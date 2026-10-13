package whatsmeowlive

import (
	"testing"
	"time"

	"go.mau.fi/whatsmeow/proto/waCommon"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"

	"mycrobo/whatsapp-bridge/internal/bridge"
	"mycrobo/whatsapp-bridge/internal/domain"
	"mycrobo/whatsapp-bridge/internal/store"
)

func syntheticEditEvent() (*events.Message, *waE2E.ProtocolMessage) {
	chat := types.NewJID("1234", types.DefaultUserServer)
	stamp := time.Date(2026, 8, 1, 9, 0, 0, 0, time.UTC)
	p := &waE2E.ProtocolMessage{Type: waE2E.ProtocolMessage_MESSAGE_EDIT.Enum(), Key: &waCommon.MessageKey{ID: proto.String("original"), RemoteJID: proto.String(chat.String()), FromMe: proto.Bool(true)}, TimestampMS: proto.Int64(stamp.Add(time.Hour).UnixMilli()), EditedMessage: &waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{Text: proto.String("Corrected synthetic statement"), ContextInfo: &waE2E.ContextInfo{StanzaID: proto.String("quoted-original")}}}}
	raw := &waE2E.Message{EditedMessage: &waE2E.FutureProofMessage{Message: &waE2E.Message{ProtocolMessage: p}}}
	event := &events.Message{Info: types.MessageInfo{MessageSource: types.MessageSource{Chat: chat, Sender: chat, IsFromMe: false}, ID: "edit-envelope", Timestamp: stamp}, RawMessage: raw, Message: raw}
	return event, p
}

func TestProtocolRevisionNormalizesLiveAndAlreadyUnwrappedHistory(t *testing.T) {
	for _, shape := range []string{"live-wrapper", "protocol", "history-unwrapped"} {
		t.Run(shape, func(t *testing.T) {
			event, p := syntheticEditEvent()
			if shape == "protocol" {
				event.Message = &waE2E.Message{ProtocolMessage: p}
				event.RawMessage = nil
			}
			if shape == "history-unwrapped" {
				event.IsEdit = true
				event.Info.ID = "original"
				event.Message = p.EditedMessage
			}
			got, matched, err := NormalizeProtocolRevision(event)
			if err != nil || !matched {
				t.Fatalf("matched=%v err=%v", matched, err)
			}
			if got.TargetSourceMessageID != "original" || got.Type != domain.MessageEdited || got.Text != "Corrected synthetic statement" || got.QuotedMessageID == nil || *got.QuotedMessageID != "quoted-original" {
				t.Fatalf("bad revision: %+v", got)
			}
			if got.FromMe || !got.TimestampKnown || !got.SourceTimestamp.Equal(time.UnixMilli(p.GetTimestampMS())) {
				t.Fatal("envelope direction/provider clock were replaced by key perspective or local time")
			}
		})
	}
}

func TestProtocolRevisionRejectsCrossChatParticipantAndMissingTarget(t *testing.T) {
	for _, fault := range []string{"chat", "participant", "missing-target", "missing-envelope", "view-once"} {
		t.Run(fault, func(t *testing.T) {
			event, p := syntheticEditEvent()
			switch fault {
			case "chat":
				p.Key.RemoteJID = proto.String("9999@s.whatsapp.net")
			case "participant":
				p.Key.Participant = proto.String("9999@s.whatsapp.net")
			case "missing-target":
				p.Key.ID = nil
			case "missing-envelope":
				event.IsEdit = true
				event.Message = &waE2E.Message{Conversation: proto.String("unverified edit")}
				event.RawMessage = nil
			case "view-once":
				event.IsViewOnce = true
			}
			_, matched, err := NormalizeProtocolRevision(event)
			if !matched || err == nil {
				t.Fatalf("unsafe shape accepted matched=%v err=%v", matched, err)
			}
		})
	}
}

func TestProtocolRevisionUnknownTimestampStaysUnknownAndRevokeIsNotText(t *testing.T) {
	event, p := syntheticEditEvent()
	event.Info.Timestamp = time.Time{}
	p.TimestampMS = nil
	got, matched, err := NormalizeProtocolRevision(event)
	if err != nil || !matched || got.TimestampKnown || !got.SourceTimestamp.IsZero() {
		t.Fatalf("unknown edit clock fabricated: %+v %v", got, err)
	}
	p.Type = waE2E.ProtocolMessage_REVOKE.Enum()
	p.EditedMessage = nil
	got, matched, err = NormalizeProtocolRevision(event)
	if err != nil || !matched || got.Type != domain.MessageRemoved || got.Kind != domain.MessageDeleted || got.Text != "" || got.TimestampKnown {
		t.Fatalf("invalid tombstone: %+v %v", got, err)
	}
	plain := &events.Message{Message: &waE2E.Message{Conversation: proto.String("An ordinary sentence")}}
	if _, matched, err = NormalizeProtocolRevision(plain); matched || err != nil {
		t.Fatal("ordinary text became a revision")
	}
}

func TestProtocolRevisionLiveIngestReplaysEditDeleteAndQuarantinesMalformedEvent(t *testing.T) {
	repo := store.NewMemory()
	client := accountTestClient("111")
	service := bridge.New(repo, nil, nil, false)
	live := &Live{client: client, service: service, state: "current-read-only"}
	if err := live.requireAccountBinding(t.Context(), client); err != nil {
		t.Fatal(err)
	}
	event, p := syntheticEditEvent()
	stamp := event.Info.Timestamp
	if _, err := service.Ingest(t.Context(), domain.IncomingEvent{ChatIdentity: domain.Identity{PhoneJID: event.Info.Chat.String()}, SenderIdentity: domain.Identity{PhoneJID: event.Info.Sender.String()}, Chat: domain.Chat{ID: event.Info.Chat.String(), Title: "Synthetic contact"}, Message: domain.Message{ID: "original", SourceMessageID: "original", Kind: domain.MessageText, Text: "Original synthetic statement", Timestamp: stamp, TimestampKnown: true, Replyable: true}}); err != nil {
		t.Fatal(err)
	}
	if applied, err := live.ingestMessage(t.Context(), event, "", false); err != nil || !applied {
		t.Fatalf("live edit=%v %v", applied, err)
	}
	latest, err := repo.LatestSourceMessage(t.Context(), "jid:1234@s.whatsapp.net")
	if err != nil || latest.Text != "Corrected synthetic statement" || !latest.Timestamp.Equal(stamp) {
		t.Fatalf("wrong live projection %+v %v", latest, err)
	}
	p.Type = waE2E.ProtocolMessage_REVOKE.Enum()
	p.EditedMessage = nil
	if applied, err := live.ingestMessage(t.Context(), event, "", false); err != nil || !applied {
		t.Fatalf("live deletion=%v %v", applied, err)
	}
	latest, err = repo.LatestSourceMessage(t.Context(), "jid:1234@s.whatsapp.net")
	if err != nil || latest.Kind != domain.MessageDeleted || latest.Text != "" {
		t.Fatalf("live deletion missing %+v %v", latest, err)
	}
	event, p = syntheticEditEvent()
	p.Key.ID = nil
	if applied, err := live.ingestMessage(t.Context(), event, "", false); err == nil || applied {
		t.Fatal("malformed live edit accepted")
	}
	stampState, err := repo.ConversationRevision(t.Context(), "jid:1234@s.whatsapp.net")
	if err != nil || stampState.UnresolvedCount != 1 {
		t.Fatalf("malformed event not quarantined %+v %v", stampState, err)
	}
	if service.SendAvailable(t.Context()) {
		t.Fatal("ingestion enabled sending")
	}
}

func TestProtocolRevisionGroupUsesOriginalAuthorAndOwnerMentionEvidence(t *testing.T) {
	event, p := syntheticEditEvent()
	group := types.NewJID("120363000", types.GroupServer)
	owner := types.NewJID("111", types.DefaultUserServer)
	event.Info.Chat = group
	event.Info.IsGroup = true
	p.Key.RemoteJID = proto.String(group.String())
	p.Key.Participant = proto.String(event.Info.Sender.String())
	p.EditedMessage.ExtendedTextMessage.ContextInfo.MentionedJID = []string{owner.String()}
	input, matched, err := NormalizeProtocolRevision(event, owner)
	if err != nil || !matched || input.MentionsOwner == nil || !*input.MentionsOwner || input.FromMe || input.SenderAliases[0] != event.Info.Sender.String() {
		t.Fatalf("wrong group sender/mention %+v %v", input, err)
	}
	p.Key.Participant = proto.String("other-author@s.whatsapp.net")
	if _, matched, err = NormalizeProtocolRevision(event, owner); !matched || err == nil {
		t.Fatal("unverified admin/other-author rewrite accepted")
	}
}

func TestProtocolRevisionHistoryDoesNotInventRevisionClockFromOriginalDate(t *testing.T) {
	event, p := syntheticEditEvent()
	p.TimestampMS = nil
	event.Info.ID = "original"
	event.Message = p.EditedMessage
	event.IsEdit = true
	input, matched, err := NormalizeProtocolRevision(event)
	if err != nil || !matched || input.TimestampKnown || !input.SourceTimestamp.IsZero() {
		t.Fatalf("original date reused as edit clock %+v %v", input, err)
	}
}
