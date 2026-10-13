package store_test

import (
	"context"
	"testing"
	"time"

	"mycrobo/whatsapp-bridge/internal/domain"
	"mycrobo/whatsapp-bridge/internal/store"
)

func TestIdentityAliasesMergeLIDAndPhoneJID(t *testing.T) {
	repo := store.NewMemory()
	ctx := context.Background()
	stamp := time.Now().UTC()
	first, err := repo.UpsertIdentity(ctx, domain.Identity{LID: "ABC@LID", PhoneJID: "9199@s.whatsapp.net", UpdatedAt: stamp})
	if err != nil {
		t.Fatal(err)
	}
	second, err := repo.UpsertIdentity(ctx, domain.Identity{PhoneJID: "9199@S.WHATSAPP.NET", Phone: "+9199", Name: "Sakshi", UpdatedAt: stamp})
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID {
		t.Fatalf("identity forked: %s != %s", first.ID, second.ID)
	}
	if second.LID != "ABC@LID" || second.Phone != "+9199" {
		t.Fatalf("aliases not merged: %#v", second)
	}
}

func TestWeakConnectorNamesCannotReplaceReadableNames(t *testing.T) {
	repo := store.NewMemory()
	ctx := context.Background()
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

func TestMessageCursorFollowsChronologyNotLexicalID(t *testing.T) {
	repo := store.NewMemory()
	ctx := context.Background()
	newer := time.Date(2026, 8, 22, 12, 0, 0, 0, time.UTC)
	older := newer.Add(-time.Hour)
	for _, message := range []domain.Message{
		{ID: "a-new", SourceMessageID: "a-new", ChatID: "chat", Timestamp: newer},
		{ID: "z-old", SourceMessageID: "z-old", ChatID: "chat", Timestamp: older},
	} {
		if _, err := repo.InsertMessage(ctx, message); err != nil {
			t.Fatal(err)
		}
	}
	page, err := repo.ListMessages(ctx, "chat", 10, "a-new")
	if err != nil || len(page) != 1 || page[0].ID != "z-old" {
		t.Fatalf("chronological cursor failed: page=%#v err=%v", page, err)
	}
}

func TestMemoryEqualTimestampUsesObservedProviderOrderNotLexicalID(t *testing.T) {
	repo := store.NewMemory()
	ctx := context.Background()
	stamp := time.Date(2026, 8, 22, 12, 0, 0, 0, time.UTC)
	for _, message := range []domain.Message{
		{ID: "z-first", SourceMessageID: "z-first", ChatID: "chat", Kind: domain.MessageText, Text: "first", Timestamp: stamp, TimestampKnown: true},
		{ID: "a-second", SourceMessageID: "a-second", ChatID: "chat", Kind: domain.MessageText, Text: "second", Timestamp: stamp, TimestampKnown: true},
	} {
		if _, err := repo.InsertMessage(ctx, message); err != nil {
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

func TestMemorySearchFindsConversationTextInTheSelectedCollection(t *testing.T) {
	repo := store.NewMemory()
	ctx := context.Background()
	stamp := time.Now().UTC()
	if err := repo.UpsertChat(ctx, domain.Chat{ID: "active", Title: "Sakshi", UpdatedAt: stamp}); err != nil {
		t.Fatal(err)
	}
	if err := repo.UpsertChat(ctx, domain.Chat{ID: "archived", Title: "Old contact", Archived: true, UpdatedAt: stamp}); err != nil {
		t.Fatal(err)
	}
	for _, message := range []domain.Message{
		{ID: "m1", SourceMessageID: "m1", ChatID: "active", Kind: domain.MessageText, Text: "Kal rain ka scene kya hai?"},
		{ID: "m2", SourceMessageID: "m2", ChatID: "archived", Kind: domain.MessageText, Text: "rain archive"},
	} {
		if _, err := repo.InsertMessage(ctx, message); err != nil {
			t.Fatal(err)
		}
	}
	active, err := repo.SearchChats(ctx, false, "RAIN", 50)
	if err != nil || len(active) != 1 || active[0].ID != "active" {
		t.Fatalf("active search=%#v err=%v", active, err)
	}
	archived, err := repo.SearchChats(ctx, true, "rain", 50)
	if err != nil || len(archived) != 1 || archived[0].ID != "archived" {
		t.Fatalf("archived search=%#v err=%v", archived, err)
	}
}

func TestToneSamplesContainOnlyVerifiedOutgoingTextAndKeepChatScope(t *testing.T) {
	repo := store.NewMemory()
	ctx := context.Background()
	stamp := time.Now().UTC()
	for _, message := range []domain.Message{
		{ID: "person", SourceMessageID: "person", ChatID: "sakshi", FromMe: true, Kind: domain.MessageText, Text: "Haan, dekhta hu", Timestamp: stamp, TimestampKnown: true},
		{ID: "general", SourceMessageID: "general", ChatID: "other", FromMe: true, Kind: domain.MessageText, Text: "Sure", Timestamp: stamp.Add(-time.Minute), TimestampKnown: true},
		{ID: "incoming", SourceMessageID: "incoming", ChatID: "sakshi", FromMe: false, Kind: domain.MessageText, Text: "Do this", Timestamp: stamp.Add(time.Minute), TimestampKnown: true},
		{ID: "call", SourceMessageID: "call", ChatID: "sakshi", FromMe: true, Kind: domain.MessageCall, Text: "Missed voice call", Timestamp: stamp, TimestampKnown: true},
	} {
		if _, err := repo.InsertMessage(ctx, message); err != nil {
			t.Fatal(err)
		}
	}
	general, err := repo.ListOwnerTextMessages(ctx, "", 50)
	if err != nil || len(general) != 2 {
		t.Fatalf("general=%#v err=%v", general, err)
	}
	person, err := repo.ListOwnerTextMessages(ctx, "sakshi", 50)
	if err != nil || len(person) != 1 || person[0].ID != "person" {
		t.Fatalf("person=%#v err=%v", person, err)
	}
}
