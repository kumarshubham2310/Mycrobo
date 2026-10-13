import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

function text(value) {
  return String(value ?? "");
}

function numeric(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export function resolveAuditChatScope(value, fallback = 150) {
  const normalized = text(value).trim().toLocaleLowerCase();
  if (normalized === "all" || normalized === "*") {
    return { mode: "all-available", maximumChats: Number.MAX_SAFE_INTEGER };
  }
  const requested = normalized ? numeric(normalized) : numeric(fallback);
  return { mode: "bounded-sample", maximumChats: Math.max(10, Math.min(10_000, Math.floor(requested || fallback))) };
}

function compareEvents(left, right) {
  return numeric(left?.timestampMs) - numeric(right?.timestampMs)
    || numeric(left?.sequence) - numeric(right?.sequence)
    || text(left?.chatId).localeCompare(text(right?.chatId))
    || text(left?.id).localeCompare(text(right?.id));
}

function lowerBoundTimestamp(events, timestampMs) {
  let low = 0;
  let high = events.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (numeric(events[middle]?.timestampMs) < timestampMs) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Indexes the immutable history once. A lookup returns only events whose
 * verified timestamp is strictly earlier than the target timestamp and never
 * returns events from the held-out chat. The caller then appends that chat's
 * canonical prefix, which also handles equal-timestamp messages safely.
 */
export function createHistoricalEvidenceIndex(events) {
  const byChat = new Map();
  for (const event of events || []) {
    const chatId = text(event?.chatId);
    if (!chatId) continue;
    const values = byChat.get(chatId) || [];
    values.push(event);
    byChat.set(chatId, values);
  }
  for (const values of byChat.values()) values.sort(compareEvents);
  const orderedChatIds = [...byChat.keys()].sort();
  return {
    eventCount: orderedChatIds.reduce((sum, chatId) => sum + byChat.get(chatId).length, 0),
    eventsStrictlyBefore(timestampMs, excludedChatId) {
      const result = [];
      for (const chatId of orderedChatIds) {
        if (chatId === excludedChatId) continue;
        const values = byChat.get(chatId);
        const end = lowerBoundTimestamp(values, timestampMs);
        for (let index = 0; index < end; index += 1) result.push(values[index]);
      }
      return result;
    },
  };
}

function updateLengthDelimited(hash, value) {
  const normalized = text(value);
  hash.update(String(Buffer.byteLength(normalized, "utf8")));
  hash.update(":");
  hash.update(normalized);
  hash.update(";");
}

/**
 * Produces a one-way revision for safe checkpoint invalidation. Raw text,
 * names, chat ids and message ids never leave this function.
 */
export function contentFreeDatasetRevision({ implementationRevision, settings, cases, events }) {
  const hash = createHash("sha256");
  updateLengthDelimited(hash, "mycrobo-backtest-checkpoint-v1");
  updateLengthDelimited(hash, implementationRevision);
  for (const [key, value] of Object.entries(settings || {}).sort(([left], [right]) => left.localeCompare(right))) {
    updateLengthDelimited(hash, key);
    updateLengthDelimited(hash, value);
  }
  for (const event of events || []) {
    updateLengthDelimited(hash, event?.chatId);
    updateLengthDelimited(hash, event?.id);
    updateLengthDelimited(hash, event?.timestampMs);
    updateLengthDelimited(hash, event?.sequence);
    updateLengthDelimited(hash, event?.direction);
    // Text is hashed into the outer digest so edits invalidate a checkpoint;
    // it is never written to the checkpoint or report.
    updateLengthDelimited(hash, event?.text);
  }
  for (const item of cases || []) {
    updateLengthDelimited(hash, item?.chat?.id);
    updateLengthDelimited(hash, item?.target?.id);
    updateLengthDelimited(hash, item?.target?.timestampMs);
    updateLengthDelimited(hash, item?.actualReply);
  }
  return hash.digest("hex");
}

function stableRank(seed, value) {
  const hash = createHash("sha256");
  updateLengthDelimited(hash, seed);
  updateLengthDelimited(hash, value);
  return hash.digest("hex");
}

export function frozenPartitionForChat(chatId, seed = "mycrobo-contact-split-v1") {
  const byte = Number.parseInt(stableRank(seed, text(chatId)).slice(0, 8), 16);
  return byte % 5 === 0 ? "calibration" : "evaluation";
}

/** Deterministic arm order kept outside the packet shown to the owner. */
export function ownerBlindArmAssignment(caseFingerprint, seed = "mycrobo-owner-blind-v1") {
  if (!/^[a-f0-9]{64}$/u.test(text(caseFingerprint))) throw new Error("Owner-blind assignment requires a content-free case fingerprint.");
  const personalizedArm = Number.parseInt(stableRank(seed, caseFingerprint).slice(0, 2), 16) % 2 === 0 ? "A" : "B";
  return { personalizedArm, baselineArm: personalizedArm === "A" ? "B" : "A" };
}

const OWNER_BLIND_RATING_KEYS = new Set([
  "caseFingerprint", "chatAuditId", "preferredArm", "armA", "armB", "raterType", "blindingConfirmed",
]);
const OWNER_BLIND_ARM_KEYS = new Set([
  "editBurden", "storyCorrect", "languageRegisterCorrect", "personSpecific", "safe", "generic",
]);
const OWNER_BLIND_EDIT_BURDEN = new Set(["send-as-is", "light-edit", "major-rewrite", "reject"]);
const OWNER_BLIND_PREFERENCE = new Set(["A", "B", "tie", "neither"]);

function validOwnerBlindRating(row, binding) {
  const validArm = (arm) => plainObject(arm)
    && Object.keys(arm).length === OWNER_BLIND_ARM_KEYS.size
    && Object.keys(arm).every((key) => OWNER_BLIND_ARM_KEYS.has(key))
    && OWNER_BLIND_EDIT_BURDEN.has(arm.editBurden)
    && ["storyCorrect", "languageRegisterCorrect", "personSpecific", "safe", "generic"]
      .every((key) => typeof arm[key] === "boolean");
  return plainObject(row)
    && Object.keys(row).length === OWNER_BLIND_RATING_KEYS.size
    && Object.keys(row).every((key) => OWNER_BLIND_RATING_KEYS.has(key))
    && row.caseFingerprint === binding?.caseFingerprint
    && row.chatAuditId === binding?.chatAuditId
    && OWNER_BLIND_PREFERENCE.has(row.preferredArm)
    && row.raterType === "owner"
    && row.blindingConfirmed === true
    && validArm(row.armA)
    && validArm(row.armB);
}

/**
 * Unblinds owner ratings in memory and returns aggregate, content-free release
 * evidence. It deliberately cannot accept message/draft text, names or
 * provider identifiers. Every available chat must be represented before the
 * coverage gate can pass.
 */
export function summarizeOwnerBlindedPersonalization({
  ratings,
  expectedBindings,
  availableChatAuditIds,
  assignmentSeed = "mycrobo-owner-blind-v1",
  minimumRatedCases = 200,
}) {
  if (!Array.isArray(ratings) || !Array.isArray(expectedBindings) || !Array.isArray(availableChatAuditIds)) {
    throw new Error("Owner-blind evaluation requires ratings, bindings and the complete available-chat audit list.");
  }
  if (expectedBindings.some((binding) => !plainObject(binding)
    || Object.keys(binding).length !== 2
    || !Object.hasOwn(binding, "caseFingerprint")
    || !Object.hasOwn(binding, "chatAuditId")
    || !/^[a-f0-9]{64}$/u.test(text(binding.caseFingerprint))
    || !/^chat-\d{3,6}$/u.test(text(binding.chatAuditId)))) {
    throw new Error("Owner-blind bindings must contain content-free fingerprints and audit ids only.");
  }
  const bindingByFingerprint = new Map(expectedBindings.map((binding) => [binding?.caseFingerprint, binding]));
  const seen = new Set();
  const validated = ratings.map((row) => {
    const binding = bindingByFingerprint.get(row?.caseFingerprint);
    if (!validOwnerBlindRating(row, binding) || seen.has(row.caseFingerprint)) {
      throw new Error("Refusing owner ratings that are duplicate, unbound or contain non-content-free fields.");
    }
    seen.add(row.caseFingerprint);
    const assignment = ownerBlindArmAssignment(row.caseFingerprint, assignmentSeed);
    return {
      chatAuditId: row.chatAuditId,
      preferredArm: row.preferredArm,
      personalizedRating: assignment.personalizedArm === "A" ? row.armA : row.armB,
      personalizedPreferred: row.preferredArm === assignment.personalizedArm,
      baselinePreferred: row.preferredArm === assignment.baselineArm,
    };
  });
  const uniqueAvailableChats = [...new Set(availableChatAuditIds.map(text).filter((value) => /^chat-\d{3,6}$/u.test(value)))];
  if (uniqueAvailableChats.length !== new Set(availableChatAuditIds).size) {
    throw new Error("Available-chat coverage must use unique content-free chat audit ids.");
  }
  const ratedChats = new Set(validated.map((row) => row.chatAuditId));
  if ([...ratedChats].some((id) => !uniqueAvailableChats.includes(id))) {
    throw new Error("An owner rating refers to a chat outside the declared available-chat universe.");
  }
  const ratio = (count, total = validated.length) => total ? Number((count / total).toFixed(4)) : 0;
  const coverage = ratio(ratedChats.size, uniqueAvailableChats.length);
  const thresholds = {
    availableChatCoverage: 1,
    minimumRatedCases: Math.max(1, Math.floor(numeric(minimumRatedCases))),
    personalizedPreference: 0.65,
    sendableOrLightEdit: 0.75,
    majorRewriteOrRejectMaximum: 0.15,
    storyCorrect: 0.9,
    languageRegisterCorrect: 0.9,
    personSpecific: 0.75,
    safety: 1,
    genericMaximum: 0.05,
  };
  const metrics = {
    availableChatCoverage: coverage,
    personalizedPreference: ratio(validated.filter((row) => row.personalizedPreferred).length),
    baselinePreference: ratio(validated.filter((row) => row.baselinePreferred).length),
    ties: ratio(validated.filter((row) => row.preferredArm === "tie").length),
    neither: ratio(validated.filter((row) => row.preferredArm === "neither").length),
    sendableOrLightEdit: ratio(validated.filter((row) => ["send-as-is", "light-edit"].includes(row.personalizedRating.editBurden)).length),
    majorRewriteOrReject: ratio(validated.filter((row) => ["major-rewrite", "reject"].includes(row.personalizedRating.editBurden)).length),
    storyCorrect: ratio(validated.filter((row) => row.personalizedRating.storyCorrect).length),
    languageRegisterCorrect: ratio(validated.filter((row) => row.personalizedRating.languageRegisterCorrect).length),
    personSpecific: ratio(validated.filter((row) => row.personalizedRating.personSpecific).length),
    safety: ratio(validated.filter((row) => row.personalizedRating.safe).length),
    generic: ratio(validated.filter((row) => row.personalizedRating.generic).length),
  };
  const evidenceComplete = validated.length >= thresholds.minimumRatedCases && coverage === 1;
  const failures = [
    metrics.personalizedPreference < thresholds.personalizedPreference ? "personalized-preference" : null,
    metrics.sendableOrLightEdit < thresholds.sendableOrLightEdit ? "edit-burden" : null,
    metrics.majorRewriteOrReject > thresholds.majorRewriteOrRejectMaximum ? "rewrite-rate" : null,
    metrics.storyCorrect < thresholds.storyCorrect ? "story" : null,
    metrics.languageRegisterCorrect < thresholds.languageRegisterCorrect ? "language-register" : null,
    metrics.personSpecific < thresholds.personSpecific ? "person-specificity" : null,
    metrics.safety < thresholds.safety ? "safety" : null,
    metrics.generic > thresholds.genericMaximum ? "genericity" : null,
  ].filter(Boolean);
  return {
    schemaVersion: 1,
    method: "owner-blinded-randomized-two-arm-all-available-chat-evaluation",
    ratedCases: validated.length,
    availableChats: uniqueAvailableChats.length,
    ratedChats: ratedChats.size,
    metrics,
    thresholds,
    gate: {
      status: evidenceComplete ? (failures.length ? "failed" : "passed") : "blocked",
      failures,
      blockers: [
        validated.length < thresholds.minimumRatedCases ? "minimum-owner-rated-cases-not-met" : null,
        coverage < 1 ? "not-every-available-chat-is-represented" : null,
      ].filter(Boolean),
    },
    containsRawContent: false,
    containsChatOrMessageIdentifiers: false,
    claim: "Owner ratings are necessary release evidence; this aggregate does not prove full WhatsApp history availability.",
  };
}

export function selectFrozenItems(items, options = {}) {
  const seed = text(options.seed || "mycrobo-frozen-items-v1");
  const maximum = Math.max(0, Math.floor(numeric(options.maximum)));
  const keyOf = typeof options.keyOf === "function" ? options.keyOf : (item) => item?.id;
  const ranked = (items || []).map((item) => {
    const key = text(keyOf(item));
    return { item, key, rank: stableRank(seed, key) };
  }).filter((entry) => entry.key)
    .sort((left, right) => left.rank.localeCompare(right.rank) || left.key.localeCompare(right.key));
  const selected = ranked.slice(0, maximum);
  const hash = createHash("sha256");
  updateLengthDelimited(hash, "mycrobo-frozen-item-sample-v1");
  updateLengthDelimited(hash, seed);
  for (const entry of selected) updateLengthDelimited(hash, entry.key);
  return { selected: selected.map((entry) => entry.item), manifestHash: hash.digest("hex"), universeCount: ranked.length };
}

const SAMPLE_DIMENSIONS = Object.freeze(["archiveState", "language", "incomingIntent", "historyDepth", "relationship"]);

function stratumKey(item) {
  return SAMPLE_DIMENSIONS.map((dimension) => `${dimension}=${text(item?.sampleTraits?.[dimension] || "unknown")}`).join("|");
}

function caseKey(item) {
  return [item?.chat?.id, item?.target?.id, item?.target?.timestampMs, item?.targetIndex].map(text).join("\u001f");
}

export function contentFreeCaseBinding(item) {
  return {
    caseFingerprint: createHash("sha256").update(caseKey(item)).digest("hex"),
    chatAuditId: text(item?.auditId),
  };
}

function traitCounts(items) {
  return Object.fromEntries(SAMPLE_DIMENSIONS.map((dimension) => {
    const counts = new Map();
    for (const item of items) {
      const value = text(item?.sampleTraits?.[dimension] || "unknown");
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    return [dimension, Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right)))];
  }));
}

/**
 * Creates a deterministic, contact-separated sample. The first pass covers
 * every available marginal stratum where capacity permits; the second pass
 * round-robins composite strata, so a large majority bucket cannot consume
 * the entire audit. Hash ordering avoids newest-only or list-tail selection.
 */
export function selectFrozenStratifiedCases(cases, options = {}) {
  const seed = text(options.seed || "mycrobo-stratified-holdout-v1");
  // Keep contact assignment frozen while allowing a preregistered selection
  // revision to draw a fresh untouched window from the same partition.
  const selectionSeed = text(options.selectionSeed || seed);
  const partition = options.partition === "calibration" ? "calibration" : "evaluation";
  const maximumCases = Math.max(1, Math.floor(numeric(options.maximumCases) || 1));
  const offsetCases = Math.max(0, Math.floor(numeric(options.offsetCases)));
  const selectionLimit = maximumCases + offsetCases;
  const universe = (cases || []).map((item) => ({
    item,
    key: caseKey(item),
    rank: stableRank(selectionSeed, caseKey(item)),
    partition: frozenPartitionForChat(item?.sampleSplitKey || item?.chat?.id, `${seed}:contact-split`),
    stratum: stratumKey(item),
  }));
  const eligible = universe.filter((entry) => entry.partition === partition)
    .sort((left, right) => left.rank.localeCompare(right.rank) || left.key.localeCompare(right.key));
  const selected = [];
  const selectedKeys = new Set();
  const missing = new Map(SAMPLE_DIMENSIONS.map((dimension) => [dimension,
    new Set(eligible.map((entry) => text(entry.item?.sampleTraits?.[dimension] || "unknown")))]));

  while (selected.length < selectionLimit && [...missing.values()].some((values) => values.size)) {
    let best = null;
    let bestGain = 0;
    for (const entry of eligible) {
      if (selectedKeys.has(entry.key)) continue;
      const gain = SAMPLE_DIMENSIONS.reduce((sum, dimension) => sum
        + (missing.get(dimension).has(text(entry.item?.sampleTraits?.[dimension] || "unknown")) ? 1 : 0), 0);
      if (gain > bestGain || (gain === bestGain && gain > 0 && (!best || entry.rank < best.rank))) {
        best = entry;
        bestGain = gain;
      }
    }
    if (!best || bestGain === 0) break;
    selected.push(best);
    selectedKeys.add(best.key);
    for (const dimension of SAMPLE_DIMENSIONS) missing.get(dimension).delete(text(best.item?.sampleTraits?.[dimension] || "unknown"));
  }

  const groups = new Map();
  for (const entry of eligible) {
    if (selectedKeys.has(entry.key)) continue;
    const values = groups.get(entry.stratum) || [];
    values.push(entry);
    groups.set(entry.stratum, values);
  }
  const groupKeys = [...groups.keys()].sort((left, right) => stableRank(`${selectionSeed}:strata`, left).localeCompare(stableRank(`${selectionSeed}:strata`, right)));
  let round = 0;
  while (selected.length < selectionLimit) {
    let added = false;
    for (const key of groupKeys) {
      const entry = groups.get(key)?.[round];
      if (!entry) continue;
      selected.push(entry);
      selectedKeys.add(entry.key);
      added = true;
      if (selected.length >= selectionLimit) break;
    }
    if (!added) break;
    round += 1;
  }

  const window = selected.slice(offsetCases, offsetCases + maximumCases);
  const chosen = window.map((entry) => entry.item);
  const manifestHash = createHash("sha256");
  updateLengthDelimited(manifestHash, "mycrobo-content-free-sample-manifest-v1");
  updateLengthDelimited(manifestHash, seed);
  updateLengthDelimited(manifestHash, selectionSeed);
  updateLengthDelimited(manifestHash, partition);
  updateLengthDelimited(manifestHash, offsetCases);
  for (const entry of window) {
    updateLengthDelimited(manifestHash, entry.key);
    updateLengthDelimited(manifestHash, entry.stratum);
  }
  const selectedCounts = traitCounts(chosen);
  const eligibleCounts = traitCounts(eligible.map((entry) => entry.item));
  const entries = chosen.map((item, index) => ({
    ordinal: index + 1,
    ...Object.fromEntries(SAMPLE_DIMENSIONS.map((dimension) => [dimension, text(item?.sampleTraits?.[dimension] || "unknown")])),
  }));
  return {
    selected: chosen,
    manifest: {
      schemaVersion: 1,
      manifestHash: manifestHash.digest("hex"),
      seed,
      selectionSeed,
      offsetCases,
      partition,
      splitUnit: "canonical-person-when-available-else-chat",
      splitRule: "sha256-modulo-5; one calibration partition and four evaluation partitions",
      selectionRule: "marginal-coverage-first, then deterministic composite-stratum round-robin, then preregistered non-overlapping window",
      dimensions: [...SAMPLE_DIMENSIONS],
      universeCases: universe.length,
      eligibleCases: eligible.length,
      selectedCases: chosen.length,
      eligibleTraitCounts: eligibleCounts,
      selectedTraitCounts: selectedCounts,
      entries,
      containsRawContent: false,
      containsChatOrMessageIdentifiers: false,
    },
  };
}

export async function implementationRevision(urls) {
  const hash = createHash("sha256");
  for (const url of urls || []) {
    updateLengthDelimited(hash, text(url));
    updateLengthDelimited(hash, await readFile(url, "utf8"));
  }
  return hash.digest("hex");
}

const RESULT_KEYS = new Set([
  "caseFingerprint", "chatAuditId", "relationship", "scenarioCode", "toneStage", "intent",
  "predictedAct", "actualAct", "actualActs", "behaviorCompatible", "rawSingleReferenceIntent",
  "answerableIntent", "safeAbstention", "accepted", "conversationScore", "accountBaselineScore",
  "neutralScore", "metrics", "predictedMode", "actualMode", "targetMode", "languageStrategies",
  "predictedLength", "actualLength", "targetLength", "lengthStrategies", "predictedWarmth",
  "actualWarmth", "predictedFormality", "actualFormality", "targetFormality", "formalityStrategies",
  "predictedEmoji", "actualEmoji", "dnaEvidenceTier", "requiredFacts", "safeFactHandling",
  "privateDraftFingerprint", "genericDraft", "errorCategory", "evaluationReasons",
  "evaluationBlockingReasons", "evaluationCandidateShapes", "generationError",
]);
const FAILURE_KEYS = new Set([
  "caseFingerprint", "chatAuditId", "relationship", "scenarioCode", "toneStage", "intent",
  "errorCategory", "evaluationReasons", "evaluationBlockingReasons", "evaluationCandidateShapes",
  "requiredFacts", "generationError", "behaviorCompatible", "rawSingleReferenceIntent",
  "answerableIntent", "safeAbstention", "accepted", "conversationScore", "accountBaselineScore",
  "neutralScore", "metrics", "safeFactHandling",
]);
const SUCCESS_KEYS = new Set([...RESULT_KEYS].filter((key) => !new Set([
  "errorCategory", "evaluationReasons", "evaluationBlockingReasons", "evaluationCandidateShapes", "generationError",
]).has(key)));
const METRIC_KEYS = new Set(["intent", "language", "brevity", "warmth", "formality", "emojiBehavior", "commitmentSafety", "storyUnderstanding", "crossContactLeakage"]);
const STRATEGY_KEYS = {
  languageStrategies: new Set(["incomingMirror", "activeDominant", "activeTransition", "globalDominant", "globalTransition"]),
  lengthStrategies: new Set(["incomingMirror", "activeDominant", "activeMedian", "globalDominant", "globalMedian"]),
  formalityStrategies: new Set(["incomingMirror", "activeBehavior", "globalBehavior"]),
};
const MODES = new Set(["English", "Mixed", "Roman Gujarati", "Roman Hindi"]);
const LENGTHS = new Set(["micro", "short", "medium", "long"]);
const FORMALITIES = new Set(["casual", "neutral", "formal"]);
const WARMTH = new Set(["neutral", "light", "warm"]);
const EMOJI = new Set(["none", "single", "multiple"]);
const RELATIONSHIPS = new Set(["family", "close-friend", "friend", "colleague", "manager", "client", "vendor", "community", "acquaintance", "unknown"]);
const TONE_STAGES = new Set(["learning", "developing", "established", "unknown"]);
const INTENTS = new Set([
  "acknowledgement", "activity-question", "affection", "apology", "arrival-update", "availability-question",
  "action-request", "call", "check-request", "choice-question", "departure-update", "emoji", "greeting",
  "intro-question", "nothing-response", "open-question", "problem", "send-request", "shared-link", "statement",
  "thanks", "timed-update", "update-request", "wellbeing-question", "when-question", "where-question",
  "why-question", "wish", "generation-error", "unknown",
]);
const RESPONSE_ACTS = new Set(["acknowledgement", "affection", "apology", "commitment", "decline", "emoji", "greeting", "information", "question", "thanks-response", "needs-owner-fact", "unknown"]);
const DNA_TIERS = new Set(["active-4+", "active-2-3", "active-1", "global-only", "unknown"]);
const FACTS = new Set(["availability", "commitment", "date", "location", "status", "time"]);
const ERROR_CATEGORIES = new Set(["candidate-evaluator-rejection", "target-verification", "reply-necessity", "history-or-target", "other-generation-error"]);
const EVALUATOR_REASONS = new Set([
  "credential-material", "assistant-language", "historical-content-replay", "affection-generic-ack",
  "action-generic-ack", "stock-acknowledgement", "foreign-evidence", "missing-current-fact",
  "invented-current-commitment", "invented-number", "invented-time-reference", "missing-target-evidence",
  "reply-length-mismatch", "unsupported-location", "unsupported-availability", "unsupported-approval",
  "unsupported-payment", "unsupported-status", "unsupported-relationship", "no-valid-candidate",
  "other-evaluator-rejection",
]);
const FAILED_GATES = new Set(["audience", "factuality", "freshness", "scope"]);

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function boundedNumber(value) {
  return Number.isFinite(value) && Math.abs(value) <= 10_000;
}

function enumArray(value, allowed, maximum = 20) {
  return Array.isArray(value) && value.length <= maximum && value.every((item) => allowed.has(item));
}

function strategyObject(value, allowedKeys, allowedValues) {
  return plainObject(value)
    && Object.keys(value).every((key) => allowedKeys.has(key))
    && Object.values(value).every((item) => item === null || item === undefined || allowedValues.has(item));
}

function validRequiredFacts(value) {
  if (value === "none" || value === "unknown") return true;
  if (typeof value !== "string") return false;
  const values = value.split("+");
  return values.length > 0 && values.length <= FACTS.size && new Set(values).size === values.length
    && values.every((item) => FACTS.has(item)) && [...values].sort().join("+") === value;
}

function validCandidateShape(value) {
  if (value === "invalid-shape") return true;
  if (typeof value !== "string") return false;
  const [act, slot, gates, extra] = value.split(":");
  if (extra !== undefined || !RESPONSE_ACTS.has(act) || !new Set(["slot", "no-slot"]).has(slot)) return false;
  if (gates === "passed") return true;
  const failed = gates.split("+");
  return failed.length > 0 && failed.length <= FAILED_GATES.size && new Set(failed).size === failed.length && failed.every((item) => FAILED_GATES.has(item));
}

function validCheckpointResult(row, binding) {
  if (!plainObject(row) || Object.keys(row).some((key) => !RESULT_KEYS.has(key))) return false;
  if (row.caseFingerprint !== binding?.caseFingerprint || row.chatAuditId !== binding?.chatAuditId) return false;
  if (!/^[a-f0-9]{64}$/u.test(row.caseFingerprint) || !/^chat-\d{3,6}$/u.test(row.chatAuditId)) return false;
  if (!RELATIONSHIPS.has(row.relationship) || !TONE_STAGES.has(row.toneStage) || !INTENTS.has(row.intent) || !validRequiredFacts(row.requiredFacts)) return false;
  if (!(row.scenarioCode === "unknown" || /^C(?:0[1-9]|1[0-5])\.S(?:0[1-9]|10)\.T(?:0[1-9]|10)$/u.test(row.scenarioCode))) return false;
  if (!plainObject(row.metrics) || Object.keys(row.metrics).length !== METRIC_KEYS.size
    || Object.keys(row.metrics).some((key) => !METRIC_KEYS.has(key)) || Object.values(row.metrics).some((item) => typeof item !== "boolean")) return false;
  for (const key of ["accepted", "safeFactHandling"]) if (typeof row[key] !== "boolean") return false;
  for (const key of ["conversationScore", "accountBaselineScore", "neutralScore"]) if (!boundedNumber(row[key])) return false;
  if (row.generationError === true) {
    if (Object.keys(row).length !== FAILURE_KEYS.size || Object.keys(row).some((key) => !FAILURE_KEYS.has(key))) return false;
    if (!ERROR_CATEGORIES.has(row.errorCategory)
      || !enumArray(row.evaluationReasons, EVALUATOR_REASONS)
      || !enumArray(row.evaluationBlockingReasons, EVALUATOR_REASONS)
      || !Array.isArray(row.evaluationCandidateShapes) || row.evaluationCandidateShapes.length > 20
      || !row.evaluationCandidateShapes.every(validCandidateShape)) return false;
    return row.behaviorCompatible === false && row.rawSingleReferenceIntent === false
      && row.answerableIntent === false && row.safeAbstention === false && row.accepted === false;
  }
  if (row.generationError !== undefined) return false;
  if (Object.keys(row).length !== SUCCESS_KEYS.size || Object.keys(row).some((key) => !SUCCESS_KEYS.has(key))) return false;
  if (!RESPONSE_ACTS.has(row.predictedAct) || !RESPONSE_ACTS.has(row.actualAct) || !DNA_TIERS.has(row.dnaEvidenceTier)) return false;
  if (!enumArray(row.actualActs, RESPONSE_ACTS, 10)) return false;
  for (const key of ["behaviorCompatible", "rawSingleReferenceIntent", "safeAbstention", "genericDraft"]) if (typeof row[key] !== "boolean") return false;
  if (!(typeof row.answerableIntent === "boolean" || row.answerableIntent === null)) return false;
  if (![row.predictedMode, row.actualMode, row.targetMode].every((item) => MODES.has(item))) return false;
  if (![row.predictedLength, row.actualLength, row.targetLength].every((item) => LENGTHS.has(item))) return false;
  if (![row.predictedWarmth, row.actualWarmth].every((item) => WARMTH.has(item))) return false;
  if (![row.predictedFormality, row.actualFormality, row.targetFormality].every((item) => FORMALITIES.has(item))) return false;
  if (![row.predictedEmoji, row.actualEmoji].every((item) => EMOJI.has(item))) return false;
  if (!strategyObject(row.languageStrategies, STRATEGY_KEYS.languageStrategies, MODES)) return false;
  if (!strategyObject(row.lengthStrategies, STRATEGY_KEYS.lengthStrategies, LENGTHS)) return false;
  if (!strategyObject(row.formalityStrategies, STRATEGY_KEYS.formalityStrategies, FORMALITIES)) return false;
  return /^[a-f0-9]{64}$/u.test(row.privateDraftFingerprint);
}

export function validateContentFreeResultPrefix(results, expectedBindings) {
  if (!Array.isArray(results) || !Array.isArray(expectedBindings) || results.length > expectedBindings.length) return false;
  const seen = new Set();
  return results.every((row, index) => {
    if (!validCheckpointResult(row, expectedBindings[index]) || seen.has(row.caseFingerprint)) return false;
    seen.add(row.caseFingerprint);
    return true;
  });
}

function validCheckpoint(value, expectedRevision, expectedBindings) {
  return value
    && value.schemaVersion === 1
    && value.method === "leak-free-three-arm-conversation-wide-chronological-pre-reply-holdout"
    && value.datasetRevision === expectedRevision
    && validateContentFreeResultPrefix(value.results, expectedBindings);
}

export async function loadContentFreeCheckpoint(path, expectedRevision, expectedBindings) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return validCheckpoint(parsed, expectedRevision, expectedBindings) ? parsed.results : [];
  } catch {
    return [];
  }
}

/** Writes only anonymised evaluation records already eligible for the report. */
export async function writeContentFreeCheckpoint(path, datasetRevision, results, progress = {}, expectedBindings = []) {
  if (!validateContentFreeResultPrefix(results, expectedBindings)) throw new Error("Refusing to write an unbound or non-content-free backtest checkpoint.");
  const payload = {
    schemaVersion: 1,
    method: "leak-free-three-arm-conversation-wide-chronological-pre-reply-holdout",
    datasetRevision,
    completedCases: results.length,
    progress: {
      totalCases: numeric(progress.totalCases),
      elapsedMs: numeric(progress.elapsedMs),
    },
    results,
  };
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}
