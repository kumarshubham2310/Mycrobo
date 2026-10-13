package mock

import (
	"context"
	"errors"
	"sync"
	"time"

	"mycrobo/whatsapp-bridge/internal/bridge"
)

type Sent struct{ Recipient, Body, IdempotencyKey string }
type Transport struct {
	mu            sync.Mutex
	Messages      []Sent
	Fail          bool
	IncompleteAck bool
}

func (t *Transport) ConnectionState(context.Context) string { return "current-read-only" }
func (t *Transport) SendText(_ context.Context, r, b, key string) (bridge.SendReceipt, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.Messages = append(t.Messages, Sent{r, b, key})
	if t.Fail {
		return bridge.SendReceipt{}, errors.New("mock network outcome unknown")
	}
	if t.IncompleteAck {
		return bridge.SendReceipt{MessageID: "mock-message-id"}, nil
	}
	return bridge.SendReceipt{MessageID: "mock-message-id", AcceptedAt: time.Now().UTC()}, nil
}
func (t *Transport) Count() int { t.mu.Lock(); defer t.mu.Unlock(); return len(t.Messages) }
