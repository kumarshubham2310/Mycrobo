package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"

	"mycrobo/whatsapp-bridge/internal/domain"
)

var ErrMessageIdentityCollision = errors.New("a message identity conflicts with another conversation or sender; verification is required")
var ErrUnresolvedConversationEvidence = errors.New("unresolved message evidence prevents this chat from being marked complete")

const identityCollisionReason = "message-identity-collision"
const unresolvedHistoryReason = "Unresolved message evidence needs verification before history can be marked complete."

// Until message identities are migrated to a proven account+chat+source key,
// a global source-ID collision must not silently discard an unrelated event.
// Normal replay may carry original pre-edit text, so text is not an identity.
func conflictingMessageIdentity(saved, incoming domain.Message) bool {
	return saved.SourceMessageID != incoming.SourceMessageID || saved.ChatID != incoming.ChatID || saved.SenderID != incoming.SenderID || saved.FromMe != incoming.FromMe
}

func collisionIssueID(saved, incoming domain.Message) string {
	value, _ := json.Marshal([]any{saved.ID, saved.SourceMessageID, saved.ChatID, saved.SenderID, saved.FromMe, incoming.ID, incoming.SourceMessageID, incoming.ChatID, incoming.SenderID, incoming.FromMe})
	sum := sha256.Sum256(value)
	return "identity:" + hex.EncodeToString(sum[:])
}

func unresolvedCountTx(ctx context.Context, tx *sql.Tx, chatID string) (int64, error) {
	var count int64
	err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM (SELECT id FROM protocol_revision_issues WHERE chat_id=? UNION SELECT p.id FROM protocol_revision_issues p JOIN identity_aliases a ON a.alias=p.scope_alias JOIN chats c ON c.identity_id=a.identity_id WHERE c.id=?)`, chatID, chatID).Scan(&count)
	return count, err
}

func recordMessageCollisionTx(ctx context.Context, tx *sql.Tx, saved, incoming domain.Message) error {
	observedAt := time.Now().UTC()
	id := collisionIssueID(saved, incoming)
	scopes := []string{saved.ChatID}
	if incoming.ChatID != saved.ChatID {
		scopes = append(scopes, incoming.ChatID)
	}
	for _, chatID := range scopes {
		var alias string
		err := tx.QueryRowContext(ctx, `SELECT COALESCE(NULLIF(source_id,''),id) FROM chats WHERE id=?`, chatID).Scan(&alias)
		if err != nil {
			return err
		}
		target := incoming.SourceMessageID
		if len(target) > 256 {
			target = ""
		}
		markerID, reason := id, identityCollisionReason
		var existing, count int
		if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM protocol_revision_issues WHERE chat_id=? AND id=?`, chatID, markerID).Scan(&existing); err != nil {
			return err
		}
		if existing == 0 {
			if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM protocol_revision_issues WHERE chat_id=?`, chatID).Scan(&count); err != nil {
				return err
			}
			if count >= maximumProtocolIssuesPerChat {
				markerID = "overflow"
				reason = "issue-capacity-reached"
				target = ""
			}
			result, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO protocol_revision_issues(chat_id,id,scope_alias,target_id,mutation_type,reason,created_at) VALUES(?,?,?,?,?,?,?)`, chatID, markerID, domain.NormalizeAlias(alias), target, "identity_collision", reason, ts(observedAt))
			if err != nil {
				return err
			}
			if n, _ := result.RowsAffected(); n > 0 {
				if _, err = tx.ExecContext(ctx, `INSERT INTO conversation_revisions(chat_id,revision) VALUES(?,1) ON CONFLICT(chat_id) DO UPDATE SET revision=revision+1`, chatID); err != nil {
					return err
				}
			}
		}
		// Preserve imported counts/cursors and all original records. A previous
		// provider terminal flag cannot certify a conversation after evidence loss.
		if _, err = tx.ExecContext(ctx, `INSERT INTO history_sync(chat_id,status,oldest_cursor,newest_cursor,messages_seen,history_end_hit,last_error,updated_at) VALUES(?,'failed','','',0,0,?,?) ON CONFLICT(chat_id) DO UPDATE SET status='failed',history_end_hit=0,last_error=excluded.last_error,updated_at=excluded.updated_at`, chatID, unresolvedHistoryReason, ts(observedAt)); err != nil {
			return err
		}
	}
	return nil
}

func (m *Memory) recordMessageCollision(saved, incoming domain.Message) {
	observedAt := time.Now().UTC()
	id := collisionIssueID(saved, incoming)
	scopes := []string{saved.ChatID}
	if incoming.ChatID != saved.ChatID {
		scopes = append(scopes, incoming.ChatID)
	}
	if m.protocolIssues == nil {
		m.protocolIssues = map[string]map[string]ProtocolRevisionIssue{}
	}
	for _, chatID := range scopes {
		if m.protocolIssues[chatID] == nil {
			m.protocolIssues[chatID] = map[string]ProtocolRevisionIssue{}
		}
		if _, exists := m.protocolIssues[chatID][id]; !exists {
			markerID, reason := id, identityCollisionReason
			target := incoming.SourceMessageID
			if len(target) > 256 {
				target = ""
			}
			if len(m.protocolIssues[chatID]) >= maximumProtocolIssuesPerChat {
				markerID = "overflow"
				reason = "issue-capacity-reached"
				target = ""
			}
			if _, exists := m.protocolIssues[chatID][markerID]; !exists {
				alias := m.chats[chatID].SourceID
				if alias == "" {
					alias = chatID
				}
				m.protocolIssues[chatID][markerID] = ProtocolRevisionIssue{ID: markerID, ScopeAlias: domain.NormalizeAlias(alias), TargetID: target, Type: "identity_collision", Reason: reason, CreatedAt: observedAt}
				m.conversationRevisions[chatID]++
			}
		}
		history := m.history[chatID]
		changed := history.Status != domain.HistoryFailed || history.HistoryEndHit || history.LastError != unresolvedHistoryReason
		history.ChatID = chatID
		history.Status = domain.HistoryFailed
		history.HistoryEndHit = false
		history.LastError = unresolvedHistoryReason
		history.UpdatedAt = observedAt
		m.history[chatID] = history
		if changed {
			m.conversationRevisions[chatID]++
		}
	}
}
