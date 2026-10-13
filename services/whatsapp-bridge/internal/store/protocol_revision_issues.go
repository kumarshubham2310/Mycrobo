package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"time"

	"mycrobo/whatsapp-bridge/internal/domain"
)

const maximumProtocolIssuesPerChat = 256

// This marker stores no message text. Unresolved source revisions block only
// their conversation until the exact operation is successfully reprocessed.
// Restart, reconnection and an unrelated new message never clear the marker.
type ProtocolRevisionIssue struct {
	ID         string
	ScopeAlias string
	TargetID   string
	Type       domain.MessageEventType
	Reason     string
	CreatedAt  time.Time
}

type ProtocolRevisionIssueRepository interface {
	RecordProtocolRevisionIssue(context.Context, domain.ProtocolRevision, string, time.Time) error
	ResolveProtocolRevisionIssue(context.Context, domain.ProtocolRevision) error
}

func protocolIssueID(input domain.ProtocolRevision) string {
	clock := int64(0)
	if input.TimestampKnown {
		clock = input.SourceTimestamp.UnixMilli()
	}
	fallbackID := ""
	if input.TargetSourceMessageID == "" {
		fallbackID = input.ProviderEventID
	}
	// Only a one-way digest persists. Distinct equal-clock conflicting payloads
	// must not share an issue key, otherwise replaying one could clear the other.
	senders := append([]string(nil), input.SenderAliases...)
	for index := range senders {
		senders[index] = domain.NormalizeAlias(senders[index])
	}
	sort.Strings(senders)
	value, _ := json.Marshal([]any{input.TargetSourceMessageID, input.Type, clock, fallbackID, input.Kind, input.Text, input.QuotedMessageID, input.MentionsOwner, input.FromMe, senders})
	sum := sha256.Sum256(value)
	return hex.EncodeToString(sum[:])
}

func protocolIssueReason(err error) string {
	switch {
	case errors.Is(err, ErrRevisionTargetUnknown):
		return "original-not-imported"
	case errors.Is(err, ErrRevisionIdentityMismatch):
		return "identity-unverified"
	case errors.Is(err, ErrRevisionClockUncertain):
		return "revision-order-unverified"
	default:
		return "revision-not-applied"
	}
}

// Error detail is never persisted: only these fixed reason codes are allowed.
func safeProtocolIssueReason(reason string) string {
	switch reason {
	case "original-not-imported", "identity-unverified", "revision-order-unverified", "revision-not-applied", "issue-capacity-reached":
		return reason
	default:
		return "revision-not-applied"
	}
}

func revisionChatTx(ctx context.Context, tx *sql.Tx, aliases []string) (string, string, error) {
	for _, alias := range aliases {
		alias = domain.NormalizeAlias(alias)
		var chatID string
		err := tx.QueryRowContext(ctx, `SELECT c.id FROM chats c JOIN identity_aliases a ON a.identity_id=c.identity_id WHERE a.alias=? LIMIT 1`, alias).Scan(&chatID)
		if err == nil {
			return chatID, alias, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return "", "", err
		}
	}
	return "", "", ErrRevisionIdentityMismatch
}

func (s *SQLite) RecordProtocolRevisionIssue(ctx context.Context, input domain.ProtocolRevision, reason string, observedAt time.Time) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	chatID, alias, err := revisionChatTx(ctx, tx, input.ChatAliases)
	if err != nil {
		if !errors.Is(err, ErrRevisionIdentityMismatch) || len(input.ChatAliases) == 0 {
			return err
		}
		alias = domain.NormalizeAlias(input.ChatAliases[0])
		if alias == "" {
			return err
		}
		chatID = unimportedRevisionScope(alias)
	}
	id := protocolIssueID(input)
	target := input.TargetSourceMessageID
	kind := string(input.Type)
	reason = safeProtocolIssueReason(reason)
	if len(target) > 256 {
		target = ""
	}
	if len(kind) > 24 {
		kind = "unknown"
	}
	var count int
	var existing int
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM protocol_revision_issues WHERE chat_id=? AND id=?`, chatID, id).Scan(&existing); err != nil {
		return err
	}
	if existing > 0 {
		return nil
	}
	if err = tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM protocol_revision_issues WHERE chat_id=?`, chatID).Scan(&count); err != nil {
		return err
	}
	if count >= maximumProtocolIssuesPerChat {
		id = "overflow"
		target = ""
		kind = "unknown"
		reason = "issue-capacity-reached"
	}
	result, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO protocol_revision_issues(chat_id,id,scope_alias,target_id,mutation_type,reason,created_at) VALUES(?,?,?,?,?,?,?)`, chatID, id, alias, target, kind, reason, ts(observedAt))
	if err != nil {
		return err
	}
	if n, _ := result.RowsAffected(); n > 0 {
		if _, err = tx.ExecContext(ctx, `INSERT INTO conversation_revisions(chat_id,revision) VALUES(?,1) ON CONFLICT(chat_id) DO UPDATE SET revision=revision+1`, chatID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *SQLite) ResolveProtocolRevisionIssue(ctx context.Context, input domain.ProtocolRevision) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	chatID, _, err := revisionChatTx(ctx, tx, input.ChatAliases)
	if err != nil {
		return err
	}
	var original domain.Message
	var fromMe int
	if err = tx.QueryRowContext(ctx, `SELECT id,source_message_id,chat_id,sender_id,from_me FROM messages WHERE source_message_id=? AND chat_id=?`, input.TargetSourceMessageID, chatID).Scan(&original.ID, &original.SourceMessageID, &original.ChatID, &original.SenderID, &fromMe); err != nil {
		return ErrRevisionTargetUnknown
	}
	original.FromMe = fromMe != 0
	senderOK, err := revisionAliasMatchesTx(ctx, tx, original.SenderID, input.SenderAliases)
	if err != nil {
		return err
	}
	if !senderOK || original.FromMe != input.FromMe {
		return ErrRevisionIdentityMismatch
	}
	var proof string
	if err = tx.QueryRowContext(ctx, `SELECT event_id FROM message_events WHERE event_id=? AND chat_id=? AND message_id=?`, protocolEventID(original, input), chatID, original.ID).Scan(&proof); err != nil {
		return ErrRevisionTargetUnknown
	}
	// Alias matching retains unresolved markers through canonical identity merges.
	result, err := tx.ExecContext(ctx, `DELETE FROM protocol_revision_issues WHERE id=? AND (chat_id=? OR scope_alias IN (SELECT a.alias FROM identity_aliases a JOIN chats c ON c.identity_id=a.identity_id WHERE c.id=?))`, protocolIssueID(input), chatID, chatID)
	if err != nil {
		return err
	}
	if n, _ := result.RowsAffected(); n > 0 {
		if _, err = tx.ExecContext(ctx, `INSERT INTO conversation_revisions(chat_id,revision) VALUES(?,1) ON CONFLICT(chat_id) DO UPDATE SET revision=revision+1`, chatID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (m *Memory) protocolIssueChat(aliases []string) (string, error) {
	for _, alias := range aliases {
		identity := m.aliases[domain.NormalizeAlias(alias)]
		if identity == "" {
			continue
		}
		for id, chat := range m.chats {
			if chat.IdentityID == identity {
				return id, nil
			}
		}
	}
	return "", ErrRevisionIdentityMismatch
}

func (m *Memory) RecordProtocolRevisionIssue(_ context.Context, input domain.ProtocolRevision, reason string, observedAt time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	chatID, err := m.protocolIssueChat(input.ChatAliases)
	if err != nil {
		if len(input.ChatAliases) == 0 || domain.NormalizeAlias(input.ChatAliases[0]) == "" {
			return err
		}
		chatID = unimportedRevisionScope(domain.NormalizeAlias(input.ChatAliases[0]))
	}
	if m.protocolIssues == nil {
		m.protocolIssues = map[string]map[string]ProtocolRevisionIssue{}
	}
	if m.protocolIssues[chatID] == nil {
		m.protocolIssues[chatID] = map[string]ProtocolRevisionIssue{}
	}
	id := protocolIssueID(input)
	if _, exists := m.protocolIssues[chatID][id]; exists {
		return nil
	}
	issue := ProtocolRevisionIssue{ID: id, ScopeAlias: domain.NormalizeAlias(input.ChatAliases[0]), TargetID: input.TargetSourceMessageID, Type: input.Type, Reason: safeProtocolIssueReason(reason), CreatedAt: observedAt}
	if len(issue.TargetID) > 256 {
		issue.TargetID = ""
	}
	if len(m.protocolIssues[chatID]) >= maximumProtocolIssuesPerChat {
		id = "overflow"
		issue = ProtocolRevisionIssue{ID: id, ScopeAlias: domain.NormalizeAlias(input.ChatAliases[0]), Reason: "issue-capacity-reached", CreatedAt: observedAt}
	}
	if _, exists := m.protocolIssues[chatID][id]; !exists {
		m.protocolIssues[chatID][id] = issue
		m.conversationRevisions[chatID]++
	}
	return nil
}

func (m *Memory) ResolveProtocolRevisionIssue(_ context.Context, input domain.ProtocolRevision) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	chatID, err := m.protocolIssueChat(input.ChatAliases)
	if err != nil {
		return err
	}
	original, found := m.messages[input.TargetSourceMessageID]
	if !found || original.ChatID != chatID {
		return ErrRevisionTargetUnknown
	}
	if !m.revisionAliasMatches(original.SenderID, input.SenderAliases) || original.FromMe != input.FromMe {
		return ErrRevisionIdentityMismatch
	}
	if !m.eventIDs[protocolEventID(original, input)] {
		return ErrRevisionTargetUnknown
	}
	id := protocolIssueID(input)
	identity := m.chats[chatID].IdentityID
	for scope, issues := range m.protocolIssues {
		if issue, exists := issues[id]; exists && (scope == chatID || m.aliases[issue.ScopeAlias] == identity) {
			delete(issues, id)
			m.conversationRevisions[chatID]++
		}
	}
	return nil
}

func unimportedRevisionScope(alias string) string {
	sum := sha256.Sum256([]byte(alias))
	return "unimported:" + hex.EncodeToString(sum[:])
}

func (m *Memory) unresolvedRevisionCount(chatID string) int64 {
	identity := m.chats[chatID].IdentityID
	ids := map[string]bool{}
	for scope, issues := range m.protocolIssues {
		for id, issue := range issues {
			if scope == chatID || (identity != "" && m.aliases[issue.ScopeAlias] == identity) {
				ids[id] = true
			}
		}
	}
	return int64(len(ids))
}

func RevisionIssueReason(err error) string { return protocolIssueReason(err) }
