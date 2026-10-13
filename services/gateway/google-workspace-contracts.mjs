import { createHash, randomBytes } from "node:crypto";

export const GOOGLE_WORKSPACE_READ_ONLY_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.readonly",
]);

export const GOOGLE_WORKSPACE_ENDPOINTS = Object.freeze({
  authorization: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
});

const AUTHORIZATION_TTL_MS = 10 * 60_000;
const PROVIDER = "google-workspace";

function requiredId(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > 160) throw new Error(`${label} is required.`);
  return normalized;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("base64url");
}

function bindingOf(input) {
  return Object.freeze({
    tenantId: requiredId(input?.tenantId, "A tenant binding"),
    userId: requiredId(input?.userId, "A user binding"),
    provider: PROVIDER,
  });
}

function validRedirectUri(value) {
  const url = new URL(String(value || ""));
  const loopback = url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !loopback) throw new Error("Google OAuth redirect must use HTTPS or an exact loopback address.");
  if (url.username || url.password || url.hash) throw new Error("Google OAuth redirect cannot include credentials or a fragment.");
  return url.toString();
}

function assertReadOnlyScopes(scopes) {
  const normalized = [...new Set((scopes || []).map(String))].sort();
  const expected = [...GOOGLE_WORKSPACE_READ_ONLY_SCOPES].sort();
  if (normalized.length !== expected.length || normalized.some((scope, index) => scope !== expected[index])) {
    throw new Error("Google Workspace access must use only the approved Gmail and Calendar read-only scopes.");
  }
  return Object.freeze(normalized);
}

export function assertOAuthStateStore(store) {
  if (store?.security?.ephemeral !== true || store?.security?.oneTimeConsume !== true
    || typeof store.put !== "function" || typeof store.take !== "function" || typeof store.deleteBinding !== "function") {
    throw new Error("OAuth state requires an ephemeral, one-time state store with binding deletion.");
  }
  return store;
}

export function assertEncryptedTokenVault(vault) {
  if (vault?.security?.encryptedAtRest !== true || vault?.security?.tenantUserScoped !== true
    || vault?.security?.exportablePlaintext !== false
    || typeof vault.putTokenSet !== "function" || typeof vault.getTokenSet !== "function" || typeof vault.deleteTokenSet !== "function") {
    throw new Error("Google tokens require a non-exportable encrypted vault scoped to tenant and user.");
  }
  return vault;
}

export function googleTokenVaultKey(input) {
  return bindingOf(input);
}

export class GoogleWorkspaceConnectorFoundation {
  constructor({ clientId = "", oauthStateStore, tokenVault = null, now = () => new Date(), randomBytesImpl = randomBytes } = {}) {
    this.clientId = String(clientId || "").trim();
    this.oauthStateStore = assertOAuthStateStore(oauthStateStore);
    this.tokenVault = tokenVault ? assertEncryptedTokenVault(tokenVault) : null;
    this.now = now;
    this.randomBytes = randomBytesImpl;
  }

  get readiness() {
    return Object.freeze({
      configured: Boolean(this.clientId && this.tokenVault),
      provider: PROVIDER,
      authorizationMode: "authorization-code-pkce",
      scopes: GOOGLE_WORKSPACE_READ_ONLY_SCOPES,
      transportIncluded: false,
    });
  }

  async beginAuthorization({ tenantId, userId, redirectUri }) {
    if (!this.clientId) throw new Error("A Google OAuth client ID is required before authorization can start.");
    const binding = bindingOf({ tenantId, userId });
    const exactRedirectUri = validRedirectUri(redirectUri);
    const state = base64Url(this.randomBytes(32));
    const codeVerifier = base64Url(this.randomBytes(64));
    const codeChallenge = digest(codeVerifier);
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + AUTHORIZATION_TTL_MS);
    await this.oauthStateStore.put({
      stateDigest: digest(state),
      binding,
      codeVerifier,
      redirectUri: exactRedirectUri,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    const authorizationUrl = new URL(GOOGLE_WORKSPACE_ENDPOINTS.authorization);
    authorizationUrl.search = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: exactRedirectUri,
      response_type: "code",
      scope: GOOGLE_WORKSPACE_READ_ONLY_SCOPES.join(" "),
      access_type: "offline",
      include_granted_scopes: "false",
      prompt: "consent",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      state,
    }).toString();
    return Object.freeze({
      provider: PROVIDER,
      authorizationUrl: authorizationUrl.toString(),
      expiresAt: expiresAt.toISOString(),
      binding,
    });
  }

  async prepareTokenExchange({ tenantId, userId, state, code, error }) {
    const binding = bindingOf({ tenantId, userId });
    const pending = await this.oauthStateStore.take(digest(requiredId(state, "OAuth state")));
    if (!pending) throw new Error("The Google authorization state is missing, expired or already used.");
    if (pending.binding?.tenantId !== binding.tenantId || pending.binding?.userId !== binding.userId || pending.binding?.provider !== PROVIDER) {
      throw new Error("The Google authorization state does not belong to this tenant and user.");
    }
    if (Date.parse(pending.expiresAt) <= this.now().getTime()) throw new Error("The Google authorization state expired.");
    if (error) throw new Error("Google authorization was cancelled or denied.");
    const authorizationCode = requiredId(code, "An authorization code");
    return Object.freeze({
      kind: "external-google-token-exchange",
      endpoint: GOOGLE_WORKSPACE_ENDPOINTS.token,
      binding,
      form: Object.freeze({
        client_id: this.clientId,
        code: authorizationCode,
        code_verifier: pending.codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: pending.redirectUri,
      }),
      requiredVault: "encrypted-tenant-user-provider",
    });
  }

  async commitTokenSet({ tenantId, userId, tokenSet, grantedScopes }) {
    if (!this.tokenVault) throw new Error("An encrypted token vault must be configured before tokens can be accepted.");
    const binding = bindingOf({ tenantId, userId });
    const scopes = assertReadOnlyScopes(grantedScopes);
    if (!tokenSet?.accessToken || !tokenSet?.refreshToken) throw new Error("The external token exchange did not return a renewable token set.");
    await this.tokenVault.putTokenSet(binding, tokenSet);
    return Object.freeze({ provider: PROVIDER, binding, scopes, connected: true, tokenLocation: "encrypted-vault" });
  }
}

export function createGoogleIncrementalSyncState(input) {
  const binding = bindingOf(input);
  const now = new Date(input?.now || Date.now()).toISOString();
  return Object.freeze({
    schema: "mycrobo-google-sync.1",
    binding,
    gmail: Object.freeze({ historyId: null, watch: null, lastSuccessfulSyncAt: null }),
    calendar: Object.freeze({ syncToken: null, watch: null, lastSuccessfulSyncAt: null }),
    createdAt: now,
    updatedAt: now,
  });
}

function normalizedWatch(watch, fields) {
  if (watch == null) return null;
  const result = {};
  for (const field of fields) result[field] = requiredId(watch[field], `Watch ${field}`);
  const expiration = new Date(watch.expiration).toISOString();
  return Object.freeze({ ...result, expiration });
}

export function advanceGoogleIncrementalSyncState(current, update) {
  if (current?.schema !== "mycrobo-google-sync.1") throw new Error("A valid Google incremental sync state is required.");
  const binding = bindingOf(update);
  if (current.binding?.tenantId !== binding.tenantId || current.binding?.userId !== binding.userId) throw new Error("Sync state cannot cross a tenant or user boundary.");
  const at = new Date(update?.now || Date.now()).toISOString();
  const gmail = update.gmail ? Object.freeze({
    historyId: requiredId(update.gmail.historyId, "Gmail historyId"),
    watch: normalizedWatch(update.gmail.watch, ["topicName"]),
    lastSuccessfulSyncAt: at,
  }) : current.gmail;
  const calendar = update.calendar ? Object.freeze({
    syncToken: requiredId(update.calendar.syncToken, "Calendar syncToken"),
    watch: normalizedWatch(update.calendar.watch, ["channelId", "resourceId"]),
    lastSuccessfulSyncAt: at,
  }) : current.calendar;
  return Object.freeze({ ...current, binding, gmail, calendar, updatedAt: at });
}

export function createGoogleDisconnectPlan(input, syncState = null) {
  const binding = bindingOf(input);
  if (syncState && (syncState.binding?.tenantId !== binding.tenantId || syncState.binding?.userId !== binding.userId)) {
    throw new Error("Disconnect state cannot cross a tenant or user boundary.");
  }
  return Object.freeze({
    schema: "mycrobo-google-disconnect.1",
    binding,
    actions: Object.freeze([
      ...(syncState?.gmail?.watch ? [{ kind: "stop-gmail-watch", watch: syncState.gmail.watch }] : []),
      ...(syncState?.calendar?.watch ? [{ kind: "stop-calendar-watch", watch: syncState.calendar.watch }] : []),
      { kind: "revoke-provider-token", endpoint: GOOGLE_WORKSPACE_ENDPOINTS.revoke, credentialSource: "encrypted-vault" },
      { kind: "delete-vault-token-set" },
      { kind: "delete-oauth-state" },
      { kind: "delete-sync-state" },
      { kind: "delete-derived-gmail-calendar-data" },
    ]),
    execution: "external-hooks-required",
  });
}
