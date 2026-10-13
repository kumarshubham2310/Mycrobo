import assert from "node:assert/strict";
import test from "node:test";

import { buildStory, decideReply, latestVerifiedHumanMessage } from "./conversation.ts";
import { CanonicalIdentityIndex } from "./identity.ts";
import { buildToneSamplePool } from "./tone.ts";
import { ApprovalLedger } from "./approval.ts";
import { createScenarioRegistry } from "./scenarios.ts";

const chat = { id: "chat:sakshi", connector: "fixture", connectorIds: ["phone", "lid"], title: "Sakshi", collection: "active", kind: "direct", participantIds: ["owner", "sakshi"] };
const watermark = { chatId: chat.id, state: "complete", reachedBeginning: true, oldestTimestampMs: 1, newestTimestampMs: 9, messageCount: 4, cursor: null, reason: "beginning-reached", verifiedAt: "2026-08-22T00:00:00.000Z" };
const event = (id, direction, text, timestampMs, kind = "text") => ({ id, chatId: chat.id, connectorMessageId: id, direction, senderId: direction === "owner" ? "owner" : "sakshi", senderName: direction === "owner" ? "You" : "Sakshi", kind, text, timestampMs, timestampVerified: timestampMs !== null, sequence: Number(id.replace(/\D/gu, "")) || 0 });

test("a verified newest owner message prevents a stale incoming reply recommendation", () => {
  const events = [event("m1", "contact", "Old question", 1), event("m2", "owner", "Already answered", 2)];
  assert.equal(latestVerifiedHumanMessage(events)?.id, "m2");
  assert.equal(decideReply({ chat, events, watermark, ownerIds: ["owner"] }).shouldDraft, false);
});

test("missing timestamps and WhatsApp controls cannot become the latest message", () => {
  const events = [
    event("m1", "owner", "Nhi bro", 1),
    event("m2", "contact", "PDF Wedding Invitation.pdf 5 pages:PDF-2 MB", null),
    event("m3", "contact", "You deleted this message", null),
    event("m4", "contact", "77 KB", null),
    event("m5", "contact", "Missed voice call Click to call back", null),
  ];
  assert.equal(latestVerifiedHumanMessage(events)?.text, "Nhi bro");
  assert.equal(decideReply({ chat, events, watermark, ownerIds: ["owner"] }).status, "no-reply-needed");
});

test("reply necessity is independent and treats a direct acknowledgement as optional", () => {
  const incoming = [event("m1", "contact", "Okay", 9)];
  const decision = decideReply({ chat, events: incoming, watermark, ownerIds: ["owner"] });
  assert.equal(decision.shouldDraft, false);
  assert.equal(decision.category, "optional-acknowledgement");
  assert.equal(decision.target.id, "m1");
});

test("speaker roles remain explicit while the story spans older facts and recent turns", () => {
  const events = Array.from({ length: 300 }, (_, index) => event(`m${index}`, index % 2 ? "owner" : "contact", `turn ${index}`, index + 1));
  events[12] = event("fact-rain", "contact", "The rain moved our Tuesday meeting", 13);
  const story = buildStory(events, 80);
  assert.ok(story.some((item) => item.text.includes("rain moved")));
  assert.ok(story.some((item) => item.direction === "owner"));
  assert.ok(story.some((item) => item.direction === "contact"));
});

test("phone JID and LID resolve to one canonical conversation", () => {
  const index = new CanonicalIdentityIndex();
  index.link("person:sakshi", ["919999@s.whatsapp.net", "260000@lid"]);
  assert.equal(index.resolve("919999@s.whatsapp.net"), "person:sakshi");
  assert.equal(index.resolve("260000@LID"), "person:sakshi");
});

test("person-specific recent outgoing evidence outranks the general tone pool", () => {
  const now = 2_000_000;
  const events = [
    event("m1", "owner", "haa done", 1),
    { ...event("m2", "owner", "Majama", now - 10), chatId: chat.id },
    { ...event("m3", "owner", "formal general sample", now - 1), chatId: "chat:client" },
  ];
  const samples = buildToneSamplePool({ allEvents: events, relationshipChatId: chat.id, nowMs: now, maximum: 30 });
  assert.equal(samples[0].relationshipSpecific, true);
  assert.equal(samples[0].text, "Majama");
});

test("time, location and commitment facts are excluded from verbatim tone examples", () => {
  const now = 2_000_000;
  const events = [
    { ...event("m1", "owner", "I will send it tomorrow at 7 pm", now - 4), chatId: chat.id },
    { ...event("m2", "owner", "Main office mein hu", now - 3), chatId: chat.id },
    { ...event("m3", "owner", "Haan, subah bata dunga", now - 2), chatId: chat.id },
    { ...event("m4", "owner", "Koi na 😊", now - 1), chatId: chat.id },
  ];
  const samples = buildToneSamplePool({ allEvents: events, relationshipChatId: chat.id, nowMs: now });
  assert.deepEqual(samples.map((sample) => sample.text), ["Koi na 😊"]);
});

test("all 1,500 scenarios receive a deterministic bounded temperature and evidence note", () => {
  const events = [event("m1", "owner", "haa done", 1), event("m2", "contact", "Okay", 2)];
  const first = createScenarioRegistry(events);
  const second = createScenarioRegistry(events);
  assert.equal(first.length, 1500);
  assert.equal(new Set(first.map((item) => item.id)).size, 1500);
  assert.deepEqual(first, second);
  assert.ok(first.every((item) => item.temperature >= 0.45 && item.temperature <= 0.82 && item.note));
});

test("approval ledger requires the exact recipient and text and is idempotent", () => {
  const ledger = new ApprovalLedger();
  ledger.create({ id: "draft-1", chatId: chat.id, chatTitle: chat.title, replyToMessageId: "m1", text: "haa done", createdAt: "2026-08-22T00:00:00Z" });
  assert.throws(() => ledger.approve({ draftId: "draft-1", requestId: "request-1", confirmedChatId: "wrong", confirmedText: "haa done", approvalVersion: "draft-approval.1", now: "2026-08-22T00:01:00Z" }), /does not exactly match/u);
  const approved = ledger.approve({ draftId: "draft-1", requestId: "request-1", confirmedChatId: chat.id, confirmedText: "haa done", approvalVersion: "draft-approval.1", now: "2026-08-22T00:01:00Z" });
  assert.deepEqual(ledger.approve({ draftId: "draft-1", requestId: "request-1", confirmedChatId: chat.id, confirmedText: "haa done", approvalVersion: "draft-approval.1", now: "2026-08-22T00:02:00Z" }), approved);
});
