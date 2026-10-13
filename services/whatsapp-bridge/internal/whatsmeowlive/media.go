package whatsmeowlive

import (
	"context"
	"errors"
	"strings"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"

	"mycrobo/whatsapp-bridge/internal/domain"
)

const (
	maximumCachedImageBytes = 12 * 1024 * 1024
	maximumCachedVideoBytes = 64 * 1024 * 1024
	maximumCachedPDFBytes   = 32 * 1024 * 1024
)

type mediaJob struct {
	asset        domain.MediaAsset
	downloadable whatsmeow.DownloadableMessage
	client       *whatsmeow.Client
	accountID    string
	epoch        string
}

func safeImageMIME(value string) string {
	value = strings.ToLower(strings.TrimSpace(strings.Split(value, ";")[0]))
	switch value {
	case "image/jpeg", "image/png", "image/webp", "image/gif":
		return value
	default:
		return ""
	}
}

func safeViewableMIME(category, value string) string {
	value = strings.ToLower(strings.TrimSpace(strings.Split(value, ";")[0]))
	switch category {
	case "image":
		return safeImageMIME(value)
	case "video":
		if value == "video/mp4" || value == "video/webm" {
			return value
		}
	case "document":
		if value == "application/pdf" {
			return value
		}
	}
	return ""
}

func maximumViewableBytes(category string) int {
	switch category {
	case "image":
		return maximumCachedImageBytes
	case "video":
		return maximumCachedVideoBytes
	case "document":
		return maximumCachedPDFBytes
	default:
		return 0
	}
}

func statusForThumbnail(thumbnail []byte) string {
	if len(thumbnail) > 0 {
		return "thumbnail"
	}
	return "metadata_only"
}

func mediaFromMessage(message *waE2E.Message, messageID string) (domain.MediaAsset, whatsmeow.DownloadableMessage, bool) {
	now := time.Now().UTC()
	downloadInfo, _ := proto.Marshal(message)
	if image := message.GetImageMessage(); image != nil {
		asset := domain.MediaAsset{
			MessageID: messageID,
			Metadata: domain.MediaMetadata{
				Category: "image", MimeType: safeImageMIME(image.GetMimetype()), SizeBytes: int64(image.GetFileLength()),
				Width: int(image.GetWidth()), Height: int(image.GetHeight()), Status: statusForThumbnail(image.GetJPEGThumbnail()),
			},
			Thumbnail: image.GetJPEGThumbnail(), DownloadInfo: downloadInfo, UpdatedAt: now,
		}
		return asset, image, true
	}
	if video := message.GetVideoMessage(); video != nil {
		asset := domain.MediaAsset{MessageID: messageID, Metadata: domain.MediaMetadata{
			Category: "video", MimeType: safeViewableMIME("video", video.GetMimetype()), SizeBytes: int64(video.GetFileLength()),
			Width: int(video.GetWidth()), Height: int(video.GetHeight()), Status: statusForThumbnail(video.GetJPEGThumbnail()),
		}, Thumbnail: video.GetJPEGThumbnail(), DownloadInfo: downloadInfo, UpdatedAt: now}
		return asset, video, true
	}
	if audio := message.GetAudioMessage(); audio != nil {
		return domain.MediaAsset{MessageID: messageID, Metadata: domain.MediaMetadata{Category: "audio", MimeType: strings.TrimSpace(audio.GetMimetype()), SizeBytes: int64(audio.GetFileLength()), Status: "metadata_only"}, UpdatedAt: now}, nil, true
	}
	if document := message.GetDocumentMessage(); document != nil {
		asset := domain.MediaAsset{MessageID: messageID, Metadata: domain.MediaMetadata{
			Category: "document", MimeType: safeViewableMIME("document", document.GetMimetype()), FileName: strings.TrimSpace(document.GetFileName()), SizeBytes: int64(document.GetFileLength()), Status: statusForThumbnail(document.GetJPEGThumbnail()),
		}, Thumbnail: document.GetJPEGThumbnail(), DownloadInfo: downloadInfo, UpdatedAt: now}
		return asset, document, true
	}
	if sticker := message.GetStickerMessage(); sticker != nil {
		return domain.MediaAsset{MessageID: messageID, Metadata: domain.MediaMetadata{Category: "sticker", MimeType: strings.TrimSpace(sticker.GetMimetype()), SizeBytes: int64(sticker.GetFileLength()), Status: "metadata_only"}, UpdatedAt: now}, nil, true
	}
	if message.GetViewOnceMessage() != nil || message.GetViewOnceMessageV2() != nil || message.GetViewOnceMessageV2Extension() != nil {
		return domain.MediaAsset{MessageID: messageID, Metadata: domain.MediaMetadata{Category: "view_once", Status: "blocked_view_once"}, UpdatedAt: now}, nil, true
	}
	return domain.MediaAsset{}, nil, false
}

func (l *Live) queueMedia(asset domain.MediaAsset, downloadable whatsmeow.DownloadableMessage) bool {
	maximum := maximumViewableBytes(asset.Metadata.Category)
	if downloadable == nil || maximum == 0 || safeViewableMIME(asset.Metadata.Category, asset.Metadata.MimeType) == "" || asset.Metadata.SizeBytes <= 0 || asset.Metadata.SizeBytes > int64(maximum) {
		return false
	}
	l.mu.RLock()
	defer l.mu.RUnlock()
	if l.state != "current-read-only" || l.boundAccountID == "" || l.accountProof == "" || l.client == nil {
		return false
	}
	select {
	case l.mediaQueue <- mediaJob{asset: asset, downloadable: downloadable, client: l.client, accountID: l.boundAccountID, epoch: l.connectionEpoch}:
		return true
	default:
		// The thumbnail remains viewable. A later history/live replay can retry
		// the bounded full-image cache without blocking message ingestion.
		return false
	}
}

// RetryMedia reconstructs WhatsApp's encrypted attachment reference from the
// durable local record. No chat message is created or sent by this operation.
func (l *Live) RetryMedia(ctx context.Context, messageID string) error {
	if _, err := l.currentAccountClient(ctx); err != nil {
		return err
	}
	if l.ConnectionState(ctx) != "current-read-only" {
		return errors.New("reconnect WhatsApp to fetch this attachment")
	}
	asset, err := l.service.Repository().GetMedia(ctx, strings.TrimSpace(messageID))
	if err != nil {
		return errors.New("attachment record was not found")
	}
	if asset.Metadata.Status == "ready" && len(asset.Data) > 0 {
		return nil
	}
	if asset.Metadata.Status == "blocked_view_once" {
		return errors.New("view-once media stays private to WhatsApp")
	}
	if len(asset.DownloadInfo) == 0 {
		return errors.New("this older attachment needs WhatsApp to replay it before it can be fetched")
	}
	var message waE2E.Message
	if err = proto.Unmarshal(asset.DownloadInfo, &message); err != nil {
		return errors.New("the saved attachment reference is invalid")
	}
	_, downloadable, ok := mediaFromMessage(&message, asset.MessageID)
	if !ok || downloadable == nil {
		return errors.New("this attachment type cannot be fetched")
	}
	asset.Metadata.Status = "queued"
	asset.UpdatedAt = time.Now().UTC()
	if err = l.service.Repository().PutMedia(ctx, asset); err != nil {
		return err
	}
	if !l.queueMedia(asset, downloadable) {
		asset.Metadata.Status = "failed"
		_ = l.service.Repository().PutMedia(ctx, asset)
		return errors.New("the attachment queue is busy; try again")
	}
	return nil
}

func (l *Live) runMediaWorker(ctx context.Context) {
	for {
		select {
		case job := <-l.mediaQueue:
			if !l.mediaJobCurrent(job) {
				continue
			}
			maximum := maximumViewableBytes(job.asset.Metadata.Category)
			timeout := 45 * time.Second
			if job.asset.Metadata.Category == "video" || job.asset.Metadata.Category == "document" {
				timeout = 90 * time.Second
			}
			downloadCtx, cancel := context.WithTimeout(ctx, timeout)
			data, err := job.client.Download(downloadCtx, job.downloadable)
			cancel()
			if err != nil || maximum == 0 || len(data) == 0 || len(data) > maximum {
				job.asset.Metadata.Status = "failed"
				if errors.Is(err, context.Canceled) && ctx.Err() != nil {
					return
				}
				l.commitMediaJob(ctx, job)
				continue
			}
			job.asset.Data = data
			job.asset.Metadata.Status = "ready"
			job.asset.UpdatedAt = time.Now().UTC()
			l.commitMediaJob(ctx, job)
		case <-ctx.Done():
			return
		}
	}
}

func (l *Live) mediaJobCurrent(job mediaJob) bool {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.mediaJobCurrentLocked(job)
}

func (l *Live) mediaJobCurrentLocked(job mediaJob) bool {
	return job.client != nil && l.client == job.client && job.accountID != "" && job.accountID == l.boundAccountID && job.epoch == l.connectionEpoch && l.state == "current-read-only" && l.accountProof != ""
}

// Revalidate under the same lock as account/session changes; late downloads
// are discarded and cannot update a replacement session's media state.
func (l *Live) commitMediaJob(ctx context.Context, job mediaJob) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	if !l.mediaJobCurrentLocked(job) {
		return
	}
	_ = l.service.Repository().PutMedia(ctx, job.asset)
}
