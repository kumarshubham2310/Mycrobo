function hasTextPreview(chat) {
  return typeof chat?.latest?.text === "string" && chat.latest.text.trim().length > 0;
}

export function hasMeaningfulLabel(value) {
  return /[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(String(value || "").trim());
}

function isNumericTitle(title) {
  return /^\d{10,}$/u.test(String(title || "").trim());
}

function isRawConnectorTitle(title) {
  return /^\d{10,}(?:-\d{5,})?$/u.test(String(title || "").trim());
}

function isPhoneIdentity(id) {
  return /@s\.whatsapp\.net$/u.test(String(id || ""));
}

function isConnectorOnlyIdentity(chat) {
  const id = String(chat?.id || "");
  const numeric = isNumericTitle(chat?.title);
  const rawConnector = isRawConnectorTitle(chat?.title);
  if (/@(?:newsletter|broadcast)$/u.test(id) || /status@broadcast/iu.test(id)) return true;
  if (rawConnector && /@g\.us$/u.test(id)) return true;
  if (numeric && /@lid$/u.test(id)) return true;
  if (numeric && (!isPhoneIdentity(id) || !hasTextPreview(chat))) return true;
  if (!hasMeaningfulLabel(chat?.title) && !isPhoneIdentity(id)) return true;
  return false;
}

export function collapseRepeatedDisplayText(value, minimumLength = 20) {
  let text = String(value || "").trim();
  while (text.length >= minimumLength && text.length % 2 === 0) {
    const midpoint = text.length / 2;
    if (text.slice(0, midpoint) !== text.slice(midpoint)) break;
    text = text.slice(0, midpoint).trim();
  }
  return text;
}

function readableTitle(chat) {
  const title = String(chat?.title || "").trim();
  if (isNumericTitle(title) && isPhoneIdentity(chat?.id)) return `+${title}`;
  return collapseRepeatedDisplayText(title, 16) || "Unnamed conversation";
}

export function shownTitle(chat) {
  return chat?.displayTitle || readableTitle(chat);
}

export function shownSender(message, chat) {
  if (message?.direction === "owner") return "You";
  if (hasMeaningfulLabel(message?.senderName)) return String(message.senderName).trim();
  return chat?.kind === "group" ? "Group member" : "Other person";
}

export function shownPreview(chat) {
  return collapseRepeatedDisplayText(chat?.latest?.text || "", 24);
}

export function draftRouteLabel(payload, personName = "this person") {
  const route = payload?.draftRoute || {};
  const basis = route?.personalization?.basis;
  const generation = route?.generation || {};
  const name = String(personName || "this person").trim();
  const parts = [];
  if (basis === "same-person-semantic") parts.push(`learned from your conversations with ${name}`);
  else if (basis === "same-person-style-only") parts.push(`matched to how you write to ${name}`);
  else if (basis === "relationship-fallback") parts.push("guided by similar relationships while this conversation learns");
  else if (basis === "owner-global-fallback") parts.push("guided by your general writing style");
  else if (route?.personalization?.evidenceTier === "safety-template") parts.push("waiting for a current fact from you");
  else parts.push("story-grounded suggestion");
  if (["standard", "escalated"].includes(generation.path) && generation.providerStatus === "succeeded") parts.push("reasoning model used");
  else if (generation.path === "local-fallback" || generation.providerStatus === "failed-fell-back") parts.push("private fallback used because the model was unavailable");
  else if (generation.path === "local") parts.push("created privately on this device");
  if (payload?.historyComplete === false) parts.push("earlier history is still being learned");
  return `Suggested reply · ${parts.join(" · ")}`;
}

export function draftTargetId(history) {
  return history?.reply?.target?.id || history?.latest?.id || "";
}

export function presentChats(chats) {
  return (Array.isArray(chats) ? chats : [])
    .filter((chat) => !isConnectorOnlyIdentity(chat))
    .map((chat) => ({ ...chat, displayTitle: readableTitle(chat) }))
    .sort((left, right) => {
      const newest = Number(right.latest?.timestampMs || 0) - Number(left.latest?.timestampMs || 0);
      return newest || shownTitle(left).localeCompare(shownTitle(right), undefined, { sensitivity: "base" });
    });
}

const ACTIVE_PAIRING_STATES = new Set(["preparing", "scan-required", "phone-code"]);

export function connectionPresentation(status, { serviceReachable = true, hasSavedChats = false } = {}) {
  if (!serviceReachable) return { code: "service-unavailable", label: hasSavedChats ? "MyCrobo service unavailable · saved chats unchanged" : "MyCrobo service unavailable", detail: "The current screen was kept. Try again when the local service is available.", actionLabel: "Try again", canReconnect: true };
  const connectionState = String(status?.connectionState || "offline");
  const pairingState = String(status?.pairing?.state || "");
  if (status?.connected === true) {
    if (connectionState === "catching-up") return { code: "catching-up", label: "WhatsApp connected · checking conversations", detail: "MyCrobo is checking for new messages while learning from older conversations privately.", actionLabel: "", canReconnect: false };
    return status?.sendAvailable === true
      ? { code: "connected", label: "WhatsApp connected · latest checked before send", detail: "The exact conversation is checked again before a reviewed message can be sent.", actionLabel: "", canReconnect: false }
      : { code: "review-only", label: "WhatsApp connected · review-only", detail: "Messages can be read and drafted, but sending is currently unavailable.", actionLabel: "", canReconnect: false };
  }
  if (connectionState === "account-verification-required") return { code: "account-mismatch", label: hasSavedChats ? "WhatsApp account needs confirmation · saved chats available" : "WhatsApp account needs confirmation", detail: "MyCrobo stopped before mixing this account with the current workspace.", actionLabel: "Review connection", canReconnect: true };
  if (connectionState === "reauth-required") return { code: "reauth-required", label: hasSavedChats ? "WhatsApp needs reconnection · saved chats available" : "WhatsApp needs reconnection", detail: "Reconnect with QR or phone to restore live updates. Saved chats remain unchanged.", actionLabel: "Reconnect", canReconnect: true };
  if (connectionState === "connecting" || connectionState === "catching-up" || ACTIVE_PAIRING_STATES.has(pairingState)) return { code: ACTIVE_PAIRING_STATES.has(pairingState) ? "linking" : "connecting", label: pairingState === "scan-required" || pairingState === "phone-code" ? "WhatsApp linking is ready" : "Connecting to WhatsApp…", detail: pairingState === "scan-required" || pairingState === "phone-code" ? "Finish linking with the QR code or phone code." : "The current screen will stay open while MyCrobo checks the connection.", actionLabel: "Continue linking", canReconnect: true };
  return { code: "offline", label: hasSavedChats ? "WhatsApp offline · saved chats available" : "WhatsApp not connected", detail: hasSavedChats ? "Saved chats remain available in read-only mode. Reconnect for new messages." : "Connect with QR or phone to start importing this workspace.", actionLabel: "Connect", canReconnect: true };
}

export function shouldPresentConnectionSetup({ view, status, forceSetup = false, hasSavedChats = false, setupDismissed = false } = {}) {
  if (view !== "chats" || status?.connected === true) return false;
  const pairingState = String(status?.pairing?.state || "");
  if (forceSetup || ACTIVE_PAIRING_STATES.has(pairingState)) return true;
  if (!hasSavedChats) return true;
  return true;
}

export function conversationStatusPresentation(watermark, fallbackCount = 0) {
  const verifiedAt = watermark?.verifiedAt ? new Date(watermark.verifiedAt) : null;
  const validVerifiedAt = verifiedAt && Number.isFinite(verifiedAt.getTime());
  const state = String(watermark?.state || "");
  const current = Boolean(validVerifiedAt) && !["syncing", "not-started"].includes(state);
  const messageCount = Math.max(0, Number(watermark?.messageCount || fallbackCount || 0));
  const historyLabel = watermark?.reachedBeginning ? "Conversation history available" : state === "failed" ? "Some older conversation context is unavailable" : "Learning from older conversations in the background";
  const freshnessLabel = current ? `Latest checked ${verifiedAt.toLocaleString()}` : "Saved conversation · reconnect to check for new messages";
  return { current, messageCount, historyLabel, freshnessLabel, label: `${freshnessLabel} · ${historyLabel}` };
}
