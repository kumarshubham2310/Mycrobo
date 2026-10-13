// Package conversationstate reduces immutable connector evidence into a small,
// explainable conversation snapshot. It deliberately does not generate text.
package conversationstate

import (
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"mycrobo/whatsapp-bridge/internal/domain"
)

var ErrRebuildRequired = errors.New("conversation state rebuild required")

// StateVersion is incremented whenever evidence reduction semantics change.
// Persisted snapshots from an older version are rebuilt from the immutable
// event journal instead of silently retaining outdated task/decision logic.
const StateVersion int64 = 2

var (
	questionPattern     = regexp.MustCompile(`(?i)(\?|\b(?:what|when|where|who|why|how|which|can you|could you|will you|do you|are you|please|pls|plz|kya|kab|kahan|kaun|kyu|kaise|batao|bata|bhej|moklo|janavjo)\b)`)
	requestPattern      = regexp.MustCompile(`(?i)\b(?:please|pls|plz|send|share|check|review|confirm|update|call|reply|batao|bata|bhej|moklo|janavjo|kar do|kar dena)\b`)
	commitmentPattern   = regexp.MustCompile(`(?i)\b(?:i will|i'll|we will|we'll|let me|kar(?:ta|ti|unga|ungi) hu|kar d(?:unga|ungi)|bata d(?:unga|ungi)|bhej d(?:unga|ungi)|confirm kar(?:ta|ti|unga|ungi)|de d(?:unga|ungi)|aa ja(?:unga|ungi)|pahunch ja(?:unga|ungi))\b`)
	cancelPattern       = regexp.MustCompile(`(?i)\b(?:cannot|can't|won't|will not|nahi kar|nahin kar|cancel|not possible|possible nahi|possible nahin)\b`)
	temporalPattern     = regexp.MustCompile(`(?i)\b(?:today|tomorrow|tonight|morning|afternoon|evening|kal|aaj|subah|shaam|baje|am|pm)\b|\b\d{1,2}[:.]\d{2}\b`)
	locationPattern     = regexp.MustCompile(`(?i)\b(?:at|in|near|reached|arrived|leaving|left|office|home|ghar|nikal|pahunch|location|where are you|kahan)\b`)
	availabilityPat     = regexp.MustCompile(`(?i)\b(?:available|free|busy|occupied|call me|can talk|availability|time milega|free hu|free ho)\b`)
	statusPattern       = regexp.MustCompile(`(?i)\b(?:done|pending|completed|finished|started|working on|update|status|ho gaya|ho gya|baaki|baki)\b`)
	genericCompletion   = regexp.MustCompile(`(?i)\b(?:done|completed|finished|ho gaya|ho gya|kar diya|kar di|thai gayu|thai gayo)\b`)
	genericAckPattern   = regexp.MustCompile(`(?i)^(?:ok(?:ay)?|got it|noted|thanks?|thank you|haan|han|hmm+|yep|sure|thik hai|theek hai)[.! ]*$`)
	yesNoAnswerPattern  = regexp.MustCompile(`(?i)^(?:yes|no|approved|approve|rejected|reject|agreed|agree|possible|not possible|nahi|nahin)[.! ]*$`)
	choiceAnswerPattern = regexp.MustCompile(`(?i)\b(?:choose|use|take|select|pick|go with|let'?s)\b`)
	choiceLabelPattern  = regexp.MustCompile(`(?i)^(?:plan|option|choice)\s+[a-z0-9][a-z0-9._-]{0,20}[.! ]*$`)
	anaphoricRefPattern = regexp.MustCompile(`(?i)\b(?:it|that|this|them|those|same)\b`)
	locationAnswerPat   = regexp.MustCompile(`(?i)(?:^(?:at|near|in)\s+\S|\b(?:reached|arrived|office|home|ghar|location|address|pahunch)\b)`)
	tokenSplitPattern   = regexp.MustCompile(`[^\p{L}\p{N}]+`)
	controlPattern      = regexp.MustCompile(`(?i)^(?:you deleted this message|this message was deleted|missed (?:voice|video) call|messages and calls are end-to-end encrypted)`)
)

var evidenceStopWords = map[string]bool{
	"a": true, "an": true, "and": true, "are": true, "at": true, "be": true, "can": true, "could": true,
	"do": true, "for": true, "from": true, "i": true, "in": true, "is": true, "it": true, "me": true,
	"my": true, "of": true, "on": true, "or": true, "our": true, "please": true, "should": true, "the": true,
	"them": true, "this": true, "to": true, "tomorrow": true, "today": true, "we": true, "what": true,
	"when": true, "where": true, "which": true, "will": true, "with": true, "you": true, "your": true,
	"send": true, "sent": true, "share": true, "shared": true, "check": true, "checked": true,
	"confirm": true, "confirmed": true, "call": true, "called": true, "done": true, "complete": true,
	"completed": true, "finish": true, "finished": true, "prepare": true, "prepared": true,
	"bhej": true, "diya": true, "kar": true, "dunga": true, "dungi": true, "hu": true, "hai": true,
}

var commitmentActions = []struct {
	kind       string
	promise    *regexp.Regexp
	completion *regexp.Regexp
}{
	{"send_share", regexp.MustCompile(`(?i)\b(?:send|share|forward|email|message|upload|provide|give|bring|bhej|mokl)\w*\b`), regexp.MustCompile(`(?i)\b(?:sent|shared|forwarded|emailed|messaged|uploaded|provided|gave|brought|bhej diya|bhej di|bhej d(?:iya|i)|mokli didh|mokli aap)\w*\b`)},
	{"check_confirm", regexp.MustCompile(`(?i)\b(?:check|confirm|verify|find|find out|look into|bata|janav)\w*\b`), regexp.MustCompile(`(?i)\b(?:checked|confirmed|verified|found|looked into|pata kar liya|check kar liya|confirm kar diya|bata diya|janavi didh)\w*\b`)},
	{"call", regexp.MustCompile(`(?i)\b(?:call|phone|ring)\w*\b`), regexp.MustCompile(`(?i)\b(?:called|phoned|rang|call kar liya|call kiya)\b`)},
	{"pay", regexp.MustCompile(`(?i)\b(?:pay|payment|transfer)\w*\b`), regexp.MustCompile(`(?i)\b(?:paid|payment done|transferred|pay kar diya)\b`)},
	{"submit", regexp.MustCompile(`(?i)\b(?:submit|file|apply|deliver)\w*\b`), regexp.MustCompile(`(?i)\b(?:submitted|filed|applied|delivered|jama kar diya)\b`)},
	{"prepare", regexp.MustCompile(`(?i)\b(?:prepare|complete|finish|draft|finali[sz]e|make|create)\w*\b`), regexp.MustCompile(`(?i)\b(?:prepared|completed|finished|drafted|finali[sz]ed|made|created|ready|bana diya)\b`)},
	{"schedule", regexp.MustCompile(`(?i)\b(?:schedule|book|arrange)\w*\b`), regexp.MustCompile(`(?i)\b(?:scheduled|booked|arranged)\b`)},
	{"attend", regexp.MustCompile(`(?i)\b(?:attend|join|visit|come|arrive|aa ja|pahunch)\w*\b`), regexp.MustCompile(`(?i)\b(?:attended|joined|visited|came|arrived|aa gaya|aa gayi|pahunch gaya|pahunch gayi)\b`)},
	{"review", regexp.MustCompile(`(?i)\b(?:review|approve|sign|audit|reconcile)\w*\b`), regexp.MustCompile(`(?i)\b(?:reviewed|approved|signed|audited|reconciled)\b`)},
	{"fix", regexp.MustCompile(`(?i)\b(?:fix|repair|install|resolve)\w*\b`), regexp.MustCompile(`(?i)\b(?:fixed|repaired|installed|resolved)\b`)},
	{"buy", regexp.MustCompile(`(?i)\b(?:buy|purchase|renew|order)\w*\b`), regexp.MustCompile(`(?i)\b(?:bought|purchased|renewed|ordered)\b`)},
}

type materializedMessage struct {
	event domain.MessageEvent
	gone  bool
}

// Reduce rebuilds a deterministic snapshot from the journal. Rebuilding from
// immutable evidence makes recovery and cross-device validation straightforward;
// the ReducedThroughSequence cursor supports incremental persistence later.
func Reduce(chatID string, events []domain.MessageEvent, now time.Time) (domain.ConversationState, error) {
	if strings.TrimSpace(chatID) == "" {
		return domain.ConversationState{}, fmt.Errorf("conversation state requires a chat id")
	}
	ordered := append([]domain.MessageEvent(nil), events...)
	sort.SliceStable(ordered, func(i, j int) bool {
		if ordered[i].Sequence == ordered[j].Sequence {
			return ordered[i].ID < ordered[j].ID
		}
		return ordered[i].Sequence < ordered[j].Sequence
	})
	seenEvents := make(map[string]domain.MessageEvent, len(ordered))
	messages := make(map[string]materializedMessage)
	var through int64
	for _, event := range ordered {
		if event.ChatID != chatID {
			return domain.ConversationState{}, fmt.Errorf("event %s belongs to another chat", event.ID)
		}
		if err := event.Validate(); err != nil {
			return domain.ConversationState{}, fmt.Errorf("event %s: %w", event.ID, err)
		}
		if _, duplicate := seenEvents[event.ID]; duplicate {
			return domain.ConversationState{}, fmt.Errorf("duplicate message event id %s", event.ID)
		}
		if event.Type != domain.MessageObserved {
			prior, exists := seenEvents[event.SupersedesEventID]
			if !exists || prior.MessageID != event.MessageID {
				return domain.ConversationState{}, fmt.Errorf("event %s has an invalid supersession chain", event.ID)
			}
		}
		seenEvents[event.ID] = event
		current := materializedMessage{event: event, gone: event.Type == domain.MessageRemoved}
		messages[event.MessageID] = current
		if event.Sequence > through {
			through = event.Sequence
		}
	}

	active := make([]domain.MessageEvent, 0, len(messages))
	for _, message := range messages {
		if !message.gone && meaningful(message.event) {
			active = append(active, message.event)
		}
	}
	sort.SliceStable(active, func(i, j int) bool {
		left, right := active[i], active[j]
		if left.TimestampKnown != right.TimestampKnown {
			return left.TimestampKnown
		}
		if left.TimestampKnown && !left.OccurredAt.Equal(right.OccurredAt) {
			return left.OccurredAt.Before(right.OccurredAt)
		}
		return left.Sequence < right.Sequence
	})

	state := domain.ConversationState{
		ChatID:                 chatID,
		Version:                StateVersion,
		ReducedThroughSequence: through,
		OpenQuestions:          []domain.ConversationQuestion{},
		Commitments:            []domain.ConversationCommitment{},
		RecentFacts:            []domain.ConversationFact{},
		ConversationStatus:     "empty",
		UpdatedAt:              now.UTC(),
	}
	if len(active) == 0 {
		return state, nil
	}

	for _, event := range active {
		applyActiveEvent(&state, event)
	}

	for index := range state.Commitments {
		item := &state.Commitments[index]
		if item.Status == domain.EvidenceCurrent && item.ExpiresAt != nil && !now.Before(*item.ExpiresAt) {
			item.Status = domain.EvidenceExpired
		}
	}
	for index := range state.RecentFacts {
		item := &state.RecentFacts[index]
		if item.Status == domain.EvidenceCurrent && item.ExpiresAt != nil && !now.Before(*item.ExpiresAt) {
			item.Status = domain.EvidenceExpired
		}
	}
	state.OpenQuestions = currentQuestions(state.OpenQuestions)
	state.Commitments = tailCommitments(state.Commitments, 40)
	state.RecentFacts = tailFacts(state.RecentFacts, 80)
	latest := active[len(active)-1]
	if latest.FromMe {
		state.ConversationStatus = "awaiting_contact"
	} else {
		state.ConversationStatus = "awaiting_owner"
	}
	return state, nil
}

// Advance applies journal entries newer than a persisted snapshot cursor.
// It is the normal ingestion path; Reduce is retained for recovery, audits and
// rebuilding after storage migrations.
func Advance(previous domain.ConversationState, events []domain.MessageEvent, now time.Time) (domain.ConversationState, error) {
	if strings.TrimSpace(previous.ChatID) == "" {
		return domain.ConversationState{}, fmt.Errorf("previous conversation state requires a chat id")
	}
	state := previous
	if previous.Version != StateVersion {
		return domain.ConversationState{}, ErrRebuildRequired
	}
	state.Version = StateVersion
	ordered := append([]domain.MessageEvent(nil), events...)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].Sequence < ordered[j].Sequence })
	for _, event := range ordered {
		if event.ChatID != state.ChatID {
			return domain.ConversationState{}, fmt.Errorf("event %s belongs to another chat", event.ID)
		}
		if err := event.Validate(); err != nil {
			return domain.ConversationState{}, fmt.Errorf("event %s: %w", event.ID, err)
		}
		if event.Sequence <= state.ReducedThroughSequence {
			continue
		}
		// History backfill is commonly delivered newest-first. Applying an older
		// observation on top of a newer snapshot would corrupt latest state and
		// question resolution, so ask the caller to rebuild in message-time order.
		if state.CurrentTopic != nil && event.TimestampKnown && state.CurrentTopic.Provenance.TimestampKnown && event.OccurredAt.Before(state.CurrentTopic.Provenance.OccurredAt) {
			return domain.ConversationState{}, ErrRebuildRequired
		}
		// Removing the current topic requires the prior journal to determine the
		// new latest message; a snapshot alone intentionally cannot guess it.
		if event.Type == domain.MessageRemoved && state.CurrentTopic != nil && state.CurrentTopic.Provenance.SourceEventID == event.SupersedesEventID {
			return domain.ConversationState{}, ErrRebuildRequired
		}
		if event.Type != domain.MessageObserved {
			invalidateEvidence(&state, event.SupersedesEventID, event.MessageID)
		}
		if event.Type != domain.MessageRemoved && meaningful(event) {
			applyActiveEvent(&state, event)
		}
		state.ReducedThroughSequence = event.Sequence
	}
	finalize(&state, now)
	return state, nil
}

func applyActiveEvent(state *domain.ConversationState, event domain.MessageEvent) {
	text := clean(event.OriginalText)
	state.LatestIntent = classifyIntent(text, event.FromMe)
	state.LatestMessageID = event.MessageID
	provenance := provenance(event)
	var answeredQuestion *domain.ConversationQuestion
	// A reply can close only the newest opposite-speaker question for which the
	// event is either an explicit quoted reply or contains compatible answer
	// evidence. A generic acknowledgement or unrelated status update must never
	// hide a real pending decision.
	if !isQuestion(text) {
		for index := len(state.OpenQuestions) - 1; index >= 0; index-- {
			question := &state.OpenQuestions[index]
			if question.Status != domain.EvidenceCurrent || question.AskedByOwner == event.FromMe || !eventAfter(event, question.Provenance) {
				continue
			}
			// Only the directly preceding unresolved question is eligible. If this
			// reply does not answer it, do not reach backward and close an older loop.
			if answerSupportsQuestion(*question, event, text) {
				question.Status = domain.EvidenceResolved
				question.ResolvedByMessageID = event.MessageID
				answeredQuestion = question
			}
			break
		}
	}
	if isQuestion(text) {
		state.OpenQuestions = append(state.OpenQuestions, domain.ConversationQuestion{ID: "question:" + event.ID, Question: text, AskedByOwner: event.FromMe, Status: domain.EvidenceCurrent, Provenance: provenance})
	}
	resolveCommitmentsByEvidence(state, event, text)
	if commitmentPattern.MatchString(text) && !isQuestion(text) {
		// Commitments remain open until matching completion/cancellation evidence
		// arrives. A later unrelated promise from the same speaker must not erase
		// an earlier open loop.
		commitment := domain.ConversationCommitment{ID: "commitment:" + event.ID, ActorIsOwner: event.FromMe, Action: text, Status: domain.EvidenceCurrent, Provenance: provenance}
		if answeredQuestion != nil && actionKind(answeredQuestion.Question, false) == actionKind(text, false) {
			commitment.SourceRequestMessageID = answeredQuestion.Provenance.SourceMessageID
			commitment.ObjectTerms = sortedSignificantTokens(answeredQuestion.Question)
		}
		for index := range state.Commitments {
			prior := &state.Commitments[index]
			if prior.Status == domain.EvidenceCurrent && prior.ActorIsOwner == commitment.ActorIsOwner && sameCommitment(prior.Action, commitment.Action) {
				prior.Status = domain.EvidenceSuperseded
				prior.SupersededByMessageID = event.MessageID
			}
		}
		state.Commitments = append(state.Commitments, commitment)
	} else if cancelPattern.MatchString(text) {
		cancelMatchingCommitment(state, event, text)
	}
	if !isQuestion(text) {
		category := factCategory(text)
		fact := domain.ConversationFact{ID: "fact:" + event.ID, Category: category, Fact: text, Status: domain.EvidenceCurrent, Provenance: provenance, ExpiresAt: expiryFor(text, event.OccurredAt)}
		if category != "statement" {
			for index := range state.RecentFacts {
				prior := &state.RecentFacts[index]
				if prior.Status == domain.EvidenceCurrent && prior.Category == category && prior.Provenance.FromMe == event.FromMe {
					prior.Status = domain.EvidenceSuperseded
					prior.SupersededByMessageID = event.MessageID
				}
			}
		}
		state.RecentFacts = append(state.RecentFacts, fact)
	}
	state.CurrentTopic = &domain.ConversationTopic{Text: truncate(text, 180), Provenance: provenance}
	if event.FromMe {
		state.ConversationStatus = "awaiting_contact"
	} else {
		state.ConversationStatus = "awaiting_owner"
	}
}

func actionKind(text string, completion bool) string {
	for _, action := range commitmentActions {
		pattern := action.promise
		if completion {
			pattern = action.completion
		}
		if pattern.MatchString(text) {
			return action.kind
		}
	}
	return ""
}

func significantTokens(text string) map[string]bool {
	out := map[string]bool{}
	for _, token := range tokenSplitPattern.Split(strings.ToLower(clean(text)), -1) {
		if len([]rune(token)) < 2 || evidenceStopWords[token] {
			continue
		}
		out[token] = true
	}
	return out
}

func sortedSignificantTokens(text string) []string {
	tokens := significantTokens(text)
	out := make([]string, 0, len(tokens))
	for token := range tokens {
		out = append(out, token)
	}
	sort.Strings(out)
	return out
}

func commitmentObjectTokens(item domain.ConversationCommitment) map[string]bool {
	out := significantTokens(item.Action)
	for _, token := range item.ObjectTerms {
		token = strings.ToLower(clean(token))
		if token != "" {
			out[token] = true
		}
	}
	return out
}

func tokenSetOverlap(left, right map[string]bool) int {
	score := 0
	for token := range left {
		if right[token] {
			score++
		}
	}
	return score
}

func tokenOverlap(left, right string) int {
	return tokenSetOverlap(significantTokens(left), significantTokens(right))
}

func questionKind(text string) string {
	lower := strings.ToLower(text)
	switch {
	case regexp.MustCompile(`\b(?:what time|when|kab|kitne baje|ketla vagye)\b`).MatchString(lower):
		return "time"
	case regexp.MustCompile(`\b(?:where|kahan|kya jagah|which place|location)\b`).MatchString(lower):
		return "location"
	case regexp.MustCompile(`\b(?:approve|approval|agree|consent|permission)\b`).MatchString(lower):
		return "approval"
	case regexp.MustCompile(`\b(?:which|option|choose|what should|should we|can we|kya kare|shu kariye)\b`).MatchString(lower):
		return "choice"
	default:
		return "general"
	}
}

func isCompatibleAnaphoricCommitment(question, answer string) bool {
	if !requestPattern.MatchString(question) || !commitmentPattern.MatchString(answer) || !anaphoricRefPattern.MatchString(answer) {
		return false
	}
	questionAction := actionKind(question, false)
	answerAction := actionKind(answer, false)
	return questionAction != "" && questionAction == answerAction
}

func answerSupportsQuestion(question domain.ConversationQuestion, event domain.MessageEvent, answer string) bool {
	if strings.TrimSpace(event.QuotedMessageID) != "" && event.QuotedMessageID == question.Provenance.SourceMessageID {
		return true
	}
	if genericAckPattern.MatchString(answer) {
		return false
	}
	switch questionKind(question.Question) {
	case "time":
		return temporalPattern.MatchString(answer)
	case "location":
		return locationAnswerPat.MatchString(answer)
	case "approval":
		return yesNoAnswerPattern.MatchString(answer)
	case "choice":
		return choiceAnswerPattern.MatchString(answer) || choiceLabelPattern.MatchString(answer)
	default:
		return tokenOverlap(question.Question, answer) > 0 || yesNoAnswerPattern.MatchString(answer) || isCompatibleAnaphoricCommitment(question.Question, answer)
	}
}

func sameCommitment(left, right string) bool {
	left = strings.ToLower(clean(left))
	right = strings.ToLower(clean(right))
	return left == right && left != ""
}

func currentCommitmentIndexes(state *domain.ConversationState, owner bool) []int {
	indexes := make([]int, 0)
	for index := range state.Commitments {
		if state.Commitments[index].Status == domain.EvidenceCurrent && state.Commitments[index].ActorIsOwner == owner {
			indexes = append(indexes, index)
		}
	}
	return indexes
}

func completionObjectCompatible(item domain.ConversationCommitment, text string) bool {
	completionKind := actionKind(text, true)
	if completionKind == "" && genericCompletion.MatchString(text) {
		return true
	}
	commitmentTokens := commitmentObjectTokens(item)
	completionTokens := significantTokens(text)
	if len(commitmentTokens) == 0 {
		// An objectless promise such as "I'll send it" cannot be safely closed
		// by a completion that introduces a previously unbound object.
		return len(completionTokens) == 0
	}
	if len(completionTokens) == 0 {
		return true
	}
	return tokenSetOverlap(commitmentTokens, completionTokens) > 0
}

func resolveCommitmentsByEvidence(state *domain.ConversationState, event domain.MessageEvent, text string) {
	if isQuestion(text) || commitmentPattern.MatchString(text) || cancelPattern.MatchString(text) {
		return
	}
	candidates := currentCommitmentIndexes(state, event.FromMe)
	completionKind := actionKind(text, true)
	if strings.TrimSpace(event.QuotedMessageID) != "" && (completionKind != "" || genericCompletion.MatchString(text)) {
		for _, index := range candidates {
			item := &state.Commitments[index]
			if eventAfter(event, item.Provenance) && event.QuotedMessageID == item.Provenance.SourceMessageID && completionObjectCompatible(*item, text) {
				item.Status = domain.EvidenceResolved
				item.ResolvedByMessageID = event.MessageID
				item.ResolutionReason = "quoted_completion_evidence"
				return
			}
		}
	}
	kind := completionKind
	if kind == "" || genericCompletion.MatchString(text) && actionKind(text, true) == "" {
		return
	}
	type match struct{ index, overlap int }
	matches := make([]match, 0)
	for _, index := range candidates {
		item := &state.Commitments[index]
		if eventAfter(event, item.Provenance) && actionKind(item.Action, false) == kind {
			matches = append(matches, match{index: index, overlap: tokenSetOverlap(commitmentObjectTokens(*item), significantTokens(text))})
		}
	}
	if len(matches) == 0 {
		return
	}
	selected := -1
	if len(matches) == 1 {
		if !completionObjectCompatible(state.Commitments[matches[0].index], text) {
			return
		}
		selected = matches[0].index
	} else {
		best, ties := 0, 0
		for _, candidate := range matches {
			if candidate.overlap > best {
				best, ties, selected = candidate.overlap, 1, candidate.index
			} else if candidate.overlap == best {
				ties++
			}
		}
		if best == 0 || ties != 1 {
			return
		}
	}
	item := &state.Commitments[selected]
	item.Status = domain.EvidenceResolved
	item.ResolvedByMessageID = event.MessageID
	item.ResolutionReason = "matching_completion_evidence"
}

func cancelMatchingCommitment(state *domain.ConversationState, event domain.MessageEvent, text string) {
	kind := actionKind(text, false)
	candidates := currentCommitmentIndexes(state, event.FromMe)
	for position := len(candidates) - 1; position >= 0; position-- {
		item := &state.Commitments[candidates[position]]
		if !eventAfter(event, item.Provenance) || (kind != "" && actionKind(item.Action, false) != kind) {
			continue
		}
		item.Status = domain.EvidenceSuperseded
		item.SupersededByMessageID = event.MessageID
		return
	}
}

func invalidateEvidence(state *domain.ConversationState, sourceEventID, replacementMessageID string) {
	questions := state.OpenQuestions[:0]
	for _, item := range state.OpenQuestions {
		if item.Provenance.SourceEventID != sourceEventID {
			questions = append(questions, item)
		}
	}
	state.OpenQuestions = questions
	for index := range state.Commitments {
		if state.Commitments[index].Provenance.SourceEventID == sourceEventID {
			state.Commitments[index].Status = domain.EvidenceSuperseded
			state.Commitments[index].SupersededByMessageID = replacementMessageID
		}
	}
	for index := range state.RecentFacts {
		if state.RecentFacts[index].Provenance.SourceEventID == sourceEventID {
			state.RecentFacts[index].Status = domain.EvidenceSuperseded
			state.RecentFacts[index].SupersededByMessageID = replacementMessageID
		}
	}
	if state.CurrentTopic != nil && state.CurrentTopic.Provenance.SourceEventID == sourceEventID {
		state.CurrentTopic = nil
	}
}

func finalize(state *domain.ConversationState, now time.Time) {
	for index := range state.Commitments {
		item := &state.Commitments[index]
		if item.Status == domain.EvidenceCurrent && item.ExpiresAt != nil && !now.Before(*item.ExpiresAt) {
			item.Status = domain.EvidenceExpired
		}
	}
	for index := range state.RecentFacts {
		item := &state.RecentFacts[index]
		if item.Status == domain.EvidenceCurrent && item.ExpiresAt != nil && !now.Before(*item.ExpiresAt) {
			item.Status = domain.EvidenceExpired
		}
	}
	state.OpenQuestions = currentQuestions(state.OpenQuestions)
	state.Commitments = tailCommitments(state.Commitments, 40)
	state.RecentFacts = tailFacts(state.RecentFacts, 80)
	state.UpdatedAt = now.UTC()
}

func meaningful(event domain.MessageEvent) bool {
	text := clean(event.OriginalText)
	return event.Kind == domain.MessageText && text != "" && !controlPattern.MatchString(text)
}

func clean(value string) string { return strings.Join(strings.Fields(strings.TrimSpace(value)), " ") }

func provenance(event domain.MessageEvent) domain.EvidenceProvenance {
	confidence := 0.65
	if event.TimestampKnown {
		confidence = 1
	}
	return domain.EvidenceProvenance{
		SourceMessageID: event.SourceMessageID,
		SourceEventID:   event.ID,
		SpeakerID:       event.SenderID,
		SpeakerName:     event.SenderName,
		FromMe:          event.FromMe,
		OriginalWording: clean(event.OriginalText),
		OccurredAt:      event.OccurredAt,
		TimestampKnown:  event.TimestampKnown,
		Confidence:      confidence,
		SafeToRepeat:    false,
	}
}

func eventAfter(event domain.MessageEvent, prior domain.EvidenceProvenance) bool {
	if event.TimestampKnown && prior.TimestampKnown {
		return !event.OccurredAt.Before(prior.OccurredAt)
	}
	return event.ID != prior.SourceEventID
}

func isQuestion(text string) bool { return questionPattern.MatchString(text) }

func classifyIntent(text string, fromMe bool) string {
	switch {
	case isQuestion(text) && requestPattern.MatchString(text):
		return "request"
	case isQuestion(text):
		return "question"
	case commitmentPattern.MatchString(text) && fromMe:
		return "owner_commitment"
	case commitmentPattern.MatchString(text):
		return "contact_commitment"
	case locationPattern.MatchString(text):
		return "location_update"
	case availabilityPat.MatchString(text):
		return "availability_update"
	case statusPattern.MatchString(text):
		return "status_update"
	default:
		return "statement"
	}
}

func factCategory(text string) string {
	switch {
	case locationPattern.MatchString(text):
		return "location"
	case availabilityPat.MatchString(text):
		return "availability"
	case temporalPattern.MatchString(text):
		return "schedule"
	case statusPattern.MatchString(text):
		return "status"
	default:
		return "statement"
	}
}

func expiryFor(text string, occurredAt time.Time) *time.Time {
	if occurredAt.IsZero() {
		return nil
	}
	var ttl time.Duration
	switch {
	case locationPattern.MatchString(text), availabilityPat.MatchString(text):
		ttl = 12 * time.Hour
	case temporalPattern.MatchString(text), statusPattern.MatchString(text):
		ttl = 48 * time.Hour
	default:
		return nil
	}
	expires := occurredAt.UTC().Add(ttl)
	return &expires
}

func truncate(value string, max int) string {
	if utf8.RuneCountInString(value) <= max {
		return value
	}
	runes := []rune(value)
	return strings.TrimSpace(string(runes[:max])) + "…"
}

func currentQuestions(items []domain.ConversationQuestion) []domain.ConversationQuestion {
	out := make([]domain.ConversationQuestion, 0, len(items))
	for _, item := range items {
		if item.Status == domain.EvidenceCurrent {
			out = append(out, item)
		}
	}
	if len(out) > 30 {
		out = out[len(out)-30:]
	}
	return out
}

func tailCommitments(items []domain.ConversationCommitment, limit int) []domain.ConversationCommitment {
	if len(items) > limit {
		return append([]domain.ConversationCommitment(nil), items[len(items)-limit:]...)
	}
	return items
}

func tailFacts(items []domain.ConversationFact, limit int) []domain.ConversationFact {
	if len(items) > limit {
		return append([]domain.ConversationFact(nil), items[len(items)-limit:]...)
	}
	return items
}
