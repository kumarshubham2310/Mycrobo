import { createServer } from "node:http";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { open, readFile, stat, unlink } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chats, messagesByChat } from "./fixture-data.mjs";
import { decideReply, isDisplayableEvent, isHumanText, latestVerifiedHumanMessage } from "../../packages/core/conversation.ts";
import { buildDraftContext, unresolvedDraftPlaceholders, validateDraftOutput } from "../../packages/core/draft.ts";
import { detectWritingMode } from "../../packages/core/relationship.ts";
import { classifyDraftEditOutcome } from "../../packages/core/personalization-learning.ts";
import { evaluateAutoSendPolicy } from "../../packages/core/auto-send-policy.ts";
import { createDraftProviderFromEnv } from "./draft-provider.mjs";
import { createBridgeSourceFromEnv } from "./bridge-source.mjs";
import { buildFollowUpItems, buildPendingItems, buildTaskItems } from "./workspace-items.mjs";
import { AUTO_SEND_EXECUTION_CONSENT_VERSION, AUTO_SEND_POLICY_VERSION, createUserStateStoreFromEnv } from "./user-state.mjs";
import { buildCommunicationDNA, buildSyncTruth, buildVerifiedContext } from "./product-intelligence.mjs";
import { authorizeGatewayRequest, authorizeSendBroker, contentFreeAuditRecord, createOperationsLogger, createRequestLimiter, opaqueCorrelationId } from "./runtime-security.mjs";
import { calendarContextForText, contactForChat, enrichChatIdentity, importContextSource, integrationStatus } from "./context-sources.mjs";
import { createGoogleContextConnectorFromEnv } from "./google-context-connector.mjs";
import { createLocalTranslatorFromEnv } from "./local-translator.mjs";
import { createTenantUsageMeterFromEnv } from "./usage-meter.mjs";
import { assertContentFreeHistoryTruth, contentFreeHistoryTruth } from "./history-diagnostics.mjs";
import { closeGatewayWhenParentExits } from "./parent-watchdog.mjs";
import { authorizeGatewayCapability, normalizeGatewayRole, roleAllowsGatewayCapability } from "./gateway-authorization.mjs";
import { AUTO_SEND_BUILD_CERTIFICATION_CONTRACT, autoSendBuildCertificationDigest, createGatewayAutoSendRuntime } from "./auto-send-gateway-runtime.mjs";
import { createBridgeAutoSendDeliveryBoundary } from "./auto-send-bridge-delivery.mjs";
import { AUTO_SEND_DURABLE_STORAGE_BINDING, AUTO_SEND_SAFETY_BINDING_CONTRACT, readAutoSendHostBootstrapFromFd } from "./auto-send-host-bootstrap.mjs";
import { createRequire } from "node:module";

const esmRequire = createRequire(import.meta.url);
let ControlPlane = null;
try {
  ({ ControlPlane } = esmRequire("../../desktop/electron/control-plane.cjs"));
} catch {}

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(here, "..", "..", "apps", "client");
const DRAFT_CURRENT_STORY_LIMIT = 2_500;
const DRAFT_RELATIONSHIP_EVIDENCE_LIMIT = 6_000;
const DRAFT_TRANSLATION_BUDGET_MS = 750;

function elapsedMs(startedAt) {
  return Number((performance.now() - startedAt).toFixed(1));
}

function sourceIdsFromState(state = {}) {
  return new Set([
    ...(state.open_questions || []),
    ...(state.commitments || []),
    ...(state.recent_facts || []),
  ].map((item) => item?.provenance?.source_message_id).filter(Boolean));
}

export function boundedCurrentStory(events = [], conversationState = null, targetMessageId = "") {
  if (events.length <= DRAFT_CURRENT_STORY_LIMIT) return events;
  const required = sourceIdsFromState(conversationState || {});
  if (targetMessageId) required.add(targetMessageId);
  const recent = events.slice(-DRAFT_CURRENT_STORY_LIMIT);
  const selected = new Map(recent.map((event) => [event.id, event]));
  for (const event of events) if (required.has(event?.id)) selected.set(event.id, event);
  return events.filter((event) => selected.has(event?.id));
}

export function boundedToneContext(toneContext = {}, currentChat = {}) {
  const events = Array.isArray(toneContext.events) ? toneContext.events : [];
  const chats = Array.isArray(toneContext.chats) ? toneContext.chats : [];
  if (events.length <= DRAFT_RELATIONSHIP_EVIDENCE_LIMIT) return { ...toneContext, events, chats };
  const currentPeople = new Set(currentChat.participantIds || []);
  const relatedChats = new Set(chats
    .filter((chat) => (chat.participantIds || []).some((personId) => currentPeople.has(personId)))
    .map((chat) => chat.id));
  const related = events.filter((event) => relatedChats.has(event?.chatId)).slice(-4_000);
  const remaining = events.filter((event) => !relatedChats.has(event?.chatId)).slice(-2_000);
  const selected = new Set([...related, ...remaining]);
  const boundedEvents = events.filter((event) => selected.has(event));
  const usedChatIds = new Set(boundedEvents.map((event) => event?.chatId).filter(Boolean));
  return {
    ...toneContext,
    events: boundedEvents,
    chats: chats.filter((chat) => usedChatIds.has(chat.id)).slice(-1_000),
    runtimeEvidenceBounded: true,
  };
}

async function filePrefix(path, length = 16) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function legacyRecoveryStatus(dataDir) {
  if (!dataDir) return { available: false, removable: false, bytes: 0, files: [] };
  const files = [];
  for (const name of ["messages.db", "linked-device.db"]) {
    const source = join(dataDir, name);
    const vault = join(dataDir, name.replace(/\.db$/u, ".vault.db"));
    try {
      const [sourceInfo, sourcePrefix, vaultPrefix] = await Promise.all([stat(source), filePrefix(source), filePrefix(vault)]);
      const sourcePlaintext = sourcePrefix.toString("ascii") === "SQLite format 3\u0000";
      const vaultEncrypted = vaultPrefix.toString("ascii") !== "SQLite format 3\u0000";
      if (sourcePlaintext && vaultEncrypted) files.push({ name, path: source, bytes: sourceInfo.size });
    } catch { /* absent or incomplete migrations are never presented as removable */ }
  }
  return { available: files.length > 0, removable: files.length > 0, bytes: files.reduce((total, file) => total + file.bytes, 0), files };
}

function json(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function oauthResult(response, success, message, failureStatus = 400) {
  const safe = String(message || "").replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  response.writeHead(success ? 200 : failureStatus, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'" });
  response.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>MyCrobo connection</title><style>body{min-height:100vh;margin:0;display:grid;place-items:center;font:16px system-ui;background:#f3f7f4;color:#10251d}.card{width:min(520px,calc(100% - 40px));padding:32px;border:1px solid #d7e4dc;border-radius:22px;background:#fff;box-shadow:0 20px 55px #163d2c18}b{display:block;font-size:24px}p{color:#617269;line-height:1.55}</style><div class="card"><b>${success ? "Google is connected" : "Connection not completed"}</b><p>${safe}</p><p>You can close this window and return to MyCrobo.</p></div>`);
}

function materializeEvents(chatId) {
  return (messagesByChat[chatId] ?? []).map((event) => ({
    ...event,
    chatId,
    connectorMessageId: event.id,
    senderId: event.direction === "owner" ? "owner" : event.direction === "contact" ? `${chatId}:contact` : null,
  }));
}

function outboundInput(input) {
  const body = typeof input.body === "string" ? input.body : "";
  const targetMessageId = typeof input.targetMessageId === "string" ? input.targetMessageId.trim() : "";
  const idempotencyKey = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  const approvalToken = typeof input.approvalToken === "string" ? input.approvalToken : "";
  if (!body.trim() || [...body].length > 800 || !targetMessageId || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
    throw new Error("Exact reply text, latest message and send-attempt key are required.");
  }
  if (unresolvedDraftPlaceholders(body).length) {
    throw new Error("Complete the missing current fact before sending.");
  }
  return { body, targetMessageId, idempotencyKey, approvalToken };
}

async function generateDraftForRequest(provider, input, context, request, response) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const close = () => { if (!response.writableEnded) controller.abort(); };
  request.once("aborted", abort);
  response.once("close", close);
  try {
    if (input.localOnly === true) {
      if (typeof provider.generateLocal !== "function") throw new Error("The immediate private draft is unavailable in this build.");
      return await provider.generateLocal(context, { signal: controller.signal });
    }
    return await provider.generate(context, { signal: controller.signal });
  } finally {
    request.off("aborted", abort);
    response.off("close", close);
  }
}

function canonicalChatOf(chat) {
  return {
    id: chat.id,
    connector: "fixture",
    connectorIds: [chat.id],
    title: chat.title,
    collection: chat.collection,
    kind: chat.kind,
    participantIds: ["owner", `${chat.id}:contact`],
  };
}

function viewOfChat(chat) {
  const events = materializeEvents(chat.id);
  const latest = latestVerifiedHumanMessage(events);
  const watermark = {
    chatId: chat.id,
    state: chat.history.state,
    reachedBeginning: chat.history.reachedBeginning,
    oldestTimestampMs: events[0]?.timestampMs ?? null,
    newestTimestampMs: events.at(-1)?.timestampMs ?? null,
    messageCount: events.length,
    cursor: null,
    reason: chat.history.reachedBeginning ? "beginning-reached" : "connector-partial",
    verifiedAt: chat.latestVerifiedAt,
  };
  const canonicalChat = canonicalChatOf(chat);
  return {
    ...chat,
    latest,
    watermark,
    reply: decideReply({ chat: canonicalChat, events, watermark, ownerIds: ["owner"] }),
  };
}

async function readJSON(request, maximumBytes = 32_768) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > maximumBytes) throw new Error("Request is too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function assertInputKeys(input, allowed) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("A JSON object is required.");
  const unexpected = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new Error("One or more automatic delivery fields are not supported.");
}

export async function refreshGoogleWhenStale({ googleConnector, sync, nowMs = Date.now(), minimumAgeMs = 15 * 60_000 } = {}) {
  if (!googleConnector?.status || typeof sync !== "function") return false;
  const connection = await googleConnector.status();
  const lastSync = Date.parse(connection?.lastSyncedAt || "");
  if (connection?.connected !== true || (Number.isFinite(lastSync) && nowMs - lastSync < minimumAgeMs)) return false;
  await sync();
  return true;
}

export function createGatewayServer(options = {}) {
  const userStateStore = options.userStateStore || createUserStateStoreFromEnv();
  const userDataDir = options.userDataDir ?? process.env.MYCROBO_USER_DATA_DIR ?? "";
  const controlPlaneDir = options.controlPlaneDir
    || process.env.MYCROBO_CONTROL_PLANE_DIR
    || (userDataDir ? dirname(userDataDir) : null);
  let controlPlane = options.controlPlane || null;
  if (!controlPlane && ControlPlane && controlPlaneDir) {
    try {
      controlPlane = new ControlPlane(controlPlaneDir);
    } catch {
      controlPlane = null;
    }
  }
  const tenantId = String(options.tenantId ?? process.env.MYCROBO_TENANT_ID ?? "").trim();
  const ownerBindingFile = userDataDir ? join(userDataDir, "whatsapp-owner.json") : null;
  let inMemoryWhatsAppOwner = null;

  function getWhatsAppOwner() {
    if (inMemoryWhatsAppOwner) return inMemoryWhatsAppOwner;
    if (ownerBindingFile && existsSync(ownerBindingFile)) {
      try {
        const data = JSON.parse(readFileSync(ownerBindingFile, "utf8"));
        if (data?.tenantId) {
          inMemoryWhatsAppOwner = data;
          return inMemoryWhatsAppOwner;
        }
      } catch {}
    }
    return null;
  }

  function setWhatsAppOwner(newTenantId, newUserId) {
    if (!newTenantId) return;
    inMemoryWhatsAppOwner = {
      tenantId: newTenantId,
      userId: newUserId || null,
      boundAt: new Date().toISOString(),
    };
    if (ownerBindingFile) {
      try {
        writeFileSync(ownerBindingFile, JSON.stringify(inMemoryWhatsAppOwner, null, 2), "utf8");
      } catch {}
    }
  }

  function clearWhatsAppOwner() {
    inMemoryWhatsAppOwner = null;
    if (ownerBindingFile && existsSync(ownerBindingFile)) {
      try { unlinkSync(ownerBindingFile); } catch {}
    }
  }
  const authenticatedUserId = String(options.authenticatedUserId ?? process.env.MYCROBO_AUTH_USER_ID ?? "").trim();
  const trustedBuildVersion = String(options.buildVersion ?? process.env.MYCROBO_BUILD_VERSION ?? "development").trim().slice(0, 120) || "development";
  const configuredSubjectKey = options.autoSendSubjectKey ?? process.env.MYCROBO_USER_STATE_KEY ?? "";
  const autoSendSubjectKey = configuredSubjectKey
    ? Buffer.isBuffer(configuredSubjectKey)
      ? configuredSubjectKey
      : Buffer.from(String(configuredSubjectKey), "utf8")
    : !tenantId && !authenticatedUserId
      ? Buffer.from("mycrobo-development-policy-subjects-only", "utf8")
      : null;
  const draftProvider = options.draftProvider === undefined
    ? createDraftProviderFromEnv(process.env, { usageStore: userStateStore })
    : options.draftProvider;
  const bridgeSource = options.bridgeSource === undefined
    ? createBridgeSourceFromEnv()
    : options.bridgeSource;
  const googleConnector = options.googleConnector || createGoogleContextConnectorFromEnv({
    ...process.env,
    MYCROBO_TENANT_ID: tenantId,
    MYCROBO_AUTH_USER_ID: authenticatedUserId,
    MYCROBO_USER_DATA_DIR: userDataDir,
  });
  const translator = options.translator === undefined
    ? createLocalTranslatorFromEnv(process.env)
    : options.translator;
  const usageMeter = options.usageMeter || createTenantUsageMeterFromEnv(process.env);
  const suppliedHostBootstrap = options.autoSendHostBootstrap;
  const hostBootstrap = suppliedHostBootstrap
    && suppliedHostBootstrap.tenantId === tenantId
    && suppliedHostBootstrap.userId === authenticatedUserId
    && suppliedHostBootstrap.buildVersion === trustedBuildVersion
    && suppliedHostBootstrap.policyVersion === AUTO_SEND_POLICY_VERSION
    && suppliedHostBootstrap.buildCertification?.contract === AUTO_SEND_BUILD_CERTIFICATION_CONTRACT
    && suppliedHostBootstrap.buildCertification?.certified === true
    && suppliedHostBootstrap.buildCertification?.buildVersion === trustedBuildVersion
    && suppliedHostBootstrap.buildCertification?.policyVersion === AUTO_SEND_POLICY_VERSION
    && suppliedHostBootstrap.buildCertification?.bindingDigest === autoSendBuildCertificationDigest(trustedBuildVersion)
    && suppliedHostBootstrap.durableStorage === AUTO_SEND_DURABLE_STORAGE_BINDING
    && suppliedHostBootstrap.safetyBinding?.contract === AUTO_SEND_SAFETY_BINDING_CONTRACT
    && ["disabled", "always-block"].includes(suppliedHostBootstrap.safetyBinding?.quietHoursMode)
    && suppliedHostBootstrap.safetyBinding?.mediaAssessmentMode === "block-unverified"
    && suppliedHostBootstrap.safetyBinding?.customRules === "disabled"
    && Buffer.byteLength(String(suppliedHostBootstrap.signingSecret || ""), "utf8") >= 32
    ? suppliedHostBootstrap
    : null;
  let hostDeliveryBoundary = null;
  if (hostBootstrap) {
    try {
      hostDeliveryBoundary = createBridgeAutoSendDeliveryBoundary({
        bridgeSource,
        expectedAccountId: hostBootstrap.accountId,
      });
    } catch { /* incomplete production delivery wiring remains disabled */ }
  }
  const hostSafetyAuthorities = hostBootstrap
    ? async () => Object.freeze({
        quietHours: Object.freeze({ active: hostBootstrap.safetyBinding?.quietHoursMode !== "disabled" }),
        mediaAssessments: Object.freeze([]),
        customRuleId: undefined,
        customRulePassed: false,
      })
    : null;
  const autoSendRuntime = createGatewayAutoSendRuntime({
    executionEnabled: hostBootstrap ? true : options.autoSendExecutionEnabled === true,
    buildVersion: trustedBuildVersion,
    buildCertification: hostBootstrap?.buildCertification || options.autoSendBuildCertification,
    tenantId,
    userId: authenticatedUserId,
    accountId: String(hostBootstrap?.accountId || options.autoSendAccountId || "").trim(),
    dataDir: hostBootstrap ? join(userDataDir, "auto-send") : options.autoSendDataDir,
    signingSecret: hostBootstrap?.signingSecret || options.autoSendSigningSecret,
    deliveryBoundary: hostBootstrap ? hostDeliveryBoundary : options.autoSendDeliveryBoundary,
    loadSafetyAuthorities: hostBootstrap ? hostSafetyAuthorities : options.autoSendSafetyAuthorities,
    countdownMs: options.autoSendCountdownMs,
    clock: options.autoSendClock,
  });
  const tenantAccountScope = (accountScopeId) => tenantId
    ? `tenant:${tenantId}\u001faccount:${String(accountScopeId || "").trim()}`
    : String(accountScopeId || "").trim();
  const tenantExportTag = tenantId ? createHash("sha256").update(tenantId).digest("hex").slice(0, 10) : "development";

  function autoSendSubjectId(kind, value) {
    if (!autoSendSubjectKey || !String(value || "").trim()) throw new Error("Automatic delivery policy subjects are unavailable for this authenticated workspace.");
    return createHmac("sha256", autoSendSubjectKey)
      .update(AUTO_SEND_POLICY_VERSION)
      .update("\u001f")
      .update(tenantId || "development-tenant")
      .update("\u001f")
      .update(authenticatedUserId || "development-user")
      .update("\u001f")
      .update(String(kind))
      .update("\u001f")
      .update(String(value))
      .digest("hex");
  }
  const securityPolicy = {
    token: options.gatewayToken ?? process.env.MYCROBO_GATEWAY_TOKEN ?? "",
    windowToken: options.windowToken ?? process.env.MYCROBO_WINDOW_TOKEN ?? "",
    allowedHost: options.allowedHost ?? process.env.MYCROBO_ALLOWED_HOST ?? "",
    allowedOrigin: options.allowedOrigin ?? process.env.MYCROBO_GATEWAY_ORIGIN ?? "",
    sendBrokerToken: options.sendBrokerToken ?? process.env.MYCROBO_SEND_BROKER_TOKEN ?? "",
  };
  // This identity comes only from the trusted Electron launch environment (or
  // an explicit server-construction option in tests). Renderer headers and JSON
  // fields can never choose or elevate the gateway role.
  const authenticatedRole = normalizeGatewayRole(options.authRole ?? process.env.MYCROBO_AUTH_ROLE ?? "");
  const requestLimiter = options.requestLimiter || createRequestLimiter();
  const oauthCallbackLimiter = options.oauthCallbackLimiter || createRequestLimiter({ readLimit: 20, writeLimit: 20, windowMs: 60_000 });
  const auditLogger = typeof options.auditLogger === "function"
    ? options.auditLogger
    : createOperationsLogger(process.env.MYCROBO_USER_DATA_DIR ? join(process.env.MYCROBO_USER_DATA_DIR, "diagnostics", "operations.jsonl") : "");
  let googleSyncPromise = null;
  const draftLearningLedger = new Map();

  function draftPersonId(chat, events = [], ownerIds = []) {
    return (chat?.participantIds || []).find((id) => id && !ownerIds.includes(id))
      || [...events].reverse().find((event) => event?.direction === "contact" && event?.senderId)?.senderId
      || `chat:${chat?.id || "unknown"}:contact`;
  }

  function exactIncomingTurn(events, targetMessageId) {
    const ordered = [...(events || [])]
      .filter((event) => event?.timestampVerified && event?.timestampMs !== null && typeof event?.text === "string")
      .sort((left, right) => left.timestampMs - right.timestampMs || (left.sequence || 0) - (right.sequence || 0));
    const targetIndex = ordered.findIndex((event) => event.id === targetMessageId);
    if (targetIndex < 0 || ordered[targetIndex]?.direction !== "contact") return "";
    let start = targetIndex;
    while (start > 0 && ordered[start - 1]?.direction === "contact" && ordered[start].timestampMs - ordered[start - 1].timestampMs <= 30 * 60_000) start -= 1;
    return ordered.slice(start, targetIndex + 1).map((event) => event.text).join("\n");
  }

  async function localSemanticTranslation(events, targetMessageId) {
    const translatorStatus = translator?.status?.();
    // Loading a 4B local model can take minutes and inference may take tens of
    // seconds on a CPU. Translation is optional semantic enrichment, so a
    // user-facing draft never starts or waits for a cold worker.
    if (!translator?.translate || translatorStatus?.enabled !== true || translatorStatus?.runtime !== "ready") return null;
    const text = exactIncomingTurn(events, targetMessageId);
    const sourceLanguage = detectWritingMode(text);
    const sourceLangCode = ["Hindi", "Roman Hindi"].includes(sourceLanguage)
      ? "hi"
      : ["Gujarati", "Roman Gujarati"].includes(sourceLanguage)
        ? "gu"
        : null;
    if (!sourceLangCode) return null;
    try {
      usageMeter.assertAvailable("translations");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DRAFT_TRANSLATION_BUDGET_MS);
      timer.unref?.();
      const result = await translator.translate(
        { tenantId, text, sourceLangCode, targetLangCode: "en", maxNewTokens: 256 },
        { signal: controller.signal },
      ).finally(() => clearTimeout(timer));
      if (result?.applied !== true || !String(result.text || "").trim()) return null;
      usageMeter.record("translations");
      return { sourceLanguage, translatedText: result.text };
    } catch {
      // Translation is a semantic enhancement, never a drafting availability
      // dependency. The original message remains the authoritative text.
      return null;
    }
  }

  function pruneDraftLearningLedger(nowMs = Date.now()) {
    const cutoff = nowMs - 30 * 60_000;
    for (const [id, record] of draftLearningLedger) if (record.createdAtMs < cutoff) draftLearningLedger.delete(id);
    while (draftLearningLedger.size > 500) draftLearningLedger.delete(draftLearningLedger.keys().next().value);
  }

  async function registerShownPattern({ context, generated, accountScopeId, personId, chatId }) {
    const binding = generated?.phrasePatternBinding;
    if (!binding || !accountScopeId || !personId) return null;
    pruneDraftLearningLedger();
    const draftId = randomUUID();
    const record = {
      draftId,
      chatId,
      accountScopeId,
      personId,
      patternId: binding.patternId,
      provenanceFingerprint: binding.phraseProvenanceFingerprint,
      templateFingerprint: binding.phraseTemplateFingerprint,
      targetMessageId: context.freshness.targetMessageId,
      createdAtMs: Date.now(),
    };
    draftLearningLedger.set(draftId, record);
    try {
      await userStateStore.recordPersonalizationOutcome({ ...record, outcome: "shown" });
    } catch {
      draftLearningLedger.delete(draftId);
      return null;
    }
    return draftId;
  }

  async function saveGoogleResult(result) {
    if (result.calendar) await userStateStore.setIntegration("calendar", result.calendar);
    return result.connection;
  }

  async function syncGoogle() {
    if (googleSyncPromise) return googleSyncPromise;
    googleSyncPromise = (async () => {
      return saveGoogleResult(await googleConnector.sync());
    })();
    try { return await googleSyncPromise; } finally { googleSyncPromise = null; }
  }

  async function workspaceItems() {
    if (bridgeSource?.workspace) return bridgeSource.workspace();
    return chats.map((chat) => {
      const view = viewOfChat(chat);
      return {
        chat: canonicalChatOf(chat),
        latest: materializeEvents(chat.id).at(-1) || view.latest,
        state: { chat_id: chat.id, updated_at: chat.latestVerifiedAt, commitments: [] },
      };
    });
  }

  async function workspacePayload() {
    const [items, saved] = await Promise.all([workspaceItems(), userStateStore.snapshot()]);
    return {
      pending: buildPendingItems(items).filter((item) => saved.decisions?.[item.id]?.status !== "dismissed"),
      tasks: buildTaskItems(items, saved),
      followUps: buildFollowUpItems(items, saved),
      generatedAt: new Date().toISOString(),
    };
  }

  async function syncTruthPayload() {
    if (!bridgeSource) {
      const active = chats.filter((chat) => chat.collection === "active").map(viewOfChat);
      const archived = chats.filter((chat) => chat.collection === "archived").map(viewOfChat);
      return buildSyncTruth({ status: { connected: true, connectionState: "fixture" }, active, archived });
    }
    const [status, active, archived, storage] = await Promise.all([
      bridgeSource.status(),
      bridgeSource.listChats("active"),
      bridgeSource.listChats("archived"),
      typeof bridgeSource.storage === "function" ? bridgeSource.storage().catch(() => null) : Promise.resolve(null),
    ]);
    return buildSyncTruth({ status, active, archived, storage });
  }

  async function intelligencePayload(chatId) {
    const imported = await userStateStore.integrations();
    if (bridgeSource) {
      const [bundle, conversationState, allEvents, style] = await Promise.all([
        bridgeSource.bundle(chatId),
        bridgeSource.conversationState ? bridgeSource.conversationState(chatId) : Promise.resolve(null),
        bridgeSource.toneEvents(chatId),
        userStateStore.chatStyle(chatId),
      ]);
      const latest = latestVerifiedHumanMessage(bundle.events);
      const contact = contactForChat(bundle.chat, imported.contacts);
      return {
        context: buildVerifiedContext(bundle, conversationState),
        dna: buildCommunicationDNA(bundle.chat, bundle.events, allEvents),
        style,
        externalContext: {
          contact: contact ? { resolved: true, displayName: contact.displayName } : { resolved: false },
          calendar: calendarContextForText(latest?.text || "", imported.calendar),
        },
      };
    }
    const chat = chats.find((item) => item.id === chatId);
    if (!chat) throw new Error("Chat not found.");
    const canonical = canonicalChatOf(chat);
    const events = materializeEvents(chat.id);
    const view = viewOfChat(chat);
    const contact = contactForChat(canonical, imported.contacts);
    return {
      context: buildVerifiedContext({ ...view, events }, null),
      dna: buildCommunicationDNA(canonical, events, events),
      style: await userStateStore.chatStyle(chatId),
      externalContext: {
        contact: contact ? { resolved: true, displayName: contact.displayName } : { resolved: false },
        calendar: calendarContextForText(latestVerifiedHumanMessage(events)?.text || "", imported.calendar),
      },
    };
  }

  async function autoSendSubjectsForChat(chatId) {
    if (bridgeSource) {
      const bundle = await bridgeSource.bundle(chatId);
      const ownerIds = Array.isArray(bundle.ownerIds) && bundle.ownerIds.length ? bundle.ownerIds : ["owner"];
      const personId = bundle.chat?.kind === "direct" ? draftPersonId(bundle.chat, bundle.events, ownerIds) : null;
      return {
        chatSubjectId: autoSendSubjectId("chat", bundle.chat?.id || chatId),
        relationshipSubjectId: personId ? autoSendSubjectId("relationship", personId) : null,
        chatKind: bundle.chat?.kind || "unknown",
      };
    }
    const chat = chats.find((item) => item.id === chatId);
    if (!chat) return {
      chatSubjectId: autoSendSubjectId("chat", chatId),
      relationshipSubjectId: null,
      chatKind: "unknown",
    };
    const canonical = canonicalChatOf(chat);
    const personId = chat.kind === "direct" ? draftPersonId(canonical, materializeEvents(chat.id), ["owner"]) : null;
    return {
      chatSubjectId: autoSendSubjectId("chat", chat.id),
      relationshipSubjectId: personId ? autoSendSubjectId("relationship", personId) : null,
      chatKind: chat.kind,
    };
  }

  function publicExecutionConsent(consent = {}) {
    return {
      version: consent.version || AUTO_SEND_EXECUTION_CONSENT_VERSION,
      policyVersion: consent.policyVersion || AUTO_SEND_POLICY_VERSION,
      authorized: consent.authorized === true,
      emergencyStop: consent.emergencyStop !== false,
      grantedAt: consent.grantedAt || null,
      revokedAt: consent.revokedAt || null,
      buildVersion: consent.buildVersion || null,
      identityBound: Boolean(consent.tenantId && consent.userId),
    };
  }

  function assertTrustedAutoSendBinding(consent = {}) {
    if (!tenantId && !authenticatedUserId) return;
    if (!tenantId || !authenticatedUserId || consent.tenantId !== tenantId || consent.userId !== authenticatedUserId) {
      throw new Error("Automatic delivery configuration is not bound to this authenticated tenant and user.");
    }
  }

  function autonomyPresentation(policy, consent, extra = {}) {
    const runtime = autoSendRuntime.status();
    const consentCurrent = consent.authorized === true
      && consent.emergencyStop === false
      && consent.buildVersion === trustedBuildVersion
      && consent.policyVersion === AUTO_SEND_POLICY_VERSION;
    const decision = evaluateAutoSendPolicy({
      tenantDefault: policy.tenantDefault,
      relationshipPolicy: policy.relationshipPolicy,
      chatOverride: policy.chatOverride,
      // Conversation-specific safeguards are evaluated only against fresh
      // bridge truth after a normal GGCP draft exists.
      safety: { authorizationEnabled: runtime.available && consentCurrent },
    });
    return {
      ...decision,
      ...extra,
      tenantDefault: policy.tenantDefault,
      relationshipPolicy: policy.relationshipPolicy,
      chatOverride: policy.chatOverride,
      executionConsent: publicExecutionConsent(consent),
      runtime,
      releaseCertified: runtime.releaseCertified,
      deliveryDevelopmentLocked: !runtime.available,
      automaticSendAvailable: runtime.available && consentCurrent,
      explanation: runtime.available && consentCurrent
        ? "Automatic delivery infrastructure is available for this certified build. Every draft still requires fresh conversation, account, graph, consent, and policy checks."
        : "Your policy and consent choice are saved for this account. Automatic delivery is unavailable until every certified execution gate is present; no message will be queued or sent by these controls.",
    };
  }

  async function tenantAutonomyPayload() {
    const [policy, consent] = await Promise.all([
      userStateStore.autoSendPolicy(),
      userStateStore.autoSendExecutionConsent(),
    ]);
    assertTrustedAutoSendBinding(consent);
    return autonomyPresentation(policy, consent, { selectedScope: "tenant" });
  }

  async function chatAutonomyPayload(chatId) {
    const subjects = await autoSendSubjectsForChat(chatId);
    const [policy, consent, legacyStyle] = await Promise.all([
      userStateStore.autoSendPolicy(subjects),
      userStateStore.autoSendExecutionConsent(),
      userStateStore.chatStyle(chatId),
    ]);
    assertTrustedAutoSendBinding(consent);
    const legacyChatMode = legacyStyle.sendingMode && legacyStyle.sendingMode !== "inherit" ? legacyStyle.sendingMode : null;
    const effectivePolicy = {
      ...policy,
      chatOverride: policy.chatOverride || (legacyChatMode ? { mode: legacyChatMode, allowGroups: false, policyVersion: AUTO_SEND_POLICY_VERSION, updatedAt: null } : null),
    };
    const selectedScope = effectivePolicy.chatOverride
      ? "chat"
      : effectivePolicy.relationshipPolicy
        ? "relationship"
        : "tenant";
    return autonomyPresentation(effectivePolicy, consent, {
      selectedScope,
      selectedMode: selectedScope === "chat"
        ? effectivePolicy.chatOverride.mode
        : selectedScope === "relationship"
          ? effectivePolicy.relationshipPolicy.mode
          : "inherit",
      relationshipPolicyAvailable: Boolean(subjects.relationshipSubjectId),
      chatKind: subjects.chatKind,
    });
  }

  async function automaticDeliveryForDraft({
    chatId,
    input,
    generated,
    context,
    toneContext,
    preferences,
    chatStyle,
    phraseSelectionSignals,
    semanticTranslation,
  }) {
    const runtimeStatus = autoSendRuntime.status();
    if (!runtimeStatus.available) return autoSendRuntime.run();
    const accountId = String(context?.scope?.accountScopeId || "").trim();
    const targetMessageId = String(context?.freshness?.targetMessageId || "").trim();
    const relationshipGraphId = String(context?.graphGrounding?.targetRelationshipGraphId || "").trim();
    const relationshipGraphVersion = String(context?.graphGrounding?.graphVersion || "").trim();
    const requestBinding = {
      tenantId,
      userId: authenticatedUserId,
      accountId,
      relationshipGraphId,
      relationshipGraphVersion,
      chatId,
      targetMessageId,
      executionId: `gateway-${randomUUID()}`,
      draftText: generated.draft,
    };

    const loadCurrentState = async () => {
      const [freshBundle, bridgeStatus, freshConversationState, consent, currentChatStyle] = await Promise.all([
        bridgeSource.bundle(chatId),
        bridgeSource.status(),
        bridgeSource.conversationState ? bridgeSource.conversationState(chatId) : Promise.resolve(null),
        userStateStore.autoSendExecutionConsent(),
        userStateStore.chatStyle(chatId),
      ]);
      const freshStory = boundedCurrentStory(freshBundle.events, freshConversationState, targetMessageId);
      const freshContext = buildDraftContext({
        accountScopeId: freshBundle.accountScopeId,
        tenantScopeId: tenantId,
        chat: freshBundle.chat,
        chatEvents: freshStory,
        allEvents: toneContext.events,
        allChats: toneContext.chats,
        watermark: freshBundle.watermark,
        ownerIds: [],
        expectedTargetMessageId: targetMessageId,
        userIntent: typeof input.intent === "string" ? input.intent : "",
        draftAnyway: input.draftAnyway === true,
        conversationState: freshConversationState,
        phraseSelectionSignals,
        semanticTranslation,
        preferences: {
          ...preferences,
          ...(chatStyle.language && chatStyle.language !== "match" ? { draftLanguage: chatStyle.language } : {}),
          ...(chatStyle.length && chatStyle.length !== "match" ? { replyLength: chatStyle.length } : {}),
          ...(chatStyle.formality && chatStyle.formality !== "match" ? { formality: chatStyle.formality } : {}),
          ...(chatStyle.emoji && chatStyle.emoji !== "match" ? { emoji: chatStyle.emoji } : {}),
        },
        nowMs: Number(options.autoSendClock?.() ?? Date.now()),
      });
      const ownerIds = Array.isArray(freshBundle.ownerIds) ? freshBundle.ownerIds : [];
      const relationshipIdentityId = freshBundle.chat.kind === "group"
        ? freshBundle.chat.id
        : draftPersonId(freshBundle.chat, freshBundle.events, ownerIds);
      const subjects = {
        chatSubjectId: autoSendSubjectId("chat", freshBundle.chat.id),
        relationshipSubjectId: freshBundle.chat.kind === "direct"
          ? autoSendSubjectId("relationship", relationshipIdentityId)
          : null,
      };
      const [storedPolicy, authorities] = await Promise.all([
        userStateStore.autoSendPolicy(subjects),
        autoSendRuntime.safetyAuthorities({
          tenantId,
          userId: authenticatedUserId,
          accountId: freshBundle.accountScopeId,
          chatId: freshBundle.chat.id,
          targetMessageId,
          chatKind: freshBundle.chat.kind,
        }),
      ]);
      const legacyChatMode = currentChatStyle.sendingMode && currentChatStyle.sendingMode !== "inherit"
        ? currentChatStyle.sendingMode
        : null;
      const policy = {
        ...storedPolicy,
        chatOverride: storedPolicy.chatOverride || (legacyChatMode
          ? { mode: legacyChatMode, allowGroups: false, policyVersion: AUTO_SEND_POLICY_VERSION, updatedAt: null }
          : null),
      };
      let withinUsageLimits = true;
      try { usageMeter.assertAvailable("drafts"); } catch { withinUsageLimits = false; }
      return {
        ...policy,
        executionConsent: consent,
        safetyInput: {
          bridgeBundle: freshBundle,
          draftContext: freshContext,
          draftOutput: generated,
          identity: {
            verified: Boolean(tenantId && authenticatedUserId && relationshipIdentityId),
            tenantId,
            accountId: freshBundle.accountScopeId,
            chatId: freshBundle.chat.id,
            relationshipIdentityId,
          },
          connection: {
            connected: bridgeStatus.connected === true && bridgeStatus.sendAvailable === true,
            state: bridgeStatus.connectionState || "unknown",
            accountId: freshBundle.accountScopeId,
          },
          usage: { withinLimits: withinUsageLimits },
          quietHours: authorities?.quietHours,
          mediaAssessments: authorities?.mediaAssessments,
          authorizationEnabled: true,
          customRuleId: authorities?.customRuleId,
          customRulePassed: authorities?.customRulePassed,
        },
      };
    };

    try {
      return await autoSendRuntime.run({
        request: requestBinding,
        loadCurrentState,
        cancelRequested: input.autoSendAction === "cancel",
      });
    } catch {
      return {
        ...runtimeStatus,
        state: "blocked",
        reasonCodes: ["RUNTIME_EXECUTION_FAILED"],
        cancellationAvailable: false,
        countdownEndsAt: null,
        delivered: false,
        contentStored: false,
      };
    }
  }

  async function connectionPayload() {
    const [saved, google, runtime] = await Promise.all([
      userStateStore.integrations(),
      typeof googleConnector.status === "function" ? googleConnector.status() : Promise.resolve(null),
      bridgeSource?.status ? bridgeSource.status().catch(() => ({ connected: false, connectionState: "offline" })) : Promise.resolve({ connected: true, connectionState: "fixture" }),
    ]);
    return integrationStatus({ ...saved, google }, {
      whatsappConnected: runtime.connected === true,
      whatsappMode: runtime.connector || runtime.connectionState || "not-connected",
      historyBoundary: runtime.historyBoundary || runtime.historyState || "connector-defined",
      draftProvider: draftProvider?.name || "disabled",
      googleAvailable: googleConnector.available,
    });
  }

  async function enrichChats(items) {
    const imported = await userStateStore.integrations();
    return items.map((chat) => enrichChatIdentity(chat, imported.contacts));
  }

  async function historyTruthDiagnostics(url) {
    if (!bridgeSource?.truth) throw new Error("Live history truth is unavailable while the connector is offline.");
    const pageLimit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 50));
    const cursor = Math.max(0, Number(url.searchParams.get("cursor")) || 0);
    const all = [...await bridgeSource.listChats("active"), ...await bridgeSource.listChats("archived")];
    const page = all.slice(cursor, cursor + pageLimit);
    const items = [];
    for (const chat of page) {
      try {
        items.push({ chat, truth: await bridgeSource.truth(chat.id) });
      } catch {
        items.push({ chat, truth: null, errorCode: "TRUTH_UNAVAILABLE" });
      }
    }
    return assertContentFreeHistoryTruth(contentFreeHistoryTruth(items, { tenantId, cursor, totalChats: all.length }));
  }
  const server = createServer(async (request, response) => {
    const startedAt = Date.now();
    let auditedPath = "/invalid";
    const suppliedCorrelation = String(request.headers["x-request-id"] || "");
    const correlationId = /^[a-zA-Z0-9._:-]{8,128}$/u.test(suppliedCorrelation)
      ? suppliedCorrelation
      : opaqueCorrelationId(`${startedAt}:${Math.random()}:${request.socket?.remoteAddress || "local"}`);
    response.setHeader("x-mycrobo-correlation-id", correlationId);
    response.once("finish", () => {
      if (!auditLogger) return;
      try {
        auditLogger(contentFreeAuditRecord({ request, pathname: auditedPath, status: response.statusCode, durationMs: Date.now() - startedAt, correlationId }));
      } catch { /* diagnostics must never interrupt the product */ }
    });
    response.setHeader("content-security-policy", "default-src 'self'; img-src 'self' data:; media-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("x-frame-options", "DENY");
    response.setHeader("referrer-policy", "no-referrer");
    response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      function extractBearerToken(req) {
        const auth = String(req.headers.authorization || "");
        if (auth.startsWith("Bearer ")) return auth.slice(7).trim();
        return "";
      }

      function callerSession(req) {
        if (!controlPlane) return { authenticated: true, isOwner: true, isWorkspaceOwner: true, tenantId, role: authenticatedRole || "owner" };
        const token = extractBearerToken(req);
        if (!token) {
          return { authenticated: false, isOwner: false, isWorkspaceOwner: false, tenantId: null, session: null, role: "" };
        }
        try {
          const session = controlPlane.sessionFromToken(token);
          if (!session) return { authenticated: false, isOwner: false, isWorkspaceOwner: false, tenantId: null, session: null, role: "" };

          const callerTenantId = session.tenant?.id;
          const callerRole = session.tenant?.role;
          const isPlatformAdmin = session.user?.platformAdmin === true;
          const isWorkspaceOwner = callerRole === "owner" || isPlatformAdmin;
          const effectiveRole = callerRole || (isPlatformAdmin ? "owner" : authenticatedRole);

          // Check persistent WhatsApp owner binding
          const currentOwner = getWhatsAppOwner();
          let isOwner = false;

          if (currentOwner?.tenantId) {
            // STRICT ISOLATION: ONLY the exact tenant that connected WhatsApp is the owner.
            // Platform admin NEVER bypasses chat privacy to view another person's WhatsApp!
            isOwner = Boolean(callerTenantId && callerTenantId === currentOwner.tenantId);
          } else if (tenantId) {
            isOwner = Boolean(callerTenantId && callerTenantId === tenantId);
          }

          return { authenticated: true, isOwner, isWorkspaceOwner, tenantId: callerTenantId || tenantId, session, role: effectiveRole };
        } catch {
          return { authenticated: false, isOwner: false, isWorkspaceOwner: false, tenantId: null, session: null, role: "" };
        }
      }

      if (url.pathname.startsWith("/api/v1/auth/")) {
        if (url.pathname === "/api/v1/auth/status") {
          if (request.method !== "GET") return json(response, 405, { error: "Use GET for auth status." });
          if (!controlPlane) {
            return json(response, 200, { authenticated: true, bootstrapRequired: false, user: null, tenant: null });
          }
          const caller = callerSession(request);
          const cpStatus = controlPlane.status();
          return json(response, 200, {
            authenticated: caller.authenticated,
            bootstrapRequired: cpStatus.bootstrapRequired,
            user: caller.session?.user || null,
            tenant: caller.session?.tenant || null,
          });
        }
        if (url.pathname === "/api/v1/auth/signup") {
          if (request.method !== "POST") return json(response, 405, { error: "Use POST to sign up." });
          if (!controlPlane) return json(response, 500, { error: "Control plane is not initialized." });
          try {
            const input = await readJSON(request, 16_384);
            const cpStatus = controlPlane.status();
            let created;
            if (cpStatus.bootstrapRequired) {
              created = controlPlane.bootstrap({
                email: input.email,
                displayName: input.displayName,
                password: input.password,
                workspaceName: input.workspaceName || input.tenantName || "Primary workspace",
                importedTenants: [{ id: tenantId || "tenant-0000000000000001", name: "WhatsApp Workspace" }],
              });
            } else {
              created = controlPlane.register({
                email: input.email,
                displayName: input.displayName,
                password: input.password,
                workspaceName: input.workspaceName || input.tenantName,
              });
            }
            return json(response, 200, { authenticated: true, token: created.token, session: created.session });
          } catch (err) {
            return json(response, 400, { error: err instanceof Error ? err.message : "Registration failed." });
          }
        }
        if (url.pathname === "/api/v1/auth/login") {
          if (request.method !== "POST") return json(response, 405, { error: "Use POST to sign in." });
          if (!controlPlane) return json(response, 500, { error: "Control plane is not initialized." });
          try {
            const input = await readJSON(request, 16_384);
            const loggedIn = controlPlane.login({ email: input.email, password: input.password });
            return json(response, 200, { authenticated: true, token: loggedIn.token, session: loggedIn.session });
          } catch (err) {
            return json(response, 401, { error: err instanceof Error ? err.message : "Sign in failed." });
          }
        }
        if (url.pathname === "/api/v1/auth/logout") {
          if (request.method !== "POST") return json(response, 405, { error: "Use POST to sign out." });
          if (controlPlane) {
            const token = extractBearerToken(request);
            if (token) try { controlPlane.logout(token); } catch {}
          }
          return json(response, 200, { signedOut: true });
        }
        return json(response, 404, { error: "Unknown auth endpoint." });
      }

      if (url.pathname === "/oauth/google/callback") {
        if (request.method !== "GET") return oauthResult(response, false, "Use the Google sign-in link from MyCrobo.");
        const callbackLimit = oauthCallbackLimiter.check(request);
        if (!callbackLimit.allowed) {
          response.setHeader("retry-after", String(callbackLimit.retryAfterSeconds));
          return oauthResult(response, false, "Too many Google callback attempts. Wait briefly and try again.", 429);
        }
        const caller = callerSession(request);
        const capabilityRole = caller.role || authenticatedRole;
        const capability = authorizeGatewayCapability({ method: request.method, pathname: url.pathname, role: capabilityRole });
        if (!capability.ok) return oauthResult(response, false, "This workspace role cannot change connected services.", capability.status);
        try {
          const result = await googleConnector.complete({ state: url.searchParams.get("state"), code: url.searchParams.get("code"), error: url.searchParams.get("error") });
          return oauthResult(response, true, "Gmail and Calendar read-only access is connected. Return to MyCrobo to refresh metadata.");
        } catch (error) {
          return oauthResult(response, false, error instanceof Error ? error.message : "Google connection could not be completed.");
        }
      }
      const authorization = authorizeGatewayRequest(request, securityPolicy);
      if (!authorization.ok) return json(response, authorization.status, { error: "The private application session is not authorized.", code: authorization.code });
      const caller = callerSession(request);
      const capabilityRole = caller.role || authenticatedRole;
      const capability =  authorizeGatewayCapability({ method: request.method, pathname: url.pathname, role: capabilityRole });
      if (!capability.ok) return json(response, capability.status, {
        error: capability.code === "ROLE_CAPABILITY_DENIED"
          ? "This workspace role has read-only access to this operation."
          : "This operation is not authorized for the private application session.",
        code: capability.code,
      });
      const limit = requestLimiter.check(request);
      if (!limit.allowed) {
        response.setHeader("retry-after", String(limit.retryAfterSeconds));
        return json(response, 429, { error: "Too many local requests. Wait briefly and try again." });
      }
      if (url.pathname === "/api/v1/status") {
        const build = {
          product: "MyCrobo",
          version: process.env.MYCROBO_BUILD_VERSION || "development",
          channel: process.env.MYCROBO_BUILD_CHANNEL || "development",
          buildId: process.env.MYCROBO_BUILD_ID || "unversioned",
        };
        if (controlPlane) {
          const caller = callerSession(request);
          if (caller.authenticated && !caller.isOwner) {
            return json(response, 200, {
              ...build,
              apiVersion: "1.0",
              connector: "personal-pilot",
              connected: false,
              connectionState: "offline",
              readOnly: true,
              sendAvailable: false,
              pairing: { state: "unpaired" },
              automaticDelivery: autoSendRuntime.status(),
            });
          }
        }
        if (bridgeSource) return json(response, 200, { ...(await bridgeSource.status()), ...build, automaticDelivery: autoSendRuntime.status() });
        return json(response, 200, {
          ...build,
          apiVersion: "1.0",
          connector: "fixture",
          connected: true,
          readOnly: true,
          sendAvailable: false,
          automaticDelivery: autoSendRuntime.status(),
        });
      }
      if (url.pathname === "/api/v1/diagnostics/history-truth") {
        if (request.method !== "GET") return json(response, 405, { error: "Use GET for content-free history truth." });
        try {
          response.setHeader("cache-control", "private, no-store");
          return json(response, 200, await historyTruthDiagnostics(url));
        } catch (error) {
          return json(response, 409, { error: error instanceof Error ? error.message : "History truth is unavailable." });
        }
      }
      if (url.pathname === "/api/v1/translation/status") {
        if (request.method !== "GET") return json(response, 405, { error: "Use GET for local translation status." });
        return json(response, 200, translator?.status?.() || { configured: false, enabled: false, localOnly: true, reason: "unavailable" });
      }
      if (url.pathname === "/api/v1/usage") {
        if (request.method !== "GET") return json(response, 405, { error: "Use GET for workspace usage." });
        return json(response, 200, usageMeter.snapshot());
      }
      if (url.pathname === "/api/v1/translation") {
        if (request.method !== "POST") return json(response, 405, { error: "Use POST for local translation." });
        if (!translator?.translate) return json(response, 503, { applied: false, reason: "unavailable", localOnly: true });
        try {
          const input = await readJSON(request, 16_384);
          usageMeter.assertAvailable("translations");
          const result = await translator.translate({ ...input, tenantId });
          if (result?.applied === true) usageMeter.record("translations");
          return json(response, 200, result);
        } catch (error) {
          return json(response, error?.code === "PLAN_LIMIT_REACHED" ? 402 : 400, {
            applied: false,
            localOnly: true,
            code: typeof error?.code === "string" ? error.code : "REQUEST_INVALID",
            error: error instanceof Error ? error.message : "The local translation request is invalid.",
          });
        }
      }
      if (url.pathname === "/api/v1/integrations") {
        if (request.method !== "GET") return json(response, 405, { error: "Use GET for connections." });
        return json(response, 200, await connectionPayload());
      }
      if (url.pathname === "/api/v1/integrations/whatsapp/logout") {
        if (request.method !== "POST") return json(response, 405, { error: "Use POST to log out WhatsApp." });
        if (controlPlane) {
          const caller = callerSession(request);
          if (caller.authenticated && !caller.isWorkspaceOwner) return json(response, 403, { error: "Only the workspace owner can log out WhatsApp." });
        }
        if (request.headers["x-mycrobo-confirm"] !== "LOG OUT WHATSAPP") return json(response, 409, { error: "Explicit WhatsApp logout confirmation is required." });
        if (!bridgeSource?.logout) return json(response, 404, { error: "WhatsApp logout is unavailable in this build." });
        try {
          const result = await bridgeSource.logout();
          clearWhatsAppOwner();
          return json(response, 200, result);
        } catch (error) {
          return json(response, 409, { error: error instanceof Error ? error.message : "WhatsApp could not be logged out." });
        }
      }
      if (url.pathname === "/api/v1/integrations/google/start") {
        if (request.method !== "POST") return json(response, 405, { error: "Use POST to connect Google." });
        try {
          const host = securityPolicy.allowedHost || String(request.headers.host || "");
          if (!/^127\.0\.0\.1:\d+$/u.test(host)) throw new Error("The private callback address is unavailable.");
          return json(response, 201, await googleConnector.start(`http://${host}/oauth/google/callback`));
        } catch (error) {
          return json(response, 409, { error: error instanceof Error ? error.message : "Google connection could not start." });
        }
      }
      if (url.pathname === "/api/v1/integrations/google/sync") {
        if (request.method !== "POST") return json(response, 405, { error: "Use POST to refresh Google context." });
        try {
          const connection = await syncGoogle();
          return json(response, 200, { synced: true, state: connection.state, lastSyncedAt: connection.lastSyncedAt, gmailContextCount: connection.gmailContextCount, busyBlockCount: connection.busyBlockCount });
        } catch (error) {
          return json(response, 409, { error: error instanceof Error ? error.message : "Google context could not be refreshed." });
        }
      }
      if (url.pathname === "/api/v1/integrations/google") {
        if (request.method !== "DELETE") return json(response, 405, { error: "Use DELETE to disconnect Google." });
        if (request.headers["x-mycrobo-confirm"] !== "DISCONNECT GOOGLE") return json(response, 409, { error: "Explicit Google disconnection confirmation is required." });
        try {
          const result = await googleConnector.disconnect();
          const integrations = await userStateStore.integrations();
          if (integrations.calendar?.origin === "google-workspace") await userStateStore.removeIntegration("calendar");
          await userStateStore.removeDirectConnection("google");
          return json(response, 200, result);
        } catch (error) {
          return json(response, 409, { error: error instanceof Error ? error.message : "Google disconnection could not be confirmed." });
        }
      }
      if (url.pathname === "/api/v1/integrations/import") {
        if (request.method !== "POST") return json(response, 405, { error: "Use POST to import read-only context." });
        try {
          const input = await readJSON(request, 2_200_000);
          const imported = importContextSource({ kind: input.kind, content: input.content, sourceName: input.sourceName });
          await userStateStore.setIntegration(imported.kind, imported);
          return json(response, 201, { kind: imported.kind, sourceName: imported.sourceName, importedAt: imported.importedAt, count: imported.count, privacyMode: imported.privacyMode || "identity-only" });
        } catch (error) {
          return json(response, 400, { error: error instanceof Error ? error.message : "The context file could not be imported." });
        }
      }
      const integrationDelete = /^\/api\/v1\/integrations\/(contacts|calendar)$/u.exec(url.pathname);
      if (integrationDelete) {
        if (request.method !== "DELETE") return json(response, 405, { error: "Use DELETE to remove this context." });
        const kind = integrationDelete[1];
        if (request.headers["x-mycrobo-confirm"] !== `REMOVE ${kind.toUpperCase()} CONTEXT`) return json(response, 409, { error: "Explicit context-removal confirmation is required." });
        return json(response, 200, await userStateStore.removeIntegration(kind));
      }
      if (url.pathname === "/api/v1/storage") {
        if (request.method !== "GET") return json(response, 405, { error: "Use GET for storage status." });
        if (controlPlane) {
          const caller = callerSession(request);
          if (caller.authenticated && !caller.isOwner) return json(response, 200, { available: false });
        }
        if (typeof bridgeSource?.storage !== "function") return json(response, 200, { available: false });
        const [storage, legacy] = await Promise.all([bridgeSource.storage(), legacyRecoveryStatus(userDataDir)]);
        return json(response, 200, { available: true, ...storage, legacy_recovery_bytes: legacy.bytes });
      }
      if (url.pathname === "/api/v1/sync-truth") {
        if (request.method !== "GET") return json(response, 405, { error: "Use GET for sync truth." });
        if (controlPlane) {
          const caller = callerSession(request);
          if (caller.authenticated && !caller.isOwner) return json(response, 200, { syncTruth: null });
        }
        return json(response, 200, await syncTruthPayload());
      }
      if (url.pathname === "/api/v1/privacy/export") {
        if (request.method !== "GET") return json(response, 405, { error: "Use GET to export local MyCrobo settings." });
        const state = await userStateStore.snapshot();
        const payload = {
          schema: "mycrobo-user-export.2",
          exportedAt: new Date().toISOString(),
          tenantFingerprint: tenantExportTag,
          preferences: state.preferences,
          automaticDelivery: {
            policies: state.autoSendPolicies,
            executionConsent: publicExecutionConsent(state.autoSendExecutionConsent),
            runtime: autoSendRuntime.status(),
            realDeliveryAvailable: autoSendRuntime.status().available
              && state.autoSendExecutionConsent?.authorized === true
              && state.autoSendExecutionConsent?.buildVersion === trustedBuildVersion,
          },
          tasks: state.tasks,
          decisions: state.decisions,
          personalization: {
            outcomeCounts: (Array.isArray(state.personalizationOutcomes) ? state.personalizationOutcomes : []).reduce((counts, item) => ({ ...counts, [item.outcome]: (counts[item.outcome] || 0) + 1 }), {}),
            recentPhraseUseCount: Array.isArray(state.phraseUsage) ? state.phraseUsage.length : 0,
          },
        };
        response.setHeader("content-disposition", `attachment; filename="mycrobo-settings-${tenantExportTag}-${new Date().toISOString().slice(0, 10)}.json"`);
        return json(response, 200, payload);
      }
      if (url.pathname === "/api/v1/privacy/user-state") {
        if (request.method !== "DELETE") return json(response, 405, { error: "Use DELETE to reset local MyCrobo settings." });
        if (request.headers["x-mycrobo-confirm"] !== "DELETE LOCAL SETTINGS") return json(response, 409, { error: "Explicit local-settings deletion confirmation is required." });
        await userStateStore.reset();
        return json(response, 200, { reset: true, deleted: ["preferences", "automatic delivery policy and consent", "conversation styles", "task decisions", "draft feedback", "model usage ledger", "read-only context imports"] });
      }
      if (url.pathname === "/api/v1/privacy/legacy-recovery") {
        const legacy = await legacyRecoveryStatus(userDataDir);
        if (request.method === "GET") return json(response, 200, legacy);
        if (request.method !== "DELETE") return json(response, 405, { error: "Use GET or DELETE for migration recovery copies." });
        if (request.headers["x-mycrobo-confirm"] !== "DELETE PLAINTEXT RECOVERY") return json(response, 409, { error: "Explicit plaintext-recovery deletion confirmation is required." });
        if (!legacy.removable) return json(response, 409, { error: "No verified encrypted replacement is available." });
        for (const file of legacy.files) await unlink(file.path);
        return json(response, 200, { deleted: legacy.files.map((file) => file.name), reclaimedBytes: legacy.bytes, recoverable: false });
      }
      if (url.pathname === "/api/v1/privacy") {
        if (request.method !== "GET") return json(response, 405, { error: "Use GET for privacy status." });
        const legacy = await legacyRecoveryStatus(userDataDir);
        const minimumContextCloud = /^(?:hybrid:|openai:|gemini:)/u.test(String(draftProvider?.name || ""));
        return json(response, 200, {
          rawChats: "local-device",
          connector: bridgeSource ? "local-linked-device" : "fixture",
          cloudDrafting: minimumContextCloud ? "enabled-minimum-context" : "disabled",
          draftProcessing: minimumContextCloud ? "Cloud-assisted · minimum context" : "Local only",
          automaticSending: false,
          exactSendReview: true,
          feedbackStorage: "content-free-local",
          crossChatDisclosure: "blocked-by-default",
          gatewaySession: securityPolicy.token && securityPolicy.windowToken ? "authenticated-per-window" : "development-unlocked",
          userStateProtection: process.env.MYCROBO_USER_STATE_KEY ? "AES-256-GCM + OS-protected key" : "development-plaintext",
          messageStoreProtection: process.env.MYCROBO_MESSAGE_DB_KEY ? "encrypted SQLite vault" : "owner-only local database",
          localAccessControl: process.env.MYCROBO_USER_DATA_DIR ? "owner-only-vault" : "development-directory",
          ordinaryStartupSend: securityPolicy.sendBrokerToken ? "native-confirmation-only" : "development-gateway",
          legacyRecovery: { available: legacy.available, bytes: legacy.bytes, removable: legacy.removable },
          contextSources: await connectionPayload(),
        });
      }
      if (url.pathname.startsWith("/api/v1/pairing-")) {
        if (controlPlane) {
          const caller = callerSession(request);
          if (caller.authenticated && !caller.isWorkspaceOwner) {
            return json(response, 403, { error: "WhatsApp device pairing is only available to the workspace owner." });
          }
        }
      }
      if (url.pathname === "/api/v1/pairing-qr") {
        if (controlPlane) {
          const caller = callerSession(request);
          const currentOwner = getWhatsAppOwner();
          const bridgeStatus = bridgeSource ? await bridgeSource.status().catch(() => null) : null;
          if (bridgeStatus?.connected && currentOwner?.tenantId && currentOwner.tenantId !== caller.session?.tenant?.id) {
            return json(response, 409, { error: "WhatsApp is currently connected to another workspace. Disconnect that account first." });
          }
          if (caller.authenticated && caller.session?.tenant?.id && caller.isWorkspaceOwner && !currentOwner?.tenantId) {
            setWhatsAppOwner(caller.session.tenant.id, caller.session.user?.id);
          }
        }
        if (!bridgeSource?.pairingQR) return json(response, 404, { error: "Pairing code is unavailable." });
        try {
          const qr = await bridgeSource.pairingQR();
          response.writeHead(200, { "content-type": qr.contentType, "cache-control": "no-store", "x-content-type-options": "nosniff" });
          response.end(qr.bytes);
          return;
        } catch (err) {
          if (bridgeSource?.useQRPairing || bridgeSource?.restartPairing) {
            try {
              if (bridgeSource.useQRPairing) await bridgeSource.useQRPairing();
              else if (bridgeSource.restartPairing) await bridgeSource.restartPairing();
              const freshQr = await bridgeSource.pairingQR();
              response.writeHead(200, { "content-type": freshQr.contentType, "cache-control": "no-store", "x-content-type-options": "nosniff" });
              response.end(freshQr.bytes);
              return;
            } catch {}
          }
          return json(response, 409, { error: err instanceof Error ? err.message : "Pairing code is unavailable." });
        }
      }
      if (url.pathname === "/api/v1/pairing-phone") {
        if (request.method !== "POST") return json(response, 405, { error: "Use POST to request a phone linking code." });
        if (controlPlane) {
          const caller = callerSession(request);
          const currentOwner = getWhatsAppOwner();
          const bridgeStatus = bridgeSource ? await bridgeSource.status().catch(() => null) : null;
          if (bridgeStatus?.connected && currentOwner?.tenantId && currentOwner.tenantId !== caller.session?.tenant?.id) {
            return json(response, 409, { error: "WhatsApp is currently connected to another workspace." });
          }
          if (caller.authenticated && caller.session?.tenant?.id && caller.isWorkspaceOwner && !currentOwner?.tenantId) {
            setWhatsAppOwner(caller.session.tenant.id, caller.session.user?.id);
          }
        }
        if (!bridgeSource?.pairByPhone) return json(response, 404, { error: "Phone-number linking is unavailable in this build." });
        const input = await readJSON(request, 1024);
        const phone = typeof input.phone === "string" ? input.phone.trim() : "";
        if (!/^\+[1-9]\d{6,14}$/u.test(phone)) return json(response, 400, { error: "Enter the complete international number, including its country code." });
        try {
          return json(response, 201, await bridgeSource.pairByPhone(phone));
        } catch (error) {
          return json(response, 409, { error: error instanceof Error ? error.message : "WhatsApp could not create a phone linking code." });
        }
      }
      if (url.pathname === "/api/v1/pairing-use-qr") {
        if (request.method !== "POST") return json(response, 405, { error: "Use POST to switch to QR linking." });
        if (controlPlane) {
          const caller = callerSession(request);
          const currentOwner = getWhatsAppOwner();
          const bridgeStatus = bridgeSource ? await bridgeSource.status().catch(() => null) : null;
          if (bridgeStatus?.connected && currentOwner?.tenantId && currentOwner.tenantId !== caller.session?.tenant?.id) {
            return json(response, 409, { error: "WhatsApp is currently connected to another workspace." });
          }
          if (caller.authenticated && caller.session?.tenant?.id && caller.isWorkspaceOwner && !currentOwner?.tenantId) {
            setWhatsAppOwner(caller.session.tenant.id, caller.session.user?.id);
          }
        }
        if (!bridgeSource?.useQRPairing) return json(response, 404, { error: "QR linking is unavailable in this build." });
        try {
          return json(response, 200, await bridgeSource.useQRPairing());
        } catch (error) {
          return json(response, 409, { error: error instanceof Error ? error.message : "A fresh QR code is not ready yet." });
        }
      }
      if (url.pathname === "/api/v1/pairing-restart") {
        if (request.method !== "POST") return json(response, 405, { error: "Use POST to start a fresh linking session." });
        if (controlPlane) {
          const caller = callerSession(request);
          const currentOwner = getWhatsAppOwner();
          const bridgeStatus = bridgeSource ? await bridgeSource.status().catch(() => null) : null;
          if (bridgeStatus?.connected && currentOwner?.tenantId && currentOwner.tenantId !== caller.session?.tenant?.id) {
            return json(response, 409, { error: "WhatsApp is currently connected to another workspace." });
          }
          if (caller.authenticated && caller.session?.tenant?.id && caller.isWorkspaceOwner && !currentOwner?.tenantId) {
            setWhatsAppOwner(caller.session.tenant.id, caller.session.user?.id);
          }
        }
        if (!bridgeSource?.restartPairing) return json(response, 404, { error: "Pairing recovery is unavailable in this build." });
        try {
          return json(response, 200, await bridgeSource.restartPairing());
        } catch (error) {
          return json(response, 409, { error: error instanceof Error ? error.message : "WhatsApp could not start a fresh linking session." });
        }
      }
      if (url.pathname === "/api/v1/events") {
        if (request.method !== "GET") return json(response, 405, { error: "Use GET for live updates." });
        if (controlPlane) {
          const caller = callerSession(request);
          if (caller.authenticated && !caller.isOwner) {
            response.writeHead(204, { "cache-control": "no-store" });
            response.end();
            return;
          }
        }
        if (!bridgeSource?.events) {
          response.writeHead(204, { "cache-control": "no-store" });
          response.end();
          return;
        }
        const controller = new AbortController();
        response.once("close", () => controller.abort());
        const upstream = await bridgeSource.events(controller.signal);
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-store",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        response.flushHeaders?.();
        try {
          for await (const chunk of upstream.body) {
            if (response.destroyed) break;
            response.write(Buffer.from(chunk));
          }
        } catch (error) {
          if (error?.name !== "AbortError" && !response.destroyed) response.write(": stream interrupted\n\n");
        } finally {
          if (!response.writableEnded) response.end();
        }
        return;
      }
      if (url.pathname.startsWith("/api/v1/media/")) {
        if (controlPlane) {
          const caller = callerSession(request);
          if (caller.authenticated && !caller.isOwner) {
            return json(response, 404, { error: "Attachment not found in your workspace." });
          }
        }
      }
      const mediaRetryMatch = /^\/api\/v1\/media\/([^/]+)\/retry$/u.exec(url.pathname);
      if (mediaRetryMatch) {
        if (request.method !== "POST") return json(response, 405, { error: "Use POST to fetch an attachment." });
        if (!bridgeSource?.retryMedia) return json(response, 503, { error: "Reconnect WhatsApp to fetch this attachment." });
        try {
          return json(response, 202, await bridgeSource.retryMedia(decodeURIComponent(mediaRetryMatch[1])));
        } catch (error) {
          return json(response, 409, { error: error instanceof Error ? error.message : "Attachment could not be fetched." });
        }
      }
      const mediaMatch = /^\/api\/v1\/media\/([^/]+)$/u.exec(url.pathname);
      if (mediaMatch) {
        if (request.method !== "GET") return json(response, 405, { error: "Use GET to view an attachment." });
        if (!bridgeSource?.media) return json(response, 404, { error: "Media is unavailable." });
        const media = await bridgeSource.media(decodeURIComponent(mediaMatch[1]));
        response.removeHeader("x-frame-options");
        response.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'self'");
        response.setHeader("accept-ranges", "bytes");
        response.setHeader("content-type", media.contentType);
        response.setHeader("cache-control", "private, no-store");
        response.setHeader("x-content-type-options", "nosniff");
        response.setHeader("content-disposition", "inline");
        const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/u);
        if (range) {
          const start = range[1] ? Number(range[1]) : 0;
          const end = range[2] ? Math.min(Number(range[2]), media.bytes.length - 1) : media.bytes.length - 1;
          if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= media.bytes.length) {
            response.writeHead(416, { "content-range": `bytes */${media.bytes.length}` });
            response.end();
            return;
          }
          response.writeHead(206, { "content-range": `bytes ${start}-${end}/${media.bytes.length}`, "content-length": String(end - start + 1) });
          response.end(media.bytes.subarray(start, end + 1));
          return;
        }
        response.writeHead(200, { "content-length": String(media.bytes.length) });
        response.end(media.bytes);
        return;
      }
      if (url.pathname === "/api/v1/workspace") {
        if (request.method !== "GET") return json(response, 405, { error: "Use GET for the workspace." });
        if (controlPlane) {
          const caller = callerSession(request);
          if (caller.authenticated && !caller.isOwner) {
            return json(response, 200, {
              tasks: [],
              followUps: [],
              pending: [],
              decisions: [],
              intelligence: { relationshipCount: 0 },
            });
          }
        }
        return json(response, 200, await workspacePayload());
      }
      if (url.pathname === "/api/v1/preferences") {
        const autonomyAction = String(url.searchParams.get("autonomy") || "").trim();
        if (autonomyAction) {
          if (request.method === "GET" && autonomyAction === "policy") return json(response, 200, await tenantAutonomyPayload());
          if (request.method !== "PUT") return json(response, 405, { error: "Use GET or PUT for automatic delivery configuration." });
          try {
            const input = await readJSON(request, 4_096);
            if (autonomyAction === "policy") {
              assertInputKeys(input, ["mode", "allowGroups"]);
              await userStateStore.setAutoSendPolicyLayer({
                layerKind: "tenant",
                mode: input.mode,
                allowGroups: input.allowGroups === true,
              });
            } else if (autonomyAction === "grant") {
              assertInputKeys(input, ["confirmed", "consentVersion", "policyVersion"]);
              await userStateStore.grantAutoSendExecutionConsent({
                version: input.consentVersion,
                policyVersion: input.policyVersion,
                buildVersion: trustedBuildVersion,
                confirmed: input.confirmed === true,
              });
            } else if (["revoke", "emergency-stop"].includes(autonomyAction)) {
              assertInputKeys(input, ["confirmed"]);
              if (input.confirmed !== true) throw new Error("Confirm this automatic delivery safety action explicitly.");
              await userStateStore.revokeAutoSendExecutionConsent();
            } else {
              return json(response, 400, { error: "Choose a valid automatic delivery configuration action." });
            }
            return json(response, 200, await tenantAutonomyPayload());
          } catch (error) {
            return json(response, 400, { error: error instanceof Error ? error.message : "Automatic delivery configuration is invalid." });
          }
        }
        if (request.method === "GET") return json(response, 200, await userStateStore.preferences());
        if (request.method !== "PUT") return json(response, 405, { error: "Use GET or PUT for preferences." });
        try {
          return json(response, 200, await userStateStore.setPreferences(await readJSON(request)));
        } catch (error) {
          return json(response, 400, { error: error instanceof Error ? error.message : "Preferences are invalid." });
        }
      }
      if (url.pathname === "/api/v1/autonomy") {
        if (request.method !== "GET") return json(response, 405, { error: "Use GET for sending safeguards." });
        return json(response, 200, await tenantAutonomyPayload());
      }
      if (url.pathname.startsWith("/api/v1/chats/")) {
        if (controlPlane) {
          const caller = callerSession(request);
          if (!caller.authenticated) {
            return json(response, 401, { error: "Authentication required to view conversations.", code: "AUTHENTICATION_REQUIRED" });
          }
          if (!caller.isOwner) {
            return json(response, 404, { error: "Chat not found in your workspace." });
          }
        }
      }
      const autonomyMatch = /^\/api\/v1\/chats\/([^/]+)\/autonomy$/u.exec(url.pathname);
      if (autonomyMatch) {
        if (request.method !== "GET") return json(response, 405, { error: "Use GET for conversation sending safeguards." });
        const chatId = decodeURIComponent(autonomyMatch[1]);
        try {
          return json(response, 200, await chatAutonomyPayload(chatId));
        } catch (error) {
          return json(response, 404, { error: error instanceof Error ? error.message : "Conversation policy is unavailable." });
        }
      }
      const intelligenceMatch = /^\/api\/v1\/chats\/([^/]+)\/intelligence$/u.exec(url.pathname);
      if (intelligenceMatch) {
        if (request.method !== "GET") return json(response, 405, { error: "Use GET for verified context." });
        try {
          return json(response, 200, await intelligencePayload(decodeURIComponent(intelligenceMatch[1])));
        } catch (error) {
          return json(response, 404, { error: error instanceof Error ? error.message : "Verified context is unavailable." });
        }
      }
      const styleMatch = /^\/api\/v1\/chats\/([^/]+)\/style$/u.exec(url.pathname);
      if (styleMatch) {
        const chatId = decodeURIComponent(styleMatch[1]);
        if (url.searchParams.get("autonomy") === "policy") {
          if (request.method === "GET") {
            try { return json(response, 200, await chatAutonomyPayload(chatId)); }
            catch (error) { return json(response, 404, { error: error instanceof Error ? error.message : "Conversation policy is unavailable." }); }
          }
          if (request.method !== "PUT") return json(response, 405, { error: "Use GET or PUT for the conversation delivery policy." });
          try {
            const input = await readJSON(request, 4_096);
            assertInputKeys(input, ["scope", "mode"]);
            const scope = String(input.scope || "");
            if (!["chat", "relationship"].includes(scope)) throw new Error("Choose this conversation or this relationship for the delivery policy.");
            const subjects = await autoSendSubjectsForChat(chatId);
            const subjectId = scope === "chat" ? subjects.chatSubjectId : subjects.relationshipSubjectId;
            if (!subjectId) throw new Error("A relationship-wide policy is available only for a verified direct conversation.");
            if (input.mode === "inherit") {
              await userStateStore.removeAutoSendPolicyLayer(scope, subjectId);
            } else {
              await userStateStore.setAutoSendPolicyLayer({ layerKind: scope, subjectId, mode: input.mode, allowGroups: false });
            }
            const style = await userStateStore.chatStyle(chatId);
            if (scope === "relationship") {
              await userStateStore.removeAutoSendPolicyLayer("chat", subjects.chatSubjectId);
              await userStateStore.setChatStyle(chatId, { ...style, sendingMode: "inherit" });
            } else {
              await userStateStore.setChatStyle(chatId, { ...style, sendingMode: input.mode });
            }
            return json(response, 200, await chatAutonomyPayload(chatId));
          } catch (error) {
            return json(response, 400, { error: error instanceof Error ? error.message : "Conversation delivery policy is invalid." });
          }
        }
        if (request.method === "GET") return json(response, 200, await userStateStore.chatStyle(chatId));
        if (request.method !== "PUT") return json(response, 405, { error: "Use GET or PUT for conversation style." });
        try {
          return json(response, 200, await userStateStore.setChatStyle(chatId, await readJSON(request)));
        } catch (error) {
          return json(response, 400, { error: error instanceof Error ? error.message : "Conversation style is invalid." });
        }
      }
      const feedbackMatch = /^\/api\/v1\/chats\/([^/]+)\/draft-feedback$/u.exec(url.pathname);
      if (feedbackMatch) {
        if (request.method !== "POST") return json(response, 405, { error: "Use POST for draft feedback." });
        try {
          return json(response, 201, await userStateStore.recordDraftFeedback(decodeURIComponent(feedbackMatch[1]), await readJSON(request)));
        } catch (error) {
          return json(response, 400, { error: error instanceof Error ? error.message : "Draft feedback is invalid." });
        }
      }
      const outcomeMatch = /^\/api\/v1\/chats\/([^/]+)\/personalization-outcome$/u.exec(url.pathname);
      if (outcomeMatch) {
        if (request.method !== "POST") return json(response, 405, { error: "Use POST for a draft outcome." });
        try {
          const chatId = decodeURIComponent(outcomeMatch[1]);
          const input = await readJSON(request);
          pruneDraftLearningLedger();
          const binding = draftLearningLedger.get(String(input.draftId || ""));
          if (!binding || binding.chatId !== chatId) return json(response, 409, { error: "This draft is no longer eligible for learning." });
          if (binding.targetMessageId !== String(input.targetMessageId || "")) return json(response, 409, { error: "The conversation changed before feedback was recorded." });
          const terminal = input.event === "sent"
            ? classifyDraftEditOutcome(String(input.shownDraft || ""), String(input.finalDraft || ""))
            : input.event === "no-reply"
              ? { outcome: "no-reply", editRatio: null }
              : input.event === "dismissed"
                ? { outcome: "dismissed", editRatio: null }
                : null;
          if (!terminal) return json(response, 400, { error: "Choose a valid final draft outcome." });
          const saved = await userStateStore.recordPersonalizationOutcome({ ...binding, ...terminal });
          draftLearningLedger.delete(binding.draftId);
          return json(response, 201, { outcome: saved.outcome, editRatio: saved.editRatio, contentStored: false });
        } catch (error) {
          return json(response, 400, { error: error instanceof Error ? error.message : "Draft outcome is invalid." });
        }
      }
      const taskMatch = /^\/api\/v1\/(tasks|followups)\/([^/]+)$/u.exec(url.pathname);
      if (taskMatch) {
        if (request.method !== "POST") return json(response, 405, { error: "Use POST to update this item." });
        const collection = taskMatch[1] === "followups" ? "followUps" : "tasks";
        const taskId = decodeURIComponent(taskMatch[2]);
        const input = await readJSON(request);
        const status = typeof input.status === "string" ? input.status : "";
        const [current, savedSnapshot] = await Promise.all([workspacePayload(), userStateStore.snapshot()]);
        const task = current[collection]?.find((item) => item.id === taskId)
          || current.tasks?.find((item) => item.id === taskId)
          || current.followUps?.find((item) => item.id === taskId)
          || savedSnapshot.tasks?.[taskId];
        if (!task) return json(response, 404, { error: "This evidence-backed item is no longer current." });
        let saved;
        try {
          saved = await userStateStore.setTaskStatus(taskId, status, new Date(), { snoozedUntil: input.snoozedUntil });
        } catch (error) {
          return json(response, 400, { error: error instanceof Error ? error.message : "Task status is invalid." });
        }
        return json(response, 200, { taskId, ...saved });
      }
      const decisionMatch = /^\/api\/v1\/decisions\/([^/]+)$/u.exec(url.pathname);
      if (decisionMatch) {
        if (request.method !== "POST") return json(response, 405, { error: "Use POST to update this decision." });
        const decisionId = decodeURIComponent(decisionMatch[1]);
        const input = await readJSON(request);
        const status = typeof input.status === "string" ? input.status : "";
        const [items, savedSnapshot] = await Promise.all([workspaceItems(), userStateStore.snapshot()]);
        const knownDecision = buildPendingItems(items).some((item) => item.id === decisionId)
          || Boolean(savedSnapshot.decisions?.[decisionId]);
        if (!knownDecision) return json(response, 404, { error: "This decision is no longer current." });
        try {
          const saved = await userStateStore.setDecisionStatus(decisionId, status, new Date());
          return json(response, 200, { decisionId, ...saved });
        } catch (error) {
          return json(response, 400, { error: error instanceof Error ? error.message : "Decision status is invalid." });
        }
      }
      if (url.pathname === "/api/v1/chats") {
        if (controlPlane) {
          const caller = callerSession(request);
          if (!caller.authenticated) {
            return json(response, 401, { error: "Authentication required to view conversations.", code: "AUTHENTICATION_REQUIRED" });
          }
          if (!caller.isOwner) {
            const collection = url.searchParams.get("collection") ?? "active";
            return json(response, 200, { collection, chats: [] });
          }
        }
        const collection = url.searchParams.get("collection") ?? "active";
        if (bridgeSource) return json(response, 200, { collection, chats: await enrichChats(await bridgeSource.listChats(collection)) });
        return json(response, 200, {
          collection,
          chats: await enrichChats(chats.filter((chat) => chat.collection === collection).map(viewOfChat)),
        });
      }
      if (url.pathname === "/api/v1/connect") {
        if (request.method !== "POST") return json(response, 405, { error: "Use POST to connect." });
        if (controlPlane) {
          const caller = callerSession(request);
          if (!caller.authenticated) {
            return json(response, 401, { error: "Authentication required to connect WhatsApp.", code: "AUTHENTICATION_REQUIRED" });
          }
          if (!caller.isWorkspaceOwner) {
            return json(response, 403, { error: "Only the workspace owner can connect WhatsApp." });
          }
          const currentOwner = getWhatsAppOwner();
          const bridgeStatus = bridgeSource ? await bridgeSource.status().catch(() => null) : null;
          if (bridgeStatus?.connected && currentOwner?.tenantId && currentOwner.tenantId !== caller.session?.tenant?.id) {
            return json(response, 409, { error: "WhatsApp is currently connected to another workspace. Disconnect that account first." });
          }
          if (caller.session?.tenant?.id) {
            setWhatsAppOwner(caller.session.tenant.id, caller.session.user?.id);
          }
        }
        if (!bridgeSource) return json(response, 409, { error: "The linked-device bridge is not configured." });
        return json(response, 202, await bridgeSource.startImport());
      }
      if (url.pathname === "/api/v1/search") {
        if (controlPlane) {
          const caller = callerSession(request);
          if (!caller.authenticated) {
            return json(response, 401, { error: "Authentication required.", code: "AUTHENTICATION_REQUIRED" });
          }
          if (!caller.isOwner) {
            const collection = url.searchParams.get("collection") === "archived" ? "archived" : "active";
            return json(response, 200, { collection, chats: [] });
          }
        }
        const collection = url.searchParams.get("collection") === "archived" ? "archived" : "active";
        const query = (url.searchParams.get("q") || "").trim();
        if ([...query].length < 2) return json(response, 400, { error: "Enter at least two characters." });
        if (bridgeSource) return json(response, 200, { collection, chats: await enrichChats(await bridgeSource.searchChats(collection, query)) });
        const needle = query.toLocaleLowerCase();
        const matches = chats.filter((chat) => chat.collection === collection && (
          chat.title.toLocaleLowerCase().includes(needle)
          || materializeEvents(chat.id).some((event) => isHumanText(event) && event.text.toLocaleLowerCase().includes(needle))
        ));
        return json(response, 200, { collection, chats: await enrichChats(matches.map(viewOfChat)) });
      }
      const chatMatch = /^\/api\/v1\/chats\/([^/]+)\/(messages|latest|draft|send-approval|send)$/u.exec(url.pathname);
      if (chatMatch) {
        if (controlPlane) {
          const caller = callerSession(request);
          if (!caller.authenticated) {
            return json(response, 401, { error: "Authentication required.", code: "AUTHENTICATION_REQUIRED" });
          }
          if (!caller.isOwner) {
            return json(response, 404, { error: "Chat not found in your workspace." });
          }
        }
        const chatId = decodeURIComponent(chatMatch[1]);
        if (bridgeSource) {
          if (chatMatch[2] === "send-approval" || chatMatch[2] === "send") {
            if (request.method !== "POST") return json(response, 405, { error: "Use POST for an exact reviewed send." });
            if (securityPolicy.sendBrokerToken && !authorizeSendBroker(request.headers["x-mycrobo-send-broker"], securityPolicy.sendBrokerToken)) {
              return json(response, 403, { error: "A native MyCrobo confirmation is required before sending." });
            }
            let input;
            try {
              input = outboundInput(await readJSON(request));
            } catch (error) {
              return json(response, 400, { error: error instanceof Error ? error.message : "Invalid send request." });
            }
            const [status, bundle] = await Promise.all([bridgeSource.status(), bridgeSource.latest(chatId)]);
            if (!status.connected || !status.sendAvailable) return json(response, 409, { error: "WhatsApp sending is not currently available." });
            const exactLatestSource = bundle.latestSource || bundle.latest;
            if (!bundle.watermark?.verifiedAt || exactLatestSource?.id !== input.targetMessageId) {
              return json(response, 409, { error: "The latest message changed. Review this conversation again before sending." });
            }
            if (chatMatch[2] === "send-approval") {
              const approval = await bridgeSource.approveSend({ chatId, ...input });
              return json(response, 201, { ...approval, recipient: bundle.chat?.title || chatId, targetMessageId: input.targetMessageId });
            }
            if (!input.approvalToken) return json(response, 400, { error: "Approval token is required." });
            const receipt = await bridgeSource.sendApproved({ chatId, ...input });
            return json(response, 200, { ...receipt, recipient: bundle.chat?.title || chatId, targetMessageId: input.targetMessageId });
          }
          if (chatMatch[2] === "draft") {
            if (request.method !== "POST") return json(response, 405, { error: "Use POST to draft." });
            if (!draftProvider) return json(response, 503, {
              error: "Drafting is not configured yet. Your chats remain local and nothing was sent.",
              draftAvailable: false,
            });
            try { usageMeter.assertAvailable("drafts"); } catch (error) {
              return json(response, 402, { error: error instanceof Error ? error.message : "The workspace plan limit was reached.", code: "PLAN_LIMIT_REACHED", draftAvailable: false });
            }
            const draftStartedAt = performance.now();
            const input = await readJSON(request);
            const bundleStartedAt = performance.now();
            const bundle = await bridgeSource.bundle(chatId);
            const bundleMs = elapsedMs(bundleStartedAt);
            if (bundle.readiness?.currentMessage?.state !== "ready" || bundle.readiness?.currentStory?.state !== "ready" || bundle.readiness?.draftAllowed !== true) {
              return json(response, 409, {
                error: bundle.readiness?.currentStory?.reason || bundle.readiness?.currentMessage?.reason || "The latest conversation truth could not be reconciled.",
                draftAvailable: false,
                readiness: bundle.readiness || null,
              });
            }
            const historyComplete = bundle.watermark.reachedBeginning && bundle.watermark.state === "complete";
            if (!historyComplete && draftProvider.requiresCompleteHistory === true) {
              return json(response, 409, {
                error: "This conversation is not fully current and complete yet. MyCrobo will not draft from partial history.",
                draftAvailable: false,
              });
            }
            const contextInputsStartedAt = performance.now();
            const [conversationState, preferences, chatStyle] = await Promise.all([
              bridgeSource.conversationState ? bridgeSource.conversationState(chatId) : Promise.resolve(null),
              userStateStore.preferences(),
              userStateStore.chatStyle(chatId),
            ]);
            const rawToneContext = input.localOnly === true
              ? { events: bundle.events, chats: [bundle.chat], accountScopeId: bundle.accountScopeId, runtimeEvidenceBounded: true }
              : await (bridgeSource.toneContext
                ? bridgeSource.toneContext(chatId)
                : bridgeSource.toneEvents(chatId).then((events) => ({ events, chats: [] })));
            const toneContext = boundedToneContext(rawToneContext, bundle.chat);
            const learningAccountScopeId = String(toneContext.accountScopeId || bundle.accountScopeId || "").trim();
            if (!learningAccountScopeId) return json(response, 409, {
              error: "The connected WhatsApp account could not be verified. Reconnect before drafting.",
              draftAvailable: false,
            });
            const learningPersonId = draftPersonId(bundle.chat, bundle.events, []);
            const stateAccountScopeId = tenantAccountScope(learningAccountScopeId);
            const [phraseSelectionSignals, semanticTranslation] = await Promise.all([
              userStateStore.phraseSelectionSignals(stateAccountScopeId, learningPersonId),
              input.localOnly === true
                ? Promise.resolve(null)
                : localSemanticTranslation(bundle.events, typeof input.targetMessageId === "string" ? input.targetMessageId : ""),
            ]);
            const contextInputsMs = elapsedMs(contextInputsStartedAt);
            let context;
            const contextBuildStartedAt = performance.now();
            try {
              const draftStory = boundedCurrentStory(bundle.events, conversationState, typeof input.targetMessageId === "string" ? input.targetMessageId : "");
              context = buildDraftContext({
                accountScopeId: learningAccountScopeId,
                ...(tenantId ? { tenantScopeId: tenantId } : {}),
                chat: bundle.chat,
                chatEvents: draftStory,
                allEvents: toneContext.events,
                allChats: toneContext.chats,
                watermark: bundle.watermark,
                ownerIds: [],
                expectedTargetMessageId: typeof input.targetMessageId === "string" ? input.targetMessageId : "",
                userIntent: typeof input.intent === "string" ? input.intent : "",
                draftAnyway: input.draftAnyway === true,
                conversationState,
                phraseSelectionSignals,
                semanticTranslation,
                preferences: {
                  ...preferences,
                  ...(chatStyle.language && chatStyle.language !== "match" ? { draftLanguage: chatStyle.language } : {}),
                  ...(chatStyle.length && chatStyle.length !== "match" ? { replyLength: chatStyle.length } : {}),
                  ...(chatStyle.formality && chatStyle.formality !== "match" ? { formality: chatStyle.formality } : {}),
                  ...(chatStyle.emoji && chatStyle.emoji !== "match" ? { emoji: chatStyle.emoji } : {}),
                },
                nowMs: Date.now(),
              });
            } catch (error) {
              return json(response, 409, { error: error instanceof Error ? error.message : "Verify the latest message again." });
            }
            const contextBuildMs = elapsedMs(contextBuildStartedAt);
            let generated;
            const generationStartedAt = performance.now();
            try {
              generated = validateDraftOutput(await generateDraftForRequest(draftProvider, input, context, request, response), context);
            } catch (error) {
              if (request.aborted || response.destroyed) return;
              return json(response, 502, { error: error instanceof Error ? error.message : "The drafting service is unavailable." });
            }
            const generationMs = elapsedMs(generationStartedAt);
            const automaticDelivery = await automaticDeliveryForDraft({
              chatId,
              input,
              generated,
              context,
              toneContext,
              preferences,
              chatStyle,
              phraseSelectionSignals,
              semanticTranslation,
            });
            const learningStartedAt = performance.now();
            const draftLearningId = await registerShownPattern({ context, generated, accountScopeId: stateAccountScopeId, personId: learningPersonId, chatId });
            const learningMs = elapsedMs(learningStartedAt);
            usageMeter.record("drafts");
            const allowedEvidence = new Set(context.story.map((event) => event.id));
            return json(response, 200, {
              ...generated,
              evidenceIds: generated.evidenceIds.filter((id) => allowedEvidence.has(id)),
              targetMessageId: context.freshness.targetMessageId,
              toneStage: context.tone.stage,
              provider: input.localOnly === true ? "local-safe-starter" : draftProvider.name || "configured",
              ...(draftLearningId ? { draftLearningId } : {}),
              historyComplete,
              readiness: bundle.readiness,
              sendAvailable: false,
              automaticDelivery,
              draftLatency: {
                schema: "mycrobo-draft-latency.1",
                totalMs: elapsedMs(draftStartedAt),
                bundleMs,
                contextInputsMs,
                contextBuildMs,
                generationMs,
                learningMs,
                localOnly: input.localOnly === true,
                translationApplied: Boolean(semanticTranslation),
                runtimeEvidenceBounded: toneContext.runtimeEvidenceBounded === true,
              },
            });
          }
          if (chatMatch[2] === "latest") {
            const bundle = await bridgeSource.latest(chatId);
            return json(response, 200, {
              chatId,
              verifiedAt: bundle.watermark.verifiedAt,
              watermark: bundle.watermark,
              latest: bundle.latest,
              latestSource: bundle.latestSource,
              reply: bundle.reply,
              readiness: bundle.readiness,
            });
          }
          const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 200));
          const page = await bridgeSource.messages(chatId, { limit, before: url.searchParams.get("before") || "" });
          const latestState = await bridgeSource.latest(chatId);
          return json(response, 200, {
            chatId,
            watermark: latestState.watermark,
            latest: latestState.latest,
            latestSource: latestState.latestSource,
            reply: latestState.reply,
            readiness: latestState.readiness,
            messages: page.events.filter(isDisplayableEvent),
            nextBefore: page.nextBefore,
          });
        }
        const chat = chats.find((item) => item.id === chatId);
        if (!chat) return json(response, 404, { error: "Chat not found." });
        if (chatMatch[2] === "send-approval" || chatMatch[2] === "send") {
          return json(response, 501, { error: "Development data is read-only. No message was sent.", sendAvailable: false });
        }
        const view = viewOfChat(chat);
        if (chatMatch[2] === "draft") {
          if (request.method !== "POST") return json(response, 405, { error: "Use POST to draft." });
          if (!draftProvider) {
            return json(response, 503, {
              error: "Drafting is not configured yet. Your chats remain local and nothing was sent.",
              draftAvailable: false,
            });
          }
          try { usageMeter.assertAvailable("drafts"); } catch (error) {
            return json(response, 402, { error: error instanceof Error ? error.message : "The workspace plan limit was reached.", code: "PLAN_LIMIT_REACHED", draftAvailable: false });
          }
          const input = await readJSON(request);
          let context;
          const fixtureChat = canonicalChatOf(chat);
          const fixtureEvents = materializeEvents(chatId);
          const learningAccountScopeId = "fixture-local-vault";
          const stateAccountScopeId = tenantAccountScope(learningAccountScopeId);
          const learningPersonId = draftPersonId(fixtureChat, fixtureEvents, ["owner"]);
          try {
            const [preferences, chatStyle, phraseSelectionSignals] = await Promise.all([
              userStateStore.preferences(),
              userStateStore.chatStyle(chatId),
              userStateStore.phraseSelectionSignals(stateAccountScopeId, learningPersonId),
            ]);
            context = buildDraftContext({
              ...(tenantId ? { tenantScopeId: tenantId, accountScopeId: learningAccountScopeId } : {}),
              chat: fixtureChat,
              chatEvents: fixtureEvents,
              allEvents: chats.flatMap((candidate) => materializeEvents(candidate.id)),
              allChats: chats.map(canonicalChatOf),
              watermark: view.watermark,
              ownerIds: ["owner"],
              expectedTargetMessageId: typeof input.targetMessageId === "string" ? input.targetMessageId : "",
              userIntent: typeof input.intent === "string" ? input.intent : "",
              draftAnyway: input.draftAnyway === true,
              phraseSelectionSignals,
              preferences: {
                ...preferences,
                ...(chatStyle.language && chatStyle.language !== "match" ? { draftLanguage: chatStyle.language } : {}),
                ...(chatStyle.length && chatStyle.length !== "match" ? { replyLength: chatStyle.length } : {}),
                ...(chatStyle.formality && chatStyle.formality !== "match" ? { formality: chatStyle.formality } : {}),
                ...(chatStyle.emoji && chatStyle.emoji !== "match" ? { emoji: chatStyle.emoji } : {}),
              },
              nowMs: Date.now(),
            });
          } catch (error) {
            return json(response, 409, { error: error instanceof Error ? error.message : "Verify the latest message again." });
          }
          let generated;
          try {
            generated = validateDraftOutput(await generateDraftForRequest(draftProvider, input, context, request, response), context);
          } catch (error) {
            if (request.aborted || response.destroyed) return;
            return json(response, 502, { error: error instanceof Error ? error.message : "The drafting service is unavailable." });
          }
          const draftLearningId = await registerShownPattern({ context, generated, accountScopeId: stateAccountScopeId, personId: learningPersonId, chatId });
          usageMeter.record("drafts");
          const allowedEvidence = new Set(context.story.map((event) => event.id));
          return json(response, 200, {
            ...generated,
            evidenceIds: generated.evidenceIds.filter((id) => allowedEvidence.has(id)),
            targetMessageId: context.freshness.targetMessageId,
            toneStage: context.tone.stage,
            provider: input.localOnly === true ? "local-safe-starter" : draftProvider.name || "configured",
            ...(draftLearningId ? { draftLearningId } : {}),
            historyComplete: view.watermark.reachedBeginning && view.watermark.state === "complete",
            sendAvailable: false,
          });
        }
        if (chatMatch[2] === "latest") {
          return json(response, 200, {
            chatId,
            verifiedAt: view.watermark.verifiedAt,
            latest: view.latest,
            reply: view.reply,
          });
        }
        const events = materializeEvents(chatId);
        const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 200));
        const visible = events.filter(isHumanText).slice(-limit);
        return json(response, 200, {
          chatId,
          watermark: view.watermark,
          latest: view.latest,
          reply: view.reply,
          messages: visible,
          nextBefore: events.filter(isHumanText).length > visible.length ? visible[0]?.id || null : null,
        });
      }
      if (url.pathname === "/api/v1/send") {
        return json(response, 501, {
          error: "Development data is read-only. No message was sent.",
          sendAvailable: false,
        });
      }
      const outSiteRoot = join(here, "..", "..", "apps", "public_html", "out");
      const legacySiteRoot = join(here, "..", "..", "apps", "public_html", "legacy-export");
      const siteRoot = existsSync(join(outSiteRoot, "index.html")) ? outSiteRoot : legacySiteRoot;
      const rawPath = url.pathname.replace(/^\/+/u, "");
      const normalizedPath = rawPath.replace(/\/+$/u, "");
      const isRscRequest = Boolean(
        rawPath.endsWith(".rsc") ||
        url.searchParams.has("_rsc") ||
        request.headers.accept?.includes("text/x-component")
      );
      const cleanPath = normalizedPath.replace(/\.rsc$/u, "");
      const isPublicSiteRoute = /^(?:product(?:\/why-mycrobo)?|why-mycrobo|vision|contact|control)$/u.test(cleanPath);
      const isNextAsset = url.pathname.startsWith("/_next/");
      const isPublicImage = url.pathname.startsWith("/images/");
      const isPublicRootAsset = /^(?:mycrobo-logo.*\.webp|mycrobo-mark\.(?:png|webp)|mycrobo.*\.png|robots\.txt|sitemap\.xml)$/u.test(normalizedPath);

      const isAppRoute = !isRscRequest && /^(?:app|login)$/u.test(normalizedPath);

      let targetFile = null;
      if (url.pathname === "/" || normalizedPath === "index.rsc") {
        if (isRscRequest) {
          const candidate1 = join(siteRoot, "index.rsc");
          const candidate2 = join(legacySiteRoot, "index.rsc");
          targetFile = existsSync(candidate1) ? candidate1 : candidate2;
        } else {
          const candidate1 = join(siteRoot, "index.html");
          const candidate2 = join(legacySiteRoot, "index.html");
          const candidate3 = join(clientRoot, "index.html");
          targetFile = existsSync(candidate1) ? candidate1 : (existsSync(candidate2) ? candidate2 : candidate3);
        }
      } else if (isAppRoute) {
        targetFile = join(clientRoot, "index.html");
      } else if (isPublicSiteRoute) {
        if (isRscRequest) {
          const candidate1 = join(siteRoot, `${cleanPath}.rsc`);
          const candidate2 = join(legacySiteRoot, `${cleanPath}.rsc`);
          targetFile = existsSync(candidate1) ? candidate1 : candidate2;
        } else {
          const candidate1 = join(siteRoot, cleanPath, "index.html");
          const candidate2 = join(siteRoot, `${cleanPath}.html`);
          const candidate3 = join(legacySiteRoot, cleanPath, "index.html");
          const candidate4 = join(legacySiteRoot, `${cleanPath}.html`);
          targetFile = existsSync(candidate1) ? candidate1 : (existsSync(candidate2) ? candidate2 : (existsSync(candidate3) ? candidate3 : candidate4));
        }
      } else if (isNextAsset || isPublicImage || isPublicRootAsset) {
        const candidate1 = join(siteRoot, rawPath);
        const candidate2 = join(legacySiteRoot, rawPath);
        targetFile = existsSync(candidate1) ? candidate1 : candidate2;
      } else {
        const assetPath = url.pathname.slice(1);
        if (!/^(?:index\.html|app\.js|admin-presentation\.mjs|autonomy-presentation\.mjs|chat-presentation\.mjs|composer-safety\.mjs|media-presentation\.mjs|pairing-presentation\.mjs|pwa-register\.mjs|relay-device\.mjs|relay-protocol\.mjs|web-auth\.mjs|web-auth-contract\.mjs|web-session\.mjs|web-hosted\.mjs|service-worker\.js|manifest\.webmanifest|styles\.css|assets\/(?:mycrobo-(?:logo-master|mark|lockup)-v1\.png|mycrobo-app-v2-(?:192|512)\.png|mycrobo-app-v2\.ico)|images\/.*)$/u.test(assetPath)) {
          return json(response, 404, { error: "Not found." });
        }
        targetFile = join(clientRoot, assetPath);
      }

      let body;
      try {
        body = await readFile(targetFile);
      } catch {
        return json(response, 404, { error: "Not found." });
      }

      if (normalizedPath === "login" && targetFile.endsWith("index.html")) {
        body = Buffer.from(body.toString("utf8").replace('<html lang="en">', '<html lang="en" class="force-auth">'));
      }

      const ext = extname(targetFile).toLowerCase();
      const mime = ext === ".rsc" || (isRscRequest && ext !== ".json" && ext !== ".js" && ext !== ".css" && ext !== ".png" && ext !== ".webp" && ext !== ".svg")
        ? "text/x-component; charset=utf-8"
        : ext === ".css"
        ? "text/css; charset=utf-8"
        : ext === ".webmanifest"
          ? "application/manifest+json; charset=utf-8"
        : [".js", ".mjs"].includes(ext)
          ? "text/javascript; charset=utf-8"
        : ext === ".png"
          ? "image/png"
        : ext === ".webp"
          ? "image/webp"
        : ext === ".svg"
          ? "image/svg+xml"
        : ext === ".ico"
          ? "image/x-icon"
        : ext === ".xml"
          ? "application/xml"
        : ext === ".json"
          ? "application/json"
        : ext === ".txt"
          ? "text/plain; charset=utf-8"
        : "text/html; charset=utf-8";
      response.writeHead(200, { "content-type": mime, "cache-control": "no-store" });
      response.end(body);
    } catch (error) {
      json(response, 500, { error: error instanceof Error ? error.message : "Unexpected error." });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 250;
  const googleRefreshTimer = setInterval(() => {
    if (!roleAllowsGatewayCapability(authenticatedRole, "integration.sync")) return;
    void refreshGoogleWhenStale({ googleConnector, sync: syncGoogle })
      .catch(() => { /* status remains visible; the next foreground refresh can retry */ });
  }, 5 * 60_000);
  googleRefreshTimer.unref?.();
  server.once("close", () => {
    clearInterval(googleRefreshTimer);
    translator?.close?.();
    autoSendRuntime.close();
    try { controlPlane?.close(); } catch {}
  });
  return server;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url)
  || process.argv.some((arg) => typeof arg === "string" && arg.includes("server.mjs"))
  || process.env.pm_id !== undefined;

if (isMain) {
  const port = Number(process.env.MYCROBO_GATEWAY_PORT || process.env.MYCROBO_REBOOT_PORT || 4177);
  const hostBootstrapResult = await readAutoSendHostBootstrapFromFd(3, {
    tenantId: process.env.MYCROBO_TENANT_ID,
    userId: process.env.MYCROBO_AUTH_USER_ID,
    accountId: process.env.MYCROBO_EXPECTED_ACCOUNT_SCOPE_ID,
    buildVersion: process.env.MYCROBO_BUILD_VERSION,
  });
  const host = process.env.MYCROBO_GATEWAY_HOST || "127.0.0.1";
  const server = createGatewayServer({
    autoSendHostBootstrap: hostBootstrapResult.accepted ? hostBootstrapResult.bootstrap : null,
  }).listen(port, host, () => {
    process.stdout.write(`MyCrobo local gateway: http://${host}:${port}\n`);
  });
  const desktopParentPID = Number(process.env.MYCROBO_DESKTOP_PARENT_PID || 0);
  closeGatewayWhenParentExits({ server, parentPID: desktopParentPID });
}
