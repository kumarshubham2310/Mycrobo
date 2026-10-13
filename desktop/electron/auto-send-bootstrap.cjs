const { createHash, randomBytes } = require("node:crypto");
const { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

const AUTO_SEND_BOOTSTRAP_FILE = "auto-send-bootstrap.bin";
const AUTO_SEND_HOST_CONFIG_CONTRACT = "mycrobo.auto-send-host-config.1";
const AUTO_SEND_BOOTSTRAP_CONTRACT = "mycrobo.auto-send-host-bootstrap.1";
const AUTO_SEND_BUILD_CERTIFICATION_CONTRACT = "mycrobo.auto-send-build-certification.1";
const AUTO_SEND_SAFETY_BINDING_CONTRACT = "mycrobo.auto-send-safety-binding.1";
const AUTO_SEND_POLICY_VERSION = "auto-send-policy.1";
const AUTO_SEND_DURABLE_STORAGE_BINDING = "tenant-auto-send-v1";
const MAX_BOOTSTRAP_AGE_MS = 30_000;
const OPAQUE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const HEX_64 = /^[a-f\d]{64}$/u;

function certificationDigest(buildVersion) {
  return createHash("sha256")
    .update(`${AUTO_SEND_BUILD_CERTIFICATION_CONTRACT}\u0000${buildVersion}\u0000${AUTO_SEND_POLICY_VERSION}`, "utf8")
    .digest("hex");
}

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!OPAQUE.test(normalized)) throw new Error(`${name} is not a valid opaque binding.`);
  return normalized;
}

function validateSafetyBinding(input) {
  if (input?.contract !== AUTO_SEND_SAFETY_BINDING_CONTRACT
    || !["disabled", "always-block"].includes(input?.quietHoursMode)
    || input?.mediaAssessmentMode !== "block-unverified"
    || input?.customRules !== "disabled") {
    throw new Error("The automatic-delivery safety binding is incomplete.");
  }
  return Object.freeze({
    contract: AUTO_SEND_SAFETY_BINDING_CONTRACT,
    quietHoursMode: input.quietHoursMode,
    mediaAssessmentMode: "block-unverified",
    customRules: "disabled",
  });
}

function validateHostConfig(input, expected) {
  if (input?.contract !== AUTO_SEND_HOST_CONFIG_CONTRACT || input?.executionEnabled !== true) {
    throw new Error("Automatic delivery is not explicitly enabled by a protected host configuration.");
  }
  const tenantId = required(input.tenantId, "tenantId");
  const userId = required(input.userId, "userId");
  const accountId = required(input.accountId, "accountId");
  const buildVersion = required(input.buildVersion, "buildVersion");
  if (tenantId !== expected.tenantId || userId !== expected.userId || accountId !== expected.accountId || buildVersion !== expected.buildVersion) {
    throw new Error("The protected automatic-delivery configuration belongs to another runtime binding.");
  }
  const certification = input.buildCertification;
  if (certification?.contract !== AUTO_SEND_BUILD_CERTIFICATION_CONTRACT
    || certification?.certified !== true
    || certification?.buildVersion !== buildVersion
    || certification?.policyVersion !== AUTO_SEND_POLICY_VERSION
    || certification?.bindingDigest !== certificationDigest(buildVersion)) {
    throw new Error("The protected automatic-delivery build certification is invalid.");
  }
  const signingSecret = String(input.signingSecret || "");
  if (Buffer.byteLength(signingSecret, "utf8") < 32 || /[\r\n\0]/u.test(signingSecret)) {
    throw new Error("The protected automatic-delivery signing key is invalid.");
  }
  const provisionedAtMs = Date.parse(String(input.provisionedAt || ""));
  if (!Number.isFinite(provisionedAtMs)) throw new Error("The protected automatic-delivery configuration has no valid provisioning time.");
  if (input.durableStorage !== AUTO_SEND_DURABLE_STORAGE_BINDING) {
    throw new Error("The protected automatic-delivery durable storage binding is invalid.");
  }
  return Object.freeze({
    contract: AUTO_SEND_HOST_CONFIG_CONTRACT,
    executionEnabled: true,
    tenantId,
    userId,
    accountId,
    buildVersion,
    policyVersion: AUTO_SEND_POLICY_VERSION,
    buildCertification: Object.freeze({ ...certification }),
    safetyBinding: validateSafetyBinding(input.safetyBinding),
    durableStorage: AUTO_SEND_DURABLE_STORAGE_BINDING,
    signingSecret,
    provisionedAt: new Date(provisionedAtMs).toISOString(),
  });
}

function bootstrapPath(userData) {
  return join(String(userData || ""), AUTO_SEND_BOOTSTRAP_FILE);
}

function storeProtectedAutoSendBootstrap({ userData, safeStorage, config, expected }) {
  if (!safeStorage?.isEncryptionAvailable?.()) throw new Error("Windows secure storage is unavailable.");
  const validated = validateHostConfig(config, expected);
  const target = bootstrapPath(userData);
  const temporary = `${target}.new`;
  try {
    writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(validated)), { mode: 0o600, flag: "w" });
    renameSync(temporary, target);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return Object.freeze({ configured: true, contract: AUTO_SEND_HOST_CONFIG_CONTRACT });
}

function loadProtectedAutoSendBootstrap({ userData, safeStorage, expected, nowMs = Date.now() }) {
  const target = bootstrapPath(userData);
  if (!existsSync(target)) return null;
  if (!safeStorage?.isEncryptionAvailable?.()) throw new Error("Windows secure storage is unavailable.");
  let parsed;
  try {
    parsed = JSON.parse(safeStorage.decryptString(readFileSync(target)));
  } catch {
    throw new Error("The protected automatic-delivery configuration is unreadable.");
  }
  const config = validateHostConfig(parsed, expected);
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new Error("The bootstrap time is invalid.");
  return Object.freeze({
    contract: AUTO_SEND_BOOTSTRAP_CONTRACT,
    executionEnabled: true,
    nonce: randomBytes(32).toString("hex"),
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + MAX_BOOTSTRAP_AGE_MS,
    tenantId: config.tenantId,
    userId: config.userId,
    accountId: config.accountId,
    buildVersion: config.buildVersion,
    policyVersion: AUTO_SEND_POLICY_VERSION,
    buildCertification: config.buildCertification,
    safetyBinding: config.safetyBinding,
    durableStorage: config.durableStorage,
    signingSecret: config.signingSecret,
  });
}

module.exports = {
  AUTO_SEND_BOOTSTRAP_CONTRACT,
  AUTO_SEND_BOOTSTRAP_FILE,
  AUTO_SEND_BUILD_CERTIFICATION_CONTRACT,
  AUTO_SEND_DURABLE_STORAGE_BINDING,
  AUTO_SEND_HOST_CONFIG_CONTRACT,
  AUTO_SEND_POLICY_VERSION,
  AUTO_SEND_SAFETY_BINDING_CONTRACT,
  bootstrapPath,
  certificationDigest,
  loadProtectedAutoSendBootstrap,
  storeProtectedAutoSendBootstrap,
  validateHostConfig,
};
