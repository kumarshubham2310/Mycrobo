package conversationstate_test

import (
	"testing"
	"time"

	"mycrobo/whatsapp-bridge/internal/conversationstate"
	"mycrobo/whatsapp-bridge/internal/domain"
)

func observed(sequence int64, id, text string, fromMe bool, when time.Time) domain.MessageEvent {
	message := domain.Message{ID: id, SourceMessageID: id, ChatID: "chat", SenderID: domain.CanonicalID("person"), FromMe: fromMe, Kind: domain.MessageText, Text: text, Timestamp: when, TimestampKnown: true}
	event := domain.NewObservedMessageEvent(message, when.Add(time.Minute))
	event.Sequence = sequence
	return event
}

func TestReduceBuildsStoryStateInMessageTimeOrder(t *testing.T) {
	base := time.Date(2026, 8, 26, 8, 0, 0, 0, time.UTC)
	// Provider history can arrive newest-first. State must follow message time,
	// not ingestion order.
	events := []domain.MessageEvent{
		observed(1, "latest", "Can you send the final report?", false, base.Add(3*time.Hour)),
		observed(2, "question", "Where should we meet?", true, base),
		observed(3, "answer", "At the office", false, base.Add(time.Hour)),
		observed(4, "promise", "I will send it tomorrow morning", true, base.Add(2*time.Hour)),
	}
	state, err := conversationstate.Reduce("chat", events, base.Add(4*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if state.LatestMessageID != "latest" || state.LatestIntent != "request" || state.ConversationStatus != "awaiting_owner" {
		t.Fatalf("wrong latest state: %#v", state)
	}
	if len(state.OpenQuestions) != 1 || state.OpenQuestions[0].Provenance.SourceMessageID != "latest" {
		t.Fatalf("open questions did not preserve story: %#v", state.OpenQuestions)
	}
	if len(state.Commitments) != 1 || !state.Commitments[0].ActorIsOwner || state.Commitments[0].Provenance.SourceMessageID != "promise" {
		t.Fatalf("owner commitment missing: %#v", state.Commitments)
	}
	if state.CurrentTopic == nil || state.CurrentTopic.Provenance.SourceMessageID != "latest" {
		t.Fatalf("topic provenance missing: %#v", state.CurrentTopic)
	}
}

func TestIncomingTimeRequestIsNotAnOwnerCommitment(t *testing.T) {
	base := time.Date(2026, 8, 26, 8, 0, 0, 0, time.UTC)
	state, err := conversationstate.Reduce("chat", []domain.MessageEvent{
		observed(1, "request", "Can you confirm 4 pm today?", false, base),
	}, base.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Commitments) != 0 {
		t.Fatalf("request was incorrectly converted to a promise: %#v", state.Commitments)
	}
	if len(state.OpenQuestions) != 1 || state.OpenQuestions[0].AskedByOwner {
		t.Fatalf("incoming question evidence missing: %#v", state.OpenQuestions)
	}
}

func TestFactsExpireAndNewEvidenceSupersedesCurrentStatus(t *testing.T) {
	base := time.Date(2026, 8, 20, 8, 0, 0, 0, time.UTC)
	state, err := conversationstate.Reduce("chat", []domain.MessageEvent{
		observed(1, "old-location", "I am at the office", false, base),
		observed(2, "new-location", "I reached home", false, base.Add(2*time.Hour)),
	}, base.Add(72*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(state.RecentFacts) != 2 || state.RecentFacts[0].Status != domain.EvidenceSuperseded || state.RecentFacts[0].SupersededByMessageID != "new-location" {
		t.Fatalf("location supersession not tracked: %#v", state.RecentFacts)
	}
	if state.RecentFacts[1].Status != domain.EvidenceExpired || state.RecentFacts[1].ExpiresAt == nil {
		t.Fatalf("temporary fact did not expire: %#v", state.RecentFacts[1])
	}
	if state.RecentFacts[1].Provenance.SafeToRepeat {
		t.Fatal("message-derived facts must default to unsafe-to-repeat")
	}
}

func TestAdvanceInvalidatesEditedAndDeletedEvidence(t *testing.T) {
	base := time.Date(2026, 8, 26, 8, 0, 0, 0, time.UTC)
	original := observed(1, "m1", "Where are you?", false, base)
	state := domain.ConversationState{ChatID: "chat", Version: conversationstate.StateVersion, OpenQuestions: []domain.ConversationQuestion{}, Commitments: []domain.ConversationCommitment{}, RecentFacts: []domain.ConversationFact{}, ConversationStatus: "empty"}
	state, err := conversationstate.Advance(state, []domain.MessageEvent{original}, base.Add(time.Minute))
	if err != nil || len(state.OpenQuestions) != 1 {
		t.Fatalf("initial advance: state=%#v err=%v", state, err)
	}
	edited := observed(2, "m1", "I reached home", false, base.Add(time.Minute))
	edited.ID = "edited:m1:1"
	edited.Type = domain.MessageEdited
	edited.SupersedesEventID = original.ID
	state, err = conversationstate.Advance(state, []domain.MessageEvent{edited}, base.Add(2*time.Minute))
	if err != nil || len(state.OpenQuestions) != 0 || state.CurrentTopic == nil || state.CurrentTopic.Text != "I reached home" {
		t.Fatalf("edit was not materialized: state=%#v err=%v", state, err)
	}
	deleted := edited
	deleted.Sequence = 3
	deleted.ID = "deleted:m1:1"
	deleted.Type = domain.MessageRemoved
	deleted.SupersedesEventID = edited.ID
	if _, err = conversationstate.Advance(state, []domain.MessageEvent{deleted}, base.Add(3*time.Minute)); err != conversationstate.ErrRebuildRequired {
		t.Fatalf("latest deletion did not request an evidence rebuild: %v", err)
	}
	rebuilt, err := conversationstate.Reduce("chat", []domain.MessageEvent{original, edited, deleted}, base.Add(3*time.Minute))
	if err != nil || rebuilt.CurrentTopic != nil || rebuilt.LatestMessageID != "" {
		t.Fatalf("delete rebuild retained removed evidence: state=%#v err=%v", rebuilt, err)
	}
}

func TestAdvanceRejectsOutOfOrderHistoryBackfill(t *testing.T) {
	base := time.Date(2026, 8, 26, 8, 0, 0, 0, time.UTC)
	state := domain.ConversationState{ChatID: "chat", Version: conversationstate.StateVersion, OpenQuestions: []domain.ConversationQuestion{}, Commitments: []domain.ConversationCommitment{}, RecentFacts: []domain.ConversationFact{}, ConversationStatus: "empty"}
	state, err := conversationstate.Advance(state, []domain.MessageEvent{observed(1, "new", "Latest question?", false, base.Add(time.Hour))}, base.Add(2*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = conversationstate.Advance(state, []domain.MessageEvent{observed(2, "old", "Older history", true, base)}, base.Add(2*time.Hour)); err != conversationstate.ErrRebuildRequired {
		t.Fatalf("out-of-order backfill was accepted: %v", err)
	}
}

func TestReduceRejectsBrokenRevisionChain(t *testing.T) {
	base := time.Date(2026, 8, 26, 8, 0, 0, 0, time.UTC)
	event := observed(1, "m1", "edited", false, base)
	event.Type = domain.MessageEdited
	event.ID = "edit:m1"
	event.SupersedesEventID = "missing"
	if _, err := conversationstate.Reduce("chat", []domain.MessageEvent{event}, base); err == nil {
		t.Fatal("broken revision chain was accepted")
	}
}

func TestOwnerCommitmentsStayOpenUntilMatchingCompletionEvidence(t *testing.T) {
	base := time.Date(2026, 8, 26, 8, 0, 0, 0, time.UTC)
	state, err := conversationstate.Reduce("chat", []domain.MessageEvent{
		observed(1, "send-promise", "I will send the report tomorrow", true, base),
		observed(2, "call-promise", "I will call the vendor", true, base.Add(time.Hour)),
		observed(3, "generic", "Okay", true, base.Add(2*time.Hour)),
		observed(4, "sent", "Sent the report", true, base.Add(3*time.Hour)),
	}, base.Add(4*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Commitments) != 2 {
		t.Fatalf("expected two independently tracked commitments: %#v", state.Commitments)
	}
	if state.Commitments[0].Status != domain.EvidenceResolved || state.Commitments[0].ResolvedByMessageID != "sent" {
		t.Fatalf("send commitment was not closed by matching evidence: %#v", state.Commitments[0])
	}
	if state.Commitments[1].Status != domain.EvidenceCurrent {
		t.Fatalf("unrelated call promise was incorrectly closed: %#v", state.Commitments[1])
	}
}

func TestOtherPersonCommitmentClosesOnlyFromTheirMatchingEvidence(t *testing.T) {
	base := time.Date(2026, 8, 26, 8, 0, 0, 0, time.UTC)
	state, err := conversationstate.Reduce("chat", []domain.MessageEvent{
		observed(1, "promise", "I will check and confirm", false, base),
		observed(2, "owner-ack", "Okay", true, base.Add(time.Hour)),
		observed(3, "contact-ack", "Got it", false, base.Add(2*time.Hour)),
		observed(4, "confirmed", "Checked and confirmed", false, base.Add(3*time.Hour)),
	}, base.Add(4*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Commitments) != 1 || state.Commitments[0].Status != domain.EvidenceResolved || state.Commitments[0].ResolvedByMessageID != "confirmed" {
		t.Fatalf("other-person follow-up closure was incorrect: %#v", state.Commitments)
	}
}

func TestOneReplyDoesNotResolveEveryOpenQuestion(t *testing.T) {
	base := time.Date(2026, 8, 26, 8, 0, 0, 0, time.UTC)
	state, err := conversationstate.Reduce("chat", []domain.MessageEvent{
		observed(1, "q1", "Which option should we use?", false, base),
		observed(2, "q2", "What time should we meet?", false, base.Add(time.Minute)),
		observed(3, "answer", "Meet at 4 pm", true, base.Add(2*time.Minute)),
	}, base.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(state.OpenQuestions) != 1 || state.OpenQuestions[0].Provenance.SourceMessageID != "q1" {
		t.Fatalf("reply should resolve only the newest pending question: %#v", state.OpenQuestions)
	}
}

func TestGenericOrUnrelatedMessagesDoNotResolveADecision(t *testing.T) {
	base := time.Date(2026, 8, 26, 8, 0, 0, 0, time.UTC)
	state, err := conversationstate.Reduce("chat", []domain.MessageEvent{
		observed(1, "question", "Which plan should we choose?", false, base),
		observed(2, "ack", "Okay", true, base.Add(time.Minute)),
		observed(3, "status", "Reached office", true, base.Add(2*time.Minute)),
	}, base.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(state.OpenQuestions) != 1 || state.OpenQuestions[0].Provenance.SourceMessageID != "question" {
		t.Fatalf("generic or unrelated messages hid a decision: %#v", state.OpenQuestions)
	}
}

func TestCompletionEvidenceUsesTheCommitmentObject(t *testing.T) {
	base := time.Date(2026, 8, 26, 8, 0, 0, 0, time.UTC)
	state, err := conversationstate.Reduce("chat", []domain.MessageEvent{
		observed(1, "report-promise", "I will send the report", true, base),
		observed(2, "invoice-promise", "I will send the invoice", true, base.Add(time.Minute)),
		observed(3, "report-sent", "Sent the report", true, base.Add(2*time.Minute)),
		observed(4, "generic-done", "Done", true, base.Add(3*time.Minute)),
	}, base.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Commitments) != 2 {
		t.Fatalf("unexpected commitments: %#v", state.Commitments)
	}
	if state.Commitments[0].Status != domain.EvidenceResolved || state.Commitments[0].ResolvedByMessageID != "report-sent" {
		t.Fatalf("report commitment was not resolved by its object: %#v", state.Commitments[0])
	}
	if state.Commitments[1].Status != domain.EvidenceCurrent {
		t.Fatalf("invoice commitment was closed by foreign or generic evidence: %#v", state.Commitments[1])
	}
}

func TestQuotedReplyCanCloseTheExactQuestionAndCommitment(t *testing.T) {
	base := time.Date(2026, 8, 26, 8, 0, 0, 0, time.UTC)
	question := observed(1, "question", "Which plan should we choose?", false, base)
	answer := observed(2, "answer", "Okay", true, base.Add(time.Minute))
	answer.QuotedMessageID = "question"
	promise := observed(3, "promise", "I will send the invoice", true, base.Add(2*time.Minute))
	done := observed(4, "done", "Done", true, base.Add(3*time.Minute))
	done.QuotedMessageID = "promise"
	state, err := conversationstate.Reduce("chat", []domain.MessageEvent{question, answer, promise, done}, base.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(state.OpenQuestions) != 0 || len(state.Commitments) != 1 || state.Commitments[0].Status != domain.EvidenceResolved || state.Commitments[0].ResolvedByMessageID != "done" {
		t.Fatalf("quoted evidence did not close the exact loop: %#v", state)
	}
}

func TestWrongObjectAndQuotedAcknowledgementDoNotCloseCommitment(t *testing.T) {
	base := time.Date(2026, 8, 26, 8, 0, 0, 0, time.UTC)
	promise := observed(1, "promise", "I will send the report", true, base)
	wrong := observed(2, "wrong", "Sent the invoice", true, base.Add(time.Minute))
	ack := observed(3, "ack", "Okay", true, base.Add(2*time.Minute))
	ack.QuotedMessageID = "promise"
	quotedWrong := observed(4, "quoted-wrong", "Sent the invoice", true, base.Add(3*time.Minute))
	quotedWrong.QuotedMessageID = "promise"
	state, err := conversationstate.Reduce("chat", []domain.MessageEvent{promise, wrong, ack, quotedWrong}, base.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Commitments) != 1 || state.Commitments[0].Status != domain.EvidenceCurrent {
		t.Fatalf("wrong object or quoted acknowledgement closed commitment: %#v", state.Commitments)
	}
}

func TestAnaphoricCommitmentClosesRequestAndCarriesItsObject(t *testing.T) {
	base := time.Date(2026, 8, 26, 8, 0, 0, 0, time.UTC)
	state, err := conversationstate.Reduce("chat", []domain.MessageEvent{
		observed(1, "request", "Can you send the report?", false, base),
		observed(2, "promise", "I'll send it", true, base.Add(time.Minute)),
		observed(3, "wrong", "Sent the invoice", true, base.Add(2*time.Minute)),
		observed(4, "right", "Sent the report", true, base.Add(3*time.Minute)),
	}, base.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(state.OpenQuestions) != 0 {
		t.Fatalf("anaphoric answer left the directly preceding request open: %#v", state.OpenQuestions)
	}
	if len(state.Commitments) != 1 || state.Commitments[0].SourceRequestMessageID != "request" || len(state.Commitments[0].ObjectTerms) != 1 || state.Commitments[0].ObjectTerms[0] != "report" {
		t.Fatalf("request object was not bound to the owner commitment: %#v", state.Commitments)
	}
	if state.Commitments[0].Status != domain.EvidenceResolved || state.Commitments[0].ResolvedByMessageID != "right" {
		t.Fatalf("wrong object closed the anaphoric commitment: %#v", state.Commitments[0])
	}
}

func TestBoundedChoiceLabelResolvesButChoiceStatusDoesNot(t *testing.T) {
	base := time.Date(2026, 8, 26, 8, 0, 0, 0, time.UTC)
	chosen, err := conversationstate.Reduce("chat", []domain.MessageEvent{
		observed(1, "question", "Which plan should we choose?", false, base),
		observed(2, "answer", "Plan B", true, base.Add(time.Minute)),
	}, base.Add(time.Hour))
	if err != nil || len(chosen.OpenQuestions) != 0 {
		t.Fatalf("bounded choice label did not resolve the choice: state=%#v err=%v", chosen.OpenQuestions, err)
	}
	unresolved, err := conversationstate.Reduce("chat", []domain.MessageEvent{
		observed(1, "question", "Which plan should we choose?", false, base),
		observed(2, "status", "The plan is delayed", true, base.Add(time.Minute)),
	}, base.Add(time.Hour))
	if err != nil || len(unresolved.OpenQuestions) != 1 {
		t.Fatalf("choice status incorrectly resolved the choice: state=%#v err=%v", unresolved.OpenQuestions, err)
	}
}

func TestObjectlessCommitmentRejectsAnIntroducedCompletionObject(t *testing.T) {
	base := time.Date(2026, 8, 26, 8, 0, 0, 0, time.UTC)
	state, err := conversationstate.Reduce("chat", []domain.MessageEvent{
		observed(1, "promise", "I will send it", true, base),
		observed(2, "wrong", "Sent the invoice", true, base.Add(time.Minute)),
	}, base.Add(time.Hour))
	if err != nil || len(state.Commitments) != 1 || state.Commitments[0].Status != domain.EvidenceCurrent {
		t.Fatalf("introduced object closed an objectless commitment: state=%#v err=%v", state.Commitments, err)
	}
}

func TestSharedChoiceNounWithoutDecisionDoesNotResolveQuestion(t *testing.T) {
	base := time.Date(2026, 8, 26, 8, 0, 0, 0, time.UTC)
	state, err := conversationstate.Reduce("chat", []domain.MessageEvent{
		observed(1, "question", "Which plan should we choose?", false, base),
		observed(2, "unrelated", "The plan is delayed", true, base.Add(time.Minute)),
	}, base.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(state.OpenQuestions) != 1 {
		t.Fatalf("shared noun without a decision closed the question: %#v", state.OpenQuestions)
	}
}

func TestAdvanceRequiresRebuildForOlderStateSemantics(t *testing.T) {
	state := domain.ConversationState{ChatID: "chat", Version: 1}
	if _, err := conversationstate.Advance(state, nil, time.Now()); err != conversationstate.ErrRebuildRequired {
		t.Fatalf("old reducer state was not rejected for rebuild: %v", err)
	}
}
