import { createHash } from "node:crypto";

import { hashAutoSendDraft } from "../../packages/core/auto-send-authorization.ts";
import { buildAutoSendSafetyContext } from "../../packages/core/auto-send-safety-context.ts";
import { AUTO_SEND_POLICY_VERSION, evaluateAutoSendPolicy } from "../../packages/core/auto-send-policy.ts";
import { AutoSendCoordinator } from "./auto-send-coordinator.mjs";

export const AUTO_SEND_RUNTIME_CONTRACT = "mycrobo.auto-send-runtime.1";
export const AUTO_SEND_EXECUTION_CONSENT_VERSION = "auto-send-execution-consent.1";

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const TERMINAL_STATES = new Set(["sent", "ambiguous", "cancelled"]);

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized || !OPAQUE_ID.test(normalized)) throw new Error(`${name} must be an opaque identifier.`);
  return normalized;
}

function integer(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer.`);
  return value;
}

function unique(values) {
  return [...new Set(values)].sort();
}

function digest(label, value) {
  return createHash("sha256").update(`${label}\u0000${String(value || "")}`, "utf8").digest("hex");
}

function draftSafetyDigest(value) {
  return `sha256_${digest("draft", value)}`;
}

function outboxBinding(input) {
  return Object.freeze({
    tenantId: required(input.tenantId, "tenantId"),
    userId: required(input.userId, "userId"),
    accountId: required(input.accountId, "accountId"),
    chatId: required(input.chatId, "chatId"),
    targetMessageId: required(input.targetMessageId, "targetMessageId"),
    graphVersion: required(input.relationshipGraphVersion, "relationshipGraphVersion"),
    policyVersion: AUTO_SEND_POLICY_VERSION,
  });
}

function authorizationBinding(input) {
  return Object.freeze({
    tenantId: required(input.tenantId, "tenantId"),
    accountId: required(input.accountId, "accountId"),
    relationshipGraphId: required(input.relationshipGraphId, "relationshipGraphId"),
    relationshipGraphVersion: required(input.relationshipGraphVersion, "relationshipGraphVersion"),
    chatId: required(input.chatId, "chatId"),
    targetMessageId: required(input.targetMessageId, "targetMessageId"),
  });
}

function consentReasons(consent, request, buildVersion, nowMs) {
  const reasons = [];
  if (!consent || typeof consent !== "object") return ["EXECUTION_CONSENT_MISSING"];
  if (consent.version !== AUTO_SEND_EXECUTION_CONSENT_VERSION) reasons.push("EXECUTION_CONSENT_VERSION_MISMATCH");
  if (consent.authorized !== true) reasons.push("EXECUTION_CONSENT_NOT_AUTHORIZED");
  if (consent.emergencyStop !== false) reasons.push("EXECUTION_EMERGENCY_STOP_ACTIVE");
  if (consent.tenantId !== request.tenantId) reasons.push("EXECUTION_CONSENT_TENANT_MISMATCH");
  if (consent.userId !== request.userId) reasons.push("EXECUTION_CONSENT_USER_MISMATCH");
  if (consent.buildVersion !== buildVersion) reasons.push("EXECUTION_CONSENT_BUILD_MISMATCH");
  if (consent.policyVersion !== AUTO_SEND_POLICY_VERSION) reasons.push("EXECUTION_CONSENT_POLICY_MISMATCH");
  const grantedAtMs = Date.parse(String(consent.grantedAt || ""));
  if (!Number.isFinite(grantedAtMs) || grantedAtMs > nowMs || consent.revokedAt != null) reasons.push("EXECUTION_CONSENT_TIME_INVALID");
  return unique(reasons);
}

function policyVersionReasons(snapshot) {
  const layers = [snapshot?.tenantDefault, snapshot?.relationshipPolicy, snapshot?.chatOverride].filter(Boolean);
  return layers.every((layer) => layer.policyVersion === AUTO_SEND_POLICY_VERSION)
    ? []
    : ["POLICY_VERSION_MISMATCH"];
}

function publicResult(job, options = {}) {
  return Object.freeze({
    contract: AUTO_SEND_RUNTIME_CONTRACT,
    state: job.state,
    job,
    reasons: Object.freeze(unique(options.reasons || [])),
    ...(options.policyDecision ? { policyDecision: options.policyDecision } : {}),
    ...(options.safety ? { safety: options.safety } : {}),
    ...(options.delivery ? { delivery: Object.freeze(options.delivery) } : {}),
  });
}

/**
 * Fail-closed runtime planner. It is inert unless `enabled: true`, a valid
 * tenant/user/build/policy execution consent is present, and every fresh
 * safety and policy check passes. The only code allowed to see the draft body
 * after validation is the injected delivery boundary.
 */
export class AutoSendRuntimePlanner {
  constructor({
    enabled = false,
    buildVersion,
    issuer,
    outbox,
    loadCurrentState,
    deliveryBoundary,
    clock = () => Date.now(),
    countdownMs = 10_000,
  } = {}) {
    this.enabled = enabled === true;
    this.buildVersion = required(buildVersion, "buildVersion");
    if (!issuer || !outbox || typeof loadCurrentState !== "function") {
      throw new Error("Auto-send runtime requires an issuer, content-free outbox, and current-state loader.");
    }
    if (this.enabled && typeof deliveryBoundary !== "function") {
      throw new Error("Enabled auto-send runtime requires an injected delivery boundary.");
    }
    this.issuer = issuer;
    this.outbox = outbox;
    this.loadCurrentState = loadCurrentState;
    this.deliveryBoundary = deliveryBoundary;
    this.clock = clock;
    this.countdownMs = Math.max(1_000, Math.min(120_000, integer(countdownMs, "countdownMs")));
  }

  #block(binding, job, reasons, nowMs, details = {}) {
    const codes = unique(reasons.length ? reasons : ["RUNTIME_BLOCKED"]);
    let blocked = job;
    if (!TERMINAL_STATES.has(job.state)) {
      blocked = this.outbox.markBlocked(binding, codes, nowMs);
    }
    return publicResult(blocked, { ...details, reasons: codes });
  }

  async #preflight(request, binding, draftText, nowMs, countdownElapsed) {
    let snapshot;
    try {
      snapshot = await this.loadCurrentState(Object.freeze({
        binding: Object.freeze({ ...authorizationBinding(request), userId: request.userId }),
        bodyHash: hashAutoSendDraft(draftText),
        nowMs,
      }));
    } catch {
      return { reasons: ["CURRENT_STATE_UNAVAILABLE"], safety: null, policyDecision: null, snapshot: null };
    }
    const safety = buildAutoSendSafetyContext({
      ...(snapshot?.safetyInput || {}),
      nowMs,
      binding: authorizationBinding(request),
    });
    const policyInput = {
      tenantDefault: snapshot?.tenantDefault,
      relationshipPolicy: snapshot?.relationshipPolicy,
      chatOverride: snapshot?.chatOverride,
      safety: { ...safety.safety, countdownElapsed },
    };
    const policyDecision = evaluateAutoSendPolicy(policyInput);
    const reasons = [
      ...safety.reasons,
      ...consentReasons(snapshot?.executionConsent, request, this.buildVersion, nowMs),
      ...policyVersionReasons(snapshot),
      ...policyDecision.blocks,
    ];
    if (safety.provenance.bindings.draft !== draftSafetyDigest(draftText)) reasons.push("DRAFT_BINDING_MISMATCH");
    return { reasons: unique(reasons), safety, policyDecision, snapshot };
  }

  async run(input = {}) {
    const nowMs = integer(input.nowMs ?? this.clock(), "nowMs");
    const request = Object.freeze({
      tenantId: required(input.tenantId, "tenantId"),
      userId: required(input.userId, "userId"),
      accountId: required(input.accountId, "accountId"),
      relationshipGraphId: required(input.relationshipGraphId, "relationshipGraphId"),
      relationshipGraphVersion: required(input.relationshipGraphVersion, "relationshipGraphVersion"),
      chatId: required(input.chatId, "chatId"),
      targetMessageId: required(input.targetMessageId, "targetMessageId"),
    });
    const draftText = String(input.draftText || "");
    if (!draftText || draftText.length > 800) throw new Error("draftText must be a bounded non-empty draft.");
    const executionId = required(input.executionId, "executionId");
    const binding = outboxBinding(request);
    let job = this.outbox.observe(binding, { bodyHash: hashAutoSendDraft(draftText), nowMs });

    if (input.cancelRequested === true || input.signal?.aborted === true) {
      if (TERMINAL_STATES.has(job.state)) return publicResult(job, { reasons: [`JOB_${job.state.toUpperCase()}`] });
      job = this.outbox.cancel(binding, "USER_CANCELLED", nowMs);
      return publicResult(job, { reasons: ["USER_CANCELLED"] });
    }
    if (TERMINAL_STATES.has(job.state)) return publicResult(job, { reasons: [`JOB_${job.state.toUpperCase()}`] });
    if (!this.enabled) return this.#block(binding, job, ["RUNTIME_DISABLED"], nowMs);
    if (job.state === "sending") return publicResult(job, { reasons: ["IN_FLIGHT_JOB_REQUIRES_RECOVERY"] });
    if (job.state === "authorized") return this.#block(binding, job, ["IN_FLIGHT_JOB_REQUIRES_RECOVERY"], nowMs);
    if (["observed", "blocked"].includes(job.state)) job = this.outbox.markDrafting(binding, nowMs);

    const countdownElapsed = job.state === "countdown" && nowMs >= job.countdownNotBeforeMs;
    let preflight = await this.#preflight(request, binding, draftText, nowMs, countdownElapsed);
    if (input.signal?.aborted === true) {
      job = this.outbox.cancel(binding, "USER_CANCELLED", nowMs);
      return publicResult(job, { reasons: ["USER_CANCELLED"], policyDecision: preflight.policyDecision, safety: preflight.safety });
    }
    const countdownOnly = preflight.policyDecision?.effectiveMode === "countdown"
      && preflight.reasons.length === 1
      && preflight.reasons[0] === "COUNTDOWN_NOT_ELAPSED";
    if (countdownOnly) {
      if (job.state !== "countdown") job = this.outbox.startCountdown(binding, nowMs + this.countdownMs, nowMs);
      return publicResult(job, { reasons: ["COUNTDOWN_NOT_ELAPSED"], policyDecision: preflight.policyDecision, safety: preflight.safety });
    }
    if (preflight.reasons.length || !preflight.policyDecision?.eligibleForAuthorization) {
      return this.#block(binding, job, preflight.reasons, nowMs, { policyDecision: preflight.policyDecision, safety: preflight.safety });
    }

    // Re-fetch every authority immediately before capability issuance. A
    // consent revocation, new message, graph update, or policy change between
    // planning and execution therefore fails closed.
    preflight = await this.#preflight(request, binding, draftText, nowMs, true);
    if (input.signal?.aborted === true) {
      job = this.outbox.cancel(binding, "USER_CANCELLED", nowMs);
      return publicResult(job, { reasons: ["USER_CANCELLED"], policyDecision: preflight.policyDecision, safety: preflight.safety });
    }
    if (preflight.reasons.length || !preflight.policyDecision?.eligibleForAuthorization) {
      return this.#block(binding, job, preflight.reasons, nowMs, { policyDecision: preflight.policyDecision, safety: preflight.safety });
    }

    const sendAttemptId = `attempt_${digest("auto-send-attempt", `${job.jobId}\u0000${executionId}`)}`;
    let boundaryInvoked = false;
    const coordinator = new AutoSendCoordinator({
      issuer: this.issuer,
      deliver: async (delivery) => {
        job = this.outbox.authorize(binding, delivery.intent.authorizationId, nowMs);
        job = this.outbox.claimSending(binding, sendAttemptId, nowMs);
        boundaryInvoked = true;
        return this.deliveryBoundary(delivery);
      },
    });

    try {
      const completed = await coordinator.execute({
        ...authorizationBinding(request),
        idempotencyKey: job.jobId,
        executionId,
        draftText,
        policy: {
          tenantDefault: preflight.snapshot.tenantDefault,
          relationshipPolicy: preflight.snapshot.relationshipPolicy,
          chatOverride: preflight.snapshot.chatOverride,
          safety: { ...preflight.safety.safety, countdownElapsed: true },
        },
        nowMs,
        ttlMs: input.ttlMs,
        deliveredAtMs: integer(input.deliveredAtMs ?? this.clock(), "deliveredAtMs"),
      });
      job = this.outbox.markSent(binding, completed.delivery.receiptFingerprint, integer(input.deliveredAtMs ?? this.clock(), "deliveredAtMs"));
      return publicResult(job, {
        policyDecision: preflight.policyDecision,
        safety: preflight.safety,
        delivery: {
          authorizationId: completed.intent.authorizationId,
          executionId: completed.intent.executionId,
          receiptFingerprint: completed.delivery.receiptFingerprint,
        },
      });
    } catch {
      const current = this.outbox.find(binding) || job;
      if (boundaryInvoked && current.state === "sending") job = this.outbox.markAmbiguous(binding, integer(this.clock(), "nowMs"));
      else if (!TERMINAL_STATES.has(current.state)) job = this.outbox.markBlocked(binding, ["RUNTIME_EXECUTION_FAILED"], integer(this.clock(), "nowMs"));
      else job = current;
      return publicResult(job, { reasons: [boundaryInvoked ? "DELIVERY_OUTCOME_AMBIGUOUS" : "RUNTIME_EXECUTION_FAILED"], policyDecision: preflight.policyDecision, safety: preflight.safety });
    }
  }
}
