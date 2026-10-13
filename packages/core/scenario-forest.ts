import { createHash } from "node:crypto";

import { classifyIncomingIntent } from "./behavioral-dna.ts";
import { detectWritingMode } from "./relationship.ts";
import {
  inferOwnerResponseMode,
  inferScenarioFamilies,
  scenarioCode,
  SCENARIO_FAMILIES,
  SCENARIO_MODES,
  SCENARIO_RELATIONSHIPS,
  SCENARIO_TAXONOMY_VERSION,
  type ScenarioFamily,
  type ScenarioMode,
  type ScenarioRelationship,
} from "./scenarios.ts";

export type ScenarioForestTrainingEpisode = {
  accountScopeId: string;
  personId?: string;
  relationship: ScenarioRelationship;
  incomingText: string;
  /** Strictly preceding turns, never the held-out owner reply. */
  storyText?: string[];
  ownerReply: string;
  timestampMs?: number;
  weight?: number;
};

export type ScenarioForestQuery = {
  accountScopeId: string;
  /** Accepted for API compatibility; identity is handled outside the forest. */
  personId?: string;
  relationship?: ScenarioRelationship;
  incomingText: string;
  /** Optional preceding story, used as bounded aggregate features only. */
  storyText?: string[];
};

export type ThermalCoordinate = {
  valence: number;
  arousal: number;
  formality: number;
};

type TrainingRow = {
  features: number[];
  label: number;
  thermal: ThermalCoordinate;
  weight: number;
  timestampMs: number;
  fingerprint: number;
};

type TreeNode = {
  sampleWeight: number;
  counts: Array<[number, number]>;
  featureIndex?: number;
  threshold?: number;
  left?: TreeNode;
  right?: TreeNode;
};

export type ScenarioForestModel = {
  version: 1;
  taxonomyVersion: string;
  accountScopeId: string;
  seed: number;
  featureNames: string[];
  cells: string[];
  trees: TreeNode[];
  observedCounts: number[];
  prior: number[];
  /** Content-free, owner-reply-derived thermal aggregates by scenario cell. */
  learnedThermal: Array<{
    evidenceWeight: number;
    centroid: ThermalCoordinate;
  }>;
  training: {
    suppliedEpisodes: number;
    retainedEpisodes: number;
    observedCellCount: number;
    absentCellCount: number;
    cellCoverage: number;
    treeCount: number;
    maxDepth: number;
    maximumExamples: number;
    bounded: true;
    thermalObservedCellCount: number;
  };
};

export type ScenarioCellProbability = {
  code: string;
  family: ScenarioFamily;
  relationship: ScenarioRelationship;
  mode: ScenarioMode;
  probability: number;
  absoluteProbability: number;
  evidenceCount: number;
  trained: boolean;
  evidenceStatus: "observed-training-cell" | "hierarchical-prior-only";
  thermal: ThermalCoordinate;
};

export type ScenarioForestPrediction = {
  version: 1;
  taxonomyVersion: string;
  topCells: ScenarioCellProbability[];
  retainedProbabilityMass: number;
  fullDistributionSize: 1_500;
  entropy: number;
  normalizedEntropy: number;
  uncertainty: number;
  calibration: {
    method: "random-forest-leaf-posterior-plus-hierarchical-dirichlet";
    meanLeafEvidence: number;
    priorStrength: number;
  };
  thermal: {
    centroid: ThermalCoordinate;
    spread: ThermalCoordinate;
    hotspots: Array<{
      probabilityMass: number;
      relativeMass: number;
      centroid: ThermalCoordinate;
      dominantCells: string[];
    }>;
    multimodal: boolean;
    mixture: {
      method: "weighted-diagonal-gmm";
      selectedComponents: number;
      effectiveSamples: number;
      bic: number;
      components: Array<{
        weight: number;
        centroid: ThermalCoordinate;
        spread: ThermalCoordinate;
      }>;
    };
  };
  treeVotes: Array<{
    tree: number;
    code: string;
    confidence: number;
    leafEvidence: number;
    pathDepth: number;
  }>;
  featureContributions: Array<{
    feature: string;
    contribution: number;
    absoluteContribution: number;
  }>;
};

export type ScenarioForestCoverageReport = {
  taxonomyVersion: string;
  totalCellCount: 1_500;
  observedCellCount: number;
  unobservedCellCount: number;
  observedCellRatio: number;
  allCellsObserved: boolean;
  evidenceDistribution: {
    minimum: number;
    median: number;
    p90: number;
    maximum: number;
    cellsWithAtLeast3: number;
    cellsWithAtLeast10: number;
  };
  axes: {
    families: Array<{ value: ScenarioFamily; observedCells: number; totalCells: 100; evidenceWeight: number }>;
    relationships: Array<{ value: ScenarioRelationship; observedCells: number; totalCells: 150; evidenceWeight: number }>;
    modes: Array<{ value: ScenarioMode; observedCells: number; totalCells: 150; evidenceWeight: number }>;
  };
  claim: string;
};

export type ScenarioForestEvaluationReport = {
  taxonomyVersion: string;
  caseCount: number;
  validCaseCount: number;
  invalidExpectedCodes: number;
  topKAccuracy: { top1: number; top3: number; top8: number; top25: number };
  axisAccuracy: { family: number; relationship: number; mode: number };
  probabilityQuality: {
    meanExpectedCellProbability: number;
    clippedNegativeLogLikelihood: number;
    top1ExpectedCalibrationError: number;
    bins: Array<{ lower: number; upper: number; cases: number; meanConfidence: number; accuracy: number }>;
  };
  observedExpectedCells: number;
  priorOnlyExpectedCells: number;
  containsRawContent: false;
  claim: string;
};

const ALL_CELLS = SCENARIO_FAMILIES.flatMap((family) => SCENARIO_RELATIONSHIPS.flatMap((relationship) => SCENARIO_MODES.map((mode) => ({
  code: scenarioCode(family, relationship, mode),
  family,
  relationship,
  mode,
}))));
const CELL_INDEX = new Map(ALL_CELLS.map((cell, index) => [cell.code, index]));
const MAX_TREES = 63;
const MAX_EXAMPLES = 20_000;
const MAX_TENANT_FOREST_MODELS = 4;
const forestModelCache = new Map<string, { revision: string; model: ScenarioForestModel }>();

function collisionResistantRevision(parts: Iterable<string>) {
  const hash = createHash("sha256");
  for (const part of parts) {
    const value = String(part || "");
    hash.update(String(Buffer.byteLength(value, "utf8")));
    hash.update(":");
    hash.update(value);
    hash.update(";");
  }
  return hash.digest("hex");
}

const TEXT_FEATURES = [
  "log_characters", "log_words", "log_lines", "question_marks", "exclamation_marks", "emoji_count",
  "digit_ratio", "uppercase_ratio", "contains_url", "contains_attachment", "contains_time", "contains_date",
  "contains_amount", "question_signal", "request_signal", "negative_signal", "apology_signal", "urgency_signal",
  "warmth_signal", "formal_signal", "casual_signal", "commitment_signal",
  "story_turns", "story_log_characters", "story_question_signal", "story_request_signal", "story_negative_signal",
  "story_urgency_signal", "story_warmth_signal", "story_formal_signal", "story_casual_signal", "story_commitment_signal",
  "story_conflict_signal", "story_resolution_signal",
];
const LANGUAGE_NAMES = ["English", "Roman Hindi", "Roman Gujarati", "Hindi", "Gujarati", "Mixed", "Unknown"];
const INTENT_NAMES = [
  "acknowledgement", "activity-question", "affection", "apology", "arrival-update", "availability-question",
  "action-request", "call", "check-request", "choice-question", "departure-update", "emoji", "greeting",
  "intro-question", "nothing-response", "open-question", "problem", "send-request", "shared-link", "statement",
  "thanks", "timed-update", "update-request", "wellbeing-question", "when-question", "where-question", "why-question", "wish",
];
const FEATURE_NAMES = [
  ...TEXT_FEATURES,
  ...INTENT_NAMES.map((value) => `story_latest_intent:${value}`),
  ...LANGUAGE_NAMES.map((value) => `language:${value}`),
  ...INTENT_NAMES.map((value) => `intent:${value}`),
  ...SCENARIO_FAMILIES.map((value) => `family_evidence:${value}`),
  ...SCENARIO_RELATIONSHIPS.map((value) => `relationship:${value}`),
];

const FAMILY_THERMAL: Record<ScenarioFamily, ThermalCoordinate> = {
  acknowledgement: { valence: 0.25, arousal: 0.2, formality: 0.35 },
  answer: { valence: 0.05, arousal: 0.35, formality: 0.5 },
  clarification: { valence: 0, arousal: 0.45, formality: 0.5 },
  commitment: { valence: 0.2, arousal: 0.65, formality: 0.55 },
  conflict: { valence: -0.75, arousal: 0.8, formality: 0.5 },
  coordination: { valence: 0.05, arousal: 0.55, formality: 0.5 },
  delay: { valence: -0.25, arousal: 0.55, formality: 0.55 },
  emotion: { valence: 0.55, arousal: 0.7, formality: 0.2 },
  greeting: { valence: 0.65, arousal: 0.4, formality: 0.3 },
  information: { valence: 0, arousal: 0.3, formality: 0.5 },
  negotiation: { valence: -0.05, arousal: 0.65, formality: 0.6 },
  refusal: { valence: -0.4, arousal: 0.55, formality: 0.55 },
  request: { valence: 0, arousal: 0.6, formality: 0.5 },
  support: { valence: 0.55, arousal: 0.45, formality: 0.35 },
  "thread-close": { valence: 0.25, arousal: 0.15, formality: 0.4 },
};
const MODE_THERMAL: Record<ScenarioMode, ThermalCoordinate> = {
  calm: { valence: 0.05, arousal: -0.2, formality: 0.05 },
  warm: { valence: 0.35, arousal: 0.05, formality: -0.15 },
  direct: { valence: 0, arousal: 0.1, formality: 0.05 },
  urgent: { valence: -0.1, arousal: 0.4, formality: 0 },
  formal: { valence: 0, arousal: 0, formality: 0.4 },
  playful: { valence: 0.4, arousal: 0.25, formality: -0.35 },
  apologetic: { valence: -0.3, arousal: 0.15, formality: 0.15 },
  decisive: { valence: 0.05, arousal: 0.25, formality: 0.1 },
  supportive: { valence: 0.35, arousal: -0.05, formality: -0.05 },
  neutral: { valence: 0, arousal: 0, formality: 0 },
};
const RELATIONSHIP_FORMALITY: Record<ScenarioRelationship, number> = {
  family: -0.25, "close-friend": -0.3, friend: -0.2, colleague: 0.08, manager: 0.28,
  client: 0.3, vendor: 0.22, community: 0.08, acquaintance: 0.15, unknown: 0.12,
};

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(high, value));
}

function round(value: number, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function stableInt(value: string) {
  let hash = 2166136261;
  for (const character of value.normalize("NFKC")) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomGenerator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function countMatches(value: string, pattern: RegExp) {
  return (value.match(pattern) || []).length;
}

function ratio(count: number, total: number) {
  return total ? count / total : 0;
}

function signal(value: string, pattern: RegExp) {
  return pattern.test(value) ? 1 : 0;
}

function normalizedStory(storyText: string[] | undefined, incomingText: string) {
  const story = (storyText || []).slice(-12).map((value) => String(value || "").normalize("NFKC").trim()).filter(Boolean);
  const incoming = String(incomingText || "").normalize("NFKC").trim();
  // Runtime callers may pass the visible conversation ending in the active
  // incoming turn. Training episodes store only the preceding story, so remove
  // an exact duplicate to keep the feature contract symmetrical.
  if (story.at(-1) === incoming) story.pop();
  return story;
}

/**
 * Converts an observed owner reply into a continuous behavioural coordinate.
 * The forest persists only this bounded numerical result, never the reply.
 */
export function inferReplyThermalCoordinate(ownerReply: string): ThermalCoordinate {
  const text = String(ownerReply || "").normalize("NFKC").trim();
  const positive = countMatches(text, /\b(?:yes|sure|great|good|perfect|happy|thanks|thank you|welcome|love|glad|haan|haa|ha|bilkul|saras|mast|khushi|koi na|no worries)\b|[😊🙂😀😄😁❤️💕👍🙏🤗]/giu);
  const negative = countMatches(text, /\b(?:no|not|never|bad|wrong|issue|problem|angry|upset|sorry|nahi|nhi|na|nathi|galat|problem)\b|[😠😡😞😔]/giu);
  const calming = countMatches(text, /\b(?:calm|calmly|no rush|take your time|when convenient|let us discuss|let's discuss|koi jaldi nahi|aaram se|shanti se|chinta mat)\b/giu);
  const urgent = countMatches(text, /\b(?:urgent|urgently|asap|immediately|right now|need it now|jaldi|abhi|turant)\b/giu);
  const casual = countMatches(text, /\b(?:bro|bhai|yaar|tu|tum|haan|haa|nhi|kya|lol|mast)\b|[😂🤣😜😎]/giu);
  const formal = countMatches(text, /\b(?:kindly|regards|request you|dear sir|dear ma'am|please find|pursuant|appreciate|thank you)\b/giu);
  const exclamations = Math.min(4, countMatches(text, /!/gu));
  const letters = text.match(/\p{L}/gu) || [];
  const uppercase = text.match(/\p{Lu}/gu) || [];
  const emoji = Math.min(4, countMatches(text, /\p{Extended_Pictographic}/gu));
  const valence = clamp((positive - negative) * 0.22 + calming * 0.12, -1, 1);
  const arousal = clamp(0.32 + urgent * 0.2 + exclamations * 0.1 + ratio(uppercase.length, Math.max(1, letters.length)) * 0.22 + emoji * 0.04 - calming * 0.22, 0, 1);
  const formality = clamp(0.5 + formal * 0.16 - casual * 0.14 - emoji * 0.04 + (/\b(?:please|could you|would you)\b/iu.test(text) ? 0.08 : 0), 0, 1);
  return { valence: round(valence), arousal: round(arousal), formality: round(formality) };
}

function featureVector(input: { relationship: ScenarioRelationship; incomingText: string; storyText?: string[] }) {
  const text = String(input.incomingText || "").normalize("NFKC").trim();
  const story = normalizedStory(input.storyText, input.incomingText);
  const storyValue = story.join("\n");
  const latestStoryIntent = classifyIncomingIntent(story.at(-1) || "");
  const characters = [...text];
  const words = text.match(/[\p{L}\p{N}]+/gu) || [];
  const letters = text.match(/\p{L}/gu) || [];
  const uppercase = text.match(/\p{Lu}/gu) || [];
  const digits = text.match(/\p{N}/gu) || [];
  const intent = classifyIncomingIntent(text);
  const language = detectWritingMode(text);
  const familyEvidence = new Map(inferScenarioFamilies(intent, text).map((candidate) => [candidate.family, candidate.probability]));
  const values = [
    Math.log1p(characters.length), Math.log1p(words.length), Math.log1p(Math.max(1, text.split(/\r?\n/u).length)),
    Math.min(4, countMatches(text, /\?/gu)), Math.min(4, countMatches(text, /!/gu)), Math.min(6, countMatches(text, /\p{Extended_Pictographic}/gu)),
    ratio(digits.length, Math.max(1, characters.length)), ratio(uppercase.length, Math.max(1, letters.length)),
    /(?:https?:\/\/|www\.)/iu.test(text) ? 1 : 0,
    /\b(?:attachment|document|file|image|photo|pdf|video|voice note)\b/iu.test(text) ? 1 : 0,
    /\b(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:am|pm|a\.m\.|p\.m\.|baje|vage)\b/iu.test(text) ? 1 : 0,
    /\b(?:today|tomorrow|tonight|yesterday|aaj|kal|parso|aaje|kaale|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\b\d{1,2}[/-]\d{1,2}/iu.test(text) ? 1 : 0,
    /(?:[$€£₹]\s*\d|\b\d[\d,.]*\s*(?:inr|rs\.?|rupees?|usd|eur|gbp)\b)/iu.test(text) ? 1 : 0,
    /\?|\b(?:what|why|when|where|who|how|kya|kyu|kab|kidhar|shu|su|kem|kyare)\b/iu.test(text) ? 1 : 0,
    /\b(?:please|pls|plz|can you|could you|send|share|check|review|confirm|bhej|mokli|karjo|karo)\b/iu.test(text) ? 1 : 0,
    /\b(?:no|not|never|can't|cannot|won't|nahi|nhi|na|nathi)\b/iu.test(text) ? 1 : 0,
    /\b(?:sorry|apolog|maaf)\b/iu.test(text) ? 1 : 0,
    /\b(?:urgent|urgently|asap|immediately|now|jaldi|abhi|turant)\b|!!+/iu.test(text) ? 1 : 0,
    /\b(?:care|love|miss|welcome|dear|yaar|bro|bhai|didi|koi na|no worries)\b|[❤️💕🥺😘🤗😊🙂]/iu.test(text) ? 1 : 0,
    /\b(?:kindly|regards|request you|dear sir|dear ma'am|please find|pursuant)\b/iu.test(text) ? 1 : 0,
    /\b(?:bro|bhai|yaar|tu|tum|kya|kro|nhi|haan|haa|lol|mast)\b|[😂🤣😜😎]/iu.test(text) ? 1 : 0,
    /\b(?:i will|i'll|we will|we'll|promise|confirm|done|kar dunga|kar dungi|kari daish)\b/iu.test(text) ? 1 : 0,
    Math.log1p(story.length), Math.log1p([...storyValue].length),
    signal(storyValue, /\?|\b(?:what|why|when|where|who|how|kya|kyu|kab|kidhar|shu|su|kem|kyare)\b/iu),
    signal(storyValue, /\b(?:please|pls|plz|can you|could you|send|share|check|review|confirm|bhej|mokli|karjo|karo)\b/iu),
    signal(storyValue, /\b(?:no|not|never|can't|cannot|won't|nahi|nhi|na|nathi|wrong|problem|issue)\b/iu),
    signal(storyValue, /\b(?:urgent|urgently|asap|immediately|now|jaldi|abhi|turant)\b|!!+/iu),
    signal(storyValue, /\b(?:care|love|miss|welcome|dear|yaar|bro|bhai|didi|koi na|no worries)\b|[❤️💕🥺😘🤗😊🙂]/iu),
    signal(storyValue, /\b(?:kindly|regards|request you|dear sir|dear ma'am|please find|pursuant)\b/iu),
    signal(storyValue, /\b(?:bro|bhai|yaar|tu|tum|kya|kro|nhi|haan|haa|lol|mast)\b|[😂🤣😜😎]/iu),
    signal(storyValue, /\b(?:i will|i'll|we will|we'll|promise|confirm|done|kar dunga|kar dungi|kari daish)\b/iu),
    signal(storyValue, /\b(?:angry|upset|unacceptable|complaint|wrong|blame|frustrat|disappoint|gussa|naraz)\b/iu),
    signal(storyValue, /\b(?:resolved|sorted|fixed|done|completed|all good|thank you|thanks|ho gaya|thai gayu)\b/iu),
  ];
  values.push(...INTENT_NAMES.map((name) => latestStoryIntent === name ? 1 : 0));
  values.push(...LANGUAGE_NAMES.map((name) => language === name ? 1 : 0));
  values.push(...INTENT_NAMES.map((name) => intent === name ? 1 : 0));
  values.push(...SCENARIO_FAMILIES.map((family) => familyEvidence.get(family) || 0));
  values.push(...SCENARIO_RELATIONSHIPS.map((relationship) => input.relationship === relationship ? 1 : 0));
  return values;
}

function labelForEpisode(episode: ScenarioForestTrainingEpisode) {
  const intent = classifyIncomingIntent(episode.incomingText);
  const family = inferScenarioFamilies(intent, episode.incomingText)[0]?.family || "information";
  const relationship = SCENARIO_RELATIONSHIPS.includes(episode.relationship) ? episode.relationship : "unknown";
  const mode = inferOwnerResponseMode(episode.ownerReply, family, relationship);
  return CELL_INDEX.get(scenarioCode(family, relationship, mode)) as number;
}

function classCounts(rows: TrainingRow[], indices: number[]) {
  const counts = new Map<number, number>();
  let total = 0;
  for (const index of indices) {
    const row = rows[index];
    counts.set(row.label, (counts.get(row.label) || 0) + row.weight);
    total += row.weight;
  }
  return { counts, total };
}

function impurity(counts: Map<number, number>, total: number) {
  if (!total) return 0;
  let squares = 0;
  for (const count of counts.values()) squares += (count / total) ** 2;
  return 1 - squares;
}

function candidateThresholds(rows: TrainingRow[], indices: number[], feature: number) {
  const values = [...new Set(indices.map((index) => rows[index].features[feature]).filter(Number.isFinite))].sort((a, b) => a - b);
  if (values.length < 2) return [];
  const thresholds = new Set<number>();
  const count = Math.min(8, values.length - 1);
  for (let step = 1; step <= count; step += 1) {
    const at = Math.min(values.length - 2, Math.floor(step * values.length / (count + 1)));
    thresholds.add((values[at] + values[at + 1]) / 2);
  }
  return [...thresholds];
}

function buildTree(rows: TrainingRow[], indices: number[], random: () => number, options: { maxDepth: number; minLeaf: number; featureSubset: number }, depth = 0): TreeNode {
  const parent = classCounts(rows, indices);
  const node: TreeNode = { sampleWeight: parent.total, counts: [...parent.counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]) };
  if (depth >= options.maxDepth || indices.length < options.minLeaf * 2 || parent.counts.size <= 1) return node;
  const candidates = Array.from({ length: FEATURE_NAMES.length }, (_, index) => index);
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const selected = Math.floor(random() * (index + 1));
    [candidates[index], candidates[selected]] = [candidates[selected], candidates[index]];
  }
  const parentImpurity = impurity(parent.counts, parent.total);
  let best: { feature: number; threshold: number; gain: number; left: number[]; right: number[] } | null = null;
  for (const feature of candidates.slice(0, options.featureSubset)) {
    for (const threshold of candidateThresholds(rows, indices, feature)) {
      const left: number[] = [];
      const right: number[] = [];
      for (const index of indices) (rows[index].features[feature] <= threshold ? left : right).push(index);
      if (left.length < options.minLeaf || right.length < options.minLeaf) continue;
      const leftCounts = classCounts(rows, left);
      const rightCounts = classCounts(rows, right);
      const childImpurity = (leftCounts.total * impurity(leftCounts.counts, leftCounts.total) + rightCounts.total * impurity(rightCounts.counts, rightCounts.total)) / parent.total;
      const gain = parentImpurity - childImpurity;
      if (!best || gain > best.gain + 1e-12 || (Math.abs(gain - best.gain) <= 1e-12 && (feature < best.feature || (feature === best.feature && threshold < best.threshold)))) {
        best = { feature, threshold, gain, left, right };
      }
    }
  }
  if (!best || best.gain <= 1e-9) return node;
  node.featureIndex = best.feature;
  node.threshold = best.threshold;
  node.left = buildTree(rows, best.left, random, options, depth + 1);
  node.right = buildTree(rows, best.right, random, options, depth + 1);
  return node;
}

function hierarchicalPrior(observedCounts: number[], strength: number) {
  const familyCounts = Array(SCENARIO_FAMILIES.length).fill(0);
  const relationshipCounts = Array(SCENARIO_RELATIONSHIPS.length).fill(0);
  const modeCounts = Array(SCENARIO_MODES.length).fill(0);
  const total = observedCounts.reduce((sum, count) => sum + count, 0);
  for (let index = 0; index < ALL_CELLS.length; index += 1) {
    const count = observedCounts[index];
    familyCounts[Math.floor(index / 100)] += count;
    relationshipCounts[Math.floor((index % 100) / 10)] += count;
    modeCounts[index % 10] += count;
  }
  const raw = ALL_CELLS.map((_, index) => {
    const family = Math.floor(index / 100);
    const relationship = Math.floor((index % 100) / 10);
    const mode = index % 10;
    const familyProbability = (familyCounts[family] + 1) / (total + SCENARIO_FAMILIES.length);
    const relationshipProbability = (relationshipCounts[relationship] + 1) / (total + SCENARIO_RELATIONSHIPS.length);
    const modeProbability = (modeCounts[mode] + 1) / (total + SCENARIO_MODES.length);
    return familyProbability * relationshipProbability * modeProbability + 1 / (ALL_CELLS.length * Math.max(1, strength));
  });
  const sum = raw.reduce((value, item) => value + item, 0) || 1;
  return raw.map((value) => value / sum);
}

function boundedRows(rows: TrainingRow[], maximum: number) {
  if (rows.length <= maximum) return rows;
  return [...rows].sort((left, right) => left.fingerprint - right.fingerprint || right.timestampMs - left.timestampMs).slice(0, maximum);
}

export function trainScenarioForest(episodes: ScenarioForestTrainingEpisode[], options: {
  accountScopeId: string;
  seed?: number;
  treeCount?: number;
  maxDepth?: number;
  minLeaf?: number;
  featureSubset?: number;
  maximumExamples?: number;
  priorStrength?: number;
}): ScenarioForestModel {
  const accountScopeId = String(options.accountScopeId || "").trim();
  if (!accountScopeId) throw new Error("Scenario forest training requires an explicit account scope.");
  const foreign = episodes.find((episode) => String(episode.accountScopeId || "").trim() !== accountScopeId);
  if (foreign) throw new Error("Scenario training evidence outside the active account boundary was blocked.");
  const maximumExamples = clamp(Math.floor(options.maximumExamples ?? 12_000), 10, MAX_EXAMPLES);
  const supplied = episodes.length;
  const rows = boundedRows(episodes.filter((episode) => String(episode.incomingText || "").trim() && String(episode.ownerReply || "").trim()).map((episode) => {
    const label = labelForEpisode(episode);
    const features = featureVector({ relationship: episode.relationship, incomingText: episode.incomingText, storyText: episode.storyText });
    return {
      features,
      label,
      thermal: inferReplyThermalCoordinate(episode.ownerReply),
      weight: clamp(Number(episode.weight ?? 1), 0.05, 20),
      timestampMs: Number.isFinite(episode.timestampMs) ? Number(episode.timestampMs) : 0,
      fingerprint: stableInt(`${accountScopeId}\u001f${label}\u001f${features.map((value) => round(value, 4)).join(",")}\u001f${episode.timestampMs || 0}`),
    };
  }), maximumExamples);
  if (!rows.length) throw new Error("Scenario forest training requires at least one usable WhatsApp-derived episode.");
  rows.sort((left, right) => left.timestampMs - right.timestampMs || left.fingerprint - right.fingerprint);
  const observedCounts = Array(ALL_CELLS.length).fill(0);
  for (const row of rows) observedCounts[row.label] += row.weight;
  const thermalWeights = Array(ALL_CELLS.length).fill(0);
  const thermalSums = ALL_CELLS.map(() => ({ valence: 0, arousal: 0, formality: 0 }));
  for (const row of rows) {
    thermalWeights[row.label] += row.weight;
    for (const key of THERMAL_KEYS) thermalSums[row.label][key] += row.thermal[key] * row.weight;
  }
  const learnedThermal = ALL_CELLS.map((_, index) => ({
    evidenceWeight: round(thermalWeights[index], 3),
    centroid: thermalWeights[index] > 0
      ? THERMAL_KEYS.reduce((value, key) => ({ ...value, [key]: round(thermalSums[index][key] / thermalWeights[index]) }), {} as ThermalCoordinate)
      : thermalPriorForCell(index),
  }));
  const treeCount = clamp(Math.floor(options.treeCount ?? 31), 3, MAX_TREES);
  const maxDepth = clamp(Math.floor(options.maxDepth ?? 6), 1, 12);
  const minLeaf = clamp(Math.floor(options.minLeaf ?? 2), 1, 100);
  const featureSubset = clamp(Math.floor(options.featureSubset ?? Math.sqrt(FEATURE_NAMES.length)), 2, FEATURE_NAMES.length);
  const seed = (options.seed ?? stableInt(`${accountScopeId}\u001f${rows.length}\u001f${rows.reduce((sum, row) => sum ^ row.fingerprint, 0)}`)) >>> 0;
  const trees: TreeNode[] = [];
  for (let treeIndex = 0; treeIndex < treeCount; treeIndex += 1) {
    const random = randomGenerator(seed ^ Math.imul(treeIndex + 1, 0x9E3779B1));
    const sampleSize = Math.min(rows.length, 4_000);
    const indices = Array.from({ length: sampleSize }, () => Math.floor(random() * rows.length));
    trees.push(buildTree(rows, indices, random, { maxDepth, minLeaf, featureSubset }));
  }
  const observedCellCount = observedCounts.filter((count) => count > 0).length;
  return {
    version: 1,
    taxonomyVersion: SCENARIO_TAXONOMY_VERSION,
    accountScopeId,
    seed,
    featureNames: [...FEATURE_NAMES],
    cells: ALL_CELLS.map((cell) => cell.code),
    trees,
    observedCounts,
    prior: hierarchicalPrior(observedCounts, options.priorStrength ?? 12),
    learnedThermal,
    training: {
      suppliedEpisodes: supplied,
      retainedEpisodes: rows.length,
      observedCellCount,
      absentCellCount: ALL_CELLS.length - observedCellCount,
      cellCoverage: round(observedCellCount / ALL_CELLS.length, 4),
      treeCount,
      maxDepth,
      maximumExamples,
      bounded: true,
      thermalObservedCellCount: thermalWeights.filter((weight) => weight > 0).length,
    },
  };
}

/**
 * Reuses a numerical tenant-local forest while its complete episode revision is
 * unchanged. The revision hashes raw inputs transiently; neither text nor
 * person identifiers are retained in the cache.
 */
export function trainScenarioForestCached(episodes: ScenarioForestTrainingEpisode[], options: Parameters<typeof trainScenarioForest>[1]) {
  const accountScopeId = String(options.accountScopeId || "").trim();
  if (!accountScopeId) throw new Error("Scenario forest training requires an explicit account scope.");
  const optionRevision = JSON.stringify({
    seed: options.seed,
    treeCount: options.treeCount,
    maxDepth: options.maxDepth,
    minLeaf: options.minLeaf,
    featureSubset: options.featureSubset,
    maximumExamples: options.maximumExamples,
    priorStrength: options.priorStrength,
  });
  const episodeRevisions = episodes.map((episode) => collisionResistantRevision([
    episode.accountScopeId,
    episode.relationship,
    episode.incomingText,
    ...(episode.storyText || []),
    episode.ownerReply,
    String(episode.timestampMs || 0),
    String(episode.weight || 1),
  ])).sort();
  // Cache identity is security-sensitive because a stale model could blend a
  // changed tenant history into the next draft. A length-delimited SHA-256
  // revision avoids the collision surface of the former 32-bit accumulator.
  const revision = collisionResistantRevision([optionRevision, String(episodeRevisions.length), ...episodeRevisions]);
  const cached = forestModelCache.get(accountScopeId);
  if (cached?.revision === revision) {
    forestModelCache.delete(accountScopeId);
    forestModelCache.set(accountScopeId, cached);
    return cached.model;
  }
  const model = trainScenarioForest(episodes, options);
  forestModelCache.set(accountScopeId, { revision, model });
  while (forestModelCache.size > MAX_TENANT_FOREST_MODELS) forestModelCache.delete(forestModelCache.keys().next().value as string);
  return model;
}

function probabilityInNode(node: TreeNode, label: number) {
  if (!node.sampleWeight) return 0;
  return (node.counts.find(([current]) => current === label)?.[1] || 0) / node.sampleWeight;
}

function leafFor(node: TreeNode, features: number[]) {
  const path: Array<{ parent: TreeNode; child: TreeNode; featureIndex: number }> = [];
  let current = node;
  while (current.left && current.right && current.featureIndex !== undefined && current.threshold !== undefined) {
    const child = features[current.featureIndex] <= current.threshold ? current.left : current.right;
    path.push({ parent: current, child, featureIndex: current.featureIndex });
    current = child;
  }
  return { leaf: current, path };
}

function thermalPriorForCell(index: number): ThermalCoordinate {
  const cell = ALL_CELLS[index];
  const family = FAMILY_THERMAL[cell.family];
  const mode = MODE_THERMAL[cell.mode];
  return {
    valence: round(clamp(family.valence + mode.valence, -1, 1)),
    arousal: round(clamp(family.arousal + mode.arousal, 0, 1)),
    formality: round(clamp(family.formality + mode.formality + RELATIONSHIP_FORMALITY[cell.relationship], 0, 1)),
  };
}

function thermalForCell(model: ScenarioForestModel, index: number): ThermalCoordinate {
  const prior = thermalPriorForCell(index);
  const learned = model.learnedThermal[index];
  if (!learned || learned.evidenceWeight <= 0) return prior;
  // Three equivalent observations provide conservative shrinkage for sparse
  // cells; substantial owner evidence dominates the taxonomy prior.
  const priorWeight = 3;
  const learnedWeight = learned.evidenceWeight;
  return THERMAL_KEYS.reduce((value, key) => ({
    ...value,
    [key]: round(clamp((learned.centroid[key] * learnedWeight + prior[key] * priorWeight) / (learnedWeight + priorWeight), key === "valence" ? -1 : 0, 1)),
  }), {} as ThermalCoordinate);
}

function distance(left: ThermalCoordinate, right: ThermalCoordinate) {
  return Math.sqrt((left.valence - right.valence) ** 2 + (left.arousal - right.arousal) ** 2 + (left.formality - right.formality) ** 2);
}

type MixtureComponent = {
  weight: number;
  centroid: ThermalCoordinate;
  variance: ThermalCoordinate;
};

const THERMAL_KEYS: Array<keyof ThermalCoordinate> = ["valence", "arousal", "formality"];

function gaussianDensity(point: ThermalCoordinate, component: MixtureComponent) {
  let exponent = 0;
  let scale = 1;
  for (const key of THERMAL_KEYS) {
    const variance = Math.max(0.0025, component.variance[key]);
    exponent += ((point[key] - component.centroid[key]) ** 2) / variance;
    scale *= Math.sqrt(2 * Math.PI * variance);
  }
  return Math.exp(-0.5 * exponent) / Math.max(1e-12, scale);
}

function weightedThermalMixture(coordinates: ThermalCoordinate[], probabilities: number[], requestedComponents: number) {
  const componentCount = clamp(Math.floor(requestedComponents), 1, 3);
  const ranked = probabilities.map((probability, index) => ({ probability, index }))
    .sort((left, right) => right.probability - left.probability || left.index - right.index);
  const seeds: number[] = [];
  for (const item of ranked) {
    if (!seeds.length || seeds.every((index) => distance(coordinates[item.index], coordinates[index]) >= 0.22)) seeds.push(item.index);
    if (seeds.length === componentCount) break;
  }
  while (seeds.length < componentCount) seeds.push(ranked[seeds.length % ranked.length].index);
  let components: MixtureComponent[] = seeds.map((index) => ({
    weight: 1 / componentCount,
    centroid: { ...coordinates[index] },
    variance: { valence: 0.08, arousal: 0.08, formality: 0.08 },
  }));
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const responsibilities = coordinates.map((point) => {
      const values = components.map((component) => component.weight * gaussianDensity(point, component));
      const total = values.reduce((sum, value) => sum + value, 0) || 1e-12;
      return values.map((value) => value / total);
    });
    components = components.map((_component, componentIndex) => {
      const mass = probabilities.reduce((sum, probability, index) => sum + probability * responsibilities[index][componentIndex], 0);
      const safeMass = Math.max(1e-9, mass);
      const centroid = THERMAL_KEYS.reduce((value, key) => ({
        ...value,
        [key]: probabilities.reduce((sum, probability, index) => sum + probability * responsibilities[index][componentIndex] * coordinates[index][key], 0) / safeMass,
      }), {} as ThermalCoordinate);
      const variance = THERMAL_KEYS.reduce((value, key) => ({
        ...value,
        [key]: Math.max(0.0025, probabilities.reduce((sum, probability, index) => sum + probability * responsibilities[index][componentIndex] * ((coordinates[index][key] - centroid[key]) ** 2), 0) / safeMass),
      }), {} as ThermalCoordinate);
      return { weight: safeMass, centroid, variance };
    });
    const totalMass = components.reduce((sum, component) => sum + component.weight, 0) || 1;
    components = components.map((component) => ({ ...component, weight: component.weight / totalMass }));
  }
  const logLikelihood = coordinates.reduce((sum, point, index) => {
    const density = components.reduce((value, component) => value + component.weight * gaussianDensity(point, component), 0);
    return sum + probabilities[index] * Math.log(Math.max(1e-12, density));
  }, 0);
  const effectiveSamples = Math.max(2, 1 / Math.max(1e-9, probabilities.reduce((sum, probability) => sum + probability ** 2, 0)));
  const parameterCount = componentCount * 7 - 1;
  const bic = -2 * effectiveSamples * logLikelihood + parameterCount * Math.log(effectiveSamples);
  return { components, effectiveSamples, bic };
}

function selectThermalMixture(
  hotspots: Array<{ relativeMass: number; centroid: ThermalCoordinate }>,
  centroid: ThermalCoordinate,
  spread: ThermalCoordinate,
  multimodal: boolean,
) {
  if (!multimodal || hotspots.length < 2) return {
    method: "weighted-diagonal-gmm" as const,
    selectedComponents: 1,
    effectiveSamples: 1,
    bic: 0,
    components: [{ weight: 1, centroid, spread }],
  };
  const coordinates = hotspots.map((hotspot) => hotspot.centroid);
  const total = hotspots.reduce((sum, hotspot) => sum + hotspot.relativeMass, 0) || 1;
  const probabilities = hotspots.map((hotspot) => hotspot.relativeMass / total);
  const candidates = Array.from({ length: Math.min(3, hotspots.length) }, (_, index) => weightedThermalMixture(coordinates, probabilities, index + 1));
  const selected = candidates.sort((left, right) => left.bic - right.bic)[0];
  return {
    method: "weighted-diagonal-gmm" as const,
    selectedComponents: selected.components.length,
    effectiveSamples: round(selected.effectiveSamples, 3),
    bic: round(selected.bic, 3),
    components: selected.components
      .map((component) => ({
        weight: round(component.weight),
        centroid: THERMAL_KEYS.reduce((value, key) => ({ ...value, [key]: round(component.centroid[key]) }), {} as ThermalCoordinate),
        spread: THERMAL_KEYS.reduce((value, key) => ({ ...value, [key]: round(Math.sqrt(component.variance[key])) }), {} as ThermalCoordinate),
      }))
      .sort((left, right) => right.weight - left.weight),
  };
}

function thermalSummary(model: ScenarioForestModel, probabilities: number[], allowMultipleComponents = true) {
  const coordinates = ALL_CELLS.map((_, index) => thermalForCell(model, index));
  const centroid = probabilities.reduce((value, probability, index) => ({
    valence: value.valence + probability * coordinates[index].valence,
    arousal: value.arousal + probability * coordinates[index].arousal,
    formality: value.formality + probability * coordinates[index].formality,
  }), { valence: 0, arousal: 0, formality: 0 });
  const variance = probabilities.reduce((value, probability, index) => ({
    valence: value.valence + probability * (coordinates[index].valence - centroid.valence) ** 2,
    arousal: value.arousal + probability * (coordinates[index].arousal - centroid.arousal) ** 2,
    formality: value.formality + probability * (coordinates[index].formality - centroid.formality) ** 2,
  }), { valence: 0, arousal: 0, formality: 0 });
  const ranked = probabilities.map((probability, index) => ({ probability, index, coordinate: coordinates[index] }))
    .sort((left, right) => right.probability - left.probability || left.index - right.index).slice(0, 96);
  const selectedMass = ranked.reduce((sum, item) => sum + item.probability, 0) || 1;
  const clusters: Array<{ mass: number; weighted: ThermalCoordinate; cells: Array<{ index: number; probability: number }> }> = [];
  for (const item of ranked) {
    let selected = clusters.map((cluster, index) => ({ index, distance: distance(item.coordinate, {
      valence: cluster.weighted.valence / cluster.mass,
      arousal: cluster.weighted.arousal / cluster.mass,
      formality: cluster.weighted.formality / cluster.mass,
    }) })).sort((left, right) => left.distance - right.distance)[0];
    if (!selected || (selected.distance > 0.24 && clusters.length < 5)) {
      clusters.push({ mass: item.probability, weighted: { valence: item.coordinate.valence * item.probability, arousal: item.coordinate.arousal * item.probability, formality: item.coordinate.formality * item.probability }, cells: [{ index: item.index, probability: item.probability }] });
      continue;
    }
    const cluster = clusters[selected.index];
    cluster.mass += item.probability;
    cluster.weighted.valence += item.coordinate.valence * item.probability;
    cluster.weighted.arousal += item.coordinate.arousal * item.probability;
    cluster.weighted.formality += item.coordinate.formality * item.probability;
    cluster.cells.push({ index: item.index, probability: item.probability });
  }
  const hotspots = clusters.map((cluster) => ({
    probabilityMass: round(cluster.mass),
    relativeMass: round(cluster.mass / selectedMass),
    centroid: { valence: round(cluster.weighted.valence / cluster.mass), arousal: round(cluster.weighted.arousal / cluster.mass), formality: round(cluster.weighted.formality / cluster.mass) },
    dominantCells: cluster.cells.sort((left, right) => right.probability - left.probability).slice(0, 3).map((item) => ALL_CELLS[item.index].code),
  })).sort((left, right) => right.relativeMass - left.relativeMass);
  const meaningful = hotspots.filter((hotspot) => hotspot.relativeMass >= 0.15);
  const multimodal = allowMultipleComponents && meaningful.some((left, index) => meaningful.slice(index + 1).some((right) => distance(left.centroid, right.centroid) >= 0.28));
  const roundedCentroid = { valence: round(centroid.valence), arousal: round(centroid.arousal), formality: round(centroid.formality) };
  const roundedSpread = { valence: round(Math.sqrt(variance.valence)), arousal: round(Math.sqrt(variance.arousal)), formality: round(Math.sqrt(variance.formality)) };
  return {
    centroid: roundedCentroid,
    spread: roundedSpread,
    hotspots,
    multimodal,
    mixture: selectThermalMixture(hotspots, roundedCentroid, roundedSpread, multimodal),
  };
}

export function predictScenarioForest(model: ScenarioForestModel, query: ScenarioForestQuery, options: { topK?: number; priorStrength?: number } = {}): ScenarioForestPrediction {
  if (String(query.accountScopeId || "").trim() !== model.accountScopeId) throw new Error("Scenario prediction outside the trained account boundary was blocked.");
  const relationship = SCENARIO_RELATIONSHIPS.includes(query.relationship as ScenarioRelationship) ? query.relationship as ScenarioRelationship : "unknown";
  const features = featureVector({ relationship, incomingText: query.incomingText, storyText: query.storyText });
  const forest = Array(ALL_CELLS.length).fill(0);
  const paths: ReturnType<typeof leafFor>[] = [];
  const treeVotes: ScenarioForestPrediction["treeVotes"] = [];
  let meanLeafEvidence = 0;
  for (let treeIndex = 0; treeIndex < model.trees.length; treeIndex += 1) {
    const result = leafFor(model.trees[treeIndex], features);
    paths.push(result);
    meanLeafEvidence += result.leaf.sampleWeight;
    for (const [label, count] of result.leaf.counts) forest[label] += count / Math.max(1, result.leaf.sampleWeight) / model.trees.length;
    const winner = [...result.leaf.counts].sort((left, right) => right[1] - left[1] || left[0] - right[0])[0] || [0, 0];
    treeVotes.push({ tree: treeIndex, code: ALL_CELLS[winner[0]].code, confidence: round(winner[1] / Math.max(1, result.leaf.sampleWeight)), leafEvidence: round(result.leaf.sampleWeight, 3), pathDepth: result.path.length });
  }
  meanLeafEvidence /= Math.max(1, model.trees.length);
  const priorStrength = clamp(Number(options.priorStrength ?? 12), 1, 100);
  const effectiveEvidence = Math.min(80, meanLeafEvidence);
  const probabilities = forest.map((value, index) => (value * effectiveEvidence + model.prior[index] * priorStrength) / (effectiveEvidence + priorStrength));
  // The S-axis is supplied by the evidence-backed relationship profile. An
  // account-wide majority must never relabel a known friend as a manager (or
  // any other relationship) merely because that class has more examples.
  // Unknown profiles remain probabilistic across S; known profiles route
  // probabilistically across the 15 x 10 family/mode cells inside that S band.
  if (relationship !== "unknown") {
    for (let index = 0; index < probabilities.length; index += 1) {
      if (ALL_CELLS[index].relationship !== relationship) probabilities[index] = 0;
    }
  }
  const total = probabilities.reduce((sum, value) => sum + value, 0) || 1;
  for (let index = 0; index < probabilities.length; index += 1) probabilities[index] /= total;
  const ranked = probabilities.map((probability, index) => ({ probability, index })).sort((left, right) => right.probability - left.probability || left.index - right.index);
  const limit = clamp(Math.floor(options.topK ?? 8), 1, 25);
  const top = ranked.slice(0, limit);
  const retainedProbabilityMass = top.reduce((sum, item) => sum + item.probability, 0) || 1;
  const topCells = top.map((item) => {
    const cell = ALL_CELLS[item.index];
    const evidenceCount = model.observedCounts[item.index];
    return {
      code: cell.code,
      family: cell.family,
      relationship: cell.relationship,
      mode: cell.mode,
      probability: round(item.probability / retainedProbabilityMass),
      absoluteProbability: round(item.probability),
      evidenceCount: round(evidenceCount, 3),
      trained: evidenceCount > 0,
      evidenceStatus: evidenceCount > 0 ? "observed-training-cell" as const : "hierarchical-prior-only" as const,
      thermal: thermalForCell(model, item.index),
    };
  });
  const normalizedTotal = topCells.reduce((sum, item) => sum + item.probability, 0);
  if (topCells.length) topCells[topCells.length - 1].probability = round(topCells[topCells.length - 1].probability + 1 - normalizedTotal);
  const entropy = -probabilities.reduce((sum, value) => value > 0 ? sum + value * Math.log(value) : sum, 0);
  const normalizedEntropy = entropy / Math.log(ALL_CELLS.length);
  const sparseUncertainty = 1 / Math.sqrt(1 + model.training.retainedEpisodes);
  const uncertainty = clamp(0.55 * normalizedEntropy + 0.35 * (1 - ranked[0].probability) + 0.1 * sparseUncertainty, 0, 1);
  const targetLabel = ranked[0].index;
  const contributions = new Map<number, number>();
  for (const result of paths) {
    for (const step of result.path) {
      const delta = (probabilityInNode(step.child, targetLabel) - probabilityInNode(step.parent, targetLabel)) / model.trees.length;
      contributions.set(step.featureIndex, (contributions.get(step.featureIndex) || 0) + delta);
    }
  }
  const featureContributions = [...contributions].map(([feature, contribution]) => ({ feature: model.featureNames[feature], contribution: round(contribution), absoluteContribution: round(Math.abs(contribution)) }))
    .sort((left, right) => right.absoluteContribution - left.absoluteContribution || left.feature.localeCompare(right.feature)).slice(0, 12);
  return {
    version: 1,
    taxonomyVersion: model.taxonomyVersion,
    topCells,
    retainedProbabilityMass: round(retainedProbabilityMass),
    fullDistributionSize: 1_500,
    entropy: round(entropy),
    normalizedEntropy: round(normalizedEntropy),
    uncertainty: round(uncertainty),
    calibration: { method: "random-forest-leaf-posterior-plus-hierarchical-dirichlet", meanLeafEvidence: round(meanLeafEvidence, 3), priorStrength },
    thermal: thermalSummary(model, probabilities, model.training.retainedEpisodes >= 20 && meanLeafEvidence >= 4),
    treeVotes,
    featureContributions,
  };
}

/**
 * Reports taxonomy evidence without looking at or returning private text.
 * "Observed" means at least one retained training episode, not that the cell
 * is accurate, representative, calibrated, or owner-approved.
 */
export function scenarioForestCoverageReport(model: ScenarioForestModel): ScenarioForestCoverageReport {
  if (model.cells.length !== 1_500 || model.observedCounts.length !== 1_500) {
    throw new Error("Scenario forest coverage requires the complete 1,500-cell taxonomy.");
  }
  const counts = model.observedCounts.map((value) => Math.max(0, Number(value || 0)));
  const ordered = [...counts].sort((left, right) => left - right);
  const percentile = (fraction: number) => ordered[Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * fraction) - 1))] || 0;
  const observedCellCount = counts.filter((value) => value > 0).length;
  const axis = <T extends ScenarioFamily | ScenarioRelationship | ScenarioMode>(
    values: readonly T[],
    select: (cell: (typeof ALL_CELLS)[number]) => T,
    totalCells: 100 | 150,
  ) => values.map((value) => {
    const indexes = ALL_CELLS.map((cell, index) => select(cell) === value ? index : -1).filter((index) => index >= 0);
    return {
      value,
      observedCells: indexes.filter((index) => counts[index] > 0).length,
      totalCells,
      evidenceWeight: round(indexes.reduce((sum, index) => sum + counts[index], 0), 3),
    };
  });
  return {
    taxonomyVersion: model.taxonomyVersion,
    totalCellCount: 1_500,
    observedCellCount,
    unobservedCellCount: 1_500 - observedCellCount,
    observedCellRatio: round(observedCellCount / 1_500, 4),
    allCellsObserved: observedCellCount === 1_500,
    evidenceDistribution: {
      minimum: ordered[0] || 0,
      median: percentile(0.5),
      p90: percentile(0.9),
      maximum: ordered.at(-1) || 0,
      cellsWithAtLeast3: counts.filter((value) => value >= 3).length,
      cellsWithAtLeast10: counts.filter((value) => value >= 10).length,
    },
    axes: {
      families: axis(SCENARIO_FAMILIES, (cell) => cell.family, 100),
      relationships: axis(SCENARIO_RELATIONSHIPS, (cell) => cell.relationship, 150),
      modes: axis(SCENARIO_MODES, (cell) => cell.mode, 150),
    },
    claim: `${observedCellCount} of 1,500 cells contain retained training evidence; observation alone does not certify accuracy or owner acceptance.`,
  };
}

/**
 * Evaluates routing on labelled, time/contact-separated cases while returning
 * only aggregate numbers. Incoming/story text is consumed in memory and is
 * never copied into the report. This is an algorithmic calibration check, not
 * a substitute for blinded owner acceptance of the realised reply.
 */
export function evaluateScenarioForest(
  model: ScenarioForestModel,
  cases: Array<{ query: ScenarioForestQuery; expectedCode: string }>,
): ScenarioForestEvaluationReport {
  const valid = cases.filter((item) => CELL_INDEX.has(String(item?.expectedCode || "")));
  const evaluated = valid.map((item) => {
    const expected = ALL_CELLS[CELL_INDEX.get(item.expectedCode)!];
    const prediction = predictScenarioForest(model, item.query, { topK: 25 });
    const ranked = prediction.topCells;
    const rank = ranked.findIndex((cell) => cell.code === expected.code);
    const predicted = ranked[0];
    const expectedProbability = Math.max(0, Number(ranked.find((cell) => cell.code === expected.code)?.absoluteProbability || 0));
    const confidence = Math.max(0, Math.min(1, Number(predicted?.absoluteProbability || 0)));
    return {
      rank,
      expectedProbability,
      confidence,
      correct: predicted?.code === expected.code,
      family: predicted?.family === expected.family,
      relationship: predicted?.relationship === expected.relationship,
      mode: predicted?.mode === expected.mode,
      observed: Number(model.observedCounts[CELL_INDEX.get(expected.code)!] || 0) > 0,
    };
  });
  const ratio = (numerator: number, denominator = evaluated.length) => denominator ? numerator / denominator : 0;
  const bins = Array.from({ length: 10 }, (_, index) => {
    const lower = index / 10;
    const upper = (index + 1) / 10;
    const values = evaluated.filter((item) => item.confidence >= lower && (index === 9 ? item.confidence <= upper : item.confidence < upper));
    return {
      lower: round(lower),
      upper: round(upper),
      cases: values.length,
      meanConfidence: round(ratio(values.reduce((sum, item) => sum + item.confidence, 0), values.length)),
      accuracy: round(ratio(values.filter((item) => item.correct).length, values.length)),
    };
  });
  const calibrationError = bins.reduce((sum, bin) => sum
    + Math.abs(bin.accuracy - bin.meanConfidence) * bin.cases / Math.max(1, evaluated.length), 0);
  return {
    taxonomyVersion: model.taxonomyVersion,
    caseCount: cases.length,
    validCaseCount: evaluated.length,
    invalidExpectedCodes: cases.length - evaluated.length,
    topKAccuracy: {
      top1: round(ratio(evaluated.filter((item) => item.rank === 0).length), 4),
      top3: round(ratio(evaluated.filter((item) => item.rank >= 0 && item.rank < 3).length), 4),
      top8: round(ratio(evaluated.filter((item) => item.rank >= 0 && item.rank < 8).length), 4),
      top25: round(ratio(evaluated.filter((item) => item.rank >= 0).length), 4),
    },
    axisAccuracy: {
      family: round(ratio(evaluated.filter((item) => item.family).length), 4),
      relationship: round(ratio(evaluated.filter((item) => item.relationship).length), 4),
      mode: round(ratio(evaluated.filter((item) => item.mode).length), 4),
    },
    probabilityQuality: {
      meanExpectedCellProbability: round(ratio(evaluated.reduce((sum, item) => sum + item.expectedProbability, 0)), 6),
      clippedNegativeLogLikelihood: round(ratio(evaluated.reduce((sum, item) => sum - Math.log(Math.max(1e-9, item.expectedProbability)), 0)), 6),
      top1ExpectedCalibrationError: round(calibrationError, 6),
      bins,
    },
    observedExpectedCells: evaluated.filter((item) => item.observed).length,
    priorOnlyExpectedCells: evaluated.filter((item) => !item.observed).length,
    containsRawContent: false,
    claim: "This content-free report measures scenario routing only; it does not certify factuality, personal tone, or owner acceptance.",
  };
}

export function assessTensorFlowViability() {
  return {
    recommended: false,
    decision: "Keep the bounded numerical forest dependency-free.",
    reasons: [
      "The feature matrix is small, structured and CPU-friendly; TensorFlow does not improve the information content of sparse WhatsApp cells.",
      "A native numerical runtime materially increases desktop download size, update surface and cold-start cost.",
      "The current forest trains entirely in-process without moving private chat-derived features outside the tenant boundary.",
    ],
    reconsiderWhen: [
      "A consented benchmark shows a statistically significant calibration or acceptance gain over this forest.",
      "The production corpus has enough evidence across substantially more than the currently sparse 1,500 cells.",
      "The measured latency, package-size and memory budgets can absorb the dependency.",
    ],
  };
}
