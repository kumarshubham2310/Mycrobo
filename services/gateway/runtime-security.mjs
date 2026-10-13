import { createHash, timingSafeEqual } from "node:crypto";
import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";

const LOOPBACKS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function equalSecret(actual, expected) {
  const left = Buffer.from(String(actual || ""));
  const right = Buffer.from(String(expected || ""));
  return left.length === right.length && timingSafeEqual(left, right);
}

export function authorizeSendBroker(actual, expected) {
  return Boolean(expected && equalSecret(actual, expected));
}

export function authorizeGatewayRequest(request, policy = {}) {
  if (!policy.token) return { ok: true, mode: "development-unlocked" };
  const remoteAddress = request.socket?.remoteAddress || "";
  if (!LOOPBACKS.has(remoteAddress)) return { ok: false, status: 403, code: "LOOPBACK_ONLY" };
  if (policy.allowedHost && request.headers.host !== policy.allowedHost) return { ok: false, status: 403, code: "HOST_DENIED" };
  const origin = String(request.headers.origin || "");
  if (origin && policy.allowedOrigin && origin !== policy.allowedOrigin) return { ok: false, status: 403, code: "ORIGIN_DENIED" };
  const authorization = String(request.headers.authorization || "");
  const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!equalSecret(bearer, policy.token)) return { ok: false, status: 401, code: "AUTHENTICATION_REQUIRED" };
  if (policy.windowToken && !equalSecret(request.headers["x-mycrobo-window"], policy.windowToken)) {
    return { ok: false, status: 401, code: "WINDOW_CAPABILITY_REQUIRED" };
  }
  if (MUTATING_METHODS.has(request.method) && origin && policy.allowedOrigin && origin !== policy.allowedOrigin) {
    return { ok: false, status: 403, code: "CROSS_ORIGIN_WRITE_DENIED" };
  }
  return { ok: true, mode: "authenticated-window" };
}

export function createRequestLimiter({ readLimit = 600, writeLimit = 90, windowMs = 60_000 } = {}) {
  const buckets = new Map();
  return {
    check(request, nowMs = Date.now()) {
      const kind = MUTATING_METHODS.has(request.method) ? "write" : "read";
      const key = `${request.socket?.remoteAddress || "unknown"}:${kind}`;
      const limit = kind === "write" ? writeLimit : readLimit;
      let bucket = buckets.get(key);
      if (!bucket || nowMs - bucket.startedAt >= windowMs) bucket = { startedAt: nowMs, count: 0 };
      bucket.count += 1;
      buckets.set(key, bucket);
      return bucket.count <= limit
        ? { allowed: true, remaining: Math.max(0, limit - bucket.count) }
        : { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (nowMs - bucket.startedAt)) / 1000)) };
    },
  };
}

export function routeCategory(pathname) {
  if (pathname === "/" || /\.(?:css|js|mjs|png|ico|webmanifest)$/u.test(pathname)) return "asset";
  if (pathname.includes("/send")) return "send";
  if (pathname.includes("/draft")) return "draft";
  if (pathname.includes("/media")) return "media";
  if (pathname.includes("/chats")) return "chat";
  if (pathname.includes("/workspace") || pathname.includes("/tasks") || pathname.includes("/followups") || pathname.includes("/decisions")) return "workspace";
  return "system";
}

export function contentFreeAuditRecord({ request, pathname, status, durationMs, correlationId, observedAt = new Date().toISOString() }) {
  const record = {
    schema: "mycrobo-operations.1",
    correlationId: String(correlationId || "").slice(0, 128),
    observedAt,
    method: String(request.method || "GET").toUpperCase(),
    route: routeCategory(pathname),
    status: Number(status),
    durationMs: Math.max(0, Math.round(Number(durationMs) || 0)),
  };
  return Object.freeze(record);
}

export function opaqueCorrelationId(seed) {
  return createHash("sha256").update(String(seed || "")).digest("hex").slice(0, 24);
}

export function createOperationsLogger(filePath, { maxBytes = 1_048_576 } = {}) {
  if (!filePath) return null;
  let queue = Promise.resolve();
  return (record) => {
    queue = queue.then(async () => {
      await mkdir(dirname(filePath), { recursive: true });
      try {
        const information = await stat(filePath);
        if (information.size >= maxBytes) await rename(filePath, `${filePath}.previous`);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      await appendFile(filePath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
    }).catch(() => { /* observability remains fail-safe and content-free */ });
  };
}
