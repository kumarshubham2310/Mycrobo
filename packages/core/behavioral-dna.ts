import { detectWritingMode, type WritingMode } from "./relationship.ts";
import { inferOwnerResponseMode, inferScenarioFamilies, inferScenarioPosterior, inferScenarioRoute, routeScenario, scenarioCode, SCENARIO_TAXONOMY_VERSION, type ScenarioCandidate, type ScenarioMode, type ScenarioRelationship, type ScenarioRoute } from "./scenarios.ts";

export type IncomingIntent =
  | "acknowledgement" | "activity-question" | "affection" | "apology" | "arrival-update" | "availability-question"
  | "action-request" | "call" | "check-request" | "choice-question" | "departure-update" | "emoji" | "greeting"
  | "intro-question" | "nothing-response" | "open-question" | "problem" | "send-request"
  | "shared-link" | "statement" | "thanks" | "timed-update" | "update-request" | "wellbeing-question"
  | "when-question" | "where-question" | "why-question" | "wish";

export type ResponseAct = "acknowledgement" | "affection" | "apology" | "commitment" | "decline" | "emoji" | "greeting" | "information" | "question" | "thanks-response";

export type BehavioralBucket = {
  sampleCount: number;
  confidence: number;
  medianCharacters: number;
  responseActs: Array<{ act: ResponseAct; count: number; rate: number }>;
  writingModes: Array<{ mode: WritingMode; count: number; rate: number }>;
  replyModesByIncomingMode: Array<{
    incomingMode: WritingMode;
    sampleCount: number;
    replyModes: Array<{ mode: WritingMode; count: number; rate: number }>;
  }>;
  lengthBuckets: Array<{ bucket: "micro" | "short" | "medium" | "long"; count: number; rate: number }>;
  emojiRate: number;
  warmthRate: number;
  formalRate: number;
  casualRate: number;
  terminalPunctuationRate: number;
  questionRate: number;
  addressForms: string[];
  emojiPalette: string[];
  safeAtoms: string[];
  medianResponseDelayMs: number;
};

export type BehavioralDNA = {
  version: 2;
  sampleCount: number;
  activeIntent: IncomingIntent;
  activeScenario: ScenarioRoute & { routes: string[]; code: string; taxonomyVersion: string; candidates: ScenarioCandidate[]; uncertainty: number };
  active: BehavioralBucket;
  global: BehavioralBucket;
  byIncomingIntent: Partial<Record<IncomingIntent, BehavioralBucket>>;
  byScenario: Record<string, BehavioralBucket>;
};

/**
 * Projects behavior learned outside the target relationship into a strictly
 * content-free policy. Cross-relationship evidence may contribute aggregate
 * rates and categorical distributions, but never a historical surface form.
 *
 * Keep this projection at the core boundary so every downstream consumer gets
 * the same fail-closed representation even when a future caller forgets that
 * the DNA came from a peer, same-category, or account-global aggregate.
 */
export function abstractBehavioralDNA(dna: BehavioralDNA): BehavioralDNA {
  const abstractBucket = (value: BehavioralBucket): BehavioralBucket => ({
    sampleCount: Number(value?.sampleCount || 0),
    confidence: Number(value?.confidence || 0),
    medianCharacters: Number(value?.medianCharacters || 0),
    responseActs: Array.isArray(value?.responseActs) ? value.responseActs.map((item) => ({ ...item })) : [],
    writingModes: Array.isArray(value?.writingModes) ? value.writingModes.map((item) => ({ ...item })) : [],
    replyModesByIncomingMode: Array.isArray(value?.replyModesByIncomingMode)
      ? value.replyModesByIncomingMode.map((item) => ({
        incomingMode: item.incomingMode,
        sampleCount: Number(item.sampleCount || 0),
        replyModes: Array.isArray(item.replyModes) ? item.replyModes.map((mode) => ({ ...mode })) : [],
      }))
      : [],
    lengthBuckets: Array.isArray(value?.lengthBuckets) ? value.lengthBuckets.map((item) => ({ ...item })) : [],
    emojiRate: Number(value?.emojiRate || 0),
    warmthRate: Number(value?.warmthRate || 0),
    formalRate: Number(value?.formalRate || 0),
    casualRate: Number(value?.casualRate || 0),
    terminalPunctuationRate: Number(value?.terminalPunctuationRate || 0),
    questionRate: Number(value?.questionRate || 0),
    // Surface forms are relationship content, even when they look harmless.
    addressForms: [],
    emojiPalette: [],
    safeAtoms: [],
    medianResponseDelayMs: Number(value?.medianResponseDelayMs || 0),
  });
  return {
    version: 2,
    sampleCount: Number(dna?.sampleCount || 0),
    activeIntent: dna.activeIntent,
    activeScenario: {
      ...dna.activeScenario,
      routes: Array.isArray(dna.activeScenario?.routes) ? [...dna.activeScenario.routes] : [],
      candidates: Array.isArray(dna.activeScenario?.candidates)
        ? dna.activeScenario.candidates.map((candidate) => ({ ...candidate }))
        : [],
    },
    active: abstractBucket(dna.active),
    global: abstractBucket(dna.global),
    byIncomingIntent: Object.fromEntries(Object.entries(dna.byIncomingIntent || {})
      .map(([intent, value]) => [intent, value ? abstractBucket(value) : value])) as Partial<Record<IncomingIntent, BehavioralBucket>>,
    byScenario: Object.fromEntries(Object.entries(dna.byScenario || {})
      .map(([scenario, value]) => [scenario, abstractBucket(value)])),
  };
}

type Interaction = { otherText?: string; ownerReply?: string; responseDelayMs?: number };

const SAFE_STYLE_ATOM = /^(?:(?:hi+|hii+|hey+|hello+|helo+|haan+|haa+|ha+|hmm+|okay+|ok+|acha+|achha+|thee?k+|thik+|fine|sure|done|got it|noted|anytime|welcome|koi na|kai nai|no worries|no problem|me too|same here|miss(?:ing)? you too|love you too|main bhi|mai bhi|mane pan)(?:\s+(?:bhai|bro|boss|sir|yaar|ji))?|[👍👌✅🙏🙂😊😂🤣❤️💕🥺😘🤗]+)[\s.!…\p{Extended_Pictographic}]*$/iu;
const ADDRESS_FORM = /\b(?:bhai|bro|boss|sir|ma'am|madam|yaar|didi|bhaiya|ji|dear)\b/giu;
const WARM_FORM = /\b(?:care|dear|love|miss|please|pls|thank|welcome|anytime|sorry|yaar|bro|bhai|didi|bhaiya|ji|koi na|kai nai|no worries|take care|dhyan)\b|[❤️💕💖🥺😘🤗😊🙂🙏]/iu;
const FORMAL_FORM = /\b(?:sir|madam|ma'am|kindly|please|request|regards|thank you|aap|aapko|aapse|tame|ji)\b/iu;
const CASUAL_FORM = /\b(?:bro|bhai|yaar|tu|tum|kya|kro|kr|nhi|haan|haa|hii|hey|lol|bas|mast|acha|achha)\b|[😂🤣😜😎]/iu;

export function classifyIncomingIntent(text: string): IncomingIntent {
  const value = String(text || "").trim();
  const lower = value.toLocaleLowerCase();
  if (/^[\p{Extended_Pictographic}\u200D\uFE0F\s]+$/u.test(value)) return "emoji";
  if (/\b(?:thank(?:s| you)?|thx|dhanyavaad|aabhar|shukriya)\b/iu.test(value)) return "thanks";
  if (/\b(?:sorry|maaf|apolog)\b/iu.test(value)) return "apology";
  if (/\b(?:miss(?:ing)? you|miss u|pyar|pyaar|love you|need (?:your )?(?:love|affection)|hug|cuddle)\b/iu.test(value)) return "affection";
  if (/^(?:(?:nahi|nhi)(?: kuch)?|nothing|kuch nahi|kuch nhi|kai nai|kai nathi)[\s.!🙂😊]*$/iu.test(value)) return "nothing-response";
  if (/\b(?:happy (?:birthday|anniversary|independence day)|congratulations|congrats|best wishes)\b/iu.test(value)) return "wish";
  if (/\b(?:how are you|how r u|kaise ho|kaisa hai|kem cho)\b/iu.test(value)) return "wellbeing-question";
  if (/\b(?:what are you (?:doing|up to)|what(?:'|’)s up with you|kya kar rahe ho|kya kr rhe ho|shu karo cho|su karo cho)(?:\s+(?:aaj|today|tonight))?\b/iu.test(value)) return "activity-question";
  if (/\b(?:subah|savare|morning|shaam|evening|kal|tomorrow|aaj|today)\b/iu.test(value) && /\b(?:bata|batana|tell|update|confirm|janav|kejo|dena)\b/iu.test(value)) return "timed-update";
  if (/\b(?:any|koi|kai)\s+update\b|\bupdate\s*\?\s*$/iu.test(value)) return "update-request";
  if (/\b(?:what do you do|know more (?:of|about)|tell me about yourself)\b/iu.test(value)) return "intro-question";
  if (/\b(?:are you free|free ho|free chhe|can we (?:talk|connect)|baat kar)\b/iu.test(value)) return "availability-question";
  if (/\b(?:call|phone|ring)\b/iu.test(value) && /\?|\b(?:please|pls|kar|karo|kro|kr|receive|uthao|pick)\b/iu.test(value)) return "call";
  if (/\b(?:send|share|bhej|bhejo|mokli|moklo|forward)\b/iu.test(value)) return "send-request";
  if (/\b(?:check|review|verify|dekh|dekho|joi|joine)\b/iu.test(value)) return "check-request";
  if (/\b(?:tell|ask|message|mail|email|pay|bring|pick|book|submit|update|reply|remind|prepare|complete|finish|confirm)\b/iu.test(value)
    && /\?|\b(?:can|could|please|pls|plz|will|would|do|kar|karo|kro|kr|karjo|dena)\b/iu.test(value)) return "action-request";
  if (/\b(?:nikl(?:ungi|unga|i|a|enge|rahi|rhi|raha)?|leaving|heading out|on my way)\b/iu.test(value)) return "departure-update";
  if (/\b(?:reached|pahuch|pahunch|aa gayi|aa gaya|arrived)\b/iu.test(value)) return "arrival-update";
  if (/\b(?:where|kahan|kidhar|kidhr|kya jagah)\b/iu.test(value)) return "where-question";
  if (/\b(?:when|kab|kyare|ketla vag(?:e)?|what time)\b/iu.test(value)) return "when-question";
  if (/\b(?:why|kyu|kyun|kem)\b/iu.test(value)) return "why-question";
  if (/\b(?:which|kaunsa|konsa|kayu|what (?:one|format)|which one)\b/iu.test(value)) return "choice-question";
  if (/\b(?:what|kya|shu|how|kaise)\b/iu.test(value) || /\?\s*$/u.test(value)) return "open-question";
  if (/^(?:hi+|hii+|hey+|hello+|helo+|good\s+(?:morning|afternoon|evening))\b/iu.test(value)) return "greeting";
  if (/https?:\/\/\S+/iu.test(value)) return "shared-link";
  if (/^(?:ok(?:ay)?|haan+|ha+|hmm+|thik|theek|acha|achha|fine|done|reached)[\s.!👍🙂😊]*$/iu.test(value)) return "acknowledgement";
  if (/\b(?:problem|issue|not working|nahi ho|nhi ho|can't|cannot|stuck|late|delay)\b/iu.test(lower)) return "problem";
  return "statement";
}

export function classifyResponseAct(text: string): ResponseAct {
  const value = String(text || "").trim();
  if (/^[\p{Extended_Pictographic}\u200d\ufe0f\s]+$/u.test(value)) return "emoji";
  if (/\b(?:sorry|apolog|maaf)\b/iu.test(value)) return "apology";
  if (/\b(?:miss(?:ing)? you|love you|me too|same here|tumhe bhi|mane pan)\b/iu.test(value)) return "affection";
  if (/^(?:hi+|hii+|hey+|hello+|good\s+(?:morning|afternoon|evening))\b/iu.test(value) && /\?\s*$/u.test(value)) return "question";
  if (/^(?:hi+|hii+|hey+|hello+|good\s+(?:morning|afternoon|evening))\b/iu.test(value)) return "greeting";
  if (/\b(?:welcome|anytime|koi na|kai nai|no worries|no problem|most welcome)\b/iu.test(value)) return "thanks-response";
  if (/\b(?:can't|cannot|won't|not possible|nahi ho|nhi ho|nahi kar|nhi kar|nahi thai|nathi thai|nai thai|possible nahi|possible nhi)\b/iu.test(value)) return "decline";
  if (/\b(?:i(?:'|’)ll|i will|i can|we(?:'|’)ll|we will|haan|haa|sure|done)\b.{0,60}\b(?:call|check|confirm|do|finish|forward|handle|meet|pay|reply|review|send|share|submit|take care|update|visit)\b|\b(?:bata|bhej|check|confirm|dekh|janav|kar|mokli|pahunch|send|update)\s*(?:dais|dunga|dungi|deta|deti|karis|karunga|karungi|lau|lunga|lungi)\b/iu.test(value)) return "commitment";
  if (/\?\s*$/u.test(value)) return "question";
  if (/^(?:ok(?:ay)?|haan+|haa+|ha+|yes|done|theek|thik|acha|accha|sure|fine|got it|noted|majama|barabar|thase|👍|👌|✅)[.!…\s\p{Extended_Pictographic}]*$/iu.test(value)) return "acknowledgement";
  return "information";
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function lengthBucket(text: string): "micro" | "short" | "medium" | "long" {
  const length = [...text].length;
  return length <= 12 ? "micro" : length <= 35 ? "short" : length <= 100 ? "medium" : "long";
}

function rankedCounts<T extends string>(values: T[]) {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

function bucket(interactions: Interaction[]): BehavioralBucket {
  const replies = interactions.map((item) => String(item.ownerReply || "").trim()).filter(Boolean);
  const sampleCount = replies.length;
  const rate = (count: number) => sampleCount ? Number((count / sampleCount).toFixed(3)) : 0;
  const responseActs = rankedCounts(replies.map(classifyResponseAct)).map(([act, count]) => ({ act, count, rate: rate(count) }));
  const writingModes = rankedCounts(replies.map(detectWritingMode)).map(([mode, count]) => ({ mode, count, rate: rate(count) }));
  const transitionGroups = new Map<WritingMode, WritingMode[]>();
  for (const interaction of interactions) {
    const incomingMode = detectWritingMode(String(interaction.otherText || ""));
    const replyMode = detectWritingMode(String(interaction.ownerReply || ""));
    const values = transitionGroups.get(incomingMode) || [];
    values.push(replyMode);
    transitionGroups.set(incomingMode, values);
  }
  const replyModesByIncomingMode = [...transitionGroups.entries()].map(([incomingMode, modes]) => ({
    incomingMode,
    sampleCount: modes.length,
    replyModes: rankedCounts(modes).map(([mode, count]) => ({ mode, count, rate: Number((count / Math.max(1, modes.length)).toFixed(3)) })),
  }));
  const lengthBuckets = rankedCounts(replies.map(lengthBucket)).map(([value, count]) => ({ bucket: value, count, rate: rate(count) }));
  const addresses = new Map<string, number>();
  const emojis = new Map<string, number>();
  const safeAtoms = new Set<string>();
  for (const reply of replies) {
    for (const match of reply.matchAll(ADDRESS_FORM)) {
      const address = match[0].toLocaleLowerCase();
      addresses.set(address, (addresses.get(address) || 0) + 1);
    }
    for (const emoji of reply.match(/\p{Extended_Pictographic}/gu) || []) emojis.set(emoji, (emojis.get(emoji) || 0) + 1);
    for (const line of reply.split(/[\r\n]+/u).map((value) => value.trim()).filter(Boolean)) {
      if ([...line].length <= 40 && SAFE_STYLE_ATOM.test(line)) safeAtoms.add(line);
    }
  }
  return {
    sampleCount,
    confidence: Number(Math.min(0.96, sampleCount / (sampleCount + 5)).toFixed(3)),
    medianCharacters: median(replies.map((reply) => [...reply].length)),
    responseActs,
    writingModes,
    replyModesByIncomingMode,
    lengthBuckets,
    emojiRate: rate(replies.filter((reply) => /\p{Extended_Pictographic}/u.test(reply)).length),
    warmthRate: rate(replies.filter((reply) => WARM_FORM.test(reply)).length),
    formalRate: rate(replies.filter((reply) => FORMAL_FORM.test(reply)).length),
    casualRate: rate(replies.filter((reply) => CASUAL_FORM.test(reply)).length),
    terminalPunctuationRate: rate(replies.filter((reply) => /[.!?…]$/u.test(reply)).length),
    questionRate: rate(replies.filter((reply) => /\?\s*$/u.test(reply)).length),
    addressForms: [...addresses.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([address]) => address),
    emojiPalette: [...emojis.entries()].sort((left, right) => right[1] - left[1]).slice(0, 4).map(([emoji]) => emoji),
    safeAtoms: [...safeAtoms].slice(-12),
    medianResponseDelayMs: median(interactions.map((item) => Number(item.responseDelayMs || 0)).filter(Number.isFinite)),
  };
}

export function buildBehavioralDNA(interactions: Interaction[], currentIncomingText: string, relationship: ScenarioRelationship = "unknown"): BehavioralDNA {
  const usable = interactions.filter((item) => String(item.otherText || "").trim() && String(item.ownerReply || "").trim()).slice(0, 240);
  const groups = new Map<IncomingIntent, Interaction[]>();
  const scenarioGroups = new Map<string, Interaction[]>();
  const episodeRoutes: Array<{ interaction: Interaction; family: ScenarioRoute["family"]; mode: ScenarioMode }> = [];
  for (const interaction of usable) {
    const intent = classifyIncomingIntent(String(interaction.otherText || ""));
    const values = groups.get(intent) || [];
    values.push(interaction);
    groups.set(intent, values);
    const family = inferScenarioFamilies(intent, String(interaction.otherText || ""))[0]?.family
      || inferScenarioRoute({ intent, text: String(interaction.otherText || ""), relationship }).family;
    const mode = inferOwnerResponseMode(String(interaction.ownerReply || ""), family, relationship);
    const route = { family, relationship, mode };
    const id = routeScenario(route)[0];
    const scenarioValues = scenarioGroups.get(id) || [];
    scenarioValues.push(interaction);
    scenarioGroups.set(id, scenarioValues);
    episodeRoutes.push({ interaction, family, mode });
  }
  const byIncomingIntent = Object.fromEntries([...groups.entries()].map(([intent, values]) => [intent, bucket(values)])) as Partial<Record<IncomingIntent, BehavioralBucket>>;
  const byScenario = Object.fromEntries([...scenarioGroups.entries()].map(([id, values]) => [id, bucket(values)]));
  const activeIntent = classifyIncomingIntent(currentIncomingText);
  const currentFamilies = new Set(inferScenarioFamilies(activeIntent, currentIncomingText).map((candidate) => candidate.family));
  const modeEvidence: Partial<Record<ScenarioMode, number>> = {};
  for (const episode of episodeRoutes) {
    if (!currentFamilies.has(episode.family)) continue;
    modeEvidence[episode.mode] = (modeEvidence[episode.mode] || 0) + 1;
  }
  const posterior = inferScenarioPosterior({ intent: activeIntent, text: currentIncomingText, relationship, modeEvidence });
  const activeRoute = posterior.primary || inferScenarioRoute({ intent: activeIntent, text: currentIncomingText, relationship });
  const activeRoutes = [...new Set([...(posterior.candidates || []).map((candidate) => candidate.id), ...routeScenario(activeRoute)])].slice(0, 8);
  const exactScenario = activeRoutes.map((id) => byScenario[id]).find((candidate) => candidate?.sampleCount >= 2) || byScenario[activeRoutes[0]];
  const intentBucket = byIncomingIntent[activeIntent];
  return {
    version: 2,
    sampleCount: usable.length,
    activeIntent,
    activeScenario: {
      family: activeRoute.family,
      relationship: activeRoute.relationship,
      mode: activeRoute.mode,
      routes: activeRoutes,
      code: "code" in activeRoute ? activeRoute.code : scenarioCode(activeRoute.family, activeRoute.relationship, activeRoute.mode),
      taxonomyVersion: SCENARIO_TAXONOMY_VERSION,
      candidates: posterior.candidates || [],
      uncertainty: posterior.uncertainty ?? 1,
    },
    active: exactScenario?.sampleCount >= 2 ? exactScenario : intentBucket || exactScenario || bucket([]),
    global: bucket(usable),
    byIncomingIntent,
    byScenario,
  };
}
