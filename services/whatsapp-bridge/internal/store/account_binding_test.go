package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"mycrobo/whatsapp-bridge/internal/domain"
)

func accountRepositories(t *testing.T, run func(*testing.T, Repository, AccountBindingRepository)) {
	t.Helper()
	for _, backend := range []string{"memory", "encrypted-sqlite"} {
		t.Run(backend, func(t *testing.T) {
			if backend == "memory" {
				repo := NewMemory()
				run(t, repo, repo)
				return
			}
			repo, err := OpenSQLiteEncrypted(t.Context(), filepath.Join(t.TempDir(), "synthetic.vault.db"), strings.Repeat("42", 32))
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { repo.Close() })
			run(t, repo, repo)
		})
	}
}

func seedAccountMessage(t *testing.T, repo Repository, id, phone string, fromMe bool) {
	t.Helper()
	var sender domain.CanonicalID
	if phone != "" {
		identity, err := repo.UpsertIdentity(t.Context(), domain.Identity{PhoneJID: phone + "@s.whatsapp.net", Phone: phone, Name: "Same display name", UpdatedAt: time.Now().UTC()})
		if err != nil {
			t.Fatal(err)
		}
		sender = identity.ID
	}
	_, err := repo.InsertMessage(t.Context(), domain.Message{ID: id, SourceMessageID: id, ChatID: "synthetic-chat", SenderID: sender, FromMe: fromMe, Kind: domain.MessageText, Text: "synthetic preserved message", Timestamp: time.Now().UTC(), TimestampKnown: true})
	if err != nil {
		t.Fatal(err)
	}
}

func TestAccountBindingEmptyStoreIsPermanent(t *testing.T) {
	accountRepositories(t, func(t *testing.T, repo Repository, bound AccountBindingRepository) {
		a := strings.Repeat("a", 64)
		b := strings.Repeat("b", 64)
		if _, err := bound.AccountBinding(t.Context()); !errors.Is(err, ErrAccountUnbound) {
			t.Fatalf("initial=%v", err)
		}
		first, err := bound.BindAccount(t.Context(), a, []string{"111@s.whatsapp.net"})
		if err != nil {
			t.Fatal(err)
		}
		if first.ProofMethod != "authenticated-empty-store" {
			t.Fatal(first.ProofMethod)
		}
		second, err := bound.BindAccount(t.Context(), a, nil)
		if err != nil || second != first {
			t.Fatalf("idempotent=%+v %v", second, err)
		}
		if _, err = bound.BindAccount(t.Context(), b, []string{"222@s.whatsapp.net"}); !errors.Is(err, ErrAccountConflict) {
			t.Fatalf("conflict=%v", err)
		}
		preserved, err := bound.AccountBinding(t.Context())
		if err != nil || preserved != first {
			t.Fatal("binding changed")
		}
	})
}

func TestAccountBindingLegacyProofRequiresEveryOutgoingIdentity(t *testing.T) {
	for _, mode := range []string{"verified", "foreign-owner", "unknown-owner", "no-owner"} {
		t.Run(mode, func(t *testing.T) {
			accountRepositories(t, func(t *testing.T, repo Repository, bound AccountBindingRepository) {
				seedAccountMessage(t, repo, "original", "111", mode != "no-owner")
				if mode == "foreign-owner" {
					seedAccountMessage(t, repo, "foreign", "222", true)
				}
				if mode == "unknown-owner" {
					seedAccountMessage(t, repo, "unknown", "", true)
				}
				binding, err := bound.BindAccount(t.Context(), strings.Repeat("a", 64), []string{"111@s.whatsapp.net"})
				if mode == "verified" {
					if err != nil || binding.ProofMethod != "authenticated-legacy-owner-identities" {
						t.Fatalf("proof=%+v %v", binding, err)
					}
				} else if !errors.Is(err, ErrLegacyAccountUnverified) {
					t.Fatalf("unproven adoption allowed: %+v %v", binding, err)
				}
				messages, err := repo.ListMessages(t.Context(), "synthetic-chat", 100, "")
				if err != nil || len(messages) < 1 {
					t.Fatal("history was changed")
				}
				if mode != "verified" {
					if _, err = bound.AccountBinding(t.Context()); !errors.Is(err, ErrAccountUnbound) {
						t.Fatal("failed adoption persisted")
					}
				}
			})
		})
	}
}

func TestAccountBindingSurvivesEncryptedReopen(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "synthetic.vault.db")
	key := strings.Repeat("42", 32)
	repo, err := OpenSQLiteEncrypted(ctx, path, key)
	if err != nil {
		t.Fatal(err)
	}
	first, err := repo.BindAccount(ctx, strings.Repeat("a", 64), nil)
	if err != nil {
		t.Fatal(err)
	}
	if err = repo.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenSQLiteEncrypted(ctx, path, key)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	persisted, err := reopened.AccountBinding(ctx)
	if err != nil || persisted != first {
		t.Fatalf("reopen=%+v %v", persisted, err)
	}
	if _, err = reopened.BindAccount(ctx, strings.Repeat("b", 64), nil); !errors.Is(err, ErrAccountConflict) {
		t.Fatal("account switch admitted after restart")
	}
}

func TestAccountBindingAcceptsOnlyProvenOwnerAliasContinuity(t *testing.T) {
	accountRepositories(t, func(t *testing.T, repo Repository, bound AccountBindingRepository) {
		seedAccountMessage(t, repo, "original", "111", true)
		first, err := bound.BindAccount(t.Context(), strings.Repeat("a", 64), []string{"111@s.whatsapp.net"})
		if err != nil {
			t.Fatal(err)
		}
		if _, err = bound.BindAccount(t.Context(), strings.Repeat("b", 64), []string{"222@s.whatsapp.net"}); !errors.Is(err, ErrAccountConflict) {
			t.Fatalf("foreign alias changed binding: %v", err)
		}
		preserved, err := bound.AccountBinding(t.Context())
		if err != nil || preserved != first {
			t.Fatal("foreign alias changed the preserved binding")
		}
		continued, err := bound.BindAccount(t.Context(), strings.Repeat("b", 64), []string{"111@s.whatsapp.net"})
		if err != nil {
			t.Fatal(err)
		}
		if continued.AccountScopeID != strings.Repeat("b", 64) || continued.ProofMethod != "authenticated-owner-alias-continuity" {
			t.Fatalf("continuity=%+v", continued)
		}
		persisted, err := bound.AccountBinding(t.Context())
		if err != nil || persisted != continued {
			t.Fatal("proven alias continuity did not persist")
		}
	})
}

func TestAccountBindingAcceptsAuthenticatedAliasWhenWhatsAppChangesPrimaryID(t *testing.T) {
	phoneAlias := "111@s.whatsapp.net"
	phoneSum := sha256.Sum256([]byte(phoneAlias))
	phoneScope := hex.EncodeToString(phoneSum[:])
	lidAlias := "777@lid"
	lidSum := sha256.Sum256([]byte(lidAlias))
	lidScope := hex.EncodeToString(lidSum[:])
	accountRepositories(t, func(t *testing.T, _ Repository, bound AccountBindingRepository) {
		first, err := bound.BindAccount(t.Context(), phoneScope, []string{phoneAlias})
		if err != nil {
			t.Fatal(err)
		}
		continued, err := bound.BindAccount(t.Context(), lidScope, []string{lidAlias, phoneAlias})
		if err != nil {
			t.Fatal(err)
		}
		if continued != first {
			t.Fatalf("stable phone binding changed after authenticated LID became primary: first=%+v continued=%+v", first, continued)
		}
		if _, err = bound.BindAccount(t.Context(), lidScope, []string{lidAlias, "222@s.whatsapp.net"}); !errors.Is(err, ErrAccountConflict) {
			t.Fatalf("foreign authenticated aliases crossed the binding: %v", err)
		}
	})
}

func TestTrustedWorkspaceOwnerRepairChangesOnlyTheBinding(t *testing.T) {
	accountRepositories(t, func(t *testing.T, repo Repository, bound AccountBindingRepository) {
		seedAccountMessage(t, repo, "original", "111", true)
		first, err := bound.BindAccount(t.Context(), strings.Repeat("a", 64), []string{"111@s.whatsapp.net"})
		if err != nil {
			t.Fatal(err)
		}
		repairer := bound.(TrustedAccountBindingRepository)
		repaired, err := repairer.RepairAccountBindingFromTrustedOwner(t.Context(), strings.Repeat("b", 64))
		if err != nil || repaired.AccountScopeID == first.AccountScopeID || repaired.ProofMethod != "authenticated-workspace-owner-record" {
			t.Fatalf("repair=%+v %v", repaired, err)
		}
		messages, err := repo.ListMessages(t.Context(), "synthetic-chat", 100, "")
		if err != nil || len(messages) != 1 || messages[0].ID != "original" {
			t.Fatal("trusted owner repair changed preserved history")
		}
		if _, err = repairer.RepairAccountBindingFromTrustedOwner(t.Context(), "not-a-scope"); !errors.Is(err, ErrAccountUnbound) {
			t.Fatal("invalid trusted owner scope was accepted")
		}
	})
}

func TestLegacyProofRejectsConflictingAliasesAndDisplayNameGuess(t *testing.T) {
	if proveLegacyOwners([]legacyOwnerIdentity{{id: "same name"}}, []string{"111@s.whatsapp.net"}) {
		t.Fatal("display-name-only identity passed")
	}
	if proveLegacyOwners([]legacyOwnerIdentity{{id: "owner", phoneJID: "111@s.whatsapp.net", lid: "wrong@lid"}}, []string{"111@s.whatsapp.net", "right@lid"}) {
		t.Fatal("conflicting authenticated aliases passed")
	}
	if !proveLegacyOwners([]legacyOwnerIdentity{{id: "owner", phoneJID: "111@s.whatsapp.net", lid: "right@lid", phone: "111"}}, []string{"111@s.whatsapp.net", "right@lid"}) {
		t.Fatal("matching authenticated aliases failed")
	}
}
