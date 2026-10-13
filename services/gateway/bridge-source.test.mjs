import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createBridgeSource } from "./bridge-source.mjs";
import { buildDraftContext } from "../../packages/core/draft.ts";

function reply(response, value, status = 200, type = "application/json") {
  response.writeHead(status, { "content-type": type });
  response.end(type === "application/json" ? JSON.stringify(value) : value);
}

test("linked-device source uses durable history, exact latest human text and explicit speakers", async () => {
  let consentBody;
  let truthLatestSourceID = "m3";
  const authHeaders = [];
  const token = "0123456789abcdef0123456789abcdef";
  const bridge = createServer(async (request, response) => {
    authHeaders.push(request.headers.authorization);
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/v1/health") return reply(response, { status: "ok", connection: "current-read-only" });
    if (url.pathname === "/v1/link") return reply(response, { state: "paired" });
    if (url.pathname === "/v1/events") return reply(response, 'data: {"type":"message.created","data":{"chat_id":"contact@lid"}}\n\n', 200, "text/event-stream");
    if (url.pathname === "/v1/freshness") return reply(response, { state: "current-read-only", caught_up_at: "2026-08-22T09:31:00Z" });
    if (url.pathname === "/v1/link/start") {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      consentBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      return reply(response, { started: true, consent_id: "consent-1" }, 202);
    }
    if (url.pathname === "/v1/chats") {
      if (url.searchParams.get("archived") === "true") return reply(response, { items: [], next_cursor: "" });
      return reply(response, { items: [{
        id: "contact@lid",
        identity_id: "lid:sakshi",
        title: "Sakshi",
        is_group: false,
        archived: false,
        latest: { id: "m3", source_message_id: "m3", chat_id: "contact@lid", sender_id: "sakshi", sender_name: "Sakshi", from_me: false, kind: "text", text: "Subah bata dena pls", timestamp: "2026-08-22T09:30:00Z", timestamp_known: true, replyable: true },
        history: { chat_id: "contact@lid", status: "complete", messages_seen: 4, history_end_hit: true },
      }], next_cursor: "" });
    }
    if (url.pathname === "/v1/search") {
      return reply(response, { items: [{
        id: "contact@lid", source_id: "9199@s.whatsapp.net", title: "Sakshi", is_group: false, archived: false,
        latest: { id: "m3", source_message_id: "m3", chat_id: "contact@lid", sender_id: "sakshi", sender_name: "Sakshi", from_me: false, kind: "text", text: "Subah bata dena pls", timestamp: "2026-08-22T09:30:00Z", timestamp_known: true, replyable: true },
      }] });
    }
    if (url.pathname.endsWith("/latest")) {
      return reply(response, {
        latest: { id: "m3", source_message_id: "m3", chat_id: "contact@lid", sender_id: "sakshi", sender_name: "Sakshi", from_me: false, kind: "text", text: "Subah bata dena pls", timestamp: "2026-08-22T09:30:00Z", timestamp_known: true, replyable: true },
        history: { chat_id: "contact@lid", status: "complete", messages_seen: 4, history_end_hit: true },
        truth: {
          observed_at: "2026-08-22T09:31:00Z",
          latest_source_message_id: truthLatestSourceID,
          latest_text_message_id: "m3",
          current_message: { state: "ready", reason: "reconciled" },
          current_story: { state: "ready", reason: "projected" },
          relationship_history: { state: "complete", reason: "available" },
          lifetime_history: { state: "complete", reason: "beginning reached" },
          draft_from_current_story_allowed: true,
        },
      });
    }
    if (url.pathname === "/v1/chats/contact%40lid/truth" || url.pathname === "/v1/chats/contact@lid/truth") {
      return reply(response, {
        observed_at: "2026-08-22T09:31:00Z",
        latest_source_message_id: truthLatestSourceID,
        latest_text_message_id: "m3",
        current_message: { state: "ready", reason: "reconciled" },
        current_story: { state: "ready", reason: "projected" },
        relationship_history: { state: "complete", reason: "available" },
        lifetime_history: { state: "complete", reason: "beginning reached" },
        draft_from_current_story_allowed: true,
        coverage: { state: "complete", locally_stored_messages: 4, provider_beginning_reached: true },
      });
    }
    if (url.pathname === "/v1/tone-samples") {
      return reply(response, {
        general: [{ id: "tone-1", source_message_id: "tone-1", chat_id: "other-chat", sender_id: "owner", sender_name: "Owner", from_me: true, kind: "text", text: "Thik hai", timestamp: "2026-08-21T09:30:00Z", timestamp_known: true, replyable: true }],
        person_specific: [{ id: "m2", source_message_id: "m2", chat_id: "contact@lid", sender_id: "owner", sender_name: "Owner", from_me: true, kind: "text", text: "Dekhta hu", timestamp: "2026-08-22T09:29:00Z", timestamp_known: true, replyable: true }],
      });
    }
    if (url.pathname === "/v1/response-episodes") {
      return reply(response, { account_scope_id: "local-test-account", items: [], chat_profiles: [] });
    }
	if (url.pathname === "/v1/chats/contact%40lid/state" || url.pathname === "/v1/chats/contact@lid/state") {
	  return reply(response, {
		chat_id: "contact@lid",
		version: 1,
		reduced_through_sequence: 4,
		current_topic: { text: "Subah bata dena pls", provenance: { source_message_id: "m3", source_event_id: "observed:m3", original_wording: "Subah bata dena pls", confidence: 1, safe_to_repeat: false } },
		open_questions: [{ id: "question:observed:m3", question: "Subah bata dena pls", asked_by_owner: false, status: "current", provenance: { source_message_id: "m3" } }],
		commitments: [],
		recent_facts: [],
		latest_intent: "request",
		conversation_status: "awaiting_owner",
		latest_message_id: "m3",
	  });
	}
    if (url.pathname === "/v1/link/qr.png") return reply(response, Buffer.from("png"), 200, "image/png");
    if (url.pathname === "/v1/chats/contact%40lid/messages" || url.pathname === "/v1/chats/contact@lid/messages") {
      return reply(response, { items: [
        { id: "system", source_message_id: "system", chat_id: "contact@lid", from_me: false, kind: "call", text: "Missed voice call", timestamp: "2026-08-22T09:31:00Z", timestamp_known: true, replyable: false },
        { id: "m3", source_message_id: "m3", chat_id: "contact@lid", sender_id: "sakshi", sender_name: "Sakshi", from_me: false, kind: "text", text: "Subah bata dena pls", timestamp: "2026-08-22T09:30:00Z", timestamp_known: true, replyable: true },
        { id: "m2", source_message_id: "m2", chat_id: "contact@lid", sender_id: "owner", sender_name: "Owner", from_me: true, kind: "text", text: "Dekhta hu", timestamp: "2026-08-22T09:29:00Z", timestamp_known: true, replyable: true },
        { id: "m1", source_message_id: "m1", chat_id: "contact@lid", sender_id: "sakshi", sender_name: "Sakshi", from_me: false, kind: "text", text: "Kal rain ka scene kya hai?", timestamp: "2026-08-22T09:28:00Z", timestamp_known: true, replyable: true },
      ] });
    }
    return reply(response, { error: "not found" }, 404);
  });
  await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve));
  const source = createBridgeSource(`http://127.0.0.1:${bridge.address().port}`, token);
  try {
    const status = await source.status();
    assert.equal(status.connected, true);
    const list = await source.listChats("active");
    assert.equal(list[0].latest.text, "Subah bata dena pls");
    assert.deepEqual(list[0].participantIds, ["lid:sakshi"]);
    const search = await source.searchChats("active", "rain");
    assert.equal(search[0].title, "Sakshi");
    assert.deepEqual(search[0].connectorIds, ["9199@s.whatsapp.net", "contact@lid"]);
    const exactLatest = await source.latest("contact@lid");
    assert.equal(exactLatest.latest.id, "m3");
    assert.equal(exactLatest.reply.shouldDraft, true);
    assert.equal(exactLatest.readiness.draftAllowed, true);
    const page = await source.messages("contact@lid", { limit: 200 });
    assert.deepEqual(page.events.filter((event) => event.kind === "text").map((event) => event.id), ["m1", "m2", "m3"]);
    const tone = await source.toneEvents("contact@lid");
    assert.deepEqual(tone.map((event) => event.text), ["Thik hai", "Dekhta hu"]);
	assert.equal(tone.every((event) => event.accountScopeId === "local-test-account"), true);
	const state = await source.conversationState("contact@lid");
	assert.equal(state.latest_message_id, "m3");
	assert.equal(state.current_topic.provenance.source_message_id, "m3");
    const qr = await source.pairingQR();
    assert.equal(qr.bytes.toString(), "png");
    const bundle = await source.bundle("contact@lid");
    assert.equal(bundle.accountScopeId, "local-test-account");
    assert.equal(bundle.chat.accountScopeId, "local-test-account");
    assert.equal(bundle.events.every((event) => event.accountScopeId === "local-test-account"), true);
    assert.equal(bundle.watermark.state, "complete");
    assert.equal(bundle.latest.id, "m3");
    assert.equal(bundle.reply.shouldDraft, true);
    assert.equal(bundle.readiness.currentMessage.state, "ready");
    assert.equal(bundle.readiness.currentStory.state, "ready");
    assert.equal(bundle.readiness.draftAllowed, true);
    assert.deepEqual(bundle.events.filter((event) => event.kind === "text").map((event) => event.direction), ["contact", "owner", "contact"]);
    assert.equal(bundle.events.at(-1).kind, "call");
    truthLatestSourceID = "newer-provider-message";
    const racedBundle = await source.bundle("contact@lid");
    assert.equal(racedBundle.readiness.currentMessage.state, "stale");
    assert.equal(racedBundle.readiness.currentStory.state, "stale");
    assert.equal(racedBundle.readiness.draftAllowed, false);
    const eventResponse = await source.events(AbortSignal.timeout(2_000));
    assert.match(await eventResponse.text(), /message\.created/u);
    await source.startImport();
    assert.deepEqual(consentBody, { import_all_chats: true, include_archived_chats: true, unofficial_risk_accepted: true });
    assert.equal(authHeaders.every((value) => value === `Bearer ${token}`), true);
  } finally {
    await new Promise((resolve) => bridge.close(resolve));
  }
});

test("cross-chat response episodes become content-free behavioral context without per-chat fetches", async () => {
  const requests = [];
  const bridge = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    requests.push(url.pathname);
    if (url.pathname === "/v1/chats") {
      if (url.searchParams.get("archived") === "true") return reply(response, { items: [], next_cursor: "" });
      return reply(response, { items: [{ id: "current-chat", identity_id: "lid:current", title: "New contact", is_group: false, archived: false }], next_cursor: "" });
    }
    if (url.pathname === "/v1/tone-samples") return reply(response, { general: [], person_specific: [], chat_profiles: [] });
    if (url.pathname === "/v1/response-episodes") {
      const crossChat = { id: "friend-chat", source_id: "friend-source", identity_id: "lid:friend", title: "Friend", is_group: false, archived: false };
      return reply(response, {
        account_scope_id: "tenant-local-proof",
        chat_profiles: [crossChat],
        items: [{
          id: "response:friend-chat:friend-in:friend-out",
          person_id: "lid:friend",
          chat: crossChat,
          relationship_kind: "direct-person",
          fact_eligible: false,
          use: "style-learning-only",
          incoming_turn: [{ id: "friend-in", source_message_id: "source-friend-in", chat_id: "friend-chat", sender_id: "lid:friend", sender_name: "Friend", from_me: false, kind: "text", text: "The report is ready", timestamp: "2026-09-12T09:00:00Z", timestamp_known: true }],
          owner_reply: [{ id: "friend-out", source_message_id: "source-friend-out", chat_id: "friend-chat", sender_id: "owner", sender_name: "Owner", from_me: true, kind: "text", text: "Great, what is next?", timestamp: "2026-09-12T09:01:00Z", timestamp_known: true }],
          source_message_ids: ["source-friend-in", "source-friend-out"],
        }],
      });
    }
    return reply(response, { error: "not found" }, 404);
  });
  await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve));
  const source = createBridgeSource(`http://127.0.0.1:${bridge.address().port}`, "local-token");
  try {
    const tone = await source.toneContext("current-chat");
    assert.deepEqual(tone.events.map((event) => [event.id, event.direction]), [["friend-in", "contact"], ["friend-out", "owner"]]);
    assert.equal(tone.chats[0].participantIds[0], "lid:friend");
    assert.equal(tone.responseEpisodeCount, 1);

    const targetTimestamp = Date.parse("2026-09-12T10:00:00Z");
    const currentChat = { id: "current-chat", accountScopeId: tone.accountScopeId, connector: "personal-pilot", connectorIds: ["current-chat"], title: "New contact", collection: "active", kind: "direct", participantIds: ["lid:current"] };
    const currentEvents = [{ id: "current-in", accountScopeId: tone.accountScopeId, chatId: "current-chat", connectorMessageId: "source-current-in", direction: "contact", senderId: "lid:current", senderName: "New contact", kind: "text", text: "What is the next step?", timestampMs: targetTimestamp, timestampVerified: true, sequence: 1 }];
    const context = buildDraftContext({
      accountScopeId: tone.accountScopeId,
      chat: currentChat,
      chatEvents: currentEvents,
      allEvents: [...tone.events, ...currentEvents],
      allChats: [...tone.chats, currentChat],
      watermark: { chatId: "current-chat", state: "complete", reachedBeginning: true, oldestTimestampMs: targetTimestamp, newestTimestampMs: targetTimestamp, messageCount: 1, cursor: null, reason: "test", verifiedAt: "2026-09-12T10:00:01Z" },
      ownerIds: [],
      expectedTargetMessageId: "current-in",
      nowMs: targetTimestamp + 1000,
    });
    assert.equal(context.retrieval.phraseBank.availablePatternCount, 1);
    assert.equal(context.retrieval.phraseBank.selected.length, 0);
    assert.equal(context.relationship.ownerGlobalBehavioralDNA.sampleCount, 0);
    assert.doesNotMatch(JSON.stringify(context), /Great, what is next\?/u);
    assert.equal(requests.filter((path) => path === "/v1/response-episodes").length, 1);
    assert.equal(requests.filter((path) => path.includes("/messages")).length, 0);
    assert.throws(() => buildDraftContext({
      accountScopeId: "tenant-other",
      chat: currentChat,
      chatEvents: currentEvents,
      allEvents: [...tone.events, ...currentEvents],
      allChats: [...tone.chats, currentChat],
      watermark: { chatId: "current-chat", state: "complete", reachedBeginning: true, oldestTimestampMs: targetTimestamp, newestTimestampMs: targetTimestamp, messageCount: 1, cursor: null, reason: "test", verifiedAt: "2026-09-12T10:00:01Z" },
      ownerIds: [], expectedTargetMessageId: "current-in", nowMs: targetTimestamp + 1000,
    }), /account boundary/iu);
  } finally {
    await new Promise((resolve) => bridge.close(resolve));
  }
});

test("response-episode cache is bounded to one bridge account and excludes the current open chat", async () => {
  const episodeCalls = new Map();
  const episode = (chatId, suffix) => {
    const profile = { id: chatId, source_id: `source-${chatId}`, identity_id: `lid:${suffix}`, title: suffix, is_group: false, archived: false };
    return {
      profile,
      value: {
        id: `response-${suffix}`,
        person_id: `lid:${suffix}`,
        chat: profile,
        relationship_kind: "direct-person",
        fact_eligible: false,
        use: "style-learning-only",
        incoming_turn: [{ id: `in-${suffix}`, source_message_id: `source-in-${suffix}`, chat_id: chatId, sender_id: `lid:${suffix}`, from_me: false, kind: "text", text: `incoming ${suffix}`, timestamp: "2026-09-12T09:00:00Z", timestamp_known: true }],
        owner_reply: [{ id: `out-${suffix}`, source_message_id: `source-out-${suffix}`, chat_id: chatId, sender_id: "owner", from_me: true, kind: "text", text: `reply ${suffix}`, timestamp: "2026-09-12T09:01:00Z", timestamp_known: true }],
      },
    };
  };
  const bridge = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const token = String(request.headers.authorization || "").replace(/^Bearer\s+/iu, "");
    if (url.pathname === "/v1/chats") {
      if (url.searchParams.get("archived") === "true") return reply(response, { items: [], next_cursor: "" });
      return reply(response, { items: [{ id: "current", identity_id: "lid:current", title: "Current", is_group: false, archived: false }], next_cursor: "" });
    }
    if (url.pathname === "/v1/tone-samples") return reply(response, { general: [], person_specific: [], chat_profiles: [] });
    if (url.pathname === "/v1/response-episodes") {
      assert.equal(url.searchParams.get("limit"), "2500");
      episodeCalls.set(token, (episodeCalls.get(token) || 0) + 1);
      const suffix = token === "token-a" ? "account-a" : "account-b";
      const cross = episode(`cross-${suffix}`, suffix);
      const current = episode("current", `stale-current-${suffix}`);
      return reply(response, { account_scope_id: suffix, items: [current.value, cross.value], chat_profiles: [current.profile, cross.profile] });
    }
    return reply(response, { error: "not found" }, 404);
  });
  await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve));
  try {
    let clock = 0;
    const sourceA = createBridgeSource(`http://127.0.0.1:${bridge.address().port}`, "token-a", { responseEpisodeCacheTtlMs: 1_000, nowMs: () => clock });
    const sourceB = createBridgeSource(`http://127.0.0.1:${bridge.address().port}`, "token-b");
    const firstA = await sourceA.toneContext("current");
    const secondA = await sourceA.toneContext("current");
    const firstB = await sourceB.toneContext("current");
    const secondB = await sourceB.toneContext("current");
    assert.deepEqual(firstA.events.map((event) => event.id), ["in-account-a", "out-account-a"]);
    assert.deepEqual(secondA.events.map((event) => event.id), ["in-account-a", "out-account-a"]);
    assert.deepEqual(firstB.events.map((event) => event.id), ["in-account-b", "out-account-b"]);
    assert.deepEqual(secondB.events.map((event) => event.id), ["in-account-b", "out-account-b"]);
    assert.equal(firstA.chats.some((chat) => chat.id === "current"), false);
    assert.equal(firstB.chats.some((chat) => chat.id === "current"), false);
    assert.deepEqual(Object.fromEntries(episodeCalls), { "token-a": 1, "token-b": 1 });
    clock = 1_001;
    await sourceA.toneContext("current");
    assert.deepEqual(Object.fromEntries(episodeCalls), { "token-a": 2, "token-b": 1 });
  } finally {
    await new Promise((resolve) => bridge.close(resolve));
  }
});

test("response-episode ingestion stops at a byte bound before parsing bridge-controlled JSON", async () => {
  const bridge = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/v1/chats") return reply(response, { items: [{ id: "current", identity_id: "lid:current", title: "Current", is_group: false, archived: false }], next_cursor: "" });
    if (url.pathname === "/v1/tone-samples") return reply(response, { general: [], person_specific: [], chat_profiles: [] });
    if (url.pathname === "/v1/response-episodes") {
      response.writeHead(200, { "content-type": "application/json" });
      response.write('{"account_scope_id":"tenant-a","items":["');
      response.write("x".repeat(4_096));
      return response.end('"]}');
    }
    return reply(response, { error: "not found" }, 404);
  });
  await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve));
  try {
    const source = createBridgeSource(`http://127.0.0.1:${bridge.address().port}`, "token", { responseEpisodeMaximumBytes: 1_024 });
    await assert.rejects(source.toneContext("current"), /safe byte limit/iu);
  } finally {
    await new Promise((resolve) => bridge.close(resolve));
  }
});
