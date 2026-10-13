import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  AUTO_SEND_POLICY_VERSION,
  evaluateAutoSendPolicy,
  type AutoSendPolicyDecision,
  type AutoSendPolicyInput,
} from "./auto-send-policy.ts";

export const AUTO_SEND_AUTHORIZATION_KIND = "mycrobo.auto-send-authorization.1" as const;
export const AUTO_SEND_REVALIDATION_CONTRACT = "mycrobo.auto-send-revalidation.1" as const;
export const DEFAULT_AUTHORIZATION_TTL_MS = 30_000;
export const MAX_AUTHORIZATION_TTL_MS = 120_000;

export type AutoSendAuthorizationBinding = {
  tenantId: string;
  accountId: string;
  relationshipGraphId: string;
  relationshipGraphVersion: string;
  chatId: string;
  targetMessageId: string;
  draftHash: string;
  policyVersion: string;
};

export type AutoSendAuthorizationPayload = AutoSendAuthorizationBinding & {
  kind: typeof AUTO_SEND_AUTHORIZATION_KIND;
  revalidationContract: typeof AUTO_SEND_REVALIDATION_CONTRACT;
  authorizationId: string;
  issuedAtMs: number;
  expiresAtMs: number;
};

export type IssueAuthorizationInput = Omit<AutoSendAuthorizationBinding, "draftHash" | "policyVersion"> & {
  idempotencyKey: string;
  draftText: string;
  policy: AutoSendPolicyInput;
  nowMs: number;
  ttlMs?: number;
};

export type RevalidationInput = Omit<AutoSendAuthorizationBinding, "draftHash" | "policyVersion"> & {
  token: string;
  executionId: string;
  draftText: string;
  policy: AutoSendPolicyInput;
  nowMs: number;
};

export type AuthorizedSendIntent = Readonly<{
  authorizationId: string;
  executionId: string;
  tenantId: string;
  accountId: string;
  relationshipGraphId: string;
  relationshipGraphVersion: string;
  chatId: string;
  targetMessageId: string;
  draftHash: string;
  policyVersion: string;
  authorizedAtMs: number;
  expiresAtMs: number;
  revalidationContract: typeof AUTO_SEND_REVALIDATION_CONTRACT;
}>;

export type AutoSendDeliveryRecord = Readonly<{
  authorizationId: string;
  executionId: string;
  deliveredAtMs: number;
  receiptFingerprint: string;
}>;

export type AutoSendAuthorizationLedgerRecord = {
  authorizationId: string;
  idempotencyKey: string;
  bindingFingerprint: string;
  encodedPayload: string;
  tokenHash: string;
  expiresAtMs: number;
  status: "issued" | "consumed" | "delivered";
  intent?: AuthorizedSendIntent;
  delivery?: AutoSendDeliveryRecord;
};

export type AutoSendAuthorizationLedger = {
  reserve(record: AutoSendAuthorizationLedgerRecord): AutoSendAuthorizationLedgerRecord;
  findByAuthorizationId(authorizationId: string): AutoSendAuthorizationLedgerRecord | null;
  consume(authorizationId: string, tokenHash: string, intent: AuthorizedSendIntent): AuthorizedSendIntent;
  complete(authorizationId: string, executionId: string, delivery: AutoSendDeliveryRecord): AutoSendDeliveryRecord;
  prune?(nowMs: number): void;
};

/**
 * Test/development-only ledger. A production send boundary must provide a
 * durable transactional implementation (for example a database row locked by
 * authorization_id) so a process restart cannot resurrect a capability.
 */
export class InMemoryAutoSendAuthorizationLedger implements AutoSendAuthorizationLedger {
  #byIdempotencyKey = new Map<string, AutoSendAuthorizationLedgerRecord>();
  #byAuthorizationId = new Map<string, AutoSendAuthorizationLedgerRecord>();

  reserve(record: AutoSendAuthorizationLedgerRecord) {
    const prior = this.#byIdempotencyKey.get(record.idempotencyKey);
    if (prior) return prior;
    const frozen = Object.freeze({ ...record });
    this.#byIdempotencyKey.set(record.idempotencyKey, frozen);
    this.#byAuthorizationId.set(record.authorizationId, frozen);
    return frozen;
  }

  findByAuthorizationId(authorizationId: string) {
    return this.#byAuthorizationId.get(authorizationId) ?? null;
  }

  consume(authorizationId: string, tokenHash: string, intent: AuthorizedSendIntent) {
    const record = this.#byAuthorizationId.get(authorizationId);
    if (!record || !fingerprintsMatch(record.tokenHash, tokenHash)) {
      throw new Error("Authorization token is not present in the active send ledger.");
    }
    if (record.status === "consumed") {
      if (record.intent?.executionId !== intent.executionId) throw new Error("Authorization token was already consumed.");
      return record.intent;
    }
    if (record.status === "delivered") {
      if (record.intent?.executionId !== intent.executionId) throw new Error("Authorization token was already delivered.");
      return record.intent;
    }
    const consumed = Object.freeze({ ...record, status: "consumed" as const, intent });
    this.#byAuthorizationId.set(authorizationId, consumed);
    this.#byIdempotencyKey.set(record.idempotencyKey, consumed);
    return intent;
  }

  complete(authorizationId: string, executionId: string, delivery: AutoSendDeliveryRecord) {
    const record = this.#byAuthorizationId.get(authorizationId);
    if (!record?.intent || record.intent.executionId !== executionId) {
      throw new Error("Only the consuming execution can complete this delivery.");
    }
    if (record.status === "delivered") {
      if (!record.delivery || record.delivery.receiptFingerprint !== delivery.receiptFingerprint) {
        throw new Error("Delivery completion conflicts with the recorded receipt.");
      }
      return record.delivery;
    }
    if (record.status !== "consumed") throw new Error("Authorization must be consumed before delivery completion.");
    const delivered = Object.freeze({ ...record, status: "delivered" as const, delivery });
    this.#byAuthorizationId.set(authorizationId, delivered);
    this.#byIdempotencyKey.set(record.idempotencyKey, delivered);
    return delivery;
  }

  prune(nowMs: number) {
    for (const [authorizationId, record] of this.#byAuthorizationId) {
      if (record.status === "issued" && record.expiresAtMs <= nowMs) {
        this.#byAuthorizationId.delete(authorizationId);
        this.#byIdempotencyKey.delete(record.idempotencyKey);
      }
    }
  }
}

function required(value: string, name: string) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function stableBinding(binding: AutoSendAuthorizationBinding) {
  return JSON.stringify({
    tenantId: binding.tenantId,
    accountId: binding.accountId,
    relationshipGraphId: binding.relationshipGraphId,
    relationshipGraphVersion: binding.relationshipGraphVersion,
    chatId: binding.chatId,
    targetMessageId: binding.targetMessageId,
    draftHash: binding.draftHash,
    policyVersion: binding.policyVersion,
  });
}

function fingerprintsMatch(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function hashAutoSendDraft(draftText: string) {
  return createHash("sha256").update(String(draftText), "utf8").digest("hex");
}

/**
 * Short-lived capability issuer backed by the injected ledger. Durable
 * ledgers persist only the signed payload and bearer hash; the bearer
 * signature is reconstructed with the process-held signing key.
 */
export class AutoSendAuthorizationIssuer {
  #secret: Buffer;
  #ledger: AutoSendAuthorizationLedger;

  constructor(options: { secret: string | Buffer; ledger: AutoSendAuthorizationLedger }) {
    if (!options?.ledger) throw new Error("A durable authorization ledger is required.");
    this.#secret = Buffer.from(options.secret);
    this.#ledger = options.ledger;
    if (this.#secret.byteLength < 32) throw new Error("Authorization signing secret must be at least 32 bytes.");
  }

  #signature(encodedPayload: string) {
    return createHmac("sha256", this.#secret).update(encodedPayload, "utf8").digest("base64url");
  }

  #prune(nowMs: number) {
    this.#ledger.prune?.(nowMs);
  }

  issue(input: IssueAuthorizationInput) {
    const decision = evaluateAutoSendPolicy(input.policy);
    if (!decision.eligibleForAuthorization) throw new Error("Policy decision is not eligible for authorization.");
    if (decision.policyVersion !== AUTO_SEND_POLICY_VERSION) throw new Error("Unsupported policy version.");
    if (!Number.isSafeInteger(input.nowMs) || input.nowMs < 0) throw new Error("nowMs must be a non-negative integer.");
    const ttlMs = input.ttlMs ?? DEFAULT_AUTHORIZATION_TTL_MS;
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAX_AUTHORIZATION_TTL_MS) {
      throw new Error(`Authorization TTL must be between 1 and ${MAX_AUTHORIZATION_TTL_MS} ms.`);
    }

    this.#prune(input.nowMs);
    const idempotencyKey = required(input.idempotencyKey, "idempotencyKey");
    const binding: AutoSendAuthorizationBinding = {
      tenantId: required(input.tenantId, "tenantId"),
      accountId: required(input.accountId, "accountId"),
      relationshipGraphId: required(input.relationshipGraphId, "relationshipGraphId"),
      relationshipGraphVersion: required(input.relationshipGraphVersion, "relationshipGraphVersion"),
      chatId: required(input.chatId, "chatId"),
      targetMessageId: required(input.targetMessageId, "targetMessageId"),
      draftHash: hashAutoSendDraft(input.draftText),
      policyVersion: decision.policyVersion,
    };
    const bindingFingerprint = hashAutoSendDraft(stableBinding(binding));
    const authorizationId = createHash("sha256")
      .update(`${idempotencyKey}\u0000${bindingFingerprint}\u0000${input.nowMs}`, "utf8")
      .digest("hex");
    const payload: AutoSendAuthorizationPayload = {
      kind: AUTO_SEND_AUTHORIZATION_KIND,
      revalidationContract: AUTO_SEND_REVALIDATION_CONTRACT,
      authorizationId,
      ...binding,
      issuedAtMs: input.nowMs,
      expiresAtMs: input.nowMs + ttlMs,
    };
    const encodedPayload = base64url(JSON.stringify(payload));
    const token = `${encodedPayload}.${this.#signature(encodedPayload)}`;
    const reserved = this.#ledger.reserve({
      authorizationId,
      idempotencyKey,
      bindingFingerprint,
      encodedPayload,
      tokenHash: hashAutoSendDraft(token),
      expiresAtMs: payload.expiresAtMs,
      status: "issued",
    });
    if (!fingerprintsMatch(reserved.bindingFingerprint, bindingFingerprint)) {
      throw new Error("Idempotency key was already used for different authorization bindings.");
    }
    const reservedToken = `${reserved.encodedPayload}.${this.#signature(reserved.encodedPayload)}`;
    if (!fingerprintsMatch(reserved.tokenHash, hashAutoSendDraft(reservedToken))) {
      throw new Error("Stored authorization payload does not match its capability hash.");
    }
    return reservedToken;
  }

  verify(token: string, nowMs: number): AutoSendAuthorizationPayload {
    const [encodedPayload, signature, extra] = String(token || "").split(".");
    if (!encodedPayload || !signature || extra) throw new Error("Malformed authorization token.");
    const expected = this.#signature(encodedPayload);
    if (!fingerprintsMatch(signature, expected)) throw new Error("Invalid authorization token signature.");
    let payload: AutoSendAuthorizationPayload;
    try {
      payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    } catch {
      throw new Error("Malformed authorization token payload.");
    }
    if (payload.kind !== AUTO_SEND_AUTHORIZATION_KIND || payload.revalidationContract !== AUTO_SEND_REVALIDATION_CONTRACT) {
      throw new Error("Unsupported authorization token contract.");
    }
    if (payload.policyVersion !== AUTO_SEND_POLICY_VERSION) throw new Error("Unsupported policy version.");
    if (!Number.isSafeInteger(nowMs) || nowMs < payload.issuedAtMs || nowMs >= payload.expiresAtMs) {
      throw new Error("Authorization token is expired or not yet valid.");
    }
    const record = this.#ledger.findByAuthorizationId(payload.authorizationId);
    if (!record || !fingerprintsMatch(record.tokenHash, hashAutoSendDraft(token))) {
      throw new Error("Authorization token is not present in the active send ledger.");
    }
    return Object.freeze({ ...payload });
  }

  /**
   * Produces an ephemeral send intent after checking the signed bindings and
   * re-running the complete policy against current state. The caller may hand
   * this intent to a future mocked/real boundary, but this class never sends.
   */
  revalidateAndAuthorize(input: RevalidationInput): AuthorizedSendIntent {
    this.#prune(input.nowMs);
    const payload = this.verify(input.token, input.nowMs);
    const currentDecision = evaluateAutoSendPolicy(input.policy);
    if (!currentDecision.eligibleForAuthorization || currentDecision.policyVersion !== payload.policyVersion) {
      throw new Error("Current policy no longer authorizes this draft.");
    }
    const currentBinding: AutoSendAuthorizationBinding = {
      tenantId: required(input.tenantId, "tenantId"),
      accountId: required(input.accountId, "accountId"),
      relationshipGraphId: required(input.relationshipGraphId, "relationshipGraphId"),
      relationshipGraphVersion: required(input.relationshipGraphVersion, "relationshipGraphVersion"),
      chatId: required(input.chatId, "chatId"),
      targetMessageId: required(input.targetMessageId, "targetMessageId"),
      draftHash: hashAutoSendDraft(input.draftText),
      policyVersion: currentDecision.policyVersion,
    };
    if (!fingerprintsMatch(hashAutoSendDraft(stableBinding(payload)), hashAutoSendDraft(stableBinding(currentBinding)))) {
      throw new Error("Authorization bindings changed during revalidation.");
    }

    const executionId = required(input.executionId, "executionId");
    const intent = Object.freeze({
      authorizationId: payload.authorizationId,
      executionId,
      tenantId: payload.tenantId,
      accountId: payload.accountId,
      relationshipGraphId: payload.relationshipGraphId,
      relationshipGraphVersion: payload.relationshipGraphVersion,
      chatId: payload.chatId,
      targetMessageId: payload.targetMessageId,
      draftHash: payload.draftHash,
      policyVersion: payload.policyVersion,
      authorizedAtMs: input.nowMs,
      expiresAtMs: payload.expiresAtMs,
      revalidationContract: AUTO_SEND_REVALIDATION_CONTRACT,
    });
    return this.#ledger.consume(payload.authorizationId, hashAutoSendDraft(input.token), intent);
  }

  recordDelivery(intent: AuthorizedSendIntent, receipt: unknown, deliveredAtMs: number): AutoSendDeliveryRecord {
    if (!Number.isSafeInteger(deliveredAtMs) || deliveredAtMs < intent.authorizedAtMs) {
      throw new Error("Delivery completion time is invalid.");
    }
    const delivery = Object.freeze({
      authorizationId: intent.authorizationId,
      executionId: intent.executionId,
      deliveredAtMs,
      receiptFingerprint: hashAutoSendDraft(JSON.stringify(receipt ?? null)),
    });
    return this.#ledger.complete(intent.authorizationId, intent.executionId, delivery);
  }
}
