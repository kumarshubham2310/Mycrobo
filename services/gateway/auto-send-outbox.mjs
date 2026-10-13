import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const AUTO_SEND_JOB_STATES = Object.freeze([
  "observed",
  "drafting",
  "blocked",
  "countdown",
  "authorized",
  "sending",
  "sent",
  "ambiguous",
  "cancelled",
]);

const STATE_SET = new Set(AUTO_SEND_JOB_STATES);
const HASH = /^[a-f\d]{64}$/u;
const REASON_CODE = /^[A-Z][A-Z0-9_]{1,95}$/u;
const OPAQUE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const TRANSITIONS = Object.freeze({
  observed: new Set(["drafting", "blocked", "cancelled"]),
  drafting: new Set(["blocked", "countdown", "authorized", "cancelled"]),
  blocked: new Set(["drafting", "countdown", "cancelled"]),
  countdown: new Set(["authorized", "blocked", "cancelled"]),
  authorized: new Set(["sending", "blocked", "cancelled"]),
  sending: new Set(["sent", "ambiguous"]),
  ambiguous: new Set(["sent"]),
  sent: new Set(),
  cancelled: new Set(),
});

function required(value, name, maximum = 256) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maximum) throw new Error(`${name} is required.`);
  return normalized;
}

function integer(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
  return value;
}

function contentHash(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function reasonCode(value) {
  const normalized = required(value, "reasonCode", 96);
  if (!REASON_CODE.test(normalized)) throw new Error("reasonCode must be a content-free uppercase code.");
  return normalized;
}

function opaqueKey(value, name) {
  const normalized = required(value, name, 128);
  if (!OPAQUE_KEY.test(normalized)) throw new Error(`${name} must be an opaque identifier.`);
  return normalized;
}

function logicalBinding(input = {}) {
  return Object.freeze({
    tenantId: required(input.tenantId, "tenantId"),
    userId: required(input.userId, "userId"),
    accountId: required(input.accountId, "accountId"),
    chatId: required(input.chatId, "chatId"),
    targetMessageId: required(input.targetMessageId, "targetMessageId"),
    graphVersion: required(input.graphVersion, "graphVersion"),
    policyVersion: required(input.policyVersion, "policyVersion"),
  });
}

export function autoSendLogicalKey(input) {
  const binding = logicalBinding(input);
  const hash = createHash("sha256");
  for (const [name, value] of Object.entries(binding)) {
    hash.update(`${name}:${Buffer.byteLength(value, "utf8")}:`, "utf8");
    hash.update(value, "utf8");
    hash.update("\u0000", "utf8");
  }
  return hash.digest("hex");
}

function reasonCodes(values) {
  return [...new Set((Array.isArray(values) ? values : []).map(reasonCode))].sort().slice(0, 32);
}

function parseRow(row) {
  if (!row) return null;
  return Object.freeze({
    jobId: row.job_id,
    logicalKey: row.logical_key,
    state: row.state,
    bodyHash: row.body_hash,
    observedAtMs: Number(row.observed_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
    countdownNotBeforeMs: row.countdown_not_before_ms == null ? null : Number(row.countdown_not_before_ms),
    blockedReasonCodes: Object.freeze(JSON.parse(row.blocked_reason_codes_json || "[]")),
    authorizationId: row.authorization_id || null,
    sendAttemptId: row.send_attempt_id || null,
    receiptFingerprint: row.receipt_fingerprint || null,
    cancelledAtMs: row.cancelled_at_ms == null ? null : Number(row.cancelled_at_ms),
    cancellationReasonCode: row.cancellation_reason_code || null,
    ambiguousAtMs: row.ambiguous_at_ms == null ? null : Number(row.ambiguous_at_ms),
    sentAtMs: row.sent_at_ms == null ? null : Number(row.sent_at_ms),
    restartCount: Number(row.restart_count),
    lastRestartAtMs: row.last_restart_at_ms == null ? null : Number(row.last_restart_at_ms),
    revision: Number(row.revision),
    bodyPersistence: "hash-only",
  });
}

/**
 * Durable content-free job/outbox state. Message bodies are never accepted or
 * persisted; callers must keep an encrypted body elsewhere and present its
 * SHA-256 hash when creating the logical job.
 */
export class SqliteAutoSendOutbox {
  constructor(databasePath) {
    if (!databasePath) throw new Error("An auto-send outbox database path is required.");
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      pragma journal_mode = WAL;
      pragma synchronous = FULL;
      pragma secure_delete = ON;
      create table if not exists auto_send_jobs (
        job_id text primary key,
        logical_key text not null unique,
        state text not null check (state in ('observed','drafting','blocked','countdown','authorized','sending','sent','ambiguous','cancelled')),
        body_hash text not null check (length(body_hash) = 64),
        observed_at_ms integer not null,
        updated_at_ms integer not null,
        countdown_not_before_ms integer,
        blocked_reason_codes_json text not null default '[]',
        authorization_id text,
        send_attempt_id text unique,
        receipt_fingerprint text,
        cancelled_at_ms integer,
        cancellation_reason_code text,
        ambiguous_at_ms integer,
        sent_at_ms integer,
        restart_count integer not null default 0,
        last_restart_at_ms integer,
        revision integer not null default 1
      ) strict;
      create index if not exists auto_send_jobs_state_updated on auto_send_jobs(state, updated_at_ms);
    `);
    this.byLogical = this.database.prepare("select * from auto_send_jobs where logical_key = ?");
    this.byId = this.database.prepare("select * from auto_send_jobs where job_id = ?");
    this.insert = this.database.prepare(`
      insert into auto_send_jobs(job_id, logical_key, state, body_hash, observed_at_ms, updated_at_ms)
      values (?, ?, 'observed', ?, ?, ?)
    `);
    this.update = this.database.prepare(`
      update auto_send_jobs set
        state = ?, updated_at_ms = ?, countdown_not_before_ms = ?, blocked_reason_codes_json = ?,
        authorization_id = ?, send_attempt_id = ?, receipt_fingerprint = ?, cancelled_at_ms = ?,
        cancellation_reason_code = ?, ambiguous_at_ms = ?, sent_at_ms = ?, revision = revision + 1
      where job_id = ? and revision = ?
    `);
    this.restartRows = this.database.prepare("select * from auto_send_jobs where state not in ('sent','ambiguous','cancelled')");
    this.markRestart = this.database.prepare(`
      update auto_send_jobs set state = ?, blocked_reason_codes_json = ?, updated_at_ms = ?,
        ambiguous_at_ms = ?, restart_count = restart_count + 1, last_restart_at_ms = ?, revision = revision + 1
      where job_id = ? and revision = ?
    `);
  }

  #transaction(callback) {
    this.database.exec("begin immediate");
    try {
      const result = callback();
      this.database.exec("commit");
      return result;
    } catch (error) {
      this.database.exec("rollback");
      throw error;
    }
  }

  observe(bindingInput, { bodyHash, nowMs, body, draftText } = {}) {
    if (body !== undefined || draftText !== undefined) throw new Error("Auto-send outbox never accepts a plaintext body.");
    const logicalKey = autoSendLogicalKey(bindingInput);
    const exactBodyHash = required(bodyHash, "bodyHash", 64);
    if (!HASH.test(exactBodyHash)) throw new Error("bodyHash must be a SHA-256 hex digest.");
    const observedAtMs = integer(nowMs, "nowMs");
    return this.#transaction(() => {
      const prior = parseRow(this.byLogical.get(logicalKey));
      if (prior) {
        if (prior.bodyHash !== exactBodyHash) throw new Error("The logical auto-send job already exists with a different body hash.");
        return prior;
      }
      const jobId = contentHash(`auto-send-job\u0000${logicalKey}`);
      this.insert.run(jobId, logicalKey, exactBodyHash, observedAtMs, observedAtMs);
      return parseRow(this.byId.get(jobId));
    });
  }

  find(bindingInput) {
    return parseRow(this.byLogical.get(autoSendLogicalKey(bindingInput)));
  }

  findByJobId(jobId) {
    return parseRow(this.byId.get(required(jobId, "jobId", 64)));
  }

  #transition(bindingInput, nextState, options = {}) {
    if (!STATE_SET.has(nextState)) throw new Error("Choose a valid auto-send state.");
    const logicalKey = autoSendLogicalKey(bindingInput);
    const at = integer(options.nowMs, "nowMs");
    return this.#transaction(() => {
      const current = parseRow(this.byLogical.get(logicalKey));
      if (!current) throw new Error("The auto-send job does not exist.");
      if (current.state === nextState) {
        if (nextState === "authorized" && current.authorizationId !== opaqueKey(options.authorizationId, "authorizationId")) throw new Error("Authorization id conflicts with the durable job.");
        if (nextState === "sending" && current.sendAttemptId !== opaqueKey(options.sendAttemptId, "sendAttemptId")) throw new Error("Send attempt id conflicts with the durable job.");
        if (nextState === "sent" && current.receiptFingerprint !== opaqueKey(options.receiptFingerprint, "receiptFingerprint")) throw new Error("Delivery receipt conflicts with the durable job.");
        return current;
      }
      if (!TRANSITIONS[current.state].has(nextState)) throw new Error(`Auto-send job cannot move from ${current.state} to ${nextState}.`);
      const countdownNotBeforeMs = nextState === "countdown"
        ? integer(options.countdownNotBeforeMs, "countdownNotBeforeMs")
        : current.countdownNotBeforeMs;
      if (nextState === "countdown" && countdownNotBeforeMs <= at) throw new Error("Countdown must end in the future.");
      const blocked = nextState === "blocked" ? reasonCodes(options.reasonCodes) : current.blockedReasonCodes;
      if (nextState === "blocked" && !blocked.length) throw new Error("A content-free blocked reason code is required.");
      const authorizationId = nextState === "authorized" ? opaqueKey(options.authorizationId, "authorizationId") : current.authorizationId;
      const sendAttemptId = nextState === "sending" ? opaqueKey(options.sendAttemptId, "sendAttemptId") : current.sendAttemptId;
      const receiptFingerprint = nextState === "sent" ? opaqueKey(options.receiptFingerprint, "receiptFingerprint") : current.receiptFingerprint;
      const cancellationReasonCode = nextState === "cancelled" ? reasonCode(options.reasonCode) : current.cancellationReasonCode;
      const result = this.update.run(
        nextState,
        at,
        countdownNotBeforeMs,
        JSON.stringify(blocked),
        authorizationId,
        sendAttemptId,
        receiptFingerprint,
        nextState === "cancelled" ? at : current.cancelledAtMs,
        cancellationReasonCode,
        nextState === "ambiguous" ? at : current.ambiguousAtMs,
        nextState === "sent" ? at : current.sentAtMs,
        current.jobId,
        current.revision,
      );
      if (result.changes !== 1) throw new Error("Auto-send job changed concurrently.");
      return parseRow(this.byId.get(current.jobId));
    });
  }

  markDrafting(binding, nowMs) { return this.#transition(binding, "drafting", { nowMs }); }
  markBlocked(binding, reasonCodesInput, nowMs) { return this.#transition(binding, "blocked", { nowMs, reasonCodes: reasonCodesInput }); }
  startCountdown(binding, countdownNotBeforeMs, nowMs) { return this.#transition(binding, "countdown", { nowMs, countdownNotBeforeMs }); }
  authorize(binding, authorizationId, nowMs) { return this.#transition(binding, "authorized", { nowMs, authorizationId }); }
  claimSending(binding, sendAttemptId, nowMs) { return this.#transition(binding, "sending", { nowMs, sendAttemptId }); }
  markAmbiguous(binding, nowMs) { return this.#transition(binding, "ambiguous", { nowMs }); }
  markSent(binding, receiptFingerprint, nowMs) { return this.#transition(binding, "sent", { nowMs, receiptFingerprint }); }
  cancel(binding, reasonCode, nowMs) { return this.#transition(binding, "cancelled", { nowMs, reasonCode }); }

  recoverAfterRestart(nowMs) {
    const at = integer(nowMs, "nowMs");
    return this.#transaction(() => {
      const recovered = [];
      for (const row of this.restartRows.all()) {
        const current = parseRow(row);
        let nextState = current.state;
        let blocked = current.blockedReasonCodes;
        let ambiguousAtMs = current.ambiguousAtMs;
        if (current.state === "sending") {
          nextState = "ambiguous";
          ambiguousAtMs = at;
        } else if (["drafting", "authorized"].includes(current.state)) {
          nextState = "blocked";
          blocked = [current.state === "drafting" ? "RESTART_REQUIRES_REDRAFT" : "RESTART_REQUIRES_REAUTHORIZATION"];
        }
        const result = this.markRestart.run(nextState, JSON.stringify(blocked), at, ambiguousAtMs, at, current.jobId, current.revision);
        if (result.changes !== 1) throw new Error("Auto-send restart recovery changed concurrently.");
        recovered.push(parseRow(this.byId.get(current.jobId)));
      }
      return Object.freeze(recovered);
    });
  }

  close() {
    this.database.close();
  }
}
