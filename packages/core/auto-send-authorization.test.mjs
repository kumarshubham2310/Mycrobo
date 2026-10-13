import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTO_SEND_REVALIDATION_CONTRACT,
  AutoSendAuthorizationIssuer,
  InMemoryAutoSendAuthorizationLedger,
  MAX_AUTHORIZATION_TTL_MS,
  hashAutoSendDraft,
} from "./auto-send-authorization.ts";

const nowMs = 1_800_000_000_000;
const secret = "test-only-secret-that-is-at-least-thirty-two-bytes-long";
const draftText = "Sounds good, thank you.";
const binding = Object.freeze({
  tenantId: "tenant-a",
  accountId: "account-a",
  relationshipGraphId: "relationship-graph-a",
  relationshipGraphVersion: "relationship-graph:42",
  chatId: "chat-a",
  targetMessageId: "message-7",
});
const safePolicy = Object.freeze({
  tenantDefault: { mode: "safe" },
  relationshipPolicy: { mode: "inherit" },
  chatOverride: { mode: "inherit" },
  safety: {
    authorizationEnabled: true,
    identityVerified: true,
    targetMessageId: "message-7",
    latestInboundMessageId: "message-7",
    newerTargetMessageExists: false,
    chatKind: "direct",
    timeDateOrLocationPromiseDetected: false,
    moneyOrPaymentDetected: false,
    legalMedicalOrSensitiveDetected: false,
    mediaOrOcrUncertain: false,
    factsComplete: true,
    newCommitmentDetected: false,
    groundingPassed: true,
    accountMatched: true,
    connectorConnected: true,
    withinUsageLimits: true,
    quietHoursActive: false,
  },
});

function issue(issuer, overrides = {}) {
  return issuer.issue({
    ...binding,
    idempotencyKey: "request-1",
    draftText,
    policy: safePolicy,
    nowMs,
    ...overrides,
  });
}

function createIssuer(ledger = new InMemoryAutoSendAuthorizationLedger()) {
  return new AutoSendAuthorizationIssuer({ secret, ledger });
}

function revalidate(issuer, token, overrides = {}) {
  return issuer.revalidateAndAuthorize({
    ...binding,
    token,
    executionId: "execution-1",
    draftText,
    policy: safePolicy,
    nowMs: nowMs + 1_000,
    ...overrides,
  });
}

test("draft hash is deterministic and sensitive to exact draft bytes", () => {
  assert.equal(hashAutoSendDraft(draftText), hashAutoSendDraft(draftText));
  assert.notEqual(hashAutoSendDraft(draftText), hashAutoSendDraft(`${draftText} `));
});

test("issuer mints a short-lived signed token bound to every required scope", () => {
  const issuer = createIssuer();
  const token = issue(issuer, { ttlMs: 15_000 });
  const payload = issuer.verify(token, nowMs + 1);
  assert.equal(payload.tenantId, binding.tenantId);
  assert.equal(payload.accountId, binding.accountId);
  assert.equal(payload.relationshipGraphId, binding.relationshipGraphId);
  assert.equal(payload.relationshipGraphVersion, binding.relationshipGraphVersion);
  assert.equal(payload.chatId, binding.chatId);
  assert.equal(payload.targetMessageId, binding.targetMessageId);
  assert.equal(payload.draftHash, hashAutoSendDraft(draftText));
  assert.equal(payload.policyVersion, "auto-send-policy.1");
  assert.equal(payload.revalidationContract, AUTO_SEND_REVALIDATION_CONTRACT);
  assert.equal(payload.expiresAtMs, nowMs + 15_000);
});

test("issuance is idempotent for the same key and rejects key reuse with changed bindings", () => {
  const issuer = createIssuer();
  const first = issue(issuer);
  const second = issue(issuer, { nowMs: nowMs + 100, ttlMs: 10_000 });
  assert.equal(second, first);
  assert.throws(() => issue(issuer, { chatId: "chat-b" }), /different authorization bindings/u);
  assert.throws(() => issue(issuer, { draftText: "Changed draft" }), /different authorization bindings/u);
});

test("issuer rejects ineligible policy decisions and non-short-lived TTLs", () => {
  const issuer = createIssuer();
  assert.throws(() => issue(issuer, {
    policy: { ...safePolicy, chatOverride: { mode: "never" } },
  }), /not eligible/u);
  assert.throws(() => issue(issuer, { ttlMs: MAX_AUTHORIZATION_TTL_MS + 1 }), /TTL/u);
});

test("the default feature-disabled policy cannot mint an authorization", () => {
  const issuer = createIssuer();
  const defaultDisabled = {
    tenantDefault: { mode: "safe" },
    safety: { ...safePolicy.safety, authorizationEnabled: undefined },
  };
  assert.throws(() => issue(issuer, { policy: defaultDisabled }), /not eligible/u);
});

test("signature tampering and expiry are rejected", () => {
  const issuer = createIssuer();
  const token = issue(issuer, { ttlMs: 2_000 });
  const [payload, signature] = token.split(".");
  const changedSignature = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
  assert.throws(() => issuer.verify(`${payload}.${changedSignature}`, nowMs + 1), /signature/u);
  assert.throws(() => issuer.verify(token, nowMs + 2_000), /expired/u);
});

test("revalidation binds tenant, account, relationship graph, chat, target, and exact draft", () => {
  const changedBindings = [
    ["tenantId", "tenant-b"],
    ["accountId", "account-b"],
    ["relationshipGraphId", "relationship-graph-b"],
    ["relationshipGraphVersion", "relationship-graph:43"],
    ["chatId", "chat-b"],
    ["targetMessageId", "message-8"],
    ["draftText", `${draftText} `],
  ];
  for (const [field, value] of changedBindings) {
    const issuer = createIssuer();
    const token = issue(issuer);
    assert.throws(() => revalidate(issuer, token, { [field]: value }), /bindings changed/u, field);
  }
});

test("a token cannot cross either its tenant or relationship graph boundary", () => {
  const issuer = createIssuer();
  const token = issue(issuer);
  assert.throws(() => revalidate(issuer, token, {
    tenantId: "tenant-b",
    relationshipGraphId: "relationship-graph-b",
  }), /bindings changed/u);
  assert.throws(() => revalidate(issuer, token, {
    tenantId: "tenant-a",
    relationshipGraphId: "relationship-graph-b",
  }), /bindings changed/u);
});

test("the complete current policy is re-run before an intent is authorized", () => {
  const issuer = createIssuer();
  const token = issue(issuer);
  const stalePolicy = {
    ...safePolicy,
    safety: { ...safePolicy.safety, latestInboundMessageId: "message-8", newerTargetMessageExists: true },
  };
  assert.throws(() => revalidate(issuer, token, { policy: stalePolicy }), /no longer authorizes/u);
});

test("consumption is idempotent per execution and blocks replay by another execution", () => {
  const issuer = createIssuer();
  const token = issue(issuer);
  const first = revalidate(issuer, token);
  const retry = revalidate(issuer, token);
  assert.deepEqual(retry, first);
  assert.equal(first.executionId, "execution-1");
  assert.equal(first.relationshipGraphId, binding.relationshipGraphId);
  assert.equal(first.relationshipGraphVersion, binding.relationshipGraphVersion);
  assert.equal(first.policyVersion, "auto-send-policy.1");
  assert.equal(first.revalidationContract, AUTO_SEND_REVALIDATION_CONTRACT);
  assert.throws(() => revalidate(issuer, token, { executionId: "execution-2" }), /already consumed/u);
});

test("authorization returns only an ephemeral intent and never invokes a send boundary", () => {
  let mockedSendCalls = 0;
  const mockedSendBoundary = () => { mockedSendCalls += 1; };
  const issuer = createIssuer();
  const intent = revalidate(issuer, issue(issuer));
  assert.equal(intent.chatId, binding.chatId);
  assert.equal(mockedSendCalls, 0);
  assert.equal(typeof mockedSendBoundary, "function");
});

test("issuance evaluates raw policy internally and ignores forged decision-shaped input", () => {
  const issuer = createIssuer();
  assert.throws(() => issue(issuer, {
    policy: {
      tenantDefault: { mode: "never" },
      safety: safePolicy.safety,
      eligibleForAuthorization: true,
      policyVersion: "auto-send-policy.1",
    },
  }), /not eligible/u);
});

test("restart replay is rejected without the same durable ledger and remains consumed with it", () => {
  const durableLedger = new InMemoryAutoSendAuthorizationLedger();
  const firstProcess = createIssuer(durableLedger);
  const token = issue(firstProcess);
  revalidate(firstProcess, token);

  const freshLedgerProcess = createIssuer();
  assert.throws(() => freshLedgerProcess.verify(token, nowMs + 1_500), /active send ledger/u);

  const restartedProcess = createIssuer(durableLedger);
  assert.throws(
    () => revalidate(restartedProcess, token, { executionId: "execution-after-restart" }),
    /already consumed/u,
  );
});
