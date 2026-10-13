const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");

const {
  AUTO_SEND_BUILD_CERTIFICATION_CONTRACT,
  AUTO_SEND_DURABLE_STORAGE_BINDING,
  AUTO_SEND_HOST_CONFIG_CONTRACT,
  AUTO_SEND_SAFETY_BINDING_CONTRACT,
  bootstrapPath,
  certificationDigest,
  loadProtectedAutoSendBootstrap,
  storeProtectedAutoSendBootstrap,
} = require("./auto-send-bootstrap.cjs");

const expected = Object.freeze({
  tenantId: "tenant-0000000000000042",
  userId: "user-000000000000000000000042",
  accountId: "account-bootstrap",
  buildVersion: "1.2.3-test",
});
const secret = "test-only-protected-auto-send-secret-at-least-32-bytes";
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`protected:${Buffer.from(value, "utf8").toString("base64")}`, "utf8"),
  decryptString: (value) => Buffer.from(value.toString("utf8").replace(/^protected:/u, ""), "base64").toString("utf8"),
};

function config(overrides = {}) {
  return {
    contract: AUTO_SEND_HOST_CONFIG_CONTRACT,
    executionEnabled: true,
    ...expected,
    policyVersion: "auto-send-policy.1",
    buildCertification: {
      contract: AUTO_SEND_BUILD_CERTIFICATION_CONTRACT,
      certified: true,
      buildVersion: expected.buildVersion,
      policyVersion: "auto-send-policy.1",
      bindingDigest: certificationDigest(expected.buildVersion),
    },
    safetyBinding: {
      contract: AUTO_SEND_SAFETY_BINDING_CONTRACT,
      quietHoursMode: "disabled",
      mediaAssessmentMode: "block-unverified",
      customRules: "disabled",
    },
    durableStorage: AUTO_SEND_DURABLE_STORAGE_BINDING,
    signingSecret: secret,
    provisionedAt: "2026-10-08T10:00:00.000Z",
    ...overrides,
  };
}

test("protected host bootstrap is absent and disabled by default", () => {
  const directory = mkdtempSync(join(tmpdir(), "mycrobo-auto-send-bootstrap-"));
  try {
    assert.equal(loadProtectedAutoSendBootstrap({ userData: directory, safeStorage, expected }), null);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("protected host bootstrap rejects partial and mismatched bindings", () => {
  const directory = mkdtempSync(join(tmpdir(), "mycrobo-auto-send-bootstrap-"));
  try {
    assert.throws(() => storeProtectedAutoSendBootstrap({ userData: directory, safeStorage, expected, config: config({ signingSecret: "short" }) }), /signing key/u);
    assert.throws(() => storeProtectedAutoSendBootstrap({ userData: directory, safeStorage, expected, config: config({ accountId: "account-other" }) }), /another runtime binding/u);
    assert.equal(existsSyncSafe(bootstrapPath(directory)), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("valid bootstrap is encrypted at rest and emits a short-lived one-shot envelope", () => {
  const directory = mkdtempSync(join(tmpdir(), "mycrobo-auto-send-bootstrap-"));
  try {
    storeProtectedAutoSendBootstrap({ userData: directory, safeStorage, expected, config: config() });
    const bytes = readFileSync(bootstrapPath(directory));
    assert.equal(bytes.includes(Buffer.from(secret, "utf8")), false);
    assert.match(bytes.toString("utf8"), /^protected:/u);
    const envelope = loadProtectedAutoSendBootstrap({ userData: directory, safeStorage, expected, nowMs: 1_000 });
    assert.equal(envelope.executionEnabled, true);
    assert.equal(envelope.expiresAtMs, 31_000);
    assert.match(envelope.nonce, /^[a-f\d]{64}$/u);
    assert.equal(envelope.signingSecret, secret);
    assert.equal(envelope.durableStorage, AUTO_SEND_DURABLE_STORAGE_BINDING);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

function existsSyncSafe(path) {
  try { readFileSync(path); return true; } catch { return false; }
}
