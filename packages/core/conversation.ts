import type {
  CanonicalChat,
  MessageEvent,
  ReplyDecision,
  SyncWatermark,
} from "./domain.ts";

const CONTROL_OR_SYSTEM_TEXT = /^(?:you deleted this message|this message was deleted(?: by (?:an )?admin)?|waiting for this message[^]*|missed (?:voice|video) call(?:\s+click to call back)?|(?:voice|video) call\s+\d+\s*(?:seconds?|minutes?|hours?)|you (?:received|sent) a view once message[^]*|messages and calls are end-to-end encrypted[^]*)$/iu;
const FILE_SIZE = /^\d+(?:[.,]\d+)?\s*(?:bytes?|[kmgt]i?b)$/iu;
const REACTION_CONTROL = /^.{1,160}:\s*reaction\b[^]*view reactions/iu;
const ATTACHMENT_CONTROL = /\.(?:pdf|docx?|xlsx?|pptx?|zip|rar|7z|txt|csv|rtf|jpg|jpeg|png|gif|webp|heic|mp3|m4a|wav|ogg|mp4|mov|avi|mkv)\b[^\n]{0,120}(?:(?:\d+\s*pages?)|(?:\d+(?:[.,]\d+)?\s*(?:bytes?|[kmgt]i?b))|(?:\b(?:pdf|document|audio|video|image)\b\s*[-:]))/iu;

export function normalizeText(value: string) {
  return value.normalize("NFKC").replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/gu, "").replace(/\s+/gu, " ").trim();
}

export function isHumanText(event: MessageEvent) {
  const text = normalizeText(event.text);
  return event.kind === "text"
    && Boolean(text)
    && !CONTROL_OR_SYSTEM_TEXT.test(text)
    && !FILE_SIZE.test(text)
    && !REACTION_CONTROL.test(text)
    && !ATTACHMENT_CONTROL.test(text);
}

const DISPLAYABLE_MEDIA = new Set(["image", "video", "audio", "document", "sticker", "view_once", "media"]);

export function isDisplayableEvent(event: MessageEvent) {
  return event.timestampVerified
    && event.timestampMs !== null
    && (isHumanText(event) || DISPLAYABLE_MEDIA.has(event.kind));
}

export function latestVerifiedDisplayableEvent(events: MessageEvent[]) {
  return orderedEvents(events).filter(isDisplayableEvent).at(-1) ?? null;
}

export function orderedEvents(events: MessageEvent[]) {
  return [...events].sort((left, right) => {
    const leftTime = left.timestampVerified && left.timestampMs !== null
      ? left.timestampMs
      : Number.POSITIVE_INFINITY;
    const rightTime = right.timestampVerified && right.timestampMs !== null
      ? right.timestampMs
      : Number.POSITIVE_INFINITY;
    return leftTime - rightTime || left.sequence - right.sequence || left.id.localeCompare(right.id);
  });
}

export function latestVerifiedHumanMessage(events: MessageEvent[]) {
  return orderedEvents(events)
    .filter((event) => event.timestampVerified && event.timestampMs !== null && isHumanText(event))
    .at(-1) ?? null;
}

export function buildStory(events: MessageEvent[], limit = 160) {
  // A conversation story is not text-only.  Keep verified media alongside
  // human text so a request followed by a PDF, image, video or voice note is
  // interpreted as one turn instead of silently targeting the older caption.
  const human = orderedEvents(events).filter(isDisplayableEvent);
  const boundedLimit = Math.max(40, Math.min(220, Math.floor(limit) || 160));
  if (human.length <= boundedLimit) return human;
  const recent = human.slice(-Math.floor(boundedLimit * 0.7));
  const facts = human
    .slice(0, -recent.length)
    .filter((event) => event.kind !== "text" || /\?|https?:\/\/|\b(?:because|since|but|after|before|payment|meeting|call|rain|today|tomorrow|deadline|confirm|pending)\b|[₹$€£]\s*\d|\b\d{1,4}[/:.-]\d{1,4}\b/iu.test(event.text))
    .slice(-Math.ceil(boundedLimit * 0.3));
  return orderedEvents([...facts, ...recent]);
}

export function decideReply(options: {
  chat: CanonicalChat;
  events: MessageEvent[];
  watermark: SyncWatermark;
  ownerIds: string[];
}): ReplyDecision {
  if (!options.watermark.verifiedAt || options.watermark.state === "syncing" || options.watermark.state === "not-started") {
    return {
      shouldDraft: false,
      status: "waiting-for-latest",
      category: "waiting-for-latest",
      reason: "The exact latest message has not been verified yet.",
      target: null,
    };
  }
  const latest = latestVerifiedDisplayableEvent(options.events);
  if (!latest || latest.direction !== "contact") {
    return {
      shouldDraft: false,
      status: "no-reply-needed",
      category: "conversation-already-answered",
      reason: "The latest verified conversational message is not an unanswered message from someone else.",
      target: null,
    };
  }
  if (options.chat.kind === "direct") {
    if (latest.kind !== "text") {
      return {
        shouldDraft: true,
        status: "reply-recommended",
        category: "user-attention-required",
        reason: "The direct conversation ends with media. Review the attachment before choosing or drafting a reply.",
        target: latest,
      };
    }
    const closing = /^(?:ok(?:ay)?|haan+|haa+|ha+|hmm+|done|fine|thee?k|thik|acha|achha|got it|noted|thanks|thank you|thx|👍|👌|✅|🙂|😊)[.!…\s\p{Extended_Pictographic}]*$/iu.test(normalizeText(latest.text));
    if (closing) {
      return {
        shouldDraft: false,
        status: "no-reply-needed",
        category: "optional-acknowledgement",
        reason: "The direct conversation ends with an acknowledgement or natural closer. A reply is optional.",
        target: latest,
      };
    }
    return {
      shouldDraft: true,
      status: "reply-recommended",
      category: "reply-recommended",
      reason: "The direct conversation ends with a verified incoming message.",
      target: latest,
    };
  }
  const text = normalizeText(latest.text);
  const personallyAddressed = latest.mentionsOwner === true
    || Boolean(latest.quotedMessageId && options.events.some((event) =>
      event.id === latest.quotedMessageId && event.direction === "owner"));
  const actionable = /\?|\b(?:please|pls|plz|send|share|check|review|confirm|update|call|reply|bata|batao|bhej|moklo|karjo|janavjo)\b/iu.test(text);
  if (!personallyAddressed || !actionable) {
    return {
      shouldDraft: false,
      status: "no-reply-needed",
      category: "group-not-addressed",
      reason: "The latest group message is not both personally addressed and actionable.",
      target: null,
    };
  }
  return {
    shouldDraft: true,
    status: "reply-recommended",
    category: "reply-recommended",
    reason: "The latest group message directly asks the owner for an answer or action.",
    target: latest,
  };
}

export function assertTimelineInvariant(events: MessageEvent[]) {
  const ids = new Set<string>();
  for (const event of events) {
    if (ids.has(event.id)) throw new Error(`Duplicate message id: ${event.id}`);
    ids.add(event.id);
    if (event.timestampVerified && (!Number.isFinite(event.timestampMs) || Number(event.timestampMs) <= 0)) {
      throw new Error(`Verified message ${event.id} has no valid timestamp.`);
    }
    if (event.direction === "owner" && !event.senderId) {
      throw new Error(`Owner message ${event.id} has no sender identity.`);
    }
  }
}
