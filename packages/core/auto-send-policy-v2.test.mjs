import assert from "node:assert/strict";
import test from "node:test";
import { AUTO_SEND_MODES, evaluateAutoSendPolicy } from "./auto-send-policy.ts";

const safeContext = Object.freeze({
  authorizationEnabled: true,
  identityVerified: true,
  targetMessageId: "message-7",
  latestInboundMessageId: "message-7",
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
  customRuleId: "tenant-safe-rule-1",
  customRulePassed: true,
});
function decision(overrides = {}) {
  return evaluateAutoSendPolicy({ tenantDefault: { mode: "safe" }, safety: { ...safeContext }, ...overrides });
}

test("auto-send defaults OFF and all five configured modes are recognized", () => {
  assert.deepEqual(AUTO_SEND_MODES, ["never", "draft", "countdown", "safe", "custom"]);
  const result = evaluateAutoSendPolicy();
  assert.equal(result.tenantMode, "never");
  assert.equal(result.effectiveMode, "never");
  assert.equal(result.eligibleForAuthorization, false);
  assert.ok(result.blocks.includes("AUTO_SEND_FEATURE_DISABLED"));
  assert.ok(result.blocks.includes("AUTO_SEND_OFF"));
});

test("policy hierarchy is tenant default -> relationship -> explicit chat override", () => {
  const result = decision({
    tenantDefault: { mode: "draft" },
    relationshipPolicy: { mode: "countdown" },
    chatOverride: { mode: "custom" },
  });
  assert.equal(result.tenantMode, "draft");
  assert.equal(result.relationshipMode, "countdown");
  assert.equal(result.chatMode, "custom");
  assert.equal(result.effectiveMode, "custom");
  assert.equal(result.modeSource, "chat");
  assert.equal(result.eligibleForAuthorization, true);
});

test("an explicit chat OFF always wins over broader policy", () => {
  const result = decision({
    tenantDefault: { mode: "safe" },
    relationshipPolicy: { mode: "custom" },
    chatOverride: { mode: "never" },
  });
  assert.equal(result.effectiveMode, "never");
  assert.equal(result.modeSource, "chat");
  assert.deepEqual(result.blocks, ["AUTO_SEND_OFF"]);
});

test("draft never authorizes; countdown and custom require their explicit gates", () => {
  assert.ok(decision({ tenantDefault: { mode: "draft" } }).blocks.includes("DRAFT_ONLY"));
  assert.ok(decision({
    tenantDefault: { mode: "countdown" },
    safety: { ...safeContext, countdownElapsed: false },
  }).blocks.includes("COUNTDOWN_NOT_ELAPSED"));
  assert.ok(decision({
    tenantDefault: { mode: "custom" },
    safety: { ...safeContext, customRulePassed: false },
  }).blocks.includes("CUSTOM_RULE_NOT_SATISFIED"));
  assert.equal(decision({ tenantDefault: { mode: "countdown" } }).eligibleForAuthorization, true);
  assert.equal(decision({ tenantDefault: { mode: "custom" } }).eligibleForAuthorization, true);
});

test("invalid configuration fails closed at the layer where it appears", () => {
  const invalidTenant = decision({ tenantDefault: { mode: "surprise" } });
  assert.equal(invalidTenant.effectiveMode, "never");
  const invalidRelationship = decision({ relationshipPolicy: { mode: "surprise" } });
  assert.equal(invalidRelationship.effectiveMode, "never");
  const invalidChat = decision({ chatOverride: { mode: "surprise" } });
  assert.equal(invalidChat.effectiveMode, "never");
});

test("groups are excluded unless a policy layer explicitly allows them", () => {
  const blocked = decision({ safety: { ...safeContext, chatKind: "group" } });
  assert.ok(blocked.blocks.includes("GROUP_NOT_EXPLICITLY_ALLOWED"));
  const relationshipAllowed = decision({
    relationshipPolicy: { mode: "safe", allowGroups: true },
    safety: { ...safeContext, chatKind: "group" },
  });
  assert.equal(relationshipAllowed.groupsExplicitlyAllowed, true);
  assert.equal(relationshipAllowed.eligibleForAuthorization, true);
  const chatDenied = decision({
    relationshipPolicy: { mode: "safe", allowGroups: true },
    chatOverride: { mode: "inherit", allowGroups: false },
    safety: { ...safeContext, chatKind: "group" },
  });
  assert.ok(chatDenied.blocks.includes("GROUP_NOT_EXPLICITLY_ALLOWED"));
});

test("every hard exclusion blocks authorization in every send-capable mode", () => {
  const exclusions = [
    ["identityVerified", false, "IDENTITY_UNCERTAIN"],
    ["latestInboundMessageId", "message-8", "TARGET_MESSAGE_STALE"],
    ["newerTargetMessageExists", true, "NEWER_TARGET_MESSAGE_EXISTS"],
    ["timeDateOrLocationPromiseDetected", true, "TIME_DATE_LOCATION_PROMISE"],
    ["moneyOrPaymentDetected", true, "MONEY_OR_PAYMENT"],
    ["legalMedicalOrSensitiveDetected", true, "LEGAL_MEDICAL_OR_SENSITIVE"],
    ["mediaOrOcrUncertain", true, "MEDIA_OR_OCR_UNCERTAIN"],
    ["factsComplete", false, "MISSING_FACTS"],
    ["newCommitmentDetected", true, "NEW_COMMITMENT"],
    ["groundingPassed", false, "GROUNDING_FAILURE"],
    ["accountMatched", false, "WRONG_ACCOUNT"],
    ["connectorConnected", false, "CONNECTOR_DISCONNECTED"],
    ["withinUsageLimits", false, "USAGE_LIMIT_REACHED"],
    ["quietHoursActive", true, "QUIET_HOURS"],
  ];
  for (const mode of ["safe", "countdown", "custom"]) {
    for (const [field, value, expectedBlock] of exclusions) {
      const result = decision({ tenantDefault: { mode }, safety: { ...safeContext, [field]: value } });
      assert.equal(result.eligibleForAuthorization, false, `${mode}:${field}`);
      assert.ok(result.blocks.includes(expectedBlock), `${mode}:${field} must yield ${expectedBlock}`);
    }
  }
});

test("unknown safety state fails closed instead of treating absence as safe", () => {
  const result = evaluateAutoSendPolicy({ tenantDefault: { mode: "safe" }, safety: { authorizationEnabled: true } });
  assert.equal(result.eligibleForAuthorization, false);
  assert.ok(result.blocks.includes("IDENTITY_UNCERTAIN"));
  assert.ok(result.blocks.includes("MISSING_FACTS"));
  assert.ok(result.blocks.includes("CONNECTOR_DISCONNECTED"));
  assert.ok(result.blocks.includes("QUIET_HOURS"));
});
