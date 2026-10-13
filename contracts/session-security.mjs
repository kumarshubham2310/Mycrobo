import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

function encode(value) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signature(header, payload, secret) {
  return createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
}

export function issuePlatformSession({ userId, tenantId, deviceId, scopes, audience, keyId, secret, nowMs = Date.now(), ttlMs = 15 * 60_000 }) {
  if (![userId, tenantId, deviceId, audience, keyId].every((value) => /^[a-zA-Z0-9._:-]{3,128}$/u.test(String(value || "")))) throw new Error("Session identity fields are invalid.");
  if (!Array.isArray(scopes) || !scopes.length || scopes.some((scope) => !/^[a-z][a-z0-9:.-]{2,63}$/u.test(scope))) throw new Error("At least one valid scope is required.");
  if (!secret || String(secret).length < 32) throw new Error("A strong session signing secret is required.");
  if (!Number.isFinite(ttlMs) || ttlMs < 60_000 || ttlMs > 86_400_000) throw new Error("Session lifetime must be between one minute and one day.");
  const header = encode({ alg: "HS256", typ: "MYCROBO", kid: keyId });
  const claims = { sub: userId, tid: tenantId, did: deviceId, aud: audience, scopes: [...new Set(scopes)].sort(), iat: nowMs, exp: nowMs + ttlMs, jti: randomUUID() };
  const payload = encode(claims);
  return `${header}.${payload}.${signature(header, payload, secret)}`;
}

export function verifyPlatformSession({ token, keyring, expectedAudience, expectedDeviceId, requiredScope, nowMs = Date.now(), revokedTokenIds = new Set() }) {
  const [headerPart, payloadPart, signaturePart, extra] = String(token || "").split(".");
  if (!headerPart || !payloadPart || !signaturePart || extra) throw new Error("The session token is malformed.");
  let header;
  let claims;
  try {
    header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    throw new Error("The session token is malformed.");
  }
  const secret = keyring?.[header.kid];
  if (header.alg !== "HS256" || header.typ !== "MYCROBO" || !secret) throw new Error("The session signing key is unavailable.");
  const expected = Buffer.from(signature(headerPart, payloadPart, secret));
  const received = Buffer.from(signaturePart);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new Error("The session signature is invalid.");
  if (claims.aud !== expectedAudience || claims.did !== expectedDeviceId) throw new Error("The session is bound to a different application or device.");
  if (!Number.isFinite(claims.iat) || !Number.isFinite(claims.exp) || claims.iat > nowMs + 30_000 || nowMs >= claims.exp) throw new Error("The session expired or has an invalid time window.");
  if (revokedTokenIds.has(claims.jti)) throw new Error("The session was revoked.");
  if (!Array.isArray(claims.scopes) || !claims.scopes.includes(requiredScope)) throw new Error("The session is not authorized for this operation.");
  return Object.freeze({ userId: claims.sub, tenantId: claims.tid, deviceId: claims.did, scopes: claims.scopes, tokenId: claims.jti, expiresAtMs: claims.exp });
}

export function createReplayGuard({ ttlMs = 5 * 60_000, maximumEntries = 10_000 } = {}) {
  const seen = new Map();
  return {
    consume(nonce, nowMs = Date.now()) {
      if (!/^[a-zA-Z0-9._:-]{16,128}$/u.test(String(nonce || ""))) throw new Error("A strong request nonce is required.");
      for (const [key, expiresAt] of seen) if (expiresAt <= nowMs) seen.delete(key);
      if (seen.has(nonce)) throw new Error("The request nonce was already used.");
      if (seen.size >= maximumEntries) throw new Error("The replay cache is at capacity.");
      seen.set(nonce, nowMs + ttlMs);
      return true;
    },
  };
}

