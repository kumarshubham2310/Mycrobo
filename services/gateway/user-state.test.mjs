import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  AUTO_SEND_EXECUTION_CONSENT_VERSION,
  AUTO_SEND_POLICY_VERSION,
  FileUserStateStore,
  MemoryUserStateStore,
  SqliteUserStateStore,
  createUserStateStoreFromEnv,
} from "./user-state.mjs";

test("memory user state records explicit task confirmation", async () => {
  const store = new MemoryUserStateStore();
  await store.setTaskStatus("chat:commitment", "done", new Date("2026-08-26T12:00:00Z"));
  assert.deepEqual((await store.snapshot()).tasks["chat:commitment"], { status: "done", confirmedAt: "2026-08-26T12:00:00.000Z", snoozedUntil: null });
});

test("snoozing requires a bounded future wake time", async () => {
  const store = new MemoryUserStateStore();
  const now = new Date("2026-08-26T12:00:00Z");
  await assert.rejects(store.setTaskStatus("chat:commitment", "snoozed", now, { snoozedUntil: "2026-08-26T11:00:00Z" }), /future/iu);
  await store.setTaskStatus("chat:commitment", "snoozed", now, { snoozedUntil: "2026-08-27T12:00:00Z" });
  assert.equal((await store.snapshot()).tasks["chat:commitment"].snoozedUntil, "2026-08-27T12:00:00.000Z");
});

test("file user state persists without storing message bodies", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mycrobo-user-state-"));
  const file = join(dir, "user-state.json");
  const store = new FileUserStateStore(file);
  await store.setTaskStatus("chat:commitment", "dismissed", new Date("2026-08-26T12:00:00Z"));
  const raw = await readFile(file, "utf8");
  assert.equal(Object.hasOwn(JSON.parse(raw), "messages"), false);
  const loaded = new FileUserStateStore(file);
  assert.equal((await loaded.snapshot()).tasks["chat:commitment"].status, "dismissed");
});

test("loading current-schema legacy Google credentials scrubs and persists them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mycrobo-google-credential-migration-"));
  const file = join(dir, "user-state.json");
  const seed = new FileUserStateStore(file);
  await seed.setTaskStatus("migration:seed", "dismissed", new Date("2026-10-08T10:00:00Z"));
  const injected = JSON.parse(await readFile(file, "utf8"));
  injected.connections.google = {
    provider: "google",
    accessToken: "LEGACY-GOOGLE-ACCESS-SECRET",
    scopes: ["mail.google.com"],
  };
  await writeFile(file, JSON.stringify(injected), "utf8");

  const migrated = new FileUserStateStore(file);
  assert.deepEqual(await migrated.directConnections(), { google: null });
  const persisted = await readFile(file, "utf8");
  assert.doesNotMatch(persisted, /LEGACY-GOOGLE|mail\.google\.com|refreshToken|accessToken/u);
  assert.deepEqual(JSON.parse(persisted).connections, { google: null });
});

test("decision dismissals persist as identifiers without storing message content", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mycrobo-decisions-"));
  const file = join(dir, "user-state.json");
  const store = new FileUserStateStore(file);
  await store.setDecisionStatus("chat-1:question-1", "dismissed", new Date("2026-08-26T12:00:00Z"));
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(saved.decisions["chat-1:question-1"], { status: "dismissed", confirmedAt: "2026-08-26T12:00:00.000Z" });
  assert.equal(JSON.stringify(saved).includes("message body"), false);
  const loaded = new FileUserStateStore(file);
  assert.equal((await loaded.snapshot()).decisions["chat-1:question-1"].status, "dismissed");
});

test("preferences are validated, persisted and migrated without chat content", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mycrobo-preferences-"));
  const file = join(dir, "user-state.json");
  const store = new FileUserStateStore(file);
  assert.deepEqual(await store.preferences(), { draftLanguage: "match", replyLength: "match", liveUpdates: true, density: "comfortable", defaultSendingMode: "draft" });
  await store.setPreferences({ draftLanguage: "Roman Hindi", replyLength: "short", liveUpdates: false, density: "compact", defaultSendingMode: "safe" });
  await assert.rejects(store.setPreferences({ density: "microscopic" }), /invalid/iu);
  const loaded = new FileUserStateStore(file);
  assert.deepEqual(await loaded.preferences(), { draftLanguage: "Roman Hindi", replyLength: "short", liveUpdates: false, density: "compact", defaultSendingMode: "safe" });
  const persisted = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(Object.keys(persisted).sort(), ["autoSendExecutionConsent", "autoSendPolicies", "binding", "chatStyles", "connections", "decisions", "draftFeedback", "integrations", "modelUsage", "personalizationOutcomes", "phraseUsage", "preferences", "schemaVersion", "tasks"]);
});

test("legacy sending preferences migrate into the five-mode policy without enabling delivery", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mycrobo-policy-migration-"));
  const file = join(dir, "user-state.json");
  await writeFile(file, JSON.stringify({
    schemaVersion: 9,
    tasks: {},
    preferences: { defaultSendingMode: "automatic" },
    chatStyles: { "chat-a": { sendingMode: "review-only" } },
  }), "utf8");
  const loaded = new FileUserStateStore(file);
  assert.equal((await loaded.preferences()).defaultSendingMode, "safe");
  assert.equal((await loaded.chatStyle("chat-a")).sendingMode, "draft");
  const consent = await loaded.autoSendExecutionConsent();
  assert.equal(consent.authorized, false);
  assert.equal(consent.emergencyStop, true);
});

test("auto-send policy layers use only opaque subjects and persist tenant relationship and chat precedence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mycrobo-auto-send-policy-"));
  const file = join(dir, "user-state.json");
  const tenantId = "tenant-0000000000000001";
  const userId = "user-000000000000000000000001";
  const relationshipSubjectId = "a".repeat(64);
  const chatSubjectId = "b".repeat(64);
  const store = new FileUserStateStore(file, null, { tenantId, userId });
  await store.setAutoSendPolicyLayer({ layerKind: "tenant", mode: "safe", allowGroups: false }, new Date("2026-10-08T10:00:00Z"));
  await store.setAutoSendPolicyLayer({ layerKind: "relationship", subjectId: relationshipSubjectId, mode: "countdown", allowGroups: false }, new Date("2026-10-08T10:01:00Z"));
  await store.setAutoSendPolicyLayer({ layerKind: "chat", subjectId: chatSubjectId, mode: "never", allowGroups: false }, new Date("2026-10-08T10:02:00Z"));
  await assert.rejects(
    store.setAutoSendPolicyLayer({ layerKind: "chat", subjectId: "raw-chat-id", mode: "safe" }),
    /opaque HMAC-ready/iu,
  );
  const reopened = new FileUserStateStore(file, null, { tenantId, userId });
  assert.deepEqual(await reopened.autoSendPolicy({ relationshipSubjectId, chatSubjectId }), {
    tenantDefault: { mode: "safe", allowGroups: false, policyVersion: AUTO_SEND_POLICY_VERSION, updatedAt: "2026-10-08T10:00:00.000Z" },
    relationshipPolicy: { mode: "countdown", allowGroups: false, policyVersion: AUTO_SEND_POLICY_VERSION, updatedAt: "2026-10-08T10:01:00.000Z" },
    chatOverride: { mode: "never", allowGroups: false, policyVersion: AUTO_SEND_POLICY_VERSION, updatedAt: "2026-10-08T10:02:00.000Z" },
  });
  const raw = await readFile(file, "utf8");
  assert.doesNotMatch(raw, /raw-chat-id|message body|PRIVATE/iu);
});

test("execution consent is independently bound, explicit, revocable and never inferred from safe configuration", async () => {
  const tenantId = "tenant-0000000000000001";
  const userId = "user-000000000000000000000001";
  const store = new MemoryUserStateStore({ tenantId, userId });
  await store.setAutoSendPolicyLayer({ layerKind: "tenant", mode: "safe" });
  assert.equal((await store.autoSendExecutionConsent()).authorized, false);
  await assert.rejects(store.grantAutoSendExecutionConsent({
    version: AUTO_SEND_EXECUTION_CONSENT_VERSION,
    policyVersion: AUTO_SEND_POLICY_VERSION,
    buildVersion: "1.0.0",
    confirmed: false,
  }), /explicitly confirmed/iu);
  const granted = await store.grantAutoSendExecutionConsent({
    version: AUTO_SEND_EXECUTION_CONSENT_VERSION,
    policyVersion: AUTO_SEND_POLICY_VERSION,
    buildVersion: "1.0.0",
    confirmed: true,
  }, new Date("2026-10-08T11:00:00Z"));
  assert.deepEqual(granted, {
    version: AUTO_SEND_EXECUTION_CONSENT_VERSION,
    authorized: true,
    tenantId,
    userId,
    grantedAt: "2026-10-08T11:00:00.000Z",
    revokedAt: null,
    emergencyStop: false,
    buildVersion: "1.0.0",
    policyVersion: AUTO_SEND_POLICY_VERSION,
  });
  const revoked = await store.revokeAutoSendExecutionConsent(new Date("2026-10-08T11:05:00Z"));
  assert.equal(revoked.authorized, false);
  assert.equal(revoked.emergencyStop, true);
  assert.equal(revoked.grantedAt, "2026-10-08T11:00:00.000Z");
  assert.equal(revoked.revokedAt, "2026-10-08T11:05:00.000Z");
});

test("durable state is tenant-user bound and unbound migration revokes forged execution authority", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mycrobo-bound-state-"));
  const file = join(dir, "user-state.json");
  const tenantId = "tenant-0000000000000001";
  const userId = "user-000000000000000000000001";
  await writeFile(file, JSON.stringify({
    schemaVersion: 10,
    tasks: {},
    preferences: { defaultSendingMode: "safe" },
    autoSendExecutionConsent: {
      version: AUTO_SEND_EXECUTION_CONSENT_VERSION,
      authorized: true,
      tenantId,
      userId,
      grantedAt: "2026-10-08T11:00:00.000Z",
      revokedAt: null,
      emergencyStop: false,
      buildVersion: "forged-legacy-build",
      policyVersion: AUTO_SEND_POLICY_VERSION,
    },
  }), "utf8");
  const migrated = new FileUserStateStore(file, null, { tenantId, userId });
  assert.equal((await migrated.autoSendExecutionConsent()).authorized, false);
  assert.deepEqual((await migrated.snapshot()).binding, { tenantId, userId });
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")).binding, { tenantId, userId });
  const wrongUser = new FileUserStateStore(file, null, { tenantId, userId: "user-000000000000000000000002" });
  await assert.rejects(wrongUser.snapshot(), /different authenticated tenant or user/iu);
});

test("personalization outcomes and recent phrase use store metadata without content", async () => {
  const store = new MemoryUserStateStore();
  const fingerprint = "a".repeat(64);
  const templateFingerprint = "b".repeat(64);
  const secret = "PRIVATE-DRAFT-CONTENT-91827";
  const outcomes = ["shown", "accepted", "lightly-edited", "full-rewrite", "dismissed", "no-reply"];
  for (let index = 0; index < outcomes.length; index += 1) {
    await store.recordPersonalizationOutcome({
      accountScopeId: "tenant-a",
      personId: "person-a",
      draftId: `draft-${index}`,
      outcome: outcomes[index],
      patternId: "phrase-pattern-a",
      provenanceFingerprint: fingerprint,
      templateFingerprint,
      editRatio: index === 2 ? 0.2 : index === 3 ? 0.9 : undefined,
      draftText: secret,
      finalText: secret,
    }, new Date(`2026-08-2${index + 1}T12:00:00Z`));
  }
  const snapshot = await store.snapshot();
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE-DRAFT-CONTENT|91827|person-a|tenant-a/iu);
  assert.deepEqual((await store.personalizationSummary("tenant-a", "person-a")).outcomes, {
    shown: 1, accepted: 1, "lightly-edited": 1, "full-rewrite": 1, dismissed: 1, "no-reply": 1,
  });
  const signals = await store.phraseSelectionSignals("tenant-a", "person-a", new Date("2026-09-01T12:00:00Z"));
  assert.deepEqual(signals.recentPatternIds, ["phrase-pattern-a"]);
  assert.equal(signals.feedbackSignals.length, 5);
  assert.ok(signals.feedbackSignals.every((signal) => Object.keys(signal).sort().join(",") === "adjustment,patternId,provenanceFingerprint,templateFingerprint"));
  assert.deepEqual(await store.phraseSelectionSignals("tenant-a", "person-b", new Date("2026-09-01T12:00:00Z")), { recentPatternIds: [], recentTemplateFingerprints: [], feedbackSignals: [] });
});

test("recent usage is deduplicated per shown draft and bounded per tenant-person", async () => {
  const store = new MemoryUserStateStore();
  const provenanceFingerprint = "c".repeat(64);
  const templateFingerprint = "d".repeat(64);
  for (let index = 0; index < 40; index += 1) {
    const input = { accountScopeId: "tenant-a", personId: "person-a", draftId: `draft-${index}`, outcome: "shown", patternId: `phrase-${index}`, provenanceFingerprint, templateFingerprint };
    await store.recordPersonalizationOutcome(input, new Date(1_700_000_000_000 + index * 1000));
    if (index === 39) await store.recordPersonalizationOutcome(input, new Date(1_700_000_100_000));
  }
  const summary = await store.personalizationSummary("tenant-a", "person-a");
  const signals = await store.phraseSelectionSignals("tenant-a", "person-a", new Date(1_700_000_200_000));
  assert.equal(summary.recentUsageCount, 32);
  assert.equal(signals.recentPatternIds.length, 32);
  assert.equal(signals.recentPatternIds.filter((id) => id === "phrase-39").length, 1);
});

test("file state persists only whitelisted content-free learning fields", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mycrobo-personalization-"));
  const file = join(dir, "user-state.json");
  const store = new FileUserStateStore(file);
  await store.recordPersonalizationOutcome({
    accountScopeId: "tenant-private",
    personId: "contact-private",
    draftId: "draft-private",
    outcome: "lightly-edited",
    patternId: "phrase-safe",
    provenanceFingerprint: "e".repeat(64),
    templateFingerprint: "f".repeat(64),
    editRatio: 0.12,
    messageText: "DO NOT PERSIST THIS MESSAGE",
  }, new Date("2026-09-01T12:00:00Z"));
  const raw = await readFile(file, "utf8");
  assert.doesNotMatch(raw, /tenant-private|contact-private|draft-private|DO NOT PERSIST THIS MESSAGE/iu);
  const loaded = new FileUserStateStore(file);
  const signals = await loaded.phraseSelectionSignals("tenant-private", "contact-private", new Date("2026-09-02T12:00:00Z"));
  assert.equal(signals.feedbackSignals.length, 1);
  assert.equal(signals.feedbackSignals[0].adjustment, 6);
});

test("state loading strips injected text and disables feedback whose evidence binding is incomplete", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mycrobo-personalization-migration-"));
  const file = join(dir, "user-state.json");
  await writeFile(file, JSON.stringify({
    schemaVersion: 8,
    tasks: {},
    personalizationOutcomes: [{
      accountKey: "a".repeat(64),
      personKey: "b".repeat(64),
      draftKey: "c".repeat(64),
      outcome: "accepted",
      patternId: "phrase-safe",
      provenanceFingerprint: null,
      templateFingerprint: "d".repeat(64),
      evidenceBound: true,
      adjustment: 999,
      rawDraft: "PRIVATE INJECTED DRAFT",
      createdAt: "2026-09-01T12:00:00.000Z",
    }],
    phraseUsage: [],
  }), "utf8");
  const store = new FileUserStateStore(file);
  const snapshot = await store.snapshot();
  assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE INJECTED DRAFT/iu);
  assert.equal(snapshot.personalizationOutcomes[0].evidenceBound, false);
  assert.equal(snapshot.personalizationOutcomes[0].adjustment, 0);
});

test("each tenant receives a bound workspace database and imports its encrypted legacy state", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycrobo-workspace-db-"));
  const key = randomBytes(32).toString("base64");
  const legacy = join(root, "user-state.json");
  const fileStore = new FileUserStateStore(legacy, key);
  await fileStore.setPreferences({ draftLanguage: "Roman Hindi", replyLength: "short", liveUpdates: true, density: "compact" });
  const tenantId = "tenant-0000000000000001";
  const userId = "user-000000000000000000000001";
  const store = new SqliteUserStateStore(join(root, "workspace.db"), key, tenantId, legacy, userId);
  assert.equal((await store.preferences()).draftLanguage, "Roman Hindi");
  await access(join(root, "workspace.db"));
  const reopened = new SqliteUserStateStore(join(root, "workspace.db"), key, tenantId, null, userId);
  assert.equal((await reopened.preferences()).density, "compact");
  await reopened.setAutoSendPolicyLayer({ layerKind: "tenant", mode: "safe", allowGroups: false }, new Date("2026-10-08T12:00:00Z"));
  await reopened.grantAutoSendExecutionConsent({
    version: AUTO_SEND_EXECUTION_CONSENT_VERSION,
    policyVersion: AUTO_SEND_POLICY_VERSION,
    buildVersion: "1.0.0",
    confirmed: true,
  }, new Date("2026-10-08T12:01:00Z"));
  const consentReopened = new SqliteUserStateStore(join(root, "workspace.db"), key, tenantId, null, userId);
  assert.equal((await consentReopened.autoSendExecutionConsent()).authorized, true);
  assert.equal((await consentReopened.autoSendPolicy()).tenantDefault.mode, "safe");
  const wrongTenant = new SqliteUserStateStore(join(root, "workspace.db"), key, "tenant-0000000000000002", null, userId);
  await assert.rejects(wrongTenant.preferences(), /different tenant/u);
  const wrongUser = new SqliteUserStateStore(join(root, "workspace.db"), key, tenantId, null, "user-000000000000000000000002");
  await assert.rejects(wrongUser.preferences(), /different authenticated user/u);
});

test("environment-derived state requires authenticated tenant and user bindings", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycrobo-workspace-db-"));
  assert.throws(() => createUserStateStoreFromEnv({ MYCROBO_USER_DATA_DIR: root, MYCROBO_USER_STATE_KEY: randomBytes(32).toString("base64") }), /verified tenant/u);
  assert.throws(() => createUserStateStoreFromEnv({ MYCROBO_USER_DATA_DIR: root, MYCROBO_TENANT_ID: "tenant-0000000000000001", MYCROBO_USER_STATE_KEY: randomBytes(32).toString("base64") }), /authenticated user/iu);
  assert.ok(createUserStateStoreFromEnv({
    MYCROBO_USER_DATA_DIR: root,
    MYCROBO_TENANT_ID: "tenant-0000000000000001",
    MYCROBO_AUTH_USER_ID: "user-000000000000000000000001",
    MYCROBO_USER_STATE_KEY: randomBytes(32).toString("base64"),
  }) instanceof SqliteUserStateStore);
});

test("environment-derived durable state is isolated per authenticated user and claims an unbound legacy database once", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycrobo-user-scoped-db-"));
  const key = randomBytes(32).toString("base64");
  const tenantId = "tenant-0000000000000001";
  const firstUserId = "user-000000000000000000000001";
  const secondUserId = "user-000000000000000000000002";
  const legacy = new SqliteUserStateStore(join(root, "workspace.db"), key, tenantId);
  await legacy.setPreferences({ defaultSendingMode: "safe" });

  const first = createUserStateStoreFromEnv({
    MYCROBO_USER_DATA_DIR: root,
    MYCROBO_TENANT_ID: tenantId,
    MYCROBO_AUTH_USER_ID: firstUserId,
    MYCROBO_USER_STATE_KEY: key,
  });
  assert.equal((await first.preferences()).defaultSendingMode, "safe");
  assert.equal((await first.autoSendExecutionConsent()).authorized, false);
  await access(join(root, "users", firstUserId, "workspace.db"));

  const second = createUserStateStoreFromEnv({
    MYCROBO_USER_DATA_DIR: root,
    MYCROBO_TENANT_ID: tenantId,
    MYCROBO_AUTH_USER_ID: secondUserId,
    MYCROBO_USER_STATE_KEY: key,
  });
  assert.equal((await second.preferences()).defaultSendingMode, "draft");
  await second.setPreferences({ defaultSendingMode: "countdown" });
  assert.equal((await first.preferences()).defaultSendingMode, "safe");
  await access(join(root, "users", secondUserId, "workspace.db"));
});
