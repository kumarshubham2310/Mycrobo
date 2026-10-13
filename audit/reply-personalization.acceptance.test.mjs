import assert from "node:assert/strict";
import test from "node:test";

import { decideReply } from "../packages/core/conversation.ts";
import { buildDraftContext } from "../packages/core/draft.ts";
import { createLocalDraftProvider } from "../services/gateway/draft-provider.mjs";

const START = 1_780_000_000_000;
const EMPTY_ACK = /^(?:ok(?:ay)?|got it|noted|haan|haan,?\s*(?:ok(?:ay)?|thee?k hai)?|thee?k hai|thanks(?: for (?:sharing|letting me know))?|👍)[.!\s]*$/iu;

function fixtureChat(id, { kind = "direct", title = "Test contact" } = {}) {
  return {
    id,
    connector: "fixture",
    connectorIds: [id],
    title,
    collection: "active",
    kind,
    participantIds: ["owner", `${id}:other`],
  };
}

function fixtureEvent(chatId, sequence, direction, text, extra = {}) {
  const id = extra.id || `${chatId}:m${sequence}`;
  return {
    id,
    chatId,
    connectorMessageId: id,
    direction,
    senderId: direction === "owner" ? "owner" : `${chatId}:other`,
    senderName: direction === "owner" ? "You" : "Other person",
    kind: "text",
    text,
    timestampMs: START + sequence * 60_000,
    timestampVerified: true,
    sequence,
    ...extra,
  };
}

function watermark(chatId, events) {
  const times = events.filter((event) => event.timestampVerified && event.timestampMs !== null).map((event) => event.timestampMs);
  return {
    chatId,
    state: "complete",
    reachedBeginning: true,
    oldestTimestampMs: Math.min(...times),
    newestTimestampMs: Math.max(...times),
    messageCount: events.length,
    cursor: null,
    reason: "beginning-reached",
    verifiedAt: new Date(Math.max(...times)).toISOString(),
  };
}

function contextFor(chat, events, options = {}) {
  const target = [...events].reverse().find((event) =>
    event.direction === "contact"
    && event.timestampVerified
    && event.timestampMs !== null
    && (event.kind === "text" || ["image", "video", "audio", "document", "sticker", "view_once", "media"].includes(event.kind)));
  return buildDraftContext({
    chat,
    chatEvents: events,
    allEvents: options.allEvents || events,
    allChats: options.allChats || [chat],
    watermark: watermark(chat.id, events),
    ownerIds: ["owner"],
    expectedTargetMessageId: target.id,
    preferences: options.preferences,
    nowMs: START + (events.length + 20) * 60_000,
  });
}

async function draftFor(chat, events, options = {}) {
  const context = contextFor(chat, events, options);
  const result = await createLocalDraftProvider().generate(context);
  return { context, result };
}

function assertSubstantive(text, label) {
  assert.equal(EMPTY_ACK.test(String(text || "").trim()), false, `${label} collapsed to a vacuous acknowledgement: ${text}`);
}

test("generic factual update: reply is situation-specific, not an empty acknowledgement", async () => {
  const chat = fixtureChat("statement");
  const events = [fixtureEvent(chat.id, 1, "contact", "I have reached the hotel safely")];
  const { result } = await draftFor(chat, events);
  assertSubstantive(result.draft, "arrival update");
  assert.match(result.draft, /(?:rest|safe|glad|good to know|travel)/iu, "The draft should respond to the arrival, not merely confirm receipt.");
});

test("direct factual question: unknown current truth stays editable and is not evaded", async () => {
  const chat = fixtureChat("direct-question");
  const events = [fixtureEvent(chat.id, 1, "contact", "Did the vendor approve the revised amount?")];
  const { result } = await draftFor(chat, events);
  assertSubstantive(result.draft, "direct question");
  assert.match(result.draft, /\[(?:add|say|confirm|enter)[^\]]*(?:status|answer|approval|approved)[^\]]*\]/iu,
    "The system must request the missing answer/status instead of asking what the clear question means.");
});

test("time and commitment: no schedule or promise is invented", async () => {
  const chat = fixtureChat("time-commitment");
  const events = [fixtureEvent(chat.id, 1, "contact", "Can you send the final file tomorrow by 4 pm?")];
  const { context, result } = await draftFor(chat, events);
  assert.equal(context.safety.requiresCurrentFact, true);
  assert.match(result.draft, /\[|\{\{(?:date|time)\}\}/u, "The owner must supply or confirm the time-bound commitment.");
  assert.doesNotMatch(result.draft, /\b(?:i(?:'|’)ll|i will|bhej dunga|mokli daish)\b/iu);
});

test("Roman Hindi: reply preserves register and answers the whole incoming turn", async () => {
  const chat = fixtureChat("roman-hindi");
  const events = [
    fixtureEvent(chat.id, 1, "contact", "Kal rain ka kya scene hai?"),
    fixtureEvent(chat.id, 2, "contact", "Umbrella leke aau kya?"),
  ];
  const { context, result } = await draftFor(chat, events);
  assert.deepEqual(context.currentIncomingTurn.messageIds, [events[0].id, events[1].id]);
  assert.equal(result.language, "Roman Hindi");
  assertSubstantive(result.draft, "Roman Hindi turn");
  assert.match(result.draft, /(?:umbrella|rain|baarish|leke|laana|pata|check|\[)/iu,
    "The reply must address the rain/umbrella story rather than return a generic question.");
});

test("Roman Gujarati: time question keeps Gujarati register and an editable fact", async () => {
  const chat = fixtureChat("roman-gujarati");
  const events = [fixtureEvent(chat.id, 1, "contact", "Aaje meeting mate ketla vage nikadvanu chhe?")];
  const { result } = await draftFor(chat, events);
  assert.equal(result.language, "Roman Gujarati");
  assert.match(result.draft, /(?:\{\{time\}\}|\[(?:add|enter)[^\]]*time[^\]]*\])/iu);
});

test("mixed-language request: the draft preserves the action and code-switched intent", async () => {
  const chat = fixtureChat("mixed-language");
  const events = [fixtureEvent(chat.id, 1, "contact", "Deck final chhe? Client ko aaj bhejna hai, can you share it?")];
  const { result } = await draftFor(chat, events);
  assertSubstantive(result.draft, "mixed-language request");
  assert.match(result.draft, /(?:deck|client|share|send|bhej|mokli)/iu, "The requested sharing action must survive multilingual reasoning.");
  assert.match(result.draft, /\[|\{\{/u, "A time-bound send commitment must remain editable.");
});

test("attachment continuity: media remains part of the verified conversational story", () => {
  const chat = fixtureChat("attachment-context");
  const events = [
    fixtureEvent(chat.id, 1, "contact", "Please review this proposal and tell me what should change"),
    fixtureEvent(chat.id, 2, "contact", "Proposal v3", { id: `${chat.id}:attachment`, kind: "document", media: { mimeType: "application/pdf" } }),
  ];
  const context = contextFor(chat, events);
  assert.ok(context.story.some((event) => event.id === `${chat.id}:attachment`),
    "The media event must be retained so the draft cannot pretend the attachment was unseen.");
  assert.equal(context.freshness.targetMessageId, `${chat.id}:attachment`,
    "The latest displayable attachment, not an older text bubble, must be the verified reply target.");
});

test("group no-reply: an unaddressed announcement does not create a draft", () => {
  const chat = fixtureChat("group-announcement", { kind: "group", title: "Test group" });
  const events = [fixtureEvent(chat.id, 1, "contact", "Reminder: the office will remain closed on Saturday", { mentionsOwner: false })];
  const decision = decideReply({ chat, events, watermark: watermark(chat.id, events), ownerIds: ["owner"] });
  assert.equal(decision.shouldDraft, false);
  assert.equal(decision.category, "group-not-addressed");
});

function relationshipHistory(chat, replies) {
  const events = [];
  let sequence = 1;
  for (const reply of replies) {
    events.push(fixtureEvent(chat.id, sequence++, "contact", "The work update is ready"));
    events.push(fixtureEvent(chat.id, sequence++, "owner", reply));
  }
  events.push(fixtureEvent(chat.id, sequence, "contact", "The material is packed and ready"));
  return events;
}

test("person-specific distinction: two relationships do not receive the same generic voice", async () => {
  const formal = fixtureChat("formal-person", { title: "Formal contact" });
  const casual = fixtureChat("casual-person", { title: "Casual contact" });
  const formalEvents = relationshipHistory(formal, [
    "Perfect, thank you.",
    "Understood, please proceed.",
    "Thank you, please keep me posted.",
    "Very good, thank you.",
  ]);
  const casualEvents = relationshipHistory(casual, ["Badhiya bhai", "Sahi hai bhai", "Mast bhai", "Kar de bhai"]);
  const allEvents = [...formalEvents, ...casualEvents];
  const allChats = [formal, casual];
  const formalDraft = (await draftFor(formal, formalEvents, { allEvents, allChats })).result.draft;
  const casualDraft = (await draftFor(casual, casualEvents, { allEvents, allChats })).result.draft;
  assert.notEqual(formalDraft.toLocaleLowerCase(), casualDraft.toLocaleLowerCase(), "Distinct relationship evidence must produce distinct replies.");
  assert.match(formalDraft, /(?:thank|please|perfect|understood|very good)/iu, "Formal learned register was not reflected.");
  assert.match(casualDraft, /(?:bhai|badhiya|sahi|mast)/iu, "Casual learned register was not reflected.");
});

test("portfolio gate: diverse situations do not collapse into a canned acknowledgement bank", async () => {
  const inputs = [
    "I have reached the airport safely",
    "The revised quotation is ready",
    "Here is the link: https://example.invalid/document",
    "The rain has stopped here",
    "Client approved the design",
    "The parcel was delivered",
    "Meeting room has changed to the second floor",
    "I spoke with the vendor and resolved it",
  ];
  const drafts = [];
  for (const [index, input] of inputs.entries()) {
    const chat = fixtureChat(`portfolio-${index}`);
    drafts.push((await draftFor(chat, [fixtureEvent(chat.id, 1, "contact", input)])).result.draft);
  }
  const vacuous = drafts.filter((draft) => EMPTY_ACK.test(draft));
  const unique = new Set(drafts.map((draft) => draft.toLocaleLowerCase().replace(/\s+/gu, " ").trim()));
  assert.ok(vacuous.length <= 1, `At most 1/8 replies may be vacuous; observed ${vacuous.length}/8.`);
  assert.ok(unique.size >= 6, `At least 6/8 replies must be materially distinct; observed ${unique.size}/8.`);
});
