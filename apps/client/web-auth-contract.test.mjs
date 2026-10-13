import assert from "node:assert/strict";
import test from "node:test";

import {
  activeMembershipPath,
  normalizeActiveMemberships,
  resolveActiveMembershipSelection,
  recoverySessionFromHash,
  sessionFromAuthPayload,
  shouldAttachWebSession,
  usableWebSession,
  validSupabaseWebConfig,
  webAuthConfigurationMode,
  hostedSessionDescriptor,
  closedPilotBoundary,
} from "./web-auth-contract.mjs";

test("accepts only bounded HTTPS Supabase browser configuration", () => {
  assert.equal(validSupabaseWebConfig({
    authMode: "supabase",
    supabaseUrl: "https://project.supabase.co",
    supabaseAnonKey: "sb_publishable_syntheticPublicTestKeyOnly",
  }), true);
  assert.equal(validSupabaseWebConfig({
    authMode: "supabase",
    supabaseUrl: "http://project.supabase.co",
    supabaseAnonKey: "sb_publishable_syntheticPublicTestKeyOnly",
  }), false);
  assert.equal(validSupabaseWebConfig({
    authMode: "supabase",
    supabaseUrl: "https://example.com",
    supabaseAnonKey: "sb_publishable_syntheticPublicTestKeyOnly",
  }), false);
});

test("hosted authentication fails closed before the private app can start", () => {
  const valid = {
    authMode: "supabase",
    supabaseUrl: "https://project.supabase.co",
    supabaseAnonKey: "sb_publishable_syntheticPublicTestKeyOnly",
  };
  assert.equal(webAuthConfigurationMode(200, valid), "supabase");
  assert.equal(webAuthConfigurationMode(503, { error: "supabase_auth_not_configured" }), "blocked");
  assert.equal(webAuthConfigurationMode(200, { authMode: "supabase" }), "blocked");
  assert.equal(webAuthConfigurationMode(200, { authMode: "local-or-access" }), "access");
  assert.equal(webAuthConfigurationMode(404, {}), "blocked");
  for (const context of [{ nativeDesktop: true }, { origin: "http://127.0.0.1:4177" }, { origin: "http://localhost:4177" }, { origin: "http://3.26.156.50" }]) {
    assert.equal(webAuthConfigurationMode(404, {}, context), "not-applicable");
    assert.equal(webAuthConfigurationMode(200, { authMode: "local-or-access" }, context), "access");
  }
  assert.equal(webAuthConfigurationMode(404, {}, { origin: "https://pilot.example" }), "blocked");
  assert.equal(webAuthConfigurationMode(404, {}, { nativeDesktop: "true", origin: "https://localhost.evil.example" }), "blocked");
});

test("public config rejects elevated keys, extra fields and non-canonical URLs", () => {
  const valid = { authMode: "supabase", supabaseUrl: "https://project.supabase.co", supabaseAnonKey: "sb_publishable_syntheticPublicTestKeyOnly" };
  for (const supabaseUrl of ["https://user:password@project.supabase.co", "https://project.supabase.co/path", "https://project.supabase.co?x=1", "https://project.supabase.co/#x", "https://project.supabase.co:443", "https://other.project.supabase.co", "https://project.supabase.co.evil.example"]) {
    assert.equal(validSupabaseWebConfig({ ...valid, supabaseUrl }), false, supabaseUrl);
  }
  for (const role of ["service_role", "authenticated", null]) {
    const key = `e30.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
    assert.equal(validSupabaseWebConfig({ ...valid, supabaseAnonKey: key }), false);
  }
  const anon = `e30.${Buffer.from('{"role":"anon"}').toString("base64url")}.signature`;
  assert.equal(validSupabaseWebConfig({ ...valid, supabaseAnonKey: anon }), true);
  assert.equal(validSupabaseWebConfig({ ...valid, supabaseAnonKey: "sb_secret_syntheticPrivilegedTestValue" }), false);
  assert.equal(validSupabaseWebConfig({ ...valid, secret: "never-expose" }), false);
  assert.equal(validSupabaseWebConfig({ ...valid, supabaseAnonKey: "x".repeat(5000) }), false);
});

test("hosted descriptor omits all credentials and boundary rejects unavailable capability truth", () => {
  const descriptor = hostedSessionDescriptor({ user: { id: "user", email: "pilot@example.test", access_token: "secret" }, membership: { tenant_id: "tenant", membership_role: "member", refresh_token: "secret" } });
  assert.equal(descriptor.surface, "closed-pilot-web");
  assert.doesNotMatch(JSON.stringify(descriptor), /secret|token/u);
  const boundary = { surface: "closed-pilot-web", desktopConnector: "not_paired", privateChatTransit: false, bridgeCredentialsAvailable: false, realMessageSending: false, googleOAuthAvailable: false, trustedRelay: { protocol: "mycrobo.relay-envelope.1", stage: "foundation_installed", pairingAvailable: false, capabilities: [], ciphertextOnly: true } };
  assert.equal(closedPilotBoundary(boundary), true);
  for (const key of ["privateChatTransit", "bridgeCredentialsAvailable", "realMessageSending", "googleOAuthAvailable"]) assert.equal(closedPilotBoundary({ ...boundary, [key]: true }), false);
  assert.equal(closedPilotBoundary({ ...boundary, trustedRelay: { ...boundary.trustedRelay, pairingAvailable: true } }), false);
  assert.equal(closedPilotBoundary({ ...boundary, trustedRelay: { ...boundary.trustedRelay, capabilities: ["chat_read"] } }), false);
});

test("sessions are usable only with both tokens and a safe remaining lifetime", () => {
  const now = 1_700_000_000_000;
  const session = sessionFromAuthPayload({
    access_token: "a".repeat(32),
    refresh_token: "r".repeat(32),
    expires_in: 3600,
    user: { id: "user-1", email: "user@example.com" },
  }, now);
  assert.ok(session);
  assert.equal(usableWebSession(session, now), true);
  assert.equal(usableWebSession({ ...session, expires_at: Math.floor(now / 1000) + 30 }, now), false);
  assert.equal(sessionFromAuthPayload({ access_token: "x", expires_in: 3600 }, now), null);
});

test("sessions accept Supabase opaque refresh tokens without inventing a minimum format", () => {
  const now = 1_700_000_000_000;
  const session = sessionFromAuthPayload({
    access_token: "a".repeat(32),
    refresh_token: "opaqueToken1",
    expires_in: 3600,
    user: { id: "user-1", email: "pilot@example.test" },
  }, now);

  assert.equal(usableWebSession(session, now), true);
  assert.equal(sessionFromAuthPayload({ access_token: "a".repeat(32), refresh_token: "", expires_in: 3600 }, now), null);
  assert.equal(sessionFromAuthPayload({ access_token: "a".repeat(32), refresh_token: " token ", expires_in: 3600 }, now), null);
});

test("bearer attachment is limited to same-origin private APIs", () => {
  const origin = "https://mycrobo.example";
  assert.equal(shouldAttachWebSession("/api/v1/chats", origin), true);
  assert.equal(shouldAttachWebSession("/v1/context", origin), true);
  assert.equal(shouldAttachWebSession("/index.html", origin), false);
  assert.equal(shouldAttachWebSession("https://attacker.example/api/v1/chats", origin), false);
});

test("active membership lookup matches the deployed tenant schema", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  assert.equal(
    activeMembershipPath(userId),
    `/rest/v1/tenant_memberships?select=tenant_id,membership_role,membership_state&user_id=eq.${userId}&membership_state=eq.active&order=tenant_id.asc&limit=101`,
  );
  assert.equal(activeMembershipPath("not-a-user-id"), null);
});

test("active membership directories are validated, deduplicated and ordered deterministically", () => {
  const tenantA = "11111111-1111-4111-8111-111111111111";
  const tenantB = "22222222-2222-4222-8222-222222222222";
  const rows = [
    { tenant_id: tenantB, membership_role: "viewer", membership_state: "active" },
    { tenant_id: tenantA, membership_role: "admin", membership_state: "active" },
  ];
  assert.deepEqual(normalizeActiveMemberships(rows).map((membership) => membership.tenant_id), [tenantA, tenantB]);
  assert.equal(normalizeActiveMemberships([...rows, rows[0]]), null, "duplicate tenant rows fail closed");
  assert.equal(normalizeActiveMemberships([...rows, { ...rows[0], tenant_id: tenantB.toUpperCase() }]), null,
    "case-variant duplicate tenant rows fail closed");
  assert.equal(normalizeActiveMemberships([{ ...rows[0], membership_state: "suspended" }]), null);
  assert.equal(normalizeActiveMemberships(Array.from({ length: 101 }, (_, index) => ({
    tenant_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    membership_role: "member",
    membership_state: "active",
  }))), null, "a possibly truncated membership directory fails closed");
});

test("workspace selection never treats a foreign or stale tenant id as active", () => {
  const tenantA = "11111111-1111-4111-8111-111111111111";
  const tenantB = "22222222-2222-4222-8222-222222222222";
  const foreign = "33333333-3333-4333-8333-333333333333";
  const rows = [
    { tenant_id: tenantB, membership_role: "viewer", membership_state: "active" },
    { tenant_id: tenantA, membership_role: "member", membership_state: "active" },
  ];
  assert.equal(resolveActiveMembershipSelection(rows).status, "choice-required");
  assert.equal(resolveActiveMembershipSelection(rows, tenantB).membership.tenant_id, tenantB);
  assert.equal(resolveActiveMembershipSelection(rows, foreign).status, "stale-selection");
  assert.equal(resolveActiveMembershipSelection(rows, "not-a-tenant").status, "stale-selection");
  assert.equal(resolveActiveMembershipSelection([rows[0]]).status, "single");
  assert.equal(resolveActiveMembershipSelection([]).status, "no-membership");
});

test("password recovery accepts only a complete recovery fragment", () => {
  const now = 1_700_000_000_000;
  const complete = recoverySessionFromHash(
    `#type=recovery&access_token=${"a".repeat(32)}&refresh_token=${"r".repeat(32)}&expires_in=3600`,
    now,
  );
  assert.ok(complete);
  assert.equal(usableWebSession(complete, now), true);
  assert.equal(recoverySessionFromHash("#type=signup&access_token=x", now), null);
  assert.equal(recoverySessionFromHash("#type=recovery&access_token=x", now), null);
});
