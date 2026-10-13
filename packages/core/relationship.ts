import { isHumanText, orderedEvents } from "./conversation.ts";
import type { CanonicalChat, MessageEvent } from "./domain.ts";
import type { ScenarioRelationship } from "./scenarios.ts";

export type WritingMode = "English" | "Hindi" | "Gujarati" | "Roman Hindi" | "Roman Gujarati" | "Mixed" | "Unknown";
export type RelationshipCategory = "professional" | "personal" | "task-oriented" | "mixed" | "unknown";

export type RelationshipContextProfile = {
  chatId: string;
  chatKind: CanonicalChat["kind"];
  category: RelationshipCategory;
  categoryConfidence: number;
  scenarioRelationship: ScenarioRelationship;
  scenarioRelationshipConfidence: number;
  evidenceMessageIds: string[];
  ownerMessageCount: number;
  contactMessageCount: number;
  medianOwnerMessageCharacters: number;
  medianOwnerReplyCharacters: number;
  ownerEmojiRate: number;
  ownerQuestionRate: number;
  ownerAcknowledgementRate: number;
  ownerAddressForms: string[];
  writingModes: Array<{ mode: WritingMode; count: number }>;
  codeSwitchRate: number;
  typicalResponseDelayMs: number | null;
};

export type PersonRelationshipModel = {
  personId: string;
  builtAt: string;
  chatIds: string[];
  sharedGroupIds: string[];
  contexts: RelationshipContextProfile[];
  aggregate: Omit<RelationshipContextProfile, "chatId" | "chatKind">;
};

const ROMAN_HINDI = new Set("aaj abhi acha accha aur badhiya bata batao bhej bhejo bhai bolo chalo dekh dekhta deta deti dunga dungi hai hain haa haan ho hoon kal kar karna karo koi kr krna kro kya kyu kyun mai main meko mujhe nahi nhi nikla nikli niklungi office pahunch phone raha rahi sahi se shaam shi sirf subah theek thik tum wala yaar".split(" "));
const ROMAN_GUJARATI = new Set("aaje atyare bhai chhe cho chu ha have joi kai karis kari kari dau kem ketla kyare lau maja majama mane mokal mokli moklo nathi nahi pahochvano pan saras savare shu su sudhi tamare tane thase vage vandho".split(" "));
const ACKNOWLEDGEMENTS = /^(?:ok(?:ay)?|haan+|haa+|ha+|yes|done|theek|thik|acha|accha|sure|fine|got it|noted|majama|barabar|thase|👍|👌|✅)[.!…\s\p{Extended_Pictographic}]*$/iu;
const ADDRESS_FORM = /\b(?:bhai|bro|boss|sir|ma'am|madam|yaar|didi|bhaiya|ji)\b/giu;
const PROFESSIONAL = /\b(?:audit|client|company|deadline|document|invoice|meeting|office|payment|project|report|review|tax|team|work)\b/giu;
const PERSONAL = /\b(?:birthday|dinner|family|ghar|home|love|mummy|papa|party|yaar|vacation|wedding)\b/giu;
const TASK = /\b(?:call|check|confirm|complete|do|finish|forward|send|share|submit|update|bhej|kar|moklo)\b/giu;
const RELATIONSHIP_SIGNALS: Record<Exclude<ScenarioRelationship, "unknown">, RegExp> = {
  family: /\b(?:dad|daddy|father|mom|mum|mummy|mother|papa|pappa|bhaiya|didi|sister|brother|family|parivar)\b/giu,
  "close-friend": /\b(?:bestie|best friend|bachpan|yaar|bro|buddy|love you|miss(?:ing)? you)\b/giu,
  friend: /\b(?:friend|birthday|party|dinner|hangout|movie|trip|vacation|wedding)\b/giu,
  colleague: /\b(?:colleague|coworker|office|team|work|meeting|report|audit|deadline|internal)\b/giu,
  manager: /\b(?:manager|boss|sir|ma'am|madam|director|hod|reporting manager)\b/giu,
  client: /\b(?:client|customer|engagement|proposal|scope|invoice|deliverable|professional fee)\b/giu,
  vendor: /\b(?:vendor|supplier|quotation|quote|purchase order|dispatch|delivery|stock|rate|pricing)\b/giu,
  community: /\b(?:community|association|society|committee|members|everyone|group|announcement)\b/giu,
  acquaintance: /\b(?:hello sir|hello ma'am|nice to meet|connected via|reference of|introduction)\b/giu,
};

function words(text: string) {
  return text.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function detectWritingMode(text: string): WritingMode {
  const value = String(text || "").normalize("NFKC");
  const hasHindiScript = /\p{Script=Devanagari}/u.test(value);
  const hasGujaratiScript = /\p{Script=Gujarati}/u.test(value);
  const tokens = words(value);
  const hindi = tokens.filter((token) => ROMAN_HINDI.has(token)).length;
  const gujarati = tokens.filter((token) => ROMAN_GUJARATI.has(token)).length;
  const latin = /\p{Script=Latin}/u.test(value);
  const signals = [hasHindiScript, hasGujaratiScript, hindi > 0, gujarati > 0].filter(Boolean).length;
  if ((hasHindiScript || hasGujaratiScript) && (latin || signals > 1)) return "Mixed";
  if (hasHindiScript) return "Hindi";
  if (hasGujaratiScript) return "Gujarati";
  if (hindi && gujarati) return "Mixed";
  if (hindi) return "Roman Hindi";
  if (gujarati) return "Roman Gujarati";
  if (latin) return "English";
  return "Unknown";
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function countMatches(text: string, pattern: RegExp) {
  return [...text.matchAll(pattern)].length;
}

function inferCategory(events: MessageEvent[]) {
  const evidence = events.map((event) => event.text).join("\n");
  const scores = {
    professional: countMatches(evidence, PROFESSIONAL),
    personal: countMatches(evidence, PERSONAL),
    "task-oriented": countMatches(evidence, TASK),
  };
  const ranked = Object.entries(scores).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const total = Object.values(scores).reduce((sum, score) => sum + score, 0);
  if (!total) return { category: "unknown" as const, confidence: 0 };
  if (ranked[1][1] > 0 && ranked[0][1] / ranked[1][1] < 1.5) {
    return { category: "mixed" as const, confidence: Number((ranked[0][1] / total).toFixed(3)) };
  }
  return { category: ranked[0][0] as RelationshipCategory, confidence: Number((ranked[0][1] / total).toFixed(3)) };
}

function inferScenarioRelationship(chat: CanonicalChat, events: MessageEvent[]): { relationship: ScenarioRelationship; confidence: number } {
  if (chat.kind === "group") return { relationship: "community", confidence: 0.98 };
  const evidence = `${chat.title}\n${events.map((event) => event.text).join("\n")}`;
  const scores = Object.entries(RELATIONSHIP_SIGNALS).map(([relationship, pattern]) => ({
    relationship: relationship as Exclude<ScenarioRelationship, "unknown">,
    score: countMatches(evidence, pattern),
  })).sort((left, right) => right.score - left.score || left.relationship.localeCompare(right.relationship));
  const best = scores[0];
  const total = scores.reduce((sum, item) => sum + item.score, 0);
  if (!best?.score) {
    const humanCount = events.filter(isHumanText).length;
    return humanCount > 0 && humanCount <= 4
      ? { relationship: "acquaintance", confidence: 0.35 }
      : { relationship: "unknown", confidence: 0 };
  }
  const runnerUp = scores[1]?.score || 0;
  const confidence = Math.min(0.99, Math.max(0.45, best.score / Math.max(1, total) + Math.min(0.24, (best.score - runnerUp) * 0.08)));
  return { relationship: best.relationship, confidence: Number(confidence.toFixed(3)) };
}

export function buildChatRelationshipProfile(chat: CanonicalChat, events: MessageEvent[]): RelationshipContextProfile {
  const human = orderedEvents(events).filter(isHumanText);
  const owner = human.filter((event) => event.direction === "owner");
  const contact = human.filter((event) => event.direction === "contact");
  const replyLengths: number[] = [];
  const delays: number[] = [];
  for (let index = 0; index < human.length; index += 1) {
    if (human[index].direction !== "owner") continue;
    const prior = human[index - 1];
    if (prior?.direction !== "contact") continue;
    replyLengths.push([...human[index].text].length);
    if (human[index].timestampMs !== null && prior.timestampMs !== null) {
      delays.push(Math.max(0, human[index].timestampMs - prior.timestampMs));
    }
  }
  const modes = new Map<WritingMode, number>();
  for (const event of owner) {
    const mode = detectWritingMode(event.text);
    modes.set(mode, (modes.get(mode) ?? 0) + 1);
  }
  const category = inferCategory(human);
  const scenario = inferScenarioRelationship(chat, human);
  const addressForms = new Set<string>();
  for (const event of owner) {
    for (const match of event.text.matchAll(ADDRESS_FORM)) addressForms.add(match[0].toLocaleLowerCase());
  }
  return {
    chatId: chat.id,
    chatKind: chat.kind,
    category: category.category,
    categoryConfidence: category.confidence,
    scenarioRelationship: scenario.relationship,
    scenarioRelationshipConfidence: scenario.confidence,
    evidenceMessageIds: human.map((event) => event.id).slice(-200),
    ownerMessageCount: owner.length,
    contactMessageCount: contact.length,
    medianOwnerMessageCharacters: median(owner.map((event) => [...event.text].length)),
    medianOwnerReplyCharacters: median(replyLengths),
    ownerEmojiRate: owner.length ? Number((owner.filter((event) => /\p{Extended_Pictographic}/u.test(event.text)).length / owner.length).toFixed(3)) : 0,
    ownerQuestionRate: owner.length ? Number((owner.filter((event) => event.text.includes("?")).length / owner.length).toFixed(3)) : 0,
    ownerAcknowledgementRate: owner.length ? Number((owner.filter((event) => ACKNOWLEDGEMENTS.test(event.text.trim())).length / owner.length).toFixed(3)) : 0,
    ownerAddressForms: [...addressForms].sort(),
    writingModes: [...modes.entries()].map(([mode, count]) => ({ mode, count })).sort((left, right) => right.count - left.count || left.mode.localeCompare(right.mode)),
    codeSwitchRate: owner.length ? Number((owner.filter((event) => detectWritingMode(event.text) === "Mixed").length / owner.length).toFixed(3)) : 0,
    typicalResponseDelayMs: delays.length ? median(delays) : null,
  };
}

function aggregateProfiles(personId: string, contexts: RelationshipContextProfile[], builtAt: string, sharedGroupIds: string[]): PersonRelationshipModel {
  const totalOwner = contexts.reduce((sum, context) => sum + context.ownerMessageCount, 0);
  const totalContact = contexts.reduce((sum, context) => sum + context.contactMessageCount, 0);
  const weighted = (key: "ownerEmojiRate" | "ownerQuestionRate" | "ownerAcknowledgementRate" | "codeSwitchRate") => totalOwner
    ? Number((contexts.reduce((sum, context) => sum + context[key] * context.ownerMessageCount, 0) / totalOwner).toFixed(3))
    : 0;
  const modeCounts = new Map<WritingMode, number>();
  for (const context of contexts) for (const item of context.writingModes) modeCounts.set(item.mode, (modeCounts.get(item.mode) ?? 0) + item.count);
  const evidenceIds = contexts.flatMap((context) => context.evidenceMessageIds).slice(-500);
  const categoryEvents = contexts.filter((context) => context.category !== "unknown");
  const categoryScores = new Map<RelationshipCategory, number>();
  for (const context of categoryEvents) categoryScores.set(context.category, (categoryScores.get(context.category) ?? 0) + context.categoryConfidence * (context.ownerMessageCount + context.contactMessageCount));
  const categoryRank = [...categoryScores.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const categoryTotal = categoryRank.reduce((sum, item) => sum + item[1], 0);
  const dominantScenario = [...contexts].sort((left, right) => right.ownerMessageCount - left.ownerMessageCount)[0];
  return {
    personId,
    builtAt,
    chatIds: contexts.map((context) => context.chatId),
    sharedGroupIds,
    contexts,
    aggregate: {
      category: categoryRank[0]?.[0] ?? "unknown",
      categoryConfidence: categoryTotal ? Number(((categoryRank[0]?.[1] ?? 0) / categoryTotal).toFixed(3)) : 0,
      scenarioRelationship: dominantScenario?.scenarioRelationship ?? "unknown",
      scenarioRelationshipConfidence: dominantScenario?.scenarioRelationshipConfidence ?? 0,
      evidenceMessageIds: evidenceIds,
      ownerMessageCount: totalOwner,
      contactMessageCount: totalContact,
      medianOwnerMessageCharacters: median(contexts.map((context) => context.medianOwnerMessageCharacters).filter(Boolean)),
      medianOwnerReplyCharacters: median(contexts.map((context) => context.medianOwnerReplyCharacters).filter(Boolean)),
      ownerEmojiRate: weighted("ownerEmojiRate"),
      ownerQuestionRate: weighted("ownerQuestionRate"),
      ownerAcknowledgementRate: weighted("ownerAcknowledgementRate"),
      ownerAddressForms: [...new Set(contexts.flatMap((context) => context.ownerAddressForms))].sort(),
      writingModes: [...modeCounts.entries()].map(([mode, count]) => ({ mode, count })).sort((left, right) => right.count - left.count || left.mode.localeCompare(right.mode)),
      codeSwitchRate: weighted("codeSwitchRate"),
      typicalResponseDelayMs: median(contexts.map((context) => context.typicalResponseDelayMs).filter((value): value is number => value !== null)),
    },
  };
}

export function buildPersonRelationshipModel(options: {
  personId: string;
  chats: CanonicalChat[];
  events: MessageEvent[];
  nowMs: number;
}): PersonRelationshipModel {
  const personChats = options.chats.filter((chat) => chat.participantIds.includes(options.personId));
  const contexts = personChats.map((chat) => buildChatRelationshipProfile(chat, options.events.filter((event) => event.chatId === chat.id)));
  return aggregateProfiles(
    options.personId,
    contexts,
    new Date(options.nowMs).toISOString(),
    personChats.filter((chat) => chat.kind === "group").map((chat) => chat.id),
  );
}
