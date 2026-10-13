import { createHash } from "node:crypto";

import { classifyIncomingIntent, classifyResponseAct, type IncomingIntent, type ResponseAct } from "./behavioral-dna.ts";
import { isHumanText, orderedEvents } from "./conversation.ts";
import type { CanonicalChat, MessageEvent } from "./domain.ts";
import { buildChatRelationshipProfile, detectWritingMode, type WritingMode } from "./relationship.ts";
import {
  inferOwnerResponseMode,
  inferScenarioFamilies,
  scenarioCode,
  type ScenarioFamily,
  type ScenarioRelationship,
} from "./scenarios.ts";

export type PhraseBankTier = "person-cst" | "person-adjacent-cst" | "relationship" | "owner-global";

export type PhraseSemanticPlan = {
  incomingIntent: IncomingIntent;
  responseAct: ResponseAct;
  scenarioFamily: ScenarioFamily;
};

export type PhraseStyleFragments = {
  /** A learned surface frame. Every detected historical fact is a named slot. */
  surfaceTemplate: string;
  literalFragments: string[];
  writingMode: WritingMode;
  characterBucket: "micro" | "short" | "medium" | "long";
  terminalMark: "question" | "exclamation" | "period" | "ellipsis" | "none";
  emoji: string[];
  lineCount: number;
};

export type PhraseProvenance = {
  origin: "whatsapp-owner-reply";
  accountScopeId: string;
  personId: string;
  relationship: ScenarioRelationship;
  chatIds: string[];
  sourceMessageIds: string[];
  latestTimestampMs: number;
};

export type PhrasePattern = {
  id: string;
  cstCode: string;
  semanticPlan: PhraseSemanticPlan;
  styleFragments: PhraseStyleFragments;
  language: WritingMode;
  recency: "recent" | "established" | "historical" | "unknown";
  evidenceCount: number;
  provenance: PhraseProvenance;
  /** Phrase patterns guide realization only. They can never authorize a fact. */
  factEligible: false;
  use: "style-template-only";
};

export type DynamicPhraseBank = {
  version: 1;
  accountScopeId: string;
  builtAt: string;
  source: "whatsapp-owner-replies-only";
  patterns: PhrasePattern[];
};

export type SelectedPhrasePattern = PhrasePattern & {
  tier: PhraseBankTier;
  score: number;
  /** Correlation-adjusted support available for this tier and intent. */
  effectiveSampleSize: number;
  /** Posterior mass of this response act inside the selected tier. */
  planProbability: number;
  /** Conservative support for using this plan rather than backing off. */
  reliability: number;
  repetitionPenalty: number;
  feedbackAdjustment: number;
};

export type PhraseFeedbackSignal = {
  patternId: string;
  provenanceFingerprint: string;
  templateFingerprint: string;
  adjustment: number;
};

export type PhraseBankSelection = {
  version: 1;
  accountScopeId: string;
  targetPersonId: string;
  targetCstCode: string;
  fallbackOrder: PhraseBankTier[];
  availablePatternCount: number;
  selected: SelectedPhrasePattern[];
};

export type LearnedEpisode = {
  personId: string;
  relationship: ScenarioRelationship;
  chatId: string;
  incomingText: string;
  /** Strictly preceding human-readable turns; excludes the incoming/reply pair. */
  storyText: string[];
  ownerReply: string;
  sourceMessageIds: string[];
  timestampMs: number;
  knownNames: string[];
};

type CompiledEpisode = {
  personId: string;
  relationship: ScenarioRelationship;
  chatId: string;
  sourceMessageIds: string[];
  timestampMs: number;
  incomingIntent: IncomingIntent;
  family: ScenarioFamily;
  responseAct: ResponseAct;
  mode: ReturnType<typeof inferOwnerResponseMode>;
  cstCode: string;
  template: string;
  language: WritingMode;
  fragments: PhraseStyleFragments;
};

type CachedChatEpisodes = {
  revisionId: number;
  /** Compiled patterns retain slotted style only, never raw historical facts. */
  episodes: CompiledEpisode[];
};

type CachedPhraseSnapshot = {
  patterns: PhrasePattern[];
};

type PhraseBankCacheCounters = {
  snapshotHits: number;
  snapshotMisses: number;
  chatHits: number;
  chatMisses: number;
  episodeHits: number;
  episodeMisses: number;
};

type AccountPhraseBankCache = {
  lastUsed: number;
  nextRevisionId: number;
  chatEpisodes: Map<string, CachedChatEpisodes>;
  compiledEpisodes: Map<string, CompiledEpisode>;
  snapshots: Map<string, CachedPhraseSnapshot>;
  counters: PhraseBankCacheCounters;
};

const FALLBACK_ORDER: PhraseBankTier[] = ["person-cst", "person-adjacent-cst", "relationship", "owner-global"];
const CST = /^C(\d{2})\.S(\d{2})\.T(\d{2})$/u;
const SLOT = /\{\{(?:amount|contact|credential|date|fact|file|name|number|place|quoted|time|topic|url)\}\}/gu;
const SLOT_PRESENT = /\{\{(?:amount|contact|credential|date|fact|file|name|number|place|quoted|time|topic|url)\}\}/u;
const CREDENTIAL = /\b(?:api[\s_-]*key|auth(?:entication)?[\s_-]*token|bearer|cvv|one[\s-]*time[\s-]*password|otp|passcode|password|pin|secret|verification[\s_-]*code)\b\s*(?:(?::|=|-)|\bis\b)?\s*(?:[\p{L}\p{N}_./+\-=]{2,})?/giu;
const SECRET_TOKEN = /\b(?:sk-(?:proj-)?[\p{L}\p{N}_-]{8,}|eyJ[\p{L}\p{N}_-]{8,}\.[\p{L}\p{N}_-]{8,}\.[\p{L}\p{N}_-]{8,}|[a-f\d]{32,})\b/giu;
const URL = /(?:https?:\/\/|www\.)[^\s<>()]+/giu;
const EMAIL = /\b[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}\b/giu;
const FILE = /\b[^\s/\\]+\.(?:csv|docx?|gif|jpe?g|json|mov|mp3|mp4|pdf|png|pptx?|txt|webp|xlsx?|zip)\b/giu;
const AMOUNT = /(?:[$€£₹]\s*\d[\d,.]*|\b\d[\d,.]*\s*(?:inr|rs\.?|rupees?|usd|eur|gbp)\b)/giu;
const TIME = /\b(?:[01]?\d|2[0-3])(?::[0-5]\d)?\s*(?:a\.?m\.?|p\.?m\.?|baje|vage)\b/giu;
const DATE = /\b(?:today|tomorrow|tonight|yesterday|aaj|kal|parso|aaje|kaale|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/giu;
const PHONE = /(?<!\p{L})(?:\+?\d[\d ()-]{7,}\d)(?!\p{L})/gu;
const NUMBER = /\b\d+(?:[.,]\d+)?\b/gu;
const QUOTED = /(["'“”‘’])[^\r\n]{2,120}?\1/gu;
const PROPER_NAME = /(?<![.!?]\s)(?<!^)(?<!\n)\b\p{Lu}[\p{L}'’-]{2,}(?:\s+\p{Lu}[\p{L}'’-]{2,})*\b/gu;
const LOCATION = /\b(at|from|in|near|to)\s+\p{Lu}[\p{L}'’-]{2,}(?:\s+\p{Lu}[\p{L}'’-]{2,})*/gu;
const CONTENT_WORD = /[\p{L}\p{N}]+/gu;
const SHARED_WORD_EXCLUSIONS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "can", "do", "for", "from", "have", "i", "in", "is", "it", "me", "my", "of", "on", "or", "please", "that", "the", "this", "to", "we", "will", "with", "you", "your",
  "hai", "haan", "ho", "ka", "ke", "ki", "ko", "mai", "main", "mein", "nahi", "nhi", "par", "se", "aur", "chhe", "cho", "chu", "tame", "ane", "mate",
]);
// Historical templates may retain syntax and a small, audited dialogue-act
// vocabulary, but never arbitrary lexical content. Unknown words are entities
// or facts from an old conversation until proven otherwise, even when they are
// lowercase (for example a venue saved as "orchardville").
const STRUCTURAL_TEMPLATE_WORDS = new Set([
  "a", "about", "after", "again", "all", "am", "an", "and", "are", "as", "ask", "at", "back", "be", "before", "but", "by", "can", "check", "checking", "confirm", "could", "did", "do", "done", "for", "from", "get", "getting", "give", "got", "had", "has", "have", "hello", "hey", "hi", "how", "i", "if", "in", "is", "it", "let", "look", "looking", "may", "me", "my", "need", "no", "not", "of", "ok", "okay", "on", "once", "or", "please", "review", "reviewing", "send", "sending", "share", "sharing", "should", "sure", "tell", "thanks", "that", "the", "then", "there", "this", "to", "update", "updating", "was", "we", "what", "when", "where", "will", "with", "would", "yes", "you", "your",
  "acha", "achha", "abhi", "aaj", "aap", "aapko", "aur", "bata", "batata", "batati", "batavo", "batao", "bhej", "bhejta", "bhejti", "bhai", "bro", "dekh", "dekhta", "dekhti", "haan", "hai", "ho", "ji", "kar", "karke", "karta", "karti", "ke", "ki", "ko", "main", "mein", "nahi", "nhi", "par", "phir", "se", "theek", "thik", "tum", "yaar",
  "ane", "chhe", "cho", "chu", "ha", "have", "janav", "karine", "mokli", "moklu", "nathi", "pachi", "tame",
]);

// The bank is rebuilt from WhatsApp history, never from a static phrase list.
// These bounds only cap derived in-memory indexes so a long-running desktop
// process cannot retain an unlimited number of superseded history revisions.
const MAX_ACCOUNT_CACHES = 4;
const MAX_CHAT_REVISIONS_PER_ACCOUNT = 1_024;
const MAX_COMPILED_EPISODES_PER_ACCOUNT = 25_000;
const MAX_SNAPSHOTS_PER_ACCOUNT = 6;
const phraseBankCaches = new Map<string, AccountPhraseBankCache>();

function emptyCounters(): PhraseBankCacheCounters {
  return { snapshotHits: 0, snapshotMisses: 0, chatHits: 0, chatMisses: 0, episodeHits: 0, episodeMisses: 0 };
}

function boundedSet<K, V>(values: Map<K, V>, key: K, value: V, maximum: number) {
  values.delete(key);
  values.set(key, value);
  while (values.size > maximum) values.delete(values.keys().next().value as K);
}

function accountCache(accountScopeId: string) {
  const existing = phraseBankCaches.get(accountScopeId);
  if (existing) {
    existing.lastUsed = Date.now();
    phraseBankCaches.delete(accountScopeId);
    phraseBankCaches.set(accountScopeId, existing);
    return existing;
  }
  const created: AccountPhraseBankCache = {
    lastUsed: Date.now(),
    nextRevisionId: 1,
    chatEpisodes: new Map(),
    compiledEpisodes: new Map(),
    snapshots: new Map(),
    counters: emptyCounters(),
  };
  phraseBankCaches.set(accountScopeId, created);
  while (phraseBankCaches.size > MAX_ACCOUNT_CACHES) phraseBankCaches.delete(phraseBankCaches.keys().next().value as string);
  return created;
}

/** Test/diagnostic hook. It contains counts only and never exposes chat text. */
export function dynamicPhraseBankCacheDiagnostics(accountScopeId?: string) {
  const selected = accountScopeId ? [...phraseBankCaches].filter(([scope]) => scope === normalize(accountScopeId)) : [...phraseBankCaches];
  return {
    accountCount: selected.length,
    accounts: selected.map(([scope, cache]) => ({
      accountScopeId: scope,
      chatRevisionCount: cache.chatEpisodes.size,
      compiledEpisodeCount: cache.compiledEpisodes.size,
      snapshotCount: cache.snapshots.size,
      ...cache.counters,
    })),
  };
}

/** Used by isolated tests and account teardown. It does not touch stored data. */
export function clearDynamicPhraseBankCache(accountScopeId?: string) {
  if (accountScopeId) phraseBankCaches.delete(normalize(accountScopeId));
  else phraseBankCaches.clear();
}

function revision(parts: Iterable<string>) {
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

/** Content-free identity for recent template use. */
export function phraseTemplateFingerprint(template: string) {
  return revision([normalize(template).toLocaleLowerCase().replace(/\s+/gu, " ")]);
}

/**
 * Binds learning feedback to the exact evidence revision that produced a
 * pattern. An edit or deleted WhatsApp message changes this fingerprint, so
 * stale acceptance feedback cannot silently weight a different pattern.
 */
export function phraseProvenanceFingerprint(pattern: PhrasePattern) {
  return revision([
    pattern.id,
    pattern.provenance.accountScopeId,
    pattern.provenance.personId,
    pattern.provenance.relationship,
    ...pattern.provenance.chatIds,
    ...pattern.provenance.sourceMessageIds,
    String(pattern.provenance.latestTimestampMs),
    phraseTemplateFingerprint(pattern.styleFragments.surfaceTemplate),
  ]);
}

function normalize(value: string) {
  return String(value || "").normalize("NFKC").replace(/\r\n?/gu, "\n").replace(/[ \t]+/gu, " ").trim();
}

function clampFeedback(value: number) {
  return Math.max(-60, Math.min(30, Number.isFinite(value) ? value : 0));
}

function isLowInformationPattern(pattern: PhrasePattern) {
  return ["acknowledgement", "thanks-response", "emoji"].includes(pattern.semanticPlan.responseAct)
    && ["micro", "short"].includes(pattern.styleFragments.characterBucket)
    && !SLOT_PRESENT.test(pattern.styleFragments.surfaceTemplate);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function replaceKnownNames(value: string, names: string[]) {
  let result = value;
  for (const name of [...new Set(names.map(normalize).filter((item) => [...item].length >= 2))].sort((a, b) => b.length - a.length)) {
    result = result.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`, "giu"), "{{name}}");
  }
  return result;
}

function replaceSharedTopics(value: string, incomingText: string) {
  const incoming = new Set((normalize(incomingText).toLocaleLowerCase().match(CONTENT_WORD) || [])
    .filter((word) => [...word].length >= 4 && !SHARED_WORD_EXCLUSIONS.has(word)));
  if (!incoming.size) return value;
  return value.replace(CONTENT_WORD, (word) => incoming.has(word.toLocaleLowerCase()) ? "{{topic}}" : word);
}

function removeHistoricalLexicalContent(value: string) {
  return value.split(/(\{\{(?:amount|contact|credential|date|fact|file|name|number|place|quoted|time|topic|url)\}\})/gu)
    .map((part) => SLOT_PRESENT.test(part) ? part : part.replace(CONTENT_WORD, (word) => {
      return STRUCTURAL_TEMPLATE_WORDS.has(word.toLocaleLowerCase()) ? word : "{{topic}}";
    }))
    .join("");
}

/**
 * Converts one historical owner reply into a content-safe reusable frame.
 * The function deliberately has no response phrase constants: an empty chat
 * history produces an empty bank rather than generic "Okay" fallbacks.
 */
export function slotHistoricalReply(ownerReply: string, incomingText = "", knownNames: string[] = []) {
  let value = normalize(ownerReply);
  value = value.replace(CREDENTIAL, "{{credential}}");
  value = value.replace(SECRET_TOKEN, "{{credential}}");
  value = value.replace(URL, "{{url}}");
  value = value.replace(EMAIL, "{{contact}}");
  value = value.replace(FILE, "{{file}}");
  value = value.replace(AMOUNT, "{{amount}}");
  value = value.replace(TIME, "{{time}}");
  value = value.replace(DATE, "{{date}}");
  value = value.replace(PHONE, "{{contact}}");
  value = value.replace(QUOTED, "{{quoted}}");
  value = value.replace(LOCATION, "$1 {{place}}");
  value = replaceKnownNames(value, knownNames);
  value = value.replace(PROPER_NAME, "{{name}}");
  value = replaceSharedTopics(value, incomingText);
  value = value.replace(NUMBER, "{{number}}");
  value = removeHistoricalLexicalContent(value);
  return value
    .replace(/(?:\{\{topic\}\}(?:\s+|[,/:-]\s*)){2,}/gu, "{{topic}} ")
    .replace(/(?:\{\{topic\}\}\s*){2,}/gu, "{{topic}} ")
    .replace(/(?:\{\{name\}\}\s*){2,}/gu, "{{name}} ")
    .replace(/[ \t]+([,.;!?])/gu, "$1")
    .replace(/[ \t]{2,}/gu, " ")
    .trim();
}

function terminalMark(value: string): PhraseStyleFragments["terminalMark"] {
  if (/\?\s*$/u.test(value)) return "question";
  if (/!\s*$/u.test(value)) return "exclamation";
  if (/…|\.\.\.\s*$/u.test(value)) return "ellipsis";
  if (/\.\s*$/u.test(value)) return "period";
  return "none";
}

function characterBucket(value: string): PhraseStyleFragments["characterBucket"] {
  const length = [...value].length;
  if (length <= 8) return "micro";
  if (length <= 40) return "short";
  if (length <= 120) return "medium";
  return "long";
}

function styleFragments(template: string, original: string): PhraseStyleFragments {
  return {
    surfaceTemplate: template,
    literalFragments: template.split(SLOT).map((item) => item.trim()).filter(Boolean).slice(0, 12),
    writingMode: detectWritingMode(original),
    characterBucket: characterBucket(original),
    terminalMark: terminalMark(original),
    emoji: [...new Set(original.match(/\p{Extended_Pictographic}/gu) || [])].slice(0, 8),
    lineCount: Math.max(1, original.split("\n").length),
  };
}

function recency(timestampMs: number, nowMs: number): PhrasePattern["recency"] {
  if (!timestampMs) return "unknown";
  const days = Math.max(0, nowMs - timestampMs) / 86_400_000;
  if (days <= 30) return "recent";
  if (days <= 365) return "established";
  return "historical";
}

function personForChat(chat: CanonicalChat, ownerIds: ReadonlySet<string>, fallbackSenderId: string | null) {
  const participants = chat.participantIds.filter((id) => !ownerIds.has(id));
  if (chat.kind === "direct" && participants.length === 1) return participants[0];
  return fallbackSenderId || (participants.length === 1 ? participants[0] : `chat:${chat.id}:contact`);
}

function learnedEpisodesForChat(chat: CanonicalChat, chatEvents: MessageEvent[], ownerSet: ReadonlySet<string>): LearnedEpisode[] {
  const allHuman = orderedEvents(chatEvents).filter(isHumanText);
  const human = allHuman.filter((event): event is MessageEvent & { timestampMs: number } =>
    event.timestampVerified && event.timestampMs !== null);
  const unverifiedSequences = allHuman
    .filter((event) => !event.timestampVerified || event.timestampMs === null)
    .map((event) => event.sequence);
  const episodes: LearnedEpisode[] = [];
  const relationship = buildChatRelationshipProfile(chat, human).scenarioRelationship;
  const turns: Array<{ direction: MessageEvent["direction"]; events: MessageEvent[]; startIndex: number }> = [];
  for (let eventIndex = 0; eventIndex < human.length; eventIndex += 1) {
    const event = human[eventIndex];
    const current = turns.at(-1);
    const prior = current?.events.at(-1);
    const gap = event.timestampMs !== null && prior?.timestampMs !== null && prior?.timestampMs !== undefined
      ? Math.max(0, event.timestampMs - prior.timestampMs)
      : Number.POSITIVE_INFINITY;
    const sameContact = event.direction !== "contact" || current?.events.at(-1)?.senderId === event.senderId;
    if (current?.direction === event.direction && sameContact && gap <= 5 * 60_000) current.events.push(event);
    else turns.push({ direction: event.direction, events: [event], startIndex: eventIndex });
  }
  for (let index = 0; index < turns.length - 1; index += 1) {
    const incoming = turns[index];
    const reply = turns[index + 1];
    if (incoming.direction !== "contact" || reply.direction !== "owner") continue;
    const incomingLast = incoming.events.at(-1);
    const ownerFirst = reply.events[0];
    if (!incomingLast || !ownerFirst
      || !incomingLast.timestampVerified || incomingLast.timestampMs === null
      || !ownerFirst.timestampVerified || ownerFirst.timestampMs === null) continue;
    if (ownerFirst.timestampMs - incomingLast.timestampMs > 6 * 60 * 60_000) continue;
    // An event with an unknown timestamp cannot be silently skipped between a
    // request and a later owner message. Its sequence position is a barrier,
    // because chronological adjacency has not been proved.
    const pairSequenceStart = Math.min(...incoming.events.map((event) => event.sequence));
    const pairSequenceEnd = Math.max(...reply.events.map((event) => event.sequence));
    if (unverifiedSequences.some((sequence) => sequence >= pairSequenceStart && sequence <= pairSequenceEnd)) continue;
    const personId = personForChat(chat, ownerSet, incomingLast.senderId);
    const knownNames = [chat.title, ...incoming.events.map((event) => event.senderName || ""), ...reply.events.map((event) => event.senderName || "")];
    episodes.push({
      personId,
      relationship,
      chatId: chat.id,
      incomingText: incoming.events.map((event) => event.text).join("\n"),
      storyText: human
        .slice(Math.max(0, incoming.startIndex - 12), incoming.startIndex)
        .map((event) => event.text)
        .filter(Boolean),
      ownerReply: reply.events.map((event) => event.text).join("\n"),
      sourceMessageIds: [...incoming.events, ...reply.events].map((event) => event.id),
      timestampMs: Math.max(...reply.events.map((event) => event.timestampMs || 0)),
      knownNames,
    });
  }
  return episodes;
}

/**
 * Produces a transient, tenant-scoped training set for probabilistic scenario
 * routing. Raw turns are never persisted in the forest model or returned in a
 * DraftContext; the model retains numerical features and aggregate labels only.
 */
export function scenarioTrainingEpisodesFromHistory(options: {
  accountScopeId: string;
  chats: CanonicalChat[];
  events: MessageEvent[];
  ownerIds: string[];
  maximumEpisodes?: number;
}) {
  const accountScopeId = normalize(options.accountScopeId);
  assertAccountBoundary(accountScopeId, options.chats, options.events);
  const ownerSet = new Set(options.ownerIds);
  const chatMap = new Map(options.chats.map((chat) => [chat.id, chat]));
  const eventGroups = new Map<string, MessageEvent[]>();
  for (const event of options.events) {
    if (!isHumanText(event) || !chatMap.has(event.chatId)) continue;
    const values = eventGroups.get(event.chatId) || [];
    values.push(event);
    eventGroups.set(event.chatId, values);
  }
  const maximumEpisodes = Math.max(10, Math.min(20_000, Math.floor(options.maximumEpisodes ?? 12_000)));
  return [...eventGroups]
    .flatMap(([chatId, events]) => {
      const chat = chatMap.get(chatId);
      if (!chat) return [];
      return learnedEpisodesForChat(chat, events, ownerSet).map((episode) => ({
        accountScopeId,
        personId: episode.personId,
        relationship: episode.relationship,
        incomingText: episode.incomingText,
        storyText: episode.storyText,
        ownerReply: episode.ownerReply,
        timestampMs: episode.timestampMs,
        weight: 1,
      }));
    })
    .sort((left, right) => right.timestampMs - left.timestampMs)
    .slice(0, maximumEpisodes);
}

function chatRevision(chat: CanonicalChat, events: MessageEvent[], ownerIds: string[]) {
  return revision([
    chat.id,
    chat.accountScopeId || "",
    chat.title,
    chat.kind,
    chat.collection,
    ...chat.participantIds,
    ...[...ownerIds].sort(),
    ...events.flatMap((event) => [
      event.id,
      event.accountScopeId || "",
      event.chatId,
      event.connectorMessageId,
      event.direction,
      event.senderId || "",
      event.senderName || "",
      event.kind,
      event.text,
      String(event.timestampMs ?? ""),
      String(event.timestampVerified),
      String(event.sequence ?? ""),
    ]),
  ]);
}

function compiledEpisodeRevision(accountScopeId: string, episode: LearnedEpisode) {
  return revision([
    accountScopeId,
    episode.personId,
    episode.relationship,
    episode.chatId,
    ...episode.sourceMessageIds,
    String(episode.timestampMs),
    episode.incomingText,
    episode.ownerReply,
    ...episode.knownNames,
  ]);
}

function compileEpisode(accountScopeId: string, episode: LearnedEpisode, cache: AccountPhraseBankCache): CompiledEpisode {
  const key = compiledEpisodeRevision(accountScopeId, episode);
  const cached = cache.compiledEpisodes.get(key);
  if (cached) {
    cache.counters.episodeHits += 1;
    cache.compiledEpisodes.delete(key);
    cache.compiledEpisodes.set(key, cached);
    return cached;
  }
  cache.counters.episodeMisses += 1;
  const incomingIntent = classifyIncomingIntent(episode.incomingText);
  const family = inferScenarioFamilies(incomingIntent, episode.incomingText)[0]?.family || "information";
  const responseAct = classifyResponseAct(episode.ownerReply);
  const mode = inferOwnerResponseMode(episode.ownerReply, family, episode.relationship);
  const cstCode = scenarioCode(family, episode.relationship, mode);
  const template = slotHistoricalReply(episode.ownerReply, episode.incomingText, episode.knownNames);
  const language = detectWritingMode(episode.ownerReply);
  const compiled: CompiledEpisode = {
    personId: episode.personId,
    relationship: episode.relationship,
    chatId: episode.chatId,
    sourceMessageIds: episode.sourceMessageIds,
    timestampMs: episode.timestampMs,
    incomingIntent,
    family,
    responseAct,
    mode,
    cstCode,
    template,
    language,
    fragments: styleFragments(template, episode.ownerReply),
  };
  boundedSet(cache.compiledEpisodes, key, compiled, MAX_COMPILED_EPISODES_PER_ACCOUNT);
  return compiled;
}

function assertAccountBoundary(accountScopeId: string, chats: CanonicalChat[], events: MessageEvent[]) {
  if (!accountScopeId.trim()) throw new Error("A phrase bank requires an explicit account scope.");
  const local = accountScopeId === "local-device-vault";
  const foreignChat = chats.find((chat) => chat.accountScopeId && chat.accountScopeId !== accountScopeId);
  const foreignEvent = events.find((event) => event.accountScopeId && event.accountScopeId !== accountScopeId);
  const unscopedChat = !local && chats.find((chat) => !chat.accountScopeId);
  const unscopedEvent = !local && events.find((event) => !event.accountScopeId);
  if (foreignChat || foreignEvent || unscopedChat || unscopedEvent) {
    throw new Error("Phrase evidence outside the active account boundary was blocked.");
  }
}

export function buildDynamicPhraseBank(options: {
  accountScopeId: string;
  chats: CanonicalChat[];
  events: MessageEvent[];
  ownerIds: string[];
  nowMs: number;
}): DynamicPhraseBank {
  const accountScopeId = normalize(options.accountScopeId);
  assertAccountBoundary(accountScopeId, options.chats, options.events);
  const cache = accountCache(accountScopeId);
  const ownerSet = new Set(options.ownerIds);
  const chatMap = new Map(options.chats.map((chat) => [chat.id, chat]));
  const eventGroups = new Map<string, MessageEvent[]>();
  for (const event of options.events) {
    if (!isHumanText(event) || !chatMap.has(event.chatId)) continue;
    const values = eventGroups.get(event.chatId) || [];
    values.push(event);
    eventGroups.set(event.chatId, values);
  }

  const revisionIds: Array<[string, number]> = [];
  const episodes: LearnedEpisode[] = [];
  for (const [chatId, unordered] of [...eventGroups].sort(([left], [right]) => left.localeCompare(right))) {
    const chat = chatMap.get(chatId);
    if (!chat) continue;
    const events = orderedEvents(unordered).filter(isHumanText);
    const cacheKey = `${chatId}\u001f${chatRevision(chat, events, options.ownerIds)}`;
    let cachedChat = cache.chatEpisodes.get(cacheKey);
    if (cachedChat) {
      cache.counters.chatHits += 1;
      cache.chatEpisodes.delete(cacheKey);
      cache.chatEpisodes.set(cacheKey, cachedChat);
    } else {
      cache.counters.chatMisses += 1;
      cachedChat = {
        revisionId: cache.nextRevisionId,
        episodes: learnedEpisodesForChat(chat, events, ownerSet).map((episode) => compileEpisode(accountScopeId, episode, cache)),
      };
      cache.nextRevisionId += 1;
      boundedSet(cache.chatEpisodes, cacheKey, cachedChat, MAX_CHAT_REVISIONS_PER_ACCOUNT);
    }
    revisionIds.push([chatId, cachedChat.revisionId]);
    episodes.push(...cachedChat.episodes);
  }

  const snapshotKey = revision([
    accountScopeId,
    ...[...options.ownerIds].sort(),
    ...revisionIds.flatMap(([chatId, revisionId]) => [chatId, String(revisionId)]),
  ]);
  const cachedSnapshot = cache.snapshots.get(snapshotKey);
  if (cachedSnapshot) {
    cache.counters.snapshotHits += 1;
    cache.snapshots.delete(snapshotKey);
    cache.snapshots.set(snapshotKey, cachedSnapshot);
    return {
      version: 1,
      accountScopeId,
      builtAt: new Date(options.nowMs).toISOString(),
      source: "whatsapp-owner-replies-only",
      patterns: cachedSnapshot.patterns.map((pattern) => ({
        ...pattern,
        recency: recency(pattern.provenance.latestTimestampMs, options.nowMs),
        styleFragments: { ...pattern.styleFragments, literalFragments: [...pattern.styleFragments.literalFragments], emoji: [...pattern.styleFragments.emoji] },
        provenance: { ...pattern.provenance, chatIds: [...pattern.provenance.chatIds], sourceMessageIds: [...pattern.provenance.sourceMessageIds] },
      })),
    };
  }
  cache.counters.snapshotMisses += 1;

  const grouped = new Map<string, { episode: CompiledEpisode; count: number; chatIds: Set<string>; ids: Set<string>; latest: number }>();
  for (const episode of episodes) {
    if (!episode.template) continue;
    const signature = normalize(episode.template).toLocaleLowerCase().replace(/\s+/gu, " ");
    const key = [episode.personId, episode.cstCode, episode.incomingIntent, episode.responseAct, episode.language, signature].join("\u001f");
    const current = grouped.get(key);
    if (current) {
      current.count += 1;
      current.chatIds.add(episode.chatId);
      for (const id of episode.sourceMessageIds) current.ids.add(id);
      current.latest = Math.max(current.latest, episode.timestampMs);
    } else {
      grouped.set(key, { episode, count: 1, chatIds: new Set([episode.chatId]), ids: new Set(episode.sourceMessageIds), latest: episode.timestampMs });
    }
  }
  const patterns = [...grouped.entries()].map(([key, group]) => {
    return {
      id: `phrase-${stableHash(`${accountScopeId}\u001f${key}`)}`,
      cstCode: group.episode.cstCode,
      semanticPlan: {
        incomingIntent: group.episode.incomingIntent,
        responseAct: group.episode.responseAct,
        scenarioFamily: group.episode.family,
      },
      styleFragments: group.episode.fragments,
      language: group.episode.language,
      recency: recency(group.latest, options.nowMs),
      evidenceCount: group.count,
      provenance: {
        origin: "whatsapp-owner-reply" as const,
        accountScopeId,
        personId: group.episode.personId,
        relationship: group.episode.relationship,
        chatIds: [...group.chatIds].sort(),
        sourceMessageIds: [...group.ids].slice(-64),
        latestTimestampMs: group.latest,
      },
      factEligible: false as const,
      use: "style-template-only" as const,
    };
  }).sort((left, right) => right.provenance.latestTimestampMs - left.provenance.latestTimestampMs || left.id.localeCompare(right.id));
  boundedSet(cache.snapshots, snapshotKey, { patterns }, MAX_SNAPSHOTS_PER_ACCOUNT);
  return {
    version: 1,
    accountScopeId,
    builtAt: new Date(options.nowMs).toISOString(),
    source: "whatsapp-owner-replies-only",
    patterns,
  };
}

function cstDistance(left: string, right: string) {
  const a = left.match(CST);
  const b = right.match(CST);
  if (!a || !b) return Number.POSITIVE_INFINITY;
  return [1, 2, 3].reduce((sum, index) => sum + (a[index] === b[index] ? 0 : 1), 0);
}

function patternSignature(pattern: PhrasePattern) {
  return [pattern.semanticPlan.responseAct, pattern.language, normalize(pattern.styleFragments.surfaceTemplate).toLocaleLowerCase()].join("\u001f");
}

function consolidate(patterns: PhrasePattern[]) {
  const values = new Map<string, PhrasePattern>();
  for (const pattern of patterns) {
    const signature = patternSignature(pattern);
    const existing = values.get(signature);
    if (!existing) {
      values.set(signature, pattern);
      continue;
    }
    const latest = existing.provenance.latestTimestampMs >= pattern.provenance.latestTimestampMs ? existing : pattern;
    values.set(signature, {
      ...latest,
      evidenceCount: existing.evidenceCount + pattern.evidenceCount,
      provenance: {
        ...latest.provenance,
        chatIds: [...new Set([...existing.provenance.chatIds, ...pattern.provenance.chatIds])].sort(),
        sourceMessageIds: [...new Set([...existing.provenance.sourceMessageIds, ...pattern.provenance.sourceMessageIds])].slice(-64),
        latestTimestampMs: Math.max(existing.provenance.latestTimestampMs, pattern.provenance.latestTimestampMs),
      },
    });
  }
  return [...values.values()];
}

export function selectDynamicPhrases(bank: DynamicPhraseBank, options: {
  personId: string;
  cstCode: string;
  adjacentCstCodes?: string[];
  relationship: ScenarioRelationship;
  incomingIntent?: IncomingIntent;
  language?: WritingMode;
  nowMs: number;
  limit?: number;
  recentPatternIds?: string[];
  recentSurfaceTemplates?: string[];
  recentTemplateFingerprints?: string[];
  feedbackSignals?: PhraseFeedbackSignal[];
}): PhraseBankSelection {
  if (bank.accountScopeId !== bank.patterns.find(Boolean)?.provenance.accountScopeId && bank.patterns.length) {
    throw new Error("Phrase bank provenance does not match its account boundary.");
  }
  const adjacent = new Set((options.adjacentCstCodes || []).filter((code) => code !== options.cstCode));
  const recentIds = new Map<string, number>();
  for (const id of options.recentPatternIds || []) recentIds.set(id, (recentIds.get(id) || 0) + 1);
  const recentTemplates = new Map<string, number>();
  for (const value of options.recentSurfaceTemplates || []) {
    const fingerprint = phraseTemplateFingerprint(value);
    recentTemplates.set(fingerprint, (recentTemplates.get(fingerprint) || 0) + 1);
  }
  for (const fingerprint of options.recentTemplateFingerprints || []) {
    recentTemplates.set(fingerprint, (recentTemplates.get(fingerprint) || 0) + 1);
  }
  const feedbackByPattern = new Map<string, PhraseFeedbackSignal[]>();
  for (const signal of options.feedbackSignals || []) {
    const records = feedbackByPattern.get(signal.patternId) || [];
    records.push(signal);
    feedbackByPattern.set(signal.patternId, records);
  }
  const chosenSignatures = new Set<string>();
  const selected: SelectedPhrasePattern[] = [];
  const limit = Math.max(1, Math.min(12, Math.floor(options.limit ?? 6)));
  const isAdjacent = (pattern: PhrasePattern) => adjacent.size
    ? adjacent.has(pattern.cstCode) || cstDistance(pattern.cstCode, options.cstCode) <= 2
    : cstDistance(pattern.cstCode, options.cstCode) <= 2;
  const byTier: Record<PhraseBankTier, PhrasePattern[]> = {
    "person-cst": bank.patterns.filter((pattern) => pattern.provenance.personId === options.personId && pattern.cstCode === options.cstCode),
    "person-adjacent-cst": bank.patterns.filter((pattern) => pattern.provenance.personId === options.personId && pattern.cstCode !== options.cstCode && isAdjacent(pattern)),
    relationship: bank.patterns.filter((pattern) => pattern.provenance.personId !== options.personId && pattern.provenance.relationship === options.relationship),
    "owner-global": bank.patterns.filter((pattern) => pattern.provenance.personId !== options.personId && pattern.provenance.relationship !== options.relationship),
  };
  const hasIntentMatchAnywhere = Boolean(options.incomingIntent
    && bank.patterns.some((pattern) => pattern.semanticPlan.incomingIntent === options.incomingIntent));
  for (const tier of FALLBACK_ORDER) {
    const consolidated = consolidate(byTier[tier]);
    // A phrase learned for a different incoming intent may still resemble the
    // owner's voice, but it must not become a semantic plan. Skip that tier
    // and allow the hierarchy to back off to conditionally relevant evidence.
    const exactIntent = options.incomingIntent
      ? consolidated.filter((pattern) => pattern.semanticPlan.incomingIntent === options.incomingIntent)
      : consolidated;
    const conditionallyRelevant = exactIntent.length || hasIntentMatchAnywhere ? exactIntent : consolidated;
    if (!conditionallyRelevant.length) continue;
    const adjustedSupport = new Map(conditionallyRelevant.map((pattern) => [
      pattern.id,
      Math.min(4, Math.sqrt(Math.max(1, pattern.evidenceCount))),
    ]));
    const effectiveSampleSize = [...adjustedSupport.values()].reduce((sum, value) => sum + value, 0);
    const supportByAct = new Map<ResponseAct, number>();
    for (const pattern of conditionallyRelevant) {
      supportByAct.set(pattern.semanticPlan.responseAct,
        (supportByAct.get(pattern.semanticPlan.responseAct) || 0) + (adjustedSupport.get(pattern.id) || 0));
    }
    const ranked = conditionallyRelevant.map((pattern) => {
      const normalizedTemplate = normalize(pattern.styleFragments.surfaceTemplate).toLocaleLowerCase();
      const templateFingerprint = phraseTemplateFingerprint(normalizedTemplate);
      const idUses = recentIds.get(pattern.id) || 0;
      const templateUses = recentTemplates.get(templateFingerprint) || 0;
      // Genericity is learned from the response act and shape of this WhatsApp
      // pattern. There is no built-in bank of canned reply strings here.
      const genericUses = isLowInformationPattern(pattern) ? idUses + templateUses : 0;
      const repetitionPenalty = Math.min(220, idUses * 80 + templateUses * 55 + genericUses * 20);
      const provenanceFingerprint = phraseProvenanceFingerprint(pattern);
      const feedbackAdjustment = Number(clampFeedback((feedbackByPattern.get(pattern.id) || []).reduce((sum, signal) => {
        if (signal.provenanceFingerprint !== provenanceFingerprint || signal.templateFingerprint !== templateFingerprint) return sum;
        return sum + Number(signal.adjustment || 0);
      }, 0)).toFixed(3));
      const ageDays = pattern.provenance.latestTimestampMs ? Math.max(0, options.nowMs - pattern.provenance.latestTimestampMs) / 86_400_000 : 730;
      const recencyScore = Math.max(0, 30 - Math.min(30, ageDays / 12));
      const languageScore = options.language && pattern.language === options.language ? 18 : 0;
      // C/S/T is deliberately only one routing signal.  The same scenario cell
      // can contain materially different dialogue acts, so an exact historical
      // incoming intent must outrank a merely adjacent cell.  This affects the
      // response plan only; historical text remains fact-ineligible.
      const intentScore = options.incomingIntent && pattern.semanticPlan.incomingIntent === options.incomingIntent ? 72 : 0;
      const evidenceScore = Math.min(36, Math.log2(pattern.evidenceCount + 1) * 12);
      const distanceScore = tier === "person-cst" ? 40 : tier === "person-adjacent-cst" ? 24 : tier === "relationship" ? 12 : 0;
      const planProbability = effectiveSampleSize
        ? (supportByAct.get(pattern.semanticPlan.responseAct) || 0) / effectiveSampleSize
        : 0;
      const intentReliability = !options.incomingIntent || pattern.semanticPlan.incomingIntent === options.incomingIntent ? 1 : 0.15;
      const reliability = planProbability * (effectiveSampleSize / (effectiveSampleSize + 4)) * intentReliability;
      const distributionScore = planProbability * 36 + reliability * 48;
      return {
        ...pattern,
        tier,
        effectiveSampleSize: Number(effectiveSampleSize.toFixed(3)),
        planProbability: Number(planProbability.toFixed(4)),
        reliability: Number(reliability.toFixed(4)),
        repetitionPenalty,
        feedbackAdjustment,
        score: Number((distanceScore + evidenceScore + recencyScore + languageScore + intentScore + distributionScore + feedbackAdjustment - repetitionPenalty).toFixed(3)),
      };
    }).sort((left, right) => right.score - left.score || right.evidenceCount - left.evidenceCount || right.provenance.latestTimestampMs - left.provenance.latestTimestampMs);
    const tierLimit = tier === "person-cst" ? 3 : 2;
    let tierSelected = 0;
    for (const pattern of ranked) {
      const signature = patternSignature(pattern);
      if (chosenSignatures.has(signature)) continue;
      chosenSignatures.add(signature);
      selected.push(pattern);
      tierSelected += 1;
      if (selected.length >= limit || tierSelected >= tierLimit) break;
    }
    if (selected.length >= limit) break;
  }
  return {
    version: 1,
    accountScopeId: bank.accountScopeId,
    targetPersonId: options.personId,
    targetCstCode: options.cstCode,
    fallbackOrder: [...FALLBACK_ORDER],
    availablePatternCount: bank.patterns.length,
    selected,
  };
}
