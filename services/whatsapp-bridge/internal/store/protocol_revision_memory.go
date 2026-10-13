package store

import (
	"context"
	"time"

	"mycrobo/whatsapp-bridge/internal/domain"
)

func (m *Memory) revisionAliasMatches(id domain.CanonicalID, aliases []string) bool {
	for _, alias := range aliases {
		if found := m.aliases[domain.NormalizeAlias(alias)]; found != "" && found == id {
			return true
		}
	}
	return false
}

func (m *Memory) ApplyProtocolRevision(_ context.Context, input domain.ProtocolRevision, observedAt time.Time) (domain.ProtocolRevisionResult, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	original, ok := m.messages[input.TargetSourceMessageID]
	if !ok {
		return domain.ProtocolRevisionResult{}, ErrRevisionTargetUnknown
	}
	chat, ok := m.chats[original.ChatID]
	if !ok || !m.revisionAliasMatches(chat.IdentityID, input.ChatAliases) || !m.revisionAliasMatches(original.SenderID, input.SenderAliases) || original.FromMe != input.FromMe {
		return domain.ProtocolRevisionResult{}, ErrRevisionIdentityMismatch
	}
	if m.eventIDs[protocolEventID(original, input)] {
		return domain.ProtocolRevisionResult{Verified: true, Message: original}, nil
	}
	var previousID string
	var previousType domain.MessageEventType
	for i := len(m.messageEvents) - 1; i >= 0; i-- {
		event := m.messageEvents[i]
		if event.MessageID == original.ID && event.ChatID == original.ChatID {
			previousID = event.ID
			previousType = event.Type
			break
		}
	}
	current, event, apply, err := prepareProtocolRevision(original, previousID, previousType, input, observedAt)
	if err != nil || !apply {
		return domain.ProtocolRevisionResult{Message: original}, err
	}
	if m.eventIDs[event.ID] {
		return domain.ProtocolRevisionResult{Message: original}, nil
	}
	m.nextEventSequence++
	event.Sequence = m.nextEventSequence
	m.messageEvents = append(m.messageEvents, event)
	m.eventIDs[event.ID] = true
	m.messages[input.TargetSourceMessageID] = current
	m.conversationRevisions[current.ChatID]++
	m.latestEventSequences[current.ChatID] = event.Sequence
	return domain.ProtocolRevisionResult{Applied: true, Verified: true, Message: current}, nil
}
