package whatsmeowlive

import (
	"testing"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"google.golang.org/protobuf/proto"
)

func TestMediaFromMessageExtractsViewableImageMetadata(t *testing.T) {
	message := &waE2E.Message{ImageMessage: &waE2E.ImageMessage{
		Mimetype: proto.String("image/jpeg"), FileLength: proto.Uint64(321), Width: proto.Uint32(640), Height: proto.Uint32(480), JPEGThumbnail: []byte("thumb"),
	}}
	asset, downloadable, ok := mediaFromMessage(message, "photo-1")
	if !ok || downloadable == nil || asset.MessageID != "photo-1" || asset.Metadata.Category != "image" || asset.Metadata.Status != "thumbnail" || asset.Metadata.Width != 640 || string(asset.Thumbnail) != "thumb" || len(asset.DownloadInfo) == 0 {
		t.Fatalf("asset=%#v downloadable=%T ok=%v", asset, downloadable, ok)
	}
	var restored waE2E.Message
	if err := proto.Unmarshal(asset.DownloadInfo, &restored); err != nil || restored.GetImageMessage() == nil {
		t.Fatalf("durable download reference was not restorable: %v", err)
	}
}

func TestMediaFromMessageNeverDownloadsViewOnce(t *testing.T) {
	message := &waE2E.Message{ViewOnceMessage: &waE2E.FutureProofMessage{Message: &waE2E.Message{ImageMessage: &waE2E.ImageMessage{Mimetype: proto.String("image/jpeg")}}}}
	asset, downloadable, ok := mediaFromMessage(message, "private-1")
	if !ok || downloadable != nil || asset.Metadata.Category != "view_once" || asset.Metadata.Status != "blocked_view_once" || len(asset.DownloadInfo) != 0 {
		t.Fatalf("asset=%#v downloadable=%T ok=%v", asset, downloadable, ok)
	}
}

func TestMediaFromMessageMakesBrowserSafeVideoDownloadable(t *testing.T) {
	message := &waE2E.Message{VideoMessage: &waE2E.VideoMessage{
		Mimetype: proto.String("video/mp4"), FileLength: proto.Uint64(2048), Width: proto.Uint32(1280), Height: proto.Uint32(720), JPEGThumbnail: []byte("video-thumb"),
	}}
	asset, downloadable, ok := mediaFromMessage(message, "video-1")
	if !ok || downloadable == nil || asset.Metadata.Category != "video" || asset.Metadata.MimeType != "video/mp4" || asset.Metadata.Status != "thumbnail" || len(asset.DownloadInfo) == 0 {
		t.Fatalf("asset=%#v downloadable=%T ok=%v", asset, downloadable, ok)
	}
}

func TestMediaFromMessageMakesPDFDownloadableButRejectsOtherDocuments(t *testing.T) {
	pdf := &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{
		Mimetype: proto.String("application/pdf"), FileName: proto.String("brief.pdf"), FileLength: proto.Uint64(4096),
	}}
	asset, downloadable, ok := mediaFromMessage(pdf, "pdf-1")
	if !ok || downloadable == nil || asset.Metadata.MimeType != "application/pdf" || asset.Metadata.FileName != "brief.pdf" || len(asset.DownloadInfo) == 0 {
		t.Fatalf("asset=%#v downloadable=%T ok=%v", asset, downloadable, ok)
	}
	word := &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{Mimetype: proto.String("application/msword"), FileLength: proto.Uint64(1024)}}
	asset, downloadable, ok = mediaFromMessage(word, "word-1")
	if !ok || downloadable == nil || asset.Metadata.MimeType != "" {
		t.Fatalf("unsafe document asset=%#v downloadable=%T ok=%v", asset, downloadable, ok)
	}
}
