package whatsmeowlive

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	_ "github.com/ncruces/go-sqlite3/driver"
	_ "github.com/ncruces/go-sqlite3/vfs/adiantum"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waCompanionReg"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/proto/waHistorySync"
	waStore "go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/store/sqlstore"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"

	"mycrobo/whatsapp-bridge/internal/bridge"
	"mycrobo/whatsapp-bridge/internal/domain"
	"mycrobo/whatsapp-bridge/internal/store"
)

func init() {
	waStore.SetOSInfo("Windows", [3]uint32{10, 0, 19045})
	waStore.DeviceProps.PlatformType = waCompanionReg.DeviceProps_CHROME.Enum()
}

type PairingSnapshot struct {
	State       string    `json:"state"`
	Code        string    `json:"code,omitempty"`
	PhoneCode   string    `json:"phone_code,omitempty"`
	PhoneMasked string    `json:"phone_masked,omitempty"`
	ExpiresAt   time.Time `json:"expires_at,omitempty"`
	FailureCode string    `json:"failure_code,omitempty"`
	Retryable   bool      `json:"retryable,omitempty"`
	Error       string    `json:"error,omitempty"`
}

type FreshnessSnapshot struct {
	State           string                      `json:"state"`
	CaughtUpAt      *time.Time                  `json:"caught_up_at,omitempty"`
	AccountID       string                      `json:"account_id,omitempty"`
	ConnectionEpoch string                      `json:"connection_epoch,omitempty"`
	StoredAccountID string                      `json:"stored_account_id,omitempty"`
	AccountProof    string                      `json:"account_proof,omitempty"`
	Verification    AccountVerificationSnapshot `json:"account_verification"`
}

// AccountVerificationSnapshot is deliberately content-free: it reports only
// which authenticated identifier forms were available and which proof gate
// failed. It never exposes a phone number, LID, account hash or chat content.
type AccountVerificationSnapshot struct {
	State                   string `json:"state"`
	Failure                 string `json:"failure,omitempty"`
	ExpectedOwnerConfigured bool   `json:"expected_owner_configured"`
	ExpectedOwnerMatched    bool   `json:"expected_owner_matched"`
	AuthenticatedAliasCount int    `json:"authenticated_alias_count"`
	HasPhoneAlias           bool   `json:"has_phone_alias"`
	HasLIDAlias             bool   `json:"has_lid_alias"`
}

type onDemandResult struct {
	ChatID   string
	Inserted int64
	End      bool
	Err      error
}

type historyPeer interface {
	BuildHistorySyncRequest(*types.MessageInfo, int) *waE2E.Message
	SendPeerMessage(context.Context, *waE2E.Message) (whatsmeow.SendResponse, error)
}

// Live owns the linked-device session and inbound event ingestion. Text sending
// is reachable only through Service's exact approval and audit boundary.
type Live struct {
	client                 *whatsmeow.Client
	historyPeer            historyPeer
	container              *sqlstore.Container
	service                *bridge.Service
	mu                     sync.RWMutex
	connectMu              sync.Mutex
	pairMu                 sync.Mutex
	pairing                PairingSnapshot
	latestQR               PairingSnapshot
	pairingDeadline        time.Time
	pairingSequence        uint64
	state                  string
	connectionEpoch        string
	boundAccountID         string
	accountProof           string
	expectedAccountScopeID string
	accountVerification    AccountVerificationSnapshot
	caughtUpAt             *time.Time
	lastHistoryAt          time.Time
	runCtx                 context.Context
	waitMu                 sync.Mutex
	waiters                map[string]chan onDemandResult
	backfillStarted        atomic.Bool
	mediaQueue             chan mediaJob
}

func (l *Live) SetExpectedAccountScopeID(value string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if decoded, err := hex.DecodeString(strings.TrimSpace(value)); err == nil && len(decoded) == 32 {
		l.expectedAccountScopeID = strings.ToLower(strings.TrimSpace(value))
	}
}

func Open(ctx context.Context, sessionPath string, service *bridge.Service) (*Live, error) {
	return open(ctx, sessionPath, service, "")
}

func OpenEncrypted(ctx context.Context, sessionPath string, service *bridge.Service, hexKey string) (*Live, error) {
	if decoded, decodeErr := hex.DecodeString(hexKey); decodeErr != nil || len(decoded) != 32 {
		return nil, errors.New("open encrypted linked-device store: a 32-byte key is required")
	}
	return open(ctx, sessionPath, service, hexKey)
}

func open(ctx context.Context, sessionPath string, service *bridge.Service, hexKey string) (*Live, error) {
	abs, err := filepath.Abs(sessionPath)
	if err != nil {
		return nil, fmt.Errorf("resolve session path: %w", err)
	}
	query := url.Values{}
	query.Add("_pragma", "foreign_keys(1)")
	query.Add("_pragma", "busy_timeout(5000)")
	query.Add("_pragma", "journal_mode(WAL)")
	query.Add("_pragma", "temp_store(memory)")
	if hexKey != "" {
		query.Set("vfs", "adiantum")
		query.Set("hexkey", hexKey)
	}
	dsn := (&url.URL{Scheme: "file", Opaque: filepath.ToSlash(abs), RawQuery: query.Encode()}).String()
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, fmt.Errorf("open linked-device store: %w", err)
	}
	db.SetMaxOpenConns(1)
	container := sqlstore.NewWithDB(db, "sqlite3", nil)
	if err = container.Upgrade(ctx); err != nil {
		_ = container.Close()
		return nil, fmt.Errorf("upgrade linked-device store: %w", err)
	}
	device, err := container.GetFirstDevice(ctx)
	if err != nil {
		_ = container.Close()
		return nil, fmt.Errorf("load linked device: %w", err)
	}
	client := whatsmeow.NewClient(device, nil)
	live := &Live{client: client, historyPeer: client, container: container, service: service, state: "offline", waiters: make(map[string]chan onDemandResult), mediaQueue: make(chan mediaJob, 256)}
	live.client.AddEventHandler(func(raw any) { live.handleClientEvent(client, raw) })
	for range 2 {
		go live.runMediaWorker(ctx)
	}
	if device.ID == nil {
		live.pairing = PairingSnapshot{State: "unpaired"}
	} else {
		live.pairing = PairingSnapshot{State: "paired"}
	}
	return live, nil
}

func (l *Live) Close() error {
	l.client.Disconnect()
	return l.container.Close()
}

func (l *Live) Pairing() PairingSnapshot {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.pairing
}

var (
	pairingPhoneDigits  = regexp.MustCompile(`^\d{7,15}$`)
	pairingPhoneDisplay = regexp.MustCompile(`^[+0-9 ().-]+$`)
)

// NormalizePairingPhone accepts an international number, removes display-only
// punctuation and rejects national/trunk-prefixed values. The normalized
// number is used only to request a one-time WhatsApp linking code and is never
// written to MyCrobo's message or settings stores.
func NormalizePairingPhone(value string) (string, error) {
	if !pairingPhoneDisplay.MatchString(strings.TrimSpace(value)) {
		return "", errors.New("phone number contains unsupported characters")
	}
	digits := strings.Map(func(character rune) rune {
		if character >= '0' && character <= '9' {
			return character
		}
		return -1
	}, strings.TrimSpace(value))
	if !pairingPhoneDigits.MatchString(digits) {
		return "", errors.New("enter a valid international phone number")
	}
	if strings.HasPrefix(digits, "0") {
		return "", errors.New("use the international country code without a leading zero")
	}
	return digits, nil
}

func maskedPairingPhone(digits string) string {
	visible := digits
	if len(visible) > 4 {
		visible = visible[len(visible)-4:]
	}
	return "•••• " + visible
}

const (
	pairingSessionLifetime = 155 * time.Second
	pairingMinimumLifetime = 45 * time.Second
	pairingReadyTimeout    = 15 * time.Second
)

func pairingFailure(err error) PairingSnapshot {
	message := strings.ToLower(err.Error())
	snapshot := PairingSnapshot{State: "retryable-error", FailureCode: "provider-unavailable", Retryable: true, Error: "WhatsApp could not create a linking code. Start a fresh connection and try again."}
	switch {
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded), strings.Contains(message, "timeout"):
		snapshot.FailureCode = "provider-timeout"
		snapshot.Error = "WhatsApp did not answer in time. Start a fresh connection and try again."
	case strings.Contains(message, "429"), strings.Contains(message, "rate"), strings.Contains(message, "too many"):
		snapshot.FailureCode = "rate-limited"
		snapshot.Error = "WhatsApp temporarily limited linking attempts. Wait a few minutes before trying again."
	case strings.Contains(message, "client outdated"), strings.Contains(message, "client-outdated"):
		snapshot.State = "blocked-error"
		snapshot.FailureCode = "client-outdated"
		snapshot.Retryable = false
		snapshot.Error = "This WhatsApp connector must be updated before it can link again."
	case strings.Contains(message, "400"), strings.Contains(message, "bad request"):
		snapshot.FailureCode = "provider-rejected"
		snapshot.Error = "WhatsApp rejected this linking request. Check the complete international number, then start a fresh connection."
	case strings.Contains(message, "network"), strings.Contains(message, "connect"), strings.Contains(message, "socket"), strings.Contains(message, "eof"):
		snapshot.FailureCode = "network-unavailable"
		snapshot.Error = "The secure WhatsApp connection was interrupted. Check the internet connection and try again."
	}
	return snapshot
}

func (l *Live) setPairingSnapshot(snapshot PairingSnapshot) {
	l.mu.Lock()
	l.pairing = snapshot
	l.mu.Unlock()
}

func (l *Live) pairingSessionUsable() bool {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.client != nil && l.client.IsConnected() && time.Until(l.pairingDeadline) >= pairingMinimumLifetime && (l.pairing.State == "scan-required" || l.pairing.State == "phone-code")
}

// PairPhone requests WhatsApp's real one-time eight-character companion code.
// It requires the already-open linking socket established by Start.
func (l *Live) PairPhone(ctx context.Context, phone string) (PairingSnapshot, error) {
	l.pairMu.Lock()
	defer l.pairMu.Unlock()
	normalized, err := NormalizePairingPhone(phone)
	if err != nil {
		return PairingSnapshot{}, err
	}
	if l.client.Store.ID != nil {
		return PairingSnapshot{}, errors.New("this MyCrobo device is already linked")
	}
	if !l.pairingSessionUsable() {
		if err = l.restartPairingSession(ctx); err != nil {
			failure := pairingFailure(err)
			l.setPairingSnapshot(failure)
			return failure, errors.New(failure.Error)
		}
	}
	code, err := l.client.PairPhone(ctx, normalized, true, whatsmeow.PairClientChrome, "Chrome (Windows)")
	if err != nil {
		failure := pairingFailure(err)
		l.setPairingSnapshot(failure)
		return failure, errors.New(failure.Error)
	}
	l.mu.RLock()
	deadline := l.pairingDeadline
	l.mu.RUnlock()
	expiresAt := time.Now().UTC().Add(150 * time.Second)
	if !deadline.IsZero() && deadline.Before(expiresAt) {
		expiresAt = deadline
	}
	snapshot := PairingSnapshot{
		State:       "phone-code",
		PhoneCode:   code,
		PhoneMasked: maskedPairingPhone(normalized),
		ExpiresAt:   expiresAt,
	}
	l.mu.Lock()
	l.pairing = snapshot
	l.mu.Unlock()
	return snapshot, nil
}

// UseQR restores the newest live QR payload without restarting the connector.
func (l *Live) UseQR(ctx context.Context) (PairingSnapshot, error) {
	l.pairMu.Lock()
	defer l.pairMu.Unlock()
	if l.client.Store.ID != nil {
		l.mu.RLock()
		currentState := l.state
		l.mu.RUnlock()
		if currentState == "reauth-required" || currentState == "account-verification-required" || currentState == "offline" {
			l.pairMu.Unlock()
			err := l.Logout(ctx)
			l.pairMu.Lock()
			if err != nil {
				return PairingSnapshot{}, err
			}
			return l.Pairing(), nil
		}
		return PairingSnapshot{}, errors.New("this MyCrobo device is already linked")
	}
	l.mu.RLock()
	latest := l.latestQR
	l.mu.RUnlock()
	if !l.client.IsConnected() || latest.State != "scan-required" || latest.Code == "" || (!latest.ExpiresAt.IsZero() && time.Until(latest.ExpiresAt) < 5*time.Second) {
		if err := l.restartPairingSession(ctx); err != nil {
			failure := pairingFailure(err)
			l.setPairingSnapshot(failure)
			return failure, errors.New(failure.Error)
		}
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.latestQR.State != "scan-required" || l.latestQR.Code == "" {
		return PairingSnapshot{}, errors.New("a fresh WhatsApp QR code is not ready yet")
	}
	l.pairing = l.latestQR
	return l.pairing, nil
}

// RestartPairing discards an expired unpaired login socket and waits for a
// provider-confirmed replacement. It never deletes stored chats and never
// sends a message.
func (l *Live) RestartPairing(ctx context.Context) (PairingSnapshot, error) {
	l.pairMu.Lock()
	defer l.pairMu.Unlock()
	if l.client.Store.ID != nil {
		l.mu.RLock()
		currentState := l.state
		l.mu.RUnlock()
		if currentState == "reauth-required" || currentState == "account-verification-required" || currentState == "offline" {
			l.pairMu.Unlock()
			err := l.Logout(ctx)
			l.pairMu.Lock()
			if err != nil {
				return PairingSnapshot{}, err
			}
			return l.Pairing(), nil
		}
		return PairingSnapshot{}, errors.New("this MyCrobo device is already linked")
	}
	if err := l.restartPairingSession(ctx); err != nil {
		failure := pairingFailure(err)
		l.setPairingSnapshot(failure)
		return failure, errors.New(failure.Error)
	}
	return l.Pairing(), nil
}

// Logout removes this MyCrobo companion from WhatsApp and replaces the
// invalidated in-memory device with a fresh, unpaired client. The normalized
// message database is intentionally untouched so saved local history remains
// available while the user reconnects.
func (l *Live) Logout(ctx context.Context) error {
	l.mu.RLock()
	client := l.client
	runCtx := l.runCtx
	l.mu.RUnlock()
	if client != nil {
		client.Disconnect()
		if client.Store != nil {
			if client.Store.ID != nil {
				_ = client.Logout(ctx)
			}
			_ = client.Store.Delete(ctx)
		}
	}
	if l.container != nil {
		if devices, err := l.container.GetAllDevices(ctx); err == nil {
			for _, dev := range devices {
				_ = dev.Delete(ctx)
			}
		}
	}
	var replacement *whatsmeow.Client
	if l.container != nil {
		replacement = whatsmeow.NewClient(l.container.NewDevice(), nil)
		replacement.AddEventHandler(func(raw any) { l.handleClientEvent(replacement, raw) })
	}
	l.mu.Lock()
	l.client = replacement
	l.historyPeer = replacement
	l.pairing = PairingSnapshot{State: "unpaired"}
	l.latestQR = PairingSnapshot{}
	l.state = "offline"
	l.caughtUpAt = nil
	l.lastHistoryAt = time.Time{}
	l.boundAccountID = ""
	l.accountProof = ""
	l.accountVerification = AccountVerificationSnapshot{State: "unverified"}
	l.mu.Unlock()
	if replacement != nil && runCtx != nil && runCtx.Err() == nil {
		l.mu.Lock()
		l.state = "connecting"
		l.mu.Unlock()
		if err := l.connectClient(runCtx, replacement); err != nil {
			return fmt.Errorf("WhatsApp logged out, but a fresh linking session could not start: %w", err)
		}
	}
	return nil
}

func (l *Live) ConnectionState(_ context.Context) string {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.state
}

func outboundMessageID(idempotencyKey string) string {
	sum := sha256.Sum256([]byte(idempotencyKey))
	return strings.ToUpper(hex.EncodeToString(sum[:16]))
}

func (l *Live) SendText(ctx context.Context, sourceJID, body, idempotencyKey string) (bridge.SendReceipt, error) {
	client, bindingErr := l.currentAccountClient(ctx)
	if bindingErr != nil {
		return bridge.SendReceipt{}, bindingErr
	}
	if l.ConnectionState(ctx) != "current-read-only" {
		return bridge.SendReceipt{}, errors.New("WhatsApp is not current")
	}
	to, err := types.ParseJID(strings.TrimSpace(sourceJID))
	if err != nil || to.IsEmpty() || to.Device > 0 {
		return bridge.SendReceipt{}, errors.New("recipient address is invalid")
	}
	response, err := client.SendMessage(ctx, to, &waE2E.Message{Conversation: proto.String(body)}, whatsmeow.SendRequestExtra{
		ID:      outboundMessageID(idempotencyKey),
		Timeout: 30 * time.Second,
	})
	if err != nil {
		return bridge.SendReceipt{}, err
	}
	senderID := domain.CanonicalID("owner")
	if client.Store.ID != nil {
		if canonical, canonicalErr := domain.CanonicalIdentityID(client.Store.LID.ToNonAD().String(), client.Store.ID.ToNonAD().String(), client.Store.ID.User); canonicalErr == nil {
			senderID = canonical
		}
	}
	return bridge.SendReceipt{MessageID: response.ID, AcceptedAt: response.Timestamp.UTC(), SenderID: senderID}, nil
}

func (l *Live) Freshness() FreshnessSnapshot {
	l.mu.RLock()
	defer l.mu.RUnlock()
	value := FreshnessSnapshot{State: l.state, CaughtUpAt: l.caughtUpAt, ConnectionEpoch: l.connectionEpoch, StoredAccountID: l.boundAccountID, AccountProof: l.accountProof, Verification: l.accountVerification}
	if l.client == nil || l.client.Store == nil || l.client.Store.ID == nil {
		if value.State == "current-read-only" || value.State == "catching-up" {
			value.State = "offline"
			value.CaughtUpAt = nil
		}
		return value
	}
	sum := sha256.Sum256([]byte(l.client.Store.ID.ToNonAD().String()))
	value.AccountID = hex.EncodeToString(sum[:])
	if !l.client.IsConnected() && value.State == "current-read-only" {
		value.State = "offline"
		value.CaughtUpAt = nil
	}
	return value
}

func (l *Live) Start(ctx context.Context) error {
	l.mu.Lock()
	l.state = "connecting"
	l.runCtx = ctx
	client := l.client
	l.mu.Unlock()
	if err := l.connectClient(ctx, client); err != nil {
		return err
	}
	defer client.Disconnect()
	<-ctx.Done()
	l.setState("offline")
	return ctx.Err()
}

func (l *Live) connectClient(ctx context.Context, client *whatsmeow.Client) error {
	l.connectMu.Lock()
	defer l.connectMu.Unlock()
	return l.connectClientLocked(ctx, client)
}

func (l *Live) connectClientLocked(ctx context.Context, client *whatsmeow.Client) error {
	if client.Store.ID == nil {
		qr, err := client.GetQRChannel(ctx)
		if err != nil {
			return err
		}
		now := time.Now().UTC()
		l.mu.Lock()
		l.pairingSequence++
		sequence := l.pairingSequence
		l.pairingDeadline = now.Add(pairingSessionLifetime)
		l.pairing = PairingSnapshot{State: "preparing"}
		l.latestQR = PairingSnapshot{}
		l.state = "connecting"
		l.mu.Unlock()
		go l.consumePairing(ctx, qr, sequence)
	}
	if err := client.Connect(); err != nil {
		l.setState("error")
		return err
	}
	return nil
}

func (l *Live) restartPairingSession(ctx context.Context) error {
	l.connectMu.Lock()
	defer l.connectMu.Unlock()
	l.mu.RLock()
	client := l.client
	l.mu.RUnlock()
	if client == nil || client.Store == nil || client.Store.ID != nil {
		return errors.New("a new WhatsApp linking session is unavailable")
	}
	// Invalidate the previous consumer before Disconnect can emit its terminal
	// event. Otherwise an expired channel can overwrite the new pairing state.
	now := time.Now().UTC()
	l.mu.Lock()
	l.pairingSequence++
	sequence := l.pairingSequence
	l.pairingDeadline = now.Add(pairingSessionLifetime)
	l.pairing = PairingSnapshot{State: "preparing"}
	l.latestQR = PairingSnapshot{}
	l.state = "connecting"
	l.mu.Unlock()
	client.Disconnect()
	replacement := whatsmeow.NewClient(l.container.NewDevice(), nil)
	replacement.AddEventHandler(func(raw any) { l.handleClientEvent(replacement, raw) })
	l.mu.Lock()
	l.client = replacement
	l.historyPeer = replacement
	l.mu.Unlock()
	client = replacement

	qr, err := client.GetQRChannel(ctx)
	if err != nil {
		return err
	}
	go l.consumePairing(ctx, qr, sequence)
	if err = client.Connect(); err != nil {
		return err
	}
	return l.waitForPairingReady(ctx, sequence)
}

func (l *Live) waitForPairingReady(ctx context.Context, sequence uint64) error {
	waitCtx, cancel := context.WithTimeout(ctx, pairingReadyTimeout)
	defer cancel()
	ticker := time.NewTicker(50 * time.Millisecond)
	defer ticker.Stop()
	for {
		l.mu.RLock()
		currentSequence := l.pairingSequence
		snapshot := l.pairing
		l.mu.RUnlock()
		if currentSequence != sequence {
			return errors.New("the WhatsApp linking session changed while it was preparing")
		}
		if snapshot.State == "scan-required" && snapshot.Code != "" && l.client.IsConnected() {
			return nil
		}
		if snapshot.State == "blocked-error" || snapshot.State == "retryable-error" || snapshot.State == "expired" {
			return errors.New(snapshot.Error)
		}
		select {
		case <-waitCtx.Done():
			return waitCtx.Err()
		case <-ticker.C:
		}
	}
}

func (l *Live) consumePairing(ctx context.Context, items <-chan whatsmeow.QRChannelItem, sequence uint64) {
	for {
		select {
		case item, ok := <-items:
			if !ok {
				return
			}
			snapshot := PairingSnapshot{State: item.Event}
			if item.Event == "code" {
				snapshot.State = "scan-required"
				snapshot.Code = item.Code
				snapshot.ExpiresAt = time.Now().UTC().Add(item.Timeout)
			} else if item.Event == "success" {
				snapshot.State = "paired"
			} else if item.Event == "timeout" {
				snapshot.State = "expired"
				snapshot.FailureCode = "pairing-session-expired"
				snapshot.Retryable = true
				snapshot.Error = "The WhatsApp linking session expired. Start a fresh connection and try again."
			} else if item.Event == "err-client-outdated" {
				snapshot.State = "blocked-error"
				snapshot.FailureCode = "client-outdated"
				snapshot.Error = "This WhatsApp connector must be updated before it can link again."
			} else if item.Event == "error" || strings.HasPrefix(item.Event, "err-") {
				snapshot.State = "retryable-error"
				snapshot.FailureCode = "provider-pairing-error"
				snapshot.Retryable = true
				snapshot.Error = "WhatsApp could not complete linking. Start a fresh connection and try again."
			}
			if item.Error != nil {
				failure := pairingFailure(item.Error)
				snapshot.State = failure.State
				snapshot.FailureCode = failure.FailureCode
				snapshot.Retryable = failure.Retryable
				snapshot.Error = failure.Error
			}
			l.mu.Lock()
			if l.pairingSequence != sequence {
				l.mu.Unlock()
				continue
			}
			if snapshot.State == "scan-required" {
				l.latestQR = snapshot
			}
			// QR payloads continue rotating while a phone-code flow is active.
			// Keep the newest QR available for an explicit switch, but do not
			// replace the phone code currently being entered on the primary phone.
			if l.pairing.State != "phone-code" || snapshot.State != "scan-required" {
				l.pairing = snapshot
			}
			l.mu.Unlock()
		case <-ctx.Done():
			return
		}
	}
}

func (l *Live) setState(value string) {
	l.mu.Lock()
	l.state = value
	if value != "current-read-only" {
		l.caughtUpAt = nil
		l.connectionEpoch = fmt.Sprintf("%d", time.Now().UnixNano())
	}
	l.mu.Unlock()
}

func (l *Live) handleEvent(raw any) {
	l.mu.RLock()
	client := l.client
	l.mu.RUnlock()
	l.handleClientEvent(client, raw)
}

// authenticatedAccountAliases returns only identifiers proved by the active
// linked-device store. WhatsApp may restore the same account with an LID as
// the primary identifier even though an older workspace was bound to its
// phone JID (or vice versa). The session's signed LID store is the authority
// for that equivalence; display names and message content are never used.
func authenticatedAccountAliases(ctx context.Context, client *whatsmeow.Client) []string {
	if client == nil || client.Store == nil || client.Store.ID == nil {
		return nil
	}
	seen := make(map[string]bool)
	aliases := make([]string, 0, 4)
	add := func(jid types.JID) {
		if jid.IsEmpty() {
			return
		}
		value := strings.ToLower(strings.TrimSpace(jid.ToNonAD().String()))
		if value == "" || seen[value] {
			return
		}
		seen[value] = true
		aliases = append(aliases, value)
	}
	primary := client.Store.ID.ToNonAD()
	add(primary)
	add(client.Store.LID)
	if client.Store.LIDs == nil {
		return aliases
	}
	for _, jid := range []types.JID{primary, client.Store.LID} {
		if jid.IsEmpty() || (jid.Server != types.DefaultUserServer && jid.Server != types.HiddenUserServer) {
			continue
		}
		alternate, err := client.Store.GetAltJID(ctx, jid)
		if err == nil {
			add(alternate)
		}
	}
	return aliases
}

// Persist the authenticated account boundary before imports or readiness. A
// different login never adopts the preserved message database by relabeling it.
func (l *Live) requireAccountBinding(ctx context.Context, client *whatsmeow.Client) error {
	if client == nil || client.Store == nil || client.Store.ID == nil {
		return store.ErrAccountUnbound
	}
	accountJID := client.Store.ID.ToNonAD().String()
	sum := sha256.Sum256([]byte(accountJID))
	accountID := hex.EncodeToString(sum[:])
	aliases := authenticatedAccountAliases(ctx, client)
	l.mu.RLock()
	isCurrent := l.client == client
	cached := l.boundAccountID == accountID && l.accountProof != ""
	expectedAccountScopeID := l.expectedAccountScopeID
	l.mu.RUnlock()
	if !isCurrent {
		return store.ErrAccountConflict
	}
	if cached {
		return nil
	}
	verification := AccountVerificationSnapshot{
		State:                   "checking",
		ExpectedOwnerConfigured: expectedAccountScopeID != "",
		AuthenticatedAliasCount: len(aliases),
	}
	for _, alias := range aliases {
		verification.HasPhoneAlias = verification.HasPhoneAlias || strings.HasSuffix(alias, "@s.whatsapp.net")
		verification.HasLIDAlias = verification.HasLIDAlias || strings.HasSuffix(alias, "@lid")
	}
	repository, ok := l.service.Repository().(store.AccountBindingRepository)
	if !ok {
		return store.ErrAccountUnbound
	}
	trustedOwnerMatch := false
	if expectedAccountScopeID != "" {
		for _, alias := range aliases {
			sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(alias))))
			if hex.EncodeToString(sum[:]) == expectedAccountScopeID {
				trustedOwnerMatch = true
				accountID = expectedAccountScopeID
				break
			}
		}
	}
	verification.ExpectedOwnerMatched = trustedOwnerMatch
	binding, err := repository.BindAccount(ctx, accountID, aliases)
	if err != nil && (trustedOwnerMatch || os.Getenv("MYCROBO_AUTO_REBIND_ACCOUNT") == "true") {
		if repairer, ok := repository.(store.TrustedAccountBindingRepository); ok {
			repairTarget := expectedAccountScopeID
			if repairTarget == "" {
				repairTarget = accountID
			}
			binding, err = repairer.RepairAccountBindingFromTrustedOwner(ctx, repairTarget)
		}
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.client != client {
		return store.ErrAccountConflict
	}
	if err != nil {
		verification.State = "blocked"
		switch {
		case errors.Is(err, store.ErrAccountConflict):
			verification.Failure = "stored-account-conflict"
		case errors.Is(err, store.ErrLegacyAccountUnverified):
			verification.Failure = "legacy-owner-proof-incomplete"
		default:
			verification.Failure = "account-proof-unavailable"
		}
		l.accountVerification = verification
		l.state = "account-verification-required"
		l.caughtUpAt = nil
		l.connectionEpoch = fmt.Sprintf("%d", time.Now().UnixNano())
		return err
	}
	verification.State = "verified"
	l.accountVerification = verification
	l.boundAccountID = binding.AccountScopeID
	l.accountProof = binding.ProofMethod
	return nil
}

func (l *Live) currentAccountClient(ctx context.Context) (*whatsmeow.Client, error) {
	l.mu.RLock()
	client := l.client
	l.mu.RUnlock()
	if err := l.requireAccountBinding(ctx, client); err != nil {
		return nil, err
	}
	return client, nil
}

func (l *Live) handleClientEvent(client *whatsmeow.Client, raw any) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	l.mu.RLock()
	current := l.client == client
	l.mu.RUnlock()
	if !current {
		return
	}
	switch raw.(type) {
	case *events.Connected, *events.OfflineSyncCompleted, *events.Message, *events.HistorySync, *events.Archive:
		if err := l.requireAccountBinding(ctx, client); err != nil {
			return
		}
	}
	switch event := raw.(type) {
	case *events.Connected:
		l.mu.Lock()
		l.connectionEpoch = fmt.Sprintf("%d", time.Now().UnixNano())
		l.state = "catching-up"
		l.caughtUpAt = nil
		l.mu.Unlock()
	case *events.OfflineSyncCompleted:
		now := time.Now().UTC()
		l.mu.Lock()
		l.state = "current-read-only"
		l.caughtUpAt = &now
		runCtx := l.runCtx
		l.mu.Unlock()
		if runCtx != nil && l.backfillStarted.CompareAndSwap(false, true) {
			go l.backfillWhenQuiet(runCtx)
		}
	case *events.Disconnected:
		l.mu.Lock()
		l.connectionEpoch = fmt.Sprintf("%d", time.Now().UnixNano())
		l.state = "offline"
		l.caughtUpAt = nil
		l.mu.Unlock()
	case *events.LoggedOut:
		l.setState("reauth-required")
	case *events.Message:
		_, _ = l.ingestMessage(ctx, event, "", false)
	case *events.HistorySync:
		l.mu.Lock()
		l.lastHistoryAt = time.Now().UTC()
		l.mu.Unlock()
		_ = l.ingestHistory(ctx, event)
	case *events.Archive:
		_ = l.applyArchive(ctx, event.JID, event.Action.GetArchived(), event.Timestamp)
	}
}

func (l *Live) backfillWhenQuiet(ctx context.Context) {
	defer l.backfillStarted.Store(false)
	for {
		select {
		case <-time.After(5 * time.Second):
		case <-ctx.Done():
			return
		}
		l.mu.RLock()
		state := l.state
		lastHistory := l.lastHistoryAt
		l.mu.RUnlock()
		if state != "current-read-only" {
			continue
		}
		if !lastHistory.IsZero() && time.Since(lastHistory) < 5*time.Second {
			continue
		}
		l.backfillAll(ctx)
		// WhatsApp may temporarily decline an older-history request while the
		// phone is busy, offline, or still uploading a page. Keep incomplete
		// conversations resumable in the background instead of permanently
		// leaving them at partial_provider_limit until the desktop restarts.
		select {
		case <-time.After(5 * time.Minute):
		case <-ctx.Done():
			return
		}
	}
}

func (l *Live) isCurrent() bool {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.state == "current-read-only"
}

func (l *Live) ingestMessage(ctx context.Context, event *events.Message, title string, archived bool) (bool, error) {
	client, bindingErr := l.currentAccountClient(ctx)
	if bindingErr != nil {
		return false, bindingErr
	}
	var ownerAliases []types.JID
	if client.Store.ID != nil {
		ownerAliases = append(ownerAliases, *client.Store.ID, client.Store.LID)
	}
	if revision, matched, revisionErr := NormalizeProtocolRevision(event, ownerAliases...); matched {
		if revisionErr != nil {
			if markerErr := l.service.RecordProtocolRevisionIssue(ctx, revision, revisionErr); markerErr != nil {
				return false, markerErr
			}
			return false, revisionErr
		}
		return l.service.ApplyProtocolRevision(ctx, revision)
	}
	if !domain.MeaningfulDisplayName(title) || isRawConnectorGroupTitle(title) {
		if event.Info.Chat.Server == types.GroupServer || event.Info.IsGroup {
			chatKey := domain.NormalizeAlias(event.Info.Chat.ToNonAD().String())
			if existing, err := l.service.Repository().GetChat(ctx, chatKey); err == nil && domain.MeaningfulDisplayName(existing.Title) && !isRawConnectorGroupTitle(existing.Title) {
				title = existing.Title
			} else if client != nil {
				if info, err := client.GetGroupInfo(ctx, event.Info.Chat); err == nil && info != nil && domain.MeaningfulDisplayName(info.GroupName.Name) && !isRawConnectorGroupTitle(info.GroupName.Name) {
					title = info.GroupName.Name
				}
			}
		}
		if !domain.MeaningfulDisplayName(title) || (event.Info.IsGroup && isRawConnectorGroupTitle(title)) {
			title = l.contactName(ctx, event.Info.Chat)
		}
	}
	if settings, err := client.Store.ChatSettings.GetChatSettings(ctx, event.Info.Chat); err == nil && settings.Found {
		archived = settings.Archived
	}
	normalized, err := NormalizeMessage(event, title, archived)
	if err != nil {
		return false, err
	}
	if event.Info.IsGroup && !event.Info.IsFromMe && client.Store.ID != nil {
		normalized.Message.MentionsOwner = contextMentionsAny(event.Message, *client.Store.ID, client.Store.LID) || contextQuotesAny(event.Message, *client.Store.ID, client.Store.LID)
	}
	asset, _, hasMedia := mediaFromMessage(event.Message, normalized.Message.ID)
	if hasMedia {
		metadata := asset.Metadata
		normalized.Message.Media = &metadata
	}
	if err := l.requireAccountBinding(ctx, client); err != nil {
		return false, err
	}
	inserted, err := l.service.Ingest(ctx, normalized)
	if err != nil {
		return false, err
	}
	if hasMedia {
		if mediaErr := l.service.Repository().PutMedia(ctx, asset); mediaErr != nil {
			return inserted, mediaErr
		}
		// Full media is fetched only when the user opens it. Thumbnails and the
		// encrypted download reference are enough for the conversation timeline,
		// and avoiding background downloads keeps a full-history import bounded.
	}
	return inserted, nil
}

func (l *Live) ingestHistory(ctx context.Context, event *events.HistorySync) error {
	client, bindingErr := l.currentAccountClient(ctx)
	if bindingErr != nil {
		return bindingErr
	}
	if event.Data == nil {
		return errors.New("empty history sync")
	}
	for _, conversation := range event.Data.GetConversations() {
		if err := l.requireAccountBinding(ctx, client); err != nil {
			return err
		}
		chat, chatJID, err := l.upsertConversation(ctx, conversation)
		if err != nil {
			return err
		}
		title := firstMeaningfulDisplayName(conversation.GetName(), conversation.GetDisplayName(), l.contactName(ctx, chatJID), chatJID.User)
		state := domain.HistorySync{ChatID: chat.ID, Status: domain.HistoryRunning}
		if prior, getErr := l.service.Repository().GetHistory(ctx, state.ChatID); getErr == nil {
			state = prior
			state.Status = domain.HistoryRunning
			state.LastError = ""
		}
		var inserted int64
		for _, historyMessage := range conversation.GetMessages() {
			parsed, parseErr := client.ParseWebMessage(chatJID, historyMessage.GetMessage())
			if parseErr != nil {
				state.Status = domain.HistoryFailed
				state.LastError = parseErr.Error()
				_ = l.service.UpdateHistory(ctx, state)
				l.notifyOnDemand(onDemandResult{ChatID: state.ChatID, Err: parseErr})
				return parseErr
			}
			var created bool
			if created, err = l.ingestMessage(ctx, parsed, title, conversation.GetArchived()); err != nil {
				l.notifyOnDemand(onDemandResult{ChatID: state.ChatID, Err: err})
				return err
			}
			if created {
				state.MessagesSeen++
				inserted++
			}
		}
		state.OldestCursor = fmt.Sprintf("chunk:%d", event.Data.GetChunkOrder())
		state.NewestCursor = fmt.Sprintf("progress:%d", event.Data.GetProgress())
		state.HistoryEndHit = state.HistoryEndHit || conversation.GetEndOfHistoryTransfer()
		if state.HistoryEndHit {
			state.Status = domain.HistoryComplete
		}
		if err = l.service.UpdateHistory(ctx, state); err != nil {
			return err
		}
		l.notifyOnDemand(onDemandResult{ChatID: state.ChatID, Inserted: inserted, End: state.HistoryEndHit})
	}
	return nil
}

func (l *Live) upsertConversation(ctx context.Context, conversation *waHistorySync.Conversation) (domain.Chat, types.JID, error) {
	if _, err := l.currentAccountClient(ctx); err != nil {
		return domain.Chat{}, types.EmptyJID, err
	}
	chatJID, err := types.ParseJID(conversation.GetID())
	if err != nil {
		return domain.Chat{}, types.EmptyJID, err
	}
	groupTitle := ""
	if chatJID.Server == types.GroupServer {
		candidate := firstMeaningfulDisplayName(conversation.GetName(), conversation.GetDisplayName())
		if candidate != "" && !isRawConnectorGroupTitle(candidate) {
			groupTitle = candidate
		}
	}
	title := firstMeaningfulDisplayName(groupTitle, conversation.GetName(), conversation.GetDisplayName(), l.contactName(ctx, chatJID))
	if chatJID.Server != types.GroupServer && !domain.MeaningfulDisplayName(title) {
		title = chatJID.User
	}
	identity := identityFromJIDs(chatJID, types.EmptyJID, title)
	for _, rawAlias := range []string{conversation.GetPnJID(), conversation.GetLidJID()} {
		alias, aliasErr := types.ParseJID(rawAlias)
		if aliasErr != nil || alias.IsEmpty() {
			continue
		}
		switch alias.Server {
		case types.HiddenUserServer, types.HostedLIDServer:
			identity.LID = alias.ToNonAD().String()
		case types.DefaultUserServer:
			identity.PhoneJID = alias.ToNonAD().String()
			identity.Phone = alias.User
		}
	}
	updatedAt := time.Now().UTC()
	if sourceSeconds := conversation.GetLastMsgTimestamp(); sourceSeconds > 0 {
		updatedAt = time.Unix(int64(sourceSeconds), 0).UTC()
	}
	identity.UpdatedAt = updatedAt
	stored, err := l.service.Repository().UpsertIdentity(ctx, identity)
	if err != nil {
		return domain.Chat{}, types.EmptyJID, err
	}
	chat := domain.Chat{
		ID:         string(stored.ID),
		SourceID:   domain.NormalizeAlias(chatJID.ToNonAD().String()),
		IdentityID: stored.ID,
		Title:      title,
		IsGroup:    chatJID.Server == types.GroupServer,
		Archived:   conversation.GetArchived(),
		UpdatedAt:  updatedAt,
	}
	if conversation.GetLastMsgTimestamp() > 0 {
		last := updatedAt
		chat.LastMessageAt = &last
	}
	if err = l.service.Repository().UpsertChat(ctx, chat); err != nil {
		return domain.Chat{}, types.EmptyJID, err
	}
	return chat, chatJID, nil
}

func (l *Live) notifyOnDemand(result onDemandResult) {
	l.waitMu.Lock()
	waiter := l.waiters[result.ChatID]
	l.waitMu.Unlock()
	if waiter == nil {
		return
	}
	select {
	case waiter <- result:
	default:
	}
}

func (l *Live) requestOlder(ctx context.Context, chat domain.Chat, oldest domain.Message) (onDemandResult, error) {
	if _, err := l.currentAccountClient(ctx); err != nil {
		return onDemandResult{}, err
	}
	chatID := domain.NormalizeAlias(chat.ID)
	sourceID := chat.SourceID
	if strings.TrimSpace(sourceID) == "" {
		sourceID = chat.ID
	}
	jid, err := types.ParseJID(sourceID)
	if err != nil {
		return onDemandResult{}, err
	}
	waiter := make(chan onDemandResult, 1)
	l.waitMu.Lock()
	if _, exists := l.waiters[chatID]; exists {
		l.waitMu.Unlock()
		return onDemandResult{}, errors.New("history request already active for chat")
	}
	l.waiters[chatID] = waiter
	l.waitMu.Unlock()
	defer func() {
		l.waitMu.Lock()
		delete(l.waiters, chatID)
		l.waitMu.Unlock()
	}()
	info := &types.MessageInfo{
		MessageSource: types.MessageSource{Chat: jid, IsFromMe: oldest.FromMe},
		ID:            types.MessageID(oldest.SourceMessageID),
		Timestamp:     oldest.Timestamp,
	}
	request := l.historyPeer.BuildHistorySyncRequest(info, 50)
	if _, err = l.historyPeer.SendPeerMessage(ctx, request); err != nil {
		return onDemandResult{}, fmt.Errorf("request older history: %w", err)
	}
	select {
	case result := <-waiter:
		return result, result.Err
	case <-time.After(45 * time.Second):
		return onDemandResult{}, errors.New("phone did not return older history in time")
	case <-ctx.Done():
		return onDemandResult{}, ctx.Err()
	}
}

// backfillAll walks active chats first and archived chats second, requesting
// older provider history for exactly one conversation at a time. A provider
// silence or stalled oldest message is recorded as partial, never complete.
func (l *Live) backfillAll(ctx context.Context) {
	for _, archived := range []bool{false, true} {
		cursor := ""
		for {
			if !l.isCurrent() {
				return
			}
			chats, err := l.service.Repository().ListChats(ctx, archived, 100, cursor)
			if err != nil {
				return
			}
			for _, chat := range chats {
				if !l.isCurrent() {
					return
				}
				l.backfillChat(ctx, chat)
				if ctx.Err() != nil {
					return
				}
			}
			if len(chats) < 100 {
				break
			}
			next := chats[len(chats)-1].ID
			if next == cursor {
				return
			}
			cursor = next
		}
	}
}

func (l *Live) backfillChat(ctx context.Context, chat domain.Chat) {
	state, err := l.service.Repository().GetHistory(ctx, chat.ID)
	if err == nil && state.Status == domain.HistoryComplete && state.HistoryEndHit {
		return
	}
	if err != nil {
		state = domain.HistorySync{ChatID: chat.ID}
	}
	state.Status = domain.HistoryRunning
	state.LastError = ""
	_ = l.service.UpdateHistory(ctx, state)
	for {
		oldest, oldestErr := l.service.Repository().OldestMessage(ctx, chat.ID)
		if oldestErr != nil {
			state.Status = domain.HistoryPartial
			state.LastError = "WhatsApp supplied no timestamped message to continue history"
			_ = l.service.UpdateHistory(ctx, state)
			return
		}
		result, requestErr := l.requestOlder(ctx, chat, oldest)
		if requestErr != nil {
			state, _ = l.service.Repository().GetHistory(ctx, chat.ID)
			state.ChatID = chat.ID
			state.Status = domain.HistoryPartial
			state.LastError = requestErr.Error()
			_ = l.service.UpdateHistory(ctx, state)
			return
		}
		state, _ = l.service.Repository().GetHistory(ctx, chat.ID)
		state.ChatID = chat.ID
		if result.End {
			state.Status = domain.HistoryComplete
			state.HistoryEndHit = true
			state.LastError = ""
			_ = l.service.UpdateHistory(ctx, state)
			return
		}
		newOldest, afterErr := l.service.Repository().OldestMessage(ctx, chat.ID)
		if result.Inserted == 0 || afterErr != nil || newOldest.ID == oldest.ID {
			state.Status = domain.HistoryPartial
			state.LastError = "WhatsApp did not confirm or advance older history"
			_ = l.service.UpdateHistory(ctx, state)
			return
		}
		select {
		case <-time.After(250 * time.Millisecond):
		case <-ctx.Done():
			return
		}
	}
}

func (l *Live) applyArchive(ctx context.Context, jid types.JID, archived bool, timestamp time.Time) error {
	if _, err := l.currentAccountClient(ctx); err != nil {
		return err
	}
	identity := identityFromJIDs(jid, types.EmptyJID, l.contactName(ctx, jid))
	identity.UpdatedAt = timestamp.UTC()
	stored, err := l.service.Repository().UpsertIdentity(ctx, identity)
	if err != nil {
		return err
	}
	return l.service.Repository().UpsertChat(ctx, domain.Chat{
		ID:         string(stored.ID),
		SourceID:   domain.NormalizeAlias(jid.ToNonAD().String()),
		IdentityID: stored.ID,
		Title:      identity.Name,
		IsGroup:    jid.Server == types.GroupServer,
		Archived:   archived,
		UpdatedAt:  timestamp.UTC(),
	})
}

var rawConnectorDigits = regexp.MustCompile(`^\d{10,}(?:-\d{5,})?$`)

func isRawConnectorGroupTitle(value string) bool {
	return rawConnectorDigits.MatchString(strings.TrimSpace(value))
}

func (l *Live) contactName(ctx context.Context, jid types.JID) string {
	if jid.Server == types.GroupServer {
		return ""
	}
	candidates := []types.JID{jid}
	if jid.Server == types.HiddenUserServer || jid.Server == types.HostedLIDServer {
		if phoneJID, err := l.client.Store.LIDs.GetPNForLID(ctx, jid); err == nil && !phoneJID.IsEmpty() {
			candidates = append(candidates, phoneJID)
		}
	}
	for _, candidate := range candidates {
		info, err := l.client.Store.Contacts.GetContact(ctx, candidate)
		if err != nil {
			continue
		}
		if name := firstMeaningfulDisplayName(info.FullName, info.FirstName, info.BusinessName, info.PushName); name != "" {
			return name
		}
	}
	return firstMeaningfulDisplayName(jid.User)
}

func firstMeaningfulDisplayName(values ...string) string {
	for _, value := range values {
		if domain.MeaningfulDisplayName(value) {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
