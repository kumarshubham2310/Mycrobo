package store_test

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"mycrobo/whatsapp-bridge/internal/bridge"
	"mycrobo/whatsapp-bridge/internal/domain"
	"mycrobo/whatsapp-bridge/internal/store"
)

func protocolIssueCount(t *testing.T, repo store.Repository, chatID string, want int64) {
	t.Helper()
	snapshot, err := repo.ConversationRevision(t.Context(), chatID)
	if err != nil || snapshot.UnresolvedCount != want {
		t.Fatalf("unresolved count=%+v wanted=%d err=%v", snapshot, want, err)
	}
}

func ingestMissingRevisionOriginal(t *testing.T, repo store.Repository, id, phone string, stamp time.Time) {
	t.Helper()
	service := bridge.New(repo, nil, nil, false)
	_, err := service.Ingest(t.Context(), domain.IncomingEvent{ChatIdentity: domain.Identity{PhoneJID: phone}, SenderIdentity: domain.Identity{PhoneJID: phone}, Chat: domain.Chat{ID: phone, Title: "Synthetic contact"}, Message: domain.Message{ID: id, SourceMessageID: id, Kind: domain.MessageText, Text: "Synthetic original", Timestamp: stamp, TimestampKnown: true, Replyable: true}})
	if err != nil {
		t.Fatal(err)
	}
}

func TestProtocolRevisionIssuesBlockOnlyAffectedChatAndResolveWithExactProof(t *testing.T) {
	for _, kind := range []string{"memory", "sqlite"} {
		t.Run(kind, func(t *testing.T) {
			repo := protocolRepo(t, kind)
			original, stamp := seedRevisionOriginal(t, repo, true)
			service := bridge.New(repo, nil, nil, false)
			issues := repo.(store.ProtocolRevisionIssueRepository)
			ingestMissingRevisionOriginal(t, repo, "other", "5678@s.whatsapp.net", stamp)
			input := syntheticRevision(stamp)
			input.TargetSourceMessageID = "not-yet-imported"
			for i := 0; i < 2; i++ {
				if applied, err := service.ApplyProtocolRevision(t.Context(), input); err == nil || applied {
					t.Fatal("unimported edit accepted")
				}
			}
			protocolIssueCount(t, repo, original.ChatID, 1)
			protocolIssueCount(t, repo, "jid:5678@s.whatsapp.net", 0)
			if err := issues.ResolveProtocolRevisionIssue(t.Context(), input); err == nil {
				t.Fatal("marker cleared without journal proof")
			}
			ingestMissingRevisionOriginal(t, repo, input.TargetSourceMessageID, "1234@s.whatsapp.net", stamp)
			protocolIssueCount(t, repo, original.ChatID, 1)
			if applied, err := service.ApplyProtocolRevision(t.Context(), input); err != nil || !applied {
				t.Fatalf("exact replay failed=%v %v", applied, err)
			}
			protocolIssueCount(t, repo, original.ChatID, 0)
			conflict := input
			conflict.Text = "Different same-clock evidence"
			if _, err := service.ApplyProtocolRevision(t.Context(), conflict); err == nil {
				t.Fatal("equal-clock conflict accepted")
			}
			protocolIssueCount(t, repo, original.ChatID, 1)
			if _, err := service.ApplyProtocolRevision(t.Context(), input); err != nil {
				t.Fatal(err)
			}
			protocolIssueCount(t, repo, original.ChatID, 1)
			if err := issues.ResolveProtocolRevisionIssue(t.Context(), conflict); err == nil {
				t.Fatal("conflict cleared using another event's proof")
			}
			protocolIssueCount(t, repo, "jid:5678@s.whatsapp.net", 0)
		})
	}
}

func TestProtocolRevisionIssuesSurviveRestartAndContainNoMessageText(t *testing.T) {
	path := filepath.Join(t.TempDir(), "restart.db")
	repo, err := store.OpenSQLite(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	original, stamp := seedRevisionOriginal(t, repo, true)
	input := syntheticRevision(stamp)
	input.TargetSourceMessageID = "missing"
	if _, err = bridge.New(repo, nil, nil, false).ApplyProtocolRevision(t.Context(), input); err == nil {
		t.Fatal("missing edit accepted")
	}
	before, err := repo.ConversationRevision(t.Context(), original.ChatID)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := repo.DB.QueryContext(t.Context(), `SELECT id,target_id,mutation_type,reason,created_at FROM protocol_revision_issues`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id, target, kind, reason, created string
		if err = rows.Scan(&id, &target, &kind, &reason, &created); err != nil {
			t.Fatal(err)
		}
		if len(id) != 64 || strings.Contains(strings.Join([]string{id, target, kind, reason, created}, " "), input.Text) || reason != "original-not-imported" {
			t.Fatal("issue stores unsafe text or wrong reason")
		}
	}
	rows.Close()
	repo.Close()
	reopened, err := store.OpenSQLite(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	after, err := reopened.ConversationRevision(t.Context(), original.ChatID)
	if err != nil || before != after || after.UnresolvedCount != 1 {
		t.Fatalf("restart cleared safety marker: %+v -> %+v %v", before, after, err)
	}
}

func TestProtocolRevisionIssueBeforeChatImportRemainsBoundToExactProviderAlias(t *testing.T) {
	for _, kind := range []string{"memory", "sqlite"} {
		t.Run(kind, func(t *testing.T) {
			repo := protocolRepo(t, kind)
			stamp := time.Date(2026, 8, 1, 9, 0, 0, 0, time.UTC)
			input := syntheticRevision(stamp)
			issues := repo.(store.ProtocolRevisionIssueRepository)
			if err := issues.RecordProtocolRevisionIssue(t.Context(), input, "original-not-imported", stamp); err != nil {
				t.Fatal(err)
			}
			ingestMissingRevisionOriginal(t, repo, "other", "5678@s.whatsapp.net", stamp)
			protocolIssueCount(t, repo, "jid:5678@s.whatsapp.net", 0)
			ingestMissingRevisionOriginal(t, repo, "original", "1234@s.whatsapp.net", stamp)
			protocolIssueCount(t, repo, "jid:1234@s.whatsapp.net", 1)
			if applied, err := bridge.New(repo, nil, nil, false).ApplyProtocolRevision(t.Context(), input); err != nil || !applied {
				t.Fatalf("reprocess=%v %v", applied, err)
			}
			protocolIssueCount(t, repo, "jid:1234@s.whatsapp.net", 0)
		})
	}
}

func TestProtocolRevisionIssueCapacityIsBoundedAndCannotSilentlyClear(t *testing.T) {
	for _, kind := range []string{"memory", "sqlite"} {
		t.Run(kind, func(t *testing.T) {
			repo := protocolRepo(t, kind)
			original, stamp := seedRevisionOriginal(t, repo, true)
			issues := repo.(store.ProtocolRevisionIssueRepository)
			input := syntheticRevision(stamp)
			for i := 0; i < 300; i++ {
				input.TargetSourceMessageID = fmt.Sprintf("missing-%d", i)
				if err := issues.RecordProtocolRevisionIssue(t.Context(), input, "unsafe arbitrary reason", stamp); err != nil {
					t.Fatal(err)
				}
			}
			protocolIssueCount(t, repo, original.ChatID, 257)
			input.TargetSourceMessageID = "missing-0"
			if err := issues.RecordProtocolRevisionIssue(t.Context(), input, "original-not-imported", stamp); err != nil {
				t.Fatal(err)
			}
			protocolIssueCount(t, repo, original.ChatID, 257)
		})
	}
}

func TestProtocolRevisionDeletionHidesCachedMediaWithoutDeletingStoredAsset(t *testing.T) {
	for _, kind := range []string{"memory", "sqlite"} {
		t.Run(kind, func(t *testing.T) {
			repo := protocolRepo(t, kind)
			original, stamp := seedRevisionOriginal(t, repo, true)
			asset := domain.MediaAsset{MessageID: original.ID, Metadata: domain.MediaMetadata{Category: "image", MimeType: "image/png", Status: "ready"}, Data: []byte("synthetic-media"), UpdatedAt: stamp}
			if err := repo.PutMedia(t.Context(), asset); err != nil {
				t.Fatal(err)
			}
			input := syntheticRevision(stamp)
			input.Type = domain.MessageRemoved
			input.Kind = domain.MessageDeleted
			input.Text = ""
			if _, err := repo.(store.ProtocolRevisionRepository).ApplyProtocolRevision(t.Context(), input, stamp.Add(time.Hour)); err != nil {
				t.Fatal(err)
			}
			if _, err := repo.GetMedia(t.Context(), original.ID); err == nil {
				t.Fatal("deleted source exposes media")
			}
			items, err := repo.ListMessages(t.Context(), original.ChatID, 10, "")
			if err != nil || len(items) != 1 || items[0].Media != nil {
				t.Fatal("deleted source exposes preview")
			}
			if sqlite, ok := repo.(*store.SQLite); ok {
				var count int
				if err := sqlite.DB.QueryRowContext(t.Context(), `SELECT COUNT(*) FROM message_media WHERE message_id=?`, original.ID).Scan(&count); err != nil || count != 1 {
					t.Fatal("stored original asset was deleted")
				}
			}
		})
	}
}

func TestProtocolRevisionPendingLookupUsesIndexesAndSurvivesAliasMerge(t *testing.T) {
	repo := protocolRepo(t, "sqlite").(*store.SQLite)
	original, stamp := seedRevisionOriginal(t, repo, true)
	input := syntheticRevision(stamp)
	input.TargetSourceMessageID = "not-imported"
	if err := repo.RecordProtocolRevisionIssue(t.Context(), input, "original-not-imported", stamp); err != nil {
		t.Fatal(err)
	}
	ingestMissingRevisionOriginal(t, repo, "winner", "5678@s.whatsapp.net", stamp)
	// Mirror canonical alias reassignment: the safety marker must follow its
	// verified provider alias, even if its old chat key becomes obsolete.
	if _, err := repo.DB.ExecContext(t.Context(), `UPDATE identity_aliases SET identity_id=(SELECT identity_id FROM chats WHERE id='jid:5678@s.whatsapp.net') WHERE alias='1234@s.whatsapp.net'`); err != nil {
		t.Fatal(err)
	}
	protocolIssueCount(t, repo, "jid:5678@s.whatsapp.net", 1)
	protocolIssueCount(t, repo, original.ChatID, 1)
	rows, err := repo.DB.QueryContext(t.Context(), `EXPLAIN QUERY PLAN SELECT c.id,COALESCE(r.revision,0),COALESCE((SELECT sequence FROM message_events WHERE chat_id=c.id ORDER BY sequence DESC LIMIT 1),0),(SELECT COUNT(*) FROM (SELECT id FROM protocol_revision_issues WHERE chat_id=c.id UNION SELECT p.id FROM protocol_revision_issues p JOIN identity_aliases a ON a.alias=p.scope_alias WHERE a.identity_id=c.identity_id)) FROM chats c LEFT JOIN conversation_revisions r ON r.chat_id=c.id WHERE c.id=?`, original.ChatID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var plan []string
	for rows.Next() {
		var id, parent, unused int
		var detail string
		if err = rows.Scan(&id, &parent, &unused, &detail); err != nil {
			t.Fatal(err)
		}
		plan = append(plan, detail)
	}
	joined := strings.Join(plan, "\n")
	for _, required := range []string{"identity_aliases_identity_id", "protocol_revision_issues_alias", "message_events_chat_sequence"} {
		if !strings.Contains(joined, required) {
			t.Fatalf("missing bounded index %s:\n%s", required, joined)
		}
	}
	for _, forbidden := range []string{"SCAN a", "SCAN p", "SCAN messages", "SCAN message_events"} {
		if strings.Contains(joined, forbidden) {
			t.Fatalf("unbounded revision poll:\n%s", joined)
		}
	}
}
