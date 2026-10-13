package httpapi_test

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"mycrobo/whatsapp-bridge/internal/bridge"
	"mycrobo/whatsapp-bridge/internal/domain"
	"mycrobo/whatsapp-bridge/internal/httpapi"
	"mycrobo/whatsapp-bridge/internal/store"
)

type recordingMediaRetrier struct {
	messageID string
	err       error
}

type currentReporter struct{}

func (currentReporter) ConnectionState(context.Context) string { return "current-read-only" }

func (r *recordingMediaRetrier) RetryMedia(_ context.Context, messageID string) error {
	r.messageID = messageID
	return r.err
}

func TestHealthAndOutboundSafeDefault(t *testing.T) {
	b := httpapi.NewBroker()
	s := bridge.New(store.NewMemory(), nil, b, false)
	h := httpapi.New(s, b).Handler()
	r := httptest.NewRequest("GET", "http://127.0.0.1/v1/health", nil)
	r.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "offline-read-only") {
		t.Fatalf("health %d %s", w.Code, w.Body.String())
	}
	r = httptest.NewRequest("POST", "http://127.0.0.1/v1/outbound/approvals", strings.NewReader(`{"recipient":"x","body":"hello"}`))
	r.RemoteAddr = "127.0.0.1:1234"
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("outbound default=%d", w.Code)
	}
}

func TestLatestReturnsNewestVerifiedConversationWithoutHistoryTraversal(t *testing.T) {
	repo := store.NewMemory()
	service := bridge.New(repo, nil, nil, false)
	stamp := time.Date(2026, 8, 22, 9, 30, 0, 0, time.UTC)
	_, err := service.Ingest(t.Context(), domain.IncomingEvent{
		ChatIdentity:   domain.Identity{LID: "contact@lid"},
		SenderIdentity: domain.Identity{LID: "contact@lid", Name: "Sakshi"},
		Chat:           domain.Chat{ID: "contact@lid", SourceID: "contact@lid", Title: "Sakshi"},
		Message:        domain.Message{ID: "m1", SourceMessageID: "m1", Kind: domain.MessageText, Text: "Subah bata dena", Timestamp: stamp, TimestampKnown: true, Replyable: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	h := httpapi.New(service, httpapi.NewBroker()).Handler()
	r := httptest.NewRequest("GET", "http://127.0.0.1/v1/chats/lid:contact@lid/latest", nil)
	r.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"id":"m1"`) || !strings.Contains(w.Body.String(), "Subah bata dena") {
		t.Fatalf("latest %d %s", w.Code, w.Body.String())
	}
}

func TestConversationTruthSeparatesCurrentStoryRelationshipAndLifetimeReadiness(t *testing.T) {
	repo := store.NewMemory()
	service := bridge.New(repo, nil, nil, false)
	service.SetConnectionReporter(currentReporter{})
	stamp := time.Date(2026, 9, 13, 9, 30, 0, 0, time.UTC)
	for _, message := range []domain.Message{
		{ID: "owner-1", SourceMessageID: "owner-1", FromMe: true, Kind: domain.MessageText, Text: "I will check", Timestamp: stamp, TimestampKnown: true, Replyable: true},
		{ID: "contact-2", SourceMessageID: "contact-2", Kind: domain.MessageText, Text: "Any update?", Timestamp: stamp.Add(time.Minute), TimestampKnown: true, Replyable: true},
	} {
		_, err := service.Ingest(t.Context(), domain.IncomingEvent{
			ChatIdentity:   domain.Identity{LID: "contact@lid", Name: "Sakshi"},
			SenderIdentity: domain.Identity{LID: "contact@lid", Name: "Sakshi"},
			Chat:           domain.Chat{ID: "contact@lid", SourceID: "contact@lid", Title: "Sakshi"},
			Message:        message,
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	chatID := "lid:contact@lid"
	if err := service.UpdateHistory(t.Context(), domain.HistorySync{ChatID: chatID, Status: domain.HistoryPartial, MessagesSeen: 1, LastError: "provider did not return an older page"}); err != nil {
		t.Fatal(err)
	}
	h := httpapi.New(service, httpapi.NewBroker()).Handler()
	r := httptest.NewRequest("GET", "http://127.0.0.1/v1/chats/lid:contact@lid/truth", nil)
	r.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	body := w.Body.String()
	for _, expected := range []string{
		`"current_message":{"state":"ready"`,
		`"current_story":{"state":"ready"`,
		`"relationship_history":{"state":"partial"`,
		`"lifetime_history":{"state":"partial"`,
		`"draft_from_current_story_allowed":true`,
		`"locally_stored_messages":2`,
		`"provider_reported_messages_seen":1`,
	} {
		if !strings.Contains(body, expected) {
			t.Fatalf("truth missing %q: %s", expected, body)
		}
	}
	if !strings.Contains(w.Header().Get("Cache-Control"), "no-store") {
		t.Fatalf("truth response is cacheable: %q", w.Header().Get("Cache-Control"))
	}

	newer := stamp.Add(2 * time.Minute)
	chat, err := repo.GetChat(t.Context(), chatID)
	if err != nil {
		t.Fatal(err)
	}
	chat.LastMessageAt = &newer
	chat.UpdatedAt = newer
	if err = repo.UpsertChat(t.Context(), chat); err != nil {
		t.Fatal(err)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if !strings.Contains(w.Body.String(), `"current_message":{"state":"stale"`) || !strings.Contains(w.Body.String(), `"draft_from_current_story_allowed":false`) {
		t.Fatalf("catalogue-ahead truth did not fail closed: %s", w.Body.String())
	}
}

func TestRejectsNonLoopback(t *testing.T) {
	b := httpapi.NewBroker()
	h := httpapi.New(bridge.New(store.NewMemory(), nil, b, false), b).Handler()
	r := httptest.NewRequest("GET", "http://example/v1/health", nil)
	r.RemoteAddr = "10.0.0.2:1234"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("status=%d", w.Code)
	}
}

func TestMediaEndpointServesOnlyLocallySavedViewableImage(t *testing.T) {
	repo := store.NewMemory()
	stamp := time.Date(2026, 8, 25, 10, 0, 0, 0, time.UTC)
	_, _ = repo.InsertMessage(t.Context(), domain.Message{ID: "photo", SourceMessageID: "photo", ChatID: "chat", Kind: domain.MessageImage, Timestamp: stamp, TimestampKnown: true})
	_ = repo.PutMedia(t.Context(), domain.MediaAsset{MessageID: "photo", Metadata: domain.MediaMetadata{Category: "image", MimeType: "image/jpeg", Status: "ready"}, Data: []byte("jpeg-bytes"), UpdatedAt: stamp})
	h := httpapi.New(bridge.New(repo, nil, nil, false), httpapi.NewBroker()).Handler()
	r := httptest.NewRequest("GET", "http://127.0.0.1/v1/media/photo", nil)
	r.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 || w.Body.String() != "jpeg-bytes" || w.Header().Get("Content-Type") != "image/jpeg" || !strings.Contains(w.Header().Get("Cache-Control"), "no-store") {
		t.Fatalf("media status=%d type=%q cache=%q body=%q", w.Code, w.Header().Get("Content-Type"), w.Header().Get("Cache-Control"), w.Body.String())
	}
	r = httptest.NewRequest("GET", "http://127.0.0.1/v1/media/missing", nil)
	r.RemoteAddr = "127.0.0.1:1234"
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 404 {
		t.Fatalf("missing media status=%d", w.Code)
	}
}

func TestMediaEndpointServesSavedVideoAndPDF(t *testing.T) {
	repo := store.NewMemory()
	stamp := time.Date(2026, 8, 26, 10, 0, 0, 0, time.UTC)
	for _, fixture := range []struct {
		id, category, mime, body string
	}{{"video", "video", "video/mp4", "video-bytes"}, {"pdf", "document", "application/pdf", "%PDF-safe"}} {
		_ = repo.PutMedia(t.Context(), domain.MediaAsset{MessageID: fixture.id, Metadata: domain.MediaMetadata{Category: fixture.category, MimeType: fixture.mime, Status: "ready"}, Data: []byte(fixture.body), UpdatedAt: stamp})
	}
	h := httpapi.New(bridge.New(repo, nil, nil, false), httpapi.NewBroker()).Handler()
	for _, fixture := range []struct{ id, mime, body string }{{"video", "video/mp4", "video-bytes"}, {"pdf", "application/pdf", "%PDF-safe"}} {
		r := httptest.NewRequest("GET", "http://127.0.0.1/v1/media/"+fixture.id, nil)
		r.RemoteAddr = "127.0.0.1:1234"
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 200 || w.Header().Get("Content-Type") != fixture.mime || w.Body.String() != fixture.body {
			t.Fatalf("media %s status=%d type=%q body=%q", fixture.id, w.Code, w.Header().Get("Content-Type"), w.Body.String())
		}
	}
}

func TestMediaFetchQueuesRetryWithoutCallingOutbound(t *testing.T) {
	repo := store.NewMemory()
	service := bridge.New(repo, nil, nil, false)
	retrier := &recordingMediaRetrier{}
	h := httpapi.New(service, httpapi.NewBroker(), retrier).Handler()
	r := httptest.NewRequest("POST", "http://127.0.0.1/v1/media/pdf-message/fetch", nil)
	r.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 202 || retrier.messageID != "pdf-message" || !strings.Contains(w.Body.String(), `"status":"queued"`) {
		t.Fatalf("media fetch status=%d id=%q body=%q", w.Code, retrier.messageID, w.Body.String())
	}
	if service.SendAvailable(t.Context()) {
		t.Fatal("media retry must not enable outbound sending")
	}
}

func TestMediaFetchFailsClosedWhenLiveConnectorIsUnavailable(t *testing.T) {
	h := httpapi.New(bridge.New(store.NewMemory(), nil, nil, false), httpapi.NewBroker()).Handler()
	r := httptest.NewRequest("POST", "http://127.0.0.1/v1/media/pdf-message/fetch", nil)
	r.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 503 || !strings.Contains(strings.ToLower(w.Body.String()), "offline") {
		t.Fatalf("offline media fetch status=%d body=%q", w.Code, w.Body.String())
	}
}

func TestToneSamplesIncludeLocalChatProfilesForRelationshipFallback(t *testing.T) {
	repo := store.NewMemory()
	stamp := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	if err := repo.UpsertChat(t.Context(), domain.Chat{ID: "office", SourceID: "office", Title: "Office colleague", UpdatedAt: stamp}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.InsertMessage(t.Context(), domain.Message{ID: "owner-tone", SourceMessageID: "owner-tone", ChatID: "office", FromMe: true, Kind: domain.MessageText, Text: "Noted", Timestamp: stamp, TimestampKnown: true}); err != nil {
		t.Fatal(err)
	}
	h := httpapi.New(bridge.New(repo, nil, nil, false), httpapi.NewBroker()).Handler()
	r := httptest.NewRequest("GET", "http://127.0.0.1/v1/tone-samples?chat_id=office", nil)
	r.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"chat_profiles"`) || !strings.Contains(w.Body.String(), `"Office colleague"`) {
		t.Fatalf("tone profile status=%d body=%q", w.Code, w.Body.String())
	}
}

func TestResponseEpisodesRequireBoundAccountAndReturnOnlyDirectLocalPairs(t *testing.T) {
	repo := store.NewMemory()
	service := bridge.New(repo, nil, nil, false)
	h := httpapi.New(service, httpapi.NewBroker()).Handler()
	request := func() *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "http://127.0.0.1/v1/response-episodes?limit=20", nil)
		r.RemoteAddr = "127.0.0.1:1234"
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	if w := request(); w.Code != 409 {
		t.Fatalf("unbound response evidence status=%d body=%s", w.Code, w.Body.String())
	}
	accountID := strings.Repeat("a", 64)
	if _, err := repo.BindAccount(t.Context(), accountID, nil); err != nil {
		t.Fatal(err)
	}
	stamp := time.Date(2026, 9, 12, 10, 0, 0, 0, time.UTC)
	for _, chat := range []domain.Chat{
		{ID: "friend", SourceID: "friend-source", IdentityID: "lid:friend", Title: "Friend", UpdatedAt: stamp},
		{ID: "team", SourceID: "team-source", IdentityID: "group:team", Title: "Team", IsGroup: true, UpdatedAt: stamp},
	} {
		if err := repo.UpsertChat(t.Context(), chat); err != nil {
			t.Fatal(err)
		}
	}
	for _, message := range []domain.Message{
		{ID: "friend-in", SourceMessageID: "source-friend-in", ChatID: "friend", SenderID: "lid:friend", Kind: domain.MessageText, Text: "Presentation is ready", Timestamp: stamp, TimestampKnown: true},
		{ID: "friend-out", SourceMessageID: "source-friend-out", ChatID: "friend", FromMe: true, Kind: domain.MessageText, Text: "Great, what is next?", Timestamp: stamp.Add(time.Minute), TimestampKnown: true},
		{ID: "team-in", SourceMessageID: "source-team-in", ChatID: "team", SenderID: "lid:member", Kind: domain.MessageText, Text: "Update", Timestamp: stamp.Add(2 * time.Minute), TimestampKnown: true},
		{ID: "team-out", SourceMessageID: "source-team-out", ChatID: "team", FromMe: true, Kind: domain.MessageText, Text: "Okay", Timestamp: stamp.Add(3 * time.Minute), TimestampKnown: true},
	} {
		if _, err := repo.InsertMessage(t.Context(), message); err != nil {
			t.Fatal(err)
		}
	}
	w := request()
	body := w.Body.String()
	if w.Code != 200 || !strings.Contains(body, `"account_scope_id":"`+accountID+`"`) || !strings.Contains(body, `"person_id":"lid:friend"`) || !strings.Contains(body, `"source-friend-in"`) || !strings.Contains(body, `"source-friend-out"`) {
		t.Fatalf("response evidence status=%d body=%s", w.Code, body)
	}
	if strings.Contains(body, "source-team-in") || strings.Contains(body, "source-team-out") || !strings.Contains(w.Header().Get("Cache-Control"), "no-store") {
		t.Fatalf("unsafe group or cacheable evidence: cache=%q body=%s", w.Header().Get("Cache-Control"), body)
	}
}

func TestWorkspaceIncludesMediaOnlyChatsWithoutExistingState(t *testing.T) {
	repo := store.NewMemory()
	stamp := time.Date(2026, 8, 26, 10, 0, 0, 0, time.UTC)
	if err := repo.UpsertChat(t.Context(), domain.Chat{ID: "media-chat", SourceID: "media-chat", Title: "Media only", UpdatedAt: stamp, LastMessageAt: &stamp}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.InsertMessage(t.Context(), domain.Message{ID: "pdf-message", SourceMessageID: "pdf-message", ChatID: "media-chat", Kind: domain.MessageDocument, Timestamp: stamp, TimestampKnown: true}); err != nil {
		t.Fatal(err)
	}
	h := httpapi.New(bridge.New(repo, nil, nil, false), httpapi.NewBroker()).Handler()
	r := httptest.NewRequest("GET", "http://127.0.0.1/v1/workspace", nil)
	r.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"id":"media-chat"`) || !strings.Contains(w.Body.String(), `"id":"pdf-message"`) {
		t.Fatalf("workspace status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestWorkspaceRebuildsOlderConversationStateBeforePublishingQueues(t *testing.T) {
	repo := store.NewMemory()
	stamp := time.Date(2026, 8, 26, 10, 0, 0, 0, time.UTC)
	if err := repo.UpsertChat(t.Context(), domain.Chat{ID: "stale-chat", SourceID: "stale-chat", Title: "Stale state", UpdatedAt: stamp, LastMessageAt: &stamp}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.InsertMessage(t.Context(), domain.Message{ID: "promise", SourceMessageID: "promise", ChatID: "stale-chat", FromMe: true, Kind: domain.MessageText, Text: "I will send the report", Timestamp: stamp, TimestampKnown: true}); err != nil {
		t.Fatal(err)
	}
	if err := repo.PutConversationState(t.Context(), domain.ConversationState{ChatID: "stale-chat", Version: 1, ConversationStatus: "empty", UpdatedAt: stamp}); err != nil {
		t.Fatal(err)
	}
	h := httpapi.New(bridge.New(repo, nil, nil, false), httpapi.NewBroker()).Handler()
	r := httptest.NewRequest("GET", "http://127.0.0.1/v1/workspace", nil)
	r.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"version":2`) || !strings.Contains(w.Body.String(), `"action":"I will send the report"`) {
		t.Fatalf("workspace published stale queue state status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestWorkspaceMaterializesMissingConversationStateBeforePublishingQueues(t *testing.T) {
	repo := store.NewMemory()
	stamp := time.Date(2026, 8, 26, 10, 0, 0, 0, time.UTC)
	if err := repo.UpsertChat(t.Context(), domain.Chat{ID: "missing-state-chat", SourceID: "missing-state-chat", Title: "Imported chat", UpdatedAt: stamp, LastMessageAt: &stamp}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.InsertMessage(t.Context(), domain.Message{ID: "promise", SourceMessageID: "promise", ChatID: "missing-state-chat", FromMe: true, Kind: domain.MessageText, Text: "I will send the report", Timestamp: stamp, TimestampKnown: true}); err != nil {
		t.Fatal(err)
	}
	h := httpapi.New(bridge.New(repo, nil, nil, false), httpapi.NewBroker()).Handler()
	r := httptest.NewRequest("GET", "http://127.0.0.1/v1/workspace", nil)
	r.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"version":2`) || !strings.Contains(w.Body.String(), `"action":"I will send the report"`) {
		t.Fatalf("workspace omitted a missing state projection status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestChatListReplacesInternalLIDNumberWithResolvedPhone(t *testing.T) {
	repo := store.NewMemory()
	stamp := time.Date(2026, 8, 26, 10, 0, 0, 0, time.UTC)
	identity, err := repo.UpsertIdentity(t.Context(), domain.Identity{LID: "246174757970026@lid", Phone: "919876543210", PhoneJID: "919876543210@s.whatsapp.net", UpdatedAt: stamp})
	if err != nil {
		t.Fatal(err)
	}
	if err = repo.UpsertChat(t.Context(), domain.Chat{ID: string(identity.ID), SourceID: "246174757970026@lid", IdentityID: identity.ID, Title: "246174757970026", UpdatedAt: stamp}); err != nil {
		t.Fatal(err)
	}
	h := httpapi.New(bridge.New(repo, nil, nil, false), httpapi.NewBroker()).Handler()
	r := httptest.NewRequest("GET", "http://127.0.0.1/v1/chats?archived=false", nil)
	r.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"title":"+919876543210"`) || strings.Contains(w.Body.String(), `"title":"246174757970026"`) {
		t.Fatalf("resolved chat status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestLocalBridgeRequiresExactBearerToken(t *testing.T) {
	token := "0123456789abcdef0123456789abcdef"
	h := httpapi.RequireBearer(httpapi.New(bridge.New(store.NewMemory(), nil, nil, false), httpapi.NewBroker()).Handler(), token)
	for _, candidate := range []struct {
		header string
		want   int
	}{{"", 401}, {"Bearer wrong", 401}, {"Bearer " + token, 200}} {
		r := httptest.NewRequest("GET", "http://127.0.0.1/v1/health", nil)
		r.RemoteAddr = "127.0.0.1:1234"
		if candidate.header != "" {
			r.Header.Set("Authorization", candidate.header)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != candidate.want {
			t.Fatalf("header=%q status=%d want=%d", candidate.header, w.Code, candidate.want)
		}
	}
}

func TestConversationStateEndpointRequiresAuthAndReturnsEvidence(t *testing.T) {
	repo := store.NewMemory()
	service := bridge.New(repo, nil, nil, false)
	stamp := time.Date(2026, 8, 26, 10, 0, 0, 0, time.UTC)
	_, err := service.Ingest(t.Context(), domain.IncomingEvent{
		ChatIdentity:   domain.Identity{LID: "contact@lid"},
		SenderIdentity: domain.Identity{LID: "contact@lid", Name: "Sakshi"},
		Chat:           domain.Chat{ID: "contact@lid", SourceID: "contact@lid", Title: "Sakshi"},
		Message:        domain.Message{ID: "state-m1", SourceMessageID: "state-m1", Kind: domain.MessageText, Text: "Where should we meet?", Timestamp: stamp, TimestampKnown: true, Replyable: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	token := "0123456789abcdef0123456789abcdef"
	handler := httpapi.RequireBearer(httpapi.New(service, httpapi.NewBroker()).Handler(), token)
	request := func(header string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("GET", "http://127.0.0.1/v1/chats/lid:contact@lid/state", nil)
		r.RemoteAddr = "127.0.0.1:1234"
		if header != "" {
			r.Header.Set("Authorization", header)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	if response := request(""); response.Code != 401 {
		t.Fatalf("unauthenticated state status=%d", response.Code)
	}
	response := request("Bearer " + token)
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"latest_message_id":"state-m1"`) || !strings.Contains(response.Body.String(), `"source_message_id":"state-m1"`) || !strings.Contains(response.Body.String(), `"conversation_status":"awaiting_owner"`) {
		t.Fatalf("state status=%d body=%s", response.Code, response.Body.String())
	}
}
