package whatsmeowadapter

import (
	"testing"
	"time"

	"mycrobo/whatsapp-bridge/internal/domain"
)

func TestNormalizeKeepsLatestTextAndArchiveIdentity(t *testing.T) {
	stamp := time.Date(2026, 8, 22, 9, 30, 0, 0, time.UTC)
	event, err := Normalize(RawMessage{ID: "m1", ChatJID: "9199@s.whatsapp.net", ChatLID: "chat@lid", SenderLID: "abc@lid", SenderPhone: "9199", ChatTitle: "Sakshi", Archived: true, Type: "conversation", Text: "Is it raining?", Timestamp: stamp, TimestampKnown: true})
	if err != nil {
		t.Fatal(err)
	}
	if event.Message.Text != "Is it raining?" || !event.Message.Replyable || event.Message.Kind != domain.MessageText || !event.Chat.Archived || !event.Message.Timestamp.Equal(stamp) || event.ChatIdentity.LID != "chat@lid" || event.SenderIdentity.LID != "abc@lid" {
		t.Fatalf("event=%#v", event)
	}
}
func TestNormalizeDoesNotPromoteWhatsAppChromeToMessage(t *testing.T) {
	for _, v := range []RawMessage{{ID: "1", ChatJID: "c", Type: "document", Text: "PDF Wedding Invitation.pdf 5 pages PDF 2 MB", TimestampKnown: true}, {ID: "2", ChatJID: "c", Type: "protocol_revoke", Text: "You deleted this message", TimestampKnown: true}, {ID: "3", ChatJID: "c", Type: "system", Text: "77 KB", TimestampKnown: false}, {ID: "4", ChatJID: "c", Type: "call", Text: "Missed voice call Click to call back", TimestampKnown: true}} {
		event, err := Normalize(v)
		if err != nil {
			t.Fatal(err)
		}
		if event.Message.Replyable || event.Message.Kind == domain.MessageText {
			t.Fatalf("promoted %#v", event.Message)
		}
	}
}
