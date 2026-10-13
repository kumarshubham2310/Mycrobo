package store_test

import (
	"bytes"
	"context"
	"path/filepath"
	"testing"
	"time"

	"mycrobo/whatsapp-bridge/internal/bridge"
	"mycrobo/whatsapp-bridge/internal/domain"
	"mycrobo/whatsapp-bridge/internal/store"
)

func TestSQLiteStorageMaintenanceBoundsOnlyRefetchableMedia(t *testing.T) {
	ctx := context.Background()
	repo, err := store.OpenSQLite(ctx, filepath.Join(t.TempDir(), "bounded-media.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	stamp := time.Date(2026, 8, 29, 10, 0, 0, 0, time.UTC)
	for index, id := range []string{"old", "middle", "new"} {
		if _, err = repo.InsertMessage(ctx, domain.Message{ID: id, SourceMessageID: id, ChatID: "chat", Kind: domain.MessageImage, Timestamp: stamp.Add(time.Duration(index) * time.Minute), TimestampKnown: true}); err != nil {
			t.Fatal(err)
		}
		asset := domain.MediaAsset{
			MessageID: id,
			Metadata:  domain.MediaMetadata{Category: "image", MimeType: "image/jpeg", Status: "ready"},
			Data:      bytes.Repeat([]byte{byte(index + 1)}, 16*1024*1024),
			Thumbnail: []byte("thumbnail"), DownloadInfo: []byte("encrypted-reference"), UpdatedAt: stamp.Add(time.Duration(index) * time.Minute),
		}
		if err = repo.PutMedia(ctx, asset); err != nil {
			t.Fatal(err)
		}
	}
	stats, err := repo.MaintainStorage(ctx, 32*1024*1024, false)
	if err != nil || stats.CachedMediaBytes > 32*1024*1024 || stats.ReclaimedMediaBytes < 16*1024*1024 {
		t.Fatalf("stats=%#v err=%v", stats, err)
	}
	old, err := repo.GetMedia(ctx, "old")
	if err != nil || len(old.Data) != 0 || string(old.Thumbnail) != "thumbnail" || string(old.DownloadInfo) != "encrypted-reference" || old.Metadata.Status != "thumbnail" || !old.Metadata.PreviewAvailable || old.Metadata.FullAvailable || !old.Metadata.FetchAvailable {
		t.Fatalf("old cache record lost durable metadata: asset=%#v err=%v", old, err)
	}
	newest, err := repo.GetMedia(ctx, "new")
	if err != nil || len(newest.Data) == 0 || newest.Metadata.Status != "ready" || !newest.Metadata.PreviewAvailable || !newest.Metadata.FullAvailable || !newest.Metadata.FetchAvailable {
		t.Fatalf("newest cache item was not retained: asset=%#v err=%v", newest, err)
	}
}

func TestSQLitePersistsLatestWithoutHistoryRegression(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "messages.db")
	repo, err := store.OpenSQLite(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	service := bridge.New(repo, nil, nil, false)
	newer := time.Date(2026, 8, 22, 12, 0, 0, 0, time.UTC)
	older := newer.Add(-48 * time.Hour)
	for _, message := range []domain.Message{
		{ID: "a-new", SourceMessageID: "a-new", Kind: domain.MessageText, Text: "actual latest", Timestamp: newer, TimestampKnown: true, Replyable: true, QuotedMessageID: "owner-old", MentionsOwner: true},
		{ID: "z-old", SourceMessageID: "z-old", Kind: domain.MessageText, Text: "older history", Timestamp: older, TimestampKnown: true, Replyable: true},
	} {
		_, err = service.Ingest(ctx, domain.IncomingEvent{Identity: domain.Identity{LID: "contact@lid"}, Chat: domain.Chat{ID: "chat", Title: "Contact"}, Message: message})
		if err != nil {
			t.Fatal(err)
		}
	}
	if err = repo.Close(); err != nil {
		t.Fatal(err)
	}

	repo, err = store.OpenSQLite(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	chats, err := repo.ListChats(ctx, false, 10, "")
	if err != nil || len(chats) != 1 || chats[0].LastMessageAt == nil || !chats[0].LastMessageAt.Equal(newer) {
		t.Fatalf("durable latest timestamp regressed: chats=%#v err=%v", chats, err)
	}
	latest, err := repo.LatestMessage(ctx, chats[0].ID)
	if err != nil || latest.QuotedMessageID != "owner-old" || !latest.MentionsOwner {
		t.Fatalf("reference evidence not durable: latest=%#v err=%v", latest, err)
	}
	page, err := repo.ListMessages(ctx, chats[0].ID, 10, "a-new")
	if err != nil || len(page) != 1 || page[0].ID != "z-old" {
		t.Fatalf("durable chronology cursor failed: page=%#v err=%v", page, err)
	}
}

func TestSQLiteEnforcesForeignKeys(t *testing.T) {
	repo, err := store.OpenSQLite(context.Background(), filepath.Join(t.TempDir(), "messages.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	var enabled int
	if err = repo.DB.QueryRow("PRAGMA foreign_keys").Scan(&enabled); err != nil || enabled != 1 {
		t.Fatalf("foreign keys disabled: enabled=%d err=%v", enabled, err)
	}
}

func TestSQLiteWeakConnectorNamesCannotReplaceReadableNames(t *testing.T) {
	ctx := context.Background()
	repo, err := store.OpenSQLite(ctx, filepath.Join(t.TempDir(), "names.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	stamp := time.Now().UTC()
	identity, err := repo.UpsertIdentity(ctx, domain.Identity{LID: "dad@lid", Name: "Dad", UpdatedAt: stamp})
	if err != nil {
		t.Fatal(err)
	}
	identity, err = repo.UpsertIdentity(ctx, domain.Identity{LID: "dad@lid", Name: ".", UpdatedAt: stamp.Add(time.Second)})
	if err != nil || identity.Name != "Dad" {
		t.Fatalf("identity=%#v err=%v", identity, err)
	}
	if err = repo.UpsertChat(ctx, domain.Chat{ID: string(identity.ID), Title: "Dad", UpdatedAt: stamp}); err != nil {
		t.Fatal(err)
	}
	if err = repo.UpsertChat(ctx, domain.Chat{ID: string(identity.ID), Title: ".", UpdatedAt: stamp.Add(time.Second)}); err != nil {
		t.Fatal(err)
	}
	chats, err := repo.ListChats(ctx, false, 10, "")
	if err != nil || len(chats) != 1 || chats[0].Title != "Dad" {
		t.Fatalf("chats=%#v err=%v", chats, err)
	}
}

func TestSQLiteSearchFindsSavedMessageText(t *testing.T) {
	ctx := context.Background()
	repo, err := store.OpenSQLite(ctx, filepath.Join(t.TempDir(), "search.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	service := bridge.New(repo, nil, nil, false)
	stamp := time.Date(2026, 8, 22, 12, 0, 0, 0, time.UTC)
	_, err = service.Ingest(ctx, domain.IncomingEvent{
		Identity: domain.Identity{LID: "search@lid"},
		Chat:     domain.Chat{ID: "search@lid", Title: "Unrelated title"},
		Message:  domain.Message{ID: "search-1", SourceMessageID: "search-1", Kind: domain.MessageText, Text: "Kal rain ka scene kya hai?", Timestamp: stamp, TimestampKnown: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	results, err := repo.SearchChats(ctx, false, "rain", 50)
	if err != nil || len(results) != 1 || results[0].Title != "Unrelated title" {
		t.Fatalf("search=%#v err=%v", results, err)
	}
}

func TestSQLiteEqualTimestampUsesInsertionOrderNotLexicalID(t *testing.T) {
	ctx := context.Background()
	repo, err := store.OpenSQLite(ctx, filepath.Join(t.TempDir(), "order.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	stamp := time.Date(2026, 8, 22, 12, 0, 0, 0, time.UTC)
	for _, message := range []domain.Message{
		{ID: "z-first", SourceMessageID: "z-first", ChatID: "chat", Kind: domain.MessageText, Text: "first", Timestamp: stamp, TimestampKnown: true},
		{ID: "a-second", SourceMessageID: "a-second", ChatID: "chat", Kind: domain.MessageText, Text: "second", Timestamp: stamp, TimestampKnown: true},
	} {
		if _, err = repo.InsertMessage(ctx, message); err != nil {
			t.Fatal(err)
		}
	}
	latest, err := repo.LatestMessage(ctx, "chat")
	if err != nil || latest.ID != "a-second" {
		t.Fatalf("latest=%#v err=%v", latest, err)
	}
	older, err := repo.ListMessages(ctx, "chat", 10, "a-second")
	if err != nil || len(older) != 1 || older[0].ID != "z-first" {
		t.Fatalf("older=%#v err=%v", older, err)
	}
}

func TestSQLiteKeepsMediaMetadataAndSeparatesLatestTextFromLatestSource(t *testing.T) {
	ctx := context.Background()
	repo, err := store.OpenSQLite(ctx, filepath.Join(t.TempDir(), "media.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	stamp := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	for _, message := range []domain.Message{
		{ID: "text", SourceMessageID: "text", ChatID: "chat", Kind: domain.MessageText, Text: "older question", Timestamp: stamp, TimestampKnown: true},
		{ID: "photo", SourceMessageID: "photo", ChatID: "chat", Kind: domain.MessageImage, Timestamp: stamp.Add(time.Minute), TimestampKnown: true},
	} {
		if _, err = repo.InsertMessage(ctx, message); err != nil {
			t.Fatal(err)
		}
	}
	asset := domain.MediaAsset{MessageID: "photo", Metadata: domain.MediaMetadata{Category: "image", MimeType: "image/jpeg", SizeBytes: 3, Width: 20, Height: 10, Status: "ready"}, Data: []byte{1, 2, 3}, DownloadInfo: []byte("durable-encrypted-reference"), UpdatedAt: stamp}
	if err = repo.PutMedia(ctx, asset); err != nil {
		t.Fatal(err)
	}
	latestText, textErr := repo.LatestMessage(ctx, "chat")
	latestSource, sourceErr := repo.LatestSourceMessage(ctx, "chat")
	if textErr != nil || latestText.ID != "text" || sourceErr != nil || latestSource.ID != "photo" {
		t.Fatalf("text=%#v textErr=%v source=%#v sourceErr=%v", latestText, textErr, latestSource, sourceErr)
	}
	page, err := repo.ListMessages(ctx, "chat", 10, "")
	if err != nil || len(page) != 2 || page[0].Media == nil || page[0].Media.Status != "ready" {
		t.Fatalf("page=%#v err=%v", page, err)
	}
	loaded, err := repo.GetMedia(ctx, "photo")
	if err != nil || string(loaded.Data) != string(asset.Data) || string(loaded.DownloadInfo) != string(asset.DownloadInfo) {
		t.Fatalf("asset=%#v err=%v", loaded, err)
	}
	if err = repo.PutMedia(ctx, domain.MediaAsset{MessageID: "photo", Metadata: domain.MediaMetadata{Category: "image", MimeType: "image/jpeg", SizeBytes: 3, Status: "failed"}, UpdatedAt: stamp.Add(time.Minute)}); err != nil {
		t.Fatal(err)
	}
	loaded, err = repo.GetMedia(ctx, "photo")
	if err != nil || string(loaded.DownloadInfo) != string(asset.DownloadInfo) || loaded.Metadata.Status != "ready" || len(loaded.Data) == 0 {
		t.Fatalf("ready bytes or download reference were downgraded by metadata replay: asset=%#v err=%v", loaded, err)
	}
}

func TestSQLiteHistoryCoverageMeasuresLocalEvidenceIndependentlyOfProviderCounter(t *testing.T) {
	ctx := context.Background()
	repo, err := store.OpenSQLite(ctx, filepath.Join(t.TempDir(), "coverage.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	stamp := time.Date(2026, 9, 13, 8, 0, 0, 0, time.UTC)
	if err = repo.UpsertChat(ctx, domain.Chat{ID: "chat", SourceID: "chat", Title: "Coverage", UpdatedAt: stamp}); err != nil {
		t.Fatal(err)
	}
	for _, message := range []domain.Message{
		{ID: "one", SourceMessageID: "one", ChatID: "chat", FromMe: true, Kind: domain.MessageText, Text: "Earlier", Timestamp: stamp, TimestampKnown: true},
		{ID: "two", SourceMessageID: "two", ChatID: "chat", Kind: domain.MessageText, Text: "Latest", Timestamp: stamp.Add(time.Minute), TimestampKnown: true},
	} {
		if _, err = repo.InsertMessage(ctx, message); err != nil {
			t.Fatal(err)
		}
	}
	if err = repo.PutHistory(ctx, domain.HistorySync{ChatID: "chat", Status: domain.HistoryPartial, MessagesSeen: 1, OldestCursor: "chunk:2", LastError: "provider limit", UpdatedAt: stamp.Add(2 * time.Minute)}); err != nil {
		t.Fatal(err)
	}
	coverage, err := repo.GetHistoryCoverage(ctx, "chat")
	if err != nil {
		t.Fatal(err)
	}
	if coverage.State != "partial" || coverage.LocallyStoredMessages != 2 || coverage.ProviderReportedMessagesSeen != 1 || coverage.OwnerMessages != 1 || coverage.OwnerTextMessages != 1 || coverage.ContactMessages != 1 {
		t.Fatalf("unexpected coverage: %#v", coverage)
	}
	if coverage.OldestMessageAt == nil || !coverage.OldestMessageAt.Equal(stamp) || coverage.NewestMessageAt == nil || !coverage.NewestMessageAt.Equal(stamp.Add(time.Minute)) {
		t.Fatalf("coverage boundaries are incorrect: %#v", coverage)
	}
}

func TestSQLiteMigrationRepairsCachedMediaReadiness(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "media-repair.db")
	repo, err := store.OpenSQLite(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = repo.Close() })
	stamp := time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC)
	if _, err = repo.InsertMessage(ctx, domain.Message{ID: "cached-pdf", SourceMessageID: "cached-pdf", ChatID: "chat", Kind: domain.MessageDocument, Timestamp: stamp, TimestampKnown: true}); err != nil {
		t.Fatal(err)
	}
	asset := domain.MediaAsset{MessageID: "cached-pdf", Metadata: domain.MediaMetadata{Category: "document", MimeType: "application/pdf", FileName: "ready.pdf", Status: "ready"}, Data: []byte("%PDF-safe"), UpdatedAt: stamp}
	if err = repo.PutMedia(ctx, asset); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.DB.ExecContext(ctx, `UPDATE message_media SET status='metadata_only' WHERE message_id='cached-pdf'`); err != nil {
		t.Fatal(err)
	}
	if err = repo.Close(); err != nil {
		t.Fatal(err)
	}
	repo, err = store.OpenSQLite(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := repo.GetMedia(ctx, "cached-pdf")
	if err != nil || loaded.Metadata.Status != "ready" || string(loaded.Data) != "%PDF-safe" {
		t.Fatalf("cached media readiness was not repaired: asset=%#v err=%v", loaded, err)
	}
}

func TestSQLiteMigrationMergesSplitLIDAndPhoneHistory(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "merge.db")
	repo, err := store.OpenSQLite(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	stamp := time.Date(2026, 8, 24, 10, 0, 0, 0, time.UTC)
	lid, err := repo.UpsertIdentity(ctx, domain.Identity{LID: "contact@lid", Name: "Contact", UpdatedAt: stamp})
	if err != nil {
		t.Fatal(err)
	}
	phone, err := repo.UpsertIdentity(ctx, domain.Identity{PhoneJID: "9199@s.whatsapp.net", Phone: "9199", Name: "Contact", UpdatedAt: stamp.Add(-time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct {
		id       string
		identity domain.Identity
		message  string
		when     time.Time
	}{
		{string(lid.ID), lid, "latest", stamp},
		{string(phone.ID), phone, "older history", stamp.Add(-24 * time.Hour)},
	} {
		if err = repo.UpsertChat(ctx, domain.Chat{ID: item.id, SourceID: "9199@s.whatsapp.net", IdentityID: item.identity.ID, Title: "Contact", UpdatedAt: item.when}); err != nil {
			t.Fatal(err)
		}
		if _, err = repo.InsertMessage(ctx, domain.Message{ID: item.message, SourceMessageID: item.message, ChatID: item.id, Kind: domain.MessageText, Text: item.message, Timestamp: item.when, TimestampKnown: true}); err != nil {
			t.Fatal(err)
		}
		if err = repo.PutHistory(ctx, domain.HistorySync{ChatID: item.id, Status: domain.HistoryPartial, MessagesSeen: 1, UpdatedAt: item.when}); err != nil {
			t.Fatal(err)
		}
	}
	if err = repo.Close(); err != nil {
		t.Fatal(err)
	}

	repo, err = store.OpenSQLite(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	chats, err := repo.ListChats(ctx, false, 10, "")
	if err != nil || len(chats) != 1 || chats[0].ID != string(lid.ID) {
		t.Fatalf("split chats remained: chats=%#v err=%v", chats, err)
	}
	messages, err := repo.ListMessages(ctx, chats[0].ID, 10, "")
	if err != nil || len(messages) != 2 || messages[0].Text != "latest" || messages[1].Text != "older history" {
		t.Fatalf("merged history=%#v err=%v", messages, err)
	}
	history, err := repo.GetHistory(ctx, chats[0].ID)
	if err != nil || history.MessagesSeen != 2 || history.Status == domain.HistoryComplete {
		t.Fatalf("merged history state=%#v err=%v", history, err)
	}
}

func TestSQLitePersistsAppendOnlyMessageEventsAndConversationState(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "state.db")
	repo, err := store.OpenSQLite(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	stamp := time.Date(2026, 8, 26, 10, 0, 0, 0, time.UTC)
	message := domain.Message{ID: "m1", SourceMessageID: "provider-m1", ChatID: "chat", SenderID: "contact", Kind: domain.MessageText, Text: "Where are you?", Timestamp: stamp, TimestampKnown: true}
	inserted, err := repo.InsertMessage(ctx, message)
	if err != nil || !inserted {
		t.Fatalf("inserted=%v err=%v", inserted, err)
	}
	inserted, err = repo.InsertMessage(ctx, message)
	if err != nil || inserted {
		t.Fatalf("duplicate message changed journal: inserted=%v err=%v", inserted, err)
	}
	events, err := repo.ListMessageEvents(ctx, "chat", 0, 10)
	if err != nil || len(events) != 1 || events[0].OriginalText != message.Text || events[0].Sequence == 0 {
		t.Fatalf("events=%#v err=%v", events, err)
	}
	state := domain.ConversationState{ChatID: "chat", Version: 1, ReducedThroughSequence: events[0].Sequence, LatestMessageID: "m1", LatestIntent: "question", ConversationStatus: "awaiting_owner", UpdatedAt: stamp}
	if err = repo.PutConversationState(ctx, state); err != nil {
		t.Fatal(err)
	}
	if err = repo.Close(); err != nil {
		t.Fatal(err)
	}
	repo, err = store.OpenSQLite(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	loaded, err := repo.GetConversationState(ctx, "chat")
	if err != nil || loaded.ReducedThroughSequence != events[0].Sequence || loaded.LatestIntent != "question" {
		t.Fatalf("state=%#v err=%v", loaded, err)
	}
}

func TestSQLiteMigrationBackfillsLegacyMessagesIntoEventJournal(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "legacy-events.db")
	repo, err := store.OpenSQLite(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	message := domain.Message{ID: "legacy", SourceMessageID: "legacy-source", ChatID: "chat", Kind: domain.MessageText, Text: "Preserve me", Timestamp: time.Date(2026, 8, 1, 9, 0, 0, 0, time.UTC), TimestampKnown: true}
	if inserted, insertErr := repo.InsertMessage(ctx, message); insertErr != nil || !inserted {
		t.Fatalf("inserted=%v err=%v", inserted, insertErr)
	}
	// Simulate a database created before the journal migration.
	if _, err = repo.DB.ExecContext(ctx, "DELETE FROM message_events"); err != nil {
		t.Fatal(err)
	}
	if err = repo.Close(); err != nil {
		t.Fatal(err)
	}
	repo, err = store.OpenSQLite(ctx, path)
	if err != nil {
		t.Fatal(err)
	}
	defer repo.Close()
	events, err := repo.ListMessageEvents(ctx, "chat", 0, 10)
	if err != nil || len(events) != 1 || events[0].ID != "observed:legacy-source" || events[0].OriginalText != "Preserve me" {
		t.Fatalf("legacy journal=%#v err=%v", events, err)
	}
}
