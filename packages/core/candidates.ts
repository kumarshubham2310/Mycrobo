export type DraftCandidate = {
  draft: string;
  language: string;
  evidenceIds: string[];
  intent?: string;
  uncertainties?: string[];
  prohibitedAssumptions?: string[];
};

export type CandidateEvaluation = {
  candidate: DraftCandidate;
  accepted: boolean;
  score: number;
  reasons: string[];
  components: {
    persona: number;
    relationship: number;
    context: number;
    channel: number;
    evidence: number;
    routing: number;
    riskPenalty: number;
  };
  gates: {
    audience: boolean;
    factuality: boolean;
    freshness: boolean;
    scope: boolean;
  };
};

const SECRET = /\b(?:otp|one[ -]?time password|password|passcode|pin|cvv|api[ _-]?key|secret|recovery code)\b|\b\d{6}\b/iu;
const ASSISTANT_TELL = /\b(?:as an ai|i hope this message finds you well|certainly!|i'd be happy to assist|please do not hesitate)\b/iu;
const FIRST_PERSON_COMMITMENT = /\b(?:i(?:'|’)ll|i will|i can|i am going to|we(?:'|’)ll|we will|we can|main|mai|mein|hum)\b.{0,64}\b(?:attend|bring|call|check|confirm|deliver|finish|forward|join|meet|pay|reach|reply|review|send|share|submit|update|visit|aaunga|aunga|aungi|bataunga|bataungi|bhejunga|bhejungi|karunga|karungi|moklish|pahunchunga|pahunchungi)\b/iu;
const REQUIRED_INPUT = /\[(?:add|confirm|enter|replace|say|select|write)\b[^\]\r\n]{0,120}\]|\{\{(?:date|time)\}\}/iu;
const GENERIC_ACKNOWLEDGEMENT = /^(?:(?:haan+|haa+|ha+)(?:[,\s]+(?:okay+|thee?k(?: hai)?|thik(?: hai)?|samajh gaya))?|okay+|ok+|hmm+|thee?k(?: hai)?|thik(?: hai)?|got it|noted|understood|thanks for (?:letting me know|the update|sharing)|bol|fine|sure|done)[\s.!👍🙂😊]*$/iu;
const AFFECTION = /\b(?:miss(?:ing)? you|miss u|pyar|pyaar|love you|need (?:your )?(?:love|affection)|hug|cuddle)\b/iu;
const EMOJI = /\p{Extended_Pictographic}/gu;
const ROMAN_GUJARATI = /\b(?:shu|su|kem|chhe|che|cho|chu|nathi|mane|tane|tamne|tame|mari|aav|jav|karu|karvu|thase|mokli|moklo|joi|joie|joine|kyare|atyare|savare|ketla|vage|pahoch|pohchi|janav|janavjo|lakho|kai|vandho|saras)\b/giu;
const ROMAN_HINDI = /\b(?:hai|hain|haan|nahi|nhi|kya|kyu|kyun|kab|kaise|kahan|kidhar|mein|mai|main|hu|ho|hoga|kar|karo|kro|karna|krna|karu|raha|rahe|rahi|bata|batao|bolo|likho|dena|aur|abhi|yaha|mujhe|meko|nikl|aaj|kal|subah|shaam|pahunch|koi|yaar|dekhta|bhej|bhejo|sahi|shi)\b/giu;
const CURRENT_TIME_WORD = /\b(?:today|tomorrow|tonight|now|later|morning|evening|aaj|kal|abhi|subah|shaam|savare)\b/iu;
const SAFE_STYLE_UTTERANCE = /^(?:(?:hi+|hii+|hey+|hello+|helo+|haan+|haa+|ha+|hmm+|okay+|ok+|acha+|achha+|thee?k+|thik+|fine|sure|done|got it|noted|anytime|welcome|koi na|kai nai|no worries|no problem)(?:\s+(?:bhai|bro|boss|sir|yaar|ji))?|[👍👌✅🙏🙂😊😂🤣❤️💕🥺]+)[\s.!…\p{Extended_Pictographic}]*$/iu;
const STYLE_FUNCTION_WORDS = new Set("a an the and or but if to of in on at for from with is are am be been being it this that these those i me my mine we us our you your yours he she they them his her their do does did can could will would should may might yes no not nahi nhi haan haa okay ok acha achha theek thik got noted sure fine done hi hii hey hello bhai bro boss sir yaar ji please pls plz koi kai na ne hu chu ho hai chhe che mein mai main hum tum tame aap aur pan ke ki ka ko se kya shu kem kyu kyun how what why when where".split(" "));

function cleanCandidate(value: unknown): DraftCandidate | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<DraftCandidate>;
  const draft = typeof raw.draft === "string" ? raw.draft.trim() : "";
  const language = typeof raw.language === "string" ? raw.language.trim().slice(0, 80) : "unknown";
  if (!draft || [...draft].length > 800) return null;
  return {
    draft,
    language: language || "unknown",
    evidenceIds: Array.isArray(raw.evidenceIds)
      ? raw.evidenceIds.filter((id): id is string => typeof id === "string").slice(0, 20)
      : [],
    intent: typeof raw.intent === "string" ? raw.intent.slice(0, 80) : undefined,
    uncertainties: Array.isArray(raw.uncertainties)
      ? raw.uncertainties.filter((item): item is string => typeof item === "string").slice(0, 10)
      : [],
    prohibitedAssumptions: Array.isArray(raw.prohibitedAssumptions)
      ? raw.prohibitedAssumptions.filter((item): item is string => typeof item === "string").slice(0, 10)
      : [],
  };
}

function normalized(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function words(value: string) {
  return normalized(value).split(/\s+/u).filter((word) => word.length > 1);
}

function tokenSimilarity(left: string, right: string) {
  const a = new Set(words(left));
  const b = new Set(words(right));
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / new Set([...a, ...b]).size;
}

function languageOf(value: string) {
  const gujaratiCount = value.match(ROMAN_GUJARATI)?.length || 0;
  const hindiCount = value.match(ROMAN_HINDI)?.length || 0;
  ROMAN_GUJARATI.lastIndex = 0;
  ROMAN_HINDI.lastIndex = 0;
  if (gujaratiCount >= 2 && gujaratiCount > hindiCount) return "Roman Gujarati";
  if (hindiCount >= 2 || hindiCount > gujaratiCount) return "Roman Hindi";
  if (gujaratiCount) return "Roman Gujarati";
  if (hindiCount) return "Roman Hindi";
  return "English";
}

function currentIncomingTurn(context: any, target: any) {
  const story = Array.isArray(context?.story) ? context.story : [];
  const targetIndex = Math.max(0, story.findIndex((event: any) => event === target || event?.id === target?.id));
  let start = targetIndex;
  while (start > 0 && story[start - 1]?.speaker === "OTHER") {
    const previous = story[start - 1];
    const next = story[start];
    const previousMs = Number(previous?.timestampMs ?? Date.parse(previous?.timestampIso || ""));
    const nextMs = Number(next?.timestampMs ?? Date.parse(next?.timestampIso || ""));
    if (Number.isFinite(previousMs) && Number.isFinite(nextMs) && nextMs - previousMs > 30 * 60 * 1_000) break;
    start -= 1;
  }
  return story.slice(start, targetIndex + 1).map((event: any) => String(event?.text || "")).join("\n");
}

function numberTokens(value: string) {
  return new Set(String(value || "").match(/\b\d+(?:[.:/-]\d+)*\b/gu) || []);
}

function unsupportedNumbers(draft: string, evidence: string) {
  const allowed = numberTokens(evidence);
  return [...numberTokens(draft)].filter((token) => !allowed.has(token));
}

const LOCATION_QUESTION = /(?:^|\b)(?:where|whereabouts|which location|kahan|kahaan|kidhar|kya location|kai jagya)(?:\b|\?)/iu;
const LOCATION_ASSERTION = /(?:^|\b)(?:(?:i am|i'm|im|we are|main|mai|mein|hum)\s+(?:at|in|near|outside|inside|home|office)|(?:at|in|near|outside|inside)\s+[\p{L}][\p{L}'’-]{2,}|[\p{L}][\p{L}'’-]{2,}\s+(?:mein|mai|par|pe)\s+(?:hu|hun|hoon|hain)|(?:ghar|office)\s+(?:par|pe|mein)\s+(?:hu|hun|hoon|hain))/iu;
const AVAILABILITY_QUESTION = /\b(?:are you|will you be|can you be|free|available|availability|aap free|tum free|tame free)\b[^?]{0,80}\?/iu;
const AVAILABILITY_ASSERTION = /\b(?:(?:i am|i'm|im|we are|main|mai|hum)\s+(?:free|available|busy|unavailable)|(?:free|available|busy|unavailable)\s+(?:hu|hun|hoon|chu|hain))\b/iu;
const CONCRETE_STATE_TERM = /\b(?:approv(?:e|ed|al)|accept(?:ed|ance)|reject(?:ed|ion)|paid|payment|invoice|bill|complete(?:d)?|finish(?:ed)?|done|ready|sent|shared|delivered|received|resolved|pending|status)\b/iu;
const CONCRETE_STATE_QUESTION = /(?:\?|^\s*(?:what|which|did|has|have|is|are|was|were|kya|shu|su|status)\b)/iu;
const CONCRETE_STATE_ASSERTION = /(?:^|\b)(?:(?:yes|no|haan|haa|nahi|nhi|approved|rejected|accepted|paid|done|ready|completed|finished|sent|shared|delivered|received|resolved|pending)\b|\b(?:i|we|main|mai|hum)\s+(?:have|had|did|approved|rejected|accepted|paid|completed|finished|sent|shared|delivered|received|resolved)|\b(?:payment|invoice|bill|approval|request|work|task|file|document|report|status|it|this|that)\b.{0,40}\b(?:is|was|has been|have been|ho gaya|ho gya|thai gayu)\b)/iu;
const RELATIONSHIP_ASSERTION = /\b(?:he|she|they|this person|ye|woh|wo)\s+(?:is|are|hai|hain|chhe)\s+(?:my|our|mera|meri|mere|hamara|apna)\s+[\p{L}][\p{L}'’-]{2,}/iu;
const NON_ASSERTIVE_REPLY = /\?|\[(?:add|confirm|enter|replace|say|select|write)\b|\b(?:let me (?:check|confirm)|i need to (?:check|confirm)|check karke|confirm karke|pehle confirm|first confirm)\b/iu;

function ownerGrounded(candidate: string, context: any) {
  const ownerEvidence = [
    ...(Array.isArray(context?.story) ? context.story.filter((event: any) => event?.speaker === "OWNER").map((event: any) => String(event?.text || "")) : []),
    String(context?.userIntent || ""),
  ].filter(Boolean).join("\n");
  if (!ownerEvidence.trim()) return false;
  const candidateTokens = contentTokens(candidate);
  const evidenceTokens = new Set(contentTokens(ownerEvidence));
  return candidateTokens.length > 0 && candidateTokens.filter((token) => evidenceTokens.has(token)).length >= Math.min(2, candidateTokens.length);
}

function unsupportedConcreteCurrentFact(candidate: string, context: any, incomingText: string) {
  if (String(context?.userIntent || "").trim() || REQUIRED_INPUT.test(candidate) || NON_ASSERTIVE_REPLY.test(candidate)) return "";
  if (LOCATION_ASSERTION.test(candidate) && !ownerGrounded(candidate, context)) {
    return LOCATION_QUESTION.test(incomingText)
      ? "The candidate invents the owner's current location."
      : "The candidate introduces an unverified current location.";
  }
  if (AVAILABILITY_ASSERTION.test(candidate) && !ownerGrounded(candidate, context)) {
    return AVAILABILITY_QUESTION.test(incomingText)
      ? "The candidate invents the owner's current availability."
      : "The candidate introduces unverified availability.";
  }
  const asksForConcreteState = CONCRETE_STATE_TERM.test(incomingText) && CONCRETE_STATE_QUESTION.test(incomingText);
  if (asksForConcreteState && CONCRETE_STATE_ASSERTION.test(candidate) && !ownerGrounded(candidate, context)) {
    return "The candidate invents an approval, payment, delivery, or status fact.";
  }
  if (RELATIONSHIP_ASSERTION.test(candidate) && !ownerGrounded(candidate, context)) {
    return "The candidate introduces an unverified relationship fact.";
  }
  return "";
}

function contentTokens(value: string) {
  return words(value).filter((token) => token.length > 2 && !STYLE_FUNCTION_WORDS.has(token));
}

function containsContentReplay(candidate: string, context: any) {
  if (SAFE_STYLE_UTTERANCE.test(candidate.trim())) return false;
  const story = Array.isArray(context?.story) ? context.story : [];
  const target = story.find((event: any) => event?.isTarget) || story.at(-1);
  // Only the verified incoming turn grounds the new answer. Older messages may
  // explain the relationship and story, but cannot turn a historical phrase
  // into reusable current content merely because it exists in the same chat.
  const currentStory = currentIncomingTurn(context, target);
  const currentTokens = new Set(contentTokens(currentStory));
  const candidateTokens = contentTokens(candidate);
  if (candidateTokens.length < 2) return false;
  const styleSources = [
    ...(Array.isArray(context?.tone?.personSpecificExamples) ? context.tone.personSpecificExamples : []),
    ...(Array.isArray(context?.tone?.generalExamples) ? context.tone.generalExamples : []),
    ...(Array.isArray(context?.relationship?.similarProfile?.examples) ? context.relationship.similarProfile.examples : []),
    ...(Array.isArray(context?.relationship?.interactions) ? context.relationship.interactions.map((item: any) => item?.ownerReply) : []),
  ].filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  for (const source of styleSources) {
    const sourceKey = normalized(source);
    const candidateKey = normalized(candidate);
    if (candidateKey === sourceKey && candidateTokens.filter((token) => !currentTokens.has(token)).length >= 3) return true;
    const sourceTokens = contentTokens(source);
    if (sourceTokens.length < 3) continue;
    for (let index = 0; index <= candidateTokens.length - 3; index += 1) {
      const phraseTokens = candidateTokens.slice(index, index + 3);
      if (phraseTokens.every((token) => currentTokens.has(token))) continue;
      if (sourceTokens.join(" ").includes(phraseTokens.join(" "))) return true;
    }
  }
  return false;
}

function personaEvidenceScore(candidate: DraftCandidate, context: any) {
  const person = (Array.isArray(context?.tone?.personSpecificExamples) ? context.tone.personSpecificExamples : []).filter((item: unknown): item is string => typeof item === "string");
  const profile = (Array.isArray(context?.relationship?.similarProfile?.examples) ? context.relationship.similarProfile.examples : []).filter((item: unknown): item is string => typeof item === "string");
  const general = (Array.isArray(context?.tone?.generalExamples) ? context.tone.generalExamples : []).filter((item: unknown): item is string => typeof item === "string");
  const interactions = (Array.isArray(context?.relationship?.interactions) ? context.relationship.interactions : []).map((item: any) => item?.ownerReply).filter((item: unknown): item is string => typeof item === "string");
  // Evidence volume controls confidence; historical wording is never the
  // objective. Situation-conditioned behavioral DNA scores the actual style.
  if (interactions.length >= 4) return 10;
  if (interactions.length || person.length >= 4) return 7;
  if (person.length) return 5;
  if (profile.length) return 3;
  return general.length ? 1 : 0;
}

function canonicalWritingMode(value: string) {
  if (["Hindi", "Roman Hindi"].includes(value)) return "Roman Hindi";
  if (["Gujarati", "Roman Gujarati"].includes(value)) return "Roman Gujarati";
  return value === "Mixed" ? "Mixed" : "English";
}

function behavioralDNAScore(candidate: DraftCandidate, context: any) {
  const personDNA = context?.relationship?.behavioralDNA;
  const peerDNA = context?.relationship?.similarProfile?.behavioralDNA;
  const accountDNA = context?.relationship?.ownerGlobalBehavioralDNA;
  const personStrong = Number(personDNA?.active?.sampleCount || 0) >= 2;
  const peerFallback = !personStrong && Boolean(peerDNA?.active?.sampleCount);
  const accountFallback = !personStrong && !peerFallback && Boolean(accountDNA?.active?.sampleCount);
  const dna = personStrong
    ? personDNA
    : peerFallback
      ? peerDNA
      : accountFallback
        ? accountDNA
        : personDNA;
  if (!dna || typeof dna !== "object") return 0;
  const active = dna.active?.sampleCount ? dna.active : dna.global;
  if (!active?.sampleCount) return 0;
  const stable = dna.global?.sampleCount ? dna.global : active;
  const activeIsReliable = Number(active.sampleCount || 0) >= 4 && Number(active.confidence || 0) >= 0.45;
  const conditionalStyle = activeIsReliable ? active : stable;
  let score = 0;
  const confidence = Number(active.confidence || 0);
  // A supported current C/S/T bucket is more predictive than a permanent
  // person-wide average. Sparse buckets shrink to the broader person history.
  const preferredLength = Number(conditionalStyle.medianCharacters || stable.medianCharacters || 0);
  if (preferredLength > 0) {
    const length = [...candidate.draft].length;
    const ratio = Math.max(length, preferredLength) / Math.max(1, Math.min(length, preferredLength));
    score += ratio <= 1.4 ? 12 : ratio <= 2.2 ? 7 : ratio <= 3.5 ? 1 : -8;
  }
  const act = classifyResponseAct(candidate.draft);
  const actEvidence = Array.isArray(active.responseActs) ? active.responseActs.find((item: any) => item?.act === act) : null;
  // A peer profile may shape register, but it must not decide whether this
  // owner accepts, declines or questions a current request.
  score += peerFallback || accountFallback ? 0 : actEvidence ? Math.round(4 + 12 * Number(actEvidence.rate || 0)) : confidence >= 0.4 ? -8 : 0;
  // Lexical evidence is valid only inside the exact target relationship.
  // Peer/account DNA is an abstract numeric/categorical prior.
  const exactTargetDNA = !peerFallback && !accountFallback;
  const isObservedSafeAtom = exactTargetDNA && Array.isArray(active.safeAtoms) && active.safeAtoms.some((atom: unknown) => typeof atom === "string" && normalized(atom) === normalized(candidate.draft));
  const mode = canonicalWritingMode(detectWritingMode(candidate.draft));
  const modeEvidence = Array.isArray(conditionalStyle.writingModes) ? conditionalStyle.writingModes.find((item: any) => canonicalWritingMode(String(item?.mode || "")) === mode) : null;
  score += modeEvidence ? Math.round(3 + 8 * Number(modeEvidence.rate || 0)) : confidence >= 0.5 ? -5 : 0;
  const usesEmoji = EMOJI.test(candidate.draft);
  EMOJI.lastIndex = 0;
  const emojiRate = Number(active.emojiRate || 0);
  if ((emojiRate >= 0.35 && usesEmoji) || (emojiRate <= 0.15 && !usesEmoji)) score += 5;
  else if ((emojiRate >= 0.6 && !usesEmoji) || (emojiRate <= 0.05 && usesEmoji)) score -= 5;
  const punctuationRate = Number(active.terminalPunctuationRate || 0);
  const punctuated = /[.!?…]$/u.test(candidate.draft.trim());
  if ((punctuationRate >= 0.65 && punctuated) || (punctuationRate <= 0.25 && !punctuated)) score += 4;
  else if (confidence >= 0.5) score -= 2;
  const addresses = exactTargetDNA && Array.isArray(active.addressForms) ? active.addressForms : [];
  if (addresses.some((form: unknown) => typeof form === "string" && new RegExp(`\\b${form.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "iu").test(candidate.draft))) score += 4;
  return Math.round(score * Math.max(0.35, confidence)) + (isObservedSafeAtom ? 18 : 0);
}

function styleFormality(value: string) {
  const formal = (String(value || "").match(/\b(?:sir|madam|ma'am|kindly|please|request|regards|thank you|aap|aapko|aapse|tame|ji)\b/giu) || []).length;
  const casual = (String(value || "").match(/\b(?:bro|bhai|yaar|tu|tum|kya|kro|kr|nhi|haan|haa|hii|hey|lol|bas|mast|acha|achha)\b|[😂🤣😜😎]/giu) || []).length;
  return formal > casual ? "formal" : casual > formal ? "casual" : "neutral";
}

function lengthBucket(value: string) {
  const length = [...String(value || "")].length;
  return length <= 12 ? "micro" : length <= 35 ? "short" : length <= 100 ? "medium" : "long";
}

function stylePolicyEvidenceScore(candidate: DraftCandidate, context: any) {
  const policy = context?.relationship?.stylePolicy;
  if (!policy || typeof policy !== "object") return 0;
  const confidenceWeight = (decision: any) => {
    const source = String(decision?.source || "");
    const sourceWeight = source === "explicit-preference" ? 1
      : source === "exact-person-active" ? 0.9
        : source === "target-mirror" ? 0.72
          : source === "owner-global" ? 0.5
            : 0.35;
    return sourceWeight * Math.max(0.35, Math.min(1, Number(decision?.confidence || 0.5)));
  };
  const actualLanguage = canonicalWritingMode(detectWritingMode(candidate.draft));
  const languageWeight = confidenceWeight(policy.language);
  const actualLength = lengthBucket(candidate.draft);
  const order = ["micro", "short", "medium", "long"];
  const lengthDistance = Math.abs(order.indexOf(actualLength) - order.indexOf(String(policy?.length?.value || "")));
  const lengthWeight = confidenceWeight(policy.length);
  const actualFormality = styleFormality(candidate.draft);
  const formalityWeight = confidenceWeight(policy.formality);
  const usesEmoji = EMOJI.test(candidate.draft);
  EMOJI.lastIndex = 0;
  const emojiWeight = confidenceWeight(policy.emoji);
  let score = actualLanguage === policy?.language?.value ? 14 * languageWeight : -12 * languageWeight;
  score += (lengthDistance === 0 ? 10 : lengthDistance === 1 ? 3 : -7) * lengthWeight;
  score += (actualFormality === policy?.formality?.value ? 8 : -5) * formalityWeight;
  score += ((usesEmoji ? "use" : "avoid") === policy?.emoji?.value ? 5 : -4) * emojiWeight;
  return Number(score.toFixed(3));
}

function relationshipScore(candidate: DraftCandidate, context: any) {
  const preferredLength = Number(context?.relationship?.medianOwnerReplyCharacters || context?.relationship?.similarProfile?.medianOwnerReplyCharacters || 0);
  const length = [...candidate.draft].length;
  let score = 0;
  if (preferredLength > 0) {
    const ratio = Math.max(length, preferredLength) / Math.max(1, Math.min(length, preferredLength));
    score += ratio <= 1.5 ? 12 : ratio <= 2.5 ? 7 : ratio <= 4 ? 2 : -8;
  }
  const interactionCount = Number(context?.relationship?.interactionCount || 0);
  if (interactionCount >= 4) {
    const emojiRate = Number(context?.relationship?.ownerEmojiReplyRate || 0);
    const usesEmoji = EMOJI.test(candidate.draft);
    EMOJI.lastIndex = 0;
    if ((emojiRate >= 0.35 && usesEmoji) || (emojiRate < 0.15 && !usesEmoji)) score += 5;
    else if (emojiRate < 0.05 && usesEmoji) score -= 4;
  }
  const addressForms = Array.isArray(context?.relationship?.profile?.ownerAddressForms) ? context.relationship.profile.ownerAddressForms : [];
  if (addressForms.some((form: unknown) => typeof form === "string" && new RegExp(`\\b${form.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\b`, "iu").test(candidate.draft))) score += 3;
  score += behavioralDNAScore(candidate, context);
  score += stylePolicyEvidenceScore(candidate, context);
  return Math.max(-20, Math.min(45, score));
}

function expectedLanguage(context: any, targetText: string) {
  const explicit = String(context?.preferences?.draftLanguage || "");
  if (["English", "Roman Hindi", "Roman Gujarati"].includes(explicit)) return explicit;
  const policyLanguage = String(context?.relationship?.stylePolicy?.language?.value || "");
  if (["English", "Roman Hindi", "Roman Gujarati"].includes(policyLanguage)) return policyLanguage;
  const dna = context?.relationship?.behavioralDNA;
  const effectiveDNA = dna?.active?.sampleCount >= 2
    ? dna
    : context?.relationship?.similarProfile?.behavioralDNA?.active?.sampleCount
      ? context.relationship.similarProfile.behavioralDNA
      : context?.relationship?.ownerGlobalBehavioralDNA?.active?.sampleCount
        ? context.relationship.ownerGlobalBehavioralDNA
        : dna;
  const active = effectiveDNA?.active;
  const activeModes = Array.isArray(active?.writingModes)
    ? [...active.writingModes]
      .map((item: any) => ({ ...item, mode: canonicalWritingMode(String(item?.mode || "")) }))
      .filter((item: any) => ["English", "Roman Hindi", "Roman Gujarati"].includes(item.mode))
      .sort((left: any, right: any) => Number(right?.rate || 0) - Number(left?.rate || 0))
    : [];
  const activeMargin = Number(activeModes[0]?.rate || 0) - Number(activeModes[1]?.rate || 0);
  const learned = Number(active?.sampleCount || 0) >= 4 && Number(active?.confidence || 0) >= 0.45
    && Number(activeModes[0]?.rate || 0) >= 0.5 && activeMargin >= 0.12
    ? active
    : effectiveDNA?.global?.sampleCount ? effectiveDNA.global : active?.sampleCount ? active : null;
  const mode = Array.isArray(learned?.writingModes)
    ? [...learned.writingModes]
      .map((item: any) => ({ ...item, mode: canonicalWritingMode(String(item?.mode || "")) }))
      .filter((item: any) => ["English", "Roman Hindi", "Roman Gujarati"].includes(item.mode))
      .sort((left: any, right: any) => Number(right?.rate || 0) - Number(left?.rate || 0))[0]
    : null;
  if (mode && Number(learned.confidence || 0) >= 0.15) return mode.mode;
  return languageOf(targetText);
}

function responseFitScore(candidate: DraftCandidate, targetText: string, context: any) {
  const requested = normalized(String(context?.userIntent || ""));
  if (requested && normalized(candidate.draft) === requested) return 60;
  const intent = String(candidate.intent || "");
  const draft = candidate.draft;
  if (intent === "departure-update") return /\b(?:dhyan|safe|careful|travel safe|take care)\b/iu.test(draft) ? 18 : GENERIC_ACKNOWLEDGEMENT.test(draft) ? -10 : 0;
  if (intent === "arrival-update") return /\b(?:good|saras|great|rest)\b/iu.test(draft) ? 10 : 0;
  if (intent === "intro-question") return /\?/u.test(draft) ? 16 : GENERIC_ACKNOWLEDGEMENT.test(draft) ? -12 : 0;
  if (["activity-question", "open-question", "why-question", "choice-question", "problem"].includes(intent)) return /\?/u.test(draft) ? 12 : GENERIC_ACKNOWLEDGEMENT.test(draft) ? -12 : 0;
  if (intent === "affection") return AFFECTION.test(draft) || /\b(?:me too|same here|tumhe bhi|mane pan)\b/iu.test(draft) ? 18 : -20;
  if (intent === "thanks") return /\b(?:welcome|anytime|koi na|kai nai|no worries)\b/iu.test(draft) ? 12 : 0;
  if (intent === "greeting") return /^(?:hi+|hey+|hello+)/iu.test(draft) ? 10 : 0;
  if (["action-request", "call", "check-request", "send-request"].includes(intent)) {
    const act = classifyResponseAct(draft);
    if (act === "commitment") return 12;
    if (act === "question") return 4;
  }
  if (/\?\s*$/u.test(targetText) && /\?\s*$/u.test(draft)) return 6;
  return 0;
}

function exactPersonGenericityScore(candidate: DraftCandidate, context: any, incomingIntent: string) {
  if (!GENERIC_ACKNOWLEDGEMENT.test(candidate.draft)) return 0;
  if (!["acknowledgement", "apology", "greeting", "nothing-response", "thanks"].includes(incomingIntent)) return 0;
  const exactPersonReplies = [
    ...(Array.isArray(context?.tone?.personSpecificExamples) ? context.tone.personSpecificExamples : []),
    ...(Array.isArray(context?.relationship?.interactions)
      ? context.relationship.interactions.map((item: any) => item?.ownerReply)
      : []),
  ].filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  if (!exactPersonReplies.length) return 0;
  const candidateKey = normalized(candidate.draft);
  const observed = exactPersonReplies.some((reply) => normalized(reply) === candidateKey);
  if (observed) return 14;
  // A stock social acknowledgement is safe, but once this person has enough
  // evidence it should lose to the owner's actually observed realization.
  // This is ranking only: it never makes historical wording factual evidence.
  return exactPersonReplies.length >= 4 ? -18 : -6;
}

function recentSurfaceRepetitionScore(candidate: DraftCandidate, context: any) {
  const recent = Array.isArray(context?.retrieval?.repetition?.recentTemplateFingerprints)
    ? context.retrieval.repetition.recentTemplateFingerprints
      .filter((value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value))
      .slice(-64)
    : [];
  if (!recent.length) return 0;
  const fingerprint = phraseTemplateFingerprint(candidate.draft);
  const uses = recent.filter((value: string) => value === fingerprint).length;
  if (!uses) return 0;
  // This is a ranking pressure, never a safety rejection. If a repeated safe
  // acknowledgement is genuinely the only valid response it remains usable,
  // but a distinct person-backed candidate will win when one is available.
  const generic = GENERIC_ACKNOWLEDGEMENT.test(candidate.draft);
  return -Math.min(generic ? 70 : 36, uses * (generic ? 28 : 12));
}

function durableStoryStateScore(candidate: DraftCandidate, context: any, incomingIntent: string) {
  const state = context?.conversationState;
  if (!state || typeof state !== "object") return 0;
  const status = String(state.conversation_status || "").replace(/-/gu, "_").toLocaleLowerCase();
  const currentQuestions = Array.isArray(state.open_questions)
    ? state.open_questions.filter((item: any) => item?.status === "current" && item?.asked_by_owner !== true)
    : [];
  const plan = candidateDialoguePlan(candidate.draft, incomingIntent);
  let score = 0;
  // Durable state is an index into the visible story, not independent factual
  // authority. It may choose the response act, but it cannot supply wording or
  // authorize a fact absent from `context.story`.
  if (status === "awaiting_owner") {
    if (["answer", "clarify", "follow-up", "accept", "decline", "defer"].includes(plan)) score += 10;
    if (plan === "acknowledge" && currentQuestions.length) score -= 30;
  }
  if (currentQuestions.length && ["answer", "clarify", "follow-up", "defer"].includes(plan)) score += 10;
  const stateIntent = String(state.latest_intent || "").toLocaleLowerCase();
  if (/(?:question|request|problem|coordination)/u.test(stateIntent)) {
    if (["answer", "clarify", "follow-up", "accept", "decline", "defer"].includes(plan)) score += 8;
    if (plan === "acknowledge") score -= 16;
  }
  return score;
}

const SEMANTIC_PLAN_TIER = Object.freeze({
  "person-cst": 4,
  "same-person-semantic": 4,
  "person-adjacent-cst": 3,
  "person-episode": 3,
  "shared-group-semantic": 2,
  relationship: 2,
  "owner-global": 1,
});

function dialoguePlanFromAct(responseAct: string, template: string, incomingIntent: string) {
  if (responseAct === "decline") return "decline";
  if (responseAct === "commitment") return /\b(?:check|confirm|let me|later|baad|pachi|dekhta|joi)\b/iu.test(template) ? "defer" : "accept";
  if (responseAct === "question") {
    return ["open-question", "why-question", "choice-question", "when-question", "where-question", "activity-question", "wellbeing-question", "intro-question"].includes(incomingIntent)
      ? "clarify"
      : "follow-up";
  }
  if (responseAct === "acknowledgement" || responseAct === "emoji") return "acknowledge";
  return "answer";
}

function preferredLearnedPlan(context: any, incomingIntent: string) {
  const runtime = context?.relationship?.preferredDialoguePlan;
  if (runtime?.dialoguePlan) {
    return {
      plan: String(runtime.dialoguePlan),
      tier: String(runtime.sourceTier || "owner-global"),
      score: Number(runtime.probability || 0) * 1_000 + Number(SEMANTIC_PLAN_TIER[runtime.sourceTier] || 0) * 100,
    };
  }
  const selected = Array.isArray(context?.retrieval?.phraseBank?.selected) ? context.retrieval.phraseBank.selected : [];
  const episodes = Array.isArray(context?.retrieval?.episodes) ? context.retrieval.episodes : [];
  const plans = [];
  for (const pattern of selected) {
    const tier = String(pattern?.tier || "owner-global");
    const learnedIntent = String(pattern?.semanticPlan?.incomingIntent || "statement");
    const responseAct = String(pattern?.semanticPlan?.responseAct || "information");
    plans.push({
      plan: dialoguePlanFromAct(responseAct, String(pattern?.styleFragments?.surfaceTemplate || ""), incomingIntent),
      tier,
      score: Number(SEMANTIC_PLAN_TIER[tier] || 0) * 100
        + (learnedIntent === incomingIntent ? 80 : 0)
        + Math.min(40, Number(pattern?.evidenceCount || 1) * 6)
        + Math.min(120, Math.max(0, Number(pattern?.score || 0))) / 10,
    });
  }
  for (const episode of episodes) {
    const learnedIntent = String(episode?.incomingIntent || classifyIncomingIntent(String(episode?.incomingText || "")));
    const responseAct = String(episode?.responseAct || classifyResponseAct(String(episode?.ownerReply || "")));
    plans.push({
      plan: dialoguePlanFromAct(responseAct, String(episode?.ownerReply || ""), incomingIntent),
      tier: "person-episode",
      score: 300 + (learnedIntent === incomingIntent ? 80 : 0) + Math.max(0, Number(episode?.similarity || 0)) * 40,
    });
  }
  return plans.sort((left, right) => right.score - left.score)[0] || null;
}

function candidateDialoguePlan(draft: string, incomingIntent: string) {
  const value = String(draft || "").trim();
  if (/\[(?:confirm|select)[^\]]*declin/iu.test(value) || /\b(?:can't|cannot|won't|not possible|nahi|nhi|nathi)\b/iu.test(value)) return "decline";
  if (/\[(?:confirm|say)[^\]]*(?:commit|accept|can )/iu.test(value)) return "accept";
  if (/\b(?:let me|check karke|confirm karke|check kari|confirm kari)[^.!?]{0,60}\b(?:get back|bata|janav|kahu)/iu.test(value)) return "defer";
  if (/\b(?:understood|theek hai|barabar)\s*[.!…]*$/iu.test(value)) return "acknowledge";
  if (/\?\s*$/u.test(value)) {
    return ["open-question", "why-question", "choice-question", "when-question", "where-question", "activity-question", "wellbeing-question", "intro-question"].includes(incomingIntent)
      ? "clarify"
      : "follow-up";
  }
  const act = classifyResponseAct(value);
  if (act === "commitment") return "accept";
  if (act === "acknowledgement" || act === "emoji") return "acknowledge";
  return "answer";
}

function dialoguePlanCompatibleWithIntent(plan: string, incomingIntent: string) {
  const allowed: Record<string, Set<string>> = {
    greeting: new Set(["greet", "acknowledge"]),
    thanks: new Set(["thank", "acknowledge"]),
    apology: new Set(["answer", "acknowledge"]),
    affection: new Set(["reciprocate"]),
    emoji: new Set(["acknowledge", "answer"]),
    wish: new Set(["answer", "thank"]),
    "nothing-response": new Set(["acknowledge", "answer"]),
    "action-request": new Set(["accept", "decline", "defer", "clarify"]),
    call: new Set(["accept", "decline", "defer", "clarify"]),
    "check-request": new Set(["accept", "decline", "defer", "clarify"]),
    "send-request": new Set(["accept", "decline", "defer", "clarify"]),
    "shared-link": new Set(["follow-up", "clarify", "acknowledge"]),
    problem: new Set(["clarify", "follow-up", "defer", "answer"]),
    statement: new Set(["answer", "acknowledge", "follow-up", "accept", "decline", "defer"]),
    "departure-update": new Set(["answer", "acknowledge"]),
    "arrival-update": new Set(["answer", "acknowledge"]),
  };
  if (allowed[incomingIntent]) return allowed[incomingIntent].has(plan);
  if (/question$/u.test(incomingIntent) || ["open-question", "why-question", "choice-question"].includes(incomingIntent)) {
    return ["answer", "clarify", "follow-up", "defer"].includes(plan);
  }
  return ["answer", "acknowledge", "follow-up", "clarify"].includes(plan);
}

function learnedSemanticPlanScore(candidate: DraftCandidate, context: any, incomingIntent: string) {
  const posterior = Array.isArray(context?.relationship?.candidateDialoguePlans)
    ? context.relationship.candidateDialoguePlans
      .filter((plan: any) => plan?.dialoguePlan && dialoguePlanCompatibleWithIntent(String(plan.dialoguePlan), incomingIntent))
      .slice(0, 4)
    : [];
  if (posterior.length) {
    const actual = candidateDialoguePlan(candidate.draft, incomingIntent);
    const hasProbabilities = posterior.some((plan: any) => Number(plan?.probability || 0) > 0);
    const weightOf = (plan: any) => hasProbabilities ? Math.max(0, Number(plan?.probability || 0)) : 1;
    const normalizedMass = posterior.reduce((sum: number, plan: any) => sum + weightOf(plan), 0) || posterior.length;
    const supporting = posterior.filter((plan: any) => String(plan.dialoguePlan) === actual);
    const support = supporting.reduce((sum: number, plan: any) => sum + weightOf(plan), 0) / normalizedMass;
    const strongestTier = Math.max(0, ...supporting.map((plan: any) => Number(SEMANTIC_PLAN_TIER[String(plan?.sourceTier || "")] || 0)));
    // Ambiguous learned behavior stays ambiguous: every supported semantic
    // plan receives proportional credit instead of an arbitrary top row
    // becoming the sole ground truth.
    if (support > 0) return Math.round(6 + support * 24 + strongestTier * 5);
    const posteriorConfidence = Math.max(...posterior.map((plan: any) => Number(plan?.probability || 0)));
    return posteriorConfidence >= 0.7 ? -12 : -4;
  }
  const learned = preferredLearnedPlan(context, incomingIntent);
  if (!learned || !dialoguePlanCompatibleWithIntent(learned.plan, incomingIntent)) return 0;
  const actual = candidateDialoguePlan(candidate.draft, incomingIntent);
  const strength = Number(SEMANTIC_PLAN_TIER[learned.tier] || 0);
  if (actual === learned.plan) return 10 + strength * 9;
  // Current safety and question-answer truth remain stronger than history.
  // A mismatch is a ranking penalty, never a factuality bypass.
  return -(4 + strength * 5);
}

function storySemanticFitScore(candidate: DraftCandidate, incomingText: string, incomingIntent: string) {
  const draft = candidate.draft;
  if (["acknowledgement", "affection", "apology", "emoji", "greeting", "nothing-response", "thanks", "wish"].includes(incomingIntent)) return 0;
  const overlap = tokenSimilarity(draft, incomingText);
  let score = Math.round(Math.min(18, overlap * 36));
  const incomingTokens = contentTokens(incomingText);
  const draftTokens = new Set(contentTokens(draft));
  const copiedCoverage = incomingTokens.length
    ? incomingTokens.filter((token) => draftTokens.has(token)).length / incomingTokens.length
    : 0;
  // Repeating almost the entire incoming update and appending "understood"
  // is not story understanding. Prefer a concise topic-grounded realization
  // or a useful next move when both are otherwise safe.
  if (incomingIntent === "statement" && copiedCoverage >= 0.8
    && /\b(?:understood|theek hai|barabar)\s*[.!…]*$/iu.test(draft)) score -= 18;
  const asksQuestion = /\?\s*$/u.test(draft);
  const hasEditableAnswer = REQUIRED_INPUT.test(draft);
  const clearQuestion = /\?\s*$/u.test(incomingText) && contentTokens(incomingText).length >= 3;
  const vagueClarification = /\b(?:what do you mean|kya hua|shu thayu|share a little more|thoda detail|thodu detail)\b/iu.test(draft);
  if (clearQuestion && hasEditableAnswer) score += 24;
  if (clearQuestion && vagueClarification) score -= 24;
  const actionWords = incomingText.match(/\b(?:call|check|confirm|deliver|finish|forward|pay|review|send|share|submit|update|phone|bhej|mokli|dekh|joi|kar)\w*\b/giu) || [];
  if (actionWords.length) {
    const actionCovered = actionWords.some((word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&").slice(0, 8)}`, "iu").test(draft));
    if (actionCovered || hasEditableAnswer) score += 18;
    else if (!asksQuestion) score -= 16;
  }
  if (incomingIntent === "statement" && !asksQuestion && overlap >= 0.2) score += 8;
  return score;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function candidateThermalCoordinate(draft: string) {
  const value = String(draft || "").trim();
  const positive = (value.match(/\b(?:glad|good|great|happy|perfect|saras|mast|badhiya|welcome|thanks|thank you|koi na|kai nai|no worries|love|miss)\b/giu) || []).length;
  const negative = (value.match(/\b(?:sorry|cannot|can't|won't|nahi|nhi|nathi|issue|problem|unwell|sad|upset)\b/giu) || []).length;
  const emojiCount = value.match(EMOJI)?.length || 0;
  EMOJI.lastIndex = 0;
  const formal = (value.match(/\b(?:please|kindly|could you|would you|aap|aapko|aapka|ji|sir|request|confirm)\b/giu) || []).length;
  const casual = (value.match(/\b(?:bro|bhai|yaar|tum|teko|meko|kro|nhi|acha|arre)\b/giu) || []).length;
  const exclamations = (value.match(/!/gu) || []).length;
  const uppercaseTokens = (value.match(/\b[A-Z]{3,}\b/gu) || []).length;
  const ellipsis = /(?:\.\.\.|…)/u.test(value);
  return {
    valence: clamp((positive - negative) * 0.28 + Math.min(0.3, emojiCount * 0.15), -1, 1),
    arousal: clamp(0.4 + Math.min(0.45, exclamations * 0.2 + uppercaseTokens * 0.15) - (ellipsis ? 0.14 : 0), 0, 1),
    formality: clamp(0.5 + Math.min(0.4, formal * 0.16) - Math.min(0.42, casual * 0.16) + (/[.]$/u.test(value) ? 0.06 : 0), 0, 1),
  };
}

function thermalDistance(left: any, right: any) {
  return Math.sqrt(
    (Number(left?.valence || 0) - Number(right?.valence || 0)) ** 2
    + (Number(left?.arousal || 0) - Number(right?.arousal || 0)) ** 2
    + (Number(left?.formality || 0) - Number(right?.formality || 0)) ** 2,
  ) / Math.sqrt(6);
}

function thermalRoutingScore(candidate: DraftCandidate, context: any) {
  const posterior = context?.retrieval?.scenarioPosterior || context?.retrieval?.scenarioForest;
  const thermal = posterior?.thermal;
  const reliability = clamp(Number(context?.retrieval?.routingBlend?.forestWeight || 0), 0, 0.75);
  if (!thermal || reliability <= 0) return 0;
  const coordinate = candidateThermalCoordinate(candidate.draft);
  const mixture = Array.isArray(thermal?.mixture?.components)
    ? thermal.mixture.components.filter((item: any) => item?.centroid && Number(item?.weight) > 0).slice(0, 4)
    : [];
  const hotspots = Array.isArray(thermal.hotspots) ? thermal.hotspots.filter((item: any) => item?.centroid) : [];
  let closeness;
  if (mixture.length) {
    const values = mixture.map((component: any) => ({
      closeness: 1 - clamp(thermalDistance(coordinate, component.centroid), 0, 1),
      weight: Math.max(0, Number(component.weight || 0)),
    }));
    const total = values.reduce((sum: number, item: any) => sum + item.weight, 0) || values.length;
    const average = values.reduce((sum: number, item: any) => sum + item.closeness * (item.weight || 1), 0) / total;
    // Mixture weights preserve multiple plausible registers without allowing
    // a tiny component to dominate the ensemble.
    closeness = values.length > 1 ? 0.45 * Math.max(...values.map((item: any) => item.closeness)) + 0.55 * average : average;
  } else if (thermal.multimodal === true && hotspots.length) {
    const values = hotspots.slice(0, 4).map((hotspot: any) => ({ closeness: 1 - clamp(thermalDistance(coordinate, hotspot.centroid), 0, 1), weight: Math.max(0, Number(hotspot.relativeMass || hotspot.probabilityMass || 0)) }));
    const total = values.reduce((sum: number, item: any) => sum + item.weight, 0) || values.length;
    closeness = values.reduce((sum: number, item: any) => sum + item.closeness * (item.weight || 1), 0) / total;
  } else {
    closeness = 1 - clamp(thermalDistance(coordinate, thermal.centroid), 0, 1);
  }
  const uncertainty = clamp(Number(posterior?.uncertainty || 0), 0, 1);
  return Number((12 * reliability * (1 - uncertainty * 0.45) * (2 * closeness - 1)).toFixed(3));
}

export function evaluateDraftCandidates(values: unknown[], context: any): {
  selected: DraftCandidate;
  evaluations: CandidateEvaluation[];
} {
  const allowedEvidence = new Set((Array.isArray(context?.story) ? context.story : []).map((event: any) => event?.id).filter(Boolean));
  const target = Array.isArray(context?.story) ? context.story.find((event: any) => event?.isTarget) || context.story.at(-1) : null;
  const preferredLength = Number(context?.relationship?.medianOwnerReplyCharacters || context?.relationship?.similarProfile?.medianOwnerReplyCharacters || 0);
  const requiredFacts = new Set(Array.isArray(context?.safety?.requiredFacts) ? context.safety.requiredFacts : []);
  const commitmentOnly = requiredFacts.size === 1 && requiredFacts.has("commitment")
    && (!Array.isArray(context?.safety?.requiredInputs) || context.safety.requiredInputs.length === 0);
  const requiresCurrentFact = context?.safety?.requiresCurrentFact === true && !commitmentOnly && !String(context?.userIntent || "").trim();
  const evidenceText = `${(Array.isArray(context?.story) ? context.story : []).map((event: any) => event?.text || "").join(" ")} ${String(context?.userIntent || "")}`;
  const incomingTurnText = currentIncomingTurn(context, target);
  const incomingIntent = classifyIncomingIntent(incomingTurnText);
  const concreteActionRequested = ["action-request", "call", "check-request", "send-request"].includes(incomingIntent);
  const genericAcknowledgementAllowed = ["acknowledgement", "apology", "greeting", "nothing-response", "thanks"].includes(incomingIntent);
  const seen = new Set<string>();
  const evaluations: CandidateEvaluation[] = [];

  for (const [candidateIndex, raw] of values.slice(0, 8).entries()) {
    const candidate = cleanCandidate(raw);
    if (!candidate) continue;
    const key = normalized(candidate.draft) || candidate.draft.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const reasons: string[] = [];
    const components = {
      persona: personaEvidenceScore(candidate, context),
      relationship: relationshipScore(candidate, context),
      context: 0,
      channel: 0,
      evidence: 0,
      routing: 0,
      riskPenalty: 0,
    };
    const gates = { audience: true, factuality: true, freshness: true, scope: true };

    if (!target || target.speaker !== "OTHER") {
      gates.audience = false;
      reasons.push("The verified target is not an incoming human message.");
    }
    if (SECRET.test(candidate.draft)) {
      gates.factuality = false;
      components.riskPenalty += 100;
      reasons.push("The candidate contains credential-like material.");
    }
    if (ASSISTANT_TELL.test(candidate.draft)) {
      gates.scope = false;
      components.riskPenalty += 40;
      reasons.push("The candidate contains generic assistant language.");
    }
    if (containsContentReplay(candidate.draft, context)) {
      gates.scope = false;
      components.riskPenalty += 120;
      reasons.push("The candidate replays content from style evidence that is absent from the current conversation.");
    }
    if (AFFECTION.test(String(target?.text || "")) && GENERIC_ACKNOWLEDGEMENT.test(candidate.draft)) {
      gates.factuality = false;
      components.riskPenalty += 60;
      reasons.push("An affectionate message cannot be reduced to a generic acknowledgement.");
    }
    if (concreteActionRequested && GENERIC_ACKNOWLEDGEMENT.test(candidate.draft)) {
      gates.scope = false;
      components.riskPenalty += 60;
      reasons.push("A concrete action request cannot be reduced to a generic acknowledgement.");
    }
    if (!genericAcknowledgementAllowed && GENERIC_ACKNOWLEDGEMENT.test(candidate.draft)) {
      gates.scope = false;
      components.riskPenalty += 60;
      reasons.push("This conversation requires a story-specific response, not a stock acknowledgement.");
    }
    const foreignEvidence = candidate.evidenceIds.filter((id) => !allowedEvidence.has(id));
    if (foreignEvidence.length) {
      gates.scope = false;
      components.riskPenalty += 100;
      reasons.push("The candidate cites evidence outside the retrieved story.");
    }
    if (requiresCurrentFact && !REQUIRED_INPUT.test(candidate.draft)) {
      gates.freshness = false;
      components.riskPenalty += 100;
      reasons.push("A current fact is missing and the candidate is not safely editable.");
    }
    if (requiresCurrentFact && FIRST_PERSON_COMMITMENT.test(candidate.draft) && !/\{\{(?:date|time)\}\}/u.test(candidate.draft)) {
      gates.freshness = false;
      components.riskPenalty += 100;
      reasons.push("The candidate invents a current commitment.");
    }
    const inventedNumbers = unsupportedNumbers(candidate.draft, evidenceText);
    if (inventedNumbers.length && !REQUIRED_INPUT.test(candidate.draft)) {
      gates.factuality = false;
      components.riskPenalty += 100;
      reasons.push("The candidate introduces a number that is absent from the verified context.");
    }
    const unsupportedFact = unsupportedConcreteCurrentFact(candidate.draft, context, incomingTurnText);
    if (unsupportedFact) {
      gates.factuality = false;
      components.riskPenalty += 120;
      reasons.push(unsupportedFact);
    }
    if (CURRENT_TIME_WORD.test(candidate.draft) && !CURRENT_TIME_WORD.test(evidenceText)
      && !String(context?.userIntent || "").trim() && !REQUIRED_INPUT.test(candidate.draft)) {
      gates.freshness = false;
      components.riskPenalty += 80;
      reasons.push("The candidate introduces a current time reference without evidence.");
    }
    if (!candidate.evidenceIds.includes(target?.id)) {
      gates.scope = false;
      components.evidence -= 18;
      components.riskPenalty += 100;
      reasons.push("The latest target is not cited as evidence, so the candidate cannot be shown.");
    } else {
      components.evidence += 16;
    }
    if (preferredLength > 0) {
      const ratio = Math.max([...candidate.draft].length, preferredLength) / Math.max(1, Math.min([...candidate.draft].length, preferredLength));
      if (ratio > 6) {
        components.relationship -= 12;
        reasons.push("The candidate is far from the person's observed reply length.");
      }
    }
    const targetLanguage = expectedLanguage(context, incomingTurnText || String(target?.text || ""));
    // Provider metadata is a claim, not evidence. Score the realized wording:
    // this catches regressions where a Roman-Hindi policy is attached to an
    // English draft and prevents metadata from masking a failed realization.
    const candidateLanguage = languageOf(candidate.draft);
    components.context += candidateLanguage === targetLanguage ? 12 : -10;
    components.context += responseFitScore(candidate, String(target?.text || ""), context);
    components.context += storySemanticFitScore(candidate, incomingTurnText, incomingIntent);
    components.context += learnedSemanticPlanScore(candidate, context, incomingIntent);
    components.context += exactPersonGenericityScore(candidate, context, incomingIntent);
    components.context += recentSurfaceRepetitionScore(candidate, context);
    components.context += durableStoryStateScore(candidate, context, incomingIntent);
    components.routing += thermalRoutingScore(candidate, context);
    if (concreteActionRequested && ["commitment", "decline", "question"].includes(classifyResponseAct(candidate.draft))) components.context += 18;
    if (candidate.intent && AFFECTION.test(String(target?.text || "")) && candidate.intent === "affection") components.context += 8;
    components.channel += context?.chat?.kind === "group" && [...candidate.draft].length <= 180 ? 6 : 4;
    if (candidate.uncertainties?.length) components.riskPenalty += Math.min(18, candidate.uncertainties.length * 4);
    if (candidate.prohibitedAssumptions?.length) components.channel += Math.min(4, candidate.prohibitedAssumptions.length);
    const accepted = Object.values(gates).every(Boolean);
    const score = Number((components.persona + components.relationship + components.context + components.channel + components.evidence + components.routing - components.riskPenalty - candidateIndex).toFixed(3));
    evaluations.push({ candidate, accepted, score, reasons, components, gates });
  }

  const selected = evaluations
    .filter((evaluation) => evaluation.accepted)
    .sort((left, right) => right.score - left.score)[0]?.candidate;
  if (!selected) {
    const error = new Error("No candidate passed factuality and safety evaluation. Add the fact you want to communicate and try again.") as Error & {
      code?: string;
      evaluationReasons?: string[];
      evaluationBlockingReasons?: string[];
      evaluationCandidateShapes?: string[];
    };
    error.code = "CANDIDATE_EVALUATION_REJECTED";
    error.evaluationReasons = [...new Set(evaluations.flatMap((evaluation) => evaluation.reasons))].slice(0, 12);
    error.evaluationBlockingReasons = evaluations.length
      ? [...new Set(evaluations[0].reasons)].filter((reason) => evaluations.every((evaluation) => evaluation.reasons.includes(reason)))
      : ["No valid candidate objects were produced."];
    error.evaluationCandidateShapes = evaluations.map((evaluation) => [
      classifyResponseAct(evaluation.candidate.draft),
      REQUIRED_INPUT.test(evaluation.candidate.draft) ? "slot" : "no-slot",
      Object.entries(evaluation.gates).filter(([, passed]) => !passed).map(([gate]) => gate).join("+") || "passed",
    ].join(":"));
    throw error;
  }
  return { selected, evaluations };
}
import { classifyIncomingIntent, classifyResponseAct } from "./behavioral-dna.ts";
import { detectWritingMode } from "./relationship.ts";
import { phraseTemplateFingerprint } from "./phrase-bank.ts";
