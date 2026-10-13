package store

import (
	"context"
	"fmt"
	"strings"
)

// ConversationRevision is an opaque invalidation stamp, not a message count or
// a history-completeness claim. Revision advances for relevant projection,
// journal, identity/collection and coverage mutations. EventSequence exposes
// the durable journal cursor independently. No message content is returned.
type ConversationRevision struct {
	ChatID          string `json:"chat_id"`
	Revision        int64  `json:"revision"`
	EventSequence   int64  `json:"event_sequence"`
	UnresolvedCount int64  `json:"unresolved_count"`
}

// The counter is necessary in addition to MAX(sequence): an identity merge can
// move older events into a conversation without increasing its maximum cursor.
// SQL triggers make the counter part of the same transaction as each mutation,
// including repairs made directly to an existing projection.
func (s *SQLite) migrateConversationRevisions(ctx context.Context) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS conversation_revisions (chat_id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0)`); err != nil {
		return fmt.Errorf("conversation revisions: %w", err)
	}
	for _, query := range []string{
		`CREATE INDEX IF NOT EXISTS identity_aliases_identity_id ON identity_aliases(identity_id,alias)`,
		`CREATE TABLE IF NOT EXISTS protocol_revision_issues (chat_id TEXT NOT NULL, id TEXT NOT NULL, scope_alias TEXT NOT NULL, target_id TEXT NOT NULL, mutation_type TEXT NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(chat_id,id))`,
		`CREATE INDEX IF NOT EXISTS protocol_revision_issues_alias ON protocol_revision_issues(scope_alias)`,
	} {
		if _, err = tx.ExecContext(ctx, query); err != nil {
			return err
		}
	}
	for _, spec := range []struct {
		table, chatColumn string
		fields            []string
	}{
		{"messages", "chat_id", []string{"chat_id", "source_message_id", "sender_id", "sender_name", "from_me", "kind", "text", "timestamp", "timestamp_known", "replyable", "quoted_message_id", "mentions_owner", "raw_type"}},
		{"message_events", "chat_id", []string{"chat_id", "event_id", "event_type", "message_id", "source_message_id", "supersedes_event_id", "sender_id", "sender_name", "from_me", "kind", "original_text", "occurred_at", "timestamp_known"}},
		{"chats", "id", []string{"source_id", "identity_id", "title", "is_group", "archived"}},
		{"history_sync", "chat_id", []string{"status", "oldest_cursor", "newest_cursor", "messages_seen", "history_end_hit", "last_error"}},
	} {
		bump := func(row string) string {
			return fmt.Sprintf(`INSERT INTO conversation_revisions(chat_id,revision) VALUES(%s.%s,1) ON CONFLICT(chat_id) DO UPDATE SET revision=revision+1;`, row, spec.chatColumn)
		}
		changed := make([]string, 0, len(spec.fields))
		for _, field := range spec.fields {
			changed = append(changed, "OLD."+field+" IS NOT NEW."+field)
		}
		queries := []string{
			fmt.Sprintf(`CREATE TRIGGER IF NOT EXISTS mycrobo_revision_%s_insert AFTER INSERT ON %s BEGIN %s END`, spec.table, spec.table, bump("NEW")),
			fmt.Sprintf(`CREATE TRIGGER IF NOT EXISTS mycrobo_revision_%s_delete AFTER DELETE ON %s BEGIN %s END`, spec.table, spec.table, bump("OLD")),
			fmt.Sprintf(`CREATE TRIGGER IF NOT EXISTS mycrobo_revision_%s_update AFTER UPDATE ON %s WHEN %s BEGIN %s
				INSERT INTO conversation_revisions(chat_id,revision) SELECT OLD.%s,1 WHERE OLD.%s IS NOT NEW.%s ON CONFLICT(chat_id) DO UPDATE SET revision=revision+1;
				END`, spec.table, spec.table, strings.Join(changed, " OR "), bump("NEW"), spec.chatColumn, spec.chatColumn, spec.chatColumn),
		}
		for _, query := range queries {
			if _, err = tx.ExecContext(ctx, query); err != nil {
				return fmt.Errorf("conversation revision trigger: %w", err)
			}
		}
	}
	return tx.Commit()
}

// This one read uses primary keys and the existing (chat_id,sequence) index;
// it never traverses messages, rebuilds story state or reads private bodies.
func (s *SQLite) ConversationRevision(ctx context.Context, chatID string) (ConversationRevision, error) {
	var snapshot ConversationRevision
	err := s.DB.QueryRowContext(ctx, `SELECT c.id,COALESCE(r.revision,0),
		COALESCE((SELECT sequence FROM message_events WHERE chat_id=c.id ORDER BY sequence DESC LIMIT 1),0),
		(SELECT COUNT(*) FROM (SELECT id FROM protocol_revision_issues WHERE chat_id=c.id UNION SELECT p.id FROM protocol_revision_issues p JOIN identity_aliases a ON a.alias=p.scope_alias WHERE a.identity_id=c.identity_id))
		FROM chats c LEFT JOIN conversation_revisions r ON r.chat_id=c.id WHERE c.id=?`, chatID).
		Scan(&snapshot.ChatID, &snapshot.Revision, &snapshot.EventSequence, &snapshot.UnresolvedCount)
	return snapshot, err
}

func (m *Memory) ConversationRevision(_ context.Context, chatID string) (ConversationRevision, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if _, exists := m.chats[chatID]; !exists {
		return ConversationRevision{}, fmt.Errorf("chat not found")
	}
	return ConversationRevision{ChatID: chatID, Revision: m.conversationRevisions[chatID], EventSequence: m.latestEventSequences[chatID], UnresolvedCount: m.unresolvedRevisionCount(chatID)}, nil
}
