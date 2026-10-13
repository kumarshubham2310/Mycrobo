/**
 * Graph-Grounded Context Protocol (GGCP)
 *
 * This module deliberately keeps factual context and cross-relationship
 * learning on different APIs. Facts and displayable content can only enter
 * through the target relationship graph. Other relationship graphs can
 * contribute content-free behavioral fingerprints, which produce only an
 * abstract response policy.
 */

export type GraphBoundary = Readonly<{
  tenantId: string;
  targetRelationshipGraphId: string;
}>;

export type GraphProvenance = GraphBoundary & Readonly<{
  sourceRecordId: string;
  sourceType: "message" | "explicit-user-input" | "connector" | "derived-fingerprint";
  recordedAt: string;
  extractorVersion?: string;
}>;

export type TargetGraphEvidence = GraphBoundary & Readonly<{
  evidenceId: string;
  kind: "message" | "explicit-user-input" | "connector-record";
  content: string;
  provenance: GraphProvenance;
}>;

export type TargetGraphFact = GraphBoundary & Readonly<{
  factId: string;
  value: string;
  evidenceIds: readonly string[];
  provenance: readonly GraphProvenance[];
  confidence: number;
  status: "current" | "superseded";
  safeToRepeat: boolean;
  observedAt: string;
  validFrom: string;
  expiresAt: string | null;
  supersededAt: string | null;
  supersededByFactId: string | null;
}>;

export type TargetRelationshipGraph = GraphBoundary & Readonly<{
  evidence: readonly TargetGraphEvidence[];
  facts: readonly TargetGraphFact[];
}>;

export type GraphGroundedContext = GraphBoundary & Readonly<{
  evidence: readonly TargetGraphEvidence[];
  facts: readonly TargetGraphFact[];
  provenance: Readonly<{
    evidenceIds: readonly string[];
    factIds: readonly string[];
    sourceRecordIds: readonly string[];
  }>;
}>;

export type BehavioralSituationFingerprint = Readonly<{
  incomingIntent: "acknowledgement" | "answer" | "request" | "question" | "statement" | "unknown";
  conversationPhase: "opening" | "active" | "closing" | "follow-up" | "unknown";
  urgencyBand: "low" | "normal" | "high" | "unknown";
  incomingLengthBand: "very-short" | "short" | "medium" | "long";
  questionState: "none" | "open" | "resolved" | "unknown";
  mediaState: "none" | "present" | "unavailable" | "unknown";
}>;

export type AbstractResponsePolicy = Readonly<{
  responseAct: "acknowledge" | "answer" | "clarify" | "decline" | "question" | "wait";
  writingMode: "English" | "Roman Hindi" | "Roman Gujarati" | "Gujarati" | "Hindi" | "mixed" | "unknown";
  replyLengthBand: "very-short" | "short" | "medium" | "long";
  emojiMode: "avoid" | "allow" | "prefer";
  formalityBand: "casual" | "neutral" | "formal";
}>;

/**
 * A cross-relationship record has no content, text, fact, topic, entity, or
 * embedding field. Runtime validation rejects unknown fields so callers
 * cannot smuggle content through a structurally typed JavaScript object.
 */
export type CrossRelationshipBehaviorFingerprint = GraphBoundary & Readonly<{
  sourceRelationshipGraphId: string;
  fingerprintId: string;
  situation: BehavioralSituationFingerprint;
  observedPolicy: AbstractResponsePolicy;
  provenance: GraphProvenance;
}>;

export type TargetBehavioralQuery = GraphBoundary & Readonly<{
  situation: BehavioralSituationFingerprint;
}>;

export type AggregateResponsePolicy = GraphBoundary & Readonly<{
  policy: AbstractResponsePolicy;
  confidence: number;
  distinctSourceGraphCount: number;
  provenance: Readonly<{
    method: "content-free-behavioral-fingerprint-v1";
    sources: readonly Readonly<{
      sourceRelationshipGraphId: string;
      fingerprintId: string;
      sourceRecordId: string;
      similarity: number;
    }>[];
  }>;
}>;

export type CandidateFactReference = GraphBoundary & Readonly<{ factId: string }>;
export type CandidateEvidenceReference = GraphBoundary & Readonly<{ evidenceId: string }>;

export type GraphGroundedCandidate = GraphBoundary & Readonly<{
  candidateId: string;
  draft: string;
  factsUsed: readonly CandidateFactReference[];
  evidenceUsed: readonly CandidateEvidenceReference[];
}>;

export type ValidatedGraphGroundedCandidate = GraphGroundedCandidate & Readonly<{
  provenance: Readonly<{
    facts: readonly Readonly<{ factId: string; evidenceIds: readonly string[] }>[];
    evidence: readonly Readonly<{ evidenceId: string; sourceRecordId: string }>[];
  }>;
}>;

export class GraphGroundedContextError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GraphGroundedContextError";
    this.code = code;
  }
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const CROSS_GRAPH_IDENTIFIER = /^xrg_[a-f\d]{40}$/u;
const FINGERPRINT_IDENTIFIER = /^fp_[a-f\d]{40}$/u;
const SOURCE_RECORD_IDENTIFIER = /^src_[a-f\d]{40}$/u;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u;

/**
 * A derived fact below this threshold is too uncertain to support a reply.
 * The threshold is intentionally public so fact extractors and audits can use
 * the same policy rather than reproducing a magic number.
 */
export const MIN_USABLE_FACT_CONFIDENCE = 0.8;

function fail(code: string, message: string): never {
  throw new GraphGroundedContextError(code, message);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("GGCP_INVALID_RECORD", `${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(value: unknown, allowed: readonly string[], path: string, code = "GGCP_UNKNOWN_FIELD") {
  const record = asRecord(value, path);
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(record).filter((key) => !allowedKeys.has(key));
  if (unknown.length) {
    fail(code, `${path} contains forbidden or unknown fields: ${unknown.join(", ")}.`);
  }
}

function assertIdentifier(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    fail("GGCP_INVALID_IDENTIFIER", `${path} must be a non-empty opaque identifier.`);
  }
}

function assertNonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) fail("GGCP_INVALID_CONTENT", `${path} must be a non-empty string.`);
}

function assertEnum(value: unknown, allowed: readonly string[], path: string): asserts value is string {
  if (typeof value !== "string" || !allowed.includes(value)) {
    fail("GGCP_INVALID_FINGERPRINT", `${path} must be one of: ${allowed.join(", ")}.`);
  }
}

function instantMs(value: unknown, path: string, nullable = false): number | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !ISO_INSTANT.test(value) || !Number.isFinite(Date.parse(value))) {
    fail("GGCP_INVALID_FACT_TIME", `${path} must be an ISO-8601 instant with an explicit timezone.`);
  }
  return Date.parse(value);
}

function evaluationTimeMs(value: unknown): number {
  if (value === undefined) return Date.now();
  const time = value instanceof Date
    ? value.getTime()
    : typeof value === "number"
      ? value
      : typeof value === "string"
        ? Date.parse(value)
        : Number.NaN;
  if (!Number.isFinite(time)) fail("GGCP_INVALID_EVALUATION_TIME", "now must be a valid date, timestamp, or ISO-8601 instant.");
  return time;
}

function readBoundary(value: unknown, path: string): GraphBoundary {
  const record = asRecord(value, path);
  assertIdentifier(record.tenantId, `${path}.tenantId`);
  assertIdentifier(record.targetRelationshipGraphId, `${path}.targetRelationshipGraphId`);
  return {
    tenantId: record.tenantId,
    targetRelationshipGraphId: record.targetRelationshipGraphId,
  };
}

function assertSameBoundary(expected: GraphBoundary, value: unknown, path: string) {
  const actual = readBoundary(value, path);
  if (actual.tenantId !== expected.tenantId) {
    fail("GGCP_FOREIGN_TENANT", `${path} belongs to a different tenant.`);
  }
  if (actual.targetRelationshipGraphId !== expected.targetRelationshipGraphId) {
    fail("GGCP_FOREIGN_TARGET_GRAPH", `${path} belongs to a different target relationship graph.`);
  }
}

function cloneProvenance(value: unknown, boundary: GraphBoundary, path: string): GraphProvenance {
  assertExactKeys(value, ["tenantId", "targetRelationshipGraphId", "sourceRecordId", "sourceType", "recordedAt", "extractorVersion"], path);
  assertSameBoundary(boundary, value, path);
  const record = asRecord(value, path);
  assertIdentifier(record.sourceRecordId, `${path}.sourceRecordId`);
  assertEnum(record.sourceType, ["message", "explicit-user-input", "connector", "derived-fingerprint"], `${path}.sourceType`);
  assertNonEmptyString(record.recordedAt, `${path}.recordedAt`);
  if (record.extractorVersion !== undefined) assertIdentifier(record.extractorVersion, `${path}.extractorVersion`);
  return Object.freeze({
    ...boundary,
    sourceRecordId: record.sourceRecordId,
    sourceType: record.sourceType as GraphProvenance["sourceType"],
    recordedAt: record.recordedAt,
    ...(record.extractorVersion === undefined ? {} : { extractorVersion: record.extractorVersion as string }),
  });
}

/** Builds an immutable, factual context using the target graph only. */
export function buildGraphGroundedContext(input: {
  boundary: GraphBoundary;
  targetGraph: TargetRelationshipGraph;
  now?: Date | string | number;
}): GraphGroundedContext {
  const boundary = readBoundary(input?.boundary, "boundary");
  const nowMs = evaluationTimeMs(input?.now);
  assertSameBoundary(boundary, input?.targetGraph, "targetGraph");
  const graph = asRecord(input.targetGraph, "targetGraph");
  if (!Array.isArray(graph.evidence) || !Array.isArray(graph.facts)) {
    fail("GGCP_INVALID_TARGET_GRAPH", "targetGraph.evidence and targetGraph.facts must be arrays.");
  }

  const evidenceIds = new Set<string>();
  const evidence = graph.evidence.map((raw, index) => {
    const path = `targetGraph.evidence[${index}]`;
    assertExactKeys(raw, ["tenantId", "targetRelationshipGraphId", "evidenceId", "kind", "content", "provenance"], path);
    assertSameBoundary(boundary, raw, path);
    const record = asRecord(raw, path);
    assertIdentifier(record.evidenceId, `${path}.evidenceId`);
    if (evidenceIds.has(record.evidenceId)) fail("GGCP_DUPLICATE_EVIDENCE", `Duplicate evidence id: ${record.evidenceId}.`);
    evidenceIds.add(record.evidenceId);
    assertEnum(record.kind, ["message", "explicit-user-input", "connector-record"], `${path}.kind`);
    assertNonEmptyString(record.content, `${path}.content`);
    return Object.freeze({
      ...boundary,
      evidenceId: record.evidenceId,
      kind: record.kind as TargetGraphEvidence["kind"],
      content: record.content,
      provenance: cloneProvenance(record.provenance, boundary, `${path}.provenance`),
    });
  });

  const rawFactIds = new Set<string>();
  const facts = graph.facts.flatMap((raw, index) => {
    const path = `targetGraph.facts[${index}]`;
    assertExactKeys(raw, [
      "tenantId",
      "targetRelationshipGraphId",
      "factId",
      "value",
      "evidenceIds",
      "provenance",
      "confidence",
      "status",
      "safeToRepeat",
      "observedAt",
      "validFrom",
      "expiresAt",
      "supersededAt",
      "supersededByFactId",
    ], path);
    assertSameBoundary(boundary, raw, path);
    const record = asRecord(raw, path);
    assertIdentifier(record.factId, `${path}.factId`);
    if (rawFactIds.has(record.factId)) fail("GGCP_DUPLICATE_FACT", `Duplicate fact id: ${record.factId}.`);
    rawFactIds.add(record.factId);
    assertNonEmptyString(record.value, `${path}.value`);
    if (!Array.isArray(record.evidenceIds) || record.evidenceIds.length === 0) {
      fail("GGCP_UNGROUNDED_FACT", `${path} must reference at least one target-graph evidence record.`);
    }
    const supportingEvidence = [...new Set(record.evidenceIds.map((id, evidenceIndex) => {
      assertIdentifier(id, `${path}.evidenceIds[${evidenceIndex}]`);
      if (!evidenceIds.has(id)) fail("GGCP_FOREIGN_OR_UNKNOWN_EVIDENCE", `${path} references evidence outside the target graph: ${id}.`);
      return id;
    }))];
    if (!Array.isArray(record.provenance) || record.provenance.length === 0) {
      fail("GGCP_PROVENANCE_REQUIRED", `${path}.provenance must preserve at least one source.`);
    }
    const provenance = record.provenance.map((item, provenanceIndex) =>
      cloneProvenance(item, boundary, `${path}.provenance[${provenanceIndex}]`));
    const evidenceSourceIds = new Set(supportingEvidence.map((evidenceId) =>
      evidence.find((item) => item.evidenceId === evidenceId)!.provenance.sourceRecordId));
    const provenanceSourceIds = new Set(provenance.map((source) => source.sourceRecordId));
    if (evidenceSourceIds.size !== provenanceSourceIds.size
      || [...evidenceSourceIds].some((sourceRecordId) => !provenanceSourceIds.has(sourceRecordId))) {
      fail("GGCP_FACT_PROVENANCE_MISMATCH", `${path}.provenance must exactly match its supporting evidence sources.`);
    }
    if (typeof record.confidence !== "number" || !Number.isFinite(record.confidence)
      || record.confidence < 0 || record.confidence > 1) {
      fail("GGCP_INVALID_FACT_CONFIDENCE", `${path}.confidence must be a finite number from 0 to 1.`);
    }
    assertEnum(record.status, ["current", "superseded"], `${path}.status`);
    if (typeof record.safeToRepeat !== "boolean") {
      fail("GGCP_INVALID_FACT_SAFETY", `${path}.safeToRepeat must be a boolean.`);
    }
    const observedAtMs = instantMs(record.observedAt, `${path}.observedAt`)!;
    const validFromMs = instantMs(record.validFrom, `${path}.validFrom`)!;
    const expiresAtMs = instantMs(record.expiresAt, `${path}.expiresAt`, true);
    const supersededAtMs = instantMs(record.supersededAt, `${path}.supersededAt`, true);
    if (record.supersededByFactId !== null) assertIdentifier(record.supersededByFactId, `${path}.supersededByFactId`);
    if (expiresAtMs !== null && expiresAtMs <= validFromMs) {
      fail("GGCP_INVALID_FACT_LIFETIME", `${path}.expiresAt must be later than validFrom.`);
    }
    if (record.status === "current") {
      if (expiresAtMs === null) fail("GGCP_FACT_EXPIRY_REQUIRED", `${path} must expire before it can be used as a current fact.`);
      if (supersededAtMs !== null || record.supersededByFactId !== null) {
        fail("GGCP_INVALID_FACT_SUPERSESSION", `${path} is current and cannot contain supersession metadata.`);
      }
    } else {
      if (supersededAtMs === null || record.supersededByFactId === null) {
        fail("GGCP_FACT_SUPERSESSION_REQUIRED", `${path} is superseded and must identify when and by which fact.`);
      }
      if (record.supersededByFactId === record.factId) {
        fail("GGCP_INVALID_FACT_SUPERSESSION", `${path} cannot supersede itself.`);
      }
    }
    const fact = Object.freeze({
      ...boundary,
      factId: record.factId,
      value: record.value,
      evidenceIds: Object.freeze(supportingEvidence),
      provenance: Object.freeze(provenance),
      confidence: record.confidence,
      status: record.status as TargetGraphFact["status"],
      safeToRepeat: record.safeToRepeat,
      observedAt: record.observedAt as string,
      validFrom: record.validFrom as string,
      expiresAt: record.expiresAt as string | null,
      supersededAt: record.supersededAt as string | null,
      supersededByFactId: record.supersededByFactId as string | null,
    });
    const usable = fact.status === "current"
      && fact.safeToRepeat
      && fact.confidence >= MIN_USABLE_FACT_CONFIDENCE
      && observedAtMs <= nowMs
      && validFromMs <= nowMs
      && expiresAtMs !== null
      && expiresAtMs > nowMs;
    return usable ? [fact] : [];
  });

  const factIds = new Set(facts.map((fact) => fact.factId));

  const sourceRecordIds = [...new Set([
    ...evidence.map((item) => item.provenance.sourceRecordId),
    ...facts.flatMap((item) => item.provenance.map((source) => source.sourceRecordId)),
  ])];

  return Object.freeze({
    ...boundary,
    evidence: Object.freeze(evidence),
    facts: Object.freeze(facts),
    provenance: Object.freeze({
      evidenceIds: Object.freeze([...evidenceIds]),
      factIds: Object.freeze([...factIds]),
      sourceRecordIds: Object.freeze(sourceRecordIds),
    }),
  });
}

const SITUATION_KEYS = ["incomingIntent", "conversationPhase", "urgencyBand", "incomingLengthBand", "questionState", "mediaState"] as const;
const POLICY_KEYS = ["responseAct", "writingMode", "replyLengthBand", "emojiMode", "formalityBand"] as const;

function cloneSituation(value: unknown, path: string): BehavioralSituationFingerprint {
  assertExactKeys(value, SITUATION_KEYS, path, "GGCP_CONTENT_BEARING_FINGERPRINT");
  const record = asRecord(value, path);
  assertEnum(record.incomingIntent, ["acknowledgement", "answer", "request", "question", "statement", "unknown"], `${path}.incomingIntent`);
  assertEnum(record.conversationPhase, ["opening", "active", "closing", "follow-up", "unknown"], `${path}.conversationPhase`);
  assertEnum(record.urgencyBand, ["low", "normal", "high", "unknown"], `${path}.urgencyBand`);
  assertEnum(record.incomingLengthBand, ["very-short", "short", "medium", "long"], `${path}.incomingLengthBand`);
  assertEnum(record.questionState, ["none", "open", "resolved", "unknown"], `${path}.questionState`);
  assertEnum(record.mediaState, ["none", "present", "unavailable", "unknown"], `${path}.mediaState`);
  return Object.freeze(record as BehavioralSituationFingerprint);
}

function clonePolicy(value: unknown, path: string): AbstractResponsePolicy {
  assertExactKeys(value, POLICY_KEYS, path, "GGCP_CONTENT_BEARING_FINGERPRINT");
  const record = asRecord(value, path);
  assertEnum(record.responseAct, ["acknowledge", "answer", "clarify", "decline", "question", "wait"], `${path}.responseAct`);
  assertEnum(record.writingMode, ["English", "Roman Hindi", "Roman Gujarati", "Gujarati", "Hindi", "mixed", "unknown"], `${path}.writingMode`);
  assertEnum(record.replyLengthBand, ["very-short", "short", "medium", "long"], `${path}.replyLengthBand`);
  assertEnum(record.emojiMode, ["avoid", "allow", "prefer"], `${path}.emojiMode`);
  assertEnum(record.formalityBand, ["casual", "neutral", "formal"], `${path}.formalityBand`);
  return Object.freeze(record as AbstractResponsePolicy);
}

function situationSimilarity(left: BehavioralSituationFingerprint, right: BehavioralSituationFingerprint) {
  const weights: Record<keyof BehavioralSituationFingerprint, number> = {
    incomingIntent: 0.3,
    conversationPhase: 0.18,
    urgencyBand: 0.17,
    incomingLengthBand: 0.1,
    questionState: 0.2,
    mediaState: 0.05,
  };
  let score = 0;
  for (const key of SITUATION_KEYS) if (left[key] === right[key]) score += weights[key];
  return Number(score.toFixed(6));
}

function weightedMode<K extends keyof AbstractResponsePolicy>(
  values: readonly { policy: AbstractResponsePolicy; weight: number }[],
  key: K,
): AbstractResponsePolicy[K] {
  const totals = new Map<AbstractResponsePolicy[K], number>();
  for (const value of values) totals.set(value.policy[key], (totals.get(value.policy[key]) ?? 0) + value.weight);
  return [...totals.entries()]
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))[0][0];
}

/**
 * Learns only an abstract response policy. Each source graph gets one vote
 * (its closest fingerprint), preventing a large graph from dominating the
 * aggregate. At least three distinct non-target graphs are mandatory.
 */
export function deriveCrossRelationshipResponsePolicy(input: {
  boundary: GraphBoundary;
  target: TargetBehavioralQuery;
  fingerprints: readonly CrossRelationshipBehaviorFingerprint[];
}): AggregateResponsePolicy {
  const boundary = readBoundary(input?.boundary, "boundary");
  assertExactKeys(input?.target, ["tenantId", "targetRelationshipGraphId", "situation"], "target", "GGCP_CONTENT_BEARING_FINGERPRINT");
  assertSameBoundary(boundary, input?.target, "target");
  const targetRecord = asRecord(input.target, "target");
  const targetSituation = cloneSituation(targetRecord.situation, "target.situation");
  if (!Array.isArray(input?.fingerprints)) fail("GGCP_INVALID_FINGERPRINT", "fingerprints must be an array.");

  const validated = input.fingerprints.map((raw, index) => {
    const path = `fingerprints[${index}]`;
    assertExactKeys(raw, ["tenantId", "targetRelationshipGraphId", "sourceRelationshipGraphId", "fingerprintId", "situation", "observedPolicy", "provenance"], path, "GGCP_CONTENT_BEARING_FINGERPRINT");
    assertSameBoundary(boundary, raw, path);
    const record = asRecord(raw, path);
    assertIdentifier(record.sourceRelationshipGraphId, `${path}.sourceRelationshipGraphId`);
    if (!CROSS_GRAPH_IDENTIFIER.test(record.sourceRelationshipGraphId)) {
      fail("GGCP_INVALID_CROSS_GRAPH_PROVENANCE", `${path}.sourceRelationshipGraphId must be a fixed-format opaque graph digest.`);
    }
    if (record.sourceRelationshipGraphId === boundary.targetRelationshipGraphId) {
      fail("GGCP_TARGET_GRAPH_NOT_CROSS_RELATIONSHIP", `${path} must identify a non-target source graph.`);
    }
    assertIdentifier(record.fingerprintId, `${path}.fingerprintId`);
    if (!FINGERPRINT_IDENTIFIER.test(record.fingerprintId)) {
      fail("GGCP_INVALID_CROSS_GRAPH_PROVENANCE", `${path}.fingerprintId must be a fixed-format opaque fingerprint digest.`);
    }
    const situation = cloneSituation(record.situation, `${path}.situation`);
    const policy = clonePolicy(record.observedPolicy, `${path}.observedPolicy`);
    const provenance = cloneProvenance(record.provenance, boundary, `${path}.provenance`);
    if (!SOURCE_RECORD_IDENTIFIER.test(provenance.sourceRecordId)) {
      fail("GGCP_INVALID_CROSS_GRAPH_PROVENANCE", `${path}.provenance.sourceRecordId must be a fixed-format opaque source digest.`);
    }
    return {
      sourceRelationshipGraphId: record.sourceRelationshipGraphId,
      fingerprintId: record.fingerprintId,
      situation,
      policy,
      provenance,
      similarity: situationSimilarity(targetSituation, situation),
    };
  });

  const bestByGraph = new Map<string, typeof validated[number]>();
  for (const item of validated) {
    const previous = bestByGraph.get(item.sourceRelationshipGraphId);
    if (!previous || item.similarity > previous.similarity ||
      (item.similarity === previous.similarity && item.fingerprintId.localeCompare(previous.fingerprintId) < 0)) {
      bestByGraph.set(item.sourceRelationshipGraphId, item);
    }
  }
  if (bestByGraph.size < 3) {
    fail("GGCP_INSUFFICIENT_DISTINCT_GRAPHS", "Cross-relationship aggregation requires at least 3 distinct source relationship graphs.");
  }

  const sources = [...bestByGraph.values()]
    .sort((left, right) => right.similarity - left.similarity || left.sourceRelationshipGraphId.localeCompare(right.sourceRelationshipGraphId));
  const weighted = sources.map((source) => ({ policy: source.policy, weight: 0.25 + 0.75 * source.similarity }));
  const policy = Object.freeze({
    responseAct: weightedMode(weighted, "responseAct"),
    writingMode: weightedMode(weighted, "writingMode"),
    replyLengthBand: weightedMode(weighted, "replyLengthBand"),
    emojiMode: weightedMode(weighted, "emojiMode"),
    formalityBand: weightedMode(weighted, "formalityBand"),
  });
  const averageSimilarity = sources.reduce((total, source) => total + source.similarity, 0) / sources.length;
  const agreement = POLICY_KEYS.reduce((total, key) => {
    const matching = weighted.filter((item) => item.policy[key] === policy[key]).reduce((sum, item) => sum + item.weight, 0);
    const all = weighted.reduce((sum, item) => sum + item.weight, 0);
    return total + (all ? matching / all : 0);
  }, 0) / POLICY_KEYS.length;

  return Object.freeze({
    ...boundary,
    policy,
    confidence: Number((averageSimilarity * agreement).toFixed(6)),
    distinctSourceGraphCount: sources.length,
    provenance: Object.freeze({
      method: "content-free-behavioral-fingerprint-v1" as const,
      sources: Object.freeze(sources.map((source) => Object.freeze({
        sourceRelationshipGraphId: source.sourceRelationshipGraphId,
        fingerprintId: source.fingerprintId,
        sourceRecordId: source.provenance.sourceRecordId,
        similarity: source.similarity,
      }))),
    }),
  });
}

/** Validates that every factual claim used by a candidate resolves in the target graph. */
export function validateGraphGroundedCandidate(input: {
  boundary: GraphBoundary;
  context: GraphGroundedContext;
  candidate: GraphGroundedCandidate;
  now?: Date | string | number;
}): ValidatedGraphGroundedCandidate {
  const boundary = readBoundary(input?.boundary, "boundary");
  assertSameBoundary(boundary, input?.context, "context");
  assertSameBoundary(boundary, input?.candidate, "candidate");
  assertExactKeys(input?.candidate, ["tenantId", "targetRelationshipGraphId", "candidateId", "draft", "factsUsed", "evidenceUsed"], "candidate");
  const candidate = asRecord(input.candidate, "candidate");
  assertIdentifier(candidate.candidateId, "candidate.candidateId");
  assertNonEmptyString(candidate.draft, "candidate.draft");
  if (!Array.isArray(candidate.factsUsed) || !Array.isArray(candidate.evidenceUsed)) {
    fail("GGCP_INVALID_CANDIDATE", "candidate.factsUsed and candidate.evidenceUsed must be arrays.");
  }
  // Re-validate even a caller-supplied/serialized context. Type annotations do
  // not protect runtime JavaScript callers from inserting a foreign nested
  // fact into an otherwise correctly stamped context object.
  const validatedContext = buildGraphGroundedContext({ boundary, targetGraph: input.context, now: input.now });
  const facts = new Map(validatedContext.facts.map((fact) => [fact.factId, fact]));
  const evidence = new Map(validatedContext.evidence.map((item) => [item.evidenceId, item]));
  const factProvenance = candidate.factsUsed.map((raw, index) => {
    const path = `candidate.factsUsed[${index}]`;
    assertExactKeys(raw, ["tenantId", "targetRelationshipGraphId", "factId"], path);
    assertSameBoundary(boundary, raw, path);
    const reference = asRecord(raw, path);
    assertIdentifier(reference.factId, `${path}.factId`);
    const fact = facts.get(reference.factId);
    if (!fact) fail("GGCP_CANDIDATE_FACT_OUTSIDE_TARGET", `${path} does not resolve in the target relationship graph: ${reference.factId}.`);
    for (const evidenceId of fact.evidenceIds) {
      if (!evidence.has(evidenceId)) fail("GGCP_CANDIDATE_FACT_UNGROUNDED", `${path} resolves to evidence outside the target relationship graph.`);
    }
    return Object.freeze({ factId: fact.factId, evidenceIds: Object.freeze([...fact.evidenceIds]) });
  });
  const evidenceProvenance = candidate.evidenceUsed.map((raw, index) => {
    const path = `candidate.evidenceUsed[${index}]`;
    assertExactKeys(raw, ["tenantId", "targetRelationshipGraphId", "evidenceId"], path);
    assertSameBoundary(boundary, raw, path);
    const reference = asRecord(raw, path);
    assertIdentifier(reference.evidenceId, `${path}.evidenceId`);
    const item = evidence.get(reference.evidenceId);
    if (!item) fail("GGCP_CANDIDATE_EVIDENCE_OUTSIDE_TARGET", `${path} does not resolve in the target relationship graph: ${reference.evidenceId}.`);
    return Object.freeze({ evidenceId: item.evidenceId, sourceRecordId: item.provenance.sourceRecordId });
  });

  return Object.freeze({
    ...boundary,
    candidateId: candidate.candidateId,
    draft: candidate.draft,
    factsUsed: Object.freeze(candidate.factsUsed.map((item) => Object.freeze({ ...readBoundary(item, "candidate.factReference"), factId: (item as CandidateFactReference).factId }))),
    evidenceUsed: Object.freeze(candidate.evidenceUsed.map((item) => Object.freeze({ ...readBoundary(item, "candidate.evidenceReference"), evidenceId: (item as CandidateEvidenceReference).evidenceId }))),
    provenance: Object.freeze({
      facts: Object.freeze(factProvenance),
      evidence: Object.freeze(evidenceProvenance),
    }),
  });
}
