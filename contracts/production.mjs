import { createHmac, timingSafeEqual } from "node:crypto";

export const PLATFORM_CONTRACT_VERSION = "mycrobo-platform.1";

export const PLATFORM_CAPABILITIES = Object.freeze({
  cursorPagination: true,
  archivedCollection: true,
  storyProvenance: true,
  mediaReasoningMetadata: true,
  exactApprovalSend: true,
  offlineSend: false,
  eventReconciliation: true,
});

export class PlatformContractError extends Error {
  constructor(code, message, { retryable = false, userAction = "none", preservedState = true, correlationId = null } = {}) {
    super(message);
    this.name = "PlatformContractError";
    this.code = code;
    this.retryable = retryable;
    this.userAction = userAction;
    this.preservedState = preservedState;
    this.correlationId = correlationId;
  }
}

export function negotiatePlatformContract({ supportedVersions, requiredCapabilities = [] }) {
  const version = supportedVersions.includes(PLATFORM_CONTRACT_VERSION) ? PLATFORM_CONTRACT_VERSION : null;
  const missingCapabilities = requiredCapabilities.filter((capability) => PLATFORM_CAPABILITIES[capability] !== true);
  if (!version || missingCapabilities.length) {
    throw new PlatformContractError("CLIENT_UPGRADE_REQUIRED", "The client and service contracts are incompatible.", {
      userAction: "upgrade-client",
    });
  }
  return { version, capabilities: PLATFORM_CAPABILITIES };
}

export function authorizePlatformRequest({ requestId, contractVersion, principal, requiredScope, nowMs }) {
  if (!requestId || !/^[a-zA-Z0-9._:-]{8,128}$/u.test(requestId)) {
    throw new PlatformContractError("REQUEST_ID_REQUIRED", "A valid request ID is required.");
  }
  if (contractVersion !== PLATFORM_CONTRACT_VERSION) {
    throw new PlatformContractError("CONTRACT_VERSION_UNSUPPORTED", "The API contract version is unsupported.", {
      userAction: "upgrade-client",
      correlationId: requestId,
    });
  }
  if (!principal?.userId || !principal?.tenantId || !principal?.deviceId) {
    throw new PlatformContractError("AUTHENTICATION_REQUIRED", "An authenticated user, tenant and device are required.", {
      userAction: "sign-in",
      correlationId: requestId,
    });
  }
  if (!Array.isArray(principal.scopes) || !principal.scopes.includes(requiredScope)) {
    throw new PlatformContractError("SCOPE_DENIED", "The request is not authorized for this operation.", {
      userAction: "none",
      correlationId: requestId,
    });
  }
  if (!Number.isFinite(principal.expiresAtMs) || nowMs >= principal.expiresAtMs) {
    throw new PlatformContractError("TOKEN_EXPIRED", "The session expired.", {
      retryable: true,
      userAction: "sign-in",
      correlationId: requestId,
    });
  }
  return Object.freeze({
    requestId,
    userId: principal.userId,
    tenantId: principal.tenantId,
    deviceId: principal.deviceId,
    scope: requiredScope,
  });
}

function cursorSignature(payload, secret) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function encodeCursor(data, secret) {
  const payload = Buffer.from(JSON.stringify(data), "utf8").toString("base64url");
  return `${payload}.${cursorSignature(payload, secret)}`;
}

function decodeCursor(cursor, secret) {
  const [payload, signature, extra] = String(cursor || "").split(".");
  if (!payload || !signature || extra) throw new PlatformContractError("CURSOR_INVALID", "The page cursor is invalid.");
  const expected = Buffer.from(cursorSignature(payload, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new PlatformContractError("CURSOR_INVALID", "The page cursor is invalid.");
  }
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new PlatformContractError("CURSOR_INVALID", "The page cursor is invalid.");
  }
}

export function cursorPage({ records, cursor = null, limit = 50, cursorSecret, tenantId, collection, snapshotRevision }) {
  const size = Number(limit);
  if (!Number.isInteger(size) || size < 1 || size > 100) {
    throw new PlatformContractError("PAGE_SIZE_INVALID", "Page size must be between 1 and 100.");
  }
  if (!cursorSecret || String(cursorSecret).length < 32) throw new Error("A strong cursor signing secret is required.");
  let offset = 0;
  if (cursor) {
    const state = decodeCursor(cursor, cursorSecret);
    if (state.v !== 1 || state.tenantId !== tenantId || state.collection !== collection || state.snapshotRevision !== snapshotRevision) {
      throw new PlatformContractError("CURSOR_SCOPE_MISMATCH", "The page cursor belongs to a different data scope.");
    }
    offset = state.offset;
  }
  const items = records.slice(offset, offset + size);
  const nextOffset = offset + items.length;
  return {
    items,
    nextCursor: nextOffset < records.length
      ? encodeCursor({ v: 1, tenantId, collection, snapshotRevision, offset: nextOffset }, cursorSecret)
      : null,
    snapshotRevision,
  };
}

export function applyRevisionedDraftEdit({ draft, expectedRevision, newText }) {
  if (draft.revision !== expectedRevision) {
    throw new PlatformContractError("DRAFT_REVISION_CONFLICT", "The draft changed on another device.", {
      retryable: false,
      userAction: "review-latest-draft",
      preservedState: true,
    });
  }
  const text = String(newText || "").trim();
  if (!text) throw new PlatformContractError("DRAFT_EMPTY", "A draft cannot be empty.");
  return { ...draft, text, revision: draft.revision + 1 };
}

const METRIC_NAMES = new Set([
  "conversations_discovered",
  "coverage_terminal",
  "draft_discarded",
  "draft_edit_distance",
  "identity_merge",
  "latest_mismatch",
  "latest_refresh_age_ms",
  "model_latency_ms",
  "reply_decision",
  "speaker_uncertainty",
  "stale_draft_invalidated",
  "sync_retry",
]);
const SAFE_LABELS = new Set(["collection", "connector", "decision", "model_version", "platform", "reason", "status"]);
const CONTENT_KEYS = /(?:body|chat|contact|draft|email|file|jid|message|name|phone|recipient|text|title|transcript|url)/iu;

export function createRedactedMetric({ name, value, labels = {}, correlationId, observedAt }) {
  if (!METRIC_NAMES.has(name)) throw new Error("Metric name is not allowlisted.");
  if (!Number.isFinite(value)) throw new Error("Metric value must be numeric.");
  if (!correlationId || !observedAt) throw new Error("Correlation ID and observation time are required.");
  const safeLabels = {};
  for (const [key, rawValue] of Object.entries(labels)) {
    if (!SAFE_LABELS.has(key) || CONTENT_KEYS.test(key)) throw new Error("Metric label is not allowlisted.");
    const label = String(rawValue);
    if (!/^[a-z0-9][a-z0-9._:-]{0,63}$/iu.test(label) || /\d{8,}/u.test(label)) {
      throw new Error("Metric label may contain private content.");
    }
    safeLabels[key] = label;
  }
  return Object.freeze({ name, value, labels: safeLabels, correlationId, observedAt });
}

export const REQUIRED_P0_GATES = Object.freeze([
  "no-unintended-send",
  "latest-is-latest",
  "exact-chronology",
  "available-history-ledger",
  "archive-separation",
  "stable-identity",
  "correct-speakers",
  "clean-content",
  "full-story",
  "group-restraint",
  "truthful-tone-quality",
  "package-parity",
  "recovery-idempotency",
]);

export function evaluateProductionRelease({ gates, securityFindings, skippedSendSafetyTests, artifact, signoffs }) {
  const gateMap = new Map(gates.map((gate) => [gate.id, gate]));
  const missingGates = REQUIRED_P0_GATES.filter((id) => gateMap.get(id)?.status !== "passed" || !gateMap.get(id)?.evidenceId);
  const blockingSecurity = securityFindings.filter((finding) => ["critical", "high"].includes(finding.severity) && finding.status !== "resolved");
  const requiredSignoffs = ["engineering", "product", "qa", "security-privacy"];
  const missingSignoffs = requiredSignoffs.filter((role) => !signoffs.some((signoff) => signoff.role === role && signoff.approved === true));
  const artifactReady = Boolean(artifact?.signed && artifact?.hashVerified && artifact?.packageParityVerified && artifact?.rollbackTested);
  const blockers = [
    ...missingGates.map((id) => `gate:${id}`),
    ...blockingSecurity.map((finding) => `security:${finding.id}`),
    ...missingSignoffs.map((role) => `signoff:${role}`),
    ...(skippedSendSafetyTests > 0 ? [`send-safety-skipped:${skippedSendSafetyTests}`] : []),
    ...(!artifactReady ? ["artifact:not-release-ready"] : []),
  ];
  return {
    decision: blockers.length ? "NO-GO" : "GO",
    blockers,
    gateSummary: { passed: REQUIRED_P0_GATES.length - missingGates.length, required: REQUIRED_P0_GATES.length },
    claim: blockers.length ? "Not production ready." : "Production release gates passed for this exact signed artifact.",
  };
}
