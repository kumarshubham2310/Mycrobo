package domain

import "time"

// ProtocolRevision carries an authenticated provider edit/revoke observation.
// Chat and sender aliases come from connector envelope metadata; quoted keys
// and display names must never establish authority to rewrite a stored message.
type ProtocolRevision struct {
	ProviderEventID       string
	TargetSourceMessageID string
	ChatAliases           []string
	SenderAliases         []string
	FromMe                bool
	Type                  MessageEventType
	Kind                  MessageKind
	Text                  string
	QuotedMessageID       *string
	MentionsOwner         *bool
	SourceTimestamp       time.Time
	TimestampKnown        bool
}

type ProtocolRevisionResult struct {
	Applied  bool
	Verified bool
	Message  Message
}
