import { createHash } from "node:crypto";
import { isAbsolute, join } from "node:path";

import { AutoSendAuthorizationIssuer } from "../../packages/core/auto-send-authorization.ts";
import { AUTO_SEND_POLICY_VERSION } from "../../packages/core/auto-send-policy.ts";
import { SqliteAutoSendAuthorizationLedger } from "./auto-send-ledger.mjs";
import { SqliteAutoSendOutbox } from "./auto-send-outbox.mjs";
import { AutoSendRuntimePlanner } from "./auto-send-runtime.mjs";

export const AUTO_SEND_BUILD_CERTIFICATION_CONTRACT = "mycrobo.auto-send-build-certification.1";
export const AUTO_SEND_GATEWAY_RUNTIME_CONTRACT = "mycrobo.auto-send-gateway-runtime.1";

const BINDING = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;

function digest(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

export function autoSendBuildCertificationDigest(buildVersion) {
  return digest(`${AUTO_SEND_BUILD_CERTIFICATION_CONTRACT}\u0000${String(buildVersion || "").trim()}\u0000${AUTO_SEND_POLICY_VERSION}`);
}

function validBinding(value) {
  return BINDING.test(String(value || "").trim());
}

function configurationReasons(options) {
  const reasons = [];
  const buildVersion = String(options.buildVersion || "").trim();
  const certification = options.buildCertification;
  if (options.executionEnabled !== true) reasons.push("EXECUTION_FLAG_DISABLED");
  if (!validBinding(options.tenantId)) reasons.push("TENANT_BINDING_UNAVAILABLE");
  if (!validBinding(options.userId)) reasons.push("USER_BINDING_UNAVAILABLE");
  if (!validBinding(options.accountId)) reasons.push("ACCOUNT_BINDING_UNAVAILABLE");
  if (!buildVersion
    || certification?.contract !== AUTO_SEND_BUILD_CERTIFICATION_CONTRACT
    || certification?.certified !== true
    || certification?.buildVersion !== buildVersion
    || certification?.policyVersion !== AUTO_SEND_POLICY_VERSION
    || certification?.bindingDigest !== autoSendBuildCertificationDigest(buildVersion)) {
    reasons.push("BUILD_NOT_CERTIFIED");
  }
  if (!isAbsolute(String(options.dataDir || "").trim())) reasons.push("DURABLE_STORAGE_UNAVAILABLE");
  const signingSecretBytes = Buffer.isBuffer(options.signingSecret)
    ? options.signingSecret.byteLength
    : Buffer.byteLength(String(options.signingSecret || ""), "utf8");
  if (signingSecretBytes < 32) reasons.push("AUTHORIZATION_KEY_UNAVAILABLE");
  if (typeof options.deliveryBoundary !== "function") reasons.push("DELIVERY_BOUNDARY_UNAVAILABLE");
  if (typeof options.loadSafetyAuthorities !== "function") reasons.push("SAFETY_AUTHORITIES_UNAVAILABLE");
  return [...new Set(reasons)].sort();
}

function publicStatus(available, reasons) {
  return Object.freeze({
    contract: AUTO_SEND_GATEWAY_RUNTIME_CONTRACT,
    requested: !reasons.includes("EXECUTION_FLAG_DISABLED"),
    available,
    executionEnabled: !reasons.includes("EXECUTION_FLAG_DISABLED"),
    releaseCertified: !reasons.includes("BUILD_NOT_CERTIFIED"),
    identityBound: !reasons.some((reason) => ["TENANT_BINDING_UNAVAILABLE", "USER_BINDING_UNAVAILABLE", "ACCOUNT_BINDING_UNAVAILABLE"].includes(reason)),
    durableLifecycle: !reasons.includes("DURABLE_STORAGE_UNAVAILABLE"),
    deliveryBoundaryConfigured: !reasons.includes("DELIVERY_BOUNDARY_UNAVAILABLE"),
    safetyAuthoritiesConfigured: !reasons.includes("SAFETY_AUTHORITIES_UNAVAILABLE"),
    reasonCodes: Object.freeze([...reasons]),
  });
}

function unavailableRuntime(reasons) {
  const status = publicStatus(false, reasons);
  return Object.freeze({
    status: () => status,
    async run() { return publicAutoSendResult(null, status); },
    close() {},
  });
}

export function publicAutoSendResult(result, fallbackStatus) {
  if (!result) return Object.freeze({
    ...fallbackStatus,
    state: fallbackStatus.available ? "not-evaluated" : "disabled",
    cancellationAvailable: false,
    countdownEndsAt: null,
    delivered: false,
    contentStored: false,
  });
  const countdownEndsAt = result.state === "countdown" && Number.isSafeInteger(result.job?.countdownNotBeforeMs)
    ? new Date(result.job.countdownNotBeforeMs).toISOString()
    : null;
  return Object.freeze({
    ...fallbackStatus,
    state: result.state,
    reasonCodes: Object.freeze([...(result.reasons || [])]),
    effectiveMode: result.policyDecision?.effectiveMode || null,
    modeSource: result.policyDecision?.modeSource || null,
    eligibleForAuthorization: result.policyDecision?.eligibleForAuthorization === true,
    cancellationAvailable: result.state === "countdown",
    countdownEndsAt,
    delivered: result.state === "sent",
    contentStored: false,
  });
}

/**
 * Trusted gateway adapter for the fail-closed planner. Environment variables
 * are intentionally not read here: enabling execution requires explicit
 * constructor wiring by the host and a build-bound certification record.
 */
export function createGatewayAutoSendRuntime(options = {}) {
  const reasons = configurationReasons(options);
  if (reasons.length) return unavailableRuntime(reasons);

  let ledger;
  let outbox;
  let issuer;
  try {
    ledger = new SqliteAutoSendAuthorizationLedger(join(options.dataDir, "authorization.sqlite"));
    outbox = new SqliteAutoSendOutbox(join(options.dataDir, "outbox.sqlite"));
    const nowMs = Number(options.clock?.() ?? Date.now());
    outbox.recoverAfterRestart(Number.isSafeInteger(nowMs) && nowMs >= 0 ? nowMs : Date.now());
    issuer = new AutoSendAuthorizationIssuer({ secret: options.signingSecret, ledger });
  } catch {
    try { outbox?.close(); } catch { /* fail closed without diagnostic content */ }
    try { ledger?.close(); } catch { /* fail closed without diagnostic content */ }
    return unavailableRuntime(["DURABLE_STORAGE_UNAVAILABLE"]);
  }
  const status = publicStatus(true, []);

  return Object.freeze({
    status: () => status,
    async run({ request, loadCurrentState, cancelRequested = false, signal } = {}) {
      if (request?.tenantId !== options.tenantId
        || request?.userId !== options.userId
        || request?.accountId !== options.accountId) {
        return publicAutoSendResult({ state: "blocked", reasons: ["GATEWAY_BINDING_MISMATCH"] }, status);
      }
      const planner = new AutoSendRuntimePlanner({
        enabled: true,
        buildVersion: options.buildVersion,
        issuer,
        outbox,
        loadCurrentState,
        deliveryBoundary: options.deliveryBoundary,
        clock: options.clock,
        countdownMs: options.countdownMs,
      });
      const result = await planner.run({ ...request, cancelRequested, signal });
      return publicAutoSendResult(result, status);
    },
    async safetyAuthorities(input) {
      return options.loadSafetyAuthorities(Object.freeze({ ...input }));
    },
    close() {
      outbox.close();
      ledger.close();
    },
  });
}
