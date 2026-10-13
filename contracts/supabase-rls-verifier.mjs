const EXPECTED_CONFIRMATION = "TEST_ONLY_MIGRATED_TENANT_RLS";
const DATABASE_COMMENT = "mycrobo:closed-pilot-test:v1:no-customer-data";
const DATA_PLANE_SCHEMA = "public";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const PROJECT_REF = /^[a-z0-9]{10,40}$/u;

const TENANT_TABLE_PROBES = Object.freeze([
  Object.freeze({ table: "tenants", tenantColumn: "id", userColumn: "owner_user_id" }),
  Object.freeze({ table: "tenant_memberships", tenantColumn: "tenant_id", userColumn: "user_id" }),
  Object.freeze({ table: "devices", tenantColumn: "tenant_id", userColumn: "user_id", expectedOwnRows: 2 }),
  Object.freeze({ table: "google_oauth_connections", tenantColumn: "tenant_id", userColumn: "user_id" }),
  Object.freeze({ table: "sync_cursors", tenantColumn: "tenant_id", userColumn: "user_id" }),
  Object.freeze({ table: "relationship_graph_metadata", tenantColumn: "tenant_id", userColumn: "user_id" }),
  Object.freeze({ table: "behavioral_fingerprints", tenantColumn: "tenant_id", userColumn: "user_id" }),
  Object.freeze({ table: "pwa_preferences", tenantColumn: "tenant_id", userColumn: "user_id" }),
  Object.freeze({ table: "auto_send_policy_layers", tenantColumn: "tenant_id", userColumn: "user_id" }),
  Object.freeze({ table: "audit_events", tenantColumn: "tenant_id", userColumn: "actor_user_id" }),
  Object.freeze({ table: "relay_pairing_challenges", tenantColumn: "tenant_id", userColumn: "user_id" }),
  Object.freeze({ table: "relay_sessions", tenantColumn: "tenant_id", userColumn: "user_id" }),
  Object.freeze({ table: "relay_envelopes", tenantColumn: "tenant_id", userColumn: "user_id" }),
  Object.freeze({ table: "relay_security_events", tenantColumn: "tenant_id", userColumn: "user_id" }),
]);
const TENANT_TABLES = Object.freeze(TENANT_TABLE_PROBES.map((probe) => probe.table));

export const SUPABASE_RLS_ENVIRONMENT = Object.freeze([
  "MYCROBO_SUPABASE_RLS_VERIFY", "MYCROBO_SUPABASE_TEST_CONFIRMATION",
  "MYCROBO_SUPABASE_TEST_URL", "MYCROBO_SUPABASE_TEST_PROJECT_REF",
  "MYCROBO_SUPABASE_TEST_ANON_KEY", "MYCROBO_SUPABASE_TEST_MANAGEMENT_TOKEN",
  "MYCROBO_SUPABASE_TEST_PRINCIPAL_A_JWT", "MYCROBO_SUPABASE_TEST_PRINCIPAL_A_ID",
  "MYCROBO_SUPABASE_TEST_PRINCIPAL_B_JWT", "MYCROBO_SUPABASE_TEST_PRINCIPAL_B_ID",
  "MYCROBO_SUPABASE_TEST_TENANT_A_ID", "MYCROBO_SUPABASE_TEST_TENANT_B_ID",
]);

export class SupabaseRlsVerificationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SupabaseRlsVerificationError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new SupabaseRlsVerificationError(code, message);
}

function required(environment, name) {
  const value = String(environment?.[name] || "").trim();
  if (!value) fail("CONFIGURATION_REQUIRED", `Closed-pilot RLS verification is disabled because ${name} is not configured.`);
  return value;
}

function decodeJwtPayload(token, label) {
  const parts = String(token).split(".");
  if (parts.length !== 3) fail("INVALID_SYNTHETIC_PRINCIPAL", `${label} is not a valid three-part access token.`);
  try {
    return JSON.parse(Buffer.from(parts[1].replace(/-/gu, "+").replace(/_/gu, "/"), "base64url").toString("utf8"));
  } catch {
    fail("INVALID_SYNTHETIC_PRINCIPAL", `${label} has an unreadable token payload.`);
  }
}

function validatePrincipal({ token, expectedId, tenantId, projectUrl, label, nowSeconds }) {
  const payload = decodeJwtPayload(token, label);
  const issuer = `${projectUrl.origin}/auth/v1`;
  if (payload.sub !== expectedId || payload.role !== "authenticated" || payload.aud !== "authenticated" || payload.iss !== issuer) {
    fail("INVALID_SYNTHETIC_PRINCIPAL", `${label} is not an authenticated synthetic principal for the configured test project.`);
  }
  if (!Number.isFinite(Number(payload.exp)) || Number(payload.exp) <= nowSeconds + 30) {
    fail("EXPIRED_SYNTHETIC_PRINCIPAL", `${label} is expired or too close to expiry.`);
  }
  if (payload?.app_metadata?.mycrobo_verification !== true || payload?.app_metadata?.mycrobo_tenant_id !== tenantId) {
    fail("INVALID_SYNTHETIC_PRINCIPAL", `${label} is missing the test-only tenant-bound verification claim.`);
  }
  return Object.freeze({ id: expectedId, tenantId, token });
}

export function loadSupabaseRlsVerificationConfig(environment = process.env, now = Date.now()) {
  if (required(environment, "MYCROBO_SUPABASE_RLS_VERIFY") !== "1") {
    fail("EXPLICIT_OPT_IN_REQUIRED", "Set MYCROBO_SUPABASE_RLS_VERIFY=1 only for the dedicated closed-pilot test project.");
  }
  if (required(environment, "MYCROBO_SUPABASE_TEST_CONFIRMATION") !== EXPECTED_CONFIRMATION) {
    fail("TEST_PROJECT_CONFIRMATION_REQUIRED", `MYCROBO_SUPABASE_TEST_CONFIRMATION must equal ${EXPECTED_CONFIRMATION}.`);
  }
  const projectRef = required(environment, "MYCROBO_SUPABASE_TEST_PROJECT_REF").toLowerCase();
  if (!PROJECT_REF.test(projectRef)) fail("INVALID_TEST_PROJECT", "The configured Supabase test project reference is invalid.");
  let projectUrl;
  try { projectUrl = new URL(required(environment, "MYCROBO_SUPABASE_TEST_URL")); }
  catch { fail("INVALID_TEST_PROJECT", "The configured Supabase test URL is invalid."); }
  if (projectUrl.protocol !== "https:" || projectUrl.username || projectUrl.password || projectUrl.search || projectUrl.hash || !["", "/"].includes(projectUrl.pathname) || projectUrl.hostname !== `${projectRef}.supabase.co`) {
    fail("INVALID_TEST_PROJECT", "The test URL must be the exact HTTPS URL for the configured Supabase test project reference.");
  }
  const tenantA = required(environment, "MYCROBO_SUPABASE_TEST_TENANT_A_ID");
  const tenantB = required(environment, "MYCROBO_SUPABASE_TEST_TENANT_B_ID");
  const principalAId = required(environment, "MYCROBO_SUPABASE_TEST_PRINCIPAL_A_ID");
  const principalBId = required(environment, "MYCROBO_SUPABASE_TEST_PRINCIPAL_B_ID");
  if (![tenantA, tenantB, principalAId, principalBId].every((value) => UUID.test(value)) || tenantA === tenantB || principalAId === principalBId) {
    fail("INVALID_SYNTHETIC_FIXTURE", "Two distinct UUID tenants and two distinct UUID synthetic principals are required.");
  }
  const nowSeconds = Math.floor(now / 1000);
  const principalA = validatePrincipal({ token: required(environment, "MYCROBO_SUPABASE_TEST_PRINCIPAL_A_JWT"), expectedId: principalAId, tenantId: tenantA, projectUrl, label: "Synthetic principal A", nowSeconds });
  const principalB = validatePrincipal({ token: required(environment, "MYCROBO_SUPABASE_TEST_PRINCIPAL_B_JWT"), expectedId: principalBId, tenantId: tenantB, projectUrl, label: "Synthetic principal B", nowSeconds });
  return Object.freeze({
    projectRef,
    projectUrl,
    anonKey: required(environment, "MYCROBO_SUPABASE_TEST_ANON_KEY"),
    managementToken: required(environment, "MYCROBO_SUPABASE_TEST_MANAGEMENT_TOKEN"),
    principalA,
    principalB,
  });
}

function boundedJson(text, label) {
  if (Buffer.byteLength(text, "utf8") > 64 * 1024) fail("UNEXPECTED_RESPONSE", `${label} returned more data than the verification bound permits.`);
  try { return JSON.parse(text); }
  catch { fail("UNEXPECTED_RESPONSE", `${label} did not return valid JSON.`); }
}

async function fetchJson(fetchImpl, url, init, label) {
  let response;
  try { response = await fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000) }); }
  catch { fail("NETWORK_VERIFICATION_FAILED", `${label} could not be reached.`); }
  const text = await response.text();
  if (!response.ok) fail("REMOTE_VERIFICATION_REJECTED", `${label} returned HTTP ${response.status}.`);
  return boundedJson(text, label);
}

function catalogQuery() {
  const names = TENANT_TABLES.map((name) => `'${name}'`).join(",");
  return `SELECT n.nspname AS table_schema, c.relname AS table_name, c.relrowsecurity, c.relforcerowsecurity, shobj_description(d.oid, 'pg_database') AS deployment_comment\nFROM pg_catalog.pg_class AS c\nJOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace\nJOIN pg_catalog.pg_database AS d ON d.datname = current_database()\nWHERE n.nspname = '${DATA_PLANE_SCHEMA}' AND c.relname IN (${names}) AND c.relkind IN ('r','p')\nORDER BY c.relname`;
}

function tenantTableUrl(config, probe, target = null) {
  const url = new URL(`/rest/v1/${probe.table}`, config.projectUrl);
  url.searchParams.set("select", `${probe.tenantColumn},${probe.userColumn}`);
  if (target?.tenantId) url.searchParams.set(probe.tenantColumn, `eq.${target.tenantId}`);
  if (target?.id) url.searchParams.set(probe.userColumn, `eq.${target.id}`);
  url.searchParams.set("limit", "3");
  return url;
}

function principalHeaders(config, principal) {
  return {
    apikey: config.anonKey,
    authorization: `Bearer ${principal.token}`,
    accept: "application/json",
    "accept-profile": DATA_PLANE_SCHEMA,
    "cache-control": "no-store",
  };
}

async function readTenantTable(config, probe, principal, fetchImpl, target = null) {
  const result = await fetchJson(fetchImpl, tenantTableUrl(config, probe, target), {
    method: "GET",
    headers: principalHeaders(config, principal),
  }, `Migrated ${probe.table} RLS read probe`);
  if (!Array.isArray(result)) fail("UNEXPECTED_RESPONSE", `The ${probe.table} RLS read probe did not return a row list.`);
  return result;
}

function assertOwnTenantRows(rows, probe, principal, label) {
  const expected = probe.expectedOwnRows || 1;
  if (rows.length !== expected) fail("RLS_ISOLATION_FAILED", `${label} did not see exactly its ${expected} synthetic ${probe.table} row(s).`);
  const allowed = [probe.tenantColumn, probe.userColumn];
  for (const row of rows) {
    if (Object.keys(row || {}).some((key) => !allowed.includes(key))
        || row?.[probe.tenantColumn] !== principal.tenantId
        || row?.[probe.userColumn] !== principal.id) {
      fail("RLS_ISOLATION_FAILED", `${label} received a ${probe.table} row outside its synthetic tenant fixture.`);
    }
  }
}

function assertCatalog(catalog) {
  if (!Array.isArray(catalog) || catalog.length === 0 || catalog.some((row) => row?.deployment_comment !== DATABASE_COMMENT)) {
    fail("TEST_PROJECT_NOT_PROVEN", "The target database is not marked as a no-customer-data closed-pilot test project.");
  }
  const expected = new Set(TENANT_TABLES);
  const observed = new Set();
  for (const row of catalog) {
    if (row?.table_schema !== DATA_PLANE_SCHEMA || !expected.has(row?.table_name) || observed.has(row.table_name)) {
      fail("FORCED_RLS_NOT_PROVEN", "The catalog response did not contain exactly the allowlisted migrated tenant tables.");
    }
    observed.add(row.table_name);
    if (row.relrowsecurity !== true || row.relforcerowsecurity !== true) {
      fail("FORCED_RLS_NOT_PROVEN", `The migrated table ${row.table_name} does not have both RLS and FORCE RLS enabled.`);
    }
  }
  if (catalog.length !== TENANT_TABLES.length || observed.size !== expected.size || TENANT_TABLES.some((table) => !observed.has(table))) {
    fail("FORCED_RLS_NOT_PROVEN", "The catalog response did not prove RLS and FORCE RLS for every migrated tenant table.");
  }
}

export async function verifySupabaseForcedRls(config, { fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") fail("VERIFIER_UNAVAILABLE", "A standards-compatible fetch implementation is required.");
  if (!config || !(config.projectUrl instanceof URL) || !config.projectRef || !config.principalA || !config.principalB) {
    fail("CONFIGURATION_REQUIRED", "Validated closed-pilot Supabase RLS configuration is required.");
  }
  const catalog = await fetchJson(fetchImpl, `https://api.supabase.com/v1/projects/${config.projectRef}/database/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${config.managementToken}`, "content-type": "application/json", accept: "application/json", "cache-control": "no-store" },
    body: JSON.stringify({ query: catalogQuery() }),
  }, "Supabase test-project catalog check");
  assertCatalog(catalog);

  let ownFixtureReads = 0;
  let crossTenantReadProbes = 0;
  for (const probe of TENANT_TABLE_PROBES) {
    const [rowsA, rowsB, foreignA, foreignB] = await Promise.all([
      readTenantTable(config, probe, config.principalA, fetchImpl),
      readTenantTable(config, probe, config.principalB, fetchImpl),
      readTenantTable(config, probe, config.principalA, fetchImpl, config.principalB),
      readTenantTable(config, probe, config.principalB, fetchImpl, config.principalA),
    ]);
    assertOwnTenantRows(rowsA, probe, config.principalA, "Synthetic principal A");
    assertOwnTenantRows(rowsB, probe, config.principalB, "Synthetic principal B");
    if (foreignA.length !== 0 || foreignB.length !== 0) {
      fail("CROSS_TENANT_ACCESS_DETECTED", `A synthetic principal could read the other synthetic tenant's ${probe.table} row.`);
    }
    ownFixtureReads += rowsA.length + rowsB.length;
    crossTenantReadProbes += 2;
  }

  return Object.freeze({
    ok: true,
    environment: "closed-pilot-test-only",
    schema: DATA_PLANE_SCHEMA,
    tables: TENANT_TABLES.length,
    forcedRlsTables: TENANT_TABLES.length,
    syntheticPrincipals: 2,
    ownFixtureReads,
    crossTenantReadProbes,
    crossTenantRowsVisible: 0,
    mutationsAttempted: 0,
  });
}

export const SUPABASE_RLS_VERIFICATION_CONTRACT = Object.freeze({
  schema: DATA_PLANE_SCHEMA,
  tables: TENANT_TABLES,
  databaseComment: DATABASE_COMMENT,
  confirmation: EXPECTED_CONFIRMATION,
});
