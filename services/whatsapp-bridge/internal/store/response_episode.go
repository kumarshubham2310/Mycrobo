package store

import (
	"sort"
	"strings"
	"time"

	"mycrobo/whatsapp-bridge/internal/domain"
)

const (
	responseTurnBurstGap    = 5 * time.Minute
	maximumResponseDelay    = 6 * time.Hour
	maximumResponseEpisodes = 12_000
)

type episodeMessage struct {
	chat    domain.Chat
	message domain.Message
	order   int64
}

type responseTurn struct {
	fromMe   bool
	barrier  bool
	messages []episodeMessage
}

func responseSourceID(message domain.Message) string {
	if value := strings.TrimSpace(message.SourceMessageID); value != "" {
		return value
	}
	return strings.TrimSpace(message.ID)
}

// buildResponseEpisodes accepts already account-local records and emits only
// direct-chat pairs. A group predecessor is not sufficient evidence that the
// owner addressed that participant, so group episodes fail closed here.
func buildResponseEpisodes(records []episodeMessage, limit int) []domain.ResponseEpisode {
	if limit <= 0 || limit > maximumResponseEpisodes {
		limit = maximumResponseEpisodes
	}
	byChat := make(map[string][]episodeMessage)
	for _, record := range records {
		message := record.message
		if record.chat.IsGroup || record.chat.IdentityID == "" || !message.TimestampKnown {
			continue
		}
		byChat[record.chat.ID] = append(byChat[record.chat.ID], record)
	}
	var episodes []domain.ResponseEpisode
	for _, records := range byChat {
		sort.Slice(records, func(i, j int) bool {
			if records[i].message.Timestamp.Equal(records[j].message.Timestamp) {
				return records[i].order < records[j].order
			}
			return records[i].message.Timestamp.Before(records[j].message.Timestamp)
		})
		var turns []responseTurn
		for _, record := range records {
			if !record.message.Conversational() {
				if len(turns) == 0 || !turns[len(turns)-1].barrier {
					turns = append(turns, responseTurn{barrier: true})
				}
				continue
			}
			current := len(turns) - 1
			if current >= 0 && !turns[current].barrier {
				prior := turns[current].messages[len(turns[current].messages)-1].message
				gap := record.message.Timestamp.Sub(prior.Timestamp)
				if turns[current].fromMe == record.message.FromMe && gap >= 0 && gap <= responseTurnBurstGap {
					turns[current].messages = append(turns[current].messages, record)
					continue
				}
			}
			turns = append(turns, responseTurn{fromMe: record.message.FromMe, messages: []episodeMessage{record}})
		}
		for index := 0; index+1 < len(turns); index++ {
			incoming := turns[index]
			reply := turns[index+1]
			if incoming.barrier || reply.barrier || incoming.fromMe || !reply.fromMe || len(incoming.messages) == 0 || len(reply.messages) == 0 {
				continue
			}
			lastIncoming := incoming.messages[len(incoming.messages)-1].message
			firstReply := reply.messages[0].message
			delay := firstReply.Timestamp.Sub(lastIncoming.Timestamp)
			if delay < 0 || delay > maximumResponseDelay {
				continue
			}
			chat := incoming.messages[0].chat
			incomingMessages := make([]domain.Message, 0, len(incoming.messages))
			replyMessages := make([]domain.Message, 0, len(reply.messages))
			sourceIDs := make([]string, 0, len(incoming.messages)+len(reply.messages))
			for _, item := range incoming.messages {
				incomingMessages = append(incomingMessages, item.message)
				sourceIDs = append(sourceIDs, responseSourceID(item.message))
			}
			for _, item := range reply.messages {
				replyMessages = append(replyMessages, item.message)
				sourceIDs = append(sourceIDs, responseSourceID(item.message))
			}
			episodes = append(episodes, domain.ResponseEpisode{
				ID:               "response:" + chat.ID + ":" + responseSourceID(lastIncoming) + ":" + responseSourceID(firstReply),
				PersonID:         chat.IdentityID,
				Chat:             chat,
				RelationshipKind: "direct-person",
				IncomingTurn:     incomingMessages,
				OwnerReply:       replyMessages,
				SourceMessageIDs: sourceIDs,
				IncomingStarted:  incoming.messages[0].message.Timestamp,
				RepliedAt:        firstReply.Timestamp,
				FactEligible:     false,
				Use:              "style-learning-only",
			})
		}
	}
	sort.Slice(episodes, func(i, j int) bool {
		if episodes[i].RepliedAt.Equal(episodes[j].RepliedAt) {
			return episodes[i].ID < episodes[j].ID
		}
		return episodes[i].RepliedAt.After(episodes[j].RepliedAt)
	})
	if len(episodes) > limit {
		episodes = episodes[:limit]
	}
	return episodes
}
