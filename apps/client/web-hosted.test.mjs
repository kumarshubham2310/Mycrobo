import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { startHostedWorkspace } from "./web-hosted.mjs";

function node() {
  const children = new Map();
  return { attributes: {}, listeners: {}, textContent: "", innerHTML: "", disabled: false,
    setAttribute(key, value) { this.attributes[key] = value; },
    querySelector(selector) { if (!children.has(selector)) children.set(selector, node()); return children.get(selector); },
    addEventListener(name, handler) { this.listeners[name] = handler; },
  };
}
function documentFixture() {
  const doc = node();
  doc.createElement = () => node();
  doc.body = { append(panel) { doc.panel = panel; } };
  return doc;
}
const boundary = { surface: "closed-pilot-web", desktopConnector: "not_paired", privateChatTransit: false, bridgeCredentialsAvailable: false, realMessageSending: false, googleOAuthAvailable: false, trustedRelay: { protocol: "mycrobo.relay-envelope.1", stage: "foundation_installed", pairingAvailable: false, capabilities: [], ciphertextOnly: true } };

test("signed-in hosted screen requests only boundary metadata and always exposes sign-out", async () => {
  const document = documentFixture();
  const paths = [];
  let signedOut = 0;
  const panel = await startHostedWorkspace({ user: { email: "pilot@example.test" } }, {
    document, fetchImpl: async (path) => { paths.push(path); return Response.json(boundary); }, signOut: async () => { signedOut += 1; },
  });
  assert.equal(document.querySelector(".appShell").attributes.hidden, "");
  assert.equal(panel.querySelector("#hostedIdentity").textContent, "pilot@example.test");
  assert.match(panel.querySelector("#hostedStatusDetail").textContent, /ciphertext-only relay foundation is installed/u);
  assert.doesNotMatch(panel.innerHTML, /id="(?:connectGoogle|draftButton|sendEditedReply|reconnect)"/u);
  await panel.querySelector("#hostedSignOut").listeners.click();
  assert.equal(signedOut, 1);
  assert.deepEqual(paths, ["/api/v1/runtime-boundary"]);
});

test("multi-workspace hosted sessions expose an explicit switch action only when available", async () => {
  const document = documentFixture();
  let switched = 0;
  const panel = await startHostedWorkspace({ user: { email: "pilot@example.test" }, workspaceSwitchAvailable: true }, {
    document,
    fetchImpl: async () => Response.json(boundary),
    switchWorkspace: async () => { switched += 1; },
  });
  assert.match(panel.innerHTML, /id="hostedSwitchWorkspace"/u);
  assert.doesNotMatch(panel.innerHTML, /class="hidden" type="button" id="hostedSwitchWorkspace"/u);
  await panel.querySelector("#hostedSwitchWorkspace").listeners.click();
  assert.equal(switched, 1);

  const single = await startHostedWorkspace({ workspaceSwitchAvailable: false }, {
    document: documentFixture(), fetchImpl: async () => Response.json(boundary),
  });
  assert.match(single.innerHTML, /class="hidden" type="button" id="hostedSwitchWorkspace"/u);
});

test("browser preparation registers only a public key and never opens private capabilities", async () => {
  const document = documentFixture();
  const requests = [];
  const descriptor = {
    user: { id: "028f3f2e-f7e7-4e39-8a88-6c4e76829f12", email: "pilot@example.test" },
    membership: { tenantId: "018f3f2e-f7e7-4e39-8a88-6c4e76829f11", role: "member", state: "active" },
  };
  const device = { deviceId: "038f3f2e-f7e7-4e39-8a88-6c4e76829f13", publicKey: "A".repeat(87) };
  const panel = await startHostedWorkspace(descriptor, {
    document,
    prepareBrowserRelay: async (scope) => {
      assert.deepEqual(scope, { tenantId: descriptor.membership.tenantId, userId: descriptor.user.id });
      return device;
    },
    fetchImpl: async (path, options = {}) => {
      requests.push({ path, options });
      if (path === "/api/v1/runtime-boundary") return Response.json(boundary);
      return Response.json({ registered: true, deviceId: device.deviceId, deviceKind: "web_client", pairingAvailable: false, capabilities: [] }, { status: 201 });
    },
  });
  assert.equal(panel.querySelector("#hostedPrepareBrowser").hidden, false);
  await panel.querySelector("#hostedPrepareBrowser").listeners.click();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].path, "/api/v1/relay/browser-device");
  assert.deepEqual(JSON.parse(requests[1].options.body), device);
  assert.equal(requests[1].options.headers["x-mycrobo-tenant-id"], descriptor.membership.tenantId);
  assert.match(panel.querySelector("#hostedStatusTitle").textContent, /desktop not yet paired/u);
  assert.match(panel.querySelector("#hostedStatusDetail").textContent, /sending remain unavailable/u);
});

test("unknown or failed hosted capability responses never open desktop actions", async () => {
  for (const body of [{ ...boundary, googleOAuthAvailable: true }, { connected: true, sendAvailable: true }, {}]) {
    const panel = await startHostedWorkspace({}, { document: documentFixture(), fetchImpl: async () => Response.json(body) });
    assert.match(panel.querySelector("#hostedStatusTitle").textContent, /could not be verified/u);
    assert.doesNotMatch(panel.innerHTML, /<form|data-view=|connectGoogle/u);
  }
});

test("actual app entry never executes desktop bootstrapping in hosted mode", async () => {
  const source = await readFile(new URL("app.js", import.meta.url), "utf8");
  const executable = source.replace(/^import .+;\r?\n/gmu, "");
  let started = 0;
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  // The desktop branch references document/navigator at its first line. They
  // are intentionally absent; accidentally bootstrapping it fails this test.
  await new AsyncFunction("webAuthReady", "startHostedWorkspace", executable)(Promise.resolve({ surface: "closed-pilot-web" }), async () => { started += 1; });
  assert.equal(started, 1);
});
