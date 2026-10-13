import { performance } from "node:perf_hooks";

import { classifyIncomingIntent } from "../packages/core/behavioral-dna.ts";
import { evaluateScenarioForest, predictScenarioForest, scenarioForestCoverageReport, trainScenarioForest } from "../packages/core/scenario-forest.ts";
import { inferOwnerResponseMode, inferScenarioFamilies, scenarioCode } from "../packages/core/scenarios.ts";

const episodeCount = Math.max(100, Math.min(20_000, Number(process.env.MYCROBO_FOREST_BENCHMARK_EPISODES || 7_500)));
const accountScopeId = "scenario-forest-benchmark-tenant";
const relationships = ["family", "close-friend", "friend", "colleague", "manager", "client", "vendor", "community", "acquaintance", "unknown"];
const incoming = [
  "Can you check this document?", "Any update on the work?", "What time should we meet?", "Sorry, I am running late",
  "Please send the file", "Kem cho?", "Office se nikal raha hu", "This is urgent, please call", "Thank you", "Why did this fail?",
];
const replies = [
  "Haan, check karke batata hu", "Sure yaar 😊", "I will confirm the time", "No worries, take care",
  "I will share it", "Majama 😊", "Okay, reach safely", "Calling now, this is urgent", "Anytime", "Let me verify what happened",
];
const episodes = Array.from({ length: episodeCount }, (_, index) => ({
  accountScopeId,
  personId: `person-${index % 150}`,
  relationship: relationships[index % relationships.length],
  incomingText: incoming[index % incoming.length],
  ownerReply: replies[(index * 7) % replies.length],
  timestampMs: 1_700_000_000_000 + index * 60_000,
}));
const trainingEpisodes = episodes.slice(0, Math.max(1, Math.floor(episodes.length * 0.8)));
const holdoutEpisodes = episodes.slice(trainingEpisodes.length);

const trainStart = performance.now();
const model = trainScenarioForest(trainingEpisodes, { accountScopeId, seed: 20260912, treeCount: 31, maxDepth: 6, maximumExamples: 12_000 });
const trainingMs = performance.now() - trainStart;
const queries = Array.from({ length: 1_000 }, (_, index) => ({
  accountScopeId,
  personId: `person-${index % 150}`,
  relationship: relationships[index % relationships.length],
  incomingText: incoming[(index * 3) % incoming.length],
}));
const predictStart = performance.now();
for (const query of queries) predictScenarioForest(model, query, { topK: 8 });
const predictionMs = performance.now() - predictStart;
const bytes = Buffer.byteLength(JSON.stringify(model));
const coverage = scenarioForestCoverageReport(model);
const evaluation = evaluateScenarioForest(model, holdoutEpisodes.map((episode) => {
  const family = inferScenarioFamilies(classifyIncomingIntent(episode.incomingText), episode.incomingText)[0].family;
  const mode = inferOwnerResponseMode(episode.ownerReply, family, episode.relationship);
  return {
    query: {
      accountScopeId,
      relationship: episode.relationship,
      incomingText: episode.incomingText,
    },
    expectedCode: scenarioCode(family, episode.relationship, mode),
  };
}));

process.stdout.write(`${JSON.stringify({
  episodeCount,
  featureCount: model.featureNames.length,
  treeCount: model.training.treeCount,
  observedCellCount: model.training.observedCellCount,
  unobservedCellCount: coverage.unobservedCellCount,
  observedCellRatio: coverage.observedCellRatio,
  evidenceDistribution: coverage.evidenceDistribution,
  observedAxisValues: {
    families: coverage.axes.families.filter((item) => item.observedCells > 0).length,
    relationships: coverage.axes.relationships.filter((item) => item.observedCells > 0).length,
    modes: coverage.axes.modes.filter((item) => item.observedCells > 0).length,
  },
  coverageClaim: coverage.claim,
  holdoutCases: evaluation.validCaseCount,
  holdoutRouting: {
    topKAccuracy: evaluation.topKAccuracy,
    axisAccuracy: evaluation.axisAccuracy,
    probabilityQuality: evaluation.probabilityQuality,
    claim: evaluation.claim,
  },
  trainingMs: Number(trainingMs.toFixed(2)),
  predictions: queries.length,
  predictionTotalMs: Number(predictionMs.toFixed(2)),
  predictionMeanMs: Number((predictionMs / queries.length).toFixed(4)),
  serializedModelBytes: bytes,
}, null, 2)}\n`);
