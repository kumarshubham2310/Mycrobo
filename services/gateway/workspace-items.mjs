const DIRECT_QUESTION = /\b(?:what do you think|your opinion|which (?:one|option|time|date)|what time|how much|should we|can you|could you|will you|would you|are you|do you|did you|is (?:it )?possible|when (?:can|will|should)|where (?:are|is|should)|kya (?:aap|tum|tu)|kab (?:aa|kar|mil)|kahan (?:ho|hai)|su lage|shu lage)\b/iu;
const DIRECT_ACTION_REQUEST = /\b(?:(?:please|pls|plz|kindly)\s+(?:send|share|check|review|confirm|update|call|pay|submit|deliver|join|attend|tell|bata|batao|moklo|bhej)|(?:send|share|check|review|confirm|update|call|pay|submit|deliver|join|attend)\s+(?:me|us|this|that|it|the|your)|(?:janav|bata|batao|moklo|bhej)\b)/iu;
const CURRENT_FACT_REQUEST = /\b(?:are you (?:available|free|busy|at|in)|what time|when (?:are|can|will)|where are you|(?:are you|will you be) (?:at (?:the )?|in (?:the )?)(?:office|home)|(?:aaj|kal) (?:free|available) (?:ho|hai)|(?:office|home|ghar) (?:kab|when))\b/iu;
const FIRST_PERSON_PROMISE = /\b(?:i will|i'll|we will|we'll|let me|main|mai|hum)\b[\s\S]{0,80}\b(?:send|share|check|confirm|call|pay|submit|deliver|join|attend|bhej|mokl|kar(?:unga|ungi)|bata(?:unga|ungi))\b/iu;
const EXPLICIT_DECISION_REQUEST = /\b(?:please advise|need your (?:approval|decision|opinion|input)|can we|could we|shall we|kya kare|kya karna|shu kariye|su kariye)\b/iu;
const NON_DELIVERABLE_PROMISE = /\b(?:pray|hope|wish|miss|remember|think|sleep|rest|wait)\b/iu;
const COMPOSITE_PROMISE_CONTINUATION = /\b(?:and(?: then)?|then|after(?: that)?|before(?: that)?|but)\b[\s\S]{1,100}\p{L}/iu;
const BROADCAST_SIGNAL = /\b(?:subscribe|follow (?:us|on)|channel|releasing|launching|register now|limited offer|warm regards|wishing you|forwarded many times|donation|official page|telegram|instagram|facebook|youtube channel)\b/iu;
const URL_PATTERN = /https?:\/\/\S+/giu;
const GENERIC_ACK_OR_CLOSURE = /^(?:ok(?:ay)?|got it|noted|thanks?|thank you|haan|han|hmm+|yep|yeah|sure|thik hai|theek hai|k|cool|alright|done|great|perfect|super|shukriya|dhanyawad)[.! ]*$/iu;
const DECISION_FRESHNESS_MS = 45 * 86_400_000;
const WORK_ITEM_FRESHNESS_MS = 45 * 86_400_000;

function occurredAt(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

function clean(value) {
  return String(value || "").replace(/\s+/gu, " ").trim();
}

function withoutURLs(value) {
  return clean(String(value || "").replace(URL_PATTERN, " "));
}

function ageIsCurrent(timestampMs, nowMs, maximumAgeMs = DECISION_FRESHNESS_MS) {
  return Number.isFinite(timestampMs) && timestampMs > 0 && timestampMs <= nowMs + 5 * 60_000 && nowMs - timestampMs <= maximumAgeMs;
}

function looksLikeBroadcast(value) {
  const text = clean(value);
  const urls = text.match(URL_PATTERN) || [];
  const body = withoutURLs(text);
  return urls.length >= 2 || (urls.length >= 1 && (BROADCAST_SIGNAL.test(body) || body.length > 160));
}

function asksForOwnerInput(value) {
  const text = clean(value);
  if (!text || looksLikeBroadcast(text)) return false;
  const body = withoutURLs(text);
  const conciseQuestion = body.includes("?") && body.length <= 220;
  const explicitAsk = DIRECT_QUESTION.test(body) || CURRENT_FACT_REQUEST.test(body) || EXPLICIT_DECISION_REQUEST.test(body) || conciseQuestion;
  // A promise alone is not a decision for the owner, but a multi-part message
  // may contain both the sender's promise and a direct ask for the owner.
  if (FIRST_PERSON_PROMISE.test(body) && !explicitAsk) return false;
  return Boolean(body && (explicitAsk || DIRECT_ACTION_REQUEST.test(body)));
}

function isPureNonDeliverablePromise(value) {
  const action = clean(value);
  if (!NON_DELIVERABLE_PROMISE.test(action)) return false;
  // The state engine has already identified this as a commitment. Exclude only
  // a pure sentiment/passive promise; never discard a second promised clause
  // merely because the first clause says "think", "wait", "rest", etc.
  return !COMPOSITE_PROMISE_CONTINUATION.test(action);
}

function isGroupChat(chat) {
  return chat?.kind === "group" || String(chat?.id || "").includes("@g.us") || (chat?.connectorIds || []).some((id) => String(id).includes("@g.us"));
}

function unprefix(id) {
  return String(id || "").replace(/^(?:jid|lid|phone):/u, "").trim().toLowerCase();
}

function matchesChat(chat, targetChatId) {
  if (!chat || !targetChatId) return false;
  if (chat.id === targetChatId) return true;
  if (Array.isArray(chat.connectorIds) && chat.connectorIds.includes(targetChatId)) return true;
  const targetClean = unprefix(targetChatId);
  if (unprefix(chat.id) === targetClean) return true;
  if (Array.isArray(chat.connectorIds) && chat.connectorIds.some((id) => unprefix(id) === targetClean)) return true;
  return false;
}

function presentationState(saved = {}, nowMs = Date.now(), observedAt = "", autoStatus = "pending") {
  if (saved.status === "snoozed") {
    const wake = Date.parse(saved.snoozedUntil || "");
    return Number.isFinite(wake) && wake > nowMs ? "snoozed" : "pending";
  }
  if (["pending", "done", "dismissed"].includes(saved.status)) return saved.status;
  if (autoStatus === "done") return "done";
  const observed = Date.parse(observedAt || "");
  return Number.isFinite(observed) && nowMs - observed > WORK_ITEM_FRESHNESS_MS ? "stale" : "pending";
}

export function buildPendingItems(workspaceItems = [], { nowMs = Date.now() } = {}) {
  const pending = [];
  for (const item of workspaceItems) {
    const chat = item?.chat;
    const latest = item?.latest;
    if (!chat) continue;
    if (item?.state && !matchesChat(chat, item.state.chat_id)) continue;
    // Group conversations remain searchable in Chats, but never become a
    // personal decision item. Even a mention can be informational, and the
    // user has explicitly chosen to keep groups out of this queue.
    if (isGroupChat(chat)) continue;
    const seen = new Set();
    if (latest?.direction === "contact" && ageIsCurrent(Number(latest.timestampMs), nowMs) && (chat.kind !== "group" || latest.mentionsOwner === true || latest.quotedMessageId)) {
      const text = clean(latest.text);
      const asksForJudgment = asksForOwnerInput(text);
      const needsPrivateMediaAttention = (latest.media?.category || latest.kind) === "view_once";
      if (asksForJudgment || needsPrivateMediaAttention) {
        pending.push({
          id: `${chat.id}:${latest.id}`,
          chat,
          messageId: latest.id,
          timestampMs: latest.timestampMs,
          preview: text || latest.media?.fileName || ({ image: "Photo", video: "Video", audio: "Audio", document: "Document", sticker: "Sticker", view_once: "View-once media" })[latest.media?.category || latest.kind] || "Media",
          reason: needsPrivateMediaAttention
            ? "Open this private attachment on your phone before deciding."
            : CURRENT_FACT_REQUEST.test(withoutURLs(text))
              ? "Your current fact, choice or commitment is required."
              : "This message asks for your opinion or decision.",
          category: needsPrivateMediaAttention ? "media-review" : "owner-discretion",
        });
        seen.add(latest.id);
      }
    }
    // A question can remain unresolved even after a newer message arrives. Keep
    // it in the decision queue, but only when immutable evidence says the other
    // person asked it and the state engine still marks it current, and no answer
    // has been given yet.
    for (const question of item?.state?.open_questions || []) {
      const sourceId = question.provenance?.source_message_id || question.id;
      if (question.asked_by_owner === true || question.status !== "current" || seen.has(sourceId)) continue;
      const occurred = Date.parse(question.provenance?.occurred_at || "");
      const questionText = clean(question.question || question.provenance?.original_wording);
      if (!ageIsCurrent(occurred, nowMs) || !asksForOwnerInput(questionText)) continue;
      // If the owner has already sent a message after this question occurred, the loop is answered.
      if (latest?.direction === "owner" && Number(latest?.timestampMs) >= occurred) continue;
      // If the conversation is waiting on the contact after this question, the owner already answered.
      if (item?.state?.conversation_status === "awaiting_contact" && Number(latest?.timestampMs || 0) >= occurred) continue;
      // If the contact sent an acknowledgement/closure after the question, the loop was answered.
      if (latest?.direction === "contact" && latest?.id !== sourceId && Number(latest?.timestampMs || 0) > occurred && GENERIC_ACK_OR_CLOSURE.test(clean(latest.text))) continue;
      pending.push({
        id: `${chat.id}:${sourceId}`,
        chat,
        messageId: sourceId,
        timestampMs: Number.isFinite(occurred) ? occurred : latest?.timestampMs || null,
        preview: questionText || "Unanswered question",
        reason: "This question is still unanswered and needs your decision.",
        category: "unanswered-question",
      });
    }
  }
  const priority = { "owner-discretion": 3, "media-review": 2, "unanswered-question": 1 };
  const ordered = pending.sort((a, b) => (priority[b.category] || 0) - (priority[a.category] || 0) || Number(b.timestampMs || 0) - Number(a.timestampMs || 0) || a.id.localeCompare(b.id));
  const byChat = new Map();
  for (const item of ordered) {
    const existing = byChat.get(item.chat.id);
    if (!existing) {
      byChat.set(item.chat.id, { ...item, additionalCount: 0, relatedMessageIds: [item.messageId] });
      continue;
    }
    existing.additionalCount += 1;
    existing.relatedMessageIds.push(item.messageId);
  }
  return [...byChat.values()].sort((a, b) => Number(b.timestampMs || 0) - Number(a.timestampMs || 0) || a.id.localeCompare(b.id));
}

export function buildTaskItems(workspaceItems = [], taskState = { tasks: {} }, { nowMs = Date.now() } = {}) {
  const tasks = [];
  for (const item of workspaceItems) {
    const chat = item?.chat;
    const state = item?.state;
    if (!chat || !state || !matchesChat(chat, state.chat_id) || isGroupChat(chat)) continue;
    for (const commitment of state.commitments || []) {
      if (commitment.actor_is_owner !== true || commitment.status !== "current") continue;
      const action = clean(commitment.action || commitment.provenance?.original_wording);
      // Tasks are every still-open commitment made by the owner, including
      // communication promises such as "I'll check and confirm". They remain
      // here until matching completion evidence is observed or the user closes
      // the loop manually.
      if (!action || isPureNonDeliverablePromise(action)) continue;
      const observedAt = commitment.provenance?.occurred_at || state.updated_at || "";
      const observedMs = occurredAt(observedAt);
      const expiresAt = Date.parse(commitment.expires_at || "");
      if (Number.isFinite(expiresAt) && expiresAt <= nowMs) continue;
      const latest = item?.latest;
      const contactAcknowledged = latest?.direction === "contact"
        && Number(latest?.timestampMs) > observedMs
        && GENERIC_ACK_OR_CLOSURE.test(clean(latest.text));
      const autoStatus = contactAcknowledged ? "done" : "pending";
      const id = `${chat.id}:${commitment.id}`;
      const saved = taskState.tasks?.[id] || {};
      tasks.push({
        id,
        chat,
        commitmentId: commitment.id,
        action,
        sourceMessageId: commitment.provenance?.source_message_id || "",
        observedAt,
        expiresAt: commitment.expires_at || null,
        evidenceConfidence: Number(commitment.provenance?.confidence || 0),
        status: presentationState(saved, nowMs, observedAt, autoStatus),
        confirmedAt: saved.confirmedAt || null,
        snoozedUntil: saved.snoozedUntil || null,
      });
    }
  }
  return tasks.sort((a, b) => {
    const statusOrder = { pending: 0, snoozed: 1, stale: 2, done: 3, dismissed: 4 };
    return statusOrder[a.status] - statusOrder[b.status] || occurredAt(b.observedAt) - occurredAt(a.observedAt) || a.id.localeCompare(b.id);
  });
}

export function buildFollowUpItems(workspaceItems = [], taskState = { tasks: {} }, { nowMs = Date.now() } = {}) {
  const followUps = [];
  for (const item of workspaceItems) {
    const chat = item?.chat;
    const state = item?.state;
    if (!chat || !state || !matchesChat(chat, state.chat_id) || isGroupChat(chat)) continue;
    for (const commitment of state.commitments || []) {
      if (commitment.status !== "current") continue;
      const action = clean(commitment.action || commitment.provenance?.original_wording);
      if (!action || isPureNonDeliverablePromise(action)) continue;
      // Follow-ups represent only promises owed to the owner by the other
      // person. Owner promises belong to Tasks; mixing the two makes ownership
      // ambiguous and was the source of incorrect reminders.
      const waitingOnOtherPerson = commitment.actor_is_owner === false && Boolean(action);
      if (!waitingOnOtherPerson) continue;
      const observedAt = commitment.provenance?.occurred_at || state.updated_at || "";
      const observedMs = occurredAt(observedAt);
      const expiresAt = Date.parse(commitment.expires_at || "");
      if (Number.isFinite(expiresAt) && expiresAt <= nowMs) continue;
      const latest = item?.latest;
      const ownerAcknowledged = latest?.direction === "owner"
        && Number(latest?.timestampMs) > observedMs
        && GENERIC_ACK_OR_CLOSURE.test(clean(latest.text));
      const autoStatus = ownerAcknowledged ? "done" : "pending";
      const id = `${chat.id}:followup:${commitment.id}`;
      const saved = taskState.tasks?.[id] || {};
      followUps.push({
        id,
        chat,
        commitmentId: commitment.id,
        action,
        role: "waiting-on-them",
        sourceMessageId: commitment.provenance?.source_message_id || "",
        observedAt,
        expiresAt: commitment.expires_at || null,
        evidenceConfidence: Number(commitment.provenance?.confidence || 0),
        status: presentationState(saved, nowMs, observedAt, autoStatus),
        confirmedAt: saved.confirmedAt || null,
        snoozedUntil: saved.snoozedUntil || null,
      });
    }
  }
  return followUps.sort((a, b) => {
    const statusOrder = { pending: 0, snoozed: 1, stale: 2, done: 3, dismissed: 4 };
    return statusOrder[a.status] - statusOrder[b.status] || occurredAt(b.observedAt) - occurredAt(a.observedAt) || a.id.localeCompare(b.id);
  });
}
