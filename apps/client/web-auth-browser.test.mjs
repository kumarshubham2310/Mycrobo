import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import * as contract from "./web-auth-contract.mjs";
import { createAuthenticatedWebFetch } from "./web-session.mjs";

const source = (await readFile(new URL("web-auth.mjs", import.meta.url), "utf8"))
  .replace(/import\s+\{[^}]+\}\s+from\s+"[^"]+";\s*/gu, "")
  .replace("export const webAuthReady", "globalThis.webAuthReady");
const userId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const secondTenantId = "33333333-3333-4333-8333-333333333333";
const foreignTenantId = "44444444-4444-4444-8444-444444444444";
const config = { authMode: "supabase", supabaseUrl: "https://project.supabase.co", supabaseAnonKey: "sb_publishable_syntheticPublicTestKeyOnly" };
function fakeNode() {
  const children = new Map();
  return { textContent: "", value: "", listeners: {}, appended: [], removed: false, classList: { add() {}, remove() {} }, setAttribute() {},
    querySelector(selector) { if (!children.has(selector)) children.set(selector, fakeNode()); return children.get(selector); },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    append(child) { this.appended.push(child); if (!this.value && child.value) this.value = child.value; },
    remove() { this.removed = true; },
  };
}
const membership = (id, role = "member") => ({ tenant_id: id, membership_role: role, membership_state: "active" });
function browser({
  origin = "https://pilot.example",
  configStatus = 200,
  payload = config,
  memberships = [membership(tenantId)],
  selectedTenantId = null,
  initialExpiresIn = 3600,
} = {}) {
  let now = Date.now();
  let activeMemberships = memberships;
  const storage = new Map([[contract.WEB_SESSION_STORAGE_KEY, JSON.stringify({ access_token: "a".repeat(32), refresh_token: "r".repeat(32), expires_at: now / 1000 + initialExpiresIn })]]);
  const persistent = new Map(selectedTenantId ? [[contract.WEB_SELECTED_TENANT_STORAGE_KEY, selectedTenantId]] : []);
  const calls = [];
  const overlays = [];
  let reloads = 0;
  const document = { createElement: fakeNode, body: { append: (node) => overlays.push(node) } };
  const window = { location: { origin, hash: "", reload() { reloads += 1; }, assign() {} },
    async fetch(input, options = {}) {
      const path = String(input);
      calls.push({ path, options });
      if (path === "/api/v1/web-config") return Response.json(payload, { status: configStatus });
      if (path === `${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`) return Response.json({ access_token: "b".repeat(32), refresh_token: "s".repeat(32), expires_in: 3600, user: { id: userId, email: "pilot@example.test" } });
      if (path === `${config.supabaseUrl}/auth/v1/user`) return Response.json({ id: userId, email: "pilot@example.test" });
      if (path.startsWith(`${config.supabaseUrl}/rest/v1/tenant_memberships`)) return Response.json(activeMemberships);
      if (path.endsWith("/auth/v1/logout")) return Response.json({});
      if (path === "/api/v1/runtime-boundary") return Response.json({ surface: "closed-pilot-web" });
      throw new Error(`Unexpected synthetic route ${path}`);
    },
  };
  const context = vm.createContext({ ...contract, createAuthenticatedWebFetch, window, document,
    sessionStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    localStorage: { getItem: (key) => persistent.get(key) || null, setItem: (key, value) => persistent.set(key, value), removeItem: (key) => persistent.delete(key) },
    Request, Response, Headers, URL, URLSearchParams, AbortSignal, Promise, Date: { now: () => now },
  });
  vm.runInContext(source, context);
  return {
    context, window, calls, overlays, storage, persistent,
    reloads: () => reloads,
    advance: (milliseconds) => { now += milliseconds; },
    setMemberships: (rows) => { activeMemberships = rows; },
  };
}

test("browser auth returns only a narrow hosted descriptor and sign-out erases the local session", async () => {
  const run = browser();
  const descriptor = await run.context.webAuthReady;
  assert.equal(descriptor.surface, "closed-pilot-web");
  assert.equal(descriptor.user.id, userId);
  assert.equal(descriptor.membership.tenantId, tenantId);
  assert.deepEqual([...run.persistent.entries()], [[contract.WEB_SELECTED_TENANT_STORAGE_KEY, tenantId]], "single-workspace compatibility persists only its tenant id");
  assert.doesNotMatch(JSON.stringify(descriptor), /access_token|refresh_token/u);
  assert.equal(run.window.mycroboDesktop, undefined, "web auth must not pretend it has native capabilities");
  await run.window.fetch("/api/v1/runtime-boundary");
  assert.equal(run.calls.at(-1).options.headers.get("authorization"), `Bearer ${"a".repeat(32)}`);
  await run.window.mycroboWebSession.signOut();
  assert.equal(run.storage.has(contract.WEB_SESSION_STORAGE_KEY), false);
  assert.equal(run.persistent.has(contract.WEB_SELECTED_TENANT_STORAGE_KEY), false);
  assert.equal(run.reloads(), 1);
});

test("sign-in and recovery password fields expose explicit accessible visibility controls", () => {
  assert.match(source, /id="webPasswordToggle"[^>]*aria-controls="webPassword"[^>]*aria-pressed="false"[^>]*aria-label="Show password"/u);
  assert.match(source, /id="webResetPasswordToggle"[^>]*aria-controls="webResetPassword"[^>]*aria-pressed="false"[^>]*aria-label="Show new password"/u);
  assert.match(source, /input\.type = reveal \? "text" : "password"/u);
  assert.match(source, /button\.setAttribute\("aria-pressed", String\(reveal\)\)/u);
  assert.match(source, /label\.textContent = reveal \? "Hide" : "Show"/u);
});

test("remote 404 and privileged config halt before membership or private requests", async () => {
  for (const options of [{ configStatus: 404, payload: {} }, { payload: { ...config, supabaseAnonKey: "sb_secret_privateSyntheticValue" } }]) {
    const run = browser(options);
    await new Promise(setImmediate);
    assert.equal(run.overlays.length, 1);
    assert.equal(run.overlays[0].querySelector("#webAuthTitle").textContent, "Web login is not ready");
    assert.deepEqual(run.calls.map((item) => item.path), ["/api/v1/web-config"]);
  }
});

test("local gateway 404 preserves desktop startup and Access uses only hosted capabilities", async () => {
  const local = browser({ origin: "http://127.0.0.1:4177", configStatus: 404, payload: {} });
  assert.equal(await local.context.webAuthReady, null);
  assert.equal(local.window.mycroboWebSession, undefined);
  const access = browser({ payload: { authMode: "local-or-access" } });
  const descriptor = await access.context.webAuthReady;
  assert.equal(descriptor.surface, "closed-pilot-web");
  assert.equal(descriptor.authMode, "cloudflare-access");
  assert.equal(access.calls.length, 1);
});

test("an account without active membership never enters the hosted workspace", async () => {
  const run = browser({ memberships: [] });
  await new Promise(setImmediate);
  assert.equal(run.window.mycroboWebSession, undefined);
  assert.equal(run.storage.has(contract.WEB_SESSION_STORAGE_KEY), false);
  assert.equal(run.overlays.length, 1);
  assert.ok(run.calls.every((item) => item.path !== "/api/v1/runtime-boundary"));
});

test("two active memberships require an explicit deterministic workspace choice", async () => {
  const run = browser({ memberships: [membership(secondTenantId, "viewer"), membership(tenantId, "admin")] });
  await new Promise(setImmediate);
  assert.equal(run.window.mycroboWebSession, undefined);
  assert.equal(run.persistent.size, 0);
  const chooser = run.overlays.at(-1);
  const select = chooser.querySelector("#webWorkspaceSelect");
  assert.deepEqual(select.appended.map((option) => option.value), [tenantId, secondTenantId]);
  select.value = secondTenantId;
  chooser.querySelector("#webWorkspaceForm").listeners.submit({ preventDefault() {} });
  const descriptor = await run.context.webAuthReady;
  assert.equal(descriptor.membership.tenantId, secondTenantId);
  assert.equal(descriptor.workspaceSwitchAvailable, true);
  assert.deepEqual([...run.persistent.entries()], [[contract.WEB_SELECTED_TENANT_STORAGE_KEY, secondTenantId]]);
});

test("foreign or stale persisted tenant ids never select an arbitrary membership", async () => {
  const run = browser({
    memberships: [membership(secondTenantId), membership(tenantId)],
    selectedTenantId: foreignTenantId,
  });
  await new Promise(setImmediate);
  assert.equal(run.window.mycroboWebSession, undefined);
  assert.equal(run.persistent.has(contract.WEB_SELECTED_TENANT_STORAGE_KEY), false);
  assert.equal(run.overlays.length, 1);
  assert.ok(run.calls.every((call) => call.path !== "/api/v1/runtime-boundary"));
});

test("a persisted active membership survives response reordering and can be switched explicitly", async () => {
  const run = browser({
    memberships: [membership(secondTenantId), membership(tenantId)],
    selectedTenantId: tenantId,
  });
  const descriptor = await run.context.webAuthReady;
  assert.equal(descriptor.membership.tenantId, tenantId);
  const switching = run.window.mycroboWebSession.switchWorkspace();
  await new Promise(setImmediate);
  const chooser = run.overlays.at(-1);
  chooser.querySelector("#webWorkspaceSelect").value = secondTenantId;
  chooser.querySelector("#webWorkspaceForm").listeners.submit({ preventDefault() {} });
  await switching;
  assert.equal(run.persistent.get(contract.WEB_SELECTED_TENANT_STORAGE_KEY), secondTenantId);
  assert.equal(run.reloads(), 1);
});

test("refresh signs out and requires authentication when the selected membership disappears", async () => {
  const run = browser({ selectedTenantId: tenantId, initialExpiresIn: 62 });
  await run.context.webAuthReady;
  run.setMemberships([]);
  run.advance(3_000);
  await assert.rejects(run.window.fetch("/api/v1/runtime-boundary"), /Sign in again/u);
  await new Promise(setImmediate);
  assert.equal(run.storage.has(contract.WEB_SESSION_STORAGE_KEY), false);
  assert.equal(run.persistent.has(contract.WEB_SELECTED_TENANT_STORAGE_KEY), false);
  assert.ok(run.calls.some((call) => call.path.endsWith("/auth/v1/logout")));
  assert.equal(run.overlays.length, 1, "membership loss opens reauthentication instead of another workspace");
  assert.ok(run.calls.every((call) => call.path !== "/api/v1/runtime-boundary"));
});
