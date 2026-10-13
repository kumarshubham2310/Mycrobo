/**
 * Executes one policy-authorized delivery through an injected idempotent send
 * boundary. It never generates a draft and never weakens policy. The boundary
 * must use `authorizationId` as its durable idempotency key.
 */
export class AutoSendCoordinator {
  constructor({ issuer, deliver }) {
    if (!issuer || typeof deliver !== "function") throw new Error("Auto-send requires an authorization issuer and delivery boundary.");
    this.issuer = issuer;
    this.deliver = deliver;
  }

  async execute(input) {
    const token = this.issuer.issue({
      tenantId: input.tenantId,
      accountId: input.accountId,
      relationshipGraphId: input.relationshipGraphId,
      relationshipGraphVersion: input.relationshipGraphVersion,
      chatId: input.chatId,
      targetMessageId: input.targetMessageId,
      idempotencyKey: input.idempotencyKey,
      draftText: input.draftText,
      policy: input.policy,
      nowMs: input.nowMs,
      ttlMs: input.ttlMs,
    });
    const intent = this.issuer.revalidateAndAuthorize({
      tenantId: input.tenantId,
      accountId: input.accountId,
      relationshipGraphId: input.relationshipGraphId,
      relationshipGraphVersion: input.relationshipGraphVersion,
      chatId: input.chatId,
      targetMessageId: input.targetMessageId,
      token,
      executionId: input.executionId,
      draftText: input.draftText,
      policy: input.policy,
      nowMs: input.nowMs,
    });
    const receipt = await this.deliver({
      intent,
      body: input.draftText,
      targetMessageId: input.targetMessageId,
      idempotencyKey: intent.authorizationId,
    });
    const delivery = this.issuer.recordDelivery(intent, receipt, input.deliveredAtMs ?? Date.now());
    return Object.freeze({ intent, delivery, receipt });
  }
}
