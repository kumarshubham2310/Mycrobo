import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createGatewayServer } from "./server.mjs";
import { MemoryUserStateStore } from "./user-state.mjs";
import {
  AUTO_SEND_BUILD_CERTIFICATION_CONTRACT,
  autoSendBuildCertificationDigest,
} from "./auto-send-gateway-runtime.mjs";
import { AUTO_SEND_DURABLE_STORAGE_BINDING, AUTO_SEND_SAFETY_BINDING_CONTRACT } from "./auto-send-host-bootstrap.mjs";

const tenantId = "tenant-0000000000000042";
const authenticatedUserId = "user-000000000000000000000042";
const accountId = "account-auto-send-integration";
const buildVersion = "certified-test-build-1";
const signingSecret = "test-only-gateway-auto-send-secret-32-bytes-minimum";
const nowMs = Date.parse("2026-10-08T10:00:02.000Z");
const draftText = "Hi!";
const chat = {
  id: "chat-auto-send",
  accountScopeId: accountId,
  title: "Test contact",
  kind: "direct",
  collection: "active",
  connector: "personal-pilot",
  connectorIds: ["chat-auto-send"],
  participantIds: ["person-auto-send"],
};
const target = {
  id: "message-auto-send",
  accountScopeId: accountId,
  chatId: chat.id,
  connectorMessageId: "message-auto-send",
  direction: "contact",
  senderId: "person-auto-send",
  senderName: "Test contact",
  kind: "text",
  text: "Hello",
  timestampMs: nowMs - 2_000,
  timestampVerified: true,
  sequence: 1,
};

function certification() {
  return {
    contract: AUTO_SEND_BUILD_CERTIFICATION_CONTRACT,
    certified: true,
    buildVersion,
    policyVersion: "auto-send-policy.1",
    bindingDigest: autoSendBuildCertificationDigest(buildVersion),
  };
}

function bridgeBundle(events = [target]) {
  const latest = events.at(-1);
  return {
    chat,
    events,
    watermark: {
      chatId: chat.id,
      state: "complete",
      reachedBeginning: true,
      oldestTimestampMs: target.timestampMs,
      newestTimestampMs: latest.timestampMs,
      messageCount: events.length,
      cursor: null,
      reason: "provider-beginning-and-live-catchup-confirmed",
      verifiedAt: new Date(nowMs - 500).toISOString(),
    },
    latest,
    latestSource: latest,
    readiness: {
      currentMessage: { state: "ready" },
      currentStory: { state: "ready" },
      relationshipHistory: { state: "complete" },
      lifetimeHistory: { state: "complete" },
      draftAllowed: true,
      observedAt: new Date(nowMs - 250).toISOString(),
    },
    accountScopeId: accountId,
  };
}

async function startFixture(t, {
  mode = "safe",
  executionEnabled = true,
  certificationRecord = certification(),
  configuredAccountId = accountId,
  bundleForCall = () => bridgeBundle(),
  legacyChatMode = "inherit",
  hostBootstrap = false,
} = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), "mycrobo-gateway-auto-send-"));
  const userStateStore = new MemoryUserStateStore({ tenantId, userId: authenticatedUserId });
  await userStateStore.setAutoSendPolicyLayer({ layerKind: "tenant", mode, allowGroups: false }, new Date(nowMs - 2_000));
  await userStateStore.setChatStyle(chat.id, { sendingMode: legacyChatMode });
  await userStateStore.grantAutoSendExecutionConsent({
    version: "auto-send-execution-consent.1",
    policyVersion: "auto-send-policy.1",
    buildVersion,
    confirmed: true,
  }, new Date(nowMs - 1_000));
  const deliveries = [];
  const bridgeDeliveries = [];
  let bundleLoads = 0;
  const bridgeSource = {
    async bundle() { bundleLoads += 1; return bundleForCall(bundleLoads); },
    async toneContext() { return { events: [target], chats: [chat], accountScopeId: accountId, runtimeEvidenceBounded: true }; },
    async conversationState() { return null; },
    async status() { return { connector: "personal-pilot", connected: true, connectionState: "current-read-only", sendAvailable: true }; },
    async approveSend(input) { bridgeDeliveries.push(["approve", input]); return { approval_token: "fake-one-use-token" }; },
    async sendApproved(input) { bridgeDeliveries.push(["send", input]); return { message_id: "fake-bridge-message" }; },
  };
  const server = createGatewayServer({
    authRole: "owner",
    tenantId,
    authenticatedUserId,
    buildVersion,
    userStateStore,
    bridgeSource,
    draftProvider: {
      name: "test-safe-provider",
      async generate() { return { draft: draftText, language: "English", evidenceIds: [target.id] }; },
    },
    autoSendSubjectKey: "test-only-auto-send-policy-subject-key",
    userDataDir: dataDir,
    autoSendHostBootstrap: hostBootstrap ? {
      tenantId,
      userId: authenticatedUserId,
      accountId,
      buildVersion,
      policyVersion: "auto-send-policy.1",
      buildCertification: certification(),
      durableStorage: AUTO_SEND_DURABLE_STORAGE_BINDING,
      safetyBinding: {
        contract: AUTO_SEND_SAFETY_BINDING_CONTRACT,
        quietHoursMode: "disabled",
        mediaAssessmentMode: "block-unverified",
        customRules: "disabled",
      },
      signingSecret,
    } : null,
    autoSendExecutionEnabled: executionEnabled,
    autoSendBuildCertification: certificationRecord,
    autoSendAccountId: configuredAccountId,
    autoSendDataDir: dataDir,
    autoSendSigningSecret: signingSecret,
    autoSendClock: () => nowMs,
    autoSendCountdownMs: 5_000,
    autoSendSafetyAuthorities: async () => ({
      quietHours: { active: false },
      mediaAssessments: [],
      customRuleId: "test-custom-rule",
      customRulePassed: true,
    }),
    autoSendDeliveryBoundary: hostBootstrap ? undefined : async (delivery) => {
      deliveries.push(delivery);
      return { mockProviderId: "mock-only-auto-send-receipt" };
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  return { server, port: server.address().port, dataDir, deliveries, bridgeDeliveries, bundleLoads };
}

async function draft(port, extra = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/chats/${chat.id}/draft`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ targetMessageId: target.id, ...extra }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

test("certified gateway execution uses the normal GGCP draft and only the injected fake boundary", async (t) => {
  const fixture = await startFixture(t);
  const result = await draft(fixture.port);

  assert.equal(result.draft, draftText);
  assert.equal(result.automaticDelivery.available, true);
  assert.equal(result.automaticDelivery.state, "sent");
  assert.equal(result.automaticDelivery.delivered, true);
  assert.equal(result.automaticDelivery.contentStored, false);
  assert.equal(fixture.deliveries.length, 1);
  assert.equal(fixture.deliveries[0].body, draftText);
  assert.equal(JSON.stringify(result.automaticDelivery).includes(accountId), false);
  assert.equal(JSON.stringify(result.automaticDelivery).includes(chat.id), false);
  assert.equal(JSON.stringify(result.automaticDelivery).includes(target.id), false);
  assert.equal(JSON.stringify(result.automaticDelivery).includes(draftText), false);

  const durableFiles = (await readdir(fixture.dataDir)).filter((name) => /^(?:authorization|outbox)\.sqlite(?:-|$)/u.test(name));
  assert.ok(durableFiles.includes("authorization.sqlite"));
  assert.ok(durableFiles.includes("outbox.sqlite"));
  for (const name of durableFiles) {
    const bytes = await readFile(join(fixture.dataDir, name));
    assert.equal(bytes.includes(Buffer.from(draftText, "utf8")), false, `${name} must not persist draft plaintext`);
  }
});

test("valid protected-host bootstrap reaches only the fresh fake bridge adapter", async (t) => {
  const fixture = await startFixture(t, { hostBootstrap: true });
  const result = await draft(fixture.port);

  assert.equal(result.automaticDelivery.state, "sent");
  assert.equal(result.automaticDelivery.delivered, true);
  assert.deepEqual(fixture.deliveries, []);
  assert.equal(fixture.bridgeDeliveries.length, 2);
  assert.equal(fixture.bridgeDeliveries[0][0], "approve");
  assert.equal(fixture.bridgeDeliveries[1][0], "send");
  assert.equal(fixture.bridgeDeliveries[0][1].body, draftText);
});

test("partial or uncertified gateway configuration stays unavailable and never calls delivery", async (t) => {
  const fixture = await startFixture(t, {
    certificationRecord: { ...certification(), bindingDigest: "0".repeat(64) },
  });
  const result = await draft(fixture.port);

  assert.equal(result.automaticDelivery.available, false);
  assert.equal(result.automaticDelivery.state, "disabled");
  assert.ok(result.automaticDelivery.reasonCodes.includes("BUILD_NOT_CERTIFIED"));
  assert.equal(fixture.deliveries.length, 0);
});

test("saved settings and consent cannot substitute for absent host activation", async (t) => {
  const fixture = await startFixture(t, { executionEnabled: false });
  const result = await draft(fixture.port);

  assert.equal(result.automaticDelivery.available, false);
  assert.ok(result.automaticDelivery.reasonCodes.includes("EXECUTION_FLAG_DISABLED"));
  assert.equal(fixture.deliveries.length, 0);
});

test("the configured bridge account must match the account that produced the GGCP draft", async (t) => {
  const fixture = await startFixture(t, { configuredAccountId: "account-other" });
  const result = await draft(fixture.port);

  assert.equal(result.automaticDelivery.state, "blocked");
  assert.ok(result.automaticDelivery.reasonCodes.includes("GATEWAY_BINDING_MISMATCH"));
  assert.equal(fixture.deliveries.length, 0);
});

test("fresh bridge truth blocks a draft when a newer message arrives before authorization", async (t) => {
  const newer = {
    ...target,
    id: "message-auto-send-newer",
    connectorMessageId: "message-auto-send-newer",
    text: "A newer private message",
    timestampMs: target.timestampMs + 1_000,
    sequence: 2,
  };
  const fixture = await startFixture(t, {
    bundleForCall: (call) => call === 1 ? bridgeBundle() : bridgeBundle([target, newer]),
  });
  const result = await draft(fixture.port);

  assert.equal(result.automaticDelivery.state, "blocked");
  assert.equal(fixture.deliveries.length, 0);
  assert.equal(JSON.stringify(result.automaticDelivery).includes(newer.text), false);
});

test("a conversation-level never override still wins over a tenant safe policy", async (t) => {
  const fixture = await startFixture(t, { mode: "safe", legacyChatMode: "never", hostBootstrap: true });
  const result = await draft(fixture.port);

  assert.equal(result.automaticDelivery.state, "blocked");
  assert.equal(result.automaticDelivery.effectiveMode, "never");
  assert.equal(result.automaticDelivery.modeSource, "chat");
  assert.ok(result.automaticDelivery.reasonCodes.includes("AUTO_SEND_OFF"));
  assert.equal(fixture.deliveries.length, 0);
  assert.equal(fixture.bridgeDeliveries.length, 0);
});

test("gateway countdown remains non-sending and an explicit cancellation is durable", async (t) => {
  const fixture = await startFixture(t, { mode: "countdown" });
  const planned = await draft(fixture.port);
  assert.equal(planned.automaticDelivery.state, "countdown");
  assert.equal(planned.automaticDelivery.cancellationAvailable, true);
  assert.equal(typeof planned.automaticDelivery.countdownEndsAt, "string");
  assert.equal(fixture.deliveries.length, 0);

  const cancelled = await draft(fixture.port, { autoSendAction: "cancel" });
  assert.equal(cancelled.automaticDelivery.state, "cancelled");
  assert.equal(cancelled.automaticDelivery.cancellationAvailable, false);
  assert.equal(fixture.deliveries.length, 0);
});
