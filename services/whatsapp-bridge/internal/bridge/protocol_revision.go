package bridge

import (
	"context"
	"errors"

	"mycrobo/whatsapp-bridge/internal/domain"
	"mycrobo/whatsapp-bridge/internal/store"
)

// ApplyProtocolRevision never upserts an identity or guesses the original by
// text/name. The store atomically checks aliases, journals the change, and
// updates only that existing message's projection. Ingestion cannot send.
func (s *Service) ApplyProtocolRevision(ctx context.Context, input domain.ProtocolRevision) (bool, error) {
	repository, ok := s.repo.(store.ProtocolRevisionRepository)
	if !ok {
		return false, errors.New("message revision storage is unavailable")
	}
	result, err := repository.ApplyProtocolRevision(ctx, input, s.clock().UTC())
	if err != nil {
		if markerErr := s.RecordProtocolRevisionIssue(ctx, input, err); markerErr != nil {
			return false, markerErr
		}
		return false, err
	}
	if !result.Applied && !result.Verified {
		return false, nil
	}
	if err = s.RefreshConversationState(ctx, result.Message.ChatID); err != nil {
		_ = s.RecordProtocolRevisionIssue(ctx, input, err)
		return false, err
	}
	issues, ok := s.repo.(store.ProtocolRevisionIssueRepository)
	if !ok {
		return false, errors.New("message revision issue storage is unavailable")
	}
	if err = issues.ResolveProtocolRevisionIssue(ctx, input); err != nil {
		return false, err
	}
	if result.Applied && s.events != nil {
		s.events.Publish(Event{Type: "message.updated", At: s.clock().UTC(), Data: result.Message})
	}
	return result.Applied, nil
}

func (s *Service) RecordProtocolRevisionIssue(ctx context.Context, input domain.ProtocolRevision, cause error) error {
	repository, ok := s.repo.(store.ProtocolRevisionIssueRepository)
	if !ok {
		return errors.New("message revision issue storage is unavailable")
	}
	if err := repository.RecordProtocolRevisionIssue(ctx, input, store.RevisionIssueReason(cause), s.clock().UTC()); err != nil {
		return err
	}
	if s.events != nil {
		s.events.Publish(Event{Type: "message.revision-blocked", At: s.clock().UTC(), Data: map[string]string{"reason": store.RevisionIssueReason(cause)}})
	}
	return nil
}
