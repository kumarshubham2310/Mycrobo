import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";

import { LocalTranslateGemmaAdapter, TranslateGemmaStdioWorker, loadLocalTranslatorConfiguration } from "./local-translator.mjs";

const tenantId = "tenant-0000000000000001";

function configuredTenant() {
  const root = mkdtempSync(join(tmpdir(), "mycrobo-translator-"));
  const modelPath = join(root, "model");
  mkdirSync(modelPath);
  writeFileSync(join(modelPath, "config.json"), "{}");
  writeFileSync(join(root, "local-translator.json"), JSON.stringify({
    version: 1,
    tenantId,
    provider: "translategemma-4b-it",
    modelPath,
    licenseAccepted: true,
    pythonExecutable: "python-test",
  }));
  return { root, modelPath };
}

test("translator configuration is local, licensed and bound to the active tenant", () => {
  const { root, modelPath } = configuredTenant();
  try {
    const enabled = loadLocalTranslatorConfiguration({ MYCROBO_USER_DATA_DIR: root, MYCROBO_TENANT_ID: tenantId });
    assert.equal(enabled.enabled, true);
    assert.equal(enabled.modelPath, modelPath);
    const mismatched = loadLocalTranslatorConfiguration({ MYCROBO_USER_DATA_DIR: root, MYCROBO_TENANT_ID: "tenant-0000000000000002" });
    assert.deepEqual({ enabled: mismatched.enabled, reason: mismatched.reason }, { enabled: false, reason: "tenant-mismatch" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("translator refuses missing license acceptance or model files without starting a worker", () => {
  const { root } = configuredTenant();
  try {
    const path = join(root, "local-translator.json");
    const config = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(path, JSON.stringify({ ...config, licenseAccepted: false }));
    assert.equal(loadLocalTranslatorConfiguration({ MYCROBO_USER_DATA_DIR: root, MYCROBO_TENANT_ID: tenantId }).reason, "license-not-accepted");
    writeFileSync(path, JSON.stringify({ ...config, modelPath: join(root, "missing") }));
    assert.equal(loadLocalTranslatorConfiguration({ MYCROBO_USER_DATA_DIR: root, MYCROBO_TENANT_ID: tenantId }).reason, "model-files-incomplete");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("adapter returns explicit unchanged fallback on local inference failure", async () => {
  const worker = {
    runtime: "ready",
    async request() { const error = new Error("private details must not surface"); error.code = "INFERENCE_FAILED"; throw error; },
  };
  const adapter = new LocalTranslateGemmaAdapter({ enabled: true, configured: true, tenantId, licenseAccepted: true }, { worker });
  const result = await adapter.translate({ tenantId, text: "Where are you?", sourceLangCode: "en", targetLangCode: "hi" });
  assert.deepEqual(result, {
    applied: false,
    text: "Where are you?",
    sourceLangCode: "en",
    targetLangCode: "hi",
    reason: "INFERENCE_FAILED",
    localOnly: true,
  });
  assert.doesNotMatch(JSON.stringify(result), /private details/u);
});

test("adapter returns only a local successful translation and redacts its model path from status", async () => {
  const worker = { runtime: "ready", async request(request) { assert.equal(request.tenantId, tenantId); return "आप कहाँ हैं?"; } };
  const adapter = new LocalTranslateGemmaAdapter({ enabled: true, configured: true, tenantId, licenseAccepted: true, modelPath: "C:\\private\\model" }, { worker });
  const result = await adapter.translate({ tenantId, text: "Where are you?", sourceLangCode: "en", targetLangCode: "hi" });
  assert.equal(result.applied, true);
  assert.equal(result.text, "आप कहाँ हैं?");
  assert.equal(result.localOnly, true);
  assert.equal(JSON.stringify(adapter.status()).includes("private"), false);
});

test("stdio worker forces offline mode and uses the licensed local model only", async () => {
  const observed = {};
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => {};
  child.stdin.setEncoding("utf8");
  child.stdin.on("data", (line) => {
    const request = JSON.parse(line);
    child.stdout.write(`${JSON.stringify({ type: "result", id: request.id, ok: true, text: "Hallo" })}\n`);
  });
  const spawnProcess = (command, args, options) => {
    Object.assign(observed, { command, args, options });
    queueMicrotask(() => child.stdout.write(`${JSON.stringify({ type: "ready", contract_version: "mycrobo-local-translation.1" })}\n`));
    return child;
  };
  const worker = new TranslateGemmaStdioWorker({
    pythonExecutable: "python-test",
    scriptPath: "C:\\worker.py",
    modelPath: "C:\\models\\translate",
    tenantId,
  }, { spawnProcess, environment: { PATH: "safe-path", HTTP_PROXY: "http://proxy", HF_TOKEN: "secret" }, startupTimeoutMs: 1_000, requestTimeoutMs: 1_000 });
  const translated = await worker.request({ contractVersion: "mycrobo-local-translation.1", tenantId, text: "Hello", sourceLangCode: "en", targetLangCode: "de-DE", maxNewTokens: 32 });
  assert.equal(translated, "Hallo");
  assert.equal(observed.options.shell, false);
  assert.equal(observed.options.env.TRANSFORMERS_OFFLINE, "1");
  assert.equal(observed.options.env.HF_HUB_OFFLINE, "1");
  assert.equal("HTTP_PROXY" in observed.options.env, false);
  assert.equal("HF_TOKEN" in observed.options.env, false);
  assert.deepEqual(observed.args.slice(-3), ["--tenant-id", tenantId, "--license-accepted"]);
  worker.close();
});

test("stdio translation requests release their pending slot immediately when the draft budget is cancelled", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => {};
  const worker = new TranslateGemmaStdioWorker({
    pythonExecutable: "python-test",
    scriptPath: "C:\\worker.py",
    modelPath: "C:\\models\\translate",
    tenantId,
  }, {
    spawnProcess() {
      queueMicrotask(() => child.stdout.write(`${JSON.stringify({ type: "ready", contract_version: "mycrobo-local-translation.1" })}\n`));
      return child;
    },
    startupTimeoutMs: 1_000,
    requestTimeoutMs: 90_000,
  });
  await worker.start();
  const controller = new AbortController();
  const pending = worker.request({ contractVersion: "mycrobo-local-translation.1", tenantId, text: "private fixture", sourceLangCode: "en", targetLangCode: "hi", maxNewTokens: 32 }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (error) => error?.code === "REQUEST_ABORTED");
  assert.equal(worker.pending.size, 0);
  worker.close();
});
