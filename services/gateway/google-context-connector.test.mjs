import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { GOOGLE_WORKSPACE_READ_ONLY_SCOPES } from "./google-workspace-contracts.mjs";
import { GOOGLE_CONTEXT_RETENTION, GoogleContextConnector, createEncryptedGoogleTokenVault, createGoogleWorkspaceNetworkTransport } from "./google-context-connector.mjs";
import { calendarContextForText } from "./context-sources.mjs";
import { createGatewayServer, refreshGoogleWhenStale } from "./server.mjs";
import { MemoryUserStateStore } from "./user-state.mjs";

async function fixture(t, transport, vaultDecorator = (vault) => vault) {
  const directory = await mkdtemp(join(tmpdir(), "mycrobo-google-runtime-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const vaultPath = join(directory, "google.vault.json");
  const baseVault = createEncryptedGoogleTokenVault({ path: vaultPath, encryptionKey: Buffer.alloc(32, 7).toString("base64"), now: () => new Date("2026-10-08T10:00:00.000Z") });
  const tokenVault = vaultDecorator(baseVault);
  const connector = new GoogleContextConnector({
    clientId: "public-client-id",
    tenantId: "tenant-a",
    userId: "user-a",
    tokenVault,
    transport,
    now: () => new Date("2026-10-08T10:00:00.000Z"),
  });
  return { connector, tokenVault, baseVault, vaultPath };
}

test("runtime uses the Gmail and Calendar readonly contract, encrypted vault, identity binding and explicit states", async (t) => {
  const observed = [];
  const { connector, tokenVault, vaultPath } = await fixture(t, {
    async exchangeToken(exchange) {
      observed.push({ kind: "exchange", exchange });
      return {
        tokenSet: { accessToken: "PRIVATE-ACCESS-TOKEN", refreshToken: "PRIVATE-REFRESH-TOKEN" },
        grantedScopes: GOOGLE_WORKSPACE_READ_ONLY_SCOPES,
      };
    },
    async sync(input) {
      observed.push({ kind: "sync", input });
      return {
        tokenSet: { accessToken: "ROTATED-ACCESS-TOKEN", refreshToken: input.tokenSet.refreshToken },
        grantedScopes: GOOGLE_WORKSPACE_READ_ONLY_SCOPES,
        gmail: { historyId: "history-42", mailboxMessageCount: 17, mailboxThreadCount: 9, recentInboxCount: 1 },
        calendar: { busyBlocks: [{ start: "2026-10-09T10:00:00.000Z", end: "2026-10-09T11:00:00.000Z", allDay: false, timezoneMode: "absolute", summary: "must be discarded" }] },
      };
    },
    async revoke() { observed.push({ kind: "revoke" }); return { revoked: true }; },
  });

  assert.equal((await connector.status()).state, "disconnected");
  const started = await connector.start("http://127.0.0.1:4040/oauth/google/callback");
  const authorization = new URL(started.authorizationUrl);
  assert.deepEqual(authorization.searchParams.get("scope").split(" ").sort(), [...GOOGLE_WORKSPACE_READ_ONLY_SCOPES].sort());
  assert.equal(authorization.searchParams.get("include_granted_scopes"), "false");
  assert.equal((await connector.status()).state, "connecting");

  await connector.complete({ state: authorization.searchParams.get("state"), code: "one-time-code" });
  assert.equal((await connector.status()).state, "connected");
  const encryptedFile = await readFile(vaultPath, "utf8");
  assert.doesNotMatch(encryptedFile, /PRIVATE-(?:ACCESS|REFRESH)-TOKEN/u);
  assert.deepEqual(await tokenVault.getTokenSet({ tenantId: "tenant-b", userId: "user-a", provider: "google-workspace" }), null);

  const synced = await connector.sync();
  assert.equal(synced.gmail.count, 1);
  assert.equal("messages" in synced.gmail, false);
  assert.equal(synced.calendar.count, 1);
  assert.equal("summary" in synced.calendar.busyBlocks[0], false);
  assert.equal(observed[1].input.binding.tenantId, "tenant-a");
  assert.equal(observed[1].input.binding.userId, "user-a");
  assert.deepEqual(observed[1].input.scopes, GOOGLE_WORKSPACE_READ_ONLY_SCOPES);
  assert.deepEqual(await connector.status(), {
    provider: "google-workspace",
    state: "connected",
    connected: true,
    available: true,
    mode: "oauth-pkce-gmail-calendar-read-only",
    scopes: GOOGLE_WORKSPACE_READ_ONLY_SCOPES,
    connectedAt: "2026-10-08T10:00:00.000Z",
    lastSyncedAt: "2026-10-08T10:00:00.000Z",
    gmailContextCount: 1,
    busyBlockCount: 1,
    error: null,
  });
  const reduced = await tokenVault.getReducedContext({ tenantId: "tenant-a", userId: "user-a", provider: "google-workspace" });
  assert.deepEqual(Object.keys(reduced.gmail).sort(), ["historyIdHash", "mailboxMessageCount", "mailboxThreadCount", "recentInboxCount"]);
  assert.equal(reduced.gmail.recentInboxCount, 1);
  assert.doesNotMatch(await readFile(vaultPath, "utf8"), /sender@example\.test|Bounded subject|Bounded snippet/u);

  await connector.disconnect();
  assert.equal((await connector.status()).state, "disconnected");
  assert.equal(observed.at(-1).kind, "revoke");
});

test("runtime rejects scopes outside the approved allowlist and records an error without persisting tokens", async (t) => {
  let revocations = 0;
  const { connector, tokenVault } = await fixture(t, {
    async exchangeToken() {
      return {
        tokenSet: { accessToken: "PRIVATE-ACCESS-TOKEN", refreshToken: "PRIVATE-REFRESH-TOKEN" },
        grantedScopes: [...GOOGLE_WORKSPACE_READ_ONLY_SCOPES, "https://www.googleapis.com/auth/gmail.modify"],
      };
    },
    async revoke() { revocations += 1; return { revoked: true }; },
  });
  const started = await connector.start("http://127.0.0.1:4040/oauth/google/callback");
  await assert.rejects(
    () => connector.complete({ state: new URL(started.authorizationUrl).searchParams.get("state"), code: "one-time-code" }),
    /only the approved Gmail and Calendar read-only scopes/u,
  );
  const status = await connector.status();
  assert.equal(status.state, "error");
  assert.match(status.error, /only the approved/u);
  assert.equal(await tokenVault.getTokenSet({ tenantId: "tenant-a", userId: "user-a", provider: "google-workspace" }), null);
  assert.equal(await tokenVault.getPendingRevocation({ tenantId: "tenant-a", userId: "user-a", provider: "google-workspace" }), null);
  assert.equal(revocations, 1);
});

test("failed cleanup of a rejected grant is encrypted, non-syncable and retried by disconnect", async (t) => {
  let allowRevocation = false;
  const { connector, tokenVault, vaultPath } = await fixture(t, {
    async exchangeToken() {
      return { tokenSet: { accessToken: "REJECTED-ACCESS", refreshToken: "REJECTED-REFRESH" }, grantedScopes: [...GOOGLE_WORKSPACE_READ_ONLY_SCOPES, "https://www.googleapis.com/auth/gmail.modify"] };
    },
    async revoke() { return { revoked: allowRevocation }; },
  });
  const started = await connector.start("http://127.0.0.1:4040/oauth/google/callback");
  await assert.rejects(() => connector.complete({ state: new URL(started.authorizationUrl).searchParams.get("state"), code: "code" }), /only the approved/u);
  assert.equal(await tokenVault.getTokenSet({ tenantId: "tenant-a", userId: "user-a", provider: "google-workspace" }), null);
  assert.ok(await tokenVault.getPendingRevocation({ tenantId: "tenant-a", userId: "user-a", provider: "google-workspace" }));
  assert.doesNotMatch(await readFile(vaultPath, "utf8"), /REJECTED-(?:ACCESS|REFRESH)/u);
  await assert.rejects(() => connector.sync(), /Connect Google Workspace/u);
  await assert.rejects(() => connector.start("http://127.0.0.1:4040/oauth/google/callback"), /must be revoked/u);
  await assert.rejects(() => connector.disconnect(), /rejected grant revocation/u);
  allowRevocation = true;
  assert.equal((await connector.disconnect()).providerRevoked, true);
  assert.equal(await tokenVault.getPendingRevocation({ tenantId: "tenant-a", userId: "user-a", provider: "google-workspace" }), null);
});

test("encrypted OAuth state survives a runtime restart and remains one-time tenant-user bound", async (t) => {
  const transport = {
    async exchangeToken() {
      return { tokenSet: { accessToken: "ACCESS", refreshToken: "REFRESH" }, grantedScopes: GOOGLE_WORKSPACE_READ_ONLY_SCOPES };
    },
  };
  const { connector, tokenVault, vaultPath } = await fixture(t, transport);
  const started = await connector.start("http://127.0.0.1:4040/oauth/google/callback");
  const state = new URL(started.authorizationUrl).searchParams.get("state");
  assert.doesNotMatch(await readFile(vaultPath, "utf8"), new RegExp(state, "u"));

  const wrongUser = new GoogleContextConnector({ clientId: "public-client-id", tenantId: "tenant-a", userId: "user-b", tokenVault, transport, now: () => new Date("2026-10-08T10:01:00.000Z") });
  await assert.rejects(() => wrongUser.complete({ state, code: "stolen-code" }), /missing, expired or already used/u);
  const restarted = new GoogleContextConnector({ clientId: "public-client-id", tenantId: "tenant-a", userId: "user-a", tokenVault, transport, now: () => new Date("2026-10-08T10:01:00.000Z") });
  await restarted.complete({ state, code: "one-time-code" });
  assert.equal((await restarted.status()).state, "connected");
  await assert.rejects(() => restarted.complete({ state, code: "replayed-code" }), /missing, expired or already used/u);

  assert.equal((await wrongUser.status()).state, "error");
});

test("network transport retains only bounded Gmail counts and reduces Calendar to availability", async () => {
  const calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = async (input, options = {}) => {
    const url = new URL(String(input));
    calls.push({ url, options });
    if (url.pathname === "/token") return json({ access_token: "EPHEMERAL-ACCESS" });
    if (url.pathname.endsWith("/profile")) return json({ historyId: "history-9", messagesTotal: 120, threadsTotal: 80 });
    if (url.pathname.endsWith("/messages")) return json({ messages: [{ id: "message-1", threadId: "thread-1" }, { id: "message-2", threadId: "thread-2" }], resultSizeEstimate: 2 });
    if (url.pathname.endsWith("/messages/message-1")) return json({ id: "message-1", threadId: "thread-1", internalDate: "1791450000000", snippet: " First\n bounded snippet ", payload: { headers: [{ name: "From", value: "One <one@example.test>" }, { name: "To", value: "User <user@example.test>" }, { name: "Subject", value: "Status one" }] } });
    if (url.pathname.endsWith("/messages/message-2")) return json({ id: "message-2", threadId: "thread-2", internalDate: "1791453600000", snippet: "Second snippet", payload: { headers: [{ name: "From", value: "Two <two@example.test>" }, { name: "To", value: "User <user@example.test>" }, { name: "Subject", value: "Status two" }] } });
    if (url.pathname.endsWith("/events")) return json({ items: [{ start: { dateTime: "2026-10-09T10:00:00.000Z" }, end: { dateTime: "2026-10-09T11:00:00.000Z" }, summary: "must not survive reduction", description: "must not survive reduction" }] });
    if (url.pathname === "/revoke") return new Response(null, { status: 200 });
    return json({ error: "unexpected" }, 500);
  };
  const transport = createGoogleWorkspaceNetworkTransport({ fetchImpl, now: () => new Date("2026-10-08T10:00:00.000Z") });
  const result = await transport.sync({ clientId: "public-client-id", tokenSet: { accessToken: "OLD", refreshToken: "REFRESH" }, scopes: GOOGLE_WORKSPACE_READ_ONLY_SCOPES });
  assert.equal(result.gmail.recentInboxCount, 2);
  assert.equal("messages" in result.gmail, false);
  assert.deepEqual(result.calendar.busyBlocks, [{ start: "2026-10-09T10:00:00.000Z", end: "2026-10-09T11:00:00.000Z", allDay: false, timezoneMode: "absolute" }]);
  const listCall = calls.find((call) => call.url.pathname.endsWith("/messages"));
  assert.equal(listCall.url.searchParams.get("maxResults"), "25");
  assert.equal(listCall.url.searchParams.get("q"), `newer_than:${GOOGLE_CONTEXT_RETENTION.gmailMaximumAgeDays}d`);
  assert.equal(calls.some((call) => /\/messages\/message-/u.test(call.url.pathname)), false);
  assert.ok(calls.filter((call) => /gmail|calendar/u.test(call.url.hostname)).every((call) => !call.options.body && (!call.options.method || call.options.method === "GET")));
  await transport.revoke({ tokenSet: { refreshToken: "REFRESH" } });
  assert.equal(calls.at(-1).url.pathname, "/revoke");
});

test("Google transport rejects oversized, timed-out and stalled paginated responses", async () => {
  const oversized = createGoogleWorkspaceNetworkTransport({
    fetchImpl: async () => new Response(JSON.stringify({ value: "x".repeat(1_100_000) }), { status: 200 }),
  });
  await assert.rejects(() => oversized.exchangeToken({ endpoint: "https://oauth2.googleapis.com/token", form: {} }), /safe byte limit/u);

  const timed = createGoogleWorkspaceNetworkTransport({
    requestTimeoutMs: 100,
    fetchImpl: async (_input, options) => {
      const keepAlive = setTimeout(() => {}, 1000);
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          clearTimeout(keepAlive);
          reject(options.signal.reason);
        }, { once: true });
      });
    },
  });
  await assert.rejects(() => timed.exchangeToken({ endpoint: "https://oauth2.googleapis.com/token", form: {} }), /timed out|timeout/iu);

  let calendarPages = 0;
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const stalled = createGoogleWorkspaceNetworkTransport({
    now: () => new Date("2026-10-08T10:00:00.000Z"),
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/token") return json({ access_token: "ACCESS" });
      if (url.pathname.endsWith("/profile")) return json({ historyId: "history" });
      if (url.pathname.endsWith("/messages")) return json({ messages: [] });
      if (url.pathname.endsWith("/events")) { calendarPages += 1; return json({ items: [], nextPageToken: "same-token" }); }
      return json({});
    },
  });
  await assert.rejects(() => stalled.sync({ clientId: "client", tokenSet: { refreshToken: "refresh" }, scopes: GOOGLE_WORKSPACE_READ_ONLY_SCOPES }), /pagination stalled/u);
  assert.equal(calendarPages, 2);
});

test("Google transport rejects Calendar page and item floods independently of token stalls", async () => {
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const baseResponse = (url) => {
    if (url.pathname === "/token") return json({ access_token: "ACCESS" });
    if (url.pathname.endsWith("/profile")) return json({ historyId: "history" });
    if (url.pathname.endsWith("/messages")) return json({ messages: [] });
    return null;
  };

  let pages = 0;
  const pageFlood = createGoogleWorkspaceNetworkTransport({
    now: () => new Date("2026-10-08T10:00:00.000Z"),
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      const base = baseResponse(url);
      if (base) return base;
      if (url.pathname.endsWith("/events")) {
        pages += 1;
        return json({ items: [], nextPageToken: `page-${pages}` });
      }
      return json({});
    },
  });
  await assert.rejects(
    () => pageFlood.sync({ clientId: "client", tokenSet: { refreshToken: "refresh" }, scopes: GOOGLE_WORKSPACE_READ_ONLY_SCOPES }),
    /safe page limit/u,
  );
  assert.equal(pages, 8);

  let itemPages = 0;
  const itemFlood = createGoogleWorkspaceNetworkTransport({
    now: () => new Date("2026-10-08T10:00:00.000Z"),
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      const base = baseResponse(url);
      if (base) return base;
      if (url.pathname.endsWith("/events")) {
        itemPages += 1;
        return json({ items: Array.from({ length: 5_001 }, () => ({})), nextPageToken: `items-${itemPages}` });
      }
      return json({});
    },
  });
  await assert.rejects(
    () => itemFlood.sync({ clientId: "client", tokenSet: { refreshToken: "refresh" }, scopes: GOOGLE_WORKSPACE_READ_ONLY_SCOPES }),
    /safe item limit/u,
  );
  assert.equal(itemPages, 2);
});

test("reduced Google context is content-free and expires from the encrypted vault", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "mycrobo-google-retention-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let now = new Date("2026-10-08T10:00:00.000Z");
  const vaultPath = join(directory, "google.vault.json");
  const vault = createEncryptedGoogleTokenVault({ path: vaultPath, encryptionKey: Buffer.alloc(32, 9).toString("base64"), now: () => now });
  const binding = { tenantId: "tenant-a", userId: "user-a", provider: "google-workspace" };
  await vault.putReducedContext(binding, {
    gmail: { historyId: "history", recentInboxCount: 4, messages: [{ subject: "must not persist", snippet: "private body" }] },
    calendar: { busyBlocks: [{ start: "2026-10-09T10:00:00.000Z", end: "2026-10-09T11:00:00.000Z" }] },
    updatedAt: now.toISOString(),
  });
  const context = await vault.getReducedContext(binding);
  assert.equal(context.gmail.recentInboxCount, 4);
  assert.equal("messages" in context.gmail, false);
  assert.doesNotMatch(await readFile(vaultPath, "utf8"), /must not persist|private body/u);
  now = new Date(now.getTime() + GOOGLE_CONTEXT_RETENTION.localCacheTtlMs + 1);
  assert.equal(await vault.getReducedContext(binding), null);
  assert.equal(calendarContextForText("Are you free tomorrow at 10am?", { origin: "google-workspace", expiresAt: "2026-10-08T10:00:00.000Z", busyBlocks: [{ start: "2026-10-09T10:00:00.000Z", end: "2026-10-09T11:00:00.000Z" }] }, now).status, "expired");
});

test("background refresh cadence reads encrypted connector status rather than legacy user state", async () => {
  let syncs = 0;
  assert.equal(await refreshGoogleWhenStale({ googleConnector: { async status() { return { connected: true, lastSyncedAt: "2026-10-08T09:00:00.000Z" }; } }, sync: async () => { syncs += 1; }, nowMs: Date.parse("2026-10-08T10:00:00.000Z") }), true);
  assert.equal(await refreshGoogleWhenStale({ googleConnector: { async status() { return { connected: true, lastSyncedAt: "2026-10-08T09:55:00.000Z" }; } }, sync: async () => { syncs += 1; }, nowMs: Date.parse("2026-10-08T10:00:00.000Z") }), false);
  assert.equal(await refreshGoogleWhenStale({ googleConnector: { async status() { return { connected: false }; } }, sync: async () => { syncs += 1; } }), false);
  assert.equal(syncs, 1);
});

test("loopback OAuth callback throttling happens before one-time state consumption", async () => {
  let allowed = false;
  let completions = 0;
  const server = createGatewayServer({
    authRole: "owner",
    draftProvider: null,
    googleConnector: {
      available: true,
      async status() { return { connected: false, available: true }; },
      async complete() { completions += 1; return {}; },
    },
    oauthCallbackLimiter: { check() { return allowed ? { allowed: true, remaining: 1 } : { allowed: false, retryAfterSeconds: 60 }; } },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const blocked = await fetch(`${origin}/oauth/google/callback?state=valid-state&code=code`);
    assert.equal(blocked.status, 429);
    assert.equal(completions, 0);
    allowed = true;
    const accepted = await fetch(`${origin}/oauth/google/callback?state=valid-state&code=code`);
    assert.equal(accepted.status, 200);
    assert.equal(completions, 1);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("disconnect retains encrypted state and reports error until provider revocation is confirmed", async (t) => {
  let allowRevocation = false;
  let revocations = 0;
  const { connector, tokenVault } = await fixture(t, {
    async exchangeToken() { return { tokenSet: { accessToken: "ACCESS", refreshToken: "REFRESH" }, grantedScopes: GOOGLE_WORKSPACE_READ_ONLY_SCOPES }; },
    async revoke() { revocations += 1; return { revoked: allowRevocation }; },
  });
  const started = await connector.start("http://127.0.0.1:4040/oauth/google/callback");
  await connector.complete({ state: new URL(started.authorizationUrl).searchParams.get("state"), code: "code" });
  await assert.rejects(() => connector.disconnect(), /revocation could not be confirmed/u);
  assert.equal((await connector.status()).state, "error");
  assert.ok(await tokenVault.getTokenSet({ tenantId: "tenant-a", userId: "user-a", provider: "google-workspace" }));
  allowRevocation = true;
  assert.equal((await connector.disconnect()).providerRevoked, true);
  assert.equal((await connector.status()).state, "disconnected");
  assert.equal(revocations, 2);
});

test("disconnect retries only local cleanup after provider revocation was confirmed", async (t) => {
  let cleanupAttempts = 0;
  let revocations = 0;
  const { connector } = await fixture(t, {
    async exchangeToken() { return { tokenSet: { accessToken: "ACCESS", refreshToken: "REFRESH" }, grantedScopes: GOOGLE_WORKSPACE_READ_ONLY_SCOPES }; },
    async revoke() { revocations += 1; return { revoked: true }; },
  }, (vault) => new Proxy(vault, {
    get(target, property) {
      if (property === "deleteBinding") return async (...args) => {
        cleanupAttempts += 1;
        if (cleanupAttempts === 1) throw new Error("simulated local cleanup interruption");
        return target.deleteBinding(...args);
      };
      return target[property];
    },
  }));
  const started = await connector.start("http://127.0.0.1:4040/oauth/google/callback");
  await connector.complete({ state: new URL(started.authorizationUrl).searchParams.get("state"), code: "code" });
  await assert.rejects(() => connector.disconnect(), /local encrypted cleanup could not be confirmed/u);
  assert.equal(revocations, 1);
  assert.equal((await connector.disconnect()).disconnected, true);
  assert.equal(revocations, 1);
  assert.equal(cleanupAttempts, 2);
});

test("gateway reports disconnect conflict and preserves derived context until revocation succeeds", async () => {
  const userStateStore = new MemoryUserStateStore();
  let legacyCredentialPurges = 0;
  const removeDirectConnection = userStateStore.removeDirectConnection.bind(userStateStore);
  userStateStore.removeDirectConnection = async (...args) => {
    legacyCredentialPurges += 1;
    return removeDirectConnection(...args);
  };
  await userStateStore.setIntegration("calendar", { kind: "calendar", origin: "google-workspace", sourceName: "Google Calendar", importedAt: "2026-10-08T10:00:00.000Z", count: 1, busyBlocks: [{ start: "2026-10-09T10:00:00.000Z", end: "2026-10-09T11:00:00.000Z" }] });
  let allowDisconnect = false;
  const googleConnector = {
    available: true,
    async status() { return { provider: "google-workspace", state: "error", connected: false, available: true, error: "Revocation pending" }; },
    async disconnect() {
      if (!allowDisconnect) throw new Error("Google disconnection was not completed because provider revocation could not be confirmed.");
      return { disconnected: true, providerRevoked: true, state: "disconnected" };
    },
  };
  const server = createGatewayServer({ authRole: "owner", userStateStore, googleConnector, draftProvider: null });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const failed = await fetch(`${origin}/api/v1/integrations/google`, { method: "DELETE", headers: { "x-mycrobo-confirm": "DISCONNECT GOOGLE" } });
    assert.equal(failed.status, 409);
    assert.match((await failed.json()).error, /revocation could not be confirmed/u);
    assert.equal((await userStateStore.integrations()).calendar.origin, "google-workspace");
    assert.equal(legacyCredentialPurges, 0);
    allowDisconnect = true;
    const succeeded = await fetch(`${origin}/api/v1/integrations/google`, { method: "DELETE", headers: { "x-mycrobo-confirm": "DISCONNECT GOOGLE" } });
    assert.equal(succeeded.status, 200);
    assert.equal((await succeeded.json()).providerRevoked, true);
    assert.equal((await userStateStore.integrations()).calendar, null);
    assert.equal(legacyCredentialPurges, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
