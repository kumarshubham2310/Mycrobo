import { createHash } from "node:crypto";

import { isDisplayableEvent, isHumanText, orderedEvents } from "./conversation.ts";
import { unresolvedDraftPlaceholders, validateDraftOutput, type DraftContext } from "./draft.ts";
import type { AutoSendSafetyContext } from "./auto-send-policy.ts";
import type { CanonicalChat, MessageEvent, SyncWatermark } from "./domain.ts";

export const AUTO_SEND_SAFETY_CONTEXT_CONTRACT = "mycrobo.auto-send-safety-context.1" as const;

export type AutoSendSafetyReason =
  | "AUTHORIZATION_DISABLED"
  | "EVALUATION_TIME_INVALID"
  | "BRIDGE_BUNDLE_UNAVAILABLE"
  | "BRIDGE_TRUTH_NOT_CURRENT"
  | "IDENTITY_UNVERIFIED"
  | "ACCOUNT_MISMATCH"
  | "CHAT_MISMATCH"
  | "TARGET_MESSAGE_MISSING"
  | "TARGET_MESSAGE_STALE"
  | "NEWER_MESSAGE_EXISTS"
  | "CHAT_KIND_UNKNOWN"
  | "DRAFT_VALIDATION_FAILED"
  | "GRAPH_BINDING_MISMATCH"
  | "DRAFT_HAS_PLACEHOLDERS"
  | "NEW_COMMITMENT_DETECTED"
  | "TIME_DATE_LOCATION_PROMISE_DETECTED"
  | "MONEY_OR_PAYMENT_DETECTED"
  | "LEGAL_MEDICAL_OR_SENSITIVE_DETECTED"
  | "MEDIA_OR_OCR_UNCERTAIN"
  | "CONNECTOR_NOT_CURRENT"
  | "USAGE_LIMIT_UNKNOWN_OR_REACHED"
  | "QUIET_HOURS_UNKNOWN_OR_ACTIVE";

export type AutoSendAuthorityBinding = Readonly<{
  tenantId: string;
  accountId: string;
  relationshipGraphId: string;
  relationshipGraphVersion: string;
  chatId: string;
  targetMessageId: string;
}>;

export type AuthoritativeBridgeBundle = Readonly<{
  chat: CanonicalChat;
  events: readonly MessageEvent[];
  watermark: SyncWatermark;
  latest: MessageEvent | null;
  latestSource: MessageEvent | null;
  readiness: Readonly<{
    currentMessage?: Readonly<{ state?: string }>;
    currentStory?: Readonly<{ state?: string }>;
    draftAllowed?: boolean;
    observedAt?: string | null;
  }>;
  accountScopeId: string;
}>;

export type AutoSendVerifiedIdentity = Readonly<{
  verified: boolean;
  tenantId: string;
  accountId: string;
  chatId: string;
  /** Canonical person id for direct chats; the canonical chat id for groups. */
  relationshipIdentityId: string;
}>;

export type AutoSendMediaAssessment = Readonly<{
  messageId: string;
  status: "verified-safe" | "uncertain" | "unavailable";
  ocrUncertain: boolean;
  requiresUserVerification: boolean;
}>;

export type AutoSendSafetyContextInput = Readonly<{
  nowMs: number;
  binding: AutoSendAuthorityBinding;
  bridgeBundle: AuthoritativeBridgeBundle;
  draftContext: DraftContext;
  /** Candidate or previously validated result; it is always validated again. */
  draftOutput: unknown;
  identity: AutoSendVerifiedIdentity;
  connection: Readonly<{
    connected: boolean;
    state: string;
    accountId: string;
  }>;
  usage: Readonly<{ withinLimits: boolean }>;
  quietHours: Readonly<{ active: boolean }>;
  mediaAssessments?: readonly AutoSendMediaAssessment[];
  authorizationEnabled: boolean;
  countdownElapsed?: boolean;
  customRuleId?: string;
  customRulePassed?: boolean;
}>;

export type BuiltAutoSendSafetyContext = Readonly<{
  contract: typeof AUTO_SEND_SAFETY_CONTEXT_CONTRACT;
  passed: boolean;
  safety: Readonly<AutoSendSafetyContext>;
  reasons: readonly AutoSendSafetyReason[];
  provenance: Readonly<{
    evaluatedAtMs: number;
    sources: readonly ["bridge-bundle", "bridge-latest-truth", "validated-draft", "graph-grounding", "runtime-safety"];
    bindings: Readonly<{
      tenant: string;
      account: string;
      chat: string;
      targetMessage: string;
      relationshipGraph: string;
      relationshipGraphVersion: string;
      draft: string;
    }>;
    checks: Readonly<{
      bridgeBundleCurrent: boolean;
      identityMatched: boolean;
      accountMatched: boolean;
      targetCurrent: boolean;
      graphBindingMatched: boolean;
      draftValidated: boolean;
    }>;
  }>;
}>;

const PLACEHOLDER = /\[(?:add|confirm|enter|replace|say|select|write)\b[^\]\r\n]{0,120}\]|\{\{(?:date|time)\}\}/iu;
const FIRST_PERSON_COMMITMENT = /\b(?:i|we|main|mai|mein|hum)\b.{0,30}\b(?:will|shall|can|promise|commit|going to|plan to|send|share|call|pay|meet|reach|deliver|complete|finish|review|check|confirm|update|visit)\b|\b(?:bata|bhej|check|confirm|dekh|janav|kahi|kar|mokli|pahunch|send|update)\s*(?:dais|dunga|dungi|deta|deti|karis|karunga|karungi|lau|lunga|lungi)\b/iu;
const AFFIRMATIVE_ONLY = /^(?:yes|yes sure|sure|okay|ok|done|haan+|haa+|ha+|thee?k(?: hai)?|thik(?: hai)?)[.!…\s\p{Extended_Pictographic}]*$/iu;
const ACTION_REQUEST = /\b(?:can|could|will|would|please|pls|plz)\b.{0,50}\b(?:send|share|call|pay|meet|reach|deliver|complete|finish|review|check|confirm|update|visit)\b|\b(?:bhej|bhejo|bata|kar|karo|karjo|mokli|moklo|pahunch)\b/iu;
const TIME_DATE = /\b(?:today|tomorrow|tonight|yesterday|aaj|kal|tonight|morning|afternoon|evening|subah|shaam|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\s+(?:week|month)|by\s+when|before|after|at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\b/iu;
const LOCATION_PROMISE = /\b(?:i|we|main|mai|mein|hum)\b.{0,28}\b(?:at|in|near|outside|from|home|office|ghar|location|reach|arrive|come|go|visit)\b|\b(?:meet|meeting|reach|arrive|come|go|visit)\b.{0,35}\b(?:at|in|near|outside|from|to)\b/iu;
const MONEY_OR_PAYMENT = /(?:[₹$€£]\s*\d)|\b(?:money|payment|paid|pay|price|cost|amount|invoice|refund|deposit|balance|bank|account|upi|cash|credit|debit|emi|loan|salary|quote|quotation)\b/iu;
const LEGAL_MEDICAL_SENSITIVE = /\b(?:lawyer|attorney|court|legal|lawsuit|sue|police|fir|contract|notice|settlement|doctor|hospital|medical|medicine|medication|dose|dosage|prescription|diagnosis|symptom|surgery|therapy|pregnan|password|passcode|otp|pin|cvv|secret|private key|recovery code|aadhaar|aadhar|pan card|passport|ssn|confidential|private|intimate|nude|sexual|self[- ]?harm|suicide)\b/iu;
const OPAQUE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const MAX_BRIDGE_TRUTH_AGE_MS = 120_000;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function digest(label: string, value: unknown) {
  return `sha256_${createHash("sha256").update(`${label}\u0000${String(value || "")}`, "utf8").digest("hex")}`;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

function verifiedRelationshipIdentity(chat: CanonicalChat | undefined, identity: AutoSendVerifiedIdentity | undefined) {
  if (!chat || identity?.verified !== true) return false;
  if (chat.kind === "group") return identity.relationshipIdentityId === chat.id;
  return Boolean(identity.relationshipIdentityId && chat.participantIds.includes(identity.relationshipIdentityId));
}

function validatedDraft(input: AutoSendSafetyContextInput | null | undefined) {
  if (!input?.draftContext) return null;
  try {
    return validateDraftOutput(input.draftOutput, input.draftContext);
  } catch {
    return null;
  }
}

/**
 * Builds the complete policy safety input from current authoritative state.
 * It cannot send, queue, mint, or consume an authorization. Unknown or
 * malformed state is projected to the blocking value for every safety flag.
 */
export function buildAutoSendSafetyContext(input?: AutoSendSafetyContextInput | null): BuiltAutoSendSafetyContext {
  const binding = input?.binding;
  const bundle = input?.bridgeBundle;
  const context = input?.draftContext;
  const identity = input?.identity;
  const candidate = validatedDraft(input);
  const candidateRecord = record(input?.draftOutput);
  const candidateText = candidate?.draft || text(candidateRecord?.draft);
  const events = Array.isArray(bundle?.events) ? [...bundle.events] : [];
  const ordered = orderedEvents(events);
  const displayable = ordered.filter(isDisplayableEvent);
  const human = ordered.filter((event) => event.timestampVerified && event.timestampMs !== null && isHumanText(event));
  const latestSource = displayable.at(-1) || null;
  const latestHuman = human.at(-1) || null;
  const latestInbound = [...displayable].reverse().find((event) => event.direction === "contact") || null;
  const target = binding?.targetMessageId ? events.find((event) => event.id === binding.targetMessageId) || null : null;
  const targetPosition = target ? displayable.findIndex((event) => event.id === target.id) : -1;
  const hasUnverifiedInbound = events.some((event) => event.direction === "contact" && (!event.timestampVerified || event.timestampMs === null));
  const newerMessageExists = targetPosition < 0 || displayable.slice(targetPosition + 1).length > 0 || hasUnverifiedInbound;
  const uniqueEventIds = events.length > 0 && new Set(events.map((event) => event.id)).size === events.length;

  const bundleAccountMatched = Boolean(
    binding?.accountId
    && bundle?.accountScopeId === binding.accountId
    && bundle.chat?.accountScopeId === binding.accountId
    && events.every((event) => event.accountScopeId === binding.accountId),
  );
  const chatMatched = Boolean(
    binding?.chatId
    && bundle?.chat?.id === binding.chatId
    && bundle?.watermark?.chatId === binding.chatId
    && events.every((event) => event.chatId === binding.chatId),
  );
  const latestTruthMatched = Boolean(
    latestSource
    && bundle?.latestSource?.id === latestSource.id
    && (latestHuman ? bundle?.latest?.id === latestHuman.id : bundle?.latest == null),
  );
  const observedAtMs = Date.parse(String(bundle?.readiness?.observedAt || ""));
  const verifiedAtMs = Date.parse(String(bundle?.watermark?.verifiedAt || ""));
  const currentNowMs = Number(input?.nowMs);
  const timestampsCurrent = Number.isSafeInteger(currentNowMs)
    && Number.isFinite(observedAtMs)
    && Number.isFinite(verifiedAtMs)
    && observedAtMs <= currentNowMs
    && verifiedAtMs <= currentNowMs
    && currentNowMs - observedAtMs <= MAX_BRIDGE_TRUTH_AGE_MS
    && currentNowMs - verifiedAtMs <= MAX_BRIDGE_TRUTH_AGE_MS;
  const bridgeBundleCurrent = Boolean(
    bundle
    && events.length
    && uniqueEventIds
    && bundle.watermark?.state === "complete"
    && bundle.watermark?.verifiedAt
    && bundle.watermark?.newestTimestampMs === latestSource?.timestampMs
    && bundle.readiness?.currentMessage?.state === "ready"
    && bundle.readiness?.currentStory?.state === "ready"
    && bundle.readiness?.draftAllowed === true
    && timestampsCurrent
    && latestTruthMatched,
  );
  const targetCurrent = Boolean(
    target
    && target.direction === "contact"
    && target.timestampVerified
    && target.timestampMs !== null
    && latestInbound?.id === target.id
    && !newerMessageExists,
  );

  const accountMatched = Boolean(
    bundleAccountMatched
    && binding?.accountId
    && context?.scope?.accountScopeId === binding.accountId
    && identity?.accountId === binding.accountId
    && input?.connection?.accountId === binding.accountId,
  );
  const identityMatched = Boolean(
    identity?.verified === true
    && binding?.tenantId
    && identity.tenantId === binding.tenantId
    && identity.chatId === binding.chatId
    && verifiedRelationshipIdentity(bundle?.chat, identity),
  );
  const graphBindingMatched = Boolean(
    candidate
    && binding?.relationshipGraphId
    && binding?.relationshipGraphVersion
    && context?.scope?.tenantScopeId === binding.tenantId
    && context?.chat?.id === binding.chatId
    && context?.freshness?.targetMessageId === binding.targetMessageId
    && context?.graphGrounding?.tenantId === binding.tenantId
    && context?.graphGrounding?.targetRelationshipGraphId === binding.relationshipGraphId
    && context?.graphGrounding?.graphVersion === binding.relationshipGraphVersion
    && context.graphGrounding.evidence.some((item) =>
      item.messageId === binding.targetMessageId
      && item.evidenceId === context.graphGrounding.targetMessageEvidenceId)
    && candidate.evidenceIds.includes(binding.targetMessageId),
  );

  const placeholderDetected = !candidate
    || candidate.requiresUserInput !== false
    || candidate.unresolvedSlots.length > 0
    || candidate.requiredInputs.length > 0
    || unresolvedDraftPlaceholders(candidate.draft).length > 0
    || PLACEHOLDER.test(candidateText);
  const classifiable = Boolean(candidate && candidateText);
  const targetText = target?.text || "";
  const newCommitmentDetected = classifiable
    ? FIRST_PERSON_COMMITMENT.test(candidateText) || (AFFIRMATIVE_ONLY.test(candidateText) && ACTION_REQUEST.test(targetText))
    : true;
  const timeDateOrLocationPromiseDetected = classifiable
    ? TIME_DATE.test(candidateText) || LOCATION_PROMISE.test(candidateText)
    : true;
  const moneyOrPaymentDetected = classifiable ? MONEY_OR_PAYMENT.test(candidateText) : true;
  const legalMedicalOrSensitiveDetected = classifiable ? LEGAL_MEDICAL_SENSITIVE.test(candidateText) : true;

  const citedIds = new Set(candidate?.evidenceIds || []);
  const citedMedia = events.filter((event) => citedIds.has(event.id) && (event.kind !== "text" || Boolean(event.media)));
  const mediaByMessageId = new Map<string, AutoSendMediaAssessment[]>();
  for (const item of input?.mediaAssessments || []) {
    const values = mediaByMessageId.get(item.messageId) || [];
    values.push(item);
    mediaByMessageId.set(item.messageId, values);
  }
  const mediaOrOcrUncertain = !candidate || citedMedia.some((event) => {
    const assessments = mediaByMessageId.get(event.id) || [];
    return assessments.length !== 1
      || assessments[0].status !== "verified-safe"
      || assessments[0].ocrUncertain !== false
      || assessments[0].requiresUserVerification !== false;
  });

  const connectorConnected = input?.connection?.connected === true
    && input.connection.state === "current-read-only"
    && accountMatched;
  const withinUsageLimits = input?.usage?.withinLimits === true;
  const quietHoursActive = input?.quietHours?.active === false ? false : true;
  const factsComplete = Boolean(candidate && !placeholderDetected);
  const groundingPassed = Boolean(candidate && graphBindingMatched && bridgeBundleCurrent && targetCurrent);
  const chatKind = bundle?.chat?.kind === "direct" || bundle?.chat?.kind === "group" ? bundle.chat.kind : undefined;
  const nowValid = Number.isSafeInteger(input?.nowMs) && Number(input?.nowMs) >= 0;

  const safety: AutoSendSafetyContext = Object.freeze({
    authorizationEnabled: input?.authorizationEnabled === true,
    identityVerified: identityMatched,
    targetMessageId: targetCurrent ? binding?.targetMessageId : undefined,
    latestInboundMessageId: latestInbound?.id,
    newerTargetMessageExists: newerMessageExists,
    chatKind,
    timeDateOrLocationPromiseDetected,
    moneyOrPaymentDetected,
    legalMedicalOrSensitiveDetected,
    mediaOrOcrUncertain,
    factsComplete,
    newCommitmentDetected,
    groundingPassed,
    accountMatched,
    connectorConnected,
    withinUsageLimits,
    quietHoursActive,
    countdownElapsed: input?.countdownElapsed === true,
    customRuleId: OPAQUE_IDENTIFIER.test(text(input?.customRuleId)) ? digest("custom-rule", input?.customRuleId) : undefined,
    customRulePassed: input?.customRulePassed === true,
  });

  const reasons: AutoSendSafetyReason[] = [];
  if (safety.authorizationEnabled !== true) reasons.push("AUTHORIZATION_DISABLED");
  if (!nowValid) reasons.push("EVALUATION_TIME_INVALID");
  if (!bundle || !events.length) reasons.push("BRIDGE_BUNDLE_UNAVAILABLE");
  if (!bridgeBundleCurrent) reasons.push("BRIDGE_TRUTH_NOT_CURRENT");
  if (!identityMatched) reasons.push("IDENTITY_UNVERIFIED");
  if (!accountMatched) reasons.push("ACCOUNT_MISMATCH");
  if (!chatMatched) reasons.push("CHAT_MISMATCH");
  if (!target) reasons.push("TARGET_MESSAGE_MISSING");
  else if (!targetCurrent) reasons.push("TARGET_MESSAGE_STALE");
  if (newerMessageExists) reasons.push("NEWER_MESSAGE_EXISTS");
  if (!chatKind) reasons.push("CHAT_KIND_UNKNOWN");
  if (!candidate) reasons.push("DRAFT_VALIDATION_FAILED");
  if (!graphBindingMatched) reasons.push("GRAPH_BINDING_MISMATCH");
  if (placeholderDetected) reasons.push("DRAFT_HAS_PLACEHOLDERS");
  if (newCommitmentDetected) reasons.push("NEW_COMMITMENT_DETECTED");
  if (timeDateOrLocationPromiseDetected) reasons.push("TIME_DATE_LOCATION_PROMISE_DETECTED");
  if (moneyOrPaymentDetected) reasons.push("MONEY_OR_PAYMENT_DETECTED");
  if (legalMedicalOrSensitiveDetected) reasons.push("LEGAL_MEDICAL_OR_SENSITIVE_DETECTED");
  if (mediaOrOcrUncertain) reasons.push("MEDIA_OR_OCR_UNCERTAIN");
  if (!connectorConnected) reasons.push("CONNECTOR_NOT_CURRENT");
  if (!withinUsageLimits) reasons.push("USAGE_LIMIT_UNKNOWN_OR_REACHED");
  if (quietHoursActive) reasons.push("QUIET_HOURS_UNKNOWN_OR_ACTIVE");

  const safeReasons = Object.freeze(unique(reasons));
  const provenance = Object.freeze({
    evaluatedAtMs: nowValid ? Number(input?.nowMs) : 0,
    sources: Object.freeze(["bridge-bundle", "bridge-latest-truth", "validated-draft", "graph-grounding", "runtime-safety"] as const),
    bindings: Object.freeze({
      tenant: digest("tenant", binding?.tenantId),
      account: digest("account", binding?.accountId),
      chat: digest("chat", binding?.chatId),
      targetMessage: digest("target-message", binding?.targetMessageId),
      relationshipGraph: digest("relationship-graph", binding?.relationshipGraphId),
      relationshipGraphVersion: digest("relationship-graph-version", binding?.relationshipGraphVersion),
      draft: digest("draft", candidate?.draft),
    }),
    checks: Object.freeze({
      bridgeBundleCurrent,
      identityMatched,
      accountMatched,
      targetCurrent,
      graphBindingMatched,
      draftValidated: Boolean(candidate),
    }),
  });

  return Object.freeze({
    contract: AUTO_SEND_SAFETY_CONTEXT_CONTRACT,
    passed: safeReasons.length === 0,
    safety,
    reasons: safeReasons,
    provenance,
  });
}
