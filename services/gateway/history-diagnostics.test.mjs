import assert from "node:assert/strict";
import test from "node:test";

import { assertContentFreeHistoryTruth, contentFreeHistoryTruth, opaqueChatReference } from "./history-diagnostics.mjs";

test("history diagnostics expose per-chat truth without persistent ids or message content", () => {
  const report = contentFreeHistoryTruth([{
    chat: { id: "919999999999@s.whatsapp.net", title: "Private person", collection: "archived", kind: "direct" },
    truth: {
      current_message: { state: "ready", reason: "generic" },
      current_story: { state: "ready", reason: "generic" },
      relationship_history: { state: "partial", reason: "generic" },
      lifetime_history: { state: "partial", reason: "generic" },
      coverage: {
        locally_stored_messages: 42,
        timestamped_messages: 41,
        owner_text_messages: 12,
        provider_reported_messages_seen: 15,
        provider_beginning_reached: false,
        oldest_message_at: "2026-01-01T00:00:00Z",
        newest_message_at: "2026-09-13T00:00:00Z",
      },
    },
  }], { tenantId: "tenant-private", totalChats: 2 });
  assertContentFreeHistoryTruth(report);
  assert.equal(report.chats[0].chatRef, opaqueChatReference("tenant-private", "919999999999@s.whatsapp.net"));
  assert.equal(report.chats[0].locallyStoredMessages, 42);
  assert.equal(report.chats[0].providerBeginningReached, false);
  assert.equal(report.nextCursor, 1);
  const raw = JSON.stringify(report);
  assert.doesNotMatch(raw, /Private person|919999999999|s\.whatsapp/iu);
});

test("history diagnostic validator rejects accidental content fields", () => {
  assert.throws(() => assertContentFreeHistoryTruth({ schema: "mycrobo-content-free-history-truth.1", chats: [{ text: "private" }] }), /forbidden content/iu);
});

test("history diagnostics do not echo provider error text", () => {
  const report = contentFreeHistoryTruth([{
    chat: { id: "private-id" },
    truth: null,
    errorCode: "private-person-name-and-phone-919999999999",
  }]);
  assert.equal(report.chats[0].errorCode, "TRUTH_UNAVAILABLE");
  assert.doesNotMatch(JSON.stringify(report), /private-person|919999999999/iu);
});
