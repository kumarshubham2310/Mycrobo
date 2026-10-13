const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SUBJECT_HMAC = /^[a-f0-9]{64}$/u;
const RELAY_VERSION = "mycrobo.relay-envelope.1";
const KEY_CONTEXT_VERSION = "mycrobo.relay-key-context.1";
const MAX_PLAINTEXT_BYTES = 512 * 1024;
const MAX_ENVELOPE_LIFETIME_MS = 5 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 30 * 1000;

// Delivery is intentionally absent. Opening a send capability requires a
// separate release review and cannot be achieved by changing PWA preferences.
export const RELAY_CAPABILITIES = Object.freeze([
  "connection_status",
  "chat_read",
  "draft_request",
]);

function cryptoApi(override) {
  const candidate = override || globalThis.crypto;
  if (!candidate?.subtle || typeof candidate.getRandomValues !== "function") {
    throw new Error("A standards-compatible Web Crypto implementation is required.");
  }
  return candidate;
}

function bytes(value, label) {
  if (!(value instanceof Uint8Array)) throw new TypeError(`${label} must be a Uint8Array.`);
  return value;
}

function base64UrlEncode(value) {
  let binary = "";
  for (const octet of value) binary += String.fromCharCode(octet);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlDecode(value, label, expectedLength = null) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value) || value.length > 1_000_000) {
    throw new Error(`${label} is not valid base64url.`);
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  let decoded;
  try { decoded = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)); }
  catch { throw new Error(`${label} is not valid base64url.`); }
  if (expectedLength !== null && decoded.byteLength !== expectedLength) throw new Error(`${label} has an invalid length.`);
  return decoded;
}

function exactUuid(value, label) {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`${label} is invalid.`);
  return value.toLowerCase();
}

function exactSubject(value, label, required) {
  if (value === null && !required) return null;
  if (typeof value !== "string" || !SUBJECT_HMAC.test(value)) throw new Error(`${label} must be a tenant-keyed HMAC.`);
  return value;
}

function exactTime(value, label) {
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw new Error(`${label} must be a canonical ISO timestamp.`);
  return time;
}

export function normalizeRelayBinding(binding) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) throw new Error("Relay binding is required.");
  const capability = String(binding.capability || "");
  if (!RELAY_CAPABILITIES.includes(capability)) throw new Error("Relay capability is not permitted.");
  const requiresSubject = capability !== "connection_status";
  const normalized = {
    version: RELAY_VERSION,
    tenantId: exactUuid(binding.tenantId, "Tenant"),
    userId: exactUuid(binding.userId, "User"),
    sessionId: exactUuid(binding.sessionId, "Session"),
    senderDeviceId: exactUuid(binding.senderDeviceId, "Sender device"),
    recipientDeviceId: exactUuid(binding.recipientDeviceId, "Recipient device"),
    sequence: Number(binding.sequence),
    capability,
    relationshipSubjectHmac: exactSubject(binding.relationshipSubjectHmac ?? null, "Relationship subject", requiresSubject),
    chatSubjectHmac: exactSubject(binding.chatSubjectHmac ?? null, "Chat subject", requiresSubject),
    keyEpoch: Number(binding.keyEpoch),
    issuedAt: String(binding.issuedAt || ""),
    expiresAt: String(binding.expiresAt || ""),
  };
  if (normalized.senderDeviceId === normalized.recipientDeviceId) throw new Error("Relay devices must be distinct.");
  if (!Number.isSafeInteger(normalized.sequence) || normalized.sequence < 1) throw new Error("Relay sequence is invalid.");
  if (!Number.isSafeInteger(normalized.keyEpoch) || normalized.keyEpoch < 1 || normalized.keyEpoch > 32767) throw new Error("Relay key epoch is invalid.");
  const issued = exactTime(normalized.issuedAt, "Issued time");
  const expires = exactTime(normalized.expiresAt, "Expiry time");
  if (expires <= issued || expires - issued > MAX_ENVELOPE_LIFETIME_MS) throw new Error("Relay envelope lifetime is invalid.");
  return Object.freeze(normalized);
}

export function relayAdditionalData(binding) {
  return new TextEncoder().encode(JSON.stringify(normalizeRelayBinding(binding)));
}

export async function generateRelayAgreementKeyPair({ crypto: override } = {}) {
  const api = cryptoApi(override);
  return api.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
}

export async function exportRelayPublicKey(publicKey, { crypto: override } = {}) {
  const raw = new Uint8Array(await cryptoApi(override).subtle.exportKey("raw", publicKey));
  if (raw.byteLength !== 65 || raw[0] !== 4) throw new Error("Relay public key is not a canonical P-256 point.");
  return base64UrlEncode(raw);
}

export async function importRelayPublicKey(encoded, { crypto: override } = {}) {
  const raw = base64UrlDecode(encoded, "Relay public key", 65);
  if (raw[0] !== 4) throw new Error("Relay public key is not an uncompressed P-256 point.");
  return cryptoApi(override).subtle.importKey("raw", raw, { name: "ECDH", namedCurve: "P-256" }, false, []);
}

export async function deriveRelaySessionKey({
  privateKey,
  peerPublicKey,
  sessionBindingDigest,
  tenantId,
  userId,
  sessionId,
  keyEpoch = 1,
  crypto: override,
}) {
  const api = cryptoApi(override);
  const salt = typeof sessionBindingDigest === "string"
    ? base64UrlDecode(sessionBindingDigest, "Session binding digest", 32)
    : bytes(sessionBindingDigest, "Session binding digest");
  if (salt.byteLength !== 32) throw new Error("Session binding digest must contain 32 bytes.");
  const context = JSON.stringify({
    version: KEY_CONTEXT_VERSION,
    tenantId: exactUuid(tenantId, "Tenant"),
    userId: exactUuid(userId, "User"),
    sessionId: exactUuid(sessionId, "Session"),
    keyEpoch: Number(keyEpoch),
  });
  if (!Number.isInteger(Number(keyEpoch)) || Number(keyEpoch) < 1 || Number(keyEpoch) > 32767) throw new Error("Relay key epoch is invalid.");
  const shared = await api.subtle.deriveBits({ name: "ECDH", public: peerPublicKey }, privateKey, 256);
  const material = await api.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  return api.subtle.deriveKey({
    name: "HKDF", hash: "SHA-256", salt, info: new TextEncoder().encode(context),
  }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function sealRelayEnvelope({ key, binding, plaintext, crypto: override }) {
  const api = cryptoApi(override);
  const clear = bytes(plaintext, "Relay plaintext");
  if (clear.byteLength < 1 || clear.byteLength > MAX_PLAINTEXT_BYTES) throw new Error("Relay plaintext is outside the permitted size boundary.");
  const normalized = normalizeRelayBinding(binding);
  const aad = relayAdditionalData(normalized);
  const nonce = api.getRandomValues(new Uint8Array(12));
  const [ciphertext, aadDigest] = await Promise.all([
    api.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 }, key, clear),
    api.subtle.digest("SHA-256", aad),
  ]);
  return Object.freeze({
    ...normalized,
    nonce: base64UrlEncode(nonce),
    aadSha256: base64UrlEncode(new Uint8Array(aadDigest)),
    ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
  });
}

export async function openRelayEnvelope({ key, envelope, expectedBinding, nowMs = Date.now(), crypto: override }) {
  const api = cryptoApi(override);
  const normalized = normalizeRelayBinding(envelope);
  const expected = normalizeRelayBinding(expectedBinding);
  const aad = relayAdditionalData(normalized);
  const expectedAad = relayAdditionalData(expected);
  if (base64UrlEncode(aad) !== base64UrlEncode(expectedAad)) throw new Error("Relay envelope is not bound to the expected tenant, user, device, chat and capability.");
  const expiry = Date.parse(normalized.expiresAt);
  const issued = Date.parse(normalized.issuedAt);
  if (nowMs > expiry || nowMs < issued - MAX_CLOCK_SKEW_MS) throw new Error("Relay envelope is stale or not yet valid.");
  const [digest, nonce, ciphertext] = await Promise.all([
    api.subtle.digest("SHA-256", aad),
    Promise.resolve(base64UrlDecode(envelope.nonce, "Relay nonce", 12)),
    Promise.resolve(base64UrlDecode(envelope.ciphertext, "Relay ciphertext")),
  ]);
  if (base64UrlEncode(new Uint8Array(digest)) !== envelope.aadSha256) throw new Error("Relay additional-data digest does not match.");
  if (ciphertext.byteLength <= 16 || ciphertext.byteLength > MAX_PLAINTEXT_BYTES + 16) throw new Error("Relay ciphertext is outside the permitted size boundary.");
  try {
    return new Uint8Array(await api.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: aad, tagLength: 128 }, key, ciphertext));
  } catch {
    throw new Error("Relay ciphertext authentication failed.");
  }
}

export function createRelayReplayGuard({ maximumSessions = 128 } = {}) {
  if (!Number.isInteger(maximumSessions) || maximumSessions < 1 || maximumSessions > 10_000) throw new Error("Replay guard capacity is invalid.");
  const lastSequence = new Map();
  return Object.freeze({
    accept(envelope, nowMs = Date.now()) {
      const binding = normalizeRelayBinding(envelope);
      if (nowMs > Date.parse(binding.expiresAt) || nowMs < Date.parse(binding.issuedAt) - MAX_CLOCK_SKEW_MS) {
        throw new Error("Relay envelope is stale or not yet valid.");
      }
      const key = `${binding.sessionId}:${binding.senderDeviceId}:${binding.keyEpoch}`;
      const previous = lastSequence.get(key) || 0;
      if (binding.sequence <= previous) throw new Error("Relay envelope sequence was replayed or reordered.");
      if (!lastSequence.has(key) && lastSequence.size >= maximumSessions) {
        lastSequence.delete(lastSequence.keys().next().value);
      }
      lastSequence.set(key, binding.sequence);
      return binding;
    },
    reset(sessionId) {
      const prefix = `${exactUuid(sessionId, "Session")}:`;
      for (const key of lastSequence.keys()) if (key.startsWith(prefix)) lastSequence.delete(key);
    },
    get size() { return lastSequence.size; },
  });
}

export const TRUSTED_RELAY_CONTRACT = Object.freeze({
  envelopeVersion: RELAY_VERSION,
  keyContextVersion: KEY_CONTEXT_VERSION,
  capabilities: RELAY_CAPABILITIES,
  maximumPlaintextBytes: MAX_PLAINTEXT_BYTES,
  maximumEnvelopeLifetimeMs: MAX_ENVELOPE_LIFETIME_MS,
  realMessageSending: false,
});
