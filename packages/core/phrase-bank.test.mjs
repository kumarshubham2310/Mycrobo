import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDynamicPhraseBank,
  clearDynamicPhraseBankCache,
  dynamicPhraseBankCacheDiagnostics,
  phraseProvenanceFingerprint,
  phraseTemplateFingerprint,
  scenarioTrainingEpisodesFromHistory,
  selectDynamicPhrases,
  slotHistoricalReply,
} from "./phrase-bank.ts";

const DAY = 86_400_000;

function chat(id, personId, title = "Riya", scope = "tenant-a") {
  return {
    id,
    accountScopeId: scope,
    connector: "fixture",
    connectorIds: [id],
    title,
    collection: "active",
    kind: "direct",
    participantIds: ["owner", personId],
  };
}

function event(chatId, id, direction, senderId, text, timestampMs, scope = "tenant-a") {
  return {
    id,
    accountScopeId: scope,
    chatId,
    connectorMessageId: id,
    direction,
    senderId,
    senderName: direction === "owner" ? "You" : senderId,
    kind: "text",
    text,
    timestampMs,
    timestampVerified: true,
    sequence: timestampMs,
  };
}

test("the bank is learned only from owner replies and has no static fallback phrases", () => {
  const bank = buildDynamicPhraseBank({
    accountScopeId: "tenant-a",
    chats: [chat("empty", "riya")],
    events: [event("empty", "incoming", "contact", "riya", "The file is ready", 1000)],
    ownerIds: ["owner"],
    nowMs: 2000,
  });
  assert.equal(bank.source, "whatsapp-owner-replies-only");
  assert.deepEqual(bank.patterns, []);
});

test("forest training episodes carry the exact preceding story and never future or reply text", () => {
  const sourceChat = chat("story-chat", "riya", "Riya");
  const episodes = scenarioTrainingEpisodesFromHistory({
    accountScopeId: "tenant-a",
    chats: [sourceChat],
    events: [
      event(sourceChat.id, "context-1", "owner", "owner", "The earlier plan was Monday", 1000),
      event(sourceChat.id, "context-2", "contact", "riya", "That timing no longer works", 2000),
      event(sourceChat.id, "incoming", "contact", "riya", "Can you suggest another time?", 3000),
      event(sourceChat.id, "reply", "owner", "owner", "I will check my calendar", 4000),
      event(sourceChat.id, "future", "contact", "riya", "Tuesday works", 5000),
    ],
    ownerIds: ["owner"],
  });
  assert.equal(episodes.length, 1);
  assert.deepEqual(episodes[0].storyText, ["The earlier plan was Monday"]);
  assert.equal(episodes[0].incomingText, "That timing no longer works\nCan you suggest another time?");
  assert.doesNotMatch(episodes[0].storyText.join(" "), /calendar|Tuesday/iu);
});

test("phrase-bank and forest episodes require verified chronological timestamps", () => {
  clearDynamicPhraseBankCache();
  const sourceChat = chat("verified-only", "riya", "Riya");
  const validIncoming = event(sourceChat.id, "valid-in", "contact", "riya", "The report is ready", 1000);
  const validReply = event(sourceChat.id, "valid-out", "owner", "owner", "Great, please share it", 1100);
  const blockedIncoming = event(sourceChat.id, "blocked-in", "contact", "riya", "The invoice is ready", 2000);
  const unverifiedBarrier = {
    ...event(sourceChat.id, "unknown-out", "owner", "owner", "Unverified owner response", 2100),
    timestampMs: null,
    timestampVerified: false,
    sequence: 4,
  };
  const laterOwner = { ...event(sourceChat.id, "later-out", "owner", "owner", "Please send the invoice", 2200), sequence: 5 };
  const sourceEvents = [
    { ...validIncoming, sequence: 1 },
    { ...validReply, sequence: 2 },
    { ...blockedIncoming, sequence: 3 },
    unverifiedBarrier,
    laterOwner,
  ];
  const bank = buildDynamicPhraseBank({
    accountScopeId: "tenant-a",
    chats: [sourceChat],
    events: sourceEvents,
    ownerIds: ["owner"],
    nowMs: 3000,
  });
  const forestEpisodes = scenarioTrainingEpisodesFromHistory({
    accountScopeId: "tenant-a",
    chats: [sourceChat],
    events: sourceEvents,
    ownerIds: ["owner"],
  });
  assert.equal(bank.patterns.length, 1);
  assert.deepEqual(bank.patterns[0].provenance.sourceMessageIds, ["valid-in", "valid-out"]);
  assert.equal(forestEpisodes.length, 1);
  assert.equal(forestEpisodes[0].incomingText, "The report is ready");
  assert.equal(forestEpisodes[0].ownerReply, "Great, please share it");
  assert.doesNotMatch(JSON.stringify({ bank, forestEpisodes }), /unknown-out|Unverified owner response|later-out/iu);
});

test("historical facts and secrets are slotted while semantic plan and style stay separate", () => {
  const template = slotHistoricalReply(
    "Sure Riya, send Project Atlas.pdf tomorrow at 5 pm. OTP 123456 https://example.test/a",
    "Can you send Project Atlas to Riya tomorrow?",
    ["Riya", "Project Atlas"],
  );
  assert.doesNotMatch(template, /Riya|Project Atlas|123456|example\.test|tomorrow|5 pm/iu);
  assert.match(template, /\{\{(?:name|file|date|time|credential|url|topic)\}\}/u);

  const sourceChat = chat("chat-riya", "riya", "Riya");
  const bank = buildDynamicPhraseBank({
    accountScopeId: "tenant-a",
    chats: [sourceChat],
    events: [
      event(sourceChat.id, "ask", "contact", "riya", "Can you send Project Atlas to Riya tomorrow?", 1000),
      event(sourceChat.id, "reply", "owner", "owner", "Sure Riya, I will send Project Atlas tomorrow at 5 pm. OTP 123456", 2000),
    ],
    ownerIds: ["owner"],
    nowMs: 3000,
  });
  assert.equal(bank.patterns.length, 1);
  const [pattern] = bank.patterns;
  assert.equal(pattern.semanticPlan.responseAct, "commitment");
  assert.equal(pattern.provenance.origin, "whatsapp-owner-reply");
  assert.deepEqual(pattern.provenance.sourceMessageIds, ["ask", "reply"]);
  assert.equal(pattern.factEligible, false);
  assert.equal(pattern.use, "style-template-only");
  assert.doesNotMatch(pattern.styleFragments.surfaceTemplate, /Riya|Atlas|123456|tomorrow|5 pm/iu);
});

test("lowercase historical entities are removed from reusable templates", () => {
  const template = slotHistoricalReply(
    "Sure, meet me at orchardville after reviewing the zephyr budget",
    "Can we catch up later?",
    [],
  );
  assert.doesNotMatch(template, /orchardville|zephyr|budget/iu);
  assert.match(template, /\{\{(?:place|topic)\}\}/u);
  assert.match(template, /after reviewing/iu);
});

test("identical learned frames deduplicate and retain evidence count, provenance and recency", () => {
  const sourceChat = chat("chat-riya", "riya", "Riya");
  const bank = buildDynamicPhraseBank({
    accountScopeId: "tenant-a",
    chats: [sourceChat],
    events: [
      event(sourceChat.id, "ask-1", "contact", "riya", "Please check invoice 12", DAY),
      event(sourceChat.id, "reply-1", "owner", "owner", "Yes, I will check invoice 12", DAY + 1000),
      event(sourceChat.id, "ask-2", "contact", "riya", "Please check invoice 45", DAY * 2),
      event(sourceChat.id, "reply-2", "owner", "owner", "Yes, I will check invoice 45", DAY * 2 + 1000),
    ],
    ownerIds: ["owner"],
    nowMs: DAY * 3,
  });
  assert.equal(bank.patterns.length, 1);
  assert.equal(bank.patterns[0].evidenceCount, 2);
  assert.equal(bank.patterns[0].recency, "recent");
  assert.deepEqual(bank.patterns[0].provenance.sourceMessageIds, ["ask-1", "reply-1", "ask-2", "reply-2"]);
});

function pattern({ id, personId, relationship, cstCode, template, timestampMs, count = 1, responseAct = "information" }) {
  return {
    id,
    cstCode,
    semanticPlan: { incomingIntent: "statement", responseAct, scenarioFamily: "information" },
    styleFragments: {
      surfaceTemplate: template,
      literalFragments: [template],
      writingMode: "English",
      characterBucket: "short",
      terminalMark: "none",
      emoji: [],
      lineCount: 1,
    },
    language: "English",
    recency: "recent",
    evidenceCount: count,
    provenance: {
      origin: "whatsapp-owner-reply",
      accountScopeId: "tenant-a",
      personId,
      relationship,
      chatIds: [`chat-${personId}`],
      sourceMessageIds: [`source-${id}`],
      latestTimestampMs: timestampMs,
    },
    factEligible: false,
    use: "style-template-only",
  };
}

test("selection follows person+cell, adjacent person cells, relationship, then owner-global", () => {
  const patterns = [
    pattern({ id: "exact", personId: "riya", relationship: "friend", cstCode: "C10.S03.T10", template: "exact {{topic}}", timestampMs: 5000 }),
    pattern({ id: "adjacent", personId: "riya", relationship: "friend", cstCode: "C10.S03.T03", template: "adjacent {{topic}}", timestampMs: 4000 }),
    pattern({ id: "relationship", personId: "amit", relationship: "friend", cstCode: "C03.S03.T03", template: "peer {{topic}}", timestampMs: 3000 }),
    pattern({ id: "global", personId: "client", relationship: "client", cstCode: "C03.S06.T05", template: "global {{topic}}", timestampMs: 2000 }),
  ];
  const selection = selectDynamicPhrases({ version: 1, accountScopeId: "tenant-a", builtAt: new Date(6000).toISOString(), source: "whatsapp-owner-replies-only", patterns }, {
    personId: "riya",
    cstCode: "C10.S03.T10",
    adjacentCstCodes: ["C10.S03.T03"],
    relationship: "friend",
    language: "English",
    nowMs: 6000,
    limit: 4,
  });
  assert.deepEqual(selection.selected.map((item) => item.tier), ["person-cst", "person-adjacent-cst", "relationship", "owner-global"]);
  assert.deepEqual(selection.fallbackOrder, ["person-cst", "person-adjacent-cst", "relationship", "owner-global"]);
});

test("selection uses incoming intent to separate different plans inside one C/S/T cell", () => {
  const shared = {
    cstCode: "C06-S02-T02",
    language: "English",
    evidenceCount: 2,
    styleFragments: { surfaceTemplate: "", literalFragments: [], writingMode: "English", terminalMark: "none", emoji: [] },
    provenance: {
      accountScopeId: "tenant-a",
      personId: "person-a",
      relationship: "friend",
      chatIds: ["chat-a"],
      sourceMessageIds: ["m1", "m2"],
      latestTimestampMs: 1_000,
    },
  };
  const bank = {
    version: 1,
    accountScopeId: "tenant-a",
    patterns: [
      { ...shared, id: "greet", semanticPlan: { incomingIntent: "greeting", responseAct: "greeting" } },
      { ...shared, id: "request", semanticPlan: { incomingIntent: "send-request", responseAct: "commitment" } },
    ],
  };
  const selected = selectDynamicPhrases(bank, {
    personId: "person-a",
    cstCode: shared.cstCode,
    relationship: "friend",
    incomingIntent: "send-request",
    language: "English",
    nowMs: 2_000,
    limit: 2,
  });
  assert.equal(selected.selected[0].id, "request");
  assert.equal(selected.selected.some((pattern) => pattern.id === "greet"), false);
  assert.equal(selected.selected[0].planProbability, 1);
  assert.ok(selected.selected[0].effectiveSampleSize > 1);
  assert.ok(selected.selected[0].reliability > 0);
});

test("an intent-mismatched person cell backs off to a conditionally relevant relationship plan", () => {
  const patterns = [
    { ...pattern({ id: "person-greeting", personId: "riya", relationship: "friend", cstCode: "C10.S03.T10", template: "Hey {{name}}", timestampMs: 5000 }), semanticPlan: { incomingIntent: "greeting", responseAct: "greeting", scenarioFamily: "greeting" } },
    { ...pattern({ id: "peer-send", personId: "amit", relationship: "friend", cstCode: "C10.S03.T10", template: "I will check and share {{topic}}", timestampMs: 4000, count: 4, responseAct: "commitment" }), semanticPlan: { incomingIntent: "send-request", responseAct: "commitment", scenarioFamily: "coordination" } },
  ];
  const selected = selectDynamicPhrases({ version: 1, accountScopeId: "tenant-a", builtAt: new Date(6000).toISOString(), source: "whatsapp-owner-replies-only", patterns }, {
    personId: "riya",
    cstCode: "C10.S03.T10",
    relationship: "friend",
    incomingIntent: "send-request",
    language: "English",
    nowMs: 6000,
    limit: 4,
  });
  assert.equal(selected.selected.some((item) => item.id === "person-greeting"), false);
  assert.equal(selected.selected[0].id, "peer-send");
  assert.equal(selected.selected[0].tier, "relationship");
  assert.equal(selected.selected[0].factEligible, false);
});

test("recently used learned patterns receive a repetition penalty", () => {
  const patterns = [
    pattern({ id: "usual", personId: "riya", relationship: "friend", cstCode: "C10.S03.T10", template: "usual {{topic}}", timestampMs: 5000, count: 5 }),
    pattern({ id: "alternate", personId: "riya", relationship: "friend", cstCode: "C10.S03.T10", template: "alternate {{topic}}", timestampMs: 4000 }),
  ];
  const selection = selectDynamicPhrases({ version: 1, accountScopeId: "tenant-a", builtAt: new Date(6000).toISOString(), source: "whatsapp-owner-replies-only", patterns }, {
    personId: "riya",
    cstCode: "C10.S03.T10",
    relationship: "friend",
    nowMs: 6000,
    recentPatternIds: ["usual"],
    limit: 2,
  });
  assert.equal(selection.selected[0].id, "alternate");
  assert.equal(selection.selected.find((item) => item.id === "usual")?.repetitionPenalty, 80);
});

test("repeated generic templates receive a frequency-aware penalty without a static phrase bank", () => {
  const patterns = [
    pattern({ id: "generic", personId: "riya", relationship: "friend", cstCode: "C10.S03.T10", template: "Okay", timestampMs: 5000, count: 8, responseAct: "acknowledgement" }),
    pattern({ id: "specific", personId: "riya", relationship: "friend", cstCode: "C10.S03.T10", template: "I saw {{topic}}", timestampMs: 4000 }),
  ];
  const selection = selectDynamicPhrases({ version: 1, accountScopeId: "tenant-a", builtAt: new Date(6000).toISOString(), source: "whatsapp-owner-replies-only", patterns }, {
    personId: "riya",
    cstCode: "C10.S03.T10",
    relationship: "friend",
    nowMs: 6000,
    recentTemplateFingerprints: [phraseTemplateFingerprint("Okay"), phraseTemplateFingerprint("Okay")],
    limit: 2,
  });
  assert.equal(selection.selected[0].id, "specific");
  assert.equal(selection.selected.find((item) => item.id === "generic")?.repetitionPenalty, 150);
});

test("feedback adjusts a pattern only while its exact template and evidence provenance match", () => {
  const accepted = pattern({ id: "accepted", personId: "riya", relationship: "friend", cstCode: "C10.S03.T10", template: "Will review {{topic}}", timestampMs: 4000 });
  const alternate = pattern({ id: "alternate", personId: "riya", relationship: "friend", cstCode: "C10.S03.T10", template: "Let me check {{topic}}", timestampMs: 5000 });
  const bank = { version: 1, accountScopeId: "tenant-a", builtAt: new Date(6000).toISOString(), source: "whatsapp-owner-replies-only", patterns: [accepted, alternate] };
  const valid = {
    patternId: accepted.id,
    provenanceFingerprint: phraseProvenanceFingerprint(accepted),
    templateFingerprint: phraseTemplateFingerprint(accepted.styleFragments.surfaceTemplate),
    adjustment: 30,
  };
  const selected = selectDynamicPhrases(bank, { personId: "riya", cstCode: "C10.S03.T10", relationship: "friend", nowMs: 6000, feedbackSignals: [valid], limit: 2 });
  assert.equal(selected.selected[0].id, "accepted");
  assert.equal(selected.selected[0].feedbackAdjustment, 30);
  const stale = selectDynamicPhrases(bank, { personId: "riya", cstCode: "C10.S03.T10", relationship: "friend", nowMs: 6000, feedbackSignals: [{ ...valid, provenanceFingerprint: "0".repeat(64) }], limit: 2 });
  assert.equal(stale.selected.find((item) => item.id === "accepted")?.feedbackAdjustment, 0);
  const changedTemplate = selectDynamicPhrases(bank, { personId: "riya", cstCode: "C10.S03.T10", relationship: "friend", nowMs: 6000, feedbackSignals: [{ ...valid, templateFingerprint: phraseTemplateFingerprint("Different learned frame") }], limit: 2 });
  assert.equal(changedTemplate.selected.find((item) => item.id === "accepted")?.feedbackAdjustment, 0);
});

test("strict account scopes reject untagged or foreign WhatsApp evidence", () => {
  assert.throws(() => buildDynamicPhraseBank({
    accountScopeId: "tenant-a",
    chats: [chat("foreign", "riya", "Riya", "tenant-b")],
    events: [],
    ownerIds: ["owner"],
    nowMs: 1,
  }), /account boundary/iu);
  assert.throws(() => buildDynamicPhraseBank({
    accountScopeId: "tenant-a",
    chats: [{ ...chat("unscoped", "riya"), accountScopeId: undefined }],
    events: [],
    ownerIds: ["owner"],
    nowMs: 1,
  }), /account boundary/iu);
});

test("an unchanged WhatsApp snapshot is memoized while time-sensitive recency is refreshed", () => {
  clearDynamicPhraseBankCache();
  const sourceChat = chat("memoized", "riya", "Riya");
  const events = [
    event(sourceChat.id, "ask", "contact", "riya", "Can you check the deck?", DAY),
    event(sourceChat.id, "reply", "owner", "owner", "Haan, I will check the deck", DAY + 1000),
  ];
  const recent = buildDynamicPhraseBank({ accountScopeId: "tenant-a", chats: [sourceChat], events, ownerIds: ["owner"], nowMs: DAY * 30 });
  const established = buildDynamicPhraseBank({ accountScopeId: "tenant-a", chats: [sourceChat], events: [...events], ownerIds: ["owner"], nowMs: DAY * 40 });
  const diagnostic = dynamicPhraseBankCacheDiagnostics("tenant-a").accounts[0];
  assert.equal(diagnostic.snapshotMisses, 1);
  assert.equal(diagnostic.snapshotHits, 1);
  assert.equal(diagnostic.episodeMisses, 1);
  assert.equal(recent.patterns[0].recency, "recent");
  assert.equal(established.patterns[0].recency, "established");
});

test("an appended WhatsApp turn reuses old episode analysis and classifies only the new episode", () => {
  clearDynamicPhraseBankCache();
  const sourceChat = chat("incremental", "riya", "Riya");
  const first = [
    event(sourceChat.id, "ask-1", "contact", "riya", "Can you check invoice 12?", 1000),
    event(sourceChat.id, "reply-1", "owner", "owner", "I will check invoice 12", 2000),
  ];
  buildDynamicPhraseBank({ accountScopeId: "tenant-a", chats: [sourceChat], events: first, ownerIds: ["owner"], nowMs: 3000 });
  const appended = [
    ...first,
    event(sourceChat.id, "ask-2", "contact", "riya", "Can you share report 45?", 700_000),
    event(sourceChat.id, "reply-2", "owner", "owner", "I will share report 45", 701_000),
  ];
  const bank = buildDynamicPhraseBank({ accountScopeId: "tenant-a", chats: [sourceChat], events: appended, ownerIds: ["owner"], nowMs: 702_000 });
  const diagnostic = dynamicPhraseBankCacheDiagnostics("tenant-a").accounts[0];
  assert.equal(diagnostic.snapshotMisses, 2);
  assert.equal(diagnostic.episodeMisses, 2);
  assert.equal(diagnostic.episodeHits, 1);
  assert.equal(bank.patterns.reduce((sum, item) => sum + item.evidenceCount, 0), 2);
});

test("memoization never leaks a future reply into an earlier chronological holdout", () => {
  clearDynamicPhraseBankCache();
  const sourceChat = chat("holdout", "riya", "Riya");
  const incoming = event(sourceChat.id, "ask", "contact", "riya", "Where should we meet?", 1000);
  const reply = event(sourceChat.id, "reply", "owner", "owner", "Near the office at 5 pm", 2000);
  const future = buildDynamicPhraseBank({ accountScopeId: "tenant-a", chats: [sourceChat], events: [incoming, reply], ownerIds: ["owner"], nowMs: 3000 });
  const holdout = buildDynamicPhraseBank({ accountScopeId: "tenant-a", chats: [sourceChat], events: [incoming], ownerIds: ["owner"], nowMs: 1001 });
  const restored = buildDynamicPhraseBank({ accountScopeId: "tenant-a", chats: [sourceChat], events: [incoming, reply], ownerIds: ["owner"], nowMs: 4000 });
  assert.equal(future.patterns.length, 1);
  assert.deepEqual(holdout.patterns, []);
  assert.equal(restored.patterns.length, 1);
  assert.deepEqual(restored.patterns[0].provenance.sourceMessageIds, ["ask", "reply"]);
});

test("an edited message invalidates the cached revision even when its id and timestamp are unchanged", () => {
  clearDynamicPhraseBankCache();
  const sourceChat = chat("edited", "riya", "Riya");
  const incoming = event(sourceChat.id, "ask", "contact", "riya", "Can you handle the invoice?", 1000);
  const original = event(sourceChat.id, "reply", "owner", "owner", "I will check the invoice", 2000);
  const edited = { ...original, text: "I will share the invoice" };
  const before = buildDynamicPhraseBank({ accountScopeId: "tenant-a", chats: [sourceChat], events: [incoming, original], ownerIds: ["owner"], nowMs: 3000 });
  const after = buildDynamicPhraseBank({ accountScopeId: "tenant-a", chats: [sourceChat], events: [incoming, edited], ownerIds: ["owner"], nowMs: 3001 });
  assert.match(before.patterns[0].styleFragments.surfaceTemplate, /check/iu);
  assert.doesNotMatch(after.patterns[0].styleFragments.surfaceTemplate, /check/iu);
  assert.match(after.patterns[0].styleFragments.surfaceTemplate, /share/iu);
  assert.equal(dynamicPhraseBankCacheDiagnostics("tenant-a").accounts[0].snapshotMisses, 2);
});

test("same ids and timestamps in different tenant caches remain isolated", () => {
  clearDynamicPhraseBankCache();
  const tenantAChat = chat("same-chat", "riya", "Riya", "tenant-a");
  const tenantBChat = chat("same-chat", "riya", "Riya", "tenant-b");
  const tenantA = buildDynamicPhraseBank({
    accountScopeId: "tenant-a",
    chats: [tenantAChat],
    events: [event("same-chat", "ask", "contact", "riya", "Status?", 1000, "tenant-a"), event("same-chat", "reply", "owner", "owner", "Checking this", 2000, "tenant-a")],
    ownerIds: ["owner"],
    nowMs: 3000,
  });
  const tenantB = buildDynamicPhraseBank({
    accountScopeId: "tenant-b",
    chats: [tenantBChat],
    events: [event("same-chat", "ask", "contact", "riya", "Status?", 1000, "tenant-b"), event("same-chat", "reply", "owner", "owner", "Will share shortly", 2000, "tenant-b")],
    ownerIds: ["owner"],
    nowMs: 3000,
  });
  assert.equal(dynamicPhraseBankCacheDiagnostics().accountCount, 2);
  assert.doesNotMatch(tenantA.patterns[0].styleFragments.surfaceTemplate, /share shortly/iu);
  assert.doesNotMatch(tenantB.patterns[0].styleFragments.surfaceTemplate, /checking this/iu);
});

test("repeated large-bank builds take the exact snapshot fast path", () => {
  clearDynamicPhraseBankCache();
  const sourceChat = chat("performance", "riya", "Riya");
  const events = [];
  for (let index = 0; index < 400; index += 1) {
    const base = index * 700_000;
    events.push(event(sourceChat.id, `ask-${index}`, "contact", "riya", `Can you review document ${index}?`, base + 1000));
    events.push(event(sourceChat.id, `reply-${index}`, "owner", "owner", `Haan, document ${index} check karke batata hu`, base + 2000));
  }
  const firstStart = performance.now();
  buildDynamicPhraseBank({ accountScopeId: "tenant-a", chats: [sourceChat], events, ownerIds: ["owner"], nowMs: DAY * 20 });
  const firstDuration = performance.now() - firstStart;
  const cachedStart = performance.now();
  buildDynamicPhraseBank({ accountScopeId: "tenant-a", chats: [sourceChat], events: [...events], ownerIds: ["owner"], nowMs: DAY * 20 + 1 });
  const cachedDuration = performance.now() - cachedStart;
  const diagnostic = dynamicPhraseBankCacheDiagnostics("tenant-a").accounts[0];
  assert.equal(diagnostic.snapshotHits, 1);
  assert.equal(diagnostic.episodeMisses, 400);
  assert.ok(cachedDuration < firstDuration, `expected cached ${cachedDuration.toFixed(2)}ms to beat initial ${firstDuration.toFixed(2)}ms`);
});
