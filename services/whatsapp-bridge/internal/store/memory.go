package store

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"mycrobo/whatsapp-bridge/internal/domain"
)

type Memory struct {
	mu                    sync.RWMutex
	identities            map[domain.CanonicalID]domain.Identity
	aliases               map[string]domain.CanonicalID
	chats                 map[string]domain.Chat
	messages              map[string]domain.Message
	messageIDs            map[string]string
	media                 map[string]domain.MediaAsset
	messageOrder          map[string]int64
	nextMessageOrder      int64
	messageEvents         []domain.MessageEvent
	eventIDs              map[string]bool
	nextEventSequence     int64
	conversationStates    map[string]domain.ConversationState
	conversationRevisions map[string]int64
	latestEventSequences  map[string]int64
	accountBinding        *AccountBinding
	protocolIssues        map[string]map[string]ProtocolRevisionIssue
	history               map[string]domain.HistorySync
	audits                []domain.OutboundAudit
	consents              []domain.ImportConsent
}

func NewMemory() *Memory {
	return &Memory{identities: map[domain.CanonicalID]domain.Identity{}, aliases: map[string]domain.CanonicalID{}, chats: map[string]domain.Chat{}, messages: map[string]domain.Message{}, media: map[string]domain.MediaAsset{}, messageOrder: map[string]int64{}, messageEvents: []domain.MessageEvent{}, eventIDs: map[string]bool{}, conversationStates: map[string]domain.ConversationState{}, conversationRevisions: map[string]int64{}, latestEventSequences: map[string]int64{}, history: map[string]domain.HistorySync{}}
}

func identityAliases(v domain.Identity) []string {
	return []string{domain.NormalizeAlias(v.LID), domain.NormalizeAlias(v.PhoneJID), domain.NormalizeAlias(v.Phone)}
}

func (m *Memory) UpsertIdentity(_ context.Context, v domain.Identity) (domain.Identity, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, alias := range identityAliases(v) {
		if id := m.aliases[alias]; alias != "" && id != "" {
			v.ID = id
			break
		}
	}
	if v.ID == "" {
		id, err := domain.CanonicalIdentityID(v.LID, v.PhoneJID, v.Phone)
		if err != nil {
			return v, err
		}
		v.ID = id
	}
	if prior, ok := m.identities[v.ID]; ok {
		if v.LID == "" {
			v.LID = prior.LID
		}
		if v.Phone == "" {
			v.Phone = prior.Phone
		}
		if v.PhoneJID == "" {
			v.PhoneJID = prior.PhoneJID
		}
		if !domain.MeaningfulDisplayName(v.Name) {
			v.Name = prior.Name
		}
	}
	m.identities[v.ID] = v
	for _, alias := range identityAliases(v) {
		if alias != "" {
			m.aliases[alias] = v.ID
		}
	}
	return v, nil
}

func (m *Memory) GetIdentity(_ context.Context, id domain.CanonicalID) (domain.Identity, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	identity, ok := m.identities[id]
	if !ok {
		return domain.Identity{}, errors.New("identity not found")
	}
	return identity, nil
}

func (m *Memory) UpsertChat(_ context.Context, v domain.Chat) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if prior, ok := m.chats[v.ID]; ok {
		if strings.TrimSpace(v.SourceID) == "" {
			v.SourceID = prior.SourceID
		}
		if !domain.MeaningfulDisplayName(v.Title) {
			v.Title = prior.Title
		}
		if v.IdentityID == "" {
			v.IdentityID = prior.IdentityID
		}
		if prior.LastMessageAt != nil && (v.LastMessageAt == nil || prior.LastMessageAt.After(*v.LastMessageAt)) {
			v.LastMessageAt = prior.LastMessageAt
		}
		if prior.UpdatedAt.After(v.UpdatedAt) {
			v.UpdatedAt = prior.UpdatedAt
		}
	}
	prior, exists := m.chats[v.ID]
	if !exists || prior.SourceID != v.SourceID || prior.IdentityID != v.IdentityID || prior.Title != v.Title || prior.IsGroup != v.IsGroup || prior.Archived != v.Archived {
		m.conversationRevisions[v.ID]++
	}
	m.chats[v.ID] = v
	return nil
}
func (m *Memory) InsertMessage(_ context.Context, v domain.Message) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := v.SourceMessageID
	if key == "" {
		key = v.ID
	}
	if key == "" {
		return false, errors.New("message has no id")
	}
	if saved, exists := m.messages[key]; exists {
		if conflictingMessageIdentity(saved, v) {
			m.recordMessageCollision(saved, v)
			return false, ErrMessageIdentityCollision
		}
		return false, nil
	}
	if m.messageIDs == nil {
		m.messageIDs = map[string]string{}
	}
	if savedKey, exists := m.messageIDs[v.ID]; exists {
		saved := m.messages[savedKey]
		if conflictingMessageIdentity(saved, v) {
			m.recordMessageCollision(saved, v)
			return false, ErrMessageIdentityCollision
		}
		return false, nil
	}
	m.messages[key] = v
	m.messageIDs[v.ID] = key
	m.nextMessageOrder++
	m.messageOrder[key] = m.nextMessageOrder
	event := domain.NewObservedMessageEvent(v, time.Now().UTC())
	m.nextEventSequence++
	event.Sequence = m.nextEventSequence
	m.messageEvents = append(m.messageEvents, event)
	m.eventIDs[event.ID] = true
	m.conversationRevisions[v.ChatID]++
	m.latestEventSequences[v.ChatID] = event.Sequence
	return true, nil
}

func (m *Memory) AppendMessageEvent(_ context.Context, event domain.MessageEvent) (bool, error) {
	if err := event.Validate(); err != nil {
		return false, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.eventIDs[event.ID] {
		return false, nil
	}
	m.nextEventSequence++
	event.Sequence = m.nextEventSequence
	m.messageEvents = append(m.messageEvents, event)
	m.eventIDs[event.ID] = true
	m.conversationRevisions[event.ChatID]++
	m.latestEventSequences[event.ChatID] = event.Sequence
	return true, nil
}

func (m *Memory) ListMessageEvents(_ context.Context, chatID string, afterSequence int64, limit int) ([]domain.MessageEvent, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if limit <= 0 || limit > 10000 {
		limit = 5000
	}
	out := make([]domain.MessageEvent, 0)
	for _, event := range m.messageEvents {
		if event.ChatID == chatID && event.Sequence > afterSequence {
			out = append(out, event)
			if len(out) == limit {
				break
			}
		}
	}
	return out, nil
}

func (m *Memory) PutConversationState(_ context.Context, state domain.ConversationState) error {
	if strings.TrimSpace(state.ChatID) == "" || state.Version <= 0 {
		return errors.New("invalid conversation state")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	prior, exists := m.conversationStates[state.ChatID]
	if !exists || state.ReducedThroughSequence >= prior.ReducedThroughSequence {
		m.conversationStates[state.ChatID] = state
	}
	return nil
}

func (m *Memory) GetConversationState(_ context.Context, chatID string) (domain.ConversationState, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	state, ok := m.conversationStates[chatID]
	if !ok {
		return state, ErrConversationStateNotFound
	}
	return state, nil
}

func (m *Memory) ListConversationStates(_ context.Context, limit int) ([]domain.ConversationState, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if limit <= 0 || limit > 5000 {
		limit = 2000
	}
	out := make([]domain.ConversationState, 0, len(m.conversationStates))
	for _, state := range m.conversationStates {
		out = append(out, state)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].UpdatedAt.Equal(out[j].UpdatedAt) {
			return out[i].ChatID < out[j].ChatID
		}
		return out[i].UpdatedAt.After(out[j].UpdatedAt)
	})
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (m *Memory) PutMedia(_ context.Context, v domain.MediaAsset) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	prior := m.media[v.MessageID]
	if len(v.Data) == 0 {
		v.Data = prior.Data
	}
	if len(v.Thumbnail) == 0 {
		v.Thumbnail = prior.Thumbnail
	}
	if len(v.DownloadInfo) == 0 {
		v.DownloadInfo = prior.DownloadInfo
	}
	if len(v.Data) > 0 && v.Metadata.Status != "blocked_view_once" {
		v.Metadata.Status = "ready"
	}
	m.media[v.MessageID] = v
	return nil
}

func (m *Memory) GetMedia(_ context.Context, messageID string) (domain.MediaAsset, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for _, message := range m.messages {
		if message.ID == messageID && message.Kind == domain.MessageDeleted {
			return domain.MediaAsset{}, errors.New("media not found")
		}
	}
	v, ok := m.media[messageID]
	if !ok {
		return v, errors.New("media not found")
	}
	v.Metadata.FullAvailable = len(v.Data) > 0
	v.Metadata.PreviewAvailable = v.Metadata.FullAvailable || len(v.Thumbnail) > 0
	v.Metadata.FetchAvailable = len(v.DownloadInfo) > 0 && v.Metadata.Status != "blocked_view_once"
	return v, nil
}

func messageStoreKey(v domain.Message) string {
	if v.SourceMessageID != "" {
		return v.SourceMessageID
	}
	return v.ID
}
func (m *Memory) ListChats(_ context.Context, archived bool, limit int, cursor string) ([]domain.Chat, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var cursorChat domain.Chat
	hasCursor := false
	if cursor != "" {
		cursorChat, hasCursor = m.chats[cursor]
		if !hasCursor || cursorChat.Archived != archived {
			return nil, errors.New("chat cursor not found")
		}
	}
	var out []domain.Chat
	for _, c := range m.chats {
		isAfterCursor := cursor == "" || c.UpdatedAt.Before(cursorChat.UpdatedAt) || (c.UpdatedAt.Equal(cursorChat.UpdatedAt) && c.ID > cursorChat.ID)
		if c.Archived == archived && isAfterCursor {
			out = append(out, c)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].UpdatedAt.Equal(out[j].UpdatedAt) {
			return out[i].ID < out[j].ID
		}
		return out[i].UpdatedAt.After(out[j].UpdatedAt)
	})
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}
func (m *Memory) GetChat(_ context.Context, id string) (domain.Chat, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	v, ok := m.chats[id]
	if !ok {
		return v, errors.New("chat not found")
	}
	return v, nil
}
func (m *Memory) SearchChats(_ context.Context, archived bool, query string, limit int) ([]domain.Chat, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	needle := strings.ToLower(strings.TrimSpace(query))
	if needle == "" {
		return nil, errors.New("search query is required")
	}
	matched := make(map[string]bool)
	for _, message := range m.messages {
		if message.Kind == domain.MessageText && strings.Contains(strings.ToLower(message.Text), needle) {
			matched[message.ChatID] = true
		}
	}
	var out []domain.Chat
	for _, chat := range m.chats {
		if chat.Archived == archived && (strings.Contains(strings.ToLower(chat.Title), needle) || matched[chat.ID]) {
			out = append(out, chat)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].UpdatedAt.Equal(out[j].UpdatedAt) {
			return out[i].ID < out[j].ID
		}
		return out[i].UpdatedAt.After(out[j].UpdatedAt)
	})
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}
func (m *Memory) ListOwnerTextMessages(_ context.Context, chatID string, limit int) ([]domain.Message, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var out []domain.Message
	for _, message := range m.messages {
		if message.FromMe && message.TimestampKnown && message.Kind == domain.MessageText && strings.TrimSpace(message.Text) != "" && (chatID == "" || message.ChatID == chatID) {
			out = append(out, message)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Timestamp.Equal(out[j].Timestamp) {
			return m.messageOrder[messageStoreKey(out[i])] > m.messageOrder[messageStoreKey(out[j])]
		}
		return out[i].Timestamp.After(out[j].Timestamp)
	})
	if limit <= 0 || limit > 500 {
		limit = 120
	}
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}
func (m *Memory) ListResponseEpisodes(_ context.Context, limit int) ([]domain.ResponseEpisode, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	records := make([]episodeMessage, 0, len(m.messages))
	for key, message := range m.messages {
		chat, ok := m.chats[message.ChatID]
		if !ok || chat.IsGroup || !message.TimestampKnown {
			continue
		}
		records = append(records, episodeMessage{chat: chat, message: message, order: m.messageOrder[key]})
	}
	return buildResponseEpisodes(records, limit), nil
}
func (m *Memory) ListMessages(_ context.Context, chatID string, limit int, before string) ([]domain.Message, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var beforeMessage domain.Message
	hasBefore := false
	if before != "" {
		for _, candidate := range m.messages {
			if candidate.ChatID == chatID && candidate.ID == before {
				beforeMessage = candidate
				hasBefore = true
				break
			}
		}
		if !hasBefore {
			return nil, errors.New("message cursor not found")
		}
	}
	var out []domain.Message
	for _, v := range m.messages {
		isOlder := before == "" || v.Timestamp.Before(beforeMessage.Timestamp) || (v.Timestamp.Equal(beforeMessage.Timestamp) && m.messageOrder[messageStoreKey(v)] < m.messageOrder[messageStoreKey(beforeMessage)])
		if v.ChatID == chatID && isOlder {
			out = append(out, v)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Timestamp.Equal(out[j].Timestamp) {
			return m.messageOrder[messageStoreKey(out[i])] > m.messageOrder[messageStoreKey(out[j])]
		}
		return out[i].Timestamp.After(out[j].Timestamp)
	})
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}
func (m *Memory) LatestMessage(ctx context.Context, chatID string) (domain.Message, error) {
	items, err := m.ListMessages(ctx, chatID, 1000, "")
	if err != nil {
		return domain.Message{}, err
	}
	for _, item := range items {
		if item.Conversational() {
			return item, nil
		}
	}
	return domain.Message{}, errors.New("latest conversational message not found")
}

func (m *Memory) LatestSourceMessage(ctx context.Context, chatID string) (domain.Message, error) {
	items, err := m.ListMessages(ctx, chatID, 1000, "")
	if err != nil {
		return domain.Message{}, err
	}
	for _, item := range items {
		if item.TimestampKnown && item.Kind != domain.MessageSystem && item.Kind != domain.MessageReaction {
			return item, nil
		}
	}
	return domain.Message{}, errors.New("latest source message not found")
}
func (m *Memory) OldestMessage(_ context.Context, chatID string) (domain.Message, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	var oldest domain.Message
	found := false
	for _, item := range m.messages {
		if item.ChatID != chatID || !item.TimestampKnown {
			continue
		}
		if !found || item.Timestamp.Before(oldest.Timestamp) || (item.Timestamp.Equal(oldest.Timestamp) && m.messageOrder[messageStoreKey(item)] < m.messageOrder[messageStoreKey(oldest)]) {
			oldest = item
			found = true
		}
	}
	if !found {
		return domain.Message{}, errors.New("oldest message not found")
	}
	return oldest, nil
}
func (m *Memory) PutHistory(_ context.Context, v domain.HistorySync) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	blocked := m.unresolvedRevisionCount(v.ChatID) > 0
	if blocked {
		v.Status = domain.HistoryFailed
		v.HistoryEndHit = false
		v.LastError = unresolvedHistoryReason
		prior := m.history[v.ChatID]
		if v.MessagesSeen < prior.MessagesSeen {
			v.MessagesSeen = prior.MessagesSeen
		}
		if v.OldestCursor == "" {
			v.OldestCursor = prior.OldestCursor
		}
		if v.NewestCursor == "" {
			v.NewestCursor = prior.NewestCursor
		}
	}
	prior, exists := m.history[v.ChatID]
	if !exists || prior.Status != v.Status || prior.OldestCursor != v.OldestCursor || prior.NewestCursor != v.NewestCursor || prior.MessagesSeen != v.MessagesSeen || prior.HistoryEndHit != v.HistoryEndHit || prior.LastError != v.LastError {
		m.conversationRevisions[v.ChatID]++
	}
	m.history[v.ChatID] = v
	if blocked {
		return ErrUnresolvedConversationEvidence
	}
	return nil
}
func (m *Memory) GetHistory(_ context.Context, id string) (domain.HistorySync, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	v, ok := m.history[id]
	if !ok {
		return v, errors.New("history state not found")
	}
	return v, nil
}

func (m *Memory) GetHistoryCoverage(_ context.Context, chatID string) (domain.HistoryCoverage, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if _, ok := m.chats[chatID]; !ok {
		return domain.HistoryCoverage{}, errors.New("chat not found")
	}
	coverage := domain.HistoryCoverage{ChatID: chatID, State: "not_started"}
	for _, message := range m.messages {
		if message.ChatID != chatID {
			continue
		}
		coverage.LocallyStoredMessages++
		if message.FromMe {
			coverage.OwnerMessages++
			if message.Kind == domain.MessageText && strings.TrimSpace(message.Text) != "" {
				coverage.OwnerTextMessages++
			}
		} else {
			coverage.ContactMessages++
		}
		if !message.TimestampKnown {
			continue
		}
		coverage.TimestampedMessages++
		stamp := message.Timestamp.UTC()
		if coverage.OldestMessageAt == nil || stamp.Before(*coverage.OldestMessageAt) {
			copy := stamp
			coverage.OldestMessageAt = &copy
		}
		if coverage.NewestMessageAt == nil || stamp.After(*coverage.NewestMessageAt) {
			copy := stamp
			coverage.NewestMessageAt = &copy
		}
	}
	if history, ok := m.history[chatID]; ok {
		coverage.ProviderStatus = history.Status
		coverage.ProviderReportedMessagesSeen = history.MessagesSeen
		coverage.ProviderBeginningReached = history.HistoryEndHit
		coverage.OldestCursor = history.OldestCursor
		coverage.NewestCursor = history.NewestCursor
		coverage.LastError = history.LastError
		stamp := history.UpdatedAt.UTC()
		coverage.LastAttemptAt = &stamp
		switch {
		case history.Status == domain.HistoryComplete && history.HistoryEndHit:
			coverage.State = "complete"
		case history.Status == domain.HistoryFailed:
			coverage.State = "failed"
		default:
			coverage.State = "partial"
		}
	} else if coverage.LocallyStoredMessages > 0 {
		coverage.State = "local_only"
	}
	return coverage, nil
}
func (m *Memory) AppendOutboundAudit(_ context.Context, v domain.OutboundAudit) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.audits = append(m.audits, v)
	return nil
}
func (m *Memory) LatestOutboundAudit(_ context.Context, key string) (domain.OutboundAudit, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	for index := len(m.audits) - 1; index >= 0; index-- {
		if m.audits[index].IdempotencyKey == key {
			return m.audits[index], nil
		}
	}
	return domain.OutboundAudit{}, errors.New("outbound audit not found")
}
func (m *Memory) AuditCount(status string) int {
	m.mu.RLock()
	defer m.mu.RUnlock()
	n := 0
	for _, a := range m.audits {
		if strings.EqualFold(a.Status, status) {
			n++
		}
	}
	return n
}
func (m *Memory) SaveImportConsent(_ context.Context, value domain.ImportConsent) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.consents = append(m.consents, value)
	return nil
}
func (m *Memory) LatestImportConsent(_ context.Context) (domain.ImportConsent, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if len(m.consents) == 0 {
		return domain.ImportConsent{}, errors.New("import consent not found")
	}
	return m.consents[len(m.consents)-1], nil
}
