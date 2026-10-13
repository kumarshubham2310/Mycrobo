package store

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEncryptedSQLiteAndNonDestructiveMigration(t *testing.T) {
	ctx := context.Background()
	directory := t.TempDir()
	sourcePath := filepath.Join(directory, "messages.db")
	destinationPath := EncryptedSQLitePath(sourcePath)
	key := strings.Repeat("42", 32)
	source, err := OpenSQLite(ctx, sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = source.DB.ExecContext(ctx, "CREATE TABLE migration_probe(value TEXT); INSERT INTO migration_probe(value) VALUES ('synthetic-secret')"); err != nil {
		t.Fatal(err)
	}
	_ = source.Close()
	if err = MigrateSQLiteToEncrypted(ctx, sourcePath, destinationPath, key); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(sourcePath); err != nil {
		t.Fatalf("migration removed the recovery source: %v", err)
	}
	raw, err := os.ReadFile(destinationPath)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "synthetic-secret") || strings.HasPrefix(string(raw), "SQLite format 3") {
		t.Fatal("encrypted database exposed plaintext content or header")
	}
	encrypted, err := OpenSQLiteEncrypted(ctx, destinationPath, key)
	if err != nil {
		t.Fatal(err)
	}
	defer encrypted.Close()
	var value string
	if err = encrypted.DB.QueryRowContext(ctx, "SELECT value FROM migration_probe").Scan(&value); err != nil || value != "synthetic-secret" {
		t.Fatalf("encrypted migration did not preserve data: value=%q err=%v", value, err)
	}
	if _, err = OpenSQLiteEncrypted(ctx, destinationPath, strings.Repeat("24", 32)); err == nil {
		t.Fatal("encrypted database opened with the wrong key")
	}
}
