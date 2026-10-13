package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"
)

var ErrAccountUnbound = errors.New("saved history account has not been verified")
var ErrAccountConflict = errors.New("this saved history belongs to a different WhatsApp account")
var ErrLegacyAccountUnverified = errors.New("the account owning earlier saved history requires verification; history has been preserved")

// AccountBinding is a permanent, content-free boundary for a single account
// vault. Binding never rewrites messages or transfers them to a new login.
type AccountBinding struct {
	AccountScopeID string    `json:"account_scope_id"`
	ProofMethod    string    `json:"proof_method"`
	BoundAt        time.Time `json:"bound_at"`
}

type AccountBindingRepository interface {
	AccountBinding(context.Context) (AccountBinding, error)
	BindAccount(context.Context, string, []string) (AccountBinding, error)
}

type TrustedAccountBindingRepository interface {
	// RepairAccountBindingFromTrustedOwner changes only the content-free binding
	// metadata after the live connector proves an authenticated alias matches the
	// workspace's preserved owner record. It never relabels or rewrites messages.
	RepairAccountBindingFromTrustedOwner(context.Context, string) (AccountBinding, error)
}

type legacyOwnerIdentity struct{ id, lid, phoneJID, phone string }

func validAccountScope(value string) bool {
	b, err := hex.DecodeString(value)
	return err == nil && len(b) == 32
}

// accountScopeMatchesAuthenticatedAlias keeps a workspace binding stable when
// WhatsApp changes which authenticated identifier is primary (for example,
// from a phone JID to an LID). It never accepts a display name or an inferred
// contact: the exact SHA-256 scope must match one of the aliases supplied by
// the authenticated linked-device store.
func accountScopeMatchesAuthenticatedAlias(accountScopeID string, authenticatedAliases []string) bool {
	if !validAccountScope(accountScopeID) {
		return false
	}
	for _, alias := range authenticatedAliases {
		alias = strings.ToLower(strings.TrimSpace(alias))
		if alias == "" {
			continue
		}
		sum := sha256.Sum256([]byte(alias))
		if hex.EncodeToString(sum[:]) == accountScopeID {
			return true
		}
	}
	return false
}

func proveLegacyOwners(owners []legacyOwnerIdentity, authenticatedAliases []string) bool {
	if len(owners) == 0 {
		return false
	}
	allowed := make(map[string]bool)
	for _, alias := range authenticatedAliases {
		alias = strings.ToLower(strings.TrimSpace(alias))
		if alias == "" {
			continue
		}
		allowed[alias] = true
		if strings.HasSuffix(alias, "@s.whatsapp.net") {
			allowed[strings.TrimSuffix(alias, "@s.whatsapp.net")] = true
		}
	}
	for _, owner := range owners {
		if strings.TrimSpace(owner.id) == "" {
			return false
		}
		matched := false
		for _, alias := range []string{owner.lid, owner.phoneJID, owner.phone} {
			alias = strings.ToLower(strings.TrimSpace(alias))
			if alias == "" {
				continue
			}
			if !allowed[alias] {
				return false
			}
			matched = true
		}
		if !matched {
			return false
		}
	}
	return true
}
