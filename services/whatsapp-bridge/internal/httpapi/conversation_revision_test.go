package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"mycrobo/whatsapp-bridge/internal/bridge"
	"mycrobo/whatsapp-bridge/internal/domain"
	"mycrobo/whatsapp-bridge/internal/httpapi"
	"mycrobo/whatsapp-bridge/internal/store"
)

type noRevisionHistoryReads struct{ store.Repository }

func (n noRevisionHistoryReads) ListMessages(context.Context, string, int, string) ([]domain.Message, error) {
	panic("revision endpoint must not load history")
}
func (n noRevisionHistoryReads) ListMessageEvents(context.Context, string, int64, int) ([]domain.MessageEvent, error) {
	panic("revision endpoint must not replay events")
}
func (n noRevisionHistoryReads) GetConversationState(context.Context, string) (domain.ConversationState, error) {
	panic("revision endpoint must not reduce state")
}

func TestConversationRevisionEndpointIsContentFreeAndDoesNotTraverseHistory(t *testing.T) {
	repo := store.NewMemory()
	stamp := time.Date(2026, 9, 5, 10, 0, 0, 0, time.UTC)
	if err := repo.UpsertChat(t.Context(), domain.Chat{ID: "a", IdentityID: "a", Title: "Private synthetic title", UpdatedAt: stamp}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.InsertMessage(t.Context(), domain.Message{ID: "m", SourceMessageID: "m", ChatID: "a", Kind: domain.MessageText, Text: "Private synthetic body", Timestamp: stamp, TimestampKnown: true}); err != nil {
		t.Fatal(err)
	}
	h := httpapi.New(bridge.New(noRevisionHistoryReads{repo}, nil, nil, false), httpapi.NewBroker()).Handler()
	r := httptest.NewRequest("GET", "http://127.0.0.1/v1/chats/a/revision", nil)
	r.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatalf("status=%d %s", w.Code, w.Body.String())
	}
	var snapshot store.ConversationRevision
	if err := json.Unmarshal(w.Body.Bytes(), &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.ChatID != "a" || snapshot.Revision <= 0 || snapshot.EventSequence <= 0 {
		t.Fatalf("invalid stamp: %+v", snapshot)
	}
	if strings.Contains(w.Body.String(), "Private") || len(w.Body.Bytes()) > 200 || w.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("revision payload is not bounded and content-free")
	}
	r = httptest.NewRequest("GET", "http://127.0.0.1/v1/chats/missing/revision", nil)
	r.RemoteAddr = "127.0.0.1:1234"
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 404 {
		t.Fatalf("missing chat status=%d", w.Code)
	}
}
