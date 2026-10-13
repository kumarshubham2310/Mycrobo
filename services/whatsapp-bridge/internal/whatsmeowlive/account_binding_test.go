package whatsmeowlive

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
	"time"

	"go.mau.fi/whatsmeow"
	waStore "go.mau.fi/whatsmeow/store"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"

	"mycrobo/whatsapp-bridge/internal/bridge"
	"mycrobo/whatsapp-bridge/internal/domain"
	"mycrobo/whatsapp-bridge/internal/store"
)

type accountTestLIDStore struct {
	lid types.JID
	pn  types.JID
}

func (s *accountTestLIDStore) PutManyLIDMappings(context.Context, []waStore.LIDMapping) error {
	return nil
}
func (s *accountTestLIDStore) PutLIDMapping(context.Context, types.JID, types.JID) error { return nil }
func (s *accountTestLIDStore) GetPNForLID(_ context.Context, lid types.JID) (types.JID, error) {
	if lid.ToNonAD() == s.lid.ToNonAD() {
		return s.pn, nil
	}
	return types.EmptyJID, nil
}
func (s *accountTestLIDStore) GetLIDForPN(_ context.Context, pn types.JID) (types.JID, error) {
	if pn.ToNonAD() == s.pn.ToNonAD() {
		return s.lid, nil
	}
	return types.EmptyJID, nil
}
func (s *accountTestLIDStore) GetManyLIDsForPNs(_ context.Context, pns []types.JID) (map[types.JID]types.JID, error) {
	result := make(map[types.JID]types.JID)
	for _, pn := range pns {
		if pn.ToNonAD() == s.pn.ToNonAD() {
			result[pn] = s.lid
		}
	}
	return result, nil
}

func accountTestClient(phone string) *whatsmeow.Client {
	jid := types.NewJID(phone, types.DefaultUserServer)
	return &whatsmeow.Client{Store: &waStore.Device{ID: &jid}}
}

func TestAccountConflictPreventsReadyAndIngestion(t *testing.T) {
	repo := store.NewMemory()
	owner := accountTestClient("111")
	foreign := accountTestClient("222")
	live := &Live{client: owner, service: bridge.New(repo, nil, nil, false), state: "catching-up"}
	if err := live.requireAccountBinding(t.Context(), owner); err != nil {
		t.Fatal(err)
	}
	live.client = foreign
	live.handleClientEvent(foreign, &events.OfflineSyncCompleted{})
	if live.state != "account-verification-required" || live.caughtUpAt != nil {
		t.Fatal("wrong account became READY")
	}
	if _, err := live.ingestMessage(t.Context(), nil, "", false); err == nil {
		t.Fatal("wrong account admitted message")
	}
	if err := live.ingestHistory(t.Context(), &events.HistorySync{}); err == nil {
		t.Fatal("wrong account admitted history")
	}
	if err := live.applyArchive(t.Context(), types.NewJID("333", types.DefaultUserServer), true, time.Now()); err == nil {
		t.Fatal("wrong account changed archive")
	}
	if err := live.RetryMedia(t.Context(), "saved"); err == nil {
		t.Fatal("wrong account admitted media")
	}
	chats, err := repo.ListChats(t.Context(), false, 100, "")
	if err != nil || len(chats) != 0 {
		t.Fatal("wrong account changed saved data")
	}
	bound, err := repo.AccountBinding(t.Context())
	sum := sha256.Sum256([]byte(owner.Store.ID.ToNonAD().String()))
	if err != nil || bound.AccountScopeID != hex.EncodeToString(sum[:]) {
		t.Fatal("binding relabeled")
	}
}

func TestAuthenticatedWorkspaceOwnerRecordRepairsStaleBinding(t *testing.T) {
	repo := store.NewMemory()
	foreign := accountTestClient("222")
	if _, err := repo.BindAccount(t.Context(), strings.Repeat("f", 64), []string{foreign.Store.ID.ToNonAD().String()}); err != nil {
		t.Fatal(err)
	}
	owner := accountTestClient("111")
	ownerSum := sha256.Sum256([]byte(owner.Store.ID.ToNonAD().String()))
	expected := hex.EncodeToString(ownerSum[:])
	live := &Live{client: owner, service: bridge.New(repo, nil, nil, false), state: "catching-up"}
	live.SetExpectedAccountScopeID(expected)
	if err := live.requireAccountBinding(t.Context(), owner); err != nil {
		t.Fatal(err)
	}
	binding, err := repo.AccountBinding(t.Context())
	if err != nil || binding.AccountScopeID != expected || binding.ProofMethod != "authenticated-workspace-owner-record" {
		t.Fatalf("binding=%+v err=%v", binding, err)
	}

	other := accountTestClient("333")
	live.client = other
	if err = live.requireAccountBinding(t.Context(), other); !errors.Is(err, store.ErrAccountConflict) {
		t.Fatalf("foreign authenticated account repaired trusted binding: %v", err)
	}
}

func TestAuthenticatedLIDSessionUsesSignedPhoneMappingForWorkspaceContinuity(t *testing.T) {
	repo := store.NewMemory()
	foreign := accountTestClient("222")
	if _, err := repo.BindAccount(t.Context(), strings.Repeat("f", 64), []string{foreign.Store.ID.ToNonAD().String()}); err != nil {
		t.Fatal(err)
	}
	phone := types.NewJID("111", types.DefaultUserServer)
	lid := types.NewJID("777", types.HiddenUserServer)
	device := &waStore.Device{ID: &lid, LID: lid, LIDs: &accountTestLIDStore{lid: lid, pn: phone}}
	owner := &whatsmeow.Client{Store: device}
	ownerSum := sha256.Sum256([]byte(phone.ToNonAD().String()))
	expected := hex.EncodeToString(ownerSum[:])
	live := &Live{client: owner, service: bridge.New(repo, nil, nil, false), state: "catching-up"}
	live.SetExpectedAccountScopeID(expected)
	if err := live.requireAccountBinding(t.Context(), owner); err != nil {
		t.Fatal(err)
	}
	binding, err := repo.AccountBinding(t.Context())
	if err != nil || binding.AccountScopeID != expected || binding.ProofMethod != "authenticated-workspace-owner-record" {
		t.Fatalf("binding=%+v err=%v", binding, err)
	}
}

func TestAuthenticatedLIDSessionWithoutPhoneProofRemainsBlocked(t *testing.T) {
	repo := store.NewMemory()
	foreign := accountTestClient("222")
	if _, err := repo.BindAccount(t.Context(), strings.Repeat("f", 64), []string{foreign.Store.ID.ToNonAD().String()}); err != nil {
		t.Fatal(err)
	}
	phone := types.NewJID("111", types.DefaultUserServer)
	lid := types.NewJID("777", types.HiddenUserServer)
	owner := &whatsmeow.Client{Store: &waStore.Device{ID: &lid, LID: lid}}
	ownerSum := sha256.Sum256([]byte(phone.ToNonAD().String()))
	live := &Live{client: owner, service: bridge.New(repo, nil, nil, false), state: "catching-up"}
	live.SetExpectedAccountScopeID(hex.EncodeToString(ownerSum[:]))
	if err := live.requireAccountBinding(t.Context(), owner); !errors.Is(err, store.ErrAccountConflict) {
		t.Fatalf("unproved LID-to-phone continuity was accepted: %v", err)
	}
}

func TestStaleClientEventsAndMediaCannotChangeReplacementSession(t *testing.T) {
	repo := store.NewMemory()
	old := accountTestClient("111")
	replacement := accountTestClient("111")
	live := &Live{client: old, service: bridge.New(repo, nil, nil, false), state: "current-read-only", connectionEpoch: "epoch-1"}
	if err := live.requireAccountBinding(t.Context(), old); err != nil {
		t.Fatal(err)
	}
	job := mediaJob{client: old, accountID: live.boundAccountID, epoch: "epoch-1", asset: domain.MediaAsset{MessageID: "stale"}}
	if !live.mediaJobCurrent(job) {
		t.Fatal("fresh media job rejected")
	}
	live.client = replacement
	live.connectionEpoch = "epoch-2"
	live.state = "catching-up"
	live.handleClientEvent(old, &events.OfflineSyncCompleted{})
	if live.state != "catching-up" {
		t.Fatal("retired callback changed readiness")
	}
	if live.mediaJobCurrent(job) {
		t.Fatal("stale media job accepted")
	}
	live.commitMediaJob(t.Context(), job)
	if _, err := repo.GetMedia(t.Context(), "stale"); err == nil {
		t.Fatal("stale media was persisted")
	}
	live.client = old
	live.state = "current-read-only"
	if live.mediaJobCurrent(job) {
		t.Fatal("old epoch accepted")
	}
	job.epoch = "epoch-2"
	job.accountID = strings.Repeat("b", 64)
	if live.mediaJobCurrent(job) {
		t.Fatal("foreign account media accepted")
	}
}
