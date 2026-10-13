import assert from "node:assert/strict";
import test from "node:test";
import {
  SUPABASE_RLS_VERIFICATION_CONTRACT,
  SupabaseRlsVerificationError,
  loadSupabaseRlsVerificationConfig,
  verifySupabaseForcedRls,
} from "./supabase-rls-verifier.mjs";

const NOW = Date.parse("2026-10-08T12:00:00.000Z");
const projectRef = "testprojectref12345";
const tenantA = "11111111-1111-4111-8111-111111111111";
const tenantB = "22222222-2222-4222-8222-222222222222";
const principalA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const principalB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function jwt(sub, tenantId, overrides = {}) {
  const payload = {
    iss: `https://${projectRef}.supabase.co/auth/v1`, sub, aud: "authenticated", role: "authenticated",
    exp: Math.floor(NOW / 1000) + 3600,
    app_metadata: { mycrobo_verification: true, mycrobo_tenant_id: tenantId },
    ...overrides,
  };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode(payload)}.synthetic-signature`;
}

function environment(overrides = {}) {
  return {
    MYCROBO_SUPABASE_RLS_VERIFY: "1",
    MYCROBO_SUPABASE_TEST_CONFIRMATION: SUPABASE_RLS_VERIFICATION_CONTRACT.confirmation,
    MYCROBO_SUPABASE_TEST_URL: `https://${projectRef}.supabase.co`,
    MYCROBO_SUPABASE_TEST_PROJECT_REF: projectRef,
    MYCROBO_SUPABASE_TEST_ANON_KEY: "synthetic-anon-key",
    MYCROBO_SUPABASE_TEST_MANAGEMENT_TOKEN: "synthetic-management-token",
    MYCROBO_SUPABASE_TEST_PRINCIPAL_A_JWT: jwt(principalA, tenantA),
    MYCROBO_SUPABASE_TEST_PRINCIPAL_A_ID: principalA,
    MYCROBO_SUPABASE_TEST_PRINCIPAL_B_JWT: jwt(principalB, tenantB),
    MYCROBO_SUPABASE_TEST_PRINCIPAL_B_ID: principalB,
    MYCROBO_SUPABASE_TEST_TENANT_A_ID: tenantA,
    MYCROBO_SUPABASE_TEST_TENANT_B_ID: tenantB,
    ...overrides,
  };
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function catalogRows(overrides = {}) {
  return SUPABASE_RLS_VERIFICATION_CONTRACT.tables.map((table) => ({
    table_schema: "public",
    table_name: table,
    relrowsecurity: true,
    relforcerowsecurity: true,
    deployment_comment: SUPABASE_RLS_VERIFICATION_CONTRACT.databaseComment,
    ...overrides[table],
  }));
}

function preference(tenantId, userId) {
  return { tenant_id: tenantId, user_id: userId };
}

const probeColumns = Object.freeze({
  tenants: ["id", "owner_user_id"],
  tenant_memberships: ["tenant_id", "user_id"],
  devices: ["tenant_id", "user_id"],
  google_oauth_connections: ["tenant_id", "user_id"],
  sync_cursors: ["tenant_id", "user_id"],
  relationship_graph_metadata: ["tenant_id", "user_id"],
  behavioral_fingerprints: ["tenant_id", "user_id"],
  pwa_preferences: ["tenant_id", "user_id"],
  auto_send_policy_layers: ["tenant_id", "user_id"],
  audit_events: ["tenant_id", "actor_user_id"],
  relay_pairing_challenges: ["tenant_id", "user_id"],
  relay_sessions: ["tenant_id", "user_id"],
  relay_envelopes: ["tenant_id", "user_id"],
  relay_security_events: ["tenant_id", "user_id"],
});

function fixtureRow(table, tenantId, userId) {
  const [tenantColumn, userColumn] = probeColumns[table];
  return { [tenantColumn]: tenantId, [userColumn]: userId };
}

function successfulFetch(log = []) {
  return async (rawUrl, init = {}) => {
    const url = new URL(String(rawUrl));
    log.push({ url, init });
    assert.equal(init.redirect, "error");
    if (url.hostname === "api.supabase.com") {
      const body = JSON.parse(init.body);
      assert.equal(init.method, "POST");
      assert.match(body.query, /^SELECT /u);
      assert.doesNotMatch(body.query, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE)\b/iu);
      for (const table of SUPABASE_RLS_VERIFICATION_CONTRACT.tables) assert.match(body.query, new RegExp(`'${table}'`, "u"));
      return response(catalogRows());
    }
    const table = url.pathname.replace(/^\/rest\/v1\//u, "");
    assert.ok(SUPABASE_RLS_VERIFICATION_CONTRACT.tables.includes(table));
    const [tenantColumn, userColumn] = probeColumns[table];
    assert.equal(init.headers["accept-profile"], "public");
    assert.equal(url.searchParams.get("select"), `${tenantColumn},${userColumn}`);
    const token = String(init.headers.authorization).replace(/^Bearer /u, "");
    const targetTenant = String(url.searchParams.get(tenantColumn) || "").replace(/^eq\./u, "");
    assert.equal(init.method, "GET");
    assert.equal(init.body, undefined);
    const ownRows = (tenantId, userId) => table === "devices"
      ? [fixtureRow(table, tenantId, userId), fixtureRow(table, tenantId, userId)]
      : [fixtureRow(table, tenantId, userId)];
    if (token === jwt(principalA, tenantA)) return response(targetTenant === tenantB ? [] : ownRows(tenantA, principalA));
    if (token === jwt(principalB, tenantB)) return response(targetTenant === tenantA ? [] : ownRows(tenantB, principalB));
    return response({ error: "unauthorized" }, 401);
  };
}

test("closed-pilot verifier fails closed before network access when explicit configuration is absent", async () => {
  let calls = 0;
  assert.throws(() => loadSupabaseRlsVerificationConfig({}, NOW), (error) => error instanceof SupabaseRlsVerificationError && error.code === "CONFIGURATION_REQUIRED");
  await assert.rejects(() => verifySupabaseForcedRls(undefined, { fetchImpl: async () => { calls += 1; } }));
  assert.equal(calls, 0);
});

test("configuration requires an exact test project and two tenant-bound synthetic principals", () => {
  assert.throws(() => loadSupabaseRlsVerificationConfig(environment({ MYCROBO_SUPABASE_TEST_URL: "https://different.supabase.co" }), NOW), /exact HTTPS URL/u);
  assert.throws(() => loadSupabaseRlsVerificationConfig(environment({ MYCROBO_SUPABASE_TEST_PRINCIPAL_B_ID: principalA }), NOW), /distinct UUID/u);
  assert.throws(() => loadSupabaseRlsVerificationConfig(environment({ MYCROBO_SUPABASE_TEST_PRINCIPAL_A_JWT: jwt(principalA, tenantA, { app_metadata: {} }) }), NOW), /test-only tenant-bound/u);
  assert.throws(() => loadSupabaseRlsVerificationConfig(environment({ MYCROBO_SUPABASE_TEST_PRINCIPAL_A_JWT: jwt(principalA, tenantA, { exp: Math.floor(NOW / 1000) }) }), NOW), /expired/u);
});

test("verifier proves every migrated table uses FORCE RLS and denies symmetric cross-tenant reads", async () => {
  const calls = [];
  const config = loadSupabaseRlsVerificationConfig(environment(), NOW);
  const result = await verifySupabaseForcedRls(config, { fetchImpl: successfulFetch(calls) });
  assert.deepEqual(result, {
    ok: true, environment: "closed-pilot-test-only", schema: "public", tables: 14,
    forcedRlsTables: 14, syntheticPrincipals: 2, ownFixtureReads: 30,
    crossTenantReadProbes: 28, crossTenantRowsVisible: 0, mutationsAttempted: 0,
  });
  assert.equal(calls.length, 57);
  assert.equal(calls.filter((call) => call.init.method === "GET").length, 56);
  assert.equal(calls.filter((call) => call.init.method === "POST" && call.url.hostname === "api.supabase.com").length, 1);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-(?:anon|management)|eyJ|11111111|aaaaaaaa/iu);
});

for (const table of SUPABASE_RLS_VERIFICATION_CONTRACT.tables) {
  for (const direction of [
    { label: "A-to-B", token: jwt(principalA, tenantA), foreignTenant: tenantB, foreignUser: principalB },
    { label: "B-to-A", token: jwt(principalB, tenantB), foreignTenant: tenantA, foreignUser: principalA },
  ]) {
    test(`verifier rejects ${direction.label} disclosure from ${table}`, async () => {
      const config = loadSupabaseRlsVerificationConfig(environment(), NOW);
      const base = successfulFetch();
      const [tenantColumn] = probeColumns[table];
      await assert.rejects(() => verifySupabaseForcedRls(config, { fetchImpl: async (rawUrl, init) => {
        const url = new URL(String(rawUrl));
        if (init.method === "GET" && url.pathname === `/rest/v1/${table}`
            && url.searchParams.get(tenantColumn) === `eq.${direction.foreignTenant}`
            && init.headers.authorization.endsWith(direction.token)) {
          return response([fixtureRow(table, direction.foreignTenant, direction.foreignUser)]);
        }
        return base(rawUrl, init);
      } }), (error) => error.code === "CROSS_TENANT_ACCESS_DETECTED" && error.message.includes(table));
    });
  }
}

test("verifier rejects a missing migrated table before reading fixtures", async () => {
  const calls = [];
  const config = loadSupabaseRlsVerificationConfig(environment(), NOW);
  await assert.rejects(() => verifySupabaseForcedRls(config, { fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return response(catalogRows().slice(1));
  } }), (error) => error.code === "FORCED_RLS_NOT_PROVEN");
  assert.equal(calls.length, 1);
});

test("verifier rejects an unexpected or duplicate catalog row", async () => {
  const config = loadSupabaseRlsVerificationConfig(environment(), NOW);
  const malformed = catalogRows();
  malformed[0] = { ...malformed[0], table_name: "unreviewed_table" };
  await assert.rejects(() => verifySupabaseForcedRls(config, { fetchImpl: async () => response(malformed) }), (error) => error.code === "FORCED_RLS_NOT_PROVEN");
});

test("verifier rejects any migrated table that is enabled but not forced", async () => {
  const calls = [];
  const config = loadSupabaseRlsVerificationConfig(environment(), NOW);
  await assert.rejects(() => verifySupabaseForcedRls(config, { fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return response(catalogRows({ devices: { relforcerowsecurity: false } }));
  } }), (error) => error.code === "FORCED_RLS_NOT_PROVEN" && /devices/u.test(error.message));
  assert.equal(calls.length, 1);
});

test("verifier refuses a database that is not independently marked no-customer-data test-only", async () => {
  const calls = [];
  const config = loadSupabaseRlsVerificationConfig(environment(), NOW);
  await assert.rejects(() => verifySupabaseForcedRls(config, { fetchImpl: async (url, init) => {
    calls.push({ url, init });
    return response(catalogRows(Object.fromEntries(SUPABASE_RLS_VERIFICATION_CONTRACT.tables.map((table) => [table, { deployment_comment: "production" }]))));
  } }), (error) => error.code === "TEST_PROJECT_NOT_PROVEN");
  assert.equal(calls.length, 1);
});

test("verifier rejects any tenant-owned row disclosed across synthetic tenant boundaries", async () => {
  const config = loadSupabaseRlsVerificationConfig(environment(), NOW);
  const base = successfulFetch();
  await assert.rejects(() => verifySupabaseForcedRls(config, { fetchImpl: async (rawUrl, init) => {
    const url = new URL(String(rawUrl));
    if (url.hostname !== "api.supabase.com" && url.searchParams.get("tenant_id") === `eq.${tenantB}` && init.headers.authorization.endsWith(jwt(principalA, tenantA))) {
      return response([preference(tenantB, principalB)]);
    }
    return base(rawUrl, init);
  } }), (error) => error.code === "CROSS_TENANT_ACCESS_DETECTED");
});

test("verifier rejects unfiltered tenant-table visibility outside the principal fixture", async () => {
  const config = loadSupabaseRlsVerificationConfig(environment(), NOW);
  const base = successfulFetch();
  await assert.rejects(() => verifySupabaseForcedRls(config, { fetchImpl: async (rawUrl, init) => {
    const url = new URL(String(rawUrl));
    if (url.hostname !== "api.supabase.com" && !url.searchParams.has("tenant_id") && init.headers.authorization.endsWith(jwt(principalA, tenantA))) {
      return response([preference(tenantA, principalA), preference(tenantB, principalB)]);
    }
    return base(rawUrl, init);
  } }), (error) => error.code === "RLS_ISOLATION_FAILED");
});
