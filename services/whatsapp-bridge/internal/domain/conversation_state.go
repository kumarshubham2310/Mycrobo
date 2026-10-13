package domain

import (
	"errors"
	"strings"
	"time"
)

// MessageEventType describes an immutable observation about a provider message.
// The messages table remains a convenient current view; this journal is the
// durable source of revisions, edits and deletions used by conversation state.
type MessageEventType string

const (
	MessageObserved MessageEventType = "observed"
	MessageEdited   MessageEventType = "edited"
	MessageRemoved  MessageEventType = "deleted"
)

type MessageEvent struct {
	Sequence          int64            `json:"sequence"`
	ID                string           `json:"id"`
	Type              MessageEventType `json:"type"`
	ChatID            string           `json:"chat_id"`
	MessageID         string           `json:"message_id"`
	SourceMessageID   string           `json:"source_message_id"`
	SupersedesEventID string           `json:"supersedes_event_id,omitempty"`
	SenderID          CanonicalID      `json:"sender_id,omitempty"`
	SenderName        string           `json:"sender_name,omitempty"`
	FromMe            bool             `json:"from_me"`
	Kind              MessageKind      `json:"kind"`
	OriginalText      string           `json:"original_text,omitempty"`
	QuotedMessageID   string           `json:"quoted_message_id,omitempty"`
	OccurredAt        time.Time        `json:"occurred_at"`
	TimestampKnown    bool             `json:"timestamp_known"`
	ObservedAt        time.Time        `json:"observed_at"`
}

func ObservedEventID(message Message) string {
	id := strings.TrimSpace(message.SourceMessageID)
	if id == "" {
		id = strings.TrimSpace(message.ID)
	}
	return "observed:" + id
}

func NewObservedMessageEvent(message Message, observedAt time.Time) MessageEvent {
	return MessageEvent{
		ID:              ObservedEventID(message),
		Type:            MessageObserved,
		ChatID:          message.ChatID,
		MessageID:       message.ID,
		SourceMessageID: message.SourceMessageID,
		SenderID:        message.SenderID,
		SenderName:      message.SenderName,
		FromMe:          message.FromMe,
		Kind:            message.Kind,
		OriginalText:    message.Text,
		QuotedMessageID: message.QuotedMessageID,
		OccurredAt:      message.Timestamp,
		TimestampKnown:  message.TimestampKnown,
		ObservedAt:      observedAt.UTC(),
	}
}

func (event MessageEvent) Validate() error {
	if strings.TrimSpace(event.ID) == "" || strings.TrimSpace(event.ChatID) == "" || strings.TrimSpace(event.MessageID) == "" {
		return errors.New("message event requires id, chat id and message id")
	}
	switch event.Type {
	case MessageObserved, MessageEdited, MessageRemoved:
	default:
		return errors.New("unsupported message event type")
	}
	if event.Type != MessageObserved && strings.TrimSpace(event.SupersedesEventID) == "" {
		return errors.New("message revision must identify the superseded event")
	}
	if event.TimestampKnown && event.OccurredAt.IsZero() {
		return errors.New("verified event timestamp cannot be zero")
	}
	if event.ObservedAt.IsZero() {
		return errors.New("message event observation time cannot be zero")
	}
	return nil
}

type EvidenceStatus string

const (
	EvidenceCurrent    EvidenceStatus = "current"
	EvidenceResolved   EvidenceStatus = "resolved"
	EvidenceExpired    EvidenceStatus = "expired"
	EvidenceSuperseded EvidenceStatus = "superseded"
)

type EvidenceProvenance struct {
	SourceMessageID string      `json:"source_message_id"`
	SourceEventID   string      `json:"source_event_id"`
	SpeakerID       CanonicalID `json:"speaker_id,omitempty"`
	SpeakerName     string      `json:"speaker_name,omitempty"`
	FromMe          bool        `json:"from_me"`
	OriginalWording string      `json:"original_wording"`
	OccurredAt      time.Time   `json:"occurred_at"`
	TimestampKnown  bool        `json:"timestamp_known"`
	Confidence      float64     `json:"confidence"`
	SafeToRepeat    bool        `json:"safe_to_repeat"`
}

type ConversationTopic struct {
	Text       string             `json:"text"`
	Provenance EvidenceProvenance `json:"provenance"`
}

type ConversationQuestion struct {
	ID                  string             `json:"id"`
	Question            string             `json:"question"`
	AskedByOwner        bool               `json:"asked_by_owner"`
	Status              EvidenceStatus     `json:"status"`
	Provenance          EvidenceProvenance `json:"provenance"`
	ResolvedByMessageID string             `json:"resolved_by_message_id,omitempty"`
}

type ConversationCommitment struct {
	ID                     string             `json:"id"`
	ActorIsOwner           bool               `json:"actor_is_owner"`
	Action                 string             `json:"action"`
	Status                 EvidenceStatus     `json:"status"`
	Provenance             EvidenceProvenance `json:"provenance"`
	SourceRequestMessageID string             `json:"source_request_message_id,omitempty"`
	ObjectTerms            []string           `json:"object_terms,omitempty"`
	ExpiresAt              *time.Time         `json:"expires_at,omitempty"`
	ResolvedByMessageID    string             `json:"resolved_by_message_id,omitempty"`
	ResolutionReason       string             `json:"resolution_reason,omitempty"`
	SupersededByMessageID  string             `json:"superseded_by_message_id,omitempty"`
}

type ConversationFact struct {
	ID                    string             `json:"id"`
	Category              string             `json:"category"`
	Fact                  string             `json:"fact"`
	Status                EvidenceStatus     `json:"status"`
	Provenance            EvidenceProvenance `json:"provenance"`
	ExpiresAt             *time.Time         `json:"expires_at,omitempty"`
	SupersededByMessageID string             `json:"superseded_by_message_id,omitempty"`
}

type ConversationState struct {
	ChatID                 string                   `json:"chat_id"`
	Version                int64                    `json:"version"`
	ReducedThroughSequence int64                    `json:"reduced_through_sequence"`
	CurrentTopic           *ConversationTopic       `json:"current_topic,omitempty"`
	OpenQuestions          []ConversationQuestion   `json:"open_questions"`
	Commitments            []ConversationCommitment `json:"commitments"`
	RecentFacts            []ConversationFact       `json:"recent_facts"`
	LatestIntent           string                   `json:"latest_intent"`
	ConversationStatus     string                   `json:"conversation_status"`
	LatestMessageID        string                   `json:"latest_message_id,omitempty"`
	UpdatedAt              time.Time                `json:"updated_at"`
}
