export const WEB_SESSION_STORAGE_KEY = "mycrobo.web.session.v1";
export const WEB_SELECTED_TENANT_STORAGE_KEY = "mycrobo.web.selected-tenant.v1";
const PUBLIC_CONFIG_FIELDS = new Set(["authMode", "supabaseUrl", "supabaseAnonKey"]);
const MEMBERSHIP_ROLES = new Set(["owner", "admin", "member", "viewer"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_ACTIVE_MEMBERSHIPS = 100;

function boundedOpaqueRefreshToken(value) {
  // Supabase documents refresh tokens as opaque, randomly generated strings;
  // their length and format are not part of the public contract. Validate only
  // the storage boundary here and let Supabase authenticate the token.
  return typeof value === "string" && value.length > 0 && value.length <= 4096 && value.trim() === value;
}

export function publicSupabaseKey(value) {
  if (typeof value !== "string" || value.length > 4096) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]{16,}$/u.test(value)) return true;
  const parts = value.split(".");
  if (parts.length !== 3 || !parts.every((part) => /^[A-Za-z0-9_-]+$/u.test(part))) return false;
  try {
    // This is a privilege check, not signature verification. Supabase verifies
    // the public project key; a server credential must never leave the Worker.
    const encoded = parts[1].replace(/-/gu, "+").replace(/_/gu, "/");
    return JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="))).role === "anon";
  } catch { return false; }
}

export function validSupabaseWebConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 3
      || Object.keys(value).some((key) => !PUBLIC_CONFIG_FIELDS.has(key))
      || value.authMode !== "supabase" || typeof value.supabaseUrl !== "string" || !publicSupabaseKey(value.supabaseAnonKey)) return false;
  try {
    const url = new URL(value.supabaseUrl);
    return url.protocol === "https:" && /^[a-z0-9-]+\.supabase\.co$/u.test(url.hostname)
      && !url.username && !url.password && !url.port && !url.search && !url.hash && url.pathname === "/"
      && (value.supabaseUrl === url.origin || value.supabaseUrl === `${url.origin}/`);
  } catch {
    return false;
  }
}

export function localWebAuthContext({ nativeDesktop = false, origin = "" } = {}) {
  if (nativeDesktop === true) return true;
  try {
    const url = new URL(origin);
    return ["http:", "https:"].includes(url.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      && !url.username && !url.password;
  } catch { return false; }
}

export function webAuthConfigurationMode(status, value, context = {}) {
  if (status === 404) return localWebAuthContext(context) ? "not-applicable" : "blocked";
  if (!Number.isInteger(status) || status < 200 || status >= 300) return "blocked";
  // This explicit profile is emitted by the hosted Worker, including local
  // Worker development. Native gateways identify themselves by the 404 above.
  if (value?.authMode === "local-or-access" && Object.keys(value).length === 1) return "access";
  return validSupabaseWebConfig(value) ? "supabase" : "blocked";
}

export function usableWebSession(value, nowMs = Date.now()) {
  return Boolean(value
    && typeof value.access_token === "string"
    && value.access_token.length > 20
    && boundedOpaqueRefreshToken(value.refresh_token)
    && Number.isFinite(value.expires_at)
    && value.expires_at * 1000 > nowMs + 60_000);
}

export function shouldAttachWebSession(input, origin) {
  try {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, origin);
    return url.origin === origin && (url.pathname.startsWith("/api/") || url.pathname.startsWith("/v1/"));
  } catch {
    return false;
  }
}

export function activeMembershipPath(userId) {
  if (!validTenantId(userId)) return null;
  // Request one row beyond the closed-pilot ceiling so the client can reject
  // a truncated directory instead of silently choosing from an incomplete set.
  return `/rest/v1/tenant_memberships?select=tenant_id,membership_role,membership_state&user_id=eq.${encodeURIComponent(userId)}&membership_state=eq.active&order=tenant_id.asc&limit=${MAX_ACTIVE_MEMBERSHIPS + 1}`;
}

export function validTenantId(value) {
  return typeof value === "string" && UUID.test(value);
}

export function normalizeActiveMemberships(rows) {
  if (!Array.isArray(rows) || rows.length > MAX_ACTIVE_MEMBERSHIPS) return null;
  const observed = new Set();
  const memberships = [];
  for (const row of rows) {
    const tenantId = typeof row?.tenant_id === "string" ? row.tenant_id.toLowerCase() : "";
    if (!row || typeof row !== "object" || Array.isArray(row)
        || !validTenantId(row.tenant_id) || row.membership_state !== "active"
        || !MEMBERSHIP_ROLES.has(row.membership_role) || observed.has(tenantId)) return null;
    observed.add(tenantId);
    memberships.push(Object.freeze({
      tenant_id: tenantId,
      membership_role: row.membership_role,
      membership_state: "active",
    }));
  }
  memberships.sort((left, right) => left.tenant_id.localeCompare(right.tenant_id));
  return Object.freeze(memberships);
}

export function resolveActiveMembershipSelection(rows, selectedTenantId = null) {
  const memberships = normalizeActiveMemberships(rows);
  if (!memberships) return Object.freeze({ status: "invalid-directory", membership: null, memberships: Object.freeze([]) });
  const requested = selectedTenantId === null || selectedTenantId === undefined ? "" : String(selectedTenantId).trim().toLowerCase();
  if (requested) {
    const membership = validTenantId(requested)
      ? memberships.find((candidate) => candidate.tenant_id === requested) || null
      : null;
    return Object.freeze({ status: membership ? "selected" : "stale-selection", membership, memberships });
  }
  if (memberships.length === 1) return Object.freeze({ status: "single", membership: memberships[0], memberships });
  return Object.freeze({ status: memberships.length ? "choice-required" : "no-membership", membership: null, memberships });
}

export function sessionFromAuthPayload(payload, nowMs = Date.now()) {
  if (typeof payload?.access_token !== "string" || payload.access_token.length <= 20 || payload.access_token.length > 16_384
      || !boundedOpaqueRefreshToken(payload?.refresh_token)
      || !Number.isFinite(Number(payload.expires_in)) || Number(payload.expires_in) <= 60 || Number(payload.expires_in) > 86_400) return null;
  return Object.freeze({
    access_token: String(payload.access_token),
    refresh_token: String(payload.refresh_token),
    expires_at: Math.floor(nowMs / 1000) + Math.max(1, Number(payload.expires_in)),
    user_id: typeof payload.user?.id === "string" ? payload.user.id : null,
    email: typeof payload.user?.email === "string" ? payload.user.email : null,
  });
}

export function hostedSessionDescriptor(identity = null, authMode = "supabase") {
  return Object.freeze({
    surface: "closed-pilot-web", authenticated: true, authMode,
    user: identity?.user ? Object.freeze({ id: String(identity.user.id), email: String(identity.user.email || "") }) : null,
    membership: identity?.membership ? Object.freeze({ tenantId: String(identity.membership.tenant_id), role: String(identity.membership.membership_role), state: "active" }) : null,
    workspaceSwitchAvailable: Number(identity?.membershipCount || 0) > 1,
  });
}

export function closedPilotBoundary(value) {
  return Boolean(value?.surface === "closed-pilot-web" && value.desktopConnector === "not_paired"
    && value.privateChatTransit === false && value.bridgeCredentialsAvailable === false && value.realMessageSending === false
    && value.googleOAuthAvailable === false
    && value.trustedRelay?.protocol === "mycrobo.relay-envelope.1"
    && ["not_provisioned", "foundation_installed"].includes(value.trustedRelay.stage)
    && value.trustedRelay.pairingAvailable === false
    && Array.isArray(value.trustedRelay.capabilities) && value.trustedRelay.capabilities.length === 0
    && value.trustedRelay.ciphertextOnly === true);
}

export function recoverySessionFromHash(hash, nowMs = Date.now()) {
  const params = new URLSearchParams(String(hash || "").replace(/^#/u, ""));
  if (params.get("type") !== "recovery") return null;
  return sessionFromAuthPayload({
    access_token: params.get("access_token"),
    refresh_token: params.get("refresh_token"),
    expires_in: Number(params.get("expires_in") || 3600),
    user: {},
  }, nowMs);
}
