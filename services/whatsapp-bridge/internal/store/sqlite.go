package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"mycrobo/whatsapp-bridge/internal/domain"
)

// SQLite is driver-neutral. The production composition root must register and
// pass a reviewed SQLite driver; the default build registers none.
type SQLite struct {
	DB   *sql.DB
	Path string
}

type StorageStats struct {
	DatabaseBytes       int64 `json:"database_bytes"`
	JournalBytes        int64 `json:"journal_bytes"`
	AllocatedBytes      int64 `json:"allocated_bytes"`
	FreeBytes           int64 `json:"free_bytes"`
	CachedMediaBytes    int64 `json:"cached_media_bytes"`
	CachedMediaItems    int64 `json:"cached_media_items"`
	MediaCacheLimit     int64 `json:"media_cache_limit"`
	ReclaimedMediaBytes int64 `json:"reclaimed_media_bytes,omitempty"`
}

func NewSQLite(db *sql.DB) *SQLite { return &SQLite{DB: db} }

func (s *SQLite) StorageStats(ctx context.Context, mediaCacheLimit int64) (StorageStats, error) {
	var pageSize, pageCount, freePages int64
	if err := s.DB.QueryRowContext(ctx, "PRAGMA page_size").Scan(&pageSize); err != nil {
		return StorageStats{}, err
	}
	if err := s.DB.QueryRowContext(ctx, "PRAGMA page_count").Scan(&pageCount); err != nil {
		return StorageStats{}, err
	}
	if err := s.DB.QueryRowContext(ctx, "PRAGMA freelist_count").Scan(&freePages); err != nil {
		return StorageStats{}, err
	}
	var mediaBytes, mediaItems int64
	if err := s.DB.QueryRowContext(ctx, `SELECT COALESCE(SUM(length(data)),0),COUNT(*) FROM message_media WHERE data IS NOT NULL AND length(data)>0`).Scan(&mediaBytes, &mediaItems); err != nil {
		return StorageStats{}, err
	}
	stats := StorageStats{
		AllocatedBytes:   pageSize * pageCount,
		FreeBytes:        pageSize * freePages,
		CachedMediaBytes: mediaBytes,
		CachedMediaItems: mediaItems,
		MediaCacheLimit:  mediaCacheLimit,
	}
	if s.Path != "" {
		if info, err := os.Stat(s.Path); err == nil {
			stats.DatabaseBytes = info.Size()
		}
		if info, err := os.Stat(s.Path + "-wal"); err == nil {
			stats.JournalBytes = info.Size()
		}
	}
	return stats, nil
}

// MaintainStorage bounds only the re-fetchable full-media cache. Message text,
// chronology, thumbnails, encrypted download references and provenance remain
// untouched. Oldest cached payloads are evicted first and can be fetched again
// on demand while WhatsApp still exposes them.
func (s *SQLite) MaintainStorage(ctx context.Context, mediaCacheLimit int64, compact bool) (StorageStats, error) {
	if mediaCacheLimit < 32*1024*1024 {
		mediaCacheLimit = 32 * 1024 * 1024
	}
	stats, err := s.StorageStats(ctx, mediaCacheLimit)
	if err != nil {
		return StorageStats{}, err
	}
	remaining := stats.CachedMediaBytes - mediaCacheLimit
	if remaining > 0 {
		rows, queryErr := s.DB.QueryContext(ctx, `SELECT message_id,length(data) FROM message_media
			WHERE data IS NOT NULL AND length(data)>0 ORDER BY updated_at ASC,message_id ASC`)
		if queryErr != nil {
			return StorageStats{}, queryErr
		}
		type cached struct {
			id    string
			bytes int64
		}
		var evict []cached
		var reclaimed int64
		for rows.Next() && reclaimed < remaining {
			var item cached
			if scanErr := rows.Scan(&item.id, &item.bytes); scanErr != nil {
				_ = rows.Close()
				return StorageStats{}, scanErr
			}
			evict = append(evict, item)
			reclaimed += item.bytes
		}
		if closeErr := rows.Close(); closeErr != nil {
			return StorageStats{}, closeErr
		}
		tx, txErr := s.DB.BeginTx(ctx, nil)
		if txErr != nil {
			return StorageStats{}, txErr
		}
		for _, item := range evict {
			if _, txErr = tx.ExecContext(ctx, `UPDATE message_media SET data=NULL,
				status=CASE WHEN thumbnail IS NOT NULL AND length(thumbnail)>0 THEN 'thumbnail' ELSE 'metadata_only' END
				WHERE message_id=?`, item.id); txErr != nil {
				_ = tx.Rollback()
				return StorageStats{}, txErr
			}
		}
		if txErr = tx.Commit(); txErr != nil {
			return StorageStats{}, txErr
		}
		stats.ReclaimedMediaBytes = reclaimed
	}
	if _, err = s.DB.ExecContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
		return StorageStats{}, err
	}
	if compact && stats.ReclaimedMediaBytes >= 32*1024*1024 {
		if _, err = s.DB.ExecContext(ctx, "VACUUM"); err != nil {
			return StorageStats{}, err
		}
		if _, err = s.DB.ExecContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
			return StorageStats{}, err
		}
	}
	after, err := s.StorageStats(ctx, mediaCacheLimit)
	if err != nil {
		return StorageStats{}, err
	}
	after.ReclaimedMediaBytes = stats.ReclaimedMediaBytes
	return after, nil
}

var migrations = []string{`
CREATE TABLE IF NOT EXISTS identities (id TEXT PRIMARY KEY, lid TEXT, phone TEXT, phone_jid TEXT, name TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS identity_aliases (alias TEXT PRIMARY KEY, identity_id TEXT NOT NULL REFERENCES identities(id));
CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, source_id TEXT, identity_id TEXT NOT NULL, title TEXT NOT NULL, is_group INTEGER NOT NULL, archived INTEGER NOT NULL, last_message_at TEXT, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS chats_archive_updated ON chats(archived, updated_at DESC);
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, source_message_id TEXT NOT NULL UNIQUE, chat_id TEXT NOT NULL, sender_id TEXT, sender_name TEXT, from_me INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT, timestamp TEXT NOT NULL, timestamp_known INTEGER NOT NULL, replyable INTEGER NOT NULL, quoted_message_id TEXT, mentions_owner INTEGER NOT NULL DEFAULT 0, raw_type TEXT);
CREATE INDEX IF NOT EXISTS messages_chat_time ON messages(chat_id, timestamp DESC, id DESC);
CREATE INDEX IF NOT EXISTS messages_response_episode_scan ON messages(timestamp_known, timestamp DESC, chat_id, kind, from_me);
CREATE TABLE IF NOT EXISTS message_media (message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, category TEXT NOT NULL, mime_type TEXT, file_name TEXT, size_bytes INTEGER NOT NULL DEFAULT 0, width INTEGER NOT NULL DEFAULT 0, height INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, data BLOB, thumbnail BLOB, download_info BLOB, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS history_sync (chat_id TEXT PRIMARY KEY, status TEXT NOT NULL, oldest_cursor TEXT, newest_cursor TEXT, messages_seen INTEGER NOT NULL, history_end_hit INTEGER NOT NULL, last_error TEXT, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outbound_audit (id TEXT PRIMARY KEY, idempotency_key TEXT, recipient_id TEXT NOT NULL, target_message_id TEXT, body_hash TEXT NOT NULL, message_id TEXT, status TEXT NOT NULL, error TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS import_consents (id TEXT PRIMARY KEY, connector TEXT NOT NULL, import_all_chats INTEGER NOT NULL, include_archived_chats INTEGER NOT NULL, unofficial_risk_accepted INTEGER NOT NULL, policy_version TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS message_events (
	sequence INTEGER PRIMARY KEY AUTOINCREMENT,
	event_id TEXT NOT NULL UNIQUE,
	event_type TEXT NOT NULL,
	chat_id TEXT NOT NULL,
	message_id TEXT NOT NULL,
	source_message_id TEXT,
	supersedes_event_id TEXT,
	sender_id TEXT,
	sender_name TEXT,
	from_me INTEGER NOT NULL,
	kind TEXT NOT NULL,
	original_text TEXT,
	occurred_at TEXT NOT NULL,
	timestamp_known INTEGER NOT NULL,
	observed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS message_events_chat_sequence ON message_events(chat_id,sequence);
CREATE INDEX IF NOT EXISTS message_events_message_sequence ON message_events(message_id,sequence);
CREATE TABLE IF NOT EXISTS conversation_states (
	chat_id TEXT PRIMARY KEY,
	version INTEGER NOT NULL,
	reduced_through_sequence INTEGER NOT NULL,
	payload_json TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
`}

func (s *SQLite) Migrate(ctx context.Context) error {
	for _, q := range migrations {
		if _, err := s.DB.ExecContext(ctx, q); err != nil {
			return fmt.Errorf("sqlite migration: %w", err)
		}
	}
	if err := s.ensureColumn(ctx, "messages", "sender_name", "TEXT"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "messages", "quoted_message_id", "TEXT"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "messages", "mentions_owner", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "chats", "source_id", "TEXT"); err != nil {
		return err
	}
	if err := s.ensureColumn(ctx, "message_media", "download_info", "BLOB"); err != nil {
		return err
	}
	if err := s.migrateConversationRevisions(ctx); err != nil {
		return err
	}
	if _, err := s.DB.ExecContext(ctx, `UPDATE message_media SET status='ready' WHERE data IS NOT NULL AND length(data)>0 AND status<>'blocked_view_once'`); err != nil {
		return fmt.Errorf("sqlite repair cached media readiness: %w", err)
	}
	for _, column := range []struct{ name, declaration string }{
		{"idempotency_key", "TEXT"},
		{"target_message_id", "TEXT"},
		{"message_id", "TEXT"},
	} {
		if err := s.ensureColumn(ctx, "outbound_audit", column.name, column.declaration); err != nil {
			return err
		}
	}
	if _, err := s.DB.ExecContext(ctx, "CREATE INDEX IF NOT EXISTS outbound_audit_idempotency ON outbound_audit(idempotency_key,created_at DESC)"); err != nil {
		return fmt.Errorf("sqlite index outbound audit idempotency: %w", err)
	}
	if _, err := s.DB.ExecContext(ctx, "UPDATE chats SET source_id=id WHERE source_id IS NULL OR source_id=''"); err != nil {
		return fmt.Errorf("sqlite backfill chats.source_id: %w", err)
	}
	// Existing installations predate the event journal. Preserve every stored
	// message as its original observed event before any identity merge runs.
	if _, err := s.DB.ExecContext(ctx, `INSERT OR IGNORE INTO message_events(event_id,event_type,chat_id,message_id,source_message_id,sender_id,sender_name,from_me,kind,original_text,occurred_at,timestamp_known,observed_at)
		SELECT 'observed:' || source_message_id, 'observed', chat_id, id, source_message_id, sender_id, sender_name, from_me, kind, text, timestamp, timestamp_known, ?
		FROM messages ORDER BY rowid`, ts(time.Now().UTC())); err != nil {
		return fmt.Errorf("sqlite backfill message event journal: %w", err)
	}
	if err := s.mergeDuplicateChats(ctx); err != nil {
		return fmt.Errorf("sqlite merge duplicate chats: %w", err)
	}
	return nil
}

func preferredCanonical(ids []string) string {
	for _, id := range ids {
		if strings.HasPrefix(id, "lid:") {
			return id
		}
	}
	if len(ids) > 0 {
		return ids[0]
	}
	return ""
}

func mergeHistoryTx(ctx context.Context, tx *sql.Tx, winner, loser string) error {
	type saved struct {
		status, oldest, newest, lastError, updated string
		seen                                       int64
		end                                        int
		found                                      bool
	}
	read := func(id string) (saved, error) {
		var v saved
		err := tx.QueryRowContext(ctx, `SELECT status,oldest_cursor,newest_cursor,messages_seen,history_end_hit,last_error,updated_at FROM history_sync WHERE chat_id=?`, id).Scan(&v.status, &v.oldest, &v.newest, &v.seen, &v.end, &v.lastError, &v.updated)
		if err == sql.ErrNoRows {
			return v, nil
		}
		v.found = err == nil
		return v, err
	}
	a, err := read(winner)
	if err != nil {
		return err
	}
	b, err := read(loser)
	if err != nil {
		return err
	}
	if !a.found && !b.found {
		return nil
	}
	var count int64
	if err = tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM messages WHERE chat_id=?", winner).Scan(&count); err != nil {
		return err
	}
	oldest := a.oldest
	if oldest == "" {
		oldest = b.oldest
	}
	newest := a.newest
	if newest == "" {
		newest = b.newest
	}
	end := a.end != 0 || b.end != 0
	status := string(domain.HistoryPending)
	if end {
		status = string(domain.HistoryComplete)
	}
	updated := a.updated
	if b.updated > updated {
		updated = b.updated
	}
	if updated == "" {
		updated = ts(time.Now().UTC())
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO history_sync(chat_id,status,oldest_cursor,newest_cursor,messages_seen,history_end_hit,last_error,updated_at)
		VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET status=excluded.status,oldest_cursor=excluded.oldest_cursor,newest_cursor=excluded.newest_cursor,messages_seen=excluded.messages_seen,history_end_hit=excluded.history_end_hit,last_error=excluded.last_error,updated_at=excluded.updated_at`, winner, status, oldest, newest, count, b2i(end), "", updated); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, "DELETE FROM history_sync WHERE chat_id=?", loser)
	return err
}

func b2i(v bool) int {
	if v {
		return 1
	}
	return 0
}

func mergeCanonicalTx(ctx context.Context, tx *sql.Tx, winner, loser string) error {
	if winner == "" || loser == "" || winner == loser {
		return nil
	}
	// Consolidate the conversation before deleting the obsolete identity. The
	// global provider message ID remains the deduplication key, so this cannot
	// create duplicate messages.
	if _, err := tx.ExecContext(ctx, "UPDATE messages SET chat_id=? WHERE chat_id=?", winner, loser); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE message_events SET chat_id=? WHERE chat_id=?", winner, loser); err != nil {
		return err
	}
	// A merged identity changes the event set for the winner. Discard both
	// derived snapshots so the reducer cannot serve stale materialized state.
	if _, err := tx.ExecContext(ctx, "DELETE FROM conversation_states WHERE chat_id IN (?,?)", winner, loser); err != nil {
		return err
	}
	if err := mergeHistoryTx(ctx, tx, winner, loser); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE chats SET
		source_id=COALESCE(NULLIF(source_id,''),(SELECT source_id FROM chats WHERE id=?)),
		title=CASE WHEN TRIM(title)='' THEN COALESCE((SELECT title FROM chats WHERE id=?),'') ELSE title END,
		archived=CASE WHEN COALESCE((SELECT updated_at FROM chats WHERE id=?),'') > updated_at THEN COALESCE((SELECT archived FROM chats WHERE id=?),archived) ELSE archived END,
		last_message_at=CASE WHEN COALESCE((SELECT last_message_at FROM chats WHERE id=?),'') > COALESCE(last_message_at,'') THEN (SELECT last_message_at FROM chats WHERE id=?) ELSE last_message_at END,
		updated_at=CASE WHEN COALESCE((SELECT updated_at FROM chats WHERE id=?),'') > updated_at THEN (SELECT updated_at FROM chats WHERE id=?) ELSE updated_at END
		WHERE id=?`, loser, loser, loser, loser, loser, loser, loser, loser, winner); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE chats SET identity_id=? WHERE identity_id=?", winner, loser); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE messages SET sender_id=? WHERE sender_id=?", winner, loser); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE outbound_audit SET recipient_id=? WHERE recipient_id=?", winner, loser); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE identity_aliases SET identity_id=? WHERE identity_id=?", winner, loser); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE identities SET
		lid=COALESCE(NULLIF(lid,''),(SELECT lid FROM identities WHERE id=?)),
		phone=COALESCE(NULLIF(phone,''),(SELECT phone FROM identities WHERE id=?)),
		phone_jid=COALESCE(NULLIF(phone_jid,''),(SELECT phone_jid FROM identities WHERE id=?)),
		name=COALESCE(NULLIF(name,''),(SELECT name FROM identities WHERE id=?)),
		updated_at=CASE WHEN COALESCE((SELECT updated_at FROM identities WHERE id=?),'') > updated_at THEN (SELECT updated_at FROM identities WHERE id=?) ELSE updated_at END
		WHERE id=?`, loser, loser, loser, loser, loser, loser, winner); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM chats WHERE id=?", loser); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, "DELETE FROM identities WHERE id=?", loser)
	return err
}

func (s *SQLite) mergeDuplicateChats(ctx context.Context) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	rows, err := tx.QueryContext(ctx, `SELECT source_id,id FROM chats WHERE TRIM(COALESCE(source_id,''))<>'' ORDER BY source_id,id`)
	if err != nil {
		return err
	}
	groups := make(map[string][]string)
	for rows.Next() {
		var sourceID, id string
		if err = rows.Scan(&sourceID, &id); err != nil {
			_ = rows.Close()
			return err
		}
		groups[domain.NormalizeAlias(sourceID)] = append(groups[domain.NormalizeAlias(sourceID)], id)
	}
	if err = rows.Close(); err != nil {
		return err
	}
	for _, ids := range groups {
		if len(ids) < 2 {
			continue
		}
		winner := preferredCanonical(ids)
		for _, loser := range ids {
			if loser != winner {
				if err = mergeCanonicalTx(ctx, tx, winner, loser); err != nil {
					return err
				}
			}
		}
	}
	return tx.Commit()
}
func (s *SQLite) ensureColumn(ctx context.Context, table, column, declaration string) error {
	rows, err := s.DB.QueryContext(ctx, "PRAGMA table_info("+table+")")
	if err != nil {
		return err
	}
	found := false
	for rows.Next() {
		var cid int
		var name, kind string
		var notNull, pk int
		var defaultValue any
		if err = rows.Scan(&cid, &name, &kind, &notNull, &defaultValue, &pk); err != nil {
			_ = rows.Close()
			return err
		}
		if name == column {
			found = true
		}
	}
	if err = rows.Close(); err != nil {
		return err
	}
	if found {
		return nil
	}
	if _, err = s.DB.ExecContext(ctx, "ALTER TABLE "+table+" ADD COLUMN "+column+" "+declaration); err != nil {
		return fmt.Errorf("sqlite add %s.%s: %w", table, column, err)
	}
	return nil
}
func ts(v time.Time) string      { return v.UTC().Format(time.RFC3339Nano) }
func parseTS(v string) time.Time { t, _ := time.Parse(time.RFC3339Nano, v); return t }
func b(v bool) int {
	if v {
		return 1
	}
	return 0
}

func (s *SQLite) UpsertIdentity(ctx context.Context, v domain.Identity) (domain.Identity, error) {
	if !domain.MeaningfulDisplayName(v.Name) {
		v.Name = ""
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return v, err
	}
	defer tx.Rollback()
	aliases := identityAliases(v)
	var matched []string
	for _, a := range aliases {
		if a == "" {
			continue
		}
		var id string
		if tx.QueryRowContext(ctx, "SELECT identity_id FROM identity_aliases WHERE alias=?", a).Scan(&id) == nil {
			if !slicesContains(matched, id) {
				matched = append(matched, id)
			}
		}
	}
	if len(matched) > 0 {
		winner := preferredCanonical(matched)
		v.ID = domain.CanonicalID(winner)
		for _, loser := range matched {
			if loser != winner {
				if err = mergeCanonicalTx(ctx, tx, winner, loser); err != nil {
					return v, err
				}
			}
		}
	}
	if v.ID == "" {
		v.ID, err = domain.CanonicalIdentityID(v.LID, v.PhoneJID, v.Phone)
		if err != nil {
			return v, err
		}
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO identities(id,lid,phone,phone_jid,name,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET lid=COALESCE(NULLIF(excluded.lid,''),lid),phone=COALESCE(NULLIF(excluded.phone,''),phone),phone_jid=COALESCE(NULLIF(excluded.phone_jid,''),phone_jid),name=COALESCE(NULLIF(excluded.name,''),name),updated_at=excluded.updated_at`, v.ID, v.LID, v.Phone, v.PhoneJID, v.Name, ts(v.UpdatedAt))
	if err != nil {
		return v, err
	}
	for _, a := range aliases {
		if a != "" {
			if _, err = tx.ExecContext(ctx, "INSERT INTO identity_aliases(alias,identity_id) VALUES(?,?) ON CONFLICT(alias) DO UPDATE SET identity_id=excluded.identity_id", a, v.ID); err != nil {
				return v, err
			}
		}
	}
	var updatedAt string
	if err = tx.QueryRowContext(ctx, "SELECT lid,phone,phone_jid,name,updated_at FROM identities WHERE id=?", v.ID).Scan(&v.LID, &v.Phone, &v.PhoneJID, &v.Name, &updatedAt); err != nil {
		return v, err
	}
	v.UpdatedAt = parseTS(updatedAt)
	return v, tx.Commit()
}

func slicesContains(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}

func (s *SQLite) GetIdentity(ctx context.Context, id domain.CanonicalID) (domain.Identity, error) {
	var value domain.Identity
	var updatedAt string
	value.ID = id
	if err := s.DB.QueryRowContext(ctx, "SELECT lid,phone,phone_jid,name,updated_at FROM identities WHERE id=?", id).Scan(&value.LID, &value.Phone, &value.PhoneJID, &value.Name, &updatedAt); err != nil {
		return domain.Identity{}, err
	}
	value.UpdatedAt = parseTS(updatedAt)
	return value, nil
}

func (s *SQLite) UpsertChat(ctx context.Context, v domain.Chat) error {
	if !domain.MeaningfulDisplayName(v.Title) {
		v.Title = ""
	}
	_, err := s.DB.ExecContext(ctx, `INSERT INTO chats(id,source_id,identity_id,title,is_group,archived,last_message_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
		source_id=CASE WHEN excluded.source_id='' THEN chats.source_id ELSE excluded.source_id END,
		identity_id=CASE WHEN excluded.identity_id='' THEN chats.identity_id ELSE excluded.identity_id END,
		title=CASE WHEN TRIM(excluded.title)='' THEN chats.title ELSE excluded.title END,
		is_group=excluded.is_group,
		archived=excluded.archived,
		last_message_at=CASE
			WHEN chats.last_message_at IS NULL THEN excluded.last_message_at
			WHEN excluded.last_message_at IS NULL THEN chats.last_message_at
			WHEN excluded.last_message_at > chats.last_message_at THEN excluded.last_message_at
			ELSE chats.last_message_at END,
		updated_at=CASE WHEN excluded.updated_at > chats.updated_at THEN excluded.updated_at ELSE chats.updated_at END`, v.ID, v.SourceID, v.IdentityID, v.Title, b(v.IsGroup), b(v.Archived), nullableTime(v.LastMessageAt), ts(v.UpdatedAt))
	return err
}
func nullableTime(v *time.Time) any {
	if v == nil {
		return nil
	}
	return ts(*v)
}
func (s *SQLite) InsertMessage(ctx context.Context, v domain.Message) (bool, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	r, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO messages(id,source_message_id,chat_id,sender_id,sender_name,from_me,kind,text,timestamp,timestamp_known,replyable,quoted_message_id,mentions_owner,raw_type) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, v.ID, v.SourceMessageID, v.ChatID, v.SenderID, v.SenderName, b(v.FromMe), v.Kind, v.Text, ts(v.Timestamp), b(v.TimestampKnown), b(v.Replyable), v.QuotedMessageID, b(v.MentionsOwner), v.RawType)
	if err != nil {
		return false, err
	}
	n, _ := r.RowsAffected()
	if n == 0 {
		rows, readErr := tx.QueryContext(ctx, `SELECT id,source_message_id,chat_id,COALESCE(sender_id,''),from_me FROM messages WHERE source_message_id=? OR id=?`, v.SourceMessageID, v.ID)
		if readErr != nil {
			return false, readErr
		}
		var conflicts []domain.Message
		for rows.Next() {
			var saved domain.Message
			var fromMe int
			if readErr = rows.Scan(&saved.ID, &saved.SourceMessageID, &saved.ChatID, &saved.SenderID, &fromMe); readErr != nil {
				rows.Close()
				return false, readErr
			}
			saved.FromMe = fromMe != 0
			if conflictingMessageIdentity(saved, v) {
				conflicts = append(conflicts, saved)
			}
		}
		readErr = rows.Err()
		rows.Close()
		if readErr != nil {
			return false, readErr
		}
		if len(conflicts) > 0 {
			for _, saved := range conflicts {
				if err = recordMessageCollisionTx(ctx, tx, saved, v); err != nil {
					return false, err
				}
			}
			if err = tx.Commit(); err != nil {
				return false, err
			}
			return false, ErrMessageIdentityCollision
		}
		return false, nil
	}
	event := domain.NewObservedMessageEvent(v, time.Now().UTC())
	if _, err = insertMessageEventTx(ctx, tx, event); err != nil {
		return false, err
	}
	if err = tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

func insertMessageEventTx(ctx context.Context, tx *sql.Tx, event domain.MessageEvent) (bool, error) {
	if err := event.Validate(); err != nil {
		return false, err
	}
	result, err := tx.ExecContext(ctx, `INSERT OR IGNORE INTO message_events(event_id,event_type,chat_id,message_id,source_message_id,supersedes_event_id,sender_id,sender_name,from_me,kind,original_text,occurred_at,timestamp_known,observed_at)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, event.ID, event.Type, event.ChatID, event.MessageID, event.SourceMessageID, event.SupersedesEventID, event.SenderID, event.SenderName, b(event.FromMe), event.Kind, event.OriginalText, ts(event.OccurredAt), b(event.TimestampKnown), ts(event.ObservedAt))
	if err != nil {
		return false, err
	}
	n, _ := result.RowsAffected()
	return n > 0, nil
}

func (s *SQLite) AppendMessageEvent(ctx context.Context, event domain.MessageEvent) (bool, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	inserted, err := insertMessageEventTx(ctx, tx, event)
	if err != nil {
		return false, err
	}
	if !inserted {
		return false, nil
	}
	if err = tx.Commit(); err != nil {
		return false, err
	}
	return true, nil
}

func (s *SQLite) ListMessageEvents(ctx context.Context, chatID string, afterSequence int64, limit int) ([]domain.MessageEvent, error) {
	if limit <= 0 || limit > 10000 {
		limit = 5000
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT sequence,event_id,event_type,chat_id,message_id,source_message_id,COALESCE(supersedes_event_id,''),COALESCE(sender_id,''),COALESCE(sender_name,''),from_me,kind,COALESCE(original_text,''),occurred_at,timestamp_known,observed_at
		FROM message_events WHERE (chat_id=? OR chat_id=(SELECT source_id FROM chats WHERE id=? OR source_id=?) OR chat_id=(SELECT id FROM chats WHERE id=? OR source_id=?)) AND sequence>? ORDER BY sequence LIMIT ?`, chatID, chatID, chatID, chatID, chatID, afterSequence, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.MessageEvent
	for rows.Next() {
		var event domain.MessageEvent
		var fromMe, known int
		var occurred, observed string
		if err = rows.Scan(&event.Sequence, &event.ID, &event.Type, &event.ChatID, &event.MessageID, &event.SourceMessageID, &event.SupersedesEventID, &event.SenderID, &event.SenderName, &fromMe, &event.Kind, &event.OriginalText, &occurred, &known, &observed); err != nil {
			return nil, err
		}
		event.FromMe = fromMe != 0
		event.TimestampKnown = known != 0
		event.OccurredAt = parseTS(occurred)
		event.ObservedAt = parseTS(observed)
		out = append(out, event)
	}
	return out, rows.Err()
}

func (s *SQLite) PutConversationState(ctx context.Context, state domain.ConversationState) error {
	if strings.TrimSpace(state.ChatID) == "" || state.Version <= 0 {
		return fmt.Errorf("invalid conversation state")
	}
	payload, err := json.Marshal(state)
	if err != nil {
		return err
	}
	_, err = s.DB.ExecContext(ctx, `INSERT INTO conversation_states(chat_id,version,reduced_through_sequence,payload_json,updated_at) VALUES(?,?,?,?,?)
		ON CONFLICT(chat_id) DO UPDATE SET version=excluded.version,reduced_through_sequence=excluded.reduced_through_sequence,payload_json=excluded.payload_json,updated_at=excluded.updated_at
		WHERE excluded.reduced_through_sequence>=conversation_states.reduced_through_sequence`, state.ChatID, state.Version, state.ReducedThroughSequence, string(payload), ts(state.UpdatedAt))
	return err
}

func (s *SQLite) GetConversationState(ctx context.Context, chatID string) (domain.ConversationState, error) {
	var state domain.ConversationState
	var payload string
	if err := s.DB.QueryRowContext(ctx, `SELECT payload_json FROM conversation_states WHERE (chat_id=? OR chat_id=(SELECT source_id FROM chats WHERE id=? OR source_id=?) OR chat_id=(SELECT id FROM chats WHERE id=? OR source_id=?)) ORDER BY CASE WHEN chat_id=? THEN 0 ELSE 1 END LIMIT 1`, chatID, chatID, chatID, chatID, chatID, chatID).Scan(&payload); err != nil {
		if err == sql.ErrNoRows {
			return state, ErrConversationStateNotFound
		}
		return state, err
	}
	if err := json.Unmarshal([]byte(payload), &state); err != nil {
		return state, fmt.Errorf("decode conversation state: %w", err)
	}
	return state, nil
}

func (s *SQLite) ListConversationStates(ctx context.Context, limit int) ([]domain.ConversationState, error) {
	if limit <= 0 || limit > 5000 {
		limit = 2000
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT payload_json FROM conversation_states ORDER BY updated_at DESC,chat_id LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]domain.ConversationState, 0)
	for rows.Next() {
		var payload string
		if err = rows.Scan(&payload); err != nil {
			return nil, err
		}
		var state domain.ConversationState
		if err = json.Unmarshal([]byte(payload), &state); err != nil {
			return nil, fmt.Errorf("decode conversation state: %w", err)
		}
		out = append(out, state)
	}
	return out, rows.Err()
}
func (s *SQLite) PutMedia(ctx context.Context, v domain.MediaAsset) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO message_media(message_id,category,mime_type,file_name,size_bytes,width,height,status,data,thumbnail,download_info,updated_at)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
		ON CONFLICT(message_id) DO UPDATE SET
		category=excluded.category,mime_type=excluded.mime_type,file_name=excluded.file_name,size_bytes=excluded.size_bytes,
		width=excluded.width,height=excluded.height,
		status=CASE WHEN message_media.data IS NOT NULL AND length(message_media.data)>0 AND excluded.status<>'blocked_view_once' THEN 'ready' ELSE excluded.status END,
		data=CASE WHEN excluded.data IS NULL OR length(excluded.data)=0 THEN message_media.data ELSE excluded.data END,
		thumbnail=CASE WHEN excluded.thumbnail IS NULL OR length(excluded.thumbnail)=0 THEN message_media.thumbnail ELSE excluded.thumbnail END,
		download_info=CASE WHEN excluded.download_info IS NULL OR length(excluded.download_info)=0 THEN message_media.download_info ELSE excluded.download_info END,
		updated_at=excluded.updated_at`, v.MessageID, v.Metadata.Category, v.Metadata.MimeType, v.Metadata.FileName, v.Metadata.SizeBytes, v.Metadata.Width, v.Metadata.Height, v.Metadata.Status, v.Data, v.Thumbnail, v.DownloadInfo, ts(v.UpdatedAt))
	return err
}
func (s *SQLite) GetMedia(ctx context.Context, messageID string) (domain.MediaAsset, error) {
	var v domain.MediaAsset
	var updated string
	err := s.DB.QueryRowContext(ctx, `SELECT message_id,category,mime_type,file_name,size_bytes,width,height,status,data,thumbnail,download_info,updated_at FROM message_media WHERE message_id=? AND NOT EXISTS (SELECT 1 FROM messages WHERE id=message_media.message_id AND kind='deleted')`, messageID).Scan(
		&v.MessageID, &v.Metadata.Category, &v.Metadata.MimeType, &v.Metadata.FileName, &v.Metadata.SizeBytes, &v.Metadata.Width, &v.Metadata.Height, &v.Metadata.Status, &v.Data, &v.Thumbnail, &v.DownloadInfo, &updated)
	if err == nil {
		v.Metadata.FullAvailable = len(v.Data) > 0
		v.Metadata.PreviewAvailable = v.Metadata.FullAvailable || len(v.Thumbnail) > 0
		v.Metadata.FetchAvailable = len(v.DownloadInfo) > 0 && v.Metadata.Status != "blocked_view_once"
	}
	v.UpdatedAt = parseTS(updated)
	return v, err
}
func (s *SQLite) ListChats(ctx context.Context, archived bool, limit int, cursor string) ([]domain.Chat, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT id,source_id,identity_id,title,is_group,archived,last_message_at,updated_at FROM chats
		WHERE archived=? AND (
			?='' OR updated_at < (SELECT updated_at FROM chats WHERE archived=? AND id=?) OR
			(updated_at = (SELECT updated_at FROM chats WHERE archived=? AND id=?) AND id > ?)
		)
		ORDER BY updated_at DESC,id LIMIT ?`, b(archived), cursor, b(archived), cursor, b(archived), cursor, cursor, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Chat
	for rows.Next() {
		var v domain.Chat
		var ig, ar int
		var last sql.NullString
		var upd string
		if err = rows.Scan(&v.ID, &v.SourceID, &v.IdentityID, &v.Title, &ig, &ar, &last, &upd); err != nil {
			return nil, err
		}
		v.IsGroup = ig != 0
		v.Archived = ar != 0
		v.UpdatedAt = parseTS(upd)
		if last.Valid {
			t := parseTS(last.String)
			v.LastMessageAt = &t
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *SQLite) GetChat(ctx context.Context, id string) (domain.Chat, error) {
	var v domain.Chat
	var ig, ar int
	var last sql.NullString
	var updated string
	err := s.DB.QueryRowContext(ctx, `SELECT id,source_id,identity_id,title,is_group,archived,last_message_at,updated_at FROM chats WHERE id=? OR source_id=? ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1`, id, id, id).Scan(&v.ID, &v.SourceID, &v.IdentityID, &v.Title, &ig, &ar, &last, &updated)
	v.IsGroup = ig != 0
	v.Archived = ar != 0
	v.UpdatedAt = parseTS(updated)
	if last.Valid {
		t := parseTS(last.String)
		v.LastMessageAt = &t
	}
	return v, err
}
func (s *SQLite) SearchChats(ctx context.Context, archived bool, query string, limit int) ([]domain.Chat, error) {
	query = strings.TrimSpace(query)
	if query == "" {
		return nil, fmt.Errorf("search query is required")
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	escaped := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(strings.ToLower(query))
	pattern := "%" + escaped + "%"
	rows, err := s.DB.QueryContext(ctx, `SELECT DISTINCT c.id,c.source_id,c.identity_id,c.title,c.is_group,c.archived,c.last_message_at,c.updated_at
		FROM chats c LEFT JOIN messages m ON m.chat_id=c.id AND m.kind=?
		WHERE c.archived=? AND (LOWER(c.title) LIKE ? ESCAPE '\' OR LOWER(COALESCE(m.text,'')) LIKE ? ESCAPE '\')
		ORDER BY c.updated_at DESC,c.id LIMIT ?`, domain.MessageText, b(archived), pattern, pattern, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Chat
	for rows.Next() {
		var v domain.Chat
		var ig, ar int
		var last sql.NullString
		var upd string
		if err = rows.Scan(&v.ID, &v.SourceID, &v.IdentityID, &v.Title, &ig, &ar, &last, &upd); err != nil {
			return nil, err
		}
		v.IsGroup = ig != 0
		v.Archived = ar != 0
		v.UpdatedAt = parseTS(upd)
		if last.Valid {
			t := parseTS(last.String)
			v.LastMessageAt = &t
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *SQLite) ListOwnerTextMessages(ctx context.Context, chatID string, limit int) ([]domain.Message, error) {
	if limit <= 0 || limit > 500 {
		limit = 120
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT id,source_message_id,chat_id,sender_id,sender_name,from_me,kind,text,timestamp,timestamp_known,replyable,quoted_message_id,mentions_owner,raw_type
		FROM messages WHERE from_me=1 AND kind=? AND timestamp_known=1 AND TRIM(COALESCE(text,''))<>'' AND (?='' OR chat_id=?)
		ORDER BY timestamp DESC,rowid DESC LIMIT ?`, domain.MessageText, chatID, chatID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Message
	for rows.Next() {
		var v domain.Message
		var fm, tk, rp, mo int
		var stamp string
		if err = rows.Scan(&v.ID, &v.SourceMessageID, &v.ChatID, &v.SenderID, &v.SenderName, &fm, &v.Kind, &v.Text, &stamp, &tk, &rp, &v.QuotedMessageID, &mo, &v.RawType); err != nil {
			return nil, err
		}
		v.FromMe = fm != 0
		v.TimestampKnown = tk != 0
		v.Replyable = rp != 0
		v.MentionsOwner = mo != 0
		v.Timestamp = parseTS(stamp)
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *SQLite) ListResponseEpisodes(ctx context.Context, limit int) ([]domain.ResponseEpisode, error) {
	if limit <= 0 || limit > maximumResponseEpisodes {
		limit = maximumResponseEpisodes
	}
	// The active local corpus is roughly 87k records. Scan enough chronology to
	// preserve turn barriers throughout that corpus while retaining a hard
	// memory/query ceiling for future, much larger vaults.
	scanLimit := limit * 10
	if scanLimit < 20_000 {
		scanLimit = 20_000
	}
	if scanLimit > 120_000 {
		scanLimit = 120_000
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT
		m.id,m.source_message_id,m.chat_id,m.sender_id,m.sender_name,m.from_me,m.kind,m.text,m.timestamp,m.timestamp_known,m.replyable,m.quoted_message_id,m.mentions_owner,m.raw_type,m.rowid,
		c.id,c.source_id,c.identity_id,c.title,c.is_group,c.archived,c.last_message_at,c.updated_at
		FROM messages m JOIN chats c ON c.id=m.chat_id
		WHERE c.is_group=0 AND m.timestamp_known=1
		ORDER BY m.timestamp DESC,m.rowid DESC LIMIT ?`, scanLimit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	records := make([]episodeMessage, 0, scanLimit)
	for rows.Next() {
		var message domain.Message
		var chat domain.Chat
		var fromMe, timestampKnown, replyable, mentionsOwner, isGroup, archived int
		var messageStamp, chatUpdated string
		var lastMessageAt sql.NullString
		var rowOrder int64
		if err = rows.Scan(
			&message.ID, &message.SourceMessageID, &message.ChatID, &message.SenderID, &message.SenderName, &fromMe, &message.Kind, &message.Text, &messageStamp, &timestampKnown, &replyable, &message.QuotedMessageID, &mentionsOwner, &message.RawType, &rowOrder,
			&chat.ID, &chat.SourceID, &chat.IdentityID, &chat.Title, &isGroup, &archived, &lastMessageAt, &chatUpdated,
		); err != nil {
			return nil, err
		}
		message.FromMe = fromMe != 0
		message.TimestampKnown = timestampKnown != 0
		message.Replyable = replyable != 0
		message.MentionsOwner = mentionsOwner != 0
		message.Timestamp = parseTS(messageStamp)
		chat.IsGroup = isGroup != 0
		chat.Archived = archived != 0
		chat.UpdatedAt = parseTS(chatUpdated)
		if lastMessageAt.Valid {
			stamp := parseTS(lastMessageAt.String)
			chat.LastMessageAt = &stamp
		}
		records = append(records, episodeMessage{chat: chat, message: message, order: rowOrder})
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	return buildResponseEpisodes(records, limit), nil
}
func (s *SQLite) ListMessages(ctx context.Context, chatID string, limit int, before string) ([]domain.Message, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT id,source_message_id,chat_id,sender_id,sender_name,from_me,kind,text,timestamp,timestamp_known,replyable,quoted_message_id,mentions_owner,raw_type
		FROM messages
		WHERE (chat_id=? OR chat_id=(SELECT source_id FROM chats WHERE id=? OR source_id=?) OR chat_id=(SELECT id FROM chats WHERE id=? OR source_id=?)) AND (
			?='' OR timestamp < (SELECT timestamp FROM messages WHERE id=?) OR
			(timestamp = (SELECT timestamp FROM messages WHERE id=?) AND rowid < (SELECT rowid FROM messages WHERE id=?))
		)
		ORDER BY timestamp DESC,rowid DESC LIMIT ?`, chatID, chatID, chatID, chatID, chatID, before, before, before, before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []domain.Message
	for rows.Next() {
		var v domain.Message
		var fm, tk, rp, mo int
		var stamp string
		if err = rows.Scan(&v.ID, &v.SourceMessageID, &v.ChatID, &v.SenderID, &v.SenderName, &fm, &v.Kind, &v.Text, &stamp, &tk, &rp, &v.QuotedMessageID, &mo, &v.RawType); err != nil {
			return nil, err
		}
		v.FromMe = fm != 0
		v.TimestampKnown = tk != 0
		v.Replyable = rp != 0
		v.MentionsOwner = mo != 0
		v.Timestamp = parseTS(stamp)
		out = append(out, v)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	if err = rows.Close(); err != nil {
		return nil, err
	}
	for index := range out {
		if out[index].Kind == domain.MessageDeleted {
			continue
		}
		if media, mediaErr := s.GetMedia(ctx, out[index].ID); mediaErr == nil {
			metadata := media.Metadata
			out[index].Media = &metadata
		}
	}
	return out, nil
}
func (s *SQLite) LatestMessage(ctx context.Context, chatID string) (domain.Message, error) {
	var v domain.Message
	var fm, tk, rp, mo int
	var stamp string
	err := s.DB.QueryRowContext(ctx, `SELECT id,source_message_id,chat_id,sender_id,sender_name,from_me,kind,text,timestamp,timestamp_known,replyable,quoted_message_id,mentions_owner,raw_type
		FROM messages WHERE (chat_id=? OR chat_id=(SELECT source_id FROM chats WHERE id=? OR source_id=?) OR chat_id=(SELECT id FROM chats WHERE id=? OR source_id=?)) AND kind=? AND timestamp_known=1 AND TRIM(COALESCE(text,''))<>''
		ORDER BY timestamp DESC,rowid DESC LIMIT 1`, chatID, chatID, chatID, chatID, chatID, domain.MessageText).Scan(&v.ID, &v.SourceMessageID, &v.ChatID, &v.SenderID, &v.SenderName, &fm, &v.Kind, &v.Text, &stamp, &tk, &rp, &v.QuotedMessageID, &mo, &v.RawType)
	if err != nil {
		return v, err
	}
	v.FromMe = fm != 0
	v.TimestampKnown = tk != 0
	v.Replyable = rp != 0
	v.MentionsOwner = mo != 0
	v.Timestamp = parseTS(stamp)
	return v, nil
}
func (s *SQLite) LatestSourceMessage(ctx context.Context, chatID string) (domain.Message, error) {
	var v domain.Message
	var fm, tk, rp, mo int
	var stamp string
	err := s.DB.QueryRowContext(ctx, `SELECT id,source_message_id,chat_id,sender_id,sender_name,from_me,kind,text,timestamp,timestamp_known,replyable,quoted_message_id,mentions_owner,raw_type
		FROM messages WHERE (chat_id=? OR chat_id=(SELECT source_id FROM chats WHERE id=? OR source_id=?) OR chat_id=(SELECT id FROM chats WHERE id=? OR source_id=?)) AND timestamp_known=1 AND kind NOT IN (?,?)
		ORDER BY timestamp DESC,rowid DESC LIMIT 1`, chatID, chatID, chatID, chatID, chatID, domain.MessageSystem, domain.MessageReaction).Scan(&v.ID, &v.SourceMessageID, &v.ChatID, &v.SenderID, &v.SenderName, &fm, &v.Kind, &v.Text, &stamp, &tk, &rp, &v.QuotedMessageID, &mo, &v.RawType)
	if err != nil {
		return v, err
	}
	v.FromMe = fm != 0
	v.TimestampKnown = tk != 0
	v.Replyable = rp != 0
	v.MentionsOwner = mo != 0
	v.Timestamp = parseTS(stamp)
	if media, mediaErr := s.GetMedia(ctx, v.ID); mediaErr == nil && v.Kind != domain.MessageDeleted {
		metadata := media.Metadata
		v.Media = &metadata
	}
	return v, nil
}
func (s *SQLite) OldestMessage(ctx context.Context, chatID string) (domain.Message, error) {
	var v domain.Message
	var fm, tk, rp, mo int
	var stamp string
	err := s.DB.QueryRowContext(ctx, `SELECT id,source_message_id,chat_id,sender_id,sender_name,from_me,kind,text,timestamp,timestamp_known,replyable,quoted_message_id,mentions_owner,raw_type
		FROM messages WHERE (chat_id=? OR chat_id=(SELECT source_id FROM chats WHERE id=? OR source_id=?) OR chat_id=(SELECT id FROM chats WHERE id=? OR source_id=?)) AND timestamp_known=1
		ORDER BY timestamp ASC,rowid ASC LIMIT 1`, chatID, chatID, chatID, chatID, chatID).Scan(&v.ID, &v.SourceMessageID, &v.ChatID, &v.SenderID, &v.SenderName, &fm, &v.Kind, &v.Text, &stamp, &tk, &rp, &v.QuotedMessageID, &mo, &v.RawType)
	if err != nil {
		return v, err
	}
	v.FromMe = fm != 0
	v.TimestampKnown = tk != 0
	v.Replyable = rp != 0
	v.MentionsOwner = mo != 0
	v.Timestamp = parseTS(stamp)
	return v, nil
}
func (s *SQLite) PutHistory(ctx context.Context, v domain.HistorySync) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	count, err := unresolvedCountTx(ctx, tx, v.ChatID)
	if err != nil {
		return err
	}
	if count > 0 {
		v.Status = domain.HistoryFailed
		v.HistoryEndHit = false
		v.LastError = unresolvedHistoryReason
		var previousCount int64
		var oldest, newest string
		if readErr := tx.QueryRowContext(ctx, `SELECT messages_seen,COALESCE(oldest_cursor,''),COALESCE(newest_cursor,'') FROM history_sync WHERE chat_id=?`, v.ChatID).Scan(&previousCount, &oldest, &newest); readErr == nil {
			if v.MessagesSeen < previousCount {
				v.MessagesSeen = previousCount
			}
			if v.OldestCursor == "" {
				v.OldestCursor = oldest
			}
			if v.NewestCursor == "" {
				v.NewestCursor = newest
			}
		} else if !errors.Is(readErr, sql.ErrNoRows) {
			return readErr
		}
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO history_sync(chat_id,status,oldest_cursor,newest_cursor,messages_seen,history_end_hit,last_error,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET status=excluded.status,oldest_cursor=excluded.oldest_cursor,newest_cursor=excluded.newest_cursor,messages_seen=excluded.messages_seen,history_end_hit=excluded.history_end_hit,last_error=excluded.last_error,updated_at=excluded.updated_at`, v.ChatID, v.Status, v.OldestCursor, v.NewestCursor, v.MessagesSeen, b(v.HistoryEndHit), v.LastError, ts(v.UpdatedAt))
	if err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	if count > 0 {
		return ErrUnresolvedConversationEvidence
	}
	return nil
}
func (s *SQLite) GetHistory(ctx context.Context, id string) (domain.HistorySync, error) {
	var v domain.HistorySync
	var end int
	var stamp string
	err := s.DB.QueryRowContext(ctx, `SELECT chat_id,status,oldest_cursor,newest_cursor,messages_seen,history_end_hit,last_error,updated_at FROM history_sync WHERE chat_id=? OR chat_id=(SELECT source_id FROM chats WHERE id=? OR source_id=?) OR chat_id=(SELECT id FROM chats WHERE id=? OR source_id=?) ORDER BY CASE WHEN chat_id=? THEN 0 ELSE 1 END LIMIT 1`, id, id, id, id, id, id).Scan(&v.ChatID, &v.Status, &v.OldestCursor, &v.NewestCursor, &v.MessagesSeen, &end, &v.LastError, &stamp)
	v.HistoryEndHit = end != 0
	v.UpdatedAt = parseTS(stamp)
	return v, err
}

func (s *SQLite) GetHistoryCoverage(ctx context.Context, chatID string) (domain.HistoryCoverage, error) {
	var coverage domain.HistoryCoverage
	var oldest, newest sql.NullString
	err := s.DB.QueryRowContext(ctx, `SELECT c.id,COUNT(m.id),
		COALESCE(SUM(CASE WHEN m.timestamp_known=1 THEN 1 ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN m.from_me=1 THEN 1 ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN m.from_me=1 AND m.kind='text' AND TRIM(COALESCE(m.text,''))<>'' THEN 1 ELSE 0 END),0),
		COALESCE(SUM(CASE WHEN m.from_me=0 THEN 1 ELSE 0 END),0),
		MIN(CASE WHEN m.timestamp_known=1 THEN m.timestamp END),
		MAX(CASE WHEN m.timestamp_known=1 THEN m.timestamp END)
		FROM chats c LEFT JOIN messages m ON (m.chat_id=c.id OR (c.source_id<>'' AND m.chat_id=c.source_id)) WHERE (c.id=? OR c.source_id=?) GROUP BY c.id ORDER BY CASE WHEN c.id=? THEN 0 ELSE 1 END LIMIT 1`, chatID, chatID, chatID).
		Scan(&coverage.ChatID, &coverage.LocallyStoredMessages, &coverage.TimestampedMessages, &coverage.OwnerMessages, &coverage.OwnerTextMessages, &coverage.ContactMessages, &oldest, &newest)
	if err != nil {
		return coverage, err
	}
	coverage.State = "not_started"
	if oldest.Valid {
		stamp := parseTS(oldest.String)
		coverage.OldestMessageAt = &stamp
	}
	if newest.Valid {
		stamp := parseTS(newest.String)
		coverage.NewestMessageAt = &stamp
	}
	history, historyErr := s.GetHistory(ctx, chatID)
	if historyErr == nil {
		coverage.ProviderStatus = history.Status
		coverage.ProviderReportedMessagesSeen = history.MessagesSeen
		coverage.ProviderBeginningReached = history.HistoryEndHit
		coverage.OldestCursor = history.OldestCursor
		coverage.NewestCursor = history.NewestCursor
		coverage.LastError = history.LastError
		stamp := history.UpdatedAt.UTC()
		coverage.LastAttemptAt = &stamp
		switch {
		case history.Status == domain.HistoryComplete && history.HistoryEndHit:
			coverage.State = "complete"
		case history.Status == domain.HistoryFailed:
			coverage.State = "failed"
		default:
			coverage.State = "partial"
		}
	} else if !errors.Is(historyErr, sql.ErrNoRows) {
		return coverage, historyErr
	} else if coverage.LocallyStoredMessages > 0 {
		coverage.State = "local_only"
	}
	return coverage, nil
}
func (s *SQLite) AppendOutboundAudit(ctx context.Context, v domain.OutboundAudit) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO outbound_audit(id,idempotency_key,recipient_id,target_message_id,body_hash,message_id,status,error,created_at) VALUES(?,?,?,?,?,?,?,?,?)`, v.ID, v.IdempotencyKey, v.RecipientID, v.TargetMessageID, v.BodyHash, v.MessageID, v.Status, v.Error, ts(v.CreatedAt))
	return err
}
func (s *SQLite) LatestOutboundAudit(ctx context.Context, key string) (domain.OutboundAudit, error) {
	var v domain.OutboundAudit
	var created string
	err := s.DB.QueryRowContext(ctx, `SELECT id,idempotency_key,recipient_id,target_message_id,body_hash,message_id,status,error,created_at FROM outbound_audit WHERE idempotency_key=? ORDER BY created_at DESC,rowid DESC LIMIT 1`, key).Scan(&v.ID, &v.IdempotencyKey, &v.RecipientID, &v.TargetMessageID, &v.BodyHash, &v.MessageID, &v.Status, &v.Error, &created)
	v.CreatedAt = parseTS(created)
	return v, err
}
func (s *SQLite) SaveImportConsent(ctx context.Context, v domain.ImportConsent) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO import_consents(id,connector,import_all_chats,include_archived_chats,unofficial_risk_accepted,policy_version,created_at) VALUES(?,?,?,?,?,?,?)`, v.ID, v.Connector, b(v.ImportAllChats), b(v.IncludeArchivedChats), b(v.UnofficialRiskAccepted), v.PolicyVersion, ts(v.CreatedAt))
	return err
}
func (s *SQLite) LatestImportConsent(ctx context.Context) (domain.ImportConsent, error) {
	var v domain.ImportConsent
	var all, archived, risk int
	var created string
	err := s.DB.QueryRowContext(ctx, `SELECT id,connector,import_all_chats,include_archived_chats,unofficial_risk_accepted,policy_version,created_at FROM import_consents ORDER BY created_at DESC,id DESC LIMIT 1`).Scan(&v.ID, &v.Connector, &all, &archived, &risk, &v.PolicyVersion, &created)
	v.ImportAllChats = all != 0
	v.IncludeArchivedChats = archived != 0
	v.UnofficialRiskAccepted = risk != 0
	v.CreatedAt = parseTS(created)
	return v, err
}
