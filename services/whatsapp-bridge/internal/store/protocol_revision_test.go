package store_test

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"mycrobo/whatsapp-bridge/internal/bridge"
	"mycrobo/whatsapp-bridge/internal/domain"
	"mycrobo/whatsapp-bridge/internal/store"
)

func protocolRepo(t *testing.T, kind string) store.Repository {
	t.Helper()
	if kind == "memory" {
		return store.NewMemory()
	}
	repo, err := store.OpenSQLite(t.Context(), filepath.Join(t.TempDir(), "protocol.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { repo.Close() })
	return repo
}

func seedRevisionOriginal(t *testing.T, repo store.Repository, known bool) (domain.Message, time.Time) {
	t.Helper()
	stamp := time.Date(2026, 8, 1, 9, 0, 0, 0, time.UTC)
	event := domain.IncomingEvent{ChatIdentity: domain.Identity{PhoneJID: "1234@s.whatsapp.net"}, SenderIdentity: domain.Identity{PhoneJID: "1234@s.whatsapp.net"}, Chat: domain.Chat{ID: "1234@s.whatsapp.net", Title: "Synthetic contact"}, Message: domain.Message{ID: "original", SourceMessageID: "original", Kind: domain.MessageText, Text: "Could you review the first document?", Timestamp: stamp, TimestampKnown: known, Replyable: true, QuotedMessageID: "document-source"}}
	service := bridge.New(repo, nil, nil, false)
	if _, err := service.Ingest(t.Context(), event); err != nil {
		t.Fatal(err)
	}
	items, err := repo.ListMessages(t.Context(), "jid:1234@s.whatsapp.net", 10, "")
	if err != nil || len(items) != 1 {
		t.Fatalf("seed failed: %v %v", items, err)
	}
	return items[0], stamp
}

func syntheticRevision(stamp time.Time) domain.ProtocolRevision {
	return domain.ProtocolRevision{TargetSourceMessageID: "original", ChatAliases: []string{"1234@s.whatsapp.net"}, SenderAliases: []string{"1234@s.whatsapp.net"}, Type: domain.MessageEdited, Kind: domain.MessageText, Text: "Could you review the corrected document?", SourceTimestamp: stamp.Add(time.Hour), TimestampKnown: true}
}

func TestProtocolRevisionReplayEditDeleteDuplicateAndOutOfOrder(t *testing.T) {
	for _, kind := range []string{"memory", "sqlite"} {
		t.Run(kind, func(t *testing.T) {
			repo := protocolRepo(t, kind)
			original, stamp := seedRevisionOriginal(t, repo, true)
			writer := repo.(store.ProtocolRevisionRepository)
			before, _ := repo.ConversationRevision(t.Context(), original.ChatID)
			input := syntheticRevision(stamp)
			result, err := writer.ApplyProtocolRevision(t.Context(), input, stamp.Add(2*time.Hour))
			if err != nil || !result.Applied {
				t.Fatalf("edit failed: %+v %v", result, err)
			}
			if result.Message.ID != original.ID || result.Message.SourceMessageID != original.SourceMessageID || result.Message.SenderID != original.SenderID || result.Message.FromMe != original.FromMe || !result.Message.Timestamp.Equal(original.Timestamp) || result.Message.QuotedMessageID != "document-source" {
				t.Fatal("edit changed source identity, sender, occurrence or quote")
			}
			after, _ := repo.ConversationRevision(t.Context(), original.ChatID)
			if after.Revision <= before.Revision {
				t.Fatal("edit did not invalidate context")
			}
			duplicate, err := writer.ApplyProtocolRevision(t.Context(), input, stamp.Add(3*time.Hour))
			if err != nil || duplicate.Applied {
				t.Fatalf("duplicate applied: %+v %v", duplicate, err)
			}
			stable, _ := repo.ConversationRevision(t.Context(), original.ChatID)
			if stable != after {
				t.Fatal("duplicate changed revision")
			}
			older := input
			older.SourceTimestamp = stamp.Add(30 * time.Minute)
			older.Text = "Stale synthetic edit"
			if got, err := writer.ApplyProtocolRevision(t.Context(), older, stamp.Add(4*time.Hour)); err != nil || got.Applied {
				t.Fatalf("out of order edit applied: %+v %v", got, err)
			}
			conflict := input
			conflict.Text = "Conflicting simultaneous synthetic edit"
			if _, err = writer.ApplyProtocolRevision(t.Context(), conflict, stamp.Add(4*time.Hour)); !errors.Is(err, store.ErrRevisionClockUncertain) {
				t.Fatalf("equal-clock conflict not rejected: %v", err)
			}
			deleted := input
			deleted.Type = domain.MessageRemoved
			deleted.Kind = domain.MessageDeleted
			deleted.Text = ""
			deleted.TimestampKnown = false
			deleted.SourceTimestamp = time.Time{}
			got, err := writer.ApplyProtocolRevision(t.Context(), deleted, stamp.Add(5*time.Hour))
			if err != nil || !got.Applied || got.Message.Kind != domain.MessageDeleted || got.Message.Text != "" || got.Message.Replyable || !got.Message.Timestamp.Equal(original.Timestamp) {
				t.Fatalf("delete failed: %+v %v", got, err)
			}
			input.SourceTimestamp = stamp.Add(8 * time.Hour)
			if got, err = writer.ApplyProtocolRevision(t.Context(), input, stamp.Add(9*time.Hour)); err != nil || got.Applied {
				t.Fatal("late edit resurrected deletion")
			}
			if _, err = repo.InsertMessage(t.Context(), original); err != nil {
				t.Fatal(err)
			}
			latest, err := repo.LatestSourceMessage(t.Context(), original.ChatID)
			if err != nil || latest.Kind != domain.MessageDeleted || latest.Text != "" {
				t.Fatalf("original replay resurrected text: %+v %v", latest, err)
			}
			if _, err = repo.LatestMessage(t.Context(), original.ChatID); err == nil {
				t.Fatal("deleted message remained a human reply target")
			}
			journal, err := repo.ListMessageEvents(t.Context(), original.ChatID, 0, 20)
			if err != nil || len(journal) != 3 {
				t.Fatalf("wrong journal cardinality: %d %v", len(journal), err)
			}
			if journal[0].OriginalText != original.Text || journal[1].OriginalText != input.Text || journal[2].Type != domain.MessageRemoved || journal[1].SupersedesEventID != journal[0].ID || journal[2].SupersedesEventID != journal[1].ID {
				t.Fatal("immutable edit/delete provenance lost")
			}
			for _, event := range journal {
				if !event.OccurredAt.Equal(original.Timestamp) {
					t.Fatal("revision moved original conversation date")
				}
			}
		})
	}
}

func TestProtocolRevisionRejectsUnknownTargetWrongScopeAndUnorderedEdit(t *testing.T) {
	for _, kind := range []string{"memory", "sqlite"} {
		t.Run(kind, func(t *testing.T) {
			repo := protocolRepo(t, kind)
			original, stamp := seedRevisionOriginal(t, repo, true)
			writer := repo.(store.ProtocolRevisionRepository)
			before, _ := repo.ConversationRevision(t.Context(), original.ChatID)
			for _, fault := range []string{"missing", "chat", "sender", "direction", "unknown-clock"} {
				input := syntheticRevision(stamp)
				switch fault {
				case "missing":
					input.TargetSourceMessageID = "not-imported"
				case "chat":
					input.ChatAliases = []string{"9999@s.whatsapp.net"}
				case "sender":
					input.SenderAliases = []string{"9999@s.whatsapp.net"}
				case "direction":
					input.FromMe = true
				case "unknown-clock":
					input.TimestampKnown = false
					input.SourceTimestamp = time.Time{}
				}
				if result, err := writer.ApplyProtocolRevision(t.Context(), input, stamp.Add(2*time.Hour)); err == nil || result.Applied {
					t.Fatalf("%s accepted", fault)
				}
			}
			after, _ := repo.ConversationRevision(t.Context(), original.ChatID)
			if after != before {
				t.Fatal("rejected operation changed data")
			}
			latest, err := repo.LatestMessage(t.Context(), original.ChatID)
			if err != nil || latest.Text != original.Text {
				t.Fatal("rejected operation changed original")
			}
		})
	}
}

func TestProtocolRevisionUnknownOriginalOccurrenceRemainsUnknown(t *testing.T) {
	for _, kind := range []string{"memory", "sqlite"} {
		t.Run(kind, func(t *testing.T) {
			repo := protocolRepo(t, kind)
			original, stamp := seedRevisionOriginal(t, repo, false)
			result, err := repo.(store.ProtocolRevisionRepository).ApplyProtocolRevision(t.Context(), syntheticRevision(stamp), stamp.Add(2*time.Hour))
			if err != nil || !result.Applied || result.Message.TimestampKnown || result.Message.Replyable || !result.Message.Timestamp.Equal(original.Timestamp) {
				t.Fatalf("unknown source date fabricated: %+v %v", result, err)
			}
		})
	}
}
