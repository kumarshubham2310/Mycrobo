import assert from "node:assert/strict";
import test from "node:test";

import { createMediaReasoningPacket, redactedMediaDiagnostic } from "./media-reasoning.ts";

const image = {
  id: "message-image-1",
  kind: "image",
  media: {
    category: "image",
    mimeType: "image/jpeg",
    fileName: "private-invoice.jpg",
    sizeBytes: 1200,
    width: 800,
    height: 600,
    status: "ready",
    viewUrl: "/api/v1/media/message-image-1",
  },
};

const localPolicy = { mediaAnalysisConsented: true, allowCloudAnalysis: false, retentionDays: 30 };

test("view-once media is never processed even when media analysis is consented", () => {
  const packet = createMediaReasoningPacket({
    event: { ...image, media: { ...image.media, category: "view_once" } },
    facts: [{ fact: "private image", sourceType: "image_ocr", confidence: 1, safeToRepeat: true, userVerified: true }],
    policy: localPolicy,
    processedAt: "2026-08-26T10:00:00.000Z",
  });
  assert.equal(packet.status, "blocked-view-once");
  assert.deepEqual(packet.facts, []);
});

test("media analysis is blocked without explicit consent", () => {
  const packet = createMediaReasoningPacket({
    event: image,
    facts: [],
    policy: { ...localPolicy, mediaAnalysisConsented: false },
    processedAt: "2026-08-26T10:00:00.000Z",
  });
  assert.equal(packet.status, "blocked-no-consent");
});

test("uncertain OCR and credentials cannot become draft facts", () => {
  const packet = createMediaReasoningPacket({
    event: image,
    facts: [
      { fact: "The total appears to be ₹5,000", sourceType: "image_ocr", confidence: 0.81, safeToRepeat: true, userVerified: false },
      { fact: "OTP 123456", sourceType: "image_ocr", confidence: 1, safeToRepeat: true, userVerified: true },
    ],
    policy: localPolicy,
    processedAt: "2026-08-26T10:00:00.000Z",
  });
  assert.deepEqual(packet.factsEligibleForDraft, []);
  assert.equal(packet.requiresUserVerification, true);
  assert.equal(packet.facts[1].sensitive, true);
});

test("a verified safe media fact preserves provenance and can be retrieved", () => {
  const packet = createMediaReasoningPacket({
    event: image,
    facts: [{ fact: "The invoice total is ₹5,000", sourceType: "image_ocr", confidence: 0.93, safeToRepeat: true, userVerified: true }],
    policy: localPolicy,
    processedAt: "2026-08-26T10:00:00.000Z",
  });
  assert.deepEqual(packet.factsEligibleForDraft, ["message-image-1:media-fact:1"]);
  assert.equal(packet.facts[0].sourceMessageId, image.id);
});

test("redacted diagnostics contain no media text, filename, URL or bytes", () => {
  const packet = createMediaReasoningPacket({
    event: image,
    facts: [{ fact: "Confidential client total", sourceType: "image_ocr", confidence: 0.9, safeToRepeat: false, userVerified: false }],
    policy: localPolicy,
    processedAt: "2026-08-26T10:00:00.000Z",
  });
  const serialized = JSON.stringify(redactedMediaDiagnostic(packet));
  assert.doesNotMatch(serialized, /Confidential|private-invoice|api\/v1\/media/u);
  assert.match(serialized, /message-image-1/u);
});
