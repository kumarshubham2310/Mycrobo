package httpapi

import (
	"bytes"
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"mycrobo/whatsapp-bridge/internal/bridge"
	"mycrobo/whatsapp-bridge/internal/conversationstate"
	"mycrobo/whatsapp-bridge/internal/domain"
	"mycrobo/whatsapp-bridge/internal/store"
)

type Server struct {
	service      *bridge.Service
	broker       *Broker
	mediaRetrier interface {
		RetryMedia(context.Context, string) error
	}
	mux *http.ServeMux
}

type ReadinessDimension struct {
	State  string `json:"state"`
	Reason string `json:"reason"`
}

// ConversationTruth reconciles independent local evidence without claiming
// that WhatsApp exposes a lifetime message total or a queryable server-side
// latest-message ID. The catalogue timestamp is the strongest provider proof
// available to this linked-device connector.
type ConversationTruth struct {
	ChatID                       string                 `json:"chat_id"`
	ObservedAt                   time.Time              `json:"observed_at"`
	ConnectorState               string                 `json:"connector_state"`
	CurrentMessage               ReadinessDimension     `json:"current_message"`
	CurrentStory                 ReadinessDimension     `json:"current_story"`
	RelationshipHistory          ReadinessDimension     `json:"relationship_history"`
	LifetimeHistory              ReadinessDimension     `json:"lifetime_history"`
	LatestSourceID               string                 `json:"latest_source_message_id,omitempty"`
	LatestTextID                 string                 `json:"latest_text_message_id,omitempty"`
	ProjectedLatestTextID        string                 `json:"projected_latest_text_message_id,omitempty"`
	LatestSourceAt               *time.Time             `json:"latest_source_at,omitempty"`
	CatalogueLatestAt            *time.Time             `json:"catalogue_latest_at,omitempty"`
	ProjectionSequence           int64                  `json:"projection_sequence"`
	JournalSequence              int64                  `json:"journal_sequence"`
	UnresolvedEvidence           int64                  `json:"unresolved_evidence"`
	DraftFromCurrentStoryAllowed bool                   `json:"draft_from_current_story_allowed"`
	Coverage                     domain.HistoryCoverage `json:"coverage"`
}

var (
	unresolvedNumericTitle = regexp.MustCompile(`^\d{13,}$`)
	phoneDigits            = regexp.MustCompile(`^\d{7,15}$`)
)

func directPhoneLabel(identity domain.Identity) string {
	phone := strings.TrimSpace(identity.Phone)
	if phone == "" {
		phone = strings.Split(strings.TrimSpace(identity.PhoneJID), "@")[0]
	}
	if phone != "" && phoneDigits.MatchString(phone) {
		return "+" + phone
	}
	return ""
}

func (s *Server) presentChat(ctx context.Context, chat domain.Chat) domain.Chat {
	trimmedTitle := strings.TrimSpace(chat.Title)
	if !unresolvedNumericTitle.MatchString(trimmedTitle) && trimmedTitle != "" {
		return chat
	}
	if identity, err := s.service.Repository().GetIdentity(ctx, chat.IdentityID); err == nil {
		if name := strings.TrimSpace(identity.Name); domain.MeaningfulDisplayName(name) && !unresolvedNumericTitle.MatchString(name) {
			chat.Title = name
			return chat
		}
		if !chat.IsGroup {
			if phone := directPhoneLabel(identity); phone != "" {
				chat.Title = phone
				return chat
			}
		}
	}
	if chat.IsGroup {
		chat.Title = "Group conversation"
		return chat
	}
	chat.Title = "Unsaved contact"
	return chat
}

func New(service *bridge.Service, broker *Broker, mediaRetriers ...interface {
	RetryMedia(context.Context, string) error
}) *Server {
	s := &Server{service: service, broker: broker, mux: http.NewServeMux()}
	if len(mediaRetriers) > 0 {
		s.mediaRetrier = mediaRetriers[0]
	}
	s.routes()
	return s
}
func (s *Server) Handler() http.Handler { return LoopbackOnly(s.mux) }
func (s *Server) routes() {
	s.mux.HandleFunc("GET /v1/health", s.health)
	s.mux.HandleFunc("GET /v1/chats", s.chats)
	s.mux.HandleFunc("GET /v1/search", s.search)
	s.mux.HandleFunc("GET /v1/tone-samples", s.toneSamples)
	s.mux.HandleFunc("GET /v1/response-episodes", s.responseEpisodes)
	s.mux.HandleFunc("GET /v1/chats/{id}/latest", s.latest)
	s.mux.HandleFunc("GET /v1/chats/{id}/truth", s.truth)
	s.mux.HandleFunc("GET /v1/chats/{id}/revision", s.conversationRevision)
	s.mux.HandleFunc("GET /v1/chats/{id}/messages", s.messages)
	s.mux.HandleFunc("GET /v1/chats/{id}/history", s.history)
	s.mux.HandleFunc("GET /v1/chats/{id}/state", s.conversationState)
	s.mux.HandleFunc("GET /v1/workspace", s.workspace)
	s.mux.HandleFunc("GET /v1/media/{id}", s.media)
	s.mux.HandleFunc("POST /v1/media/{id}/fetch", s.fetchMedia)
	s.mux.HandleFunc("GET /v1/events", s.events)
	s.mux.HandleFunc("POST /v1/outbound/approvals", s.approve)
	s.mux.HandleFunc("POST /v1/outbound/send", s.send)
}
func (s *Server) fetchMedia(w http.ResponseWriter, r *http.Request) {
	messageID := strings.TrimSpace(r.PathValue("id"))
	if messageID == "" || len(messageID) > 256 {
		errJSON(w, 400, errors.New("media id is invalid"))
		return
	}
	if s.mediaRetrier == nil {
		errJSON(w, 503, errors.New("attachment fetching is unavailable while WhatsApp is offline"))
		return
	}
	if err := s.mediaRetrier.RetryMedia(r.Context(), messageID); err != nil {
		errJSON(w, 409, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "queued", "message_id": messageID})
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func errJSON(w http.ResponseWriter, status int, err error) {
	writeJSON(w, status, map[string]string{"error": err.Error()})
}
func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"status": "ok", "connection": s.service.State(r.Context()), "outbound": "exact-approval-gated", "send_available": s.service.SendAvailable(r.Context())})
}
func limit(r *http.Request) int {
	v, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if v <= 0 {
		return 100
	}
	return v
}
func (s *Server) chats(w http.ResponseWriter, r *http.Request) {
	archived, _ := strconv.ParseBool(r.URL.Query().Get("archived"))
	pageLimit := limit(r)
	if pageLimit > 500 {
		pageLimit = 500
	}
	v, err := s.service.Repository().ListChats(r.Context(), archived, pageLimit, r.URL.Query().Get("cursor"))
	if err != nil {
		errJSON(w, 500, err)
		return
	}
	for index := range v {
		v[index] = s.presentChat(r.Context(), v[index])
		if latest, latestErr := s.service.Repository().LatestSourceMessage(r.Context(), v[index].ID); latestErr == nil {
			v[index].Latest = &latest
		}
		if history, historyErr := s.service.Repository().GetHistory(r.Context(), v[index].ID); historyErr == nil {
			v[index].History = &history
		}
		if coverage, coverageErr := s.service.Repository().GetHistoryCoverage(r.Context(), v[index].ID); coverageErr == nil {
			v[index].Coverage = &coverage
		}
	}
	next := ""
	if len(v) == pageLimit && len(v) > 0 {
		next = v[len(v)-1].ID
	}
	writeJSON(w, 200, map[string]any{"items": v, "next_cursor": next})
}
func (s *Server) search(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len([]rune(query)) < 2 {
		errJSON(w, 400, errors.New("enter at least two characters"))
		return
	}
	archived, _ := strconv.ParseBool(r.URL.Query().Get("archived"))
	v, err := s.service.Repository().SearchChats(r.Context(), archived, query, 50)
	if err != nil {
		errJSON(w, 500, err)
		return
	}
	for index := range v {
		v[index] = s.presentChat(r.Context(), v[index])
		if latest, latestErr := s.service.Repository().LatestSourceMessage(r.Context(), v[index].ID); latestErr == nil {
			v[index].Latest = &latest
		}
		if history, historyErr := s.service.Repository().GetHistory(r.Context(), v[index].ID); historyErr == nil {
			v[index].History = &history
		}
		if coverage, coverageErr := s.service.Repository().GetHistoryCoverage(r.Context(), v[index].ID); coverageErr == nil {
			v[index].Coverage = &coverage
		}
	}
	writeJSON(w, 200, map[string]any{"items": v})
}
func (s *Server) latest(w http.ResponseWriter, r *http.Request) {
	chatID := strings.TrimSpace(r.PathValue("id"))
	if chatID == "" {
		errJSON(w, 400, errors.New("chat id is required"))
		return
	}
	latest, textErr := s.service.Repository().LatestMessage(r.Context(), chatID)
	latestSource, sourceErr := s.service.Repository().LatestSourceMessage(r.Context(), chatID)
	if textErr != nil && sourceErr != nil {
		errJSON(w, 404, errors.New("latest message not found"))
		return
	}
	result := map[string]any{}
	if textErr == nil {
		result["latest"] = latest
	}
	if sourceErr == nil {
		result["latest_source"] = latestSource
	}
	if history, historyErr := s.service.Repository().GetHistory(r.Context(), chatID); historyErr == nil {
		result["history"] = history
	}
	if truth, truthErr := s.conversationTruth(r.Context(), chatID); truthErr == nil {
		result["truth"] = truth
	}
	writeJSON(w, 200, result)
}

func (s *Server) truth(w http.ResponseWriter, r *http.Request) {
	chatID := strings.TrimSpace(r.PathValue("id"))
	if chatID == "" || len(chatID) > 256 {
		errJSON(w, 400, errors.New("valid chat id is required"))
		return
	}
	truth, err := s.conversationTruth(r.Context(), chatID)
	if err != nil {
		errJSON(w, 404, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, 200, truth)
}

func (s *Server) conversationTruth(ctx context.Context, chatID string) (ConversationTruth, error) {
	chat, err := s.service.Repository().GetChat(ctx, chatID)
	if err != nil {
		return ConversationTruth{}, errors.New("chat not found")
	}
	coverage, err := s.service.Repository().GetHistoryCoverage(ctx, chatID)
	if err != nil {
		return ConversationTruth{}, err
	}
	result := ConversationTruth{
		ChatID:              chatID,
		ObservedAt:          time.Now().UTC(),
		ConnectorState:      s.service.State(ctx),
		CurrentMessage:      ReadinessDimension{State: "unavailable", Reason: "No verified latest source message is stored."},
		CurrentStory:        ReadinessDimension{State: "unavailable", Reason: "No current conversation projection is available."},
		RelationshipHistory: ReadinessDimension{State: "unavailable", Reason: "No owner-authored relationship evidence is stored."},
		LifetimeHistory:     ReadinessDimension{State: coverage.State, Reason: "WhatsApp has not confirmed the beginning of this conversation."},
		Coverage:            coverage,
		CatalogueLatestAt:   chat.LastMessageAt,
	}
	latestSource, sourceErr := s.service.Repository().LatestSourceMessage(ctx, chatID)
	latestText, textErr := s.service.Repository().LatestMessage(ctx, chatID)
	if sourceErr == nil {
		result.LatestSourceID = latestSource.ID
		stamp := latestSource.Timestamp.UTC()
		result.LatestSourceAt = &stamp
	}
	if textErr == nil {
		result.LatestTextID = latestText.ID
	}
	if coverage.ProviderBeginningReached && coverage.ProviderStatus == domain.HistoryComplete {
		result.LifetimeHistory = ReadinessDimension{State: "complete", Reason: "WhatsApp explicitly confirmed the beginning of this conversation."}
	} else if coverage.State == "failed" {
		result.LifetimeHistory = ReadinessDimension{State: "failed", Reason: coverage.LastError}
	} else if coverage.State == "not_started" {
		result.LifetimeHistory = ReadinessDimension{State: "not_started", Reason: "No provider history attempt has been recorded."}
	} else if coverage.LastError != "" {
		result.LifetimeHistory = ReadinessDimension{State: "partial", Reason: coverage.LastError}
	}
	if coverage.OwnerTextMessages > 0 {
		state := "partial"
		reason := "Owner-authored evidence is available, but lifetime history is not proven complete."
		if coverage.ProviderBeginningReached && coverage.ProviderStatus == domain.HistoryComplete {
			state = "complete"
			reason = "Owner-authored evidence is available across provider-confirmed lifetime history."
		}
		result.RelationshipHistory = ReadinessDimension{State: state, Reason: reason}
	}
	revision, revisionErr := s.service.Repository().ConversationRevision(ctx, chatID)
	if revisionErr == nil {
		result.JournalSequence = revision.EventSequence
		result.UnresolvedEvidence = revision.UnresolvedCount
	}
	connectorCurrent := result.ConnectorState == "current-read-only"
	catalogueAligned := sourceErr == nil && latestSource.TimestampKnown && chat.LastMessageAt != nil && !chat.LastMessageAt.After(latestSource.Timestamp)
	switch {
	case !connectorCurrent:
		result.CurrentMessage = ReadinessDimension{State: "stale", Reason: "The connector is not caught up and read-only."}
	case sourceErr != nil || !latestSource.TimestampKnown:
		result.CurrentMessage = ReadinessDimension{State: "unavailable", Reason: "The latest source message has no verified timestamp."}
	case chat.LastMessageAt == nil:
		result.CurrentMessage = ReadinessDimension{State: "unverified", Reason: "The provider catalogue has no latest timestamp to reconcile."}
	case !catalogueAligned:
		result.CurrentMessage = ReadinessDimension{State: "stale", Reason: "The provider catalogue is newer than the latest locally stored source message."}
	case result.UnresolvedEvidence > 0:
		result.CurrentMessage = ReadinessDimension{State: "blocked", Reason: "Unresolved protocol revisions make the latest message ambiguous."}
	default:
		result.CurrentMessage = ReadinessDimension{State: "ready", Reason: "The exact source ID is persisted and its timestamp reaches the latest observed provider catalogue timestamp."}
	}
	state, stateErr := s.service.ConversationState(ctx, chatID)
	if stateErr == nil {
		result.ProjectedLatestTextID = state.LatestMessageID
		result.ProjectionSequence = state.ReducedThroughSequence
		if refreshed, refreshErr := s.service.Repository().ConversationRevision(ctx, chatID); refreshErr == nil {
			result.JournalSequence = refreshed.EventSequence
			result.UnresolvedEvidence = refreshed.UnresolvedCount
		}
	}
	switch {
	case result.CurrentMessage.State != "ready":
		result.CurrentStory = ReadinessDimension{State: "stale", Reason: "Current-story readiness requires a reconciled latest source message."}
	case textErr != nil:
		result.CurrentStory = ReadinessDimension{State: "needs_media", Reason: "The current conversation contains no verified text target; media may require review."}
	case stateErr != nil:
		result.CurrentStory = ReadinessDimension{State: "unavailable", Reason: "The durable conversation projection could not be refreshed."}
	case result.UnresolvedEvidence > 0:
		result.CurrentStory = ReadinessDimension{State: "blocked", Reason: "Unresolved protocol evidence prevents a trustworthy story projection."}
	case result.ProjectionSequence != result.JournalSequence:
		result.CurrentStory = ReadinessDimension{State: "stale", Reason: "The conversation projection has not consumed the complete local event journal."}
	case result.ProjectedLatestTextID != result.LatestTextID:
		result.CurrentStory = ReadinessDimension{State: "stale", Reason: "The conversation projection and latest verified text disagree."}
	case result.LatestSourceID != result.LatestTextID:
		result.CurrentStory = ReadinessDimension{State: "needs_media", Reason: "A newer non-text item must be reviewed before drafting from the story."}
	default:
		result.CurrentStory = ReadinessDimension{State: "ready", Reason: "The projection consumed the journal and agrees with the latest verified text target."}
		result.DraftFromCurrentStoryAllowed = true
	}
	return result, nil
}

func (s *Server) conversationRevision(w http.ResponseWriter, r *http.Request) {
	chatID := strings.TrimSpace(r.PathValue("id"))
	if chatID == "" || len(chatID) > 256 {
		errJSON(w, 400, errors.New("valid chat id is required"))
		return
	}
	snapshot, err := s.service.Repository().ConversationRevision(r.Context(), chatID)
	if err != nil {
		errJSON(w, 404, errors.New("conversation revision is unavailable"))
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, snapshot)
}

func (s *Server) media(w http.ResponseWriter, r *http.Request) {
	messageID := strings.TrimSpace(r.PathValue("id"))
	if messageID == "" || len(messageID) > 256 {
		errJSON(w, 400, errors.New("media id is invalid"))
		return
	}
	asset, err := s.service.Repository().GetMedia(r.Context(), messageID)
	if err != nil || asset.Metadata.Status == "blocked_view_once" {
		errJSON(w, 404, errors.New("media is unavailable"))
		return
	}
	data := asset.Data
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(asset.Metadata.MimeType, ";")[0]))
	if len(data) == 0 {
		data = asset.Thumbnail
		contentType = "image/jpeg"
	}
	viewable := contentType == "image/jpeg" || contentType == "image/png" || contentType == "image/webp" || contentType == "image/gif" || contentType == "video/mp4" || contentType == "video/webm" || contentType == "application/pdf"
	if len(data) == 0 || !viewable {
		errJSON(w, 404, errors.New("viewable media is unavailable"))
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Disposition", "inline")
	name := strings.TrimSpace(asset.Metadata.FileName)
	if name == "" {
		name = "media"
	}
	http.ServeContent(w, r, name, asset.UpdatedAt, bytes.NewReader(data))
}
func (s *Server) toneSamples(w http.ResponseWriter, r *http.Request) {
	chatID := strings.TrimSpace(r.URL.Query().Get("chat_id"))
	if chatID == "" {
		errJSON(w, 400, errors.New("chat id is required"))
		return
	}
	general, err := s.service.Repository().ListOwnerTextMessages(r.Context(), "", 160)
	if err != nil {
		errJSON(w, 500, err)
		return
	}
	person, err := s.service.Repository().ListOwnerTextMessages(r.Context(), chatID, 100)
	if err != nil {
		errJSON(w, 500, err)
		return
	}
	profiles := make([]domain.Chat, 0)
	seenChats := make(map[string]bool)
	for _, message := range append(append([]domain.Message{}, general...), person...) {
		id := strings.TrimSpace(message.ChatID)
		if id == "" || seenChats[id] {
			continue
		}
		seenChats[id] = true
		if chat, chatErr := s.service.Repository().GetChat(r.Context(), id); chatErr == nil {
			profiles = append(profiles, chat)
		}
	}
	writeJSON(w, 200, map[string]any{"general": general, "person_specific": person, "chat_profiles": profiles})
}
func (s *Server) responseEpisodes(w http.ResponseWriter, r *http.Request) {
	bound, ok := s.service.Repository().(store.AccountBindingRepository)
	if !ok {
		errJSON(w, 409, store.ErrAccountUnbound)
		return
	}
	binding, err := bound.AccountBinding(r.Context())
	if err != nil {
		errJSON(w, 409, err)
		return
	}
	episodes, err := s.service.Repository().ListResponseEpisodes(r.Context(), limit(r))
	if err != nil {
		errJSON(w, 500, err)
		return
	}
	profiles := make([]domain.Chat, 0)
	seenChats := make(map[string]bool)
	for _, episode := range episodes {
		if episode.Chat.ID == "" || seenChats[episode.Chat.ID] {
			continue
		}
		seenChats[episode.Chat.ID] = true
		profiles = append(profiles, episode.Chat)
	}
	w.Header().Set("Cache-Control", "private, no-store")
	writeJSON(w, 200, map[string]any{
		"account_scope_id": binding.AccountScopeID,
		"items":            episodes,
		"chat_profiles":    profiles,
	})
}
func (s *Server) messages(w http.ResponseWriter, r *http.Request) {
	v, err := s.service.Repository().ListMessages(r.Context(), r.PathValue("id"), limit(r), r.URL.Query().Get("before"))
	if err != nil {
		errJSON(w, 500, err)
		return
	}
	writeJSON(w, 200, map[string]any{"items": v})
}
func (s *Server) history(w http.ResponseWriter, r *http.Request) {
	v, err := s.service.Repository().GetHistory(r.Context(), r.PathValue("id"))
	if err != nil {
		errJSON(w, 404, err)
		return
	}
	coverage, coverageErr := s.service.Repository().GetHistoryCoverage(r.Context(), r.PathValue("id"))
	if coverageErr != nil {
		errJSON(w, 500, coverageErr)
		return
	}
	// Preserve the original flat history contract while extending it with an
	// independently measured local coverage object.
	writeJSON(w, 200, map[string]any{
		"chat_id":         v.ChatID,
		"status":          v.Status,
		"oldest_cursor":   v.OldestCursor,
		"newest_cursor":   v.NewestCursor,
		"messages_seen":   v.MessagesSeen,
		"history_end_hit": v.HistoryEndHit,
		"last_error":      v.LastError,
		"updated_at":      v.UpdatedAt,
		"coverage":        coverage,
	})
}
func (s *Server) conversationState(w http.ResponseWriter, r *http.Request) {
	chatID := strings.TrimSpace(r.PathValue("id"))
	if chatID == "" {
		errJSON(w, 400, errors.New("chat id is required"))
		return
	}
	if _, err := s.service.Repository().GetChat(r.Context(), chatID); err != nil {
		errJSON(w, 404, errors.New("chat not found"))
		return
	}
	state, err := s.service.ConversationState(r.Context(), chatID)
	if err != nil {
		errJSON(w, 500, err)
		return
	}
	writeJSON(w, 200, state)
}

func (s *Server) workspace(w http.ResponseWriter, r *http.Request) {
	// Drive the workspace from the complete chat catalogue, rather than only
	// snapshots that already happened to have conversation state. This keeps
	// media-only and newly discovered conversations visible in the decision list.
	states, err := s.service.Repository().ListConversationStates(r.Context(), 10000)
	if err != nil {
		errJSON(w, 500, err)
		return
	}
	stateByChat := make(map[string]domain.ConversationState, len(states))
	for _, state := range states {
		if state.Version != conversationstate.StateVersion {
			state, err = s.service.ConversationState(r.Context(), state.ChatID)
			if err != nil {
				errJSON(w, 500, err)
				return
			}
		}
		stateByChat[state.ChatID] = state
	}
	chats := make([]domain.Chat, 0, 512)
	for _, archived := range []bool{false, true} {
		cursor := ""
		for page := 0; page < 1000; page++ {
			batch, err := s.service.Repository().ListChats(r.Context(), archived, 500, cursor)
			if err != nil {
				errJSON(w, 500, err)
				return
			}
			chats = append(chats, batch...)
			if len(batch) < 500 {
				break
			}
			next := batch[len(batch)-1].ID
			if next == "" || next == cursor {
				errJSON(w, 500, errors.New("chat cursor stalled"))
				return
			}
			cursor = next
		}
	}
	items := make([]map[string]any, 0, len(chats))
	for _, chat := range chats {
		chat = s.presentChat(r.Context(), chat)
		item := map[string]any{"chat": chat}
		latest, latestErr := s.service.Repository().LatestSourceMessage(r.Context(), chat.ID)
		state, hasState := stateByChat[chat.ID]
		if !hasState && chat.SourceID != "" {
			state, hasState = stateByChat[chat.SourceID]
		}
		if hasState {
			state.ChatID = chat.ID
			item["state"] = state
		} else if latestErr == nil {
			// Legacy/imported chats may have durable message events but no projection
			// row yet. Materialize them before publishing queues so an unopened chat
			// cannot silently lose its Decision, Task or Follow-up.
			state, stateErr := s.service.ConversationState(r.Context(), chat.ID)
			if stateErr != nil {
				errJSON(w, 500, stateErr)
				return
			}
			state.ChatID = chat.ID
			stateByChat[chat.ID] = state
			if chat.SourceID != "" {
				stateByChat[chat.SourceID] = state
			}
			item["state"] = state
		}
		if latestErr == nil {
			item["latest"] = latest
		}
		items = append(items, item)
	}
	writeJSON(w, 200, map[string]any{"items": items})
}
func (s *Server) events(w http.ResponseWriter, r *http.Request) {
	f, ok := w.(http.Flusher)
	if !ok {
		errJSON(w, 500, errors.New("streaming unsupported"))
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	id, ch := s.broker.subscribe()
	defer s.broker.unsubscribe(id)
	for {
		select {
		case data, ok := <-ch:
			if !ok {
				return
			}
			_, _ = fmt.Fprintf(w, "data: %s\n\n", data)
			f.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

type outboundRequest struct {
	Recipient       string `json:"recipient"`
	Body            string `json:"body"`
	TargetMessageID string `json:"target_message_id"`
	IdempotencyKey  string `json:"idempotency_key"`
	ApprovalToken   string `json:"approval_token"`
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		errJSON(w, 400, err)
		return false
	}
	return true
}
func (s *Server) approve(w http.ResponseWriter, r *http.Request) {
	var v outboundRequest
	if !decode(w, r, &v) {
		return
	}
	token, err := s.service.IssueApproval(r.Context(), strings.TrimSpace(v.Recipient), v.Body, strings.TrimSpace(v.TargetMessageID), strings.TrimSpace(v.IdempotencyKey), 2*time.Minute)
	if err != nil {
		errJSON(w, 403, err)
		return
	}
	writeJSON(w, 201, map[string]any{"approval_token": token, "expires_in_seconds": 120})
}
func (s *Server) send(w http.ResponseWriter, r *http.Request) {
	var v outboundRequest
	if !decode(w, r, &v) {
		return
	}
	id, err := s.service.SendApproved(r.Context(), strings.TrimSpace(v.Recipient), v.Body, strings.TrimSpace(v.TargetMessageID), strings.TrimSpace(v.IdempotencyKey), v.ApprovalToken)
	if err != nil {
		errJSON(w, 403, err)
		return
	}
	writeJSON(w, 200, map[string]string{"message_id": id})
}
func LoopbackOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.RemoteAddr
		if strings.HasPrefix(host, "127.0.0.1:") || strings.HasPrefix(host, "[::1]:") || host == "" {
			next.ServeHTTP(w, r)
			return
		}
		errJSON(w, 403, errors.New("localhost access only"))
	})
}

func RequireBearer(next http.Handler, token string) http.Handler {
	expected := []byte("Bearer " + strings.TrimSpace(token))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		provided := []byte(r.Header.Get("Authorization"))
		if len(expected) <= len("Bearer ") || len(provided) != len(expected) || subtle.ConstantTimeCompare(provided, expected) != 1 {
			errJSON(w, 401, errors.New("local bridge authorization required"))
			return
		}
		next.ServeHTTP(w, r)
	})
}
