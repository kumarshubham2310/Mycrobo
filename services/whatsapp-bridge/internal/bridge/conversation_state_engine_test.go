package bridge_test

import (
	"testing"
	"time"

	"mycrobo/whatsapp-bridge/internal/conversationstate"
	"mycrobo/whatsapp-bridge/internal/domain"
)

func stateEvent(sequence int64, id, text string, fromMe bool, when time.Time) domain.MessageEvent {
	message := domain.Message{ID: id, SourceMessageID: id, ChatID: "chat", SenderID: domain.CanonicalID("person"), FromMe: fromMe, Kind: domain.MessageText, Text: text, Timestamp: when, TimestampKnown: true}
	event := domain.NewObservedMessageEvent(message, when.Add(time.Minute))
	event.Sequence = sequence
	return event
}

// This integration-level mirror ensures the reducer executes on Windows hosts
// where Application Control permits the established bridge test binary but
// blocks a newly named conversationstate.test.exe after compilation.
func TestConversationStateEngineSafetyRegressions(t *testing.T) {
	base := time.Date(2026, 8, 26, 8, 0, 0, 0, time.UTC)
	state, err := conversationstate.Reduce("chat", []domain.MessageEvent{
		stateEvent(1, "latest", "Can you send the final report?", false, base.Add(3*time.Hour)),
		stateEvent(2, "question", "Where should we meet?", true, base),
		stateEvent(3, "answer", "At the office", false, base.Add(time.Hour)),
		stateEvent(4, "promise", "I will send it tomorrow morning", true, base.Add(2*time.Hour)),
	}, base.Add(4*time.Hour))
	if err != nil || state.LatestMessageID != "latest" || state.ConversationStatus != "awaiting_owner" || len(state.Commitments) != 1 {
		t.Fatalf("chronological state failed: state=%#v err=%v", state, err)
	}

	requestState, err := conversationstate.Reduce("chat", []domain.MessageEvent{
		stateEvent(1, "request", "Can you confirm 4 pm today?", false, base),
	}, base.Add(time.Hour))
	if err != nil || len(requestState.Commitments) != 0 || len(requestState.OpenQuestions) != 1 {
		t.Fatalf("incoming request became a commitment: state=%#v err=%v", requestState, err)
	}

	original := stateEvent(1, "m1", "Where are you?", false, base)
	edited := stateEvent(2, "m1", "I reached home", false, base.Add(time.Minute))
	edited.ID, edited.Type, edited.SupersedesEventID = "edited:m1:1", domain.MessageEdited, original.ID
	deleted := edited
	deleted.Sequence, deleted.ID, deleted.Type, deleted.SupersedesEventID = 3, "deleted:m1:1", domain.MessageRemoved, edited.ID
	rebuilt, err := conversationstate.Reduce("chat", []domain.MessageEvent{original, edited, deleted}, base.Add(3*time.Minute))
	if err != nil || rebuilt.CurrentTopic != nil || rebuilt.LatestMessageID != "" {
		t.Fatalf("deleted evidence survived rebuild: state=%#v err=%v", rebuilt, err)
	}
}
