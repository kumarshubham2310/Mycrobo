import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("service-worker.js", import.meta.url), "utf8");
const shellHtml = await readFile(new URL("index.html", import.meta.url), "utf8");
const origin = "https://mycrobo.example";
const cacheName = "mycrobo-shell-v8";
const absolute = (path) => new URL(path, origin).href;

function responseFor(path, body, { status = 200, type = "text/javascript", url = absolute(path), redirected = false, headers = {} } = {}) {
  const response = new Response(body, { status, headers: { "content-type": type, ...headers } });
  const annotate = (value) => {
    Object.defineProperties(value, { url: { value: url }, redirected: { value: redirected } });
    const clone = value.clone.bind(value);
    value.clone = () => annotate(clone());
    return value;
  };
  return annotate(response);
}

function createWorker({ network = () => { throw new Error("offline"); }, immediateTimeout = false, storageUnavailable = false } = {}) {
  const listeners = new Map();
  const stores = new Map();
  const calls = [];
  const deleted = [];
  let skipWaiting = 0;
  let claims = 0;
  let fetcher = network;
  const caches = {
    async open(name) {
      if (storageUnavailable) throw new Error("Storage disabled");
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async put(key, response) { entries.set(typeof key === "string" ? key : key.url, response.clone()); },
        async match(key) { return entries.get(typeof key === "string" ? key : key.url)?.clone(); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { deleted.push(name); return stores.delete(name); },
  };
  const context = vm.createContext({
    URL, Request, Response, AbortController, caches,
    setTimeout: immediateTimeout ? (callback, duration) => {
      assert.equal(duration, 4000);
      return setTimeout(callback, 0);
    } : setTimeout,
    clearTimeout,
    fetch: async (request) => { calls.push(request); return fetcher(request); },
    self: {
      location: { origin },
      addEventListener: (type, listener) => listeners.set(type, listener),
      skipWaiting: async () => { skipWaiting += 1; },
      clients: { claim: async () => { claims += 1; } },
    },
  });
  vm.runInContext(source, context, { filename: "service-worker.js" });
  return {
    calls, stores, deleted, caches,
    get skipWaiting() { return skipWaiting; },
    get claims() { return claims; },
    setNetwork(next) { fetcher = next; },
    async seed(path, body, options, name = cacheName) {
      await (await caches.open(name)).put(absolute(path), responseFor(path, body, options));
    },
    async cached(path, name = cacheName) { return (await caches.open(name)).match(absolute(path)); },
    fetch(path, options) {
      let result;
      listeners.get("fetch")({ request: new Request(absolute(path), options), respondWith(value) { result = value; } });
      return result;
    },
    dispatch(type, data) {
      let result;
      listeners.get(type)({ data, waitUntil(value) { result = value; } });
      return result;
    },
  };
}

test("already-installed shell fetches new scripts and styles without a service-worker revision", async () => {
  const worker = createWorker({ network: (request) => {
    const path = new URL(request.url).pathname;
    return responseFor(path, `new ${path}`, { type: path.endsWith(".css") ? "text/css" : "text/javascript" });
  } });
  for (const path of ["/app.js", "/web-auth.mjs", "/styles.css"]) {
    await worker.seed(path, `old ${path}`);
    assert.equal(await (await worker.fetch(path)).text(), `new ${path}`);
    assert.equal(await (await worker.cached(path)).text(), `new ${path}`);
  }
  assert.equal(worker.calls.length, 3);
  assert.ok(worker.calls.every((request) => request.cache === "no-store" && request.redirect === "error"));
  worker.setNetwork(() => { throw new Error("offline"); });
  assert.equal(await (await worker.fetch("/app.js")).text(), "new /app.js");
});

test("offline and stalled networks return the last safe shell within the request deadline", async () => {
  const offline = createWorker();
  await offline.seed("/", shellHtml, { type: "text/html" });
  assert.equal(await (await offline.fetch("/")).text(), shellHtml);
  const stalled = createWorker({ network: () => new Promise(() => {}), immediateTimeout: true });
  await stalled.seed("/app.js", "last safe script");
  assert.equal(await (await stalled.fetch("/app.js")).text(), "last safe script");
  assert.equal(stalled.calls[0].signal.aborted, true);
});

test("redirects, errors, private responses and HTML cannot replace a cached script", async () => {
  const cases = [
    { status: 302, headers: { location: "/login" } },
    { redirected: true },
    { url: `${origin}/login` },
    { url: "https://login.example/app.js" },
    { url: `${origin}/app.js?token=secret` },
    { status: 500 },
    { type: "text/html" },
    { headers: { "cache-control": "private, max-age=600" } },
    { headers: { vary: "Accept-Encoding, Cookie" } },
    { headers: { vary: "Authorization" } },
    { headers: { vary: "*" } },
    { body: "<!doctype html><title>Sign in</title>" },
  ];
  for (const options of cases) {
    const worker = createWorker({ network: () => responseFor("/app.js", options.body || "unsafe", options) });
    await worker.seed("/app.js", "safe script");
    assert.equal(await (await worker.fetch("/app.js")).text(), "safe script", JSON.stringify(options));
    assert.equal(await (await worker.cached("/app.js")).text(), "safe script");
  }
});

test("an auth page served at the root cannot overwrite the offline application", async () => {
  const worker = createWorker({ network: () => responseFor("/", "<html>Access sign in</html>", { type: "text/html" }) });
  await worker.seed("/", shellHtml, { type: "text/html" });
  assert.equal(await (await worker.fetch("/")).text(), shellHtml);
  assert.equal(await (await worker.cached("/")).text(), shellHtml);
  const uncached = createWorker({ network: () => responseFor("/app.js", "<html>Sign in</html>", { type: "text/html" }) });
  assert.equal((await uncached.fetch("/app.js")).status, 503);
  assert.equal(await uncached.cached("/app.js"), undefined);
});

test("private routes bypass even poisoned caches and never enter shell storage", async () => {
  const worker = createWorker({ network: (request) => responseFor(new URL(request.url).pathname, "private fresh payload", { type: "application/json" }) });
  for (const path of ["/api/v1/chats", "/api/v1/web-config", "/oauth/callback", "/media/attachment"]) {
    await worker.seed(path, "stale private poison");
    assert.equal(await (await worker.fetch(path)).text(), "private fresh payload");
    assert.equal(await (await worker.cached(path)).text(), "stale private poison");
  }
  assert.ok(worker.calls.every((request) => request.cache === "no-store"));
  for (const path of ["/?code=private", "/app.js?code=private", "/unknown.js", "https://other.example/app.js"]) {
    assert.equal(worker.fetch(path), undefined);
  }
  assert.equal(worker.fetch("/app.js", { method: "POST", body: "private" }), undefined);
  assert.equal(worker.calls.length, 4);
});

test("activation and explicit clearing preserve caches owned by other applications", async () => {
  const worker = createWorker();
  await worker.seed("/app.js", "new");
  await worker.seed("/app.js", "old-v4", undefined, "mycrobo-shell-v4");
  await worker.seed("/app.js", "old", undefined, "mycrobo-shell-v3");
  await worker.seed("/app.js", "unrelated", undefined, "other-product-cache");
  await worker.dispatch("activate");
  assert.deepEqual(worker.deleted, ["mycrobo-shell-v4", "mycrobo-shell-v3"]);
  assert.equal(worker.claims, 1);
  assert.equal(await (await worker.cached("/app.js", "other-product-cache")).text(), "unrelated");
  await worker.dispatch("message", { type: "CLEAR_MYCROBO_SHELL_CACHE" });
  assert.deepEqual(await worker.caches.keys(), ["other-product-cache"]);
});

test("installation validates every real shell asset before promoting the worker", async () => {
  const worker = createWorker({ network: async (request) => {
    const path = new URL(request.url).pathname;
    const body = await readFile(new URL(path === "/" ? "index.html" : path.slice(1), import.meta.url));
    const type = path === "/" ? "text/html" : path.endsWith(".css") ? "text/css"
      : path.endsWith(".png") ? "image/png" : path.endsWith(".ico") ? "image/x-icon"
        : path.endsWith(".webmanifest") ? "application/manifest+json" : "text/javascript";
    return responseFor(path, body, { type, headers: { "cache-control": "no-store" } });
  } });
  await worker.dispatch("install");
  assert.equal(worker.skipWaiting, 1);
  assert.ok(worker.calls.some((request) => request.url === absolute("/")));
  assert.ok(worker.calls.some((request) => request.url === absolute("/web-auth.mjs")));
  assert.ok(worker.calls.some((request) => request.url === absolute("/web-session.mjs")));
  assert.ok(worker.calls.some((request) => request.url === absolute("/web-hosted.mjs")));
  assert.ok(worker.calls.every((request) => !new URL(request.url).pathname.startsWith("/api/")));
  assert.equal(worker.stores.get(cacheName).size, worker.calls.length);
  worker.setNetwork(() => { throw new Error("offline"); });
  for (const path of ["/", "/app.js", "/web-auth.mjs", "/web-session.mjs", "/web-hosted.mjs", "/styles.css", "/assets/mycrobo-app-v2-192.png"]) {
    assert.equal((await worker.fetch(path)).status, 200);
  }
});

test("failed installation leaves the previous worker cache intact", async () => {
  const worker = createWorker({ network: (request) => responseFor(new URL(request.url).pathname, "<html>Sign in</html>", { type: "text/html" }) });
  await worker.seed("/app.js", "previous release", undefined, "mycrobo-shell-v3");
  await assert.rejects(worker.dispatch("install"), /Unsafe shell response/u);
  assert.equal(worker.skipWaiting, 0);
  assert.equal(worker.stores.has(cacheName), false);
  assert.equal(await (await worker.cached("/app.js", "mycrobo-shell-v3")).text(), "previous release");
});

test("unavailable cache storage does not prevent an online shell response", async () => {
  const worker = createWorker({ storageUnavailable: true, network: () => responseFor("/app.js", "online script") });
  assert.equal(await (await worker.fetch("/app.js")).text(), "online script");
});
