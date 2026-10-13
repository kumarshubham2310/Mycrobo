package store

import (
	"context"
	"errors"

	"mycrobo/whatsapp-bridge/internal/domain"
)

var ErrConversationStateNotFound = errors.New("conversation state not found")

type Repository interface {
	UpsertIdentity(context.Context, domain.Identity) (domain.Identity, error)
	GetIdentity(context.Context, domain.CanonicalID) (domain.Identity, error)
	UpsertChat(context.Context, domain.Chat) error
	InsertMessage(context.Context, domain.Message) (bool, error)
	AppendMessageEvent(context.Context, domain.MessageEvent) (bool, error)
	ListMessageEvents(context.Context, string, int64, int) ([]domain.MessageEvent, error)
	ConversationRevision(context.Context, string) (ConversationRevision, error)
	PutConversationState(context.Context, domain.ConversationState) error
	GetConversationState(context.Context, string) (domain.ConversationState, error)
	ListConversationStates(context.Context, int) ([]domain.ConversationState, error)
	PutMedia(context.Context, domain.MediaAsset) error
	GetMedia(context.Context, string) (domain.MediaAsset, error)
	ListChats(context.Context, bool, int, string) ([]domain.Chat, error)
	GetChat(context.Context, string) (domain.Chat, error)
	SearchChats(context.Context, bool, string, int) ([]domain.Chat, error)
	ListOwnerTextMessages(context.Context, string, int) ([]domain.Message, error)
	ListResponseEpisodes(context.Context, int) ([]domain.ResponseEpisode, error)
	ListMessages(context.Context, string, int, string) ([]domain.Message, error)
	LatestMessage(context.Context, string) (domain.Message, error)
	LatestSourceMessage(context.Context, string) (domain.Message, error)
	OldestMessage(context.Context, string) (domain.Message, error)
	PutHistory(context.Context, domain.HistorySync) error
	GetHistory(context.Context, string) (domain.HistorySync, error)
	GetHistoryCoverage(context.Context, string) (domain.HistoryCoverage, error)
	AppendOutboundAudit(context.Context, domain.OutboundAudit) error
	LatestOutboundAudit(context.Context, string) (domain.OutboundAudit, error)
	SaveImportConsent(context.Context, domain.ImportConsent) error
	LatestImportConsent(context.Context) (domain.ImportConsent, error)
}
