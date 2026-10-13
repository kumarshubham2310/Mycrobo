import { createHmac, timingSafeEqual } from "node:crypto";

export const WHATSAPP_BUSINESS_CAPABILITIES = Object.freeze({
  supportedProductionConnector: true,
  receivesNewMessagesByWebhook: true,
  importsPersonalAccountHistory: false,
  importsPreRegistrationHistory: false,
  sendsOnlyAfterApplicationApproval: true,
  mediaRetrievalRequiresProviderId: true,
});

export function verifyMetaWebhookSignature({ rawBody, signature, appSecret }) {
  if (!appSecret || String(appSecret).length < 24) throw new Error("A strong Meta app secret is required.");
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  const left = Buffer.from(String(signature || ""));
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new Error("The WhatsApp webhook signature is invalid.");
  return true;
}

export function normalizeWhatsAppBusinessWebhook(payload, receivedAtMs = Date.now()) {
  const events = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      if (change?.field !== "messages") continue;
      const value = change.value || {};
      const contacts = new Map((value.contacts || []).map((contact) => [contact.wa_id, contact.profile?.name || null]));
      for (const message of value.messages || []) {
        const timestampMs = Number(message.timestamp) * 1000;
        const type = String(message.type || "unknown");
        const text = type === "text" ? String(message.text?.body || "") : String(message[type]?.caption || "");
        events.push(Object.freeze({
          connector: "whatsapp-business-platform",
          connectorMessageId: String(message.id || ""),
          conversationId: String(message.from || ""),
          senderId: String(message.from || ""),
          senderName: contacts.get(message.from) || null,
          direction: "contact",
          kind: type,
          text,
          providerTimestampMs: Number.isFinite(timestampMs) ? timestampMs : null,
          receivedAtMs,
          mediaId: message[type]?.id || null,
          historyCoverage: "from-webhook-registration",
        }));
      }
    }
  }
  return events.filter((event) => event.connectorMessageId && event.conversationId);
}

export function createWhatsAppBusinessTransport({ accessToken, phoneNumberId, fetchImplementation = fetch, graphVersion }) {
  if (!accessToken || !phoneNumberId) throw new Error("WhatsApp Business credentials are required.");
  if (!/^v\d+\.\d+$/u.test(String(graphVersion || ""))) throw new Error("An explicitly approved Meta Graph API version is required.");
  const base = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(phoneNumberId)}`;
  return Object.freeze({
    capabilities: WHATSAPP_BUSINESS_CAPABILITIES,
    async sendApprovedText({ recipient, body, idempotencyKey }) {
      if (!/^\d{7,20}$/u.test(String(recipient || "")) || !String(body || "").trim() || !/^[a-zA-Z0-9._:-]{16,128}$/u.test(String(idempotencyKey || ""))) {
        throw new Error("An exact recipient, body and idempotency key are required.");
      }
      const response = await fetchImplementation(`${base}/messages`, {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", "x-mycrobo-idempotency-key": idempotencyKey },
        body: JSON.stringify({ messaging_product: "whatsapp", to: recipient, type: "text", text: { preview_url: false, body } }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`WhatsApp Business send failed with provider status ${response.status}.`);
      const result = await response.json();
      return { providerMessageId: result.messages?.[0]?.id || null, accepted: true };
    },
  });
}
