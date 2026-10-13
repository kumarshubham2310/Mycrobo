package bridge_test

import (
	"testing"
	"time"

	"mycrobo/whatsapp-bridge/internal/bridge"
	"mycrobo/whatsapp-bridge/internal/domain"
	"mycrobo/whatsapp-bridge/internal/store"
)

type revisionPublisher struct{ events []bridge.Event }

func (p *revisionPublisher) Publish(event bridge.Event) { p.events = append(p.events, event) }

func TestProtocolRevisionRefreshesStoryAndPublishesUpdateWithoutSending(t *testing.T) {
	repo := store.NewMemory()
	publisher := &revisionPublisher{}
	service := bridge.New(repo, nil, publisher, false)
	stamp := time.Date(2026, 8, 1, 9, 0, 0, 0, time.UTC)
	original := domain.IncomingEvent{ChatIdentity: domain.Identity{PhoneJID: "1234@s.whatsapp.net"}, SenderIdentity: domain.Identity{PhoneJID: "1234@s.whatsapp.net"}, Chat: domain.Chat{ID: "1234@s.whatsapp.net", Title: "Synthetic"}, Message: domain.Message{ID: "m", SourceMessageID: "m", Kind: domain.MessageText, Text: "Please review document A?", Timestamp: stamp, TimestampKnown: true, Replyable: true}}
	if _, err := service.Ingest(t.Context(), original); err != nil {
		t.Fatal(err)
	}
	input := domain.ProtocolRevision{TargetSourceMessageID: "m", ChatAliases: []string{"1234@s.whatsapp.net"}, SenderAliases: []string{"1234@s.whatsapp.net"}, Type: domain.MessageEdited, Kind: domain.MessageText, Text: "Please review document B?", SourceTimestamp: stamp.Add(time.Hour), TimestampKnown: true}
	if applied, err := service.ApplyProtocolRevision(t.Context(), input); err != nil || !applied {
		t.Fatalf("edit=%v %v", applied, err)
	}
	state, err := service.ConversationState(t.Context(), "jid:1234@s.whatsapp.net")
	if err != nil || state.LatestMessageID != "m" {
		t.Fatalf("state not refreshed: %+v %v", state, err)
	}
	if state.CurrentTopic == nil || state.CurrentTopic.Provenance.OriginalWording != "Please review document B?" {
		t.Fatalf("old fact survived: %+v", state.CurrentTopic)
	}
	input.Type = domain.MessageRemoved
	input.Kind = domain.MessageDeleted
	input.Text = ""
	if applied, err := service.ApplyProtocolRevision(t.Context(), input); err != nil || !applied {
		t.Fatalf("delete=%v %v", applied, err)
	}
	state, err = service.ConversationState(t.Context(), "jid:1234@s.whatsapp.net")
	if err != nil || state.LatestMessageID != "" || state.CurrentTopic != nil {
		t.Fatalf("deleted story remains live: %+v %v", state, err)
	}
	if len(publisher.events) != 3 || publisher.events[1].Type != "message.updated" || publisher.events[2].Type != "message.updated" || service.SendAvailable(t.Context()) {
		t.Fatal("wrong event route or send capability")
	}
}
