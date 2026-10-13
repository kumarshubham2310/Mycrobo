package store_test

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"mycrobo/whatsapp-bridge/internal/bridge"
	"mycrobo/whatsapp-bridge/internal/domain"
	"mycrobo/whatsapp-bridge/internal/store"
)

func collisionRepository(t *testing.T, kind string) store.Repository {
	t.Helper()
	if kind == "memory" {
		return store.NewMemory()
	}
	repo, err := store.OpenSQLite(t.Context(), filepath.Join(t.TempDir(), "collision.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { repo.Close() })
	return repo
}

func collisionEvent(id, source, chat, sender string, owner bool) domain.IncomingEvent {
	return domain.IncomingEvent{ChatIdentity: domain.Identity{PhoneJID: chat}, SenderIdentity: domain.Identity{PhoneJID: sender}, Chat: domain.Chat{ID: chat, Title: "Synthetic contact"}, Message: domain.Message{ID: id, SourceMessageID: source, Kind: domain.MessageText, Text: "Synthetic private original", FromMe: owner, Timestamp: time.Date(2026, 9, 5, 9, 0, 0, 0, time.UTC), TimestampKnown: true, Replyable: true}}
}

func collisionCount(t *testing.T, repo store.Repository, chat string, want int64) {
	t.Helper()
	got, err := repo.ConversationRevision(t.Context(), chat)
	if err != nil || got.UnresolvedCount != want {
		t.Fatalf("wrong collision count %+v expected %d %v", got, want, err)
	}
}

func TestMessageCollisionBlocksImplicatedChatsAndNeverClaimsComplete(t *testing.T) {
	for _, kind := range []string{"memory", "sqlite"} {
		t.Run(kind, func(t *testing.T) {
			repo := collisionRepository(t, kind)
			service := bridge.New(repo, nil, nil, false)
			original := collisionEvent("same-id", "same-id", "1111@s.whatsapp.net", "1111@s.whatsapp.net", false)
			if created, err := service.Ingest(t.Context(), original); err != nil || !created {
				t.Fatal(err)
			}
			if err := service.UpdateHistory(t.Context(), domain.HistorySync{ChatID: "jid:1111@s.whatsapp.net", Status: domain.HistoryComplete, HistoryEndHit: true, MessagesSeen: 7, OldestCursor: "verified-oldest", NewestCursor: "verified-latest"}); err != nil {
				t.Fatal(err)
			}
			if _, err := service.Ingest(t.Context(), collisionEvent("unrelated", "unrelated", "3333@s.whatsapp.net", "3333@s.whatsapp.net", false)); err != nil {
				t.Fatal(err)
			}
			collision := collisionEvent("same-id", "same-id", "2222@s.whatsapp.net", "2222@s.whatsapp.net", false)
			collision.Message.Text = "Second private message must not overwrite first"
			for replay := 0; replay < 2; replay++ {
				if created, err := service.Ingest(t.Context(), collision); created || !errors.Is(err, store.ErrMessageIdentityCollision) {
					t.Fatalf("collision silently deduped created=%v err=%v", created, err)
				} else if strings.Contains(err.Error(), "same-id") || strings.Contains(err.Error(), "private") {
					t.Fatal("private evidence leaked through error")
				}
			}
			for _, chat := range []string{"jid:1111@s.whatsapp.net", "jid:2222@s.whatsapp.net"} {
				collisionCount(t, repo, chat, 1)
				history, err := repo.GetHistory(t.Context(), chat)
				if err != nil || history.Status != domain.HistoryFailed || history.HistoryEndHit {
					t.Fatalf("collision claims complete %+v %v", history, err)
				}
				if err = service.UpdateHistory(t.Context(), domain.HistorySync{ChatID: chat, Status: domain.HistoryComplete, HistoryEndHit: true}); !errors.Is(err, store.ErrUnresolvedConversationEvidence) {
					t.Fatalf("complete accepted %v", err)
				}
			}
			collisionCount(t, repo, "jid:3333@s.whatsapp.net", 0)
			latest, err := repo.LatestMessage(t.Context(), "jid:1111@s.whatsapp.net")
			if err != nil || latest.Text != original.Message.Text {
				t.Fatal("original overwritten")
			}
			if _, err := repo.LatestMessage(t.Context(), "jid:2222@s.whatsapp.net"); err == nil {
				t.Fatal("colliding message inserted under ambiguous global key")
			}
			history, _ := repo.GetHistory(t.Context(), "jid:1111@s.whatsapp.net")
			if history.MessagesSeen != 7 || history.OldestCursor != "verified-oldest" || history.NewestCursor != "verified-latest" {
				t.Fatalf("imported coverage erased %+v", history)
			}
			if created, err := service.Ingest(t.Context(), original); err != nil || created {
				t.Fatal("original normal replay failed")
			}
			collisionCount(t, repo, "jid:1111@s.whatsapp.net", 1)
		})
	}
}

func TestMessageCollisionRejectsDifferentSenderDirectionAndLocalID(t *testing.T) {
	for _, kind := range []string{"memory", "sqlite"} {
		for _, fault := range []string{"sender", "direction", "local-id"} {
			t.Run(kind+"/"+fault, func(t *testing.T) {
				repo := collisionRepository(t, kind)
				service := bridge.New(repo, nil, nil, false)
				event := collisionEvent("local", "source", "1111@s.whatsapp.net", "1111@s.whatsapp.net", false)
				if _, err := service.Ingest(t.Context(), event); err != nil {
					t.Fatal(err)
				}
				switch fault {
				case "sender":
					event.SenderIdentity.PhoneJID = "2222@s.whatsapp.net"
				case "direction":
					event.Message.FromMe = true
				case "local-id":
					event.Message.SourceMessageID = "other-source"
				}
				if created, err := service.Ingest(t.Context(), event); created || !errors.Is(err, store.ErrMessageIdentityCollision) {
					t.Fatalf("conflicting identity accepted=%v %v", created, err)
				}
				collisionCount(t, repo, "jid:1111@s.whatsapp.net", 1)
				events, err := repo.ListMessageEvents(t.Context(), "jid:1111@s.whatsapp.net", 0, 100)
				if err != nil || len(events) != 1 {
					t.Fatal("collision corrupted immutable journal")
				}
			})
		}
	}
}

func TestMessageCollisionAllowsExactReplayAndVerifiedAliasEnrichment(t *testing.T) {
	for _, kind := range []string{"memory", "sqlite"} {
		t.Run(kind, func(t *testing.T) {
			repo := collisionRepository(t, kind)
			service := bridge.New(repo, nil, nil, false)
			event := collisionEvent("original", "original", "1111@s.whatsapp.net", "1111@s.whatsapp.net", false)
			if _, err := service.Ingest(t.Context(), event); err != nil {
				t.Fatal(err)
			}
			before, err := repo.ConversationRevision(t.Context(), "jid:1111@s.whatsapp.net")
			if err != nil {
				t.Fatal(err)
			}
			for repeat := 0; repeat < 2; repeat++ {
				if created, err := service.Ingest(t.Context(), event); err != nil || created {
					t.Fatalf("duplicate changed %v %v", created, err)
				}
			}
			event.ChatIdentity.LID = "7777@lid"
			event.SenderIdentity.LID = "7777@lid"
			event.Chat.ID = "7777@lid"
			if created, err := service.Ingest(t.Context(), event); err != nil || created {
				t.Fatalf("verified alias mistaken for collision %v %v", created, err)
			}
			after, err := repo.ConversationRevision(t.Context(), "jid:1111@s.whatsapp.net")
			if err != nil || after.UnresolvedCount != 0 || after.EventSequence != before.EventSequence {
				t.Fatal("normal replay invalidated evidence")
			}
		})
	}
}

func TestMessageCollisionPersistsAfterSQLiteRestart(t *testing.T) {
	path := filepath.Join(t.TempDir(), "persist.db")
	repo, err := store.OpenSQLite(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	service := bridge.New(repo, nil, nil, false)
	if _, err = service.Ingest(t.Context(), collisionEvent("id", "id", "1111@s.whatsapp.net", "1111@s.whatsapp.net", false)); err != nil {
		t.Fatal(err)
	}
	if _, err = service.Ingest(t.Context(), collisionEvent("id", "id", "2222@s.whatsapp.net", "2222@s.whatsapp.net", false)); !errors.Is(err, store.ErrMessageIdentityCollision) {
		t.Fatal(err)
	}
	repo.Close()
	repo, err = store.OpenSQLite(t.Context(), path)
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	for _, chat := range []string{"jid:1111@s.whatsapp.net", "jid:2222@s.whatsapp.net"} {
		collisionCount(t, repo, chat, 1)
		if err = repo.PutHistory(t.Context(), domain.HistorySync{ChatID: chat, Status: domain.HistoryComplete, HistoryEndHit: true}); !errors.Is(err, store.ErrUnresolvedConversationEvidence) {
			t.Fatal("restart lost completion block")
		}
	}
}
