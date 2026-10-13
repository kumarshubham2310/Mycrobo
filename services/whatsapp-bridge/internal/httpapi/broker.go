package httpapi

import (
	"encoding/json"
	"sync"

	"mycrobo/whatsapp-bridge/internal/bridge"
)

type Broker struct {
	mu          sync.RWMutex
	next        int
	subscribers map[int]chan []byte
}

func NewBroker() *Broker { return &Broker{subscribers: map[int]chan []byte{}} }
func (b *Broker) Publish(e bridge.Event) {
	data, err := json.Marshal(e)
	if err != nil {
		return
	}
	b.mu.RLock()
	defer b.mu.RUnlock()
	for _, ch := range b.subscribers {
		select {
		case ch <- data:
		default:
		}
	}
}
func (b *Broker) subscribe() (int, <-chan []byte) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.next++
	ch := make(chan []byte, 32)
	b.subscribers[b.next] = ch
	return b.next, ch
}
func (b *Broker) unsubscribe(id int) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if ch, ok := b.subscribers[id]; ok {
		delete(b.subscribers, id)
		close(ch)
	}
}
