import assert from "node:assert/strict";
import test from "node:test";

import { createBridgeAutoSendDeliveryBoundary } from "./auto-send-bridge-delivery.mjs";

function fakeBridge(overrides = {}) {
  const calls = [];
  return {
    calls,
    async status() { return { connected: true, connectionState: "current-read-only", sendAvailable: true }; },
    async bundle(chatId) {
      return {
        accountScopeId: "account-42",
        chat: { id: chatId, accountScopeId: "account-42" },
        latestSource: { id: "message-42" },
        readiness: { draftAllowed: true, currentMessage: { state: "ready" } },
      };
    },
    async approveSend(input) { calls.push(["approve", input]); return { approval_token: "fake-one-use-token" }; },
    async sendApproved(input) { calls.push(["send", input]); return { message_id: "fake-message-id" }; },
    ...overrides,
  };
}

function delivery(overrides = {}) {
  return {
    intent: { accountId: "account-42", chatId: "chat-42", targetMessageId: "message-42" },
    body: "Test-only reply",
    targetMessageId: "message-42",
    idempotencyKey: "authorization-42",
    ...overrides,
  };
}

test("bridge delivery stays unreachable for a mismatched certified account", async () => {
  const bridge = fakeBridge();
  const boundary = createBridgeAutoSendDeliveryBoundary({ bridgeSource: bridge, expectedAccountId: "account-42" });
  await assert.rejects(boundary(delivery({ intent: { ...delivery().intent, accountId: "account-foreign" } })), /bindings/u);
  assert.deepEqual(bridge.calls, []);
});

test("bridge delivery rejects stale latest truth before requesting approval", async () => {
  const bridge = fakeBridge({ async bundle(chatId) { return { accountScopeId: "account-42", chat: { id: chatId, accountScopeId: "account-42" }, latestSource: { id: "message-newer" }, readiness: { draftAllowed: true, currentMessage: { state: "ready" } } }; } });
  const boundary = createBridgeAutoSendDeliveryBoundary({ bridgeSource: bridge, expectedAccountId: "account-42" });
  await assert.rejects(boundary(delivery()), /truth changed/u);
  assert.deepEqual(bridge.calls, []);
});

test("valid fake delivery uses bridge one-use approval and preserves idempotency", async () => {
  const bridge = fakeBridge();
  const boundary = createBridgeAutoSendDeliveryBoundary({ bridgeSource: bridge, expectedAccountId: "account-42" });
  assert.deepEqual(await boundary(delivery()), { message_id: "fake-message-id" });
  assert.equal(bridge.calls.length, 2);
  assert.equal(bridge.calls[0][0], "approve");
  assert.equal(bridge.calls[1][0], "send");
  assert.equal(bridge.calls[0][1].idempotencyKey, "authorization-42");
  assert.equal(bridge.calls[1][1].idempotencyKey, "authorization-42");
  assert.equal(bridge.calls[1][1].approvalToken, "fake-one-use-token");
});
