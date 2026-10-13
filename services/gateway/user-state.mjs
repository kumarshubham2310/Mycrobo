import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { PERSONALIZATION_OUTCOMES, personalizationOutcomeAdjustment } from "../../packages/core/personalization-learning.ts";

const VALID_TASK_STATUS = new Set(["pending", "done", "dismissed", "snoozed"]);
const VALID_DECISION_STATUS = new Set(["pending", "dismissed"]);
const VALID_FEEDBACK = new Set(["good", "wrong-tone", "wrong-fact", "wrong-language", "too-long", "too-short", "no-reply", "wrong-person"]);
const AUTO_SEND_MODES = new Set(["never", "draft", "countdown", "safe", "custom"]);
const AUTO_SEND_SUBJECT_ID = /^[a-f\d]{64}$/u;
const TENANT_ID = /^tenant-[a-f\d]{16}$/u;
const USER_ID = /^user-[a-f\d]{24}$/u;
export const AUTO_SEND_EXECUTION_CONSENT_VERSION = "auto-send-execution-consent.1";
export const AUTO_SEND_POLICY_VERSION = "auto-send-policy.1";
const DEFAULT_PREFERENCES = Object.freeze({
  draftLanguage: "match",
  replyLength: "match",
  liveUpdates: true,
  density: "comfortable",
  defaultSendingMode: "draft",
});
const PREFERENCE_VALUES = Object.freeze({
  draftLanguage: new Set(["match", "English", "Roman Hindi", "Roman Gujarati"]),
  replyLength: new Set(["match", "short", "medium"]),
  liveUpdates: new Set([true, false]),
  density: new Set(["comfortable", "compact"]),
  defaultSendingMode: AUTO_SEND_MODES,
});
const VAULT_SCHEMA = "mycrobo-user-state-vault.1";
const VALID_PERSONALIZATION_OUTCOME = new Set(PERSONALIZATION_OUTCOMES);
const CONTENT_FINGERPRINT = /^[a-f\d]{64}$/u;
const PATTERN_ID = /^[a-z\d][a-z\d_-]{0,119}$/iu;
const MAX_PERSONALIZATION_OUTCOMES = 2_000;
const MAX_PHRASE_USAGE = 5_000;
const MAX_RECENT_USAGE_PER_PERSON = 32;

function normalizeStateBinding(binding = {}) {
  const tenantId = String(binding?.tenantId || "").trim();
  const userId = String(binding?.userId || binding?.authenticatedUserId || "").trim();
  return {
    tenantId: TENANT_ID.test(tenantId) ? tenantId : null,
    userId: USER_ID.test(userId) ? userId : null,
  };
}

function completeStateBinding(binding = {}) {
  const normalized = normalizeStateBinding(binding);
  return normalized.tenantId && normalized.userId ? normalized : null;
}

function assertCompatibleStateBinding(storedBinding, requestedBinding) {
  const stored = completeStateBinding(storedBinding);
  const requested = completeStateBinding(requestedBinding);
  if (stored && (!requested || stored.tenantId !== requested.tenantId || stored.userId !== requested.userId)) {
    throw new Error("This user state belongs to a different authenticated tenant or user.");
  }
}

function defaultExecutionConsent(binding = {}) {
  const normalized = normalizeStateBinding(binding);
  return {
    version: AUTO_SEND_EXECUTION_CONSENT_VERSION,
    authorized: false,
    tenantId: normalized.tenantId,
    userId: normalized.userId,
    grantedAt: null,
    revokedAt: null,
    emergencyStop: true,
    buildVersion: null,
    policyVersion: AUTO_SEND_POLICY_VERSION,
  };
}

function normalizeExecutionConsent(input, binding = {}, { preserveAuthorization = true } = {}) {
  const fallback = defaultExecutionConsent(binding);
  const normalizedBinding = normalizeStateBinding(binding);
  const bindingMatches = Boolean(
    normalizedBinding.tenantId
    && normalizedBinding.userId
    && input?.tenantId === normalizedBinding.tenantId
    && input?.userId === normalizedBinding.userId,
  );
  const versionMatches = input?.version === AUTO_SEND_EXECUTION_CONSENT_VERSION
    && input?.policyVersion === AUTO_SEND_POLICY_VERSION;
  const grantedAt = Number.isFinite(Date.parse(input?.grantedAt || "")) ? new Date(input.grantedAt).toISOString() : null;
  const revokedAt = Number.isFinite(Date.parse(input?.revokedAt || "")) ? new Date(input.revokedAt).toISOString() : null;
  const buildVersion = typeof input?.buildVersion === "string" && input.buildVersion.trim()
    ? input.buildVersion.trim().slice(0, 120)
    : null;
  const authorized = preserveAuthorization
    && bindingMatches
    && versionMatches
    && input?.authorized === true
    && input?.emergencyStop === false
    && Boolean(grantedAt && buildVersion)
    && !revokedAt;
  return {
    ...fallback,
    authorized,
    grantedAt: bindingMatches && versionMatches ? grantedAt : null,
    revokedAt: authorized ? null : bindingMatches && versionMatches ? revokedAt : null,
    emergencyStop: authorized ? false : true,
    buildVersion: bindingMatches && versionMatches ? buildVersion : null,
  };
}

function normalizeAutoSendLayer(input = {}, { fallbackMode = "never" } = {}) {
  const mode = AUTO_SEND_MODES.has(input?.mode) ? input.mode : fallbackMode;
  return {
    mode,
    allowGroups: input?.allowGroups === true,
    policyVersion: AUTO_SEND_POLICY_VERSION,
    updatedAt: Number.isFinite(Date.parse(input?.updatedAt || "")) ? new Date(input.updatedAt).toISOString() : null,
  };
}

function normalizePolicyMap(input = {}) {
  const output = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return output;
  for (const [subjectId, layer] of Object.entries(input)) {
    if (AUTO_SEND_SUBJECT_ID.test(subjectId)) output[subjectId] = normalizeAutoSendLayer(layer);
  }
  return output;
}

function normalizeAutoSendPolicies(input = {}, preferences = DEFAULT_PREFERENCES) {
  return {
    tenant: normalizeAutoSendLayer(input?.tenant, { fallbackMode: normalizePreferences(preferences).defaultSendingMode }),
    relationships: normalizePolicyMap(input?.relationships),
    chats: normalizePolicyMap(input?.chats),
  };
}

function normalizedVaultKey(value) {
  if (!value) return null;
  const key = Buffer.from(String(value), "base64");
  if (key.length !== 32) throw new Error("The private user-state vault key must contain exactly 32 bytes.");
  return key;
}

function encryptState(state, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(state), "utf8"), cipher.final()]);
  return JSON.stringify({
    schema: VAULT_SCHEMA,
    algorithm: "AES-256-GCM",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  });
}

function decryptState(envelope, key) {
  if (envelope?.schema !== VAULT_SCHEMA) return envelope;
  if (!key) throw new Error("Encrypted MyCrobo settings require the private vault key.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}

function contentFreeKey(...values) {
  const hash = createHash("sha256");
  for (const value of values) {
    const normalized = String(value || "").normalize("NFKC").trim();
    hash.update(String(Buffer.byteLength(normalized, "utf8")));
    hash.update(":");
    hash.update(normalized);
    hash.update(";");
  }
  return hash.digest("hex");
}

function personalizationScope(accountScopeId, personId) {
  const account = String(accountScopeId || "").trim();
  const person = String(personId || "").trim();
  if (!account || !person) throw new Error("Personalization learning requires an account and person scope.");
  return { accountKey: contentFreeKey("account", account), personKey: contentFreeKey("person", account, person) };
}

function normalizedOutcomeRecords(records) {
  return (Array.isArray(records) ? records : []).filter((record) => record && CONTENT_FINGERPRINT.test(record.accountKey || "") && CONTENT_FINGERPRINT.test(record.personKey || "") && VALID_PERSONALIZATION_OUTCOME.has(record.outcome)).slice(-MAX_PERSONALIZATION_OUTCOMES).map((record) => ({
    accountKey: record.accountKey,
    personKey: record.personKey,
    draftKey: CONTENT_FINGERPRINT.test(record.draftKey || "") ? record.draftKey : contentFreeKey("migrated-draft", record.accountKey, record.personKey, record.createdAt || ""),
    outcome: record.outcome,
    patternId: PATTERN_ID.test(record.patternId || "") ? record.patternId : null,
    provenanceFingerprint: CONTENT_FINGERPRINT.test(record.provenanceFingerprint || "") ? record.provenanceFingerprint : null,
    templateFingerprint: CONTENT_FINGERPRINT.test(record.templateFingerprint || "") ? record.templateFingerprint : null,
    evidenceBound: record.evidenceBound === true && PATTERN_ID.test(record.patternId || "") && CONTENT_FINGERPRINT.test(record.provenanceFingerprint || "") && CONTENT_FINGERPRINT.test(record.templateFingerprint || ""),
    adjustment: record.evidenceBound === true
      && PATTERN_ID.test(record.patternId || "")
      && CONTENT_FINGERPRINT.test(record.provenanceFingerprint || "")
      && CONTENT_FINGERPRINT.test(record.templateFingerprint || "")
      ? personalizationOutcomeAdjustment(record.outcome)
      : 0,
    editRatio: Number.isFinite(record.editRatio) ? Math.max(0, Math.min(1, Number(Number(record.editRatio).toFixed(4)))) : null,
    createdAt: Number.isFinite(Date.parse(record.createdAt || "")) ? new Date(record.createdAt).toISOString() : new Date(0).toISOString(),
  }));
}

function normalizedUsageRecords(records) {
  return (Array.isArray(records) ? records : []).filter((record) => record && CONTENT_FINGERPRINT.test(record.accountKey || "") && CONTENT_FINGERPRINT.test(record.personKey || "") && CONTENT_FINGERPRINT.test(record.usageKey || "") && PATTERN_ID.test(record.patternId || "") && CONTENT_FINGERPRINT.test(record.provenanceFingerprint || "") && CONTENT_FINGERPRINT.test(record.templateFingerprint || "")).slice(-MAX_PHRASE_USAGE).map((record) => ({
    accountKey: record.accountKey,
    personKey: record.personKey,
    usageKey: record.usageKey,
    patternId: record.patternId,
    provenanceFingerprint: record.provenanceFingerprint,
    templateFingerprint: record.templateFingerprint,
    usedAt: Number.isFinite(Date.parse(record.usedAt || "")) ? new Date(record.usedAt).toISOString() : new Date(0).toISOString(),
  }));
}

function emptyState(binding = {}) {
  const preferences = { ...DEFAULT_PREFERENCES };
  return {
    schemaVersion: 10,
    binding: normalizeStateBinding(binding),
    tasks: {},
    decisions: {},
    preferences,
    chatStyles: {},
    autoSendPolicies: normalizeAutoSendPolicies({}, preferences),
    autoSendExecutionConsent: defaultExecutionConsent(binding),
    draftFeedback: [],
    personalizationOutcomes: [],
    phraseUsage: [],
    modelUsage: [],
    integrations: { contacts: null, calendar: null },
    connections: { google: null },
  };
}

function normalizedStoredState(parsed, binding = {}) {
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10].includes(parsed?.schemaVersion) || !parsed.tasks || typeof parsed.tasks !== "object") return null;
  assertCompatibleStateBinding(parsed.binding, binding);
  const requestedBinding = normalizeStateBinding(binding);
  const storedBinding = normalizeStateBinding(parsed.binding);
  const normalizedBinding = completeStateBinding(requestedBinding) || storedBinding;
  const bindingMatches = Boolean(
    completeStateBinding(requestedBinding)
    && completeStateBinding(storedBinding)
    && requestedBinding.tenantId === storedBinding.tenantId
    && requestedBinding.userId === storedBinding.userId,
  );
  const preferences = normalizePreferences(parsed.preferences);
  const migrated = parsed.schemaVersion !== 10 || !bindingMatches;
  return {
    schemaVersion: 10,
    binding: normalizedBinding,
    tasks: parsed.tasks,
    decisions: parsed.decisions && typeof parsed.decisions === "object" ? parsed.decisions : {},
    preferences,
    chatStyles: parsed.chatStyles && typeof parsed.chatStyles === "object" ? parsed.chatStyles : {},
    autoSendPolicies: normalizeAutoSendPolicies(parsed.autoSendPolicies, preferences),
    // A legacy mode was configuration shown under an execution lock. It must
    // never become delivery authority merely because this schema is upgraded.
    autoSendExecutionConsent: normalizeExecutionConsent(parsed.autoSendExecutionConsent, normalizedBinding, { preserveAuthorization: !migrated }),
    draftFeedback: Array.isArray(parsed.draftFeedback) ? parsed.draftFeedback.slice(-500) : [],
    personalizationOutcomes: normalizedOutcomeRecords(parsed.personalizationOutcomes),
    phraseUsage: normalizedUsageRecords(parsed.phraseUsage),
    modelUsage: Array.isArray(parsed.modelUsage) ? parsed.modelUsage.slice(-10_000) : [],
    integrations: normalizeIntegrations(parsed.integrations),
    connections: normalizeConnections(parsed.connections),
  };
}

function normalizeIntegrations(input = {}) {
  return {
    contacts: input?.contacts?.kind === "contacts" && Array.isArray(input.contacts.contacts) ? input.contacts : null,
    calendar: input?.calendar?.kind === "calendar" && Array.isArray(input.calendar.busyBlocks) ? input.calendar : null,
  };
}

function normalizeConnections(input = {}) {
  // Google credentials moved to the dedicated AES-GCM tenant/user vault.
  // Legacy credential-shaped records are deliberately discarded on load.
  void input;
  return { google: null };
}

function normalizeChatStyle(input = {}) {
  const output = {};
  if (["match", "English", "Roman Hindi", "Roman Gujarati"].includes(input.language)) output.language = input.language;
  if (["match", "short", "medium"].includes(input.length)) output.length = input.length;
  if (["match", "casual", "neutral", "formal"].includes(input.formality)) output.formality = input.formality;
  if (["match", "avoid", "use"].includes(input.emoji)) output.emoji = input.emoji;
  const sendingMode = input.sendingMode === "review-only"
    ? "draft"
    : input.sendingMode === "automatic"
      ? "safe"
      : input.sendingMode;
  if (["inherit", "never", "draft", "countdown", "safe", "custom"].includes(sendingMode)) output.sendingMode = sendingMode;
  if (typeof input.instruction === "string") output.instruction = input.instruction.replace(/\s+/gu, " ").trim().slice(0, 240);
  return output;
}

function normalizePreferences(input = {}) {
  const output = { ...DEFAULT_PREFERENCES };
  const normalizedInput = {
    ...input,
    defaultSendingMode: input.defaultSendingMode === "review-only"
      ? "draft"
      : input.defaultSendingMode === "automatic"
        ? "safe"
        : input.defaultSendingMode,
  };
  for (const [key, allowed] of Object.entries(PREFERENCE_VALUES)) {
    if (allowed.has(normalizedInput[key])) output[key] = normalizedInput[key];
  }
  return output;
}

export class MemoryUserStateStore {
  constructor(binding = {}) {
    this.binding = normalizeStateBinding(binding);
    this.state = emptyState(this.binding);
  }

  async snapshot() {
    return structuredClone(this.state);
  }

  async setTaskStatus(taskId, status, now = new Date(), options = {}) {
    if (!String(taskId || "").trim() || !VALID_TASK_STATUS.has(status)) throw new Error("A valid task and status are required.");
    let snoozedUntil = null;
    if (status === "snoozed") {
      const parsed = Date.parse(options.snoozedUntil || "");
      const maximum = now.getTime() + 366 * 86_400_000;
      if (!Number.isFinite(parsed) || parsed <= now.getTime() || parsed > maximum) throw new Error("Choose a future follow-up time within one year.");
      snoozedUntil = new Date(parsed).toISOString();
    }
    this.state.tasks[taskId] = { status, confirmedAt: status === "pending" ? null : now.toISOString(), snoozedUntil };
    return this.state.tasks[taskId];
  }

  async preferences() {
    return structuredClone(normalizePreferences(this.state.preferences));
  }

  async setDecisionStatus(decisionId, status, now = new Date()) {
    if (!String(decisionId || "").trim() || !VALID_DECISION_STATUS.has(status)) throw new Error("A valid decision and status are required.");
    this.state.decisions[decisionId] = { status, confirmedAt: status === "pending" ? null : now.toISOString() };
    return this.state.decisions[decisionId];
  }

  async setPreferences(input) {
    const rawInput = { ...(input || {}) };
    delete rawInput.autoReplyEnabled;
    const proposed = { ...normalizePreferences(this.state.preferences), ...rawInput };
    for (const [key, value] of Object.entries(proposed)) {
      if (!(key in PREFERENCE_VALUES) || !PREFERENCE_VALUES[key].has(value)) throw new Error("One or more preferences are invalid.");
    }
    this.state.preferences = normalizePreferences(proposed);
    this.state.autoSendPolicies.tenant = normalizeAutoSendLayer({
      ...this.state.autoSendPolicies.tenant,
      mode: this.state.preferences.defaultSendingMode,
    }, { fallbackMode: this.state.preferences.defaultSendingMode });
    return this.preferences();
  }

  async autoSendPolicy({ relationshipSubjectId = null, chatSubjectId = null } = {}) {
    if (relationshipSubjectId !== null && !AUTO_SEND_SUBJECT_ID.test(String(relationshipSubjectId))) {
      throw new Error("A content-free relationship policy subject is required.");
    }
    if (chatSubjectId !== null && !AUTO_SEND_SUBJECT_ID.test(String(chatSubjectId))) {
      throw new Error("A content-free chat policy subject is required.");
    }
    const policies = normalizeAutoSendPolicies(this.state.autoSendPolicies, this.state.preferences);
    return structuredClone({
      tenantDefault: policies.tenant,
      relationshipPolicy: relationshipSubjectId ? policies.relationships[relationshipSubjectId] ?? null : null,
      chatOverride: chatSubjectId ? policies.chats[chatSubjectId] ?? null : null,
    });
  }

  async setAutoSendPolicyLayer(input, now = new Date()) {
    const layerKind = String(input?.layerKind || "");
    if (!["tenant", "relationship", "chat"].includes(layerKind)) throw new Error("Choose a valid auto-send policy layer.");
    const subjectId = input?.subjectId == null ? null : String(input.subjectId);
    if (layerKind === "tenant" && subjectId !== null) throw new Error("A tenant policy cannot include a relationship or chat subject.");
    if (layerKind !== "tenant" && !AUTO_SEND_SUBJECT_ID.test(subjectId || "")) {
      throw new Error("Relationship and chat policy subjects must be opaque HMAC-ready identifiers.");
    }
    if (!AUTO_SEND_MODES.has(input?.mode)) throw new Error("Choose a valid auto-send policy mode.");
    if (input?.allowGroups !== undefined && typeof input.allowGroups !== "boolean") throw new Error("Group delivery policy must be explicit.");
    if (!Number.isFinite(now.getTime())) throw new Error("The policy update time is invalid.");
    const layer = normalizeAutoSendLayer({ ...input, updatedAt: now.toISOString() });
    if (layerKind === "tenant") {
      this.state.autoSendPolicies.tenant = layer;
      this.state.preferences.defaultSendingMode = layer.mode;
    } else {
      const collection = layerKind === "relationship" ? this.state.autoSendPolicies.relationships : this.state.autoSendPolicies.chats;
      collection[subjectId] = layer;
    }
    return structuredClone(layer);
  }

  async removeAutoSendPolicyLayer(layerKind, subjectId) {
    if (!["relationship", "chat"].includes(layerKind) || !AUTO_SEND_SUBJECT_ID.test(String(subjectId || ""))) {
      throw new Error("Choose a valid content-free relationship or chat policy.");
    }
    const collection = layerKind === "relationship" ? this.state.autoSendPolicies.relationships : this.state.autoSendPolicies.chats;
    const removed = delete collection[String(subjectId)];
    return { removed, layerKind, subjectId: String(subjectId) };
  }

  async autoSendExecutionConsent() {
    this.state.autoSendExecutionConsent = normalizeExecutionConsent(this.state.autoSendExecutionConsent, this.binding);
    return structuredClone(this.state.autoSendExecutionConsent);
  }

  async grantAutoSendExecutionConsent(input, now = new Date()) {
    if (!this.binding.tenantId || !this.binding.userId) throw new Error("Execution consent requires an authenticated tenant and user binding.");
    if (input?.version !== AUTO_SEND_EXECUTION_CONSENT_VERSION || input?.policyVersion !== AUTO_SEND_POLICY_VERSION) {
      throw new Error("Execution consent uses an unsupported policy version.");
    }
    if (input?.confirmed !== true) throw new Error("Execution consent must be explicitly confirmed.");
    const buildVersion = String(input?.buildVersion || "").trim().slice(0, 120);
    if (!buildVersion || !Number.isFinite(now.getTime())) throw new Error("Execution consent requires a valid build and time.");
    this.state.autoSendExecutionConsent = normalizeExecutionConsent({
      version: AUTO_SEND_EXECUTION_CONSENT_VERSION,
      authorized: true,
      tenantId: this.binding.tenantId,
      userId: this.binding.userId,
      grantedAt: now.toISOString(),
      revokedAt: null,
      emergencyStop: false,
      buildVersion,
      policyVersion: AUTO_SEND_POLICY_VERSION,
    }, this.binding);
    return this.autoSendExecutionConsent();
  }

  async revokeAutoSendExecutionConsent(now = new Date()) {
    if (!Number.isFinite(now.getTime())) throw new Error("The consent revocation time is invalid.");
    const previous = normalizeExecutionConsent(this.state.autoSendExecutionConsent, this.binding);
    this.state.autoSendExecutionConsent = {
      ...defaultExecutionConsent(this.binding),
      grantedAt: previous.grantedAt,
      revokedAt: now.toISOString(),
      emergencyStop: true,
      buildVersion: previous.buildVersion,
    };
    return this.autoSendExecutionConsent();
  }

  async chatStyle(chatId) {
    return structuredClone(normalizeChatStyle(this.state.chatStyles?.[chatId]));
  }

  async setChatStyle(chatId, input) {
    if (!String(chatId || "").trim()) throw new Error("A chat is required.");
    this.state.chatStyles[chatId] = normalizeChatStyle(input);
    return this.chatStyle(chatId);
  }

  async recordDraftFeedback(chatId, input, now = new Date()) {
    if (!String(chatId || "").trim() || !VALID_FEEDBACK.has(input?.reason)) throw new Error("Choose a valid feedback reason.");
    const record = { chatId, reason: input.reason, draftId: String(input.draftId || "").slice(0, 120), createdAt: now.toISOString() };
    this.state.draftFeedback.push(record);
    this.state.draftFeedback = this.state.draftFeedback.slice(-500);
    return record;
  }

  async recordPersonalizationOutcome(input, now = new Date()) {
    if (!VALID_PERSONALIZATION_OUTCOME.has(input?.outcome)) throw new Error("Choose a valid personalization outcome.");
    const { accountKey, personKey } = personalizationScope(input.accountScopeId, input.personId);
    const patternId = PATTERN_ID.test(String(input.patternId || "")) ? String(input.patternId) : null;
    const provenanceFingerprint = CONTENT_FINGERPRINT.test(String(input.provenanceFingerprint || "")) ? String(input.provenanceFingerprint) : null;
    const templateFingerprint = CONTENT_FINGERPRINT.test(String(input.templateFingerprint || "")) ? String(input.templateFingerprint) : null;
    const evidenceBound = Boolean(patternId && provenanceFingerprint && templateFingerprint);
    const parsedRatio = Number(input.editRatio);
    const editRatio = ["lightly-edited", "full-rewrite"].includes(input.outcome) && Number.isFinite(parsedRatio)
      ? Math.max(0, Math.min(1, Number(parsedRatio.toFixed(4))))
      : null;
    const draftKey = contentFreeKey("draft", accountKey, personKey, String(input.draftId || "anonymous-draft").slice(0, 240));
    const record = {
      accountKey,
      personKey,
      draftKey,
      outcome: input.outcome,
      patternId,
      provenanceFingerprint,
      templateFingerprint,
      evidenceBound,
      adjustment: evidenceBound ? personalizationOutcomeAdjustment(input.outcome) : 0,
      editRatio,
      createdAt: now.toISOString(),
    };
    this.state.personalizationOutcomes.push(record);
    this.state.personalizationOutcomes = this.state.personalizationOutcomes.slice(-MAX_PERSONALIZATION_OUTCOMES);
    if (input.outcome === "shown" && evidenceBound) {
      const usageKey = contentFreeKey("usage", draftKey, patternId, provenanceFingerprint, templateFingerprint);
      const existing = this.state.phraseUsage.find((usage) => usage.usageKey === usageKey);
      if (existing) existing.usedAt = now.toISOString();
      else this.state.phraseUsage.push({ accountKey, personKey, usageKey, patternId, provenanceFingerprint, templateFingerprint, usedAt: now.toISOString() });
      const matching = this.state.phraseUsage.filter((usage) => usage.accountKey === accountKey && usage.personKey === personKey)
        .sort((left, right) => String(right.usedAt).localeCompare(String(left.usedAt)));
      const allowed = new Set(matching.slice(0, MAX_RECENT_USAGE_PER_PERSON).map((usage) => usage.usageKey));
      this.state.phraseUsage = this.state.phraseUsage.filter((usage) => usage.accountKey !== accountKey || usage.personKey !== personKey || allowed.has(usage.usageKey)).slice(-MAX_PHRASE_USAGE);
    }
    return structuredClone(record);
  }

  async phraseSelectionSignals(accountScopeId, personId, now = new Date()) {
    const { accountKey, personKey } = personalizationScope(accountScopeId, personId);
    const usageCutoff = now.getTime() - 30 * 86_400_000;
    const feedbackCutoff = now.getTime() - 180 * 86_400_000;
    const usage = this.state.phraseUsage.filter((record) => record.accountKey === accountKey && record.personKey === personKey && Date.parse(record.usedAt || "") >= usageCutoff)
      .sort((left, right) => String(right.usedAt).localeCompare(String(left.usedAt))).slice(0, MAX_RECENT_USAGE_PER_PERSON);
    const latestByDraft = new Map();
    for (const record of this.state.personalizationOutcomes) {
      if (record.accountKey !== accountKey || record.personKey !== personKey || !record.evidenceBound || record.outcome === "shown" || Date.parse(record.createdAt || "") < feedbackCutoff) continue;
      const key = `${record.draftKey}\u001f${record.patternId}`;
      const existing = latestByDraft.get(key);
      if (!existing || String(record.createdAt).localeCompare(String(existing.createdAt)) >= 0) latestByDraft.set(key, record);
    }
    const feedbackSignals = [...latestByDraft.values()]
      .map((record) => ({ patternId: record.patternId, provenanceFingerprint: record.provenanceFingerprint, templateFingerprint: record.templateFingerprint, adjustment: record.adjustment }));
    return {
      recentPatternIds: usage.map((record) => record.patternId),
      recentTemplateFingerprints: usage.map((record) => record.templateFingerprint),
      feedbackSignals,
    };
  }

  async personalizationSummary(accountScopeId, personId) {
    const { accountKey, personKey } = personalizationScope(accountScopeId, personId);
    const outcomes = {};
    for (const record of this.state.personalizationOutcomes) {
      if (record.accountKey === accountKey && record.personKey === personKey) outcomes[record.outcome] = (outcomes[record.outcome] || 0) + 1;
    }
    return { outcomes, recentUsageCount: this.state.phraseUsage.filter((record) => record.accountKey === accountKey && record.personKey === personKey).length };
  }

  async modelUsageSummary(now = new Date()) {
    const day = now.toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    const records = Array.isArray(this.state.modelUsage) ? this.state.modelUsage : [];
    const summarize = (selected) => selected.reduce((total, record) => ({
      calls: total.calls + 1,
      inputTokens: total.inputTokens + Number(record.inputTokens || 0),
      cachedInputTokens: total.cachedInputTokens + Number(record.cachedInputTokens || 0),
      outputTokens: total.outputTokens + Number(record.outputTokens || 0),
      estimatedCostMicrousd: total.estimatedCostMicrousd + Number(record.estimatedCostMicrousd || 0),
    }), { calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, estimatedCostMicrousd: 0 });
    return {
      day: summarize(records.filter((record) => String(record.createdAt || "").startsWith(day))),
      month: summarize(records.filter((record) => String(record.createdAt || "").startsWith(month))),
    };
  }

  async recordModelUsage(input, now = new Date()) {
    const model = String(input?.model || "").trim().slice(0, 120);
    const route = String(input?.route || "standard").trim().slice(0, 40);
    const integer = (value, maximum = 10_000_000) => Math.max(0, Math.min(maximum, Math.floor(Number(value) || 0)));
    if (!model) throw new Error("A model name is required for usage accounting.");
    const record = {
      model,
      route,
      inputTokens: integer(input.inputTokens),
      cachedInputTokens: integer(input.cachedInputTokens),
      outputTokens: integer(input.outputTokens),
      estimatedCostMicrousd: integer(input.estimatedCostMicrousd, 1_000_000_000),
      createdAt: now.toISOString(),
    };
    this.state.modelUsage.push(record);
    const keepAfter = now.getTime() - 40 * 86_400_000;
    this.state.modelUsage = this.state.modelUsage.filter((item) => Date.parse(item.createdAt || "") >= keepAfter).slice(-10_000);
    return record;
  }

  async integrations() {
    return structuredClone(normalizeIntegrations(this.state.integrations));
  }

  async setIntegration(kind, payload) {
    if (!['contacts', 'calendar'].includes(kind) || payload?.kind !== kind) throw new Error("Choose a valid context source.");
    this.state.integrations = normalizeIntegrations({ ...this.state.integrations, [kind]: structuredClone(payload) });
    return structuredClone(this.state.integrations[kind]);
  }

  async removeIntegration(kind) {
    if (!['contacts', 'calendar'].includes(kind)) throw new Error("Choose a valid context source.");
    this.state.integrations = normalizeIntegrations({ ...this.state.integrations, [kind]: null });
    return { removed: true, kind };
  }

  async directConnections() {
    return structuredClone(normalizeConnections(this.state.connections));
  }

  async setDirectConnection(provider, payload) {
    if (provider !== "google" || payload?.provider !== provider) throw new Error("Choose a valid direct connection.");
    this.state.connections = normalizeConnections(this.state.connections);
    return null;
  }

  async removeDirectConnection(provider) {
    if (provider !== "google") throw new Error("Choose a valid direct connection.");
    this.state.connections = normalizeConnections({ ...this.state.connections, [provider]: null });
    if (this.state.integrations?.contacts?.origin === provider) this.state.integrations.contacts = null;
    if (this.state.integrations?.calendar?.origin === provider) this.state.integrations.calendar = null;
    return { removed: true, provider };
  }

  async reset() {
    this.state = emptyState(this.binding);
    return this.snapshot();
  }
}

export class FileUserStateStore extends MemoryUserStateStore {
  constructor(filePath, encryptionKey = null, binding = {}) {
    super(binding);
    this.filePath = filePath;
    this.encryptionKey = normalizedVaultKey(encryptionKey);
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const stored = JSON.parse(await readFile(this.filePath, "utf8"));
      const needsEncryptionMigration = Boolean(this.encryptionKey && stored?.schema !== VAULT_SCHEMA);
      const parsed = decryptState(stored, this.encryptionKey);
      const needsStateMigration = parsed?.schemaVersion !== 10
        || Boolean(completeStateBinding(this.binding) && !completeStateBinding(parsed?.binding))
        || Boolean(parsed?.connections?.google);
      const normalized = normalizedStoredState(parsed, this.binding);
      if (normalized) {
        this.state = normalized;
        if (needsEncryptionMigration || needsStateMigration) await this.persist();
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  async snapshot() {
    await this.load();
    return super.snapshot();
  }

  async preferences() {
    await this.load();
    return super.preferences();
  }

  async setTaskStatus(taskId, status, now = new Date(), options = {}) {
    await this.load();
    const result = await super.setTaskStatus(taskId, status, now, options);
    await this.persist();
    return result;
  }

  async setPreferences(input) {
    await this.load();
    const result = await super.setPreferences(input);
    await this.persist();
    return result;
  }

  async autoSendPolicy(input = {}) {
    await this.load();
    return super.autoSendPolicy(input);
  }

  async setAutoSendPolicyLayer(input, now = new Date()) {
    await this.load();
    const result = await super.setAutoSendPolicyLayer(input, now);
    await this.persist();
    return result;
  }

  async removeAutoSendPolicyLayer(layerKind, subjectId) {
    await this.load();
    const result = await super.removeAutoSendPolicyLayer(layerKind, subjectId);
    await this.persist();
    return result;
  }

  async autoSendExecutionConsent() {
    await this.load();
    return super.autoSendExecutionConsent();
  }

  async grantAutoSendExecutionConsent(input, now = new Date()) {
    await this.load();
    const result = await super.grantAutoSendExecutionConsent(input, now);
    await this.persist();
    return result;
  }

  async revokeAutoSendExecutionConsent(now = new Date()) {
    await this.load();
    const result = await super.revokeAutoSendExecutionConsent(now);
    await this.persist();
    return result;
  }

  async setDecisionStatus(decisionId, status, now = new Date()) {
    await this.load();
    const result = await super.setDecisionStatus(decisionId, status, now);
    await this.persist();
    return result;
  }

  async chatStyle(chatId) {
    await this.load();
    return super.chatStyle(chatId);
  }

  async setChatStyle(chatId, input) {
    await this.load();
    const result = await super.setChatStyle(chatId, input);
    await this.persist();
    return result;
  }

  async recordDraftFeedback(chatId, input, now = new Date()) {
    await this.load();
    const result = await super.recordDraftFeedback(chatId, input, now);
    await this.persist();
    return result;
  }

  async recordPersonalizationOutcome(input, now = new Date()) {
    await this.load();
    const result = await super.recordPersonalizationOutcome(input, now);
    await this.persist();
    return result;
  }

  async phraseSelectionSignals(accountScopeId, personId, now = new Date()) {
    await this.load();
    return super.phraseSelectionSignals(accountScopeId, personId, now);
  }

  async personalizationSummary(accountScopeId, personId) {
    await this.load();
    return super.personalizationSummary(accountScopeId, personId);
  }

  async modelUsageSummary(now = new Date()) {
    await this.load();
    return super.modelUsageSummary(now);
  }

  async recordModelUsage(input, now = new Date()) {
    await this.load();
    const result = await super.recordModelUsage(input, now);
    await this.persist();
    return result;
  }

  async integrations() {
    await this.load();
    return super.integrations();
  }

  async setIntegration(kind, payload) {
    await this.load();
    const result = await super.setIntegration(kind, payload);
    await this.persist();
    return result;
  }

  async removeIntegration(kind) {
    await this.load();
    const result = await super.removeIntegration(kind);
    await this.persist();
    return result;
  }

  async directConnections() {
    await this.load();
    return super.directConnections();
  }

  async setDirectConnection(provider, payload) {
    await this.load();
    const result = await super.setDirectConnection(provider, payload);
    await this.persist();
    return result;
  }

  async removeDirectConnection(provider) {
    await this.load();
    const result = await super.removeDirectConnection(provider);
    await this.persist();
    return result;
  }

  async reset() {
    await this.load();
    await super.reset();
    await this.persist();
    return this.snapshot();
  }

  async persist() {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    const serialized = this.encryptionKey ? encryptState(this.state, this.encryptionKey) : JSON.stringify(this.state, null, 2);
    await writeFile(temporary, serialized, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, this.filePath);
  }
}

export class SqliteUserStateStore extends FileUserStateStore {
  constructor(databasePath, encryptionKey, tenantId, legacyFilePath = null, authenticatedUserId = null, legacyDatabasePath = null) {
    const binding = normalizeStateBinding({ tenantId, userId: authenticatedUserId });
    super(databasePath, encryptionKey, binding);
    this.databasePath = databasePath;
    this.tenantId = String(tenantId || "").trim();
    this.authenticatedUserId = String(authenticatedUserId || "").trim();
    this.legacyFilePath = legacyFilePath;
    this.legacyDatabasePath = legacyDatabasePath;
    this.database = null;
    if (!TENANT_ID.test(this.tenantId)) throw new Error("Workspace state requires a verified tenant identifier.");
    if (this.authenticatedUserId && !USER_ID.test(this.authenticatedUserId)) throw new Error("Workspace state requires a verified authenticated user identifier.");
  }

  async loadLegacyDatabase() {
    if (!this.legacyDatabasePath || this.legacyDatabasePath === this.databasePath) return null;
    try {
      await access(this.legacyDatabasePath);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    const legacy = new DatabaseSync(this.legacyDatabasePath);
    let transactionOpen = false;
    try {
      legacy.exec("BEGIN IMMEDIATE");
      transactionOpen = true;
      const tenantId = legacy.prepare("SELECT value FROM metadata WHERE key='tenant_id'").get()?.value;
      if (tenantId !== this.tenantId) throw new Error("The legacy workspace state belongs to a different tenant.");
      const boundUser = legacy.prepare("SELECT value FROM metadata WHERE key='authenticated_user_id'").get()?.value;
      const migratedUser = legacy.prepare("SELECT value FROM metadata WHERE key='migrated_to_authenticated_user_id'").get()?.value;
      if ((boundUser && boundUser !== this.authenticatedUserId) || (migratedUser && migratedUser !== this.authenticatedUserId)) {
        legacy.exec("ROLLBACK");
        transactionOpen = false;
        return null;
      }
      const row = legacy.prepare("SELECT envelope FROM workspace_state WHERE singleton=1").get();
      if (!row?.envelope) {
        legacy.exec("ROLLBACK");
        transactionOpen = false;
        return null;
      }
      const parsed = decryptState(JSON.parse(row.envelope), this.encryptionKey);
      const normalized = normalizedStoredState(parsed, this.binding);
      if (!normalized) throw new Error("The legacy workspace state is invalid.");
      legacy.prepare("INSERT INTO metadata(key,value) VALUES('migrated_to_authenticated_user_id',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .run(this.authenticatedUserId);
      legacy.exec("COMMIT");
      transactionOpen = false;
      return normalized;
    } catch (error) {
      if (transactionOpen) {
        try { legacy.exec("ROLLBACK"); } catch {}
      }
      throw error;
    } finally {
      legacy.close();
    }
  }

  openDatabase() {
    if (this.database) return this.database;
    this.database = new DatabaseSync(this.databasePath);
    this.database.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS workspace_state(singleton INTEGER PRIMARY KEY CHECK(singleton=1),envelope TEXT NOT NULL,updated_at TEXT NOT NULL);");
    const bound = this.database.prepare("SELECT value FROM metadata WHERE key='tenant_id'").get()?.value;
    if (bound && bound !== this.tenantId) throw new Error("This workspace database belongs to a different tenant.");
    if (!bound) this.database.prepare("INSERT INTO metadata(key,value) VALUES('tenant_id',?)").run(this.tenantId);
    const boundUser = this.database.prepare("SELECT value FROM metadata WHERE key='authenticated_user_id'").get()?.value;
    if (boundUser && this.authenticatedUserId && boundUser !== this.authenticatedUserId) throw new Error("This workspace database belongs to a different authenticated user.");
    if (!boundUser && this.authenticatedUserId) this.database.prepare("INSERT INTO metadata(key,value) VALUES('authenticated_user_id',?)").run(this.authenticatedUserId);
    this.database.prepare("INSERT INTO metadata(key,value) VALUES('schema','mycrobo-workspace-state.1') ON CONFLICT(key) DO NOTHING").run();
    return this.database;
  }

  async load() {
    if (this.loaded) return;
    this.loaded = true;
    await mkdir(dirname(this.databasePath), { recursive: true });
    const database = this.openDatabase();
    const row = database.prepare("SELECT envelope FROM workspace_state WHERE singleton=1").get();
    if (row?.envelope) {
      const stored = JSON.parse(row.envelope);
      const parsed = decryptState(stored, this.encryptionKey);
      const normalized = normalizedStoredState(parsed, this.binding);
      if (!normalized) throw new Error("The tenant workspace state is invalid.");
      this.state = normalized;
      if (parsed?.schemaVersion !== 10) await this.persist();
      return;
    }
    const legacyDatabaseState = await this.loadLegacyDatabase();
    if (legacyDatabaseState) {
      this.state = legacyDatabaseState;
      await this.persist();
      return;
    }
    if (this.legacyFilePath) {
      try {
        const stored = JSON.parse(await readFile(this.legacyFilePath, "utf8"));
        const parsed = decryptState(stored, this.encryptionKey);
        const normalized = normalizedStoredState(parsed, this.binding);
        if (normalized) this.state = normalized;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    await this.persist();
  }

  async persist() {
    await mkdir(dirname(this.databasePath), { recursive: true });
    const database = this.openDatabase();
    const serialized = this.encryptionKey ? encryptState(this.state, this.encryptionKey) : JSON.stringify(this.state);
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare("INSERT INTO workspace_state(singleton,envelope,updated_at) VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET envelope=excluded.envelope,updated_at=excluded.updated_at")
        .run(serialized, new Date().toISOString());
      database.exec("COMMIT");
    } catch (error) {
      try { database.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }
}

export function createUserStateStoreFromEnv(environment = process.env) {
  const explicit = String(environment.MYCROBO_USER_STATE_FILE || "").trim();
  const dataDir = String(environment.MYCROBO_USER_DATA_DIR || "").trim();
  const binding = { tenantId: environment.MYCROBO_TENANT_ID, userId: environment.MYCROBO_AUTH_USER_ID };
  if (explicit) return new FileUserStateStore(explicit, environment.MYCROBO_USER_STATE_KEY || null, binding);
  if (dataDir) {
    if (!TENANT_ID.test(String(environment.MYCROBO_TENANT_ID || ""))) throw new Error("Workspace state requires a verified tenant identifier.");
    if (!USER_ID.test(String(environment.MYCROBO_AUTH_USER_ID || ""))) throw new Error("Workspace state requires a verified authenticated user identifier.");
    const authenticatedUserId = String(environment.MYCROBO_AUTH_USER_ID);
    return new SqliteUserStateStore(
      join(dataDir, "users", authenticatedUserId, "workspace.db"),
      environment.MYCROBO_USER_STATE_KEY || null,
      environment.MYCROBO_TENANT_ID,
      join(dataDir, "user-state.json"),
      authenticatedUserId,
      join(dataDir, "workspace.db"),
    );
  }
  return new MemoryUserStateStore();
}
