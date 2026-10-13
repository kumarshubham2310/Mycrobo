import assert from "node:assert/strict";
import test from "node:test";

import { ensureBrowserRelayIdentity, relayDeviceRegistration } from "./relay-device.mjs";

const tenantId = "018f3f2e-f7e7-4e39-8a88-6c4e76829f11";
const userId = "028f3f2e-f7e7-4e39-8a88-6c4e76829f12";
const deviceId = "038f3f2e-f7e7-4e39-8a88-6c4e76829f13";

test("browser relay registration exposes only a device id and public key", () => {
  const publicKey = "A".repeat(87);
  assert.deepEqual(relayDeviceRegistration({ deviceId, publicKey, privateKey: "never serialized" }), { deviceId, publicKey });
  assert.throws(() => relayDeviceRegistration({ deviceId: "wrong", publicKey }), /invalid/u);
  assert.throws(() => relayDeviceRegistration({ deviceId, publicKey: "short" }), /invalid/u);
});

test("browser relay identity is tenant-user scoped and re-imports the private key as non-exportable", async () => {
  const records = new Map();
  const store = {
    async get(scope) { return records.get(scope) || null; },
    async put(record) { records.set(record.scope, record); },
  };
  const generatedPrivate = { kind: "temporary-private" };
  const storedPrivate = { kind: "stored-private" };
  const calls = [];
  const cryptoImpl = {
    randomUUID: () => deviceId,
    subtle: {
      async generateKey(algorithm, extractable, usages) {
        calls.push({ operation: "generate", algorithm, extractable, usages });
        return { publicKey: { kind: "public" }, privateKey: generatedPrivate };
      },
      async exportKey(format, key) {
        if (key.kind === "public") return Uint8Array.from([4, ...Array(64).fill(7)]).buffer;
        return { kty: "EC", crv: "P-256", d: "synthetic", x: "x", y: "y" };
      },
      async importKey(format, key, algorithm, extractable, usages) {
        calls.push({ operation: "import", format, key, algorithm, extractable, usages });
        return storedPrivate;
      },
    },
  };

  const first = await ensureBrowserRelayIdentity({ tenantId, userId, cryptoImpl, store });
  assert.equal(first.deviceId, deviceId);
  assert.equal(first.existing, false);
  assert.equal(first.publicKey.length, 87);
  assert.equal(calls.find((call) => call.operation === "import")?.extractable, false);
  assert.equal([...records.values()][0].privateKey, storedPrivate);
  assert.equal([...records.values()][0].scope, `${tenantId}:${userId}`);

  // Node's CryptoKey constructor is not available in every supported test
  // runtime, so validate persistence through the stored payload itself here.
  assert.equal(records.size, 1);
  await assert.rejects(ensureBrowserRelayIdentity({ tenantId: "wrong", userId, cryptoImpl, store }), /verified workspace/u);
});
