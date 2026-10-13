import assert from "node:assert/strict";
import test from "node:test";

import { EvidenceBackedIdentityGraph } from "./identity.ts";
import { buildPersonRelationshipModel, detectWritingMode } from "./relationship.ts";
import {
  DeterministicMultilingualEncoder,
  retrieveContext,
  semanticSimilarity,
  semanticSimilarityAcrossVariants,
} from "./retrieval.ts";

const now = Date.UTC(2026, 7, 26, 12, 0, 0);
const owner = "person:owner";
const sakshi = "person:sakshi";
const other = "person:other";
const chat = (id, title, kind, participantIds) => ({
  id,
  connector: "fixture",
  connectorIds: [id],
  title,
  collection: "active",
  kind,
  participantIds,
});
const message = (id, chatId, direction, text, offset, senderId = direction === "owner" ? owner : sakshi) => ({
  id,
  chatId,
  connectorMessageId: id,
  direction,
  senderId,
  senderName: direction === "owner" ? "You" : senderId === sakshi ? "Sakshi" : "Other",
  kind: "text",
  text,
  timestampMs: now + offset,
  timestampVerified: true,
  sequence: Math.abs(offset),
});

test("identity resolution retains evidence and refuses conflicting confirmed links", () => {
  const graph = new EvidenceBackedIdentityGraph();
  graph.addLink({ id: "e1", connectorId: "919999@s.whatsapp.net", canonicalPersonId: sakshi, source: "connector", confidence: 0.9, observedAt: "2026-08-26T00:00:00Z" });
  graph.addLink({ id: "e2", connectorId: "919999@s.whatsapp.net", canonicalPersonId: sakshi, source: "user-confirmed", confidence: 1, observedAt: "2026-08-26T00:01:00Z" });
  graph.addAlias({ alias: "Sakshi office", canonicalPersonId: sakshi, sourceMessageId: "m1", confidence: 0.8, observedAt: "2026-08-26T00:02:00Z" });
  const resolved = graph.resolve("919999@S.WHATSAPP.NET");
  assert.equal(resolved.canonicalPersonId, sakshi);
  assert.equal(resolved.evidence.length, 2);
  assert.deepEqual(graph.aliases(sakshi).map((item) => item.alias), ["Sakshi office"]);
  assert.throws(() => graph.addLink({ id: "e3", connectorId: "919999@s.whatsapp.net", canonicalPersonId: other, source: "user-confirmed", confidence: 1, observedAt: "2026-08-26T00:03:00Z" }), /conflicting confirmed evidence/iu);
});

test("relationship features remain person-specific, contextual and evidence-backed", () => {
  const direct = chat("chat:direct", "Sakshi", "direct", [owner, sakshi]);
  const group = chat("chat:friends", "Weekend friends", "group", [owner, sakshi, other]);
  const events = [
    message("d1", direct.id, "contact", "Please review the audit report", -10_000),
    message("d2", direct.id, "owner", "Haan, check karta hu", -9_000),
    message("d3", direct.id, "contact", "Office meeting kal?", -8_000),
    message("d4", direct.id, "owner", "Yes, will confirm", -7_000),
    message("g1", group.id, "contact", "Birthday dinner at home", -6_000),
    message("g2", group.id, "owner", "Haan yaar 😊", -5_000),
    message("g3", group.id, "owner", "મજા ma bro", -4_000),
  ];
  const model = buildPersonRelationshipModel({ personId: sakshi, chats: [direct, group], events, nowMs: now });
  assert.deepEqual(model.sharedGroupIds, [group.id]);
  assert.equal(model.contexts.length, 2);
  const directProfile = model.contexts.find((item) => item.chatId === direct.id);
  const groupProfile = model.contexts.find((item) => item.chatId === group.id);
  assert.equal(directProfile.category, "professional");
  assert.equal(groupProfile.category, "personal");
  assert.ok(directProfile.evidenceMessageIds.includes("d1"));
  assert.ok(groupProfile.ownerEmojiRate > directProfile.ownerEmojiRate);
  assert.ok(groupProfile.ownerAddressForms.includes("yaar"));
  assert.equal(detectWritingMode("office se niklungi"), "Roman Hindi");
  assert.equal(detectWritingMode("મજા ma bro"), "Mixed");
});

test("deterministic multilingual similarity connects English and Roman-script intent", () => {
  const semantic = semanticSimilarity("Leaving work now", "Office se niklungi");
  const unrelated = semanticSimilarity("Leaving work now", "Birthday cake photo");
  assert.ok(semantic > 0.3, `expected semantic similarity, received ${semantic}`);
  assert.ok(semantic > unrelated);
  assert.equal(semanticSimilarity("Leaving work now", "Office se niklungi"), semantic);
});

test("a local translation is encoded as an alternative meaning rather than diluting the original turn", () => {
  const original = "કૃપા કરીને આ તપાસશો";
  const historical = "Please review this";
  const originalOnly = semanticSimilarity(original, historical);
  const bridged = semanticSimilarityAcrossVariants([original, historical], historical);
  assert.equal(bridged, 1);
  assert.ok(bridged > originalOnly);
  assert.equal(semanticSimilarityAcrossVariants([original, historical], historical), bridged);
});

test("variant similarity encodes shared historical text only once", () => {
  const delegate = new DeterministicMultilingualEncoder();
  const calls = [];
  const encoder = {
    encode(text) {
      calls.push(text);
      return delegate.encode(text);
    },
  };
  const similarity = semanticSimilarityAcrossVariants(
    ["Please review this", "Kindly check this", "Please review this"],
    "Can you check this?",
    encoder,
  );
  assert.ok(similarity > 0);
  assert.deepEqual(calls, ["Please review this", "Kindly check this", "Can you check this?"]);
});

test("semantic retrieval can use an optional local translation without exposing it as factual authority", () => {
  const current = chat("chat:translated-current", "Sakshi", "direct", [owner, sakshi]);
  const history = chat("chat:translated-history", "Sakshi history", "direct", [owner, sakshi]);
  const currentEvent = message("translated-current", current.id, "contact", "કૃપા કરીને આ તપાસશો", -1_000);
  const events = [
    currentEvent,
    message("translated-history-in", history.id, "contact", "Please review this", -10_000),
    message("translated-history-out", history.id, "owner", "I will review it", -9_000),
  ];
  const chats = [current, history];
  const relationshipModel = buildPersonRelationshipModel({ personId: sakshi, chats, events, nowMs: now });
  const results = retrieveContext({
    queryText: currentEvent.text,
    queryVariants: ["Please review this"],
    currentStory: [currentEvent],
    currentTimestampMs: currentEvent.timestampMs,
    currentChat: current,
    targetPersonId: sakshi,
    chats,
    events,
    relationshipModel,
    nowMs: now,
  });
  const precedent = results.find((item) => item.eventId === "translated-history-out");
  assert.ok(precedent);
  assert.equal(precedent.incomingSimilarity, 1);
  assert.equal(precedent.factEligible, false);
  assert.equal(precedent.use, "analogy-only");
});

test("retrieval follows priority order and enforces content-versus-style boundaries", () => {
  const current = chat("chat:current", "Sakshi", "direct", [owner, sakshi]);
  const samePerson = chat("chat:same-person-alias", "Sakshi old connector", "direct", [owner, sakshi]);
  const shared = chat("chat:shared", "Office team", "group", [owner, sakshi, other]);
  const privateGroup = chat("chat:private", "Private leadership", "group", [owner, other]);
  const analogous = chat("chat:analogous", "Client work", "direct", [owner, other]);
  const general = chat("chat:general", "Family", "direct", [owner, other]);
  const chats = [current, samePerson, shared, privateGroup, analogous, general];
  const events = [
    message("current-1", current.id, "contact", "When are you leaving work?", -1_000),
    message("same-1", samePerson.id, "owner", "Office se niklungi", -3_000),
    message("shared-1", shared.id, "contact", "Leaving the office now", -4_000, other),
    message("private-1", privateGroup.id, "contact", "Sakshi secret office departure", -2_000, other),
    message("analogous-1", analogous.id, "owner", "Will leave office after the meeting", -5_000),
    message("general-1", general.id, "owner", "Leaving home bro", -6_000),
  ];
  const relationshipModel = buildPersonRelationshipModel({ personId: sakshi, chats, events, nowMs: now });
  const results = retrieveContext({ queryText: "Leaving work now", currentChat: current, targetPersonId: sakshi, chats, events, relationshipModel, nowMs: now, limit: 20 });
  assert.deepEqual(results.map((item) => item.tier), [
    "current-conversation",
    "shared-group",
    "same-relationship",
    "general-owner-tone",
  ]);
  assert.equal(results.some((item) => item.eventId === "private-1"), false);
  const sharedResult = results.find((item) => item.eventId === "shared-1");
  assert.equal(sharedResult.use, "analogy-only");
  assert.equal(sharedResult.factEligible, false);
  assert.equal(sharedResult.privacy.targetPersonWasParticipant, true);
  assert.equal(results.some((item) => item.eventId === "same-1"), false, "an owner response without a preceding story is not a semantic precedent");
  const analogousResult = results.find((item) => item.eventId === "analogous-1");
  assert.equal(analogousResult.use, "style-only");
  assert.equal(analogousResult.factEligible, false);
  assert.match(analogousResult.text, /^\[Style evidence:/u);
  assert.doesNotMatch(analogousResult.text, /office|meeting/iu);
  const generalResult = results.find((item) => item.eventId === "general-1");
  assert.equal(generalResult.use, "style-only");
  assert.equal(generalResult.factEligible, false);
  assert.doesNotMatch(generalResult.text, /home/iu);
  assert.ok(results.filter((item) => item.tier !== "current-conversation").every((item) => item.factEligible === false));
});

test("semantic retrieval distinguishes identical final messages by their bounded preceding stories", () => {
  const current = chat("chat:current-story", "Sakshi", "direct", [owner, sakshi]);
  const invoiceHistory = chat("chat:invoice-history", "Sakshi billing", "direct", [owner, sakshi]);
  const dinnerHistory = chat("chat:dinner-history", "Sakshi dinner", "direct", [owner, sakshi]);
  const currentEvents = [
    message("current-context", current.id, "contact", "The invoice total is wrong", -2_000),
    message("current-final", current.id, "contact", "What should we do?", -1_000),
  ];
  const events = [
    ...currentEvents,
    message("invoice-context", invoiceHistory.id, "contact", "The invoice total is wrong", -20_000),
    message("invoice-final", invoiceHistory.id, "contact", "What should we do?", -19_000),
    message("invoice-reply", invoiceHistory.id, "owner", "Let's verify the amount", -18_500),
    message("dinner-context", dinnerHistory.id, "contact", "The dinner venue is unavailable", -18_000),
    message("dinner-final", dinnerHistory.id, "contact", "What should we do?", -17_000),
    message("dinner-reply", dinnerHistory.id, "owner", "Let's choose another restaurant", -16_500),
    message("future-invoice", invoiceHistory.id, "contact", "The invoice total is wrong and needs correction", 5_000),
  ];
  const chats = [current, invoiceHistory, dinnerHistory];
  const relationshipModel = buildPersonRelationshipModel({ personId: sakshi, chats, events, nowMs: now });
  const results = retrieveContext({
    queryText: "What should we do?",
    currentStory: currentEvents,
    currentTimestampMs: now - 1_000,
    currentChat: current,
    targetPersonId: sakshi,
    chats,
    events,
    relationshipModel,
    nowMs: now,
    limit: 20,
  });
  const invoice = results.find((item) => item.eventId === "invoice-reply");
  const dinner = results.find((item) => item.eventId === "dinner-reply");
  assert.ok(invoice && dinner);
  assert.ok(invoice.similarity > dinner.similarity, `${invoice.similarity} should exceed ${dinner.similarity}`);
  assert.ok(results.indexOf(invoice) < results.indexOf(dinner));
  assert.equal(results.some((item) => item.eventId === "future-invoice"), false);
  assert.equal(invoice.use, "analogy-only");
  assert.equal(invoice.factEligible, false);
  assert.ok(invoice.incomingSimilarity > 0);
  assert.ok(invoice.precedingStorySimilarity > dinner.precedingStorySimilarity);
  assert.ok(invoice.wholeStorySimilarity > dinner.wholeStorySimilarity);
  assert.equal(invoice.intentMatched, true);
  assert.equal(invoice.responseAct, "information");
});

test("semantic plan reliability admits one near-identical exact-person precedent", () => {
  const current = chat("chat:current-plan", "Sakshi", "direct", [owner, sakshi]);
  const history = chat("chat:history-plan", "Sakshi history", "direct", [owner, sakshi]);
  const currentEvent = message("current-plan", current.id, "contact", "Please check the invoice total", -1_000);
  const events = [
    currentEvent,
    message("history-plan-in", history.id, "contact", "Please check the invoice total", -10_000),
    message("history-plan-out", history.id, "owner", "I will check and update you", -9_000),
  ];
  const chats = [current, history];
  const relationshipModel = buildPersonRelationshipModel({ personId: sakshi, chats, events, nowMs: now });
  const results = retrieveContext({
    queryText: currentEvent.text,
    currentStory: [currentEvent],
    currentTimestampMs: currentEvent.timestampMs,
    currentChat: current,
    targetPersonId: sakshi,
    chats,
    events,
    relationshipModel,
    nowMs: now,
  });
  const precedent = results.find((item) => item.eventId === "history-plan-out");
  assert.ok(precedent);
  assert.equal(precedent.tier, "same-person");
  assert.equal(precedent.planProbability, 1);
  assert.ok(precedent.effectiveSampleSize >= 2);
  assert.ok(precedent.reliability >= 0.4);
  assert.equal(precedent.factEligible, false);
});

test("contradictory exact-person precedents split their response-plan posterior and fail closed", () => {
  const current = chat("chat:current-conflict", "Sakshi", "direct", [owner, sakshi]);
  const first = chat("chat:first-conflict", "Sakshi first", "direct", [owner, sakshi]);
  const second = chat("chat:second-conflict", "Sakshi second", "direct", [owner, sakshi]);
  const currentEvent = message("current-conflict", current.id, "contact", "Please check the invoice total", -1_000);
  const events = [
    currentEvent,
    message("first-conflict-in", first.id, "contact", "Please check the invoice total", -12_000),
    message("first-conflict-out", first.id, "owner", "I will check and update you", -11_000),
    message("second-conflict-in", second.id, "contact", "Please check the invoice total", -10_000),
    message("second-conflict-out", second.id, "owner", "Can you send the invoice copy?", -9_000),
  ];
  const chats = [current, first, second];
  const relationshipModel = buildPersonRelationshipModel({ personId: sakshi, chats, events, nowMs: now });
  const results = retrieveContext({
    queryText: currentEvent.text,
    currentStory: [currentEvent],
    currentTimestampMs: currentEvent.timestampMs,
    currentChat: current,
    targetPersonId: sakshi,
    chats,
    events,
    relationshipModel,
    nowMs: now,
  });
  const precedents = results.filter((item) => item.direction === "owner" && item.tier === "same-person");
  assert.equal(precedents.length, 2);
  assert.ok(precedents.every((item) => item.planProbability === 0.5));
  assert.ok(precedents.every((item) => item.reliability < 0.4));
  assert.ok(precedents.every((item) => item.factEligible === false));
});

test("cross-chat credentials are excluded and current credentials are redacted", () => {
  const current = chat("chat:current", "Sakshi", "direct", [owner, sakshi]);
  const samePerson = chat("chat:old", "Sakshi old", "direct", [owner, sakshi]);
  const events = [
    message("current-secret", current.id, "contact", "OTP 123456", -1_000),
    message("old-secret", samePerson.id, "owner", "Password is hunter2", -2_000),
  ];
  const model = buildPersonRelationshipModel({ personId: sakshi, chats: [current, samePerson], events, nowMs: now });
  const results = retrieveContext({ queryText: "OTP password", currentChat: current, targetPersonId: sakshi, chats: [current, samePerson], events, relationshipModel: model, nowMs: now });
  assert.equal(results.some((item) => item.eventId === "old-secret"), false);
  const currentResult = results.find((item) => item.eventId === "current-secret");
  assert.ok(currentResult);
  assert.match(currentResult.text, /Sensitive value redacted/u);
  assert.equal(currentResult.factEligible, false);
  assert.equal(currentResult.privacy.sensitiveValueRedacted, true);
});
