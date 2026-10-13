import assert from "node:assert/strict";
import test from "node:test";

import { analyzeReplySafety, buildDraftContext, retrieveResponseEpisodes, unresolvedDraftPlaceholders, validateDraftOutput } from "./draft.ts";
import { phraseProvenanceFingerprint, phraseTemplateFingerprint } from "./phrase-bank.ts";

const chat = {
  id: "chat:sakshi",
  connector: "fixture",
  connectorIds: ["chat:sakshi"],
  title: "Sakshi",
  collection: "active",
  kind: "direct",
  participantIds: ["owner", "sakshi"],
};
const events = [
  { id: "m1", chatId: chat.id, connectorMessageId: "m1", direction: "contact", senderId: "sakshi", senderName: "Sakshi", kind: "text", text: "Kal rain ka scene kya hai?", timestampMs: 1000, timestampVerified: true, sequence: 1 },
  { id: "m2", chatId: chat.id, connectorMessageId: "m2", direction: "owner", senderId: "owner", senderName: "You", kind: "text", text: "Dekhta hu", timestampMs: 2000, timestampVerified: true, sequence: 2 },
  { id: "m3", chatId: chat.id, connectorMessageId: "m3", direction: "contact", senderId: "sakshi", senderName: "Sakshi", kind: "text", text: "Subah bata dena pls", timestampMs: 3000, timestampVerified: true, sequence: 3 },
];
const watermark = { chatId: chat.id, state: "complete", reachedBeginning: true, oldestTimestampMs: 1000, newestTimestampMs: 3000, messageCount: 3, cursor: null, reason: "beginning-reached", verifiedAt: "2026-08-22T09:30:00Z" };

test("draft context preserves the story and explicit owner/other speakers", () => {
  const context = buildDraftContext({ chat, chatEvents: events, allEvents: events, watermark, ownerIds: ["owner"], expectedTargetMessageId: "m3", nowMs: 4000 });
  assert.deepEqual(context.story.map((event) => event.speaker), ["OTHER", "OWNER", "OTHER"]);
  assert.match(context.story[0].text, /rain/u);
  assert.equal(context.coverage.humanMessagesConsidered, 3);
  assert.equal(context.freshness.targetMessageId, "m3");
  assert.equal(context.graphGrounding.protocol, "ggcp-v1");
  assert.match(context.graphGrounding.targetRelationshipGraphId, /^trg_[a-f\d]{40}$/u);
  assert.match(context.graphGrounding.graphVersion, /^gv_[a-f\d]{64}$/u);
  assert.equal(context.graphGrounding.evidence.length, 3);
  assert.equal(context.graphGrounding.evidence.find((item) => item.messageId === "m3").evidenceId, context.graphGrounding.targetMessageEvidenceId);
  assert.equal(context.tone.stage, "learning");
  assert.equal(context.relationship.interactionCount, 1);
  assert.ok(context.relationship.profile.evidenceMessageIds.includes("m1"));
  assert.equal(context.relationship.profile.chatId, chat.id);
  assert.deepEqual(context.relationship.interactions[0], {
    otherMessageIds: ["m1"],
    ownerReplyIds: ["m2"],
    otherMessageId: "m1",
    ownerReplyId: "m2",
    precedingStoryText: [],
    otherText: "Kal rain ka scene kya hai?",
    ownerReply: "Dekhta hu",
    responseDelayMs: 1000,
  });
  assert.deepEqual(context.relationship.otherPartyExamples, ["Subah bata dena pls", "Kal rain ka scene kya hai?"]);
  assert.equal(context.retrieval.targetPersonId, "sakshi");
  assert.equal(context.retrieval.scenarioCode, context.relationship.behavioralDNA.activeScenario.code);
  assert.equal(context.retrieval.scenarioForest.fullDistributionSize, 1500);
  assert.ok(context.retrieval.scenarioForest.topCells.length > 1);
  assert.ok(context.retrieval.scenarioForest.uncertainty > 0.5);
  assert.equal(context.retrieval.scenarioForest.thermal.mixture.selectedComponents, 1);
  assert.equal(context.retrieval.scenarioPosterior, context.retrieval.scenarioForest);
  assert.ok(context.retrieval.routingBlend.forestWeight < context.retrieval.routingBlend.rulePriorWeight);
  assert.ok(Math.abs(context.retrieval.routingBlend.forestWeight + context.retrieval.routingBlend.rulePriorWeight - 1) < 0.00001);
  const forestCellsInBlend = context.retrieval.scenarioForest.topCells
    .map((cell) => ({ cell, blended: context.retrieval.routingBlend.rankedCodes.find((item) => item.code === cell.code) }))
    .filter((item) => item.blended);
  assert.ok(forestCellsInBlend.length > 0);
  for (const { cell, blended } of forestCellsInBlend) {
    assert.ok(Math.abs(blended.forestContribution - context.retrieval.routingBlend.forestWeight * cell.absoluteProbability) < 0.00001);
  }
  assert.equal(context.retrieval.scenarioCode, context.retrieval.routingBlend.rankedCodes[0].code);
  assert.equal(context.retrieval.episodes[0].factEligible, false);
  assert.equal(context.retrieval.episodes[0].use, "analogy-only");
  assert.deepEqual(context.retrieval.episodes[0].sourceMessageIds, ["m1", "m2"]);
  assert.equal(context.retrieval.phraseBank.availablePatternCount, 1);
  assert.equal(context.retrieval.phraseBank.selected[0].tier, "person-adjacent-cst");
  assert.equal(context.retrieval.phraseBank.selected[0].factEligible, false);
  assert.deepEqual(context.retrieval.phraseBank.selected[0].provenance.sourceMessageIds, ["m1", "m2"]);
  assert.ok(context.retrieval.semanticEvidence.some((item) => item.eventId === "m3" && item.tier === "current-conversation"));
  assert.equal(context.story.at(-1).isTarget, true);
  assert.equal(context.story.at(-1).factAuthority, "other_requested");
  assert.equal(context.safety.timeSensitive, true);
  assert.equal(context.safety.commitmentRequested, true);
  assert.deepEqual(context.safety.requiredFacts, ["commitment", "time"]);
});

test("authenticated tenants isolate learned phrase banks and scenario models even for the same connector account", () => {
  const accountScopeId = "same-provider-account";
  const scopedChat = { ...chat, accountScopeId };
  const scopedEvents = events.map((event) => ({ ...event, accountScopeId }));
  const input = {
    accountScopeId,
    chat: scopedChat,
    chatEvents: scopedEvents,
    allEvents: scopedEvents,
    watermark,
    ownerIds: ["owner"],
    expectedTargetMessageId: "m3",
    nowMs: 4000,
  };
  const tenantA = buildDraftContext({ ...input, tenantScopeId: "tenant-a" });
  const tenantB = buildDraftContext({ ...input, tenantScopeId: "tenant-b" });
  assert.equal(tenantA.scope.isolation, "strict-tenant-account");
  assert.equal(tenantA.scope.tenantScopeId, "tenant-a");
  assert.equal(tenantB.scope.tenantScopeId, "tenant-b");
  assert.notEqual(tenantA.retrieval.phraseBank.accountScopeId, tenantB.retrieval.phraseBank.accountScopeId);
  assert.notEqual(tenantA.retrieval.scenarioForest, tenantB.retrieval.scenarioForest);
  assert.notEqual(tenantA.graphGrounding.targetRelationshipGraphId, tenantB.graphGrounding.targetRelationshipGraphId);
});

test("target graph identity is stable while verified story edits change its graph version", () => {
  const input = { chat, chatEvents: events, allEvents: events, watermark, ownerIds: ["owner"], expectedTargetMessageId: "m3", nowMs: 4000 };
  const first = buildDraftContext(input);
  const rebuilt = buildDraftContext({ ...input, nowMs: 5000 });
  const editedEvents = events.map((event) => event.id === "m1" ? { ...event, text: "Kal heavy rain ka scene kya hai?" } : event);
  const edited = buildDraftContext({ ...input, chatEvents: editedEvents, allEvents: editedEvents });

  assert.equal(first.graphGrounding.targetRelationshipGraphId, rebuilt.graphGrounding.targetRelationshipGraphId);
  assert.equal(first.graphGrounding.graphVersion, rebuilt.graphGrounding.graphVersion);
  assert.equal(first.graphGrounding.targetRelationshipGraphId, edited.graphGrounding.targetRelationshipGraphId);
  assert.notEqual(first.graphGrounding.graphVersion, edited.graphGrounding.graphVersion);
});

test("foreign relationship lexical surfaces cannot enter a production DraftContext", () => {
  const foreignReplies = ["ok bro", "haan bhai", "sure sir", "🙏", "no worries ji"];
  const targetChat = { ...chat, title: "Colleague Sakshi" };
  const foreignChats = ["alex", "ravi", "nina", "omar", "leena"].map((person) => ({
    ...targetChat,
    id: `chat:${person}`,
    connectorIds: [`chat:${person}`],
    title: `Colleague ${person}`,
    participantIds: ["owner", person],
  }));
  const foreignEvents = foreignChats.flatMap((foreignChat, index) => [
    { ...events[0], id: `foreign-in-${index}`, connectorMessageId: `foreign-in-${index}`, chatId: foreignChat.id, senderId: foreignChat.participantIds[1], text: "Please review this", timestampMs: 100 + index * 10 },
    { ...events[1], id: `foreign-out-${index}`, connectorMessageId: `foreign-out-${index}`, chatId: foreignChat.id, text: foreignReplies[index], timestampMs: 101 + index * 10 },
  ]);
  const context = buildDraftContext({
    chat: targetChat,
    chatEvents: events,
    allChats: [targetChat, ...foreignChats],
    allEvents: [...events, ...foreignEvents],
    watermark,
    ownerIds: ["owner"],
    expectedTargetMessageId: "m3",
    nowMs: 4000,
  });

  assert.equal(context.tone.generalExamples.length, 0);
  assert.equal(Object.hasOwn(context.relationship.similarProfile, "examples"), false);
  assert.equal(Object.hasOwn(context.relationship.similarProfile, "reason"), false);
  assert.equal(context.relationship.ownerGlobalBehavioralDNA.sampleCount, 5);
  assert.equal(context.relationship.ownerGlobalBehavioralDNAProvenance.sourceCount, 5);
  assert.equal(context.relationship.ownerGlobalBehavioralDNAProvenance.sources.length, 0);
  assert.equal(context.relationship.similarProfile.active, true);
  assert.ok(context.relationship.similarProfile.behavioralDNA.sampleCount >= 3);
  assert.equal(context.relationship.similarProfile.aggregatePolicy?.distinctSourceGraphCount, context.relationship.similarProfile.behavioralDNA.sampleCount);
  assert.deepEqual(context.relationship.similarProfile.behavioralDNAProvenance, context.relationship.similarProfile.aggregatePolicy.provenance);
  assert.equal(context.relationship.similarProfile.behavioralDNAProvenance.sourceCount, context.relationship.similarProfile.behavioralDNA.sampleCount);
  assert.deepEqual(context.relationship.similarProfile.aggregatePolicy.provenance.sources, []);
  assert.deepEqual(context.relationship.ownerGlobalBehavioralDNAProvenance.sources, []);
  for (const dna of [context.relationship.ownerGlobalBehavioralDNA, context.relationship.similarProfile.behavioralDNA]) {
    for (const bucket of [dna.active, dna.global, ...Object.values(dna.byIncomingIntent), ...Object.values(dna.byScenario)]) {
      assert.deepEqual(bucket.addressForms, []);
      assert.deepEqual(bucket.emojiPalette, []);
      assert.deepEqual(bucket.safeAtoms, []);
    }
  }
  assert.ok(context.retrieval.phraseBank.selected.every((pattern) => pattern.tier.startsWith("person-")));
  const serialized = JSON.stringify(context);
  for (const reply of foreignReplies) assert.equal(serialized.includes(reply), false);
  assert.doesNotMatch(serialized, /(?:xrg|fp|src)_[a-f\d]{40}/u);
});

test("exact-target relationship lexical evidence remains available inside its own graph", () => {
  const targetPhrase = "got it yaar";
  const targetEvents = [
    { ...events[0], id: "target-style-in", connectorMessageId: "target-style-in", text: "Thanks", timestampMs: 100, sequence: 1 },
    { ...events[1], id: "target-style-out", connectorMessageId: "target-style-out", text: targetPhrase, timestampMs: 200, sequence: 2 },
    { ...events[2], id: "target-current", connectorMessageId: "target-current", text: "Please review this", timestampMs: 300, sequence: 3 },
  ];
  const context = buildDraftContext({
    chat,
    chatEvents: targetEvents,
    allEvents: targetEvents,
    watermark: { ...watermark, oldestTimestampMs: 100, newestTimestampMs: 300, messageCount: 3 },
    ownerIds: ["owner"],
    expectedTargetMessageId: "target-current",
    nowMs: 400,
  });

  assert.ok(context.relationship.behavioralDNA.global.safeAtoms.includes(targetPhrase));
});

test("cross-relationship DNA ignores matching chats without qualifying owner responses", () => {
  const targetChat = { ...chat, title: "Colleague Sakshi" };
  const sourceChats = ["alex", "ravi", "nina"].map((person) => ({
    ...targetChat,
    id: `chat:no-response-${person}`,
    connectorIds: [`chat:no-response-${person}`],
    title: `Colleague ${person}`,
    participantIds: ["owner", person],
  }));
  const sourceEvents = sourceChats.flatMap((sourceChat, index) => {
    const incoming = { ...events[0], id: `no-response-in-${index}`, connectorMessageId: `no-response-in-${index}`, chatId: sourceChat.id, senderId: sourceChat.participantIds[1], text: `Please review item ${index}`, timestampMs: 100 + index * 10 };
    return index === 0
      ? [incoming, { ...events[1], id: "only-owner-response", connectorMessageId: "only-owner-response", chatId: sourceChat.id, text: "Will review", timestampMs: 101 }]
      : [incoming];
  });
  const context = buildDraftContext({
    chat: targetChat,
    chatEvents: events,
    allChats: [targetChat, ...sourceChats],
    allEvents: [...events, ...sourceEvents],
    watermark,
    ownerIds: ["owner"],
    expectedTargetMessageId: "m3",
    nowMs: 4000,
  });

  assert.equal(context.relationship.similarProfile.sourceChatCount, 1);
  assert.equal(context.relationship.similarProfile.active, false);
  assert.equal(context.relationship.similarProfile.behavioralDNA, null);
  assert.equal(context.relationship.similarProfile.behavioralDNAProvenance, null);
  assert.equal(context.relationship.similarProfile.aggregatePolicy, null);
  assert.equal(context.relationship.ownerGlobalBehavioralDNA.sampleCount, 0);
  assert.equal(context.relationship.ownerGlobalBehavioralDNAProvenance, null);
});

test("audit ablations rebuild account and neutral contexts without target-person evidence", () => {
  const otherChat = { ...chat, id: "chat:alex", connectorIds: ["chat:alex"], title: "Alex", participantIds: ["owner", "alex"] };
  const otherEvents = [
    { ...events[0], id: "a1", chatId: otherChat.id, connectorMessageId: "a1", senderId: "alex", senderName: "Alex", text: "Please review the file", timestampMs: 500 },
    { ...events[1], id: "a2", chatId: otherChat.id, connectorMessageId: "a2", text: "Sure, I will check", timestampMs: 600 },
  ];
  const input = {
    chat,
    chatEvents: events,
    allEvents: [...events, ...otherEvents],
    allChats: [chat, otherChat],
    watermark,
    ownerIds: ["owner"],
    expectedTargetMessageId: "m3",
    nowMs: 4000,
  };
  const personalized = buildDraftContext(input);
  const account = buildDraftContext({ ...input, learningAblation: "account-baseline" });
  const neutral = buildDraftContext({ ...input, learningAblation: "neutral" });

  assert.ok(personalized.relationship.interactions.length > 0);
  assert.equal(personalized.relationship.ownerGlobalBehavioralDNA.sampleCount, 0);
  assert.equal(account.relationship.interactions.length, 0);
  assert.equal(account.tone.personSpecificExamples.length, 0);
  assert.match(account.retrieval.targetPersonId, /account-baseline:anonymous$/u);
  assert.equal(account.retrieval.episodes.length, 0);
  assert.ok(account.retrieval.phraseBank.selected.every((pattern) => pattern.provenance.personId !== "sakshi"));
  assert.equal(neutral.relationship.interactions.length, 0);
  assert.equal(neutral.relationship.ownerGlobalBehavioralDNA.sampleCount, 0);
  assert.equal(neutral.tone.generalExamples.length, 0);
  assert.equal(neutral.retrieval.phraseBank.availablePatternCount, 0);
  assert.equal(neutral.retrieval.scenarioForest, null);
});

test("canonical-person alias chats remain person evidence and never inflate the owner-global prior", () => {
  const aliasChat = { ...chat, id: "chat:sakshi-alias", connectorIds: ["chat:sakshi-alias"], title: "Sakshi old" };
  const aliasEvents = [
    { ...events[0], id: "alias-in", chatId: aliasChat.id, connectorMessageId: "alias-in", text: "FYI", timestampMs: 500 },
    { ...events[1], id: "alias-out", chatId: aliasChat.id, connectorMessageId: "alias-out", text: "Haan yaar", timestampMs: 600 },
  ];
  const context = buildDraftContext({
    chat,
    chatEvents: events,
    allChats: [chat, aliasChat],
    allEvents: [...events, ...aliasEvents],
    watermark,
    ownerIds: ["owner"],
    expectedTargetMessageId: "m3",
    nowMs: 4000,
  });
  assert.ok(context.tone.personSpecificExamples.includes("Haan yaar"));
  assert.equal(context.tone.generalExamples.includes("Haan yaar"), false);
  assert.equal(context.relationship.ownerGlobalBehavioralDNA.sampleCount, 0);
});

test("draft context applies persisted repetition and evidence-bound phrase feedback signals", () => {
  const options = { chat, chatEvents: events, allEvents: events, watermark, ownerIds: ["owner"], expectedTargetMessageId: "m3", nowMs: 4000 };
  const initial = buildDraftContext(options);
  const pattern = initial.retrieval.phraseBank.selected[0];
  const phraseSelectionSignals = {
    recentPatternIds: [pattern.id],
    recentTemplateFingerprints: [phraseTemplateFingerprint(pattern.styleFragments.surfaceTemplate)],
    feedbackSignals: [{
      patternId: pattern.id,
      provenanceFingerprint: phraseProvenanceFingerprint(pattern),
      templateFingerprint: phraseTemplateFingerprint(pattern.styleFragments.surfaceTemplate),
      adjustment: -25,
    }],
  };
  const updated = buildDraftContext({ ...options, phraseSelectionSignals });
  const selected = updated.retrieval.phraseBank.selected.find((item) => item.id === pattern.id);
  assert.ok(selected.repetitionPenalty > 0);
  assert.equal(selected.feedbackAdjustment, -25);
  assert.deepEqual(updated.retrieval.repetition.recentPatternIds, [pattern.id]);
  assert.deepEqual(updated.retrieval.repetition.recentTemplateFingerprints, phraseSelectionSignals.recentTemplateFingerprints);
});

test("a tenant-local translation enriches semantic routing without replacing the original language surface", () => {
  const context = buildDraftContext({
    chat,
    chatEvents: events,
    allEvents: events,
    watermark,
    ownerIds: ["owner"],
    expectedTargetMessageId: "m3",
    semanticTranslation: { sourceLanguage: "Roman Hindi", translatedText: "Please tell me in the morning" },
    nowMs: 4000,
  });
  assert.equal(context.currentIncomingTurn.text, "Subah bata dena pls");
  assert.equal(context.languageBridge.translatedText, "Please tell me in the morning");
  assert.equal(context.languageBridge.localOnly, true);
  assert.equal(context.languageBridge.use, "semantic-understanding-only");
  assert.ok(context.retrieval.episodes.every((item) => item.factEligible === false));
});

test("scenario retrieval prefers a substantive same-person precedent over generic acknowledgement", () => {
  const requestEvents = [
    { ...events[0], id: "ask-1", connectorMessageId: "ask-1", text: "Can you send the invoice?", timestampMs: 1000, sequence: 1 },
    { ...events[1], id: "reply-1", connectorMessageId: "reply-1", text: "Okay", timestampMs: 1100, sequence: 2 },
    { ...events[0], id: "ask-2", connectorMessageId: "ask-2", text: "Please send the invoice", timestampMs: 2000, sequence: 3 },
    { ...events[1], id: "reply-2", connectorMessageId: "reply-2", text: "I will check and share it", timestampMs: 2100, sequence: 4 },
    { ...events[2], id: "current-request", connectorMessageId: "current-request", text: "Can you send the report?", timestampMs: 3000, sequence: 5 },
  ];
  const context = buildDraftContext({
    chat,
    chatEvents: requestEvents,
    allEvents: requestEvents,
    watermark: { ...watermark, newestTimestampMs: 3000, messageCount: requestEvents.length },
    ownerIds: ["owner"],
    expectedTargetMessageId: "current-request",
    nowMs: 4000,
  });
  assert.equal(context.retrieval.episodes[0].ownerReply, "I will check and share it");
  assert.equal(context.retrieval.episodes[0].incomingIntent, "send-request");
  assert.equal(context.retrieval.episodes[0].responseAct, "commitment");
  assert.equal(context.retrieval.episodes[0].factEligible, false);
  assert.equal(new Set(context.retrieval.episodes.map((item) => item.ownerReply.toLowerCase())).size, context.retrieval.episodes.length);
});

test("response episodes with identical final messages are selected by the preceding story", () => {
  const interaction = (prefix, precedingStoryText, ownerReply, timestampMs) => ({
    otherMessageIds: [`${prefix}-incoming`],
    ownerReplyIds: [`${prefix}-reply`],
    otherMessageId: `${prefix}-incoming`,
    ownerReplyId: `${prefix}-reply`,
    precedingStoryText,
    otherText: "What should we do?",
    ownerReply,
    responseDelayMs: 1000,
    timestampMs,
  });
  const interactions = [
    interaction("dinner", ["The dinner venue is unavailable"], "Let's choose another restaurant", 2000),
    interaction("invoice", ["The invoice total is wrong"], "Let's verify the invoice amount", 3000),
  ];
  const common = {
    queryText: "What should we do?",
    relationship: "friend",
    interactions,
    activeScenario: { code: "C01-S03-T01", family: "information", candidates: [] },
    nowMs: 4000,
    timestampByMessageId: new Map([["dinner-reply", 2000], ["invoice-reply", 3000]]),
  };
  const invoice = retrieveResponseEpisodes({ ...common, currentStoryText: ["The invoice total is wrong"] });
  const dinner = retrieveResponseEpisodes({ ...common, currentStoryText: ["The dinner venue is unavailable"] });
  assert.equal(invoice[0].ownerReply, "Let's verify the invoice amount");
  assert.equal(dinner[0].ownerReply, "Let's choose another restaurant");
  assert.ok(invoice[0].similarity > invoice[1].similarity);
  assert.ok(dinner[0].similarity > dinner[1].similarity);
  assert.ok(invoice[0].effectiveSampleSize > 0);
  assert.ok(invoice[0].planProbability > 0);
  assert.ok(invoice[0].reliability > 0);
  assert.ok([...invoice, ...dinner].every((episode) => episode.use === "analogy-only" && episode.factEligible === false));
});

test("a near-identical exact-person story clears the plan gate but contradictory acts do not", () => {
  const interaction = (prefix, ownerReply) => ({
    otherMessageIds: [`${prefix}-incoming`],
    ownerReplyIds: [`${prefix}-reply`],
    otherMessageId: `${prefix}-incoming`,
    ownerReplyId: `${prefix}-reply`,
    precedingStoryText: ["The invoice total is wrong"],
    otherText: "What should we do?",
    ownerReply,
    responseDelayMs: 1000,
  });
  const common = {
    queryText: "What should we do?",
    currentStoryText: ["The invoice total is wrong"],
    relationship: "colleague",
    activeScenario: { code: "C01-S01-T01", family: "information", candidates: [] },
    nowMs: 10_000,
  };
  const supported = retrieveResponseEpisodes({
    ...common,
    interactions: [interaction("supported", "I will check and update you")],
    timestampByMessageId: new Map([["supported-reply", 9000]]),
  });
  assert.ok(supported[0].effectiveSampleSize >= 2);
  assert.ok(supported[0].reliability >= 0.4);
  assert.equal(supported[0].planProbability, 1);

  const contradictory = retrieveResponseEpisodes({
    ...common,
    interactions: [
      interaction("commitment", "I will check and update you"),
      interaction("question", "Can you send the invoice copy?"),
    ],
    timestampByMessageId: new Map([["commitment-reply", 8000], ["question-reply", 9000]]),
  });
  assert.ok(contradictory.every((episode) => episode.planProbability === 0.5));
  assert.ok(contradictory.every((episode) => episode.reliability < 0.4));
});

test("style evidence uses an intent-conditioned person transition with correlation-adjusted support", () => {
  const history = [];
  for (let index = 0; index < 8; index += 1) {
    history.push(
      { ...events[0], id: `style-in-${index}`, connectorMessageId: `style-in-${index}`, text: `The report section ${index} is ready`, timestampMs: 1000 + index * 2000, sequence: index * 2 + 1 },
      { ...events[1], id: `style-out-${index}`, connectorMessageId: `style-out-${index}`, text: `Haan main section ${index} dekh raha hu`, timestampMs: 2000 + index * 2000, sequence: index * 2 + 2 },
    );
  }
  history.push({ ...events[2], id: "style-current", connectorMessageId: "style-current", text: "The final report is ready", timestampMs: 18_000, sequence: 17 });
  const context = buildDraftContext({
    chat,
    chatEvents: history,
    allEvents: history,
    watermark: { ...watermark, newestTimestampMs: 18_000, messageCount: history.length },
    ownerIds: ["owner"],
    expectedTargetMessageId: "style-current",
    nowMs: 19_000,
  });
  assert.equal(context.relationship.stylePolicy.language.value, "Roman Hindi");
  assert.equal(context.relationship.stylePolicy.language.source, "exact-person-active");
  assert.equal(context.relationship.stylePolicy.language.sampleCount, 8);
  assert.equal(context.relationship.stylePolicy.language.effectiveSampleSize, 6);
  assert.equal(context.relationship.ownerGlobalBehavioralDNA.sampleCount, 0);
});

test("relationship memory correlates complete multi-message turns for one person", () => {
  const turnEvents = [
    { ...events[0], id: "in-1", connectorMessageId: "in-1", text: "Rain ka kya scene hai?", timestampMs: 1000, sequence: 1 },
    { ...events[0], id: "in-2", connectorMessageId: "in-2", text: "Umbrella leke aau?", timestampMs: 1100, sequence: 2 },
    { ...events[1], id: "out-1", connectorMessageId: "out-1", text: "Haan", timestampMs: 1200, sequence: 3 },
    { ...events[1], id: "out-2", connectorMessageId: "out-2", text: "Leke aana", timestampMs: 1300, sequence: 4 },
    { ...events[2], id: "current", connectorMessageId: "current", text: "Kal bhi rain hai?", timestampMs: 1400, sequence: 5 },
  ];
  const currentWatermark = { ...watermark, newestTimestampMs: 1400, messageCount: 5 };
  const context = buildDraftContext({ chat, chatEvents: turnEvents, allEvents: turnEvents, watermark: currentWatermark, ownerIds: ["owner"], expectedTargetMessageId: "current", nowMs: 2000 });
  assert.deepEqual(context.relationship.interactions[0].otherMessageIds, ["in-1", "in-2"]);
  assert.deepEqual(context.relationship.interactions[0].ownerReplyIds, ["out-1", "out-2"]);
  assert.deepEqual(context.relationship.interactions[0].precedingStoryText, []);
  assert.equal(context.relationship.interactions[0].otherText, "Rain ka kya scene hai?\nUmbrella leke aau?");
  assert.equal(context.relationship.interactions[0].ownerReply, "Haan\nLeke aana");
});

test("draft context refuses a stale target message", () => {
  assert.throws(() => buildDraftContext({ chat, chatEvents: events, allEvents: events, watermark, ownerIds: ["owner"], expectedTargetMessageId: "m1", nowMs: 4000 }), /conversation changed/iu);
});

test("drafting consumes durable state and rejects a state pointing at another latest message", () => {
  const durable = { chat_id: chat.id, version: 1, latest_message_id: "m3", latest_intent: "request", conversation_status: "awaiting_owner", open_questions: [], commitments: [], recent_facts: [] };
  const context = buildDraftContext({ chat, chatEvents: events, allEvents: events, watermark, ownerIds: ["owner"], expectedTargetMessageId: "m3", conversationState: durable, nowMs: 4000 });
  assert.equal(context.conversationState.latest_message_id, "m3");
  assert.throws(() => buildDraftContext({ chat, chatEvents: events, allEvents: events, watermark, ownerIds: ["owner"], expectedTargetMessageId: "m3", conversationState: { ...durable, latest_message_id: "m2" }, nowMs: 4000 }), /durable conversation state is stale/iu);
});

test("draft anyway permits an exact passive incoming message but never owner-last", () => {
  const groupChat = { ...chat, kind: "group" };
  const passiveIncoming = [{ ...events[0], id: "passive", connectorMessageId: "passive", text: "FYI, the file is ready", mentionsOwner: false }];
  const groupWatermark = { ...watermark, newestTimestampMs: 1000, messageCount: 1 };
  assert.throws(() => buildDraftContext({ chat: groupChat, chatEvents: passiveIncoming, allEvents: events, watermark: groupWatermark, ownerIds: ["owner"], expectedTargetMessageId: "passive", nowMs: 4000 }), /not both personally addressed/iu);
  const context = buildDraftContext({ chat: groupChat, chatEvents: passiveIncoming, allEvents: events, watermark: groupWatermark, ownerIds: ["owner"], expectedTargetMessageId: "passive", draftAnyway: true, nowMs: 4000 });
  assert.equal(context.freshness.targetMessageId, "passive");
  const ownerLast = [{ ...passiveIncoming[0], direction: "owner", senderId: "owner" }];
  assert.throws(() => buildDraftContext({ chat: groupChat, chatEvents: ownerLast, allEvents: events, watermark: groupWatermark, ownerIds: ["owner"], expectedTargetMessageId: "passive", draftAnyway: true, nowMs: 4000 }), /not an unanswered message/iu);
});

test("group grounding is chat-bound and cannot absorb a participant's direct or other-group sentences", () => {
  const groupChat = { ...chat, id: "group:project", connectorIds: ["group:project"], kind: "group", participantIds: ["owner", "sakshi", "alex"] };
  const groupEvents = [{ ...events[0], id: "group-target", connectorMessageId: "group-target", chatId: groupChat.id, text: "@owner please review the report", mentionsOwner: true }];
  const directSecret = "DIRECT_SAKSHI_SECRET_7711";
  const otherGroupSecret = "OTHER_GROUP_SECRET_8822";
  const directEvents = [
    { ...events[0], id: "direct-in", connectorMessageId: "direct-in", text: "Private status?", timestampMs: 100 },
    { ...events[1], id: "direct-out", connectorMessageId: "direct-out", text: directSecret, timestampMs: 200 },
  ];
  const otherGroup = { ...groupChat, id: "group:other", connectorIds: ["group:other"], participantIds: ["owner", "sakshi", "nina"] };
  const otherGroupEvents = [
    { ...events[0], id: "other-group-in", connectorMessageId: "other-group-in", chatId: otherGroup.id, text: "Another private group", timestampMs: 300 },
    { ...events[1], id: "other-group-out", connectorMessageId: "other-group-out", chatId: otherGroup.id, text: otherGroupSecret, timestampMs: 400 },
  ];
  const context = buildDraftContext({
    chat: groupChat,
    chatEvents: groupEvents,
    allChats: [chat, groupChat, otherGroup],
    allEvents: [...directEvents, ...otherGroupEvents, ...groupEvents],
    watermark: { ...watermark, chatId: groupChat.id, newestTimestampMs: 1000, messageCount: 1 },
    ownerIds: ["owner"],
    expectedTargetMessageId: "group-target",
    nowMs: 2000,
  });
  const directContext = buildDraftContext({ chat, chatEvents: events, allEvents: events, watermark, ownerIds: ["owner"], expectedTargetMessageId: "m3", nowMs: 4000 });

  assert.notEqual(context.graphGrounding.targetRelationshipGraphId, directContext.graphGrounding.targetRelationshipGraphId);
  assert.deepEqual(context.graphGrounding.evidence.map((item) => item.messageId), ["group-target"]);
  assert.ok(context.retrieval.semanticEvidence.every((item) => item.chatId === groupChat.id));
  assert.doesNotMatch(JSON.stringify(context), new RegExp(`${directSecret}|${otherGroupSecret}`, "u"));
});

test("factual claims require a target-graph fact while abstentions and explicit user facts remain valid", () => {
  const questionEvents = [{ ...events[2], id: "payment-question", connectorMessageId: "payment-question", text: "Is the payment done?", timestampMs: 5000 }];
  const questionWatermark = { ...watermark, oldestTimestampMs: 5000, newestTimestampMs: 5000, messageCount: 1 };
  const questionContext = buildDraftContext({ chat, chatEvents: questionEvents, allEvents: questionEvents, watermark: questionWatermark, ownerIds: ["owner"], expectedTargetMessageId: "payment-question", nowMs: 6000 });
  assert.throws(() => validateDraftOutput({
    draft: "Payment is done",
    language: "English",
    evidenceIds: ["payment-question"],
  }, questionContext), /factual claim.+not grounded/iu);

  const abstention = validateDraftOutput({ draft: "[Confirm payment status]", language: "English", evidenceIds: ["payment-question"] }, questionContext);
  assert.equal(abstention.requiresUserInput, true);

  const explicitContext = buildDraftContext({ chat, chatEvents: questionEvents, allEvents: questionEvents, watermark: questionWatermark, ownerIds: ["owner"], expectedTargetMessageId: "payment-question", userIntent: "Payment is done", nowMs: 6000 });
  const grounded = validateDraftOutput({ draft: "Payment is done", language: "English", evidenceIds: ["payment-question"] }, explicitContext);
  assert.equal(grounded.draft, "Payment is done");
  assert.equal(explicitContext.graphGrounding.factIds.length, 1);
  assert.ok(explicitContext.graphGrounding.evidence.every((item) => /^ev_[a-f\d]{40}$/u.test(item.evidenceId) && /^tgs_[a-f\d]{40}$/u.test(item.sourceRecordId)));

  const otherLocationEvents = [{ ...events[2], id: "other-location", connectorMessageId: "other-location", text: "I am at office", timestampMs: 7000 }];
  const otherLocationContext = buildDraftContext({ chat, chatEvents: otherLocationEvents, allEvents: otherLocationEvents, watermark: { ...questionWatermark, oldestTimestampMs: 7000, newestTimestampMs: 7000 }, ownerIds: ["owner"], expectedTargetMessageId: "other-location", nowMs: 8000 });
  assert.throws(() => validateDraftOutput({ draft: "I am at office", language: "English", evidenceIds: ["other-location"] }, otherLocationContext), /factual claim.+not grounded/iu);
});

test("draft context retains unsafe fact provenance but excludes it from usable GGCP facts", () => {
  const unsafeEvents = [{
    ...events[2],
    id: "unsafe-credential",
    connectorMessageId: "unsafe-credential",
    text: "OTP is 123456",
    timestampMs: 5_000,
  }];
  const context = buildDraftContext({
    chat,
    chatEvents: unsafeEvents,
    allEvents: unsafeEvents,
    watermark: { ...watermark, oldestTimestampMs: 5_000, newestTimestampMs: 5_000, messageCount: 1 },
    ownerIds: ["owner"],
    expectedTargetMessageId: "unsafe-credential",
    nowMs: 6_000,
  });
  const unsafeFact = context.graphGrounding.facts.find((fact) => fact.evidenceId === context.graphGrounding.targetMessageEvidenceId);

  assert.ok(unsafeFact);
  assert.equal(unsafeFact.safeToRepeat, false);
  assert.equal(context.graphGrounding.factIds.includes(unsafeFact.factId), false);
  assert.throws(
    () => validateDraftOutput({
      draft: "OTP is 123456",
      language: "English",
      intent: "answer",
      evidenceIds: ["unsafe-credential"],
    }, context),
    /not grounded in the target relationship graph/iu,
  );
});

test("unseen declarative claims fail closed while questions abstentions placeholders and semantic facts remain valid", () => {
  const benignEvents = [{ ...events[2], id: "benign-target", connectorMessageId: "benign-target", text: "Good morning", timestampMs: 9000 }];
  const benignWatermark = { ...watermark, oldestTimestampMs: 9000, newestTimestampMs: 9000, messageCount: 1 };
  const benignContext = buildDraftContext({ chat, chatEvents: benignEvents, allEvents: benignEvents, watermark: benignWatermark, ownerIds: ["owner"], expectedTargetMessageId: "benign-target", nowMs: 10000 });
  for (const draft of [
    "Surabhi left the office",
    "Meeting moved to Palladium tomorrow",
    "Your order ships tomorrow",
  ]) {
    assert.throws(
      () => validateDraftOutput({ draft, language: "English", evidenceIds: ["benign-target"] }, benignContext),
      /factual claim.+not grounded/iu,
      draft,
    );
  }

  assert.equal(validateDraftOutput({ draft: "Did Surabhi leave the office?", language: "English", evidenceIds: ["benign-target"] }, benignContext).draft, "Did Surabhi leave the office?");
  assert.equal(validateDraftOutput({ draft: "I need to check first.", language: "English", evidenceIds: ["benign-target"] }, benignContext).draft, "I need to check first.");
  assert.equal(validateDraftOutput({ draft: "[Confirm whether Surabhi left the office]", language: "English", evidenceIds: ["benign-target"] }, benignContext).requiresUserInput, true);

  const explicitContext = buildDraftContext({ ...{
    chat,
    chatEvents: benignEvents,
    allEvents: benignEvents,
    watermark: benignWatermark,
    ownerIds: ["owner"],
    expectedTargetMessageId: "benign-target",
    nowMs: 10000,
  }, userIntent: "Meeting moved to Palladium tomorrow" });
  assert.equal(validateDraftOutput({ draft: "Meeting moved to Palladium tomorrow", language: "English", evidenceIds: ["benign-target"] }, explicitContext).draft, "Meeting moved to Palladium tomorrow");

  const semanticEvents = [{ ...events[2], id: "semantic-fact", connectorMessageId: "semantic-fact", text: "Surabhi departed from the office", timestampMs: 11000 }];
  const semanticContext = buildDraftContext({ chat, chatEvents: semanticEvents, allEvents: semanticEvents, watermark: { ...benignWatermark, oldestTimestampMs: 11000, newestTimestampMs: 11000 }, ownerIds: ["owner"], expectedTargetMessageId: "semantic-fact", nowMs: 12000 });
  assert.equal(validateDraftOutput({ draft: "Surabhi left the office", language: "English", evidenceIds: ["semantic-fact"] }, semanticContext).draft, "Surabhi left the office");

  const contraryEvents = [{ ...events[2], id: "contrary-fact", connectorMessageId: "contrary-fact", text: "The order is delayed until tomorrow", timestampMs: 13000 }];
  const contraryContext = buildDraftContext({ chat, chatEvents: contraryEvents, allEvents: contraryEvents, watermark: { ...benignWatermark, oldestTimestampMs: 13000, newestTimestampMs: 13000 }, ownerIds: ["owner"], expectedTargetMessageId: "contrary-fact", nowMs: 14000 });
  assert.throws(
    () => validateDraftOutput({ draft: "Your order ships tomorrow", language: "English", evidenceIds: ["contrary-fact"] }, contraryContext),
    /factual claim.+not grounded/iu,
  );
});

test("draft output has bounded editable text without a manufactured score", () => {
  const context = buildDraftContext({ chat, chatEvents: events, allEvents: events, watermark, ownerIds: ["owner"], expectedTargetMessageId: "m3", nowMs: 4000 });
  const result = validateDraftOutput({ draft: "Haan, subah bata dunga.", language: "Roman Hindi", evidenceIds: ["m1", "m3"] }, context);
  assert.equal(result.draft, "[Confirm what you can commit to before sending]");
  assert.equal(result.language, "Roman Hindi");
  assert.deepEqual(result.evidenceIds, ["m1", "m3"]);
  assert.equal(result.requiresUserInput, true);
  assert.deepEqual(result.unresolvedSlots, ["[Confirm what you can commit to before sending]"]);
  assert.equal(result.safetyIntervention, true);
  assert.equal(result.safetyNote, "Complete the missing current fact before sending. Historical replies were used only for writing style.");
  assert.deepEqual(result.requiredInputs, []);
  assert.equal(result.draftRoute.personalization.basis, "none");
  assert.equal(result.draftRoute.personalization.evidenceTier, "safety-template");
  assert.equal(result.draftRoute.scenario.factEligible, false);
  assert.equal(Object.hasOwn(result, "toneMatch"), false);
  assert.throws(
    () => validateDraftOutput({ draft: "Okay", language: "English", evidenceIds: ["foreign-message", "m3"] }, context),
    /outside the target relationship graph/iu,
  );
  assert.throws(() => validateDraftOutput({ draft: "" }), /unsafe reply length/iu);
});

test("validated route metadata distinguishes provider fallback without fake percentages", () => {
  const context = buildDraftContext({ chat, chatEvents: events, allEvents: events, watermark, ownerIds: ["owner"], expectedTargetMessageId: "m3", userIntent: "I need to check this first.", nowMs: 4000 });
  const result = validateDraftOutput({
    draft: "I need to check this first.",
    language: "English",
    evidenceIds: ["m3"],
    generationRoute: "local-fallback",
    providerFailureClass: "provider-timeout",
    personalizationBasis: "relationship-semantic-fallback",
  }, context);
  assert.deepEqual(result.draftRoute.generation, {
    path: "local-fallback",
    providerStatus: "failed-fell-back",
    failureClass: "provider-timeout",
  });
  assert.equal(result.draftRoute.personalization.basis, "relationship-fallback");
  assert.equal(result.draftRoute.scenario.factEligible, false);
  assert.doesNotMatch(JSON.stringify(result.draftRoute), /percent|toneMatch|confidence/iu);
  const sensitive = validateDraftOutput({
    draft: "I need to check this first.",
    language: "English",
    evidenceIds: ["m3"],
    generationRoute: "local-sensitive-data",
    providerFailureClass: "sensitive-context-local-only",
  }, context);
  assert.deepEqual(sensitive.draftRoute.generation, {
    path: "local-sensitive-data",
    providerStatus: "blocked-local-only",
    failureClass: "sensitive-context-local-only",
  });
});

test("validated route metadata preserves used, attempted and fallback engines", () => {
  const context = buildDraftContext({ chat, chatEvents: events, allEvents: events, watermark, ownerIds: ["owner"], expectedTargetMessageId: "m3", userIntent: "I need to check this first.", nowMs: 4000 });
  const result = validateDraftOutput({
    draft: "I need to check this first.",
    language: "English",
    evidenceIds: ["m3"],
    generationRoute: "local-fallback",
    providerName: "mycrobo-local",
    providerModel: "local-safe-starter-v1",
    providerTransport: "in-process",
    providerAttempted: "openai:configured-model",
    fallbackProvider: "mycrobo-local:local-safe-starter-v1",
    providerFailureClass: "provider-timeout",
  }, context);
  assert.deepEqual(result.draftRoute.generation, {
    path: "local-fallback",
    providerStatus: "failed-fell-back",
    failureClass: "provider-timeout",
    provider: "mycrobo-local",
    model: "local-safe-starter-v1",
    transport: "in-process",
    attemptedProvider: "openai:configured-model",
    fallbackProvider: "mycrobo-local:local-safe-starter-v1",
  });
});

test("current time, availability, location and commitment requests require a user fact", () => {
  const cases = [
    ["What time will you reach?", ["availability", "commitment", "time"]],
    ["Are you free now?", ["availability", "time"]],
    ["Any update?", ["commitment", "status"]],
    ["Can you send it tonight?", ["availability", "commitment", "time"]],
    ["Can you send it Monday?", ["availability", "commitment", "time"]],
    ["Can you send 2 files?", ["availability", "commitment"]],
  ];
  for (const [message, facts] of cases) {
    const result = analyzeReplySafety(message);
    assert.equal(result.requiresCurrentFact, true, message);
    assert.deepEqual(result.requiredFacts, facts, message);
  }
  assert.equal(analyzeReplySafety("Thanks yaar").requiresCurrentFact, false);
  assert.deepEqual(unresolvedDraftPlaceholders("Reach by [Add the actual time before sending]"), ["[Add the actual time before sending]"]);
});

test("a provider cannot turn an availability question into an unsupported yes", () => {
  const availabilityEvents = [{ ...events[2], id: "available", connectorMessageId: "available", text: "Are you free now?", timestampMs: 3000 }];
  const context = buildDraftContext({ chat, chatEvents: availabilityEvents, allEvents: availabilityEvents, watermark: { ...watermark, oldestTimestampMs: 3000, newestTimestampMs: 3000, messageCount: 1 }, ownerIds: ["owner"], expectedTargetMessageId: "available", nowMs: 4000 });
  const result = validateDraftOutput({ draft: "Yes", language: "English", evidenceIds: ["available"] }, context);
  assert.equal(result.draft, "[Say whether you are available before sending]");
  assert.equal(result.requiresUserInput, true);
});

test("an exact user-provided reply may contain a deliberate commitment", () => {
  const context = buildDraftContext({ chat, chatEvents: events, allEvents: events, watermark, ownerIds: ["owner"], expectedTargetMessageId: "m3", userIntent: "Haan, 10 minute mein.", nowMs: 4000 });
  const result = validateDraftOutput({ draft: "Haan, 10 minute mein.", language: "Roman Hindi", evidenceIds: ["m3"] }, context);
  assert.equal(result.draft, "Haan, 10 minute mein.");
  assert.equal(result.requiresUserInput, false);
  assert.equal(result.safetyIntervention, false);
});
