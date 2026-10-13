import { createHash } from "node:crypto";

const STATES = new Set(["ready", "complete", "partial", "local_only", "not_started", "unavailable", "unverified", "stale", "blocked", "failed", "needs_media"]);

function state(value, fallback = "unavailable") {
  const normalized = String(value || "").trim().toLowerCase();
  return STATES.has(normalized) ? normalized : fallback;
}

function count(value) {
  const number = Number(value || 0);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function boundedTimestamp(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

const ERROR_CODES = new Set(["TRUTH_UNAVAILABLE", "BRIDGE_OFFLINE", "HISTORY_NOT_STARTED", "HISTORY_PARTIAL", "HISTORY_FAILED"]);

function diagnosticErrorCode(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return ERROR_CODES.has(normalized) ? normalized : value ? "TRUTH_UNAVAILABLE" : null;
}

export function opaqueChatReference(tenantId, chatId) {
  return createHash("sha256").update(`mycrobo-history-truth-v1\0${String(tenantId || "local")}\0${String(chatId || "")}`).digest("hex").slice(0, 20);
}

export function contentFreeHistoryTruth(items, { tenantId = "", cursor = 0, totalChats = items.length } = {}) {
  const rows = (Array.isArray(items) ? items : []).map(({ chat, truth, errorCode }) => {
    const coverage = truth?.coverage || chat?.historyCoverage || {};
    return {
      chatRef: opaqueChatReference(tenantId, chat?.id),
      collection: chat?.collection === "archived" ? "archived" : "active",
      kind: chat?.kind === "group" ? "group" : "direct",
      currentMessage: state(truth?.current_message?.state),
      currentStory: state(truth?.current_story?.state),
      relationshipHistory: state(truth?.relationship_history?.state),
      lifetimeHistory: state(truth?.lifetime_history?.state, "not_started"),
      locallyStoredMessages: count(coverage.locally_stored_messages),
      timestampedMessages: count(coverage.timestamped_messages),
      ownerTextMessages: count(coverage.owner_text_messages),
      providerReportedMessagesSeen: count(coverage.provider_reported_messages_seen),
      providerBeginningReached: coverage.provider_beginning_reached === true,
      oldestMessageAt: boundedTimestamp(coverage.oldest_message_at),
      newestMessageAt: boundedTimestamp(coverage.newest_message_at),
      lastAttemptAt: boundedTimestamp(coverage.last_attempt_at),
      errorCode: diagnosticErrorCode(errorCode),
    };
  });
  const stateCounts = (field) => Object.fromEntries([...new Set(rows.map((row) => row[field]))].sort().map((value) => [value, rows.filter((row) => row[field] === value).length]));
  return {
    schema: "mycrobo-content-free-history-truth.1",
    generatedAt: new Date().toISOString(),
    cursor: count(cursor),
    returnedChats: rows.length,
    totalChats: count(totalChats),
    nextCursor: count(cursor) + rows.length < count(totalChats) ? count(cursor) + rows.length : null,
    summary: {
      active: rows.filter((row) => row.collection === "active").length,
      archived: rows.filter((row) => row.collection === "archived").length,
      direct: rows.filter((row) => row.kind === "direct").length,
      groups: rows.filter((row) => row.kind === "group").length,
      providerBeginningReached: rows.filter((row) => row.providerBeginningReached).length,
      locallyStoredMessages: rows.reduce((sum, row) => sum + row.locallyStoredMessages, 0),
      currentMessage: stateCounts("currentMessage"),
      currentStory: stateCounts("currentStory"),
      relationshipHistory: stateCounts("relationshipHistory"),
      lifetimeHistory: stateCounts("lifetimeHistory"),
    },
    chats: rows,
  };
}

export function assertContentFreeHistoryTruth(report) {
  const raw = JSON.stringify(report);
  if (/"(?:text|title|name|phone|email|sender|recipient|body|originalWording|original_wording)"\s*:/iu.test(raw)) {
    throw new Error("History diagnostic contains a forbidden content field.");
  }
  if (!report || report.schema !== "mycrobo-content-free-history-truth.1" || !Array.isArray(report.chats)) {
    throw new Error("History diagnostic schema is invalid.");
  }
  return report;
}
