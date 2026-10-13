package whatsmeowlive

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"

	"mycrobo/whatsapp-bridge/internal/bridge"
	"mycrobo/whatsapp-bridge/internal/domain"
	"mycrobo/whatsapp-bridge/internal/store"
)

func TestOutboundMessageIDIsStableAndKeySpecific(t *testing.T) {
	first := outboundMessageID("attempt-1234567890")
	if first == "" || first != outboundMessageID("attempt-1234567890") {
		t.Fatal("outbound message ID is not deterministic")
	}
	if first == outboundMessageID("attempt-0987654321") {
		t.Fatal("different idempotency keys produced the same message ID")
	}
}

func TestDisplayNameSelectionRejectsPunctuationOnlyConnectorMetadata(t *testing.T) {
	if got := firstMeaningfulDisplayName(".", "  ", "Dad", "9199"); got != "Dad" {
		t.Fatalf("display name=%q", got)
	}
	if got := firstMeaningfulDisplayName("👨‍👩‍👧", "Family"); got != "👨‍👩‍👧" {
		t.Fatalf("emoji display name=%q", got)
	}
}

func TestNormalizeMessageUsesProtocolDirectionAndMergesLIDPhoneEvidence(t *testing.T) {
	stamp := time.Date(2026, 8, 22, 9, 30, 0, 0, time.UTC)
	text := "Subah bata dena pls"
	event := &events.Message{
		Info: types.MessageInfo{
			MessageSource: types.MessageSource{
				Chat:      types.NewJID("contact-lid", types.HiddenUserServer),
				Sender:    types.NewJID("contact-lid", types.HiddenUserServer),
				SenderAlt: types.NewJID("919999999999", types.DefaultUserServer),
				IsFromMe:  false,
			},
			ID:        "real-message-id",
			PushName:  "Sakshi",
			Timestamp: stamp,
			Type:      "text",
		},
		Message: &waE2E.Message{Conversation: &text},
	}
	normalized, err := NormalizeMessage(event, "Sakshi", false)
	if err != nil {
		t.Fatal(err)
	}
	if normalized.Message.FromMe || !normalized.Message.Replyable || normalized.Message.Text != text || !normalized.Message.Timestamp.Equal(stamp) {
		t.Fatalf("message=%#v", normalized.Message)
	}
	if normalized.ChatIdentity.LID == "" || normalized.ChatIdentity.PhoneJID == "" || normalized.SenderIdentity.LID == "" || normalized.SenderIdentity.Phone != "919999999999" {
		t.Fatalf("identity evidence lost: chat=%#v sender=%#v", normalized.ChatIdentity, normalized.SenderIdentity)
	}
}

type fakeHistoryPeer struct {
	live    *Live
	current string
	order   []string
}

func (f *fakeHistoryPeer) BuildHistorySyncRequest(info *types.MessageInfo, _ int) *waE2E.Message {
	f.current = domain.NormalizeAlias(info.Chat.ToNonAD().String())
	return &waE2E.Message{}
}
func (f *fakeHistoryPeer) SendPeerMessage(context.Context, *waE2E.Message) (whatsmeow.SendResponse, error) {
	f.order = append(f.order, f.current)
	f.live.notifyOnDemand(onDemandResult{ChatID: f.current, End: true})
	return whatsmeow.SendResponse{}, nil
}

func TestNormalizeMessageKeepsReactionOutsideConversation(t *testing.T) {
	stamp := time.Date(2026, 8, 22, 9, 30, 0, 0, time.UTC)
	reaction := "👍"
	event := &events.Message{
		Info:    types.MessageInfo{MessageSource: types.MessageSource{Chat: types.NewJID("9199", types.DefaultUserServer), Sender: types.NewJID("9199", types.DefaultUserServer)}, ID: "reaction", Timestamp: stamp},
		Message: &waE2E.Message{ReactionMessage: &waE2E.ReactionMessage{Text: &reaction}},
	}
	normalized, err := NormalizeMessage(event, "Contact", false)
	if err != nil {
		t.Fatal(err)
	}
	if normalized.Message.Kind != domain.MessageReaction || normalized.Message.Replyable {
		t.Fatalf("reaction became replyable: %#v", normalized.Message)
	}
}

func TestNormalizeMessagePreservesQuoteAndExplicitOwnerMention(t *testing.T) {
	stamp := time.Date(2026, 8, 22, 9, 30, 0, 0, time.UTC)
	text := "@Tirth please confirm?"
	quoted := "owner-message-id"
	owner := types.NewJID("919900000000", types.DefaultUserServer)
	participant := owner.String()
	event := &events.Message{
		Info: types.MessageInfo{MessageSource: types.MessageSource{Chat: types.NewJID("group", types.GroupServer), Sender: types.NewJID("member", types.HiddenUserServer), IsGroup: true}, ID: "group-message", Timestamp: stamp},
		Message: &waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{
			Text:        &text,
			ContextInfo: &waE2E.ContextInfo{StanzaID: &quoted, Participant: &participant, MentionedJID: []string{owner.String()}},
		}},
	}
	normalized, err := NormalizeMessage(event, "Project group", false)
	if err != nil {
		t.Fatal(err)
	}
	if normalized.Message.QuotedMessageID != quoted || !contextMentionsAny(event.Message, owner) || !contextQuotesAny(event.Message, owner) {
		t.Fatalf("group reference evidence lost: %#v", normalized.Message)
	}
}

func TestOpenCreatesPersistentSessionWithoutConnecting(t *testing.T) {
	service := bridge.New(store.NewMemory(), nil, nil, false)
	live, err := Open(context.Background(), filepath.Join(t.TempDir(), "session.db"), service)
	if err != nil {
		t.Fatal(err)
	}
	defer live.Close()
	if live.ConnectionState(context.Background()) != "offline" || live.Pairing().State != "unpaired" {
		t.Fatalf("opening adapter performed lifecycle work: state=%s pairing=%#v", live.ConnectionState(context.Background()), live.Pairing())
	}
}

func TestFreshnessRequiresOfflineCatchupCompletionAndClearsOnDisconnect(t *testing.T) {
	service := bridge.New(store.NewMemory(), nil, nil, false)
	live, err := Open(context.Background(), filepath.Join(t.TempDir(), "session.db"), service)
	if err != nil {
		t.Fatal(err)
	}
	defer live.Close()
	owner := types.NewJID("111", types.DefaultUserServer)
	live.client.Store.ID = &owner
	live.handleEvent(&events.Connected{})
	if snapshot := live.Freshness(); snapshot.State != "catching-up" || snapshot.CaughtUpAt != nil {
		t.Fatalf("connected was prematurely current: %#v", snapshot)
	}
	live.handleEvent(&events.OfflineSyncCompleted{Count: 0})
	// Injected catchup is not a real socket connection. The public status must
	// stay offline even though event handling recorded completion internally.
	if snapshot := live.Freshness(); snapshot.State != "offline" || snapshot.CaughtUpAt != nil || snapshot.AccountProof == "" {
		t.Fatalf("synthetic event falsely established readiness: %#v", snapshot)
	}
	live.handleEvent(&events.Disconnected{})
	if snapshot := live.Freshness(); snapshot.State != "offline" || snapshot.CaughtUpAt != nil {
		t.Fatalf("disconnect left stale freshness: %#v", snapshot)
	}
}

func TestRealBackfillCoordinatorRequestsActiveThenArchivedOneChatAtATime(t *testing.T) {
	ctx := context.Background()
	repo := store.NewMemory()
	service := bridge.New(repo, nil, nil, false)
	live := &Live{client: accountTestClient("111"), service: service, state: "current-read-only", waiters: make(map[string]chan onDemandResult)}
	if err := live.requireAccountBinding(ctx, live.client); err != nil {
		t.Fatal(err)
	}
	stamp := time.Date(2026, 8, 22, 9, 30, 0, 0, time.UTC)
	for index, chat := range []domain.Chat{
		{ID: "active@s.whatsapp.net", Title: "Active", UpdatedAt: stamp},
		{ID: "archived@s.whatsapp.net", Title: "Archived", Archived: true, UpdatedAt: stamp.Add(-time.Minute)},
	} {
		if err := repo.UpsertChat(ctx, chat); err != nil {
			t.Fatal(err)
		}
		messageID := fmt.Sprintf("oldest-%d", index)
		if _, err := repo.InsertMessage(ctx, domain.Message{ID: messageID, SourceMessageID: messageID, ChatID: chat.ID, Timestamp: stamp, TimestampKnown: true}); err != nil {
			t.Fatal(err)
		}
	}
	peer := &fakeHistoryPeer{live: live}
	live.historyPeer = peer
	live.backfillAll(ctx)
	if len(peer.order) != 2 || peer.order[0] != "active@s.whatsapp.net" || peer.order[1] != "archived@s.whatsapp.net" {
		t.Fatalf("backfill order=%v", peer.order)
	}
	for _, id := range peer.order {
		state, err := repo.GetHistory(ctx, id)
		if err != nil || state.Status != domain.HistoryComplete || !state.HistoryEndHit {
			t.Fatalf("history %s=%#v err=%v", id, state, err)
		}
	}
}
