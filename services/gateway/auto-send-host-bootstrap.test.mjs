import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import {
  AUTO_SEND_BOOTSTRAP_CONTRACT,
  AUTO_SEND_DURABLE_STORAGE_BINDING,
  AUTO_SEND_SAFETY_BINDING_CONTRACT,
  readAutoSendHostBootstrap,
  validateAutoSendHostBootstrap,
} from "./auto-send-host-bootstrap.mjs";
import {
  AUTO_SEND_BUILD_CERTIFICATION_CONTRACT,
  autoSendBuildCertificationDigest,
} from "./auto-send-gateway-runtime.mjs";

const expected = Object.freeze({ tenantId: "tenant-42", userId: "user-42", accountId: "account-42", buildVersion: "1.2.3" });
let sequence = 0;

function envelope(overrides = {}) {
  sequence += 1;
  return {
    contract: AUTO_SEND_BOOTSTRAP_CONTRACT,
    executionEnabled: true,
    nonce: sequence.toString(16).padStart(64, "0"),
    issuedAtMs: 1_000,
    expiresAtMs: 31_000,
    ...expected,
    policyVersion: "auto-send-policy.1",
    buildCertification: {
      contract: AUTO_SEND_BUILD_CERTIFICATION_CONTRACT,
      certified: true,
      buildVersion: expected.buildVersion,
      policyVersion: "auto-send-policy.1",
      bindingDigest: autoSendBuildCertificationDigest(expected.buildVersion),
    },
    durableStorage: AUTO_SEND_DURABLE_STORAGE_BINDING,
    safetyBinding: {
      contract: AUTO_SEND_SAFETY_BINDING_CONTRACT,
      quietHoursMode: "disabled",
      mediaAssessmentMode: "block-unverified",
      customRules: "disabled",
    },
    signingSecret: "test-only-bootstrap-signing-secret-at-least-32-bytes",
    ...overrides,
  };
}

test("host bootstrap is absent or partial by default", async () => {
  assert.deepEqual(await readAutoSendHostBootstrap(null, expected, { nowMs: 2_000 }), {
    accepted: false, reasonCodes: ["HOST_BOOTSTRAP_ABSENT"],
  });
  assert.equal(validateAutoSendHostBootstrap({ contract: AUTO_SEND_BOOTSTRAP_CONTRACT }, expected, { nowMs: 2_000 }).accepted, false);
});

test("host bootstrap rejects identity mismatch and stale envelopes", () => {
  assert.deepEqual(validateAutoSendHostBootstrap(envelope({ accountId: "account-foreign" }), expected, { nowMs: 2_000 }).reasonCodes, ["HOST_BOOTSTRAP_BINDING_MISMATCH"]);
  assert.deepEqual(validateAutoSendHostBootstrap(envelope(), expected, { nowMs: 31_001 }).reasonCodes, ["HOST_BOOTSTRAP_STALE"]);
});

test("host bootstrap accepts exactly once and rejects replay", () => {
  const input = envelope();
  const accepted = validateAutoSendHostBootstrap(input, expected, { nowMs: 2_000 });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.bootstrap.signingSecret, input.signingSecret);
  assert.deepEqual(validateAutoSendHostBootstrap(input, expected, { nowMs: 2_001 }).reasonCodes, ["HOST_BOOTSTRAP_REPLAYED"]);
});

test("host channel parsing rejects malformed and accepts a complete bounded envelope", async () => {
  assert.deepEqual((await readAutoSendHostBootstrap(Readable.from(["{"]), expected, { nowMs: 2_000 })).reasonCodes, ["HOST_BOOTSTRAP_MALFORMED"]);
  const result = await readAutoSendHostBootstrap(Readable.from([JSON.stringify(envelope())]), expected, { nowMs: 2_000 });
  assert.equal(result.accepted, true);
});
