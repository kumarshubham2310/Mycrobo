package whatsmeowlive

import (
	"strings"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"

	"mycrobo/whatsapp-bridge/internal/domain"
)

// NormalizeMessage converts whatsmeow's parsed live/history event into the
// same canonical event. Sender direction comes from authenticated protocol
// metadata, never bubble position or text such as "You:".
func NormalizeMessage(event *events.Message, title string, archived bool) (domain.IncomingEvent, error) {
	// Direct-chat events expose the other person's alternate address on
	// different fields depending on message direction. Incoming LID messages
	// carry the phone JID in SenderAlt, while outgoing messages carry it in
	// RecipientAlt. Using only RecipientAlt split one person into a new LID chat
	// with one recent message and an older phone-JID chat with the real history.
	chatAlternate := event.Info.RecipientAlt
	if !event.Info.IsGroup && !event.Info.IsFromMe && !event.Info.SenderAlt.IsEmpty() {
		chatAlternate = event.Info.SenderAlt
	}
	chatIdentity := identityFromJIDs(event.Info.Chat, chatAlternate, title)
	senderIdentity := identityFromJIDs(event.Info.Sender, event.Info.SenderAlt, event.Info.PushName)
	kind, text := messageContent(event)
	known := !event.Info.Timestamp.IsZero()
	replyable := known && kind == domain.MessageText && strings.TrimSpace(text) != ""
	contextInfo := messageContext(event.Message)
	return domain.IncomingEvent{
		ChatIdentity:   chatIdentity,
		SenderIdentity: senderIdentity,
		Chat: domain.Chat{
			ID:       domain.NormalizeAlias(event.Info.Chat.ToNonAD().String()),
			SourceID: domain.NormalizeAlias(event.Info.Chat.ToNonAD().String()),
			Title:    strings.TrimSpace(title),
			IsGroup:  event.Info.IsGroup,
			Archived: archived,
		},
		Message: domain.Message{
			ID:              string(event.Info.ID),
			SourceMessageID: string(event.Info.ID),
			FromMe:          event.Info.IsFromMe,
			Kind:            kind,
			Text:            strings.TrimSpace(text),
			Timestamp:       event.Info.Timestamp.UTC(),
			TimestampKnown:  known,
			Replyable:       replyable,
			QuotedMessageID: strings.TrimSpace(contextInfo.GetStanzaID()),
			RawType:         event.Info.Type,
		},
	}, nil
}

func messageContext(message *waE2E.Message) *waE2E.ContextInfo {
	if message == nil {
		return nil
	}
	if value := message.GetExtendedTextMessage().GetContextInfo(); value != nil {
		return value
	}
	if value := message.GetImageMessage().GetContextInfo(); value != nil {
		return value
	}
	if value := message.GetVideoMessage().GetContextInfo(); value != nil {
		return value
	}
	if value := message.GetDocumentMessage().GetContextInfo(); value != nil {
		return value
	}
	if value := message.GetAudioMessage().GetContextInfo(); value != nil {
		return value
	}
	return nil
}

func contextMentionsAny(message *waE2E.Message, identities ...types.JID) bool {
	contextInfo := messageContext(message)
	if contextInfo == nil {
		return false
	}
	wanted := make(map[string]bool)
	for _, identity := range identities {
		if !identity.IsEmpty() {
			wanted[domain.NormalizeAlias(identity.ToNonAD().String())] = true
		}
	}
	for _, raw := range contextInfo.GetMentionedJID() {
		jid, err := types.ParseJID(raw)
		if err == nil && wanted[domain.NormalizeAlias(jid.ToNonAD().String())] {
			return true
		}
	}
	return false
}

func contextQuotesAny(message *waE2E.Message, identities ...types.JID) bool {
	contextInfo := messageContext(message)
	if contextInfo == nil || strings.TrimSpace(contextInfo.GetStanzaID()) == "" {
		return false
	}
	participant, err := types.ParseJID(contextInfo.GetParticipant())
	if err != nil || participant.IsEmpty() {
		return false
	}
	wanted := domain.NormalizeAlias(participant.ToNonAD().String())
	for _, identity := range identities {
		if !identity.IsEmpty() && wanted == domain.NormalizeAlias(identity.ToNonAD().String()) {
			return true
		}
	}
	return false
}

func identityFromJIDs(primary, alternate types.JID, name string) domain.Identity {
	identity := domain.Identity{Name: strings.TrimSpace(name)}
	for _, jid := range []types.JID{primary.ToNonAD(), alternate.ToNonAD()} {
		if jid.IsEmpty() {
			continue
		}
		switch jid.Server {
		case types.HiddenUserServer, types.HostedLIDServer:
			identity.LID = jid.String()
		case types.DefaultUserServer:
			identity.PhoneJID = jid.String()
			identity.Phone = jid.User
		default:
			if identity.PhoneJID == "" {
				identity.PhoneJID = jid.String()
			}
		}
	}
	return identity
}

func messageContent(event *events.Message) (domain.MessageKind, string) {
	message := event.Message
	if message == nil {
		return domain.MessageSystem, ""
	}
	if text := strings.TrimSpace(message.GetConversation()); text != "" {
		return domain.MessageText, text
	}
	if text := strings.TrimSpace(message.GetExtendedTextMessage().GetText()); text != "" {
		return domain.MessageText, text
	}
	if message.GetReactionMessage() != nil || message.GetEncReactionMessage() != nil {
		return domain.MessageReaction, ""
	}
	if message.GetCall() != nil || message.GetCallLogMesssage() != nil || message.GetScheduledCallCreationMessage() != nil || message.GetScheduledCallEditMessage() != nil {
		return domain.MessageCall, ""
	}
	if protocol := message.GetProtocolMessage(); protocol != nil {
		return domain.MessageSystem, ""
	}
	if media := message.GetImageMessage(); media != nil {
		return domain.MessageImage, media.GetCaption()
	}
	if media := message.GetVideoMessage(); media != nil {
		return domain.MessageVideo, media.GetCaption()
	}
	if media := message.GetDocumentMessage(); media != nil {
		caption := media.GetCaption()
		if strings.TrimSpace(caption) == "" {
			caption = media.GetFileName()
		}
		return domain.MessageDocument, caption
	}
	if message.GetAudioMessage() != nil {
		return domain.MessageAudio, ""
	}
	if message.GetStickerMessage() != nil {
		return domain.MessageSticker, ""
	}
	if message.GetViewOnceMessage() != nil || message.GetViewOnceMessageV2() != nil || message.GetViewOnceMessageV2Extension() != nil {
		return domain.MessageViewOnce, ""
	}
	return domain.MessageSystem, ""
}
