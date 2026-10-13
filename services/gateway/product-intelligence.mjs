import { buildChatRelationshipProfile } from "../../packages/core/relationship.ts";

function clean(value, maximum = 240) {
  return String(value || "").replace(/\s+/gu, " ").trim().slice(0, maximum);
}

function evidenceOf(item = {}) {
  return {
    sourceMessageId: clean(item.provenance?.source_message_id, 160) || null,
    speaker: item.actor_is_owner === true || item.asked_by_owner === true ? "you" : "other-person",
    observedAt: item.provenance?.occurred_at || null,
    confidence: Number.isFinite(Number(item.provenance?.confidence)) ? Number(item.provenance.confidence) : null,
    current: item.status ? item.status === "current" : true,
  };
}

export function buildVerifiedContext(bundle = {}, conversationState = null) {
  const state = conversationState || {};
  const target = bundle.latestSource || bundle.latest || null;
  const questions = (state.open_questions || []).filter((item) => item.status === "current").slice(-5).map((item) => ({
    text: clean(item.question || item.provenance?.original_wording),
    ...evidenceOf(item),
  })).filter((item) => item.text);
  const commitments = (state.commitments || []).filter((item) => item.status === "current").slice(-5).map((item) => ({
    text: clean(item.action || item.provenance?.original_wording),
    ...evidenceOf(item),
  })).filter((item) => item.text);
  const facts = (state.recent_facts || []).filter((item) => item.status !== "superseded").slice(-5).map((item) => ({
    text: clean(item.fact || item.provenance?.original_wording),
    safeToRepeat: item.provenance?.safe_to_repeat === true,
    ...evidenceOf(item),
  })).filter((item) => item.text);
  return {
    topic: clean(state.current_topic?.text) || clean(target?.text) || "No current text topic",
    latestIntent: clean(state.latest_intent, 80) || "unknown",
    conversationStatus: clean(state.conversation_status, 80) || "unknown",
    latestMessageId: clean(state.latest_message_id || target?.id, 160) || null,
    verifiedAt: bundle.watermark?.verifiedAt || null,
    reachedBeginning: bundle.watermark?.reachedBeginning === true,
    messageCount: Number(bundle.watermark?.messageCount || bundle.events?.length || 0),
    questions,
    commitments,
    facts,
  };
}

export function buildCommunicationDNA(chat, events = [], allEvents = []) {
  const profile = buildChatRelationshipProfile(chat, events);
  const ownerAcrossAccount = allEvents.filter((event) => event?.direction === "owner" && String(event?.text || "").trim()).length;
  const primaryMode = profile.writingModes[0] || { mode: "Unknown", count: 0 };
  const evidenceLevel = profile.ownerMessageCount >= 30 ? "established" : profile.ownerMessageCount >= 10 ? "developing" : "learning";
  return {
    evidenceLevel,
    personSpecificEvidence: profile.ownerMessageCount,
    accountWideEvidence: ownerAcrossAccount,
    relationshipContext: profile.category,
    primaryWritingMode: primaryMode.mode,
    medianReplyCharacters: profile.medianOwnerReplyCharacters || profile.medianOwnerMessageCharacters,
    emojiUse: profile.ownerEmojiRate >= 0.35 ? "frequent" : profile.ownerEmojiRate > 0 ? "occasional" : "rare",
    acknowledgementStyle: profile.ownerAcknowledgementRate >= 0.35 ? "often brief" : "contextual",
    addressForms: profile.ownerAddressForms,
    typicalResponseDelayMs: profile.typicalResponseDelayMs,
    evidenceMessageIds: profile.evidenceMessageIds.slice(-40),
    note: evidenceLevel === "learning"
      ? "MyCrobo is still learning this relationship. Suggestions should be reviewed and edited."
      : "Person-specific evidence is preferred over general writing style for this conversation.",
  };
}

export function buildSyncTruth({ status = {}, active = [], archived = [], storage = null } = {}) {
  const chats = [...active, ...archived];
  const receipt = (chat) => ({
    state: chat.watermark?.state || chat.watermark?.status || "unknown",
    reachedBeginning: chat.watermark?.reachedBeginning === true || chat.watermark?.history_end_hit === true,
    verifiedAt: chat.watermark?.verifiedAt || chat.watermark?.updated_at || null,
    messageCount: Number(chat.watermark?.messageCount ?? chat.watermark?.messages_seen ?? 0),
  });
  const complete = chats.filter((chat) => receipt(chat).reachedBeginning && receipt(chat).state === "complete").length;
  const failed = chats.filter((chat) => receipt(chat).state === "failed").length;
  const current = chats.filter((chat) => Boolean(receipt(chat).verifiedAt) && !["not-started", "syncing", "pending", "running"].includes(receipt(chat).state)).length;
  const savedMessages = chats.reduce((sum, chat) => sum + receipt(chat).messageCount, 0);
  return {
    connected: status.connected === true,
    connectionState: status.connectionState || (status.connected ? "connected" : "offline"),
    chatCount: chats.length,
    activeChats: active.length,
    archivedChats: archived.length,
    latestVerifiedChats: current,
    completeHistoryChats: complete,
    partialHistoryChats: Math.max(0, chats.length - complete - failed),
    failedHistoryChats: failed,
    savedMessages,
    allHistoryProven: chats.length > 0 && complete === chats.length,
    storage: storage ? {
      databaseBytes: Number(storage.database_bytes || 0),
      cachedMediaBytes: Number(storage.cached_media_bytes || 0),
      mediaCacheLimit: Number(storage.media_cache_limit || 0),
    } : null,
    statement: chats.length === 0
      ? "No saved conversations are available yet."
      : complete === chats.length
        ? "The beginning of every currently discovered conversation has been reached."
        : `${chats.length - complete} conversations still have unproven earlier history. Latest messages can still be verified independently.`,
  };
}
