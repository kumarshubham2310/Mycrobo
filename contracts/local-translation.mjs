export const LOCAL_TRANSLATION_CONTRACT_VERSION = "mycrobo-local-translation.1";
export const LOCAL_TRANSLATION_MODEL = "google/translategemma-4b-it";
export const TRANSLATION_CONTEXT_TOKENS = 2_048;
export const TRANSLATION_MAX_NEW_TOKENS = 512;
export const TRANSLATION_DEFAULT_NEW_TOKENS = 256;
export const TRANSLATION_MAX_TEXT_CODE_POINTS = 1_536;
export const TRANSLATION_MAX_TEXT_BYTES = 12_288;

const TENANT_ID = /^tenant-[a-f0-9]{16}$/u;
const LANGUAGE_CODE = /^[a-z]{2}(?:-[A-Z]{2})?$/u;

export class LocalTranslationContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LocalTranslationContractError";
    this.code = code;
  }
}

export function assertTranslationTenantId(value) {
  const tenantId = String(value || "").trim();
  if (!TENANT_ID.test(tenantId)) {
    throw new LocalTranslationContractError("TENANT_INVALID", "Translation requires a verified local workspace.");
  }
  return tenantId;
}

export function normalizeTranslationLanguageCode(value) {
  const raw = String(value || "").trim().replace(/_/gu, "-");
  const parts = raw.split("-");
  const normalized = parts.length === 1
    ? parts[0].toLowerCase()
    : `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}`;
  if (!LANGUAGE_CODE.test(normalized)) {
    throw new LocalTranslationContractError("LANGUAGE_INVALID", "Use a two-letter language code with an optional region.");
  }
  return normalized;
}

export function validateLocalTranslationRequest(input, expectedTenantId) {
  const tenantId = assertTranslationTenantId(input?.tenantId);
  if (tenantId !== assertTranslationTenantId(expectedTenantId)) {
    throw new LocalTranslationContractError("TENANT_MISMATCH", "The translation request belongs to a different workspace.");
  }
  const text = typeof input?.text === "string" ? input.text : "";
  const points = [...text];
  if (!text.trim()) throw new LocalTranslationContractError("TEXT_REQUIRED", "Translation text is required.");
  if (points.length > TRANSLATION_MAX_TEXT_CODE_POINTS || Buffer.byteLength(text, "utf8") > TRANSLATION_MAX_TEXT_BYTES) {
    throw new LocalTranslationContractError("TEXT_TOO_LARGE", "Translation text exceeds the bounded local context.");
  }
  if (text.includes("\u0000")) throw new LocalTranslationContractError("TEXT_INVALID", "Translation text contains an unsupported character.");
  const maxNewTokens = input?.maxNewTokens === undefined
    ? TRANSLATION_DEFAULT_NEW_TOKENS
    : Number(input.maxNewTokens);
  if (!Number.isInteger(maxNewTokens) || maxNewTokens < 1 || maxNewTokens > TRANSLATION_MAX_NEW_TOKENS) {
    throw new LocalTranslationContractError("OUTPUT_BOUND_INVALID", "Translation output must be bounded to 1–512 tokens.");
  }
  const sourceLangCode = normalizeTranslationLanguageCode(input?.sourceLangCode);
  const targetLangCode = normalizeTranslationLanguageCode(input?.targetLangCode);
  if (sourceLangCode === targetLangCode) {
    throw new LocalTranslationContractError("LANGUAGE_SAME", "Source and target languages must differ.");
  }
  return Object.freeze({
    contractVersion: LOCAL_TRANSLATION_CONTRACT_VERSION,
    tenantId,
    text,
    sourceLangCode,
    targetLangCode,
    maxNewTokens,
  });
}

export function structuredTranslateGemmaContent(request) {
  return Object.freeze([Object.freeze({
    type: "text",
    source_lang_code: request.sourceLangCode,
    target_lang_code: request.targetLangCode,
    text: request.text,
  })]);
}
