package store

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"path/filepath"

	_ "github.com/ncruces/go-sqlite3/driver"
	_ "github.com/ncruces/go-sqlite3/vfs/adiantum"
)

// OpenSQLite opens MyCrobo's durable local message store with foreign-key
// enforcement, a bounded lock wait and WAL journaling. The caller owns Close.
func OpenSQLite(ctx context.Context, path string) (*SQLite, error) {
	return openSQLite(ctx, path, "")
}

// OpenSQLiteEncrypted opens an Adiantum-encrypted SQLite store. The caller
// supplies 32 bytes of key material as 64 hexadecimal characters. The key is
// never written to the database, logs or error messages.
func OpenSQLiteEncrypted(ctx context.Context, path, hexKey string) (*SQLite, error) {
	if !validHexKey(hexKey) {
		return nil, fmt.Errorf("open encrypted sqlite: a 32-byte key is required")
	}
	return openSQLite(ctx, path, hexKey)
}

func openSQLite(ctx context.Context, path, hexKey string) (*SQLite, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("resolve sqlite path: %w", err)
	}
	// Opaque produces file:C:/... on Windows. A hierarchical file://C:/ URI is
	// interpreted as a UNC host by the pure-Go driver.
	query := url.Values{}
	query.Add("_pragma", "foreign_keys(1)")
	query.Add("_pragma", "busy_timeout(5000)")
	query.Add("_pragma", "journal_mode(WAL)")
	query.Add("_pragma", "synchronous(NORMAL)")
	query.Add("_pragma", "wal_autocheckpoint(256)")
	query.Add("_pragma", "journal_size_limit(8388608)")
	query.Add("_pragma", "temp_store(memory)")
	if hexKey != "" {
		query.Set("vfs", "adiantum")
		query.Set("hexkey", hexKey)
	}
	dsn := (&url.URL{Scheme: "file", Opaque: filepath.ToSlash(abs), RawQuery: query.Encode()}).String()
	db, err := sql.Open("sqlite3", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	db.SetMaxOpenConns(1)
	if err = db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}
	repo := NewSQLite(db)
	repo.Path = abs
	if err = repo.Migrate(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	// A prior crash or long import may leave a large WAL beside an otherwise
	// healthy database. Truncating committed WAL pages at startup is lossless
	// and prevents temporary import storage from becoming permanent bloat.
	if _, err = db.ExecContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("checkpoint sqlite journal: %w", err)
	}
	return repo, nil
}

func (s *SQLite) Close() error {
	_, _ = s.DB.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
	return s.DB.Close()
}
