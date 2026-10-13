import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAutonomyPolicy } from "./autonomy-policy.ts";

const passing = {
  defaultMode: "automatic",
  chatMode: "inherit",
  releaseCertified: true,
  emergencyStop: false,
  connected: true,
  accountMatched: true,
  currentMessageVerified: true,
  currentStoryReady: true,
  replyNeeded: true,
  factualityPassed: true,
  recipientVerified: true,
  exactTargetMessageId: "message-1",
  candidateTargetMessageId: "message-1",
};

test("automatic sending is disabled by default and while the release gate is closed", () => {
  const policy = evaluateAutonomyPolicy();
  assert.equal(policy.effectiveMode, "review-only");
  assert.equal(policy.automaticSendAllowed, false);
  assert.ok(policy.blocks.includes("release-not-certified"));
  assert.ok(policy.blocks.includes("emergency-stop-active"));
});

test("a per-chat review choice overrides a future automatic default", () => {
  const policy = evaluateAutonomyPolicy({ ...passing, chatMode: "review-only" });
  assert.equal(policy.effectiveMode, "review-only");
  assert.equal(policy.automaticSendAllowed, false);
  assert.ok(policy.blocks.includes("review-required"));
});

test("every safety condition must pass for an automatic action", () => {
  assert.equal(evaluateAutonomyPolicy(passing).automaticSendAllowed, true);
  assert.deepEqual(evaluateAutonomyPolicy({ ...passing, candidateTargetMessageId: "message-2" }).blocks, ["target-changed"]);
  assert.deepEqual(evaluateAutonomyPolicy({ ...passing, replyNeeded: false }).blocks, ["reply-not-required"]);
  assert.deepEqual(evaluateAutonomyPolicy({ ...passing, factualityPassed: false }).blocks, ["factuality-not-passed"]);
});

test("invalid configuration fails closed", () => {
  const policy = evaluateAutonomyPolicy({ ...passing, defaultMode: "anything", chatMode: "anything" });
  assert.equal(policy.defaultMode, "review-only");
  assert.equal(policy.chatMode, "review-only");
  assert.equal(policy.automaticSendAllowed, false);
});
