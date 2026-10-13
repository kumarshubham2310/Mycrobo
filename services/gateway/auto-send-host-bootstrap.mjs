import { createReadStream } from "node:fs";

import {
  AUTO_SEND_BUILD_CERTIFICATION_CONTRACT,
  autoSendBuildCertificationDigest,
} from "./auto-send-gateway-runtime.mjs";
import { AUTO_SEND_POLICY_VERSION } from "../../packages/core/auto-send-policy.ts";

export const AUTO_SEND_BOOTSTRAP_CONTRACT = "mycrobo.auto-send-host-bootstrap.1";
export const AUTO_SEND_SAFETY_BINDING_CONTRACT = "mycrobo.auto-send-safety-binding.1";
export const AUTO_SEND_DURABLE_STORAGE_BINDING = "tenant-auto-send-v1";

const MAX_BOOTSTRAP_BYTES = 16_384;
const MAX_BOOTSTRAP_AGE_MS = 30_000;
const OPAQUE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const HEX_64 = /^[a-f\d]{64}$/u;
const consumedNonces = new Set();

function expectedBinding(value) {
  const normalized = String(value || "").trim();
  return OPAQUE.test(normalized) ? normalized : "";
}

function rejected(reasonCode) {
  return Object.freeze({ accepted: false, reasonCodes: Object.freeze([reasonCode]) });
}

function validSafetyBinding(binding) {
  return binding?.contract === AUTO_SEND_SAFETY_BINDING_CONTRACT
    && ["disabled", "always-block"].includes(binding?.quietHoursMode)
    && binding?.mediaAssessmentMode === "block-unverified"
    && binding?.customRules === "disabled";
}

export function validateAutoSendHostBootstrap(input, expected = {}, options = {}) {
  const nowMs = Number(options.nowMs ?? Date.now());
  if (!input || typeof input !== "object" || Array.isArray(input)) return rejected("HOST_BOOTSTRAP_ABSENT");
  if (input.contract !== AUTO_SEND_BOOTSTRAP_CONTRACT || input.executionEnabled !== true) return rejected("HOST_BOOTSTRAP_INCOMPLETE");
  const nonce = String(input.nonce || "");
  if (!HEX_64.test(nonce)) return rejected("HOST_BOOTSTRAP_INCOMPLETE");
  if (consumedNonces.has(nonce)) return rejected("HOST_BOOTSTRAP_REPLAYED");
  const issuedAtMs = Number(input.issuedAtMs);
  const expiresAtMs = Number(input.expiresAtMs);
  if (!Number.isSafeInteger(nowMs) || !Number.isSafeInteger(issuedAtMs) || !Number.isSafeInteger(expiresAtMs)
    || issuedAtMs > nowMs || expiresAtMs <= nowMs || expiresAtMs <= issuedAtMs
    || expiresAtMs - issuedAtMs > MAX_BOOTSTRAP_AGE_MS) return rejected("HOST_BOOTSTRAP_STALE");

  const tenantId = expectedBinding(expected.tenantId);
  const userId = expectedBinding(expected.userId);
  const accountId = expectedBinding(expected.accountId);
  const buildVersion = expectedBinding(expected.buildVersion);
  if (!tenantId || !userId || !accountId || !buildVersion
    || input.tenantId !== tenantId || input.userId !== userId
    || input.accountId !== accountId || input.buildVersion !== buildVersion
    || input.policyVersion !== AUTO_SEND_POLICY_VERSION) return rejected("HOST_BOOTSTRAP_BINDING_MISMATCH");

  const certification = input.buildCertification;
  if (certification?.contract !== AUTO_SEND_BUILD_CERTIFICATION_CONTRACT
    || certification?.certified !== true
    || certification?.buildVersion !== buildVersion
    || certification?.policyVersion !== AUTO_SEND_POLICY_VERSION
    || certification?.bindingDigest !== autoSendBuildCertificationDigest(buildVersion)) return rejected("HOST_BOOTSTRAP_CERTIFICATION_INVALID");
  if (input.durableStorage !== AUTO_SEND_DURABLE_STORAGE_BINDING) return rejected("HOST_BOOTSTRAP_DURABLE_BINDING_INVALID");
  if (!validSafetyBinding(input.safetyBinding)) return rejected("HOST_BOOTSTRAP_SAFETY_BINDING_INVALID");
  const signingSecret = String(input.signingSecret || "");
  if (Buffer.byteLength(signingSecret, "utf8") < 32 || /[\r\n\0]/u.test(signingSecret)) return rejected("HOST_BOOTSTRAP_SIGNING_BINDING_INVALID");

  consumedNonces.add(nonce);
  return Object.freeze({
    accepted: true,
    reasonCodes: Object.freeze([]),
    bootstrap: Object.freeze({
      tenantId,
      userId,
      accountId,
      buildVersion,
      policyVersion: AUTO_SEND_POLICY_VERSION,
      buildCertification: Object.freeze({ ...certification }),
      durableStorage: AUTO_SEND_DURABLE_STORAGE_BINDING,
      safetyBinding: Object.freeze({ ...input.safetyBinding }),
      signingSecret,
    }),
  });
}

export async function readAutoSendHostBootstrap(stream, expected, options = {}) {
  if (!stream || typeof stream[Symbol.asyncIterator] !== "function") return rejected("HOST_BOOTSTRAP_ABSENT");
  const chunks = [];
  let bytes = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_BOOTSTRAP_BYTES) return rejected("HOST_BOOTSTRAP_OVERSIZED");
      chunks.push(buffer);
    }
  } catch {
    return rejected("HOST_BOOTSTRAP_ABSENT");
  }
  if (!bytes) return rejected("HOST_BOOTSTRAP_ABSENT");
  try {
    return validateAutoSendHostBootstrap(JSON.parse(Buffer.concat(chunks).toString("utf8")), expected, options);
  } catch {
    return rejected("HOST_BOOTSTRAP_MALFORMED");
  }
}

export async function readAutoSendHostBootstrapFromFd(fd, expected, options = {}) {
  let stream;
  try {
    stream = createReadStream(null, { fd, autoClose: false });
    return await readAutoSendHostBootstrap(stream, expected, options);
  } catch {
    return rejected("HOST_BOOTSTRAP_ABSENT");
  } finally {
    stream?.destroy();
  }
}
