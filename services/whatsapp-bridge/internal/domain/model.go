package domain

import (
	"errors"
	"strings"
	"time"
	"unicode"
)

type CanonicalID string

type Identity struct {
	ID        CanonicalID `json:"id"`
	LID       string      `json:"lid,omitempty"`
	Phone     string      `json:"phone,omitempty"`
	PhoneJID  string      `json:"phone_jid,omitempty"`
	Name      string      `json:"name,omitempty"`
	UpdatedAt time.Time   `json:"updated_at"`
}

func NormalizeAlias(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	return strings.TrimSuffix(value, "/")
}

// MeaningfulDisplayName rejects connector noise such as "." while retaining
// names in every script, numbers used for unsaved contacts, and emoji names.
func MeaningfulDisplayName(value string) bool {
	for _, r := range strings.TrimSpace(value) {
		if unicode.IsLetter(r) || unicode.IsNumber(r) || unicode.IsSymbol(r) {
			return true
		}
	}
	return false
}

func CanonicalIdentityID(lid, phoneJID, phone string) (CanonicalID, error) {
	if v := NormalizeAlias(lid); v != "" {
		return CanonicalID("lid:" + v), nil
	}
	if v := NormalizeAlias(phoneJID); v != "" {
		return CanonicalID("jid:" + v), nil
	}
	if v := NormalizeAlias(phone); v != "" {
		return CanonicalID("phone:" + v), nil
	}
	return "", errors.New("identity has no stable alias")
}

type Chat struct {
	ID            string           `json:"id"`
	SourceID      string           `json:"source_id"`
	IdentityID    CanonicalID      `json:"identity_id"`
	Title         string           `json:"title"`
	IsGroup       bool             `json:"is_group"`
	Archived      bool             `json:"archived"`
	LastMessageAt *time.Time       `json:"last_message_at,omitempty"`
	UpdatedAt     time.Time        `json:"updated_at"`
	Latest        *Message         `json:"latest,omitempty"`
	History       *HistorySync     `json:"history,omitempty"`
	Coverage      *HistoryCoverage `json:"history_coverage,omitempty"`
}

// HistoryCoverage reports only evidence that can be measured from the local
// immutable store and the connector's explicit end-of-history signal. It does
// not estimate an unavailable provider-side denominator and therefore never
// presents a percentage as lifetime completeness.
type HistoryCoverage struct {
	ChatID                       string        `json:"chat_id"`
	State                        string        `json:"state"`
	LocallyStoredMessages        int64         `json:"locally_stored_messages"`
	TimestampedMessages          int64         `json:"timestamped_messages"`
	OwnerMessages                int64         `json:"owner_messages"`
	OwnerTextMessages            int64         `json:"owner_text_messages"`
	ContactMessages              int64         `json:"contact_messages"`
	OldestMessageAt              *time.Time    `json:"oldest_message_at,omitempty"`
	NewestMessageAt              *time.Time    `json:"newest_message_at,omitempty"`
	ProviderStatus               HistoryStatus `json:"provider_status,omitempty"`
	ProviderReportedMessagesSeen int64         `json:"provider_reported_messages_seen"`
	ProviderBeginningReached     bool          `json:"provider_beginning_reached"`
	OldestCursor                 string        `json:"oldest_cursor,omitempty"`
	NewestCursor                 string        `json:"newest_cursor,omitempty"`
	LastAttemptAt                *time.Time    `json:"last_attempt_at,omitempty"`
	LastError                    string        `json:"last_error,omitempty"`
}

type MessageKind string

const (
	MessageText     MessageKind = "text"
	MessageMedia    MessageKind = "media"
	MessageImage    MessageKind = "image"
	MessageVideo    MessageKind = "video"
	MessageAudio    MessageKind = "audio"
	MessageDocument MessageKind = "document"
	MessageSticker  MessageKind = "sticker"
	MessageViewOnce MessageKind = "view_once"
	MessageReaction MessageKind = "reaction"
	MessageCall     MessageKind = "call"
	MessageSystem   MessageKind = "system"
	MessageDeleted  MessageKind = "deleted"
)

type MediaMetadata struct {
	Category         string `json:"category"`
	MimeType         string `json:"mime_type,omitempty"`
	FileName         string `json:"file_name,omitempty"`
	SizeBytes        int64  `json:"size_bytes,omitempty"`
	Width            int    `json:"width,omitempty"`
	Height           int    `json:"height,omitempty"`
	Status           string `json:"status"`
	PreviewAvailable bool   `json:"preview_available,omitempty"`
	FullAvailable    bool   `json:"full_available,omitempty"`
	FetchAvailable   bool   `json:"fetch_available,omitempty"`
}

type MediaAsset struct {
	MessageID    string        `json:"message_id"`
	Metadata     MediaMetadata `json:"metadata"`
	Data         []byte        `json:"-"`
	Thumbnail    []byte        `json:"-"`
	DownloadInfo []byte        `json:"-"`
	UpdatedAt    time.Time     `json:"updated_at"`
}

type Message struct {
	ID              string         `json:"id"`
	SourceMessageID string         `json:"source_message_id"`
	ChatID          string         `json:"chat_id"`
	SenderID        CanonicalID    `json:"sender_id,omitempty"`
	SenderName      string         `json:"sender_name,omitempty"`
	FromMe          bool           `json:"from_me"`
	Kind            MessageKind    `json:"kind"`
	Text            string         `json:"text,omitempty"`
	Timestamp       time.Time      `json:"timestamp"`
	TimestampKnown  bool           `json:"timestamp_known"`
	Replyable       bool           `json:"replyable"`
	QuotedMessageID string         `json:"quoted_message_id,omitempty"`
	MentionsOwner   bool           `json:"mentions_owner,omitempty"`
	RawType         string         `json:"raw_type,omitempty"`
	Media           *MediaMetadata `json:"media,omitempty"`
}

// ResponseEpisode is local-only evidence that an owner turn followed an
// incoming turn in one canonical conversation. Historical text remains
// analogy/style evidence and is never authority for a current fact.
//
// Direct chats are safe because Chat.IdentityID is the alias-resolved person.
// Group episodes must not be emitted unless the implementation can prove the
// addressed participant; the repository currently excludes groups entirely.
type ResponseEpisode struct {
	ID               string      `json:"id"`
	PersonID         CanonicalID `json:"person_id"`
	Chat             Chat        `json:"chat"`
	RelationshipKind string      `json:"relationship_kind"`
	IncomingTurn     []Message   `json:"incoming_turn"`
	OwnerReply       []Message   `json:"owner_reply"`
	SourceMessageIDs []string    `json:"source_message_ids"`
	IncomingStarted  time.Time   `json:"incoming_started_at"`
	RepliedAt        time.Time   `json:"replied_at"`
	FactEligible     bool        `json:"fact_eligible"`
	Use              string      `json:"use"`
}

func (m Message) Conversational() bool {
	return m.TimestampKnown && m.Kind == MessageText && strings.TrimSpace(m.Text) != ""
}

type IncomingEvent struct {
	// Identity is retained as a compatibility fallback for simple direct-chat
	// sources. Protocol adapters should set ChatIdentity and SenderIdentity.
	Identity       Identity `json:"identity,omitempty"`
	ChatIdentity   Identity `json:"chat_identity"`
	SenderIdentity Identity `json:"sender_identity"`
	Chat           Chat     `json:"chat"`
	Message        Message  `json:"message"`
}

type HistoryStatus string

const (
	HistoryPending  HistoryStatus = "pending"
	HistoryRunning  HistoryStatus = "running"
	HistoryComplete HistoryStatus = "complete"
	HistoryPartial  HistoryStatus = "partial_provider_limit"
	HistoryFailed   HistoryStatus = "failed"
)

type HistorySync struct {
	ChatID        string        `json:"chat_id"`
	Status        HistoryStatus `json:"status"`
	OldestCursor  string        `json:"oldest_cursor,omitempty"`
	NewestCursor  string        `json:"newest_cursor,omitempty"`
	MessagesSeen  int64         `json:"messages_seen"`
	HistoryEndHit bool          `json:"history_end_hit"`
	LastError     string        `json:"last_error,omitempty"`
	UpdatedAt     time.Time     `json:"updated_at"`
}

type OutboundAudit struct {
	ID              string    `json:"id"`
	IdempotencyKey  string    `json:"idempotency_key"`
	RecipientID     string    `json:"recipient_id"`
	TargetMessageID string    `json:"target_message_id"`
	BodyHash        string    `json:"body_hash"`
	MessageID       string    `json:"message_id,omitempty"`
	Status          string    `json:"status"`
	Error           string    `json:"error,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
}

type ImportConsent struct {
	ID                     string    `json:"id"`
	Connector              string    `json:"connector"`
	ImportAllChats         bool      `json:"import_all_chats"`
	IncludeArchivedChats   bool      `json:"include_archived_chats"`
	UnofficialRiskAccepted bool      `json:"unofficial_risk_accepted"`
	PolicyVersion          string    `json:"policy_version"`
	CreatedAt              time.Time `json:"created_at"`
}
