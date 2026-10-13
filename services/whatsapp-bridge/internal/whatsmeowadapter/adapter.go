// Package whatsmeowadapter is the dependency seam for a linked-device client.
// It intentionally does not import whatsmeow in the default build. A reviewed
// production package can wrap *whatsmeow.Client behind Client without exposing
// the rest of the application to protocol-specific structs.
package whatsmeowadapter

import (
	"context"
	"errors"
	"strings"
	"time"

	"mycrobo/whatsapp-bridge/internal/bridge"
	"mycrobo/whatsapp-bridge/internal/domain"
)

type RawMessage struct {
	ID             string
	ChatJID        string
	ChatLID        string
	SenderJID      string
	SenderLID      string
	SenderPhone    string
	ChatTitle      string
	FromMe         bool
	IsGroup        bool
	Archived       bool
	Type           string
	Text           string
	Timestamp      time.Time
	TimestampKnown bool
}

type RawChat struct {
	JID      string
	LID      string
	Title    string
	IsGroup  bool
	Archived bool
}

type Client interface {
	// A production implementation wraps a persistent whatsmeow device store.
	// None of these lifecycle methods are called by the default executable.
	Connect(context.Context) error
	Disconnect()
	Events() <-chan RawMessage
	DiscoverChats(context.Context, bool) ([]RawChat, error)
	HistoryPage(context.Context, RawChat, string) ([]RawMessage, string, bool, error)
	ConnectionState(context.Context) string
	SendText(context.Context, string, string) (string, error)
}

type Adapter struct {
	client  Client
	service *bridge.Service
}

func New(client Client, service *bridge.Service) *Adapter {
	return &Adapter{client: client, service: service}
}

// OutboundTransport is intentionally constructed separately so the service
// can own the only path to Client.SendText while Adapter owns ingestion.
type OutboundTransport struct{ client Client }

func NewOutboundTransport(client Client) *OutboundTransport {
	return &OutboundTransport{client: client}
}
func (t *OutboundTransport) ConnectionState(ctx context.Context) string {
	return t.client.ConnectionState(ctx)
}
func (t *OutboundTransport) SendText(ctx context.Context, to, body, _ string) (bridge.SendReceipt, error) {
	id, err := t.client.SendText(ctx, to, body)
	if err != nil {
		return bridge.SendReceipt{}, err
	}
	return bridge.SendReceipt{MessageID: id, AcceptedAt: time.Now().UTC()}, nil
}

// Run is the explicit linked-device event pump. Keeping it separate from New
// guarantees that constructing or testing the adapter cannot connect an account.
func (a *Adapter) Run(ctx context.Context) error {
	if err := a.client.Connect(ctx); err != nil {
		return err
	}
	defer a.client.Disconnect()
	for {
		select {
		case raw, ok := <-a.client.Events():
			if !ok {
				return nil
			}
			if _, err := a.HandleLinkedDeviceEvent(ctx, raw); err != nil {
				return err
			}
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func (a *Adapter) DiscoverChats(ctx context.Context, archived bool) ([]domain.Chat, error) {
	raw, err := a.client.DiscoverChats(ctx, archived)
	if err != nil {
		return nil, err
	}
	out := make([]domain.Chat, 0, len(raw))
	for _, v := range raw {
		out = append(out, domain.Chat{ID: domain.NormalizeAlias(v.JID), Title: v.Title, IsGroup: v.IsGroup, Archived: archived})
	}
	return out, nil
}

func (a *Adapter) HistoryPage(ctx context.Context, chat domain.Chat, cursor string) ([]domain.IncomingEvent, string, bool, error) {
	rawChat := RawChat{JID: chat.ID, Title: chat.Title, IsGroup: chat.IsGroup, Archived: chat.Archived}
	items, next, end, err := a.client.HistoryPage(ctx, rawChat, cursor)
	if err != nil {
		return nil, "", false, err
	}
	out := make([]domain.IncomingEvent, 0, len(items))
	for _, item := range items {
		event, err := Normalize(item)
		if err != nil {
			return nil, "", false, err
		}
		event.Chat.Archived = chat.Archived
		out = append(out, event)
	}
	return out, next, end, nil
}

func (a *Adapter) HandleLinkedDeviceEvent(ctx context.Context, raw RawMessage) (bool, error) {
	event, err := Normalize(raw)
	if err != nil {
		return false, err
	}
	return a.service.Ingest(ctx, event)
}

func Normalize(raw RawMessage) (domain.IncomingEvent, error) {
	if strings.TrimSpace(raw.ID) == "" || strings.TrimSpace(raw.ChatJID) == "" {
		return domain.IncomingEvent{}, errors.New("source message id and chat jid are required")
	}
	now := time.Now().UTC()
	chatIdentity := domain.Identity{LID: raw.ChatLID, PhoneJID: raw.ChatJID, Name: raw.ChatTitle, UpdatedAt: now}
	senderIdentity := domain.Identity{LID: raw.SenderLID, PhoneJID: raw.SenderJID, Phone: raw.SenderPhone, UpdatedAt: now}
	kind, replyable := classify(raw.Type, raw.Text, raw.TimestampKnown)
	sourceID := domain.NormalizeAlias(raw.ChatJID)
	return domain.IncomingEvent{ChatIdentity: chatIdentity, SenderIdentity: senderIdentity, Chat: domain.Chat{ID: sourceID, SourceID: sourceID, Title: raw.ChatTitle, IsGroup: raw.IsGroup, Archived: raw.Archived, UpdatedAt: now}, Message: domain.Message{ID: raw.ID, SourceMessageID: raw.ID, FromMe: raw.FromMe, Kind: kind, Text: strings.TrimSpace(raw.Text), Timestamp: raw.Timestamp.UTC(), TimestampKnown: raw.TimestampKnown, Replyable: replyable, RawType: raw.Type}}, nil
}

func classify(rawType, text string, timestampKnown bool) (domain.MessageKind, bool) {
	t := strings.ToLower(strings.TrimSpace(rawType))
	body := strings.ToLower(strings.TrimSpace(text))
	switch {
	case strings.Contains(t, "reaction"):
		return domain.MessageReaction, false
	case strings.Contains(t, "call"):
		return domain.MessageCall, false
	case strings.Contains(t, "revoke") || strings.Contains(t, "deleted") || body == "you deleted this message" || body == "this message was deleted":
		return domain.MessageDeleted, false
	case strings.Contains(t, "view_once"):
		return domain.MessageViewOnce, false
	case strings.Contains(t, "image"):
		return domain.MessageImage, false
	case strings.Contains(t, "video"):
		return domain.MessageVideo, false
	case strings.Contains(t, "audio"):
		return domain.MessageAudio, false
	case strings.Contains(t, "document"):
		return domain.MessageDocument, false
	case strings.Contains(t, "sticker"):
		return domain.MessageSticker, false
	case strings.Contains(t, "protocol") || strings.Contains(t, "system"):
		return domain.MessageSystem, false
	case timestampKnown && strings.TrimSpace(text) != "":
		return domain.MessageText, true
	default:
		return domain.MessageSystem, false
	}
}
