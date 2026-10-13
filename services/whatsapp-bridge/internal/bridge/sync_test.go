package bridge_test

import (
	"context"
	"fmt"
	"strconv"
	"testing"
	"time"

	"mycrobo/whatsapp-bridge/internal/bridge"
	"mycrobo/whatsapp-bridge/internal/domain"
	"mycrobo/whatsapp-bridge/internal/store"
)

type historyMock struct{ order []string }

func (h *historyMock) DiscoverChats(_ context.Context, archived bool) ([]domain.Chat, error) {
	if archived {
		return []domain.Chat{{ID: "archived", Archived: true}}, nil
	}
	return []domain.Chat{{ID: "active"}}, nil
}

type longHistoryMock struct{ pages int }

func (h *longHistoryMock) DiscoverChats(_ context.Context, archived bool) ([]domain.Chat, error) {
	if archived {
		return nil, nil
	}
	return []domain.Chat{{ID: "long"}}, nil
}
func (h *longHistoryMock) HistoryPage(_ context.Context, _ domain.Chat, cursor string) ([]domain.IncomingEvent, string, bool, error) {
	page := 0
	if cursor != "" {
		var err error
		page, err = strconv.Atoi(cursor)
		if err != nil {
			return nil, "", false, err
		}
	}
	h.pages++
	next := fmt.Sprintf("%d", page+1)
	return nil, next, page >= 1501, nil
}

func TestSyncAllHasNoArbitraryHistoryPageCutoff(t *testing.T) {
	repo := store.NewMemory()
	service := bridge.New(repo, nil, nil, false)
	source := &longHistoryMock{}
	summary, err := service.SyncAll(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	if summary.ChatsComplete != 1 || source.pages != 1502 {
		t.Fatalf("summary=%#v pages=%d", summary, source.pages)
	}
}
func (h *historyMock) HistoryPage(_ context.Context, c domain.Chat, cursor string) ([]domain.IncomingEvent, string, bool, error) {
	h.order = append(h.order, c.ID+":"+cursor)
	stamp := time.Date(2026, 8, 20, 12, 0, 0, 0, time.UTC)
	event := domain.IncomingEvent{Identity: domain.Identity{LID: c.ID}, Chat: c, Message: domain.Message{ID: c.ID + cursor + "m", SourceMessageID: c.ID + cursor + "m", Kind: domain.MessageText, Text: "hello", Timestamp: stamp, TimestampKnown: true, Replyable: true}}
	if cursor == "" {
		return []domain.IncomingEvent{event}, "page-2", false, nil
	}
	return []domain.IncomingEvent{event}, "end", true, nil
}
func TestSyncAllDoesEveryActiveThenArchivedChatSequentially(t *testing.T) {
	repo := store.NewMemory()
	service := bridge.New(repo, nil, nil, false)
	source := &historyMock{}
	summary, err := service.SyncAll(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	if summary.ChatsComplete != 2 || summary.MessagesSeen != 4 {
		t.Fatalf("summary=%#v", summary)
	}
	want := []string{"active:", "active:page-2", "archived:", "archived:page-2"}
	if len(source.order) != len(want) {
		t.Fatalf("order=%v", source.order)
	}
	for i := range want {
		if source.order[i] != want[i] {
			t.Fatalf("order=%v", source.order)
		}
	}
	state, err := repo.GetHistory(context.Background(), "archived")
	if err != nil || !state.HistoryEndHit || state.Status != domain.HistoryComplete {
		t.Fatalf("state=%#v err=%v", state, err)
	}
}
