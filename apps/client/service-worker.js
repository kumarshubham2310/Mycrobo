const CACHE_PREFIX = "mycrobo-shell-";
const CACHE_VERSION = `${CACHE_PREFIX}v8`;
const NETWORK_TIMEOUT_MS = 4000;
const SHELL_PATHS = Object.freeze([
  "/",
  "/styles.css",
  "/app.js",
  "/admin-presentation.mjs",
  "/autonomy-presentation.mjs",
  "/chat-presentation.mjs",
  "/composer-safety.mjs",
  "/media-presentation.mjs",
  "/pairing-presentation.mjs",
  "/pwa-register.mjs",
  "/relay-protocol.mjs",
  "/relay-device.mjs",
  "/web-auth.mjs",
  "/web-auth-contract.mjs",
  "/web-session.mjs",
  "/web-hosted.mjs",
  "/manifest.webmanifest",
  "/assets/mycrobo-app-v2-192.png",
  "/assets/mycrobo-app-v2-512.png",
  "/assets/mycrobo-app-v2.ico",
  "/assets/mycrobo-lockup-v1.png",
]);
const SHELL_PATH_SET = new Set(SHELL_PATHS);
const PRIVATE_PREFIXES = Object.freeze(["/api/", "/oauth/", "/media/"]);

function isPrivateRequest(url) {
  return PRIVATE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

function shellKey(path) {
  return new URL(path, self.location.origin).href;
}

async function isSafeShellResponse(response, path) {
  if (response.status !== 200 || response.redirected || response.type === "opaque" || response.type === "opaqueredirect") return false;
  if (!response.url) return false;
  const responseUrl = new URL(response.url);
  if (responseUrl.href !== shellKey(path)) return false;
  if (/\bprivate\b/iu.test(response.headers.get("cache-control") || "")) return false;
  if (/(?:^|,)\s*(?:cookie|authorization|\*)\s*(?:,|$)/iu.test(response.headers.get("vary") || "")) return false;

  const type = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (path === "/") {
    if (type !== "text/html") return false;
    const html = await response.clone().text();
    // An access-provider login page is not our offline shell, even if served at /.
    return /<meta\s+name="application-name"\s+content="MyCrobo"/u.test(html)
      && /<script\b[^>]*\bsrc="\/app\.js"/u.test(html);
  }
  if (/\.(?:js|mjs)$/u.test(path)) {
    if (!["text/javascript", "application/javascript"].includes(type)) return false;
    return !/^\s*</u.test(await response.clone().text());
  }
  if (path.endsWith(".css")) {
    return type === "text/css" && !/^\s*</u.test(await response.clone().text());
  }
  if (path.endsWith(".webmanifest")) return ["application/manifest+json", "application/json"].includes(type);
  if (path.endsWith(".png")) return type === "image/png";
  if (path.endsWith(".ico")) return ["image/x-icon", "image/vnd.microsoft.icon"].includes(type);
  return false;
}

async function fetchShell(path) {
  const controller = new AbortController();
  let timeout;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(new Request(shellKey(path), {
          cache: "no-store", redirect: "error", signal: controller.signal,
        }));
        if (!await isSafeShellResponse(response, path)) throw new Error("Unsafe shell response");
        return response;
      })(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new Error("Shell request timed out"));
        }, NETWORK_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function latestShell(path) {
  const cache = await caches.open(CACHE_VERSION).catch(() => null);
  try {
    const response = await fetchShell(path);
    // Only validated, public files from SHELL_PATHS are stored. Static servers
    // use no-store to prevent HTTP-cache staleness; this offline store is explicit.
    try { await cache?.put(shellKey(path), response.clone()); } catch { /* Storage quota must not prevent an online load. */ }
    return response;
  } catch {
    const cached = await cache?.match(shellKey(path)).catch(() => null);
    return cached || new Response("MyCrobo is temporarily unavailable. Reconnect and reload.", {
      status: 503, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all(SHELL_PATHS.map(async (path) => [path, await fetchShell(path)]))
      .then(async (entries) => {
        const cache = await caches.open(CACHE_VERSION);
        await Promise.all(entries.map(([path, response]) => cache.put(shellKey(path), response)));
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Conversation payloads, OAuth callbacks, attachments and every API response
  // always go to the private gateway and are never written to Cache Storage.
  if (isPrivateRequest(url)) {
    event.respondWith(fetch(new Request(request, { cache: "no-store" })));
    return;
  }

  if (!SHELL_PATH_SET.has(url.pathname)) return;
  // Query strings may contain auth callbacks or other user state. They are never
  // promoted into the shared static shell, even when their pathname is /.
  if (url.search) return;
  event.respondWith(latestShell(url.pathname));
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "CLEAR_MYCROBO_SHELL_CACHE") return;
  event.waitUntil(caches.delete(CACHE_VERSION));
});
