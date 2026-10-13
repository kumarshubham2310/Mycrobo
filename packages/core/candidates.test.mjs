import assert from "node:assert/strict";
import test from "node:test";

import { evaluateDraftCandidates } from "./candidates.ts";
import { phraseTemplateFingerprint } from "./phrase-bank.ts";

const context = {
  story: [{ id: "latest", speaker: "OTHER", text: "What time will you reach?", isTarget: true }],
  tone: { personSpecificExamples: ["Okay"], generalExamples: [] },
  relationship: { medianOwnerReplyCharacters: 8 },
  safety: { requiresCurrentFact: true },
  userIntent: null,
};

test("independent evaluation rejects invented commitments and selects an editable fact slot", () => {
  const result = evaluateDraftCandidates([
    { draft: "I will reach at 7", language: "English", evidenceIds: ["latest"] },
    { draft: "[Add the actual time before sending]", language: "English", evidenceIds: ["latest"] },
  ], context);
  assert.equal(result.selected.draft, "[Add the actual time before sending]");
  assert.equal(result.evaluations[0].accepted, false);
});

test("evaluation rejects foreign evidence, credentials and generic assistant tells", () => {
  for (const candidate of [
    { draft: "Okay", language: "English", evidenceIds: ["another-chat"] },
    { draft: "OTP is 123456", language: "English", evidenceIds: ["latest"] },
    { draft: "Certainly! I'd be happy to assist", language: "English", evidenceIds: ["latest"] },
  ]) {
    assert.throws(() => evaluateDraftCandidates([candidate], { ...context, safety: { requiresCurrentFact: false } }), /No candidate passed/iu);
  }
});

test("evaluation is deterministic, deduplicates candidates and does not expose a tone percentage", () => {
  const acknowledgementContext = {
    ...context,
    story: [{ id: "latest", speaker: "OTHER", text: "Okay", isTarget: true }],
    safety: { requiresCurrentFact: false },
  };
  const result = evaluateDraftCandidates([
    { draft: "Okay", language: "English", evidenceIds: ["latest"] },
    { draft: " okay ", language: "English", evidenceIds: ["latest"] },
    { draft: "Got it", language: "English", evidenceIds: ["latest"] },
  ], acknowledgementContext);
  assert.equal(result.evaluations.length, 2);
  assert.equal(Object.hasOwn(result.selected, "toneMatch"), false);
});

test("an observed exact-person acknowledgement outranks an unobserved stock acknowledgement", () => {
  const acknowledgementContext = {
    ...context,
    story: [{ id: "latest", speaker: "OTHER", text: "Okay", isTarget: true }],
    tone: { personSpecificExamples: ["Noted", "Will see", "Send details", "Let me check"], generalExamples: ["Okay"] },
    relationship: {
      medianOwnerReplyCharacters: 8,
      interactions: [
        { ownerReply: "Noted" },
        { ownerReply: "Will see" },
        { ownerReply: "Send details" },
        { ownerReply: "Let me check" },
      ],
    },
    safety: { requiresCurrentFact: false },
  };
  const result = evaluateDraftCandidates([
    { draft: "Okay", language: "English", evidenceIds: ["latest"] },
    { draft: "Noted", language: "English", evidenceIds: ["latest"] },
  ], acknowledgementContext);
  assert.equal(result.selected.draft, "Noted");
  assert.ok(result.evaluations[1].components.context > result.evaluations[0].components.context);
});

test("recent content-free fingerprints de-prioritise a repeated generic surface without blocking safety", () => {
  const acknowledgementContext = {
    ...context,
    story: [{ id: "latest", speaker: "OTHER", text: "Okay", isTarget: true }],
    tone: { personSpecificExamples: ["Noted", "Haan"], generalExamples: [] },
    relationship: { medianOwnerReplyCharacters: 6, interactions: [{ ownerReply: "Noted" }, { ownerReply: "Haan" }] },
    retrieval: {
      repetition: {
        recentTemplateFingerprints: [phraseTemplateFingerprint("Noted"), phraseTemplateFingerprint("Noted")],
      },
    },
    safety: { requiresCurrentFact: false },
  };
  const ranked = evaluateDraftCandidates([
    { draft: "Noted", language: "English", evidenceIds: ["latest"] },
    { draft: "Haan", language: "Roman Hindi", evidenceIds: ["latest"] },
  ], acknowledgementContext);
  assert.equal(ranked.selected.draft, "Haan");
  assert.ok(ranked.evaluations[0].components.context < ranked.evaluations[1].components.context);

  const onlySafeOption = evaluateDraftCandidates([
    { draft: "Noted", language: "English", evidenceIds: ["latest"] },
  ], acknowledgementContext);
  assert.equal(onlySafeOption.selected.draft, "Noted");
});

test("durable story state prevents a trailing acknowledgement from hiding an unresolved question", () => {
  const statefulContext = {
    ...context,
    story: [
      { id: "question", speaker: "OTHER", text: "Should you review the report?", timestampMs: 1_000, isTarget: false },
      { id: "latest", speaker: "OTHER", text: "Okay", timestampMs: 4_000_000, isTarget: true },
    ],
    safety: { requiresCurrentFact: false, requiredFacts: [] },
    conversationState: {
      latest_intent: "request",
      conversation_status: "awaiting_owner",
      open_questions: [{ asked_by_owner: false, status: "current", provenance: { source_message_id: "question" } }],
    },
  };
  const result = evaluateDraftCandidates([
    { draft: "Okay", language: "English", evidenceIds: ["latest"] },
    { draft: "Should I review the report?", language: "English", evidenceIds: ["latest"] },
  ], statefulContext);
  assert.equal(result.selected.draft, "Should I review the report?");
  assert.ok(result.evaluations[1].components.context > result.evaluations[0].components.context);
});

test("independent evaluation ranks an exact-person semantic plan above cosmetic order", () => {
  const semanticContext = {
    ...context,
    story: [{ id: "latest", speaker: "OTHER", text: "The presentation is ready", isTarget: true }],
    safety: { requiresCurrentFact: false },
    retrieval: {
      phraseBank: {
        selected: [{
          tier: "person-cst",
          score: 50,
          evidenceCount: 4,
          semanticPlan: { incomingIntent: "statement", responseAct: "question" },
          styleFragments: { surfaceTemplate: "Should I review {{topic}}?" },
        }],
      },
    },
  };
  const result = evaluateDraftCandidates([
    { draft: "The presentation is ready — understood", language: "English", evidenceIds: ["latest"] },
    { draft: "Should I review the presentation?", language: "English", evidenceIds: ["latest"] },
  ], semanticContext);
  assert.equal(result.selected.draft, "Should I review the presentation?");
  assert.ok(result.evaluations[1].components.context > result.evaluations[0].components.context);
});

test("thermal formality softly ranks equivalent wording without becoming factual evidence", () => {
  const thermalContext = {
    ...context,
    story: [{ id: "latest", speaker: "OTHER", text: "Can you review the presentation?", isTarget: true }],
    tone: { personSpecificExamples: [], generalExamples: [] },
    relationship: { medianOwnerReplyCharacters: 0 },
    safety: { requiresCurrentFact: false, requiredFacts: [] },
    retrieval: {
      routingBlend: { forestWeight: 0.7, rulePriorWeight: 0.3 },
      scenarioForest: {
        uncertainty: 0.12,
        thermal: {
          centroid: { valence: 0, arousal: 0.4, formality: 0.86 },
          multimodal: false,
          hotspots: [],
        },
      },
    },
  };
  const result = evaluateDraftCandidates([
    { draft: "Review the presentation bro?", language: "English", evidenceIds: ["latest"] },
    { draft: "Could you please confirm the presentation review?", language: "English", evidenceIds: ["latest"] },
  ], thermalContext);
  assert.equal(result.selected.draft, "Could you please confirm the presentation review?");
  assert.ok(result.evaluations[1].components.routing > result.evaluations[0].components.routing);
  assert.equal(result.evaluations.every((item) => item.gates.factuality), true);
});

test("multimodal thermal hotspots preserve more than one legitimate style", () => {
  const thermalContext = {
    ...context,
    story: [{ id: "latest", speaker: "OTHER", text: "The presentation is ready", isTarget: true }],
    safety: { requiresCurrentFact: false, requiredFacts: [] },
    retrieval: {
      routingBlend: { forestWeight: 0.65, rulePriorWeight: 0.35 },
      scenarioForest: {
        uncertainty: 0.28,
        thermal: {
          centroid: { valence: 0.2, arousal: 0.45, formality: 0.5 },
          multimodal: true,
          hotspots: [
            { relativeMass: 0.52, centroid: { valence: 0.2, arousal: 0.42, formality: 0.82 } },
            { relativeMass: 0.48, centroid: { valence: 0.25, arousal: 0.5, formality: 0.2 } },
          ],
        },
      },
    },
  };
  const result = evaluateDraftCandidates([
    { draft: "Please confirm the presentation review.", language: "English", evidenceIds: ["latest"] },
    { draft: "Presentation dekhna hai bro?", language: "Roman Hindi", evidenceIds: ["latest"] },
  ], thermalContext);
  assert.equal(result.evaluations.length, 2);
  assert.equal(result.evaluations.every((item) => item.accepted), true);
  assert.equal(result.evaluations.every((item) => Number.isFinite(item.components.routing)), true);
});

test("independent factuality rejects an invented current location", () => {
  const locationContext = {
    ...context,
    story: [{ id: "where", speaker: "OTHER", text: "Where are you?", isTarget: true }],
    safety: { requiresCurrentFact: false, requiredFacts: [] },
  };
  assert.throws(() => evaluateDraftCandidates([
    { draft: "I'm in Delhi", language: "English", evidenceIds: ["where"] },
  ], locationContext), /No candidate passed/iu);
  const safe = evaluateDraftCandidates([
    { draft: "[Add your current location before sending]", language: "English", evidenceIds: ["where"] },
  ], locationContext);
  assert.match(safe.selected.draft, /^\[/u);
});

test("independent factuality rejects invented approval payment and status answers", () => {
  for (const [incoming, draft] of [
    ["Has the payment been made?", "Yes, the payment is done"],
    ["Was this approved?", "It was approved"],
    ["What is the delivery status?", "It has been delivered"],
  ]) {
    const factContext = {
      ...context,
      story: [{ id: "fact", speaker: "OTHER", text: incoming, isTarget: true }],
      safety: { requiresCurrentFact: false, requiredFacts: [] },
    };
    assert.throws(() => evaluateDraftCandidates([
      { draft, language: "English", evidenceIds: ["fact"] },
    ], factContext), /No candidate passed/iu, incoming);
  }
});

test("thermal mixture posterior contributes bounded probabilistic ranking", () => {
  const thermalContext = {
    ...context,
    story: [{ id: "latest", speaker: "OTHER", text: "Can you review the presentation?", isTarget: true }],
    tone: { personSpecificExamples: [], generalExamples: [] },
    relationship: { medianOwnerReplyCharacters: 0 },
    safety: { requiresCurrentFact: false, requiredFacts: [] },
    retrieval: {
      routingBlend: { forestWeight: 0.72, rulePriorWeight: 0.28 },
      scenarioPosterior: {
        uncertainty: 0.08,
        thermal: {
          centroid: { valence: 0, arousal: 0.4, formality: 0.5 },
          mixture: { components: [
            { weight: 0.92, centroid: { valence: 0, arousal: 0.4, formality: 0.9 } },
            { weight: 0.08, centroid: { valence: 0.1, arousal: 0.55, formality: 0.1 } },
          ] },
        },
      },
    },
  };
  const result = evaluateDraftCandidates([
    { draft: "Review the presentation bro?", language: "English", evidenceIds: ["latest"] },
    { draft: "Could you please confirm the presentation review?", language: "English", evidenceIds: ["latest"] },
  ], thermalContext);
  assert.equal(result.selected.draft, "Could you please confirm the presentation review?");
  assert.ok(result.evaluations[1].components.routing > result.evaluations[0].components.routing);
});

test("supported active C/S/T language and length outrank a broad person average", () => {
  const calibratedContext = {
    ...context,
    story: [{ id: "ready", speaker: "OTHER", text: "The presentation is ready", isTarget: true }],
    tone: { personSpecificExamples: [], generalExamples: [] },
    safety: { requiresCurrentFact: false, requiredFacts: [] },
    relationship: {
      medianOwnerReplyCharacters: 0,
      behavioralDNA: {
        active: {
          sampleCount: 6, confidence: 0.8, medianCharacters: 28,
          writingModes: [{ mode: "Roman Hindi", count: 5, rate: 0.83 }, { mode: "English", count: 1, rate: 0.17 }],
          responseActs: [{ act: "question", count: 5, rate: 0.83 }], emojiRate: 0, terminalPunctuationRate: 0.8,
        },
        global: {
          sampleCount: 50, confidence: 0.9, medianCharacters: 70,
          writingModes: [{ mode: "English", count: 45, rate: 0.9 }],
          responseActs: [{ act: "question", count: 30, rate: 0.6 }], emojiRate: 0, terminalPunctuationRate: 0.8,
        },
      },
    },
  };
  const result = evaluateDraftCandidates([
    { draft: "Presentation ke liye ab next kya hai?", language: "Roman Hindi", intent: "statement", evidenceIds: ["ready"] },
    { draft: "What is the next step for the presentation and who should be involved in reviewing it?", language: "English", intent: "statement", evidenceIds: ["ready"] },
  ], calibratedContext);
  assert.equal(result.selected.language, "Roman Hindi");
  assert.ok([...result.selected.draft].length < 50);
});

test("independent evaluation scores realized language rather than trusting candidate metadata", () => {
  const languageContext = {
    ...context,
    story: [{ id: "where", speaker: "OTHER", text: "Where are you?", isTarget: true }],
    safety: { requiresCurrentFact: true, requiredFacts: ["location"] },
    relationship: {
      medianOwnerReplyCharacters: 30,
      stylePolicy: {
        language: { value: "Roman Hindi", source: "explicit-preference", confidence: 1 },
        length: { value: "short", targetCharacters: 30, source: "explicit-preference", confidence: 1 },
        formality: { value: "neutral", source: "target-mirror", confidence: 0.5 },
        emoji: { value: "avoid", source: "target-mirror", confidence: 0.5 },
      },
    },
  };
  const result = evaluateDraftCandidates([
    { draft: "[Add: your current location]", language: "Roman Hindi", evidenceIds: ["where"] },
    { draft: "[Add: abhi kahan ho woh likho]", language: "English", evidenceIds: ["where"] },
  ], languageContext);
  assert.equal(result.selected.draft, "[Add: abhi kahan ho woh likho]");
  assert.ok(result.evaluations[1].components.context > result.evaluations[0].components.context);
});

test("an ambiguous learned-plan posterior credits each supported meaning", () => {
  const posteriorContext = {
    ...context,
    story: [{ id: "ready", speaker: "OTHER", text: "The presentation is ready", isTarget: true }],
    tone: { personSpecificExamples: [], generalExamples: [] },
    safety: { requiresCurrentFact: false, requiredFacts: [] },
    relationship: {
      medianOwnerReplyCharacters: 0,
      candidateDialoguePlans: [
        { dialoguePlan: "acknowledge", sourceTier: "person-cst", probability: 0.52 },
        { dialoguePlan: "follow-up", sourceTier: "person-cst", probability: 0.48 },
      ],
    },
  };
  const result = evaluateDraftCandidates([
    { draft: "Presentation — understood", language: "English", intent: "statement", evidenceIds: ["ready"] },
    { draft: "What next for the presentation?", language: "English", intent: "statement", evidenceIds: ["ready"] },
  ], posteriorContext);
  assert.equal(result.evaluations.every((item) => item.accepted), true);
  assert.ok(result.evaluations.every((item) => item.components.context > 0));
});
