import assert from "node:assert/strict";
import test from "node:test";

import { buildCommunicationDNA, buildSyncTruth, buildVerifiedContext } from "./product-intelligence.mjs";

test("verified context keeps source-backed story fields separate", () => {
  const context = buildVerifiedContext({
    latest: { id: "m3", text: "Where are you?" },
    watermark: { verifiedAt: "2026-08-29T10:00:00Z", reachedBeginning: false, messageCount: 95 },
  }, {
    latest_message_id: "m3",
    current_topic: { text: "Meeting location" },
    latest_intent: "location-question",
    conversation_status: "awaiting_owner",
    open_questions: [{ id: "q1", question: "Where are you?", asked_by_owner: false, status: "current", provenance: { source_message_id: "m3", occurred_at: "2026-08-29T09:59:00Z", confidence: 1 } }],
    commitments: [{ id: "c1", action: "Confirm in the morning", actor_is_owner: true, status: "current", provenance: { source_message_id: "m2" } }],
    recent_facts: [],
  });
  assert.equal(context.topic, "Meeting location");
  assert.equal(context.questions[0].sourceMessageId, "m3");
  assert.equal(context.commitments[0].speaker, "you");
  assert.equal(context.reachedBeginning, false);
});

test("communication DNA reports evidence stage without a fake percentage", () => {
  const chat = { id: "chat-1", kind: "direct", title: "Sakshi", participantIds: ["owner", "person-1"], connector: "test", connectorIds: ["chat-1"], collection: "active" };
  const events = Array.from({ length: 12 }, (_, index) => ({ id: `m${index}`, chatId: "chat-1", connectorMessageId: `m${index}`, senderId: index % 2 ? "owner" : "person-1", direction: index % 2 ? "owner" : "contact", kind: "text", text: index % 2 ? "Haan okay" : "Can you check?", timestampMs: 1_700_000_000_000 + index * 1_000, timestampVerified: true }));
  const dna = buildCommunicationDNA(chat, events, events);
  assert.equal(dna.evidenceLevel, "learning");
  assert.equal(dna.personSpecificEvidence, 6);
  assert.equal("toneMatchPercentage" in dna, false);
});

test("sync truth never calls partial history complete", () => {
  const truth = buildSyncTruth({
    status: { connected: true },
    active: [
      { watermark: { state: "complete", reachedBeginning: true, verifiedAt: "2026-08-29T10:00:00Z", messageCount: 50 } },
      { watermark: { state: "partial", reachedBeginning: false, verifiedAt: "2026-08-29T10:00:00Z", messageCount: 45 } },
    ],
    archived: [{ watermark: { state: "failed", reachedBeginning: false, messageCount: 10 } }],
  });
  assert.equal(truth.completeHistoryChats, 1);
  assert.equal(truth.partialHistoryChats, 1);
  assert.equal(truth.failedHistoryChats, 1);
  assert.equal(truth.savedMessages, 105);
  assert.equal(truth.allHistoryProven, false);
});
