import assert from "node:assert/strict";
import test from "node:test";

import {
  GOOGLE_WORKSPACE_READ_ONLY_SCOPES,
  GoogleWorkspaceConnectorFoundation,
  advanceGoogleIncrementalSyncState,
  assertEncryptedTokenVault,
  createGoogleDisconnectPlan,
  createGoogleIncrementalSyncState,
} from "./google-workspace-contracts.mjs";

function stateStore() {
  const records = new Map();
  return {
    security: { ephemeral: true, oneTimeConsume: true },
    async put(record) { records.set(record.stateDigest, record); },
    async take(key) { const value = records.get(key); records.delete(key); return value; },
    async deleteBinding(binding) {
      for (const [key, value] of records) if (value.binding.tenantId === binding.tenantId && value.binding.userId === binding.userId) records.delete(key);
    },
  };
}

function deterministicBytes(size) {
  return Buffer.alloc(size, size);
}

test("authorization uses only Gmail and Calendar read-only scopes and binds PKCE state to tenant and user", async () => {
  const store = stateStore();
  const connector = new GoogleWorkspaceConnectorFoundation({
    clientId: "public-client-id",
    oauthStateStore: store,
    now: () => new Date("2026-10-08T10:00:00.000Z"),
    randomBytesImpl: deterministicBytes,
  });
  const started = await connector.beginAuthorization({ tenantId: "tenant-a", userId: "user-a", redirectUri: "http://127.0.0.1:4040/oauth/google-workspace/callback" });
  const url = new URL(started.authorizationUrl);
  assert.deepEqual(url.searchParams.get("scope").split(" ").sort(), [...GOOGLE_WORKSPACE_READ_ONLY_SCOPES].sort());
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.has("client_secret"), false);
  const callback = { tenantId: "tenant-a", userId: "user-a", state: url.searchParams.get("state"), code: "one-time-code" };
  const exchange = await connector.prepareTokenExchange(callback);
  assert.equal(exchange.kind, "external-google-token-exchange");
  assert.equal(exchange.binding.tenantId, "tenant-a");
  await assert.rejects(() => connector.prepareTokenExchange(callback), /missing, expired or already used/u);
});

test("authorization state cannot be consumed by another tenant or user", async () => {
  const connector = new GoogleWorkspaceConnectorFoundation({ clientId: "public-client-id", oauthStateStore: stateStore(), randomBytesImpl: deterministicBytes });
  const started = await connector.beginAuthorization({ tenantId: "tenant-a", userId: "user-a", redirectUri: "https://app.example.test/oauth/google-workspace/callback" });
  const state = new URL(started.authorizationUrl).searchParams.get("state");
  await assert.rejects(
    () => connector.prepareTokenExchange({ tenantId: "tenant-b", userId: "user-a", state, code: "one-time-code" }),
    /does not belong to this tenant and user/u,
  );
});

test("token acceptance requires a non-exportable tenant-user encrypted vault and exact read-only scopes", async () => {
  assert.throws(() => assertEncryptedTokenVault({}), /encrypted vault/u);
  const writes = [];
  const vault = {
    security: { encryptedAtRest: true, tenantUserScoped: true, exportablePlaintext: false },
    async putTokenSet(binding) { writes.push(binding); },
    async getTokenSet() { return null; },
    async deleteTokenSet() {},
  };
  const connector = new GoogleWorkspaceConnectorFoundation({ clientId: "public-client-id", oauthStateStore: stateStore(), tokenVault: vault });
  const connection = await connector.commitTokenSet({
    tenantId: "tenant-a",
    userId: "user-a",
    tokenSet: { accessToken: "ephemeral", refreshToken: "vault-only" },
    grantedScopes: GOOGLE_WORKSPACE_READ_ONLY_SCOPES,
  });
  assert.equal(connection.tokenLocation, "encrypted-vault");
  assert.equal("accessToken" in connection, false);
  assert.equal(writes.length, 1);
  await assert.rejects(() => connector.commitTokenSet({
    tenantId: "tenant-a",
    userId: "user-a",
    tokenSet: { accessToken: "ephemeral", refreshToken: "vault-only" },
    grantedScopes: [...GOOGLE_WORKSPACE_READ_ONLY_SCOPES, "https://www.googleapis.com/auth/gmail.modify"],
  }), /only the approved/u);
});

test("incremental state records Gmail history watch and Calendar sync token watch without crossing identities", () => {
  const initial = createGoogleIncrementalSyncState({ tenantId: "tenant-a", userId: "user-a", now: "2026-10-08T10:00:00.000Z" });
  const next = advanceGoogleIncrementalSyncState(initial, {
    tenantId: "tenant-a",
    userId: "user-a",
    now: "2026-10-08T10:05:00.000Z",
    gmail: { historyId: "history-42", watch: { topicName: "projects/project/topics/gmail", expiration: "2026-10-15T10:00:00.000Z" } },
    calendar: { syncToken: "sync-42", watch: { channelId: "calendar-channel", resourceId: "calendar-resource", expiration: "2026-10-15T10:00:00.000Z" } },
  });
  assert.equal(next.gmail.historyId, "history-42");
  assert.equal(next.calendar.syncToken, "sync-42");
  assert.throws(() => advanceGoogleIncrementalSyncState(next, { tenantId: "tenant-b", userId: "user-a", gmail: { historyId: "x" } }), /cannot cross/u);
});

test("disconnect plan stops watches, revokes access and deletes credentials, state and derived data", () => {
  const initial = createGoogleIncrementalSyncState({ tenantId: "tenant-a", userId: "user-a" });
  const synced = advanceGoogleIncrementalSyncState(initial, {
    tenantId: "tenant-a",
    userId: "user-a",
    gmail: { historyId: "history-42", watch: { topicName: "projects/project/topics/gmail", expiration: "2026-10-15T10:00:00.000Z" } },
    calendar: { syncToken: "sync-42", watch: { channelId: "channel", resourceId: "resource", expiration: "2026-10-15T10:00:00.000Z" } },
  });
  const plan = createGoogleDisconnectPlan({ tenantId: "tenant-a", userId: "user-a" }, synced);
  assert.deepEqual(plan.actions.map((action) => action.kind), [
    "stop-gmail-watch",
    "stop-calendar-watch",
    "revoke-provider-token",
    "delete-vault-token-set",
    "delete-oauth-state",
    "delete-sync-state",
    "delete-derived-gmail-calendar-data",
  ]);
  assert.equal(plan.execution, "external-hooks-required");
});
