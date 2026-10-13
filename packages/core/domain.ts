export type ChatCollection = "active" | "archived";
export type ChatKind = "direct" | "group";
export type MessageDirection = "owner" | "contact" | "system";
export type MessageKind =
  | "text"
  | "image"
  | "video"
  | "audio"
  | "document"
  | "call"
  | "reaction"
  | "deleted"
  | "system";

export type CanonicalChat = {
  id: string;
  /** Opaque local account/tenant boundary. Required by multi-account callers. */
  accountScopeId?: string;
  connector: "personal-pilot" | "official-business" | "fixture";
  connectorIds: string[];
  title: string;
  collection: ChatCollection;
  kind: ChatKind;
  participantIds: string[];
};

export type MessageEvent = {
  id: string;
  /** Opaque local account/tenant boundary. Required by multi-account callers. */
  accountScopeId?: string;
  chatId: string;
  connectorMessageId: string;
  direction: MessageDirection;
  senderId: string | null;
  senderName: string | null;
  kind: MessageKind;
  text: string;
  timestampMs: number | null;
  timestampVerified: boolean;
  sequence: number;
  quotedMessageId?: string | null;
  mentionsOwner?: boolean;
  media?: {
    category: "image" | "video" | "audio" | "document" | "sticker" | "view_once" | "media";
    mimeType: string;
    fileName: string;
    sizeBytes: number;
    width: number;
    height: number;
    status: "metadata_only" | "thumbnail" | "ready" | "expired" | "failed" | "blocked_view_once";
    viewUrl?: string | null;
  } | null;
};

export type SyncWatermark = {
  chatId: string;
  state: "not-started" | "syncing" | "complete" | "partial" | "failed";
  reachedBeginning: boolean;
  oldestTimestampMs: number | null;
  newestTimestampMs: number | null;
  messageCount: number;
  cursor: string | null;
  reason: string;
  verifiedAt: string | null;
};

export type ReplyDecision = {
  shouldDraft: boolean;
  status: "reply-recommended" | "no-reply-needed" | "waiting-for-latest";
  category?: "reply-recommended" | "optional-acknowledgement" | "user-attention-required" | "cannot-decide-without-media" | "conversation-already-answered" | "group-not-addressed" | "waiting-for-latest";
  reason: string;
  target: MessageEvent | null;
};

export type ToneSample = {
  messageId: string;
  chatId: string;
  text: string;
  timestampMs: number;
  relationshipSpecific: boolean;
};
