import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_TRANSLATION_CONTRACT_VERSION,
  TRANSLATION_MAX_TEXT_CODE_POINTS,
  structuredTranslateGemmaContent,
  validateLocalTranslationRequest,
} from "./local-translation.mjs";

const tenantId = "tenant-0000000000000001";

test("local translation contract produces TranslateGemma structured content", () => {
  const request = validateLocalTranslationRequest({
    tenantId,
    text: "Dobré ráno",
    sourceLangCode: "cs",
    targetLangCode: "de_de",
    maxNewTokens: 128,
  }, tenantId);
  assert.equal(request.contractVersion, LOCAL_TRANSLATION_CONTRACT_VERSION);
  assert.deepEqual(structuredTranslateGemmaContent(request), [{
    type: "text",
    source_lang_code: "cs",
    target_lang_code: "de-DE",
    text: "Dobré ráno",
  }]);
});

test("local translation contract rejects tenant crossover and oversized input", () => {
  assert.throws(() => validateLocalTranslationRequest({
    tenantId: "tenant-0000000000000002",
    text: "hello",
    sourceLangCode: "en",
    targetLangCode: "hi",
  }, tenantId), (error) => error.code === "TENANT_MISMATCH");
  assert.throws(() => validateLocalTranslationRequest({
    tenantId,
    text: "x".repeat(TRANSLATION_MAX_TEXT_CODE_POINTS + 1),
    sourceLangCode: "en",
    targetLangCode: "hi",
  }, tenantId), (error) => error.code === "TEXT_TOO_LARGE");
});

test("local translation contract rejects ambiguous languages and output bounds", () => {
  assert.throws(() => validateLocalTranslationRequest({ tenantId, text: "hello", sourceLangCode: "English", targetLangCode: "hi" }, tenantId), (error) => error.code === "LANGUAGE_INVALID");
  assert.throws(() => validateLocalTranslationRequest({ tenantId, text: "hello", sourceLangCode: "en", targetLangCode: "en" }, tenantId), (error) => error.code === "LANGUAGE_SAME");
  assert.throws(() => validateLocalTranslationRequest({ tenantId, text: "hello", sourceLangCode: "en", targetLangCode: "hi", maxNewTokens: 513 }, tenantId), (error) => error.code === "OUTPUT_BOUND_INVALID");
});
