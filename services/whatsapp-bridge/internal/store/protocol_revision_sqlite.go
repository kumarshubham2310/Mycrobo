package store

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"mycrobo/whatsapp-bridge/internal/domain"
)

func revisionAliasMatchesTx(ctx context.Context, tx *sql.Tx, id domain.CanonicalID, aliases []string) (bool, error) {
	for _, alias := range aliases {
		alias = domain.NormalizeAlias(alias)
		if alias == "" {
			continue
		}
		var found string
		err := tx.QueryRowContext(ctx, `SELECT identity_id FROM identity_aliases WHERE alias=?`, alias).Scan(&found)
		if err == nil && domain.CanonicalID(found) == id {
			return true, nil
		}
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return false, err
		}
	}
	return false, nil
}

func (s *SQLite) ApplyProtocolRevision(ctx context.Context, input domain.ProtocolRevision, observedAt time.Time) (domain.ProtocolRevisionResult, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return domain.ProtocolRevisionResult{}, err
	}
	defer tx.Rollback()
	var original domain.Message
	var fromMe, known, replyable, mentions int
	var timestamp string
	err = tx.QueryRowContext(ctx, `SELECT id,source_message_id,chat_id,COALESCE(sender_id,''),COALESCE(sender_name,''),from_me,kind,COALESCE(text,''),timestamp,timestamp_known,replyable,COALESCE(quoted_message_id,''),mentions_owner,COALESCE(raw_type,'') FROM messages WHERE source_message_id=?`, input.TargetSourceMessageID).
		Scan(&original.ID, &original.SourceMessageID, &original.ChatID, &original.SenderID, &original.SenderName, &fromMe, &original.Kind, &original.Text, &timestamp, &known, &replyable, &original.QuotedMessageID, &mentions, &original.RawType)
	if errors.Is(err, sql.ErrNoRows) {
		return domain.ProtocolRevisionResult{}, ErrRevisionTargetUnknown
	}
	if err != nil {
		return domain.ProtocolRevisionResult{}, err
	}
	original.FromMe = fromMe != 0
	original.TimestampKnown = known != 0
	original.Timestamp = parseTS(timestamp)
	original.Replyable = replyable != 0
	original.MentionsOwner = mentions != 0
	var chatIdentity domain.CanonicalID
	if err = tx.QueryRowContext(ctx, `SELECT identity_id FROM chats WHERE id=?`, original.ChatID).Scan(&chatIdentity); err != nil {
		return domain.ProtocolRevisionResult{}, ErrRevisionTargetUnknown
	}
	chatOK, err := revisionAliasMatchesTx(ctx, tx, chatIdentity, input.ChatAliases)
	if err != nil {
		return domain.ProtocolRevisionResult{}, err
	}
	senderOK, err := revisionAliasMatchesTx(ctx, tx, original.SenderID, input.SenderAliases)
	if err != nil {
		return domain.ProtocolRevisionResult{}, err
	}
	if !chatOK || !senderOK || original.FromMe != input.FromMe {
		return domain.ProtocolRevisionResult{}, ErrRevisionIdentityMismatch
	}
	var existingID string
	if lookupErr := tx.QueryRowContext(ctx, `SELECT event_id FROM message_events WHERE event_id=? AND chat_id=? AND message_id=?`, protocolEventID(original, input), original.ChatID, original.ID).Scan(&existingID); lookupErr == nil {
		return domain.ProtocolRevisionResult{Verified: true, Message: original}, nil
	} else if !errors.Is(lookupErr, sql.ErrNoRows) {
		return domain.ProtocolRevisionResult{}, lookupErr
	}
	var previousID string
	var previousType domain.MessageEventType
	if err = tx.QueryRowContext(ctx, `SELECT event_id,event_type FROM message_events WHERE message_id=? AND chat_id=? ORDER BY sequence DESC LIMIT 1`, original.ID, original.ChatID).Scan(&previousID, &previousType); err != nil {
		return domain.ProtocolRevisionResult{}, ErrRevisionTargetUnknown
	}
	current, event, apply, err := prepareProtocolRevision(original, previousID, previousType, input, observedAt)
	if err != nil || !apply {
		return domain.ProtocolRevisionResult{Message: original}, err
	}
	inserted, err := insertMessageEventTx(ctx, tx, event)
	if err != nil {
		return domain.ProtocolRevisionResult{}, err
	}
	if !inserted {
		return domain.ProtocolRevisionResult{Message: original}, nil
	}
	if _, err = tx.ExecContext(ctx, `UPDATE messages SET kind=?,text=?,replyable=?,quoted_message_id=?,mentions_owner=? WHERE id=? AND chat_id=?`, current.Kind, current.Text, b(current.Replyable), current.QuotedMessageID, b(current.MentionsOwner), current.ID, current.ChatID); err != nil {
		return domain.ProtocolRevisionResult{}, err
	}
	if err = tx.Commit(); err != nil {
		return domain.ProtocolRevisionResult{}, err
	}
	return domain.ProtocolRevisionResult{Applied: true, Verified: true, Message: current}, nil
}
