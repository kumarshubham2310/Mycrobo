package bridge_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"mycrobo/whatsapp-bridge/internal/bridge"
	"mycrobo/whatsapp-bridge/internal/domain"
	"mycrobo/whatsapp-bridge/internal/mock"
	"mycrobo/whatsapp-bridge/internal/store"
)

func TestIngestIsIdempotentAndPreservesArchive(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	s := bridge.New(repo, nil, nil, false)
	stamp := time.Date(2026, 8, 20, 12, 0, 0, 0, time.UTC)
	e := domain.IncomingEvent{Identity: domain.Identity{LID: "123@lid", Phone: "919999999999", UpdatedAt: stamp}, Chat: domain.Chat{ID: "123@lid", Title: "Sakshi", Archived: true, UpdatedAt: stamp}, Message: domain.Message{ID: "m1", SourceMessageID: "wa-m1", Kind: domain.MessageText, Text: "real latest message", Timestamp: stamp, TimestampKnown: true, Replyable: true}}
	first, err := s.Ingest(ctx, e)
	if err != nil || !first {
		t.Fatalf("first ingest=%v err=%v", first, err)
	}
	second, err := s.Ingest(ctx, e)
	if err != nil || second {
		t.Fatalf("duplicate ingest=%v err=%v", second, err)
	}
	chats, _ := repo.ListChats(ctx, true, 10, "")
	if len(chats) != 1 || !chats[0].Archived {
		t.Fatalf("archive metadata lost: %#v", chats)
	}
}

func TestUnknownTimestampCannotBecomeLatestReplyableMessage(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	s := bridge.New(repo, nil, nil, false)
	e := domain.IncomingEvent{Identity: domain.Identity{LID: "x"}, Chat: domain.Chat{ID: "c"}, Message: domain.Message{ID: "m", SourceMessageID: "m", Kind: domain.MessageText, Text: "77 KB", TimestampKnown: false, Replyable: true}}
	if _, err := s.Ingest(ctx, e); err != nil {
		t.Fatal(err)
	}
	v, _ := repo.ListMessages(ctx, "lid:x", 10, "")
	if len(v) != 1 || v[0].Replyable || v[0].TimestampKnown {
		t.Fatalf("unsafe message: %#v", v)
	}
}

func TestOlderHistoryCannotReplaceTheRealLatestChatTimestamp(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	s := bridge.New(repo, nil, nil, false)
	identity := domain.Identity{LID: "person@lid"}
	newer := time.Date(2026, 8, 22, 9, 30, 0, 0, time.UTC)
	older := newer.Add(-72 * time.Hour)
	for _, message := range []domain.Message{
		{ID: "newest", SourceMessageID: "newest", Kind: domain.MessageText, Text: "latest", Timestamp: newer, TimestampKnown: true, Replyable: true},
		{ID: "older", SourceMessageID: "older", Kind: domain.MessageText, Text: "history", Timestamp: older, TimestampKnown: true, Replyable: true},
	} {
		if _, err := s.Ingest(ctx, domain.IncomingEvent{Identity: identity, Chat: domain.Chat{ID: "chat", Title: "Kavya"}, Message: message}); err != nil {
			t.Fatal(err)
		}
	}
	chats, err := repo.ListChats(ctx, false, 10, "")
	if err != nil || len(chats) != 1 || chats[0].LastMessageAt == nil || !chats[0].LastMessageAt.Equal(newer) {
		t.Fatalf("latest timestamp regressed: chats=%#v err=%v", chats, err)
	}
}

func TestPhoneAndLIDEventsBecomeOneCanonicalConversation(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	service := bridge.New(repo, nil, nil, false)
	stamp := time.Date(2026, 8, 22, 12, 0, 0, 0, time.UTC)
	events := []domain.IncomingEvent{
		{ChatIdentity: domain.Identity{PhoneJID: "9199@s.whatsapp.net"}, SenderIdentity: domain.Identity{PhoneJID: "9199@s.whatsapp.net"}, Chat: domain.Chat{ID: "9199@s.whatsapp.net", SourceID: "9199@s.whatsapp.net", Title: "Sakshi"}, Message: domain.Message{ID: "phone", SourceMessageID: "phone", Kind: domain.MessageText, Text: "one", Timestamp: stamp, TimestampKnown: true}},
		{ChatIdentity: domain.Identity{LID: "contact@lid", PhoneJID: "9199@s.whatsapp.net"}, SenderIdentity: domain.Identity{LID: "contact@lid", PhoneJID: "9199@s.whatsapp.net"}, Chat: domain.Chat{ID: "contact@lid", SourceID: "contact@lid", Title: "Sakshi"}, Message: domain.Message{ID: "lid", SourceMessageID: "lid", Kind: domain.MessageText, Text: "two", Timestamp: stamp.Add(time.Minute), TimestampKnown: true}},
	}
	for _, event := range events {
		if _, err := service.Ingest(ctx, event); err != nil {
			t.Fatal(err)
		}
	}
	chats, err := repo.ListChats(ctx, false, 10, "")
	if err != nil || len(chats) != 1 {
		t.Fatalf("identity split into chats: %#v err=%v", chats, err)
	}
	messages, err := repo.ListMessages(ctx, chats[0].ID, 10, "")
	if err != nil || len(messages) != 2 {
		t.Fatalf("canonical history split: %#v err=%v", messages, err)
	}
}

func TestOutboundNeedsExactOneUseApproval(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	transport := &mock.Transport{}
	s := bridge.New(repo, transport, nil, true)
	stamp := time.Now().UTC()
	if _, err := s.Ingest(ctx, domain.IncomingEvent{Identity: domain.Identity{LID: "sakshi@lid"}, Chat: domain.Chat{ID: "sakshi@lid", SourceID: "sakshi@lid", Title: "Sakshi"}, Message: domain.Message{ID: "latest", SourceMessageID: "latest", Kind: domain.MessageText, Text: "Hello?", Timestamp: stamp, TimestampKnown: true}}); err != nil {
		t.Fatal(err)
	}
	recipient := "lid:sakshi@lid"
	token, err := s.IssueApproval(ctx, recipient, "Hello", "latest", "attempt-00000001", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.SendApproved(ctx, recipient, "Changed", "latest", "attempt-00000001", token); !errors.Is(err, bridge.ErrIdempotencyConflict) && !errors.Is(err, bridge.ErrApprovalInvalid) {
		t.Fatalf("mismatch=%v", err)
	}
	if transport.Count() != 0 {
		t.Fatal("mismatched body was sent")
	}
	token, _ = s.IssueApproval(ctx, recipient, "Hello", "latest", "attempt-00000002", time.Minute)
	if _, err = s.SendApproved(ctx, recipient, "Hello", "latest", "attempt-00000002", token); err != nil {
		t.Fatal(err)
	}
	if id, err := s.SendApproved(ctx, recipient, "Hello", "latest", "attempt-00000002", token); err != nil || id != "mock-message-id" {
		t.Fatalf("reuse=%v", err)
	}
	if transport.Count() != 1 {
		t.Fatalf("sent %d times", transport.Count())
	}
	if transport.Messages[0].Recipient != "sakshi@lid" || transport.Messages[0].IdempotencyKey != "attempt-00000002" {
		t.Fatalf("wrong provider recipient or idempotency binding: %#v", transport.Messages[0])
	}
	if repo.AuditCount("approved") != 2 || repo.AuditCount("sending") != 1 || repo.AuditCount("sent") != 1 {
		t.Fatal("durable audit boundary missing")
	}
	latest, err := repo.LatestMessage(ctx, recipient)
	if err != nil || latest.ID != "mock-message-id" || latest.Text != "Hello" || !latest.FromMe {
		t.Fatalf("accepted send missing from visible history: latest=%#v err=%v", latest, err)
	}
}

func TestExactApprovalCanRecoverAcrossBridgeRestartWithoutDuplicateSend(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	transport := &mock.Transport{}
	first := bridge.New(repo, transport, nil, true)
	stamp := time.Now().UTC()
	if _, err := first.Ingest(ctx, domain.IncomingEvent{
		Identity: domain.Identity{LID: "person@lid"},
		Chat:     domain.Chat{ID: "person@lid", SourceID: "person@lid", Title: "Person"},
		Message:  domain.Message{ID: "target", SourceMessageID: "target", Kind: domain.MessageText, Text: "Question", Timestamp: stamp, TimestampKnown: true},
	}); err != nil {
		t.Fatal(err)
	}
	const key = "restart-recovery-key-001"
	if _, err := first.IssueApproval(ctx, "lid:person@lid", "Exact reply", "target", key, 2*time.Minute); err != nil {
		t.Fatal(err)
	}

	// A new Service has no in-memory token, but it shares the durable audit.
	restarted := bridge.New(repo, transport, nil, true)
	if _, err := restarted.IssueApproval(ctx, "lid:person@lid", "Changed reply", "target", key, 2*time.Minute); !errors.Is(err, bridge.ErrIdempotencyConflict) {
		t.Fatalf("changed binding recovered: %v", err)
	}
	token, err := restarted.IssueApproval(ctx, "lid:person@lid", "Exact reply", "target", key, 2*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	messageID, err := restarted.SendApproved(ctx, "lid:person@lid", "Exact reply", "target", key, token)
	if err != nil || messageID != "mock-message-id" {
		t.Fatalf("recovered send id=%q err=%v", messageID, err)
	}
	if transport.Count() != 1 {
		t.Fatalf("recovered approval crossed the transport %d times", transport.Count())
	}
	if id, err := restarted.SendApproved(ctx, "lid:person@lid", "Exact reply", "target", key, token); err != nil || id != messageID {
		t.Fatalf("idempotent readback id=%q err=%v", id, err)
	}
	if transport.Count() != 1 {
		t.Fatalf("idempotent readback duplicated the send: %d", transport.Count())
	}
}

func TestOutboundRejectsUnresolvedCurrentFactPlaceholder(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	transport := &mock.Transport{}
	service := bridge.New(repo, transport, nil, true)
	stamp := time.Now().UTC()
	if _, err := service.Ingest(ctx, domain.IncomingEvent{Identity: domain.Identity{LID: "person@lid"}, Chat: domain.Chat{ID: "person@lid", SourceID: "person@lid", Title: "Person"}, Message: domain.Message{ID: "target", SourceMessageID: "target", Kind: domain.MessageText, Text: "What time will you reach?", Timestamp: stamp, TimestampKnown: true}}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.IssueApproval(ctx, "lid:person@lid", "I should reach by [Add the actual time before sending]", "target", "placeholder-key-001", time.Minute); !errors.Is(err, bridge.ErrApprovalInvalid) {
		t.Fatalf("expected unresolved placeholder rejection, got %v", err)
	}
	if transport.Count() != 0 {
		t.Fatal("placeholder crossed the transport boundary")
	}
}

func TestSendFailsClosedWhenLatestMessageChanges(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	transport := &mock.Transport{}
	service := bridge.New(repo, transport, nil, true)
	stamp := time.Now().UTC()
	base := domain.IncomingEvent{Identity: domain.Identity{LID: "person@lid"}, Chat: domain.Chat{ID: "person@lid", SourceID: "person@lid", Title: "Person"}}
	base.Message = domain.Message{ID: "target", SourceMessageID: "target", Kind: domain.MessageText, Text: "First", Timestamp: stamp, TimestampKnown: true}
	if _, err := service.Ingest(ctx, base); err != nil {
		t.Fatal(err)
	}
	token, err := service.IssueApproval(ctx, "lid:person@lid", "Reply", "target", "stale-attempt-0001", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	base.Message = domain.Message{ID: "newer", SourceMessageID: "newer", Kind: domain.MessageText, Text: "Changed", Timestamp: stamp.Add(time.Second), TimestampKnown: true}
	if _, err = service.Ingest(ctx, base); err != nil {
		t.Fatal(err)
	}
	if _, err = service.SendApproved(ctx, "lid:person@lid", "Reply", "target", "stale-attempt-0001", token); !errors.Is(err, bridge.ErrStaleTarget) {
		t.Fatalf("expected stale target, got %v", err)
	}
	if transport.Count() != 0 {
		t.Fatal("stale reply crossed the transport boundary")
	}
}

func TestAmbiguousSendCannotBeBlindlyRetried(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	transport := &mock.Transport{Fail: true}
	service := bridge.New(repo, transport, nil, true)
	stamp := time.Now().UTC()
	if _, err := service.Ingest(ctx, domain.IncomingEvent{Identity: domain.Identity{LID: "person@lid"}, Chat: domain.Chat{ID: "person@lid", SourceID: "person@lid", Title: "Person"}, Message: domain.Message{ID: "target", SourceMessageID: "target", Kind: domain.MessageText, Text: "Question", Timestamp: stamp, TimestampKnown: true}}); err != nil {
		t.Fatal(err)
	}
	token, err := service.IssueApproval(ctx, "lid:person@lid", "Reply", "target", "ambiguous-key-001", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = service.SendApproved(ctx, "lid:person@lid", "Reply", "target", "ambiguous-key-001", token); !errors.Is(err, bridge.ErrAmbiguousOutcome) {
		t.Fatalf("first=%v", err)
	}
	if _, err = service.SendApproved(ctx, "lid:person@lid", "Reply", "target", "ambiguous-key-001", token); !errors.Is(err, bridge.ErrAmbiguousOutcome) {
		t.Fatalf("retry=%v", err)
	}
	if transport.Count() != 1 {
		t.Fatalf("ambiguous attempt crossed transport %d times", transport.Count())
	}
}

func TestOutboundDisabledByDefault(t *testing.T) {
	s := bridge.New(store.NewMemory(), &mock.Transport{}, nil, false)
	if _, err := s.IssueApproval(context.Background(), "x", "y", "z", "attempt-00000003", time.Minute); !errors.Is(err, bridge.ErrOutboundDisabled) {
		t.Fatalf("got %v", err)
	}
}

func TestHistoryCompleteRequiresConfirmedEnd(t *testing.T) {
	s := bridge.New(store.NewMemory(), nil, nil, false)
	err := s.UpdateHistory(context.Background(), domain.HistorySync{ChatID: "c", Status: domain.HistoryComplete})
	if err == nil {
		t.Fatal("incomplete history marked complete")
	}
}

func TestImportConsentIsOneExplicitScopeForAllActiveAndArchivedChats(t *testing.T) {
	repo := store.NewMemory()
	service := bridge.New(repo, nil, nil, false)
	if _, err := service.RecordImportConsent(context.Background(), "v1", true, false, true); err == nil {
		t.Fatal("partial archive consent was accepted as all-chat import")
	}
	consent, err := service.RecordImportConsent(context.Background(), "v1", true, true, true)
	if err != nil {
		t.Fatal(err)
	}
	stored, err := repo.LatestImportConsent(context.Background())
	if err != nil || stored.ID != consent.ID || !stored.ImportAllChats || !stored.IncludeArchivedChats || !stored.UnofficialRiskAccepted {
		t.Fatalf("consent not durable: stored=%#v err=%v", stored, err)
	}
}

func TestPairedSessionCanResumeOnlyAfterDurableAllChatConsent(t *testing.T) {
	repo := store.NewMemory()
	service := bridge.New(repo, nil, nil, false)
	ctx := context.Background()
	if service.CanResumeImport(ctx) {
		t.Fatal("session resumed without consent")
	}
	if _, err := service.RecordImportConsent(ctx, "personal-pilot-import-v1", true, true, true); err != nil {
		t.Fatal(err)
	}
	if !service.CanResumeImport(ctx) {
		t.Fatal("durable all-chat consent did not permit read-only resume")
	}
}

func TestConversationStateRebuildKeepsLatestWhenOlderHistoryArrivesLater(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	service := bridge.New(repo, nil, nil, false)
	newer := time.Date(2026, 8, 26, 12, 0, 0, 0, time.UTC)
	older := newer.Add(-72 * time.Hour)
	for _, message := range []domain.Message{
		{ID: "new", SourceMessageID: "new", Kind: domain.MessageText, Text: "Can you send the latest file?", Timestamp: newer, TimestampKnown: true},
		{ID: "old", SourceMessageID: "old", Kind: domain.MessageText, Text: "Old background statement", Timestamp: older, TimestampKnown: true, FromMe: true},
	} {
		_, err := service.Ingest(ctx, domain.IncomingEvent{Identity: domain.Identity{LID: "contact"}, Chat: domain.Chat{ID: "contact", Title: "Contact"}, Message: message})
		if err != nil {
			t.Fatal(err)
		}
	}
	state, err := repo.GetConversationState(ctx, "lid:contact")
	if err != nil {
		t.Fatal(err)
	}
	if state.LatestMessageID != "new" || state.ConversationStatus != "awaiting_owner" || len(state.OpenQuestions) != 1 {
		t.Fatalf("older backfill replaced latest state: %#v", state)
	}
}
