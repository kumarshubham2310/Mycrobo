package store

import (
	"context"
	"database/sql"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	sqliteDriver "github.com/ncruces/go-sqlite3/driver"
	_ "github.com/ncruces/go-sqlite3/vfs/adiantum"
)

func validHexKey(value string) bool {
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == 32
}

// EncryptedSQLitePath keeps the recovery source and encrypted destination
// unambiguous during one-time migration.
func EncryptedSQLitePath(path string) string {
	extension := filepath.Ext(path)
	return strings.TrimSuffix(path, extension) + ".vault" + extension
}

func encryptedURI(path, hexKey string) (string, error) {
	if !validHexKey(hexKey) {
		return "", fmt.Errorf("encrypted sqlite requires a 32-byte key")
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("resolve encrypted sqlite path: %w", err)
	}
	query := url.Values{}
	query.Set("vfs", "adiantum")
	query.Set("hexkey", hexKey)
	query.Add("_pragma", "busy_timeout(5000)")
	query.Add("_pragma", "temp_store(memory)")
	return (&url.URL{Scheme: "file", Opaque: filepath.ToSlash(abs), RawQuery: query.Encode()}).String(), nil
}

// MigrateSQLiteToEncrypted creates and verifies an encrypted copy without
// modifying the source. The caller can switch to the destination only after
// this function succeeds. Recovery-source deletion is a separate explicit
// lifecycle action.
func MigrateSQLiteToEncrypted(ctx context.Context, sourcePath, destinationPath, hexKey string) error {
	if _, err := os.Stat(destinationPath); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("inspect encrypted sqlite destination: %w", err)
	}
	if _, err := os.Stat(sourcePath); err != nil {
		return fmt.Errorf("inspect sqlite migration source: %w", err)
	}
	temporary := destinationPath + ".migration"
	_ = os.Remove(temporary)
	destinationURI, err := encryptedURI(temporary, hexKey)
	if err != nil {
		return err
	}
	source, err := sql.Open("sqlite3", sourcePath)
	if err != nil {
		return fmt.Errorf("open sqlite migration source: %w", err)
	}
	defer source.Close()
	connection, err := source.Conn(ctx)
	if err != nil {
		return fmt.Errorf("connect sqlite migration source: %w", err)
	}
	err = connection.Raw(func(driverConnection any) error {
		return driverConnection.(sqliteDriver.Conn).Raw().Backup("main", destinationURI)
	})
	_ = connection.Close()
	if err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("copy sqlite into encrypted vault: %w", err)
	}
	verification, err := OpenSQLiteEncrypted(ctx, temporary, hexKey)
	if err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("verify encrypted sqlite copy: %w", err)
	}
	var integrity string
	err = verification.DB.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&integrity)
	_ = verification.Close()
	if err != nil || integrity != "ok" {
		_ = os.Remove(temporary)
		return fmt.Errorf("encrypted sqlite integrity verification failed")
	}
	if err = os.Rename(temporary, destinationPath); err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("publish encrypted sqlite copy: %w", err)
	}
	return nil
}
