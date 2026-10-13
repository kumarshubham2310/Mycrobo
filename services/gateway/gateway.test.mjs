import assert from "node:assert/strict";
import test from "node:test";

import { createLocalDraftProvider } from "./draft-provider.mjs";
import { createGatewayServer as createGatewayServerBase } from "./server.mjs";
import { MemoryUserStateStore } from "./user-state.mjs";
import { phraseProvenanceFingerprint, phraseTemplateFingerprint } from "../../packages/core/phrase-bank.ts";

// Product-behaviour tests run as a trusted tenant owner. Authorization denial
// and cross-role matrices are covered independently in the gateway role suite.
const createGatewayServer = (options = {}) => createGatewayServerBase({ authRole: "owner", ...options });

const readyConversation = (complete = true) => ({
  currentMessage: { state: "ready", reason: "reconciled" },
  currentStory: { state: "ready", reason: "projected" },
  relationshipHistory: { state: complete ? "complete" : "partial", reason: "measured" },
  lifetimeHistory: { state: complete ? "complete" : "partial", reason: "measured" },
  draftAllowed: true,
});

test("gateway separates archived chats and returns the latest verified human message", async () => {
  const server = createGatewayServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const active = await fetch(`http://127.0.0.1:${port}/api/v1/chats?collection=active`).then((response) => response.json());
    const archived = await fetch(`http://127.0.0.1:${port}/api/v1/chats?collection=archived`).then((response) => response.json());
    assert.equal(active.chats.some((chat) => chat.collection === "archived"), false);
    assert.equal(archived.chats.every((chat) => chat.collection === "archived"), true);
    const latest = await fetch(`http://127.0.0.1:${port}/api/v1/chats/${encodeURIComponent("chat:example-contact")}/latest`).then((response) => response.json());
    assert.equal(latest.latest.text, "Please confirm tomorrow.");
    assert.equal(latest.reply.shouldDraft, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("gateway searches saved conversation text in the backend", async () => {
  const server = createGatewayServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const result = await fetch(`http://127.0.0.1:${port}/api/v1/search?collection=active&q=rain`).then((response) => response.json());
    assert.deepEqual(result.chats.map((chat) => chat.title), ["Example contact"]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("gateway serves the complete transitive module graph imported by the customer application", async () => {
  const server = createGatewayServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const pending = ["/app.js", "/relay-protocol.mjs"];
    const visited = new Set();
    while (pending.length) {
      const asset = pending.shift();
      if (visited.has(asset)) continue;
      visited.add(asset);
      const response = await fetch(`http://127.0.0.1:${port}${asset}`);
      assert.equal(response.status, 200, `${asset} must be served by the private asset allowlist`);
      assert.match(response.headers.get("content-type") || "", /text\/javascript/u);
      const source = await response.text();
      for (const match of source.matchAll(/^import\s+(?:.+?\s+from\s+)?["']((?:\.{1,2}\/|\/).+?)["'];?$/gmu)) {
        const importedPath = new URL(match[1], `http://127.0.0.1:${port}${asset}`).pathname;
        if (!visited.has(importedPath)) pending.push(importedPath);
      }
    }
    assert.ok(visited.has("/admin-presentation.mjs"));
    assert.ok(visited.has("/relay-device.mjs"));
    assert.ok(visited.has("/relay-protocol.mjs"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("gateway exposes only validated preferences that change real behaviour", async () => {
  const server = createGatewayServer({ userStateStore: new MemoryUserStateStore() });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const initial = await fetch(`http://127.0.0.1:${port}/api/v1/preferences`).then((response) => response.json());
    assert.equal(initial.draftLanguage, "match");
    assert.equal(initial.defaultSendingMode, "draft");
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/preferences`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ draftLanguage: "Roman Gujarati", replyLength: "short", liveUpdates: false, density: "compact", defaultSendingMode: "safe" }) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { draftLanguage: "Roman Gujarati", replyLength: "short", liveUpdates: false, density: "compact", defaultSendingMode: "safe" });
    const invalid = await fetch(`http://127.0.0.1:${port}/api/v1/preferences`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ replyLength: "essay" }) });
    assert.equal(invalid.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("automatic sending policies are tenant-local and conversation overrides remain release-locked", async () => {
  const userStateStore = new MemoryUserStateStore();
  await userStateStore.setPreferences({ defaultSendingMode: "safe" });
  await userStateStore.setChatStyle("chat-1", { sendingMode: "never" });
  const server = createGatewayServer({ userStateStore });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const global = await fetch(`http://127.0.0.1:${port}/api/v1/autonomy`).then((response) => response.json());
    assert.equal(global.tenantMode, "safe");
    assert.equal(global.automaticSendAvailable, false);
    assert.ok(global.blocks.includes("AUTO_SEND_FEATURE_DISABLED"));
    const chat = await fetch(`http://127.0.0.1:${port}/api/v1/chats/chat-1/autonomy`).then((response) => response.json());
    assert.equal(chat.chatMode, "never");
    assert.equal(chat.effectiveMode, "never");
    assert.equal(chat.eligibleForAuthorization, false);
    assert.ok(chat.blocks.includes("AUTO_SEND_OFF"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("authenticated policy and execution-consent controls persist without enabling a delivery boundary", async () => {
  const tenantId = "tenant-0000000000000001";
  const authenticatedUserId = "user-000000000000000000000001";
  const userStateStore = new MemoryUserStateStore({ tenantId, userId: authenticatedUserId });
  const server = createGatewayServer({
    userStateStore,
    tenantId,
    authenticatedUserId,
    autoSendSubjectKey: "test-only-content-free-subject-key",
    buildVersion: "1.2.3-test",
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const initial = await fetch(`http://127.0.0.1:${port}/api/v1/preferences?autonomy=policy`).then((response) => response.json());
    assert.equal(initial.executionConsent.authorized, false);
    assert.equal(initial.executionConsent.identityBound, true);
    assert.equal(initial.automaticSendAvailable, false);

    const policyResponse = await fetch(`http://127.0.0.1:${port}/api/v1/preferences?autonomy=policy`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "safe", allowGroups: false }),
    });
    assert.equal(policyResponse.status, 200);
    const policy = await policyResponse.json();
    assert.equal(policy.tenantDefault.mode, "safe");
    assert.equal(policy.automaticSendAvailable, false);

    const invalidGrant = await fetch(`http://127.0.0.1:${port}/api/v1/preferences?autonomy=grant`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmed: true, consentVersion: "wrong", policyVersion: "auto-send-policy.1" }),
    });
    assert.equal(invalidGrant.status, 400);

    const grantedResponse = await fetch(`http://127.0.0.1:${port}/api/v1/preferences?autonomy=grant`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmed: true, consentVersion: "auto-send-execution-consent.1", policyVersion: "auto-send-policy.1" }),
    });
    assert.equal(grantedResponse.status, 200);
    const granted = await grantedResponse.json();
    assert.equal(granted.executionConsent.authorized, true);
    assert.equal(granted.executionConsent.buildVersion, "1.2.3-test");
    assert.equal(granted.automaticSendAvailable, false);
    assert.equal(granted.deliveryDevelopmentLocked, true);
    assert.match(granted.explanation, /no message will be queued or sent/iu);

    const stoppedResponse = await fetch(`http://127.0.0.1:${port}/api/v1/preferences?autonomy=emergency-stop`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmed: true }),
    });
    const stopped = await stoppedResponse.json();
    assert.equal(stopped.executionConsent.authorized, false);
    assert.equal(stopped.executionConsent.emergencyStop, true);
    assert.equal(stopped.automaticSendAvailable, false);

    await fetch(`http://127.0.0.1:${port}/api/v1/preferences?autonomy=grant`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmed: true, consentVersion: "auto-send-execution-consent.1", policyVersion: "auto-send-policy.1" }),
    });
    const revokedResponse = await fetch(`http://127.0.0.1:${port}/api/v1/preferences?autonomy=revoke`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmed: true }),
    });
    assert.equal((await revokedResponse.json()).executionConsent.authorized, false);

    const unexpected = await fetch(`http://127.0.0.1:${port}/api/v1/preferences?autonomy=policy`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "safe", messageBody: "must never be stored" }),
    });
    assert.equal(unexpected.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("conversation policy endpoints preserve relationship and chat precedence using only opaque subjects", async () => {
  const tenantId = "tenant-0000000000000001";
  const authenticatedUserId = "user-000000000000000000000001";
  const userStateStore = new MemoryUserStateStore({ tenantId, userId: authenticatedUserId });
  const server = createGatewayServer({ userStateStore, tenantId, authenticatedUserId, autoSendSubjectKey: "test-only-content-free-subject-key" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const chatPath = `/api/v1/chats/${encodeURIComponent("chat:example-contact")}/style?autonomy=policy`;
  try {
    await fetch(`http://127.0.0.1:${port}/api/v1/preferences?autonomy=policy`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "safe" }) });
    const relationship = await fetch(`http://127.0.0.1:${port}${chatPath}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "relationship", mode: "countdown" }) }).then((response) => response.json());
    assert.equal(relationship.selectedScope, "relationship");
    assert.equal(relationship.relationshipMode, "countdown");
    assert.equal(relationship.effectiveMode, "countdown");
    assert.doesNotMatch(JSON.stringify(relationship), /chat:example-contact|example-contact/u);

    const chat = await fetch(`http://127.0.0.1:${port}${chatPath}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "chat", mode: "never" }) }).then((response) => response.json());
    assert.equal(chat.selectedScope, "chat");
    assert.equal(chat.chatMode, "never");
    assert.equal(chat.effectiveMode, "never");

    const groupRelationship = await fetch(`http://127.0.0.1:${port}/api/v1/chats/${encodeURIComponent("chat:project-group")}/style?autonomy=policy`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: "relationship", mode: "safe" }) });
    assert.equal(groupRelationship.status, 400);
    const saved = await userStateStore.snapshot();
    assert.ok(Object.keys(saved.autoSendPolicies.relationships).every((subject) => /^[a-f\d]{64}$/u.test(subject)));
    assert.ok(Object.keys(saved.autoSendPolicies.chats).every((subject) => /^[a-f\d]{64}$/u.test(subject)));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("tenant settings export is allowlisted and excludes credentials and imported private context", async () => {
  const userStateStore = new MemoryUserStateStore();
  await userStateStore.setDirectConnection("google", { provider: "google", refreshToken: "PRIVATE-REFRESH-TOKEN", scopes: ["contacts"], connectedAt: "2026-09-12T00:00:00Z" });
  await userStateStore.setIntegration("contacts", { kind: "contacts", origin: "file", contacts: [{ name: "Private Person", phones: ["919999999999"], emails: ["private@example.test"] }] });
  const server = createGatewayServer({ userStateStore, tenantId: "tenant-0000000000000001" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/privacy/export`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-disposition"), /mycrobo-settings-[a-f0-9]{10}-/u);
    const text = await response.text();
    assert.doesNotMatch(text, /PRIVATE-REFRESH-TOKEN|Private Person|919999999999|private@example\.test|refreshToken|connections|integrations/iu);
    const payload = JSON.parse(text);
    assert.equal(payload.schema, "mycrobo-user-export.2");
    assert.equal("preferences" in payload, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("gateway exposes content-free bounded storage coverage", async () => {
  const bridgeSource = { async storage() { return { database_bytes: 220_000_000, journal_bytes: 800_000, cached_media_bytes: 120_000_000, media_cache_limit: 134_217_728 }; } };
  const server = createGatewayServer({ bridgeSource, draftProvider: null });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/storage`);
    assert.equal(response.status, 200);
    const storage = await response.json();
    assert.equal(storage.available, true);
    assert.equal(storage.media_cache_limit, 134_217_728);
    assert.equal("message" in storage, false);
    assert.equal("filename" in storage, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("gateway exposes paginated content-free real-profile history truth", async () => {
  const bridgeSource = {
    async listChats(collection) {
      return collection === "active"
        ? [{ id: "private-contact-id", title: "Private contact", collection: "active", kind: "direct", historyCoverage: { locally_stored_messages: 7 } }]
        : [{ id: "private-group-id", title: "Private group", collection: "archived", kind: "group", historyCoverage: { locally_stored_messages: 3 } }];
    },
    async truth(chatId) {
      return {
        current_message: { state: "ready" },
        current_story: { state: chatId.includes("group") ? "needs_media" : "ready" },
        relationship_history: { state: "partial" },
        lifetime_history: { state: "partial" },
        coverage: {
          locally_stored_messages: chatId.includes("group") ? 3 : 7,
          timestamped_messages: chatId.includes("group") ? 3 : 6,
          owner_text_messages: 2,
          provider_reported_messages_seen: 4,
          provider_beginning_reached: false,
        },
      };
    },
  };
  const server = createGatewayServer({ bridgeSource, draftProvider: null, tenantId: "tenant-history-test" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/diagnostics/history-truth?limit=1`);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.schema, "mycrobo-content-free-history-truth.1");
    assert.equal(payload.totalChats, 2);
    assert.equal(payload.returnedChats, 1);
    assert.equal(payload.nextCursor, 1);
    assert.equal(payload.chats[0].locallyStoredMessages, 7);
    assert.doesNotMatch(JSON.stringify(payload), /Private contact|private-contact-id|Private group|private-group-id/iu);
    assert.match(response.headers.get("cache-control"), /no-store/iu);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("gateway exposes sync truth, verified context, local style and content-free feedback", async () => {
  const userStateStore = new MemoryUserStateStore();
  const server = createGatewayServer({ userStateStore });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const truth = await fetch(`http://127.0.0.1:${port}/api/v1/sync-truth`).then((response) => response.json());
    assert.equal(typeof truth.completeHistoryChats, "number");
    assert.equal(typeof truth.allHistoryProven, "boolean");
    const intelligence = await fetch(`http://127.0.0.1:${port}/api/v1/chats/${encodeURIComponent("chat:example-contact")}/intelligence`).then((response) => response.json());
    assert.equal(typeof intelligence.context.latestMessageId, "string");
    assert.equal(intelligence.dna.personSpecificEvidence > 0, true);
    const style = await fetch(`http://127.0.0.1:${port}/api/v1/chats/${encodeURIComponent("chat:example-contact")}/style`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ language: "Roman Hindi", length: "short", formality: "casual" }) }).then((response) => response.json());
    assert.equal(style.language, "Roman Hindi");
    const feedback = await fetch(`http://127.0.0.1:${port}/api/v1/chats/${encodeURIComponent("chat:example-contact")}/draft-feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "wrong-tone", draftId: "draft-1" }) });
    assert.equal(feedback.status, 201);
    const saved = await userStateStore.snapshot();
    assert.equal(saved.draftFeedback[0].reason, "wrong-tone");
    assert.equal("body" in saved.draftFeedback[0], false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("gateway proxies private bridge events as same-origin server-sent updates", async () => {
  let upstreamAborted = false;
  const bridgeSource = {
    async events(signal) {
      signal.addEventListener("abort", () => { upstreamAborted = true; }, { once: true });
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"type":"message.created","data":{"chat_id":"chat-1"}}\n\n'));
          controller.close();
        },
      }), { headers: { "content-type": "text/event-stream" } });
    },
  };
  const server = createGatewayServer({ bridgeSource, draftProvider: null });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/events`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/event-stream/u);
    assert.match(await response.text(), /message\.created/u);
    assert.equal(upstreamAborted, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("fixture gateway cannot send", async () => {
  const server = createGatewayServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/send`, { method: "POST" });
    assert.equal(response.status, 501);
    assert.equal((await response.json()).sendAvailable, false);
    assert.match(response.headers.get("content-security-policy"), /default-src 'self'/u);
    assert.equal(response.headers.get("x-frame-options"), "DENY");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("gateway stages an exact recipient and body before the mocked send boundary", async () => {
  const calls = [];
  const latest = { id: "latest-1", direction: "contact", kind: "text", text: "Question?", timestampMs: 1_777_000_000_000, timestampVerified: true };
  const bridgeSource = {
    async status() { return { connector: "personal-pilot", connected: true, sendAvailable: true }; },
    async latest() { return { chat: { id: "chat-1", title: "Sakshi" }, latest, watermark: { verifiedAt: "2026-08-22T12:00:00Z" } }; },
    async approveSend(input) { calls.push(["approve", input]); return { approval_token: "one-use", expires_in_seconds: 120 }; },
    async sendApproved(input) { calls.push(["send", input]); return { message_id: "server-ack-1" }; },
  };
  const server = createGatewayServer({ bridgeSource, draftProvider: null });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const exact = { body: "Haan.", targetMessageId: "latest-1", idempotencyKey: "gateway-attempt-0001" };
  try {
    const approval = await fetch(`http://127.0.0.1:${port}/api/v1/chats/chat-1/send-approval`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(exact) });
    assert.equal(approval.status, 201);
    const approved = await approval.json();
    const sent = await fetch(`http://127.0.0.1:${port}/api/v1/chats/chat-1/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...exact, approvalToken: approved.approval_token }) });
    assert.equal(sent.status, 200);
    assert.equal((await sent.json()).message_id, "server-ack-1");
    assert.deepEqual(calls.map(([kind]) => kind), ["approve", "send"]);
    assert.equal(calls[1][1].body, "Haan.");
    assert.equal(calls[1][1].chatId, "chat-1");
    assert.equal(calls[1][1].targetMessageId, "latest-1");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("gateway refuses a stale send before approval reaches the bridge", async () => {
  let called = false;
  const server = createGatewayServer({
    bridgeSource: {
      async status() { return { connected: true, sendAvailable: true }; },
      async latest() { return { chat: { title: "Sakshi" }, latest: { id: "newer" }, watermark: { verifiedAt: "2026-08-22T12:00:00Z" } }; },
      async approveSend() { called = true; },
    },
    draftProvider: null,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/chats/chat-1/send-approval`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "Reply", targetMessageId: "older", idempotencyKey: "gateway-attempt-0002" }) });
    assert.equal(response.status, 409);
    assert.equal(called, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a newer media item invalidates an older text send target", async () => {
  let called = false;
  const server = createGatewayServer({
    bridgeSource: {
      async status() { return { connected: true, sendAvailable: true }; },
      async latest() {
        return {
          chat: { title: "Sakshi" },
          latest: { id: "older-text" },
          latestSource: { id: "newer-photo", kind: "image" },
          watermark: { verifiedAt: "2026-08-25T12:00:00Z" },
        };
      },
      async approveSend() { called = true; },
    },
    draftProvider: null,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/chats/chat-1/send-approval`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: "Reply", targetMessageId: "older-text", idempotencyKey: "gateway-media-stale-0001" }) });
    assert.equal(response.status, 409);
    assert.equal(called, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("gateway exposes cached images through a same-origin no-store route", async () => {
  const bytes = Buffer.from("safe-image");
  const server = createGatewayServer({
    bridgeSource: {
      async media(id) {
        assert.equal(id, "photo-1");
        return { bytes, contentType: "image/jpeg" };
      },
    },
    draftProvider: null,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/media/photo-1`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/jpeg");
    assert.match(response.headers.get("cache-control"), /no-store/u);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("gateway supports in-app PDF framing and video byte ranges", async () => {
  const assets = {
    pdf: { bytes: Buffer.from("%PDF-safe"), contentType: "application/pdf" },
    video: { bytes: Buffer.from("0123456789"), contentType: "video/mp4" },
  };
  const server = createGatewayServer({ bridgeSource: { async media(id) { return assets[id]; } }, draftProvider: null });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const pdf = await fetch(`http://127.0.0.1:${port}/api/v1/media/pdf`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    assert.equal(pdf.headers.get("x-frame-options"), null);
    assert.match(pdf.headers.get("content-security-policy"), /frame-ancestors 'self'/u);
    const video = await fetch(`http://127.0.0.1:${port}/api/v1/media/video`, { headers: { range: "bytes=2-5" } });
    assert.equal(video.status, 206);
    assert.equal(video.headers.get("content-range"), "bytes 2-5/10");
    assert.equal(await video.text(), "2345");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("gateway retries a persisted photo, PDF, or video fetch without invoking any send path", async () => {
  let retried = "";
  const server = createGatewayServer({
    bridgeSource: {
      async retryMedia(id) { retried = id; return { status: "queued", message_id: id }; },
      async approveSend() { assert.fail("attachment retry must not approve a chat message"); },
      async send() { assert.fail("attachment retry must not send a chat message"); },
    },
    draftProvider: null,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/media/photo-message/retry`, { method: "POST" });
    assert.equal(response.status, 202);
    assert.equal(retried, "photo-message");
    assert.deepEqual(await response.json(), { status: "queued", message_id: "photo-message" });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("workspace exposes decisions and user-confirmed owner tasks", async () => {
  const taskState = new MemoryUserStateStore();
  const chat = { id: "chat-1", title: "Sakshi", collection: "active", kind: "direct" };
  const bridgeSource = { async workspace() { return [{
    chat,
    latest: { id: "q1", direction: "contact", kind: "text", text: "Which time should we confirm?", timestampMs: Date.now() },
    state: { chat_id: "chat-1", commitments: [
      { id: "c1", actor_is_owner: true, action: "I will prepare the report", status: "current", provenance: { source_message_id: "m1", occurred_at: "2026-08-26T10:00:00Z", confidence: 1 } },
      { id: "c2", actor_is_owner: true, action: "I will send it after review", status: "current", provenance: { source_message_id: "m2", occurred_at: "2026-08-26T10:01:00Z", confidence: 1 } },
      { id: "c3", actor_is_owner: false, action: "I will send the receipt", status: "current", provenance: { source_message_id: "m3", occurred_at: "2026-08-26T10:02:00Z", confidence: 1 } },
    ] },
  }]; } };
  const server = createGatewayServer({ bridgeSource, draftProvider: null, userStateStore: taskState });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    let workspace = await fetch(`http://127.0.0.1:${port}/api/v1/workspace`).then((response) => response.json());
    assert.equal(workspace.pending.length, 1);
    assert.equal(workspace.tasks.length, 2);
    assert.equal(workspace.followUps.length, 1);
    assert.equal(workspace.followUps[0].commitmentId, "c3");
    const decisionId = workspace.pending[0].id;
    const dismissed = await fetch(`http://127.0.0.1:${port}/api/v1/decisions/${encodeURIComponent(decisionId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "dismissed" }) });
    assert.equal(dismissed.status, 200);
    workspace = await fetch(`http://127.0.0.1:${port}/api/v1/workspace`).then((response) => response.json());
    assert.equal(workspace.pending.length, 0);
    const restored = await fetch(`http://127.0.0.1:${port}/api/v1/decisions/${encodeURIComponent(decisionId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "pending" }) });
    assert.equal(restored.status, 200);
    const taskId = workspace.tasks[0].id;
    const updated = await fetch(`http://127.0.0.1:${port}/api/v1/tasks/${encodeURIComponent(taskId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "done" }) });
    assert.equal(updated.status, 200);
    workspace = await fetch(`http://127.0.0.1:${port}/api/v1/workspace`).then((response) => response.json());
    assert.equal(workspace.tasks.find((item) => item.id === taskId)?.status, "done");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("archived latest state is independent and does not require a reply after the owner answered", async () => {
  const server = createGatewayServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const latest = await fetch(`http://127.0.0.1:${port}/api/v1/chats/${encodeURIComponent("chat:archived-client")}/latest`).then((response) => response.json());
    assert.equal(latest.latest.text, "done");
    assert.equal(latest.reply.shouldDraft, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("draft endpoint gives the provider the complete ordered story with explicit speakers", async () => {
  let received;
  const server = createGatewayServer({ draftProvider: {
    name: "test-provider",
    async generate(context) {
      received = context;
      return { draft: "Haan, subah bata dunga.", language: "Roman Hindi", evidenceIds: ["s1", "s3"] };
    },
  } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/chats/${encodeURIComponent("chat:example-contact")}/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetMessageId: "s3" }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.draft, "[Confirm what you can commit to before sending]");
    assert.equal(result.requiresUserInput, true);
    assert.equal(result.safetyIntervention, true);
    assert.deepEqual(result.evidenceIds, ["s1", "s3"]);
    assert.deepEqual(received.story.map((event) => event.speaker), ["OTHER", "OWNER", "OTHER"]);
    assert.match(received.story[0].text, /rain/u);
    assert.equal(result.toneStage, "learning");
    assert.equal("toneMatch" in result, false);
    assert.equal(result.draftRoute.generation.path, "unspecified");
    assert.equal(result.draftRoute.personalization.basis, "none");
    assert.equal(result.draftRoute.scenario.factEligible, false);
    assert.doesNotMatch(JSON.stringify(result.draftRoute), /percent|toneMatch|confidence/iu);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("shown and edited draft outcomes close the content-free personalization loop", async () => {
  const nowMs = Date.now();
  const chat = { id: "learning-chat", accountScopeId: "account-learning", title: "Learning contact", kind: "direct", collection: "active", connector: "personal-pilot", connectorIds: ["learning-chat"], participantIds: ["person-learning"] };
  const events = [
    { id: "learn-in", accountScopeId: "account-learning", chatId: chat.id, connectorMessageId: "learn-in", direction: "contact", senderId: "person-learning", senderName: "Learning contact", kind: "text", text: "The rain has stopped", timestampMs: nowMs - 2_000, timestampVerified: true, sequence: 1 },
    { id: "learn-out", accountScopeId: "account-learning", chatId: chat.id, connectorMessageId: "learn-out", direction: "owner", senderId: "owner", senderName: "You", kind: "text", text: "Good, that's better", timestampMs: nowMs - 1_000, timestampVerified: true, sequence: 2 },
    { id: "learn-current", accountScopeId: "account-learning", chatId: chat.id, connectorMessageId: "learn-current", direction: "contact", senderId: "person-learning", senderName: "Learning contact", kind: "text", text: "The weather is clear now", timestampMs: nowMs, timestampVerified: true, sequence: 3 },
  ];
  const watermark = { chatId: chat.id, state: "complete", reachedBeginning: true, oldestTimestampMs: nowMs - 2_000, newestTimestampMs: nowMs, messageCount: 3, cursor: null, reason: "beginning-reached", verifiedAt: new Date(nowMs).toISOString() };
  const userStateStore = new MemoryUserStateStore();
  const bridgeSource = {
    async bundle() { return { chat, events, watermark, latest: events.at(-1), latestSource: events.at(-1), accountScopeId: "account-learning", readiness: readyConversation() }; },
    async toneContext() { return { events: [], chats: [], accountScopeId: "account-learning" }; },
    async conversationState() { return null; },
  };
  const draftProvider = {
    name: "test-pattern-provider",
    async generate(context) {
      const pattern = context.retrieval.phraseBank.selected[0];
      assert.ok(pattern);
      return {
        draft: "Good, that's better",
        language: "English",
        evidenceIds: ["learn-current"],
        generationRoute: "local",
        personalizationBasis: "same-person-semantic-plan",
        phrasePatternBinding: {
          patternId: pattern.id,
          phraseProvenanceFingerprint: phraseProvenanceFingerprint(pattern),
          phraseTemplateFingerprint: phraseTemplateFingerprint(pattern.styleFragments.surfaceTemplate),
        },
      };
    },
  };
  const server = createGatewayServer({ bridgeSource, draftProvider, userStateStore });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const draftResponse = await fetch(`http://127.0.0.1:${port}/api/v1/chats/${chat.id}/draft`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetMessageId: "learn-current" }) });
    const draft = await draftResponse.json();
    assert.equal(draftResponse.status, 200, draft.error || "draft request failed");
    assert.equal(typeof draft.draftLearningId, "string");
    const shown = await userStateStore.personalizationSummary("account-learning", "person-learning");
    assert.equal(shown.outcomes.shown, 1);

    const outcomeResponse = await fetch(`http://127.0.0.1:${port}/api/v1/chats/${chat.id}/personalization-outcome`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draftId: draft.draftLearningId, targetMessageId: "learn-current", event: "sent", shownDraft: draft.draft, finalDraft: `${draft.draft}.` }),
    });
    assert.equal(outcomeResponse.status, 201);
    assert.deepEqual(await outcomeResponse.json(), { outcome: "lightly-edited", editRatio: 0.05, contentStored: false });
    const learned = await userStateStore.personalizationSummary("account-learning", "person-learning");
    assert.equal(learned.outcomes["lightly-edited"], 1);
    assert.equal(learned.recentUsageCount, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("gateway rejects a forced send that still contains a current-fact placeholder", async () => {
  let called = false;
  const server = createGatewayServer({
    bridgeSource: {
      async status() { return { connected: true, sendAvailable: true }; },
      async latest() { return { chat: { title: "Sakshi" }, latest: { id: "latest" }, watermark: { verifiedAt: "2026-08-22T12:00:00Z" } }; },
      async approveSend() { called = true; },
    },
    draftProvider: null,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/chats/chat-1/send-approval`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: "I should reach by [Add the actual time before sending]", targetMessageId: "latest", idempotencyKey: "gateway-placeholder-0001" }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /missing current fact/iu);
    assert.equal(called, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("draft endpoint refuses a stale message before calling the model", async () => {
  let called = false;
  const server = createGatewayServer({ draftProvider: { name: "test-provider", async generate() { called = true; return { draft: "x" }; } } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/chats/${encodeURIComponent("chat:example-contact")}/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetMessageId: "s1" }),
    });
    assert.equal(response.status, 409);
    assert.equal(called, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("linked-device draft fails closed when bridge truth and current story are not reconciled", async () => {
  let called = false;
  const event = { id: "latest", accountScopeId: "account-truth", chatId: "chat-truth", direction: "contact", kind: "text", text: "Current?", timestampMs: 2_000, timestampVerified: true, sequence: 1 };
  const server = createGatewayServer({
    bridgeSource: {
      async bundle() {
        return {
          chat: { id: "chat-truth", accountScopeId: "account-truth", title: "Truth", kind: "direct", collection: "active", connector: "personal-pilot", connectorIds: ["chat-truth"], participantIds: [] },
          events: [event],
          watermark: { chatId: "chat-truth", state: "partial", reachedBeginning: false, verifiedAt: null },
          accountScopeId: "account-truth",
          readiness: {
            currentMessage: { state: "stale", reason: "The provider catalogue is newer than local storage." },
            currentStory: { state: "stale", reason: "Current-story readiness requires a reconciled latest source message." },
            relationshipHistory: { state: "partial", reason: "measured" },
            lifetimeHistory: { state: "partial", reason: "provider did not reach beginning" },
            draftAllowed: false,
          },
        };
      },
    },
    draftProvider: { name: "must-not-run", async generate() { called = true; return { draft: "unsafe" }; } },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/chats/chat-truth/draft`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetMessageId: "latest" }),
    });
    const payload = await response.json();
    assert.equal(response.status, 409);
    assert.equal(payload.readiness.currentMessage.state, "stale");
    assert.equal(called, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("gateway forwards exactly one all-chat import consent to the linked-device bridge", async () => {
  let calls = 0;
  const server = createGatewayServer({
    bridgeSource: {
      async startImport() { calls += 1; return { started: true, consent_id: "consent" }; },
      async status() { return { connector: "personal-pilot", connected: false }; },
      async listChats() { return []; },
      async bundle() { throw new Error("not used"); },
    },
    draftProvider: null,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/connect`, { method: "POST" });
    assert.equal(response.status, 202);
    assert.equal((await response.json()).started, true);
    assert.equal(calls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("gateway proxies the pairing image without exposing the bridge secret", async () => {
  const server = createGatewayServer({
    bridgeSource: { async pairingQR() { return { bytes: Buffer.from("safe-png"), contentType: "image/png" }; } },
    draftProvider: null,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/pairing-qr`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(await response.text(), "safe-png");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("linked-device chat opening uses a bounded message page and a lightweight latest barrier", async () => {
  let bundleCalls = 0;
  let requestedLimit = 0;
  const latestEvent = { id: "latest-1", direction: "contact", kind: "text", text: "Current question?", timestampMs: 1_777_000_000_000, timestampVerified: true, sequence: 1 };
  const watermark = { chatId: "chat-1", state: "complete", reachedBeginning: true, newestTimestampMs: latestEvent.timestampMs, verifiedAt: "2026-08-22T09:31:00Z" };
  const server = createGatewayServer({
    bridgeSource: {
      async status() { return { connector: "personal-pilot", connected: true }; },
      async listChats() { return []; },
      async startImport() { throw new Error("not used"); },
      async latest() { return { latest: latestEvent, watermark, reply: { shouldDraft: true, status: "reply-recommended", reason: "incoming", target: latestEvent } }; },
      async messages(_chatId, options) { requestedLimit = options.limit; return { events: [latestEvent], nextBefore: "older" }; },
      async bundle() { bundleCalls += 1; throw new Error("full traversal must not run while opening a chat"); },
    },
    draftProvider: null,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const result = await fetch(`http://127.0.0.1:${port}/api/v1/chats/chat-1/messages?limit=200`).then((response) => response.json());
    assert.equal(result.latest.id, "latest-1");
    assert.equal(result.messages.length, 1);
    assert.equal(requestedLimit, 200);
    assert.equal(bundleCalls, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("linked-device drafting requires complete history and separates person tone from general tone", async () => {
  let received;
  let translatedInput;
  const tenantId = "tenant-0000000000000001";
  const accountScopeId = "account-linked-test";
  const story = [
    { id: "m1", chatId: "chat-1", direction: "contact", senderId: "other", senderName: "Sakshi", kind: "text", text: "Kal rain ka scene kya hai?", timestampMs: 1_777_000_000_000, timestampVerified: true, sequence: 1 },
    { id: "m2", chatId: "chat-1", direction: "owner", senderId: "owner", senderName: "You", kind: "text", text: "Dekhta hu", timestampMs: 1_777_000_060_000, timestampVerified: true, sequence: 2 },
    { id: "m3", chatId: "chat-1", direction: "contact", senderId: "other", senderName: "Sakshi", kind: "text", text: "Subah bata dena pls", timestampMs: 1_777_000_120_000, timestampVerified: true, sequence: 3 },
  ].map((event) => ({ ...event, accountScopeId }));
  const tone = [
    { id: "g1", chatId: "other-chat", direction: "owner", senderId: "owner", kind: "text", text: "Sure, will check.", timestampMs: 1_776_000_000_000, timestampVerified: true, sequence: 1 },
    story[1],
  ].map((event) => ({ ...event, accountScopeId }));
  const watermark = { chatId: "chat-1", state: "complete", reachedBeginning: true, newestTimestampMs: story.at(-1).timestampMs, verifiedAt: "2026-08-22T09:31:00Z" };
  const server = createGatewayServer({
    tenantId,
    translator: {
      status() { return { enabled: true, configured: true, tenantId, localOnly: true, runtime: "ready" }; },
      async translate(input) { translatedInput = input; return { applied: true, text: "Please tell me in the morning", localOnly: true }; },
    },
    bridgeSource: {
      async bundle() { return { chat: { id: "chat-1", accountScopeId, title: "Sakshi", kind: "direct", collection: "active", connector: "personal-pilot", connectorIds: ["chat-1"], participantIds: [] }, events: story, watermark, accountScopeId, readiness: readyConversation() }; },
      async toneContext() { return { events: tone, chats: [], accountScopeId }; },
      async conversationState() { return { chat_id: "chat-1", version: 1, latest_message_id: "m3", latest_intent: "request", conversation_status: "awaiting_owner", open_questions: [], commitments: [], recent_facts: [] }; },
    },
    draftProvider: { name: "test", async generate(context) { received = context; return { draft: "Haan, subah bata dunga.", language: "Roman Hindi", evidenceIds: ["m1", "m3"] }; } },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/chats/chat-1/draft`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetMessageId: "m3" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(received.story.map((event) => event.speaker), ["OTHER", "OWNER", "OTHER"]);
    assert.deepEqual(received.tone.generalExamples, []);
    assert.deepEqual(received.tone.personSpecificExamples, ["Dekhta hu"]);
    assert.doesNotMatch(JSON.stringify(received), /Sure, will check\./u);
    assert.equal(received.conversationState.latest_message_id, "m3");
    assert.equal(translatedInput.tenantId, tenantId);
    assert.equal(translatedInput.text, "Subah bata dena pls");
    assert.equal(received.scope.isolation, "strict-tenant-account");
    assert.equal(received.languageBridge.translatedText, "Please tell me in the morning");
    assert.equal(received.languageBridge.use, "semantic-understanding-only");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("local safe acknowledgement remains available when older WhatsApp history is partial", async () => {
  const accountScopeId = "account-local-partial";
  const story = [
    { id: "m1", chatId: "chat-1", direction: "owner", senderId: "owner", senderName: "You", kind: "text", text: "Where are you?", timestampMs: 1_787_577_900_000, timestampVerified: true, sequence: 1 },
    { id: "m2", chatId: "chat-1", direction: "contact", senderId: "other", senderName: "Sakshi", kind: "text", text: "Office se niklungi", timestampMs: 1_787_577_983_000, timestampVerified: true, sequence: 2 },
  ].map((event) => ({ ...event, accountScopeId }));
  const watermark = { chatId: "chat-1", state: "partial", reachedBeginning: false, newestTimestampMs: story.at(-1).timestampMs, verifiedAt: "2026-08-24T15:53:08Z" };
  const server = createGatewayServer({
    bridgeSource: {
      async bundle() { return { chat: { id: "chat-1", accountScopeId, title: "Sakshi", kind: "direct", collection: "active", connector: "personal-pilot", connectorIds: ["chat-1"], participantIds: [] }, events: story, watermark, accountScopeId, readiness: readyConversation(false) }; },
      async toneContext() { return { events: [{ ...story[0], text: "Okay" }], chats: [], accountScopeId }; },
    },
    draftProvider: createLocalDraftProvider(),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/chats/chat-1/draft`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetMessageId: "m2" }),
    });
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.match(payload.draft, /^Okay, dhyan se\.?$/u);
    assert.equal(payload.historyComplete, false);
    assert.equal(payload.provider, "local-safe-starter");
    assert.equal(payload.draftRoute.generation.path, "local");
    assert.equal(payload.draftRoute.generation.providerStatus, "not-used");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("explicit draft anyway works only for the exact passive incoming message", async () => {
  const accountScopeId = "account-group-test";
  const event = { id: "passive", accountScopeId, chatId: "group-1", direction: "contact", senderId: "member", senderName: "Member", kind: "text", text: "FYI, the file is ready", timestampMs: 1_787_578_000_000, timestampVerified: true, sequence: 1, mentionsOwner: false };
  const watermark = { chatId: "group-1", state: "complete", reachedBeginning: true, newestTimestampMs: event.timestampMs, verifiedAt: "2026-08-24T16:00:00Z" };
  let calls = 0;
  const server = createGatewayServer({
    bridgeSource: {
      async bundle() { return { chat: { id: "group-1", accountScopeId, title: "Project", kind: "group", collection: "active", connector: "personal-pilot", connectorIds: ["group-1"], participantIds: [] }, events: [event], watermark, accountScopeId, readiness: readyConversation() }; },
      async toneContext() { return { events: [], chats: [], accountScopeId }; },
    },
    draftProvider: { name: "test", async generate() { calls += 1; return { draft: "Okay", language: "English", evidenceIds: ["passive"] }; } },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const withoutOverride = await fetch(`http://127.0.0.1:${port}/api/v1/chats/group-1/draft`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetMessageId: "passive" }),
    });
    assert.equal(withoutOverride.status, 409);
    assert.equal(calls, 0);
    const withOverride = await fetch(`http://127.0.0.1:${port}/api/v1/chats/group-1/draft`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetMessageId: "passive", draftAnyway: true }),
    });
    assert.equal(withOverride.status, 200);
    assert.equal(calls, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
