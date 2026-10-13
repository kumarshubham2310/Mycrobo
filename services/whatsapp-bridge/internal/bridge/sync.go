package bridge

import (
	"context"
	"fmt"

	"mycrobo/whatsapp-bridge/internal/domain"
)

// HistorySource is implemented by the whatsmeow adapter. Pages must be
// returned newest-to-oldest and End must only become true when WhatsApp has
// confirmed that no older history remains for that chat.
type HistorySource interface {
	DiscoverChats(context.Context, bool) ([]domain.Chat, error)
	HistoryPage(context.Context, domain.Chat, string) (events []domain.IncomingEvent, nextCursor string, end bool, err error)
}

type SyncSummary struct {
	ChatsDiscovered int   `json:"chats_discovered"`
	ChatsComplete   int   `json:"chats_complete"`
	MessagesSeen    int64 `json:"messages_seen"`
}

// SyncAll deliberately processes one conversation at a time. That gives each
// chat a durable checkpoint and prevents concurrent history requests from
// racing or causing WhatsApp to evict the selected conversation.
func (s *Service) SyncAll(ctx context.Context, source HistorySource) (SyncSummary, error) {
	var summary SyncSummary
	for _, archived := range []bool{false, true} {
		chats, err := source.DiscoverChats(ctx, archived)
		if err != nil {
			return summary, fmt.Errorf("discover archived=%t: %w", archived, err)
		}
		summary.ChatsDiscovered += len(chats)
		for _, chat := range chats {
			chat.Archived = archived
			state := domain.HistorySync{ChatID: chat.ID, Status: domain.HistoryRunning}
			if err := s.UpdateHistory(ctx, state); err != nil {
				return summary, err
			}
			cursor := ""
			for {
				if err := ctx.Err(); err != nil {
					state.Status = domain.HistoryPartial
					state.LastError = err.Error()
					_ = s.UpdateHistory(context.Background(), state)
					return summary, err
				}
				events, next, end, err := source.HistoryPage(ctx, chat, cursor)
				if err != nil {
					state.Status = domain.HistoryFailed
					state.LastError = err.Error()
					_ = s.UpdateHistory(ctx, state)
					return summary, fmt.Errorf("history %s: %w", chat.ID, err)
				}
				if next == cursor && !end {
					state.Status = domain.HistoryFailed
					state.LastError = "history cursor did not advance"
					_ = s.UpdateHistory(ctx, state)
					return summary, fmt.Errorf("history %s cursor stalled", chat.ID)
				}
				for _, event := range events {
					event.Chat.Archived = archived
					if _, err = s.Ingest(ctx, event); err != nil {
						return summary, fmt.Errorf("ingest history %s: %w", chat.ID, err)
					}
					state.MessagesSeen++
					summary.MessagesSeen++
				}
				if state.NewestCursor == "" {
					state.NewestCursor = next
				}
				state.OldestCursor = next
				state.HistoryEndHit = end
				if end {
					state.Status = domain.HistoryComplete
					if err = s.UpdateHistory(ctx, state); err != nil {
						return summary, err
					}
					summary.ChatsComplete++
					break
				}
				cursor = next
				if err = s.UpdateHistory(ctx, state); err != nil {
					return summary, err
				}
			}
		}
	}
	return summary, nil
}
