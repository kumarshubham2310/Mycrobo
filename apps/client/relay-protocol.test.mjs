import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";

import {
  RELAY_CAPABILITIES,
  TRUSTED_RELAY_CONTRACT,
  createRelayReplayGuard,
  deriveRelaySessionKey,
  exportRelayPublicKey,
  generateRelayAgreementKeyPair,
  importRelayPublicKey,
  normalizeRelayBinding,
  openRelayEnvelope,
  sealRelayEnvelope,
} from "./relay-protocol.mjs";

const tenantId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const desktopId = "44444444-4444-4444-8444-444444444444";
const webId = "55555555-5555-4555-8555-555555555555";
const now = Date.parse("2026-10-09T10:00:00.000Z");
const binding = (overrides = {}) => ({
  tenantId, userId, sessionId, senderDeviceId: desktopId, recipientDeviceId: webId,
  sequence: 1, capability: "chat_read", relationshipSubjectHmac: "a".repeat(64),
  chatSubjectHmac: "b".repeat(64), keyEpoch: 1,
  issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 60_000).toISOString(),
  ...overrides,
});

async function keys() {
  const desktop = await generateRelayAgreementKeyPair({ crypto: webcrypto });
  const web = await generateRelayAgreementKeyPair({ crypto: webcrypto });
  const [desktopPublic, webPublic] = await Promise.all([
    importRelayPublicKey(await exportRelayPublicKey(desktop.publicKey, { crypto: webcrypto }), { crypto: webcrypto }),
    importRelayPublicKey(await exportRelayPublicKey(web.publicKey, { crypto: webcrypto }), { crypto: webcrypto }),
  ]);
  const digest = webcrypto.getRandomValues(new Uint8Array(32));
  const [desktopKey, webKey] = await Promise.all([
    deriveRelaySessionKey({ privateKey: desktop.privateKey, peerPublicKey: webPublic, sessionBindingDigest: digest, tenantId, userId, sessionId, crypto: webcrypto }),
    deriveRelaySessionKey({ privateKey: web.privateKey, peerPublicKey: desktopPublic, sessionBindingDigest: digest, tenantId, userId, sessionId, crypto: webcrypto }),
  ]);
  return { desktopKey, webKey };
}

test("trusted relay derives matching non-exportable session keys and exposes no delivery capability", async () => {
  const { desktopKey, webKey } = await keys();
  assert.equal(desktopKey.extractable, false);
  assert.equal(webKey.extractable, false);
  assert.deepEqual(RELAY_CAPABILITIES, ["connection_status", "chat_read", "draft_request"]);
  assert.equal(RELAY_CAPABILITIES.includes("send"), false);
  assert.equal(TRUSTED_RELAY_CONTRACT.realMessageSending, false);
});

test("ciphertext round-trips only under the exact tenant, user, devices, relationship and chat binding", async () => {
  const { desktopKey, webKey } = await keys();
  const clear = new TextEncoder().encode("private synthetic message");
  const envelope = await sealRelayEnvelope({ key: desktopKey, binding: binding(), plaintext: clear, crypto: webcrypto });
  assert.doesNotMatch(JSON.stringify(envelope), /private synthetic message/u);
  const opened = await openRelayEnvelope({ key: webKey, envelope, expectedBinding: binding(), nowMs: now + 1_000, crypto: webcrypto });
  assert.equal(new TextDecoder().decode(opened), "private synthetic message");
  await assert.rejects(
    openRelayEnvelope({ key: webKey, envelope, expectedBinding: binding({ chatSubjectHmac: "c".repeat(64) }), nowMs: now + 1_000, crypto: webcrypto }),
    /not bound to the expected/u,
  );
  await assert.rejects(
    openRelayEnvelope({ key: webKey, envelope: { ...envelope, ciphertext: `${envelope.ciphertext.slice(0, -1)}A` }, expectedBinding: binding(), nowMs: now + 1_000, crypto: webcrypto }),
    /authentication failed/u,
  );
});

test("connection status may omit chat subjects while private capabilities cannot", () => {
  assert.equal(normalizeRelayBinding(binding({ capability: "connection_status", relationshipSubjectHmac: null, chatSubjectHmac: null })).capability, "connection_status");
  assert.throws(() => normalizeRelayBinding(binding({ relationshipSubjectHmac: null })), /tenant-keyed HMAC/u);
  assert.throws(() => normalizeRelayBinding(binding({ capability: "message_send" })), /not permitted/u);
  assert.throws(() => normalizeRelayBinding(binding({ senderDeviceId: webId })), /must be distinct/u);
});

test("replay guard rejects duplicates, reordering and stale envelopes", () => {
  const guard = createRelayReplayGuard();
  guard.accept(binding(), now + 1_000);
  assert.throws(() => guard.accept(binding(), now + 1_000), /replayed or reordered/u);
  assert.throws(() => guard.accept(binding({ sequence: 0 }), now + 1_000), /sequence is invalid/u);
  guard.accept(binding({ sequence: 2 }), now + 1_000);
  assert.throws(() => guard.accept(binding({ sequence: 3 }), now + 61_000), /stale/u);
  guard.reset(sessionId);
  assert.equal(guard.size, 0);
});
