import assert from "node:assert/strict";
import test from "node:test";

import { collapseRepeatedDisplayText, connectionPresentation, conversationStatusPresentation, draftRouteLabel, draftTargetId, presentChats, shouldPresentConnectionSetup, shownPreview, shownSender, shownTitle } from "./chat-presentation.mjs";

test("chat list hides unresolved linked-device, group, newsletter and empty-phone identities", () => {
  const visible = presentChats([
    { id: "lid:75905108058316@lid", title: "75905108058316", latest: null },
    { id: "lid:97568805630117@lid", title: "97568805630117", latest: { text: "Hello", timestampMs: 4 } },
    { id: "jid:120363162274127340@newsletter", title: "120363162274127340", latest: { text: "Update", timestampMs: 3 } },
    { id: "jid:120363411702729817@g.us", title: "120363411702729817", latest: { text: "Group", timestampMs: 2 } },
    { id: "jid:917988376784-1596299657@g.us", title: "917988376784-1596299657", latest: { text: "Older group", timestampMs: 2 } },
    { id: "jid:919909922845@s.whatsapp.net", title: "919909922845", latest: null },
  ]);
  assert.deepEqual(visible, []);
});

test("chat list keeps named conversations and readable unsaved phone chats", () => {
  const visible = presentChats([
    { id: "lid:263328807014604@lid", title: "Sakshi", latest: { text: "Office se niklungi", timestampMs: 2 } },
    { id: "jid:919909922845@s.whatsapp.net", title: "919909922845", latest: { text: "Hi", timestampMs: 3 } },
    { id: "lid:210342047137825@lid", title: "Murli Chandak", latest: null },
  ]);
  assert.deepEqual(visible.map(shownTitle), ["+919909922845", "Sakshi", "Murli Chandak"]);
});

test("chat presentation rejects punctuation metadata and keeps emoji labels", () => {
  const visible = presentChats([
    { id: "lid:bad@lid", title: ".", latest: { text: "Tracking URL", timestampMs: 4 } },
    { id: "lid:emoji@lid", title: "👨‍👩‍👧", latest: { text: "Hello", timestampMs: 3 } },
  ]);
  assert.deepEqual(visible.map(shownTitle), ["👨‍👩‍👧"]);
  assert.equal(shownSender({ direction: "contact", senderName: "." }, { kind: "direct" }), "Other person");
  assert.equal(shownSender({ direction: "contact", senderName: "." }, { kind: "group" }), "Group member");
});

test("draft anyway targets the verified latest message when no reply is recommended", () => {
  assert.equal(draftTargetId({ latest: { id: "owner-latest" }, reply: { target: null } }), "owner-latest");
  assert.equal(draftTargetId({ latest: { id: "latest" }, reply: { target: { id: "incoming-target" } } }), "incoming-target");
});

test("chat presentation removes exact connector echo without changing short natural repetition", () => {
  const repeatedUrl = "https://example.com/reporthttps://example.com/report";
  assert.equal(collapseRepeatedDisplayText(repeatedUrl), "https://example.com/report");
  assert.equal(shownPreview({ latest: { text: repeatedUrl } }), "https://example.com/report");
  assert.equal(shownTitle({ title: "Long ContactLong Contact" }), "Long Contact");
  assert.equal(collapseRepeatedDisplayText("haha"), "haha");
});

test("draft labels report real personalization and provider fallback without a fake score", () => {
  assert.equal(draftRouteLabel({
    historyComplete: false,
    draftRoute: {
      generation: { path: "local-fallback", providerStatus: "failed-fell-back" },
      personalization: { basis: "same-person-semantic" },
    },
  }, "Sakshi"), "Suggested reply · learned from your conversations with Sakshi · private fallback used because the model was unavailable · earlier history is still being learned");
  assert.doesNotMatch(draftRouteLabel({ draftRoute: { generation: { path: "local" }, personalization: { basis: "owner-global-fallback" } } }), /%|tone match/iu);
});

test("connection states remain distinct and honest", () => {
  assert.equal(connectionPresentation({ connected: true, sendAvailable: true }).code, "connected");
  assert.match(connectionPresentation({ connected: true, sendAvailable: false }).label, /review-only/iu);
  assert.equal(connectionPresentation({ connected: false, connectionState: "reauth-required" }, { hasSavedChats: true }).code, "reauth-required");
  assert.match(connectionPresentation({ connected: false }, { hasSavedChats: true }).label, /saved chats available/iu);
  assert.match(connectionPresentation(null, { serviceReachable: false, hasSavedChats: true }).label, /unchanged/iu);
});

test("background connection checks never take over non-chat tabs", () => {
  const disconnected = { connected: false, connectionState: "reauth-required", pairing: { state: "unpaired" } };
  for (const view of ["pending", "tasks", "followups", "connections", "settings", "admin"]) assert.equal(shouldPresentConnectionSetup({ view, status: disconnected, hasSavedChats: true }), false, view);
  assert.equal(shouldPresentConnectionSetup({ view: "chats", status: disconnected, hasSavedChats: true }), true);
  assert.equal(shouldPresentConnectionSetup({ view: "chats", status: disconnected, hasSavedChats: true, setupDismissed: true }), false);
});

test("active pairing stays visible on Chats without affecting another selected view", () => {
  const pairing = { connected: false, connectionState: "connecting", pairing: { state: "scan-required" } };
  assert.equal(shouldPresentConnectionSetup({ view: "chats", status: pairing, hasSavedChats: true }), true);
  assert.equal(shouldPresentConnectionSetup({ view: "settings", status: pairing, hasSavedChats: true }), false);
});

test("conversation status is human-readable without exposing backfill mechanics", () => {
  const partial = conversationStatusPresentation({ verifiedAt: "2026-09-13T10:00:00.000Z", messageCount: 95, reachedBeginning: false, state: "partial" });
  assert.equal(partial.current, true);
  assert.equal(partial.messageCount, 95);
  assert.match(partial.label, /Learning from older conversations/iu);
  assert.doesNotMatch(partial.label, /backfill|cursor|page|95 messages/iu);
  const offline = conversationStatusPresentation({ messageCount: 40, reachedBeginning: false, state: "syncing" });
  assert.equal(offline.current, false);
  assert.match(offline.label, /reconnect/iu);
});
