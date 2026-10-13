package store

import (
	"strings"
	"testing"
	"time"

	"mycrobo/whatsapp-bridge/internal/domain"
)

func TestResponseEpisodesPreserveDirectTurnProvenanceAndExcludeGroups(t *testing.T) {
	accountRepositories(t, func(t *testing.T, repo Repository, bound AccountBindingRepository) {
		if _, err := bound.BindAccount(t.Context(), strings.Repeat("a", 64), nil); err != nil {
			t.Fatal(err)
		}
		stamp := time.Date(2026, 9, 12, 10, 0, 0, 0, time.UTC)
		for _, chat := range []domain.Chat{
			{ID: "friend-chat", SourceID: "friend-source", IdentityID: "lid:friend", Title: "Friend", UpdatedAt: stamp},
			{ID: "client-chat", SourceID: "client-source", IdentityID: "lid:client", Title: "Client", UpdatedAt: stamp},
			{ID: "media-chat", SourceID: "media-source", IdentityID: "lid:media", Title: "Media contact", UpdatedAt: stamp},
			{ID: "group-chat", SourceID: "group-source", IdentityID: "group:team", Title: "Team", IsGroup: true, UpdatedAt: stamp},
		} {
			if err := repo.UpsertChat(t.Context(), chat); err != nil {
				t.Fatal(err)
			}
		}
		messages := []domain.Message{
			{ID: "friend-in-1", SourceMessageID: "source-friend-in-1", ChatID: "friend-chat", SenderID: "lid:friend", SenderName: "Friend", Kind: domain.MessageText, Text: "The report", Timestamp: stamp, TimestampKnown: true},
			{ID: "friend-in-2", SourceMessageID: "source-friend-in-2", ChatID: "friend-chat", SenderID: "lid:friend", SenderName: "Friend", Kind: domain.MessageText, Text: "is ready", Timestamp: stamp.Add(time.Minute), TimestampKnown: true},
			{ID: "friend-out-1", SourceMessageID: "source-friend-out-1", ChatID: "friend-chat", FromMe: true, Kind: domain.MessageText, Text: "Great", Timestamp: stamp.Add(2 * time.Minute), TimestampKnown: true},
			{ID: "friend-out-2", SourceMessageID: "source-friend-out-2", ChatID: "friend-chat", FromMe: true, Kind: domain.MessageText, Text: "What is next?", Timestamp: stamp.Add(3 * time.Minute), TimestampKnown: true},
			{ID: "client-in", SourceMessageID: "source-client-in", ChatID: "client-chat", SenderID: "lid:client", SenderName: "Client", Kind: domain.MessageText, Text: "Invoice is ready", Timestamp: stamp.Add(4 * time.Minute), TimestampKnown: true},
			{ID: "client-out", SourceMessageID: "source-client-out", ChatID: "client-chat", FromMe: true, Kind: domain.MessageText, Text: "Please share it", Timestamp: stamp.Add(5 * time.Minute), TimestampKnown: true},
			{ID: "media-in", SourceMessageID: "source-media-in", ChatID: "media-chat", SenderID: "lid:media", Kind: domain.MessageText, Text: "Earlier unrelated text", Timestamp: stamp.Add(6 * time.Minute), TimestampKnown: true},
			{ID: "media-boundary", SourceMessageID: "source-media-boundary", ChatID: "media-chat", SenderID: "lid:media", Kind: domain.MessageImage, Timestamp: stamp.Add(7 * time.Minute), TimestampKnown: true},
			{ID: "media-out", SourceMessageID: "source-media-out", ChatID: "media-chat", FromMe: true, Kind: domain.MessageText, Text: "Looks good", Timestamp: stamp.Add(8 * time.Minute), TimestampKnown: true},
			{ID: "group-in", SourceMessageID: "source-group-in", ChatID: "group-chat", SenderID: "lid:member", Kind: domain.MessageText, Text: "Group update", Timestamp: stamp.Add(6 * time.Minute), TimestampKnown: true},
			{ID: "group-out", SourceMessageID: "source-group-out", ChatID: "group-chat", FromMe: true, Kind: domain.MessageText, Text: "Noted", Timestamp: stamp.Add(7 * time.Minute), TimestampKnown: true},
		}
		for _, message := range messages {
			if _, err := repo.InsertMessage(t.Context(), message); err != nil {
				t.Fatal(err)
			}
		}
		episodes, err := repo.ListResponseEpisodes(t.Context(), 20)
		if err != nil {
			t.Fatal(err)
		}
		if len(episodes) != 2 {
			t.Fatalf("episodes=%#v", episodes)
		}
		if episodes[0].PersonID != "lid:client" || episodes[0].Chat.ID != "client-chat" {
			t.Fatalf("canonical client relation lost: %#v", episodes[0])
		}
		friend := episodes[1]
		if friend.PersonID != "lid:friend" || friend.RelationshipKind != "direct-person" || friend.FactEligible || friend.Use != "style-learning-only" {
			t.Fatalf("unsafe relationship metadata: %#v", friend)
		}
		if len(friend.IncomingTurn) != 2 || len(friend.OwnerReply) != 2 {
			t.Fatalf("turn burst was not preserved: %#v", friend)
		}
		want := []string{"source-friend-in-1", "source-friend-in-2", "source-friend-out-1", "source-friend-out-2"}
		if strings.Join(friend.SourceMessageIDs, ",") != strings.Join(want, ",") {
			t.Fatalf("source provenance=%v", friend.SourceMessageIDs)
		}
		for _, episode := range episodes {
			if episode.Chat.IsGroup || episode.Chat.ID == "group-chat" {
				t.Fatal("unproven group participant entered phrase evidence")
			}
			if episode.Chat.ID == "media-chat" {
				t.Fatal("an intervening media message was ignored while pairing response evidence")
			}
		}
	})
}

func TestResponseEpisodeCoverageExceedsLegacyFiveHundredLimit(t *testing.T) {
	accountRepositories(t, func(t *testing.T, repo Repository, bound AccountBindingRepository) {
		if _, err := bound.BindAccount(t.Context(), strings.Repeat("b", 64), nil); err != nil {
			t.Fatal(err)
		}
		stamp := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
		chat := domain.Chat{ID: "large-chat", SourceID: "large-source", IdentityID: "lid:large", Title: "Large direct history", UpdatedAt: stamp}
		if err := repo.UpsertChat(t.Context(), chat); err != nil {
			t.Fatal(err)
		}
		const episodeCount = 650
		for index := 0; index < episodeCount; index++ {
			incomingAt := stamp.Add(time.Duration(index*10) * time.Minute)
			incomingID := "incoming-" + time.Unix(int64(index), 0).UTC().Format("150405.000000000")
			replyID := "reply-" + time.Unix(int64(index), 0).UTC().Format("150405.000000000")
			for _, message := range []domain.Message{
				{ID: incomingID, SourceMessageID: "source-" + incomingID, ChatID: chat.ID, SenderID: chat.IdentityID, Kind: domain.MessageText, Text: "Incoming topic", Timestamp: incomingAt, TimestampKnown: true},
				{ID: replyID, SourceMessageID: "source-" + replyID, ChatID: chat.ID, FromMe: true, Kind: domain.MessageText, Text: "Owner response", Timestamp: incomingAt.Add(time.Minute), TimestampKnown: true},
			} {
				if _, err := repo.InsertMessage(t.Context(), message); err != nil {
					t.Fatal(err)
				}
			}
		}
		episodes, err := repo.ListResponseEpisodes(t.Context(), 12_000)
		if err != nil {
			t.Fatal(err)
		}
		if len(episodes) != episodeCount {
			t.Fatalf("response episode coverage=%d want=%d", len(episodes), episodeCount)
		}
	})
}
