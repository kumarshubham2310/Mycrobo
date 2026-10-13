import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(process.cwd());
const extensions = new Set([".js", ".mjs", ".cjs", ".ts", ".go", ".json", ".md"]);
const ignored = new Set([".git", "node_modules", ".test-bin"]);

async function files(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (extensions.has(extname(entry.name))) result.push(path);
  }
  return result;
}

const findings = [];
for (const path of await files(root)) {
  const text = await readFile(path, "utf8");
  const name = relative(root, path).replaceAll("\\", "/");
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(text)) findings.push({ name, issue: "private-key-material" });
  if (/\bAIza[0-9A-Za-z_-]{30,}\b/u.test(text)) findings.push({ name, issue: "google-api-key" });
  if (/\bsk-(?:proj-)?[0-9A-Za-z_-]{24,}\b/u.test(text)) findings.push({ name, issue: "openai-api-key" });
  if (/\bghp_[0-9A-Za-z]{30,}\b/u.test(text)) findings.push({ name, issue: "github-token" });
}

assert.deepEqual(findings, [], `Potential committed credentials found: ${JSON.stringify(findings)}`);
const main = await readFile(join(root, "desktop/electron/main.cjs"), "utf8");
for (const invariant of [/nodeIntegration:\s*false/u, /contextIsolation:\s*true/u, /sandbox:\s*true/u, /webSecurity:\s*true/u]) {
  assert.match(main, invariant, `Electron isolation invariant missing: ${invariant}`);
}
assert.match(main, /requestSingleInstanceLock/u, "Desktop single-instance protection was not found.");
assert.match(main, /acquireTenantRuntimeLease/u, "Tenant runtime isolation was not found.");
assert.match(main, /MYCROBO_DESKTOP_PARENT_PID/u, "Child-service parent binding was not found.");
assert.match(main, /loadProtectedAutoSendBootstrap/u, "Protected automatic-delivery host configuration was not found.");
assert.match(main, /stdio:\s*\["ignore",\s*"ignore",\s*"pipe",\s*"pipe"\]/u, "Automatic-delivery bootstrap must use a dedicated inherited pipe.");
assert.doesNotMatch(main, /gatewayEnv\.MYCROBO_AUTO_SEND_SIGNING_SECRET/u, "Automatic-delivery signing material must never enter the child environment.");
const server = await readFile(join(root, "services/gateway/server.mjs"), "utf8");
assert.match(server, /authorization/iu, "Gateway authentication enforcement was not found.");
assert.match(server, /send-approval/u, "Exact send approval boundary was not found.");
assert.match(server, /readAutoSendHostBootstrapFromFd\(3/u, "Automatic delivery must require the protected host bootstrap channel.");
assert.match(server, /executionEnabled:\s*hostBootstrap\s*\?\s*true\s*:\s*options\.autoSendExecutionEnabled === true/u, "Automatic delivery must require protected-host or explicit test-constructor activation.");
assert.match(server, /automaticSendAvailable:\s*runtime\.available && consentCurrent/u, "Automatic delivery availability must remain bound to current execution consent.");
const autoSendRuntime = await readFile(join(root, "services/gateway/auto-send-gateway-runtime.mjs"), "utf8");
assert.doesNotMatch(autoSendRuntime, /process\.env/u, "The guarded automatic-delivery runtime must not self-enable from ambient environment variables.");
for (const invariant of [
  /EXECUTION_FLAG_DISABLED/u,
  /TENANT_BINDING_UNAVAILABLE/u,
  /USER_BINDING_UNAVAILABLE/u,
  /ACCOUNT_BINDING_UNAVAILABLE/u,
  /BUILD_NOT_CERTIFIED/u,
  /DURABLE_STORAGE_UNAVAILABLE/u,
  /AUTHORIZATION_KEY_UNAVAILABLE/u,
  /DELIVERY_BOUNDARY_UNAVAILABLE/u,
  /SAFETY_AUTHORITIES_UNAVAILABLE/u,
]) {
  assert.match(autoSendRuntime, invariant, `Guarded automatic-delivery gate missing: ${invariant}`);
}
const translator = await readFile(join(root, "services/translator/translategemma_service.py"), "utf8");
assert.match(translator, /local_files_only=True/u, "Local translation must never download gated model weights at runtime.");
assert.match(translator, /TRANSFORMERS_OFFLINE/u, "Local translation must force offline model loading.");

const webAuth = await readFile(join(root, "apps/client/web-auth-contract.mjs"), "utf8");
assert.match(webAuth, /publicSupabaseKey/u, "Browser auth must reject privileged project credentials.");
assert.match(webAuth, /status === 404\) return localWebAuthContext\(context\)/u, "Remote auth configuration failures must not bypass sign-in.");
const webWorker = await readFile(join(root, "infrastructure/cloudflare/src/worker.mjs"), "utf8");
assert.match(webWorker, /import \{ validSupabaseWebConfig \}/u, "Worker and browser must share the public credential boundary.");
assert.match(webWorker, /if \(url\.pathname\.startsWith\('\/api\/'\)\) return desktopConnectorRequired/u, "The hosted Worker must not expose private desktop APIs.");
assert.match(webWorker, /googleOAuthAvailable: false/u, "Hosted Google OAuth must remain explicitly unavailable.");
const webSession = await readFile(join(root, "apps/client/web-session.mjs"), "utf8");
assert.match(webSession, /generation !== requestGeneration/u, "Logout must prevent a pending authenticated dispatch.");
assert.match(webSession, /response\.status === 401 && generation === requestGeneration/u, "An old failed request must not clear a new session.");

console.log(JSON.stringify({ ok: true, scannedFiles: (await files(root)).length, findings: 0, electronIsolation: true }, null, 2));
