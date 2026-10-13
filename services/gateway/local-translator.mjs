import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import {
  LOCAL_TRANSLATION_CONTRACT_VERSION,
  LOCAL_TRANSLATION_MODEL,
  LocalTranslationContractError,
  assertTranslationTenantId,
  validateLocalTranslationRequest,
} from "../../contracts/local-translation.mjs";

const DEFAULT_SCRIPT = fileURLToPath(new URL("../translator/translategemma_service.py", import.meta.url));
const CONFIG_FILENAME = "local-translator.json";
const PROVIDER_NAME = "translategemma-4b-it";
const SAFE_ENVIRONMENT_KEYS = [
  "SystemRoot", "WINDIR", "PATH", "PATHEXT", "TEMP", "TMP", "TMPDIR",
  "USERPROFILE", "LOCALAPPDATA", "APPDATA", "ProgramData", "CUDA_PATH",
  "CUDA_VISIBLE_DEVICES", "LD_LIBRARY_PATH", "DYLD_LIBRARY_PATH",
];

function disabledConfiguration(reason, tenantId = null) {
  return Object.freeze({ enabled: false, configured: false, reason, tenantId });
}

export function loadLocalTranslatorConfiguration(environment = process.env) {
  let tenantId;
  try {
    tenantId = assertTranslationTenantId(environment.MYCROBO_TENANT_ID);
  } catch {
    return disabledConfiguration("tenant-unavailable");
  }
  const userDataDir = String(environment.MYCROBO_USER_DATA_DIR || "").trim();
  if (!userDataDir || !isAbsolute(userDataDir)) return disabledConfiguration("configuration-unavailable", tenantId);
  const configPath = join(resolve(userDataDir), CONFIG_FILENAME);
  if (!existsSync(configPath)) return disabledConfiguration("not-configured", tenantId);
  let raw;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return disabledConfiguration("configuration-invalid", tenantId);
  }
  if (raw?.version !== 1 || raw?.tenantId !== tenantId || raw?.provider !== PROVIDER_NAME) {
    return disabledConfiguration(raw?.tenantId && raw.tenantId !== tenantId ? "tenant-mismatch" : "configuration-invalid", tenantId);
  }
  if (raw.licenseAccepted !== true) return disabledConfiguration("license-not-accepted", tenantId);
  const modelPath = typeof raw.modelPath === "string" ? raw.modelPath.trim() : "";
  if (!isAbsolute(modelPath)) return disabledConfiguration("model-path-invalid", tenantId);
  const resolvedModelPath = resolve(modelPath);
  try {
    if (!statSync(resolvedModelPath).isDirectory() || !statSync(join(resolvedModelPath, "config.json")).isFile()) {
      return disabledConfiguration("model-files-incomplete", tenantId);
    }
  } catch {
    return disabledConfiguration("model-files-incomplete", tenantId);
  }
  const pythonExecutable = typeof raw.pythonExecutable === "string" && raw.pythonExecutable.trim()
    ? raw.pythonExecutable.trim()
    : (environment.MYCROBO_TRANSLATOR_PYTHON || "python");
  const scriptPath = DEFAULT_SCRIPT;
  if (!existsSync(scriptPath)) return disabledConfiguration("worker-unavailable", tenantId);
  return Object.freeze({
    enabled: true,
    configured: true,
    tenantId,
    modelPath: resolvedModelPath,
    pythonExecutable,
    scriptPath,
    licenseAccepted: true,
    provider: PROVIDER_NAME,
  });
}

function offlineChildEnvironment(environment = process.env) {
  const child = {};
  for (const key of SAFE_ENVIRONMENT_KEYS) if (environment[key]) child[key] = environment[key];
  return {
    ...child,
    PYTHONIOENCODING: "utf-8",
    PYTHONUNBUFFERED: "1",
    HF_HUB_OFFLINE: "1",
    TRANSFORMERS_OFFLINE: "1",
    HF_DATASETS_OFFLINE: "1",
    TOKENIZERS_PARALLELISM: "false",
  };
}

function workerError(code) {
  const error = new Error("Local translation is temporarily unavailable.");
  error.code = code;
  return error;
}

export class TranslateGemmaStdioWorker {
  constructor(configuration, { spawnProcess = spawn, environment = process.env, startupTimeoutMs = 180_000, requestTimeoutMs = 90_000 } = {}) {
    this.configuration = configuration;
    this.spawnProcess = spawnProcess;
    this.environment = environment;
    this.startupTimeoutMs = startupTimeoutMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.process = null;
    this.startPromise = null;
    this.pending = new Map();
    this.stdoutBuffer = "";
    this.runtime = "idle";
  }

  async start() {
    if (this.runtime === "ready" && this.process) return;
    if (this.startPromise) return this.startPromise;
    this.runtime = "starting";
    this.startPromise = new Promise((resolveStart, rejectStart) => {
      let settled = false;
      const args = [
        this.configuration.scriptPath,
        "--model-path", this.configuration.modelPath,
        "--tenant-id", this.configuration.tenantId,
        "--license-accepted",
      ];
      const child = this.spawnProcess(this.configuration.pythonExecutable, args, {
        cwd: this.configuration.modelPath,
        env: offlineChildEnvironment(this.environment),
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.process = child;
      const timer = setTimeout(() => fail(workerError("WORKER_START_TIMEOUT")), this.startupTimeoutMs);
      timer.unref?.();
      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.runtime = "unavailable";
        this.process = null;
        rejectStart(error?.code ? error : workerError("WORKER_START_FAILED"));
        try { child.kill(); } catch { /* already gone */ }
      };
      child.once("error", () => fail(workerError("WORKER_START_FAILED")));
      child.once("exit", () => {
        if (!settled) fail(workerError("WORKER_EXITED"));
        this.runtime = "unavailable";
        this.process = null;
        for (const pending of this.pending.values()) pending.reject(workerError("WORKER_EXITED"));
        this.pending.clear();
      });
      child.stderr?.on("data", () => { /* never copy model paths or private content into gateway logs */ });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        this.stdoutBuffer += chunk;
        if (Buffer.byteLength(this.stdoutBuffer, "utf8") > 65_536) return fail(workerError("WORKER_PROTOCOL_INVALID"));
        let newline = this.stdoutBuffer.indexOf("\n");
        while (newline >= 0) {
          const line = this.stdoutBuffer.slice(0, newline);
          this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
          let message;
          try { message = JSON.parse(line); } catch { return fail(workerError("WORKER_PROTOCOL_INVALID")); }
          if (message.type === "ready" && message.contract_version === LOCAL_TRANSLATION_CONTRACT_VERSION) {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              this.runtime = "ready";
              resolveStart();
            }
          } else if (message.type === "fatal") {
            fail(workerError(typeof message.code === "string" ? message.code : "MODEL_LOAD_FAILED"));
          } else if (message.type === "result") {
            let pending = this.pending.get(message.id);
            if (!pending && message.id == null) pending = this.pending.values().next().value;
            if (pending) {
              clearTimeout(pending.timer);
              this.pending.delete(pending.id);
              if (message.ok === true && typeof message.text === "string") pending.resolve(message.text);
              else pending.reject(workerError(typeof message.code === "string" ? message.code : "INFERENCE_FAILED"));
            }
          }
          newline = this.stdoutBuffer.indexOf("\n");
        }
      });
    }).finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  async request(request, runtime = {}) {
    const signal = runtime.signal;
    if (signal?.aborted) throw workerError("REQUEST_ABORTED");
    if (signal) {
      let abortStart;
      try {
        await Promise.race([
          this.start(),
          new Promise((_, reject) => {
            abortStart = () => reject(workerError("REQUEST_ABORTED"));
            signal.addEventListener("abort", abortStart, { once: true });
          }),
        ]);
      } finally {
        signal.removeEventListener("abort", abortStart);
      }
    } else {
      await this.start();
    }
    if (signal?.aborted) throw workerError("REQUEST_ABORTED");
    if (!this.process || this.runtime !== "ready") throw workerError("WORKER_UNAVAILABLE");
    const id = randomUUID().replace(/-/gu, "");
    const payload = JSON.stringify({
      id,
      contract_version: request.contractVersion,
      tenant_id: request.tenantId,
      text: request.text,
      source_lang_code: request.sourceLangCode,
      target_lang_code: request.targetLangCode,
      max_new_tokens: request.maxNewTokens,
    });
    return new Promise((resolveRequest, rejectRequest) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        this.pending.delete(id);
      };
      const resolveBounded = (value) => { cleanup(); resolveRequest(value); };
      const rejectBounded = (error) => { cleanup(); rejectRequest(error); };
      const timer = setTimeout(() => {
        rejectBounded(workerError("INFERENCE_TIMEOUT"));
      }, this.requestTimeoutMs);
      timer.unref?.();
      const abort = () => rejectBounded(workerError("REQUEST_ABORTED"));
      signal?.addEventListener("abort", abort, { once: true });
      this.pending.set(id, { id, timer, resolve: resolveBounded, reject: rejectBounded });
      this.process.stdin.write(`${payload}\n`, "utf8", (error) => {
        if (!error) return;
        rejectBounded(workerError("WORKER_WRITE_FAILED"));
      });
    });
  }

  close() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(workerError("WORKER_CLOSED"));
    }
    this.pending.clear();
    try { this.process?.kill(); } catch { /* already gone */ }
    this.process = null;
    this.runtime = "closed";
  }
}

export class LocalTranslateGemmaAdapter {
  constructor(configuration, { worker } = {}) {
    this.configuration = configuration;
    this.worker = configuration.enabled ? (worker || new TranslateGemmaStdioWorker(configuration)) : null;
  }

  status() {
    return Object.freeze({
      contractVersion: LOCAL_TRANSLATION_CONTRACT_VERSION,
      provider: LOCAL_TRANSLATION_MODEL,
      tenantId: this.configuration.tenantId || null,
      configured: this.configuration.configured === true,
      enabled: this.configuration.enabled === true,
      licenseAccepted: this.configuration.licenseAccepted === true,
      localOnly: true,
      inputTokenLimit: 2_048,
      runtime: this.worker?.runtime || "disabled",
      reason: this.configuration.enabled ? null : this.configuration.reason,
    });
  }

  async translate(input, runtime = {}) {
    if (!this.configuration.enabled || !this.worker) {
      return Object.freeze({ applied: false, text: typeof input?.text === "string" ? input.text : "", reason: this.configuration.reason || "disabled", localOnly: true });
    }
    const request = validateLocalTranslationRequest(input, this.configuration.tenantId);
    try {
      const text = await this.worker.request(request, runtime);
      return Object.freeze({
        applied: true,
        text,
        sourceLangCode: request.sourceLangCode,
        targetLangCode: request.targetLangCode,
        provider: LOCAL_TRANSLATION_MODEL,
        localOnly: true,
      });
    } catch (error) {
      if (error instanceof LocalTranslationContractError) throw error;
      return Object.freeze({
        applied: false,
        text: request.text,
        sourceLangCode: request.sourceLangCode,
        targetLangCode: request.targetLangCode,
        reason: typeof error?.code === "string" ? error.code : "LOCAL_TRANSLATION_UNAVAILABLE",
        localOnly: true,
      });
    }
  }

  close() { this.worker?.close?.(); }
}

export function createLocalTranslatorFromEnv(environment = process.env, options = {}) {
  return new LocalTranslateGemmaAdapter(loadLocalTranslatorConfiguration(environment), options);
}
