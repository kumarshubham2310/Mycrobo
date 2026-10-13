package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"mycrobo/whatsapp-bridge/internal/domain"
)

var ErrRevisionTargetUnknown = errors.New("the exact original message for this revision is not available")
var ErrRevisionIdentityMismatch = errors.New("the revision does not match the original conversation and sender")
var ErrRevisionClockUncertain = errors.New("the order of the message revisions cannot be verified")

type ProtocolRevisionRepository interface {
	ApplyProtocolRevision(context.Context, domain.ProtocolRevision, time.Time) (domain.ProtocolRevisionResult, error)
}

// The provider revision clock is encoded in this internal immutable event ID.
// OccurredAt retains the original message's occurrence, so editing an earlier
// statement cannot move that statement to Today or reorder the conversation.
// ObservedAt remains the actual local observation time. The hash includes all
// changed semantic fields and prevents duplicate protocol deliveries from
// producing additional journal entries.
func protocolEventID(original domain.Message, revision domain.ProtocolRevision) string {
	clock := int64(0)
	if revision.TimestampKnown {
		clock = revision.SourceTimestamp.UnixMilli()
	}
	// Source IDs are unique within the permanently account-bound vault. Do not
	// hash canonical chat IDs: PN/LID merges must not change an event's identity.
	payload, _ := json.Marshal([]any{original.SourceMessageID, revision.Type, clock, revision.Kind, revision.Text, revision.QuotedMessageID, revision.MentionsOwner})
	sum := sha256.Sum256(payload)
	return "protocol:" + strconv.FormatInt(clock, 10) + ":" + hex.EncodeToString(sum[:])
}

func protocolEventClock(id string) (time.Time, bool) {
	parts := strings.SplitN(id, ":", 3)
	if len(parts) != 3 || parts[0] != "protocol" {
		return time.Time{}, false
	}
	stamp, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil || stamp <= 0 {
		return time.Time{}, false
	}
	return time.UnixMilli(stamp).UTC(), true
}

func prepareProtocolRevision(original domain.Message, previousID string, previousType domain.MessageEventType, revision domain.ProtocolRevision, observedAt time.Time) (domain.Message, domain.MessageEvent, bool, error) {
	if revision.TargetSourceMessageID == "" || original.SourceMessageID != revision.TargetSourceMessageID {
		return original, domain.MessageEvent{}, false, ErrRevisionTargetUnknown
	}
	if revision.FromMe != original.FromMe {
		return original, domain.MessageEvent{}, false, ErrRevisionIdentityMismatch
	}
	if revision.Type != domain.MessageEdited && revision.Type != domain.MessageRemoved {
		return original, domain.MessageEvent{}, false, errors.New("unsupported protocol revision")
	}
	if observedAt.IsZero() {
		return original, domain.MessageEvent{}, false, errors.New("revision observation time is required")
	}
	if previousID == "" {
		return original, domain.MessageEvent{}, false, ErrRevisionTargetUnknown
	}
	// A deleted source is terminal; late edits and duplicate originals cannot
	// resurrect private text, regardless of arrival order or provider timestamps.
	if original.Kind == domain.MessageDeleted || previousType == domain.MessageRemoved {
		return original, domain.MessageEvent{}, false, nil
	}
	if revision.Type == domain.MessageEdited {
		if !revision.TimestampKnown || revision.SourceTimestamp.IsZero() {
			return original, domain.MessageEvent{}, false, ErrRevisionClockUncertain
		}
		if original.TimestampKnown && revision.SourceTimestamp.Before(original.Timestamp) {
			return original, domain.MessageEvent{}, false, ErrRevisionClockUncertain
		}
		if revision.Kind != original.Kind || (revision.Kind != domain.MessageText && revision.Kind != domain.MessageImage && revision.Kind != domain.MessageVideo && revision.Kind != domain.MessageDocument) {
			return original, domain.MessageEvent{}, false, errors.New("unsupported or conflicting edited content type")
		}
	}
	id := protocolEventID(original, revision)
	if id == previousID {
		return original, domain.MessageEvent{}, false, nil
	}
	if previousType == domain.MessageEdited && revision.Type == domain.MessageEdited {
		priorClock, known := protocolEventClock(previousID)
		if !known {
			return original, domain.MessageEvent{}, false, ErrRevisionClockUncertain
		}
		if revision.SourceTimestamp.Before(priorClock) {
			return original, domain.MessageEvent{}, false, nil
		}
		if revision.SourceTimestamp.Equal(priorClock) {
			return original, domain.MessageEvent{}, false, ErrRevisionClockUncertain
		}
	}
	current := original
	if revision.Type == domain.MessageRemoved {
		current.Kind = domain.MessageDeleted
		current.Text = ""
		current.Replyable = false
		current.Media = nil
	} else {
		current.Text = strings.TrimSpace(revision.Text)
		current.Replyable = current.TimestampKnown && current.Kind == domain.MessageText && current.Text != ""
		if revision.QuotedMessageID != nil {
			current.QuotedMessageID = *revision.QuotedMessageID
		}
		if revision.MentionsOwner != nil {
			current.MentionsOwner = *revision.MentionsOwner
		}
	}
	event := domain.NewObservedMessageEvent(current, observedAt)
	event.ID = id
	event.Type = revision.Type
	event.SupersedesEventID = previousID
	if err := event.Validate(); err != nil {
		return original, domain.MessageEvent{}, false, fmt.Errorf("invalid revision evidence: %w", err)
	}
	return current, event, true, nil
}
