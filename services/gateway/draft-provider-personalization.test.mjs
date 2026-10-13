import assert from "node:assert/strict";
import test from "node:test";

import { buildDynamicPhraseBank, createLocalDraftProvider, modelContextEnvelope } from "./draft-provider.mjs";
import { evaluateDraftCandidates } from "../../packages/core/candidates.ts";
import { buildBehavioralDNA } from "../../packages/core/behavioral-dna.ts";
import { buildDraftContext, validateDraftOutput } from "../../packages/core/draft.ts";

function baseContext(story, overrides = {}) {
  return {
    story,
    currentIncomingTurn: {
      messageIds: story.filter((event) => event.speaker === "OTHER").slice(-1).map((event) => event.id),
      text: story.filter((event) => event.speaker === "OTHER").at(-1)?.text || "",
    },
    tone: { personSpecificExamples: [], generalExamples: [] },
    relationship: {
      interactionCount: 0,
      medianOwnerReplyCharacters: 0,
      ownerEmojiReplyRate: 0,
      otherPartyExamples: [],
      interactions: [],
      profile: { ownerAddressForms: [] },
    },
    userIntent: null,
    ...overrides,
  };
}

function selectedPattern({ responseAct, tier = "person-cst", score = 80, template = "{{topic}}", incomingIntent = "statement", source = "historical-source" }) {
  return {
    id: `${tier}-${responseAct}-${source}`,
    cstCode: "C10.S04.T03",
    tier,
    score,
    evidenceCount: 4,
    language: "English",
    semanticPlan: { incomingIntent, responseAct, scenarioFamily: "information" },
    styleFragments: {
      surfaceTemplate: template,
      literalFragments: template.split(/\{\{[^}]+\}\}/u).filter(Boolean),
      writingMode: "English",
      characterBucket: "short",
      terminalMark: "none",
      emoji: [],
      lineCount: 1,
    },
    provenance: {
      origin: "whatsapp-owner-reply",
      accountScopeId: "local-device-vault",
      personId: tier.startsWith("person-") ? "current-person" : "fallback-person",
      relationship: "colleague",
      chatIds: ["historical-chat"],
      sourceMessageIds: [source],
      latestTimestampMs: 1,
    },
    factEligible: false,
    use: "style-template-only",
  };
}

test("an answer to the owner's earlier question stays attached to that story", async () => {
  const result = await createLocalDraftProvider().generate(baseContext([
    { id: "owner-question", speaker: "OWNER", text: "Which place?", timestampMs: 1 },
    { id: "answer", speaker: "OTHER", text: "Palladium", timestampMs: 2, isTarget: true },
  ]));

  assert.match(result.draft, /Palladium/iu);
  assert.doesNotMatch(result.draft, /^(?:ok(?:ay)?|got it|noted|thanks for letting me know)[.!\s]*$/iu);
  assert.ok(result.evidenceIds.includes("answer"));
});

test("an ordinary weather update produces a topic-aware reply rather than a blank acknowledgement", async () => {
  const result = await createLocalDraftProvider().generate(baseContext([
    { id: "rain", speaker: "OTHER", text: "There is heavy rain near the office", timestampMs: 1, isTarget: true },
  ]));

  assert.match(result.draft, /rain|safe|baarish|varsad/iu);
  assert.doesNotMatch(result.draft, /^(?:ok(?:ay)?|got it|noted|thanks for letting me know)[.!\s]*$/iu);
});

test("a shared link names its source and asks a useful question", async () => {
  const result = await createLocalDraftProvider().generate(baseContext([
    { id: "video", speaker: "OTHER", text: "https://youtu.be/abc123", timestampMs: 1, isTarget: true },
  ]));

  assert.match(result.draft, /YouTube/iu);
  assert.match(result.draft, /\?/u);
  assert.doesNotMatch(result.draft, /^(?:ok(?:ay)?|got it|noted|thanks for sharing)[.!\s]*$/iu);
});

test("person-specific situation evidence can select Roman Hindi for an English incoming update", async () => {
  const result = await createLocalDraftProvider().generate(baseContext([
    { id: "meeting", speaker: "OTHER", text: "The meeting plan has changed", timestampMs: 1, isTarget: true },
  ], {
    relationship: {
      interactionCount: 4,
      medianOwnerReplyCharacters: 30,
      ownerEmojiReplyRate: 0,
      otherPartyExamples: [],
      interactions: [],
      profile: { ownerAddressForms: [] },
      behavioralDNA: {
        active: {
          sampleCount: 4,
          confidence: 0.7,
          writingModes: [{ mode: "Roman Hindi", count: 3, rate: 0.75 }],
          responseActs: [{ act: "question", count: 3, rate: 0.75 }],
          medianCharacters: 30,
        },
        global: { sampleCount: 4, writingModes: [{ mode: "English", count: 3, rate: 0.75 }], medianCharacters: 30 },
      },
    },
  }));

  assert.equal(result.language, "Roman Hindi");
  assert.match(result.draft, /plan|final|confirm|side/iu);
});

test("retrieved person episodes influence structure but never replay an old fact", async () => {
  const result = await createLocalDraftProvider().generate(baseContext([
    { id: "current", speaker: "OTHER", text: "The presentation is ready", timestampMs: 1, isTarget: true },
  ], {
    retrieval: {
      episodes: [{
        incomingText: "The old report is ready",
        ownerReply: "Isme meri side se kuch karna hai? OTP 123456",
        similarity: 0.91,
        responseAct: "question",
        factEligible: false,
      }],
    },
  }));

  assert.match(result.draft, /\?/u);
  assert.doesNotMatch(result.draft, /old report|otp|123456/iu);
});

test("current-fact and commitment safety gates remain in force", async () => {
  const result = await createLocalDraftProvider().generate(baseContext([
    { id: "send", speaker: "OTHER", text: "Can you send the file today?", timestampMs: 1, isTarget: true },
  ], {
    safety: {
      requiresCurrentFact: true,
      requiredFacts: ["commitment", "time"],
      requiredInputs: [],
    },
  }));

  assert.match(result.draft, /^\[/u);
  assert.doesNotMatch(result.draft, /(?:I'll|I will|bhej dunga|mokli daish)/iu);
});

test("different story types do not collapse into one stock reply", async () => {
  const messages = [
    "There is heavy rain near the office",
    "The presentation is ready",
    "The meeting plan has changed",
    "The payment amount is final",
    "I have a fever and feel unwell",
    "I will send the document",
    "https://drive.google.com/file/d/example",
  ];
  const replies = [];
  for (const [index, text] of messages.entries()) {
    const result = await createLocalDraftProvider().generate(baseContext([
      { id: `case-${index}`, speaker: "OTHER", text, timestampMs: index + 1, isTarget: true },
    ]));
    assert.doesNotMatch(result.draft, /^(?:ok(?:ay)?|got it|noted|thanks for letting me know)[.!\s]*$/iu, text);
    replies.push(result.draft);
  }
  assert.ok(new Set(replies).size >= 6, replies.join(" | "));
});

test("the independent gate rejects stock acknowledgements for substantive updates", () => {
  const story = [{ id: "update", speaker: "OTHER", text: "The client changed the plan", isTarget: true }];
  assert.throws(() => evaluateDraftCandidates([
    { draft: "Okay", language: "English", evidenceIds: ["update"] },
    { draft: "Got it", language: "English", evidenceIds: ["update"] },
    { draft: "Thanks for letting me know", language: "English", evidenceIds: ["update"] },
  ], baseContext(story)), /No candidate passed/iu);
});

test("two person histories produce isolated dynamic banks and different replies", async () => {
  const story = [{ id: "ready", speaker: "OTHER", text: "The presentation is ready", timestampMs: 1, isTarget: true }];
  const person = (ownerReply, scenarioCode) => baseContext(story, {
    retrieval: {
      scenarioCode,
      episodes: [{
        incomingText: "The report is ready",
        ownerReply,
        similarity: 0.9,
        responseAct: "question",
        writingMode: "English",
        scenarioCode,
        factEligible: false,
      }],
    },
  });
  const casual = person("Acha, bata dena bhai", "C10.S02.T03");
  const formal = person("Perfect, let me know sir", "C10.S05.T05");
  const casualBank = buildDynamicPhraseBank(casual, "English", "statement");
  const formalBank = buildDynamicPhraseBank(formal, "English", "statement");
  assert.deepEqual({ opener: casualBank.opener, address: casualBank.address, scenarioCode: casualBank.scenarioCode }, { opener: "Acha", address: "bhai", scenarioCode: "C10.S02.T03" });
  assert.deepEqual({ opener: formalBank.opener, address: formalBank.address, scenarioCode: formalBank.scenarioCode }, { opener: "Perfect", address: "sir", scenarioCode: "C10.S05.T05" });
  assert.equal(Object.hasOwn(casualBank, "ownerReply"), false);

  const casualReply = await createLocalDraftProvider().generate(casual);
  const formalReply = await createLocalDraftProvider().generate(formal);
  assert.notEqual(casualReply.draft, formalReply.draft);
  assert.match(casualReply.draft, /Acha|bhai/iu);
  assert.match(formalReply.draft, /Perfect|sir/iu);
  assert.equal(casualReply.personalizationBasis, "same-person-semantic-plan");
});

test("identical current input and style produce different meanings for opposite learned plans", async () => {
  const story = [{ id: "current-ready", speaker: "OTHER", text: "The presentation is ready", timestampMs: 1, isTarget: true }];
  const withPlan = (responseAct) => baseContext(story, {
    retrieval: {
      scenarioCode: "C10.S04.T03",
      phraseBank: {
        targetCstCode: "C10.S04.T03",
        selected: [selectedPattern({ responseAct, template: "{{topic}}" })],
      },
    },
  });
  const acknowledge = await createLocalDraftProvider().generate(withPlan("acknowledgement"));
  const followUp = await createLocalDraftProvider().generate(withPlan("question"));

  assert.notEqual(acknowledge.draft, followUp.draft);
  assert.doesNotMatch(acknowledge.draft, /\?\s*$/u);
  assert.match(acknowledge.draft, /presentation|ready|understood/iu);
  assert.match(followUp.draft, /\?\s*$/u);
  assert.match(followUp.draft, /presentation|feedback|next|look/iu);
  assert.equal(acknowledge.personalizationBasis, "same-person-semantic-plan");
  assert.equal(followUp.personalizationBasis, "same-person-semantic-plan");
});

test("exact-person semantic evidence outranks a higher-scored lower tier", () => {
  const value = baseContext([{ id: "ready", speaker: "OTHER", text: "The presentation is ready", isTarget: true }], {
    retrieval: {
      phraseBank: {
        targetCstCode: "C10.S04.T03",
        selected: [
          selectedPattern({ responseAct: "question", tier: "relationship", score: 999, source: "peer" }),
          selectedPattern({ responseAct: "acknowledgement", tier: "person-cst", score: 1, source: "exact-person" }),
        ],
      },
    },
  });
  const bank = buildDynamicPhraseBank(value, "English", "statement");
  assert.equal(bank.preferredPlan.sourceTier, "person-cst");
  assert.equal(bank.preferredPlan.dialoguePlan, "acknowledge");
});

test("many lower-tier rows cannot collectively outvote one relevant exact-person plan", () => {
  const value = baseContext([{ id: "ready", speaker: "OTHER", text: "The presentation is ready", isTarget: true }], {
    retrieval: {
      phraseBank: {
        targetCstCode: "C10.S04.T03",
        selected: [
          selectedPattern({ responseAct: "acknowledgement", tier: "person-cst", score: 1, source: "exact-person" }),
          ...Array.from({ length: 8 }, (_, index) => selectedPattern({ responseAct: "question", tier: "relationship", score: 999, source: `peer-${index}` })),
        ],
      },
    },
  });
  const bank = buildDynamicPhraseBank(value, "English", "statement");
  assert.equal(bank.preferredPlan.sourceTier, "person-cst");
  assert.equal(bank.preferredPlan.dialoguePlan, "acknowledge");
  assert.equal(bank.candidatePlans.some((plan) => plan.sourceTier === "relationship"), false);
});

test("semantic retrieval contributes a content-free response plan without becoming factual evidence", () => {
  const value = baseContext([{ id: "ready", speaker: "OTHER", text: "The presentation is ready", isTarget: true }], {
    retrieval: {
      phraseBank: { targetCstCode: "C10.S04.T03", selected: [] },
      semanticEvidence: [{
        eventId: "historical-owner",
        chatId: "same-person-chat",
        text: "What is the next step?",
        direction: "owner",
        tier: "same-person",
        use: "conversation-fact",
        factEligible: true,
        similarity: 0.91,
      }],
    },
  });
  const bank = buildDynamicPhraseBank(value, "English", "statement");
  assert.equal(bank.preferredPlan.sourceTier, "same-person-semantic");
  assert.equal(bank.preferredPlan.dialoguePlan, "follow-up");
  assert.equal(bank.preferredPlan.factEligible, false);
  assert.doesNotMatch(JSON.stringify(bank.preferredPlan), /historical-owner|same-person-chat/iu);
});

test("an exact-person retrieved episode outranks a lower-tier phrase fallback", () => {
  const value = baseContext([{ id: "ready", speaker: "OTHER", text: "The presentation is ready", isTarget: true }], {
    retrieval: {
      episodes: [{
        incomingText: "The report is ready",
        ownerReply: "Understood",
        incomingIntent: "statement",
        responseAct: "acknowledgement",
        similarity: 0.96,
        factEligible: false,
      }],
      phraseBank: {
        targetCstCode: "C10.S04.T03",
        selected: [selectedPattern({ responseAct: "question", tier: "relationship", score: 999, source: "peer" })],
      },
    },
  });
  const bank = buildDynamicPhraseBank(value, "English", "statement");
  assert.equal(bank.preferredPlan.sourceTier, "person-episode");
  assert.equal(bank.preferredPlan.dialoguePlan, "acknowledge");
});

test("ambiguous person evidence keeps multiple dialogue plans for independent evaluation", () => {
  const value = baseContext([{ id: "ready", speaker: "OTHER", text: "The presentation is ready", isTarget: true }], {
    retrieval: {
      phraseBank: {
        targetCstCode: "C10.S04.T03",
        selected: [
          selectedPattern({ responseAct: "acknowledgement", tier: "person-cst", score: 60, source: "person-ack" }),
          selectedPattern({ responseAct: "question", tier: "person-cst", score: 60, source: "person-question" }),
        ],
      },
    },
  });
  const bank = buildDynamicPhraseBank(value, "English", "statement");
  assert.equal(bank.preferredPlan.decisive, false);
  assert.equal(bank.candidatePlans.length, 2);
  assert.ok(bank.candidatePlans.every((plan) => plan.probability > 0));
});

test("historical structural slots and secrets never become current facts", async () => {
  const story = [{ id: "ready", speaker: "OTHER", text: "The presentation is ready", isTarget: true }];
  const value = baseContext(story, {
    retrieval: {
      phraseBank: {
        targetCstCode: "C10.S04.T03",
        selected: [selectedPattern({
          responseAct: "commitment",
          template: "I will send {{file}} to {{name}} for {{amount}} using OTP 123456",
          source: "secret-history",
        })],
      },
    },
  });
  const bank = buildDynamicPhraseBank(value, "English", "statement");
  assert.equal(bank.preferredPlan.structuralTemplate, "");
  const result = await createLocalDraftProvider().generate(value);
  assert.doesNotMatch(result.draft, /123456|otp|amount|name|secret-history/iu);
  assert.match(result.draft, /^\[/u);
});

test("safe learned structures bind only a verified current topic", async () => {
  const story = [{ id: "ready", speaker: "OTHER", text: "The presentation is ready", isTarget: true }];
  const result = await createLocalDraftProvider().generate(baseContext(story, {
    retrieval: {
      phraseBank: {
        targetCstCode: "C10.S04.T03",
        selected: [selectedPattern({
          responseAct: "question",
          template: "Should I review the {{topic}}?",
          source: "safe-frame",
        })],
      },
    },
  }));
  assert.equal(result.draft, "Should I review the presentation?");
  assert.doesNotMatch(result.draft, /\{\{|historical|safe-frame/iu);
});

test("only the dynamic pattern that shaped the selected draft is bound through validation", async () => {
  const story = [{ id: "ready", speaker: "OTHER", text: "The presentation is ready", isTarget: true }];
  const pattern = selectedPattern({ responseAct: "question", template: "Should I review the {{topic}}?", source: "bound-frame" });
  const context = baseContext(story, {
    retrieval: {
      scenarioCode: pattern.cstCode,
      phraseBank: { targetCstCode: pattern.cstCode, selected: [pattern] },
    },
    safety: { requiresCurrentFact: false, requiredFacts: [], requiredInputs: [] },
  });
  const result = await createLocalDraftProvider().generate(context);
  assert.equal(result.draft, "Should I review the presentation?");
  assert.equal(result.phrasePatternBinding.patternId, pattern.id);
  assert.match(result.phrasePatternBinding.phraseProvenanceFingerprint, /^[a-f\d]{64}$/u);
  assert.match(result.phrasePatternBinding.phraseTemplateFingerprint, /^[a-f\d]{64}$/u);

  const validated = validateDraftOutput(result, context);
  assert.deepEqual(validated.draftRoute.personalization.patternBinding, result.phrasePatternBinding);
  assert.deepEqual(validated.phrasePatternBinding, result.phrasePatternBinding);

  const unrelated = validateDraftOutput({
    ...result,
    personalizationBasis: "same-person-style-only",
  }, context);
  assert.equal(Object.hasOwn(unrelated, "phrasePatternBinding"), false);
  assert.equal(Object.hasOwn(unrelated.draftRoute.personalization, "patternBinding"), false);
});

test("lower-tier fallback evidence is never labelled person-specific", async () => {
  const story = [{ id: "ready", speaker: "OTHER", text: "The presentation is ready", isTarget: true }];
  const result = await createLocalDraftProvider().generate(baseContext(story, {
    retrieval: {
      phraseBank: {
        targetCstCode: "C10.S04.T03",
        selected: [selectedPattern({ responseAct: "question", tier: "relationship", source: "another-person" })],
      },
    },
  }));
  assert.notEqual(result.personalizationBasis, "same-person-semantic-plan");
  assert.equal(result.personalizationBasis, "relationship-semantic-fallback");
});

test("cloud context receives the content-free per-person bank without historical facts", () => {
  const story = [{ id: "ready", speaker: "OTHER", text: "The presentation is ready", timestampMs: 1, isTarget: true }];
  const value = baseContext(story, {
    retrieval: {
      scenarioCode: "C10.S04.T03",
      phraseBank: {
        targetCstCode: "C10.S04.T03",
        selected: [selectedPattern({ responseAct: "question", template: "Should I review {{topic}} at orchardville?", source: "entity-proof" })],
      },
      episodes: [{
        incomingText: "Old Project Falcon at orchardville is ready",
        ownerReply: "Acha, Project Falcon ke 8400 orchardville bhej dena bhai",
        similarity: 0.94,
        responseAct: "question",
        writingMode: "Roman Hindi",
        factEligible: false,
      }],
    },
  });
  const envelope = modelContextEnvelope(value);
  assert.equal(envelope.characteristics.relationship.scenarioPhraseBank.scenarioCode, "C10.S04.T03");
  assert.equal(envelope.characteristics.relationship.scenarioPhraseBank.opener, "Acha");
  assert.equal(envelope.characteristics.relationship.scenarioPhraseBank.address, "bhai");
  assert.doesNotMatch(JSON.stringify(envelope.characteristics), /Falcon|8400|orchardville/iu);
});

test("cloud context replaces persistent identifiers and consumes semantic matches as content-free routing", () => {
  const story = [
    { id: "provider-message-secret-1", speaker: "OWNER", text: "Which place?", timestampMs: 1 },
    { id: "provider-message-secret-2", speaker: "OTHER", text: "Palladium", timestampMs: 2, isTarget: true },
  ];
  const value = baseContext(story, {
    freshness: { targetMessageId: "provider-message-secret-2" },
    relationship: {
      interactionCount: 1,
      medianOwnerReplyCharacters: 8,
      ownerEmojiReplyRate: 0,
      otherPartyExamples: [], interactions: [],
      profile: { ownerAddressForms: [], evidenceMessageIds: ["profile-id-secret"] },
    },
    retrieval: {
      phraseBank: { targetCstCode: "C10.S04.T03", selected: [] },
      semanticEvidence: [{
        eventId: "semantic-id-secret", chatId: "chat-id-secret", text: "What is next?",
        direction: "owner", tier: "same-person", similarity: 0.82, incomingSimilarity: 0.9,
        precedingStorySimilarity: 0.7, wholeStorySimilarity: 0.84, incomingIntent: "statement",
        responseAct: "question", intentMatched: true, factEligible: true,
      }],
    },
  });
  const envelope = modelContextEnvelope(value);
  assert.equal(envelope.chat.targetMessageId, "m2");
  assert.deepEqual(envelope.chat.messages.map((item) => item.id), ["m1", "m2"]);
  assert.deepEqual(envelope.chat.currentIncomingTurn.messageIds, ["m2"]);
  assert.equal(envelope.characteristics.relationship.semanticRouting.matches[0].observedResponseAct, "question");
  assert.equal(envelope.characteristics.relationship.semanticRouting.matches[0].incomingIntent, "statement");
  assert.equal(envelope.characteristics.relationship.semanticRouting.matches[0].intentMatched, true);
  assert.equal(envelope.characteristics.relationship.semanticRouting.matches[0].incomingSimilarity, 0.9);
  assert.doesNotMatch(JSON.stringify(envelope), /provider-message-secret|profile-id-secret|semantic-id-secret|chat-id-secret/iu);
});

test("cloud context receives only a content-free thermal routing summary", () => {
  const story = [{ id: "ready", speaker: "OTHER", text: "The presentation is ready", timestampMs: 1, isTarget: true }];
  const value = baseContext(story, {
    retrieval: {
      routingBlend: { forestWeight: 0.42, rulePriorWeight: 0.58, rankedCodes: ["C10.S04.T05"] },
      scenarioForest: {
        uncertainty: 0.24,
        topCells: [{ code: "C10.S04.T05", family: "information", relationship: "colleague", mode: "formal", probability: 0.61, trained: true }],
        thermal: {
          centroid: { valence: 0.1, arousal: 0.44, formality: 0.78 },
          spread: { valence: 0.08, arousal: 0.11, formality: 0.09 },
          multimodal: false,
          hotspots: [{ relativeMass: 0.8, centroid: { valence: 0.1, arousal: 0.44, formality: 0.78 }, dominantCells: ["C10.S04.T05"], rawOwnerReply: "private historical fact" }],
        },
        treeVotes: [{ tree: 1, path: "private-tree-detail" }],
      },
    },
  });
  const routing = modelContextEnvelope(value).characteristics.relationship.scenarioRouting;
  assert.equal(routing.signal, "forest-rule-blend");
  assert.equal(routing.factEligible, false);
  assert.equal(routing.style.formality, "formal");
  assert.equal(routing.uncertainty, "low");
  assert.equal(Object.hasOwn(routing, "treeVotes"), false);
  assert.doesNotMatch(JSON.stringify(routing), /private historical fact|private-tree-detail/iu);
});

test("cloud context bounds scenario-posterior mixture components without content", () => {
  const story = [{ id: "ready", speaker: "OTHER", text: "The presentation is ready", timestampMs: 1, isTarget: true }];
  const routing = modelContextEnvelope(baseContext(story, {
    retrieval: {
      routingBlend: { forestWeight: 0.7, rulePriorWeight: 0.3 },
      scenarioPosterior: {
        uncertainty: 0.2,
        topCells: [],
        thermal: {
          centroid: { valence: 0, arousal: 0.4, formality: 0.5 },
          spread: { valence: 0.1, arousal: 0.1, formality: 0.2 },
          mixture: { components: [
            { weight: 9, centroid: { valence: 5, arousal: -2, formality: 4 }, spread: { valence: 9 }, privateText: "must-not-leak" },
            { weight: 1, centroid: { valence: -0.2, arousal: 0.6, formality: 0.2 } },
          ] },
        },
      },
    },
  })).characteristics.relationship.scenarioRouting;
  assert.equal(routing.mixture.components.length, 2);
  assert.deepEqual(routing.mixture.components.map((item) => item.weight), [0.5, 0.5]);
  assert.deepEqual(routing.mixture.components[0].centroid, { valence: 1, arousal: 0, formality: 1 });
  assert.doesNotMatch(JSON.stringify(routing), /must-not-leak/iu);
});

test("learned clarify strategy does not fall back to the static generic question", async () => {
  const story = [{ id: "question", speaker: "OTHER", text: "What should we do about the presentation?", timestampMs: 1, isTarget: true }];
  const result = await createLocalDraftProvider().generate(baseContext(story, {
    retrieval: {
      phraseBank: {
        targetCstCode: "C10.S04.T03",
        selected: [selectedPattern({ responseAct: "question", template: "{{topic}}", incomingIntent: "open-question", source: "clarify-plan" })],
      },
    },
  }));
  assert.match(result.draft, /\?/u);
  assert.doesNotMatch(result.draft, /What do you mean exactly/iu);
  assert.match(result.draft, /clarity|clarify|part/iu);
});

test("thermal mixture can shape local wording without changing its semantic plan", async () => {
  const story = [{ id: "link", speaker: "OTHER", text: "https://youtu.be/abc123", timestampMs: 1, isTarget: true }];
  const result = await createLocalDraftProvider().generate(baseContext(story, {
    relationship: { interactionCount: 0, medianOwnerReplyCharacters: 0, ownerEmojiReplyRate: 0, otherPartyExamples: [], interactions: [], profile: { ownerAddressForms: [] } },
    retrieval: {
      routingBlend: { forestWeight: 0.72, rulePriorWeight: 0.28 },
      scenarioPosterior: {
        uncertainty: 0.08,
        thermal: {
          centroid: { valence: 0, arousal: 0.4, formality: 0.5 },
          mixture: { components: [{ weight: 1, centroid: { valence: 0.1, arousal: 0.35, formality: 0.92 } }] },
        },
      },
    },
  }));
  assert.match(result.draft, /YouTube/iu);
  assert.match(result.draft, /\?/u);
  assert.doesNotMatch(result.draft, /^(?:Okay|Got it|Noted)/iu);
});

test("thermal routing orders same-tier plans but cannot displace exact-person evidence", () => {
  const story = [{ id: "ready", speaker: "OTHER", text: "The presentation is ready", isTarget: true }];
  const value = baseContext(story, {
    retrieval: {
      routingBlend: { forestWeight: 0.75, rulePriorWeight: 0.25, rankedCodes: ["C10.S04.T05"] },
      scenarioForest: {
        uncertainty: 0.05,
        topCells: [{ code: "C10.S04.T05", probability: 0.9 }],
        thermal: { centroid: { valence: 0, arousal: 0.4, formality: 0.8 }, hotspots: [], multimodal: false },
      },
      phraseBank: {
        targetCstCode: "C10.S04.T05",
        selected: [
          { ...selectedPattern({ responseAct: "question", tier: "relationship", score: 999, source: "peer" }), cstCode: "C10.S04.T05" },
          { ...selectedPattern({ responseAct: "acknowledgement", tier: "person-cst", score: 1, source: "exact-person" }), cstCode: "C10.S04.T03" },
        ],
      },
    },
  });
  const bank = buildDynamicPhraseBank(value, "English", "statement");
  assert.equal(bank.preferredPlan.sourceTier, "person-cst");
  assert.equal(bank.preferredPlan.dialoguePlan, "acknowledge");
});

test("a semantically incompatible learned plan backs off instead of changing a greeting", async () => {
  const story = [{ id: "hello", speaker: "OTHER", text: "Hi", timestampMs: 1, isTarget: true }];
  const result = await createLocalDraftProvider().generate(baseContext(story, {
    retrieval: {
      phraseBank: {
        targetCstCode: "C01.S04.T03",
        selected: [selectedPattern({ responseAct: "decline", incomingIntent: "greeting", template: "{{topic}}", source: "wrong-plan" })],
      },
    },
  }));
  assert.match(result.draft, /^(?:hi+|hey|hello)/iu);
  assert.doesNotMatch(result.draft, /decline|cannot|can't|won't|confirm/iu);
});

test("weak learned evidence shapes neither meaning nor claimed personalization", async () => {
  const story = [{ id: "ready-weak", speaker: "OTHER", text: "The presentation is ready", timestampMs: 1, isTarget: true }];
  const weak = {
    ...selectedPattern({ responseAct: "decline", incomingIntent: "statement", template: "{{topic}}", source: "weak-plan" }),
    evidenceCount: 1,
    effectiveSampleSize: 1,
    reliability: 0.1,
    planProbability: 0.1,
  };
  const result = await createLocalDraftProvider().generate(baseContext(story, {
    retrieval: { phraseBank: { targetCstCode: weak.cstCode, selected: [weak] } },
  }));
  assert.doesNotMatch(result.draft, /decline|cannot|can't|won't|\[Confirm that you want to decline/iu);
  assert.notEqual(result.personalizationBasis, "same-person-semantic-plan");
});

test("production provider envelopes and local candidates expose no foreign lexical surfaces", async () => {
  const accountScopeId = "account-provider-envelope";
  const tenantScopeId = "tenant-provider-envelope";
  const targetChat = {
    id: "chat:target-envelope",
    accountScopeId,
    connector: "fixture",
    connectorIds: ["chat:target-envelope"],
    title: "Colleague Target",
    collection: "active",
    kind: "direct",
    participantIds: ["owner", "target-person"],
  };
  const targetEvents = [
    { id: "target-in", accountScopeId, chatId: targetChat.id, connectorMessageId: "target-in", direction: "contact", senderId: "target-person", senderName: "Target", kind: "text", text: "Can you review this?", timestampMs: 1_000, timestampVerified: true, sequence: 1 },
  ];
  const foreignReplies = ["ok bro", "haan bhai", "sure sir", "🙏", "no worries ji"];
  const foreignChats = ["peer-a", "peer-b", "peer-c", "peer-d", "peer-e"].map((person) => ({
    ...targetChat,
    id: `chat:${person}`,
    connectorIds: [`chat:${person}`],
    title: `Colleague ${person}`,
    participantIds: ["owner", person],
  }));
  const foreignEvents = foreignChats.flatMap((chat, index) => [
    { id: `peer-in-${index}`, accountScopeId, chatId: chat.id, connectorMessageId: `peer-in-${index}`, direction: "contact", senderId: chat.participantIds[1], senderName: chat.title, kind: "text", text: "Please review this", timestampMs: 100 + index * 10, timestampVerified: true, sequence: 1 },
    { id: `peer-out-${index}`, accountScopeId, chatId: chat.id, connectorMessageId: `peer-out-${index}`, direction: "owner", senderId: "owner", senderName: "You", kind: "text", text: foreignReplies[index], timestampMs: 101 + index * 10, timestampVerified: true, sequence: 2 },
  ]);
  const context = buildDraftContext({
    tenantScopeId,
    accountScopeId,
    chat: targetChat,
    chatEvents: targetEvents,
    allChats: [targetChat, ...foreignChats],
    allEvents: [...targetEvents, ...foreignEvents],
    watermark: { chatId: targetChat.id, state: "complete", reachedBeginning: true, oldestTimestampMs: 1_000, newestTimestampMs: 1_000, messageCount: 1, cursor: null, reason: "complete", verifiedAt: "2026-10-08T10:00:00.000Z" },
    ownerIds: ["owner"],
    expectedTargetMessageId: "target-in",
    nowMs: 2_000,
  });
  const envelope = modelContextEnvelope(context);
  const serialized = JSON.stringify(envelope);

  assert.equal(envelope.graphGrounding.protocol, "ggcp-v1");
  assert.equal(envelope.graphGrounding.tenantId, tenantScopeId);
  assert.equal(envelope.graphGrounding.targetRelationshipGraphId, context.graphGrounding.targetRelationshipGraphId);
  assert.equal(envelope.graphGrounding.graphVersion, context.graphGrounding.graphVersion);
  assert.deepEqual(envelope.graphGrounding.evidence.map((item) => item.messageId), ["m1"]);
  assert.equal(envelope.characteristics.relationship.similarProfile.use, "content-free-behavioral-policy-only");
  assert.equal(envelope.characteristics.relationship.similarProfile.active, true);
  assert.ok(envelope.characteristics.relationship.similarProfile.behavioralDNAProvenance.sourceCount >= 3);
  assert.equal(envelope.characteristics.relationship.similarProfile.behavioralDNAProvenance.sourceCount,
    envelope.characteristics.relationship.similarProfile.behavioralDNA.sampleCount);
  assert.equal(envelope.characteristics.relationship.ownerGlobalBehavioralDNAProvenance.sourceCount, 5);
  assert.equal(envelope.characteristics.ownerWriting.generalFallback.behavioralDNAProvenance.sourceCount, 5);
  for (const dna of [
    envelope.characteristics.relationship.ownerGlobalBehavioralDNA,
    envelope.characteristics.relationship.similarProfile.behavioralDNA,
    envelope.characteristics.ownerWriting.generalFallback.behavioralDNA,
  ]) {
    for (const bucket of [dna.active, dna.global]) {
      assert.deepEqual(bucket.addressForms, []);
      assert.deepEqual(bucket.emojiPalette, []);
      assert.deepEqual(bucket.safeAtoms, []);
    }
  }
  assert.equal(Object.hasOwn(envelope.characteristics.relationship.similarProfile, "style"), false);
  assert.doesNotMatch(serialized, /(?:xrg|fp|src)_[a-f\d]{40}/u);
  for (const reply of foreignReplies) assert.equal(serialized.includes(reply), false);

  const result = await createLocalDraftProvider().generate(context);
  const generated = JSON.stringify(result);
  for (const reply of foreignReplies) assert.equal(generated.includes(reply), false);
});

test("provider envelopes retain lexical evidence only for the exact target relationship", () => {
  const targetPhrase = "got it yaar";
  const targetDNA = buildBehavioralDNA([{
    otherText: "Thanks",
    ownerReply: targetPhrase,
    responseDelayMs: 500,
  }], "Thanks", "friend");
  const story = [{ id: "target-thanks", speaker: "OTHER", text: "Thanks", timestampMs: 1_000, isTarget: true }];
  const context = baseContext(story, {
    freshness: { targetMessageId: "target-thanks" },
    relationship: {
      interactionCount: 1,
      medianOwnerReplyCharacters: targetPhrase.length,
      ownerEmojiReplyRate: 0,
      otherPartyExamples: ["Thanks"],
      interactions: [{ otherText: "Thanks", ownerReply: targetPhrase, responseDelayMs: 500 }],
      profile: { ownerAddressForms: ["yaar"] },
      behavioralDNA: targetDNA,
    },
  });

  const envelope = modelContextEnvelope(context);
  assert.ok(envelope.characteristics.relationship.behavioralDNA.global.safeAtoms.includes(targetPhrase));
  assert.ok(envelope.characteristics.relationship.behavioralDNA.global.addressForms.includes("yaar"));
});
