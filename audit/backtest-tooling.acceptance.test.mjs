import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  contentFreeDatasetRevision,
  contentFreeCaseBinding,
  createHistoricalEvidenceIndex,
  loadContentFreeCheckpoint,
  ownerBlindArmAssignment,
  resolveAuditChatScope,
  selectFrozenItems,
  selectFrozenStratifiedCases,
  summarizeOwnerBlindedPersonalization,
  writeContentFreeCheckpoint,
} from "../scripts/backtest-tooling.mjs";

test("audit chat scope explicitly supports every connector-available chat", () => {
  assert.deepEqual(resolveAuditChatScope("all"), { mode: "all-available", maximumChats: Number.MAX_SAFE_INTEGER });
  assert.deepEqual(resolveAuditChatScope("*"), { mode: "all-available", maximumChats: Number.MAX_SAFE_INTEGER });
  assert.deepEqual(resolveAuditChatScope("150"), { mode: "bounded-sample", maximumChats: 150 });
});

function event(id, chatId, timestampMs, text = id, sequence = 0) {
  return { id, chatId, timestampMs, sequence, direction: "owner", text };
}

test("chronological evidence index excludes the held-out chat and all equal/future timestamps", () => {
  const source = [
    event("a-early", "chat-a", 100),
    event("b-early", "chat-b", 100),
    event("b-before", "chat-b", 199),
    event("b-equal", "chat-b", 200),
    event("c-future", "chat-c", 201),
  ];
  const index = createHistoricalEvidenceIndex(source);
  const selected = index.eventsStrictlyBefore(200, "chat-a");
  assert.deepEqual(selected.map((item) => item.id), ["b-early", "b-before"]);
  assert.equal(index.eventCount, source.length);
});

test("dataset revision changes on a text edit without exposing text", () => {
  const common = {
    implementationRevision: "code-revision",
    settings: { maximumCases: 20 },
    cases: [{ chat: { id: "chat-a" }, target: { id: "target", timestampMs: 100 }, actualReply: "private reply" }],
  };
  const before = contentFreeDatasetRevision({ ...common, events: [event("event", "chat-a", 50, "private alpha")] });
  const after = contentFreeDatasetRevision({ ...common, events: [event("event", "chat-a", 50, "private beta")] });
  assert.notEqual(before, after);
  assert.match(before, /^[a-f0-9]{64}$/u);
  assert.equal(before.includes("private"), false);
});

test("owner-blinded personalization gate unblinds only into content-free aggregate evidence", () => {
  const bindings = Array.from({ length: 200 }, (_, index) => ({
    caseFingerprint: `${index}`.padStart(64, "a").slice(-64),
    chatAuditId: `chat-${String(index + 1).padStart(3, "0")}`,
  }));
  // Replace the synthetic strings with valid hex-only fingerprints.
  for (let index = 0; index < bindings.length; index += 1) {
    bindings[index].caseFingerprint = index.toString(16).padStart(64, "0");
  }
  const ratings = bindings.map((binding) => {
    const assignment = ownerBlindArmAssignment(binding.caseFingerprint, "test-blind-seed");
    const personalized = { editBurden: "send-as-is", storyCorrect: true, languageRegisterCorrect: true, personSpecific: true, safe: true, generic: false };
    const baseline = { editBurden: "major-rewrite", storyCorrect: false, languageRegisterCorrect: false, personSpecific: false, safe: true, generic: true };
    return {
      ...binding,
      preferredArm: assignment.personalizedArm,
      armA: assignment.personalizedArm === "A" ? personalized : baseline,
      armB: assignment.personalizedArm === "B" ? personalized : baseline,
      raterType: "owner",
      blindingConfirmed: true,
    };
  });
  const report = summarizeOwnerBlindedPersonalization({
    ratings,
    expectedBindings: bindings,
    availableChatAuditIds: bindings.map((binding) => binding.chatAuditId),
    assignmentSeed: "test-blind-seed",
  });
  assert.equal(report.gate.status, "passed");
  assert.equal(report.metrics.personalizedPreference, 1);
  assert.equal(report.metrics.availableChatCoverage, 1);
  assert.equal(report.containsRawContent, false);
  assert.doesNotMatch(JSON.stringify(report), /caseFingerprint|chat-001|preferredArm|send-as-is/u);
});

test("owner-blinded gate blocks partial chat coverage and rejects raw or extra fields", () => {
  const binding = { caseFingerprint: "f".repeat(64), chatAuditId: "chat-001" };
  const rating = {
    ...binding,
    preferredArm: "A",
    armA: { editBurden: "light-edit", storyCorrect: true, languageRegisterCorrect: true, personSpecific: true, safe: true, generic: false },
    armB: { editBurden: "major-rewrite", storyCorrect: false, languageRegisterCorrect: false, personSpecific: false, safe: true, generic: true },
    raterType: "owner",
    blindingConfirmed: true,
  };
  const partial = summarizeOwnerBlindedPersonalization({
    ratings: [rating],
    expectedBindings: [binding],
    availableChatAuditIds: ["chat-001", "chat-002"],
    minimumRatedCases: 1,
  });
  assert.equal(partial.gate.status, "blocked");
  assert.ok(partial.gate.blockers.includes("not-every-available-chat-is-represented"));
  assert.throws(() => summarizeOwnerBlindedPersonalization({
    ratings: [{ ...rating, draft: "private message text" }],
    expectedBindings: [binding],
    availableChatAuditIds: ["chat-001"],
    minimumRatedCases: 1,
  }), /non-content-free/iu);
});

function validCheckpointRow(binding, overrides = {}) {
  return {
    ...binding,
    relationship: "colleague",
    scenarioCode: "C01.S02.T03",
    toneStage: "developing",
    intent: "statement",
    predictedAct: "information",
    actualAct: "information",
    actualActs: ["information"],
    behaviorCompatible: true,
    rawSingleReferenceIntent: true,
    answerableIntent: true,
    safeAbstention: false,
    accepted: true,
    conversationScore: 90,
    accountBaselineScore: 80,
    neutralScore: 70,
    metrics: { intent: true, language: true, brevity: true, warmth: true, formality: true, emojiBehavior: true, commitmentSafety: true, storyUnderstanding: true, crossContactLeakage: true },
    predictedMode: "English",
    actualMode: "English",
    targetMode: "English",
    languageStrategies: { incomingMirror: "English", activeDominant: "English", activeTransition: "English", globalDominant: "English", globalTransition: "English" },
    predictedLength: "short",
    actualLength: "short",
    targetLength: "short",
    lengthStrategies: { incomingMirror: "short", activeDominant: "short", activeMedian: "short", globalDominant: "short", globalMedian: "short" },
    predictedWarmth: "neutral",
    actualWarmth: "neutral",
    predictedFormality: "neutral",
    actualFormality: "neutral",
    targetFormality: "neutral",
    formalityStrategies: { incomingMirror: "neutral", activeBehavior: "neutral", globalBehavior: "neutral" },
    predictedEmoji: "none",
    actualEmoji: "none",
    dnaEvidenceTier: "active-4+",
    requiredFacts: "none",
    safeFactHandling: true,
    privateDraftFingerprint: "0".repeat(64),
    genericDraft: false,
    ...overrides,
  };
}

function validFailureRow(binding, overrides = {}) {
  return {
    caseFingerprint: binding.caseFingerprint,
    chatAuditId: binding.chatAuditId,
    relationship: "colleague",
    scenarioCode: "C01.S02.T03",
    toneStage: "developing",
    intent: "generation-error",
    errorCategory: "candidate-evaluator-rejection",
    evaluationReasons: ["missing-current-fact"],
    evaluationBlockingReasons: ["missing-current-fact"],
    evaluationCandidateShapes: ["needs-owner-fact:slot:freshness"],
    requiredFacts: "time",
    generationError: true,
    behaviorCompatible: false,
    rawSingleReferenceIntent: false,
    answerableIntent: false,
    safeAbstention: false,
    accepted: false,
    conversationScore: 0,
    accountBaselineScore: 0,
    neutralScore: 0,
    metrics: { intent: false, language: false, brevity: false, warmth: false, formality: false, emojiBehavior: false, commitmentSafety: false, storyUnderstanding: false, crossContactLeakage: false },
    safeFactHandling: false,
    ...overrides,
  };
}

test("checkpoint resumes only an exact revision and writes no raw chat content", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mycrobo-backtest-"));
  const path = join(directory, "checkpoint.json");
  try {
    const binding = { caseFingerprint: "a".repeat(64), chatAuditId: "chat-001" };
    const result = validCheckpointRow(binding);
    await writeContentFreeCheckpoint(path, "revision-a", [result], { totalCases: 1, elapsedMs: 10 }, [binding]);
    const serialized = await readFile(path, "utf8");
    assert.equal(serialized.includes("private message that must never be written"), false);
    assert.deepEqual(await loadContentFreeCheckpoint(path, "revision-a", [binding]), [result]);
    assert.deepEqual(await loadContentFreeCheckpoint(path, "revision-b", [binding]), []);
    assert.deepEqual(await loadContentFreeCheckpoint(path, "revision-a", []), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("checkpoint rejects injected fields, wrong case order, duplicates and free-form diagnostics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mycrobo-backtest-adversarial-"));
  const path = join(directory, "checkpoint.json");
  const bindings = [
    { caseFingerprint: "a".repeat(64), chatAuditId: "chat-001" },
    { caseFingerprint: "b".repeat(64), chatAuditId: "chat-002" },
  ];
  const envelope = (results) => ({ schemaVersion: 1, method: "leak-free-three-arm-conversation-wide-chronological-pre-reply-holdout", datasetRevision: "revision-a", completedCases: results.length, progress: { totalCases: 2, elapsedMs: 1 }, results });
  try {
    const attempts = [
      [{ ...validCheckpointRow(bindings[0]), rawMessage: "private message" }],
      [validCheckpointRow(bindings[1])],
      [validCheckpointRow(bindings[0]), validCheckpointRow(bindings[0])],
      [validCheckpointRow(bindings[0], { relationship: "Sakshi" })],
      [validCheckpointRow(bindings[0], { toneStage: "abcde1234f" })],
      [validCheckpointRow(bindings[0], { intent: "ABCDE1234F" })],
      [validCheckpointRow(bindings[0], { requiredFacts: "4111111111111111" })],
      [validCheckpointRow(bindings[0], { predictedAct: "AKIAIOSFODNN7EXAMPLE" })],
      [validCheckpointRow(bindings[0], { actualAct: "Sakshi" })],
      [validCheckpointRow(bindings[0], { actualActs: ["4111111111111111"] })],
      [validCheckpointRow(bindings[0], { dnaEvidenceTier: "abcde1234f" })],
      [validCheckpointRow(bindings[0], { metrics: { intent: true } })],
      [validFailureRow(bindings[0], { errorCategory: "Sakshi" })],
      [validFailureRow(bindings[0], { evaluationReasons: ["abcde1234f"] })],
      [validFailureRow(bindings[0], { evaluationBlockingReasons: ["4111111111111111"] })],
      [validFailureRow(bindings[0], { evaluationCandidateShapes: ["AKIAIOSFODNN7EXAMPLE"] })],
      [{ ...validFailureRow(bindings[0]), predictedAct: "information" }],
    ];
    for (const rows of attempts) {
      await writeFile(path, `${JSON.stringify(envelope(rows))}\n`, "utf8");
      assert.deepEqual(await loadContentFreeCheckpoint(path, "revision-a", bindings), []);
    }
    await assert.rejects(
      writeContentFreeCheckpoint(path, "revision-a", [{ ...validCheckpointRow(bindings[0]), targetText: "private" }], {}, bindings),
      /unbound or non-content-free/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("content-free case binding contains only an anonymized digest and audit ordinal", () => {
  const binding = contentFreeCaseBinding({ chat: { id: "private-chat" }, target: { id: "private-message", timestampMs: 123 }, targetIndex: 4, auditId: "chat-009" });
  assert.deepEqual(binding, { caseFingerprint: binding.caseFingerprint, chatAuditId: "chat-009" });
  assert.match(binding.caseFingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(binding).includes("private"), false);
});

function sampleCase(index) {
  const languages = ["English", "Roman Hindi", "Roman Gujarati", "Mixed"];
  const intents = ["statement", "open-question", "send-request", "greeting", "problem"];
  const depths = ["emerging", "established", "deep"];
  const relationships = ["personal", "colleague", "family", "unknown"];
  return {
    chat: { id: `chat-${index}` },
    sampleSplitKey: `person-${index}`,
    target: { id: `target-${index}`, timestampMs: 1_000 + index },
    targetIndex: index,
    actualReply: `private reply ${index}`,
    sampleTraits: {
      archiveState: index % 7 === 0 ? "archived" : "active",
      language: languages[index % languages.length],
      incomingIntent: intents[index % intents.length],
      historyDepth: depths[index % depths.length],
      relationship: relationships[index % relationships.length],
    },
  };
}

test("frozen stratification is order-independent and covers every available minority marginal", () => {
  const universe = Array.from({ length: 120 }, (_, index) => sampleCase(index));
  const forward = selectFrozenStratifiedCases(universe, { maximumCases: 40, partition: "evaluation", seed: "test-seed" });
  const reverse = selectFrozenStratifiedCases([...universe].reverse(), { maximumCases: 40, partition: "evaluation", seed: "test-seed" });
  assert.deepEqual(forward.selected.map((item) => item.target.id), reverse.selected.map((item) => item.target.id));
  for (const dimension of forward.manifest.dimensions) {
    assert.deepEqual(
      Object.keys(forward.manifest.selectedTraitCounts[dimension]).sort(),
      Object.keys(forward.manifest.eligibleTraitCounts[dimension]).sort(),
      `missing minority marginal for ${dimension}`,
    );
  }
  assert.equal(forward.manifest.containsRawContent, false);
  assert.equal(JSON.stringify(forward.manifest).includes("private reply"), false);
});

test("calibration and evaluation are person-separated and sampling is not list-tail based", () => {
  const universe = Array.from({ length: 200 }, (_, index) => sampleCase(index));
  const calibration = selectFrozenStratifiedCases(universe, { maximumCases: 200, partition: "calibration", seed: "split-seed" });
  const evaluation = selectFrozenStratifiedCases(universe, { maximumCases: 200, partition: "evaluation", seed: "split-seed" });
  const calibrationPeople = new Set(calibration.selected.map((item) => item.sampleSplitKey));
  assert.equal(evaluation.selected.some((item) => calibrationPeople.has(item.sampleSplitKey)), false);
  assert.equal(calibration.selected.length + evaluation.selected.length, universe.length);

  const frozen = selectFrozenItems(universe, { maximum: 20, seed: "chat-seed", keyOf: (item) => item.chat.id });
  assert.notDeepEqual(frozen.selected.map((item) => item.chat.id), universe.slice(-20).map((item) => item.chat.id));
  assert.deepEqual(frozen.selected.map((item) => item.chat.id),
    selectFrozenItems([...universe].reverse(), { maximum: 20, seed: "chat-seed", keyOf: (item) => item.chat.id }).selected.map((item) => item.chat.id));
});

test("a preregistered offset draws a non-overlapping window without changing contact partitioning", () => {
  const universe = Array.from({ length: 500 }, (_, index) => sampleCase(index));
  const first = selectFrozenStratifiedCases(universe, {
    maximumCases: 40,
    partition: "evaluation",
    seed: "fixed-contact-split",
    selectionSeed: "release-window",
    offsetCases: 0,
  });
  const second = selectFrozenStratifiedCases(universe, {
    maximumCases: 40,
    partition: "evaluation",
    seed: "fixed-contact-split",
    selectionSeed: "release-window",
    offsetCases: 40,
  });
  assert.equal(first.manifest.seed, second.manifest.seed);
  assert.equal(first.manifest.selectionSeed, second.manifest.selectionSeed);
  assert.equal(first.manifest.offsetCases, 0);
  assert.equal(second.manifest.offsetCases, 40);
  assert.notEqual(first.manifest.manifestHash, second.manifest.manifestHash);
  const keys = (sample) => new Set(sample.selected.map((item) => `${item.chat.id}:${item.target.id}`));
  assert.equal([...keys(first)].some((key) => keys(second).has(key)), false);
});

test("production style policy declares symmetric priors rather than evaluation-derived constants", async () => {
  const source = await readFile(new URL("../packages/core/style-policy.ts", import.meta.url), "utf8");
  assert.match(source, /calibration:\s*"hierarchical-prior-v2"/u);
  assert.match(source, /Symmetric, deliberately uninformative reliability priors/u);
  assert.doesNotMatch(source, /privacy-safe-holdout-v1|200-case privacy-safe|activeDominant:\s*0\./u);
});

test("audit runner has no newest-tail holdout selector and derives relationship only from a bounded prefix", async () => {
  const source = await readFile(new URL("../scripts/backtest-cloning.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /slice\(-maximumCases\)|return cases\.slice\(-12\)/u);
  assert.match(source, /selectFrozenStratifiedCases\(candidateCases/u);
  assert.match(source, /human\.slice\(Math\.max\(0, index - 199\), index \+ 1\)/u);
});

test("desktop launcher forwards the frozen audit partition and exact resume checkpoint", async () => {
  const source = await readFile(new URL("../desktop/electron/main.cjs", import.meta.url), "utf8");
  assert.match(source, /MYCROBO_BACKTEST_CHECKPOINT:\s*process\.env\.MYCROBO_BACKTEST_CHECKPOINT/u);
  assert.match(source, /MYCROBO_BACKTEST_RESUME:\s*process\.env\.MYCROBO_BACKTEST_RESUME/u);
  assert.match(source, /MYCROBO_BACKTEST_PARTITION:\s*process\.env\.MYCROBO_BACKTEST_PARTITION/u);
  assert.match(source, /MYCROBO_BACKTEST_SELECTION_SEED:\s*process\.env\.MYCROBO_BACKTEST_SELECTION_SEED/u);
  assert.match(source, /MYCROBO_BACKTEST_CASE_OFFSET:\s*process\.env\.MYCROBO_BACKTEST_CASE_OFFSET/u);
});
