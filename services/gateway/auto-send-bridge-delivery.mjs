const OPAQUE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!OPAQUE.test(normalized)) throw new Error(`${name} is not a valid delivery binding.`);
  return normalized;
}

/**
 * Last-mile production adapter. Its caller must already have a validated host
 * bootstrap and a one-shot authorization intent. The adapter performs one
 * final fresh bridge/account/message check before requesting a one-use bridge
 * approval and never exposes the bridge methods on an unguarded path.
 */
export function createBridgeAutoSendDeliveryBoundary({ bridgeSource, expectedAccountId } = {}) {
  const accountId = required(expectedAccountId, "expectedAccountId");
  if (!bridgeSource || typeof bridgeSource.status !== "function" || typeof bridgeSource.bundle !== "function"
    || typeof bridgeSource.approveSend !== "function" || typeof bridgeSource.sendApproved !== "function") {
    throw new Error("The certified bridge delivery boundary is unavailable.");
  }
  return async function deliver(delivery) {
    const intent = delivery?.intent;
    const chatId = required(intent?.chatId, "chatId");
    const targetMessageId = required(delivery?.targetMessageId, "targetMessageId");
    const idempotencyKey = required(delivery?.idempotencyKey, "idempotencyKey");
    const body = String(delivery?.body || "");
    if (!body.trim() || body.length > 800 || intent?.accountId !== accountId || intent?.targetMessageId !== targetMessageId) {
      throw new Error("Delivery bindings do not match the certified bridge account.");
    }

    const [status, bundle] = await Promise.all([bridgeSource.status(), bridgeSource.bundle(chatId)]);
    if (status?.connected !== true || status?.connectionState !== "current-read-only" || status?.sendAvailable !== true
      || bundle?.accountScopeId !== accountId || bundle?.chat?.id !== chatId
      || bundle?.chat?.accountScopeId !== accountId || bundle?.latestSource?.id !== targetMessageId
      || bundle?.readiness?.draftAllowed !== true || bundle?.readiness?.currentMessage?.state !== "ready") {
      throw new Error("The bridge truth changed before delivery.");
    }

    const approval = await bridgeSource.approveSend({ chatId, body, targetMessageId, idempotencyKey });
    const approvalToken = String(approval?.approval_token || "");
    if (!approvalToken) throw new Error("The bridge did not issue a one-use delivery approval.");
    return bridgeSource.sendApproved({ chatId, body, targetMessageId, idempotencyKey, approvalToken });
  };
}
