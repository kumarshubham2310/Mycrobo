import assert from "node:assert/strict";
import test from "node:test";

import { buildDraftContext } from "../../packages/core/draft.ts";
import { createLocalDraftProvider } from "./draft-provider.mjs";
import { boundedCurrentStory, boundedToneContext } from "./server.mjs";

const accountScopeId = "latency-fixture-account";
const COLD_CONTEXT_BUILD_BUDGET_MS = 1_500;
const WARM_CONTEXT_BUILD_BUDGET_MS = 750;
const LOCAL_GENERATION_BUDGET_MS = 1_000;

function event(index, chatId, direction = index % 2 ? "owner" : "contact") {
  return {
    id: `${chatId}:${index}`,
    chatId,
    accountScopeId,
    connectorMessageId: `${chatId}:${index}`,
    direction,
    senderId: direction === "owner" ? "owner" : `${chatId}:person`,
    senderName: direction === "owner" ? "You" : "Other",
    kind: "text",
    text: direction === "owner" ? `Dekhta hu ${index % 7}` : `Please check item ${index % 11}`,
    timestampMs: 1_790_000_000_000 + index * 1_000,
    timestampIso: new Date(1_790_000_000_000 + index * 1_000).toISOString(),
    timestampVerified: true,
    sequence: index,
  };
}

test("runtime evidence bounds prevent imported lifetime history from monopolising the gateway event loop", async (testContext) => {
  const allChats = Array.from({ length: 1_500 }, (_, index) => ({
    id: `chat-${index}`,
    accountScopeId,
    connector: "fixture",
    connectorIds: [`chat-${index}`],
    kind: "direct",
    participantIds: ["owner", `person-${index % 500}`],
  }));
  const unboundedToneEvents = Array.from({ length: 60_000 }, (_, index) => event(index, `chat-${index % 1_500}`));
  const currentChat = { ...allChats[0], participantIds: ["owner", "person-0"] };
  const boundedTone = boundedToneContext({ events: unboundedToneEvents, chats: allChats, accountScopeId }, currentChat);
  assert.equal(boundedTone.events.length <= 6_000, true);
  assert.equal(boundedTone.chats.length <= 1_000, true);

  const unboundedStory = Array.from({ length: 6_000 }, (_, index) => event(index, currentChat.id, index === 5_999 ? "contact" : index % 2 ? "owner" : "contact"));
  const targetMessageId = unboundedStory.at(-1).id;
  const story = boundedCurrentStory(unboundedStory, null, targetMessageId);
  assert.equal(story.length <= 2_500, true);
  const contextOptions = {
    accountScopeId,
    tenantScopeId: "tenant-latency-fixture",
    chat: currentChat,
    chatEvents: story,
    allEvents: boundedTone.events,
    allChats: boundedTone.chats,
    watermark: {
      chatId: currentChat.id,
      state: "complete",
      reachedBeginning: true,
      newestTimestampMs: story.at(-1).timestampMs,
      verifiedAt: "2026-09-13T00:00:00Z",
    },
    ownerIds: ["owner"],
    expectedTargetMessageId: targetMessageId,
    nowMs: story.at(-1).timestampMs + 1_000,
  };
  const coldStartedAt = performance.now();
  const context = buildDraftContext(contextOptions);
  const coldBuiltMs = performance.now() - coldStartedAt;
  // A repeated build exercises the tenant-local model and phrase-bank caches.
  // Keep a strict steady-state ceiling while giving the first compilation and
  // cache population enough headroom for variable shared CI hosts.
  const warmStartedAt = performance.now();
  buildDraftContext(contextOptions);
  const warmBuiltMs = performance.now() - warmStartedAt;
  const generatedAt = performance.now();
  const result = await createLocalDraftProvider().generate(context);
  const generatedMs = performance.now() - generatedAt;
  testContext.diagnostic(`draft latency: cold=${coldBuiltMs.toFixed(1)}ms warm=${warmBuiltMs.toFixed(1)}ms generation=${generatedMs.toFixed(1)}ms`);
  assert.ok(result.draft);
  assert.ok(coldBuiltMs < COLD_CONTEXT_BUILD_BUDGET_MS,
    `cold bounded context build blocked for ${coldBuiltMs.toFixed(1)}ms`);
  assert.ok(warmBuiltMs < WARM_CONTEXT_BUILD_BUDGET_MS,
    `warm bounded context build blocked for ${warmBuiltMs.toFixed(1)}ms`);
  assert.ok(generatedMs < LOCAL_GENERATION_BUDGET_MS,
    `bounded local generation blocked for ${generatedMs.toFixed(1)}ms`);
});
