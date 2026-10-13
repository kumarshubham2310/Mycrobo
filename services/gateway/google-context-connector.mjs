import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  GOOGLE_WORKSPACE_READ_ONLY_SCOPES,
  GoogleWorkspaceConnectorFoundation,
} from "./google-workspace-contracts.mjs";

const GMAIL_PROFILE_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/profile";
const GMAIL_MESSAGES_ENDPOINT = "https://gmail.googleapis.com/gmail/v1/users/me/messages";
const CALENDAR_EVENTS_ENDPOINT = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const GOOGLE_REVOCATION_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const TOKEN_VAULT_SCHEMA = "mycrobo-google-token-vault.1";
const CONNECTION_SCHEMA = "mycrobo-google-connection.1";
const CONNECTION_STATES = new Set(["disconnected", "connecting", "connected", "error"]);
const GMAIL_CONTEXT_LIMIT = 25;
const GOOGLE_REQUEST_TIMEOUT_MS = 15_000;
const GOOGLE_RESPONSE_MAX_BYTES = 1_048_576;
const GOOGLE_CALENDAR_MAX_PAGES = 8;
const GOOGLE_CALENDAR_MAX_ITEMS = 10_000;
export const GOOGLE_CONTEXT_RETENTION = Object.freeze({
  gmailMaximumAgeDays: 30,
  calendarPastDays: 1,
  calendarFutureDays: 366,
  localCacheTtlMs: 24 * 60 * 60_000,
});

function boundedText(value, maximum) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, maximum);
}

function opaqueId(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function reducedCalendarBlocks(blocks, now = new Date()) {
  const minimum = now.getTime() - GOOGLE_CONTEXT_RETENTION.calendarPastDays * 86_400_000;
  const maximum = now.getTime() + GOOGLE_CONTEXT_RETENTION.calendarFutureDays * 86_400_000;
  return (Array.isArray(blocks) ? blocks : []).slice(0, 10_000).map((block) => ({
    start: boundedText(block?.start, 40),
    end: boundedText(block?.end, 40),
    allDay: block?.allDay === true,
    timezoneMode: block?.timezoneMode === "floating-date" ? "floating-date" : "absolute",
  })).filter((block) => Date.parse(block.end) > Date.parse(block.start)
    && Date.parse(block.end) >= minimum && Date.parse(block.start) <= maximum);
}

function requiredBinding(input = {}) {
  const tenantId = String(input.tenantId || "").trim();
  const userId = String(input.userId || "").trim();
  if (!tenantId || !userId) throw new Error("Google Workspace requires an authenticated tenant and user binding.");
  return Object.freeze({ tenantId, userId, provider: "google-workspace" });
}

function sameBinding(left, right) {
  return left?.tenantId === right?.tenantId && left?.userId === right?.userId && left?.provider === right?.provider;
}

function normalizedVaultKey(value) {
  if (!value) return null;
  const key = Buffer.from(String(value), "base64");
  if (key.length !== 32) throw new Error("The Google token vault key must contain exactly 32 bytes.");
  return key;
}

function safeError(error) {
  return String(error instanceof Error ? error.message : error || "Google Workspace operation failed.")
    .replace(/Bearer\s+[^\s]+/giu, "Bearer [redacted]")
    .replace(/(?:access|refresh)[_-]?token\s*[:=]\s*[^\s,}]+/giu, "token=[redacted]")
    .slice(0, 240);
}

function assertConnectionRecord(record, binding) {
  if (!record) return null;
  if (record.schema !== CONNECTION_SCHEMA || !sameBinding(record.binding, binding) || !CONNECTION_STATES.has(record.state)) {
    throw new Error("The Google connection record does not belong to this tenant and user.");
  }
  const scopes = Array.isArray(record.scopes) ? record.scopes.map(String).sort() : [];
  const approved = [...GOOGLE_WORKSPACE_READ_ONLY_SCOPES].sort();
  if (scopes.length && (scopes.length !== approved.length || scopes.some((scope, index) => scope !== approved[index]))) {
    throw new Error("The stored Google connection contains scopes outside the approved read-only allowlist.");
  }
  return record;
}

function publicConnection(record, available) {
  const state = record?.state || "disconnected";
  return Object.freeze({
    provider: "google-workspace",
    state,
    connected: state === "connected",
    available,
    mode: "oauth-pkce-gmail-calendar-read-only",
    scopes: GOOGLE_WORKSPACE_READ_ONLY_SCOPES,
    connectedAt: record?.connectedAt || null,
    lastSyncedAt: record?.lastSyncedAt || null,
    gmailContextCount: Number(record?.gmailContextCount || 0),
    busyBlockCount: Number(record?.busyBlockCount || 0),
    error: state === "error" ? String(record?.error || "Google Workspace requires attention.") : null,
  });
}

function encryptedEnvelope(payload, key) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return JSON.stringify({
    schema: TOKEN_VAULT_SCHEMA,
    algorithm: "AES-256-GCM",
    nonce: nonce.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  });
}

function decryptedEnvelope(envelope, key) {
  if (envelope?.schema !== TOKEN_VAULT_SCHEMA || envelope?.algorithm !== "AES-256-GCM") throw new Error("The Google token vault format is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.nonce, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8"));
}

export function createEncryptedGoogleTokenVault({ path, encryptionKey, now = () => new Date() } = {}) {
  const vaultPath = String(path || "").trim();
  const key = normalizedVaultKey(encryptionKey);
  if (!vaultPath || !key) throw new Error("An encrypted Google token vault path and key are required.");

  async function load() {
    try {
      const payload = decryptedEnvelope(JSON.parse(await readFile(vaultPath, "utf8")), key);
      return {
        schema: TOKEN_VAULT_SCHEMA,
        records: Array.isArray(payload.records) ? payload.records : [],
        oauthStates: Array.isArray(payload.oauthStates) ? payload.oauthStates : [],
      };
    } catch (error) {
      if (error?.code === "ENOENT") return { schema: TOKEN_VAULT_SCHEMA, records: [], oauthStates: [] };
      throw error;
    }
  }

  async function persist(payload) {
    await mkdir(dirname(vaultPath), { recursive: true, mode: 0o700 });
    const temporary = `${vaultPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temporary, encryptedEnvelope(payload, key), { mode: 0o600 });
    await rename(temporary, vaultPath);
  }

  function indexOf(records, binding) {
    return records.findIndex((record) => sameBinding(record.binding, binding));
  }

  function emptyRecord(record) {
    return !record?.tokenSet && !record?.connection && !record?.reducedContext && !record?.pendingRevocation;
  }

  async function persistOrRemove(payload) {
    if (payload.records.length || payload.oauthStates.length) return persist(payload);
    await unlink(vaultPath).catch((error) => { if (error?.code !== "ENOENT") throw error; });
  }

  return {
    security: Object.freeze({ encryptedAtRest: true, tenantUserScoped: true, exportablePlaintext: false }),
    async putTokenSet(bindingInput, tokenSet) {
      const binding = requiredBinding(bindingInput);
      if (!tokenSet?.accessToken || !tokenSet?.refreshToken) throw new Error("A renewable Google token set is required.");
      const payload = await load();
      const index = indexOf(payload.records, binding);
      const current = index >= 0 ? payload.records[index] : { binding, connection: null };
      const next = { ...current, binding, tokenSet: { accessToken: String(tokenSet.accessToken), refreshToken: String(tokenSet.refreshToken) } };
      if (index >= 0) payload.records[index] = next; else payload.records.push(next);
      await persist(payload);
    },
    async getTokenSet(bindingInput) {
      const binding = requiredBinding(bindingInput);
      const record = (await load()).records.find((candidate) => sameBinding(candidate.binding, binding));
      return record?.tokenSet ? structuredClone(record.tokenSet) : null;
    },
    async deleteTokenSet(bindingInput) {
      const binding = requiredBinding(bindingInput);
      const payload = await load();
      const index = indexOf(payload.records, binding);
      if (index < 0) return;
      payload.records[index] = { ...payload.records[index], tokenSet: null };
      if (emptyRecord(payload.records[index])) payload.records.splice(index, 1);
      await persistOrRemove(payload);
    },
    async putConnectionConfig(bindingInput, connection) {
      const binding = requiredBinding(bindingInput);
      const validated = assertConnectionRecord({ ...connection, binding }, binding);
      const payload = await load();
      const index = indexOf(payload.records, binding);
      const current = index >= 0 ? payload.records[index] : { binding, tokenSet: null };
      const next = { ...current, binding, connection: validated };
      if (index >= 0) payload.records[index] = next; else payload.records.push(next);
      await persist(payload);
    },
    async getConnectionConfig(bindingInput) {
      const binding = requiredBinding(bindingInput);
      const record = (await load()).records.find((candidate) => sameBinding(candidate.binding, binding));
      return assertConnectionRecord(record?.connection || null, binding);
    },
    async deleteConnectionConfig(bindingInput) {
      const binding = requiredBinding(bindingInput);
      const payload = await load();
      const index = indexOf(payload.records, binding);
      if (index < 0) return;
      payload.records[index] = { ...payload.records[index], connection: null };
      if (emptyRecord(payload.records[index])) payload.records.splice(index, 1);
      await persistOrRemove(payload);
    },
    async putReducedContext(bindingInput, context) {
      const binding = requiredBinding(bindingInput);
      const payload = await load();
      const index = indexOf(payload.records, binding);
      const current = index >= 0 ? payload.records[index] : { binding, tokenSet: null, connection: null };
      const observedAt = now();
      const calendarBusyBlocks = reducedCalendarBlocks(context?.calendar?.busyBlocks, observedAt);
      const next = {
        ...current,
        binding,
        reducedContext: {
          gmail: {
            historyIdHash: opaqueId(context?.gmail?.historyId),
            recentInboxCount: Math.max(0, Math.min(GMAIL_CONTEXT_LIMIT, Number(context?.gmail?.recentInboxCount || 0))),
            mailboxMessageCount: Math.max(0, Number(context?.gmail?.mailboxMessageCount || 0)),
            mailboxThreadCount: Math.max(0, Number(context?.gmail?.mailboxThreadCount || 0)),
          },
          calendar: { busyBlocks: calendarBusyBlocks },
          updatedAt: boundedText(context?.updatedAt, 40),
          expiresAt: new Date(observedAt.getTime() + GOOGLE_CONTEXT_RETENTION.localCacheTtlMs).toISOString(),
        },
      };
      if (index >= 0) payload.records[index] = next; else payload.records.push(next);
      await persist(payload);
    },
    async getReducedContext(bindingInput) {
      const binding = requiredBinding(bindingInput);
      const payload = await load();
      const index = indexOf(payload.records, binding);
      const context = index >= 0 ? payload.records[index].reducedContext : null;
      if (!context) return null;
      if (!Number.isFinite(Date.parse(context.expiresAt || "")) || Date.parse(context.expiresAt) <= now().getTime()) {
        payload.records[index] = { ...payload.records[index], reducedContext: null };
        await persistOrRemove(payload);
        return null;
      }
      return structuredClone(context);
    },
    async putPendingRevocation(bindingInput, tokenSet, createdAt = now().toISOString()) {
      const binding = requiredBinding(bindingInput);
      if (!tokenSet?.accessToken && !tokenSet?.refreshToken) throw new Error("A Google credential is required for pending revocation.");
      const payload = await load();
      const index = indexOf(payload.records, binding);
      const current = index >= 0 ? payload.records[index] : { binding, tokenSet: null, connection: null, reducedContext: null };
      const next = {
        ...current,
        binding,
        pendingRevocation: {
          tokenSet: { accessToken: String(tokenSet.accessToken || ""), refreshToken: String(tokenSet.refreshToken || "") },
          createdAt: new Date(createdAt).toISOString(),
        },
      };
      if (index >= 0) payload.records[index] = next; else payload.records.push(next);
      await persist(payload);
    },
    async getPendingRevocation(bindingInput) {
      const binding = requiredBinding(bindingInput);
      const record = (await load()).records.find((candidate) => sameBinding(candidate.binding, binding));
      return record?.pendingRevocation ? structuredClone(record.pendingRevocation) : null;
    },
    async deletePendingRevocation(bindingInput) {
      const binding = requiredBinding(bindingInput);
      const payload = await load();
      const index = indexOf(payload.records, binding);
      if (index < 0 || !payload.records[index].pendingRevocation) return;
      payload.records[index] = { ...payload.records[index], pendingRevocation: null };
      if (emptyRecord(payload.records[index])) payload.records.splice(index, 1);
      await persistOrRemove(payload);
    },
    async putOAuthState(record) {
      const binding = requiredBinding(record?.binding);
      const payload = await load();
      payload.oauthStates = payload.oauthStates.filter((candidate) => candidate.stateDigest !== record.stateDigest && Date.parse(candidate.expiresAt) > Date.now());
      payload.oauthStates.push({ ...structuredClone(record), binding });
      await persist(payload);
    },
    async takeOAuthState(stateDigest, bindingInput) {
      const binding = requiredBinding(bindingInput);
      const payload = await load();
      const index = payload.oauthStates.findIndex((record) => record.stateDigest === stateDigest && sameBinding(record.binding, binding));
      const record = index >= 0 ? payload.oauthStates.splice(index, 1)[0] : null;
      await persistOrRemove(payload);
      return record ? structuredClone(record) : null;
    },
    async deleteOAuthStateBinding(bindingInput) {
      const binding = requiredBinding(bindingInput);
      const payload = await load();
      payload.oauthStates = payload.oauthStates.filter((record) => !sameBinding(record.binding, binding));
      await persistOrRemove(payload);
    },
    async deleteBinding(bindingInput) {
      const binding = requiredBinding(bindingInput);
      const payload = await load();
      payload.records = payload.records.filter((record) => !sameBinding(record.binding, binding));
      payload.oauthStates = payload.oauthStates.filter((record) => !sameBinding(record.binding, binding));
      await persistOrRemove(payload);
    },
  };
}

export function createEncryptedGoogleOAuthStateStore(tokenVault, bindingInput) {
  const binding = requiredBinding(bindingInput);
  if (tokenVault?.security?.encryptedAtRest !== true || tokenVault?.security?.tenantUserScoped !== true
    || typeof tokenVault.putOAuthState !== "function" || typeof tokenVault.takeOAuthState !== "function" || typeof tokenVault.deleteOAuthStateBinding !== "function") {
    throw new Error("Google OAuth state requires the encrypted tenant-user vault.");
  }
  return {
    security: Object.freeze({ ephemeral: true, oneTimeConsume: true, encryptedAtRest: true, tenantUserScoped: true, durableAcrossRestart: true }),
    async put(record) {
      if (!sameBinding(record?.binding, binding)) throw new Error("OAuth state cannot cross a tenant or user boundary.");
      await tokenVault.putOAuthState(record);
    },
    async take(stateDigest) { return tokenVault.takeOAuthState(stateDigest, binding); },
    async deleteBinding(requestedBinding) {
      if (!sameBinding(requestedBinding, binding)) throw new Error("OAuth state cannot cross a tenant or user boundary.");
      await tokenVault.deleteOAuthStateBinding(binding);
    },
  };
}

async function boundedResponseText(response, maximumBytes) {
  const contentLength = Number(response.headers?.get?.("content-length") || 0);
  if (contentLength > maximumBytes) throw new Error("Google response exceeded the safe byte limit.");
  if (!response.body && contentLength === 0) return "";
  if (!response.body?.getReader) throw new Error("Google response streaming is unavailable; bounded parsing was required.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const fragments = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel().catch(() => {});
        throw new Error("Google response exceeded the safe byte limit.");
      }
      fragments.push(decoder.decode(value, { stream: true }));
    }
    fragments.push(decoder.decode());
    return fragments.join("");
  } finally {
    reader.releaseLock();
  }
}

async function responseJSON(response, fallback, maximumBytes = GOOGLE_RESPONSE_MAX_BYTES) {
  const raw = await boundedResponseText(response, maximumBytes);
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { throw new Error("Google returned malformed JSON."); }
  if (!response.ok) throw new Error(payload.error_description || payload.error?.message || payload.error || fallback);
  return payload;
}

export function createGoogleWorkspaceNetworkTransport({ fetchImpl = globalThis.fetch, now = () => new Date(), requestTimeoutMs = GOOGLE_REQUEST_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Google Workspace transport requires an HTTP implementation.");
  const timeoutMs = Math.max(100, Math.min(60_000, Number(requestTimeoutMs) || GOOGLE_REQUEST_TIMEOUT_MS));
  const request = (input, options = {}) => fetchImpl(input, { ...options, signal: AbortSignal.timeout(timeoutMs) });
  return {
    async exchangeToken(exchange) {
      const token = await responseJSON(await request(exchange.endpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(exchange.form),
      }), "Google authorization could not be completed.");
      return {
        tokenSet: { accessToken: String(token.access_token || ""), refreshToken: String(token.refresh_token || "") },
        grantedScopes: String(token.scope || "").split(/\s+/u).filter(Boolean),
      };
    },
    async sync({ clientId, tokenSet, scopes }) {
      const refreshed = await responseJSON(await request("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, refresh_token: tokenSet.refreshToken, grant_type: "refresh_token" }),
      }), "Google access could not be refreshed.");
      const accessToken = String(refreshed.access_token || "");
      if (!accessToken) throw new Error("Google access could not be refreshed.");
      const headers = { authorization: `Bearer ${accessToken}` };
      const profile = await responseJSON(await request(GMAIL_PROFILE_ENDPOINT, { headers }), "Gmail metadata could not be refreshed.");
      const messageListUrl = new URL(GMAIL_MESSAGES_ENDPOINT);
      messageListUrl.search = new URLSearchParams({
        maxResults: String(GMAIL_CONTEXT_LIMIT),
        labelIds: "INBOX",
        q: `newer_than:${GOOGLE_CONTEXT_RETENTION.gmailMaximumAgeDays}d`,
        fields: "messages(id),resultSizeEstimate",
      }).toString();
      const messageList = await responseJSON(await request(messageListUrl, { headers }), "Gmail message list could not be refreshed.");
      const recentInboxCount = Math.min(GMAIL_CONTEXT_LIMIT, (messageList.messages || []).filter((item) => item?.id).length);
      const busyBlocks = [];
      let pageToken = "";
      let observedItems = 0;
      const observedPageTokens = new Set();
      for (let page = 0; page < GOOGLE_CALENDAR_MAX_PAGES; page += 1) {
        const observedAt = now();
        const url = new URL(CALENDAR_EVENTS_ENDPOINT);
        url.search = new URLSearchParams({
          singleEvents: "true",
          orderBy: "startTime",
          timeMin: new Date(observedAt.getTime() - 86_400_000).toISOString(),
          timeMax: new Date(observedAt.getTime() + 366 * 86_400_000).toISOString(),
          fields: "nextPageToken,items(start,end)",
          maxResults: "2500",
          ...(pageToken ? { pageToken } : {}),
        }).toString();
        const calendar = await responseJSON(await request(url, { headers }), "Google Calendar metadata could not be refreshed.");
        const items = Array.isArray(calendar.items) ? calendar.items : [];
        observedItems += items.length;
        if (observedItems > GOOGLE_CALENDAR_MAX_ITEMS) throw new Error("Google Calendar exceeded the safe item limit.");
        for (const event of items) {
          const start = event.start?.dateTime || (event.start?.date ? `${event.start.date}T00:00:00.000Z` : "");
          const end = event.end?.dateTime || (event.end?.date ? `${event.end.date}T00:00:00.000Z` : "");
          if (Date.parse(end) > Date.parse(start)) busyBlocks.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString(), allDay: Boolean(event.start?.date), timezoneMode: event.start?.date ? "floating-date" : "absolute" });
          if (busyBlocks.length >= 10_000) break;
        }
        const nextPageToken = busyBlocks.length < 10_000 ? String(calendar.nextPageToken || "") : "";
        if (!nextPageToken) { pageToken = ""; break; }
        if (observedPageTokens.has(nextPageToken)) throw new Error("Google Calendar pagination stalled.");
        observedPageTokens.add(nextPageToken);
        pageToken = nextPageToken;
        if (page === GOOGLE_CALENDAR_MAX_PAGES - 1) throw new Error("Google Calendar exceeded the safe page limit.");
      }
      return {
        tokenSet: { accessToken, refreshToken: String(refreshed.refresh_token || tokenSet.refreshToken) },
        grantedScopes: String(refreshed.scope || "").trim() ? String(refreshed.scope).split(/\s+/u).filter(Boolean) : scopes,
        gmail: { historyId: String(profile.historyId || ""), mailboxMessageCount: Number(profile.messagesTotal || 0), mailboxThreadCount: Number(profile.threadsTotal || 0), recentInboxCount },
        calendar: { busyBlocks },
      };
    },
    async revoke({ tokenSet }) {
      const credential = String(tokenSet?.refreshToken || tokenSet?.accessToken || "");
      if (!credential) throw new Error("The Google credential needed for provider revocation is unavailable.");
      const response = await request(GOOGLE_REVOCATION_ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: credential }),
      });
      await boundedResponseText(response, 65_536);
      if (!response.ok) throw new Error(`Google did not confirm access revocation (${response.status}).`);
      return { revoked: true };
    },
  };
}

export class GoogleContextConnector {
  constructor({ clientId = "", tenantId, userId, oauthStateStore = null, tokenVault = null, transport = null, now = () => new Date() } = {}) {
    this.clientId = String(clientId || "").trim();
    this.binding = requiredBinding({ tenantId, userId });
    this.tokenVault = tokenVault;
    this.transport = transport;
    this.now = now;
    this.oauthStateStore = oauthStateStore || createEncryptedGoogleOAuthStateStore(tokenVault, this.binding);
    this.foundation = new GoogleWorkspaceConnectorFoundation({ clientId: this.clientId, oauthStateStore: this.oauthStateStore, tokenVault, now });
  }

  get available() {
    return this.foundation.readiness.configured && Boolean(this.transport);
  }

  async record(state, fields = {}) {
    if (!this.tokenVault?.putConnectionConfig) throw new Error("Google connection configuration requires the encrypted tenant-user vault.");
    const record = {
      schema: CONNECTION_SCHEMA,
      binding: this.binding,
      state,
      scopes: GOOGLE_WORKSPACE_READ_ONLY_SCOPES,
      connectedAt: fields.connectedAt || null,
      lastSyncedAt: fields.lastSyncedAt || null,
      gmailContextCount: Number(fields.gmailContextCount || 0),
      busyBlockCount: Number(fields.busyBlockCount || 0),
      providerRevokedAt: fields.providerRevokedAt || null,
      error: state === "error" ? safeError(fields.error) : null,
      updatedAt: this.now().toISOString(),
    };
    await this.tokenVault.putConnectionConfig(this.binding, record);
    return record;
  }

  async status() {
    if (!this.tokenVault?.getConnectionConfig) return publicConnection(null, false);
    const record = await this.tokenVault.getConnectionConfig(this.binding);
    return publicConnection(record, this.available);
  }

  async start(redirectUri) {
    if (!this.available) throw new Error("Google Workspace requires its OAuth client, encrypted vault and external transport before connection can start.");
    if (await this.tokenVault.getPendingRevocation?.(this.binding)) {
      throw new Error("A rejected Google grant must be revoked before another connection can start.");
    }
    const previous = await this.tokenVault.getConnectionConfig(this.binding);
    await this.oauthStateStore.deleteBinding(this.binding);
    await this.record("connecting", { connectedAt: previous?.connectedAt || null, lastSyncedAt: previous?.lastSyncedAt || null });
    try {
      return await this.foundation.beginAuthorization({ ...this.binding, redirectUri });
    } catch (error) {
      await this.record("error", { error });
      throw error;
    }
  }

  async complete({ state, code, error }) {
    let exchangedTokenSet = null;
    let tokenCommitted = false;
    try {
      const exchange = await this.foundation.prepareTokenExchange({ ...this.binding, state, code, error });
      const result = await this.transport.exchangeToken(exchange);
      exchangedTokenSet = result.tokenSet;
      await this.foundation.commitTokenSet({ ...this.binding, tokenSet: result.tokenSet, grantedScopes: result.grantedScopes });
      tokenCommitted = true;
      const connectedAt = this.now().toISOString();
      await this.tokenVault.putReducedContext(this.binding, { gmail: { historyId: "", recentInboxCount: 0 }, calendar: { busyBlocks: [] }, updatedAt: connectedAt });
      const connection = await this.record("connected", { connectedAt });
      return { connection: publicConnection(connection, this.available) };
    } catch (cause) {
      let rejectedGrantQuarantined = false;
      if (exchangedTokenSet) {
        let revoked = false;
        try { revoked = (await this.transport?.revoke?.({ binding: this.binding, tokenSet: exchangedTokenSet }))?.revoked === true; }
        catch { revoked = false; }
        if (revoked) {
          if (tokenCommitted) await this.tokenVault.deleteBinding(this.binding);
        } else {
          await this.tokenVault.putPendingRevocation(this.binding, exchangedTokenSet, this.now().toISOString());
          if (tokenCommitted) await this.tokenVault.deleteTokenSet(this.binding);
          rejectedGrantQuarantined = true;
        }
      }
      await this.record("error", { error: rejectedGrantQuarantined
        ? "Google authorization was rejected and provider revocation must be retried."
        : cause });
      throw cause;
    }
  }

  async sync() {
    const current = assertConnectionRecord(await this.tokenVault?.getConnectionConfig(this.binding), this.binding);
    if (current?.state !== "connected") throw new Error("Connect Google Workspace before refreshing it.");
    try {
      const tokenSet = await this.tokenVault.getTokenSet(this.binding);
      if (!tokenSet) throw new Error("The encrypted Google token set is unavailable. Reconnect Google Workspace.");
      const result = await this.transport.sync({ binding: this.binding, clientId: this.clientId, tokenSet, scopes: GOOGLE_WORKSPACE_READ_ONLY_SCOPES });
      await this.foundation.commitTokenSet({ ...this.binding, tokenSet: result.tokenSet, grantedScopes: result.grantedScopes });
      const syncedAt = this.now().toISOString();
      const gmailContextCount = Math.max(0, Math.min(Number(result.gmail?.recentInboxCount || 0), GMAIL_CONTEXT_LIMIT));
      const calendarBusyBlocks = reducedCalendarBlocks(result.calendar?.busyBlocks, this.now());
      const expiresAt = new Date(this.now().getTime() + GOOGLE_CONTEXT_RETENTION.localCacheTtlMs).toISOString();
      const record = await this.record("connected", {
        connectedAt: current.connectedAt,
        lastSyncedAt: syncedAt,
        gmailContextCount,
        busyBlockCount: calendarBusyBlocks.length,
      });
      await this.tokenVault.putReducedContext(this.binding, { gmail: result.gmail, calendar: { busyBlocks: calendarBusyBlocks }, updatedAt: syncedAt });
      return {
        connection: publicConnection(record, this.available),
        gmail: { kind: "gmail-content-free-counts", origin: "google-workspace", importedAt: syncedAt, expiresAt, count: gmailContextCount },
        calendar: { kind: "calendar", origin: "google-workspace", sourceName: "Google Calendar", importedAt: syncedAt, expiresAt, count: calendarBusyBlocks.length, busyBlocks: calendarBusyBlocks, privacyMode: "availability-only" },
      };
    } catch (error) {
      await this.record("error", { connectedAt: current.connectedAt, lastSyncedAt: current.lastSyncedAt, gmailContextCount: current.gmailContextCount, busyBlockCount: current.busyBlockCount, error });
      throw error;
    }
  }

  async disconnect() {
    const current = await this.tokenVault?.getConnectionConfig(this.binding);
    const pendingRevocation = await this.tokenVault?.getPendingRevocation?.(this.binding);
    if (pendingRevocation?.tokenSet) {
      try {
        const result = await this.transport?.revoke?.({ binding: this.binding, tokenSet: pendingRevocation.tokenSet });
        if (result?.revoked !== true) throw new Error("Google did not confirm access revocation.");
        await this.tokenVault.deletePendingRevocation(this.binding);
      } catch (error) {
        await this.record("error", { ...current, error: `Rejected grant revocation was not confirmed. ${safeError(error)}` });
        throw new Error("Google disconnection was not completed because rejected grant revocation could not be confirmed.");
      }
    }
    const tokenSet = await this.tokenVault?.getTokenSet(this.binding);
    if (pendingRevocation && !tokenSet) {
      await this.oauthStateStore.deleteBinding(this.binding);
      await this.tokenVault.deleteBinding(this.binding);
      return { disconnected: true, provider: "google-workspace", state: "disconnected", providerRevoked: true };
    }
    if (current?.state === "connecting" && !tokenSet) {
      await this.oauthStateStore.deleteBinding(this.binding);
      await this.tokenVault.deleteBinding(this.binding);
      return { disconnected: true, provider: "google-workspace", state: "disconnected", providerRevoked: false, providerGrantCreated: false };
    }
    if (!current && !tokenSet) {
      await this.oauthStateStore.deleteBinding(this.binding);
      return { disconnected: true, provider: "google-workspace", state: "disconnected", providerRevoked: true };
    }
    let providerRevokedAt = current?.providerRevokedAt || null;
    if (!providerRevokedAt) {
      if (!tokenSet) {
        await this.record("error", { ...current, error: "Provider revocation cannot be confirmed because the encrypted Google credential is unavailable." });
        throw new Error("Google disconnection is incomplete because provider revocation could not be confirmed.");
      }
      try {
        const result = await this.transport?.revoke?.({ binding: this.binding, tokenSet });
        if (result?.revoked !== true) throw new Error("Google did not confirm access revocation.");
        providerRevokedAt = this.now().toISOString();
        await this.record("error", { ...current, providerRevokedAt, error: "Google access was revoked. Local encrypted cleanup is pending." });
      } catch (error) {
        await this.record("error", { ...current, error: `Provider revocation was not confirmed. ${safeError(error)}` });
        throw new Error("Google disconnection was not completed because provider revocation could not be confirmed.");
      }
    }
    try {
      await this.oauthStateStore.deleteBinding(this.binding);
      await this.tokenVault.deleteBinding(this.binding);
    } catch (error) {
      await this.record("error", { ...current, providerRevokedAt, error: "Google access is revoked, but local encrypted cleanup must be retried." }).catch(() => {});
      throw new Error("Google access was revoked, but local encrypted cleanup could not be confirmed. Retry disconnect.");
    }
    return { disconnected: true, provider: "google-workspace", state: "disconnected", providerRevoked: true };
  }
}

export function createGoogleContextConnectorFromEnv(environment = process.env, fetchImpl = globalThis.fetch) {
  const tenantId = String(environment.MYCROBO_TENANT_ID || "").trim();
  const userId = String(environment.MYCROBO_AUTH_USER_ID || "").trim();
  const clientId = String(environment.MYCROBO_GOOGLE_CLIENT_ID || "").trim();
  const dataDir = String(environment.MYCROBO_USER_DATA_DIR || "").trim();
  if (!tenantId || !userId || !dataDir || !environment.MYCROBO_USER_STATE_KEY) {
    const unavailable = () => { throw new Error("Google Workspace requires an authenticated tenant, user and encrypted local vault."); };
    return {
      available: false,
      async status() { return publicConnection(null, false); },
      async start() { return unavailable(); },
      async complete() { return unavailable(); },
      async sync() { return unavailable(); },
      async disconnect() { return unavailable(); },
    };
  }
  const tokenVault = createEncryptedGoogleTokenVault({ path: join(dataDir, "google-workspace.vault.json"), encryptionKey: environment.MYCROBO_USER_STATE_KEY });
  const transport = clientId ? createGoogleWorkspaceNetworkTransport({ fetchImpl }) : null;
  return new GoogleContextConnector({ clientId, tenantId, userId, tokenVault, transport });
}
