package store

import (
	"context"
	"time"
)

func (m *Memory) AccountBinding(_ context.Context) (AccountBinding, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.accountBinding != nil {
		return *m.accountBinding, nil
	}
	return AccountBinding{}, ErrAccountUnbound
}

func (m *Memory) BindAccount(_ context.Context, accountID string, aliases []string) (AccountBinding, error) {
	if !validAccountScope(accountID) {
		return AccountBinding{}, ErrAccountUnbound
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.accountBinding != nil {
		binding := *m.accountBinding
		if binding.AccountScopeID != accountID {
			if accountScopeMatchesAuthenticatedAlias(binding.AccountScopeID, aliases) {
				return binding, nil
			}
			if !proveLegacyOwners(m.ownerIdentities(), aliases) {
				return AccountBinding{}, ErrAccountConflict
			}
			binding = AccountBinding{AccountScopeID: accountID, ProofMethod: "authenticated-owner-alias-continuity", BoundAt: time.Now().UTC()}
			m.accountBinding = &binding
		}
		return binding, nil
	}
	method := "authenticated-empty-store"
	if len(m.messages)+len(m.messageEvents)+len(m.chats)+len(m.identities)+len(m.history)+len(m.conversationStates)+len(m.media) > 0 {
		if !proveLegacyOwners(m.ownerIdentities(), aliases) {
			return AccountBinding{}, ErrLegacyAccountUnverified
		}
		method = "authenticated-legacy-owner-identities"
	}
	value := AccountBinding{AccountScopeID: accountID, ProofMethod: method, BoundAt: time.Now().UTC()}
	m.accountBinding = &value
	return value, nil
}

func (m *Memory) RepairAccountBindingFromTrustedOwner(_ context.Context, accountID string) (AccountBinding, error) {
	if !validAccountScope(accountID) {
		return AccountBinding{}, ErrAccountUnbound
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	value := AccountBinding{AccountScopeID: accountID, ProofMethod: "authenticated-workspace-owner-record", BoundAt: time.Now().UTC()}
	m.accountBinding = &value
	return value, nil
}

func (m *Memory) ownerIdentities() []legacyOwnerIdentity {
	owners := make([]legacyOwnerIdentity, 0)
	for _, message := range m.messages {
		if !message.FromMe {
			continue
		}
		identity := m.identities[message.SenderID]
		owners = append(owners, legacyOwnerIdentity{string(message.SenderID), identity.LID, identity.PhoneJID, identity.Phone})
	}
	for _, event := range m.messageEvents {
		if !event.FromMe {
			continue
		}
		identity := m.identities[event.SenderID]
		owners = append(owners, legacyOwnerIdentity{string(event.SenderID), identity.LID, identity.PhoneJID, identity.Phone})
	}
	return owners
}
