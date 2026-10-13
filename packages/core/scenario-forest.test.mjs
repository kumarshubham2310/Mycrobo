import assert from "node:assert/strict";
import test from "node:test";

import { classifyIncomingIntent } from "./behavioral-dna.ts";
import { assessTensorFlowViability, evaluateScenarioForest, inferReplyThermalCoordinate, predictScenarioForest, scenarioForestCoverageReport, trainScenarioForest, trainScenarioForestCached } from "./scenario-forest.ts";
import { inferOwnerResponseMode, inferScenarioFamilies, scenarioCode, SCENARIO_FAMILIES, SCENARIO_MODES, SCENARIO_RELATIONSHIPS } from "./scenarios.ts";

function episode(index, overrides = {}) {
  return {
    accountScopeId: "tenant-a",
    personId: `person-${index % 4}`,
    relationship: "friend",
    incomingText: index % 2 ? "Can you check this?" : "Any update on this?",
    ownerReply: index % 3 ? "Haan, check karke batata hu" : "Sure yaar 😊",
    timestampMs: 1_000 + index,
    ...overrides,
  };
}

test("all 1,500 C/S/T labels are reachable by observable conversation evidence", () => {
  const incomingByFamily = new Map([
    ["acknowledgement", "Thanks"],
    ["answer", "Why did this fail?"],
    ["clarification", "What do you mean?"],
    ["commitment", "I will do it"],
    ["conflict", "This is wrong and unacceptable"],
    ["coordination", "Where should we meet?"],
    ["delay", "I am running late"],
    ["emotion", "I miss you"],
    ["greeting", "Hello"],
    ["information", "The report is ready"],
    ["negotiation", "Can we discuss the price and discount?"],
    ["refusal", "No"],
    ["request", "Please send the file"],
    ["support", "I need help with this problem"],
    ["thread-close", "Bye, talk later"],
  ]);
  const replyByMode = new Map([
    ["calm", "No rush, take your time"],
    ["warm", "Sure yaar 😊"],
    ["direct", "What exactly is required?"],
    ["urgent", "This is urgent, do it right now"],
    ["formal", "Kindly review this. Regards"],
    ["playful", "Haha 😂"],
    ["apologetic", "Sorry, maaf karna"],
    ["decisive", "Confirmed. I will do it"],
    ["supportive", "Don't worry, take care"],
    ["neutral", "Information received"],
  ]);
  const examples = [];
  let timestampMs = 1_000;
  for (const family of SCENARIO_FAMILIES) {
    for (const relationship of SCENARIO_RELATIONSHIPS) {
      for (const mode of SCENARIO_MODES) {
        examples.push({
          accountScopeId: "all-cells-tenant",
          relationship,
          incomingText: incomingByFamily.get(family),
          ownerReply: replyByMode.get(mode),
          timestampMs: timestampMs++,
        });
      }
    }
  }
  const model = trainScenarioForest(examples, { accountScopeId: "all-cells-tenant", seed: 1500, treeCount: 3, maxDepth: 1, minLeaf: 1, maximumExamples: 2_000 });
  assert.equal(examples.length, 1_500);
  assert.equal(model.training.observedCellCount, 1_500);
  assert.equal(model.training.absentCellCount, 0);
  assert.equal(model.training.cellCoverage, 1);
  assert.ok(model.observedCounts.every((count) => count === 1));
  const coverage = scenarioForestCoverageReport(model);
  assert.equal(coverage.totalCellCount, 1_500);
  assert.equal(coverage.observedCellCount, 1_500);
  assert.equal(coverage.allCellsObserved, true);
  assert.equal(coverage.axes.families.length, 15);
  assert.equal(coverage.axes.relationships.length, 10);
  assert.equal(coverage.axes.modes.length, 10);
  assert.ok(coverage.axes.families.every((item) => item.observedCells === 100));
  assert.ok(coverage.axes.relationships.every((item) => item.observedCells === 150));
  assert.ok(coverage.axes.modes.every((item) => item.observedCells === 150));
  assert.match(coverage.claim, /observation alone does not certify accuracy/iu);
});

test("coverage report makes sparse evidence and sufficiency visible without private text", () => {
  const model = trainScenarioForest([episode(0), episode(1), episode(2)], { accountScopeId: "tenant-a", seed: 120, treeCount: 3 });
  const report = scenarioForestCoverageReport(model);
  assert.equal(report.totalCellCount, 1_500);
  assert.ok(report.observedCellCount < report.totalCellCount);
  assert.equal(report.allCellsObserved, false);
  assert.equal(report.evidenceDistribution.minimum, 0);
  assert.equal(report.evidenceDistribution.cellsWithAtLeast10, 0);
  assert.doesNotMatch(JSON.stringify(report), /Can you check|Sure yaar|person-/iu);
});

test("forest holdout evaluation returns calibration and axis metrics without source content", () => {
  const privateMarker = "PRIVATE-MARKER-DO-NOT-REPORT";
  const examples = Array.from({ length: 120 }, (_, index) => episode(index, {
    incomingText: index % 2 ? `Can you check this ${privateMarker}?` : `Any update ${privateMarker}?`,
    ownerReply: index % 3 ? "Haan, check karke batata hu" : "Sure yaar 😊",
  }));
  const model = trainScenarioForest(examples, { accountScopeId: "tenant-a", seed: 771, treeCount: 21, maxDepth: 5 });
  const cases = examples.slice(0, 30).map((item) => {
    const family = inferScenarioFamilies(classifyIncomingIntent(item.incomingText), item.incomingText)[0].family;
    const mode = inferOwnerResponseMode(item.ownerReply, family, item.relationship);
    return {
      query: { accountScopeId: item.accountScopeId, relationship: item.relationship, incomingText: item.incomingText },
      expectedCode: scenarioCode(family, item.relationship, mode),
    };
  });
  cases.push({ query: { accountScopeId: "tenant-a", relationship: "friend", incomingText: privateMarker }, expectedCode: "invalid" });
  const report = evaluateScenarioForest(model, cases);
  assert.equal(report.caseCount, 31);
  assert.equal(report.validCaseCount, 30);
  assert.equal(report.invalidExpectedCodes, 1);
  assert.equal(report.probabilityQuality.bins.length, 10);
  assert.ok(report.topKAccuracy.top8 >= report.topKAccuracy.top1);
  assert.ok(report.axisAccuracy.relationship >= 0 && report.axisAccuracy.relationship <= 1);
  assert.equal(report.containsRawContent, false);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE-MARKER|check this|Any update/iu);
});

test("seeded forest training and prediction are deterministic", () => {
  const examples = Array.from({ length: 40 }, (_, index) => episode(index));
  const options = { accountScopeId: "tenant-a", seed: 9001, treeCount: 11, maxDepth: 4 };
  const first = trainScenarioForest(examples, options);
  const second = trainScenarioForest([...examples].reverse(), options);
  assert.deepEqual(first, second);
  const query = { accountScopeId: "tenant-a", personId: "person-1", relationship: "friend", incomingText: "Could you check and update me?" };
  assert.deepEqual(predictScenarioForest(first, query), predictScenarioForest(second, query));
});

test("top-k is normalized while preserving its absolute retained mass", () => {
  const model = trainScenarioForest(Array.from({ length: 32 }, (_, index) => episode(index)), { accountScopeId: "tenant-a", seed: 7, treeCount: 9 });
  const prediction = predictScenarioForest(model, { accountScopeId: "tenant-a", relationship: "friend", incomingText: "Any update?" }, { topK: 7 });
  assert.equal(prediction.topCells.length, 7);
  assert.ok(Math.abs(prediction.topCells.reduce((sum, item) => sum + item.probability, 0) - 1) < 0.00001);
  assert.ok(Math.abs(prediction.topCells.reduce((sum, item) => sum + item.absoluteProbability, 0) - prediction.retainedProbabilityMass) < 0.00001);
  assert.equal(prediction.fullDistributionSize, 1500);
  assert.ok(prediction.uncertainty >= 0 && prediction.uncertainty <= 1);
  assert.ok(prediction.normalizedEntropy >= 0 && prediction.normalizedEntropy <= 1);
});

test("ambiguous owner behaviour preserves multiple thermal hotspots", () => {
  const examples = Array.from({ length: 80 }, (_, index) => episode(index, {
    personId: "same-person",
    incomingText: "Can you look at this?",
    ownerReply: index % 2 ? "Sure yaar 😊" : "This is urgent, need it now!",
  }));
  const model = trainScenarioForest(examples, { accountScopeId: "tenant-a", seed: 22, treeCount: 21, maxDepth: 3 });
  const prediction = predictScenarioForest(model, { accountScopeId: "tenant-a", personId: "same-person", relationship: "friend", incomingText: "Can you look at this?" }, { topK: 10 });
  assert.ok(prediction.topCells.some((item) => item.mode === "warm"));
  assert.ok(prediction.topCells.some((item) => item.mode === "urgent"));
  assert.ok(prediction.thermal.hotspots.length >= 2);
  assert.equal(prediction.thermal.multimodal, true);
  assert.ok(prediction.thermal.spread.arousal > 0);
  assert.equal(prediction.thermal.mixture.method, "weighted-diagonal-gmm");
  assert.ok(prediction.thermal.mixture.selectedComponents >= 2);
  assert.ok(Math.abs(prediction.thermal.mixture.components.reduce((sum, item) => sum + item.weight, 0) - 1) < 0.00001);
});

test("the forest learns different scenario modes from the actual preceding story", () => {
  const examples = Array.from({ length: 120 }, (_, index) => {
    const urgentStory = index % 2 === 0;
    return episode(index, {
      personId: "story-sensitive-person",
      incomingText: "Can you check this?",
      storyText: urgentStory
        ? ["This has failed again", "The client is angry and needs it urgently now"]
        : ["No rush on this", "Whenever convenient, we can discuss it calmly"],
      ownerReply: urgentStory ? "This is urgent, need it now!" : "Okay yaar 😊",
    });
  });
  const model = trainScenarioForest(examples, {
    accountScopeId: "tenant-a",
    seed: 441,
    treeCount: 41,
    maxDepth: 5,
    minLeaf: 2,
    featureSubset: 138,
    priorStrength: 2,
  });
  const urgent = predictScenarioForest(model, {
    accountScopeId: "tenant-a",
    personId: "story-sensitive-person",
    relationship: "friend",
    incomingText: "Can you check this?",
    storyText: ["This has failed again", "The client is angry and needs it urgently now"],
  }, { topK: 12, priorStrength: 2 });
  const calm = predictScenarioForest(model, {
    accountScopeId: "tenant-a",
    personId: "story-sensitive-person",
    relationship: "friend",
    incomingText: "Can you check this?",
    storyText: ["No rush on this", "Whenever convenient, we can discuss it calmly"],
  }, { topK: 12, priorStrength: 2 });

  assert.equal(urgent.topCells[0].mode, "urgent");
  assert.equal(calm.topCells[0].mode, "warm");
  assert.ok(urgent.topCells[0].absoluteProbability > calm.topCells.find((cell) => cell.mode === "urgent").absoluteProbability);
  assert.ok(calm.topCells[0].absoluteProbability > urgent.topCells.find((cell) => cell.mode === "warm").absoluteProbability);
  assert.notDeepEqual(urgent.topCells.map((cell) => [cell.code, cell.absoluteProbability]), calm.topCells.map((cell) => [cell.code, cell.absoluteProbability]));
  assert.ok([...urgent.featureContributions, ...calm.featureContributions].some((item) => item.feature.startsWith("story_")));
});

test("thermal coordinates are learned from calming owner replies in conflict", () => {
  const observed = inferReplyThermalCoordinate("Let's discuss this calmly, no need to rush.");
  assert.ok(observed.arousal < 0.2);
  assert.ok(observed.valence >= 0);
  const examples = Array.from({ length: 80 }, (_, index) => episode(index, {
    personId: "calm-owner",
    relationship: "colleague",
    incomingText: "This is unacceptable and completely wrong",
    storyText: ["The delivery failed", "They are frustrated and blaming our team"],
    ownerReply: "Let's discuss this calmly, no need to rush.",
  }));
  const model = trainScenarioForest(examples, { accountScopeId: "tenant-a", seed: 81, treeCount: 21, priorStrength: 2 });
  const prediction = predictScenarioForest(model, {
    accountScopeId: "tenant-a",
    personId: "calm-owner",
    relationship: "colleague",
    incomingText: "This is unacceptable and completely wrong",
    storyText: ["The delivery failed", "They are frustrated and blaming our team"],
  }, { topK: 8, priorStrength: 2 });
  const conflictCalm = prediction.topCells.find((cell) => cell.family === "conflict" && cell.mode === "calm");
  assert.ok(conflictCalm);
  assert.ok(conflictCalm.trained);
  assert.ok(conflictCalm.thermal.arousal < 0.2, `expected learned calming arousal, received ${conflictCalm.thermal.arousal}`);
  assert.ok(model.training.thermalObservedCellCount >= 1);
});

test("sparse evidence is smoothed without claiming absent cells were trained", () => {
  const model = trainScenarioForest([episode(0)], { accountScopeId: "tenant-a", seed: 3, treeCount: 5, maximumExamples: 20 });
  assert.equal(model.training.observedCellCount, 1);
  assert.equal(model.training.absentCellCount, 1499);
  const prediction = predictScenarioForest(model, { accountScopeId: "tenant-a", relationship: "unknown", incomingText: "Please share an update" }, { topK: 25 });
  assert.ok(prediction.topCells.some((item) => item.trained));
  assert.ok(prediction.topCells.some((item) => !item.trained && item.evidenceStatus === "hierarchical-prior-only"));
  assert.ok(prediction.uncertainty > 0.5);
  assert.equal(prediction.thermal.mixture.selectedComponents, 1);
});

test("tenant boundaries are enforced for both training and prediction", () => {
  assert.throws(() => trainScenarioForest([episode(0), episode(1, { accountScopeId: "tenant-b" })], { accountScopeId: "tenant-a" }), /account boundary/iu);
  const model = trainScenarioForest([episode(0)], { accountScopeId: "tenant-a", seed: 1, treeCount: 3 });
  assert.throws(() => predictScenarioForest(model, { accountScopeId: "tenant-b", relationship: "friend", incomingText: "Hello" }), /account boundary/iu);
});

test("unrelated person identifiers cannot change a forest prediction", () => {
  const examples = Array.from({ length: 64 }, (_, index) => episode(index, {
    personId: `training-person-${index % 19}`,
    storyText: index % 2 ? ["The client asked for an urgent update"] : ["There is no rush"],
  }));
  const model = trainScenarioForest(examples, { accountScopeId: "tenant-a", seed: 71, treeCount: 17, maxDepth: 5 });
  assert.equal(model.featureNames.some((name) => name.startsWith("person_bucket:")), false);
  const query = {
    accountScopeId: "tenant-a",
    relationship: "friend",
    incomingText: "Could you check and update me?",
    storyText: ["The client asked for an urgent update"],
  };
  const reference = predictScenarioForest(model, { ...query, personId: "unrelated-person-alpha" });
  for (let index = 0; index < 64; index += 1) {
    assert.deepEqual(predictScenarioForest(model, { ...query, personId: `unrelated-person-${index}` }), reference);
  }
});

test("an account-wide relationship majority cannot override the known query relationship", () => {
  const managerEpisodes = Array.from({ length: 120 }, (_, index) => episode(index, {
    relationship: "manager",
    incomingText: "Please share the status update",
    ownerReply: "Certainly, I will share the verified status.",
  }));
  const friendEpisodes = Array.from({ length: 3 }, (_, index) => episode(1_000 + index, {
    relationship: "friend",
    incomingText: "Any update bhai?",
    ownerReply: "Haan bhai, check karke batata hu",
  }));
  const model = trainScenarioForest([...managerEpisodes, ...friendEpisodes], {
    accountScopeId: "tenant-a",
    seed: 991,
    treeCount: 21,
    maxDepth: 5,
    priorStrength: 12,
  });
  const prediction = predictScenarioForest(model, {
    accountScopeId: "tenant-a",
    relationship: "friend",
    incomingText: "Any update bhai?",
  }, { topK: 20 });
  assert.ok(prediction.topCells.length > 1);
  assert.ok(prediction.topCells.every((cell) => cell.relationship === "friend"));
  assert.ok(Math.abs(prediction.topCells.reduce((sum, cell) => sum + cell.probability, 0) - 1) < 0.00001);
});

test("the tenant forest cache is reused only for an identical collision-resistant history revision", () => {
  const examples = Array.from({ length: 20 }, (_, index) => episode(index));
  const options = { accountScopeId: "tenant-cache-proof", seed: 99, treeCount: 5 };
  const scoped = examples.map((value) => ({ ...value, accountScopeId: options.accountScopeId }));
  const first = trainScenarioForestCached(scoped, options);
  const reused = trainScenarioForestCached(scoped.map((value) => ({ ...value })), options);
  const changed = trainScenarioForestCached(scoped.map((value, index) => index === 7 ? { ...value, ownerReply: `${value.ownerReply} changed` } : value), options);
  assert.equal(reused, first);
  assert.notEqual(changed, first);
});

test("model and audit output never retain or reveal source text", () => {
  const secret = "unique-private-phrase-ALPHA-92741";
  const storySecret = "private-prior-story-BRAVO-61823";
  const model = trainScenarioForest([episode(0, { incomingText: `Can you check ${secret}?`, storyText: [storySecret], ownerReply: `Sure ${secret}` })], { accountScopeId: "tenant-a", seed: 4, treeCount: 3 });
  const prediction = predictScenarioForest(model, { accountScopeId: "tenant-a", relationship: "friend", incomingText: secret });
  const serialized = JSON.stringify({ model, prediction });
  assert.doesNotMatch(serialized, /unique-private-phrase|ALPHA-92741|private-prior-story|BRAVO-61823/iu);
  assert.ok(prediction.treeVotes.length > 0);
  assert.ok(prediction.featureContributions.every((item) => model.featureNames.includes(item.feature)));
});

test("TensorFlow remains out until an empirical benefit pays for its costs", () => {
  const assessment = assessTensorFlowViability();
  assert.equal(assessment.recommended, false);
  assert.ok(assessment.reasons.length >= 3);
  assert.ok(assessment.reconsiderWhen.length >= 3);
});
