import assert from "node:assert/strict";
import test from "node:test";
import { createAuthenticatedWebFetch } from "./web-session.mjs";

const origin = "https://pilot.example";
const epoch = 1_700_000_000_000;
const token = (name, seconds = 3600) => ({ access_token: name.repeat(32), refresh_token: "r".repeat(32), expires_at: epoch / 1000 + seconds });
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }
function setup({ initial = token("a"), refresh = async () => token("b"), fetchImpl = async () => new Response("ok") } = {}) {
  let session = initial;
  let refreshCount = 0;
  let authCount = 0;
  let now = epoch;
  const calls = [];
  const controller = createAuthenticatedWebFetch({ origin, now: () => now,
    readSession: () => session, saveSession: (value) => { session = value; },
    refreshSession: async (value) => { refreshCount += 1; return refresh(value); },
    fetchImpl: async (...args) => { calls.push(args); return fetchImpl(...args); },
    onAuthRequired: () => { authCount += 1; },
  });
  return { controller, calls, session: () => session, counts: () => ({ refreshCount, authCount }), advance: (ms) => { now += ms; } };
}

test("concurrent expiring requests share one refresh and use the new token", async () => {
  const refreshing = deferred();
  const run = setup({ initial: token("a", 30), refresh: () => refreshing.promise });
  const first = run.controller.fetch("/api/v1/runtime-boundary");
  const second = run.controller.fetch("/api/v1/runtime-boundary");
  assert.equal(run.counts().refreshCount, 1);
  assert.equal(run.calls.length, 0);
  refreshing.resolve(token("b"));
  await Promise.all([first, second]);
  assert.equal(run.calls.length, 2);
  assert.ok(run.calls.every(([, options]) => options.headers.get("authorization") === `Bearer ${"b".repeat(32)}` && options.redirect === "error" && options.credentials === "omit"));
});

test("failed refresh blocks a pending write and starts reauthentication once", async () => {
  const run = setup({ initial: token("a", 30), refresh: async () => null });
  const results = await Promise.allSettled([
    run.controller.fetch("/api/v1/preferences", { method: "POST", body: "never-dispatch" }),
    run.controller.fetch("/api/v1/runtime-boundary"),
  ]);
  assert.ok(results.every((result) => result.status === "rejected"));
  assert.equal(run.calls.length, 0);
  assert.equal(run.session(), null);
  assert.equal(run.counts().authCount, 1);
});

test("401 never replays a write and clears the rejected session", async () => {
  const run = setup({ fetchImpl: async () => new Response(null, { status: 401 }) });
  const response = await run.controller.fetch("/api/v1/preferences", { method: "POST", body: "original" });
  assert.equal(response.status, 401);
  assert.equal(run.calls.length, 1);
  assert.equal(run.calls[0][1].body, "original");
  assert.equal(run.session(), null);
  assert.equal(run.counts().refreshCount, 0);
  assert.equal(run.counts().authCount, 1);
});

test("logout prevents requests paused before dispatch and rejects late refresh resurrection", async () => {
  const run = setup();
  const pending = run.controller.fetch("/api/v1/preferences", { method: "POST" });
  run.controller.invalidate({ reauthenticate: false });
  await assert.rejects(pending, /Sign in again/u);
  assert.equal(run.calls.length, 0);
  const refreshing = deferred();
  const late = setup({ initial: token("a", 30), refresh: () => refreshing.promise });
  const request = late.controller.fetch("/api/v1/runtime-boundary");
  late.controller.invalidate({ reauthenticate: false });
  refreshing.resolve(token("b"));
  await assert.rejects(request, /Sign in again/u);
  assert.equal(late.session(), null);
  assert.equal(late.calls.length, 0);
});

test("a late rejected old token cannot clear a newly refreshed session", async () => {
  const oldResponse = deferred();
  const run = setup({ refresh: async () => token("b", 7200), fetchImpl: async (_url, options) => options.headers.get("authorization") === `Bearer ${"a".repeat(32)}` ? oldResponse.promise : new Response("ok") });
  const oldRequest = run.controller.fetch("/api/v1/runtime-boundary");
  await Promise.resolve();
  run.advance(3_550_000);
  await run.controller.fetch("/api/v1/runtime-boundary");
  assert.equal(run.session().access_token, "b".repeat(32));
  oldResponse.resolve(new Response(null, { status: 401 }));
  await oldRequest;
  assert.equal(run.session().access_token, "b".repeat(32));
  assert.equal(run.counts().authCount, 0);
});

test("static and foreign requests receive no bearer or automatic refresh", async () => {
  const run = setup({ initial: null });
  await run.controller.fetch("https://other.example/api/v1/chats");
  await run.controller.fetch("/styles.css");
  assert.equal(run.counts().refreshCount, 0);
  assert.ok(run.calls.every(([, options]) => options.headers === undefined));
});
