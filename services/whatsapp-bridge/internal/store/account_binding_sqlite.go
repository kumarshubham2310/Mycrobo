package store

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

const accountBindingSchema = `CREATE TABLE IF NOT EXISTS account_binding (
	singleton INTEGER PRIMARY KEY CHECK(singleton=1), account_scope_id TEXT NOT NULL,
	proof_method TEXT NOT NULL, bound_at TEXT NOT NULL)`

func (s *SQLite) AccountBinding(ctx context.Context) (AccountBinding, error) {
	var exists int
	if err := s.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='account_binding'`).Scan(&exists); err != nil {
		return AccountBinding{}, err
	}
	if exists == 0 {
		return AccountBinding{}, ErrAccountUnbound
	}
	var value AccountBinding
	var bound string
	err := s.DB.QueryRowContext(ctx, `SELECT account_scope_id,proof_method,bound_at FROM account_binding WHERE singleton=1`).Scan(&value.AccountScopeID, &value.ProofMethod, &bound)
	if errors.Is(err, sql.ErrNoRows) {
		return value, ErrAccountUnbound
	}
	if err != nil {
		return value, err
	}
	value.BoundAt, err = time.Parse(time.RFC3339Nano, bound)
	return value, err
}

// BindAccount is additive and transactional. Legacy adoption requires every
// recorded outgoing sender to resolve to an authenticated session-owned alias.
// An unknown sender or lack of owner evidence blocks adoption without edits.
func (s *SQLite) BindAccount(ctx context.Context, accountID string, aliases []string) (AccountBinding, error) {
	if !validAccountScope(accountID) {
		return AccountBinding{}, ErrAccountUnbound
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return AccountBinding{}, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, accountBindingSchema); err != nil {
		return AccountBinding{}, err
	}
	var current AccountBinding
	var stamp string
	err = tx.QueryRowContext(ctx, `SELECT account_scope_id,proof_method,bound_at FROM account_binding WHERE singleton=1`).Scan(&current.AccountScopeID, &current.ProofMethod, &stamp)
	if err == nil {
		if current.AccountScopeID != accountID {
			if accountScopeMatchesAuthenticatedAlias(current.AccountScopeID, aliases) {
				current.BoundAt, err = time.Parse(time.RFC3339Nano, stamp)
				return current, err
			}
			owners, ownerErr := sqliteOwnerIdentities(ctx, tx)
			if ownerErr != nil {
				return AccountBinding{}, ownerErr
			}
			if !proveLegacyOwners(owners, aliases) {
				return AccountBinding{}, ErrAccountConflict
			}
			current = AccountBinding{AccountScopeID: accountID, ProofMethod: "authenticated-owner-alias-continuity", BoundAt: time.Now().UTC()}
			if _, err = tx.ExecContext(ctx, `UPDATE account_binding SET account_scope_id=?,proof_method=?,bound_at=? WHERE singleton=1`, current.AccountScopeID, current.ProofMethod, current.BoundAt.Format(time.RFC3339Nano)); err != nil {
				return AccountBinding{}, err
			}
			if err = tx.Commit(); err != nil {
				return AccountBinding{}, err
			}
			return current, nil
		}
		current.BoundAt, err = time.Parse(time.RFC3339Nano, stamp)
		return current, err
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return AccountBinding{}, err
	}
	var count int
	err = tx.QueryRowContext(ctx, `SELECT (SELECT COUNT(*) FROM messages)+(SELECT COUNT(*) FROM message_events)+(SELECT COUNT(*) FROM chats)+(SELECT COUNT(*) FROM identities)+(SELECT COUNT(*) FROM history_sync)+(SELECT COUNT(*) FROM conversation_states)+(SELECT COUNT(*) FROM message_media)`).Scan(&count)
	if err != nil {
		return AccountBinding{}, err
	}
	method := "authenticated-empty-store"
	if count > 0 {
		owners, ownerErr := sqliteOwnerIdentities(ctx, tx)
		if ownerErr != nil {
			return AccountBinding{}, ownerErr
		}
		if !proveLegacyOwners(owners, aliases) {
			return AccountBinding{}, ErrLegacyAccountUnverified
		}
		method = "authenticated-legacy-owner-identities"
	}
	value := AccountBinding{AccountScopeID: accountID, ProofMethod: method, BoundAt: time.Now().UTC()}
	if _, err = tx.ExecContext(ctx, `INSERT INTO account_binding(singleton,account_scope_id,proof_method,bound_at) VALUES(1,?,?,?)`, value.AccountScopeID, value.ProofMethod, value.BoundAt.Format(time.RFC3339Nano)); err != nil {
		return AccountBinding{}, err
	}
	if err = tx.Commit(); err != nil {
		return AccountBinding{}, err
	}
	return value, nil
}

func sqliteOwnerIdentities(ctx context.Context, tx *sql.Tx) ([]legacyOwnerIdentity, error) {
	rows, err := tx.QueryContext(ctx, `SELECT DISTINCT COALESCE(o.sender_id,''),COALESCE(i.lid,''),COALESCE(i.phone_jid,''),COALESCE(i.phone,'')
		FROM (SELECT sender_id FROM messages WHERE from_me=1 UNION SELECT sender_id FROM message_events WHERE from_me=1) o
		LEFT JOIN identities i ON i.id=o.sender_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	owners := make([]legacyOwnerIdentity, 0)
	for rows.Next() {
		var owner legacyOwnerIdentity
		if err = rows.Scan(&owner.id, &owner.lid, &owner.phoneJID, &owner.phone); err != nil {
			return nil, err
		}
		owners = append(owners, owner)
	}
	return owners, rows.Err()
}

func (s *SQLite) RepairAccountBindingFromTrustedOwner(ctx context.Context, accountID string) (AccountBinding, error) {
	if !validAccountScope(accountID) {
		return AccountBinding{}, ErrAccountUnbound
	}
	value := AccountBinding{AccountScopeID: accountID, ProofMethod: "authenticated-workspace-owner-record", BoundAt: time.Now().UTC()}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return AccountBinding{}, err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, accountBindingSchema); err != nil {
		return AccountBinding{}, err
	}
	if _, err = tx.ExecContext(ctx, `INSERT INTO account_binding(singleton,account_scope_id,proof_method,bound_at) VALUES(1,?,?,?)
		ON CONFLICT(singleton) DO UPDATE SET account_scope_id=excluded.account_scope_id,proof_method=excluded.proof_method,bound_at=excluded.bound_at`, value.AccountScopeID, value.ProofMethod, value.BoundAt.Format(time.RFC3339Nano)); err != nil {
		return AccountBinding{}, err
	}
	if err = tx.Commit(); err != nil {
		return AccountBinding{}, err
	}
	return value, nil
}
