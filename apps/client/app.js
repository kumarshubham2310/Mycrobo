import { connectionPresentation, conversationStatusPresentation, draftRouteLabel, draftTargetId, presentChats, shouldPresentConnectionSetup, shownPreview, shownSender, shownTitle } from "/chat-presentation.mjs";
import { composerSendState } from "/composer-safety.mjs";
import { mediaPresentation } from "/media-presentation.mjs";
import { PAIRING_COUNTRIES, defaultPairingCountry, normalizePairingPhone, pairingCodeCells, pairingSecondsRemaining, shouldCheckSavedChatsBeforeSetup } from "/pairing-presentation.mjs";
import { canOpenAdmin, normalizeAdminSnapshot, validateAdminUser, validateMembership, validateTenant } from "/admin-presentation.mjs";
import { webAuthReady } from "/web-auth.mjs";
import { startHostedWorkspace } from "/web-hosted.mjs";
import { autonomyReadiness, autonomySummary } from "/autonomy-presentation.mjs";

const webSession = await webAuthReady;
if (webSession?.surface === "closed-pilot-web") {
  await startHostedWorkspace(webSession);
} else {

const PRODUCT_VIEWS = ["chats", "pending", "tasks", "followups", "connections", "settings", "admin"];
const OVERVIEW_VIEWS = ["pending", "tasks", "followups"];
const VIEW_STORAGE_KEY = "mycrobo.activeView.v1";
// An enhanced provider must never hold the composer hostage. The private
// in-process route is exposed quickly and both routes have a hard UI deadline.
const DRAFT_PROGRESS_MS = 1_800;
const DRAFT_TIMEOUT_MS = 9_000;
const LOCAL_DRAFT_TIMEOUT_MS = 3_500;
const LIVE_EVENT_DEBOUNCE_MS = 250;
const HISTORY_EVENT_REFRESH_MS = 12_000;
const RECENT_LIVE_EVENT_WINDOW_MS = 10 * 60_000;
const STATUS_TIMEOUT_MS = 2_500;
const STATUS_FAILURE_THRESHOLD = 2;

function savedProductView() {
  try {
    const saved = localStorage.getItem(VIEW_STORAGE_KEY);
    return PRODUCT_VIEWS.includes(saved) && saved !== "admin" ? saved : "chats";
  } catch {
    return "chats";
  }
}

const state = {
  view: savedProductView(), collection: "active", chats: [], chatVisibleCount: 80, selected: null, selectedLatestId: null, query: "", openEpoch: 0,
  loadingChats: false, loadingOverview: false, sendAvailable: false, pending: [], tasks: [], followUps: [],
  hasSavedChats: null, forceSetup: false, connectionSetupDismissed: false, lastStatus: null,
  chatRequest: { sequence: 0, controller: null, promise: null }, workspaceRequest: { sequence: 0, controller: null, promise: null },
  draftRequest: { sequence: 0, controller: null, chatId: null },
  statusRequest: { sequence: 0, promise: null }, statusHealth: { consecutiveFailures: 0, lastSuccessAt: 0 },
  chatRenderSignature: "", workspaceSignature: "", overviewRenderedView: null,
  overviewViewport: { pending: null, tasks: null, followups: null },
  dismissedExpanded: { tasks: false, followups: false }, snoozedExpanded: { tasks: false, followups: false }, staleExpanded: { tasks: false, followups: false }, drafts: new Map(), historyByChat: new Map(), pendingLatestId: null,
  preferences: { draftLanguage: "match", replyLength: "match", liveUpdates: true, density: "comfortable", defaultSendingMode: "draft" },
  autonomy: null,
  integrations: null, tenants: null,
  auth: null, admin: null, adminLoading: false,
  pairingMethod: "qr", pairingCountry: defaultPairingCountry(navigator.languages?.[0] || navigator.language, Intl.DateTimeFormat().resolvedOptions().timeZone), pairingCustomCode: "+", pairingPhoneDraft: "", pairingShowEntry: false,
};
const chatList = document.querySelector("#chatList");
const messageList = document.querySelector("#messageList");
const replyPanel = document.querySelector("#replyPanel");
const conversationHeader = document.querySelector("#conversationHeader");
const contextPanel = document.querySelector("#contextPanel");
const setupPanel = document.querySelector("#setupPanel");
const workspace = document.querySelector("#workspace");
const overviewPanel = document.querySelector("#overviewPanel");
const overviewList = document.querySelector("#overviewList");
const newMessageNotice = document.querySelector("#newMessageNotice");
const refreshChatsButton = document.querySelector("#refresh");
const refreshOverviewButton = document.querySelector("#refreshOverview");
const toastRegion = document.querySelector("#toastRegion");
const settingsPanel = document.querySelector("#settingsPanel");
const connectionsPanel = document.querySelector("#connectionsPanel");
const adminPanel = document.querySelector("#adminPanel");
const settingsForm = document.querySelector("#settingsForm");
const storageCard = document.querySelector("#storageCard");
let chatsStarted = false;
let searchTimer;
let liveEvents;
let eventRefreshTimer;
let historyEventRefreshTimer;
let toastTimer;
let googleConnectPoll;
let pairingClockTimer;

function signatureOf(value) {
  return JSON.stringify(value);
}

function captureAnchor(container, selector, datasetKey) {
  if (!container) return null;
  const containerTop = container.getBoundingClientRect().top;
  const candidates = [...container.querySelectorAll(selector)];
  const anchor = candidates.find((node) => node.getBoundingClientRect().bottom > containerTop + 1);
  return {
    id: anchor?.dataset?.[datasetKey] || null,
    offset: anchor ? anchor.getBoundingClientRect().top - containerTop : 0,
    scrollTop: container.scrollTop,
  };
}

function restoreAnchor(container, selector, datasetKey, snapshot) {
  if (!container || !snapshot) return;
  const anchor = snapshot.id
    ? [...container.querySelectorAll(selector)].find((node) => node.dataset?.[datasetKey] === snapshot.id)
    : null;
  if (!anchor) {
    container.scrollTop = snapshot.scrollTop || 0;
    return;
  }
  const currentOffset = anchor.getBoundingClientRect().top - container.getBoundingClientRect().top;
  container.scrollTop += currentOffset - snapshot.offset;
}

function nearBottom(container, threshold = 72) {
  return container.scrollHeight - container.scrollTop - container.clientHeight <= threshold;
}

function rememberOverviewViewport(view = state.view) {
  if (!state.overviewViewport[view]) state.overviewViewport[view] = {};
  state.overviewViewport[view] = captureAnchor(overviewList, "[data-work-id]", "workId");
  if (["tasks", "followups"].includes(view)) {
    const dismissed = overviewList.querySelector("details.dismissedSection");
    if (dismissed) state.dismissedExpanded[view] = dismissed.open;
    const snoozed = overviewList.querySelector("details.snoozedSection");
    if (snoozed) state.snoozedExpanded[view] = snoozed.open;
    const stale = overviewList.querySelector("details.staleSection");
    if (stale) state.staleExpanded[view] = stale.open;
  }
}

function setRefreshButton(button, loading, label = "Refresh") {
  if (!button) return;
  button.disabled = loading;
  button.setAttribute("aria-busy", String(loading));
  if (button === refreshChatsButton) {
    button.textContent = loading ? "…" : "↻";
    button.title = loading ? "Updating chats and open conversation" : "Refresh chats and open conversation";
  }
  if (button === refreshOverviewButton) button.innerHTML = loading ? '<span aria-hidden="true">↻</span> Updating…' : `<span aria-hidden="true">↻</span> ${label}`;
  if (button?.id === "refreshConnections") button.innerHTML = loading ? '<span aria-hidden="true">↻</span> Checking…' : `<span aria-hidden="true">↻</span> ${label}`;
}

function showToast(message, { actionLabel = "", onAction = null } = {}) {
  clearTimeout(toastTimer);
  toastRegion.innerHTML = `<div class="toast"><span>${escapeHtml(message)}</span>${actionLabel && onAction ? `<button type="button">${escapeHtml(actionLabel)}</button>` : ""}</div>`;
  const action = toastRegion.querySelector("button");
  if (action && onAction) action.addEventListener("click", () => { toastRegion.innerHTML = ""; void onAction(); }, { once: true });
  toastTimer = setTimeout(() => { toastRegion.innerHTML = ""; }, action ? 7_000 : 3_000);
}

function hideNewMessageNotice() {
  state.pendingLatestId = null;
  newMessageNotice.classList.add("hidden");
}

function showNewMessageNotice(chat, latestId, label = "New messages") {
  if (state.selected?.id !== chat.id) return;
  state.pendingLatestId = latestId || state.pendingLatestId;
  const draft = state.drafts.get(chat.id);
  if (draft) state.drafts.set(chat.id, {
    ...draft,
    pendingNewMessages: true,
    safetyNote: "New messages arrived. Your writing was kept; review the conversation and edit it before sending.",
  });
  newMessageNotice.firstChild.textContent = `${label} `;
  newMessageNotice.classList.remove("hidden");
}

function updateConnectionSurface(presentation) {
  const card = document.querySelector(".connectionCard");
  const label = document.querySelector("#connection");
  const reconnect = document.querySelector("#reconnect");
  const notice = document.querySelector("#connectionNotice");
  if (card) card.dataset.state = presentation.code;
  if (label) {
    label.textContent = presentation.label;
    label.title = presentation.detail;
  }
  if (reconnect) {
    reconnect.textContent = presentation.actionLabel || "Reconnect";
    reconnect.classList.toggle("hidden", !presentation.canReconnect);
  }
  if (notice) {
    const needsAttention = presentation.canReconnect && !["connecting", "linking"].includes(presentation.code);
    notice.textContent = presentation.label;
    notice.title = presentation.detail;
    notice.setAttribute("aria-label", `${presentation.label}. ${presentation.actionLabel || "Open connection"}`);
    notice.classList.toggle("hidden", !needsAttention);
  }
}

function startLiveEvents() {
  if (!state.preferences.liveUpdates || liveEvents || typeof EventSource !== "function") return;
  liveEvents = new EventSource("/api/v1/events");
  liveEvents.addEventListener("message", (message) => {
    let event;
    try { event = JSON.parse(message.data); } catch { return; }
    const type = String(event?.type || "");
    if (!["message.created", "history.updated"].includes(type)) return;
    const eventChatId = event?.data?.chat_id || event?.data?.chatId || "";
    const eventTimestamp = Date.parse(event?.data?.timestamp || event?.at || "");
    const recentLiveMessage = type === "message.created"
      && (!Number.isFinite(eventTimestamp) || Date.now() - eventTimestamp <= RECENT_LIVE_EVENT_WINDOW_MS);
    if (recentLiveMessage) {
      clearTimeout(eventRefreshTimer);
      eventRefreshTimer = setTimeout(() => {
        if (!chatsStarted) return;
        void loadChats({ silent: true });
        void loadWorkspace({ silent: true });
        const matchesSelected = state.selected && (
          !eventChatId
          || state.selected.id === eventChatId
          || state.selected.connectorIds?.includes(eventChatId)
          || String(eventChatId).replace(/^(?:jid|lid|phone):/u, "") === String(state.selected.id).replace(/^(?:jid|lid|phone):/u, "")
          || state.selected.connectorIds?.some((id) => String(id).replace(/^(?:jid|lid|phone):/u, "") === String(eventChatId).replace(/^(?:jid|lid|phone):/u, ""))
        );
        if (matchesSelected) void refreshSelectedLatest();
        if (eventChatId && getChatAutoReplyMode(eventChatId)) {
          const targetChat = state.chats.find((c) => c.id === eventChatId || c.connectorIds?.includes(eventChatId)) || { id: eventChatId };
          void triggerAutoReplyForNewMessage(targetChat);
        }
      }, LIVE_EVENT_DEBOUNCE_MS);
      return;
    }
    // History import can emit thousands of message.created events. It changes
    // learned evidence, not the verified latest turn, so one bounded trailing
    // chat-list refresh is sufficient. Workspace/task derivation remains on its
    // regular poll and on genuinely recent live messages.
    clearTimeout(historyEventRefreshTimer);
    historyEventRefreshTimer = setTimeout(() => {
      if (chatsStarted) void loadChats({ silent: true });
    }, HISTORY_EVENT_REFRESH_MS);
  });
}

function applyPreferences(preferences) {
  state.preferences = { ...state.preferences, ...(preferences || {}) };
  document.body.classList.toggle("compact", state.preferences.density === "compact");
  if (!state.preferences.liveUpdates && liveEvents) {
    liveEvents.close();
    liveEvents = null;
  } else if (state.preferences.liveUpdates && (state.lastStatus?.connected || state.lastStatus?.connectionState === "catching-up") && state.lastStatus?.connector === "personal-pilot") {
    startLiveEvents();
  }
  if (settingsForm) {
    settingsForm.elements.draftLanguage.value = state.preferences.draftLanguage;
    settingsForm.elements.replyLength.value = state.preferences.replyLength;
    settingsForm.elements.liveUpdates.checked = state.preferences.liveUpdates;
    settingsForm.elements.density.value = state.preferences.density;
    settingsForm.elements.defaultSendingMode.value = state.preferences.defaultSendingMode || "draft";
    const autoReplySwitch = document.querySelector("#globalAutoReplySwitch");
    const autoReplyBadge = document.querySelector("#globalAutoReplyBadge");
    const autoReplyTip = document.querySelector("#autoReplyTip");
    const isAutoReplyOn = isAutoReplyEnabledGlobally();
    if (autoReplySwitch) autoReplySwitch.checked = isAutoReplyOn;
    if (autoReplyBadge) {
      autoReplyBadge.textContent = isAutoReplyOn ? "Auto-reply is ON" : "Auto-reply is OFF";
      autoReplyBadge.className = `autoReplyBadge ${isAutoReplyOn ? "on" : "off"}`;
    }
    if (autoReplyTip) {
      autoReplyTip.textContent = isAutoReplyOn
        ? "When ON, new incoming WhatsApp messages will be analyzed and replied automatically."
        : "When OFF, AI prepares drafts for your review only. Turn ON to automatically send replies.";
    }
  }
}

document.querySelector("#globalAutoReplySwitch")?.addEventListener("change", (event) => {
  const isNowOn = event.target.checked;
  state.preferences.autoReplyEnabled = isNowOn;
  try {
    localStorage.setItem("mycrobo.globalAutoReply", isNowOn ? "on" : "off");
  } catch {}
  const autoReplyBadge = document.querySelector("#globalAutoReplyBadge");
  const autoReplyTip = document.querySelector("#autoReplyTip");
  if (autoReplyBadge) {
    autoReplyBadge.textContent = isNowOn ? "Auto-reply is ON" : "Auto-reply is OFF";
    autoReplyBadge.className = `autoReplyBadge ${isNowOn ? "on" : "off"}`;
  }
  if (autoReplyTip) {
    autoReplyTip.textContent = isNowOn
      ? "When ON, new incoming WhatsApp messages will be analyzed and replied automatically."
      : "When OFF, AI prepares drafts for your review only. Turn ON to automatically send replies.";
  }
  showToast(isNowOn ? "Global Auto-reply turned ON" : "Global Auto-reply turned OFF");
});

function readableBytes(value) {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && amount >= 1024; index += 1) {
    amount /= 1024;
    unit = units[index];
  }
  return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${unit}`;
}

async function loadStorage() {
  if (!storageCard) return;
  const summary = storageCard.querySelector("#storageSummary");
  const policy = storageCard.querySelector("#storagePolicy");
  const meter = storageCard.querySelector(".storageMeter");
  const fill = storageCard.querySelector("#storageMeterFill");
  try {
    const storage = await fetchJSON("/api/v1/storage", { cache: "no-store" });
    if (!storage.available) throw new Error("Storage measurement is unavailable.");
    const database = Number(storage.database_bytes || storage.allocated_bytes || 0);
    const journal = Number(storage.journal_bytes || 0);
    const media = Number(storage.cached_media_bytes || 0);
    const legacy = Number(storage.legacy_recovery_bytes || 0);
    const limit = Math.max(1, Number(storage.media_cache_limit || 0));
    const percentage = Math.min(100, Math.round((media / limit) * 100));
    summary.textContent = `${readableBytes(database + journal)} encrypted vault · ${readableBytes(media)} attachment cache${legacy ? ` · ${readableBytes(legacy)} migration recovery` : ""}`;
    policy.textContent = `Attachment cache limit: ${readableBytes(limit)}. Older full attachments are removed first. ${legacy ? "A plaintext pre-migration recovery copy is retained until you explicitly remove it below." : "No plaintext migration recovery copy is retained."}`;
    meter.setAttribute("aria-valuenow", String(percentage));
    meter.setAttribute("aria-valuetext", `${readableBytes(media)} of ${readableBytes(limit)}`);
    fill.style.width = `${percentage}%`;
  } catch {
    summary.textContent = "Storage measurement is temporarily unavailable.";
    policy.textContent = "Messages remain local. Full attachments use a bounded, on-demand cache.";
    meter.setAttribute("aria-valuenow", "0");
    fill.style.width = "0%";
  }
}

async function loadProductTruth() {
  const statement = document.querySelector("#syncTruthStatement");
  const grid = document.querySelector("#syncTruthGrid");
  const privacyStatement = document.querySelector("#privacyStatement");
  const privacyList = document.querySelector("#privacyList");
  try {
    const [truth, privacy] = await Promise.all([
      fetchJSON("/api/v1/sync-truth", { cache: "no-store" }),
      fetchJSON("/api/v1/privacy", { cache: "no-store" }),
    ]);
    statement.textContent = truth.statement;
    grid.innerHTML = [
      ["Chats discovered", truth.chatCount],
      ["Latest verified", truth.latestVerifiedChats],
      ["Full history proven", truth.completeHistoryChats],
      ["Earlier history partial", truth.partialHistoryChats],
      ["Archived", truth.archivedChats],
      ["Messages saved", truth.savedMessages],
    ].map(([label, value]) => `<div><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`).join("");
    privacyStatement.textContent = privacy.cloudDrafting === "disabled"
      ? "Local-only processing is active. The protections below are enforced by this build."
      : "Cloud assistance is configured; only selected minimum context may leave this device.";
    privacyList.innerHTML = [
      ["Chat storage", privacy.rawChats === "local-device" ? "This device only" : privacy.rawChats],
      ["Draft processing", privacy.draftProcessing || (privacy.cloudDrafting === "disabled" ? "Local only" : "Cloud-assisted · minimum context")],
      ["Automatic sending", privacy.automaticSending ? "Enabled" : "Never automatic"],
      ["Before sending", privacy.exactSendReview ? "Latest message verified + one Send click" : "Unavailable"],
      ["Draft feedback", privacy.feedbackStorage === "content-free-local" ? "Local · no message text" : privacy.feedbackStorage],
      ["Application session", privacy.gatewaySession === "authenticated-per-window" ? "Private window token" : privacy.gatewaySession],
      ["Settings & DNA", privacy.userStateProtection?.startsWith("AES-256-GCM") ? "Encrypted · Windows-protected" : privacy.userStateProtection],
      ["Message evidence", privacy.messageStoreProtection === "encrypted SQLite vault" ? "Encrypted on-device vault" : privacy.messageStoreProtection],
      ["Local file access", privacy.localAccessControl === "owner-only-vault" ? "This Windows account only" : privacy.localAccessControl],
      ["Send gateway", privacy.ordinaryStartupSend === "native-confirmation-only" ? "One deliberate Send click" : privacy.ordinaryStartupSend],
    ].map(([label, value]) => `<div><span>${escapeHtml(label)}</span><span class="protectionValue"><small aria-label="Enforced protection">Locked</small><b>${escapeHtml(value)}</b></span></div>`).join("");
    const removeLegacy = document.querySelector("#removeLegacyRecovery");
    removeLegacy?.classList.toggle("hidden", !privacy.legacyRecovery?.removable);
    if (removeLegacy && privacy.legacyRecovery?.bytes) removeLegacy.textContent = `Remove ${readableBytes(privacy.legacyRecovery.bytes)} migration recovery copy`;
  } catch {
    statement.textContent = "Sync truth is temporarily unavailable; no completeness claim is being made.";
    grid.innerHTML = "";
    privacyStatement.textContent = "Privacy status could not be verified.";
    privacyList.innerHTML = "";
  }
}

async function loadPreferences() {
  try { applyPreferences(await fetchJSON("/api/v1/preferences", { cache: "no-store" })); } catch { applyPreferences(state.preferences); }
}

const deliveryPolicyLabel = (mode) => ({
  never: "Never automatic",
  draft: "Draft for review",
  countdown: "Safe countdown",
  safe: "Safe automatic policy",
  custom: "Custom policy",
})[mode] || "Not configured";

function renderAutonomy(autonomy) {
  state.autonomy = autonomy || null;
  const policy = document.querySelector("#autonomyPolicy");
  const consent = document.querySelector("#autonomyConsent");
  const delivery = document.querySelector("#autonomyDelivery");
  const status = document.querySelector("#autonomyStatus");
  const grant = document.querySelector("#grantAutoSendConsent");
  const revoke = document.querySelector("#revokeAutoSendConsent");
  const emergency = document.querySelector("#emergencyStopAutoSend");
  const readiness = document.querySelector("#autonomyReadiness");
  const authorized = autonomy?.executionConsent?.authorized === true;
  const summary = autonomySummary(autonomy);
  if (policy) policy.textContent = deliveryPolicyLabel(autonomy?.tenantDefault?.mode || autonomy?.tenantMode);
  if (consent) consent.textContent = authorized ? "Recorded for this account" : "Not granted";
  if (delivery) delivery.textContent = autonomy?.automaticSendAvailable === true ? "Available" : "Off";
  if (status) {
    const title = document.createElement("b");
    title.textContent = summary.title;
    status.replaceChildren(title, document.createTextNode(` ${summary.detail}`));
  }
  if (readiness) readiness.innerHTML = autonomyReadiness(autonomy).map((item) => `<li class="${item.ready ? "ready" : "required"}"><span>${escapeHtml(item.label)}</span><b>${item.ready ? "Ready" : "Required"}</b></li>`).join("");
  if (grant) grant.disabled = authorized;
  if (revoke) revoke.disabled = !authorized;
  if (emergency) emergency.disabled = !authorized;
}

async function loadAutonomy() {
  try {
    renderAutonomy(await fetchJSON("/api/v1/preferences?autonomy=policy", { cache: "no-store" }));
  } catch (error) {
    const status = document.querySelector("#autonomyStatus");
    if (status) status.textContent = error instanceof Error ? error.message : "Automatic delivery configuration is unavailable.";
  }
}

async function updateAutonomyConsent(action) {
  const messages = {
    grant: "Record execution consent for a future independently certified build? This development build will remain unable to send automatically.",
    revoke: "Revoke the saved automatic delivery consent for this account?",
    "emergency-stop": "Activate the emergency stop and revoke automatic delivery consent now?",
  };
  if (!messages[action] || !window.confirm(messages[action])) return;
  const buttons = ["#grantAutoSendConsent", "#revokeAutoSendConsent", "#emergencyStopAutoSend"].map((selector) => document.querySelector(selector)).filter(Boolean);
  buttons.forEach((button) => { button.disabled = true; });
  try {
    const saved = await fetchJSON(`/api/v1/preferences?autonomy=${encodeURIComponent(action)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        confirmed: true,
        consentVersion: state.autonomy?.executionConsent?.version || "auto-send-execution-consent.1",
        policyVersion: state.autonomy?.executionConsent?.policyVersion || "auto-send-policy.1",
      }),
    });
    renderAutonomy(saved);
    showToast(action === "grant" ? "Consent recorded; delivery remains locked" : action === "emergency-stop" ? "Emergency stop active" : "Consent revoked");
  } catch (error) {
    const status = document.querySelector("#autonomyStatus");
    if (status) status.textContent = error instanceof Error ? error.message : "The consent choice could not be saved.";
    await loadAutonomy();
  }
}

async function savePreferences(event) {
  event.preventDefault();
  const submit = settingsForm.querySelector('button[type="submit"]');
  const status = document.querySelector("#settingsStatus");
  submit.disabled = true;
  status.textContent = "Saving…";
  try {
    const saved = await fetchJSON("/api/v1/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        draftLanguage: settingsForm.elements.draftLanguage.value,
        replyLength: settingsForm.elements.replyLength.value,
        liveUpdates: settingsForm.elements.liveUpdates.checked,
        density: settingsForm.elements.density.value,
        defaultSendingMode: settingsForm.elements.defaultSendingMode.value,
      }),
    });
    applyPreferences(saved);
    await loadAutonomy();
    status.textContent = "Configuration saved on this device. Automatic delivery state was not changed.";
    showToast("Settings saved");
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Settings could not be saved.";
  } finally { submit.disabled = false; }
}

async function exportLocalState() {
  const status = document.querySelector("#settingsStatus");
  try {
    const response = await fetch("/api/v1/privacy/export", { cache: "no-store" });
    if (!response.ok) throw new Error("Export is unavailable.");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const header = response.headers.get("content-disposition") || "";
    const filename = /filename="(mycrobo-settings-[a-f0-9]{10}-\d{4}-\d{2}-\d{2}\.json)"/u.exec(header)?.[1];
    link.download = filename || `mycrobo-settings-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    status.textContent = "Local MyCrobo settings exported.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Export is unavailable.";
  }
}

async function resetLocalState() {
  const status = document.querySelector("#settingsStatus");
  if (!window.confirm("Reset MyCrobo preferences, conversation styles, task decisions and draft feedback on this device? WhatsApp history will remain.")) return;
  try {
    const response = await fetch("/api/v1/privacy/user-state", { method: "DELETE", headers: { "x-mycrobo-confirm": "DELETE LOCAL SETTINGS" } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Local metadata could not be reset.");
    await loadPreferences();
    await loadWorkspace({ silent: true });
    status.textContent = "MyCrobo metadata was reset. WhatsApp history was not deleted.";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Local metadata could not be reset.";
  }
}

async function removeLegacyRecovery() {
  const status = document.querySelector("#settingsStatus");
  if (!window.confirm("Permanently remove the pre-encryption SQLite recovery copies? The encrypted message and linked-device vaults will remain, but the old copies cannot be recovered.")) return;
  try {
    const response = await fetch("/api/v1/privacy/legacy-recovery", { method: "DELETE", headers: { "x-mycrobo-confirm": "DELETE PLAINTEXT RECOVERY" } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Migration recovery copies could not be removed.");
    status.textContent = `${readableBytes(payload.reclaimedBytes)} reclaimed. Encrypted vaults remain.`;
    await Promise.all([loadStorage(), loadProductTruth()]);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Migration recovery copies could not be removed.";
  }
}

function cancelDraftRequest() {
  const current = state.draftRequest;
  if (!current.controller) return;
  current.controller.abort();
  state.draftRequest = { sequence: current.sequence + 1, controller: null, chatId: null };
}

function clearConversation() {
  cancelDraftRequest();
  state.openEpoch += 1;
  state.selected = null;
  state.selectedLatestId = null;
  conversationHeader.innerHTML = '<div><span class="sectionLabel">Conversation</span><h2 id="conversationTitle" tabindex="-1">Choose a chat</h2><p>The latest message will be verified before it is shown.</p></div>';
  contextPanel.classList.add("hidden");
  contextPanel.innerHTML = "";
  messageList.innerHTML = '<div class="emptyState"><span class="emptyMark" aria-hidden="true">M</span><h2>Your conversations, without the clutter</h2><p>Select a chat to see its verified history and a reply recommendation.</p></div>';
  replyPanel.className = "replyPanel hidden";
  replyPanel.innerHTML = "";
  hideNewMessageNotice();
  if (state.chats.length) renderChats();
}

function contextItem(item) {
  return `<li><span>${escapeHtml(item.text)}</span><small>${item.speaker === "you" ? "From you" : "From the other person"}${item.observedAt ? ` · ${escapeHtml(new Date(item.observedAt).toLocaleString())}` : ""}</small></li>`;
}

async function loadIntelligence(chat, epoch) {
  try {
    const [payload, autonomy] = await Promise.all([
      fetchJSON(`/api/v1/chats/${encodeURIComponent(chat.id)}/intelligence`, { cache: "no-store" }),
      fetchJSON(`/api/v1/chats/${encodeURIComponent(chat.id)}/style?autonomy=policy`, { cache: "no-store" }),
    ]);
    if (state.selected?.id !== chat.id || state.openEpoch !== epoch) return;
    const context = payload.context || {};
    const dna = payload.dna || {};
    const style = payload.style || {};
    const external = payload.externalContext || {};
    const evidence = Number(dna.personSpecificEvidence || 0);
    const calendarCopy = ({
      busy: "Busy in your imported calendar at the requested time.",
      "free-in-imported-calendar": "No conflict appears in the imported calendar at the requested time.",
      "meridiem-unclear": "The message mentions a time but AM or PM is unclear.",
      "date-unclear": "The message mentions a time but the date is unclear.",
      "time-unclear": "The requested time is not specific enough to check safely.",
    })[external.calendar?.status];
    const externalMarkup = external.contact?.resolved || calendarCopy ? `<section><h3>Connected context</h3>${external.contact?.resolved ? `<p><b>${escapeHtml(external.contact.displayName)}</b> matched from your local contacts.</p>` : ""}${calendarCopy ? `<p>${escapeHtml(calendarCopy)} <small>Advisory only—no promise is added to a draft.</small></p>` : ""}</section>` : "";
    contextPanel.innerHTML = `<details class="contextCard">
      <summary><span><b>Conversation context</b><small>${escapeHtml(context.topic || "No current topic")}</small></span><span class="contextBadge">${context.reachedBeginning ? "Available history checked" : "Still learning"}</span></summary>
      <div class="contextBody">
        <section><h3>Current story</h3><p>${escapeHtml(context.topic || "No current topic")}</p><div class="contextFacts"><span>${escapeHtml(context.latestIntent || "unknown")} intent</span><span>${escapeHtml(context.conversationStatus || "unknown").replaceAll("_", " ")}</span><span>${escapeHtml(context.messageCount || 0)} saved messages</span></div>
          ${context.questions?.length ? `<h4>Open questions</h4><ul>${context.questions.map(contextItem).join("")}</ul>` : ""}
          ${context.commitments?.length ? `<h4>Current commitments</h4><ul>${context.commitments.map(contextItem).join("")}</ul>` : ""}
        </section>
        <section><h3>Communication DNA</h3><p>${escapeHtml(dna.note || "Learning from evidence in this relationship.")}</p><div class="dnaGrid"><div><b>${escapeHtml(dna.primaryWritingMode || "Unknown")}</b><span>writing mode</span></div><div><b>${escapeHtml(dna.relationshipContext || "unknown")}</b><span>relationship context</span></div><div><b>${escapeHtml(evidence)}</b><span>your replies studied</span></div><div><b>${escapeHtml(dna.medianReplyCharacters || 0)}</b><span>typical characters</span></div></div>
          <h4>Refine this conversation</h4><div class="styleStudio"><select id="chatStyleLanguage" aria-label="Conversation language"><option value="match">Match conversation</option><option>English</option><option>Roman Hindi</option><option>Roman Gujarati</option></select><select id="chatStyleLength" aria-label="Conversation reply length"><option value="match">Match length</option><option value="short">Short</option><option value="medium">Medium</option></select><select id="chatStyleFormality" aria-label="Conversation formality"><option value="match">Match formality</option><option value="casual">Casual</option><option value="neutral">Neutral</option><option value="formal">Formal</option></select><select id="chatSendingScope" aria-label="Delivery policy scope"><option value="chat">Only this conversation</option>${autonomy.relationshipPolicyAvailable ? '<option value="relationship">This person across direct chats</option>' : ""}</select><select id="chatSendingMode" aria-label="Conversation delivery policy"><option value="inherit">Use broader policy</option><option value="never">Never send automatically</option><option value="draft">Draft for my review</option><option value="countdown">Safe countdown</option><option value="safe">Safe automatic delivery</option><option value="custom">Custom policy</option></select><button type="button" id="saveChatStyle">Save</button></div><p class="styleStatus" id="chatStyleStatus">Policy changes are saved for this account. They cannot send until consent and every protected execution gate are ready.</p>
        </section>
        ${externalMarkup}
      </div>
    </details>`;
    contextPanel.classList.remove("hidden");
    const setValue = (id, value) => { const node = document.querySelector(id); if (node && [...node.options].some((option) => option.value === value)) node.value = value; };
    setValue("#chatStyleLanguage", style.language || "match"); setValue("#chatStyleLength", style.length || "match"); setValue("#chatStyleFormality", style.formality || "match"); setValue("#chatSendingScope", autonomy.selectedScope === "relationship" ? "relationship" : "chat"); setValue("#chatSendingMode", autonomy.selectedMode || style.sendingMode || "inherit");
    document.querySelector("#saveChatStyle")?.addEventListener("click", async (event) => {
      const button = event.currentTarget; button.disabled = true;
      const status = document.querySelector("#chatStyleStatus"); status.textContent = "Saving…";
      try {
        await fetchJSON(`/api/v1/chats/${encodeURIComponent(chat.id)}/style`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ language: document.querySelector("#chatStyleLanguage").value, length: document.querySelector("#chatStyleLength").value, formality: document.querySelector("#chatStyleFormality").value, sendingMode: document.querySelector("#chatSendingMode").value }) });
        const savedPolicy = await fetchJSON(`/api/v1/chats/${encodeURIComponent(chat.id)}/style?autonomy=policy`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope: document.querySelector("#chatSendingScope").value, mode: document.querySelector("#chatSendingMode").value }) });
        status.textContent = `Saved for ${savedPolicy.selectedScope === "relationship" ? "this person" : "this conversation"}. ${savedPolicy.automaticSendAvailable === true ? "Certified delivery is available, subject to fresh checks." : "Automatic delivery remains off until every protected execution gate is ready."}`;
      } catch (error) { status.textContent = error instanceof Error ? error.message : "Could not save."; }
      finally { button.disabled = false; }
    });
  } catch {
    if (state.selected?.id === chat.id && state.openEpoch === epoch) {
      contextPanel.classList.add("hidden");
      contextPanel.innerHTML = "";
    }
  }
}

async function fetchJSON(url, options = {}) {
  const token = localStorage.getItem("mycrobo.web.auth_token.v1");
  const headers = {
    ...(options.headers || {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
  const response = await fetch(url, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

function stamp(value) {
  if (!Number.isFinite(value)) return "Unknown date";
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function isAutoReplyEnabledGlobally() {
  return state.preferences.autoReplyEnabled === true || localStorage.getItem("mycrobo.globalAutoReply") === "on";
}

function getChatAutoReplyMode(chatId) {
  try {
    const override = localStorage.getItem(`mycrobo.chatAutoReply.${chatId}`);
    if (override === "on") return true;
    if (override === "off") return false;
  } catch {}
  return isAutoReplyEnabledGlobally();
}

function setChatAutoReplyMode(chatId, enabled) {
  try {
    localStorage.setItem(`mycrobo.chatAutoReply.${chatId}`, enabled ? "on" : "off");
  } catch {}
}

const autoReplyingChats = new Set();
const autoRepliedTargetMessageIds = new Set();

async function triggerAutoReplyForNewMessage(chat) {
  if (!chat || !chat.id) return;
  if (!getChatAutoReplyMode(chat.id)) return;
  if (autoReplyingChats.has(chat.id)) return;

  try {
    autoReplyingChats.add(chat.id);
    const history = await fetchJSON(`/api/v1/chats/${encodeURIComponent(chat.id)}/messages?limit=10`, { cache: "no-store" });
    const targetMessageId = draftTargetId(history);
    const exactSourceMessageId = history.latestSource?.id || targetMessageId;
    if (!exactSourceMessageId) return;

    // Chat Analysis 1: verify the message is incoming from contact
    const latestEvent = history.latestSource || history.latest;
    if (latestEvent?.direction !== "contact") return;

    // Chat Analysis 2: deduplication check
    if (autoRepliedTargetMessageIds.has(exactSourceMessageId)) return;

    // Chat Analysis 3: verify reply need (don't reply if no reply needed)
    const decision = history.reply;
    if (decision && decision.status === "waiting-for-latest") return;
    if (decision && decision.shouldDraft === false) {
      autoRepliedTargetMessageIds.add(exactSourceMessageId);
      return;
    }

    if (state.selected?.id === chat.id && replyPanel) {
      replyPanel.className = "replyPanel waiting";
      replyPanel.innerHTML = `<div><b>Auto-reply active</b><p>Analyzing conversation and preparing AI reply for ${escapeHtml(shownTitle(chat))}…</p></div>`;
    }

    const response = await fetch(`/api/v1/chats/${encodeURIComponent(chat.id)}/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetMessageId: exactSourceMessageId }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      if (state.selected?.id === chat.id && replyPanel) {
        replyPanel.className = "replyPanel error";
        replyPanel.innerHTML = `<div><b>Auto-reply paused</b><p>${escapeHtml(payload.error || "A draft could not be generated.")}</p></div>`;
      }
      return;
    }
    const payload = await response.json();
    const draftText = String(payload.draft || "").trim();
    if (!draftText) return;

    if (/\[(?:time|date|name|price|amount|location)\]/iu.test(draftText)) {
      if (state.selected?.id === chat.id && replyPanel) {
        replyPanel.className = "replyPanel waiting";
        replyPanel.innerHTML = `<div><b>Auto-reply held for review</b><p>Reply contains placeholders that need your input.</p></div>`;
      }
      return;
    }

    autoRepliedTargetMessageIds.add(exactSourceMessageId);

    if (state.selected?.id === chat.id && replyPanel) {
      replyPanel.className = "replyPanel waiting";
      replyPanel.innerHTML = `<div><b>Sending auto-reply…</b><p>${escapeHtml(draftText)}</p></div>`;
    }

    const idempotencyKey = crypto.randomUUID();
    let receipt;
    if (window.mycroboDesktop?.sendExact) {
      receipt = await window.mycroboDesktop.sendExact({
        chatId: chat.id,
        recipient: shownTitle(chat),
        body: draftText,
        targetMessageId: exactSourceMessageId,
        idempotencyKey,
      });
    } else {
      const approval = await fetchJSON(`/api/v1/chats/${encodeURIComponent(chat.id)}/send-approval`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: draftText, targetMessageId: exactSourceMessageId, idempotencyKey }),
      });
      receipt = await fetchJSON(`/api/v1/chats/${encodeURIComponent(chat.id)}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: draftText, targetMessageId: exactSourceMessageId, idempotencyKey, approvalToken: approval.approval_token }),
      });
    }

    showToast(`Auto-reply sent to ${shownTitle(chat)}!`);
    if (state.selected?.id === chat.id) {
      replyPanel.className = "replyPanel sent";
      replyPanel.innerHTML = `<div><b>Auto-reply sent</b><p>${escapeHtml(draftText)}</p></div>`;
      setTimeout(() => {
        if (state.selected?.id === chat.id) void openChat(chat, { preserveViewport: true });
      }, 1500);
    }
  } catch (error) {
    console.error("Auto-reply failed:", error);
    if (state.selected?.id === chat.id && replyPanel) {
      replyPanel.className = "replyPanel error";
      replyPanel.innerHTML = `<div><b>Auto-reply error</b><p>${escapeHtml(error instanceof Error ? error.message : "Auto-reply could not be sent.")}</p></div>`;
    }
  } finally {
    autoReplyingChats.delete(chat.id);
  }
}

function attachChatAutoReplyListener(chat) {
  const toggle = document.querySelector("#chatAutoReplySwitch");
  if (!toggle) return;
  toggle.onchange = (event) => {
    const isNowOn = event.target.checked;
    setChatAutoReplyMode(chat.id, isNowOn);
    const badge = document.querySelector("#chatAutoReplyBadge");
    if (badge) {
      badge.textContent = isNowOn ? "ON" : "OFF";
      badge.className = `chatAutoReplyBadge ${isNowOn ? "on" : "off"}`;
    }
    showToast(isNowOn ? `Auto-reply turned ON for ${shownTitle(chat)}` : `Auto-reply turned OFF for ${shownTitle(chat)}`);
  };
}

function conversationTitle(chat, detail) {
  const title = shownTitle(chat);
  const isAutoReplyOn = getChatAutoReplyMode(chat.id);
  return `<button class="mobileBack" id="backToChats" type="button" aria-label="Back to chats">←</button><div class="conversationHeadingWrap"><span class="sectionLabel">Conversation</span><h2 id="conversationTitle" tabindex="-1" title="${escapeHtml(title)}">${escapeHtml(title)}</h2><p>${escapeHtml(detail)}</p></div><div class="conversationAutoReplyControl"><label class="chatAutoReplyToggleLabel" title="Turn auto-reply on or off for this conversation"><span class="chatAutoReplyLabelText">Auto-reply</span><input type="checkbox" id="chatAutoReplySwitch" class="chatAutoReplySwitch" ${isAutoReplyOn ? "checked" : ""} aria-label="Toggle auto-reply for this conversation" /><span class="chatAutoReplyBadge ${isAutoReplyOn ? "on" : "off"}" id="chatAutoReplyBadge">${isAutoReplyOn ? "ON" : "OFF"}</span></label></div>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function mediaLabel(message) {
  const category = message?.media?.category || message?.kind || "media";
  return ({ image: "Photo", video: "Video", audio: "Audio", document: "Document", sticker: "Sticker", view_once: "View-once media", media: "Media" })[category] || "Media";
}

function chatPreview(chat) {
  if (chat.latest?.text) return shownPreview(chat);
  if (chat.latest?.media || ["image", "video", "audio", "document", "sticker", "view_once", "media"].includes(chat.latest?.kind)) return mediaLabel(chat.latest);
  return "No message preview";
}

function mergeMessages(...pages) {
  const unique = new Map();
  for (const message of pages.flat()) if (message?.id) unique.set(message.id, message);
  return [...unique.values()].sort((left, right) => (left.timestampMs - right.timestampMs) || ((left.sequence || 0) - (right.sequence || 0)) || String(left.id).localeCompare(String(right.id)));
}

function dayLabel(timestampMs) {
  if (!Number.isFinite(timestampMs)) return "Unknown date";
  const date = new Date(timestampMs);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const key = date.toDateString();
  if (key === today.toDateString()) return "Today";
  if (key === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { dateStyle: "medium" });
}

function renderConversationMessages(chat, messages, nextBefore) {
  let previousDay = "";
  let previousDirection = "";
  const rows = [];
  if (nextBefore) rows.push(`<button class="loadEarlier" data-load-earlier="${escapeHtml(nextBefore)}">Load earlier messages</button>`);
  for (const message of messages) {
    const currentDay = Number.isFinite(message.timestampMs) ? new Date(message.timestampMs).toDateString() : "unknown";
    if (currentDay !== previousDay) {
      rows.push(`<div class="dateSeparator"><span>${escapeHtml(dayLabel(message.timestampMs))}</span></div>`);
      previousDay = currentDay;
      previousDirection = "";
    }
    const speaker = shownSender(message, chat);
    const continued = previousDirection === message.direction;
    rows.push(`<article class="message ${message.direction} ${message.media ? "hasMedia" : ""} ${continued ? "continued" : ""}" data-message-id="${escapeHtml(message.id)}" aria-label="${escapeHtml(speaker)}"><strong class="sender">${message.direction === "owner" ? "You" : escapeHtml(speaker)}</strong>${renderMessageBody(message)}<time>${escapeHtml(stamp(message.timestampMs))}</time></article>`);
    previousDirection = message.direction;
  }
  messageList.innerHTML = rows.join("") || '<div class="empty">No saved messages.</div>';
}

async function loadEarlierMessages(chat) {
  const saved = state.historyByChat.get(chat.id);
  if (!saved?.nextBefore) return;
  const button = messageList.querySelector("[data-load-earlier]");
  if (button) { button.disabled = true; button.textContent = "Loading earlier messages…"; }
  const viewport = captureAnchor(messageList, "[data-message-id]", "messageId");
  try {
    const page = await fetchJSON(`/api/v1/chats/${encodeURIComponent(chat.id)}/messages?limit=200&before=${encodeURIComponent(saved.nextBefore)}`, { cache: "no-store" });
    if (state.selected?.id !== chat.id) return;
    const merged = mergeMessages(page.messages || [], saved.messages || []);
    const updated = { ...saved, messages: merged, nextBefore: page.nextBefore || null };
    state.historyByChat.set(chat.id, updated);
    renderConversationMessages(chat, merged, updated.nextBefore);
    restoreAnchor(messageList, "[data-message-id]", "messageId", viewport);
  } catch (error) {
    if (button) { button.disabled = false; button.textContent = error instanceof Error ? "Could not load earlier messages · Try again" : "Try loading earlier messages again"; }
  }
}

function renderMessageBody(message) {
  const media = message?.media;
  const caption = String(message?.text || "").trim();
  if (!media) return `<p>${escapeHtml(caption)}</p>`;
  const presentation = mediaPresentation(message);
  const label = presentation.label;
  let visual;
  if (presentation.kind === "image") {
    visual = `<button type="button" class="imagePreview" data-media-url="${escapeHtml(presentation.viewUrl)}" data-media-kind="image" data-media-label="${escapeHtml(caption || label)}" aria-label="Open ${escapeHtml(label)}"><img src="${escapeHtml(presentation.viewUrl)}" alt="${escapeHtml(caption || `${label} shared in chat`)}" loading="lazy" decoding="async" /><span>${presentation.fullAvailable ? "View photo" : "Preview photo"}</span></button><p class="mediaPlaybackStatus" role="status"></p>${presentation.canRetry ? `<button type="button" class="mediaRetry mediaFetchFull" data-media-retry-id="${escapeHtml(message.id)}">${escapeHtml(presentation.retryLabel)}</button>` : ""}`;
  } else if (presentation.kind === "video") {
    visual = `<div class="videoPreview"><video class="inlineVideo" controls preload="metadata" src="${escapeHtml(presentation.viewUrl)}" aria-label="${escapeHtml(caption || "Video shared in chat")}"></video><button type="button" class="mediaExpand" data-media-url="${escapeHtml(presentation.viewUrl)}" data-media-kind="video" data-media-label="${escapeHtml(caption || presentation.fileName || "Chat video")}">Open larger</button><p class="mediaPlaybackStatus" role="status"></p></div>`;
  } else if (presentation.kind === "audio") {
    visual = `<div class="audioPreview"><strong>${escapeHtml(presentation.fileName || "Voice message")}</strong><audio controls preload="metadata" src="${escapeHtml(presentation.viewUrl)}" aria-label="${escapeHtml(caption || "Audio shared in chat")}"></audio><p class="mediaPlaybackStatus" role="status"></p></div>`;
  } else if (presentation.kind === "pdf") {
    visual = `<button class="documentPreview" data-media-url="${escapeHtml(presentation.viewUrl)}" data-media-kind="pdf" data-media-label="${escapeHtml(presentation.fileName)}" aria-label="Open ${escapeHtml(presentation.fileName)}"><span class="fileIcon">PDF</span><span><strong>${escapeHtml(presentation.fileName)}</strong><small>Saved locally for private viewing</small></span><span class="openLabel">Open PDF</span></button>`;
  } else {
    visual = `<div class="mediaPlaceholder"${presentation.pending ? ' data-media-pending="true"' : ""}><strong>${escapeHtml(presentation.fileName || label)}</strong><small>${escapeHtml(presentation.detail)}</small>${presentation.canRetry ? `<button type="button" class="mediaRetry" data-media-retry-id="${escapeHtml(message.id)}">${escapeHtml(presentation.retryLabel || "Fetch attachment")}</button>` : ""}</div>`;
  }
  return `${visual}${caption ? `<p class="mediaCaption">${escapeHtml(caption)}</p>` : ""}`;
}

function renderChats() {
  const visible = state.chats.slice(0, state.chatVisibleCount);
  const signature = signatureOf({ selected: state.selected?.id || null, visibleCount: state.chatVisibleCount, total: state.chats.length, chats: visible.map((chat) => ({ id: chat.id, title: shownTitle(chat), preview: chatPreview(chat), timestampMs: chat.latest?.timestampMs || null })) });
  if (signature === state.chatRenderSignature) return false;
  const viewport = captureAnchor(chatList, "[data-chat-id]", "chatId");
  const focusedChatId = document.activeElement?.closest?.("[data-chat-id]")?.dataset?.chatId || null;
  const more = state.chats.length > visible.length
    ? `<button type="button" class="showMoreChats" data-show-more-chats>Show more conversations <small>${visible.length} of ${state.chats.length}</small></button>`
    : "";
  chatList.innerHTML = visible.length ? `${visible.map((chat) => `
    <button class="chatRow ${state.selected?.id === chat.id ? "selected" : ""}" data-chat-id="${escapeHtml(chat.id)}">
      <span class="avatar">${escapeHtml(shownTitle(chat).slice(0, 1).toUpperCase())}</span>
      <span class="chatSummary"><strong>${escapeHtml(shownTitle(chat))}</strong><small>${escapeHtml(chatPreview(chat))}</small></span>
      <time>${chat.latest ? escapeHtml(stamp(chat.latest.timestampMs)) : ""}</time>
    </button>`).join("")}${more}` : `<div class="empty">${state.query.trim() ? "No matching conversations." : "No readable conversations yet."}</div>`;
  state.chatRenderSignature = signature;
  restoreAnchor(chatList, "[data-chat-id]", "chatId", viewport);
  if (focusedChatId) [...chatList.querySelectorAll("[data-chat-id]")].find((node) => node.dataset.chatId === focusedChatId)?.focus({ preventScroll: true });
  return true;
}

async function loadChats({ silent = false, force = false } = {}) {
  if (silent && !force && state.loadingChats) return state.chatRequest.promise || true;
  state.chatRequest.controller?.abort();
  const controller = new AbortController();
  const sequence = ++state.chatRequest.sequence;
  state.chatRequest.controller = controller;
  state.loadingChats = true;
  let succeeded = false;
  if (!silent && !state.chats.length) chatList.innerHTML = '<div class="empty">Loading chats…</div>';
  if (!silent) {
    refreshChatsButton.disabled = true;
    refreshChatsButton.setAttribute("aria-busy", "true");
  }
  const promise = (async () => {
    try {
      const query = state.query.trim();
      const endpoint = [...query].length >= 2
        ? `/api/v1/search?collection=${state.collection}&q=${encodeURIComponent(query)}`
        : `/api/v1/chats?collection=${state.collection}`;
      const payload = await fetchJSON(endpoint, { cache: "no-store", signal: controller.signal });
      if (sequence !== state.chatRequest.sequence) return false;
      state.chats = presentChats(payload.chats);
      if (state.chats.length) state.hasSavedChats = true;
      const refreshedSelection = state.selected && state.chats.find((chat) =>
        chat.id === state.selected.id
        || chat.connectorIds?.includes(state.selected.id)
        || state.selected.connectorIds?.includes(chat.id)
      );
      if (refreshedSelection) state.selected = { ...state.selected, ...refreshedSelection };
      renderChats();
      succeeded = true;
    } catch (error) {
      if (error?.name !== "AbortError" && !silent) chatList.innerHTML = `<div class="empty errorText">${escapeHtml(error instanceof Error ? error.message : "Chats could not be loaded.")}</div>`;
    } finally {
      if (sequence === state.chatRequest.sequence) {
        state.loadingChats = false;
        state.chatRequest.controller = null;
        state.chatRequest.promise = null;
        if (!silent) {
          refreshChatsButton.disabled = false;
          refreshChatsButton.setAttribute("aria-busy", "false");
        }
      }
    }
    return succeeded;
  })();
  state.chatRequest.promise = promise;
  return promise;
}

async function openChat(chat, { preserveViewport = false, acknowledgeNewMessages = false, focusConversation = false } = {}) {
  if (state.draftRequest.chatId && (!preserveViewport || state.draftRequest.chatId !== chat.id)) cancelDraftRequest();
  const viewport = preserveViewport ? captureAnchor(messageList, "[data-message-id]", "messageId") : null;
  const wasAtBottom = !preserveViewport || nearBottom(messageList);
  const savedDraft = state.drafts.get(chat.id) || null;
  const epoch = ++state.openEpoch;
  state.selected = chat;
  state.selectedLatestId = null;
  renderChats();
  conversationHeader.innerHTML = conversationTitle(chat, "Checking the exact latest message…");
  if (!preserveViewport) {
    contextPanel.classList.add("hidden");
    contextPanel.innerHTML = "";
  }
  if (!preserveViewport) {
    messageList.innerHTML = '<div class="latestGate"><b>Verifying the latest message</b><p>Saved history is withheld until the connector confirms this exact conversation.</p></div>';
    replyPanel.className = "replyPanel hidden";
  }
  try {
    let history = await fetchJSON(`/api/v1/chats/${encodeURIComponent(chat.id)}/messages?limit=200`, { cache: "no-store" });
    if (history.latest?.id && !history.messages.some((message) => message.id === history.latest.id)) {
      history = await fetchJSON(`/api/v1/chats/${encodeURIComponent(chat.id)}/messages?limit=200`, { cache: "no-store" });
    }
    if (state.selected?.id !== chat.id || state.openEpoch !== epoch) return;
    const conversationStatus = conversationStatusPresentation(history.watermark, history.messages.length);
    const current = conversationStatus.current;
    conversationHeader.innerHTML = conversationTitle(chat, conversationStatus.label);
    const priorHistory = preserveViewport ? state.historyByChat.get(chat.id) : null;
    const renderedMessages = mergeMessages(priorHistory?.messages || [], history.messages || []);
    const renderedNextBefore = priorHistory ? priorHistory.nextBefore : (history.nextBefore || null);
    state.historyByChat.set(chat.id, { messages: renderedMessages, nextBefore: renderedNextBefore, watermark: history.watermark });
    renderConversationMessages(chat, renderedMessages, renderedNextBefore);
    void loadIntelligence(chat, epoch);
    state.selectedLatestId = history.latestSource?.id || history.latest?.id || null;
    const latestEvent = history.latestSource || history.latest || renderedMessages.at(-1) || null;
    if (latestEvent) {
      const chatInList = state.chats.find((c) =>
        c.id === chat.id
        || c.connectorIds?.includes(chat.id)
        || chat.connectorIds?.includes(c.id)
      );
      if (chatInList) {
        const existingStamp = Number(chatInList.latest?.timestampMs || 0);
        const newStamp = Number(latestEvent.timestampMs || 0);
        if (newStamp >= existingStamp || !chatInList.latest) {
          chatInList.latest = latestEvent;
          state.chats = presentChats(state.chats);
          renderChats();
        }
      }
    }
    if (acknowledgeNewMessages) {
      messageList.scrollTop = messageList.scrollHeight;
    } else if (preserveViewport && !wasAtBottom) {
      restoreAnchor(messageList, "[data-message-id]", "messageId", viewport);
    } else {
      messageList.scrollTop = messageList.scrollHeight;
    }
    hideNewMessageNotice();
    const decision = history.reply || { shouldDraft: false, status: "waiting-for-latest", reason: "The exact latest message has not been verified yet." };
    const waiting = !current || decision.status === "waiting-for-latest";
    const targetMessageId = draftTargetId(history);
    const exactSourceMessageId = history.latestSource?.id || targetMessageId;
    replyPanel.className = `replyPanel ${waiting ? "waiting" : decision.shouldDraft ? "recommended" : "notNeeded"}`;
    const optionalIncoming = !decision.shouldDraft && history.latest?.direction === "contact" && history.latest?.id === exactSourceMessageId;
    const decisionLabel = waiting
      ? "Waiting for current messages"
      : decision.shouldDraft
        ? "Reply recommended"
        : decision.category === "optional-acknowledgement"
          ? "Reply optional"
          : decision.category === "cannot-decide-without-media"
            ? "View the attachment first"
            : "No reply needed";
    const canWriteManually = Boolean(exactSourceMessageId);
    const actions = !canWriteManually ? "" : `<div class="draftActions">${!waiting && decision.shouldDraft ? '<button id="draftButton">Draft reply</button>' : !waiting && optionalIncoming ? '<button id="draftAnyway">Draft anyway</button>' : ""}<button class="secondary" id="writeReply">${decision.shouldDraft || optionalIncoming || history.latestSource?.direction === "contact" ? "Write my own" : "Write another message"}</button></div>`;
    replyPanel.innerHTML = `<div><b>${decisionLabel}</b><p>${escapeHtml(decision.reason)}</p></div>${actions}`;
    document.querySelector("#draftButton")?.addEventListener("click", () => void draftReply(chat, targetMessageId));
    document.querySelector("#draftAnyway")?.addEventListener("click", () => void draftReply(chat, targetMessageId, { draftAnyway: true }));
    document.querySelector("#writeReply")?.addEventListener("click", () => showComposer(chat, exactSourceMessageId, "", decision.shouldDraft || optionalIncoming || history.latestSource?.direction === "contact" ? "Your reply" : "Your follow-up"));
    if (savedDraft) {
      const targetChanged = savedDraft.targetMessageId !== exactSourceMessageId;
      showComposer(chat, exactSourceMessageId, savedDraft.body, savedDraft.label, {
        safetyNote: targetChanged || preserveViewport || savedDraft.pendingNewMessages ? "New messages arrived. Your writing was kept; review the conversation and edit it before sending." : savedDraft.safetyNote,
        alternatives: savedDraft.alternatives,
        draftId: savedDraft.draftId,
        draftLearningId: savedDraft.draftLearningId,
        shownBody: savedDraft.shownBody,
        requiredInputs: savedDraft.requiredInputs,
        inputValues: savedDraft.inputValues,
      });
      if (preserveViewport && !acknowledgeNewMessages && (targetChanged || savedDraft.pendingNewMessages)) {
        showNewMessageNotice(chat, exactSourceMessageId, "New messages");
      }
    }
    attachChatAutoReplyListener(chat);
    if (focusConversation) conversationHeader.querySelector("#conversationTitle")?.focus({ preventScroll: true });
    return true;
  } catch (error) {
    if (state.selected?.id !== chat.id || state.openEpoch !== epoch) return;
    if (preserveViewport) {
      conversationHeader.innerHTML = conversationTitle(chat, "Update could not be verified · your current view was kept");
      attachChatAutoReplyListener(chat);
      showNewMessageNotice(chat, state.pendingLatestId, "Try update again");
      return false;
    }
    conversationHeader.innerHTML = conversationTitle(chat, "Saved history could not be verified");
    attachChatAutoReplyListener(chat);
    messageList.innerHTML = `<div class="latestGate"><b>Could not verify this conversation</b><p>${escapeHtml(error instanceof Error ? error.message : "Try again.")}</p></div>`;
    replyPanel.className = "replyPanel error";
    replyPanel.innerHTML = '<div><b>Drafting is paused</b><p>MyCrobo will not draft from an unverified latest message.</p></div><button id="retryChat">Try again</button>';
    document.querySelector("#retryChat")?.addEventListener("click", () => void openChat(chat));
    return false;
  }
}

async function refreshSelectedLatest() {
  const chat = state.selected;
  if (!chat || document.visibilityState !== "visible") return;
  try {
    const latest = await fetchJSON(`/api/v1/chats/${encodeURIComponent(chat.id)}/latest`, { cache: "no-store" });
    const latestId = latest.latestSource?.id || latest.latest?.id;
    const latestChanged = Boolean(latestId && latestId !== state.selectedLatestId);
    const hasPendingMedia = Boolean(messageList.querySelector('[data-media-pending="true"]'));
    if (state.selected?.id === chat.id && (latestChanged || hasPendingMedia)) {
      if (document.querySelector("#draftText") || !nearBottom(messageList)) {
        if (latestChanged) showNewMessageNotice(chat, latestId, "New messages");
        return;
      }
      await openChat(chat, { preserveViewport: true });
    }
  } catch {
    // The visible conversation keeps its saved-history label; the next poll retries.
  }
}

let isRefreshingEverything = false;
async function refreshEverything() {
  if (isRefreshingEverything) return;
  isRefreshingEverything = true;
  setRefreshButton(refreshChatsButton, true);
  const selected = state.selected;
  try {
    chatsStarted = true;
    state.hasSavedChats = null;
    await refreshStatus().catch(() => null);
    const [chatsUpdated] = await Promise.all([
      loadChats({ force: true, silent: true }),
      loadWorkspace({ force: true, silent: true }).catch(() => false),
    ]);
    const activeSelected = state.selected || selected;
    const conversationUpdated = activeSelected
      ? await openChat(activeSelected, { preserveViewport: true, acknowledgeNewMessages: true }).catch(() => false)
      : true;
    if (chatsUpdated === false) throw new Error("Chats could not be refreshed. Your current view was kept.");
    showToast(selected ? "Latest messages checked. Open conversation updated." : "Your conversation list is up to date.");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Refresh could not finish. Your current view was kept.");
  } finally {
    isRefreshingEverything = false;
    setRefreshButton(refreshChatsButton, false);
  }
}

async function retryMedia(messageId, button) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "Fetching…";
  try {
    await fetchJSON(`/api/v1/media/${encodeURIComponent(messageId)}/retry`, { method: "POST" });
    button.textContent = "Fetching in background…";
    showToast("Attachment fetch started. It will appear here when ready.");
    for (const delay of [900, 2_000, 5_000]) {
      setTimeout(() => { if (state.selected) void openChat(state.selected, { preserveViewport: true }); }, delay);
    }
  } catch (error) {
    button.disabled = false;
    button.textContent = original;
    showToast(error instanceof Error ? error.message : "Attachment could not be fetched.");
  }
}

async function draftReply(chat, targetMessageId, { draftAnyway = false, localOnly = false } = {}) {
  cancelDraftRequest();
  const sequence = state.draftRequest.sequence + 1;
  const controller = new AbortController();
  state.draftRequest = { sequence, controller, chatId: chat.id };
  const button = document.querySelector(localOnly ? "#localDraftButton" : draftAnyway ? "#draftAnyway" : "#draftButton")
    || document.querySelector(draftAnyway ? "#draftAnyway" : "#draftButton");
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = localOnly ? "Creating private draft…" : "Drafting…";
  }
  const actions = button?.closest(".draftActions");
  let localButton = actions?.querySelector("#localDraftButton") || null;
  if (!localOnly && actions && !localButton) {
    localButton = document.createElement("button");
    localButton.type = "button";
    localButton.id = "localDraftButton";
    localButton.className = "secondary draftRecovery hidden";
    localButton.textContent = "Use instant private draft";
    actions.insertBefore(localButton, actions.lastElementChild);
    localButton.addEventListener("click", () => void draftReply(chat, targetMessageId, { draftAnyway, localOnly: true }), { once: true });
  }
  let timedOut = false;
  const progressTimer = setTimeout(() => {
    if (state.draftRequest.sequence !== sequence || state.selected?.id !== chat.id) return;
    if (button?.isConnected) button.textContent = "Enhanced draft still working…";
    localButton?.classList.remove("hidden");
  }, DRAFT_PROGRESS_MS);
  const timeoutTimer = setTimeout(() => {
    if (state.draftRequest.sequence !== sequence) return;
    timedOut = true;
    controller.abort();
  }, localOnly ? LOCAL_DRAFT_TIMEOUT_MS : DRAFT_TIMEOUT_MS);
  try {
    const response = await fetch(`/api/v1/chats/${encodeURIComponent(chat.id)}/draft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetMessageId, draftAnyway, localOnly }),
      signal: controller.signal,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "A draft could not be created.");
    if (state.draftRequest.sequence !== sequence || state.selected?.id !== chat.id || payload.targetMessageId !== targetMessageId) return;
    showComposer(chat, targetMessageId, payload.draft, draftRouteLabel(payload, shownTitle(chat)), {
      safetyNote: payload.safetyNote,
      alternatives: payload.alternatives,
      draftId: crypto.randomUUID(),
      draftLearningId: payload.draftLearningId || "",
      requiredInputs: payload.requiredInputs,
    });
  } catch (error) {
    if (state.draftRequest.sequence !== sequence || (error?.name === "AbortError" && !timedOut) || state.selected?.id !== chat.id) return;
    const message = timedOut
      ? localOnly
        ? "The private draft could not finish promptly. Nothing was sent. Try again or write your own reply."
        : "The enhanced draft did not finish within nine seconds and was stopped. Nothing was sent. Try again or use the instant private draft."
      : error instanceof Error ? error.message : "A draft could not be created.";
    replyPanel.className = "replyPanel error";
    replyPanel.innerHTML = `<div><b>Draft unavailable</b><p>${escapeHtml(message)}</p></div><div class="draftActions"><button class="secondary" id="retryDraft">Try again</button><button id="localDraftButton">Use instant private draft</button></div>`;
    document.querySelector("#retryDraft")?.addEventListener("click", () => void draftReply(chat, targetMessageId, { draftAnyway }));
    document.querySelector("#localDraftButton")?.addEventListener("click", () => void draftReply(chat, targetMessageId, { draftAnyway, localOnly: true }));
  } finally {
    clearTimeout(progressTimer);
    clearTimeout(timeoutTimer);
    if (button?.isConnected) {
      button.removeAttribute("aria-busy");
      button.disabled = false;
    }
    if (state.draftRequest.sequence === sequence) state.draftRequest = { sequence, controller: null, chatId: null };
  }
}

function formatStructuredInput(type, value) {
  if (!value) return "";
  if (type === "time" && /^\d{2}:\d{2}$/u.test(value)) {
    const [hour, minute] = value.split(":").map(Number);
    const suffix = hour >= 12 ? "pm" : "am";
    return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${suffix}`;
  }
  if (type === "date" && /^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    const date = new Date(`${value}T12:00:00`);
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
  }
  return value;
}

function showComposer(chat, targetMessageId, text, label, { safetyNote = "", alternatives = [], draftId = "", draftLearningId = "", shownBody = text, requiredInputs = [], inputValues = {} } = {}) {
  const safeAlternatives = Array.isArray(alternatives) ? alternatives.filter((item) => typeof item === "string" && item.trim() && item !== text).slice(0, 3) : [];
  const safeInputs = Array.isArray(requiredInputs) ? requiredInputs.filter((item) => item && ["date", "time"].includes(item.key) && item.type === item.key && item.token === `{{${item.key}}}`).slice(0, 2) : [];
  const values = Object.fromEntries(safeInputs.map((item) => [item.key, typeof inputValues?.[item.key] === "string" ? inputValues[item.key] : ""]));
  const renderedValues = Object.fromEntries(safeInputs.map((item) => [item.key, formatStructuredInput(item.type, values[item.key])]));
  const feedbackId = draftId || crypto.randomUUID();
  state.drafts.set(chat.id, { body: text, shownBody, label, targetMessageId, safetyNote, alternatives: safeAlternatives, draftId: feedbackId, draftLearningId, requiredInputs: safeInputs, inputValues: values });
  replyPanel.className = "replyPanel draftReady";
  const variantButtons = safeAlternatives.map((_, index) => `<button type="button" class="draftChip" data-draft-variant="${index}">Alternative ${index + 1}</button>`).join("");
  const structuredFields = safeInputs.length ? `<div class="structuredInputs"><span>Only add the missing ${safeInputs.map((item) => item.label.toLocaleLowerCase()).join(" and ")}</span>${safeInputs.map((item) => `<label><b>${escapeHtml(item.label)}</b><input type="${item.type}" data-structured-input="${item.key}" value="${escapeHtml(values[item.key])}" aria-label="${escapeHtml(item.label)} for this reply" /></label>`).join("")}</div>` : "";
  replyPanel.innerHTML = `<div class="draftEditor"><label for="draftText">${escapeHtml(label)}</label>${structuredFields}<textarea id="draftText" maxlength="800" placeholder="Write the exact message you want to send">${escapeHtml(text)}</textarea>${variantButtons ? `<div class="draftTools"><span>Other safe options</span>${variantButtons}</div>` : ""}<div class="draftFeedback"><button type="button" class="feedbackToggle" id="feedbackToggle">Help MyCrobo improve</button><div class="feedbackChoices hidden" id="feedbackChoices"><button type="button" data-feedback="wrong-tone">Tone</button><button type="button" data-feedback="wrong-fact">Fact</button><button type="button" data-feedback="wrong-language">Language</button><button type="button" data-feedback="too-long">Too long</button><button type="button" data-feedback="no-reply">No reply needed</button></div></div><p id="composerHelp">${escapeHtml(safetyNote || (state.sendAvailable ? "Edit freely. Your Send click is the only approval." : "You can write and copy this now. Sending will appear when WhatsApp is fully current."))}</p><p class="sendError" id="composerError"></p></div><div class="draftActions"><button class="secondary" id="copyDraft">Copy</button><button class="secondary" id="discardDraft">Discard</button>${state.sendAvailable ? `<button id="sendEditedReply" disabled>Send to ${escapeHtml(shownTitle(chat))}</button>` : '<button disabled title="WhatsApp must be fully current before sending">Send reconnecting…</button>'}</div>`;
  const editor = document.querySelector("#draftText");
  const sendButton = document.querySelector("#sendEditedReply");
  const help = document.querySelector("#composerHelp");
  const errorNode = document.querySelector("#composerError");
  const update = () => {
    const composer = composerSendState(editor.value);
    state.drafts.set(chat.id, { body: editor.value, shownBody, label, targetMessageId, safetyNote: help.textContent || safetyNote, alternatives: safeAlternatives, draftId: feedbackId, draftLearningId, requiredInputs: safeInputs, inputValues: values });
    if (sendButton) sendButton.disabled = !composer.canSend;
    if (composer.unresolved.length) help.textContent = "Replace the missing current fact before sending. MyCrobo did not infer it from older replies.";
    else help.textContent = safetyNote || (state.sendAvailable ? "Edit freely. Your Send click is the only approval." : "You can write and copy this now. Sending will appear when WhatsApp is fully current.");
    errorNode.textContent = "";
  };
  editor.addEventListener("input", update);
  document.querySelectorAll("[data-structured-input]").forEach((input) => input.addEventListener("input", () => {
    const definition = safeInputs.find((item) => item.key === input.dataset.structuredInput);
    if (!definition) return;
    const previous = renderedValues[definition.key];
    values[definition.key] = input.value;
    const rendered = formatStructuredInput(definition.type, input.value);
    if (editor.value.includes(definition.token)) editor.value = editor.value.replace(definition.token, rendered || definition.token);
    else if (previous && editor.value.includes(previous)) editor.value = editor.value.replace(previous, rendered || definition.token);
    renderedValues[definition.key] = rendered;
    update();
  }));
  update();
  document.querySelector("#copyDraft")?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(editor.value);
    document.querySelector("#copyDraft").textContent = "Copied";
  });
  document.querySelector("#discardDraft")?.addEventListener("click", () => {
    void recordDraftOutcome(chat.id, targetMessageId, draftLearningId, { event: "dismissed" });
    state.drafts.delete(chat.id);
    void openChat(chat);
  });
  document.querySelectorAll("[data-draft-variant]").forEach((button) => button.addEventListener("click", () => {
    const chosen = safeAlternatives[Number(button.dataset.draftVariant)];
    if (!chosen) return;
    editor.value = chosen;
    for (const definition of safeInputs) {
      if (values[definition.key] && editor.value.includes(definition.token)) editor.value = editor.value.replace(definition.token, renderedValues[definition.key]);
    }
    update();
    editor.focus();
  }));
  document.querySelector("#feedbackToggle")?.addEventListener("click", () => document.querySelector("#feedbackChoices")?.classList.toggle("hidden"));
  document.querySelectorAll("[data-feedback]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await fetchJSON(`/api/v1/chats/${encodeURIComponent(chat.id)}/draft-feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draftId: feedbackId, reason: button.dataset.feedback }) });
      if (button.dataset.feedback === "no-reply") void recordDraftOutcome(chat.id, targetMessageId, draftLearningId, { event: "no-reply" });
      document.querySelector("#feedbackChoices").innerHTML = "<span>Saved privately. No message text was stored.</span>";
    } catch { showToast("Feedback could not be saved."); }
  }));
  sendButton?.addEventListener("click", () => void sendEditedReply({ chat, targetMessageId, editor, sendButton, errorNode, draftLearningId, shownDraft: shownBody }));
}

async function recordDraftOutcome(chatId, targetMessageId, draftLearningId, outcome) {
  if (!draftLearningId) return null;
  try {
    return await fetchJSON(`/api/v1/chats/${encodeURIComponent(chatId)}/personalization-outcome`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ draftId: draftLearningId, targetMessageId, ...outcome }),
    });
  } catch {
    return null;
  }
}

async function sendEditedReply({ chat, targetMessageId, editor, sendButton, errorNode, draftLearningId, shownDraft }) {
  const body = editor.value;
  const composer = composerSendState(body);
  if (!composer.canSend) {
    errorNode.textContent = composer.unresolved.length ? "Complete the missing current fact before sending." : "Write a reply before sending.";
    editor.focus();
    return;
  }
  sendButton.disabled = true;
  sendButton.textContent = "Checking latest…";
  try {
    const current = await fetchJSON(`/api/v1/chats/${encodeURIComponent(chat.id)}/latest`, { cache: "no-store" });
    const exactLatestId = current.latestSource?.id || current.latest?.id;
    if (state.selected?.id !== chat.id || exactLatestId !== targetMessageId) {
      throw new Error("The latest message changed. Review the conversation again.");
    }
  } catch (error) {
    errorNode.textContent = error instanceof Error ? error.message : "The latest message could not be verified.";
    sendButton.textContent = `Send to ${shownTitle(chat)}`;
    sendButton.disabled = false;
    return;
  }
  await executeSend({ sendButton, errorNode, chat, targetMessageId, body, idempotencyKey: crypto.randomUUID(), draftLearningId, shownDraft });
}

async function executeSend({ sendButton, errorNode, chat, targetMessageId, body, idempotencyKey, draftLearningId, shownDraft }) {
  sendButton.disabled = true;
  sendButton.textContent = "Sending…";
  try {
    let receipt;
    if (window.mycroboDesktop?.sendExact) {
      const result = await window.mycroboDesktop.sendExact({ chatId: chat.id, recipient: shownTitle(chat), body, targetMessageId, idempotencyKey });
      receipt = result?.receipt;
    } else {
      const approval = await fetchJSON(`/api/v1/chats/${encodeURIComponent(chat.id)}/send-approval`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, targetMessageId, idempotencyKey }),
      });
      receipt = await fetchJSON(`/api/v1/chats/${encodeURIComponent(chat.id)}/send`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, targetMessageId, idempotencyKey, approvalToken: approval.approval_token }),
      });
    }
    if (!receipt?.message_id) throw new Error("WhatsApp did not return a delivery acceptance receipt.");
    await recordDraftOutcome(chat.id, targetMessageId, draftLearningId, { event: "sent", shownDraft, finalDraft: body });
    state.drafts.delete(chat.id);
    replyPanel.className = "replyPanel sent";
    replyPanel.innerHTML = `<div><b>Accepted by WhatsApp</b><p>Message ID ${escapeHtml(receipt.message_id)}. MyCrobo will refresh the conversation.</p></div>`;
    setTimeout(() => { if (state.selected?.id === chat.id) void openChat(chat); }, 700);
  } catch (error) {
    errorNode.textContent = `${error instanceof Error ? error.message : "Delivery could not be confirmed."} Your edited reply has been kept.`;
    sendButton.textContent = "Send unavailable";
  }
}

chatList.addEventListener("click", (event) => {
  const more = event.target.closest("[data-show-more-chats]");
  if (more) {
    state.chatVisibleCount += 80;
    state.chatRenderSignature = "";
    renderChats();
    return;
  }
  const row = event.target.closest("[data-chat-id]");
  if (!row) return;
  const chat = state.chats.find((item) => item.id === row.dataset.chatId);
  if (chat) void openChat(chat, { focusConversation: true });
});
messageList.addEventListener("click", (event) => {
  const earlier = event.target.closest("[data-load-earlier]");
  if (earlier) {
    if (state.selected) void loadEarlierMessages(state.selected);
    return;
  }
  const retry = event.target.closest("[data-media-retry-id]");
  if (retry) {
    void retryMedia(retry.dataset.mediaRetryId, retry);
    return;
  }
  const trigger = event.target.closest("[data-media-url]");
  if (!trigger) return;
  const returnFocus = trigger;
  document.querySelector("#mediaDialog")?.remove();
  const dialog = document.createElement("dialog");
  dialog.id = "mediaDialog";
  dialog.className = "mediaDialog";
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-labelledby", "mediaViewerTitle");
  const kind = trigger.dataset.mediaKind || "image";
  const viewer = kind === "pdf"
    ? `<iframe src="${escapeHtml(trigger.dataset.mediaUrl)}" title="${escapeHtml(trigger.dataset.mediaLabel || "Chat PDF")}" sandbox="allow-same-origin" referrerpolicy="no-referrer"></iframe>`
    : kind === "video"
      ? `<video controls playsinline src="${escapeHtml(trigger.dataset.mediaUrl)}"></video>`
      : kind === "audio"
        ? `<audio controls src="${escapeHtml(trigger.dataset.mediaUrl)}"></audio>`
      : `<img src="${escapeHtml(trigger.dataset.mediaUrl)}" alt="${escapeHtml(trigger.dataset.mediaLabel || "Chat image")}" />`;
  dialog.innerHTML = `<header class="mediaViewerHeader"><strong id="mediaViewerTitle">${escapeHtml(trigger.dataset.mediaLabel || "Chat attachment")}</strong><span id="mediaViewerStatus" role="status">Opening private preview…</span></header><button type="button" class="mediaClose" aria-label="Close preview">×</button>${viewer}`;
  document.body.append(dialog);
  const viewedMedia = dialog.querySelector("iframe,img,video,audio");
  const viewerStatus = dialog.querySelector("#mediaViewerStatus");
  viewedMedia?.addEventListener("load", () => { viewerStatus.textContent = viewedMedia.tagName === "IFRAME" ? "Preview opened. If it appears blank, close it and fetch the PDF again." : "Ready"; }, { once: true });
  viewedMedia?.addEventListener("loadedmetadata", () => { viewerStatus.textContent = "Ready"; }, { once: true });
  viewedMedia?.addEventListener("error", () => {
    viewerStatus.textContent = "This saved attachment could not be displayed. Close the preview and try fetching it again.";
    viewerStatus.classList.add("errorText");
  }, { once: true });
  dialog.querySelector(".mediaClose").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (click) => { if (click.target === dialog) dialog.close(); });
  dialog.addEventListener("close", () => {
    dialog.remove();
    if (returnFocus.isConnected) returnFocus.focus({ preventScroll: true });
  }, { once: true });
  dialog.showModal();
  dialog.querySelector(".mediaClose")?.focus({ preventScroll: true });
});
messageList.addEventListener("error", (event) => {
  const media = event.target.closest?.("img,video,audio");
  if (!media) return;
  const status = media.closest?.(".message")?.querySelector(".mediaPlaybackStatus");
  if (status) status.textContent = media.tagName === "IMG" ? "This preview could not be displayed. Try loading the photo again." : "This saved attachment cannot be played here. Try fetching it again from the message.";
}, true);
document.querySelector("#search").addEventListener("input", (event) => {
  state.query = event.target.value;
  state.chatVisibleCount = 80;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void loadChats(), 250);
});
document.querySelector("#refresh").addEventListener("click", () => void refreshEverything());
document.querySelectorAll("[data-collection]").forEach((button) => button.addEventListener("click", () => {
  state.collection = button.dataset.collection;
  state.chatVisibleCount = 80;
  clearConversation();
  document.querySelectorAll("[data-collection]").forEach((item) => {
    const active = item === button;
    item.classList.toggle("active", active);
    item.setAttribute("aria-pressed", String(active));
  });
  void loadChats();
}));
conversationHeader.addEventListener("click", (event) => {
  if (event.target.closest("#backToChats")) {
    clearConversation();
    document.querySelector("#search")?.focus({ preventScroll: true });
  }
});
newMessageNotice.addEventListener("click", () => {
  const chat = state.selected;
  if (chat) {
    const help = document.querySelector("#composerHelp");
    if (help) help.textContent = "New messages arrived. Your writing was kept; review the conversation and edit it before sending.";
    void openChat(chat, { preserveViewport: true, acknowledgeNewMessages: true });
  }
});

function applyViewVisibility() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  workspace.classList.toggle("hidden", state.view !== "chats");
  overviewPanel.classList.toggle("hidden", !OVERVIEW_VIEWS.includes(state.view));
  settingsPanel.classList.toggle("hidden", state.view !== "settings");
  connectionsPanel.classList.toggle("hidden", state.view !== "connections");
  adminPanel.classList.toggle("hidden", state.view !== "admin");
  const label = ({ chats: "Chats", pending: "Decisions", tasks: "Tasks", followups: "Follow-ups", connections: "Connections", settings: "Settings", admin: "Administration" })[state.view];
  document.title = `${label} · MyCrobo`;
}

function focusViewHeading(view) {
  const selector = ({ chats: ".chatRail h1", pending: "#overviewTitle", tasks: "#overviewTitle", followups: "#overviewTitle", connections: "#connectionsTitle", settings: "#settingsTitle", admin: "#adminTitle" })[view];
  const heading = selector ? document.querySelector(selector) : null;
  if (!heading) return;
  heading.setAttribute("tabindex", "-1");
  heading.focus({ preventScroll: true });
}

function switchView(view, { persist = true, focusContent = false } = {}) {
  const requested = PRODUCT_VIEWS.includes(view) ? view : "chats";
  const nextView = requested === "admin" && !canOpenAdmin(state.auth) ? "chats" : requested;
  if (state.view !== nextView && OVERVIEW_VIEWS.includes(state.view)) rememberOverviewViewport(state.view);
  if (nextView !== "chats") cancelDraftRequest();
  state.view = nextView;
  if (persist) {
    try { localStorage.setItem(VIEW_STORAGE_KEY, state.view); } catch { /* The view still remains stable for this session. */ }
  }
  setupPanel.classList.add("hidden");
  applyViewVisibility();
  if (OVERVIEW_VIEWS.includes(state.view)) renderOverview();
  if (state.view === "settings") {
    applyPreferences(state.preferences);
    void loadAutonomy();
    void loadStorage();
    void loadProductTruth();
  }
  if (state.view === "connections") void loadConnections();
  if (state.view === "admin") void loadAdmin();
  if (state.view === "chats" && state.lastStatus?.connector === "personal-pilot" && !state.lastStatus?.connected) void refreshStatus();
  if (focusContent) requestAnimationFrame(() => focusViewHeading(state.view));
}

function updateAccountSurface() {
  const card = document.querySelector("#accountCard");
  const adminNav = document.querySelector("#adminNav");
  const platformConsole = document.querySelector("#openPlatformConsole");
  const authenticated = state.auth?.authenticated === true;
  card?.classList.toggle("hidden", !authenticated);
  // Commercial/platform administration is deliberately not embedded in the
  // customer product. Workspace administration remains backend-compatible.
  adminNav?.classList.add("hidden");
  platformConsole?.classList.toggle("hidden", !authenticated || state.auth?.user?.platformAdmin !== true);
  if (!authenticated) {
    if (state.view === "admin") switchView("chats");
    return;
  }
  const name = String(state.auth?.user?.displayName || state.auth?.user?.email || "MyCrobo user");
  document.querySelector("#accountName").textContent = name;
  document.querySelector("#accountWorkspace").textContent = String(state.auth?.tenant?.name || "No workspace selected");
  document.querySelector("#accountAvatar").textContent = (name.trim()[0] || "M").toLocaleUpperCase();
}

function setupDesktopAuthBridge() {
  const USERS_KEY = "mycrobo.web.accounts.v1";
  const SESSION_KEY = "mycrobo.web.session.v1";

  function loadAccounts() {
    try { return JSON.parse(localStorage.getItem(USERS_KEY) || "[]"); }
    catch { return []; }
  }
  function saveAccounts(accounts) {
    try { localStorage.setItem(USERS_KEY, JSON.stringify(accounts)); } catch {}
  }
  function loadSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); }
    catch { return null; }
  }
  function saveSession(session) {
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch {}
  }

  if (!window.mycroboDesktop) {
    const TOKEN_KEY = "mycrobo.web.auth_token.v1";
    window.mycroboDesktop = {
      isWebBridge: true,
      async authStatus() {
        const token = localStorage.getItem(TOKEN_KEY);
        try {
          const res = await fetch("/api/v1/auth/status", {
            headers: token ? { authorization: `Bearer ${token}` } : {},
          });
          if (res.ok) {
            return await res.json();
          }
        } catch {}
        return { authenticated: false, bootstrapRequired: false, user: null, tenant: null };
      },
      async bootstrapOwner(input) {
        const res = await fetch("/api/v1/auth/signup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not create account.");
        if (data.token) localStorage.setItem(TOKEN_KEY, data.token);
        if (data.session?.user) {
          const name = String(data.session.user.displayName || data.session.user.email?.split("@")[0] || "User");
          localStorage.setItem("mycrobo.user.name", name);
          localStorage.setItem("mycrobo.user.email", String(data.session.user.email || ""));
        }
        return { authenticated: true, session: data.session };
      },
      async signIn(input) {
        const res = await fetch("/api/v1/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Invalid email or password.");
        if (data.token) localStorage.setItem(TOKEN_KEY, data.token);
        if (data.session?.user) {
          const name = String(data.session.user.displayName || data.session.user.email?.split("@")[0] || "User");
          localStorage.setItem("mycrobo.user.name", name);
          localStorage.setItem("mycrobo.user.email", String(data.session.user.email || ""));
        }
        return { authenticated: true, session: data.session };
      },
      async signOut() {
        const token = localStorage.getItem(TOKEN_KEY);
        try {
          await fetch("/api/v1/auth/logout", {
            method: "POST",
            headers: token ? { authorization: `Bearer ${token}` } : {},
          });
        } catch {}
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem("mycrobo.user.name");
        localStorage.removeItem("mycrobo.user.email");
        localStorage.removeItem("mycrobo.web.session.v1");
        window.location.replace("/login");
        return { signedOut: true };
      },
      async tenants() {
        const status = await this.authStatus();
        if (!status?.tenant) return { tenants: [] };
        return {
          tenants: [{ id: status.tenant.id, name: status.tenant.name, status: "active", selected: true, role: status.tenant.role || "owner" }],
          activeTenantId: status.tenant.id,
        };
      },
      async openExternal(url) {
        window.open(url, "_blank", "noopener,noreferrer");
        return { opened: true };
      },
    };
  }

  const overlay = document.querySelector("#authOverlay");
  const form = document.querySelector("#authForm");
  const bootstrapFields = document.querySelector("#bootstrapFields");
  const title = document.querySelector("#authTitle");
  const description = document.querySelector("#authDescription");
  const eyebrow = document.querySelector("#authEyebrow");
  const errorNode = document.querySelector("#authError");
  const submit = document.querySelector("#submitAuth");
  const passwordInput = document.querySelector("#passwordInput");
  const passwordToggle = document.querySelector("#passwordToggle");
  const passwordToggleLabel = document.querySelector("#passwordToggleLabel");
  const eyeNormal = document.querySelector(".eyeNormal");
  const eyeSlash = document.querySelector(".eyeSlash");
  const authSwitchPrompt = document.querySelector("#authSwitchPrompt");
  const toggleAuthMode = document.querySelector("#toggleAuthMode");

  if (!overlay || !form) return;

  let mode = "login";

  function setPasswordVisibility(reveal) {
    if (!passwordInput || !passwordToggle) return;
    passwordInput.type = reveal ? "text" : "password";
    passwordToggle.setAttribute("aria-pressed", String(reveal));
    passwordToggle.setAttribute("aria-label", `${reveal ? "Hide" : "Show"} password`);
    passwordToggle.title = `${reveal ? "Hide" : "Show"} password`;
    if (passwordToggleLabel) passwordToggleLabel.textContent = reveal ? "Hide" : "Show";
    if (eyeNormal && eyeSlash) {
      eyeNormal.classList.toggle("hidden", reveal);
      eyeSlash.classList.toggle("hidden", !reveal);
    }
  }

  passwordToggle?.addEventListener("click", () => {
    setPasswordVisibility(passwordInput.type === "password");
    passwordInput.focus();
  });

  function updateModeUI() {
    const isSignup = mode === "signup";
    bootstrapFields.classList.toggle("hidden", !isSignup);
    if (form.elements.displayName) {
      form.elements.displayName.required = isSignup;
    }
    form.elements.password.autocomplete = isSignup ? "new-password" : "current-password";

    if (isSignup) {
      eyebrow.textContent = "Create your account";
      title.textContent = "Sign up for MyCrobo";
      description.textContent = "Set up your account and private workspace. Your chat data stays locally encrypted.";
      submit.textContent = "Sign up";
      if (authSwitchPrompt) authSwitchPrompt.textContent = "Already have an account?";
      if (toggleAuthMode) toggleAuthMode.textContent = "Sign in";
    } else {
      eyebrow.textContent = "Welcome back";
      title.textContent = "Sign in to MyCrobo";
      description.textContent = "Unlock only the workspaces assigned to your account.";
      submit.textContent = "Sign in";
      if (authSwitchPrompt) authSwitchPrompt.textContent = "Don't have an account?";
      if (toggleAuthMode) toggleAuthMode.textContent = "Sign up";
    }
  }

  toggleAuthMode?.addEventListener("click", (event) => {
    event.preventDefault();
    errorNode.textContent = "";
    mode = mode === "signup" ? "login" : "signup";
    updateModeUI();
    if (mode === "signup") form.elements.displayName?.focus();
    else form.elements.email?.focus();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorNode.textContent = "";
    submit.disabled = true;
    submit.textContent = mode === "signup" ? "Creating account…" : "Signing in…";
    const values = Object.fromEntries(new FormData(form));
    try {
      if (mode === "signup") {
        await window.mycroboDesktop.bootstrapOwner(values);
      } else {
        await window.mycroboDesktop.signIn(values);
      }
      form.elements.password.value = "";
      setPasswordVisibility(false);
      document.documentElement.classList.remove("force-auth");
      overlay.classList.add("hidden");
      if (window.location.pathname.startsWith("/login")) {
        window.history.replaceState(null, "", "/app");
      }
      await loadAuthStatus();
      showToast(mode === "signup" ? "Account created! Welcome to MyCrobo." : "Signed in successfully.");
      await loadChats({ force: true });
      await refreshStatus();
    } catch (error) {
      form.elements.password.value = "";
      setPasswordVisibility(false);
      errorNode.textContent = error instanceof Error ? error.message : "Authentication could not be completed.";
    } finally {
      submit.disabled = false;
      submit.textContent = mode === "signup" ? "Sign up" : "Sign in";
    }
  });

  const isExplicitLogin = window.location.pathname.startsWith("/login") || window.location.hash === "#authOverlay";
  if (isExplicitLogin) {
    overlay.classList.remove("hidden");
  }

  window.mycroboDesktop.authStatus().then((status) => {
    if (!status.authenticated || isExplicitLogin) {
      if (status.bootstrapRequired) mode = "signup";
      updateModeUI();
      overlay.classList.remove("hidden");
      if (!status.authenticated && window.location.pathname === "/app") {
        window.location.replace("/login");
      }
    } else {
      overlay.classList.add("hidden");
    }
  }).catch(() => {});
}

async function loadAuthStatus() {
  if (!window.mycroboDesktop?.authStatus) return;
  try {
    const status = await window.mycroboDesktop.authStatus();
    state.auth = {
      ...status,
      user: status?.user || status?.session?.user || null,
      tenant: status?.tenant || status?.session?.tenant || null,
    };
    if (state.auth?.authenticated && state.auth?.user) {
      const name = String(state.auth.user.displayName || state.auth.user.email?.split("@")[0] || "User");
      localStorage.setItem("mycrobo.user.name", name);
      localStorage.setItem("mycrobo.user.email", String(state.auth.user.email || ""));
    } else if (!state.auth?.authenticated) {
      localStorage.removeItem("mycrobo.user.name");
      localStorage.removeItem("mycrobo.user.email");
      if (window.location.pathname === "/app") {
        window.location.replace("/login");
      }
    }
  } catch {
    state.auth = null;
  }
  updateAccountSurface();
  const overlay = document.querySelector("#authOverlay");
  if (overlay && window.mycroboDesktop?.isWebBridge) {
    if (window.location.pathname.startsWith("/login") || window.location.hash === "#authOverlay") {
      overlay.classList.remove("hidden");
    } else {
      overlay.classList.toggle("hidden", state.auth?.authenticated === true);
    }
  }
}

function tenantOptions(tenants, selected = "") {
  return tenants.filter((tenant) => tenant.status === "active").map((tenant) => `<option value="${escapeHtml(tenant.id)}"${tenant.id === selected ? " selected" : ""}>${escapeHtml(tenant.name)}</option>`).join("");
}

function renderAdmin() {
  if (!state.admin) return;
  const { tenants, users, memberships } = state.admin;
  const platformAdmin = state.auth?.user?.platformAdmin === true;
  document.querySelector(".adminCreateGrid")?.classList.toggle("hidden", !platformAdmin);
  document.querySelector("#adminNotice").textContent = `${tenants.length} workspace${tenants.length === 1 ? "" : "s"} · ${users.length} account${users.length === 1 ? "" : "s"}.`;
  document.querySelector("#newUserTenant").innerHTML = tenantOptions(tenants);
  document.querySelector("#adminTenantList").innerHTML = tenants.length ? tenants.map((tenant) => `<article class="adminRow"><span><b>${escapeHtml(tenant.name)}</b><small>${tenant.memberCount} active member${tenant.memberCount === 1 ? "" : "s"} · ${escapeHtml(tenant.status)}</small></span>${platformAdmin ? `<button type="button" class="${tenant.status === "active" ? "dangerSecondary" : "secondary"}" data-tenant-state="${escapeHtml(tenant.id)}" data-suspended="${tenant.status === "active" ? "true" : "false"}">${tenant.status === "active" ? "Suspend" : "Restore"}</button>` : ""}</article>`).join("") : '<p class="adminEmpty">No workspaces are available.</p>';
  document.querySelector("#adminUserList").innerHTML = users.length ? users.map((user) => {
    const membership = memberships.find((item) => item.userId === user.id) || { tenantId: tenants[0]?.id || "", role: "member", status: "active" };
    return `<form class="adminRow membershipForm"><span><b>${escapeHtml(user.displayName || user.email || "Account")}${user.platformAdmin ? ' <em>Platform admin</em>' : ""}</b><small>${escapeHtml(user.email)} · account ${escapeHtml(user.status)}</small></span><input type="hidden" name="userId" value="${escapeHtml(user.id)}" /><label><span>Workspace</span><select name="tenantId"${platformAdmin ? "" : " disabled"}>${tenantOptions(tenants, membership.tenantId)}</select></label><label><span>Role</span><select name="role"${platformAdmin ? "" : " disabled"}><option value="viewer"${membership.role === "viewer" ? " selected" : ""}>Viewer</option><option value="member"${membership.role === "member" ? " selected" : ""}>Member</option><option value="admin"${membership.role === "admin" ? " selected" : ""}>Administrator</option><option value="owner"${membership.role === "owner" ? " selected" : ""}>Owner</option></select></label><label><span>Access</span><select name="status"${platformAdmin ? "" : " disabled"}><option value="active"${membership.status === "active" ? " selected" : ""}>Active</option><option value="disabled"${membership.status === "disabled" ? " selected" : ""}>Disabled</option></select></label>${platformAdmin ? '<button type="submit">Save access</button>' : ""}</form>`;
  }).join("") : '<p class="adminEmpty">No accounts are available.</p>';
}

async function loadAdmin() {
  if (!canOpenAdmin(state.auth) || state.adminLoading || !window.mycroboDesktop?.adminSnapshot) return;
  state.adminLoading = true;
  setRefreshButton(document.querySelector("#refreshAdmin"), true);
  try {
    state.admin = normalizeAdminSnapshot(await window.mycroboDesktop.adminSnapshot());
    renderAdmin();
  } catch (error) {
    document.querySelector("#adminNotice").textContent = error instanceof Error ? error.message : "Administration could not be loaded.";
  } finally {
    state.adminLoading = false;
    setRefreshButton(document.querySelector("#refreshAdmin"), false);
  }
}

function runtimeConnectionCard(label, connected, detail) {
  return `<article class="runtimeCard ${connected ? "ready" : "waiting"}"><span class="runtimeDot" aria-hidden="true"></span><div><b>${escapeHtml(label)}</b><small>${escapeHtml(detail)}</small></div></article>`;
}

async function loadTenants(container = document.querySelector("#tenantActions")) {
  if (!container || !window.mycroboDesktop?.tenants) return;
  try {
    const payload = await window.mycroboDesktop.tenants();
    state.tenants = payload;
    const tenants = Array.isArray(payload?.tenants) ? payload.tenants : [];
    const active = tenants.find((tenant) => tenant.id === payload.activeTenantId) || tenants[0];
    container.innerHTML = `<label><span>Workspace</span><select class="tenantSelect" aria-label="MyCrobo workspace">${tenants.map((tenant) => `<option value="${escapeHtml(tenant.id)}"${tenant.id === active?.id ? " selected" : ""}>${escapeHtml(tenant.name || tenant.label || "Workspace")}</option>`).join("")}</select></label>`;
    container.querySelector(".tenantSelect")?.addEventListener("change", async (event) => {
      const tenantId = event.currentTarget.value;
      if (tenantId === payload.activeTenantId) return;
      if (!window.confirm("Switch workspaces? MyCrobo will restart. Each workspace keeps its own WhatsApp session, chats, settings and learned style.")) {
        event.currentTarget.value = payload.activeTenantId;
        return;
      }
      container.querySelectorAll("button,select").forEach((control) => { control.disabled = true; });
      await window.mycroboDesktop.switchTenant(tenantId);
    });
    container.querySelector(".addTenant")?.addEventListener("click", async () => {
      if (!window.confirm("Create another workspace? MyCrobo will restart into a clean, isolated workspace ready to link a different WhatsApp account.")) return;
      container.querySelectorAll("button,select").forEach((control) => { control.disabled = true; });
      await window.mycroboDesktop.addTenant();
    });
  } catch (error) {
    container.innerHTML = `<p class="setupError">${escapeHtml(error instanceof Error ? error.message : "Workspaces could not be loaded.")}</p>`;
  }
}

async function loadConnections({ silent = false } = {}) {
  const refresh = document.querySelector("#refreshConnections");
  if (!silent) setRefreshButton(refresh, true);
  void loadRelayStatus();
  try {
    if (!silent) await refreshStatus().catch(() => null);
    const payload = await fetchJSON("/api/v1/integrations", { cache: "no-store" });
    state.integrations = payload;
    const whatsapp = payload.whatsapp || {};
    // Background connection polling must not replace the workspace selector while
    // somebody is using it. Populate it on an intentional load, or once when no
    // tenant snapshot has been rendered yet.
    if (!silent || !state.tenants) void loadTenants();
    const whatsappStatus = document.querySelector("#whatsappStatus");
    const connectWhatsApp = document.querySelector("#connectWhatsApp");
    const logoutWhatsApp = document.querySelector("#logoutWhatsApp");
    const connectionView = connectionPresentation({ ...state.lastStatus, connected: whatsapp.connected, sendAvailable: state.sendAvailable }, { hasSavedChats: state.hasSavedChats === true });
    whatsappStatus.textContent = `${connectionView.label}. ${connectionView.detail}`;
    logoutWhatsApp.classList.toggle("hidden", !whatsapp.connected);
    connectWhatsApp.classList.toggle("hidden", whatsapp.connected);
    const google = payload.google || {};
    const googleStatus = document.querySelector("#googleStatus");
    const connectGoogle = document.querySelector("#connectGoogle");
    const syncGoogle = document.querySelector("#syncGoogle");
    const disconnectGoogle = document.querySelector("#disconnectGoogle");
    if (google.connected) {
      googleStatus.textContent = `${google.gmailContextCount || 0} recent Gmail metadata items retained locally · ${google.busyBlockCount || 0} calendar blocks · refreshed ${google.lastSyncedAt ? new Date(google.lastSyncedAt).toLocaleString() : "not yet"}`;
      connectGoogle.classList.add("hidden"); syncGoogle.classList.remove("hidden"); disconnectGoogle.classList.remove("hidden");
      clearInterval(googleConnectPoll); googleConnectPoll = null;
    } else if (google.state === "connecting") {
      googleStatus.textContent = "Finish the read-only Google sign-in in your browser.";
      connectGoogle.classList.remove("hidden"); connectGoogle.disabled = true; connectGoogle.textContent = "Connecting…";
      syncGoogle.classList.add("hidden"); disconnectGoogle.classList.add("hidden");
    } else if (google.state === "error") {
      googleStatus.textContent = google.error || "Google Workspace needs to be reconnected.";
      connectGoogle.classList.remove("hidden"); connectGoogle.disabled = !google.available; connectGoogle.textContent = "Reconnect Google";
      syncGoogle.classList.add("hidden"); disconnectGoogle.classList.remove("hidden");
    } else {
      googleStatus.textContent = google.available ? "Ready for secure read-only sign-in." : "The MyCrobo Google OAuth registration has not been added to this build yet.";
      connectGoogle.classList.remove("hidden"); connectGoogle.disabled = !google.available; connectGoogle.textContent = google.available ? "Connect Google" : "Google setup required";
      syncGoogle.classList.add("hidden"); disconnectGoogle.classList.add("hidden");
    }
    document.querySelector("#runtimeConnections").innerHTML = [
      runtimeConnectionCard("WhatsApp", payload.whatsapp?.connected, connectionView.detail),
      runtimeConnectionCard("Draft intelligence", payload.drafting?.connected, payload.drafting?.connected ? (payload.drafting.minimumContextOnly ? (String(payload.drafting.mode || "").includes("gemini") ? "Gemini-assisted · only the selected context is used" : "Cloud-assisted · only the selected context is used") : "Private drafting is ready on this device") : "Drafting needs setup"),
      runtimeConnectionCard("Mobile", payload.mobile?.connected, payload.mobile?.connected ? "A mobile device is connected" : "Not available in this desktop release"),
    ].join("");
    for (const kind of ["contacts", "calendar"]) {
      const info = payload[kind] || {};
      const status = document.querySelector(`#${kind}Status`);
      status.textContent = info.connected ? `${info.count} ${kind === "contacts" ? "contacts" : "busy periods"} · ${info.sourceName}` : "Not imported";
      document.querySelector(`#remove${kind[0].toUpperCase()}${kind.slice(1)}`).classList.toggle("hidden", !info.connected);
    }
    if (!silent) setRefreshButton(refresh, false, "Updated");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Connection status could not be loaded.");
    if (!silent) setRefreshButton(refresh, false, "Try again");
  }
}

function showRelayStatus(status) {
  const form = document.querySelector("#relayIdentityForm");
  const message = document.querySelector("#webRelayStatus");
  const stateLabel = document.querySelector("#webRelayState");
  if (!form || !message || !stateLabel) return;
  const prepared = status?.state === "identity_bound_key_protected" && status?.prepared === true;
  form.classList.toggle("hidden", prepared);
  stateLabel.dataset.ready = String(prepared);
  stateLabel.textContent = prepared ? "Desktop prepared" : "Not prepared";
  if (prepared) {
    const verified = status.lastVerifiedAt ? new Date(status.lastVerifiedAt).toLocaleString() : "an earlier session";
    message.textContent = `Identity verified ${verified}. The desktop key is protected. Browser pairing and cloud capabilities remain closed until the trusted pairing boundary is implemented.`;
  } else {
    message.textContent = "Sign in with the same closed-pilot account to bind this local workspace and create its protected desktop key.";
    const email = state.auth?.user?.email || "";
    if (email && !form.elements.email.value) form.elements.email.value = email;
  }
}

async function loadRelayStatus() {
  if (!window.mycroboDesktop?.relayStatus) return;
  try { showRelayStatus(await window.mycroboDesktop.relayStatus()); }
  catch (error) {
    const message = document.querySelector("#webRelayStatus");
    if (message) message.textContent = error instanceof Error ? error.message : "The protected desktop identity could not be checked.";
  }
}

async function prepareDesktopRelay(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = document.querySelector("#prepareDesktopRelay");
  const message = document.querySelector("#webRelayStatus");
  button.disabled = true;
  button.textContent = "Verifying…";
  message.textContent = "Verifying the person and active cloud workspace…";
  try {
    const result = await window.mycroboDesktop.bindRelay({ email: form.elements.email.value, password: form.elements.password.value, cloudTenantId: form.elements.cloudTenantId.value });
    if (result?.choiceRequired) {
      const choice = document.querySelector("#cloudTenantChoice");
      const select = form.elements.cloudTenantId;
      select.innerHTML = result.memberships.map((membership) => `<option value="${escapeHtml(membership.tenantId)}">Workspace ${escapeHtml(membership.tenantId.slice(0, 8))} · ${escapeHtml(membership.role)}</option>`).join("");
      choice.classList.remove("hidden");
      message.textContent = "Choose the correct cloud workspace, then enter the password again. MyCrobo did not retain it.";
    } else {
      showRelayStatus(result);
      showToast("This desktop identity and key are protected. No chats were uploaded and no message was sent.");
    }
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : "This desktop could not be prepared.";
  } finally {
    form.elements.password.value = "";
    button.disabled = false;
    button.textContent = "Prepare this desktop";
  }
}

async function logoutWhatsApp() {
  if (!window.confirm("Log out this MyCrobo linked device from WhatsApp? Saved local chat history will remain, but live sync and sending will stop until you reconnect.")) return;
  const button = document.querySelector("#logoutWhatsApp");
  const status = document.querySelector("#whatsappStatus");
  button.disabled = true;
  button.textContent = "Logging out…";
  status.textContent = "Removing this linked device securely…";
  try {
    await fetchJSON("/api/v1/integrations/whatsapp/logout", { method: "POST", headers: { "x-mycrobo-confirm": "LOG OUT WHATSAPP" } });
    state.forceSetup = true;
    state.pairingMethod = "qr";
    state.pairingShowEntry = false;
    delete setupPanel.dataset.mode;
    showToast("WhatsApp logged out. Saved local history was preserved.");
    await refreshStatus();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "WhatsApp could not be logged out.";
    button.disabled = false;
    button.textContent = "Log out WhatsApp";
  }
}

async function connectGoogle() {
  const button = document.querySelector("#connectGoogle");
  const status = document.querySelector("#googleStatus");
  button.disabled = true; button.textContent = "Opening Google…";
  try {
    const flow = await fetchJSON("/api/v1/integrations/google/start", { method: "POST" });
    if (window.mycroboDesktop?.openExternal) await window.mycroboDesktop.openExternal(flow.authorizationUrl);
    else window.open(flow.authorizationUrl, "_blank", "noopener,noreferrer");
    status.textContent = "Finish the read-only sign-in in your browser. MyCrobo will check the connection while this screen is open.";
    clearInterval(googleConnectPoll);
    googleConnectPoll = setInterval(() => { if (document.visibilityState === "visible") void loadConnections({ silent: true }); }, 2_000);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Google connection could not start.";
    button.disabled = false; button.textContent = "Connect Google";
  }
}

async function syncGoogle() {
  const button = document.querySelector("#syncGoogle");
  button.disabled = true; button.textContent = "Refreshing…";
  try {
    const result = await fetchJSON("/api/v1/integrations/google/sync", { method: "POST" });
    showToast(`${result.gmailContextCount} recent Gmail metadata items and ${result.busyBlockCount} calendar blocks refreshed locally.`);
    await loadConnections({ silent: true });
    if (chatsStarted) await loadChats({ silent: true });
  } catch (error) { showToast(error instanceof Error ? error.message : "Google context could not be refreshed."); }
  finally { button.disabled = false; button.textContent = "Refresh now"; }
}

async function disconnectGoogle() {
  if (!window.confirm("Revoke MyCrobo's Google access, then remove its encrypted Gmail and Calendar context from this device? If Google cannot confirm revocation, nothing local will be reported as disconnected.")) return;
  try {
    await fetchJSON("/api/v1/integrations/google", { method: "DELETE", headers: { "x-mycrobo-confirm": "DISCONNECT GOOGLE" } });
    showToast("Google access was revoked and its local encrypted context was removed.");
    await loadConnections({ silent: true });
    if (chatsStarted) await loadChats({ silent: true });
  } catch (error) { showToast(error instanceof Error ? error.message : "Google could not be disconnected."); }
}

async function importContextFile(kind, input) {
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showToast("Choose a context file smaller than 2 MB."); input.value = ""; return; }
  const status = document.querySelector(`#${kind}Status`);
  status.textContent = "Importing securely…";
  try {
    const result = await fetchJSON("/api/v1/integrations/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, sourceName: file.name, content: await file.text() }) });
    showToast(`${result.count} ${kind === "contacts" ? "contacts" : "busy periods"} imported locally.`);
    await loadConnections();
    if (kind === "contacts" && chatsStarted) await loadChats({ silent: true });
  } catch (error) {
    status.textContent = "Import failed";
    showToast(error instanceof Error ? error.message : "The file could not be imported.");
  } finally { input.value = ""; }
}

async function removeContext(kind) {
  if (!window.confirm(`Remove imported ${kind} context from this device?`)) return;
  try {
    await fetchJSON(`/api/v1/integrations/${kind}`, { method: "DELETE", headers: { "x-mycrobo-confirm": `REMOVE ${kind.toUpperCase()} CONTEXT` } });
    showToast(`${kind === "contacts" ? "Contacts" : "Calendar"} context removed.`);
    await loadConnections();
    if (kind === "contacts" && chatsStarted) await loadChats({ silent: true });
  } catch (error) { showToast(error instanceof Error ? error.message : "The context could not be removed."); }
}

function taskTime(task) {
  const parsed = Date.parse(task.observedAt || "");
  return Number.isFinite(parsed) ? stamp(parsed) : "Evidence saved in this conversation";
}

function renderWorkItem(item, { pendingView, followUpView }) {
  if (pendingView) return `
    <article class="workItem" data-work-id="${escapeHtml(item.id)}">
      <div><h2>${escapeHtml(shownTitle(item.chat))}</h2><p class="workMeta">${escapeHtml(stamp(item.timestampMs))}</p><p class="workPreview">${escapeHtml(item.preview)}</p><p class="workReason">${escapeHtml(item.reason)}${item.additionalCount ? ` · ${item.additionalCount} more open in this conversation` : ""}</p></div>
      <div class="workActions"><button data-open-chat="${escapeHtml(item.chat.id)}" data-chat-collection="${escapeHtml(item.chat.collection || "active")}">Open chat</button><button class="secondary" data-decision-id="${escapeHtml(item.id)}" data-decision-status="dismissed">Not needed</button></div>
    </article>`;
  const kind = followUpView ? "followups" : "tasks";
  const statusLabel = item.status === "snoozed" && item.snoozedUntil
    ? `Snoozed until ${taskTime({ observedAt: item.snoozedUntil })}`
    : item.status === "dismissed" ? "Dismissed" : item.status;
  const stateAction = item.status === "pending"
    ? `<button class="secondary" data-task-id="${escapeHtml(item.id)}" data-task-kind="${kind}" data-task-status="done">Mark done</button>`
    : `<button class="secondary" data-task-id="${escapeHtml(item.id)}" data-task-kind="${kind}" data-task-status="pending">Restore</button>`;
  const snoozeAction = item.status === "pending" ? `<button class="secondary" data-task-id="${escapeHtml(item.id)}" data-task-kind="${kind}" data-task-status="snoozed" data-snooze-days="1">Snooze 1 day</button>` : "";
  const dismissAction = item.status !== "dismissed" ? `<button class="secondary" data-task-id="${escapeHtml(item.id)}" data-task-kind="${kind}" data-task-status="dismissed">Dismiss</button>` : "";
  return `
    <article class="workItem ${item.status === "done" || item.status === "dismissed" ? "done" : ""}" data-work-id="${escapeHtml(item.id)}">
      <div><h2>${escapeHtml(shownTitle(item.chat))}</h2><p class="workMeta">${escapeHtml(taskTime(item))}</p><p class="workPreview">${escapeHtml(item.action || "Evidence-backed reminder")}</p>${followUpView ? '<p class="workReason">Waiting for them</p>' : '<p class="workReason">You committed to this</p>'}<span class="taskStatus">${escapeHtml(statusLabel)}</span></div>
      <div class="workActions"><button data-open-chat="${escapeHtml(item.chat.id)}" data-chat-collection="${escapeHtml(item.chat.collection || "active")}">Open chat</button>${stateAction}${snoozeAction}${dismissAction}</div>
    </article>`;
}

function renderOverview() {
  if (state.overviewRenderedView === state.view) rememberOverviewViewport(state.view);
  const viewport = state.overviewViewport[state.view];
  const completeRender = () => {
    state.overviewRenderedView = state.view;
    restoreAnchor(overviewList, "[data-work-id]", "workId", viewport);
  };
  const pendingView = state.view === "pending";
  const followUpView = state.view === "followups";
  const items = pendingView ? state.pending : followUpView ? state.followUps : state.tasks;
  document.querySelector("#overviewEyebrow").textContent = pendingView ? "Your judgement" : followUpView ? "Waiting on others" : "Your open commitments";
  document.querySelector("#overviewTitle").textContent = pendingView ? "Needs your decision" : followUpView ? "Follow-ups" : "Your tasks";
  document.querySelector("#overviewDescription").textContent = pendingView
    ? "Direct messages that need your opinion, a current fact, a choice, or an attachment review. Groups are kept out of this queue."
    : followUpView
      ? "Promises made to you that are still waiting for matching completion evidence in the conversation."
      : "Commitments you made that still need to be closed. Communication promises are included; group activity and other people's work are excluded.";
  if (state.loadingOverview && !items.length) {
    overviewList.innerHTML = '<div class="overviewEmpty">Loading…</div>';
    completeRender();
    return;
  }
  if (!items.length) {
    overviewList.innerHTML = `<div class="overviewEmpty">${pendingView ? "Nothing currently needs your decision." : followUpView ? "No follow-ups are currently waiting." : "No current personal tasks were found."}</div>`;
    completeRender();
    return;
  }
  if (pendingView) {
    overviewList.innerHTML = items.map((item) => renderWorkItem(item, { pendingView, followUpView })).join("");
    completeRender();
    return;
  }
  const visibleItems = items.filter((item) => !["dismissed", "snoozed", "stale"].includes(item.status));
  const snoozedItems = items.filter((item) => item.status === "snoozed");
  const dismissedItems = items.filter((item) => item.status === "dismissed");
  const staleItems = items.filter((item) => item.status === "stale");
  const visibleMarkup = visibleItems.length
    ? visibleItems.map((item) => renderWorkItem(item, { pendingView, followUpView })).join("")
    : `<div class="overviewEmpty compact">${followUpView ? "No active follow-ups." : "No active tasks."}</div>`;
  const snoozedMarkup = snoozedItems.length ? `
    <details class="snoozedSection" data-snoozed-kind="${followUpView ? "followups" : "tasks"}" ${state.snoozedExpanded[state.view] ? "open" : ""}>
      <summary aria-label="Snoozed ${followUpView ? "follow-ups" : "tasks"}, ${snoozedItems.length} item${snoozedItems.length === 1 ? "" : "s"}. Show or hide"><span>Snoozed</span><span class="dismissedCount" aria-hidden="true">${snoozedItems.length}</span><span class="dismissedHint" aria-hidden="true">Show</span></summary>
      <div class="dismissedList">${snoozedItems.map((item) => renderWorkItem(item, { pendingView, followUpView })).join("")}</div>
    </details>` : "";
  const dismissedMarkup = dismissedItems.length ? `
    <details class="dismissedSection" data-dismissed-kind="${followUpView ? "followups" : "tasks"}" ${state.dismissedExpanded[state.view] ? "open" : ""}>
      <summary aria-label="Dismissed ${followUpView ? "follow-ups" : "tasks"}, ${dismissedItems.length} item${dismissedItems.length === 1 ? "" : "s"}. Show or hide"><span>Dismissed</span><span class="dismissedCount" aria-hidden="true">${dismissedItems.length}</span><span class="dismissedHint" aria-hidden="true">Show</span></summary>
      <div class="dismissedList">${dismissedItems.map((item) => renderWorkItem(item, { pendingView, followUpView })).join("")}</div>
    </details>` : "";
  const staleMarkup = staleItems.length ? `
    <details class="staleSection" data-stale-kind="${followUpView ? "followups" : "tasks"}" ${state.staleExpanded[state.view] ? "open" : ""}>
      <summary aria-label="Older ${followUpView ? "follow-ups" : "tasks"} to review, ${staleItems.length} item${staleItems.length === 1 ? "" : "s"}. Show or hide"><span>Older items to review</span><span class="dismissedCount" aria-hidden="true">${staleItems.length}</span><span class="dismissedHint" aria-hidden="true">Show</span></summary>
      <div class="dismissedList">${staleItems.map((item) => renderWorkItem(item, { pendingView, followUpView })).join("")}</div>
    </details>` : "";
  overviewList.innerHTML = `${visibleMarkup}${snoozedMarkup}${staleMarkup}${dismissedMarkup}`;
  completeRender();
}

async function loadWorkspace({ silent = false, force = false } = {}) {
  if (silent && !force && state.loadingOverview) return state.workspaceRequest.promise || true;
  state.workspaceRequest.controller?.abort();
  const controller = new AbortController();
  const sequence = ++state.workspaceRequest.sequence;
  state.workspaceRequest.controller = controller;
  state.loadingOverview = true;
  let changed = false;
  let failed = false;
  if (!silent) setRefreshButton(refreshOverviewButton, true);
  const promise = (async () => {
    try {
      const payload = await fetchJSON("/api/v1/workspace", { cache: "no-store", signal: controller.signal });
      if (sequence !== state.workspaceRequest.sequence) return false;
      const next = {
        pending: Array.isArray(payload.pending) ? payload.pending : [],
        tasks: Array.isArray(payload.tasks) ? payload.tasks : [],
        followUps: Array.isArray(payload.followUps) ? payload.followUps : [],
      };
      const nextSignature = signatureOf(next);
      changed = nextSignature !== state.workspaceSignature;
      state.pending = next.pending;
      state.tasks = next.tasks;
      state.followUps = next.followUps;
      state.workspaceSignature = nextSignature;
      document.querySelector("#pendingCount").textContent = String(state.pending.length);
      document.querySelector("#taskCount").textContent = String(state.tasks.filter((item) => item.status === "pending").length);
      document.querySelector("#followUpCount").textContent = String(state.followUps.filter((item) => item.status === "pending").length);
    } catch (error) {
      failed = true;
      if (error?.name !== "AbortError" && !silent) {
        if (!state.pending.length && !state.tasks.length && !state.followUps.length && state.view !== "chats") overviewList.innerHTML = `<div class="overviewEmpty errorText">${escapeHtml(error instanceof Error ? error.message : "The list could not be refreshed.")}</div>`;
        setRefreshButton(refreshOverviewButton, false, "Try again");
      }
    } finally {
      if (sequence === state.workspaceRequest.sequence) {
        state.loadingOverview = false;
        state.workspaceRequest.controller = null;
        state.workspaceRequest.promise = null;
        if (changed && state.view !== "chats") renderOverview();
        if (!silent && !failed) {
          setRefreshButton(refreshOverviewButton, false, "Updated");
          setTimeout(() => { if (!state.loadingOverview) setRefreshButton(refreshOverviewButton, false); }, 1_200);
        }
      }
    }
    return !failed;
  })();
  state.workspaceRequest.promise = promise;
  return promise;
}

function matchesChatId(chat, targetId) {
  if (!chat || !targetId) return false;
  if (chat.id === targetId) return true;
  if (Array.isArray(chat.connectorIds) && chat.connectorIds.includes(targetId)) return true;
  const clean = (val) => String(val || "").replace(/^(?:jid|lid|phone):/u, "").toLowerCase();
  const targetClean = clean(targetId);
  return clean(chat.id) === targetClean || (Array.isArray(chat.connectorIds) && chat.connectorIds.some((id) => clean(id) === targetClean));
}

async function openWorkspaceChat(chatId, collection) {
  switchView("chats");
  state.collection = collection === "archived" ? "archived" : "active";
  state.query = "";
  document.querySelector("#search").value = "";
  document.querySelectorAll("[data-collection]").forEach((button) => {
    const active = button.dataset.collection === state.collection;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  await loadChats();
  let chat = state.chats.find((item) => matchesChatId(item, chatId));
  if (!chat) {
    const otherCollection = state.collection === "active" ? "archived" : "active";
    try {
      const data = await fetchJSON(`/api/v1/chats?collection=${otherCollection}`);
      const fallbackChat = (data.chats || []).find((item) => matchesChatId(item, chatId));
      if (fallbackChat) {
        state.collection = otherCollection;
        document.querySelectorAll("[data-collection]").forEach((button) => {
          const active = button.dataset.collection === state.collection;
          button.classList.toggle("active", active);
          button.setAttribute("aria-pressed", String(active));
        });
        state.chats = data.chats || [];
        renderChatList();
        chat = fallbackChat;
      }
    } catch {}
  }
  if (chat) await openChat(chat, { focusConversation: true });
}

async function updateTask(taskId, status, kind = "tasks", { offerUndo = true, snoozedUntil = null } = {}) {
  const source = kind === "followups" ? state.followUps : state.tasks;
  const previous = source.find((item) => item.id === taskId) || { status: "pending", snoozedUntil: null };
  try {
    await fetchJSON(`/api/v1/${kind === "followups" ? "followups" : "tasks"}/${encodeURIComponent(taskId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, ...(snoozedUntil ? { snoozedUntil } : {}) }),
    });
    await loadWorkspace();
    const noun = kind === "followups" ? "Follow-up" : "Task";
    const verb = status === "dismissed" ? "dismissed" : status === "done" ? "completed" : status === "snoozed" ? "snoozed until tomorrow" : "restored";
    showToast(`${noun} ${verb}.`, offerUndo ? { actionLabel: "Undo", onAction: () => updateTask(taskId, previous.status, kind, { offerUndo: false, snoozedUntil: previous.snoozedUntil }) } : {});
  } catch (error) {
    showToast(error instanceof Error ? error.message : "That change could not be saved.");
  }
}

async function updateDecision(decisionId, status, { offerUndo = true } = {}) {
  try {
    await fetchJSON(`/api/v1/decisions/${encodeURIComponent(decisionId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await loadWorkspace();
    showToast(status === "dismissed" ? "Removed from Decisions." : "Decision restored.", offerUndo ? {
      actionLabel: "Undo",
      onAction: () => updateDecision(decisionId, status === "dismissed" ? "pending" : "dismissed", { offerUndo: false }),
    } : {});
  } catch (error) {
    showToast(error instanceof Error ? error.message : "That decision could not be updated.");
  }
}

document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
  switchView(button.dataset.view, { focusContent: true });
  if (["pending", "tasks", "followups"].includes(button.dataset.view)) void loadWorkspace();
}));
document.querySelector("#refreshAdmin")?.addEventListener("click", () => void loadAdmin());
document.querySelector("#openPlatformConsole")?.addEventListener("click", async () => {
  try { await window.mycroboDesktop?.openPlatformAdmin?.(); }
  catch (error) { showToast(error instanceof Error ? error.message : "The platform console could not be opened."); }
});
document.querySelector("#signOut")?.addEventListener("click", async () => {
  try {
    liveEvents?.close();
    state.auth = null;
    state.admin = null;
    localStorage.removeItem("mycrobo.web.auth_token.v1");
    localStorage.removeItem("mycrobo.user.name");
    localStorage.removeItem("mycrobo.user.email");
    localStorage.removeItem("mycrobo.web.session.v1");
    if (window.mycroboDesktop?.signOut) {
      await window.mycroboDesktop.signOut().catch(() => {});
    }
  } catch (error) {
    console.error("Sign out error:", error);
  } finally {
    window.location.replace("/login");
  }
});
document.querySelector("#createTenantForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector("button[type=submit]");
  submit.disabled = true;
  try {
    await window.mycroboDesktop.createTenant(validateTenant(Object.fromEntries(new FormData(form))));
    form.reset();
    showToast("Workspace created.");
    await loadAdmin();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Workspace could not be created.");
  } finally { submit.disabled = false; }
});
document.querySelector("#createUserForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector("button[type=submit]");
  submit.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(form));
    await window.mycroboDesktop.createUser(validateAdminUser(values));
    form.reset();
    form.elements.password.value = "";
    showToast("Account created.");
    await loadAdmin();
  } catch (error) {
    form.elements.password.value = "";
    showToast(error instanceof Error ? error.message : "Account could not be created.");
  } finally { submit.disabled = false; }
});
document.querySelector("#adminUserList")?.addEventListener("submit", async (event) => {
  const form = event.target.closest(".membershipForm");
  if (!form) return;
  event.preventDefault();
  const submit = form.querySelector("button[type=submit]");
  submit.disabled = true;
  try {
    await window.mycroboDesktop.setMembership(validateMembership(Object.fromEntries(new FormData(form))));
    showToast("Access updated.");
    await loadAdmin();
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Access could not be updated.");
  } finally { submit.disabled = false; }
});
document.querySelector("#adminTenantList")?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-tenant-state]");
  if (!button) return;
  const suspended = button.dataset.suspended === "true";
  const action = suspended ? "suspend" : "restore";
  if (!window.confirm(`${action[0].toLocaleUpperCase()}${action.slice(1)} this workspace? ${suspended ? "Its members will lose access until it is restored. Stored data will not be deleted." : "Authorized members will regain access."}`)) return;
  button.disabled = true;
  try {
    await window.mycroboDesktop.suspendTenant({ tenantId: button.dataset.tenantState, suspended });
    showToast(`Workspace ${suspended ? "suspended" : "restored"}.`);
    await loadAdmin();
  } catch (error) {
    showToast(error instanceof Error ? error.message : `Workspace could not be ${action}ed.`);
  } finally { button.disabled = false; }
});
document.querySelector("#refreshConnections")?.addEventListener("click", () => void loadConnections());
document.querySelector("#relayIdentityForm")?.addEventListener("submit", (event) => void prepareDesktopRelay(event));
document.querySelector("#toggleRelayPassword")?.addEventListener("click", (event) => {
  const input = document.querySelector("#relayIdentityForm input[name='password']");
  const visible = input.type === "text";
  input.type = visible ? "password" : "text";
  event.currentTarget.textContent = visible ? "Show" : "Hide";
  event.currentTarget.setAttribute("aria-label", visible ? "Show password" : "Hide password");
  event.currentTarget.setAttribute("aria-pressed", String(!visible));
});
document.querySelector("#connectWhatsApp")?.addEventListener("click", async () => {
  state.forceSetup = true;
  state.connectionSetupDismissed = false;
  switchView("chats");
  const currentPairing = state.lastStatus?.pairing;
  if (currentPairing && (currentPairing.state === "expired" || currentPairing.state === "retryable-error")) {
    try {
      await fetchJSON("/api/v1/pairing-restart", { method: "POST" });
      await refreshStatus();
      return;
    } catch {}
  }
  renderSetup(state.lastStatus || { connectionState: "offline", pairing: { state: "unpaired" } });
});
document.querySelector("#logoutWhatsApp")?.addEventListener("click", () => void logoutWhatsApp());
document.querySelector("#connectGoogle")?.addEventListener("click", () => void connectGoogle());
document.querySelector("#syncGoogle")?.addEventListener("click", () => void syncGoogle());
document.querySelector("#disconnectGoogle")?.addEventListener("click", () => void disconnectGoogle());
document.querySelector("#contactsFile")?.addEventListener("change", (event) => void importContextFile("contacts", event.currentTarget));
document.querySelector("#calendarFile")?.addEventListener("change", (event) => void importContextFile("calendar", event.currentTarget));
document.querySelector("#removeContacts")?.addEventListener("click", () => void removeContext("contacts"));
document.querySelector("#removeCalendar")?.addEventListener("click", () => void removeContext("calendar"));
settingsForm.addEventListener("submit", (event) => void savePreferences(event));
document.querySelector("#grantAutoSendConsent")?.addEventListener("click", () => void updateAutonomyConsent("grant"));
document.querySelector("#revokeAutoSendConsent")?.addEventListener("click", () => void updateAutonomyConsent("revoke"));
document.querySelector("#emergencyStopAutoSend")?.addEventListener("click", () => void updateAutonomyConsent("emergency-stop"));
document.querySelector("#exportLocalState")?.addEventListener("click", () => void exportLocalState());
document.querySelector("#resetLocalState")?.addEventListener("click", () => void resetLocalState());
document.querySelector("#removeLegacyRecovery")?.addEventListener("click", () => void removeLegacyRecovery());
document.querySelector("#refreshOverview").addEventListener("click", () => void loadWorkspace());
overviewList.addEventListener("click", (event) => {
  const chatButton = event.target.closest("[data-open-chat]");
  if (chatButton) {
    void openWorkspaceChat(chatButton.dataset.openChat, chatButton.dataset.chatCollection);
    return;
  }
  const taskButton = event.target.closest("[data-task-id]");
  if (taskButton) {
    const snoozeDays = Number(taskButton.dataset.snoozeDays || 0);
    const snoozedUntil = snoozeDays > 0 ? new Date(Date.now() + snoozeDays * 86_400_000).toISOString() : null;
    void updateTask(taskButton.dataset.taskId, taskButton.dataset.taskStatus, taskButton.dataset.taskKind, { snoozedUntil });
    return;
  }
  const decisionButton = event.target.closest("[data-decision-id]");
  if (decisionButton) void updateDecision(decisionButton.dataset.decisionId, decisionButton.dataset.decisionStatus);
});
overviewList.addEventListener("toggle", (event) => {
  const section = event.target.closest?.("details.dismissedSection");
  const kind = section?.dataset?.dismissedKind;
  if (section && ["tasks", "followups"].includes(kind)) state.dismissedExpanded[kind] = section.open;
  const snoozed = event.target.closest?.("details.snoozedSection");
  const snoozedKind = snoozed?.dataset?.snoozedKind;
  if (snoozed && ["tasks", "followups"].includes(snoozedKind)) state.snoozedExpanded[snoozedKind] = snoozed.open;
  const stale = event.target.closest?.("details.staleSection");
  const staleKind = stale?.dataset?.staleKind;
  if (stale && ["tasks", "followups"].includes(staleKind)) state.staleExpanded[staleKind] = stale.open;
}, true);

async function startImport() {
  const button = document.querySelector("#connectAll");
  const consent = document.querySelector("#connectorRisk");
  if (!consent?.checked) {
    document.querySelector("#setupError").textContent = "Please confirm the connector disclosure first.";
    return;
  }
  button.disabled = true;
  button.textContent = "Starting…";
  state.forceSetup = true;
  try {
    const response = await fetch("/api/v1/connect", { method: "POST", signal: AbortSignal.timeout(20_000) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Connection could not start.");
    renderSetup({ connectionState: "connecting", pairing: { state: "preparing" } });
    await refreshStatus({ skipSavedChatProbe: true });
  } catch (error) {
    const errorNode = document.querySelector("#setupError");
    if (errorNode) errorNode.textContent = error?.name === "TimeoutError"
      ? "Connection took too long. Please try again."
      : error instanceof Error ? error.message : "Connection could not start.";
    const currentButton = document.querySelector("#connectAll");
    if (currentButton) {
      currentButton.disabled = false;
      currentButton.textContent = "Show QR and phone login";
    }
  }
}

function pairingTabs(active) {
  return `<div class="pairingTabs" role="tablist" aria-label="WhatsApp connection method"><button type="button" role="tab" data-pairing-method="qr" aria-selected="${active === "qr"}" class="${active === "qr" ? "active" : ""}">QR code</button><button type="button" role="tab" data-pairing-method="phone" aria-selected="${active === "phone"}" class="${active === "phone" ? "active" : ""}">Phone number</button></div>`;
}

function stopPairingClock() {
  clearInterval(pairingClockTimer);
  pairingClockTimer = null;
}

function startPairingClock(expiresAt) {
  stopPairingClock();
  const update = () => {
    const label = document.querySelector("#pairingExpiry");
    if (!label) return stopPairingClock();
    const seconds = pairingSecondsRemaining(expiresAt);
    if (seconds === null) {
      label.textContent = "This code is valid for a short time.";
      return;
    }
    if (seconds <= 0) {
      label.textContent = "Code expired. Request a new code.";
      label.classList.add("expired");
      document.querySelector("#newPhoneCode")?.classList.remove("hidden");
      return stopPairingClock();
    }
    const minutes = Math.floor(seconds / 60);
    const remainder = String(seconds % 60).padStart(2, "0");
    label.textContent = `Code expires in ${minutes}:${remainder}`;
  };
  update();
  pairingClockTimer = setInterval(update, 1_000);
}

function countryOptions() {
  const options = PAIRING_COUNTRIES.map(([iso, name, dial]) => `<option value="${iso}"${state.pairingCountry === iso ? " selected" : ""}>${escapeHtml(name)} (${dial})</option>`).join("");
  return `${options}<option value="custom"${state.pairingCountry === "custom" ? " selected" : ""}>Other country code</option>`;
}

function bindPairingTabs(status) {
  setupPanel.querySelectorAll("[data-pairing-method]").forEach((button) => button.addEventListener("click", async () => {
    const method = button.dataset.pairingMethod;
    if (method === state.pairingMethod && !(method === "phone" && state.pairingShowEntry)) {
      if (method === "qr") {
        try {
          await fetchJSON("/api/v1/pairing-restart", { method: "POST" });
          await refreshStatus();
        } catch {
          try {
            await fetchJSON("/api/v1/pairing-use-qr", { method: "POST" });
            await refreshStatus();
          } catch {
            // The existing QR view is kept.
          }
        }
      }
      return;
    }
    state.pairingMethod = method;
    state.pairingShowEntry = method === "phone";
    stopPairingClock();
    delete setupPanel.dataset.mode;
    if (method === "qr" && status.pairing?.state === "phone-code") {
      setupPanel.innerHTML = '<div class="setupCard"><span class="step">Switching method</span><h1>Preparing a fresh QR code</h1><p>This takes only a moment.</p></div>';
      try {
        await fetchJSON("/api/v1/pairing-use-qr", { method: "POST" });
        await refreshStatus();
      } catch (error) {
        renderPairingError(status, error instanceof Error ? error.message : "A fresh QR code is not ready yet.");
      }
      return;
    }
    renderSetup(status);
  }));
}

function renderPairingError(status, message) {
  setupPanel.dataset.mode = `pairing-error:${state.pairingMethod}`;
  setupPanel.innerHTML = `<div class="setupCard pairingCard"><span class="step">Connection needs attention</span><h1>WhatsApp could not create the code</h1><p>${escapeHtml(message)}</p><button type="button" id="retryPairing">Try again</button><button type="button" class="setupSecondary" id="returnToQR">Use QR code</button><small>No chat message was sent.</small></div>`;
  document.querySelector("#retryPairing")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (button) {
      button.disabled = true;
      button.textContent = "Connecting…";
    }
    state.pairingShowEntry = true;
    delete setupPanel.dataset.mode;
    try {
      await fetchJSON("/api/v1/pairing-restart", { method: "POST" });
      await refreshStatus();
    } catch {
      try {
        await fetchJSON("/api/v1/connect", { method: "POST" });
        await refreshStatus();
      } catch {
        renderSetup(status);
      }
    }
  });
  document.querySelector("#returnToQR")?.addEventListener("click", async () => {
    state.pairingMethod = "qr";
    state.pairingShowEntry = false;
    delete setupPanel.dataset.mode;
    try { await fetchJSON("/api/v1/pairing-use-qr", { method: "POST" }); await refreshStatus(); }
    catch (error) { renderPairingError(status, error instanceof Error ? error.message : "A fresh QR code is not ready yet."); }
  });
}

function renderPairingRecovery(status, pairing) {
  stopPairingClock();
  const mode = `pairing-recovery:${pairing.state}:${pairing.failureCode || "expired"}`;
  if (setupPanel.dataset.mode === mode) return;
  setupPanel.dataset.mode = mode;
  const blocked = pairing.retryable === false || pairing.state === "blocked-error";
  const message = pairing.error || (blocked
    ? "This connector must be updated before WhatsApp can link again."
    : "The previous WhatsApp linking session expired before the phone confirmed it.");
  setupPanel.innerHTML = `<div class="setupCard pairingCard"><span class="step">${blocked ? "Update required" : "Connection expired"}</span><h1>${blocked ? "WhatsApp linking needs attention" : "Start with a fresh WhatsApp code"}</h1><p>${escapeHtml(message)}</p>${blocked ? "" : '<button type="button" id="restartPairing">Start fresh connection</button>'}<small>Saved local chats remain untouched. Restarting linking never sends a message.</small></div>`;
  document.querySelector("#restartPairing")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Preparing fresh connection…";
    try {
      const result = await fetchJSON("/api/v1/pairing-restart", { method: "POST" });
      state.lastStatus = { ...status, pairing: { ...pairing, ...result } };
      delete setupPanel.dataset.mode;
      await refreshStatus();
    } catch (error) {
      try {
        await fetchJSON("/api/v1/connect", { method: "POST" });
        delete setupPanel.dataset.mode;
        await refreshStatus();
      } catch (innerError) {
        renderPairingError(status, innerError instanceof Error ? innerError.message : (error instanceof Error ? error.message : "WhatsApp could not start a fresh linking session."));
      }
    }
  });
}

function renderReauthenticationRecovery(status) {
  stopPairingClock();
  const mode = "reauth-required";
  if (setupPanel.dataset.mode === mode) return;
  setupPanel.dataset.mode = mode;
  delete setupPanel.dataset.qr;
  setupPanel.innerHTML = `<div class="setupCard pairingCard"><span class="step">WhatsApp disconnected</span><h1>Reconnect WhatsApp</h1><p>WhatsApp no longer accepts the saved linked-device session. Start a fresh secure connection to restore live updates.</p><button type="button" id="startRelink">Reconnect with QR or phone</button><button type="button" class="setupSecondary" id="useSavedOffline">Use saved chats offline</button><p class="setupError" id="relinkError" role="alert"></p><small>Your saved chats, settings and learned communication style remain untouched. Reconnecting never sends a message.</small></div>`;
  document.querySelector("#startRelink")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const errorNode = document.querySelector("#relinkError");
    if (!window.mycroboDesktop?.relinkWhatsApp) {
      errorNode.textContent = "This desktop build cannot prepare a fresh WhatsApp session.";
      return;
    }
    if (!window.confirm("Reconnect WhatsApp with a fresh QR code or phone code? The expired session will be preserved as a backup, and saved chats will not be deleted.")) return;
    button.disabled = true;
    button.textContent = "Preparing secure login…";
    try {
      await window.mycroboDesktop.relinkWhatsApp();
    } catch (error) {
      errorNode.textContent = error instanceof Error ? error.message : "WhatsApp reconnection could not be prepared.";
      button.disabled = false;
      button.textContent = "Reconnect with QR or phone";
    }
  });
  document.querySelector("#useSavedOffline")?.addEventListener("click", () => {
    state.forceSetup = false;
    showSavedWorkspaceOffline(status);
  });
}

function renderAccountVerificationRecovery(status) {
  stopPairingClock();
  const mode = "account-verification-required";
  if (setupPanel.dataset.mode === mode) return;
  setupPanel.dataset.mode = mode;
  delete setupPanel.dataset.qr;
  setupPanel.innerHTML = `<div class="setupCard pairingCard accountVerificationCard"><span class="step">WhatsApp linked · workspace protected</span><h1>This WhatsApp account does not match this workspace</h1><p>The QR or phone login succeeded, but MyCrobo could not prove that the linked WhatsApp identity owns the chats already saved in <strong>this workspace</strong>. It stopped before importing anything, so histories from two people cannot be mixed.</p><div class="accountVerificationChoices"><div><strong>If this is your original WhatsApp</strong><small>Reconnect and scan using the WhatsApp account that previously owned this workspace.</small><button type="button" id="relinkOriginal">Reconnect original account</button></div><div><strong>If this is another person's WhatsApp</strong><small>Keep it isolated in a new workspace with its own chats, session and learned style.</small><button type="button" class="setupSecondary" id="separateWorkspace">Create separate workspace</button></div></div><button type="button" class="setupSecondary" id="useSavedOffline">Use this workspace offline</button><p class="setupError" id="accountVerificationError" role="alert"></p><small>The newly linked account has not been merged with or imported into this workspace. No message was sent.</small></div>`;
  document.querySelector("#relinkOriginal")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const errorNode = document.querySelector("#accountVerificationError");
    if (!window.mycroboDesktop?.relinkWhatsApp) {
      errorNode.textContent = "This desktop build cannot prepare a fresh WhatsApp session.";
      return;
    }
    if (!window.confirm("Reconnect the WhatsApp account that originally owned this workspace? The unverified linked session will be preserved as a backup, and saved chats will not be deleted.")) return;
    button.disabled = true;
    button.textContent = "Preparing original-account login…";
    try {
      await window.mycroboDesktop.relinkWhatsApp();
    } catch (error) {
      errorNode.textContent = error instanceof Error ? error.message : "WhatsApp reconnection could not be prepared.";
      button.disabled = false;
      button.textContent = "Reconnect original account";
    }
  });
  document.querySelector("#separateWorkspace")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const errorNode = document.querySelector("#accountVerificationError");
    if (!window.mycroboDesktop?.addTenant) {
      errorNode.textContent = "This desktop build cannot create a separate workspace.";
      return;
    }
    if (!window.confirm("Create a separate workspace for this WhatsApp account? The current workspace and all of its saved chats will remain untouched. You will link the other account again inside the new workspace.")) return;
    button.disabled = true;
    button.textContent = "Creating isolated workspace…";
    try {
      await window.mycroboDesktop.addTenant({ name: "New WhatsApp workspace" });
    } catch (error) {
      errorNode.textContent = error instanceof Error ? error.message : "A separate workspace could not be created.";
      button.disabled = false;
      button.textContent = "Create separate workspace";
    }
  });
  document.querySelector("#useSavedOffline")?.addEventListener("click", () => {
    state.forceSetup = false;
    showSavedWorkspaceOffline(status);
  });
}

function renderPhoneEntry(status) {
  stopPairingClock();
  setupPanel.dataset.mode = "phone-entry";
  const selected = PAIRING_COUNTRIES.find(([iso]) => iso === state.pairingCountry);
  const dial = selected?.[2] || state.pairingCustomCode || "+";
  setupPanel.innerHTML = `<div class="setupCard pairingCard">${pairingTabs("phone")}<span class="step">Connect without scanning</span><h1>Enter your WhatsApp number</h1><p>MyCrobo asks WhatsApp for a one-time code. The number is used for this request only and is not saved.</p><form class="phonePairingForm" id="phonePairingForm"><label><span>Country or region</span><select id="pairingCountry">${countryOptions()}</select></label><label id="customDialLabel" class="${state.pairingCountry === "custom" ? "" : "hidden"}"><span>International country code</span><input id="pairingCustomCode" inputmode="tel" autocomplete="off" value="${escapeHtml(state.pairingCustomCode)}" placeholder="+91" maxlength="5" /></label><label><span>Phone number</span><div class="phoneNumberField"><b id="pairingDial">${escapeHtml(dial)}</b><input id="pairingPhone" inputmode="numeric" autocomplete="tel-national" value="${escapeHtml(state.pairingPhoneDraft)}" placeholder="Number without country code" maxlength="14" /></div><small>Use digits only. Remove a leading zero used for local calls.</small></label><button type="submit" id="requestPhoneCode">Get phone code</button><p class="setupError" id="phonePairingError" role="alert"></p></form><small class="pairingPrivacy">The number and one-time code are never written to chat history, settings or diagnostics.</small></div>`;
  bindPairingTabs(status);
  const country = document.querySelector("#pairingCountry");
  const custom = document.querySelector("#pairingCustomCode");
  const phone = document.querySelector("#pairingPhone");
  country?.addEventListener("change", () => {
    state.pairingCountry = country.value;
    const choice = PAIRING_COUNTRIES.find(([iso]) => iso === country.value);
    document.querySelector("#customDialLabel")?.classList.toggle("hidden", country.value !== "custom");
    document.querySelector("#pairingDial").textContent = choice?.[2] || state.pairingCustomCode || "+";
  });
  custom?.addEventListener("input", () => {
    state.pairingCustomCode = custom.value.replace(/[^+\d]/gu, "").slice(0, 5);
    document.querySelector("#pairingDial").textContent = state.pairingCustomCode || "+";
  });
  phone?.addEventListener("input", () => { state.pairingPhoneDraft = phone.value.replace(/\D/gu, "").slice(0, 14); phone.value = state.pairingPhoneDraft; });
  document.querySelector("#phonePairingForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const errorNode = document.querySelector("#phonePairingError");
    const button = document.querySelector("#requestPhoneCode");
    try {
      const choice = PAIRING_COUNTRIES.find(([iso]) => iso === state.pairingCountry);
      const complete = normalizePairingPhone(choice?.[2] || state.pairingCustomCode, state.pairingPhoneDraft);
      errorNode.textContent = "";
      button.disabled = true;
      button.textContent = "Requesting secure code…";
      const result = await fetchJSON("/api/v1/pairing-phone", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: complete }) });
      state.pairingShowEntry = false;
      state.lastStatus = { ...status, pairing: { ...status.pairing, ...result } };
      delete setupPanel.dataset.mode;
      renderSetup(state.lastStatus);
    } catch (error) {
      errorNode.textContent = error instanceof Error ? error.message : "WhatsApp could not create a phone linking code.";
      button.disabled = false;
      button.textContent = "Get phone code";
    }
  });
}

function renderPhoneCode(status, pairing) {
  const cells = pairingCodeCells(pairing.phoneCode);
  if (!cells.length) return renderPairingError(status, "WhatsApp returned an invalid or expired phone code.");
  state.pairingMethod = "phone";
  setupPanel.dataset.mode = `phone-code:${pairing.phoneCode}`;
  setupPanel.innerHTML = `<div class="setupCard pairingCard">${pairingTabs("phone")}<span class="step">One-time WhatsApp code</span><h1>Enter this code on your phone</h1><p>Linking the account ending ${escapeHtml(pairing.phoneMasked || "in your number")}</p><div class="phoneCode" aria-label="WhatsApp linking code ${escapeHtml(cells.join(" "))}">${cells.map((cell, index) => `${index === 4 ? '<i aria-hidden="true">–</i>' : ""}<b>${escapeHtml(cell)}</b>`).join("")}</div><p class="pairingExpiry" id="pairingExpiry"></p><ol class="pairingSteps"><li><span>1</span><p>Open <strong>WhatsApp</strong> on your phone.</p></li><li><span>2</span><p>Android: tap <strong>Menu</strong>. iPhone: tap <strong>Settings</strong>.</p></li><li><span>3</span><p>Tap <strong>Linked devices</strong>, then <strong>Link a device</strong>.</p></li><li><span>4</span><p>Tap <strong>Link with phone number instead</strong> and enter the code above.</p></li></ol><button type="button" class="setupSecondary" id="differentPhone">Use a different number</button><button type="button" class="setupSecondary hidden" id="newPhoneCode">Get a new code</button><small>No message is sent by linking. MyCrobo will continue automatically after WhatsApp confirms the device.</small></div>`;
  bindPairingTabs(status);
  document.querySelector("#differentPhone")?.addEventListener("click", () => { state.pairingShowEntry = true; delete setupPanel.dataset.mode; renderSetup(status); });
  document.querySelector("#newPhoneCode")?.addEventListener("click", () => { state.pairingShowEntry = true; delete setupPanel.dataset.mode; renderSetup(status); });
  startPairingClock(pairing.expiresAt);
}

function renderQRPairing(status, pairing) {
  stopPairingClock();
  state.pairingMethod = "qr";
  setupPanel.dataset.mode = `scan-required:${pairing.qrImage}`;
  setupPanel.dataset.qr = pairing.qrImage;
  setupPanel.innerHTML = `<div class="setupCard pairingCard">${pairingTabs("qr")}<span class="step">Connect by camera</span><h1>Scan with WhatsApp</h1><p>On your phone, open WhatsApp → Linked devices → Link a device.</p><img class="pairingQR" src="${escapeHtml(pairing.qrImage)}?t=${Date.now()}" alt="WhatsApp linked-device QR code" /><ol class="pairingSteps compactSteps"><li><span>1</span><p>Open WhatsApp on your phone.</p></li><li><span>2</span><p>Open <strong>Linked devices</strong>.</p></li><li><span>3</span><p>Tap <strong>Link a device</strong> and scan this code.</p></li></ol><button type="button" class="setupSecondary" id="refreshQR"><span aria-hidden="true">↻</span> Reload QR code</button><small>No chat message is sent by linking or importing.</small></div>`;
  bindPairingTabs(status);
  document.querySelector("#refreshQR")?.addEventListener("click", async () => {
    const button = document.querySelector("#refreshQR");
    if (button) {
      button.disabled = true;
      button.innerHTML = '<span aria-hidden="true">↻</span> Reloading…';
    }
    try {
      await fetchJSON("/api/v1/pairing-restart", { method: "POST" });
      await refreshStatus();
    } catch {
      try {
        await fetchJSON("/api/v1/pairing-use-qr", { method: "POST" });
        await refreshStatus();
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Could not reload QR code.");
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = '<span aria-hidden="true">↻</span> Reload QR code';
      }
    }
  });
}

function renderSetup(status) {
  if (state.view !== "chats") {
    setupPanel.classList.add("hidden");
    applyViewVisibility();
    return;
  }
  workspace.classList.add("hidden");
  overviewPanel.classList.add("hidden");
  settingsPanel.classList.add("hidden");
  connectionsPanel.classList.add("hidden");
  setupPanel.classList.remove("hidden");
  const pairing = status.pairing || {};
  if (status.connectionState === "account-verification-required") {
    renderAccountVerificationRecovery(status);
    return;
  }
  if (status.connectionState === "reauth-required") {
    renderReauthenticationRecovery(status);
    return;
  }
  if (pairing.state === "phone-code") {
    const mode = state.pairingShowEntry ? "phone-entry" : `phone-code:${pairing.phoneCode}`;
    if (setupPanel.dataset.mode === mode) return;
    if (state.pairingShowEntry) renderPhoneEntry(status); else renderPhoneCode(status, pairing);
    return;
  }
  if (pairing.state === "scan-required" && pairing.qrImage) {
    const mode = state.pairingMethod === "phone" ? "phone-entry" : `scan-required:${pairing.qrImage}`;
    if (setupPanel.dataset.mode === mode) return;
    if (state.pairingMethod === "phone") renderPhoneEntry(status); else renderQRPairing(status, pairing);
    return;
  }
  if (["expired", "retryable-error", "blocked-error", "timeout"].includes(pairing.state)) {
    renderPairingRecovery(status, pairing);
    return;
  }
  if (status.connectionState === "connecting" || status.connectionState === "catching-up" || pairing.state === "preparing") {
    stopPairingClock();
    if (setupPanel.dataset.mode === "connecting") return;
    setupPanel.dataset.mode = "connecting";
    delete setupPanel.dataset.qr;
    const preparingLink = !pairing.state || pairing.state === "unpaired";
    setupPanel.innerHTML = preparingLink
      ? '<div class="setupCard"><span class="step">Preparing connection</span><h1>Getting WhatsApp ready</h1><p>MyCrobo is preparing fresh QR and phone-number linking options. This normally takes only a moment.</p></div>'
      : '<div class="setupCard"><span class="step">Importing</span><h1>Bringing your chats up to date</h1><p>Keep your phone online. Active and archived conversations are being saved locally; you can leave this screen open.</p></div>';
    return;
  }
  stopPairingClock();
  if (setupPanel.dataset.mode === "consent") return;
  setupPanel.dataset.mode = "consent";
  delete setupPanel.dataset.qr;
  setupPanel.innerHTML = `<div class="setupCard"><span class="step">Private personal workspace</span><h1>Connect WhatsApp</h1><p>This workspace keeps its own WhatsApp session, chats, settings, attachments and learned communication style. Nothing is shared with another workspace.</p><div class="setupTenant" id="setupTenantActions"></div><label class="consent consentCard"><input id="connectorRisk" type="checkbox" /><span><strong>I understand and approve</strong><small>I approve one local import for all active and archived chats in this workspace. The connector is unofficial and may carry account or service risk.</small></span></label><button id="connectAll" disabled>Show QR and phone login</button><p class="setupError" id="setupError"></p><small>Sync, analysis and drafting never send a chat message.</small></div>`;
  void loadTenants(document.querySelector("#setupTenantActions"));
  document.querySelector("#connectorRisk")?.addEventListener("change", (event) => {
    const button = document.querySelector("#connectAll");
    if (button) button.disabled = !event.currentTarget.checked;
    document.querySelector("#setupError").textContent = "";
  });
  document.querySelector("#connectAll")?.addEventListener("click", () => void startImport());
}

async function savedChatsExist() {
  if (state.hasSavedChats === true) return true;
  try {
    const [active, archived] = await Promise.all([
      fetchJSON("/api/v1/chats?collection=active", { cache: "no-store", signal: AbortSignal.timeout(5_000) }),
      fetchJSON("/api/v1/chats?collection=archived", { cache: "no-store", signal: AbortSignal.timeout(5_000) }),
    ]);
    state.hasSavedChats = Boolean(active.chats?.length || archived.chats?.length);
  } catch {
    state.hasSavedChats = false;
  }
  return state.hasSavedChats;
}

function showSavedWorkspaceOffline(status) {
  state.connectionSetupDismissed = true;
  state.hasSavedChats = true;
  setupPanel.classList.add("hidden");
  applyViewVisibility();
  updateConnectionSurface(connectionPresentation(status, { hasSavedChats: true }));
  if (!chatsStarted) {
    chatsStarted = true;
    void loadChats();
    void loadWorkspace({ silent: true });
  }
}

async function refreshStatusOnce({ skipSavedChatProbe = false } = {}) {
  try {
    const response = await fetch("/api/v1/status", { cache: "no-store", signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) });
    const status = await response.json();
    if (!response.ok) throw new Error(status.error || "Connection unavailable.");
    state.statusHealth.consecutiveFailures = 0;
    state.statusHealth.lastSuccessAt = Date.now();
    state.lastStatus = status;
    state.sendAvailable = status.sendAvailable === true;
    if ((status.connected || status.connectionState === "catching-up") && status.connector === "personal-pilot") startLiveEvents();
    if (status.connector === "personal-pilot" && !status.connected) {
      if (status.connectionState === "catching-up") state.forceSetup = false;
      const pairingState = String(status.pairing?.state || "");
      if (pairingState === "unpaired" && state.forceSetup) state.connectionSetupDismissed = false;
      if (shouldCheckSavedChatsBeforeSetup({ forceSetup: state.forceSetup, skipSavedChatProbe })) await savedChatsExist();
      const hasSavedChats = state.hasSavedChats === true;
      updateConnectionSurface(connectionPresentation(status, { hasSavedChats }));
      if (shouldPresentConnectionSetup({
        view: state.view,
        status,
        forceSetup: state.forceSetup,
        hasSavedChats,
        setupDismissed: state.connectionSetupDismissed,
      })) renderSetup(status);
      else {
        setupPanel.classList.add("hidden");
        applyViewVisibility();
        if (hasSavedChats && !chatsStarted) {
          chatsStarted = true;
          void loadChats();
          void loadWorkspace({ silent: true });
        }
      }
      if (state.view === "connections") void loadConnections({ silent: true });
      return;
    }
    state.forceSetup = false;
    state.connectionSetupDismissed = false;
    if (state.hasSavedChats !== true) await savedChatsExist();
    updateConnectionSurface(connectionPresentation(status, { hasSavedChats: state.hasSavedChats === true }));
    stopPairingClock();
    setupPanel.classList.add("hidden");
    applyViewVisibility();
    if (!chatsStarted) {
      chatsStarted = true;
      void loadChats();
      void loadWorkspace({ silent: true });
    } else {
      void loadChats({ silent: true });
    }
    return status;
  } catch {
    state.statusHealth.consecutiveFailures += 1;
    // A single missed poll under import load is not a disconnection. Keep the
    // last verified state while the next bounded poll confirms service health.
    if (state.lastStatus && state.statusHealth.consecutiveFailures < STATUS_FAILURE_THRESHOLD) return state.lastStatus;
    updateConnectionSurface(connectionPresentation(null, { serviceReachable: false, hasSavedChats: state.hasSavedChats === true }));
    return null;
  }
}

function refreshStatus(options = {}) {
  if (state.statusRequest.promise) return state.statusRequest.promise;
  const sequence = state.statusRequest.sequence + 1;
  const promise = refreshStatusOnce(options).finally(() => {
    if (state.statusRequest.sequence === sequence) state.statusRequest.promise = null;
  });
  state.statusRequest = { sequence, promise };
  return promise;
}

document.querySelector("#reconnect").addEventListener("click", async () => {
  if (document.querySelector(".connectionCard")?.dataset.state === "service-unavailable") {
    void refreshStatus();
    return;
  }
  state.forceSetup = true;
  state.connectionSetupDismissed = false;
  switchView("chats");
  const currentPairing = state.lastStatus?.pairing;
  if (currentPairing && (currentPairing.state === "expired" || currentPairing.state === "retryable-error")) {
    try {
      await fetchJSON("/api/v1/pairing-restart", { method: "POST" });
      await refreshStatus();
      return;
    } catch {}
  }
  renderSetup(state.lastStatus || { connectionState: "offline", pairing: { state: "unpaired" } });
});
document.querySelector("#connectionNotice")?.addEventListener("click", () => document.querySelector("#reconnect")?.click());

const menuBtn = document.querySelector(".site-header .menu-button");
const primaryNav = document.querySelector("#primary-navigation");
if (menuBtn && primaryNav) {
  menuBtn.addEventListener("click", () => {
    const open = primaryNav.classList.toggle("nav-open");
    menuBtn.setAttribute("aria-expanded", String(open));
  });
}

setupDesktopAuthBridge();
await loadAuthStatus();
applyViewVisibility();
void loadPreferences();
void refreshStatus();
setInterval(() => { if (document.visibilityState === "visible") void refreshStatus(); }, 2_000);
setInterval(() => { if (state.preferences.liveUpdates && chatsStarted && document.visibilityState === "visible") void loadChats({ silent: true }); }, 60_000);
setInterval(() => { if (state.preferences.liveUpdates && chatsStarted && document.visibilityState === "visible") void refreshSelectedLatest(); }, 12_000);
setInterval(() => { if (state.preferences.liveUpdates && chatsStarted && document.visibilityState === "visible") void loadWorkspace({ silent: true }); }, 60_000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !chatsStarted || !state.preferences.liveUpdates) return;
  void refreshStatus();
  void loadChats({ silent: true });
  void loadWorkspace({ silent: true });
  void refreshSelectedLatest();
});
window.addEventListener("beforeunload", () => {
  liveEvents?.close();
  clearTimeout(eventRefreshTimer);
  clearTimeout(historyEventRefreshTimer);
  clearInterval(googleConnectPoll);
  stopPairingClock();
}, { once: true });
}
