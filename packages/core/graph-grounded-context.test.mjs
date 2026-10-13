import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  GraphGroundedContextError,
  buildGraphGroundedContext,
  deriveCrossRelationshipResponsePolicy,
  validateGraphGroundedCandidate,
} from "./graph-grounded-context.ts";

function digest(prefix, value) {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 40)}`;
}

const boundary = Object.freeze({ tenantId: "tenant-a", targetRelationshipGraphId: digest("xrg", "relationship-target") });
const NOW = "2026-10-08T12:00:00.000Z";

function provenance(sourceRecordId, sourceType = "message") {
  return {
    ...boundary,
    sourceRecordId,
    sourceType,
    recordedAt: "2026-10-08T10:00:00.000Z",
    extractorVersion: "ggcp-v1",
  };
}

function targetGraph() {
  return {
    ...boundary,
    evidence: [{
      ...boundary,
      evidenceId: "evidence-location",
      kind: "message",
      content: "I am at the office",
      provenance: provenance("message-101"),
    }],
    facts: [{
      ...boundary,
      factId: "fact-current-location",
      value: "at the office",
      evidenceIds: ["evidence-location"],
      provenance: [provenance("message-101")],
      confidence: 0.98,
      status: "current",
      safeToRepeat: true,
      observedAt: "2026-10-08T10:00:00.000Z",
      validFrom: "2026-10-08T10:00:00.000Z",
      expiresAt: "2026-10-09T10:00:00.000Z",
      supersededAt: null,
      supersededByFactId: null,
    }],
  };
}

const situation = Object.freeze({
  incomingIntent: "question",
  conversationPhase: "active",
  urgencyBand: "normal",
  incomingLengthBand: "short",
  questionState: "open",
  mediaState: "none",
});

const policy = Object.freeze({
  responseAct: "answer",
  writingMode: "English",
  replyLengthBand: "short",
  emojiMode: "avoid",
  formalityBand: "neutral",
});

function fingerprint(graphId, id, overrides = {}) {
  const sourceRelationshipGraphId = graphId === boundary.targetRelationshipGraphId ? graphId : digest("xrg", graphId);
  const fingerprintId = digest("fp", id);
  return {
    ...boundary,
    sourceRelationshipGraphId,
    fingerprintId,
    situation,
    observedPolicy: policy,
    provenance: { ...provenance(digest("src", `source-${id}`), "derived-fingerprint") },
    ...overrides,
  };
}

function expectCode(fn, code) {
  assert.throws(fn, (error) => error instanceof GraphGroundedContextError && error.code === code);
}

test("builds immutable context exclusively from the target graph and preserves provenance", () => {
  const context = buildGraphGroundedContext({ boundary, targetGraph: targetGraph(), now: NOW });

  assert.equal(context.tenantId, boundary.tenantId);
  assert.equal(context.targetRelationshipGraphId, boundary.targetRelationshipGraphId);
  assert.deepEqual(context.provenance, {
    evidenceIds: ["evidence-location"],
    factIds: ["fact-current-location"],
    sourceRecordIds: ["message-101"],
  });
  assert.equal(context.facts[0].evidenceIds[0], "evidence-location");
  assert.equal(context.facts[0].confidence, 0.98);
  assert.equal(context.facts[0].status, "current");
  assert.equal(context.facts[0].safeToRepeat, true);
  assert.equal(context.facts[0].expiresAt, "2026-10-09T10:00:00.000Z");
  assert.equal(context.evidence[0].provenance.sourceRecordId, "message-101");
  assert.ok(Object.isFrozen(context));
  assert.ok(Object.isFrozen(context.facts));
  assert.ok(Object.isFrozen(context.evidence[0].provenance));
});

test("admits only current, safe, sufficiently confident, temporally valid facts", () => {
  const scenarios = [
    {
      name: "expired",
      changes: { expiresAt: "2026-10-08T11:59:59.999Z" },
    },
    {
      name: "superseded",
      changes: {
        status: "superseded",
        supersededAt: "2026-10-08T11:30:00.000Z",
        supersededByFactId: "fact-new-location",
      },
    },
    {
      name: "unsafe to repeat",
      changes: { safeToRepeat: false },
    },
    {
      name: "below the confidence floor",
      changes: { confidence: 0.799999 },
    },
    {
      name: "observed in the future",
      changes: { observedAt: "2026-10-08T12:00:00.001Z" },
    },
    {
      name: "not valid yet",
      changes: { validFrom: "2026-10-08T12:00:00.001Z" },
    },
  ];

  for (const scenario of scenarios) {
    const graph = targetGraph();
    Object.assign(graph.facts[0], scenario.changes);
    const context = buildGraphGroundedContext({ boundary, targetGraph: graph, now: NOW });
    assert.deepEqual(context.facts, [], `${scenario.name} fact entered usable context`);
    assert.deepEqual(context.provenance.factIds, [], `${scenario.name} fact entered usable provenance`);
    expectCode(
      () => validateGraphGroundedCandidate({
        boundary,
        context,
        now: NOW,
        candidate: {
          ...boundary,
          candidateId: `candidate-${scenario.name.replaceAll(" ", "-")}`,
          draft: "I am at the office",
          factsUsed: [{ ...boundary, factId: "fact-current-location" }],
          evidenceUsed: [],
        },
      }),
      "GGCP_CANDIDATE_FACT_OUTSIDE_TARGET",
    );
  }
});

test("candidate validation re-checks factual currency at validation time", () => {
  const graph = targetGraph();
  graph.facts[0].expiresAt = "2026-10-08T12:30:00.000Z";
  const context = buildGraphGroundedContext({ boundary, targetGraph: graph, now: NOW });
  assert.equal(context.facts.length, 1);

  expectCode(
    () => validateGraphGroundedCandidate({
      boundary,
      context,
      now: "2026-10-08T12:30:00.000Z",
      candidate: {
        ...boundary,
        candidateId: "candidate-after-expiry",
        draft: "I am at the office",
        factsUsed: [{ ...boundary, factId: "fact-current-location" }],
        evidenceUsed: [],
      },
    }),
    "GGCP_CANDIDATE_FACT_OUTSIDE_TARGET",
  );
});

test("requires complete fact currency metadata and evidence-matched provenance", () => {
  const missingConfidence = targetGraph();
  delete missingConfidence.facts[0].confidence;
  expectCode(
    () => buildGraphGroundedContext({ boundary, targetGraph: missingConfidence, now: NOW }),
    "GGCP_INVALID_FACT_CONFIDENCE",
  );

  const noExpiry = targetGraph();
  noExpiry.facts[0].expiresAt = null;
  expectCode(
    () => buildGraphGroundedContext({ boundary, targetGraph: noExpiry, now: NOW }),
    "GGCP_FACT_EXPIRY_REQUIRED",
  );

  const mismatchedProvenance = targetGraph();
  mismatchedProvenance.facts[0].provenance = [provenance("message-999")];
  expectCode(
    () => buildGraphGroundedContext({ boundary, targetGraph: mismatchedProvenance, now: NOW }),
    "GGCP_FACT_PROVENANCE_MISMATCH",
  );
});

test("rejects foreign-tenant and foreign-graph factual evidence", () => {
  const wrongTenant = targetGraph();
  wrongTenant.evidence[0].tenantId = "tenant-b";
  expectCode(
    () => buildGraphGroundedContext({ boundary, targetGraph: wrongTenant }),
    "GGCP_FOREIGN_TENANT",
  );

  const wrongGraph = targetGraph();
  wrongGraph.evidence[0].targetRelationshipGraphId = "relationship-foreign";
  expectCode(
    () => buildGraphGroundedContext({ boundary, targetGraph: wrongGraph }),
    "GGCP_FOREIGN_TARGET_GRAPH",
  );
});

test("rejects facts grounded by missing or foreign target-graph evidence", () => {
  const graph = targetGraph();
  graph.facts[0].evidenceIds = ["foreign-evidence"];
  expectCode(
    () => buildGraphGroundedContext({ boundary, targetGraph: graph }),
    "GGCP_FOREIGN_OR_UNKNOWN_EVIDENCE",
  );
});

test("requires the tenant and target graph boundary on nested factual paths", () => {
  const graph = targetGraph();
  delete graph.facts[0].tenantId;
  expectCode(
    () => buildGraphGroundedContext({ boundary, targetGraph: graph }),
    "GGCP_INVALID_IDENTIFIER",
  );

  const graphWithUnboundedProvenance = targetGraph();
  delete graphWithUnboundedProvenance.evidence[0].provenance.targetRelationshipGraphId;
  expectCode(
    () => buildGraphGroundedContext({ boundary, targetGraph: graphWithUnboundedProvenance }),
    "GGCP_INVALID_IDENTIFIER",
  );
});

test("cross-relationship fingerprints reject content-bearing or unknown fields", () => {
  const fingerprints = [
    fingerprint("relationship-a", "fp-a"),
    fingerprint("relationship-b", "fp-b"),
    fingerprint("relationship-c", "fp-c", { text: "private conversation content" }),
  ];
  expectCode(
    () => deriveCrossRelationshipResponsePolicy({ boundary, target: { ...boundary, situation }, fingerprints }),
    "GGCP_CONTENT_BEARING_FINGERPRINT",
  );

  const nestedContent = fingerprint("relationship-c", "fp-c", {
    situation: { ...situation, topic: "private topic" },
  });
  expectCode(
    () => deriveCrossRelationshipResponsePolicy({
      boundary,
      target: { ...boundary, situation },
      fingerprints: [fingerprint("relationship-a", "fp-a"), fingerprint("relationship-b", "fp-b"), nestedContent],
    }),
    "GGCP_CONTENT_BEARING_FINGERPRINT",
  );
});

test("cross-relationship aggregation rejects foreign tenants and the target graph as a source", () => {
  const foreignTenant = fingerprint("relationship-c", "fp-c", { tenantId: "tenant-b" });
  expectCode(
    () => deriveCrossRelationshipResponsePolicy({
      boundary,
      target: { ...boundary, situation },
      fingerprints: [fingerprint("relationship-a", "fp-a"), fingerprint("relationship-b", "fp-b"), foreignTenant],
    }),
    "GGCP_FOREIGN_TENANT",
  );

  const targetAsSource = fingerprint(boundary.targetRelationshipGraphId, "fp-target");
  expectCode(
    () => deriveCrossRelationshipResponsePolicy({
      boundary,
      target: { ...boundary, situation },
      fingerprints: [fingerprint("relationship-a", "fp-a"), fingerprint("relationship-b", "fp-b"), targetAsSource],
    }),
    "GGCP_TARGET_GRAPH_NOT_CROSS_RELATIONSHIP",
  );
});

test("requires three distinct source graphs before cross-relationship aggregation", () => {
  const fingerprints = [
    fingerprint("relationship-a", "fp-a1"),
    fingerprint("relationship-a", "fp-a2"),
    fingerprint("relationship-b", "fp-b"),
  ];
  expectCode(
    () => deriveCrossRelationshipResponsePolicy({ boundary, target: { ...boundary, situation }, fingerprints }),
    "GGCP_INSUFFICIENT_DISTINCT_GRAPHS",
  );
});

test("cross-relationship provenance accepts only fixed-format opaque digests", () => {
  const leakedGraphId = {
    ...fingerprint("relationship-a", "fp-a"),
    sourceRelationshipGraphId: "chat:alice-family-group",
  };
  expectCode(
    () => deriveCrossRelationshipResponsePolicy({
      boundary,
      target: { ...boundary, situation },
      fingerprints: [leakedGraphId, fingerprint("relationship-b", "fp-b"), fingerprint("relationship-c", "fp-c")],
    }),
    "GGCP_INVALID_CROSS_GRAPH_PROVENANCE",
  );
  const leakedSource = fingerprint("relationship-a", "fp-a", {
    provenance: provenance("message:private-chat:42", "derived-fingerprint"),
  });
  expectCode(
    () => deriveCrossRelationshipResponsePolicy({
      boundary,
      target: { ...boundary, situation },
      fingerprints: [leakedSource, fingerprint("relationship-b", "fp-b"), fingerprint("relationship-c", "fp-c")],
    }),
    "GGCP_INVALID_CROSS_GRAPH_PROVENANCE",
  );
});

test("cross-relationship similarity returns abstract policy only with graph-balanced provenance", () => {
  const alternatePolicy = {
    ...policy,
    responseAct: "clarify",
    writingMode: "Roman Hindi",
    replyLengthBand: "medium",
  };
  const result = deriveCrossRelationshipResponsePolicy({
    boundary,
    target: { ...boundary, situation },
    fingerprints: [
      fingerprint("relationship-a", "fp-a-exact"),
      fingerprint("relationship-a", "fp-a-lower", {
        situation: { ...situation, incomingIntent: "statement", questionState: "none" },
        observedPolicy: alternatePolicy,
      }),
      fingerprint("relationship-b", "fp-b"),
      fingerprint("relationship-c", "fp-c", { observedPolicy: alternatePolicy }),
    ],
  });

  assert.deepEqual(result.policy, policy);
  assert.equal(result.distinctSourceGraphCount, 3);
  assert.equal(result.provenance.sources.length, 3);
  assert.equal(result.provenance.sources.filter((source) => source.sourceRelationshipGraphId === digest("xrg", "relationship-a")).length, 1);
  assert.equal(result.provenance.sources.some((source) => source.fingerprintId === digest("fp", "fp-a-exact")), true);
  assert.deepEqual(Object.keys(result).sort(), [
    "confidence",
    "distinctSourceGraphCount",
    "policy",
    "provenance",
    "targetRelationshipGraphId",
    "tenantId",
  ]);
  assert.deepEqual(Object.keys(result.policy).sort(), [
    "emojiMode",
    "formalityBand",
    "replyLengthBand",
    "responseAct",
    "writingMode",
  ]);
  assert.equal(JSON.stringify(result).includes("private conversation"), false);
  assert.ok(result.confidence > 0 && result.confidence <= 1);
});

test("candidate validation accepts only facts and evidence resolved in the target graph", () => {
  const context = buildGraphGroundedContext({ boundary, targetGraph: targetGraph(), now: NOW });
  const candidate = {
    ...boundary,
    candidateId: "candidate-1",
    draft: "I am at the office",
    factsUsed: [{ ...boundary, factId: "fact-current-location" }],
    evidenceUsed: [{ ...boundary, evidenceId: "evidence-location" }],
  };
  const validated = validateGraphGroundedCandidate({ boundary, context, candidate, now: NOW });

  assert.deepEqual(validated.provenance.facts, [{
    factId: "fact-current-location",
    evidenceIds: ["evidence-location"],
  }]);
  assert.deepEqual(validated.provenance.evidence, [{
    evidenceId: "evidence-location",
    sourceRecordId: "message-101",
  }]);
  assert.ok(Object.isFrozen(validated));
});

test("candidate validation rejects foreign or unknown fact references", () => {
  const context = buildGraphGroundedContext({ boundary, targetGraph: targetGraph(), now: NOW });
  const baseCandidate = {
    ...boundary,
    candidateId: "candidate-1",
    draft: "A candidate",
    evidenceUsed: [],
  };
  expectCode(
    () => validateGraphGroundedCandidate({
      boundary,
      context,
      now: NOW,
      candidate: {
        ...baseCandidate,
        factsUsed: [{ tenantId: "tenant-b", targetRelationshipGraphId: boundary.targetRelationshipGraphId, factId: "fact-current-location" }],
      },
    }),
    "GGCP_FOREIGN_TENANT",
  );
  expectCode(
    () => validateGraphGroundedCandidate({
      boundary,
      context,
      now: NOW,
      candidate: { ...baseCandidate, factsUsed: [{ ...boundary, factId: "fact-from-other-graph" }] },
    }),
    "GGCP_CANDIDATE_FACT_OUTSIDE_TARGET",
  );
});

test("candidate validation re-checks nested boundaries on serialized contexts", () => {
  const context = buildGraphGroundedContext({ boundary, targetGraph: targetGraph(), now: NOW });
  const forgedContext = {
    ...context,
    facts: [{
      ...context.facts[0],
      tenantId: "tenant-b",
    }],
  };
  expectCode(
    () => validateGraphGroundedCandidate({
      boundary,
      context: forgedContext,
      now: NOW,
      candidate: {
        ...boundary,
        candidateId: "candidate-1",
        draft: "A candidate",
        factsUsed: [{ ...boundary, factId: "fact-current-location" }],
        evidenceUsed: [],
      },
    }),
    "GGCP_FOREIGN_TENANT",
  );
});
