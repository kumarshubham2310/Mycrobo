import assert from "node:assert/strict";
import test from "node:test";

import { mediaPresentation } from "./media-presentation.mjs";

test("browser-safe video and PDF attachments open in-app", () => {
  assert.equal(mediaPresentation({ media: { category: "video", mimeType: "video/mp4", status: "ready", viewUrl: "/video" } }).kind, "video");
  assert.equal(mediaPresentation({ media: { category: "document", mimeType: "application/pdf", status: "ready", viewUrl: "/pdf" } }).kind, "pdf");
});

test("ready audio opens in a private in-app player", () => {
  const audio = mediaPresentation({ media: { category: "audio", mimeType: "audio/ogg", status: "ready", viewUrl: "/api/v1/media/a1", fullAvailable: true } });
  assert.equal(audio.kind, "audio");
  assert.equal(audio.canView, true);
});

test("partial video and PDF attachments remain honest pending placeholders", () => {
  const video = mediaPresentation({ media: { category: "video", mimeType: "video/mp4", status: "thumbnail", fetchAvailable: true } });
  const pdf = mediaPresentation({ media: { category: "document", mimeType: "application/pdf", status: "metadata_only", fileName: "brief.pdf", fetchAvailable: true } });
  assert.equal(video.kind, "placeholder");
  assert.equal(video.pending, true);
  assert.equal(video.canRetry, true);
  assert.equal(video.retryLabel, "Fetch video");
  assert.match(video.detail, /not saved for viewing/iu);
  assert.equal(pdf.pending, true);
  assert.equal(pdf.canRetry, true);
  assert.equal(pdf.retryLabel, "Fetch PDF");
  assert.match(mediaPresentation({ media: { category: "document", mimeType: "application/pdf", status: "queued", fileName: "brief.pdf" } }).detail, /Fetching this attachment locally/iu);
});

test("failed PDF and video fetches remain explicitly retryable", () => {
  assert.equal(mediaPresentation({ media: { category: "video", mimeType: "video/mp4", status: "failed", fetchAvailable: true } }).canRetry, true);
  assert.equal(mediaPresentation({ media: { category: "document", mimeType: "application/pdf", status: "failed", fetchAvailable: true } }).canRetry, true);
});

test("photos expose an honest thumbnail preview and a full-photo recovery action", () => {
  const thumbnail = mediaPresentation({ media: { category: "image", mimeType: "image/jpeg", status: "thumbnail", previewAvailable: true, fullAvailable: false, fetchAvailable: true, viewUrl: "/photo" } });
  assert.equal(thumbnail.kind, "image");
  assert.equal(thumbnail.canView, true);
  assert.equal(thumbnail.canRetry, true);
  assert.equal(thumbnail.retryLabel, "Load full photo");
  assert.match(thumbnail.detail, /thumbnail/iu);

  const missing = mediaPresentation({ media: { category: "image", mimeType: "image/jpeg", status: "metadata_only", previewAvailable: false, fullAvailable: false, fetchAvailable: true } });
  assert.equal(missing.kind, "placeholder");
  assert.equal(missing.canRetry, true);
  assert.equal(missing.retryLabel, "Load full photo");
});

test("photos without a durable WhatsApp reference do not offer a broken retry", () => {
  const unavailable = mediaPresentation({ media: { category: "image", mimeType: "image/jpeg", status: "metadata_only", fetchAvailable: false } });
  assert.equal(unavailable.canRetry, false);
  assert.match(unavailable.detail, /has not provided/iu);
});

test("view-once content is never exposed", () => {
  const result = mediaPresentation({ media: { category: "view_once", status: "blocked_view_once", viewUrl: "/must-not-open" } });
  assert.equal(result.canView, false);
  assert.match(result.detail, /private/iu);
});
