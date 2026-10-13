import { createHash } from "node:crypto";

import { buildStory, decideReply, isHumanText, latestVerifiedHumanMessage, orderedEvents } from "./conversation.ts";
import { abstractBehavioralDNA, buildBehavioralDNA, classifyIncomingIntent, classifyResponseAct, type BehavioralBucket, type BehavioralDNA } from "./behavioral-dna.ts";
import { inferOwnerResponseMode, inferScenarioFamilies, scenarioCode } from "./scenarios.ts";
import { buildChatRelationshipProfile, buildPersonRelationshipModel, detectWritingMode, type RelationshipContextProfile } from "./relationship.ts";
import { retrieveContext, semanticSimilarity, semanticSimilarityAcrossVariants, type RetrievalItem } from "./retrieval.ts";
import { buildToneSamplePool } from "./tone.ts";
import { buildDynamicPhraseBank, phraseProvenanceFingerprint, phraseTemplateFingerprint, scenarioTrainingEpisodesFromHistory, selectDynamicPhrases, type PhraseBankSelection, type PhraseFeedbackSignal } from "./phrase-bank.ts";
import { predictScenarioForest, trainScenarioForestCached, type ScenarioForestPrediction } from "./scenario-forest.ts";
import { selectBehavioralStylePolicy, type BehavioralStylePolicy } from "./style-policy.ts";
import {
  buildGraphGroundedContext,
  deriveCrossRelationshipResponsePolicy,
  validateGraphGroundedCandidate,
  type AggregateResponsePolicy,
  type GraphGroundedContext,
} from "./graph-grounded-context.ts";
import type { CanonicalChat, MessageEvent, SyncWatermark } from "./domain.ts";

export type DraftContext = {
  scope: {
    tenantScopeId: string;
    accountScopeId: string;
    isolation: "local-installation" | "strict-account" | "strict-tenant-account";
  };
  graphGrounding: {
    protocol: "ggcp-v1";
    tenantId: string;
    targetRelationshipGraphId: string;
    graphVersion: string;
    targetMessageEvidenceId: string;
    evidence: Array<{
      messageId: string | null;
      evidenceId: string;
      sourceRecordId: string;
      recordedAt: string;
      sourceType: "message" | "explicit-user-input";
    }>;
    facts: Array<{
      factId: string;
      evidenceId: string;
      sourceRecordId: string;
      authority: "owner_asserted" | "other_asserted" | "explicit-user-input";
      confidence: number;
      status: "current" | "superseded";
      safeToRepeat: boolean;
      observedAt: string;
      validFrom: string;
      expiresAt: string | null;
      supersededAt: string | null;
      supersededByFactId: string | null;
    }>;
    factIds: string[];
  };
  chat: { id: string; title: string; kind: CanonicalChat["kind"] };
  freshness: { verifiedAt: string; newestTimestampMs: number; targetMessageId: string };
  currentIncomingTurn: { messageIds: string[]; text: string };
  languageBridge?: {
    sourceLanguage: "Hindi" | "Gujarati" | "Roman Hindi" | "Roman Gujarati";
    targetLanguage: "English";
    translatedText: string;
    localOnly: true;
    use: "semantic-understanding-only";
  };
  story: Array<{
    id: string;
    speaker: "OWNER" | "OTHER";
    speakerName: string;
    text: string;
    timestampMs: number;
    timestampIso: string;
    ageMs: number;
    isTarget: boolean;
    temporalStatus: "current" | "historical" | "expired";
    factAuthority: "owner_asserted" | "other_requested" | "other_asserted";
  }>;
  coverage: { humanMessagesConsidered: number; storyEventsIncluded: number; reachedBeginning: boolean };
  tone: {
    stage: "learning" | "developing" | "established";
    generalExamples: string[];
    personSpecificExamples: string[];
  };
  relationship: {
    profile: RelationshipContextProfile;
    interactionCount: number;
    medianOwnerReplyCharacters: number;
    ownerEmojiReplyRate: number;
    otherPartyExamples: string[];
    interactions: Array<{
      otherMessageIds: string[];
      ownerReplyIds: string[];
      otherMessageId: string;
      ownerReplyId: string;
      /** Verified messages before this incoming turn, oldest to newest. */
      precedingStoryText: string[];
      otherText: string;
      ownerReply: string;
      responseDelayMs: number;
    }>;
    behavioralDNA: BehavioralDNA;
    /**
     * Content-free style features learned across this account only. This is
     * the cold-start prior for a new contact; it never contains reusable
     * historical facts or unrestricted sentences.
     */
    ownerGlobalBehavioralDNA: BehavioralDNA;
    ownerGlobalBehavioralDNAProvenance: AggregateResponsePolicy["provenance"] | null;
    /** Per-dimension, confidence-calibrated style source. Contains no chat text. */
    stylePolicy: BehavioralStylePolicy;
    similarProfile: {
      active: boolean;
      relationship: RelationshipContextProfile["scenarioRelationship"];
      sourceChatCount: number;
      ownerExampleCount: number;
      medianOwnerReplyCharacters: number;
      behavioralDNA: BehavioralDNA | null;
      behavioralDNAProvenance: AggregateResponsePolicy["provenance"] | null;
      aggregatePolicy: AggregateResponsePolicy | null;
      use: "content-free-behavioral-policy-only";
    };
  };
  retrieval: {
    targetPersonId: string;
    scenarioCode: string;
    /**
     * Same-person historical request/reply episodes. They are analogies for
     * response strategy and register only: historical facts must never be
     * copied into a new reply.
     */
    episodes: Array<{
      incomingText: string;
      ownerReply: string;
      similarity: number;
      incomingSimilarity: number;
      precedingStorySimilarity: number;
      wholeStorySimilarity: number;
      score: number;
      effectiveSampleSize: number;
      planProbability: number;
      reliability: number;
      scenarioCode: string;
      incomingIntent: string;
      responseAct: string;
      writingMode: string;
      timestampMs: number;
      sourceMessageIds: string[];
      factEligible: false;
      use: "analogy-only";
    }>;
    semanticEvidence: RetrievalItem[];
    /**
     * Dynamic, content-slotted owner phrase patterns. This remains separate
     * from semantic evidence and is never factual authority for a draft.
     */
    phraseBank: PhraseBankSelection;
    /**
     * Probabilistic routing across all 1,500 C/S/T cells plus the continuous
     * valence/arousal/formality thermal space. This is content-free model
     * output; raw training turns never leave the local context builder.
     */
    scenarioForest: ScenarioForestPrediction | null;
    /** Primary name used by generation; scenarioForest remains compatible. */
    scenarioPosterior: ScenarioForestPrediction | null;
    routingBlend: {
      forestWeight: number;
      rulePriorWeight: number;
      rankedCodes: Array<{
        code: string;
        blendedWeight: number;
        forestContribution: number;
        ruleContribution: number;
      }>;
    };
    /** Content-free recent-use memory used only to de-prioritise repetition. */
    repetition: {
      recentPatternIds: string[];
      recentTemplateFingerprints: string[];
    };
  };
  safety: {
    timeSensitive: boolean;
    commitmentRequested: boolean;
    requiresCurrentFact: boolean;
    requiredFacts: Array<"availability" | "commitment" | "date" | "location" | "status" | "time">;
    requiredInputs: Array<{
      key: "date" | "time";
      type: "date" | "time";
      label: string;
      token: "{{date}}" | "{{time}}";
    }>;
  };
  conversationState: Record<string, unknown> | null;
  userIntent: string | null;
  preferences: {
    draftLanguage: "match" | "English" | "Roman Hindi" | "Roman Gujarati";
    replyLength: "match" | "short" | "medium";
    formality: "match" | "casual" | "neutral" | "formal";
    emoji: "match" | "avoid" | "use";
  };
};

function opaqueGraphDigest(label: string, values: readonly unknown[]) {
  const hash = createHash("sha256");
  hash.update(label);
  for (const value of values) {
    hash.update("\u001f");
    hash.update(typeof value === "string" ? value : JSON.stringify(value));
  }
  return hash.digest("hex");
}

function graphVersionForStory(targetRelationshipGraphId: string, story: DraftContext["story"], userIntent: string | null = null) {
  const canonicalStory = story.map((event) => ({
    id: event.id,
    speaker: event.speaker,
    text: event.text,
    timestampMs: event.timestampMs,
    isTarget: event.isTarget,
    temporalStatus: event.temporalStatus,
    factAuthority: event.factAuthority,
  }));
  return `gv_${opaqueGraphDigest("mycrobo-ggcp-graph-version-v1", [targetRelationshipGraphId, canonicalStory, userIntent || ""])}`;
}

const GGCP_FACT_TTL_MS = 24 * 60 * 60 * 1_000;
const GGCP_UNSAFE_TO_REPEAT = /\b(?:cvv|otp|one[ -]?time pass(?:code|word)|pass(?:code|word)|pin|private key|recovery code|api[ _-]?key|secret|security code)\b|\b(?:\d[ -]?){12,19}\b|https?:\/\/[^\s<>()]*(?:[?&]|%26)(?:access(?:_|%5f)token|api(?:_|%5f)key|auth|key|password|signature|token|x-amz-(?:credential|signature)|sig)(?:=|%3d)/iu;

function graphFactSafeToRepeat(value: string) {
  return !GGCP_UNSAFE_TO_REPEAT.test(value);
}

function graphContextFromDraftContext(context: DraftContext): GraphGroundedContext {
  const grounding = context.graphGrounding;
  const boundary = {
    tenantId: grounding.tenantId,
    targetRelationshipGraphId: grounding.targetRelationshipGraphId,
  };
  const storyById = new Map(context.story.map((event) => [event.id, event]));
  const factValueByEvidenceId = new Map<string, string>();
  const evidenceById = new Map<string, DraftContext["graphGrounding"]["evidence"][number]>();
  const targetGraph = buildGraphGroundedContext({
    boundary,
    targetGraph: {
      ...boundary,
      evidence: grounding.evidence.map((entry) => {
        const event = entry.messageId ? storyById.get(entry.messageId) : null;
        const content = entry.sourceType === "explicit-user-input" ? String(context.userIntent || "").trim() : event?.text;
        if (!content) throw new Error("Graph grounding metadata references content outside the verified target graph.");
        factValueByEvidenceId.set(entry.evidenceId, content);
        evidenceById.set(entry.evidenceId, entry);
        return {
          ...boundary,
          evidenceId: entry.evidenceId,
          kind: entry.sourceType === "explicit-user-input" ? "explicit-user-input" as const : "message" as const,
          content,
          provenance: {
            ...boundary,
            sourceRecordId: entry.sourceRecordId,
            sourceType: entry.sourceType,
            recordedAt: entry.recordedAt,
            extractorVersion: "mycrobo-draft-ggcp-v1",
          },
        };
      }),
      facts: grounding.facts.map((fact) => {
        const evidence = evidenceById.get(fact.evidenceId);
        const value = factValueByEvidenceId.get(fact.evidenceId);
        if (!evidence || !value || evidence.sourceRecordId !== fact.sourceRecordId) {
          throw new Error("Graph fact provenance does not resolve in the verified target graph.");
        }
        return {
          ...boundary,
          factId: fact.factId,
          value,
          evidenceIds: [fact.evidenceId],
          provenance: [{
            ...boundary,
            sourceRecordId: fact.sourceRecordId,
            sourceType: evidence.sourceType,
            recordedAt: evidence.recordedAt,
            extractorVersion: "mycrobo-draft-ggcp-v1",
          }],
          confidence: fact.confidence,
          status: fact.status,
          safeToRepeat: fact.safeToRepeat,
          observedAt: fact.observedAt,
          validFrom: fact.validFrom,
          expiresAt: fact.expiresAt,
          supersededAt: fact.supersededAt,
          supersededByFactId: fact.supersededByFactId,
        };
      }),
    },
  });
  if (graphVersionForStory(grounding.targetRelationshipGraphId, context.story, context.userIntent) !== grounding.graphVersion) {
    throw new Error("The target relationship graph changed after the draft context was built.");
  }
  return targetGraph;
}

const FACTUAL_CLAIM_SIGNAL = /(?:\b(?:i am|i'm|im|we are|i have|we have|i will|i'll|we will|i can|we can|main|mai|mein|hum)\b|\b(?:is|are|was|were|has been|have been|ho gaya|ho gya|thai gayu)\b|\b(?:approved|rejected|accepted|paid|done|ready|completed|finished|sent|shared|delivered|received|resolved|pending|available|unavailable|busy)\b|\b\d+(?:[.:/-]\d+)*\b)/iu;
const FIRST_PERSON_FACTUAL_CLAIM = /\b(?:i am|i'm|im|we are|i have|we have|i will|i'll|we will|i can|we can|main|mai|mein|hum)\b/iu;
const CLAIM_PLACEHOLDER = /\[(?:add|confirm|enter|replace|say|select|write)\b[^\]\r\n]{0,120}\]|\{\{(?:date|time)\}\}/iu;
const NON_FACTUAL_UTTERANCE = /^(?:(?:okay+|ok+|haan+|haa+|ha+|hmm+|acha+|achha+|thee?k(?: hai)?|thik(?: hai)?|got it|noted|understood|sure|fine|no worries|koi na|kai nai|hi+|hii+|hey+|hello+|welcome|thanks?|thank you|sorry|congratulations?|happy birthday|take care|dhyan se)(?:[,\s]+(?:bhai|bro|boss|sir|yaar|ji))?|[👍👌✅🙏🙂😊😂🤣❤️💕🥺]+)[\s.!…\p{Extended_Pictographic}]*$/iu;
const ABSTENTION_UTTERANCE = /^(?:(?:i|we)\s+(?:do\s*n't|dont|cannot|can't|cant)\s+(?:know|confirm|verify|say)|(?:i(?:'m| am)|we(?:'re| are))\s+not\s+(?:sure|certain)|(?:i|we)\s+(?:need|have)\s+to\s+(?:check|confirm|verify)|(?:let me|i(?:'ll| will)|we(?:'ll| will))\s+(?:check|confirm|verify)(?:\s+(?:first|and get back))?|(?:not|unable to)\s+(?:sure|confirm|verify))(?:[,.!…\s].*)?$/iu;
const CLAIM_STOP_WORDS = new Set("a an the and or but if to of in on at for from with is are am was were be been being has have had it this that these those i im me my mine we us our you your yours he she they them his her their do does did can could will would should may might yes no not nahi nhi haan haa okay ok acha achha theek thik got noted sure fine done understood please pls plz se ka ki ko par pe hu hun hoon hai hain chhe che chu main mai mein hum tum tame aap".split(" "));

function claimTokens(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu)
    ?.filter((token) => token.length > 1 && !CLAIM_STOP_WORDS.has(token)) || [];
}

function factualClaimsInDraft(draft: string) {
  return String(draft || "")
    .split(/(?:[.!…]\s+|\s+[—–]\s+)/u)
    .map((value) => value.trim())
    .filter((value) => {
      if (!value || value.endsWith("?") || CLAIM_PLACEHOLDER.test(value) || NON_FACTUAL_UTTERANCE.test(value) || ABSTENTION_UTTERANCE.test(value)) return false;
      // Fail closed for substantive declarative clauses. This intentionally
      // does not depend on a finite verb/status list: unseen names, verbs and
      // domains must still resolve to a target-graph fact.
      return FACTUAL_CLAIM_SIGNAL.test(value) || claimTokens(value).length >= 2;
    });
}

function factSupportsClaim(factValue: string, claim: string) {
  const claimValues = claimTokens(claim);
  const factTokenList = claimTokens(factValue);
  const factValues = new Set(factTokenList);
  if (!claimValues.length) {
    return factValue.normalize("NFKC").toLocaleLowerCase().includes(claim.normalize("NFKC").toLocaleLowerCase());
  }
  if (claimValues.every((token) => factValues.has(token))) return true;
  const overlap = claimValues.filter((token) => factValues.has(token)).length / claimValues.length;
  const claimNumbers = new Set(claim.match(/\b\d+(?:[.:/-]\d+)*\b/gu) || []);
  const factNumbers = new Set(factValue.match(/\b\d+(?:[.:/-]\d+)*\b/gu) || []);
  if ([...claimNumbers].some((number) => !factNumbers.has(number))) return false;
  if (overlap < 0.5 || semanticSimilarity(claim, factValue) < 0.25) return false;
  // Whole-sentence similarity alone can hide a changed predicate, entity or
  // time behind shared context (for example "ships tomorrow" versus
  // "delayed tomorrow"). Every non-exact claim token therefore needs its own
  // semantic counterpart in the verified fact.
  const unmatchedClaimTokens = claimValues.filter((token) => !factValues.has(token));
  const unmatchedFactTokens = factTokenList.filter((token) => !claimValues.includes(token));
  return unmatchedClaimTokens.every((claimToken) => unmatchedFactTokens.some((factToken) =>
    semanticSimilarity(claimToken, factToken) >= 0.45));
}

const EDIT_PLACEHOLDER = /\[(?:add|confirm|enter|replace|say|select|write)\b[^\]\r\n]{0,120}\]|\{\{(?:date|time)\}\}/giu;

export function unresolvedDraftPlaceholders(text: string): string[] {
  return [...String(text || "").matchAll(EDIT_PLACEHOLDER)].map((match) => match[0]);
}

export function analyzeReplySafety(text: string): DraftContext["safety"] {
  const value = String(text || "").trim().toLocaleLowerCase();
  // A salutation such as "Good morning" describes the greeting, not a time
  // the owner has been asked to promise. Remove only that lexical use before
  // evaluating genuine dates, deadlines and availability requests.
  const temporalValue = value.replace(/\bgood\s+(?:morning|afternoon|evening)\b/giu, " ");
  const facts = new Set<DraftContext["safety"]["requiredFacts"][number]>();
  const negatedImmediateAction = /\b(?:abhi\s+(?:nahi|nhi)|(?:nahi|nhi)\s+abhi|not\s+now)\b/iu.test(temporalValue);
  const temporalSignal = !negatedImmediateAction && /\b(?:aaj|abhi|after|afternoon|at what time|before|baje|by when|evening|friday|hours?|in \d+|kal|kab|ketla vag(?:e)?|kyare|later|lunch|monday|minutes?|morning|next (?:week|month)|noon|now|saturday|savare|shaam|soon|subah|sunday|thursday|today|tomorrow|tonight|tuesday|wednesday|what time|when)\b|\b\d{1,2}:\d{2}\s*(?:am|pm)?\b|\b\d{1,2}\s*(?:am|pm|baje)\b/iu.test(temporalValue);
  const asksAvailability = /\b(?:are you (?:available|free)|available ho|can you|could you|free (?:ho|chhe)|will you|would you)\b/iu.test(value);
  const asksLocation = /\b(?:where are you|where will you|kahan ho|kidhar ho|kyan cho|location)\b/iu.test(value);
  const asksStatus = /\b(?:any|koi|kai)\s+update\b|\b(?:status|progress|update)\s*(?:\?|please|pls|do|bata|batao|janav)?\b/iu.test(value);
  const asksExactTime = /\b(?:at what time|what time|which time|kitne baje|ketla vag(?:e)?|ketla vage)\b/iu.test(value);
  const asksExactDate = /\b(?:what date|which date|which day|kaunsi date|konsi date|kaya divase|kai date)\b/iu.test(value)
    || (/\b(?:when|kab|kyare)\b/iu.test(value) && !asksExactTime);
  const actionSignal = /\b(?:attend|bring|call|phone|ring|check|complete|confirm|deliver|do|drop|finish|forward|join|meet|pay|pick|prepare|reach|reply|review|send|share|submit|update|visit|bhej|bhejo|bata|batana|dekho|janav|karjo|mokli|moklo|pahunch)\b/iu.test(value);
  const commitmentRequested = /\b(?:attend|bring|call|phone|ring|check|complete|confirm|deliver|do|drop|finish|forward|join|meet|pay|pick|prepare|reach|reply|review|send|share|submit|update|visit|bhej|bhejo|bata|batana|dekho|janav|karjo|mokli|moklo|pahunch)\b/iu.test(value)
    && (/\?|\b(?:can|could|please|pls|plz|will|would|kar|karo|kro|kr|karjo|dena|do|jo)\b/iu.test(value) || temporalSignal);
  // A temporal word is not itself a request for a time commitment.  Phrases
  // such as "what are you doing today?" and "how was today?" are ordinary
  // social questions.  The old broad rule converted them into an unrelated
  // time placeholder.  Temporal safety applies only when the message asks for
  // an exact date/time, availability, or a concrete time-bound action.
  const timeSensitive = temporalSignal && (asksExactTime || asksExactDate || asksAvailability || actionSignal || commitmentRequested);
  // Temporal action requests are never accepted from historical behavior
  // alone: even when the other party supplied "tomorrow" or "at 5", the
  // owner must still decide whether to make that time-bound promise.
  if (timeSensitive) facts.add("time");
  if (asksExactDate) facts.add("date");
  if (asksAvailability) facts.add("availability");
  if (asksLocation) facts.add("location");
  if (asksStatus) facts.add("status");
  if (commitmentRequested) facts.add("commitment");
  return {
    timeSensitive,
    commitmentRequested,
    requiresCurrentFact: facts.size > 0,
    requiredFacts: [...facts].sort(),
    requiredInputs: [
      ...(asksExactDate ? [{ key: "date" as const, type: "date" as const, label: "Date", token: "{{date}}" as const }] : []),
      ...(asksExactTime ? [{ key: "time" as const, type: "time" as const, label: "Time", token: "{{time}}" as const }] : []),
    ],
  };
}

function containsUnverifiedCommitment(text: string) {
  const value = String(text || "").trim();
  const firstPersonFuture = /\b(?:i(?:'|’)ll|i will|i can|i am going to|we(?:'|’)ll|we will|we can)\b.{0,36}\b(?:call|check|complete|confirm|finish|forward|meet|pay|reach|reply|review|send|share|submit|tell|update|visit)\b/iu;
  const romanCommitment = /\b(?:bata|bhej|check|confirm|dekh|janav|kahi|kar|mokli|pahunch|send|update)\s*(?:dais|dunga|dungi|deta|deti|karis|karunga|karungi|lau|lunga|lungi)\b/iu;
  const availabilityClaim = /\b(?:i(?:'|’)m|i am|main|mai)\s+(?:available|free)\b|\b(?:free (?:hu|hoon|chhu)|haan,?\s*free)\b/iu;
  const locationClaim = /\b(?:i(?:'|’)m|i am|main|mai)\s+(?:at|in|near|outside|ghar|home|office)\b/iu;
  return firstPersonFuture.test(value) || romanCommitment.test(value) || availabilityClaim.test(value) || locationClaim.test(value);
}

function safeFactPlaceholder(context: DraftContext) {
  const facts = new Set(context.safety.requiredFacts);
  const targetText = context.story.find((event) => event.isTarget)?.text || "";
  if (facts.has("time") && /\b(?:at what time|by when|kab|ketla vag|kyare|what time|when)\b/iu.test(targetText)) return "[Add the actual time before sending]";
  if (facts.has("location")) return "[Add your current location before sending]";
  if (facts.has("availability")) return "[Say whether you are available before sending]";
  if (facts.has("status")) return "[Add the current status before sending]";
  if (facts.has("commitment")) return "[Confirm what you can commit to before sending]";
  if (facts.has("time")) return "[Add the actual time before sending]";
  return "[Confirm what you can commit to before sending]";
}

function structuredFactTemplate(context: DraftContext) {
  const keys = new Set(context.safety.requiredInputs.map((item) => item.key));
  const target = context.story.find((event) => event.isTarget)?.text || "";
  const romanHindi = /\b(?:hai|haan|nahi|nhi|kya|kab|kaise|kahan|mein|mai|main|hu|kar|bata|bhej|pahunch)\b/iu.test(target);
  const romanGujarati = /\b(?:chhe|cho|chu|kem|kyare|mokli|moklo|pahoch|pahunch|shu)\b/iu.test(target);
  if (keys.has("date") && keys.has("time")) {
    if (romanGujarati) return "{{date}} na {{time}} vage rakhie";
    if (romanHindi) return "{{date}} ko {{time}} baje rakhte hain";
    return "Let's plan it for {{date}} at {{time}}.";
  }
  if (keys.has("time")) {
    if (/\b(?:reach|arrive|pahunch|pahoch)\b/iu.test(target)) {
      if (romanGujarati) return "{{time}} sudhi pahochvano plan chhe";
      if (romanHindi) return "{{time}} tak pahunchne ka plan hai";
      return "I should reach by {{time}}.";
    }
    if (romanGujarati) return "{{time}} vage rakhie";
    if (romanHindi) return "{{time}} baje rakhte hain";
    return "{{time}} works for me.";
  }
  if (keys.has("date")) {
    if (/\b(?:send|share|bhej|mokli|complete|finish|deliver)\b/iu.test(target)) {
      if (romanGujarati) return "{{date}} sudhi mokli daish";
      if (romanHindi) return "{{date}} tak bhej dunga";
      return "I can send it by {{date}}.";
    }
    if (romanGujarati) return "{{date}} rakhie";
    if (romanHindi) return "{{date}} rakhte hain";
    return "{{date}} works for me.";
  }
  return safeFactPlaceholder(context);
}

function conversationalIntent(text: string) {
  const value = String(text || "").toLocaleLowerCase();
  if (/\b(?:miss(?:ing)? you|miss u|pyar|pyaar|love you|need (?:your )?(?:love|affection)|hug|cuddle)\b/iu.test(value)) return "affection";
  if (/\b(?:thank|thanks|thx|shukriya|aabhar)\b/iu.test(value)) return "thanks";
  if (/^(?:hi+|hey+|hello+)\b/iu.test(value)) return "greeting";
  if (/\b(?:sorry|maaf|apolog)\b/iu.test(value)) return "apology";
  if (/\b(?:happy birthday|happy anniversary|congratulations|congrats)\b/iu.test(value)) return "wish";
  if (/^(?:ok(?:ay)?|haan+|ha+|hmm+|thik|theek|done)[\s.!👍🙂😊]*$/iu.test(value.trim())) return "acknowledgement";
  return "other";
}

const CONCEPT_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:send|share|bhej|bhejo|mokli|moklo|forward)\b/iu, "send"],
  [/\b(?:check|review|verify|dekh|dekho|joi|joine)\b/iu, "review"],
  [/\b(?:when|kab|kyare|ketla\s+vag|what\s+time)\b/iu, "time-question"],
  [/\b(?:where|kahan|kidhar|location|jagah)\b/iu, "place-question"],
  [/\b(?:meet|meeting|mil|malishu)\b/iu, "meeting"],
  [/\b(?:today|aaj)\b/iu, "today"],
  [/\b(?:tomorrow|kal)\b/iu, "tomorrow"],
  [/\b(?:leave|leaving|nikal|nikl|on my way)\b/iu, "departure"],
  [/\b(?:arrive|arrived|reached|pahuch|pahunch)\b/iu, "arrival"],
  [/\b(?:price|rate|discount|budget|quote|quotation)\b/iu, "commercial"],
  [/\b(?:problem|issue|not working|nahi ho|nhi ho|stuck)\b/iu, "problem"],
  [/\b(?:thank|thanks|thx|shukriya|aabhar)\b/iu, "thanks"],
];

function semanticTokens(text: string) {
  const value = String(text || "").toLocaleLowerCase();
  const tokens = new Set(value.match(/[\p{L}\p{N}]+/gu) || []);
  for (const [pattern, concept] of CONCEPT_PATTERNS) if (pattern.test(value)) tokens.add(`@${concept}`);
  return tokens;
}

function interactionRelevance(targetText: string, interaction: DraftContext["relationship"]["interactions"][number], index: number) {
  const targetIntent = classifyIncomingIntent(targetText);
  const historicalIntent = classifyIncomingIntent(interaction.otherText);
  const targetFamilies = inferScenarioFamilies(targetIntent, targetText);
  const historicalFamilies = inferScenarioFamilies(historicalIntent, interaction.otherText);
  const targetWords = semanticTokens(targetText);
  const historicalWords = semanticTokens(interaction.otherText);
  let overlap = 0;
  for (const word of targetWords) if (historicalWords.has(word)) overlap += 1;
  let familyOverlap = 0;
  for (const target of targetFamilies) {
    const historical = historicalFamilies.find((candidate) => candidate.family === target.family);
    if (historical) familyOverlap += target.probability * historical.probability;
  }
  return (targetIntent === historicalIntent ? 80 : 0) + familyOverlap * 160 + overlap * 8 + index / 1_000_000;
}

function relationshipMemory(events: MessageEvent[], targetText = "") {
  const human = orderedEvents(events).filter((event): event is MessageEvent & { timestampMs: number } =>
    isHumanText(event) && event.timestampVerified && event.timestampMs !== null);
  const interactions: DraftContext["relationship"]["interactions"] = [];
  const turns: Array<{ direction: MessageEvent["direction"]; events: MessageEvent[]; startIndex: number }> = [];
  // Direction changes alone do not prove that the next owner message answered
  // the prior incoming message. Bound each learned response pair to a natural
  // chat burst so a later topic cannot be learned as the response to "Ok".
  // Consecutive bubbles belong to one learned response only while they are a
  // genuine typing burst. A 30-minute same-speaker window merged unrelated
  // messages and distorted both reply length and response act.
  const turnBurstGapMs = 5 * 60 * 1_000;
  const maximumResponseDelayMs = 6 * 60 * 60 * 1_000;
  for (let eventIndex = 0; eventIndex < human.length; eventIndex += 1) {
    const event = human[eventIndex];
    const current = turns.at(-1);
    const prior = current?.events.at(-1);
    const gapMs = prior?.timestampMs !== null && prior?.timestampMs !== undefined && event.timestampMs !== null
      ? Math.max(0, event.timestampMs - prior.timestampMs)
      : Number.POSITIVE_INFINITY;
    if (current?.direction === event.direction && gapMs <= turnBurstGapMs) current.events.push(event);
    else turns.push({ direction: event.direction, events: [event], startIndex: eventIndex });
  }
  for (let index = 0; index < turns.length - 1; index += 1) {
    const otherTurn = turns[index];
    const ownerTurn = turns[index + 1];
    if (otherTurn.direction !== "contact" || ownerTurn.direction !== "owner") continue;
    const lastOther = otherTurn.events.at(-1);
    const firstOwner = ownerTurn.events[0];
    if (!lastOther || !firstOwner || firstOwner.timestampMs === null || lastOther.timestampMs === null) continue;
    const responseDelayMs = Math.max(0, firstOwner.timestampMs - lastOther.timestampMs);
    if (responseDelayMs > maximumResponseDelayMs) continue;
    interactions.push({
      otherMessageIds: otherTurn.events.map((event) => event.id),
      ownerReplyIds: ownerTurn.events.map((event) => event.id),
      otherMessageId: lastOther.id,
      ownerReplyId: firstOwner.id,
      precedingStoryText: human
        .slice(Math.max(0, otherTurn.startIndex - 12), otherTurn.startIndex)
        .map((event) => event.text),
      otherText: otherTurn.events.map((event) => event.text).join("\n"),
      ownerReply: ownerTurn.events.map((event) => event.text).join("\n"),
      responseDelayMs,
    });
  }
  const ranked = interactions.map((interaction, index) => ({ interaction, index, score: interactionRelevance(targetText, interaction, index) }))
    .sort((left, right) => right.score - left.score || right.index - left.index);
  const duplicateReplies = new Map<string, number>();
  const recent: DraftContext["relationship"]["interactions"] = [];
  for (const item of ranked) {
    const signature = item.interaction.ownerReply.toLocaleLowerCase().replace(/\s+/gu, " ").trim();
    const repetitions = duplicateReplies.get(signature) || 0;
    if (repetitions >= 2) continue;
    duplicateReplies.set(signature, repetitions + 1);
    recent.push(item.interaction);
    if (recent.length >= 96) break;
  }
  const lengths = recent.map((pair) => [...pair.ownerReply].length).sort((left, right) => left - right);
  const middle = lengths.length ? Math.floor(lengths.length / 2) : 0;
  const median = lengths.length
    ? lengths.length % 2
      ? lengths[middle]
      : Math.round((lengths[middle - 1] + lengths[middle]) / 2)
    : 0;
  const emojiReplies = recent.filter((pair) => /\p{Extended_Pictographic}/u.test(pair.ownerReply)).length;
  return {
    interactionCount: interactions.length,
    medianOwnerReplyCharacters: median,
    ownerEmojiReplyRate: recent.length ? Number((emojiReplies / recent.length).toFixed(3)) : 0,
    otherPartyExamples: human.filter((event) => event.direction === "contact").slice(-24).reverse().map((event) => event.text),
    interactions: recent,
  };
}

function correlationAdjustedStyleBucket(bucket: BehavioralBucket): BehavioralBucket & { effectiveSampleSize?: number } {
  const observed = Math.max(0, Number(bucket.sampleCount || 0));
  if (observed <= 1) return bucket;
  // Repeated messages in one relationship are correlated observations. Their
  // contribution grows sub-linearly so volume alone cannot make a narrow
  // habit override the current message or the account-level backoff.
  const effective = Math.min(observed, Math.max(1, Math.round(1 + 2 * Math.sqrt(observed - 1))));
  const replyModesByIncomingMode = bucket.replyModesByIncomingMode.map((transition) => {
    const transitionObserved = Math.max(0, Number(transition.sampleCount || 0));
    if (transitionObserved <= 1) return transition;
    const transitionEffective = Math.min(transitionObserved, Math.max(1, Math.round(1 + 2 * Math.sqrt(transitionObserved - 1))));
    return {
      ...transition,
      effectiveSampleSize: transitionEffective,
    };
  });
  return {
    ...bucket,
    effectiveSampleSize: effective,
    confidence: Number(Math.min(0.96, effective / (effective + 5)).toFixed(3)),
    replyModesByIncomingMode,
  };
}

function conditionPersonStyleDNA(dna: BehavioralDNA): BehavioralDNA {
  const intentBucket = dna.byIncomingIntent[dna.activeIntent];
  return {
    ...dna,
    // Style is conditioned on the incoming intent before it uses a narrower
    // C/S/T leaf. Sparse or repetitive person evidence then naturally backs
    // off inside selectBehavioralStylePolicy on a per-dimension basis.
    active: correlationAdjustedStyleBucket(intentBucket || dna.active),
  };
}

function ownerGlobalBehavioralProfile(
  events: MessageEvent[],
  targetText: string,
  boundary: { tenantId: string; targetRelationshipGraphId: string },
  accountScopeId: string,
) {
  const grouped = new Map<string, MessageEvent[]>();
  for (const event of orderedEvents(events)) {
    if (!isHumanText(event)) continue;
    const values = grouped.get(event.chatId) || [];
    values.push(event);
    grouped.set(event.chatId, values);
  }
  const contributingGraphs = [...grouped.entries()]
    .map(([chatId, chatEvents]) => ({ chatId, chatEvents, interactions: relationshipMemory(chatEvents, targetText).interactions }))
    .filter(({ interactions }) => interactions.length > 0);
  if (contributingGraphs.length < 3) {
    return { dna: buildBehavioralDNA([], targetText, "unknown"), provenance: null };
  }
  // Give every source relationship graph exactly one observation in the
  // account prior. A long conversation must not dominate two other graphs
  // and become a disguised single-relationship profile.
  const interactions = contributingGraphs.map(({ interactions: graphInteractions }) => graphInteractions
    .map((interaction, index) => ({ interaction, index, score: interactionRelevance(targetText, interaction, index) }))
    .sort((left, right) => right.score - left.score || right.index - left.index)[0].interaction);
  const fingerprints = contributingGraphs.map(({ chatId, chatEvents, interactions: graphInteractions }) => {
    const graphDNA = buildBehavioralDNA(graphInteractions, targetText, "unknown");
    const sourceRelationshipGraphId = `xrg_${opaqueGraphDigest("mycrobo-ggcp-owner-global-graph-v1", [boundary.tenantId, accountScopeId, chatId]).slice(0, 40)}`;
    return {
      ...boundary,
      sourceRelationshipGraphId,
      fingerprintId: `fp_${opaqueGraphDigest("mycrobo-ggcp-owner-global-fingerprint-v1", [sourceRelationshipGraphId, graphDNA.activeScenario.code, graphDNA.active.sampleCount]).slice(0, 40)}`,
      situation: ggcpSituation(targetText),
      observedPolicy: ggcpPolicyFromDNA(graphDNA),
      provenance: {
        ...boundary,
        sourceRecordId: `src_${opaqueGraphDigest("mycrobo-ggcp-owner-global-source-v1", [sourceRelationshipGraphId, ...graphInteractions.flatMap((item) => item.ownerReplyIds)]).slice(0, 40)}`,
        sourceType: "derived-fingerprint" as const,
        recordedAt: new Date(Math.max(0, ...chatEvents.map((event) => event.timestampMs || 0))).toISOString(),
        extractorVersion: "mycrobo-draft-ggcp-v1",
      },
    };
  });
  const aggregatePolicy = deriveCrossRelationshipResponsePolicy({
    boundary,
    target: { ...boundary, situation: ggcpSituation(targetText) },
    fingerprints,
  });
  return {
    dna: abstractBehavioralDNA(buildBehavioralDNA(interactions, targetText, "unknown")),
    // Source graph/fingerprint identifiers are internal derivation material.
    // They must not enter the target relationship context.
    provenance: { ...aggregatePolicy.provenance, sourceCount: aggregatePolicy.provenance.sources.length, sources: [] },
  };
}

const GENERIC_ACKNOWLEDGEMENT = /^(?:ok(?:ay)?|got it|noted|thanks(?: for letting me know)?|thank you|haan+|haa+|ha+|thee?k|thik|acha|achha|fine|sure|done)[.!…\s\p{Extended_Pictographic}]*$/iu;

/**
 * Selects evidence-backed same-person response episodes for the active
 * scenario. This is deliberately separate from factual retrieval: the text
 * is labelled analogy-only and cannot authorize a claim in the new draft.
 */
export function retrieveResponseEpisodes(options: {
  queryText: string;
  /** Local translations or transliterations of this same current turn only. */
  queryVariants?: string[];
  currentStoryText?: string[];
  relationship: RelationshipContextProfile["scenarioRelationship"];
  interactions: DraftContext["relationship"]["interactions"];
  activeScenario: BehavioralDNA["activeScenario"];
  nowMs: number;
  timestampByMessageId?: ReadonlyMap<string, number>;
  limit?: number;
}): DraftContext["retrieval"]["episodes"] {
  const queryIntent = classifyIncomingIntent(options.queryText);
  const queryFamilies = inferScenarioFamilies(queryIntent, options.queryText);
  const candidateCodes = new Set([
    options.activeScenario.code,
    ...(options.activeScenario.candidates || []).map((candidate) => candidate.code),
  ]);
  const currentPrecedingText = (options.currentStoryText || []).filter(Boolean).slice(-11).join("\n").slice(-2_400);
  const currentVariants = [...new Set([
    options.queryText,
    ...(options.queryVariants || []),
  ].map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 4);
  const currentStoryVariants = [...new Set(currentVariants.map((variant) =>
    [currentPrecedingText, variant].filter(Boolean).join("\n").slice(-2_400)))];
  const candidates = options.interactions.map((interaction, index) => {
    const incomingIntent = classifyIncomingIntent(interaction.otherText);
    const familyCandidates = inferScenarioFamilies(incomingIntent, interaction.otherText);
    const family = familyCandidates[0]?.family || queryFamilies[0]?.family || options.activeScenario.family;
    const mode = inferOwnerResponseMode(interaction.ownerReply, family, options.relationship);
    const historicalScenarioCode = scenarioCode(family, options.relationship, mode);
    const historicalPrecedingText = interaction.precedingStoryText
      .filter(Boolean).slice(-11).join("\n").slice(-2_400);
    const historicalStoryText = [historicalPrecedingText, interaction.otherText]
      .filter(Boolean).slice(-12).join("\n").slice(-2_400) || interaction.otherText;
    const incomingSimilarity = semanticSimilarityAcrossVariants(currentVariants, interaction.otherText);
    const wholeStorySimilarity = semanticSimilarityAcrossVariants(currentStoryVariants, historicalStoryText);
    const precedingSimilarity = currentPrecedingText && historicalPrecedingText
      ? semanticSimilarity(currentPrecedingText, historicalPrecedingText)
      : wholeStorySimilarity;
    // Direct-turn meaning leads. Story similarity then distinguishes the
    // owner's different response to the same short request in different
    // circumstances without allowing old context to hide an intent mismatch.
    const similarity = Number((incomingSimilarity * 0.5 + wholeStorySimilarity * 0.35 + precedingSimilarity * 0.15).toFixed(6));
    const familyOverlap = queryFamilies.reduce((sum, current) => {
      const historical = familyCandidates.find((candidate) => candidate.family === current.family);
      return sum + (historical ? current.probability * historical.probability : 0);
    }, 0);
    const exactIntent = incomingIntent === queryIntent;
    const scenarioMatch = candidateCodes.has(historicalScenarioCode);
    const genericPenalty = queryIntent !== "acknowledgement" && queryIntent !== "greeting"
      && GENERIC_ACKNOWLEDGEMENT.test(interaction.ownerReply) ? 45 : 0;
    const timestampMs = Math.max(0, ...interaction.ownerReplyIds.map((id) => options.timestampByMessageId?.get(id) || 0));
    const agePenalty = timestampMs ? Math.min(12, Math.max(0, options.nowMs - timestampMs) / (365 * 86_400_000)) : 0;
    const score = similarity * 100 + (exactIntent ? 55 : 0) + familyOverlap * 60 + (scenarioMatch ? 20 : 0) - genericPenalty - agePenalty + index / 1_000_000;
    return {
      incomingText: interaction.otherText,
      ownerReply: interaction.ownerReply,
      similarity: Number(similarity.toFixed(6)),
      incomingSimilarity: Number(incomingSimilarity.toFixed(6)),
      precedingStorySimilarity: Number(precedingSimilarity.toFixed(6)),
      wholeStorySimilarity: Number(wholeStorySimilarity.toFixed(6)),
      score: Number(score.toFixed(6)),
      scenarioCode: historicalScenarioCode,
      incomingIntent,
      responseAct: classifyResponseAct(interaction.ownerReply),
      writingMode: detectWritingMode(interaction.ownerReply),
      timestampMs,
      sourceMessageIds: [...interaction.otherMessageIds, ...interaction.ownerReplyIds],
      factEligible: false as const,
      use: "analogy-only" as const,
    };
  });
  const supportByAct = new Map<string, number>();
  let effectiveSampleSize = 0;
  for (const candidate of candidates) {
    const intentRelevance = candidate.incomingIntent === queryIntent ? 1 : candidate.similarity >= 0.45 ? 0.72 : candidate.similarity >= 0.25 ? 0.38 : 0.1;
    // A near-identical causal story is stronger evidence than an arbitrary
    // singleton, while a weak lexical match remains below the reliability
    // gate. Conflicting high-similarity acts split posterior mass and still
    // fail closed instead of allowing one example to seize the plan.
    const support = intentRelevance * (0.5 + 2.5 * candidate.similarity ** 2);
    effectiveSampleSize += support;
    supportByAct.set(candidate.responseAct, (supportByAct.get(candidate.responseAct) || 0) + support);
  }
  const ranked = candidates.map((candidate) => {
    const planProbability = effectiveSampleSize ? (supportByAct.get(candidate.responseAct) || 0) / effectiveSampleSize : 0;
    const reliability = planProbability * (effectiveSampleSize / (effectiveSampleSize + 2)) * (0.5 + candidate.similarity * 0.5);
    return {
      ...candidate,
      effectiveSampleSize: Number(effectiveSampleSize.toFixed(3)),
      planProbability: Number(planProbability.toFixed(4)),
      reliability: Number(reliability.toFixed(4)),
      score: Number((candidate.score + reliability * 80).toFixed(6)),
    };
  }).sort((left, right) => right.score - left.score || right.timestampMs - left.timestampMs);
  const selected: DraftContext["retrieval"]["episodes"] = [];
  const replySignatures = new Set<string>();
  const limit = Math.max(1, Math.min(12, Math.floor(options.limit ?? 8)));
  for (const episode of ranked) {
    const signature = episode.ownerReply.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (replySignatures.has(signature)) continue;
    replySignatures.add(signature);
    selected.push(episode);
    if (selected.length >= limit) break;
  }
  return selected;
}

function ggcpSituation(text: string) {
  const rawIntent = classifyIncomingIntent(text);
  const incomingIntent = ["acknowledgement", "answer", "request", "question", "statement"].includes(rawIntent)
    ? rawIntent as "acknowledgement" | "answer" | "request" | "question" | "statement"
    : "unknown" as const;
  const length = [...text].length;
  return {
    incomingIntent,
    conversationPhase: "active" as const,
    urgencyBand: /\b(?:urgent|urgently|asap|immediately|jaldi|turant)\b/iu.test(text) ? "high" as const : "normal" as const,
    incomingLengthBand: length <= 12 ? "very-short" as const : length <= 40 ? "short" as const : length <= 100 ? "medium" as const : "long" as const,
    questionState: /\?/u.test(text) ? "open" as const : "none" as const,
    mediaState: "none" as const,
  };
}

function ggcpPolicyFromDNA(dna: BehavioralDNA) {
  const active = dna.active?.sampleCount ? dna.active : dna.global;
  const rawAct = active.responseActs?.[0]?.act;
  const responseAct = rawAct === "acknowledgement" ? "acknowledge"
    : rawAct === "question" ? "question"
      : rawAct === "clarification" ? "clarify"
        : rawAct === "decline" ? "decline"
          : rawAct === "commitment" ? "answer"
            : "answer";
  const rawMode = String(active.writingModes?.[0]?.mode || "unknown");
  const writingMode = ["English", "Roman Hindi", "Roman Gujarati", "Gujarati", "Hindi", "mixed", "unknown"].includes(rawMode)
    ? rawMode as "English" | "Roman Hindi" | "Roman Gujarati" | "Gujarati" | "Hindi" | "mixed" | "unknown"
    : rawMode === "Mixed" ? "mixed" as const : "unknown" as const;
  const characters = Number(active.medianCharacters || 0);
  return {
    responseAct,
    writingMode,
    replyLengthBand: characters <= 12 ? "very-short" as const : characters <= 40 ? "short" as const : characters <= 100 ? "medium" as const : "long" as const,
    emojiMode: Number(active.emojiRate || 0) >= 0.5 ? "prefer" as const : Number(active.emojiRate || 0) <= 0.15 ? "avoid" as const : "allow" as const,
    formalityBand: Number(active.formalRate || 0) >= 0.55 ? "formal" as const : Number(active.casualRate || 0) >= 0.55 ? "casual" as const : "neutral" as const,
  };
}

function similarRelationshipProfile(options: {
  targetProfile: RelationshipContextProfile;
  boundary: { tenantId: string; targetRelationshipGraphId: string };
  accountScopeId: string;
  excludedChatIds: string[];
  allChats?: CanonicalChat[];
  allEvents: MessageEvent[];
  personExampleCount: number;
  interactionCount: number;
  activeBehaviorSampleCount: number;
  targetText: string;
}) {
  const weakPersonEvidence = options.personExampleCount < 8 || options.interactionCount < 4 || options.activeBehaviorSampleCount < 2;
  const targetRelationship = options.targetProfile.scenarioRelationship;
  if (!weakPersonEvidence || targetRelationship === "unknown") {
    return {
      active: false,
      relationship: targetRelationship,
      sourceChatCount: 0,
      ownerExampleCount: 0,
      medianOwnerReplyCharacters: 0,
      behavioralDNA: null,
      behavioralDNAProvenance: null,
      aggregatePolicy: null,
      use: "content-free-behavioral-policy-only" as const,
    };
  }
  const excludedChatIds = new Set(options.excludedChatIds);
  const grouped = new Map<string, MessageEvent[]>();
  for (const event of orderedEvents(options.allEvents)) {
    if (excludedChatIds.has(event.chatId) || !isHumanText(event)) continue;
    const values = grouped.get(event.chatId) || [];
    values.push(event);
    grouped.set(event.chatId, values);
  }
  const matchingInteractions: DraftContext["relationship"]["interactions"] = [];
  const sourceFingerprints: Array<Parameters<typeof deriveCrossRelationshipResponsePolicy>[0]["fingerprints"][number]> = [];
  const chatMetadata = new Map((options.allChats || []).map((chat) => [chat.id, chat]));
  let sourceChatCount = 0;
  for (const [chatId, events] of grouped) {
    const syntheticChat = chatMetadata.get(chatId) || { id: chatId, connector: "fixture" as const, connectorIds: [chatId], collection: "active" as const, kind: "direct" as const, title: "", participantIds: [] };
    const profile = buildChatRelationshipProfile(syntheticChat, events);
    if (profile.scenarioRelationship !== targetRelationship || profile.scenarioRelationshipConfidence < 0.4) continue;
    const graphInteractions = relationshipMemory(events, options.targetText).interactions;
    if (graphInteractions.length) {
      sourceChatCount += 1;
      // One equally weighted observation per qualifying relationship graph
      // prevents a single long chat from controlling the aggregate DNA.
      matchingInteractions.push(graphInteractions
        .map((interaction, index) => ({ interaction, index, score: interactionRelevance(options.targetText, interaction, index) }))
        .sort((left, right) => right.score - left.score || right.index - left.index)[0].interaction);
      const dna = buildBehavioralDNA(graphInteractions, options.targetText, targetRelationship);
      const sourceRelationshipGraphId = `xrg_${opaqueGraphDigest("mycrobo-ggcp-cross-graph-v1", [options.boundary.tenantId, options.accountScopeId, chatId]).slice(0, 40)}`;
      const fingerprintId = `fp_${opaqueGraphDigest("mycrobo-ggcp-cross-fingerprint-v1", [sourceRelationshipGraphId, dna.activeScenario.code, dna.active.sampleCount]).slice(0, 40)}`;
      const sourceRecordId = `src_${opaqueGraphDigest("mycrobo-ggcp-cross-source-v1", [sourceRelationshipGraphId, ...graphInteractions.flatMap((item) => item.ownerReplyIds)]).slice(0, 40)}`;
      sourceFingerprints.push({
        ...options.boundary,
        sourceRelationshipGraphId,
        fingerprintId,
        situation: ggcpSituation(options.targetText),
        observedPolicy: ggcpPolicyFromDNA(dna),
        provenance: {
          ...options.boundary,
          sourceRecordId,
          sourceType: "derived-fingerprint",
          recordedAt: new Date(Math.max(0, ...events.map((event) => event.timestampMs || 0))).toISOString(),
          extractorVersion: "mycrobo-draft-ggcp-v1",
        },
      });
    }
  }
  const lengths = matchingInteractions.map((interaction) => [...interaction.ownerReply].length).sort((left, right) => left - right);
  const middle = Math.floor(lengths.length / 2);
  const median = lengths.length ? (lengths.length % 2 ? lengths[middle] : Math.round((lengths[middle - 1] + lengths[middle]) / 2)) : 0;
  // Cross-relationship behavior is an aggregate prior only. Requiring three
  // distinct source graphs prevents a single foreign conversation (or two
  // correlated ones) from becoming a synthetic peer profile.
  const qualifyingSourceGraphCount = new Set(sourceFingerprints.map((item) => item.sourceRelationshipGraphId)).size;
  const aggregateEligible = qualifyingSourceGraphCount >= 3;
  const aggregatePolicy = aggregateEligible
    ? deriveCrossRelationshipResponsePolicy({
      boundary: options.boundary,
      target: { ...options.boundary, situation: ggcpSituation(options.targetText) },
      fingerprints: sourceFingerprints,
    })
    : null;
  const contentFreeAggregatePolicy = aggregatePolicy
    ? { ...aggregatePolicy, provenance: { ...aggregatePolicy.provenance, sourceCount: aggregatePolicy.provenance.sources.length, sources: [] } }
    : null;
  return {
    active: aggregateEligible,
    relationship: targetRelationship,
    sourceChatCount,
    ownerExampleCount: matchingInteractions.length,
    medianOwnerReplyCharacters: median,
    behavioralDNA: aggregateEligible ? abstractBehavioralDNA(buildBehavioralDNA(matchingInteractions, options.targetText, targetRelationship)) : null,
    behavioralDNAProvenance: contentFreeAggregatePolicy?.provenance || null,
    aggregatePolicy: contentFreeAggregatePolicy,
    use: "content-free-behavioral-policy-only" as const,
  };
}

export function buildDraftContext(options: {
  chat: CanonicalChat;
  chatEvents: MessageEvent[];
  allEvents: MessageEvent[];
  /** Chat metadata for relationship-profile cold start; content stays local. */
  allChats?: CanonicalChat[];
  /**
   * Multi-account callers must supply this opaque id and tag every chat/event
   * with the same id. The single-user desktop may omit it because its local
   * vault and process already form the account boundary.
   */
  accountScopeId?: string;
  /** Authenticated workspace boundary. Production callers must provide this. */
  tenantScopeId?: string;
  watermark: SyncWatermark;
  ownerIds: string[];
  expectedTargetMessageId: string;
  userIntent?: string;
  draftAnyway?: boolean;
  conversationState?: Record<string, unknown> | null;
  preferences?: Partial<DraftContext["preferences"]>;
  phraseSelectionSignals?: {
    recentPatternIds?: string[];
    recentTemplateFingerprints?: string[];
    feedbackSignals?: PhraseFeedbackSignal[];
  };
  /** Optional tenant-local translation used only to improve semantic routing. */
  semanticTranslation?: {
    sourceLanguage: "Hindi" | "Gujarati" | "Roman Hindi" | "Roman Gujarati";
    translatedText: string;
  } | null;
  /** Audit-only evidence ablation. Production callers must leave this unset. */
  learningAblation?: "none" | "account-baseline" | "neutral";
  nowMs: number;
}): DraftContext {
  const accountScopeId = String(options.accountScopeId || "").trim();
  const tenantScopeId = String(options.tenantScopeId || "").trim();
  if (tenantScopeId && !accountScopeId) {
    throw new Error("An authenticated tenant draft also requires a verified connector account scope.");
  }
  if (accountScopeId) {
    if (options.chat.accountScopeId !== accountScopeId) {
      throw new Error("The selected chat is outside the active account boundary.");
    }
    const foreignEvent = [...options.chatEvents, ...options.allEvents]
      .find((event) => event.accountScopeId !== accountScopeId);
    if (foreignEvent) {
      throw new Error("Tone evidence from another account was blocked before drafting.");
    }
  }
  const decision = decideReply({
    chat: options.chat,
    events: options.chatEvents,
    watermark: options.watermark,
    ownerIds: options.ownerIds,
  });
  const optionalIncomingTarget = options.draftAnyway ? latestVerifiedHumanMessage(options.chatEvents) : null;
  const target = decision.target || (optionalIncomingTarget?.direction === "contact" ? optionalIncomingTarget : null);
  if (!target) throw new Error(decision.reason);
  if (target.id !== options.expectedTargetMessageId) {
    throw new Error("The conversation changed. Verify the latest message again before drafting.");
  }
  const durableChatId = String(options.conversationState?.chat_id || "").trim();
  const durableLatestId = String(options.conversationState?.latest_message_id || "").trim();
  if (durableChatId && durableChatId !== options.chat.id) throw new Error("The durable conversation state belongs to another chat.");
  if (durableLatestId && durableLatestId !== target.id) throw new Error("The durable conversation state is stale. Verify the latest message again.");
  if (!options.watermark.verifiedAt || options.watermark.newestTimestampMs === null) {
    throw new Error("The exact latest message has not been verified.");
  }

  const allHuman = orderedEvents(options.chatEvents).filter(isHumanText);
  const story = buildStory(options.chatEvents).map((event) => {
    const timestampMs = event.timestampMs as number;
    const ageMs = Math.max(0, options.nowMs - timestampMs);
    const requestedFact = event.direction === "contact" && analyzeReplySafety(event.text).requiresCurrentFact;
    return {
      id: event.id,
      speaker: event.direction === "owner" ? "OWNER" as const : "OTHER" as const,
      speakerName: event.direction === "owner" ? "You" : event.senderName || "Other person",
      text: event.text,
      timestampMs,
      timestampIso: new Date(timestampMs).toISOString(),
      ageMs,
      isTarget: event.id === target.id,
      temporalStatus: event.id === target.id || ageMs <= 24 * 60 * 60 * 1_000
        ? "current" as const
        : ageMs <= 30 * 24 * 60 * 60 * 1_000
          ? "historical" as const
          : "expired" as const,
      factAuthority: event.direction === "owner"
        ? "owner_asserted" as const
        : requestedFact
          ? "other_requested" as const
          : "other_asserted" as const,
    };
  });
  const targetPersonId = options.chat.participantIds.find((participantId) => !options.ownerIds.includes(participantId))
    || [...options.chatEvents].reverse().find((event) => event.direction === "contact" && event.senderId)?.senderId
    || `chat:${options.chat.id}:contact`;
  const graphTenantId = tenantScopeId || "local-installation";
  const graphAccountId = accountScopeId || "local-device-vault";
  const targetRelationshipGraphId = `trg_${opaqueGraphDigest("mycrobo-ggcp-target-relationship-v1", [
    graphTenantId,
    graphAccountId,
    options.chat.kind === "group" ? `group:${options.chat.id}` : `person:${targetPersonId}`,
  ]).slice(0, 40)}`;
  const graphBoundary = { tenantId: graphTenantId, targetRelationshipGraphId };
  const explicitUserIntent = options.userIntent?.trim().slice(0, 500) || null;
  const graphEvidenceMetadata: DraftContext["graphGrounding"]["evidence"] = story.map((event) => ({
    messageId: event.id,
    evidenceId: `ev_${opaqueGraphDigest("mycrobo-ggcp-evidence-v1", [targetRelationshipGraphId, event.id]).slice(0, 40)}`,
    sourceRecordId: `tgs_${opaqueGraphDigest("mycrobo-ggcp-source-v1", [graphAccountId, options.chat.id, event.id]).slice(0, 40)}`,
    recordedAt: event.timestampIso,
    sourceType: "message" as const,
  }));
  if (explicitUserIntent) {
    graphEvidenceMetadata.push({
      messageId: null,
      evidenceId: `ev_${opaqueGraphDigest("mycrobo-ggcp-user-evidence-v1", [targetRelationshipGraphId, explicitUserIntent]).slice(0, 40)}`,
      sourceRecordId: `tgs_${opaqueGraphDigest("mycrobo-ggcp-user-source-v1", [graphAccountId, targetRelationshipGraphId, explicitUserIntent]).slice(0, 40)}`,
      recordedAt: options.watermark.verifiedAt,
      sourceType: "explicit-user-input",
    });
  }
  const factBearingMessageIds = new Set(story.filter((event) =>
    event.factAuthority === "owner_asserted"
    || (event.factAuthority === "other_asserted" && !/\?/u.test(event.text))).map((event) => event.id));
  const factEvaluationNowMs = Date.now();
  const graphFactMetadata: DraftContext["graphGrounding"]["facts"] = graphEvidenceMetadata
    .filter((entry) => entry.sourceType === "explicit-user-input" || (entry.messageId && factBearingMessageIds.has(entry.messageId)))
    .map((entry) => {
      const event = entry.messageId ? story.find((candidate) => candidate.id === entry.messageId) : null;
      const authority = entry.sourceType === "explicit-user-input"
        ? "explicit-user-input" as const
        : event!.factAuthority as "owner_asserted" | "other_asserted";
      const value = entry.sourceType === "explicit-user-input" ? explicitUserIntent! : event!.text;
      // Message timestamps and the injected evaluation clock may use a
      // deterministic fixture epoch. Normalize the fact lifecycle onto the
      // current wall clock while retaining exact source time in provenance.
      const sourceTimestampMs = entry.sourceType === "explicit-user-input" ? options.nowMs : event!.timestampMs;
      const observedAtMs = factEvaluationNowMs + (sourceTimestampMs - options.nowMs);
      return {
        factId: `fact_${opaqueGraphDigest("mycrobo-ggcp-fact-v1", [targetRelationshipGraphId, entry.evidenceId]).slice(0, 40)}`,
        evidenceId: entry.evidenceId,
        sourceRecordId: entry.sourceRecordId,
        authority,
        confidence: authority === "other_asserted" ? 0.9 : 1,
        status: "current" as const,
        safeToRepeat: graphFactSafeToRepeat(value),
        observedAt: new Date(observedAtMs).toISOString(),
        validFrom: new Date(observedAtMs).toISOString(),
        expiresAt: new Date(observedAtMs + GGCP_FACT_TTL_MS).toISOString(),
        supersededAt: null,
        supersededByFactId: null,
      };
    });
  const graphEvidenceContent = new Map(graphEvidenceMetadata.map((entry) => [entry.evidenceId,
    entry.sourceType === "explicit-user-input"
      ? explicitUserIntent!
      : story.find((candidate) => candidate.id === entry.messageId)!.text]));
  const targetGraphContext = buildGraphGroundedContext({
    boundary: graphBoundary,
    targetGraph: {
      ...graphBoundary,
      evidence: graphEvidenceMetadata.map((entry) => {
        return {
          ...graphBoundary,
          evidenceId: entry.evidenceId,
          kind: entry.sourceType === "explicit-user-input" ? "explicit-user-input" as const : "message" as const,
          content: graphEvidenceContent.get(entry.evidenceId)!,
          provenance: {
            ...graphBoundary,
            sourceRecordId: entry.sourceRecordId,
            sourceType: entry.sourceType,
            recordedAt: entry.recordedAt,
            extractorVersion: "mycrobo-draft-ggcp-v1",
          },
        };
      }),
      facts: graphFactMetadata.map((fact) => {
        const evidence = graphEvidenceMetadata.find((entry) => entry.evidenceId === fact.evidenceId)!;
        return {
          ...graphBoundary,
          factId: fact.factId,
          value: graphEvidenceContent.get(fact.evidenceId)!,
          evidenceIds: [fact.evidenceId],
          provenance: [{
            ...graphBoundary,
            sourceRecordId: fact.sourceRecordId,
            sourceType: evidence.sourceType,
            recordedAt: evidence.recordedAt,
            extractorVersion: "mycrobo-draft-ggcp-v1",
          }],
          confidence: fact.confidence,
          status: fact.status,
          safeToRepeat: fact.safeToRepeat,
          observedAt: fact.observedAt,
          validFrom: fact.validFrom,
          expiresAt: fact.expiresAt,
          supersededAt: fact.supersededAt,
          supersededByFactId: fact.supersededByFactId,
        };
      }),
    },
    now: factEvaluationNowMs,
  });
  const targetMessageEvidenceId = graphEvidenceMetadata.find((entry) => entry.messageId === target.id)?.evidenceId;
  if (!targetMessageEvidenceId) throw new Error("The verified draft target is missing from the target relationship graph.");
  const graphGrounding: DraftContext["graphGrounding"] = {
    protocol: "ggcp-v1",
    tenantId: graphTenantId,
    targetRelationshipGraphId,
    graphVersion: graphVersionForStory(targetRelationshipGraphId, story, explicitUserIntent),
    targetMessageEvidenceId,
    evidence: graphEvidenceMetadata,
    facts: graphFactMetadata,
    factIds: [...targetGraphContext.provenance.factIds],
  };
  const learningAblation = ["account-baseline", "neutral"].includes(String(options.learningAblation))
    ? options.learningAblation as "account-baseline" | "neutral"
    : "none";
  const targetRelationshipChatIds = new Set([...(options.allChats || []), options.chat]
    .filter((chat) => chat.id === options.chat.id || (
      options.chat.kind === "direct"
      && chat.kind === "direct"
      && chat.participantIds.includes(targetPersonId)
    ))
    .map((chat) => chat.id));
  const learningEvents = learningAblation === "neutral"
    ? []
    : learningAblation === "account-baseline"
      ? options.allEvents.filter((event) => !targetRelationshipChatIds.has(event.chatId))
      : options.allEvents;
  const evidenceCutoffMs = target.timestampMs ?? options.watermark.newestTimestampMs;
  const chronologicalLearningEvents = learningEvents.filter((event) =>
    event.timestampVerified && event.timestampMs !== null && event.timestampMs <= evidenceCutoffMs);
  const samples = buildToneSamplePool({
    allEvents: chronologicalLearningEvents,
    relationshipChatId: options.chat.id,
    nowMs: options.nowMs,
  }).map((sample) => ({ ...sample, relationshipSpecific: targetRelationshipChatIds.has(sample.chatId) }));
  const personSpecific = samples.filter((sample) => sample.relationshipSpecific).map((sample) => sample.text);
  const general = samples.filter((sample) => !sample.relationshipSpecific).map((sample) => sample.text);
  const total = samples.length;
  const memory = relationshipMemory(learningAblation === "none" ? options.chatEvents : [], target.text);
  const observedProfile = buildChatRelationshipProfile(options.chat, options.chatEvents);
  const emptyProfile = buildChatRelationshipProfile(options.chat, []);
  const profile = learningAblation === "none"
    ? observedProfile
    : learningAblation === "account-baseline"
      ? {
        ...emptyProfile,
        scenarioRelationship: observedProfile.scenarioRelationship,
        scenarioRelationshipConfidence: observedProfile.scenarioRelationshipConfidence,
      }
      : emptyProfile;
  const targetStoryIndex = Math.max(0, story.findIndex((event) => event.id === target.id));
  let currentTurnStart = targetStoryIndex;
  while (currentTurnStart > 0 && story[currentTurnStart - 1]?.speaker === "OTHER") {
    const previous = story[currentTurnStart - 1];
    const next = story[currentTurnStart];
    if (next.timestampMs - previous.timestampMs > 30 * 60 * 1_000) break;
    currentTurnStart -= 1;
  }
  const currentIncomingTurn = story.slice(currentTurnStart, targetStoryIndex + 1)
    .filter((event) => event.speaker === "OTHER")
    .map((event) => event.text)
    .join("\n");
  const originalIncomingText = currentIncomingTurn || target.text;
  const translatedText = String(options.semanticTranslation?.translatedText || "").replace(/\s+/gu, " ").trim().slice(0, 2_000);
  const languageBridge = translatedText && translatedText !== originalIncomingText.trim()
    ? {
      sourceLanguage: options.semanticTranslation!.sourceLanguage,
      targetLanguage: "English" as const,
      translatedText,
      localOnly: true as const,
      use: "semantic-understanding-only" as const,
    }
    : null;
  const reasoningText = languageBridge
    ? `${originalIncomingText}\n[Local English meaning: ${languageBridge.translatedText}]`
    : originalIncomingText;
  // Preserve the original turn for language/style detection while allowing a
  // separately encoded local translation to improve semantic recall. The two
  // are never concatenated for cosine similarity, which previously diluted
  // short Roman Hindi/Gujarati turns.
  const semanticQueryVariants = languageBridge
    ? [originalIncomingText, languageBridge.translatedText]
    : [originalIncomingText];
  const behavioralDNA = buildBehavioralDNA(memory.interactions, reasoningText, profile.scenarioRelationship);
  // The owner-global prior is a genuine backoff. Exclude every chat belonging
  // to the target person so exact-person observations are not counted twice
  // and cannot masquerade as independent account-wide support.
  const ownerGlobalLearningEvents = chronologicalLearningEvents.filter((event) => !targetRelationshipChatIds.has(event.chatId));
  const accountBehavioralProfile = ownerGlobalBehavioralProfile(ownerGlobalLearningEvents, reasoningText, graphBoundary, graphAccountId);
  const accountBehavioralDNA = accountBehavioralProfile.dna;
  const relationship = {
    ...memory,
    profile,
    behavioralDNA,
    ownerGlobalBehavioralDNA: accountBehavioralDNA,
    ownerGlobalBehavioralDNAProvenance: accountBehavioralProfile.provenance,
    stylePolicy: selectBehavioralStylePolicy({
      incomingText: currentIncomingTurn || target.text,
      personDNA: conditionPersonStyleDNA(behavioralDNA),
      ownerGlobalDNA: accountBehavioralDNA,
      preferences: options.preferences,
    }),
    similarProfile: similarRelationshipProfile({
      targetProfile: profile,
      boundary: graphBoundary,
      accountScopeId: graphAccountId,
      excludedChatIds: [...targetRelationshipChatIds],
      allChats: options.allChats,
      allEvents: chronologicalLearningEvents,
      personExampleCount: personSpecific.length,
      interactionCount: memory.interactionCount,
      activeBehaviorSampleCount: behavioralDNA.active.sampleCount,
      targetText: currentIncomingTurn || target.text,
    }),
  };
  const queryText = reasoningText;
  // Prefer the bridge's alias-resolved canonical participant. Sender ids can
  // vary between LID and phone-JID messages for the same WhatsApp person.
  // Audit baselines anonymize it so a person-conditioned forest leaf cannot
  // survive after the person's episodes have been removed.
  const retrievalPersonId = learningAblation === "none"
    ? options.chat.kind === "group" ? `group:${options.chat.id}` : targetPersonId
    : `audit:${learningAblation}:anonymous`;
  const currentChatForRetrieval: CanonicalChat = options.chat.participantIds.includes(targetPersonId)
    ? options.chat
    : { ...options.chat, participantIds: [...new Set([...options.chat.participantIds, targetPersonId])] };
  const retrievalChats = new Map<string, CanonicalChat>();
  for (const chat of options.allChats || []) {
    if (learningAblation === "account-baseline" && targetRelationshipChatIds.has(chat.id)) continue;
    if (learningAblation === "neutral") continue;
    retrievalChats.set(chat.id, chat);
  }
  retrievalChats.set(currentChatForRetrieval.id, currentChatForRetrieval);
  const retrievalEvents = new Map<string, MessageEvent>();
  for (const event of [...chronologicalLearningEvents, ...(learningAblation === "none" ? options.chatEvents : [])]) retrievalEvents.set(`${event.chatId}:${event.id}`, event);
  const allRetrievalEvents = [...retrievalEvents.values()];
  // A group is its own relationship graph. Direct conversations with any
  // member, and other groups containing that member, cannot become group
  // context merely because participant ordering selected that person first.
  const contextualRetrievalChats = options.chat.kind === "group"
    ? [currentChatForRetrieval]
    : [...retrievalChats.values()];
  const contextualRetrievalEvents = options.chat.kind === "group"
    ? allRetrievalEvents.filter((event) => event.chatId === options.chat.id)
    : allRetrievalEvents;
  const personRelationshipModel = buildPersonRelationshipModel({
    personId: retrievalPersonId,
    chats: contextualRetrievalChats,
    events: contextualRetrievalEvents,
    nowMs: options.nowMs,
  });
  const responseEpisodes = retrieveResponseEpisodes({
    queryText: originalIncomingText,
    queryVariants: semanticQueryVariants,
    currentStoryText: story.slice(Math.max(0, targetStoryIndex - 11), targetStoryIndex).map((event) => event.text),
    relationship: profile.scenarioRelationship,
    interactions: memory.interactions,
    activeScenario: behavioralDNA.activeScenario,
    nowMs: options.nowMs,
    timestampByMessageId: new Map(options.chatEvents
      .filter((event): event is MessageEvent & { timestampMs: number } => event.timestampVerified && event.timestampMs !== null)
      .map((event) => [event.id, event.timestampMs])),
  });
  // The connector account id alone is not a tenant boundary: two tenants can
  // legitimately connect accounts with the same provider-local identifier.
  // Namespace every learned cache/model by both authenticated tenant and
  // connector account, while preserving the verified account check above.
  const learningScopeId = tenantScopeId
    ? `tenant:${tenantScopeId}\u001faccount:${accountScopeId}`
    : accountScopeId || "local-device-vault";
  const scopedRetrievalChats = [...retrievalChats.values()].map((chat) => ({ ...chat, accountScopeId: learningScopeId }));
  const scopedRetrievalEvents = allRetrievalEvents.map((event) => ({ ...event, accountScopeId: learningScopeId }));
  const dynamicPhraseBank = buildDynamicPhraseBank({
    accountScopeId: learningScopeId,
    chats: scopedRetrievalChats,
    events: scopedRetrievalEvents,
    ownerIds: options.ownerIds,
    nowMs: options.nowMs,
  });
  const scenarioTrainingEpisodes = scenarioTrainingEpisodesFromHistory({
    accountScopeId: learningScopeId,
    chats: scopedRetrievalChats,
    events: scopedRetrievalEvents,
    ownerIds: options.ownerIds,
  });
  let scenarioForest: ScenarioForestPrediction | null = null;
  if (scenarioTrainingEpisodes.length) {
    const forest = trainScenarioForestCached(scenarioTrainingEpisodes, {
      accountScopeId: learningScopeId,
      treeCount: 31,
      maxDepth: 6,
      maximumExamples: 12_000,
    });
    scenarioForest = predictScenarioForest(forest, {
      accountScopeId: learningScopeId,
      personId: retrievalPersonId,
      relationship: profile.scenarioRelationship,
      incomingText: queryText,
      storyText: story.slice(-12).map((event) => event.text),
    }, { topK: 8 });
  }
  // The forest is evidence, not an oracle. Sparse leaves and diffuse thermal
  // clouds must defer to the multilingual intent posterior instead of allowing
  // one historical episode to seize the route. As evidence concentrates, the
  // learned forest can carry up to 75% of the routing mass.
  const meanLeafEvidence = Number(scenarioForest?.calibration.meanLeafEvidence || 0);
  const forestWeight = Number((scenarioForest
    ? Math.max(0, Math.min(0.75, (1 - scenarioForest.uncertainty) * Math.min(1, meanLeafEvidence / 12)))
    : 0).toFixed(4));
  const rulePriorWeight = Number((1 - forestWeight).toFixed(4));
  const blendedScenarioScores = new Map<string, number>();
  const ruleScenarioScores = new Map<string, number>();
  const forestScenarioScores = new Map<string, number>();
  for (const candidate of behavioralDNA.activeScenario.candidates || []) {
    const contribution = rulePriorWeight * candidate.probability;
    ruleScenarioScores.set(candidate.code, contribution);
    blendedScenarioScores.set(candidate.code, (blendedScenarioScores.get(candidate.code) || 0) + contribution);
  }
  for (const candidate of scenarioForest?.topCells || []) {
    // Use probability in the complete 1,500-cell posterior. `probability` is
    // normalized only within the displayed top-K and would overstate a diffuse
    // forest when its retained absolute mass is small.
    const contribution = forestWeight * candidate.absoluteProbability;
    forestScenarioScores.set(candidate.code, contribution);
    blendedScenarioScores.set(candidate.code, (blendedScenarioScores.get(candidate.code) || 0) + contribution);
  }
  const rankedScenarioRoutes = [...blendedScenarioScores]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  const forestCodes = rankedScenarioRoutes.map(([code]) => code);
  const targetScenarioCode = forestCodes[0] || behavioralDNA.activeScenario.code;
  const selectedPhraseBank = selectDynamicPhrases(dynamicPhraseBank, {
    personId: retrievalPersonId,
    cstCode: targetScenarioCode,
    adjacentCstCodes: forestCodes.slice(1).length
      ? forestCodes.slice(1)
      : (behavioralDNA.activeScenario.candidates || []).map((candidate) => candidate.code),
    relationship: profile.scenarioRelationship,
    incomingIntent: behavioralDNA.activeIntent,
    language: detectWritingMode(originalIncomingText),
    nowMs: options.nowMs,
    limit: 6,
    recentPatternIds: (options.phraseSelectionSignals?.recentPatternIds || []).filter((value): value is string => typeof value === "string").slice(-64),
    recentTemplateFingerprints: (options.phraseSelectionSignals?.recentTemplateFingerprints || []).filter((value): value is string => typeof value === "string").slice(-64),
    feedbackSignals: (options.phraseSelectionSignals?.feedbackSignals || []).filter((value): value is PhraseFeedbackSignal => Boolean(value && typeof value === "object")).slice(-128),
  });
  // Phrase surfaces from another relationship graph are content, even when
  // fact-slotted. Only patterns belonging to this target person may enter a
  // production DraftContext. Cross relationships are represented separately
  // by BehavioralDNA and other content-free routing policies.
  const phraseBank: PhraseBankSelection = {
    ...selectedPhraseBank,
    fallbackOrder: selectedPhraseBank.fallbackOrder.filter((tier) => tier === "person-cst" || tier === "person-adjacent-cst"),
    selected: selectedPhraseBank.selected.filter((pattern) =>
      (pattern.tier === "person-cst" || pattern.tier === "person-adjacent-cst")
      && pattern.provenance.chatIds.length > 0
      && pattern.provenance.chatIds.every((chatId) => targetRelationshipChatIds.has(chatId))),
  };
  const retrieval = {
    targetPersonId: retrievalPersonId,
    scenarioCode: targetScenarioCode,
    episodes: responseEpisodes,
    semanticEvidence: retrieveContext({
      queryText: originalIncomingText,
      queryVariants: semanticQueryVariants,
      currentStory: options.chatEvents.filter((event) => event.timestampVerified && event.timestampMs !== null && event.timestampMs <= (target.timestampMs || 0)),
      currentTimestampMs: target.timestampMs || 0,
      currentChat: currentChatForRetrieval,
      targetPersonId: retrievalPersonId,
      chats: contextualRetrievalChats,
      events: contextualRetrievalEvents,
      relationshipModel: personRelationshipModel,
      nowMs: options.nowMs,
      limit: 24,
    }),
    phraseBank,
    scenarioForest,
    scenarioPosterior: scenarioForest,
    routingBlend: {
      forestWeight: Number(forestWeight.toFixed(4)),
      rulePriorWeight: Number(rulePriorWeight.toFixed(4)),
      rankedCodes: rankedScenarioRoutes.slice(0, 8).map(([code, blendedWeight]) => ({
        code,
        blendedWeight: Number(blendedWeight.toFixed(6)),
        forestContribution: Number((forestScenarioScores.get(code) || 0).toFixed(6)),
        ruleContribution: Number((ruleScenarioScores.get(code) || 0).toFixed(6)),
      })),
    },
    repetition: {
      recentPatternIds: (options.phraseSelectionSignals?.recentPatternIds || [])
        .filter((value): value is string => typeof value === "string").slice(-64),
      recentTemplateFingerprints: (options.phraseSelectionSignals?.recentTemplateFingerprints || [])
        .filter((value): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value)).slice(-64),
    },
  };
  const safety = analyzeReplySafety(queryText);
  const stage = total >= 30 && personSpecific.length >= 8
    ? "established"
    : total >= 12
      ? "developing"
      : "learning";

  return {
    scope: {
      tenantScopeId: tenantScopeId || "local-installation",
      accountScopeId: accountScopeId || "local-device-vault",
      isolation: tenantScopeId ? "strict-tenant-account" : accountScopeId ? "strict-account" : "local-installation",
    },
    graphGrounding,
    chat: { id: options.chat.id, title: options.chat.title, kind: options.chat.kind },
    freshness: {
      verifiedAt: options.watermark.verifiedAt,
      newestTimestampMs: options.watermark.newestTimestampMs,
      targetMessageId: target.id,
    },
    currentIncomingTurn: {
      messageIds: story.slice(currentTurnStart, targetStoryIndex + 1).filter((event) => event.speaker === "OTHER").map((event) => event.id),
      text: currentIncomingTurn || target.text,
    },
    ...(languageBridge ? { languageBridge } : {}),
    story,
    coverage: {
      humanMessagesConsidered: allHuman.length,
      storyEventsIncluded: story.length,
      reachedBeginning: options.watermark.reachedBeginning,
    },
    tone: {
      stage,
      // Cross-relationship sentences never enter a DraftContext. The
      // content-free ownerGlobalBehavioralDNA is the only general fallback.
      generalExamples: [],
      personSpecificExamples: personSpecific.slice(0, 24),
    },
    relationship,
    retrieval,
    safety,
    conversationState: options.conversationState || null,
    userIntent: explicitUserIntent,
    preferences: {
      draftLanguage: ["English", "Roman Hindi", "Roman Gujarati"].includes(String(options.preferences?.draftLanguage))
        ? options.preferences?.draftLanguage as DraftContext["preferences"]["draftLanguage"]
        : "match",
      replyLength: ["short", "medium"].includes(String(options.preferences?.replyLength))
        ? options.preferences?.replyLength as DraftContext["preferences"]["replyLength"]
        : "match",
      formality: ["casual", "neutral", "formal"].includes(String(options.preferences?.formality))
        ? options.preferences?.formality as DraftContext["preferences"]["formality"]
        : "match",
      emoji: ["avoid", "use"].includes(String(options.preferences?.emoji))
        ? options.preferences?.emoji as DraftContext["preferences"]["emoji"]
        : "match",
    },
  };
}

export function validateDraftOutput(value: unknown, context?: DraftContext) {
  if (!value || typeof value !== "object") throw new Error("The drafting engine returned an invalid result.");
  const candidate = value as { draft?: unknown; language?: unknown; intent?: unknown; evidenceIds?: unknown; alternatives?: unknown; candidateCount?: unknown; evaluator?: unknown; personalizationBasis?: unknown; phrasePatternBinding?: unknown; generationRoute?: unknown; providerName?: unknown; providerModel?: unknown; providerTransport?: unknown; providerFailureClass?: unknown; providerAttempted?: unknown; providerEligible?: unknown; fallbackProvider?: unknown };
  let draft = typeof candidate.draft === "string" ? candidate.draft.trim() : "";
  if (!draft || draft.length > 800) throw new Error("The drafting engine returned an unsafe reply length.");
  const language = typeof candidate.language === "string" ? candidate.language.trim().slice(0, 80) : "unknown";
  const evidenceIds = Array.isArray(candidate.evidenceIds)
    ? candidate.evidenceIds.filter((id): id is string => typeof id === "string").slice(0, 20)
    : [];
  if (context?.graphGrounding) {
    const evidenceByMessageId = new Map(context.graphGrounding.evidence.map((item) => [item.messageId, item.evidenceId]));
    const unknownEvidenceId = evidenceIds.find((id) => !evidenceByMessageId.has(id));
    if (unknownEvidenceId) {
      throw new Error("The drafting engine cited evidence outside the target relationship graph.");
    }
    if (!evidenceIds.includes(context.freshness.targetMessageId)) {
      throw new Error("The drafting engine did not cite the verified target message in the target relationship graph.");
    }
    const graphContext = graphContextFromDraftContext(context);
    const boundary = {
      tenantId: context.graphGrounding.tenantId,
      targetRelationshipGraphId: context.graphGrounding.targetRelationshipGraphId,
    };
    const factsUsed = new Map<string, GraphGroundedContext["facts"][number]>();
    for (const claim of factualClaimsInDraft(draft)) {
      const firstPersonClaim = FIRST_PERSON_FACTUAL_CLAIM.test(claim);
      const supportingFact = graphContext.facts.find((fact) => {
        if (!factSupportsClaim(fact.value, claim)) return false;
        if (!firstPersonClaim) return true;
        const metadata = context.graphGrounding.facts.find((item) => item.factId === fact.factId);
        return metadata?.authority === "owner_asserted" || metadata?.authority === "explicit-user-input";
      });
      if (!supportingFact) {
        // Existing safety handling replaces an unsupported first-person
        // commitment with an editable abstention before anything is shown.
        // It therefore must be allowed to reach that fail-closed rewrite;
        // every other unsupported declarative claim is rejected here.
        if (context && !context.userIntent && context.safety.requiresCurrentFact && containsUnverifiedCommitment(draft)) continue;
        throw new Error("The drafting engine produced a factual claim that is not grounded in the target relationship graph.");
      }
      factsUsed.set(supportingFact.factId, supportingFact);
    }
    validateGraphGroundedCandidate({
      boundary,
      context: graphContext,
      candidate: {
        ...boundary,
        candidateId: `candidate_${opaqueGraphDigest("mycrobo-ggcp-candidate-v1", [context.graphGrounding.graphVersion, draft, evidenceIds]).slice(0, 40)}`,
        draft,
        factsUsed: [...factsUsed.values()].map((fact) => ({
          ...boundary,
          factId: fact.factId,
        })),
        evidenceUsed: evidenceIds.map((messageId) => ({
          ...boundary,
          evidenceId: evidenceByMessageId.get(messageId)!,
        })),
      },
    });
  }
  let safetyIntervention = false;
  const providerPlaceholders = unresolvedDraftPlaceholders(draft);
  const structuredInputs = context?.safety.requiredInputs || [];
  const requiredFacts = new Set(context?.safety.requiredFacts || []);
  // A direct imperative such as "phone kro" contains no missing external
  // fact. The editable draft may propose accepting it because the user's
  // final Send click is the deliberate acceptance. Availability, status,
  // location, date and time questions still require explicit user input.
  const commitmentOnly = requiredFacts.size === 1 && requiredFacts.has("commitment") && structuredInputs.length === 0;
  const hasEveryStructuredToken = structuredInputs.every((item) => draft.includes(item.token));
  if (context && !context.userIntent && (
    (structuredInputs.length > 0 && !hasEveryStructuredToken)
    || (structuredInputs.length === 0 && context.safety.requiresCurrentFact && !commitmentOnly && providerPlaceholders.length === 0)
    || (containsUnverifiedCommitment(draft) && structuredInputs.length === 0 && !commitmentOnly)
  )) {
    draft = structuredInputs.length ? structuredFactTemplate(context) : safeFactPlaceholder(context);
    safetyIntervention = true;
  }
  const unresolvedSlots = unresolvedDraftPlaceholders(draft);
  const alternatives = Array.isArray(candidate.alternatives)
    ? candidate.alternatives.filter((item): item is string => typeof item === "string")
      .map((item) => item.trim()).filter((item, index, all) => item && item !== draft && [...item].length <= 800 && all.indexOf(item) === index).slice(0, 3)
    : [];
  const generationRoute = typeof candidate.generationRoute === "string" ? candidate.generationRoute.trim().slice(0, 40) : "unspecified";
  const providerFailure = typeof candidate.providerFailureClass === "string" ? candidate.providerFailureClass.trim().slice(0, 80) : "";
  const providerName = typeof candidate.providerName === "string" ? candidate.providerName.trim().slice(0, 80) : "";
  const providerModel = typeof candidate.providerModel === "string" ? candidate.providerModel.trim().slice(0, 120) : "";
  const providerTransport = typeof candidate.providerTransport === "string" ? candidate.providerTransport.trim().slice(0, 80) : "";
  const providerAttempted = typeof candidate.providerAttempted === "string" ? candidate.providerAttempted.trim().slice(0, 160) : "";
  const providerEligible = typeof candidate.providerEligible === "string" ? candidate.providerEligible.trim().slice(0, 160) : "";
  const fallbackProvider = typeof candidate.fallbackProvider === "string" ? candidate.fallbackProvider.trim().slice(0, 160) : "";
  const rawBasis = typeof candidate.personalizationBasis === "string" ? candidate.personalizationBasis.trim() : "unreported";
  const basis = rawBasis === "same-person-semantic-plan"
    ? "same-person-semantic"
    : ["relationship-semantic-fallback", "relationship-style-fallback"].includes(rawBasis)
      ? "relationship-fallback"
      : ["owner-global-semantic-fallback", "owner-global-style-fallback"].includes(rawBasis)
        ? "owner-global-fallback"
        : rawBasis === "same-person-style-only"
          ? "same-person-style-only"
          : "none";
  const suppliedBinding = candidate.phrasePatternBinding && typeof candidate.phrasePatternBinding === "object"
    ? candidate.phrasePatternBinding as { patternId?: unknown; phraseProvenanceFingerprint?: unknown; phraseTemplateFingerprint?: unknown }
    : null;
  const patternId = typeof suppliedBinding?.patternId === "string" ? suppliedBinding.patternId.slice(0, 120) : "";
  const fingerprint = /^[a-f\d]{64}$/u;
  const selectedPattern = (context?.retrieval?.phraseBank?.selected || []).find((pattern) => pattern.id === patternId);
  const expectedProvenanceFingerprint = selectedPattern ? phraseProvenanceFingerprint(selectedPattern) : "";
  const expectedTemplateFingerprint = selectedPattern ? phraseTemplateFingerprint(selectedPattern.styleFragments.surfaceTemplate) : "";
  const phrasePatternBinding = !safetyIntervention
    && ["same-person-semantic-plan", "relationship-semantic-fallback", "owner-global-semantic-fallback"].includes(rawBasis)
    && /^[a-z\d][a-z\d_-]{0,119}$/iu.test(patternId)
    && typeof suppliedBinding?.phraseProvenanceFingerprint === "string"
    && typeof suppliedBinding?.phraseTemplateFingerprint === "string"
    && fingerprint.test(suppliedBinding.phraseProvenanceFingerprint)
    && fingerprint.test(suppliedBinding.phraseTemplateFingerprint)
    && suppliedBinding.phraseProvenanceFingerprint === expectedProvenanceFingerprint
    && suppliedBinding.phraseTemplateFingerprint === expectedTemplateFingerprint
      ? {
        patternId,
        phraseProvenanceFingerprint: suppliedBinding.phraseProvenanceFingerprint,
        phraseTemplateFingerprint: suppliedBinding.phraseTemplateFingerprint,
      }
      : null;
  const forest = context?.retrieval?.scenarioForest;
  const centroid = forest?.thermal?.centroid;
  const band = (input: unknown, low: number, high: number, labels: [string, string, string]) => {
    const numeric = Number(input);
    if (!Number.isFinite(numeric)) return "unknown";
    return numeric <= low ? labels[0] : numeric >= high ? labels[2] : labels[1];
  };
  const draftRoute = {
    version: 1,
    generation: {
      path: generationRoute || "unspecified",
      providerStatus: providerFailure
        ? generationRoute === "local-sensitive-data" ? "blocked-local-only" : "failed-fell-back"
        : generationRoute.startsWith("local")
          ? "not-used"
          : generationRoute === "standard" || generationRoute === "escalated"
            ? "succeeded"
            : "unreported",
      ...(providerFailure ? { failureClass: providerFailure } : {}),
      ...(providerName ? { provider: providerName } : {}),
      ...(providerModel ? { model: providerModel } : {}),
      ...(providerTransport ? { transport: providerTransport } : {}),
      ...(providerAttempted ? { attemptedProvider: providerAttempted } : {}),
      ...(providerEligible ? { eligibleProvider: providerEligible } : {}),
      ...(fallbackProvider ? { fallbackProvider } : {}),
    },
    personalization: {
      basis: safetyIntervention ? "none" : basis,
      evidenceTier: safetyIntervention ? "safety-template" : rawBasis,
      scenarioCode: String(context?.retrieval?.scenarioCode || "").slice(0, 40),
      ...(phrasePatternBinding ? { patternBinding: phrasePatternBinding } : {}),
    },
    scenario: {
      source: forest && Number(context?.retrieval?.routingBlend?.forestWeight || 0) > 0 ? "forest-rule-blend" : "rules-only",
      factEligible: false,
      uncertainty: forest ? band(forest.uncertainty, 0.38, 0.7, ["low", "medium", "high"]) : "unavailable",
      multimodal: forest?.thermal?.multimodal === true,
      hotspotCount: Array.isArray(forest?.thermal?.hotspots) ? Math.min(4, forest.thermal.hotspots.length) : 0,
      style: {
        valence: centroid ? band(centroid.valence, -0.2, 0.25, ["negative", "neutral", "positive"]) : "unknown",
        arousal: centroid ? band(centroid.arousal, 0.35, 0.68, ["low", "medium", "high"]) : "unknown",
        formality: centroid ? band(centroid.formality, 0.38, 0.68, ["casual", "neutral", "formal"]) : "unknown",
      },
    },
  };
  return {
    draft,
    language,
    evidenceIds,
    ...(Array.isArray(candidate.alternatives) ? { alternatives } : {}),
    ...(Number.isFinite(Number(candidate.candidateCount)) ? { candidateCount: Math.max(1, Math.min(8, Number(candidate.candidateCount))) } : {}),
    ...(typeof candidate.evaluator === "string" ? { evaluator: candidate.evaluator.slice(0, 80) } : {}),
    ...(typeof candidate.intent === "string" ? { intent: candidate.intent.trim().slice(0, 80) } : {}),
    generationRoute,
    ...(providerName ? { providerName } : {}),
    ...(providerModel ? { providerModel } : {}),
    ...(providerTransport ? { providerTransport } : {}),
    ...(providerAttempted ? { providerAttempted } : {}),
    ...(providerEligible ? { providerEligible } : {}),
    ...(fallbackProvider ? { fallbackProvider } : {}),
    ...(providerFailure ? { providerFailureClass: providerFailure } : {}),
    personalizationBasis: rawBasis,
    ...(phrasePatternBinding ? { phrasePatternBinding } : {}),
    draftRoute,
    requiresUserInput: unresolvedSlots.length > 0,
    unresolvedSlots,
    safetyIntervention,
    safetyNote: unresolvedSlots.length
      ? structuredInputs.length
        ? "Choose only the missing date or time. MyCrobo drafted the rest and did not infer a commitment from history."
        : "Complete the missing current fact before sending. Historical replies were used only for writing style."
      : null,
    requiredInputs: structuredInputs,
  };
}
