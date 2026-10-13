export const AUTO_SEND_MODES = ["never", "draft", "countdown", "safe", "custom"] as const;
export type AutoSendMode = typeof AUTO_SEND_MODES[number];

export const AUTO_SEND_POLICY_VERSION = "auto-send-policy.1" as const;

export type AutoSendPolicyLayer = {
  mode?: AutoSendMode | "inherit" | unknown;
  allowGroups?: boolean;
};

export type AutoSendSafetyContext = {
  authorizationEnabled?: boolean;
  identityVerified?: boolean;
  targetMessageId?: string;
  latestInboundMessageId?: string;
  newerTargetMessageExists?: boolean;
  chatKind?: "direct" | "group";
  timeDateOrLocationPromiseDetected?: boolean;
  moneyOrPaymentDetected?: boolean;
  legalMedicalOrSensitiveDetected?: boolean;
  mediaOrOcrUncertain?: boolean;
  factsComplete?: boolean;
  newCommitmentDetected?: boolean;
  groundingPassed?: boolean;
  accountMatched?: boolean;
  connectorConnected?: boolean;
  withinUsageLimits?: boolean;
  quietHoursActive?: boolean;
  countdownElapsed?: boolean;
  customRuleId?: string;
  customRulePassed?: boolean;
};

export type AutoSendPolicyInput = {
  tenantDefault?: AutoSendPolicyLayer;
  relationshipPolicy?: AutoSendPolicyLayer | null;
  chatOverride?: AutoSendPolicyLayer | null;
  safety?: AutoSendSafetyContext;
};

export type AutoSendBlock =
  | "AUTO_SEND_FEATURE_DISABLED"
  | "AUTO_SEND_OFF"
  | "DRAFT_ONLY"
  | "COUNTDOWN_NOT_ELAPSED"
  | "CUSTOM_RULE_NOT_SATISFIED"
  | "IDENTITY_UNCERTAIN"
  | "TARGET_MESSAGE_MISSING"
  | "TARGET_MESSAGE_STALE"
  | "NEWER_TARGET_MESSAGE_EXISTS"
  | "GROUP_NOT_EXPLICITLY_ALLOWED"
  | "TIME_DATE_LOCATION_PROMISE"
  | "MONEY_OR_PAYMENT"
  | "LEGAL_MEDICAL_OR_SENSITIVE"
  | "MEDIA_OR_OCR_UNCERTAIN"
  | "MISSING_FACTS"
  | "NEW_COMMITMENT"
  | "GROUNDING_FAILURE"
  | "WRONG_ACCOUNT"
  | "CONNECTOR_DISCONNECTED"
  | "USAGE_LIMIT_REACHED"
  | "QUIET_HOURS";

export type AutoSendPolicyDecision = Readonly<{
  policyVersion: typeof AUTO_SEND_POLICY_VERSION;
  tenantMode: AutoSendMode;
  relationshipMode: AutoSendMode | "inherit";
  chatMode: AutoSendMode | "inherit";
  effectiveMode: AutoSendMode;
  modeSource: "tenant" | "relationship" | "chat";
  groupsExplicitlyAllowed: boolean;
  eligibleForAuthorization: boolean;
  blocks: readonly AutoSendBlock[];
}>;

function validMode(value: unknown): value is AutoSendMode {
  return AUTO_SEND_MODES.includes(value as AutoSendMode);
}

function layerMode(layer: AutoSendPolicyLayer | null | undefined, invalidFallback: AutoSendMode | "inherit") {
  if (layer?.mode == null || layer.mode === "inherit") return "inherit" as const;
  return validMode(layer.mode) ? layer.mode : invalidFallback;
}

function explicitGroupSetting(...layers: Array<AutoSendPolicyLayer | null | undefined>) {
  for (const layer of [...layers].reverse()) {
    if (typeof layer?.allowGroups === "boolean") return layer.allowGroups;
  }
  return false;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

/**
 * Resolves tenant -> relationship -> chat policy and applies non-overridable
 * safety exclusions. This function only determines whether a short-lived
 * authorization may be minted; it never sends or queues a message.
 */
export function evaluateAutoSendPolicy(input: AutoSendPolicyInput = {}): AutoSendPolicyDecision {
  const tenantMode = validMode(input.tenantDefault?.mode) ? input.tenantDefault.mode : "never";
  const relationshipMode = layerMode(input.relationshipPolicy, "never");
  const chatMode = layerMode(input.chatOverride, "never");

  let effectiveMode: AutoSendMode = tenantMode;
  let modeSource: AutoSendPolicyDecision["modeSource"] = "tenant";
  if (relationshipMode !== "inherit") {
    effectiveMode = relationshipMode;
    modeSource = "relationship";
  }
  if (chatMode !== "inherit") {
    effectiveMode = chatMode;
    modeSource = "chat";
  }

  const groupsExplicitlyAllowed = explicitGroupSetting(input.tenantDefault, input.relationshipPolicy, input.chatOverride);
  const safety = input.safety ?? {};
  const blocks: AutoSendBlock[] = [];

  // Authorization itself is separately feature-gated and defaults off.
  if (safety.authorizationEnabled !== true) blocks.push("AUTO_SEND_FEATURE_DISABLED");

  if (effectiveMode === "never") blocks.push("AUTO_SEND_OFF");
  if (effectiveMode === "draft") blocks.push("DRAFT_ONLY");
  if (effectiveMode === "countdown" && safety.countdownElapsed !== true) blocks.push("COUNTDOWN_NOT_ELAPSED");
  if (effectiveMode === "custom" && (!safety.customRuleId || safety.customRulePassed !== true)) {
    blocks.push("CUSTOM_RULE_NOT_SATISFIED");
  }

  if (safety.identityVerified !== true) blocks.push("IDENTITY_UNCERTAIN");
  if (!safety.targetMessageId || !safety.latestInboundMessageId) blocks.push("TARGET_MESSAGE_MISSING");
  else if (safety.targetMessageId !== safety.latestInboundMessageId) blocks.push("TARGET_MESSAGE_STALE");
  if (safety.newerTargetMessageExists !== false) blocks.push("NEWER_TARGET_MESSAGE_EXISTS");
  if (safety.chatKind === "group" && !groupsExplicitlyAllowed) blocks.push("GROUP_NOT_EXPLICITLY_ALLOWED");
  if (safety.chatKind !== "direct" && safety.chatKind !== "group") blocks.push("IDENTITY_UNCERTAIN");
  if (safety.timeDateOrLocationPromiseDetected !== false) blocks.push("TIME_DATE_LOCATION_PROMISE");
  if (safety.moneyOrPaymentDetected !== false) blocks.push("MONEY_OR_PAYMENT");
  if (safety.legalMedicalOrSensitiveDetected !== false) blocks.push("LEGAL_MEDICAL_OR_SENSITIVE");
  if (safety.mediaOrOcrUncertain !== false) blocks.push("MEDIA_OR_OCR_UNCERTAIN");
  if (safety.factsComplete !== true) blocks.push("MISSING_FACTS");
  if (safety.newCommitmentDetected !== false) blocks.push("NEW_COMMITMENT");
  if (safety.groundingPassed !== true) blocks.push("GROUNDING_FAILURE");
  if (safety.accountMatched !== true) blocks.push("WRONG_ACCOUNT");
  if (safety.connectorConnected !== true) blocks.push("CONNECTOR_DISCONNECTED");
  if (safety.withinUsageLimits !== true) blocks.push("USAGE_LIMIT_REACHED");
  if (safety.quietHoursActive !== false) blocks.push("QUIET_HOURS");

  const uniqueBlocks = Object.freeze(unique(blocks));
  return Object.freeze({
    policyVersion: AUTO_SEND_POLICY_VERSION,
    tenantMode,
    relationshipMode,
    chatMode,
    effectiveMode,
    modeSource,
    groupsExplicitlyAllowed,
    eligibleForAuthorization: uniqueBlocks.length === 0,
    blocks: uniqueBlocks,
  });
}
