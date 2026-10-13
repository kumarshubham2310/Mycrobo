package whatsmeowlive

import (
	"errors"
	"strings"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"

	"mycrobo/whatsapp-bridge/internal/domain"
)

func revisionProtocol(message *waE2E.Message) *waE2E.ProtocolMessage {
	for depth := 0; message != nil && depth < 8; depth++ {
		if protocol := message.GetProtocolMessage(); protocol != nil {
			return protocol
		}
		switch {
		case message.GetEditedMessage().GetMessage() != nil:
			message = message.GetEditedMessage().GetMessage()
		case message.GetDeviceSentMessage().GetMessage() != nil:
			message = message.GetDeviceSentMessage().GetMessage()
		case message.GetEphemeralMessage().GetMessage() != nil:
			message = message.GetEphemeralMessage().GetMessage()
		default:
			return nil
		}
	}
	return nil
}

func revisionAliases(jids ...types.JID) []string {
	var aliases []string
	for _, jid := range jids {
		if jid.IsEmpty() {
			continue
		}
		alias := domain.NormalizeAlias(jid.ToNonAD().String())
		seen := false
		for _, prior := range aliases {
			if prior == alias {
				seen = true
			}
		}
		if !seen {
			aliases = append(aliases, alias)
		}
	}
	return aliases
}

func revisionRouteContains(aliases []string, value string) bool {
	jid, err := types.ParseJID(value)
	if err != nil || jid.IsEmpty() {
		return false
	}
	value = domain.NormalizeAlias(jid.ToNonAD().String())
	for _, alias := range aliases {
		if value == alias {
			return true
		}
	}
	return false
}

// Whatsmeow's history parser may replace Info.ID and Message with edited
// content. RawMessage still contains the authoritative protocol key/clock.
// Always inspect both shapes so an edit cannot be inserted as a new ordinary
// sentence or silently ignored by INSERT OR IGNORE.
func NormalizeProtocolRevision(event *events.Message, ownerAliases ...types.JID) (domain.ProtocolRevision, bool, error) {
	var result domain.ProtocolRevision
	if event == nil {
		return result, false, nil
	}
	result.ProviderEventID = event.Info.ID
	chatAlternate := event.Info.RecipientAlt
	if !event.Info.IsGroup && !event.Info.IsFromMe && !event.Info.SenderAlt.IsEmpty() {
		chatAlternate = event.Info.SenderAlt
	}
	result.ChatAliases = revisionAliases(event.Info.Chat, chatAlternate)
	result.SenderAliases = revisionAliases(event.Info.Sender, event.Info.SenderAlt)
	result.FromMe = event.Info.IsFromMe
	result.SourceTimestamp = event.Info.Timestamp.UTC()
	result.TimestampKnown = !event.Info.Timestamp.IsZero()
	protocol := revisionProtocol(event.Message)
	if protocol == nil {
		protocol = revisionProtocol(event.RawMessage)
	}
	if protocol == nil {
		if event.IsEdit {
			result.Type = domain.MessageEdited
			return result, true, errors.New("edited message has no verifiable protocol key")
		}
		return result, false, nil
	}
	if protocol.Type == nil {
		return result, true, errors.New("message revision type is missing")
	}
	if protocol.GetType() != waE2E.ProtocolMessage_MESSAGE_EDIT && protocol.GetType() != waE2E.ProtocolMessage_REVOKE {
		return result, false, nil
	}
	result.Type = domain.MessageEdited
	if protocol.GetType() == waE2E.ProtocolMessage_REVOKE {
		result.Type = domain.MessageRemoved
		result.Kind = domain.MessageDeleted
	}
	if protocol.TimestampMS != nil && protocol.GetTimestampMS() > 0 {
		result.SourceTimestamp = time.UnixMilli(protocol.GetTimestampMS()).UTC()
		result.TimestampKnown = true
	}
	key := protocol.GetKey()
	if key != nil {
		result.TargetSourceMessageID = key.GetID()
		// ParseWebMessage can replace the envelope ID with the original ID and
		// retain its occurrence timestamp. Without a protocol clock that history
		// shape does not prove when the edit happened.
		if result.Type == domain.MessageEdited && (protocol.TimestampMS == nil || protocol.GetTimestampMS() <= 0) && event.Info.ID == key.GetID() {
			result.SourceTimestamp = time.Time{}
			result.TimestampKnown = false
		}
	}
	if event.IsViewOnce || event.IsViewOnceV2 || event.IsViewOnceV2Extension {
		return result, true, errors.New("view-once message revisions are not imported")
	}
	if key == nil || strings.TrimSpace(key.GetID()) == "" {
		return result, true, errors.New("message revision has no exact target")
	}
	if len(result.ChatAliases) == 0 || len(result.SenderAliases) == 0 {
		return result, true, errors.New("message revision has no authenticated chat or sender")
	}
	if remote := strings.TrimSpace(key.GetRemoteJID()); remote != "" && !revisionRouteContains(result.ChatAliases, remote) {
		return result, true, errors.New("message revision targets a different conversation")
	}
	// Group-admin removal of another author's message requires separate proven
	// authority. This path accepts only the authenticated original author.
	if participant := strings.TrimSpace(key.GetParticipant()); participant != "" && !revisionRouteContains(result.SenderAliases, participant) {
		return result, true, errors.New("message revision targets a different participant")
	}
	if protocol.GetType() == waE2E.ProtocolMessage_REVOKE {
		result.Type = domain.MessageRemoved
		result.Kind = domain.MessageDeleted
		return result, true, nil
	}
	result.Type = domain.MessageEdited
	edited := protocol.GetEditedMessage()
	if edited == nil {
		return result, true, errors.New("edited message content is missing")
	}
	result.Kind, result.Text = messageContent(&events.Message{Message: edited})
	if result.Kind == domain.MessageSystem || result.Kind == domain.MessageViewOnce {
		return result, true, errors.New("edited message content is unsupported")
	}
	if contextInfo := messageContext(edited); contextInfo != nil {
		if quote := strings.TrimSpace(contextInfo.GetStanzaID()); quote != "" {
			result.QuotedMessageID = &quote
		}
	}
	if event.Info.IsGroup {
		mentions := contextMentionsAny(edited, ownerAliases...) || contextQuotesAny(edited, ownerAliases...)
		result.MentionsOwner = &mentions
	}
	return result, true, nil
}
