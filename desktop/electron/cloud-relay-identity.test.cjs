const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");
const { BINDING_FILE, createCloudRelayIdentity, validateWebConfig } = require("./cloud-relay-identity.cjs");

const config = Object.freeze({
  schema: "mycrobo-cloud-deployment.1",
  origin: "https://pilot.example.test",
  supabaseProjectRef: "abcdefghijklmnopqrst",
});
const cloudUserId = "11111111-1111-4111-8111-111111111111";
const cloudTenantId = "22222222-2222-4222-8222-222222222222";
const otherTenantId = "33333333-3333-4333-8333-333333333333";
const anonKey = "sb_publishable_syntheticPublicKeyForTestsOnly";
const identity = Object.freeze({ user: { id: "local-user", email: "pilot@example.test" }, tenant: { id: "tenant-0123456789abcdef", role: "owner" } });

function safeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`protected:${Buffer.from(value).toString("base64")}`),
    decryptString: (value) => JSON.parse(JSON.stringify(Buffer.from(value).toString())).startsWith("protected:")
      ? Buffer.from(Buffer.from(value).toString().slice(10), "base64").toString("utf8")
      : (() => { throw new Error("unreadable"); })(),
  };
}

function fixture({ memberships = [{ tenant_id: cloudTenantId, membership_role: "admin", membership_state: "active" }], authEmail = "pilot@example.test", projectRef = config.supabaseProjectRef } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "mycrobo-cloud-relay-"));
  const configPath = join(directory, "cloud.json");
  writeFileSync(configPath, JSON.stringify(config));
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url) === `${config.origin}/api/v1/web-config`) return Response.json({ authMode: "supabase", supabaseUrl: `https://${projectRef}.supabase.co`, supabaseAnonKey: anonKey });
    if (String(url).includes("/auth/v1/token?grant_type=password")) return Response.json({ access_token: "access-token-value", refresh_token: "refresh-token-value", expires_in: 3600, user: { id: cloudUserId, email: authEmail } });
    if (String(url).includes("/rest/v1/tenant_memberships")) return Response.json(memberships);
    return Response.json({ error: "unexpected" }, { status: 404 });
  };
  return { calls, configPath, directory, fetchImpl, relay: createCloudRelayIdentity({ configPath, fetchImpl, safeStorage: safeStorage(), now: () => "2026-10-09T10:00:00.000Z", createDeviceId: () => "44444444-4444-4444-8444-444444444444" }) };
}

test("bind proves the same account and membership while keeping secrets in Windows-protected storage", async () => {
  const run = fixture();
  const result = await run.relay.bind({ tenantData: run.directory, identity, email: " PILOT@example.test ", password: "correct horse battery staple" });
  assert.deepEqual(result, {
    state: "identity_bound_key_protected", prepared: true, tenantId: cloudTenantId, role: "admin", lastVerifiedAt: "2026-10-09T10:00:00.000Z",
    pairingAvailable: false, cloudRegistrationAvailable: false, capabilities: [],
  });
  const protectedBytes = readFileSync(join(run.directory, BINDING_FILE));
  assert.doesNotMatch(protectedBytes.toString(), /correct horse|access-token|refresh-token|PRIVATE/iu);
  const decrypted = JSON.parse(safeStorage().decryptString(protectedBytes));
  assert.equal(decrypted.cloudTenantId, cloudTenantId);
  assert.equal(decrypted.localTenantId, identity.tenant.id);
  assert.equal(decrypted.password, undefined);
  assert.equal(decrypted.accessToken, "access-token-value");
  assert.match(decrypted.privateKeyPkcs8, /^[A-Za-z0-9_-]{80,}$/u);
  assert.deepEqual(run.relay.status({ tenantData: run.directory, identity }), result);
  assert.equal(run.calls.length, 3);
});

test("bind rejects a different authenticated person and a wrong deployment project", async () => {
  const mismatch = fixture({ authEmail: "other@example.test" });
  await assert.rejects(() => mismatch.relay.bind({ tenantData: mismatch.directory, identity, email: identity.user.email, password: "valid-password" }), /does not match/iu);
  const wrongProject = fixture({ projectRef: "zyxwvutsrqponmlkjihg" });
  await assert.rejects(() => wrongProject.relay.bind({ tenantData: wrongProject.directory, identity, email: identity.user.email, password: "valid-password" }), /expected closed-pilot project/iu);
  assert.throws(() => validateWebConfig({ authMode: "supabase", supabaseUrl: `https://${config.supabaseProjectRef}.supabase.co`, supabaseAnonKey: "e30.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature" }, config.supabaseProjectRef), /bounded public/iu);
});

test("multiple cloud workspaces require an explicit choice and never retain the password", async () => {
  const run = fixture({ memberships: [
    { tenant_id: cloudTenantId, membership_role: "admin", membership_state: "active" },
    { tenant_id: otherTenantId, membership_role: "member", membership_state: "active" },
  ] });
  const choice = await run.relay.bind({ tenantData: run.directory, identity, email: identity.user.email, password: "valid-password" });
  assert.equal(choice.choiceRequired, true);
  assert.deepEqual(choice.memberships, [{ tenantId: cloudTenantId, role: "admin" }, { tenantId: otherTenantId, role: "member" }]);
  assert.equal(run.relay.status({ tenantData: run.directory, identity }).prepared, false);
  const selected = await run.relay.bind({ tenantData: run.directory, identity, email: identity.user.email, password: "valid-password", cloudTenantId: otherTenantId });
  assert.equal(selected.tenantId, otherTenantId);
});

test("missing membership and a cross-workspace or corrupted local binding fail closed", async () => {
  const missing = fixture({ memberships: [] });
  await assert.rejects(() => missing.relay.bind({ tenantData: missing.directory, identity, email: identity.user.email, password: "valid-password" }), /no active/iu);
  const run = fixture();
  await run.relay.bind({ tenantData: run.directory, identity, email: identity.user.email, password: "valid-password" });
  assert.throws(() => run.relay.status({ tenantData: run.directory, identity: { ...identity, tenant: { id: "tenant-fedcba9876543210", role: "owner" } } }), /does not belong/iu);
  writeFileSync(join(run.directory, BINDING_FILE), "not protected");
  assert.throws(() => run.relay.status({ tenantData: run.directory, identity }), /cannot be opened/iu);
});
