package bridge

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"sync"
	"time"
)

var ErrOutboundDisabled = errors.New("outbound messaging is disabled")
var ErrApprovalInvalid = errors.New("approval token is invalid, expired, used, or does not match the exact message")
var ErrStaleTarget = errors.New("the latest message changed; review the conversation again")
var ErrIdempotencyConflict = errors.New("this send attempt key was already used")
var ErrAmbiguousOutcome = errors.New("the prior send outcome is ambiguous; do not retry blindly")

type approval struct {
	recipient, hash, target, idempotency string
	expires                              time.Time
}
type ApprovalTokens struct {
	mu     sync.Mutex
	tokens map[string]approval
}

func NewApprovalTokens() *ApprovalTokens { return &ApprovalTokens{tokens: map[string]approval{}} }
func bodyHash(body string) string {
	sum := sha256.Sum256([]byte(body))
	return hex.EncodeToString(sum[:])
}
func randomID() string {
	v := make([]byte, 24)
	_, _ = rand.Read(v)
	return base64.RawURLEncoding.EncodeToString(v)
}
func (a *ApprovalTokens) Issue(recipient, body, target, idempotency string, ttl time.Duration) (string, error) {
	if recipient == "" || body == "" || target == "" || idempotency == "" || ttl <= 0 || ttl > 5*time.Minute {
		return "", ErrApprovalInvalid
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	token := randomID()
	a.tokens[token] = approval{recipient: recipient, hash: bodyHash(body), target: target, idempotency: idempotency, expires: time.Now().Add(ttl)}
	return token, nil
}
func (a *ApprovalTokens) Consume(token, recipient, body, target, idempotency string, now time.Time) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	v, ok := a.tokens[token]
	delete(a.tokens, token)
	if !ok || now.After(v.expires) || v.recipient != recipient || v.hash != bodyHash(body) || v.target != target || v.idempotency != idempotency {
		return ErrApprovalInvalid
	}
	return nil
}
