package httpapi_test

import (
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

func TestProtocolRevisionEndpointExposesPersistentIssueCountWithoutDetails(t *testing.T) {
	repo := store.NewMemory()
	stamp := time.Date(2026, 8, 1, 9, 0, 0, 0, time.UTC)
	service := bridge.New(repo, nil, nil, false)
	if _, err := service.Ingest(t.Context(), domain.IncomingEvent{ChatIdentity: domain.Identity{PhoneJID: "1234@s.whatsapp.net"}, SenderIdentity: domain.Identity{PhoneJID: "1234@s.whatsapp.net"}, Chat: domain.Chat{ID: "1234@s.whatsapp.net", Title: "Private title"}, Message: domain.Message{ID: "source", SourceMessageID: "source", Kind: domain.MessageText, Text: "Private synthetic body", Timestamp: stamp, TimestampKnown: true, Replyable: true}}); err != nil {
		t.Fatal(err)
	}
	handler := httpapi.New(bridge.New(noRevisionHistoryReads{repo}, nil, nil, false), httpapi.NewBroker()).Handler()
	for _, expected := range []float64{0, 1} {
		if expected == 1 {
			input := domain.ProtocolRevision{TargetSourceMessageID: "private-source-id", ChatAliases: []string{"1234@s.whatsapp.net"}, SenderAliases: []string{"1234@s.whatsapp.net"}, Type: domain.MessageEdited, Kind: domain.MessageText, Text: "Private synthetic edit"}
			if err := repo.RecordProtocolRevisionIssue(t.Context(), input, "original-not-imported", stamp); err != nil {
				t.Fatal(err)
			}
		}
		r := httptest.NewRequest("GET", "http://127.0.0.1/v1/chats/jid:1234@s.whatsapp.net/revision", nil)
		r.RemoteAddr = "127.0.0.1:1234"
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		var got map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if w.Code != 200 || got["unresolved_count"] != expected {
			t.Fatalf("count missing/non-numeric/wrong: %d %s", w.Code, w.Body.String())
		}
		if strings.Contains(strings.ToLower(w.Body.String()), "private") || strings.Contains(w.Body.String(), "original-not-imported") || len(w.Body.Bytes()) > 200 || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("content leaked in revision response")
		}
	}
}
