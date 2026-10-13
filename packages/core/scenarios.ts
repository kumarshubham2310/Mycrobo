import type { MessageEvent } from "./domain.ts";

export const SCENARIO_FAMILIES = [
  "acknowledgement", "answer", "clarification", "commitment", "conflict",
  "coordination", "delay", "emotion", "greeting", "information",
  "negotiation", "refusal", "request", "support", "thread-close",
] as const;

export const SCENARIO_RELATIONSHIPS = [
  "family", "close-friend", "friend", "colleague", "manager",
  "client", "vendor", "community", "acquaintance", "unknown",
] as const;

export const SCENARIO_MODES = [
  "calm", "warm", "direct", "urgent", "formal",
  "playful", "apologetic", "decisive", "supportive", "neutral",
] as const;

export type ScenarioFamily = typeof SCENARIO_FAMILIES[number];
export type ScenarioRelationship = typeof SCENARIO_RELATIONSHIPS[number];
export type ScenarioMode = typeof SCENARIO_MODES[number];

export const SCENARIO_TAXONOMY_VERSION = "scenario-taxonomy.2";

export type ScenarioEvaluation = {
  scenarioId: string;
  fixtureId: string;
  fixtureVersion: string;
  consented: boolean;
  representative: boolean;
  assertionsPassed: boolean;
  modelVersion: string;
  promptVersion: string;
  evaluatedAt: string;
  decodingTemperature: number;
  metrics: {
    replyNeedCorrect: boolean;
    factuality: number;
    tone: number;
    language: number;
    commitmentSafe: boolean;
    secretLeak: boolean;
    groupSafe: boolean;
  };
  failureNotes: string[];
};

export type ScenarioTemperature = {
  id: string;
  family: ScenarioFamily;
  relationship: ScenarioRelationship;
  mode: ScenarioMode;
  temperature: number;
  evidenceCount: number;
  evidenceSufficiency: "not-enough-evidence" | "evaluated";
  covered: boolean;
  replyPolicy: "evaluate" | "default-no-reply";
  evaluationIds: string[];
  lastEvaluatedAt: string | null;
  note: string;
};

const DEFAULT_TEMPERATURE = 0.6;

export function scenarioId(family: ScenarioFamily, relationship: ScenarioRelationship, mode: ScenarioMode) {
  return `${family}.${relationship}.${mode}`;
}

export function scenarioCode(family: ScenarioFamily, relationship: ScenarioRelationship, mode: ScenarioMode) {
  const c = SCENARIO_FAMILIES.indexOf(family) + 1;
  const s = SCENARIO_RELATIONSHIPS.indexOf(relationship) + 1;
  const t = SCENARIO_MODES.indexOf(mode) + 1;
  if (!c || !s || !t) throw new Error("Scenario code contains an unsupported dimension.");
  return `C${String(c).padStart(2, "0")}.S${String(s).padStart(2, "0")}.T${String(t).padStart(2, "0")}`;
}

function evaluationsByScenario(evaluations: ScenarioEvaluation[]) {
  const byScenario = new Map<string, ScenarioEvaluation[]>();
  for (const evaluation of evaluations) {
    const records = byScenario.get(evaluation.scenarioId) || [];
    records.push(evaluation);
    byScenario.set(evaluation.scenarioId, records);
  }
  return byScenario;
}

function validEvidence(evaluation: ScenarioEvaluation) {
  return Boolean(evaluation.fixtureId && evaluation.fixtureVersion && evaluation.modelVersion && evaluation.promptVersion)
    && Number.isFinite(Date.parse(evaluation.evaluatedAt))
    && Number.isFinite(evaluation.decodingTemperature)
    && evaluation.decodingTemperature >= 0
    && evaluation.decodingTemperature <= 1
    && evaluation.consented
    && evaluation.representative
    && evaluation.assertionsPassed
    && evaluation.metrics.replyNeedCorrect
    && evaluation.metrics.factuality >= 0.98
    && evaluation.metrics.tone >= 0.75
    && evaluation.metrics.language >= 0.9
    && evaluation.metrics.commitmentSafe
    && !evaluation.metrics.secretLeak
    && evaluation.metrics.groupSafe
    && evaluation.failureNotes.length === 0;
}

/**
 * Builds the canonical matrix. Raw WhatsApp messages are deliberately ignored:
 * a production conversation is not evidence that a benchmark cell passed.
 * Only versioned, consented evaluation records can mark a cell as covered.
 */
export function createScenarioRegistry(_events: MessageEvent[] = [], evaluations: ScenarioEvaluation[] = []): ScenarioTemperature[] {
  const byScenario = evaluationsByScenario(evaluations);
  return SCENARIO_FAMILIES.flatMap((family) => SCENARIO_RELATIONSHIPS.flatMap((relationship) => SCENARIO_MODES.map((mode) => {
    const id = scenarioId(family, relationship, mode);
    const evidence = (byScenario.get(id) || []).filter(validEvidence);
    const latest = [...evidence].sort((left, right) => right.evaluatedAt.localeCompare(left.evaluatedAt))[0] || null;
    const temperature = latest?.decodingTemperature ?? DEFAULT_TEMPERATURE;
    return {
      id,
      family,
      relationship,
      mode,
      temperature: Number(Math.max(0, Math.min(1, temperature)).toFixed(2)),
      evidenceCount: evidence.length,
      evidenceSufficiency: evidence.length ? "evaluated" as const : "not-enough-evidence" as const,
      covered: evidence.length > 0,
      replyPolicy: relationship === "community" ? "default-no-reply" as const : "evaluate" as const,
      evaluationIds: evidence.map((item) => item.fixtureId),
      lastEvaluatedAt: latest?.evaluatedAt ?? null,
      note: evidence.length
        ? `Covered by ${evidence.length} passing consented benchmark fixture${evidence.length === 1 ? "" : "s"}.`
        : "Not enough evidence; conservative model configuration only.",
    };
  })));
}

export type ScenarioRoute = {
  family: ScenarioFamily;
  relationship: ScenarioRelationship;
  mode: ScenarioMode;
};

export type ScenarioCandidate = ScenarioRoute & {
  id: string;
  code: string;
  probability: number;
};

const URGENT = /\b(?:urgent|asap|immediately|right now|abhi|jaldi|turant|priority|emergency)\b/iu;
const PLAYFUL = /\b(?:haha|hehe|lol|lmao|mazaak|masti)\b|[😂🤣😜😅]/u;
const FORMAL = /\b(?:sir|ma'am|madam|please|kindly|regards|request you)\b/iu;
const CONFLICT = /\b(?:angry|upset|disappointed|wrong|unacceptable|not fair|jhoot|gussa|naraz|naraaz)\b/iu;
const NEGOTIATION = /\b(?:price|rate|discount|budget|deal|negotiate|offer|quote|quotation)\b/iu;
const DELAY = /\b(?:late|delay|delayed|wait|waiting|stuck|traffic|time lagega)\b/iu;
const SUPPORT = /\b(?:help|support|problem|issue|not working|stuck|can't|cannot|nahi ho|nhi ho)\b/iu;
const CLARIFICATION = /\b(?:what do you mean|which one|which part|can you clarify|please clarify|did not understand|didn't understand|samajh nahi|samajh nhi|shu kehva mango cho|su kehva mango cho)\b/iu;

function normalizeScores<T extends string>(scores: Map<T, number>, limit: number) {
  const ranked = [...scores.entries()].filter(([, score]) => score > 0).sort((left, right) => right[1] - left[1]).slice(0, limit);
  const total = ranked.reduce((sum, [, score]) => sum + score, 0) || 1;
  return ranked.map(([value, score]) => ({ value, probability: Number((score / total).toFixed(4)) }));
}

/**
 * Produces a compact multi-label family posterior. Runtime computes 15 family
 * scores, not 1,500 generations. Multi-part turns therefore retain secondary
 * acts instead of being collapsed by the first matching phrase.
 */
export function inferScenarioFamilies(intent: string, text: string) {
  const value = String(text || "");
  const scores = new Map<ScenarioFamily, number>();
  const add = (family: ScenarioFamily, score: number) => scores.set(family, (scores.get(family) || 0) + score);
  const primary = inferScenarioFamily(intent, value);
  add(primary, primary === "answer" ? 0.95 : 0.55);
  if (CONFLICT.test(value)) add("conflict", 1.2);
  if (NEGOTIATION.test(value)) add("negotiation", 1.1);
  if (DELAY.test(value)) add("delay", 0.9);
  if (SUPPORT.test(value)) add("support", 0.9);
  if (/\b(?:send|share|bhej|bhejo|mokli|moklo|forward|check|review|confirm|please|pls|plz|kar|karo|kro|karjo)\b/iu.test(value)) add("request", 1.4);
  if (/\b(?:when|kab|kyare|ketla\s+vag|what\s+time|meet|mil|malishu|location|where|kahan|kidhar)\b/iu.test(value)) add("coordination", 1.4);
  if (/\b(?:thank(?:s| you)?|thx|dhanyavaad|aabhar|shukriya)\b/iu.test(value)) add("acknowledgement", 0.65);
  if (/\b(?:sorry|maaf|apolog)\b/iu.test(value)) add("emotion", 0.9);
  if (/\b(?:done|confirmed|will do|i['’]?ll|i will|kar dunga|kar dungi|kari daish)\b/iu.test(value)) add("commitment", 0.95);
  if (CLARIFICATION.test(value)) add("clarification", 1.1);
  else if (/\?\s*$/u.test(value) || /\b(?:what|why|how|which|kya|kyu|kyun|kaise|shu|kem)\b/iu.test(value)) add("clarification", 0.25);
  return normalizeScores(scores, 4).map(({ value: family, probability }) => ({ family, probability }));
}

export function inferScenarioFamily(intent: string, text: string): ScenarioFamily {
  const value = String(text || "");
  if (CONFLICT.test(value)) return "conflict";
  if (NEGOTIATION.test(value)) return "negotiation";
  if (DELAY.test(value)) return "delay";
  if (["affection", "apology", "wish"].includes(intent)) return "emotion";
  if (intent === "greeting") return "greeting";
  if (["acknowledgement", "emoji", "nothing-response", "thanks"].includes(intent)) return "acknowledgement";
  if (["action-request", "call", "check-request", "send-request", "update-request"].includes(intent)) return "request";
  if (["availability-question", "when-question", "where-question"].includes(intent)) return "coordination";
  if (["activity-question", "choice-question", "intro-question", "open-question", "why-question", "wellbeing-question"].includes(intent)) {
    return CLARIFICATION.test(value) ? "clarification" : "answer";
  }
  if (["arrival-update", "departure-update", "timed-update"].includes(intent)) return "coordination";
  if (intent === "problem" || SUPPORT.test(value)) return "support";
  if (/\b(?:no|nope|can't|cannot|won't|nahi|nhi|possible nahi|possible nhi)\b/iu.test(value)) return "refusal";
  if (/\b(?:done|confirmed|will do|i'll|i will|kar dunga|kar dungi|kari daish)\b/iu.test(value)) return "commitment";
  if (/\?\s*$/u.test(value)) return "answer";
  if (/\b(?:bye|good night|talk later|see you|chalo bye)\b/iu.test(value)) return "thread-close";
  return "information";
}

export function inferScenarioMode(text: string, family: ScenarioFamily, relationship: ScenarioRelationship): ScenarioMode {
  const value = String(text || "");
  if (URGENT.test(value)) return "urgent";
  if (/\b(?:sorry|apolog|maaf)\b/iu.test(value)) return "apologetic";
  if (PLAYFUL.test(value)) return "playful";
  if (FORMAL.test(value) || ["client", "manager", "vendor"].includes(relationship)) return "formal";
  if (["emotion", "greeting"].includes(family) || /[❤️💕🥺😘🤗]/u.test(value)) return "warm";
  if (["support", "delay"].includes(family)) return "supportive";
  if (["commitment", "refusal"].includes(family)) return "decisive";
  if (["request", "coordination", "clarification", "answer"].includes(family)) return "direct";
  if (["conflict", "negotiation"].includes(family)) return "calm";
  return "neutral";
}

/** Classifies the owner's chosen response style, never the contact's mood. */
export function inferOwnerResponseMode(ownerReply: string, family: ScenarioFamily, relationship: ScenarioRelationship): ScenarioMode {
  const value = String(ownerReply || "");
  if (URGENT.test(value)) return "urgent";
  if (/\b(?:sorry|apolog|maaf)\b/iu.test(value)) return "apologetic";
  if (PLAYFUL.test(value)) return "playful";
  if (FORMAL.test(value)) return "formal";
  if (/\b(?:take care|dhyan|hope you|don't worry|tension mat|with you)\b|[❤️💕🥺😘🤗]/iu.test(value)) return "supportive";
  if (/\b(?:calmly|no rush|take your time|when convenient|aaram se|shanti se|koi jaldi nahi)\b/iu.test(value)) return "calm";
  if (/\b(?:definitely|decided|final|yes|haan|done|confirmed|will|kar dunga|kar dungi|nahi|cannot|won't)\b/iu.test(value)) return "decisive";
  if (/\b(?:bro|bhai|yaar|dear|love|miss|welcome|anytime)\b|[😊🙂🙏]/u.test(value)) return "warm";
  if (/\b(?:neutral|no preference|without comment|information received)\b/iu.test(value)) return "neutral";
  if (/\?\s*$/u.test(value) || ["answer", "clarification", "coordination"].includes(family)) return "direct";
  if (["conflict", "negotiation"].includes(family)) return "calm";
  if (["client", "manager", "vendor"].includes(relationship) && /\b(?:please|kindly|regards|thank you)\b/iu.test(value)) return "formal";
  return "neutral";
}

export function inferScenarioPosterior(input: {
  intent: string;
  text: string;
  relationship: ScenarioRelationship;
  modeEvidence?: Partial<Record<ScenarioMode, number>>;
}) {
  const relationship = SCENARIO_RELATIONSHIPS.includes(input.relationship) ? input.relationship : "unknown";
  const families = inferScenarioFamilies(input.intent, input.text);
  const suppliedModes = new Map<ScenarioMode, number>();
  for (const mode of SCENARIO_MODES) {
    const score = Number(input.modeEvidence?.[mode] || 0);
    if (Number.isFinite(score) && score > 0) suppliedModes.set(mode, score);
  }
  if (!suppliedModes.size) {
    for (const { family, probability } of families) {
      const mode = inferScenarioMode(input.text, family, relationship);
      suppliedModes.set(mode, (suppliedModes.get(mode) || 0) + probability);
    }
  }
  if (suppliedModes.size === 1 && !suppliedModes.has("neutral")) suppliedModes.set("neutral", 0.15);
  const modes = normalizeScores(suppliedModes, 3).map(({ value: mode, probability }) => ({ mode, probability }));
  const candidates = families.flatMap(({ family, probability: familyProbability }) => modes.map(({ mode, probability: modeProbability }) => {
    const route = { family, relationship, mode };
    return { ...route, id: scenarioId(family, relationship, mode), code: scenarioCode(family, relationship, mode), probability: familyProbability * modeProbability };
  })).sort((left, right) => right.probability - left.probability).slice(0, 8);
  const total = candidates.reduce((sum, candidate) => sum + candidate.probability, 0) || 1;
  const normalized: ScenarioCandidate[] = candidates.map((candidate) => ({ ...candidate, probability: Number((candidate.probability / total).toFixed(4)) }));
  return {
    taxonomyVersion: SCENARIO_TAXONOMY_VERSION,
    primary: normalized[0],
    candidates: normalized,
    uncertainty: Number((1 - (normalized[0]?.probability || 0)).toFixed(4)),
  };
}

export function inferScenarioRoute(input: { intent: string; text: string; relationship: ScenarioRelationship }): ScenarioRoute {
  const family = inferScenarioFamily(input.intent, input.text);
  return {
    family,
    relationship: SCENARIO_RELATIONSHIPS.includes(input.relationship) ? input.relationship : "unknown",
    mode: inferScenarioMode(input.text, family, input.relationship),
  };
}

/** Selects one exact runtime cell and a small deterministic set of adjacent cells. */
export function routeScenario(input: ScenarioRoute): string[] {
  if (!SCENARIO_FAMILIES.includes(input.family)
    || !SCENARIO_RELATIONSHIPS.includes(input.relationship)
    || !SCENARIO_MODES.includes(input.mode)) {
    throw new Error("Scenario route contains an unsupported dimension.");
  }
  const routes = [scenarioId(input.family, input.relationship, input.mode)];
  if (input.mode !== "neutral") routes.push(scenarioId(input.family, input.relationship, "neutral"));
  if (input.relationship !== "unknown") routes.push(scenarioId(input.family, "unknown", input.mode));
  if (input.family === "request" || input.family === "coordination") {
    routes.push(scenarioId("commitment", input.relationship, input.mode));
  }
  return [...new Set(routes)].slice(0, 4);
}

export function evaluateScenarioRelease(matrix: ScenarioTemperature[]) {
  if (matrix.length !== 1_500 || new Set(matrix.map((cell) => cell.id)).size !== 1_500) {
    throw new Error("The scenario matrix must contain exactly 1,500 unique cells.");
  }
  const covered = matrix.filter((cell) => cell.covered).length;
  const failures = matrix.filter((cell) => cell.covered && cell.evidenceCount < 1).map((cell) => cell.id);
  return {
    total: matrix.length,
    covered,
    uncovered: matrix.length - covered,
    coverageRate: Number((covered / matrix.length).toFixed(4)),
    failures,
    releaseReady: covered === matrix.length && failures.length === 0,
    claim: covered === matrix.length
      ? "All 1,500 scenario cells have passing versioned evidence."
      : `${covered} of 1,500 scenario cells have passing versioned evidence; uncovered cells remain not enough evidence.`,
  };
}
