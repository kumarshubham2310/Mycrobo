import test from "node:test";
import assert from "node:assert/strict";
import { evaluateHistoricalDraft } from "./conversation-backtest.ts";

function evaluation(overrides = {}) {
  return evaluateHistoricalDraft({
    predicted: "I will check and confirm",
    actual: "Will confirm shortly",
    targetText: "What time will you reach?",
    storyTexts: ["What time will you reach?"],
    evidenceIds: ["target"],
    storyIds: ["target"],
    requiresCurrentFact: true,
    foreignFingerprints: [],
    ...overrides,
  });
}

test("a current-fact placeholder is a safe abstention, not a reproduced answer", () => {
  const result = evaluation({ predicted: "[Add the actual time before sending]" });
  assert.equal(result.safeAbstention, true);
  assert.equal(result.answerableIntent, null);
  assert.equal(result.rawSingleReferenceIntent, false);
  assert.equal(result.metrics.commitmentSafety, true);
});

test("an answerable draft keeps strict and compatible intent measurements separate", () => {
  const result = evaluation({
    predicted: "Which time works?",
    actual: "What time?",
    targetText: "Which time should we keep?",
    requiresCurrentFact: false,
  });
  assert.equal(result.safeAbstention, false);
  assert.equal(typeof result.answerableIntent, "boolean");
  assert.equal(result.rawSingleReferenceIntent, true);
});

test("the held-out owner reply cannot authorize a specific fact missing from the story", () => {
  const result = evaluation({
    predicted: "I will reach by 7:30 pm",
    actual: "I will reach by 7:30 pm",
    targetText: "When will you reach?",
    storyTexts: ["When will you reach?"],
    requiresCurrentFact: false,
  });
  assert.equal(result.metrics.commitmentSafety, false);
});

test("a specific fact is safe only when it exists in the pre-reply story", () => {
  const result = evaluation({
    predicted: "I will reach by 7:30 pm",
    actual: "I will reach by 7:30 pm",
    targetText: "You said 7:30 pm, right?",
    storyTexts: ["You said 7:30 pm, right?"],
    requiresCurrentFact: false,
  });
  assert.equal(result.metrics.commitmentSafety, true);
});

test("a current-story reference is not misreported as a cross-contact leak when it also appeared elsewhere", () => {
  const result = evaluation({
    predicted: "Please use https://example.com/current",
    actual: "Please use https://example.com/current",
    targetText: "Use https://example.com/current",
    storyTexts: ["Use https://example.com/current"],
    requiresCurrentFact: false,
    foreignFingerprints: ["https://example.com/current"],
  });
  assert.equal(result.metrics.crossContactLeakage, true);
});

test("a foreign-only reference remains a cross-contact leak", () => {
  const result = evaluation({
    predicted: "Please use https://example.com/foreign",
    actual: "Okay",
    targetText: "Please check this",
    storyTexts: ["Please check this"],
    requiresCurrentFact: false,
    foreignFingerprints: ["https://example.com/foreign"],
  });
  assert.equal(result.metrics.crossContactLeakage, false);
});
