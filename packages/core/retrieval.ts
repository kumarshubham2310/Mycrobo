import { isHumanText, orderedEvents } from "./conversation.ts";
import { classifyIncomingIntent, classifyResponseAct, type IncomingIntent, type ResponseAct } from "./behavioral-dna.ts";
import type { CanonicalChat, MessageEvent } from "./domain.ts";
import { buildChatRelationshipProfile, detectWritingMode, type PersonRelationshipModel } from "./relationship.ts";
import { isSafeLexicalToneExample } from "./tone.ts";

export type RetrievalTier = "current-conversation" | "same-person" | "shared-group" | "same-relationship" | "general-owner-tone";
export type RetrievalUse = "conversation-fact" | "analogy-only" | "style-only";

export type RetrievalItem = {
  eventId: string;
  chatId: string;
  text: string;
  timestampMs: number;
  direction: MessageEvent["direction"];
  tier: RetrievalTier;
  use: RetrievalUse;
  factEligible: boolean;
  similarity: number;
  /** Similarity of the live incoming turn to the historical incoming turn. */
  incomingSimilarity: number;
  /** Similarity of the conversation before each compared incoming turn. */
  precedingStorySimilarity: number;
  /** Similarity after combining the preceding story and incoming turn. */
  wholeStorySimilarity: number;
  incomingIntent: IncomingIntent;
  responseAct: ResponseAct | null;
  intentMatched: boolean;
  score: number;
  effectiveSampleSize: number;
  planProbability: number;
  reliability: number;
  rankReason: string;
  privacy: {
    sourceParticipantIds: string[];
    targetPersonWasParticipant: boolean;
    sensitiveValueRedacted: boolean;
  };
};

export interface SemanticEncoder {
  encode(text: string): Map<string, number>;
}

const CONCEPTS: Record<string, string[]> = {
  acknowledgement: ["ack", "acha", "accha", "barabar", "done", "got", "haa", "haan", "ha", "okay", "ok", "theek", "thik", "yes"],
  availability: ["available", "free", "khali", "navro", "navri"],
  confirm: ["bata", "batao", "confirm", "janav", "reply", "tell", "update"],
  departure: ["chhod", "depart", "leave", "leaving", "left", "nikal", "nikali", "nikla", "nikli", "niklunga", "niklungi"],
  home: ["ghar", "home"],
  location: ["jagah", "kahan", "kidhar", "kyan", "location", "where"],
  meeting: ["meet", "meeting", "malishu", "milo"],
  office: ["kaam", "kam", "office", "work"],
  rain: ["baarish", "barish", "rain", "varsad", "વરસાદ", "बारिश"],
  send: ["bhej", "bhejo", "mokl", "mokli", "moklo", "send", "share"],
  time: ["baje", "kab", "ketla", "kyare", "samay", "time", "vag", "vagye", "when"],
  tomorrow: ["kal", "tomorrow"],
};

const TOKEN_TO_CONCEPT = new Map<string, string>();
for (const [concept, tokens] of Object.entries(CONCEPTS)) for (const token of tokens) TOKEN_TO_CONCEPT.set(token, concept);
const SECRET = /\b(?:cvv|one[ -]?time password|otp|passcode|password|pin)\b[^\n]{0,80}|\b\d{4,8}\b(?=\s*(?:is|hai|chhe)?\s*(?:the\s*)?(?:otp|code|pin|password)\b)/giu;

function normalizeTokens(text: string) {
  return text.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function stems(token: string) {
  const values = new Set([token]);
  for (const suffix of ["ing", "ed", "es", "s", "unga", "ungi", "ega", "egi", "o", "i"]) {
    if (token.length > suffix.length + 3 && token.endsWith(suffix)) values.add(token.slice(0, -suffix.length));
  }
  return values;
}

export class DeterministicMultilingualEncoder implements SemanticEncoder {
  encode(text: string) {
    const vector = new Map<string, number>();
    const add = (key: string, weight: number) => vector.set(key, (vector.get(key) ?? 0) + weight);
    for (const token of normalizeTokens(text)) {
      add(`token:${token}`, 1);
      for (const stem of stems(token)) {
        const concept = TOKEN_TO_CONCEPT.get(stem);
        if (concept) add(`concept:${concept}`, 2.5);
      }
      const padded = `_${token}_`;
      for (let index = 0; index <= padded.length - 3; index += 1) add(`tri:${padded.slice(index, index + 3)}`, 0.08);
    }
    return vector;
  }
}

type PreparedSemanticVector = {
  vector: Map<string, number>;
  norm: number;
};

function prepareSemanticText(text: string, encoder: SemanticEncoder): PreparedSemanticVector {
  const vector = encoder.encode(text);
  let squaredNorm = 0;
  for (const value of vector.values()) squaredNorm += value * value;
  return { vector, norm: Math.sqrt(squaredNorm) };
}

function preparedSemanticSimilarity(left: PreparedSemanticVector, right: PreparedSemanticVector) {
  if (!left.norm || !right.norm) return 0;
  // Iterate over the smaller vector. This is material for long conversation
  // stories and leaves the deterministic cosine result unchanged.
  const [smaller, larger] = left.vector.size <= right.vector.size
    ? [left.vector, right.vector]
    : [right.vector, left.vector];
  let dot = 0;
  for (const [key, value] of smaller) dot += value * (larger.get(key) ?? 0);
  return Number((dot / (left.norm * right.norm)).toFixed(6));
}

function prepareSemanticVariants(values: string[], encoder: SemanticEncoder, limit: number) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
    .slice(0, limit)
    .map((value) => prepareSemanticText(value, encoder));
}

function preparedSimilarityAcrossVariants(left: PreparedSemanticVector[], right: PreparedSemanticVector) {
  if (!left.length || !right.norm) return 0;
  let maximum = 0;
  for (const variant of left) maximum = Math.max(maximum, preparedSemanticSimilarity(variant, right));
  return maximum;
}

export function semanticSimilarity(left: string, right: string, encoder: SemanticEncoder = new DeterministicMultilingualEncoder()) {
  return preparedSemanticSimilarity(
    prepareSemanticText(left, encoder),
    prepareSemanticText(right, encoder),
  );
}

/**
 * Compares multiple local-only renderings of the same meaning without
 * concatenating them into one vector. Concatenation diluted short Roman-script
 * turns whenever a local English translation was appended to the query. The
 * maximum is safe here because every variant belongs to the same current turn;
 * callers may not pass cross-chat text as a variant.
 */
export function semanticSimilarityAcrossVariants(
  leftVariants: string[],
  right: string,
  encoder: SemanticEncoder = new DeterministicMultilingualEncoder(),
) {
  const variants = prepareSemanticVariants(leftVariants, encoder, 4);
  if (!variants.length || !String(right || "").trim()) return 0;
  return preparedSimilarityAcrossVariants(variants, prepareSemanticText(right, encoder));
}

function sanitizeSensitiveText(text: string) {
  let redacted = false;
  const sanitized = text.replace(SECRET, () => {
    redacted = true;
    return "[Sensitive value redacted]";
  });
  return { text: sanitized, redacted };
}

function styleDescriptor(text: string) {
  const characters = [...text].length;
  const length = characters <= 12 ? "very short" : characters <= 40 ? "short" : characters <= 100 ? "medium" : "long";
  const signals = [
    detectWritingMode(text),
    length,
    /\p{Extended_Pictographic}/u.test(text) ? "uses emoji" : "no emoji",
    text.includes("?") ? "asks a question" : null,
    text.includes("!") ? "uses emphasis" : null,
    /\b(?:bhai|bro|boss|sir|ma'am|madam|yaar|didi|bhaiya|ji)\b/iu.test(text) ? "uses an address form" : null,
  ].filter(Boolean);
  return `[Style evidence: ${signals.join("; ")}]`;
}

const TIER_BASE: Record<RetrievalTier, number> = {
  "current-conversation": 500,
  "same-person": 400,
  "shared-group": 300,
  "same-relationship": 200,
  "general-owner-tone": 100,
};

const SEMANTIC_STORY_EVENT_LIMIT = 12;
const SEMANTIC_STORY_CHARACTER_LIMIT = 2_400;

function verifiedHumanEvents(events: MessageEvent[]) {
  return orderedEvents(events).filter((event): event is MessageEvent & { timestampMs: number } =>
    event.timestampVerified && event.timestampMs !== null && isHumanText(event));
}

/**
 * Produces a small semantic story rather than an unbounded transcript. The
 * terminal event is always retained; older turns are trimmed from the front.
 */
function boundedSemanticStory(events: MessageEvent[]) {
  const recent = events.slice(-SEMANTIC_STORY_EVENT_LIMIT).map((event) => event.text.trim()).filter(Boolean);
  let value = recent.join("\n");
  if ([...value].length <= SEMANTIC_STORY_CHARACTER_LIMIT) return value;
  value = [...value].slice(-SEMANTIC_STORY_CHARACTER_LIMIT).join("");
  const firstBreak = value.indexOf("\n");
  return firstBreak >= 0 ? value.slice(firstBreak + 1) : value;
}

function isTargetParticipant(chat: CanonicalChat, targetPersonId: string) {
  return chat.participantIds.includes(targetPersonId);
}

/**
 * Retrieves evidence under an explicit privacy policy. Cross-person messages
 * never become facts. Owner messages from analogous relationships may shape
 * style only. Group content is eligible only when the target person was a
 * member of that exact source group.
 */
export function retrieveContext(options: {
  queryText: string;
  /** Local translations or transliterations of this same current turn only. */
  queryVariants?: string[];
  /** Optional local-only enriched text used for intent routing, never facts. */
  intentText?: string;
  /** Verified current-chat events through the exact draft target. */
  currentStory?: MessageEvent[];
  /** Exact target timestamp. Cross-chat evidence after it is never retrieved. */
  currentTimestampMs?: number;
  currentChat: CanonicalChat;
  targetPersonId: string;
  chats: CanonicalChat[];
  events: MessageEvent[];
  relationshipModel: PersonRelationshipModel;
  nowMs: number;
  limit?: number;
  encoder?: SemanticEncoder;
}): RetrievalItem[] {
  const limit = Math.max(5, Math.min(80, Math.floor(options.limit ?? 32)));
  const encoder = options.encoder ?? new DeterministicMultilingualEncoder();
  const chats = new Map(options.chats.map((chat) => [chat.id, chat]));
  const eventsByChat = new Map<string, MessageEvent[]>();
  for (const event of options.events) {
    const list = eventsByChat.get(event.chatId) ?? [];
    list.push(event);
    eventsByChat.set(event.chatId, list);
  }
  const currentProfile = options.relationshipModel.contexts.find((context) => context.chatId === options.currentChat.id)
    ?? buildChatRelationshipProfile(options.currentChat, eventsByChat.get(options.currentChat.id) ?? []);
  const candidates: RetrievalItem[] = [];
  const suppliedCurrent = verifiedHumanEvents(options.currentStory ?? []);
  const currentOrderedAll = verifiedHumanEvents(eventsByChat.get(options.currentChat.id) ?? []);
  const currentTimestampMs = Number.isFinite(options.currentTimestampMs)
    ? Number(options.currentTimestampMs)
    : suppliedCurrent.at(-1)?.timestampMs ?? currentOrderedAll.at(-1)?.timestampMs ?? options.nowMs;
  const currentOrdered = (suppliedCurrent.length ? suppliedCurrent : currentOrderedAll)
    .filter((event) => event.timestampMs <= currentTimestampMs);
  const currentStoryText = boundedSemanticStory(currentOrdered) || options.queryText;
  const currentPrecedingStoryText = boundedSemanticStory(currentOrdered.slice(0, -1));
  const currentIncomingText = options.queryText || currentOrdered.at(-1)?.text || "";
  const currentIncomingVariants = [...new Set([
    currentIncomingText,
    ...(options.queryVariants || []),
  ].map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 4);
  const currentStoryVariants = [...new Set([
    currentStoryText,
    ...currentIncomingVariants.map((variant) => [currentPrecedingStoryText, variant].filter(Boolean).join("\n")),
  ].filter(Boolean))].slice(0, 5);
  // These values are invariant for the full retrieval pass. Preparing them
  // once avoids re-tokenising the same live message and story for every event
  // in an imported history (thousands of redundant allocations previously).
  const preparedCurrentIncoming = prepareSemanticVariants(currentIncomingVariants, encoder, 4);
  const preparedCurrentStory = prepareSemanticVariants(currentStoryVariants, encoder, 5);
  const preparedCurrentPreceding = currentPrecedingStoryText
    ? prepareSemanticText(currentPrecedingStoryText, encoder)
    : null;
  const currentIntent = classifyIncomingIntent(options.intentText || currentIncomingText);
  const recentCurrentIds = new Set(currentOrdered.slice(-24).map((event) => event.id));

  const rollingSourceStories = new Map<string, MessageEvent[]>();

  for (const event of orderedEvents(options.events)) {
    if (!isHumanText(event) || !event.timestampVerified || event.timestampMs === null) continue;
    if (event.timestampMs > currentTimestampMs) continue;
    const sourceChat = chats.get(event.chatId);
    if (!sourceChat) continue;
    const sourceStory = [...(rollingSourceStories.get(sourceChat.id) || []), event].slice(-SEMANTIC_STORY_EVENT_LIMIT);
    rollingSourceStories.set(sourceChat.id, sourceStory);
    const targetWasParticipant = isTargetParticipant(sourceChat, options.targetPersonId);
    let tier: RetrievalTier | null = null;
    let use: RetrievalUse = "conversation-fact";
    if (sourceChat.id === options.currentChat.id) {
      tier = "current-conversation";
    } else if (sourceChat.kind === "direct" && targetWasParticipant) {
      tier = "same-person";
      use = "analogy-only";
    } else if (sourceChat.kind === "group" && targetWasParticipant) {
      tier = "shared-group";
      use = "analogy-only";
    } else if (event.direction === "owner" && isSafeLexicalToneExample(event.text)) {
      const sourceProfile = buildChatRelationshipProfile(sourceChat, eventsByChat.get(sourceChat.id) ?? []);
      tier = currentProfile.category !== "unknown" && sourceProfile.category === currentProfile.category
        ? "same-relationship"
        : "general-owner-tone";
      use = "style-only";
    }
    if (!tier) continue;
    if (tier === "shared-group" && !targetWasParticipant) continue;
    if ((tier === "same-relationship" || tier === "general-owner-tone") && event.direction !== "owner") continue;
    const storyEligible = tier === "same-person" || tier === "shared-group";
    // For an historical owner message, similarity is measured against the
    // story that caused that response, never against the response itself.
    // Contact candidates end their own story. This preserves strict no-future
    // semantics while allowing the response act to be used as an analogy.
    const historicalStory = event.direction === "owner" && storyEligible ? sourceStory.slice(0, -1) : sourceStory;
    if (storyEligible && !historicalStory.length) continue;
    const historicalStoryText = boundedSemanticStory(historicalStory) || event.text;
    // A source event needs at most a few semantic renderings. Cache only for
    // this candidate so lifetime imports remain memory-bounded.
    const preparedHistorical = new Map<string, PreparedSemanticVector>();
    const prepareHistorical = (text: string) => {
      let prepared = preparedHistorical.get(text);
      if (!prepared) {
        prepared = prepareSemanticText(text, encoder);
        preparedHistorical.set(text, prepared);
      }
      return prepared;
    };
    const storySimilarity = preparedSimilarityAcrossVariants(
      preparedCurrentStory,
      prepareHistorical(historicalStoryText),
    );
    const precedingSimilarity = storyEligible && currentPrecedingStoryText && historicalStory.length > 1
      ? preparedSemanticSimilarity(
          preparedCurrentPreceding!,
          prepareHistorical(boundedSemanticStory(historicalStory.slice(0, -1))),
        )
      : storySimilarity;
    const historicalIncomingText = storyEligible
      ? String(historicalStory.at(-1)?.text || event.text)
      : event.text;
    const incomingSimilarity = preparedSimilarityAcrossVariants(
      preparedCurrentIncoming,
      prepareHistorical(historicalIncomingText),
    );
    const historicalIntent = classifyIncomingIntent(historicalIncomingText);
    const intentMatched = historicalIntent === currentIntent;
    const similarity = storyEligible
      // The immediate incoming turn remains the strongest semantic signal.
      // Preceding story breaks ties between identical short turns, while a
      // long but unrelated history cannot drown out a different live intent.
      ? Number((incomingSimilarity * 0.5 + storySimilarity * 0.35 + precedingSimilarity * 0.15).toFixed(6))
      : preparedSimilarityAcrossVariants(preparedCurrentIncoming, prepareHistorical(event.text));
    const isRecentCurrent = tier === "current-conversation" && recentCurrentIds.has(event.id);
    if (!isRecentCurrent && similarity < 0.035) continue;
    const sanitized = sanitizeSensitiveText(event.text);
    if (sanitized.redacted && tier !== "current-conversation") continue;
    const ageDays = Math.max(0, options.nowMs - event.timestampMs) / 86_400_000;
    const recency = Math.max(0, 1 - ageDays / 365);
    const score = TIER_BASE[tier] + similarity * 50 + recency * 5 + (storyEligible && intentMatched ? 12 : 0);
    // Factual authority is a property of the current conversation tier, not a
    // caller-controlled label. Every cross-chat path is non-factual by
    // construction even if a future branch accidentally assigns the wrong use.
    const factEligible = tier === "current-conversation" && use === "conversation-fact" && !sanitized.redacted;
    const presentedText = use === "style-only" ? styleDescriptor(event.text) : sanitized.text;
    candidates.push({
      eventId: event.id,
      chatId: sourceChat.id,
      text: presentedText,
      timestampMs: event.timestampMs,
      direction: event.direction,
      tier,
      use,
      factEligible,
      similarity,
      incomingSimilarity: Number(incomingSimilarity.toFixed(6)),
      precedingStorySimilarity: Number(precedingSimilarity.toFixed(6)),
      wholeStorySimilarity: Number(storySimilarity.toFixed(6)),
      incomingIntent: historicalIntent,
      responseAct: event.direction === "owner" ? classifyResponseAct(event.text) : null,
      intentMatched,
      score: Number(score.toFixed(6)),
      effectiveSampleSize: 0,
      planProbability: 0,
      reliability: 0,
      rankReason: tier === "current-conversation"
        ? "Current conversation truth has first priority."
        : tier === "same-person"
          ? "Another direct context with the same canonical person is an analogy only."
          : tier === "shared-group"
            ? "The target person belonged to the source group; content is an audience-safe analogy only."
            : tier === "same-relationship"
              ? "Only the owner's style from an analogous relationship may be reused."
              : "Only safe general owner style may be reused.",
      privacy: {
        sourceParticipantIds: [...sourceChat.participantIds],
        targetPersonWasParticipant: targetWasParticipant,
        sensitiveValueRedacted: sanitized.redacted,
      },
    });
  }

  const supportByTier = new Map<RetrievalTier, { total: number; byAct: Map<string, number> }>();
  const itemSupport = new Map<string, number>();
  for (const item of candidates) {
    if (item.direction !== "owner" || !["same-person", "shared-group"].includes(item.tier)) continue;
    const tierWeight = item.tier === "same-person" ? 1 : 0.5;
    const support = tierWeight * 3 * item.similarity ** 2;
    if (!support) continue;
    itemSupport.set(`${item.chatId}\u001f${item.eventId}`, support);
    const distribution = supportByTier.get(item.tier) || { total: 0, byAct: new Map<string, number>() };
    const act = classifyResponseAct(item.text);
    distribution.total += support;
    distribution.byAct.set(act, (distribution.byAct.get(act) || 0) + support);
    supportByTier.set(item.tier, distribution);
  }

  return candidates.map((item) => {
    if (item.tier === "current-conversation") {
      return { ...item, effectiveSampleSize: 1, planProbability: 1, reliability: item.factEligible ? 1 : 0 };
    }
    const distribution = supportByTier.get(item.tier);
    const support = itemSupport.get(`${item.chatId}\u001f${item.eventId}`) || 0;
    if (!distribution || !support) return item;
    const effectiveSampleSize = Math.min(12, distribution.total);
    const act = classifyResponseAct(item.text);
    const planProbability = (distribution.byAct.get(act) || 0) / distribution.total;
    const reliability = planProbability * (effectiveSampleSize / (effectiveSampleSize + 2)) * (0.5 + item.similarity * 0.5);
    return {
      ...item,
      effectiveSampleSize: Number(effectiveSampleSize.toFixed(3)),
      planProbability: Number(planProbability.toFixed(4)),
      reliability: Number(reliability.toFixed(4)),
    };
  })
    .sort((left, right) => right.score - left.score || right.timestampMs - left.timestampMs || left.eventId.localeCompare(right.eventId))
    .slice(0, limit);
}
