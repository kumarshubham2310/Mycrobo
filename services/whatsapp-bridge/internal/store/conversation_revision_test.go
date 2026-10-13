package store_test

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"mycrobo/whatsapp-bridge/internal/domain"
	"mycrobo/whatsapp-bridge/internal/store"
)

func revision(t *testing.T, repo store.Repository, chat string) store.ConversationRevision {
	t.Helper()
	v, err := repo.ConversationRevision(t.Context(), chat)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func TestConversationRevisionCatchesHistoryEditsDeletesWithoutChangingLatest(t *testing.T) {
	for _, kind := range []string{"memory", "sqlite"} {
		t.Run(kind, func(t *testing.T) {
			var repo store.Repository = store.NewMemory()
			if kind == "sqlite" {
				sqlite, err := store.OpenSQLite(t.Context(), filepath.Join(t.TempDir(), "revision.db"))
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { sqlite.Close() })
				repo = sqlite
			}
			stamp := time.Date(2026, 9, 5, 10, 0, 0, 0, time.UTC)
			chat := domain.Chat{ID: "a", IdentityID: "a", Title: "Synthetic contact", UpdatedAt: stamp}
			if err := repo.UpsertChat(t.Context(), chat); err != nil {
				t.Fatal(err)
			}
			newest := domain.Message{ID: "latest", SourceMessageID: "latest", ChatID: "a", Kind: domain.MessageText, Text: "A synthetic current question?", Timestamp: stamp, TimestampKnown: true, Replyable: true}
			if _, err := repo.InsertMessage(t.Context(), newest); err != nil {
				t.Fatal(err)
			}
			before := revision(t, repo, "a")
			if _, err := repo.InsertMessage(t.Context(), newest); err != nil {
				t.Fatal(err)
			}
			if got := revision(t, repo, "a"); got != before {
				t.Fatalf("duplicate changed revision: %+v -> %+v", before, got)
			}
			older := newest
			older.ID, older.SourceMessageID, older.Timestamp = "old", "old", stamp.Add(-24*time.Hour)
			if _, err := repo.InsertMessage(t.Context(), older); err != nil {
				t.Fatal(err)
			}
			afterHistory := revision(t, repo, "a")
			if afterHistory.Revision <= before.Revision || afterHistory.EventSequence <= before.EventSequence {
				t.Fatalf("history did not advance: %+v -> %+v", before, afterHistory)
			}
			latest, err := repo.LatestMessage(t.Context(), "a")
			if err != nil || latest.ID != "latest" {
				t.Fatalf("latest regressed: %+v %v", latest, err)
			}
			edit := domain.NewObservedMessageEvent(older, stamp)
			edit.ID, edit.Type, edit.SupersedesEventID, edit.OriginalText = "edit:old", domain.MessageEdited, domain.ObservedEventID(older), "Corrected synthetic fact"
			if _, err := repo.AppendMessageEvent(t.Context(), edit); err != nil {
				t.Fatal(err)
			}
			afterEdit := revision(t, repo, "a")
			if afterEdit.Revision <= afterHistory.Revision || afterEdit.EventSequence <= afterHistory.EventSequence {
				t.Fatal("journal edit was invisible")
			}
			edit.ID, edit.Type, edit.SupersedesEventID, edit.OriginalText = "delete:old", domain.MessageRemoved, "edit:old", ""
			if _, err := repo.AppendMessageEvent(t.Context(), edit); err != nil {
				t.Fatal(err)
			}
			if got := revision(t, repo, "a"); got.Revision <= afterEdit.Revision || got.EventSequence <= afterEdit.EventSequence {
				t.Fatal("journal deletion was invisible")
			}
			stable := revision(t, repo, "a")
			chat.UpdatedAt = stamp.Add(time.Hour)
			if err := repo.UpsertChat(t.Context(), chat); err != nil {
				t.Fatal(err)
			}
			if got := revision(t, repo, "a"); got != stable {
				t.Fatal("timestamp-only poll invalidates drafts")
			}
			chat.Title = "Renamed synthetic contact"
			if err := repo.UpsertChat(t.Context(), chat); err != nil {
				t.Fatal(err)
			}
			if got := revision(t, repo, "a"); got.Revision <= stable.Revision {
				t.Fatal("recipient metadata change invisible")
			}
			if _, err := repo.ConversationRevision(t.Context(), "missing"); err == nil {
				t.Fatal("missing chat reported valid revision")
			}
		})
	}
}

func TestConversationRevisionCoverageAndOtherChatIsolation(t *testing.T) {
	for _, kind := range []string{"memory", "sqlite"} {
		t.Run(kind, func(t *testing.T) {
			var repo store.Repository = store.NewMemory()
			if kind == "sqlite" {
				sqlite, err := store.OpenSQLite(t.Context(), filepath.Join(t.TempDir(), "coverage.db"))
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { sqlite.Close() })
				repo = sqlite
			}
			stamp := time.Date(2026, 9, 5, 10, 0, 0, 0, time.UTC)
			for _, id := range []string{"a", "b"} {
				if err := repo.UpsertChat(t.Context(), domain.Chat{ID: id, IdentityID: domain.CanonicalID(id), Title: id, UpdatedAt: stamp}); err != nil {
					t.Fatal(err)
				}
			}
			other := revision(t, repo, "b")
			history := domain.HistorySync{ChatID: "a", Status: domain.HistoryRunning, MessagesSeen: 2, UpdatedAt: stamp}
			if err := repo.PutHistory(t.Context(), history); err != nil {
				t.Fatal(err)
			}
			before := revision(t, repo, "a")
			history.UpdatedAt = stamp.Add(time.Minute)
			if err := repo.PutHistory(t.Context(), history); err != nil {
				t.Fatal(err)
			}
			if got := revision(t, repo, "a"); got != before {
				t.Fatal("unchanged coverage polling changed revision")
			}
			history.HistoryEndHit, history.Status = true, domain.HistoryComplete
			if err := repo.PutHistory(t.Context(), history); err != nil {
				t.Fatal(err)
			}
			if got := revision(t, repo, "a"); got.Revision <= before.Revision {
				t.Fatal("coverage terminal change invisible")
			}
			if got := revision(t, repo, "b"); got != other {
				t.Fatal("unrelated conversation was invalidated")
			}
		})
	}
}

func TestSQLiteRevisionTracksEarlierProjectionRepairAndCanonicalMerge(t *testing.T) {
	repo, err := store.OpenSQLite(t.Context(), filepath.Join(t.TempDir(), "merge.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	stamp := time.Date(2026, 9, 5, 10, 0, 0, 0, time.UTC)
	for _, id := range []string{"loser", "winner"} {
		if err = repo.UpsertChat(t.Context(), domain.Chat{ID: id, IdentityID: domain.CanonicalID(id), Title: id, UpdatedAt: stamp}); err != nil {
			t.Fatal(err)
		}
		if _, err = repo.InsertMessage(t.Context(), domain.Message{ID: id, SourceMessageID: id, ChatID: id, Kind: domain.MessageText, Text: "synthetic", Timestamp: stamp, TimestampKnown: true}); err != nil {
			t.Fatal(err)
		}
	}
	beforeWinner, beforeLoser := revision(t, repo, "winner"), revision(t, repo, "loser")
	// This mirrors the journal move in mergeCanonicalTx. The moved sequence is
	// older than the winner's current maximum, so MAX(sequence) alone fails.
	if _, err = repo.DB.ExecContext(t.Context(), `UPDATE message_events SET chat_id='winner' WHERE chat_id='loser'`); err != nil {
		t.Fatal(err)
	}
	after := revision(t, repo, "winner")
	if after.EventSequence != beforeWinner.EventSequence || after.Revision <= beforeWinner.Revision {
		t.Fatalf("older merge missed: %+v -> %+v", beforeWinner, after)
	}
	if got := revision(t, repo, "loser"); got.Revision <= beforeLoser.Revision {
		t.Fatal("losing conversation was not invalidated")
	}
	before := after
	if _, err = repo.DB.ExecContext(t.Context(), `UPDATE messages SET text='synthetic correction' WHERE chat_id='winner'`); err != nil {
		t.Fatal(err)
	}
	if got := revision(t, repo, "winner"); got.Revision <= before.Revision || got.EventSequence != before.EventSequence {
		t.Fatal("projection repair was invisible")
	}
	before = revision(t, repo, "winner")
	if _, err = repo.DB.ExecContext(t.Context(), `DELETE FROM messages WHERE chat_id='winner'`); err != nil {
		t.Fatal(err)
	}
	if got := revision(t, repo, "winner"); got.Revision <= before.Revision {
		t.Fatal("projection deletion was invisible")
	}
}

func TestSQLiteRevisionMigrationReopenPreservesStamp(t *testing.T) {
	path := filepath.Join(t.TempDir(), "persist.db")
	repo, err := store.OpenSQLite(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	stamp := time.Date(2026, 9, 5, 10, 0, 0, 0, time.UTC)
	if err = repo.UpsertChat(t.Context(), domain.Chat{ID: "a", SourceID: "a", IdentityID: "a", Title: "A", UpdatedAt: stamp}); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.InsertMessage(t.Context(), domain.Message{ID: "a1", SourceMessageID: "a1", ChatID: "a", Kind: domain.MessageText, Text: "synthetic", Timestamp: stamp, TimestampKnown: true}); err != nil {
		t.Fatal(err)
	}
	before := revision(t, repo, "a")
	if err = repo.Close(); err != nil {
		t.Fatal(err)
	}
	repo, err = store.OpenSQLite(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	if got := revision(t, repo, "a"); got != before {
		t.Fatalf("reopen changed revision: %+v -> %+v", before, got)
	}
	latest, err := repo.LatestMessage(t.Context(), "a")
	if err != nil || latest.Text != "synthetic" {
		t.Fatal("migration changed source data")
	}
}

func TestSQLiteRevisionUsesIndexedJournalSeek(t *testing.T) {
	repo, err := store.OpenSQLite(t.Context(), filepath.Join(t.TempDir(), "plan.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	rows, err := repo.DB.QueryContext(t.Context(), `EXPLAIN QUERY PLAN SELECT c.id,COALESCE(r.revision,0),COALESCE((SELECT sequence FROM message_events WHERE chat_id=c.id ORDER BY sequence DESC LIMIT 1),0) FROM chats c LEFT JOIN conversation_revisions r ON r.chat_id=c.id WHERE c.id=?`, "a")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var plans []string
	for rows.Next() {
		var id, parent, unused int
		var detail string
		if err = rows.Scan(&id, &parent, &unused, &detail); err != nil {
			t.Fatal(err)
		}
		plans = append(plans, detail)
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
	plan := strings.Join(plans, "\n")
	if !strings.Contains(plan, "message_events_chat_sequence") || strings.Contains(plan, "SCAN messages") || strings.Contains(plan, "SCAN message_events") {
		t.Fatalf("unbounded revision query:\n%s", plan)
	}
}

func BenchmarkSQLiteConversationRevision10000Events(b *testing.B) {
	ctx := context.Background()
	repo, err := store.OpenSQLite(ctx, filepath.Join(b.TempDir(), "bench.db"))
	if err != nil {
		b.Fatal(err)
	}
	defer repo.Close()
	stamp := time.Date(2026, 9, 5, 10, 0, 0, 0, time.UTC)
	if err = repo.UpsertChat(ctx, domain.Chat{ID: "a", IdentityID: "a", Title: "Synthetic", UpdatedAt: stamp}); err != nil {
		b.Fatal(err)
	}
	// One synthetic transaction avoids measuring fixture construction.
	tx, err := repo.DB.BeginTx(ctx, nil)
	if err != nil {
		b.Fatal(err)
	}
	stmt, err := tx.PrepareContext(ctx, `INSERT INTO message_events(event_id,event_type,chat_id,message_id,from_me,kind,occurred_at,timestamp_known,observed_at) VALUES(?,'observed','a',?,0,'text',?,1,?)`)
	if err != nil {
		b.Fatal(err)
	}
	for i := 0; i < 10000; i++ {
		id := fmt.Sprintf("synthetic-%d", i)
		if _, err = stmt.ExecContext(ctx, id, id, stamp.Format(time.RFC3339Nano), stamp.Format(time.RFC3339Nano)); err != nil {
			b.Fatal(err)
		}
	}
	stmt.Close()
	if err = tx.Commit(); err != nil {
		b.Fatal(err)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if _, err = repo.ConversationRevision(ctx, "a"); err != nil {
			b.Fatal(err)
		}
	}
}
