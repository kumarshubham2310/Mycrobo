import { writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";

import { presentChats } from "../apps/client/chat-presentation.mjs";
import { classifyIncomingIntent } from "../packages/core/behavioral-dna.ts";
import { buildDraftContext } from "../packages/core/draft.ts";
import { buildChatRelationshipProfile } from "../packages/core/relationship.ts";
import {
  canonicalHistoricalLanguage,
  evaluateHistoricalDraft,
  historicalFormalityBand,
  historicalLengthBucket,
  privateForeignFingerprints,
} from "../packages/core/conversation-backtest.ts";
import { createLocalDraftProvider } from "../services/gateway/draft-provider.mjs";
import {
  contentFreeDatasetRevision,
  contentFreeCaseBinding,
  createHistoricalEvidenceIndex,
  implementationRevision,
  loadContentFreeCheckpoint,
  resolveAuditChatScope,
  selectFrozenItems,
  selectFrozenStratifiedCases,
  writeContentFreeCheckpoint,
  validateContentFreeResultPrefix,
} from "./backtest-tooling.mjs";

const require = createRequire(import.meta.url);
const cdpUrl = process.env.MYCROBO_BACKTEST_CDP || "http://127.0.0.1:9227";
const directGatewayUrl = String(process.env.MYCROBO_BACKTEST_GATEWAY_URL || "").replace(/\/$/u, "");
const directGatewayToken = String(process.env.MYCROBO_BACKTEST_GATEWAY_TOKEN || "");
const directWindowToken = String(process.env.MYCROBO_BACKTEST_WINDOW_TOKEN || "");
const chromium = directGatewayUrl ? null : require("playwright").chromium;
const reportPath = resolve(process.env.MYCROBO_BACKTEST_REPORT || "docs/CLONING_BACKTEST_ALPHA12.json");
const checkpointPath = resolve(process.env.MYCROBO_BACKTEST_CHECKPOINT || `${reportPath}.checkpoint.json`);
const resumeCheckpoint = !["0", "false", "no"].includes(String(process.env.MYCROBO_BACKTEST_RESUME || "true").toLowerCase());
const checkpointEvery = Math.max(1, Math.min(100, Number(process.env.MYCROBO_BACKTEST_CHECKPOINT_EVERY || 5)));
// `MYCROBO_BACKTEST_CHATS=all` audits every active chat made available by the
// connector. Archived chats are always included separately below. The default
// remains a bounded development sample because all-history audits are lengthy.
const auditChatScope = resolveAuditChatScope(process.env.MYCROBO_BACKTEST_CHATS || "150");
const maximumChats = auditChatScope.maximumChats;
const maximumMessagesPerChat = Math.max(100, Math.min(50_000, Number(process.env.MYCROBO_BACKTEST_MESSAGES || 10_000)));
// Small live smoke samples are valid when the caller explicitly requests
// them; full release runs can still select up to 1,200 chronological holdouts.
const maximumCases = Math.max(20, Math.min(1_200, Number(process.env.MYCROBO_BACKTEST_CASES || 800)));
const auditPartition = String(process.env.MYCROBO_BACKTEST_PARTITION || "evaluation").toLowerCase() === "calibration"
  ? "calibration"
  : "evaluation";
const samplingSeed = "mycrobo-frozen-stratified-holdout-v1";
const selectionSeed = String(process.env.MYCROBO_BACKTEST_SELECTION_SEED || samplingSeed);
const caseOffset = Math.max(0, Math.min(10_000, Number(process.env.MYCROBO_BACKTEST_CASE_OFFSET || 0)));
const replyBurstGapMs = 5 * 60 * 1_000;
const maximumReplyDelayMs = 6 * 60 * 60 * 1_000;

function round(value, digits = 3) {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}

function ratio(numerator, denominator) {
  return denominator ? round(numerator / denominator) : 0;
}

function wilson95(values) {
  const n = values.length;
  if (!n) return { observed: 0, low: 0, high: 0, cases: 0 };
  const successes = values.filter(Boolean).length;
  const p = successes / n;
  const z = 1.959964;
  const denominator = 1 + z ** 2 / n;
  const centre = (p + z ** 2 / (2 * n)) / denominator;
  const half = z * Math.sqrt((p * (1 - p) + z ** 2 / (4 * n)) / n) / denominator;
  return { observed: round(p), low: round(Math.max(0, centre - half)), high: round(Math.min(1, centre + half)), cases: n };
}

function macroF1(values, predictedKey, actualKey) {
  const labels = [...new Set(values.flatMap((value) => [value[predictedKey], value[actualKey]]).filter(Boolean))].sort();
  if (!labels.length) return { score: 0, labels: {} };
  const byLabel = Object.fromEntries(labels.map((label) => {
    const truePositive = values.filter((value) => value[predictedKey] === label && value[actualKey] === label).length;
    const falsePositive = values.filter((value) => value[predictedKey] === label && value[actualKey] !== label).length;
    const falseNegative = values.filter((value) => value[predictedKey] !== label && value[actualKey] === label).length;
    const precision = truePositive / Math.max(1, truePositive + falsePositive);
    const recall = truePositive / Math.max(1, truePositive + falseNegative);
    const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
    return [label, { precision: round(precision), recall: round(recall), f1: round(f1), support: truePositive + falseNegative }];
  }));
  return { score: round(Object.values(byLabel).reduce((sum, value) => sum + value.f1, 0) / labels.length), labels: byLabel };
}

const GENERIC_DRAFT = /^(?:haan+|ha+|okay+|ok+|hmm+|thee?k|thik|got it|noted|thanks(?: for (?:sharing|letting me know))?)[\s.!👍🙂😊]*$/iu;

function privateDraftFingerprint(value) {
  const normalized = String(value || "").normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return createHash("sha256").update(normalized).digest("hex");
}

function errorCategory(error) {
  const message = String(error instanceof Error ? error.message : error || "");
  if (/No candidate passed/iu.test(message)) return "candidate-evaluator-rejection";
  if (/latest incoming message|verified target/iu.test(message)) return "target-verification";
  if (/No reply|already answered|reply is not required/iu.test(message)) return "reply-necessity";
  if (/history|watermark|message target/iu.test(message)) return "history-or-target";
  return "other-generation-error";
}

function evaluatorReasonCode(value) {
  const reason = String(value || "").toLocaleLowerCase();
  const rules = [
    [/credential/u, "credential-material"],
    [/generic assistant/u, "assistant-language"],
    [/replays content/u, "historical-content-replay"],
    [/affectionate/u, "affection-generic-ack"],
    [/concrete action/u, "action-generic-ack"],
    [/stock acknowledgement/u, "stock-acknowledgement"],
    [/outside the retrieved story/u, "foreign-evidence"],
    [/current fact is missing/u, "missing-current-fact"],
    [/current commitment/u, "invented-current-commitment"],
    [/introduces a number/u, "invented-number"],
    [/current time reference/u, "invented-time-reference"],
    [/latest target/u, "missing-target-evidence"],
    [/observed reply length/u, "reply-length-mismatch"],
    [/location/u, "unsupported-location"],
    [/availability/u, "unsupported-availability"],
    [/approv/u, "unsupported-approval"],
    [/payment/u, "unsupported-payment"],
    [/(?:delivery|completion|status)/u, "unsupported-status"],
    [/relationship/u, "unsupported-relationship"],
    [/valid candidate/u, "no-valid-candidate"],
  ];
  return rules.find(([pattern]) => pattern.test(reason))?.[1] || "other-evaluator-rejection";
}

function evaluatorShapeCode(value) {
  const normalized = String(value || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9:+_-]{0,79}$/u.test(normalized) ? normalized : "invalid-shape";
}

function canonicalMode(value) {
  if (["Hindi", "Roman Hindi"].includes(String(value || ""))) return "Roman Hindi";
  if (["Gujarati", "Roman Gujarati"].includes(String(value || ""))) return "Roman Gujarati";
  if (String(value || "") === "Mixed") return "Mixed";
  return "English";
}

function dominantMode(bucket) {
  const item = [...(Array.isArray(bucket?.writingModes) ? bucket.writingModes : [])]
    .sort((left, right) => Number(right?.count || 0) - Number(left?.count || 0))[0];
  return item ? canonicalMode(item.mode) : null;
}

function transitionMode(bucket, incomingMode) {
  const transition = (Array.isArray(bucket?.replyModesByIncomingMode) ? bucket.replyModesByIncomingMode : [])
    .find((item) => canonicalMode(item?.incomingMode) === incomingMode);
  const item = [...(Array.isArray(transition?.replyModes) ? transition.replyModes : [])]
    .sort((left, right) => Number(right?.count || 0) - Number(left?.count || 0))[0];
  return item ? canonicalMode(item.mode) : null;
}

function dominantLength(bucket) {
  return [...(Array.isArray(bucket?.lengthBuckets) ? bucket.lengthBuckets : [])]
    .sort((left, right) => Number(right?.count || 0) - Number(left?.count || 0))[0]?.bucket || null;
}

function behavioralFormality(bucket) {
  const formal = Number(bucket?.formalRate || 0);
  const casual = Number(bucket?.casualRate || 0);
  if (formal >= 0.25 && formal > casual * 1.2) return "formal";
  if (casual >= 0.25 && casual > formal * 1.2) return "casual";
  return "neutral";
}

function usableMessage(event) {
  return event && event.kind === "text" && typeof event.text === "string" && event.text.trim() && event.timestampVerified && Number.isFinite(event.timestampMs);
}

function orderedHuman(events) {
  return events.filter(usableMessage).sort((left, right) => left.timestampMs - right.timestampMs || Number(left.sequence || 0) - Number(right.sequence || 0));
}

function historicalCases(chat, events) {
  const human = orderedHuman(events);
  const cases = [];
  let previousOwnerCount = 0;
  for (let index = 0; index < human.length - 1; index += 1) {
    if (human[index].direction === "owner") {
      previousOwnerCount += 1;
      continue;
    }
    if (human[index].direction !== "contact" || human[index + 1].direction !== "owner") continue;
    const target = human[index];
    const firstOwner = human[index + 1];
    if (firstOwner.timestampMs - target.timestampMs > maximumReplyDelayMs) continue;
    if (previousOwnerCount < 4) continue;
    const reply = [firstOwner];
    let cursor = index + 2;
    while (cursor < human.length && human[cursor].direction === "owner" && human[cursor].timestampMs - reply.at(-1).timestampMs <= replyBurstGapMs) {
      reply.push(human[cursor]);
      cursor += 1;
    }
    cases.push({
      chat,
      events: human,
      sampleSplitKey: chat.participantIds.filter((participantId) => participantId !== "owner").sort().join("|") || chat.id,
      targetIndex: index,
      target,
      actualReply: reply.map((event) => event.text).join("\n"),
      sampleTraits: {
        archiveState: chat.auditArchived === true ? "archived" : "active",
        language: canonicalHistoricalLanguage(target.text),
        incomingIntent: classifyIncomingIntent(target.text),
        historyDepth: previousOwnerCount >= 25 ? "deep" : previousOwnerCount >= 10 ? "established" : "emerging",
        // Sampling may use only evidence already visible at this holdout. The
        // bounded prefix prevents future leakage without making discovery
        // quadratic on very long chats.
        relationship: buildChatRelationshipProfile(chat, human.slice(Math.max(0, index - 199), index + 1)).scenarioRelationship,
      },
    });
  }
  return cases;
}

async function apiGet(page, path) {
  if (directGatewayUrl) {
    const response = await fetch(`${directGatewayUrl}${path}`, {
      cache: "no-store",
      headers: {
        authorization: `Bearer ${directGatewayToken}`,
        "x-mycrobo-window": directWindowToken,
      },
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(`Local API ${response.status}`);
    return payload;
  }
  return page.evaluate(async (endpoint) => {
    const response = await fetch(endpoint, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(`Local API ${response.status}`);
    return payload;
  }, path);
}

async function historyFor(page, chat) {
  const messages = [];
  let before = "";
  let watermark = null;
  while (messages.length < maximumMessagesPerChat) {
    const suffix = before ? `&before=${encodeURIComponent(before)}` : "";
    const pageResult = await apiGet(page, `/api/v1/chats/${encodeURIComponent(chat.id)}/messages?limit=200${suffix}`);
    watermark = pageResult.watermark || watermark;
    const incoming = Array.isArray(pageResult.messages) ? pageResult.messages : [];
    const known = new Set(messages.map((message) => message.id));
    messages.push(...incoming.filter((message) => !known.has(message.id)));
    if (!pageResult.nextBefore || !incoming.length || pageResult.nextBefore === before) break;
    before = pageResult.nextBefore;
  }
  return { events: orderedHuman(messages).slice(-maximumMessagesPerChat), watermark };
}

const browser = directGatewayUrl ? null : await chromium.connectOverCDP(cdpUrl);
try {
  const page = directGatewayUrl ? null : browser.contexts().flatMap((context) => context.pages()).find((candidate) => /^http:\/\/127\.0\.0\.1:\d+\/?$/u.test(candidate.url()));
  if (!directGatewayUrl && !page) throw new Error("The running MyCrobo page was not found on the local evaluation channel.");
  const [activePayload, archivedPayload] = await Promise.all([
    apiGet(page, "/api/v1/chats?collection=active"),
    apiGet(page, "/api/v1/chats?collection=archived"),
  ]);
  const visibleActiveChats = presentChats(activePayload.chats || []).map((chat) => ({ ...chat, auditArchived: false }));
  const visibleArchivedChats = presentChats(archivedPayload.chats || []).map((chat) => ({ ...chat, auditArchived: true }));
  const discovered = [...visibleActiveChats, ...visibleArchivedChats]
    .filter((chat, index, values) => chat?.id && values.findIndex((candidate) => candidate?.id === chat.id) === index);
  const activeChatSample = selectFrozenItems(visibleActiveChats.filter((chat) => chat.latest?.id), {
    maximum: maximumChats,
    seed: `${samplingSeed}:active-chats`,
    keyOf: (chat) => chat.id,
  });
  const selectedActiveChats = activeChatSample.selected;
  const selectedArchivedChats = visibleArchivedChats.filter((chat) => chat.latest?.id);
  const selectedChats = [...selectedActiveChats, ...selectedArchivedChats]
    .filter((chat, index, values) => values.findIndex((candidate) => candidate.id === chat.id) === index)
    .sort((left, right) => Number(right.latest?.timestampMs || 0) - Number(left.latest?.timestampMs || 0));
  const auditIdByChatId = new Map(selectedChats.map((chat, index) => [chat.id, `chat-${String(index + 1).padStart(3, "0")}`]));

  const histories = [];
  const historyErrors = [];
  for (const chat of selectedChats) {
    try {
      const history = await historyFor(page, chat);
      histories.push({ chat, auditId: auditIdByChatId.get(chat.id), ...history });
    } catch (error) {
      historyErrors.push({ auditId: auditIdByChatId.get(chat.id), category: errorCategory(error) });
    }
  }
  const evaluationHistories = histories.filter((history) => history.chat.kind === "direct" && history.events.length >= 12);
  const allEvents = evaluationHistories.flatMap((history) => history.events);
  const candidateCases = evaluationHistories.flatMap((history) => historicalCases(history.chat, history.events)
    .map((item) => ({ ...item, auditId: history.auditId })));
  const stratifiedSample = selectFrozenStratifiedCases(candidateCases, {
    maximumCases,
    partition: auditPartition,
    seed: samplingSeed,
    selectionSeed,
    offsetCases: caseOffset,
  });
  const cases = stratifiedSample.selected
    // Evaluate the identical selected holdouts in global chronological order.
    // The evidence universe then grows monotonically, which exercises the
    // production phrase bank's append-only fast path without ever exposing a
    // reply or event from after the historical target.
    .sort((left, right) => left.target.timestampMs - right.target.timestampMs
      || left.chat.id.localeCompare(right.chat.id)
      || left.target.id.localeCompare(right.target.id));
  const caseBindings = cases.map(contentFreeCaseBinding);
  const evidenceIndexStartedAt = performance.now();
  const evidenceIndex = createHistoricalEvidenceIndex(allEvents);
  const evidenceIndexBuildMs = Math.round(performance.now() - evidenceIndexStartedAt);
  const pipelineRevision = await implementationRevision([
    new URL(import.meta.url),
    new URL("../packages/core/draft.ts", import.meta.url),
    new URL("../packages/core/candidates.ts", import.meta.url),
    new URL("../packages/core/conversation-backtest.ts", import.meta.url),
    new URL("../packages/core/phrase-bank.ts", import.meta.url),
    new URL("../packages/core/scenario-forest.ts", import.meta.url),
    new URL("../packages/core/style-policy.ts", import.meta.url),
    new URL("../services/gateway/draft-provider.mjs", import.meta.url),
  ]);
  const datasetRevision = contentFreeDatasetRevision({
    implementationRevision: pipelineRevision,
    settings: {
      maximumChats,
      auditChatScope: auditChatScope.mode,
      maximumMessagesPerChat,
      maximumCases,
      replyBurstGapMs,
      maximumReplyDelayMs,
      auditPartition,
      samplingSeed,
      selectionSeed,
      caseOffset,
      sampleManifestHash: stratifiedSample.manifest.manifestHash,
      activeChatSampleHash: activeChatSample.manifestHash,
    },
    cases,
    events: allEvents,
  });
  const provider = createLocalDraftProvider();
  const runStartedAt = performance.now();
  const results = resumeCheckpoint
    ? await loadContentFreeCheckpoint(checkpointPath, datasetRevision, caseBindings)
    : [];
  const resumedCases = results.length;
  let lastCheckpointAt = performance.now();

  const persistProgress = async (force = false) => {
    const now = performance.now();
    if (!force && results.length % checkpointEvery !== 0 && now - lastCheckpointAt < 30_000) return;
    const elapsedMs = Math.round(now - runStartedAt);
    await writeContentFreeCheckpoint(checkpointPath, datasetRevision, results, { totalCases: cases.length, elapsedMs }, caseBindings);
    lastCheckpointAt = now;
    const completedThisRun = Math.max(0, results.length - resumedCases);
    const meanCaseMs = completedThisRun ? elapsedMs / completedThisRun : 0;
    process.stderr.write(`${JSON.stringify({
      type: "mycrobo-backtest-progress",
      completedCases: results.length,
      totalCases: cases.length,
      resumedCases,
      elapsedMs,
      estimatedRemainingMs: meanCaseMs ? Math.round(meanCaseMs * Math.max(0, cases.length - results.length)) : null,
      rawContentIncluded: false,
      outboundMessages: 0,
    })}\n`);
  };

  for (let caseIndex = resumedCases; caseIndex < cases.length; caseIndex += 1) {
    const item = cases[caseIndex];
    // Slice by canonical order, not by timestamp. Messages can share the same
    // timestamp; a <= timestamp filter could accidentally reveal the held-out
    // owner reply to the model or make it look like the latest message.
    const prefix = item.events.slice(0, item.targetIndex + 1);
    const historicalUniverse = [
      ...evidenceIndex.eventsStrictlyBefore(item.target.timestampMs, item.chat.id),
      ...prefix,
    ];
    const watermark = {
      chatId: item.chat.id,
      state: "partial",
      reachedBeginning: false,
      oldestTimestampMs: prefix[0]?.timestampMs || item.target.timestampMs,
      newestTimestampMs: item.target.timestampMs,
      messageCount: prefix.length,
      cursor: null,
      reason: "historical-holdout",
      verifiedAt: new Date(item.target.timestampMs).toISOString(),
    };
    let context;
    try {
      const contextInput = {
        chat: item.chat,
        chatEvents: prefix,
        allEvents: historicalUniverse,
        allChats: selectedChats,
        watermark,
        ownerIds: ["owner"],
        expectedTargetMessageId: item.target.id,
        draftAnyway: true,
        nowMs: item.target.timestampMs + 1,
      };
      context = buildDraftContext(contextInput);
      const personalized = await provider.generate(context);
      const accountBaselineContext = buildDraftContext({ ...contextInput, learningAblation: "account-baseline" });
      const neutralContext = buildDraftContext({ ...contextInput, learningAblation: "neutral" });
      const accountBaseline = await provider.generate(accountBaselineContext);
      const neutral = await provider.generate(neutralContext);
      const evaluationInput = {
        actual: item.actualReply,
        targetText: context.currentIncomingTurn?.text || item.target.text,
        storyTexts: context.story.map((event) => event.text),
        storyIds: context.story.map((event) => event.id),
        requiresCurrentFact: context.safety.requiresCurrentFact,
        foreignFingerprints: privateForeignFingerprints(historicalUniverse, item.chat.id),
      };
      const personalizedEvaluation = evaluateHistoricalDraft({
        ...evaluationInput,
        predicted: personalized.draft,
        evidenceIds: personalized.evidenceIds || [],
      });
      const accountBaselineEvaluation = evaluateHistoricalDraft({
        ...evaluationInput,
        predicted: accountBaseline.draft,
        evidenceIds: accountBaseline.evidenceIds || [],
      });
      const neutralEvaluation = evaluateHistoricalDraft({
        ...evaluationInput,
        predicted: neutral.draft,
        evidenceIds: neutral.evidenceIds || [],
      });
      const activeDNASamples = Number(context.relationship?.behavioralDNA?.active?.sampleCount || 0);
      const dnaEvidenceTier = activeDNASamples >= 4 ? "active-4+" : activeDNASamples >= 2 ? "active-2-3" : activeDNASamples === 1 ? "active-1" : "global-only";
      const targetMode = canonicalHistoricalLanguage(evaluationInput.targetText);
      const targetFormality = historicalFormalityBand(evaluationInput.targetText);
      const targetLength = historicalLengthBucket(evaluationInput.targetText);
      const personDNA = context.relationship?.behavioralDNA;
      const profileDNA = context.relationship?.similarProfile?.behavioralDNA;
      const accountDNA = context.relationship?.ownerGlobalBehavioralDNA;
      const effectiveDNA = Number(personDNA?.active?.sampleCount || 0) >= 2
        ? personDNA
        : Number(profileDNA?.active?.sampleCount || 0) > 0
          ? profileDNA
          : Number(accountDNA?.active?.sampleCount || 0) > 0
            ? accountDNA
            : personDNA || accountDNA || profileDNA;
      const effectiveActive = effectiveDNA?.active?.sampleCount ? effectiveDNA.active : effectiveDNA?.global;
      results.push({
        ...contentFreeCaseBinding(item),
        chatAuditId: item.auditId,
        relationship: context.relationship.profile.scenarioRelationship,
        scenarioCode: context.relationship?.behavioralDNA?.activeScenario?.code || "unknown",
        toneStage: context.tone.stage,
        intent: personalized.intent || "unknown",
        predictedAct: personalizedEvaluation.predictedAct,
        actualAct: personalizedEvaluation.actualActs[0] || "unknown",
        actualActs: personalizedEvaluation.actualActs,
        behaviorCompatible: personalizedEvaluation.metrics.intent,
        rawSingleReferenceIntent: personalizedEvaluation.rawSingleReferenceIntent,
        answerableIntent: personalizedEvaluation.answerableIntent,
        safeAbstention: personalizedEvaluation.safeAbstention,
        accepted: personalizedEvaluation.accepted,
        conversationScore: personalizedEvaluation.score,
        accountBaselineScore: accountBaselineEvaluation.score,
        neutralScore: neutralEvaluation.score,
        metrics: personalizedEvaluation.metrics,
        predictedMode: personalizedEvaluation.predictedLanguage,
        actualMode: personalizedEvaluation.actualLanguage,
        targetMode,
        languageStrategies: {
          incomingMirror: targetMode,
          activeDominant: dominantMode(effectiveActive),
          activeTransition: transitionMode(effectiveActive, targetMode),
          globalDominant: dominantMode(effectiveDNA?.global),
          globalTransition: transitionMode(effectiveDNA?.global, targetMode),
        },
        predictedLength: personalizedEvaluation.predictedLength,
        actualLength: personalizedEvaluation.actualLength,
        targetLength,
        lengthStrategies: {
          incomingMirror: targetLength,
          activeDominant: dominantLength(effectiveActive),
          activeMedian: Number(effectiveActive?.medianCharacters || 0) > 0 ? historicalLengthBucket("x".repeat(Number(effectiveActive.medianCharacters))) : null,
          globalDominant: dominantLength(effectiveDNA?.global),
          globalMedian: Number(effectiveDNA?.global?.medianCharacters || 0) > 0 ? historicalLengthBucket("x".repeat(Number(effectiveDNA.global.medianCharacters))) : null,
        },
        predictedWarmth: personalizedEvaluation.predictedWarmth,
        actualWarmth: personalizedEvaluation.actualWarmth,
        predictedFormality: personalizedEvaluation.predictedFormality,
        actualFormality: personalizedEvaluation.actualFormality,
        targetFormality,
        formalityStrategies: {
          incomingMirror: targetFormality,
          activeBehavior: behavioralFormality(effectiveActive),
          globalBehavior: behavioralFormality(effectiveDNA?.global),
        },
        predictedEmoji: personalizedEvaluation.predictedEmoji,
        actualEmoji: personalizedEvaluation.actualEmoji,
        dnaEvidenceTier,
        requiredFacts: [...(context.safety.requiredFacts || [])].sort().join("+") || "none",
        safeFactHandling: personalizedEvaluation.metrics.commitmentSafety,
        privateDraftFingerprint: privateDraftFingerprint(personalized.draft),
        genericDraft: GENERIC_DRAFT.test(String(personalized.draft || "").trim()),
      });
    } catch (error) {
      results.push({
        ...contentFreeCaseBinding(item),
        chatAuditId: item.auditId,
        relationship: context?.relationship?.profile?.scenarioRelationship || "unknown",
        scenarioCode: context?.relationship?.behavioralDNA?.activeScenario?.code || "unknown",
        toneStage: context?.tone?.stage || "unknown",
        intent: context?.relationship?.behavioralDNA?.activeIntent || "generation-error",
        errorCategory: errorCategory(error),
        evaluationReasons: Array.isArray(error?.evaluationReasons) ? [...new Set(error.evaluationReasons.map(evaluatorReasonCode))] : [],
        evaluationBlockingReasons: Array.isArray(error?.evaluationBlockingReasons) ? [...new Set(error.evaluationBlockingReasons.map(evaluatorReasonCode))] : [],
        evaluationCandidateShapes: Array.isArray(error?.evaluationCandidateShapes) ? error.evaluationCandidateShapes.map(evaluatorShapeCode) : [],
        requiredFacts: [...(context?.safety?.requiredFacts || [])].sort().join("+") || "unknown",
        generationError: true,
        behaviorCompatible: false,
        rawSingleReferenceIntent: false,
        answerableIntent: false,
        safeAbstention: false,
        accepted: false,
        conversationScore: 0,
        accountBaselineScore: 0,
        neutralScore: 0,
        metrics: {
          intent: false,
          language: false,
          brevity: false,
          warmth: false,
          formality: false,
          emojiBehavior: false,
          commitmentSafety: false,
          storyUnderstanding: false,
          crossContactLeakage: false,
        },
        safeFactHandling: false,
      });
    }
    await persistProgress(caseIndex === cases.length - 1);
  }

  const metricNames = ["intent", "language", "brevity", "warmth", "formality", "emojiBehavior", "commitmentSafety", "storyUnderstanding", "crossContactLeakage"];
  const metricThresholds = {
    intent: 0.8,
    language: 0.85,
    brevity: 0.8,
    warmth: 0.8,
    formality: 0.8,
    emojiBehavior: 0.9,
    commitmentSafety: 1,
    storyUnderstanding: 0.95,
    crossContactLeakage: 1,
  };
  const metricRates = (subset) => Object.fromEntries(metricNames.map((metric) => [metric, ratio(subset.filter((result) => result.metrics?.[metric]).length, subset.length)]));
  const byDimension = (key) => Object.fromEntries([...new Set(results.map((result) => result[key]))].sort().map((value) => {
    const subset = results.filter((result) => result[key] === value);
    const generatedSubset = subset.filter((result) => !result.generationError);
    return [value, {
      cases: subset.length,
      generationCompletion: ratio(generatedSubset.length, subset.length),
      strictAcceptance: ratio(generatedSubset.filter((result) => result.accepted).length, subset.length),
      averageConversationScore: round(generatedSubset.reduce((sum, result) => sum + result.conversationScore, 0) / Math.max(1, generatedSubset.length), 1),
      ownerPersonalizationLift: round(generatedSubset.reduce((sum, result) => sum + result.conversationScore - result.neutralScore, 0) / Math.max(1, generatedSubset.length), 1),
      relationshipSpecificLift: round(generatedSubset.reduce((sum, result) => sum + result.conversationScore - result.accountBaselineScore, 0) / Math.max(1, generatedSubset.length), 1),
      metricPassRates: metricRates(generatedSubset),
    }];
  }));
  const counts = (values) => Object.fromEntries([...new Set(values)].sort().map((value) => [value, values.filter((item) => item === value).length]));
  const generated = results.filter((result) => !result.generationError);
  const perChatBehavior = Object.fromEntries([...new Set(results.map((result) => result.chatAuditId))].sort().map((auditId) => {
    const subset = results.filter((result) => result.chatAuditId === auditId);
    const completed = subset.filter((result) => !result.generationError);
    return [auditId, {
      holdoutCases: subset.length,
      generationCompletion: ratio(completed.length, subset.length),
      strictAcceptance: ratio(completed.filter((result) => result.accepted).length, subset.length),
      averageConversationScore: round(completed.reduce((sum, result) => sum + result.conversationScore, 0) / Math.max(1, completed.length), 1),
      scenarioCells: counts(completed.map((result) => result.scenarioCode || "unknown")),
      actualResponseActs: counts(completed.map((result) => result.actualAct || "unknown")),
      predictedToActualActs: counts(completed.map((result) => `${result.predictedAct || "unknown"}->${result.actualAct || "unknown"}`)),
      actualWritingModes: counts(completed.map((result) => result.actualMode || "unknown")),
      predictedToActualWritingModes: counts(completed.map((result) => `${result.predictedMode || "unknown"}->${result.actualMode || "unknown"}`)),
      actualLengthBuckets: counts(completed.map((result) => result.actualLength || "unknown")),
      predictedToActualLengthBuckets: counts(completed.map((result) => `${result.predictedLength || "unknown"}->${result.actualLength || "unknown"}`)),
      actualFormality: counts(completed.map((result) => result.actualFormality || "unknown")),
      predictedToActualFormality: counts(completed.map((result) => `${result.predictedFormality || "unknown"}->${result.actualFormality || "unknown"}`)),
      failedDimensions: counts(completed.flatMap((result) => metricNames.filter((metric) => !result.metrics?.[metric]))),
    }];
  }));
  const strategyRate = (family, compatible) => {
    const names = [...new Set(generated.flatMap((result) => Object.keys(result[family] || {})))].sort();
    return Object.fromEntries(names.map((name) => {
      const applicable = generated.filter((result) => result[family]?.[name]);
      return [name, {
        cases: applicable.length,
        passRate: ratio(applicable.filter((result) => compatible(result[family][name], result)).length, applicable.length),
      }];
    }));
  };
  const aggregateMetricRates = metricRates(generated);
  const answerable = generated.filter((result) => result.answerableIntent !== null);
  const intentQuality = {
    rawSingleReferenceAgreement: wilson95(generated.map((result) => result.rawSingleReferenceIntent === true)),
    compatibleAnswerableIntent: wilson95(answerable.map((result) => result.answerableIntent === true)),
    safeAbstention: {
      cases: generated.filter((result) => result.safeAbstention).length,
      rateAmongAll: ratio(generated.filter((result) => result.safeAbstention).length, generated.length),
    },
  };
  const classificationQuality = {
    languageMacroF1: macroF1(generated, "predictedMode", "actualMode"),
    formalityMacroF1: macroF1(generated, "predictedFormality", "actualFormality"),
    emojiMacroF1: macroF1(generated, "predictedEmoji", "actualEmoji"),
  };
  const metricConfidence95 = Object.fromEntries(metricNames.map((metric) => [metric, wilson95(generated.map((result) => result.metrics?.[metric] === true))]));
  const draftFingerprintCounts = counts(generated.map((result) => result.privateDraftFingerprint || "missing"));
  const distinctDrafts = Object.keys(draftFingerprintCounts).filter((value) => value !== "missing").length;
  const mostRepeatedDraftCount = Math.max(0, ...Object.values(draftFingerprintCounts));
  const systemicFailures = metricNames
    .filter((metric) => aggregateMetricRates[metric] < metricThresholds[metric])
    .map((metric) => ({
      dimension: metric,
      observed: aggregateMetricRates[metric],
      required: metricThresholds[metric],
      architecturalRegressionRequired: true,
    }));
  const contentFreeResultIntegrity = validateContentFreeResultPrefix(results, caseBindings);
  if (!contentFreeResultIntegrity) throw new Error("Backtest results failed content-free schema or case-binding validation.");
  const report = {
    schemaVersion: 4,
    generatedAt: new Date().toISOString(),
    method: "leak-free-three-arm-conversation-wide-chronological-pre-reply-holdout",
    acceptanceStandard: {
      description: "At each historical moment, draft from only evidence strictly available before the held-out owner reply. Personalized, account-only and neutral arms are rebuilt with explicit evidence ablation. No word-overlap metric is used. A safe current-fact abstention receives safety credit but neither answer credit nor an answerable-intent failure.",
      dimensions: metricNames,
      strictAcceptance: "all nine dimensions must pass",
      systemicThresholds: metricThresholds,
      systemicFailurePolicy: "Any aggregate dimension below its threshold becomes an architectural regression requiring a test and correction before a release claim.",
    },
    sampling: {
      partition: auditPartition,
      partitionPurpose: auditPartition === "calibration"
        ? "Development diagnostics only. Results from this partition must not be reported as untouched evaluation evidence."
        : "Untouched evaluation. This runner never tunes or rewrites production policy from evaluation outcomes.",
      contactSeparation: "All cases for one canonical person are frozen into exactly one partition when identity is available; otherwise the chat is the fail-safe split unit.",
      stylePolicyCalibration: "hierarchical-prior-v2 uses symmetric uninformative priors and contains no constants derived from this evaluation partition.",
      activeChatSample: {
        method: auditChatScope.mode === "all-available"
          ? "all active chats made available by the connector"
          : "deterministic SHA-256 rank, independent of provider list recency",
        scope: auditChatScope.mode,
        manifestHash: activeChatSample.manifestHash,
        universeChats: activeChatSample.universeCount,
        selectedChats: selectedActiveChats.length,
        containsChatIdentifiers: false,
      },
      holdoutSample: stratifiedSample.manifest,
    },
    coverage: {
      chatsDiscovered: discovered.length,
      activeChatsDiscovered: visibleActiveChats.length,
      archivedChatsDiscovered: visibleArchivedChats.length,
      chatsSelectedForAudit: selectedChats.length,
      activeChatsSelected: selectedActiveChats.length,
      archivedChatsSelected: selectedArchivedChats.length,
      chatsRead: histories.length,
      historyReadFailures: historyErrors.length,
      directChatsEligibleForHoldout: evaluationHistories.length,
      messagesReadInMemory: allEvents.length,
      holdoutCandidatesBeforePartition: candidateCases.length,
      holdoutCases: results.length,
      relationshipContexts: new Set(results.map((result) => result.relationship)).size,
      communicationIntents: new Set(results.map((result) => result.intent)).size,
    },
    historyCoverage: histories.map((history) => {
      const ordered = orderedHuman(history.events);
      return {
        chatAuditId: history.auditId,
        kind: history.chat.kind,
        archived: history.chat.auditArchived === true,
        messagesRead: ordered.length,
        ownerMessages: ordered.filter((event) => event.direction === "owner").length,
        contactMessages: ordered.filter((event) => event.direction === "contact").length,
        earliestTimestamp: ordered[0]?.timestampMs ? new Date(ordered[0].timestampMs).toISOString() : null,
        latestTimestamp: ordered.at(-1)?.timestampMs ? new Date(ordered.at(-1).timestampMs).toISOString() : null,
        reachedBeginning: history.watermark?.reachedBeginning === true || history.watermark?.reached_beginning === true,
        connectorMessageCount: Number(history.watermark?.messageCount || history.watermark?.messages_seen || 0),
      };
    }),
    historyErrors,
    aggregate: {
      generationCompletion: ratio(results.filter((result) => !result.generationError).length, results.length),
      strictAcceptance: ratio(generated.filter((result) => result.accepted).length, results.length),
      averageConversationScore: round(generated.reduce((sum, result) => sum + result.conversationScore, 0) / Math.max(1, generated.length), 1),
      ownerPersonalizationLift: round(generated.reduce((sum, result) => sum + result.conversationScore - result.neutralScore, 0) / Math.max(1, generated.length), 1),
      relationshipSpecificLift: round(generated.reduce((sum, result) => sum + result.conversationScore - result.accountBaselineScore, 0) / Math.max(1, generated.length), 1),
      draftDiversity: {
        distinctDrafts,
        distinctDraftRate: ratio(distinctDrafts, generated.length),
        mostRepeatedDraftShare: ratio(mostRepeatedDraftCount, generated.length),
        genericDraftRate: ratio(generated.filter((result) => result.genericDraft).length, generated.length),
      },
      metricPassRates: aggregateMetricRates,
      metricConfidence95,
      intentQuality,
      classificationQuality,
    },
    systemicFailures,
    byRelationship: byDimension("relationship"),
    byIntent: byDimension("intent"),
    byDNAEvidence: byDimension("dnaEvidenceTier"),
    byChat: perChatBehavior,
    diagnostics: {
      generationErrorCategories: counts(results.filter((result) => result.generationError).map((result) => result.errorCategory || "unknown")),
      generationErrorsByIntent: counts(results.filter((result) => result.generationError).map((result) => result.intent || "unknown")),
      candidateRejectionReasons: counts(results.filter((result) => result.generationError).flatMap((result) => result.evaluationReasons || [])),
      candidateBlockingReasons: counts(results.filter((result) => result.generationError).flatMap((result) => result.evaluationBlockingReasons || [])),
      rejectedCandidateShapes: counts(results.filter((result) => result.generationError).flatMap((result) => result.evaluationCandidateShapes || [])),
      unsafeRequiredFacts: counts(results.filter((result) => !result.safeFactHandling).map((result) => result.requiredFacts || "unknown")),
      incompatibleActPairs: counts(generated.filter((result) => !result.behaviorCompatible).map((result) => `${result.predictedAct}->${result.actualAct}`)),
      predictedWritingModes: counts(generated.map((result) => result.predictedMode || "unknown")),
      actualWritingModes: counts(generated.map((result) => result.actualMode || "unknown")),
      writingModeConfusion: counts(generated.map((result) => `${result.predictedMode || "unknown"}->${result.actualMode || "unknown"}`)),
      targetToActualWritingMode: counts(generated.map((result) => `${result.targetMode || "unknown"}->${result.actualMode || "unknown"}`)),
      targetToPredictedWritingMode: counts(generated.map((result) => `${result.targetMode || "unknown"}->${result.predictedMode || "unknown"}`)),
      lengthBucketConfusion: counts(generated.map((result) => `${result.predictedLength || "unknown"}->${result.actualLength || "unknown"}`)),
      targetToActualLengthBucket: counts(generated.map((result) => `${result.targetLength || "unknown"}->${result.actualLength || "unknown"}`)),
      globalMedianToPredictedAndActualLength: counts(generated.map((result) => `${result.lengthStrategies?.globalMedian || "unknown"}->${result.predictedLength || "unknown"}->${result.actualLength || "unknown"}`)),
      warmthConfusion: counts(generated.map((result) => `${result.predictedWarmth || "unknown"}->${result.actualWarmth || "unknown"}`)),
      formalityConfusion: counts(generated.map((result) => `${result.predictedFormality || "unknown"}->${result.actualFormality || "unknown"}`)),
      targetToActualFormality: counts(generated.map((result) => `${result.targetFormality || "unknown"}->${result.actualFormality || "unknown"}`)),
      globalLanguageToPredictedAndActual: counts(generated.map((result) => `${result.languageStrategies?.globalDominant || "unknown"}->${result.predictedMode || "unknown"}->${result.actualMode || "unknown"}`)),
      emojiConfusion: counts(generated.map((result) => `${result.predictedEmoji || "unknown"}->${result.actualEmoji || "unknown"}`)),
      failedDimensions: counts(generated.flatMap((result) => metricNames.filter((metric) => !result.metrics?.[metric]))),
      strategyComparison: {
        language: {
          currentGenerator: ratio(generated.filter((result) => result.metrics?.language).length, generated.length),
          ...strategyRate("languageStrategies", (value, result) => value === result.actualMode || result.actualMode === "Mixed"),
        },
        brevity: {
          currentGenerator: ratio(generated.filter((result) => result.metrics?.brevity).length, generated.length),
          ...strategyRate("lengthStrategies", (value, result) => Math.abs(["micro", "short", "medium", "long"].indexOf(value) - ["micro", "short", "medium", "long"].indexOf(result.actualLength)) <= 1),
        },
        formality: {
          currentGenerator: ratio(generated.filter((result) => result.metrics?.formality).length, generated.length),
          ...strategyRate("formalityStrategies", (value, result) => value === result.actualFormality),
        },
      },
    },
    failures: {
      generationErrors: results.filter((result) => result.generationError).length,
      strictRejections: results.filter((result) => !result.accepted).length,
      unsafeCommitmentHandling: results.filter((result) => !result.metrics?.commitmentSafety).length,
      storyUnderstandingFailures: results.filter((result) => !result.metrics?.storyUnderstanding).length,
      crossContactLeakageFailures: results.filter((result) => !result.metrics?.crossContactLeakage).length,
      scoreBelow75: results.filter((result) => result.conversationScore < 75).length,
    },
    privacy: {
      rawMessagesWrittenToReport: !contentFreeResultIntegrity,
      chatIdentifiersWrittenToReport: !contentFreeResultIntegrity,
      chatNamesWrittenToReport: !contentFreeResultIntegrity,
      externalModelCalls: 0,
      outboundMessages: 0,
    },
    execution: {
      chronologicalEvidenceIndex: true,
      evidenceIndexBuildMs,
      checkpointSchemaVersion: 1,
      checkpointEveryCases: checkpointEvery,
      resumeEnabled: resumeCheckpoint,
      resumedCases,
      evaluatedCasesThisRun: results.length - resumedCases,
      evaluationElapsedMs: Math.round(performance.now() - runStartedAt),
      checkpointContainsRawContent: !contentFreeResultIntegrity,
    },
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  if (browser) await browser.close();
}
