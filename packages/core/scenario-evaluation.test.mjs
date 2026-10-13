import assert from "node:assert/strict";
import test from "node:test";

import {
  createScenarioRegistry,
  evaluateScenarioRelease,
  routeScenario,
} from "./scenarios.ts";

const passingEvaluation = {
  scenarioId: "request.colleague.urgent",
  fixtureId: "fixture-request-colleague-urgent-001",
  fixtureVersion: "scenario-fixtures.1",
  consented: true,
  representative: true,
  assertionsPassed: true,
  modelVersion: "model-test.1",
  promptVersion: "prompt-test.1",
  evaluatedAt: "2026-08-26T10:00:00.000Z",
  decodingTemperature: 0.42,
  metrics: {
    replyNeedCorrect: true,
    factuality: 1,
    tone: 0.82,
    language: 0.9,
    commitmentSafe: true,
    secretLeak: false,
    groupSafe: true,
  },
  failureNotes: [],
};

test("raw chats cannot be misrepresented as scenario benchmark evidence", () => {
  const matrix = createScenarioRegistry([{ id: "raw-message" }]);
  assert.equal(matrix.length, 1_500);
  assert.equal(matrix.filter((cell) => cell.covered).length, 0);
  assert.equal(matrix[0].evidenceSufficiency, "not-enough-evidence");
});

test("only consented representative passing evaluation fixtures cover a cell", () => {
  const rejected = [
    { ...passingEvaluation, fixtureId: "no-consent", consented: false },
    { ...passingEvaluation, fixtureId: "secret-leak", metrics: { ...passingEvaluation.metrics, secretLeak: true } },
    { ...passingEvaluation, fixtureId: "failed", assertionsPassed: false },
  ];
  const matrix = createScenarioRegistry([], [...rejected, passingEvaluation]);
  const cell = matrix.find(({ id }) => id === passingEvaluation.scenarioId);
  assert.equal(cell.covered, true);
  assert.equal(cell.evidenceCount, 1);
  assert.equal(cell.temperature, 0.42);
  assert.deepEqual(cell.evaluationIds, [passingEvaluation.fixtureId]);
});

test("runtime routing selects a bounded relevant neighbourhood, not all 1,500 cells", () => {
  assert.deepEqual(routeScenario({ family: "request", relationship: "colleague", mode: "urgent" }), [
    "request.colleague.urgent",
    "request.colleague.neutral",
    "request.unknown.urgent",
    "commitment.colleague.urgent",
  ]);
});

test("release assessment states exact evidence coverage without a false completion claim", () => {
  const report = evaluateScenarioRelease(createScenarioRegistry([], [passingEvaluation]));
  assert.equal(report.total, 1_500);
  assert.equal(report.covered, 1);
  assert.equal(report.releaseReady, false);
  assert.match(report.claim, /^1 of 1,500/u);
});
