const SIMPLE_LOCAL = /^(?:emoji|greeting|thanks|acknowledgement|shared-link|departure-update|arrival-update|nothing-response|wish)$/u;
const HIGH_JUDGMENT = /^(?:affection|apology|problem|open-question|why-question|wellbeing-question|intro-question|choice-question)$/u;

// Pricing is used only for a local pre-flight estimate and content-free usage
// ledger. It is deliberately versioned because vendor pricing is not a durable
// application constant. Administrators can replace it without rebuilding.
export const MODEL_PRICE_SNAPSHOT = Object.freeze({
  version: "2026-09-01",
  models: Object.freeze({
    "gpt-5.6-luna": Object.freeze({ inputPerMillionUsd: 0.20, cachedInputPerMillionUsd: 0.02, outputPerMillionUsd: 1.20 }),
    "gpt-5.6-sol": Object.freeze({ inputPerMillionUsd: 4.00, cachedInputPerMillionUsd: 0.40, outputPerMillionUsd: 20.00 }),
    // Gemini entries use the published introductory rates current on the
    // snapshot date. The versioned table must be reviewed when pricing changes;
    // actual provider usage replaces pre-flight estimates after every call.
    "gemini-3.7-flash": Object.freeze({ inputPerMillionUsd: 0.75, cachedInputPerMillionUsd: 0.075, outputPerMillionUsd: 3.75 }),
    "gemini-3.6-flash": Object.freeze({ inputPerMillionUsd: 0.75, cachedInputPerMillionUsd: 0.075, outputPerMillionUsd: 3.75 }),
    "gemini-3.5-flash": Object.freeze({ inputPerMillionUsd: 1.50, cachedInputPerMillionUsd: 0.15, outputPerMillionUsd: 9.00 }),
    "gemini-3.5-flash-lite": Object.freeze({ inputPerMillionUsd: 0.30, cachedInputPerMillionUsd: 0.03, outputPerMillionUsd: 2.50 }),
    "gemini-2.5-flash": Object.freeze({ inputPerMillionUsd: 0.30, cachedInputPerMillionUsd: 0.03, outputPerMillionUsd: 2.50 }),
  }),
});

// Backwards-compatible export for code and evidence created before the
// provider-neutral ledger was introduced.
export const OPENAI_PRICE_SNAPSHOT = MODEL_PRICE_SNAPSHOT;

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

export function estimateTokens(value) {
  // A deliberately conservative pre-flight estimate for multilingual text.
  // Actual provider usage replaces it in the ledger after every response.
  return Math.max(1, Math.ceil([...String(value || "")].length / 3));
}

export function usageCostMicrousd(usage, pricing) {
  if (!pricing) return 0;
  const input = Math.max(0, Number(usage?.inputTokens || 0));
  const cached = Math.max(0, Math.min(input, Number(usage?.cachedInputTokens || 0)));
  const uncached = input - cached;
  const output = Math.max(0, Number(usage?.outputTokens || 0));
  // USD / 1M tokens is numerically equal to micro-USD / token.
  return Math.max(0, Math.round(
    uncached * pricing.inputPerMillionUsd
    + cached * pricing.cachedInputPerMillionUsd
    + output * pricing.outputPerMillionUsd,
  ));
}

export function modelPolicyFromEnv(environment = process.env) {
  const requestedProvider = String(environment.MYCROBO_MODEL_PROVIDER || "").trim().toLocaleLowerCase();
  const provider = requestedProvider || (environment.GEMINI_API_KEY ? "gemini" : "openai");
  const gemini = provider === "gemini";
  const standardModel = String(gemini
    ? environment.MYCROBO_GEMINI_MODEL || "gemini-3.7-flash"
    : environment.MYCROBO_OPENAI_MODEL || "gpt-5.6-luna").trim();
  const escalationEnabled = String(gemini
    ? environment.MYCROBO_GEMINI_ESCALATION_ENABLED || ""
    : environment.MYCROBO_OPENAI_ESCALATION_ENABLED || "").toLocaleLowerCase() === "true";
  const escalationModel = String(gemini
    ? environment.MYCROBO_GEMINI_ESCALATION_MODEL || "gemini-3.7-flash"
    : environment.MYCROBO_OPENAI_ESCALATION_MODEL || "gpt-5.6-sol").trim();
  const fallbackModel = String(gemini ? environment.MYCROBO_GEMINI_FALLBACK_MODEL || "gemini-3.6-flash" : "").trim();
  const stableFallbackModel = String(gemini ? environment.MYCROBO_GEMINI_STABLE_FALLBACK_MODEL || "gemini-3.5-flash" : "").trim();
  return {
    provider,
    standardModel,
    fallbackModel,
    stableFallbackModel,
    escalationEnabled,
    escalationModel,
    maxInputTokens: Math.floor(boundedNumber(environment.MYCROBO_MODEL_MAX_INPUT_TOKENS, 8_000, 1_500, 40_000)),
    // Gemini includes hidden thinking tokens inside this ceiling. Reserve enough
    // room for medium reasoning plus the complete three-candidate JSON object.
    maxOutputTokens: Math.floor(boundedNumber(environment.MYCROBO_MODEL_MAX_OUTPUT_TOKENS, gemini ? 1_600 : 450, gemini ? 800 : 180, gemini ? 4_000 : 1_200)),
    dailyCallLimit: Math.floor(boundedNumber(environment.MYCROBO_MODEL_DAILY_CALL_LIMIT, 300, 1, 100_000)),
    monthlyCostLimitMicrousd: Math.floor(boundedNumber(environment.MYCROBO_MODEL_MONTHLY_USD_LIMIT, 10, 0.25, 10_000) * 1_000_000),
  };
}

function targetOf(context) {
  const story = Array.isArray(context?.story) ? context.story : [];
  return story.find((event) => event?.isTarget) || story.at(-1) || null;
}

function judgmentIntent(text) {
  const value = String(text || "").trim();
  if (/^[\p{Extended_Pictographic}\u200D\uFE0F\s]+$/u.test(value)) return "emoji";
  if (/^(?:hi+|hii+|hey+|hello+|good\s+(?:morning|afternoon|evening))\b/iu.test(value)) return "greeting";
  if (/\b(?:thank(?:s| you)?|thx|dhanyavaad|aabhar|shukriya)\b/iu.test(value)) return "thanks";
  if (/\b(?:sorry|maaf|apolog)\b/iu.test(value)) return "apology";
  if (/\b(?:miss(?:ing)? you|miss u|pyar|pyaar|love you|need (?:your )?(?:love|affection)|hug|cuddle)\b/iu.test(value)) return "affection";
  if (/https?:\/\/\S+/iu.test(value)) return "shared-link";
  if (/\b(?:nikl(?:ungi|unga|i|a|enge|rahi|rhi|raha)?|leaving|heading out|on my way)\b/iu.test(value)) return "departure-update";
  if (/\b(?:reached|pahuch|pahunch|arrived)\b/iu.test(value)) return "arrival-update";
  if (/^(?:ok(?:ay)?|haan+|ha+|hmm+|thik|theek|done|fine)[\s.!👍🙂😊]*$/iu.test(value)) return "acknowledgement";
  if (/\b(?:problem|issue|not working|can't|cannot|stuck|late|delay|hurt|upset|angry)\b/iu.test(value)) return "problem";
  if (/\b(?:why|kyu|kyun|kem)\b/iu.test(value)) return "why-question";
  if (/\?\s*$/u.test(value) || /\b(?:what|kya|shu|how|kaise|which|kaunsa|konsa)\b/iu.test(value)) return "open-question";
  return "statement";
}

export function routeDraftContext(context, policy = modelPolicyFromEnv({})) {
  const target = targetOf(context);
  const intent = judgmentIntent(target?.text);
  const suppliedIntent = String(context?.userIntent || "").trim();
  const storyLength = Array.isArray(context?.story) ? context.story.length : 0;
  const interactionCount = Number(context?.relationship?.interactionCount || 0);
  if (!target || target.speaker !== "OTHER") return { route: "local", reason: "no-verified-incoming-target" };
  if (suppliedIntent) return { route: "local", reason: "owner-already-supplied-the-reply" };
  if (Array.isArray(context?.safety?.requiredInputs) && context.safety.requiredInputs.length > 0) return { route: "local", reason: "structured-current-fact-input" };
  const activeDNA = context?.relationship?.behavioralDNA?.active;
  const activeSamples = Number(activeDNA?.sampleCount || 0);
  const activeConfidence = Number(activeDNA?.confidence || 0);
  // A short message is not automatically a generic message. Keep a simple
  // intent local only when the same person has repeated, intent-conditioned
  // response evidence. With thin evidence the reasoning model receives the
  // bounded current story plus derived characteristics so that "thanks",
  // "okay" or an update is not flattened into one universal acknowledgement.
  if (SIMPLE_LOCAL.test(intent) && activeSamples >= 3 && activeConfidence >= 0.25) {
    return { route: "local", reason: "strong-person-specific-simple-intent" };
  }
  // This router is reached only by a configured hybrid provider. Partial
  // history lowers style confidence but does not justify replacing reasoning
  // with a stock answer: the verified current story supplies semantics while
  // derived characteristics shape tone.
  const emotionallyComplex = HIGH_JUDGMENT.test(intent) || /\b(?:hurt|upset|angry|miss|love|sorry|conflict|trust|promise)\b/iu.test(String(target.text || ""));
  if (policy.escalationEnabled && emotionallyComplex && (storyLength >= 12 || interactionCount >= 6)) {
    return { route: "escalated", model: policy.escalationModel, reasoningEffort: "medium", reason: "high-judgment-relationship-context" };
  }
  return {
    route: "standard",
    model: policy.standardModel,
    reasoningEffort: emotionallyComplex ? "medium" : "low",
    reason: emotionallyComplex ? "relationship-judgment" : SIMPLE_LOCAL.test(intent) ? "thin-evidence-tone-reasoning" : "multilingual-context-reasoning",
  };
}

export async function modelBudgetDecision({ usageStore, policy, model, estimatedInputTokens, estimatedOutputTokens }) {
  const pricing = MODEL_PRICE_SNAPSHOT.models[model] || null;
  if (!pricing) return { allowed: false, reason: "unknown-model-price", projectedMicrousd: 0 };
  const projectedMicrousd = usageCostMicrousd({ inputTokens: estimatedInputTokens, outputTokens: estimatedOutputTokens }, pricing);
  if (estimatedInputTokens > policy.maxInputTokens) return { allowed: false, reason: "per-call-input-budget", projectedMicrousd };
  const summary = usageStore?.modelUsageSummary ? await usageStore.modelUsageSummary() : { day: { calls: 0 }, month: { estimatedCostMicrousd: 0 } };
  if (Number(summary.day?.calls || 0) >= policy.dailyCallLimit) return { allowed: false, reason: "daily-call-budget", projectedMicrousd };
  if (Number(summary.month?.estimatedCostMicrousd || 0) + projectedMicrousd > policy.monthlyCostLimitMicrousd) return { allowed: false, reason: "monthly-cost-budget", projectedMicrousd };
  return { allowed: true, reason: "within-budget", projectedMicrousd };
}
