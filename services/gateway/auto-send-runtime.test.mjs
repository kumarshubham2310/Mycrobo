import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { AutoSendAuthorizationIssuer, InMemoryAutoSendAuthorizationLedger } from "../../packages/core/auto-send-authorization.ts";
import { buildDraftContext } from "../../packages/core/draft.ts";
import { SqliteAutoSendOutbox } from "./auto-send-outbox.mjs";
import { AutoSendRuntimePlanner } from "./auto-send-runtime.mjs";

const secret = "test-only-auto-send-runtime-secret-at-least-32-bytes";
const buildVersion = "test-build-2026.10.08";
const tenantId = "tenant-runtime";
const userId = "user-runtime";
const accountId = "account-runtime";
const baseNowMs = Date.parse("2026-10-08T10:00:02.000Z");
const privateDraft = "Hi!";
const chat = {
  id: "chat:runtime",
  accountScopeId: accountId,
  connector: "personal-pilot",
  connectorIds: ["chat:runtime"],
  title: "Sakshi",
  collection: "active",
  kind: "direct",
  participantIds: ["person:sakshi"],
};
const target = {
  id: "message-runtime",
  accountScopeId: accountId,
  chatId: chat.id,
  connectorMessageId: "message-runtime",
  direction: "contact",
  senderId: "person:sakshi",
  senderName: "Sakshi",
  kind: "text",
  text: "Good morning private runtime target",
  timestampMs: 10_000,
  timestampVerified: true,
  sequence: 1,
};
const watermark = {
  chatId: chat.id,
  state: "complete",
  reachedBeginning: true,
  oldestTimestampMs: 10_000,
  newestTimestampMs: 10_000,
  messageCount: 1,
  cursor: null,
  reason: "provider-beginning-and-live-catchup-confirmed",
  verifiedAt: "2026-10-08T10:00:00.000Z",
};
const context = buildDraftContext({
  tenantScopeId: tenantId,
  accountScopeId: accountId,
  chat,
  chatEvents: [target],
  allEvents: [target],
  watermark,
  ownerIds: ["owner"],
  expectedTargetMessageId: target.id,
  nowMs: 11_000,
});
const request = Object.freeze({
  tenantId,
  userId,
  accountId,
  relationshipGraphId: context.graphGrounding.targetRelationshipGraphId,
  relationshipGraphVersion: context.graphGrounding.graphVersion,
  chatId: chat.id,
  targetMessageId: target.id,
  executionId: "execution-runtime",
  draftText: privateDraft,
  nowMs: baseNowMs,
  deliveredAtMs: baseNowMs + 10,
});

function consent(overrides = {}) {
  return {
    version: "auto-send-execution-consent.1",
    authorized: true,
    tenantId,
    userId,
    grantedAt: "2026-10-08T09:55:00.000Z",
    revokedAt: null,
    emergencyStop: false,
    buildVersion,
    policyVersion: "auto-send-policy.1",
    ...overrides,
  };
}

function safetyInput(overrides = {}) {
  return {
    nowMs: baseNowMs,
    binding: {
      tenantId,
      accountId,
      relationshipGraphId: context.graphGrounding.targetRelationshipGraphId,
      relationshipGraphVersion: context.graphGrounding.graphVersion,
      chatId: chat.id,
      targetMessageId: target.id,
    },
    bridgeBundle: {
      chat,
      events: [target],
      watermark,
      latest: target,
      latestSource: target,
      readiness: {
        currentMessage: { state: "ready", reason: "private truth detail" },
        currentStory: { state: "ready", reason: "private story detail" },
        draftAllowed: true,
        observedAt: "2026-10-08T10:00:01.000Z",
      },
      accountScopeId: accountId,
    },
    draftContext: context,
    draftOutput: { draft: privateDraft, language: "English", evidenceIds: [target.id] },
    identity: { verified: true, tenantId, accountId, chatId: chat.id, relationshipIdentityId: "person:sakshi" },
    connection: { connected: true, state: "current-read-only", accountId },
    usage: { withinLimits: true },
    quietHours: { active: false },
    mediaAssessments: [],
    authorizationEnabled: true,
    countdownElapsed: false,
    customRuleId: "custom-rule-runtime",
    customRulePassed: true,
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    safetyInput: safetyInput(),
    tenantDefault: { mode: "safe", allowGroups: false, policyVersion: "auto-send-policy.1" },
    relationshipPolicy: null,
    chatOverride: null,
    executionConsent: consent(),
    ...overrides,
  };
}

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "mycrobo-auto-send-runtime-"));
  const databasePath = join(directory, "outbox.db");
  const outbox = new SqliteAutoSendOutbox(databasePath);
  t.after(async () => {
    outbox.close();
    await rm(directory, { recursive: true, force: true });
  });
  const issuer = new AutoSendAuthorizationIssuer({ secret, ledger: new InMemoryAutoSendAuthorizationLedger() });
  let stateLoads = 0;
  const boundaryCalls = [];
  const loadCurrentState = options.loadCurrentState || (async () => {
    stateLoads += 1;
    return snapshot(options.snapshot || {});
  });
  const deliveryBoundary = options.deliveryBoundary || (async (delivery) => {
    boundaryCalls.push(delivery);
    return { mockedProviderMessageId: "mock-only-message-id" };
  });
  const planner = new AutoSendRuntimePlanner({
    enabled: options.enabled,
    buildVersion,
    issuer,
    outbox,
    loadCurrentState,
    deliveryBoundary,
    clock: () => baseNowMs + 10,
    countdownMs: options.countdownMs || 5_000,
  });
  return { planner, outbox, databasePath, boundaryCalls, stateLoads: () => stateLoads };
}

test("runtime is inert by default even when every policy and safety input would pass", async (t) => {
  const { planner, boundaryCalls, stateLoads } = await fixture(t, { enabled: undefined });
  const result = await planner.run(request);

  assert.equal(result.state, "blocked");
  assert.deepEqual(result.reasons, ["RUNTIME_DISABLED"]);
  assert.equal(stateLoads(), 0);
  assert.equal(boundaryCalls.length, 0);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(privateDraft, "u"));
});

test("safe mode performs two fresh checks then reaches only the injected mock boundary", async (t) => {
  const { planner, outbox, databasePath, boundaryCalls, stateLoads } = await fixture(t, { enabled: true });
  const result = await planner.run(request);

  assert.equal(result.state, "sent");
  assert.equal(stateLoads(), 2);
  assert.equal(boundaryCalls.length, 1);
  assert.equal(boundaryCalls[0].body, privateDraft);
  assert.equal(boundaryCalls[0].idempotencyKey, result.delivery.authorizationId);
  assert.equal(outbox.find({ ...request, graphVersion: request.relationshipGraphVersion, policyVersion: "auto-send-policy.1" }).state, "sent");
  assert.doesNotMatch(JSON.stringify(result), /Hi!|mock-only-message-id|private truth detail|private story detail/iu);
  assert.equal((await readFile(databasePath)).includes(Buffer.from(privateDraft, "utf8")), false);
});

test("revoked, wrong-user, wrong-build, and wrong-policy consent never reach delivery", async (t) => {
  const invalid = [
    [consent({ authorized: false, emergencyStop: true }), "EXECUTION_CONSENT_NOT_AUTHORIZED"],
    [consent({ userId: "user-other" }), "EXECUTION_CONSENT_USER_MISMATCH"],
    [consent({ buildVersion: "another-build" }), "EXECUTION_CONSENT_BUILD_MISMATCH"],
    [consent({ policyVersion: "auto-send-policy.2" }), "EXECUTION_CONSENT_POLICY_MISMATCH"],
    [consent({ revokedAt: "2026-10-08T09:59:00.000Z" }), "EXECUTION_CONSENT_TIME_INVALID"],
  ];
  for (let index = 0; index < invalid.length; index += 1) {
    const [executionConsent, reason] = invalid[index];
    const { planner, boundaryCalls } = await fixture(t, { enabled: true, snapshot: { executionConsent } });
    const result = await planner.run(request);
    assert.equal(result.state, "blocked", reason);
    assert.ok(result.reasons.includes(reason), reason);
    assert.equal(boundaryCalls.length, 0, reason);
  }
});

test("a new message between planning and issuance blocks the job without invoking delivery", async (t) => {
  let loads = 0;
  const newer = { ...target, id: "message-newer", connectorMessageId: "message-newer", text: "Private newer message", timestampMs: 10_100, sequence: 2 };
  const loadCurrentState = async () => {
    loads += 1;
    if (loads === 1) return snapshot();
    return snapshot({
      safetyInput: safetyInput({
        bridgeBundle: {
          chat,
          events: [target, newer],
          watermark: { ...watermark, newestTimestampMs: newer.timestampMs, messageCount: 2 },
          latest: newer,
          latestSource: newer,
          readiness: { currentMessage: { state: "ready" }, currentStory: { state: "ready" }, draftAllowed: true, observedAt: "2026-10-08T10:00:01.500Z" },
          accountScopeId: accountId,
        },
      }),
    });
  };
  const { planner, boundaryCalls } = await fixture(t, { enabled: true, loadCurrentState });
  const result = await planner.run(request);

  assert.equal(loads, 2);
  assert.equal(result.state, "blocked");
  assert.ok(result.reasons.includes("NEWER_MESSAGE_EXISTS"));
  assert.equal(boundaryCalls.length, 0);
  assert.doesNotMatch(JSON.stringify(result), /Private newer message/u);
});

test("countdown stays inert before its deadline and supports explicit cancellation", async (t) => {
  const { planner, boundaryCalls } = await fixture(t, { enabled: true, snapshot: { tenantDefault: { mode: "countdown", allowGroups: false, policyVersion: "auto-send-policy.1" } } });
  const planned = await planner.run(request);
  assert.equal(planned.state, "countdown");
  assert.ok(planned.reasons.includes("COUNTDOWN_NOT_ELAPSED"));
  assert.equal(boundaryCalls.length, 0);

  const cancelled = await planner.run({ ...request, nowMs: baseNowMs + 100, cancelRequested: true });
  assert.equal(cancelled.state, "cancelled");
  assert.deepEqual(cancelled.reasons, ["USER_CANCELLED"]);
  assert.equal(boundaryCalls.length, 0);
});

test("countdown completion rechecks every authority before mock delivery", async (t) => {
  const { planner, boundaryCalls, stateLoads } = await fixture(t, { enabled: true, countdownMs: 5_000, snapshot: { tenantDefault: { mode: "countdown", allowGroups: false, policyVersion: "auto-send-policy.1" } } });
  assert.equal((await planner.run(request)).state, "countdown");
  const result = await planner.run({ ...request, nowMs: baseNowMs + 5_001, deliveredAtMs: baseNowMs + 5_010 });

  assert.equal(result.state, "sent");
  assert.equal(boundaryCalls.length, 1);
  assert.equal(stateLoads(), 3);
});

test("an abort arriving during fresh preflight cancels before capability issuance", async (t) => {
  const controller = new AbortController();
  let loads = 0;
  const loadCurrentState = async () => {
    loads += 1;
    controller.abort();
    return snapshot();
  };
  const { planner, boundaryCalls } = await fixture(t, { enabled: true, loadCurrentState });
  const result = await planner.run({ ...request, signal: controller.signal });

  assert.equal(loads, 1);
  assert.equal(result.state, "cancelled");
  assert.deepEqual(result.reasons, ["USER_CANCELLED"]);
  assert.equal(boundaryCalls.length, 0);
});

test("an injected boundary failure becomes an ambiguous content-free tombstone", async (t) => {
  const privateFailure = "private provider failure with message content";
  const { planner, boundaryCalls } = await fixture(t, {
    enabled: true,
    deliveryBoundary: async (delivery) => {
      boundaryCalls.push(delivery);
      throw new Error(privateFailure);
    },
  });
  const result = await planner.run(request);

  assert.equal(boundaryCalls.length, 1);
  assert.equal(result.state, "ambiguous");
  assert.deepEqual(result.reasons, ["DELIVERY_OUTCOME_AMBIGUOUS"]);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(privateFailure, "u"));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(privateDraft, "u"));
});

test("a safety-valid snapshot with a different draft cannot authorize the requested body", async (t) => {
  const { planner, boundaryCalls } = await fixture(t, {
    enabled: true,
    snapshot: { safetyInput: safetyInput({ draftOutput: { draft: "Hello!", language: "English", evidenceIds: [target.id] } }) },
  });
  const result = await planner.run(request);

  assert.equal(result.state, "blocked");
  assert.ok(result.reasons.includes("DRAFT_BINDING_MISMATCH"));
  assert.equal(boundaryCalls.length, 0);
});
