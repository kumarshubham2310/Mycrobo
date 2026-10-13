import { detectWritingMode } from "./relationship.ts";

export type StyleEvidenceSource = "explicit-preference" | "exact-person-active" | "owner-global" | "target-mirror";
export type StyleDecision<T> = {
  value: T;
  source: StyleEvidenceSource;
  confidence: number;
  sampleCount: number;
  effectiveSampleSize: number;
  rationale: string;
};

export type BehavioralStylePolicy = {
  version: 1;
  calibration: "hierarchical-prior-v2";
  language: StyleDecision<"English" | "Roman Hindi" | "Roman Gujarati">;
  length: StyleDecision<"micro" | "short" | "medium" | "long"> & { targetCharacters: number };
  formality: StyleDecision<"casual" | "neutral" | "formal">;
  emoji: StyleDecision<"avoid" | "use"> & { palette: string[] };
};

type RankedValue = { mode?: unknown; bucket?: unknown; count?: unknown; rate?: unknown };
type BehavioralBucket = {
  sampleCount?: unknown;
  effectiveSampleSize?: unknown;
  confidence?: unknown;
  medianCharacters?: unknown;
  writingModes?: RankedValue[];
  replyModesByIncomingMode?: Array<{ incomingMode?: unknown; effectiveSampleSize?: unknown; replyModes?: RankedValue[] }>;
  lengthBuckets?: RankedValue[];
  emojiRate?: unknown;
  emojiPalette?: unknown;
  formalRate?: unknown;
  casualRate?: unknown;
};
type BehavioralDNA = { active?: BehavioralBucket; global?: BehavioralBucket } | null | undefined;

const HINDI = /\b(?:hai|haan|nahi|nhi|kya|kyu|kab|kaise|kahan|kidhar|mein|mai|main|hu|hoga|kar|karo|kro|karna|krna|bata|batao|bolo|aur|abhi|mujhe|meko|nikl|aaj|kal|koi|yaar|bhej|bhejo)\b/giu;
const GUJARATI = /\b(?:shu|kem|chhe|che|chu|nathi|mane|tane|aav|jav|karu|karvu|thase|mokli|moklo|joi|joine|kyare|kai|vandho|saras)\b/giu;
const FORMAL = /\b(?:sir|madam|ma'am|kindly|please|request|regards|thank you|aap|aapko|aapse|tame|ji)\b/giu;
const CASUAL = /\b(?:bro|bhai|yaar|tu|tum|kya|kro|kr|nhi|haan|haa|hii|hey|lol|bas|mast|acha|achha)\b|[😂🤣😜😎]/giu;

// Symmetric, deliberately uninformative reliability priors. Evidence volume,
// dominance and margin determine each decision; no number below was tuned on
// the historical evaluation set that later measures this policy.
const PRIOR_RELIABILITY = Object.freeze({
  language: { person: 0.5, global: 0.5, target: 0.5 },
  length: { person: 0.5, global: 0.5, target: 0.5 },
  formality: { person: 0.5, global: 0.5, target: 0.5 },
  emoji: { person: 0.5, global: 0.5, target: 0.5 },
});

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : 0));
}

function rounded(value: number) {
  return Number(clamp(value).toFixed(3));
}

function lengthBucketFromCharacters(length: number): BehavioralStylePolicy["length"]["value"] {
  return length <= 12 ? "micro" : length <= 35 ? "short" : length <= 100 ? "medium" : "long";
}

function canonicalLanguage(value: unknown): BehavioralStylePolicy["language"]["value"] | null {
  const mode = String(value || "");
  if (mode === "Hindi" || mode === "Roman Hindi") return "Roman Hindi";
  if (mode === "Gujarati" || mode === "Roman Gujarati") return "Roman Gujarati";
  if (mode === "English") return "English";
  return null;
}

export function styleLanguageOf(text: string): BehavioralStylePolicy["language"]["value"] {
  const value = String(text || "");
  const gujarati = value.match(GUJARATI)?.length || 0;
  const hindi = value.match(HINDI)?.length || 0;
  HINDI.lastIndex = 0;
  GUJARATI.lastIndex = 0;
  if (gujarati >= 2 && gujarati > hindi) return "Roman Gujarati";
  if (hindi >= 2 || hindi > gujarati) return "Roman Hindi";
  const detected = canonicalLanguage(detectWritingMode(value));
  return detected || (gujarati ? "Roman Gujarati" : hindi ? "Roman Hindi" : "English");
}

export function styleFormalityOf(text: string): BehavioralStylePolicy["formality"]["value"] {
  const value = String(text || "");
  const formal = value.match(FORMAL)?.length || 0;
  const casual = value.match(CASUAL)?.length || 0;
  FORMAL.lastIndex = 0;
  CASUAL.lastIndex = 0;
  return formal > casual ? "formal" : casual > formal ? "casual" : "neutral";
}

function categoricalCandidate<T extends string>(
  bucket: BehavioralBucket | undefined,
  values: Array<{ value: T; rate: number }>,
  source: StyleEvidenceSource,
  prior: number,
  rationale: string,
): StyleDecision<T> | null {
  const sampleCount = Math.max(0, Number(bucket?.sampleCount || 0));
  if (!sampleCount || !values.length) return null;
  const effectiveSampleSize = Math.max(0, Math.min(sampleCount, Number(bucket?.effectiveSampleSize ?? sampleCount)));
  const ranked = [...values].filter((item) => Number.isFinite(item.rate)).sort((left, right) => right.rate - left.rate);
  if (!ranked.length) return null;
  const dominance = clamp(ranked[0].rate);
  const margin = dominance - clamp(ranked[1]?.rate || 0);
  const evidence = effectiveSampleSize / (effectiveSampleSize + 8);
  const confidence = prior * 0.35 + evidence * 0.35 + dominance * 0.2 + clamp(margin) * 0.1;
  return { value: ranked[0].value, source, confidence: rounded(confidence), sampleCount, effectiveSampleSize, rationale };
}

function languageCandidate(bucket: BehavioralBucket | undefined, source: StyleEvidenceSource, prior: number) {
  const values = (Array.isArray(bucket?.writingModes) ? bucket.writingModes : [])
    .map((item) => ({ value: canonicalLanguage(item?.mode), rate: Number(item?.rate || 0) }))
    .filter((item): item is { value: BehavioralStylePolicy["language"]["value"]; rate: number } => Boolean(item.value));
  return categoricalCandidate(bucket, values, source, prior, "Dominant owner writing mode in the selected evidence tier.");
}

function transitionLanguageCandidate(bucket: BehavioralBucket | undefined, incomingText: string, source: StyleEvidenceSource, prior: number) {
  const incomingMode = canonicalLanguage(detectWritingMode(String(incomingText || "")));
  if (!incomingMode) return null;
  const transition = (Array.isArray(bucket?.replyModesByIncomingMode) ? bucket.replyModesByIncomingMode : [])
    .find((item) => canonicalLanguage(item?.incomingMode) === incomingMode);
  const values = (Array.isArray(transition?.replyModes) ? transition.replyModes : [])
    .map((item) => ({ value: canonicalLanguage(item?.mode), rate: Number(item?.rate || 0), count: Number(item?.count || 0) }))
    .filter((item): item is { value: BehavioralStylePolicy["language"]["value"]; rate: number; count: number } => Boolean(item.value));
  const sampleCount = values.reduce((sum, item) => sum + Math.max(0, item.count), 0);
  if (sampleCount < 4) return null;
  const effectiveSampleSize = Math.max(0, Math.min(sampleCount, Number(transition?.effectiveSampleSize ?? sampleCount)));
  return categoricalCandidate({ ...bucket, sampleCount, effectiveSampleSize }, values, source, prior,
    "Observed owner reply language for this incoming-language context.");
}

function strongerCandidate<T extends StyleDecision<unknown>>(conditional: T | null, dominant: T | null) {
  if (!conditional) return dominant;
  if (!dominant) return conditional;
  // A supported conditional transition is more relevant than a permanent
  // person-wide label, but only when its own posterior confidence is close.
  return conditional.confidence + 0.06 >= dominant.confidence ? conditional : dominant;
}

function lengthCandidate(bucket: BehavioralBucket | undefined, source: StyleEvidenceSource, prior: number) {
  const sampleCount = Math.max(0, Number(bucket?.sampleCount || 0));
  const effectiveSampleSize = Math.max(0, Math.min(sampleCount, Number(bucket?.effectiveSampleSize ?? sampleCount)));
  const targetCharacters = Math.max(0, Math.round(Number(bucket?.medianCharacters || 0)));
  if (!sampleCount || !targetCharacters) return null;
  const listed = (Array.isArray(bucket?.lengthBuckets) ? bucket.lengthBuckets : [])
    .map((item) => ({ value: String(item?.bucket || "") as BehavioralStylePolicy["length"]["value"], rate: Number(item?.rate || 0) }))
    .filter((item) => ["micro", "short", "medium", "long"].includes(item.value));
  const concentration = listed.length ? Math.max(...listed.map((item) => item.rate)) : 0.5;
  const evidence = effectiveSampleSize / (effectiveSampleSize + 8);
  return {
    value: lengthBucketFromCharacters(targetCharacters),
    targetCharacters,
    source,
    confidence: rounded(prior * 0.45 + evidence * 0.4 + clamp(concentration) * 0.15),
    sampleCount,
    effectiveSampleSize,
    rationale: "Median owner reply length in the selected evidence tier.",
  };
}

function formalityCandidate(bucket: BehavioralBucket | undefined, source: StyleEvidenceSource, prior: number) {
  const formal = clamp(Number(bucket?.formalRate || 0));
  const casual = clamp(Number(bucket?.casualRate || 0));
  const neutral = clamp(1 - Math.max(formal, casual));
  return categoricalCandidate(bucket, [
    { value: "formal" as const, rate: formal },
    { value: "casual" as const, rate: casual },
    { value: "neutral" as const, rate: neutral },
  ], source, prior, "Observed owner formality markers in the selected evidence tier.");
}

function emojiCandidate(bucket: BehavioralBucket | undefined, source: StyleEvidenceSource, prior: number) {
  const sampleCount = Math.max(0, Number(bucket?.sampleCount || 0));
  if (!sampleCount) return null;
  const rate = clamp(Number(bucket?.emojiRate || 0));
  const decision = categoricalCandidate(bucket, [
    { value: "use" as const, rate },
    { value: "avoid" as const, rate: 1 - rate },
  ], source, prior, "Observed owner emoji behavior in the selected evidence tier.");
  const palette = Array.isArray(bucket?.emojiPalette)
    ? bucket.emojiPalette.filter((item): item is string => typeof item === "string" && /\p{Extended_Pictographic}/u.test(item)).slice(0, 4)
    : [];
  return decision ? { ...decision, palette } : null;
}

function choose<T extends StyleDecision<unknown>>(
  person: T | null,
  target: T,
  global: T | null,
  minimumPersonSamples: number,
  minimumPersonConfidence: number,
  preferStrongerGlobal = false,
) {
  const personEligible = Boolean(person
    && person.effectiveSampleSize >= minimumPersonSamples
    && person.confidence >= minimumPersonConfidence);
  // Account-wide behavior is allowed only when it is both well-supported and
  // more reliable than mirroring this message. Equality deliberately mirrors.
  const globalEligible = Boolean(global
    && global.effectiveSampleSize >= 12
    && global.confidence >= target.confidence + 0.04);
  if (preferStrongerGlobal && globalEligible && (!personEligible || Number(global?.confidence) >= Number(person?.confidence))) return global as T;
  if (personEligible) return person as T;
  if (globalEligible) return global as T;
  return target;
}

export function selectBehavioralStylePolicy(input: {
  incomingText: string;
  personDNA?: BehavioralDNA;
  ownerGlobalDNA?: BehavioralDNA;
  preferences?: { draftLanguage?: unknown; replyLength?: unknown; formality?: unknown; emoji?: unknown };
}): BehavioralStylePolicy {
  const incomingText = String(input.incomingText || "");
  const targetCharacters = Math.max(1, [...incomingText.trim()].length);
  const targetLanguage: BehavioralStylePolicy["language"] = {
    value: styleLanguageOf(incomingText), source: "target-mirror", confidence: PRIOR_RELIABILITY.language.target,
    sampleCount: 1, effectiveSampleSize: 1, rationale: "Mirror the current message when historical evidence is not stronger.",
  };
  const targetLength: BehavioralStylePolicy["length"] = {
    value: lengthBucketFromCharacters(targetCharacters), targetCharacters, source: "target-mirror", confidence: PRIOR_RELIABILITY.length.target,
    sampleCount: 1, effectiveSampleSize: 1, rationale: "Mirror the current message length when historical evidence is not stronger.",
  };
  const targetFormalityValue = styleFormalityOf(incomingText);
  const targetFormality: BehavioralStylePolicy["formality"] = {
    value: targetFormalityValue, source: "target-mirror",
    confidence: rounded(PRIOR_RELIABILITY.formality.target + (targetFormalityValue === "neutral" ? 0 : 0.15)),
    sampleCount: 1, effectiveSampleSize: 1, rationale: "Mirror explicit formality cues in the current message.",
  };
  const targetHasEmoji = /\p{Extended_Pictographic}/u.test(incomingText);
  const targetEmoji: BehavioralStylePolicy["emoji"] = {
    value: targetHasEmoji ? "use" : "avoid", source: "target-mirror",
    confidence: rounded(PRIOR_RELIABILITY.emoji.target + (targetHasEmoji ? 0.15 : 0)), sampleCount: 1, effectiveSampleSize: 1, palette: [],
    rationale: "Mirror the current message's emoji presence when historical evidence is not stronger.",
  };

  const person = input.personDNA?.active;
  const global = input.ownerGlobalDNA?.global || input.ownerGlobalDNA?.active;
  const personLanguage = strongerCandidate(
    transitionLanguageCandidate(person, incomingText, "exact-person-active", PRIOR_RELIABILITY.language.person),
    languageCandidate(person, "exact-person-active", PRIOR_RELIABILITY.language.person),
  );
  const globalLanguage = strongerCandidate(
    transitionLanguageCandidate(global, incomingText, "owner-global", PRIOR_RELIABILITY.language.global),
    languageCandidate(global, "owner-global", PRIOR_RELIABILITY.language.global),
  );
  let language = choose(personLanguage, targetLanguage, globalLanguage, 3, 0.57);
  let length = choose(lengthCandidate(person, "exact-person-active", PRIOR_RELIABILITY.length.person), targetLength,
    lengthCandidate(global, "owner-global", PRIOR_RELIABILITY.length.global), 4, 0.5);
  // A clear current-message formality cue is relational context, not noise.
  // A clear current cue may be overridden only by supported exact-person
  // evidence. Account-global behavior is backoff for neutral/ambiguous cues.
  let formality = choose(formalityCandidate(person, "exact-person-active", PRIOR_RELIABILITY.formality.person), targetFormality,
    targetFormalityValue === "neutral" ? formalityCandidate(global, "owner-global", PRIOR_RELIABILITY.formality.global) : null, 6, 0.62, true);
  let emoji = choose(emojiCandidate(person, "exact-person-active", PRIOR_RELIABILITY.emoji.person), targetEmoji,
    emojiCandidate(global, "owner-global", PRIOR_RELIABILITY.emoji.global), 8, 0.62);

  const explicitLanguage = canonicalLanguage(input.preferences?.draftLanguage);
  if (explicitLanguage) language = { value: explicitLanguage, source: "explicit-preference", confidence: 1, sampleCount: 0, effectiveSampleSize: 0, rationale: "Explicit conversation preference." };
  const explicitLength = String(input.preferences?.replyLength || "");
  if (["short", "medium"].includes(explicitLength)) {
    const characters = explicitLength === "short" ? 24 : 68;
    length = { value: explicitLength as "short" | "medium", targetCharacters: characters, source: "explicit-preference", confidence: 1, sampleCount: 0, effectiveSampleSize: 0, rationale: "Explicit conversation preference." };
  }
  const explicitFormality = String(input.preferences?.formality || "");
  if (["casual", "neutral", "formal"].includes(explicitFormality)) formality = { value: explicitFormality as BehavioralStylePolicy["formality"]["value"], source: "explicit-preference", confidence: 1, sampleCount: 0, effectiveSampleSize: 0, rationale: "Explicit conversation preference." };
  const explicitEmoji = String(input.preferences?.emoji || "");
  if (["avoid", "use"].includes(explicitEmoji)) emoji = { ...emoji, value: explicitEmoji as "avoid" | "use", source: "explicit-preference", confidence: 1, sampleCount: 0, effectiveSampleSize: 0, rationale: "Explicit conversation preference." };

  return { version: 1, calibration: "hierarchical-prior-v2", language, length, formality, emoji };
}

export function stylePolicyCompatibility(text: string, policy: BehavioralStylePolicy) {
  const value = String(text || "").trim();
  const actualLanguage = styleLanguageOf(value);
  const actualLength = lengthBucketFromCharacters([...value].length);
  const actualFormality = styleFormalityOf(value);
  const actualEmoji = /\p{Extended_Pictographic}/u.test(value) ? "use" : "avoid";
  const order = ["micro", "short", "medium", "long"];
  const lengthDistance = Math.abs(order.indexOf(actualLength) - order.indexOf(policy.length.value));
  return {
    language: actualLanguage === policy.language.value,
    length: lengthDistance === 0,
    formality: actualFormality === policy.formality.value,
    emoji: actualEmoji === policy.emoji.value,
    score: (actualLanguage === policy.language.value ? 4 : 0)
      + (lengthDistance === 0 ? 3 : lengthDistance === 1 ? 1 : 0)
      + (actualFormality === policy.formality.value ? 2 : 0)
      + (actualEmoji === policy.emoji.value ? 1 : 0),
  };
}
