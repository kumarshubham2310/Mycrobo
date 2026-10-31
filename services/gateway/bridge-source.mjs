import { decideReply, isHumanText, latestVerifiedDisplayableEvent, latestVerifiedHumanMessage } from "../../packages/core/conversation.ts";

function bridgeHeaders(token, extra = {}) {
  return { accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra };
}

async function parseBoundedJSON(response, maximumBytes) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maximumBytes) throw new Error("Bridge response exceeded the safe byte limit.");
  if (!response.body?.getReader) throw new Error("Bridge response streaming is unavailable; bounded parsing was required.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  const fragments = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel().catch(() => {});
        throw new Error("Bridge response exceeded the safe byte limit.");
      }
      fragments.push(decoder.decode(value, { stream: true }));
    }
    fragments.push(decoder.decode());
  } finally {
    reader.releaseLock();
  }
  const raw = fragments.join("");
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error("Bridge returned invalid JSON."); }
}

async function fetchJSON(url, token, options = {}) {
  const response = await fetch(url, { headers: bridgeHeaders(token), signal: AbortSignal.timeout(15_000) });
  const payload = Number(options.maximumBytes) > 0
    ? await parseBoundedJSON(response, Number(options.maximumBytes))
    : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Bridge request failed (${response.status}).`);
  return payload;
}

async function bridgeResponse(response, fallback) {
  const raw = await response.text();
  let payload = {};
  try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = { error: raw.trim() }; }
  if (!response.ok) throw new Error(payload.error || `${fallback} (${response.status}).`);
  return payload;
}

function timestampMs(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function boundedResponseEpisode(episode) {
  const boundedTurn = (turn) => (Array.isArray(turn) ? turn : []).slice(0, 12).map((message) => ({
    ...message,
    text: String(message?.text || "").slice(0, 1_200),
  }));
  return {
    ...episode,
    incoming_turn: boundedTurn(episode?.incoming_turn),
    owner_reply: boundedTurn(episode?.owner_reply),
    source_message_ids: (Array.isArray(episode?.source_message_ids) ? episode.source_message_ids : []).slice(0, 24),
  };
}

function canonicalChat(raw, collection, accountScopeId = "") {
  const connectorIds = [raw.source_id, raw.id].filter(Boolean);
  const participantIds = raw.is_group
    ? (Array.isArray(raw.participant_ids) ? raw.participant_ids.filter(Boolean) : [])
    : [raw.identity_id, raw.contact_identity_id].filter(Boolean);
  return {
    id: raw.id,
    connector: "personal-pilot",
    connectorIds: [...new Set(connectorIds)],
    title: raw.title || "Unnamed chat",
    collection,
    kind: raw.is_group ? "group" : "direct",
    // Direct-chat identity_id is the bridge's canonical alias-resolved person
    // key. Keeping it here lets the drafting core find same-person contexts
    // without relying on display names or exposing phone numbers.
    participantIds: [...new Set(participantIds)],
    historyCoverage: raw.history_coverage || null,
    ...(accountScopeId ? { accountScopeId } : {}),
  };
}

function canonicalEvent(raw, sequence, accountScopeId = "") {
  const kind = raw.kind || "system";
  const visibleKinds = new Set(["text", "image", "video", "audio", "document", "sticker", "view_once", "media"]);
  const direction = visibleKinds.has(kind) ? (raw.from_me ? "owner" : "contact") : "system";
  const time = raw.timestamp_known ? timestampMs(raw.timestamp) : null;
  const rawMedia = raw.media && typeof raw.media === "object" ? raw.media : null;
  const mediaStatus = rawMedia?.status || "metadata_only";
  const mediaCategory = rawMedia?.category || kind;
  const previewAvailable = rawMedia?.preview_available === true;
  const fullAvailable = rawMedia?.full_available === true;
  const fetchAvailable = rawMedia?.fetch_available === true;
  const viewableStatus = mediaCategory === "image" ? previewAvailable : fullAvailable;
  const media = rawMedia ? {
    category: rawMedia.category || kind,
    mimeType: rawMedia.mime_type || "",
    fileName: rawMedia.file_name || "",
    sizeBytes: Number(rawMedia.size_bytes || 0),
    width: Number(rawMedia.width || 0),
    height: Number(rawMedia.height || 0),
    status: mediaStatus,
    previewAvailable,
    fullAvailable,
    fetchAvailable,
    viewUrl: viewableStatus ? `/api/v1/media/${encodeURIComponent(raw.id)}` : null,
  } : (["image", "video", "audio", "document", "sticker", "view_once", "media"].includes(kind) ? {
    category: kind, mimeType: "", fileName: "", sizeBytes: 0, width: 0, height: 0,
    status: kind === "view_once" ? "blocked_view_once" : "metadata_only", viewUrl: null,
  } : null);
  return {
    id: raw.id,
    chatId: raw.chat_id,
    connectorMessageId: raw.source_message_id || raw.id,
    direction,
    senderId: raw.sender_id || null,
    senderName: raw.from_me ? "You" : raw.sender_name || null,
    kind,
    text: raw.text || "",
    timestampMs: time,
    timestampVerified: raw.timestamp_known === true && time !== null,
    sequence,
    quotedMessageId: raw.quoted_message_id || null,
    mentionsOwner: raw.mentions_owner === true,
    media,
    ...(accountScopeId ? { accountScopeId } : {}),
  };
}

function replyDecision(chat, events, watermark, latestSource) {
  const textDecision = decideReply({ chat, events, watermark, ownerIds: [] });
  const latestText = latestVerifiedHumanMessage(events);
  if (latestSource && (!latestText || latestSource.id !== latestText.id)) {
    return {
      shouldDraft: false,
      status: "no-reply-needed",
      category: "cannot-decide-without-media",
      reason: "The newest item is media. View it before deciding whether to reply.",
      target: null,
    };
  }
  return textDecision;
}

export function createBridgeSource(baseURL, apiToken = "", options = {}) {
  const base = baseURL.replace(/\/+$/u, "");
  const rawChats = new Map();
  const nowMs = typeof options.nowMs === "function" ? options.nowMs : Date.now;
  const responseEpisodeCacheTtlMs = Math.max(1_000, Math.min(120_000, Number(options.responseEpisodeCacheTtlMs) || 60_000));
  const messageCacheTtlMs = Math.max(1_000, Math.min(120_000, Number(options.messageCacheTtlMs) || 60_000));
  const responseEpisodeMaximumBytes = Math.max(1_024, Math.min(128 * 1024 * 1024, Number(options.responseEpisodeMaximumBytes) || 32 * 1024 * 1024));
  const responseEpisodeMaximumItems = Math.max(250, Math.min(5_000, Number(options.responseEpisodeMaximumItems) || 2_500));
  const currentStoryMaximumMessages = Math.max(500, Math.min(5_000, Number(options.currentStoryMaximumMessages) || 3_000));
  const configuredAccountScopeId = /^[a-f\d]{64}$/u.test(String(options.expectedAccountScopeId || "").trim().toLocaleLowerCase())
    ? String(options.expectedAccountScopeId).trim().toLocaleLowerCase()
    : "";
  let observedAccountScopeId = configuredAccountScopeId;
  let responseEpisodeCache = null;
  let responseEpisodeRequest = null;
  const messageCache = new Map();

  async function responseEpisodePayload() {
    const now = Number(nowMs());
    if (responseEpisodeCache && now < responseEpisodeCache.expiresAt) return responseEpisodeCache.payload;
    if (responseEpisodeRequest) return responseEpisodeRequest;
    responseEpisodeRequest = fetchJSON(`${base}/v1/response-episodes?limit=${responseEpisodeMaximumItems}`, apiToken, { maximumBytes: responseEpisodeMaximumBytes }).then((payload) => {
      const accountScopeId = String(payload?.account_scope_id || "").trim();
      if (!accountScopeId) throw new Error("The response-episode feed has no verified account scope.");
      if (observedAccountScopeId && observedAccountScopeId !== accountScopeId) {
        responseEpisodeCache = null;
        throw new Error("The response-episode account scope changed unexpectedly.");
      }
      observedAccountScopeId = accountScopeId;
      const boundedPayload = {
        ...payload,
        account_scope_id: accountScopeId,
        items: Array.isArray(payload?.items) ? payload.items.slice(0, responseEpisodeMaximumItems).map(boundedResponseEpisode) : [],
        chat_profiles: Array.isArray(payload?.chat_profiles) ? payload.chat_profiles.slice(0, responseEpisodeMaximumItems) : [],
      };
      responseEpisodeCache = { payload: boundedPayload, expiresAt: Number(nowMs()) + responseEpisodeCacheTtlMs };
      return boundedPayload;
    }).finally(() => {
      responseEpisodeRequest = null;
    });
    return responseEpisodeRequest;
  }

  async function freshness() {
    return fetchJSON(`${base}/v1/freshness`, apiToken);
  }

  async function listRaw(collection) {
    const archived = collection === "archived";
    const all = [];
    let cursor = "";
    for (let page = 0; page < 1000; page += 1) {
      const query = new URLSearchParams({ archived: String(archived), limit: "500" });
      if (cursor) query.set("cursor", cursor);
      const payload = await fetchJSON(`${base}/v1/chats?${query}`, apiToken);
      all.push(...(payload.items || []));
      if (!payload.next_cursor) break;
      if (payload.next_cursor === cursor) throw new Error("Bridge chat cursor stalled.");
      cursor = payload.next_cursor;
    }
    for (const item of all) {
      rawChats.set(item.id, { ...rawChats.get(item.id), ...item, collection });
      if (item.source_id && item.source_id !== item.id) {
        rawChats.set(item.source_id, { ...rawChats.get(item.source_id), ...item, collection });
      }
    }
    return all;
  }

  async function searchRaw(collection, query) {
    const archived = collection === "archived";
    const params = new URLSearchParams({ archived: String(archived), q: query });
    const payload = await fetchJSON(`${base}/v1/search?${params}`, apiToken);
    const items = payload.items || [];
    for (const item of items) {
      rawChats.set(item.id, { ...rawChats.get(item.id), ...item, collection });
      if (item.source_id && item.source_id !== item.id) {
        rawChats.set(item.source_id, { ...rawChats.get(item.source_id), ...item, collection });
      }
    }
    return items;
  }

  async function loadMessages(chatId, accountScopeId) {
    const now = Number(nowMs());
    const cached = messageCache.get(chatId);
    if (cached && cached.accountScopeId === accountScopeId && now < cached.expiresAt) return cached.events;
    const newestFirst = [];
    let before = "";
    for (let page = 0; newestFirst.length < currentStoryMaximumMessages; page += 1) {
      const query = new URLSearchParams({ limit: "1000" });
      if (before) query.set("before", before);
      const payload = await fetchJSON(`${base}/v1/chats/${encodeURIComponent(chatId)}/messages?${query}`, apiToken);
      const items = payload.items || [];
      newestFirst.push(...items);
      if (items.length < 1000) break;
      const next = items.at(-1)?.id || "";
      if (!next || next === before) throw new Error("Bridge message cursor stalled.");
      before = next;
    }
    const events = newestFirst.slice(0, currentStoryMaximumMessages).reverse().map((event, sequence) => canonicalEvent(event, sequence, accountScopeId));
    messageCache.delete(chatId);
    messageCache.set(chatId, { accountScopeId, events, expiresAt: Number(nowMs()) + messageCacheTtlMs });
    while (messageCache.size > 4) messageCache.delete(messageCache.keys().next().value);
    return events;
  }

  async function rawForChat(chatId) {
    let raw = rawChats.get(chatId);
    if (!raw) {
      for (const item of rawChats.values()) {
        if (item.id === chatId || item.source_id === chatId) {
          raw = item;
          break;
        }
      }
    }
    if (!raw) {
      await Promise.all([listRaw("active"), listRaw("archived")]);
      raw = rawChats.get(chatId);
      if (!raw) {
        for (const item of rawChats.values()) {
          if (item.id === chatId || item.source_id === chatId) {
            raw = item;
            break;
          }
        }
      }
    }
    if (!raw) throw new Error("Chat not found.");
    return raw;
  }

  function watermarkOf(chatId, history, fresh, events = [], coverage = null) {
    const current = fresh.state === "current-read-only" && Boolean(fresh.caught_up_at);
    const complete = current && history.status === "complete" && history.history_end_hit === true;
    const human = events.filter(isHumanText);
    return {
      chatId,
      state: complete ? "complete" : history.status === "failed" ? "failed" : current ? "partial" : "syncing",
      reachedBeginning: history.history_end_hit === true,
      oldestTimestampMs: human[0]?.timestampMs ?? null,
      newestTimestampMs: human.at(-1)?.timestampMs ?? null,
      messageCount: Number(coverage?.locally_stored_messages ?? history.messages_seen ?? events.length),
      providerReportedMessageCount: Number(coverage?.provider_reported_messages_seen ?? history.messages_seen ?? 0),
      cursor: history.oldest_cursor || null,
      reason: complete ? "provider-beginning-and-live-catchup-confirmed" : history.last_error || "freshness-or-history-incomplete",
      verifiedAt: current ? fresh.caught_up_at : null,
    };
  }

  function reconciledReadiness(truth, events) {
    const latestSource = latestVerifiedDisplayableEvent(events);
    const latestText = latestVerifiedHumanMessage(events);
    const currentMessage = { ...(truth?.current_message || { state: "unavailable", reason: "The bridge returned no current-message reconciliation." }) };
    const currentStory = { ...(truth?.current_story || { state: "unavailable", reason: "The bridge returned no current-story reconciliation." }) };
    let draftAllowed = truth?.draft_from_current_story_allowed === true;
    if (truth?.latest_source_message_id && latestSource?.id !== truth.latest_source_message_id) {
      currentMessage.state = "stale";
      currentMessage.reason = "The paginated local timeline and bridge latest-source snapshot disagree.";
      currentStory.state = "stale";
      currentStory.reason = "The current story cannot be used while latest-source evidence disagrees.";
      draftAllowed = false;
    }
    if (truth?.latest_text_message_id && latestText?.id !== truth.latest_text_message_id) {
      currentStory.state = "stale";
      currentStory.reason = "The paginated local timeline and bridge latest-text snapshot disagree.";
      draftAllowed = false;
    }
    return {
      currentMessage,
      currentStory,
      relationshipHistory: truth?.relationship_history || { state: "unavailable", reason: "Relationship-history readiness is unavailable." },
      lifetimeHistory: truth?.lifetime_history || { state: "not_started", reason: "Lifetime-history readiness is unavailable." },
      draftAllowed,
      coverage: truth?.coverage || null,
      observedAt: truth?.observed_at || null,
    };
  }

  async function latest(chatId, collectionHint) {
    const raw = await rawForChat(chatId);
    const [payload, fresh] = await Promise.all([
      fetchJSON(`${base}/v1/chats/${encodeURIComponent(chatId)}/latest`, apiToken),
      freshness(),
    ]);
    const event = payload.latest ? canonicalEvent(payload.latest, 0, observedAccountScopeId) : null;
    const latestSource = payload.latest_source ? canonicalEvent(payload.latest_source, 1, observedAccountScopeId) : event;
    const history = payload.history || raw.history || {};
    const watermark = watermarkOf(chatId, history, fresh, [event, latestSource].filter(Boolean), payload.truth?.coverage || raw.history_coverage || null);
    const collection = raw.collection || collectionHint || (raw.archived ? "archived" : "active");
    const chat = canonicalChat(raw, collection, observedAccountScopeId);
    return {
      chat,
      watermark,
      latest: event,
      latestSource,
      readiness: reconciledReadiness(payload.truth, [event, latestSource].filter(Boolean)),
      reply: replyDecision(chat, [event, latestSource].filter(Boolean), watermark, latestSource),
    };
  }

  async function messages(chatId, options = {}) {
    await rawForChat(chatId);
    const pageLimit = Math.max(1, Math.min(200, Number(options.limit) || 200));
    const query = new URLSearchParams({ limit: String(pageLimit) });
    if (options.before) query.set("before", options.before);
    const payload = await fetchJSON(`${base}/v1/chats/${encodeURIComponent(chatId)}/messages?${query}`, apiToken);
    const rawItems = payload.items || [];
    return {
      events: rawItems.slice().reverse().map((event, sequence) => canonicalEvent(event, sequence, observedAccountScopeId)),
      nextBefore: rawItems.length === pageLimit ? rawItems.at(-1)?.id || null : null,
    };
  }

  async function toneContext(chatId) {
    await rawForChat(chatId);
    const [payload, episodePayload] = await Promise.all([
      fetchJSON(`${base}/v1/tone-samples?chat_id=${encodeURIComponent(chatId)}`, apiToken),
      responseEpisodePayload(),
    ]);
    const accountScopeId = String(episodePayload.account_scope_id || "").trim();
    const unique = new Map();
    for (const raw of [...(payload.general || []), ...(payload.person_specific || [])]) {
      const event = canonicalEvent(raw, unique.size, accountScopeId);
      if (event.direction === "owner" && isHumanText(event)) unique.set(`${event.chatId}:${event.id}`, event);
    }
    let responseEpisodeCount = 0;
    for (const episode of episodePayload.items || []) {
      if (episode?.fact_eligible !== false || episode?.use !== "style-learning-only") continue;
      const episodeChatId = String(episode?.chat?.id || episode?.incoming_turn?.[0]?.chat_id || episode?.owner_reply?.[0]?.chat_id || "");
      // The freshly paginated open-chat bundle is added after tone context by
      // buildDraftContext and is authoritative. Avoid retaining a cached copy
      // of that same chat in the cross-chat evidence feed.
      if (!episodeChatId || episodeChatId === chatId) continue;
      responseEpisodeCount += 1;
      for (const raw of [...(episode.incoming_turn || []), ...(episode.owner_reply || [])]) {
        const event = canonicalEvent(raw, unique.size, accountScopeId);
        if (isHumanText(event)) unique.set(`${event.chatId}:${event.id}`, event);
      }
    }
    const rawProfiles = [
      ...(payload.chat_profiles || []),
      ...(episodePayload.chat_profiles || []).filter((profile) => String(profile?.id || "") !== chatId),
    ];
    const chatsById = new Map();
    for (const raw of rawProfiles) {
      const chat = canonicalChat(raw, raw.archived ? "archived" : "active", accountScopeId);
      if (chat.id) chatsById.set(chat.id, chat);
    }
    return {
      events: [...unique.values()],
      chats: [...chatsById.values()],
      accountScopeId,
      responseEpisodeCount,
    };
  }

  async function toneEvents(chatId) {
    return (await toneContext(chatId)).events;
  }

  async function conversationState(chatId) {
	const id = String(chatId || "").trim();
	if (!id) throw new Error("Chat id is required.");
	return fetchJSON(`${base}/v1/chats/${encodeURIComponent(id)}/state`, apiToken);
  }

  async function bundle(chatId, collectionHint) {
    const raw = await rawForChat(chatId);
    const collection = raw.collection || collectionHint || (raw.archived ? "archived" : "active");
    const accountScopeId = observedAccountScopeId || String((await responseEpisodePayload()).account_scope_id || "").trim();
    if (!accountScopeId) throw new Error("The live WhatsApp account has no verified account scope.");
    const [events, fresh, truth] = await Promise.all([
      loadMessages(chatId, accountScopeId),
      freshness(),
      fetchJSON(`${base}/v1/chats/${encodeURIComponent(chatId)}/truth`, apiToken),
    ]);
    const history = raw.history || {};
    const watermark = watermarkOf(chatId, history, fresh, events, truth?.coverage || raw.history_coverage || null);
    const chat = canonicalChat(raw, collection, accountScopeId);
    const latestSource = latestVerifiedDisplayableEvent(events);
    return {
      chat,
      events,
      watermark,
      latest: latestVerifiedHumanMessage(events),
      latestSource,
      readiness: reconciledReadiness(truth, events),
      reply: replyDecision(chat, events, watermark, latestSource),
      accountScopeId,
    };
  }

  return {
    async startImport() {
      const response = await fetch(`${base}/v1/link/start`, {
        method: "POST",
        headers: bridgeHeaders(apiToken, { "content-type": "application/json" }),
        body: JSON.stringify({ import_all_chats: true, include_archived_chats: true, unofficial_risk_accepted: true }),
        signal: AbortSignal.timeout(15_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Connection start failed (${response.status}).`);
      return payload;
    },
    async status() {
      const [health, link, fresh] = await Promise.all([
        fetchJSON(`${base}/v1/health`, apiToken),
        fetchJSON(`${base}/v1/link`, apiToken),
        freshness(),
      ]);
      return {
        product: "MyCrobo",
        apiVersion: "1.0",
        connector: "personal-pilot",
        connected: fresh.state === "current-read-only",
        connectionState: fresh.state,
        readOnly: health.send_available !== true,
        analysisReadOnly: true,
        sendAvailable: health.send_available === true,
        pairing: {
          state: link.state,
          qrImage: link.state === "scan-required" ? "/api/v1/pairing-qr" : null,
          phoneCode: link.state === "phone-code" ? link.phone_code || null : null,
          phoneMasked: link.state === "phone-code" ? link.phone_masked || null : null,
          expiresAt: link.expires_at || null,
          failureCode: link.failure_code || null,
          retryable: link.retryable === true,
          error: link.error || null,
        },
        accountVerification: fresh.account_verification && typeof fresh.account_verification === "object"
          ? {
              state: String(fresh.account_verification.state || "unknown").slice(0, 48),
              failure: fresh.account_verification.failure ? String(fresh.account_verification.failure).slice(0, 64) : null,
              expectedOwnerConfigured: fresh.account_verification.expected_owner_configured === true,
              expectedOwnerMatched: fresh.account_verification.expected_owner_matched === true,
              authenticatedAliasCount: Math.max(0, Math.min(8, Number(fresh.account_verification.authenticated_alias_count || 0))),
              hasPhoneAlias: fresh.account_verification.has_phone_alias === true,
              hasLIDAlias: fresh.account_verification.has_lid_alias === true,
            }
          : null,
        bridge: health.status,
      };
    },
    async listChats(collection) {
      const raw = await listRaw(collection);
      const views = [];
      for (const item of raw) {
        const chat = canonicalChat(item, collection, observedAccountScopeId);
        const latest = item.latest ? canonicalEvent(item.latest, 0, observedAccountScopeId) : null;
        views.push({
          ...chat,
          latest,
          watermark: item.history || null,
          historyCoverage: item.history_coverage || null,
          reply: { shouldDraft: false, status: "waiting-for-latest", reason: "Open the conversation to verify its latest state.", target: null },
        });
      }
      return views;
    },
    toneContext,
    async searchChats(collection, query) {
      const raw = await searchRaw(collection, query);
      return raw.map((item) => ({
        ...canonicalChat(item, collection, observedAccountScopeId),
        latest: item.latest ? canonicalEvent(item.latest, 0, observedAccountScopeId) : null,
        watermark: item.history || null,
        historyCoverage: item.history_coverage || null,
        reply: { shouldDraft: false, status: "waiting-for-latest", reason: "Open the conversation to verify its latest state.", target: null },
      }));
    },
    async pairingQR() {
      const response = await fetch(`${base}/v1/link/qr.png`, {
        headers: bridgeHeaders(apiToken, { accept: "image/png" }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error(`Pairing code is unavailable (${response.status}).`);
      return { bytes: Buffer.from(await response.arrayBuffer()), contentType: response.headers.get("content-type") || "image/png" };
    },
    async pairByPhone(phone) {
      const response = await fetch(`${base}/v1/link/phone`, {
        method: "POST",
        headers: bridgeHeaders(apiToken, { "content-type": "application/json", accept: "application/json" }),
        body: JSON.stringify({ phone }),
        signal: AbortSignal.timeout(20_000),
      });
      const payload = await bridgeResponse(response, "Phone linking code is unavailable");
      return {
        state: payload.state,
        phoneCode: payload.phone_code,
        phoneMasked: payload.phone_masked,
        expiresAt: payload.expires_at,
      };
    },
    async restartPairing() {
      const response = await fetch(`${base}/v1/link/restart`, {
        method: "POST",
        headers: bridgeHeaders(apiToken, { accept: "application/json" }),
        signal: AbortSignal.timeout(25_000),
      });
      const payload = await bridgeResponse(response, "A fresh WhatsApp linking session is unavailable");
      return {
        state: payload.state,
        expiresAt: payload.expires_at,
        failureCode: payload.failure_code || null,
        retryable: payload.retryable === true,
        error: payload.error || null,
      };
    },
    async useQRPairing() {
      const response = await fetch(`${base}/v1/link/qr`, {
        method: "POST",
        headers: bridgeHeaders(apiToken, { accept: "application/json" }),
        signal: AbortSignal.timeout(15_000),
      });
      const payload = await bridgeResponse(response, "QR linking is unavailable");
      return { state: payload.state, expiresAt: payload.expires_at };
    },
    async media(messageId) {
      const response = await fetch(`${base}/v1/media/${encodeURIComponent(messageId)}`, {
        headers: bridgeHeaders(apiToken, { accept: "*/*" }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`Media is unavailable (${response.status}).`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      const maximum = contentType.startsWith("video/") ? 64 * 1024 * 1024 : contentType === "application/pdf" ? 32 * 1024 * 1024 : 12 * 1024 * 1024;
      if (!bytes.length || bytes.length > maximum) throw new Error("Media exceeds the safe local viewing limit.");
      return { bytes, contentType: contentType || "application/octet-stream" };
    },
    async retryMedia(messageId) {
      const response = await fetch(`${base}/v1/media/${encodeURIComponent(messageId)}/fetch`, {
        method: "POST",
        headers: bridgeHeaders(apiToken, { "content-type": "application/json" }),
        signal: AbortSignal.timeout(15_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Attachment could not be fetched (${response.status}).`);
      return payload;
    },
    async logout() {
      const response = await fetch(`${base}/v1/link/logout`, {
        method: "POST",
        headers: bridgeHeaders(apiToken, { "content-type": "application/json" }),
        body: JSON.stringify({ confirm: "LOG OUT WHATSAPP" }),
        signal: AbortSignal.timeout(20_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "WhatsApp could not be logged out.");
      return payload;
    },
    async workspace() {
      const payload = await fetchJSON(`${base}/v1/workspace`, apiToken);
      return (payload.items || []).map((item) => {
        const chat = canonicalChat(item.chat, item.chat?.archived ? "archived" : "active", observedAccountScopeId);
        const state = item.state ? { ...item.state, chat_id: chat.id } : null;
        return {
          chat,
          latest: item.latest ? canonicalEvent(item.latest, 0, observedAccountScopeId) : null,
          state,
        };
      });
    },
    async storage() {
      return fetchJSON(`${base}/v1/storage`, apiToken);
    },
    async truth(chatId) {
      const id = String(chatId || "").trim();
      if (!id) throw new Error("Chat id is required.");
      return fetchJSON(`${base}/v1/chats/${encodeURIComponent(id)}/truth`, apiToken);
    },
    async events(signal) {
      const response = await fetch(`${base}/v1/events`, {
        headers: bridgeHeaders(apiToken, { accept: "text/event-stream" }),
        signal,
      });
      if (!response.ok || !response.body) throw new Error(`Live event stream is unavailable (${response.status}).`);
      return response;
    },
    async approveSend({ chatId, body, targetMessageId, idempotencyKey }) {
      const response = await fetch(`${base}/v1/outbound/approvals`, {
        method: "POST",
        headers: bridgeHeaders(apiToken, { "content-type": "application/json" }),
        body: JSON.stringify({ recipient: chatId, body, target_message_id: targetMessageId, idempotency_key: idempotencyKey }),
        signal: AbortSignal.timeout(15_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Send approval failed (${response.status}).`);
      return payload;
    },
    async sendApproved({ chatId, body, targetMessageId, idempotencyKey, approvalToken }) {
      const response = await fetch(`${base}/v1/outbound/send`, {
        method: "POST",
        headers: bridgeHeaders(apiToken, { "content-type": "application/json" }),
        body: JSON.stringify({ recipient: chatId, body, target_message_id: targetMessageId, idempotency_key: idempotencyKey, approval_token: approvalToken }),
        signal: AbortSignal.timeout(45_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Send failed (${response.status}).`);
      return payload;
    },
    latest,
    messages,
    toneEvents,
	conversationState,
    bundle,
  };
}

export function createBridgeSourceFromEnv(environment = process.env) {
  const value = environment.MYCROBO_BRIDGE_URL?.trim();
  if (!value) return null;
  const token = environment.MYCROBO_BRIDGE_TOKEN?.trim() || "";
  if (token.length < 32) throw new Error("MYCROBO_BRIDGE_TOKEN must contain at least 32 characters.");
  return createBridgeSource(value, token, { expectedAccountScopeId: environment.MYCROBO_EXPECTED_ACCOUNT_SCOPE_ID });
}
