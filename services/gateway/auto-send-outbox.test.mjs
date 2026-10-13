import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SqliteAutoSendOutbox, autoSendLogicalKey } from "./auto-send-outbox.mjs";

const nowMs = 1_800_000_000_000;
const body = "Private reply body that must never enter the outbox";
const bodyHash = "a".repeat(64);
const binding = Object.freeze({
  tenantId: "tenant-a",
  userId: "user-a",
  accountId: "account-a",
  chatId: "chat-a",
  targetMessageId: "message-a",
  graphVersion: "graph-9",
  policyVersion: "auto-send-policy.1",
});

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "mycrobo-auto-send-outbox-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, databasePath: join(directory, "outbox.db") };
}

test("outbox persists every content-free lifecycle state without accepting a plaintext body", async (t) => {
  const { databasePath } = await fixture(t);
  const outbox = new SqliteAutoSendOutbox(databasePath);
  assert.throws(() => outbox.observe(binding, { bodyHash, body, nowMs }), /never accepts a plaintext body/u);
  let job = outbox.observe(binding, { bodyHash, nowMs });
  assert.equal(job.state, "observed");
  assert.equal(job.bodyPersistence, "hash-only");
  job = outbox.markDrafting(binding, nowMs + 1);
  assert.equal(job.state, "drafting");
  assert.throws(() => outbox.markBlocked(binding, ["Private message text"], nowMs + 2), /content-free uppercase code/u);
  job = outbox.markBlocked(binding, ["CURRENT_FACT_MISSING"], nowMs + 2);
  assert.deepEqual(job.blockedReasonCodes, ["CURRENT_FACT_MISSING"]);
  job = outbox.markDrafting(binding, nowMs + 3);
  job = outbox.startCountdown(binding, nowMs + 10_000, nowMs + 4);
  assert.equal(job.countdownNotBeforeMs, nowMs + 10_000);
  job = outbox.authorize(binding, "authorization-a", nowMs + 10_001);
  job = outbox.claimSending(binding, "attempt-a", nowMs + 10_002);
  job = outbox.markSent(binding, "receipt-a", nowMs + 10_003);
  assert.equal(job.state, "sent");
  assert.equal(job.receiptFingerprint, "receipt-a");
  outbox.close();

  const databaseBytes = await readFile(databasePath);
  assert.equal(databaseBytes.includes(Buffer.from(body, "utf8")), false);
  const restarted = new SqliteAutoSendOutbox(databasePath);
  assert.equal(restarted.find(binding).state, "sent");
  restarted.close();
});

test("logical key is unique across tenant user account chat target graph and policy versions", async (t) => {
  const { databasePath } = await fixture(t);
  const outbox = new SqliteAutoSendOutbox(databasePath);
  const first = outbox.observe(binding, { bodyHash, nowMs });
  assert.equal(outbox.observe(binding, { bodyHash, nowMs: nowMs + 1 }).jobId, first.jobId);
  assert.throws(() => outbox.observe(binding, { bodyHash: "b".repeat(64), nowMs: nowMs + 1 }), /different body hash/u);
  for (const [field, value] of [
    ["tenantId", "tenant-b"], ["userId", "user-b"], ["accountId", "account-b"],
    ["chatId", "chat-b"], ["targetMessageId", "message-b"], ["graphVersion", "graph-10"],
    ["policyVersion", "auto-send-policy.2"],
  ]) {
    const changed = { ...binding, [field]: value };
    assert.notEqual(autoSendLogicalKey(changed), first.logicalKey, field);
    assert.notEqual(outbox.observe(changed, { bodyHash, nowMs }).jobId, first.jobId, field);
  }
  outbox.close();
});

test("restart recovery preserves countdowns, blocks unsafe resumptions and tombstones in-flight ambiguity", async (t) => {
  const { databasePath } = await fixture(t);
  const countdown = { ...binding, targetMessageId: "countdown" };
  const drafting = { ...binding, targetMessageId: "drafting" };
  const authorized = { ...binding, targetMessageId: "authorized" };
  const sending = { ...binding, targetMessageId: "sending" };
  const cancelled = { ...binding, targetMessageId: "cancelled" };
  const sent = { ...binding, targetMessageId: "sent" };
  const first = new SqliteAutoSendOutbox(databasePath);
  for (const value of [countdown, drafting, authorized, sending, cancelled, sent]) first.observe(value, { bodyHash, nowMs });
  first.markDrafting(countdown, nowMs + 1);
  first.startCountdown(countdown, nowMs + 60_000, nowMs + 2);
  first.markDrafting(drafting, nowMs + 1);
  first.markDrafting(authorized, nowMs + 1);
  first.authorize(authorized, "authorization-restart", nowMs + 2);
  first.markDrafting(sending, nowMs + 1);
  first.authorize(sending, "authorization-sending", nowMs + 2);
  first.claimSending(sending, "attempt-sending", nowMs + 3);
  first.cancel(cancelled, "USER_CANCELLED", nowMs + 1);
  first.markDrafting(sent, nowMs + 1);
  first.authorize(sent, "authorization-sent", nowMs + 2);
  first.claimSending(sent, "attempt-sent", nowMs + 3);
  first.markSent(sent, "receipt-sent", nowMs + 4);
  first.close();

  const restarted = new SqliteAutoSendOutbox(databasePath);
  const recovered = restarted.recoverAfterRestart(nowMs + 30_000);
  assert.equal(recovered.length, 4);
  assert.equal(restarted.find(countdown).state, "countdown");
  assert.equal(restarted.find(countdown).countdownNotBeforeMs, nowMs + 60_000);
  assert.equal(restarted.find(drafting).state, "blocked");
  assert.deepEqual(restarted.find(drafting).blockedReasonCodes, ["RESTART_REQUIRES_REDRAFT"]);
  assert.equal(restarted.find(authorized).state, "blocked");
  assert.deepEqual(restarted.find(authorized).blockedReasonCodes, ["RESTART_REQUIRES_REAUTHORIZATION"]);
  assert.equal(restarted.find(sending).state, "ambiguous");
  assert.equal(restarted.find(sending).sendAttemptId, "attempt-sending");
  assert.equal(restarted.find(sent).state, "sent");
  assert.equal(restarted.find(cancelled).state, "cancelled");
  assert.equal(restarted.find(sending).state, "ambiguous");
  assert.equal(restarted.find(sent).state, "sent");
  assert.throws(() => restarted.claimSending(sending, "attempt-retry", nowMs + 40_001), /cannot move from ambiguous/u);
  restarted.close();
});

test("send-attempt and delivery idempotency reject conflicting replay", async (t) => {
  const { databasePath } = await fixture(t);
  const outbox = new SqliteAutoSendOutbox(databasePath);
  outbox.observe(binding, { bodyHash, nowMs });
  outbox.markDrafting(binding, nowMs + 1);
  outbox.authorize(binding, "authorization-a", nowMs + 2);
  const sending = outbox.claimSending(binding, "attempt-a", nowMs + 3);
  assert.equal(outbox.claimSending(binding, "attempt-a", nowMs + 4).revision, sending.revision);
  assert.throws(() => outbox.claimSending(binding, "attempt-b", nowMs + 4), /conflicts/u);
  const sent = outbox.markSent(binding, "receipt-a", nowMs + 5);
  assert.equal(outbox.markSent(binding, "receipt-a", nowMs + 6).revision, sent.revision);
  assert.throws(() => outbox.markSent(binding, "receipt-b", nowMs + 6), /conflicts/u);
  assert.throws(() => outbox.cancel(binding, "LATE_CANCEL", nowMs + 7), /cannot move from sent/u);
  outbox.close();
});
