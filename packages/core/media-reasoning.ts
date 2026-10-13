import type { MessageEvent } from "./domain.ts";

export type MediaSourceType = "caption" | "image_classification" | "image_ocr" | "document_text" | "voice_transcript";

export type MediaDerivedFact = {
  fact: string;
  sourceType: MediaSourceType;
  confidence: number;
  safeToRepeat: boolean;
  userVerified: boolean;
};

export type MediaReasoningPolicy = {
  mediaAnalysisConsented: boolean;
  allowCloudAnalysis: boolean;
  retentionDays: number;
};

const SECRET_OR_CREDENTIAL = /\b(?:cvv|otp|one[ -]?time pass(?:code|word)|pass(?:code|word)|pin|private key|recovery code|secret|security code)\b|\b(?:\d[ -]?){12,19}\b/iu;

function isSensitiveFact(fact: string) {
  return SECRET_OR_CREDENTIAL.test(fact);
}

export function createMediaReasoningPacket(options: {
  event: MessageEvent;
  facts: MediaDerivedFact[];
  policy: MediaReasoningPolicy;
  processedAt: string;
}) {
  const media = options.event.media;
  if (!media) throw new Error("Media reasoning requires a media event.");
  if (media.category === "view_once" || media.status === "blocked_view_once") {
    return {
      messageId: options.event.id,
      status: "blocked-view-once" as const,
      processor: "none" as const,
      facts: [],
      factsEligibleForDraft: [],
      requiresUserVerification: false,
      reason: "View-once media is never processed or retained.",
    };
  }
  if (!options.policy.mediaAnalysisConsented) {
    return {
      messageId: options.event.id,
      status: "blocked-no-consent" as const,
      processor: "none" as const,
      facts: [],
      factsEligibleForDraft: [],
      requiresUserVerification: false,
      reason: "Media analysis consent is required.",
    };
  }
  if (media.status !== "ready") {
    return {
      messageId: options.event.id,
      status: "metadata-only" as const,
      processor: "none" as const,
      facts: [],
      factsEligibleForDraft: [],
      requiresUserVerification: false,
      reason: "The media bytes are not available for analysis.",
    };
  }

  const facts = options.facts
    .map((fact, index) => {
      const text = String(fact.fact || "").trim().slice(0, 1_000);
      const sensitive = isSensitiveFact(text);
      const confidence = Math.max(0, Math.min(1, Number(fact.confidence) || 0));
      const requiresUserVerification = fact.sourceType !== "caption" || confidence < 0.95 || sensitive;
      const eligibleForDraft = Boolean(
        text
        && fact.safeToRepeat
        && !sensitive
        && confidence >= 0.8
        && (!requiresUserVerification || fact.userVerified),
      );
      return {
        id: `${options.event.id}:media-fact:${index + 1}`,
        sourceMessageId: options.event.id,
        sourceType: fact.sourceType,
        fact: text,
        confidence,
        sensitive,
        safeToRepeat: Boolean(fact.safeToRepeat),
        userVerified: Boolean(fact.userVerified),
        requiresUserVerification,
        eligibleForDraft,
        observedAt: options.processedAt,
      };
    })
    .filter((fact) => fact.fact);

  return {
    messageId: options.event.id,
    status: "analyzed" as const,
    processor: options.policy.allowCloudAnalysis ? "consented-cloud" as const : "local-only" as const,
    retentionDays: Math.max(0, Math.min(365, Math.floor(options.policy.retentionDays))),
    facts,
    factsEligibleForDraft: facts.filter((fact) => fact.eligibleForDraft).map((fact) => fact.id),
    requiresUserVerification: facts.some((fact) => fact.requiresUserVerification && !fact.userVerified),
    reason: facts.length ? "Media facts retain source and verification status." : "No facts were extracted.",
  };
}

/** Diagnostic projection intentionally excludes text, file name, URLs and bytes. */
export function redactedMediaDiagnostic(packet: ReturnType<typeof createMediaReasoningPacket>) {
  const facts = "facts" in packet && Array.isArray(packet.facts) ? packet.facts : [];
  return {
    messageId: packet.messageId,
    status: packet.status,
    processor: packet.processor,
    factCount: facts.length,
    eligibleFactCount: packet.factsEligibleForDraft.length,
    sourceTypes: [...new Set(facts.map((fact) => fact.sourceType))].sort(),
    requiresUserVerification: packet.requiresUserVerification,
  };
}
