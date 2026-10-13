export const SENDING_MODES = ["review-only", "automatic"] as const;
export type SendingMode = typeof SENDING_MODES[number];

export type AutonomyPolicyInput = {
  defaultMode?: unknown;
  chatMode?: unknown;
  releaseCertified?: boolean;
  emergencyStop?: boolean;
  connected?: boolean;
  accountMatched?: boolean;
  currentMessageVerified?: boolean;
  currentStoryReady?: boolean;
  replyNeeded?: boolean;
  factualityPassed?: boolean;
  recipientVerified?: boolean;
  exactTargetMessageId?: string;
  candidateTargetMessageId?: string;
};

function validMode(value: unknown): value is SendingMode {
  return SENDING_MODES.includes(value as SendingMode);
}

export function evaluateAutonomyPolicy(input: AutonomyPolicyInput = {}) {
  const defaultMode: SendingMode = validMode(input.defaultMode) ? input.defaultMode : "review-only";
  const chatMode: SendingMode | "inherit" = input.chatMode === "inherit" || input.chatMode == null
    ? "inherit"
    : validMode(input.chatMode)
      ? input.chatMode
      : "review-only";
  const effectiveMode = chatMode === "inherit" ? defaultMode : chatMode;
  const blocks: string[] = [];
  if (effectiveMode !== "automatic") blocks.push("review-required");
  if (input.releaseCertified !== true) blocks.push("release-not-certified");
  if (input.emergencyStop !== false) blocks.push("emergency-stop-active");
  if (input.connected !== true) blocks.push("connector-not-live");
  if (input.accountMatched !== true) blocks.push("account-not-verified");
  if (input.currentMessageVerified !== true) blocks.push("latest-message-not-verified");
  if (input.currentStoryReady !== true) blocks.push("story-not-ready");
  if (input.replyNeeded !== true) blocks.push("reply-not-required");
  if (input.factualityPassed !== true) blocks.push("factuality-not-passed");
  if (input.recipientVerified !== true) blocks.push("recipient-not-verified");
  if (!input.exactTargetMessageId || input.exactTargetMessageId !== input.candidateTargetMessageId) blocks.push("target-changed");
  return Object.freeze({
    defaultMode,
    chatMode,
    effectiveMode,
    automaticSendAllowed: blocks.length === 0,
    blocks: Object.freeze([...new Set(blocks)]),
  });
}
