package bridge

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"mycrobo/whatsapp-bridge/internal/conversationstate"
	"mycrobo/whatsapp-bridge/internal/domain"
	"mycrobo/whatsapp-bridge/internal/store"
)

var unresolvedDraftPlaceholder = regexp.MustCompile(`(?i)\[(?:add|confirm|enter|replace|say|select|write)\b[^\]\r\n]{0,120}\]`)

type Event struct {
	Type string    `json:"type"`
	At   time.Time `json:"at"`
	Data any       `json:"data"`
}
type Publisher interface{ Publish(Event) }
type ConnectionReporter interface {
	ConnectionState(context.Context) string
}
type Transport interface {
	ConnectionReporter
	SendText(context.Context, string, string, string) (SendReceipt, error)
}

type SendReceipt struct {
	MessageID  string
	AcceptedAt time.Time
	SenderID   domain.CanonicalID
}

type Service struct {
	repo            store.Repository
	reporter        ConnectionReporter
	transport       Transport
	events          Publisher
	clock           func() time.Time
	outboundEnabled bool
	approvals       *ApprovalTokens
	outboundMu      sync.Mutex
}

func New(repo store.Repository, transport Transport, events Publisher, outbound bool) *Service {
	return &Service{repo: repo, reporter: transport, transport: transport, events: events, clock: time.Now, outboundEnabled: outbound, approvals: NewApprovalTokens()}
}
func (s *Service) Repository() store.Repository { return s.repo }
func (s *Service) SetConnectionReporter(reporter ConnectionReporter) {
	s.reporter = reporter
}
func (s *Service) SetTransport(transport Transport, enabled bool) {
	s.transport = transport
	s.reporter = transport
	s.outboundEnabled = enabled
}
func (s *Service) State(ctx context.Context) string {
	if s.reporter == nil {
		return "offline-read-only"
	}
	return s.reporter.ConnectionState(ctx)
}
func (s *Service) SendAvailable(ctx context.Context) bool {
	return s.outboundEnabled && s.transport != nil && s.State(ctx) == "current-read-only"
}

func (s *Service) Ingest(ctx context.Context, e domain.IncomingEvent) (bool, error) {
	if strings.TrimSpace(e.Chat.ID) == "" {
		return false, errors.New("chat id is required")
	}
	chatIdentity := e.ChatIdentity
	if identityEmpty(chatIdentity) {
		chatIdentity = e.Identity
	}
	if chatIdentity.UpdatedAt.IsZero() {
		chatIdentity.UpdatedAt = s.clock().UTC()
	}
	chatID, err := s.repo.UpsertIdentity(ctx, chatIdentity)
	if err != nil {
		return false, err
	}
	senderIdentity := e.SenderIdentity
	if identityEmpty(senderIdentity) {
		senderIdentity = e.Identity
	}
	senderID := chatID
	if !identityEmpty(senderIdentity) {
		if senderIdentity.UpdatedAt.IsZero() {
			senderIdentity.UpdatedAt = s.clock().UTC()
		}
		senderID, err = s.repo.UpsertIdentity(ctx, senderIdentity)
		if err != nil {
			return false, err
		}
	}
	e.Chat.IdentityID = chatID.ID
	if strings.TrimSpace(e.Chat.SourceID) == "" {
		e.Chat.SourceID = e.Chat.ID
	}
	e.Chat.ID = string(chatID.ID)
	if e.Chat.UpdatedAt.IsZero() {
		if e.Message.TimestampKnown {
			e.Chat.UpdatedAt = e.Message.Timestamp.UTC()
		} else {
			e.Chat.UpdatedAt = s.clock().UTC()
		}
	}
	if e.Message.SenderID == "" {
		e.Message.SenderID = senderID.ID
	}
	if strings.TrimSpace(e.Message.SenderName) == "" {
		e.Message.SenderName = senderID.Name
	}
	if e.Message.TimestampKnown && e.Message.Timestamp.IsZero() {
		return false, errors.New("known timestamp cannot be zero")
	}
	if !e.Message.TimestampKnown {
		e.Message.Timestamp = time.Unix(0, 0).UTC()
		e.Message.Replyable = false
	}
	e.Message.ChatID = e.Chat.ID
	if e.Message.Kind != domain.MessageText {
		e.Message.Replyable = false
	}
	if e.Message.TimestampKnown {
		t := e.Message.Timestamp
		e.Chat.LastMessageAt = &t
	}
	if err = s.repo.UpsertChat(ctx, e.Chat); err != nil {
		return false, err
	}
	inserted, err := s.repo.InsertMessage(ctx, e.Message)
	if err != nil {
		return false, err
	}
	if err = s.RefreshConversationState(ctx, e.Chat.ID); err != nil {
		return false, err
	}
	if inserted && s.events != nil {
		s.events.Publish(Event{Type: "message.created", At: s.clock().UTC(), Data: e.Message})
	}
	return inserted, nil
}

// RefreshConversationState incrementally advances the durable state cursor.
// It is safe to call after a retry: already-reduced events are ignored.
func (s *Service) RefreshConversationState(ctx context.Context, chatID string) error {
	state, err := s.repo.GetConversationState(ctx, chatID)
	if err != nil {
		if !errors.Is(err, store.ErrConversationStateNotFound) {
			return err
		}
		state = domain.ConversationState{
			ChatID:             chatID,
			Version:            conversationstate.StateVersion,
			OpenQuestions:      []domain.ConversationQuestion{},
			Commitments:        []domain.ConversationCommitment{},
			RecentFacts:        []domain.ConversationFact{},
			ConversationStatus: "empty",
		}
		if err = s.repo.PutConversationState(ctx, state); err != nil {
			return err
		}
	}
	if state.Version != conversationstate.StateVersion {
		return s.rebuildConversationState(ctx, chatID)
	}
	for {
		events, listErr := s.repo.ListMessageEvents(ctx, chatID, state.ReducedThroughSequence, 1000)
		if listErr != nil {
			return listErr
		}
		if len(events) == 0 {
			break
		}
		state, err = conversationstate.Advance(state, events, s.clock().UTC())
		if err != nil {
			if errors.Is(err, conversationstate.ErrRebuildRequired) {
				return s.rebuildConversationState(ctx, chatID)
			}
			return err
		}
		if err = s.repo.PutConversationState(ctx, state); err != nil {
			return err
		}
		if len(events) < 1000 {
			break
		}
	}
	return nil
}

// ConversationState lazily materializes legacy/imported evidence before
// returning it. Callers never need to infer whether a snapshot is stale.
func (s *Service) ConversationState(ctx context.Context, chatID string) (domain.ConversationState, error) {
	if strings.TrimSpace(chatID) == "" {
		return domain.ConversationState{}, errors.New("chat id is required")
	}
	if err := s.RefreshConversationState(ctx, chatID); err != nil {
		return domain.ConversationState{}, err
	}
	return s.repo.GetConversationState(ctx, chatID)
}

func (s *Service) rebuildConversationState(ctx context.Context, chatID string) error {
	all := make([]domain.MessageEvent, 0)
	var cursor int64
	for {
		page, err := s.repo.ListMessageEvents(ctx, chatID, cursor, 1000)
		if err != nil {
			return err
		}
		if len(page) == 0 {
			break
		}
		all = append(all, page...)
		cursor = page[len(page)-1].Sequence
		if len(page) < 1000 {
			break
		}
	}
	state, err := conversationstate.Reduce(chatID, all, s.clock().UTC())
	if err != nil {
		return err
	}
	return s.repo.PutConversationState(ctx, state)
}
func identityEmpty(v domain.Identity) bool {
	return strings.TrimSpace(v.LID) == "" && strings.TrimSpace(v.PhoneJID) == "" && strings.TrimSpace(v.Phone) == "" && v.ID == ""
}
func (s *Service) UpdateHistory(ctx context.Context, v domain.HistorySync) error {
	if v.ChatID == "" {
		return errors.New("chat id is required")
	}
	if v.Status == domain.HistoryComplete && !v.HistoryEndHit {
		return errors.New("history cannot be complete before end is confirmed")
	}
	v.UpdatedAt = s.clock().UTC()
	if err := s.repo.PutHistory(ctx, v); err != nil {
		return err
	}
	if s.events != nil {
		s.events.Publish(Event{Type: "history.updated", At: v.UpdatedAt, Data: v})
	}
	return nil
}
func (s *Service) RecordImportConsent(ctx context.Context, policyVersion string, importAll, includeArchived, acceptRisk bool) (domain.ImportConsent, error) {
	if strings.TrimSpace(policyVersion) == "" || !importAll || !includeArchived || !acceptRisk {
		return domain.ImportConsent{}, errors.New("full-chat import and unofficial connector risk must be explicitly accepted")
	}
	value := domain.ImportConsent{
		ID:                     randomID(),
		Connector:              "personal-pilot",
		ImportAllChats:         true,
		IncludeArchivedChats:   true,
		UnofficialRiskAccepted: true,
		PolicyVersion:          strings.TrimSpace(policyVersion),
		CreatedAt:              s.clock().UTC(),
	}
	if err := s.repo.SaveImportConsent(ctx, value); err != nil {
		return domain.ImportConsent{}, err
	}
	return value, nil
}

// CanResumeImport permits a previously paired read-only session to reconnect
// without asking the user to approve every chat again. It succeeds only when
// the durable one-shot consent covers all active and archived chats and the
// unofficial personal connector risk was explicitly accepted.
func (s *Service) CanResumeImport(ctx context.Context) bool {
	value, err := s.repo.LatestImportConsent(ctx)
	return err == nil &&
		value.Connector == "personal-pilot" &&
		value.ImportAllChats &&
		value.IncludeArchivedChats &&
		value.UnofficialRiskAccepted &&
		strings.TrimSpace(value.PolicyVersion) != ""
}
func validateOutbound(recipient, body, target, idempotency string) error {
	if strings.TrimSpace(recipient) == "" || strings.TrimSpace(target) == "" || strings.TrimSpace(idempotency) == "" {
		return ErrApprovalInvalid
	}
	if strings.TrimSpace(body) == "" || utf8.RuneCountInString(body) > 800 {
		return ErrApprovalInvalid
	}
	if unresolvedDraftPlaceholder.MatchString(body) {
		return ErrApprovalInvalid
	}
	if n := utf8.RuneCountInString(idempotency); n < 16 || n > 128 {
		return ErrApprovalInvalid
	}
	return nil
}
func (s *Service) ensureLatest(ctx context.Context, recipient, target string) (domain.Chat, error) {
	chat, err := s.repo.GetChat(ctx, recipient)
	if err != nil || strings.TrimSpace(chat.SourceID) == "" {
		return chat, ErrApprovalInvalid
	}
	latest, err := s.repo.LatestSourceMessage(ctx, recipient)
	if err != nil || latest.ID != target || !latest.Conversational() {
		return chat, ErrStaleTarget
	}
	return chat, nil
}
func (s *Service) IssueApproval(ctx context.Context, recipient, body, target, idempotency string, ttl time.Duration) (string, error) {
	s.outboundMu.Lock()
	defer s.outboundMu.Unlock()
	if !s.SendAvailable(ctx) {
		return "", ErrOutboundDisabled
	}
	if err := validateOutbound(recipient, body, target, idempotency); err != nil {
		return "", err
	}
	if _, err := s.ensureLatest(ctx, recipient, target); err != nil {
		return "", err
	}
	if prior, err := s.repo.LatestOutboundAudit(ctx, idempotency); err == nil {
		if prior.Status != "approved" || !sameOutbound(prior, recipient, body, target) {
			return "", ErrIdempotencyConflict
		}
		// Approval tokens intentionally live only in memory. If the bridge
		// restarts after the durable approved record was written but before the
		// send begins, permit one exact-binding token to be reconstructed only
		// within the normal API approval window. A later sending/sent/ambiguous
		// record is never recoverable through this branch, and SendApproved
		// re-checks the durable status under the same outbound mutex.
		remaining := prior.CreatedAt.Add(2 * time.Minute).Sub(s.clock().UTC())
		if remaining <= 0 {
			return "", ErrApprovalInvalid
		}
		if ttl > remaining {
			ttl = remaining
		}
		return s.approvals.Issue(recipient, body, target, idempotency, ttl)
	}
	token, err := s.approvals.Issue(recipient, body, target, idempotency, ttl)
	if err != nil {
		return "", err
	}
	audit := domain.OutboundAudit{ID: randomID(), IdempotencyKey: idempotency, RecipientID: recipient, TargetMessageID: target, BodyHash: bodyHash(body), Status: "approved", CreatedAt: s.clock().UTC()}
	if err = s.repo.AppendOutboundAudit(ctx, audit); err != nil {
		return "", err
	}
	return token, nil
}
func sameOutbound(a domain.OutboundAudit, recipient, body, target string) bool {
	return a.RecipientID == recipient && a.BodyHash == bodyHash(body) && a.TargetMessageID == target
}
func (s *Service) SendApproved(ctx context.Context, recipient, body, target, idempotency, token string) (string, error) {
	s.outboundMu.Lock()
	defer s.outboundMu.Unlock()
	if !s.SendAvailable(ctx) {
		return "", ErrOutboundDisabled
	}
	if err := validateOutbound(recipient, body, target, idempotency); err != nil {
		return "", err
	}
	prior, priorErr := s.repo.LatestOutboundAudit(ctx, idempotency)
	if priorErr == nil {
		if !sameOutbound(prior, recipient, body, target) {
			return "", ErrIdempotencyConflict
		}
		if prior.Status == "sent" && prior.MessageID != "" {
			return prior.MessageID, nil
		}
		if prior.Status == "sending" || prior.Status == "ambiguous" {
			return "", ErrAmbiguousOutcome
		}
		if prior.Status != "approved" {
			return "", ErrIdempotencyConflict
		}
	}
	if err := s.approvals.Consume(token, recipient, body, target, idempotency, s.clock()); err != nil {
		return "", err
	}
	chat, err := s.ensureLatest(ctx, recipient, target)
	if err != nil {
		return "", err
	}
	base := domain.OutboundAudit{IdempotencyKey: idempotency, RecipientID: recipient, TargetMessageID: target, BodyHash: bodyHash(body), CreatedAt: s.clock().UTC()}
	sending := base
	sending.ID = randomID()
	sending.Status = "sending"
	// Persist the exact attempt before crossing the network boundary.
	if err = s.repo.AppendOutboundAudit(ctx, sending); err != nil {
		return "", err
	}
	receipt, sendErr := s.transport.SendText(ctx, chat.SourceID, body, idempotency)
	result := base
	result.ID = randomID()
	result.MessageID = receipt.MessageID
	result.CreatedAt = s.clock().UTC()
	if sendErr != nil {
		result.Status = "ambiguous"
		result.Error = sendErr.Error()
	} else if receipt.MessageID == "" || receipt.AcceptedAt.IsZero() {
		result.Status = "ambiguous"
		result.Error = "WhatsApp did not return a complete server acknowledgement"
		sendErr = ErrAmbiguousOutcome
	} else {
		result.Status = "sent"
	}
	if auditErr := s.repo.AppendOutboundAudit(ctx, result); auditErr != nil {
		return receipt.MessageID, auditErr
	}
	if sendErr != nil {
		return receipt.MessageID, ErrAmbiguousOutcome
	}
	// WhatsApp's server acknowledgement is authoritative. Persist a local echo
	// immediately instead of waiting for the linked-device event to loop back;
	// otherwise a successfully sent reply disappears from the conversation and
	// looks like a failed send. The provider message ID deduplicates the later
	// live echo safely.
	senderID := receipt.SenderID
	if senderID == "" {
		senderID = domain.CanonicalID("owner")
	}
	_, _ = s.repo.InsertMessage(ctx, domain.Message{
		ID:              receipt.MessageID,
		SourceMessageID: receipt.MessageID,
		ChatID:          chat.ID,
		SenderID:        senderID,
		SenderName:      "You",
		FromMe:          true,
		Kind:            domain.MessageText,
		Text:            body,
		Timestamp:       receipt.AcceptedAt.UTC(),
		TimestampKnown:  true,
		Replyable:       true,
		RawType:         "outbound-local-echo",
	})
	acceptedAt := receipt.AcceptedAt.UTC()
	chat.LastMessageAt = &acceptedAt
	chat.UpdatedAt = acceptedAt
	_ = s.repo.UpsertChat(ctx, chat)
	return receipt.MessageID, nil
}
