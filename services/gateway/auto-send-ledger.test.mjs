import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  AutoSendAuthorizationIssuer,
  InMemoryAutoSendAuthorizationLedger,
  hashAutoSendDraft,
} from "../../packages/core/auto-send-authorization.ts";
import { SqliteAutoSendAuthorizationLedger } from "./auto-send-ledger.mjs";
import { AutoSendCoordinator } from "./auto-send-coordinator.mjs";

const secret = "test-only-secret-that-is-at-least-thirty-two-bytes-long";
const nowMs = 1_800_000_000_000;
const binding = {
  tenantId: "tenant-a",
  accountId: "account-a",
  relationshipGraphId: "relationship-a",
  relationshipGraphVersion: "relationship-a:9",
  chatId: "chat-a",
  targetMessageId: "message-a",
};
const policy = {
  tenantDefault: { mode: "safe" },
  safety: {
    authorizationEnabled: true,
    identityVerified: true,
    targetMessageId: "message-a",
    latestInboundMessageId: "message-a",
    newerTargetMessageExists: false,
    chatKind: "direct",
    timeDateOrLocationPromiseDetected: false,
    moneyOrPaymentDetected: false,
    legalMedicalOrSensitiveDetected: false,
    mediaOrOcrUncertain: false,
    factsComplete: true,
    newCommitmentDetected: false,
    groundingPassed: true,
    accountMatched: true,
    connectorConnected: true,
    withinUsageLimits: true,
    quietHoursActive: false,
  },
};

test("SQLite ledger blocks replay across issuer and gateway restarts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mycrobo-send-ledger-"));
  const databasePath = join(directory, "authorization-ledger.db");
  try {
    const firstLedger = new SqliteAutoSendAuthorizationLedger(databasePath);
    const firstIssuer = new AutoSendAuthorizationIssuer({ secret, ledger: firstLedger });
    const token = firstIssuer.issue({
      ...binding,
      idempotencyKey: "request-a",
      draftText: "Understood.",
      policy,
      nowMs,
    });
    firstIssuer.revalidateAndAuthorize({
      ...binding,
      token,
      executionId: "execution-a",
      draftText: "Understood.",
      policy,
      nowMs: nowMs + 100,
    });
    firstLedger.close();

    const restartedLedger = new SqliteAutoSendAuthorizationLedger(databasePath);
    const restartedIssuer = new AutoSendAuthorizationIssuer({ secret, ledger: restartedLedger });
    assert.throws(() => restartedIssuer.revalidateAndAuthorize({
      ...binding,
      token,
      executionId: "execution-b",
      draftText: "Understood.",
      policy,
      nowMs: nowMs + 200,
    }), /already consumed/u);
    restartedLedger.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("SQLite ledger rejects a valid signature when its durable record is absent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mycrobo-send-ledger-"));
  try {
    const first = new SqliteAutoSendAuthorizationLedger(join(directory, "first.db"));
    const issuer = new AutoSendAuthorizationIssuer({ secret, ledger: first });
    const token = issuer.issue({ ...binding, idempotencyKey: "request-b", draftText: "Okay.", policy, nowMs });
    first.close();

    const empty = new SqliteAutoSendAuthorizationLedger(join(directory, "empty.db"));
    const restarted = new AutoSendAuthorizationIssuer({ secret, ledger: empty });
    assert.throws(() => restarted.verify(token, nowMs + 1), /active send ledger/u);
    empty.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("coordinator records delivery and retries a crash window with one durable bridge idempotency key", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mycrobo-send-ledger-"));
  const databasePath = join(directory, "authorization-ledger.db");
  const receipts = new Map();
  const boundaryCalls = [];
  let simulateCrashAfterBoundary = true;
  const deliver = async ({ idempotencyKey }) => {
    boundaryCalls.push(idempotencyKey);
    if (!receipts.has(idempotencyKey)) receipts.set(idempotencyKey, { providerMessageId: "provider-message-1" });
    const receipt = receipts.get(idempotencyKey);
    if (simulateCrashAfterBoundary) {
      simulateCrashAfterBoundary = false;
      throw new Error("simulated gateway crash after idempotent provider delivery");
    }
    return receipt;
  };
  const execution = {
    ...binding,
    idempotencyKey: "request-crash-window",
    executionId: "execution-crash-window",
    draftText: "Understood.",
    policy,
    nowMs,
    deliveredAtMs: nowMs + 500,
  };
  try {
    const firstLedger = new SqliteAutoSendAuthorizationLedger(databasePath);
    const first = new AutoSendCoordinator({
      issuer: new AutoSendAuthorizationIssuer({ secret, ledger: firstLedger }),
      deliver,
    });
    await assert.rejects(() => first.execute(execution), /simulated gateway crash/u);
    firstLedger.close();

    const restartedLedger = new SqliteAutoSendAuthorizationLedger(databasePath);
    const restarted = new AutoSendCoordinator({
      issuer: new AutoSendAuthorizationIssuer({ secret, ledger: restartedLedger }),
      deliver,
    });
    const result = await restarted.execute({ ...execution, nowMs: nowMs + 100 });
    assert.equal(result.receipt.providerMessageId, "provider-message-1");
    assert.equal(result.delivery.executionId, execution.executionId);
    assert.equal(boundaryCalls.length, 2);
    assert.equal(boundaryCalls[0], boundaryCalls[1]);
    restartedLedger.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("pruning removes only expired unused capabilities and retains consumed and delivered tombstones", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mycrobo-send-ledger-"));
  const databasePath = join(directory, "authorization-ledger.db");
  try {
    const ledger = new SqliteAutoSendAuthorizationLedger(databasePath);
    const issuer = new AutoSendAuthorizationIssuer({ secret, ledger });
    const issuedToken = issuer.issue({ ...binding, idempotencyKey: "prune-issued", draftText: "Issued", policy, nowMs, ttlMs: 1_000 });
    const issuedId = issuer.verify(issuedToken, nowMs + 1).authorizationId;

    const consumedToken = issuer.issue({ ...binding, idempotencyKey: "prune-consumed", draftText: "Consumed", policy, nowMs, ttlMs: 1_000 });
    const consumedIntent = issuer.revalidateAndAuthorize({ ...binding, token: consumedToken, executionId: "execution-consumed", draftText: "Consumed", policy, nowMs: nowMs + 10 });

    const deliveredToken = issuer.issue({ ...binding, idempotencyKey: "prune-delivered", draftText: "Delivered", policy, nowMs, ttlMs: 1_000 });
    const deliveredIntent = issuer.revalidateAndAuthorize({ ...binding, token: deliveredToken, executionId: "execution-delivered", draftText: "Delivered", policy, nowMs: nowMs + 10 });
    issuer.recordDelivery(deliveredIntent, { providerMessageId: "receipt" }, nowMs + 20);

    ledger.prune(nowMs + 10_000_000);
    assert.equal(ledger.findByAuthorizationId(issuedId), null);
    assert.equal(ledger.findByAuthorizationId(consumedIntent.authorizationId).status, "consumed");
    assert.equal(ledger.findByAuthorizationId(deliveredIntent.authorizationId).status, "delivered");
    const reissued = issuer.issue({ ...binding, idempotencyKey: "prune-issued", draftText: "Issued", policy, nowMs: nowMs + 10_000_001, ttlMs: 1_000 });
    assert.notEqual(reissued, issuedToken);
    const consumedReplay = issuer.issue({ ...binding, idempotencyKey: "prune-consumed", draftText: "Consumed", policy, nowMs: nowMs + 10_000_001, ttlMs: 1_000 });
    assert.equal(consumedReplay, consumedToken);
    ledger.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("SQLite ledger stores no plaintext bearer and reconstructs idempotent capability after restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mycrobo-send-ledger-"));
  const databasePath = join(directory, "authorization-ledger.db");
  try {
    const firstLedger = new SqliteAutoSendAuthorizationLedger(databasePath);
    const firstIssuer = new AutoSendAuthorizationIssuer({ secret, ledger: firstLedger });
    const token = firstIssuer.issue({ ...binding, idempotencyKey: "hash-only-token", draftText: "Hash only", policy, nowMs });
    const signature = token.split(".")[1];
    firstLedger.close();
    const bytes = await readFile(databasePath);
    assert.equal(bytes.includes(Buffer.from(token, "utf8")), false);
    assert.equal(bytes.includes(Buffer.from(signature, "utf8")), false);

    const restartedLedger = new SqliteAutoSendAuthorizationLedger(databasePath);
    const columns = restartedLedger.database.prepare("pragma table_info(auto_send_authorizations)").all().map((column) => column.name);
    assert.equal(columns.includes("token"), false);
    assert.equal(columns.includes("encoded_payload"), true);
    const restartedIssuer = new AutoSendAuthorizationIssuer({ secret, ledger: restartedLedger });
    const retry = restartedIssuer.issue({ ...binding, idempotencyKey: "hash-only-token", draftText: "Hash only", policy, nowMs: nowMs + 100 });
    assert.equal(retry, token);
    restartedLedger.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("legacy plaintext-token ledger migrates to payload-plus-hash without changing tombstones", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mycrobo-send-ledger-"));
  const databasePath = join(directory, "authorization-ledger.db");
  try {
    const memoryIssuer = new AutoSendAuthorizationIssuer({ secret, ledger: new InMemoryAutoSendAuthorizationLedger() });
    const token = memoryIssuer.issue({ ...binding, idempotencyKey: "legacy-token", draftText: "Legacy", policy, nowMs });
    const payload = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      create table auto_send_authorizations (
        authorization_id text primary key, idempotency_key text not null unique,
        binding_fingerprint text not null, token text not null, token_hash text not null,
        expires_at_ms integer not null, status text not null,
        intent_json text, delivery_json text
      ) strict;
    `);
    legacy.prepare("insert into auto_send_authorizations values (?, ?, ?, ?, ?, ?, 'consumed', ?, null)").run(
      payload.authorizationId,
      "legacy-token",
      "legacy-binding-fingerprint",
      token,
      hashAutoSendDraft(token),
      payload.expiresAtMs,
      JSON.stringify({ executionId: "legacy-execution" }),
    );
    legacy.close();

    const migrated = new SqliteAutoSendAuthorizationLedger(databasePath);
    const record = migrated.findByAuthorizationId(payload.authorizationId);
    assert.equal(record.status, "consumed");
    assert.equal(record.encodedPayload, token.split(".")[0]);
    assert.equal("token" in record, false);
    migrated.prune(nowMs + 10_000_000);
    assert.equal(migrated.findByAuthorizationId(payload.authorizationId).status, "consumed");
    migrated.close();
    assert.equal((await readFile(databasePath)).includes(Buffer.from(token, "utf8")), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
