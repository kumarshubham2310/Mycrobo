import assert from "node:assert/strict";
import test from "node:test";

import { createGatewayServer as createGatewayServerBase } from "./server.mjs";

const createGatewayServer = (options = {}) => createGatewayServerBase({ authRole: "member", ...options });

const tenantId = "tenant-0000000000000001";

test("gateway exposes tenant-scoped local translator status and never trusts a caller tenant", async () => {
  const calls = [];
  const translator = {
    status() { return { configured: true, enabled: true, tenantId, localOnly: true, runtime: "ready" }; },
    async translate(input) { calls.push(input); return { applied: true, text: "नमस्ते", localOnly: true }; },
  };
  const server = createGatewayServer({ translator, tenantId });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const status = await fetch(`http://127.0.0.1:${port}/api/v1/translation/status`).then((response) => response.json());
    assert.equal(status.tenantId, tenantId);
    assert.equal(status.localOnly, true);
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/translation`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId: "tenant-0000000000000002", text: "Hello", sourceLangCode: "en", targetLangCode: "hi" }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).text, "नमस्ते");
    assert.equal(calls[0].tenantId, tenantId);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("gateway returns an explicit safe fallback without converting it into an error or send", async () => {
  let closed = false;
  const translator = {
    status() { return { configured: true, enabled: true, tenantId, localOnly: true }; },
    async translate(input) { return { applied: false, text: input.text, reason: "INFERENCE_TIMEOUT", localOnly: true }; },
    close() { closed = true; },
  };
  const server = createGatewayServer({ translator, tenantId });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/translation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Keep me unchanged", sourceLangCode: "en", targetLangCode: "hi" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { applied: false, text: "Keep me unchanged", reason: "INFERENCE_TIMEOUT", localOnly: true });
  await new Promise((resolve) => server.close(resolve));
  assert.equal(closed, true);
});

test("gateway exposes content-free tenant usage and blocks translation beyond the assigned plan", async () => {
  let invoked = false;
  const limitError = new Error("This workspace has reached its monthly translations limit.");
  limitError.code = "PLAN_LIMIT_REACHED";
  const usageMeter = {
    snapshot() { return { tenantId, period: "2026-09", drafts: 4, translations: 10, limits: { drafts: 100, translations: 10 } }; },
    assertAvailable(metric) { if (metric === "translations") throw limitError; },
    record() { throw new Error("A blocked operation must not be recorded."); },
  };
  const translator = { status() { return { configured: true, enabled: true, localOnly: true }; }, async translate() { invoked = true; return { applied: true, text: "never" }; } };
  const server = createGatewayServer({ translator, tenantId, usageMeter });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const usage = await fetch(`http://127.0.0.1:${port}/api/v1/usage`).then((response) => response.json());
    assert.equal(usage.translations, 10);
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/translation`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "Hello", sourceLangCode: "en", targetLangCode: "hi" }) });
    assert.equal(response.status, 402);
    assert.equal((await response.json()).code, "PLAN_LIMIT_REACHED");
    assert.equal(invoked, false);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
