import assert from "node:assert/strict";
import test from "node:test";

import { buildAutoSendSafetyContext } from "./auto-send-safety-context.ts";
import { evaluateAutoSendPolicy } from "./auto-send-policy.ts";
import { buildDraftContext } from "./draft.ts";

const tenantId = "tenant-auto-safety";
const accountId = "account-auto-safety";
const chat = {
  id: "chat:auto-safety",
  accountScopeId: accountId,
  connector: "personal-pilot",
  connectorIds: ["chat:auto-safety"],
  title: "Sakshi",
  collection: "active",
  kind: "direct",
  participantIds: ["person:sakshi"],
};
const target = {
  id: "message-target",
  accountScopeId: accountId,
  chatId: chat.id,
  connectorMessageId: "message-target",
  direction: "contact",
  senderId: "person:sakshi",
  senderName: "Sakshi",
  kind: "text",
  text: "Good morning",
  timestampMs: 10_000,
  timestampVerified: true,
  sequence: 1,
};
const watermark = {
  chatId: chat.id,
  state: "complete",
  reachedBeginning: true,
  oldestTimestampMs: target.timestampMs,
  newestTimestampMs: target.timestampMs,
  messageCount: 1,
  cursor: null,
  reason: "provider-beginning-and-live-catchup-confirmed",
  verifiedAt: "2026-10-08T10:00:00.000Z",
};

function buildInput(options = {}) {
  const events = options.events || [target];
  const activeTarget = options.target || target;
  const context = options.context || buildDraftContext({
    tenantScopeId: tenantId,
    accountScopeId: accountId,
    chat: options.chat || chat,
    chatEvents: events,
    allEvents: events,
    watermark: options.watermark || watermark,
    ownerIds: ["owner"],
    expectedTargetMessageId: activeTarget.id,
    nowMs: 11_000,
    ...(options.userIntent ? { userIntent: options.userIntent } : {}),
  });
  const binding = {
    tenantId,
    accountId,
    relationshipGraphId: context.graphGrounding.targetRelationshipGraphId,
    relationshipGraphVersion: context.graphGrounding.graphVersion,
    chatId: (options.chat || chat).id,
    targetMessageId: activeTarget.id,
    ...(options.binding || {}),
  };
  return {
    nowMs: Date.parse("2026-10-08T10:00:02.000Z"),
    binding,
    bridgeBundle: {
      chat: options.chat || chat,
      events,
      watermark: options.watermark || watermark,
      latest: activeTarget.kind === "text" ? activeTarget : null,
      latestSource: events.at(-1),
      readiness: {
        currentMessage: { state: "ready", reason: "content must not escape" },
        currentStory: { state: "ready", reason: "content must not escape" },
        draftAllowed: true,
        observedAt: "2026-10-08T10:00:01.000Z",
      },
      accountScopeId: accountId,
      ...(options.bridgeBundle || {}),
    },
    draftContext: context,
    draftOutput: options.draftOutput || { draft: "Hi!", language: "English", evidenceIds: [activeTarget.id] },
    identity: {
      verified: true,
      tenantId,
      accountId,
      chatId: (options.chat || chat).id,
      relationshipIdentityId: (options.chat || chat).kind === "group" ? (options.chat || chat).id : "person:sakshi",
      ...(options.identity || {}),
    },
    connection: { connected: true, state: "current-read-only", accountId, ...(options.connection || {}) },
    usage: { withinLimits: true, ...(options.usage || {}) },
    quietHours: { active: false, ...(options.quietHours || {}) },
    mediaAssessments: options.mediaAssessments || [],
    authorizationEnabled: options.authorizationEnabled ?? true,
    countdownElapsed: true,
    customRuleId: "custom-rule-1",
    customRulePassed: true,
  };
}

test("authoritative current truth produces the complete content-free policy safety context", () => {
  const result = buildAutoSendSafetyContext(buildInput());

  assert.equal(result.contract, "mycrobo.auto-send-safety-context.1");
  assert.equal(result.passed, true);
  assert.deepEqual(result.reasons, []);
  assert.deepEqual(result.safety, {
    authorizationEnabled: true,
    identityVerified: true,
    targetMessageId: target.id,
    latestInboundMessageId: target.id,
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
    countdownElapsed: true,
    customRuleId: result.safety.customRuleId,
    customRulePassed: true,
  });
  assert.match(result.safety.customRuleId, /^sha256_[a-f\d]{64}$/u);
  assert.equal(evaluateAutoSendPolicy({ tenantDefault: { mode: "safe" }, safety: result.safety }).eligibleForAuthorization, true);
  assert.ok(Object.values(result.provenance.bindings).every((value) => /^sha256_[a-f\d]{64}$/u.test(value)));
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /Good morning|Hi!|content must not escape/iu);
});

test("unknown input fails closed without throwing and returns content-free reason codes", () => {
  const result = buildAutoSendSafetyContext(null);

  assert.equal(result.passed, false);
  assert.equal(result.safety.identityVerified, false);
  assert.equal(result.safety.newerTargetMessageExists, true);
  assert.equal(result.safety.timeDateOrLocationPromiseDetected, true);
  assert.equal(result.safety.moneyOrPaymentDetected, true);
  assert.equal(result.safety.legalMedicalOrSensitiveDetected, true);
  assert.equal(result.safety.mediaOrOcrUncertain, true);
  assert.equal(result.safety.factsComplete, false);
  assert.equal(result.safety.newCommitmentDetected, true);
  assert.equal(result.safety.groundingPassed, false);
  assert.equal(result.safety.quietHoursActive, true);
  assert.ok(result.reasons.includes("BRIDGE_BUNDLE_UNAVAILABLE"));
  assert.ok(result.reasons.includes("DRAFT_VALIDATION_FAILED"));
  assert.ok(result.reasons.includes("USAGE_LIMIT_UNKNOWN_OR_REACHED"));
  assert.equal(evaluateAutoSendPolicy({ tenantDefault: { mode: "safe" }, safety: result.safety }).eligibleForAuthorization, false);
});

test("newer bridge truth, stale reconciliation and identity or account drift are blocked", () => {
  const newer = { ...target, id: "message-newer", connectorMessageId: "message-newer", text: "New private content", timestampMs: 10_100, sequence: 2 };
  const raced = buildAutoSendSafetyContext(buildInput({ events: [target, newer], target, context: buildInput().draftContext, bridgeBundle: { latest: newer, latestSource: newer } }));
  assert.equal(raced.safety.newerTargetMessageExists, true);
  assert.ok(raced.reasons.includes("NEWER_MESSAGE_EXISTS"));
  assert.ok(raced.reasons.includes("TARGET_MESSAGE_STALE"));

  const stale = buildAutoSendSafetyContext(buildInput({ bridgeBundle: { readiness: { currentMessage: { state: "stale" }, currentStory: { state: "stale" }, draftAllowed: false, observedAt: "2026-10-08T10:00:01.000Z" } } }));
  assert.ok(stale.reasons.includes("BRIDGE_TRUTH_NOT_CURRENT"));

  const wrongIdentity = buildAutoSendSafetyContext(buildInput({ identity: { relationshipIdentityId: "person:other" } }));
  assert.equal(wrongIdentity.safety.identityVerified, false);
  assert.ok(wrongIdentity.reasons.includes("IDENTITY_UNVERIFIED"));

  const wrongAccount = buildAutoSendSafetyContext(buildInput({ connection: { accountId: "account-other" } }));
  assert.equal(wrongAccount.safety.accountMatched, false);
  assert.ok(wrongAccount.reasons.includes("ACCOUNT_MISMATCH"));
});

test("grounding and graph bindings are revalidated instead of trusting a claimed validated draft", () => {
  const input = buildInput();
  const wrongVersion = buildAutoSendSafetyContext({ ...input, binding: { ...input.binding, relationshipGraphVersion: "gv_foreign" } });
  assert.equal(wrongVersion.safety.groundingPassed, false);
  assert.ok(wrongVersion.reasons.includes("GRAPH_BINDING_MISMATCH"));

  const unsupported = buildAutoSendSafetyContext({
    ...input,
    draftOutput: { draft: "Your order ships tomorrow", language: "English", evidenceIds: [target.id], requiresUserInput: false },
  });
  assert.equal(unsupported.safety.groundingPassed, false);
  assert.ok(unsupported.reasons.includes("DRAFT_VALIDATION_FAILED"));
  assert.ok(unsupported.reasons.includes("GRAPH_BINDING_MISMATCH"));
});

test("placeholders commitments temporal or location promises money and sensitive domains are independently blocked", () => {
  const cases = [
    {
      draft: "[Confirm the status before sending]",
      reason: "DRAFT_HAS_PLACEHOLDERS",
      field: "factsComplete",
      expected: false,
    },
    {
      draft: "I will send it",
      userIntent: "I will send it",
      reason: "NEW_COMMITMENT_DETECTED",
      field: "newCommitmentDetected",
      expected: true,
    },
    {
      draft: "I will meet at Palladium tomorrow",
      userIntent: "I will meet at Palladium tomorrow",
      reason: "TIME_DATE_LOCATION_PROMISE_DETECTED",
      field: "timeDateOrLocationPromiseDetected",
      expected: true,
    },
    {
      draft: "Can you confirm the payment amount?",
      reason: "MONEY_OR_PAYMENT_DETECTED",
      field: "moneyOrPaymentDetected",
      expected: true,
    },
    {
      draft: "Can you confirm the medical prescription?",
      reason: "LEGAL_MEDICAL_OR_SENSITIVE_DETECTED",
      field: "legalMedicalOrSensitiveDetected",
      expected: true,
    },
  ];
  for (const item of cases) {
    const input = buildInput({
      ...(item.userIntent ? { userIntent: item.userIntent } : {}),
      draftOutput: { draft: item.draft, language: "English", evidenceIds: [target.id] },
    });
    const result = buildAutoSendSafetyContext(input);
    assert.equal(result.safety[item.field], item.expected, item.draft);
    assert.ok(result.reasons.includes(item.reason), item.draft);
    assert.equal(result.passed, false, item.draft);
  }
});

test("media and OCR require an explicit verified-safe assessment", () => {
  const mediaTarget = {
    ...target,
    id: "message-image",
    connectorMessageId: "message-image",
    kind: "image",
    text: "Image attachment",
    media: { category: "image", mimeType: "image/jpeg", fileName: "private.jpg", sizeBytes: 100, width: 10, height: 10, status: "ready" },
  };
  const mediaWatermark = { ...watermark, newestTimestampMs: mediaTarget.timestampMs };
  const context = buildDraftContext({
    tenantScopeId: tenantId,
    accountScopeId: accountId,
    chat,
    chatEvents: [mediaTarget],
    allEvents: [mediaTarget],
    watermark: mediaWatermark,
    ownerIds: ["owner"],
    expectedTargetMessageId: mediaTarget.id,
    nowMs: 11_000,
  });
  const base = buildInput({ events: [mediaTarget], target: mediaTarget, watermark: mediaWatermark, context, draftOutput: { draft: "What should I check in the image?", language: "English", evidenceIds: [mediaTarget.id] } });

  const missing = buildAutoSendSafetyContext(base);
  assert.equal(missing.safety.mediaOrOcrUncertain, true);
  assert.ok(missing.reasons.includes("MEDIA_OR_OCR_UNCERTAIN"));

  const verified = buildAutoSendSafetyContext({
    ...base,
    mediaAssessments: [{ messageId: mediaTarget.id, status: "verified-safe", ocrUncertain: false, requiresUserVerification: false }],
  });
  assert.equal(verified.safety.mediaOrOcrUncertain, false);
  assert.equal(verified.reasons.includes("MEDIA_OR_OCR_UNCERTAIN"), false);
  assert.doesNotMatch(JSON.stringify(verified), /private\.jpg|Image attachment/iu);
});

test("connection usage quiet hours and group kind come from explicit current authorities", () => {
  const disconnected = buildAutoSendSafetyContext(buildInput({ connection: { connected: false } }));
  assert.ok(disconnected.reasons.includes("CONNECTOR_NOT_CURRENT"));
  const limited = buildAutoSendSafetyContext(buildInput({ usage: { withinLimits: false } }));
  assert.ok(limited.reasons.includes("USAGE_LIMIT_UNKNOWN_OR_REACHED"));
  const quiet = buildAutoSendSafetyContext(buildInput({ quietHours: { active: true } }));
  assert.ok(quiet.reasons.includes("QUIET_HOURS_UNKNOWN_OR_ACTIVE"));

  const groupChat = { ...chat, id: "group:auto-safety", kind: "group", participantIds: ["person:sakshi", "person:alex"] };
  const groupTarget = { ...target, id: "group-target", connectorMessageId: "group-target", chatId: groupChat.id, mentionsOwner: true, text: "@owner please confirm", accountScopeId: accountId };
  const groupWatermark = { ...watermark, chatId: groupChat.id };
  const groupInput = buildInput({ chat: groupChat, events: [groupTarget], target: groupTarget, watermark: groupWatermark });
  const group = buildAutoSendSafetyContext(groupInput);
  assert.equal(group.safety.chatKind, "group");
  assert.equal(evaluateAutoSendPolicy({ tenantDefault: { mode: "safe" }, safety: group.safety }).blocks.includes("GROUP_NOT_EXPLICITLY_ALLOWED"), true);
});
