import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shellUrl = new URL("../../desktop/electron/main.cjs", import.meta.url);
const splashUrl = new URL("../../desktop/electron/splash.html", import.meta.url);
const clientUrl = new URL("../../apps/client/app.js", import.meta.url);
const stylesUrl = new URL("../../apps/client/styles.css", import.meta.url);

test("desktop shell keeps approval-gated messaging inside an isolated local origin", async () => {
  const source = await readFile(shellUrl, "utf8");

  assert.match(source, /randomBytes\(32\)/);
  assert.match(source, /delete commonEnv\.OPENAI_API_KEY/);
  assert.match(source, /delete commonEnv\.MYCROBO_OPENAI_MODEL/);
  assert.match(source, /nodeIntegration:\s*false/);
  assert.match(source, /contextIsolation:\s*true/);
  assert.match(source, /sandbox:\s*true/);
  assert.match(source, /webSecurity:\s*true/);
  assert.match(source, /setWindowOpenHandler\(\(\) => \(\{ action: "deny" \}\)\)/);
  assert.match(source, /setPermissionRequestHandler\([^\n]+callback\(false\)/);
  assert.match(source, /new URL\(url\)\.origin !== allowedOrigin/);
  assert.doesNotMatch(source, /url\.startsWith\("http:\/\/127\.0\.0\.1:"\)/);
  assert.match(source, /windowsHide:\s*true/g);
  assert.match(source, /"-enable-text-send"/);
  assert.match(source, /stopChildAndWait\(gatewayProcess, 7_500\)/);
  assert.match(source, /stopChildAndWait\(bridgeProcess, 7_500\)/);
  assert.match(source, /mycrobo-app-v2\.ico/);
  assert.match(source, /createSplashWindow\(\)/);
  assert.match(source, /requestSingleInstanceLock/u);
  assert.match(source, /"second-instance"/u);
  assert.match(source, /acquireTenantRuntimeLease\(tenantData, authorized\.tenant\.id\)/u);
  assert.match(source, /await stopLocalServices\(\)/u);
  assert.match(source, /Restart was cancelled to protect the WhatsApp session/u);
  assert.match(source, /"-parent-pid", String\(process\.pid\)/u);
  assert.match(source, /MYCROBO_DESKTOP_PARENT_PID: String\(process\.pid\)/u);
  assert.match(source, /function expectedWhatsAppAccountScope\(userData\)/u);
  assert.match(source, /const expectedAccountScopeId = expectedWhatsAppAccountScope\(tenantData\)/u);
  assert.match(source, /MYCROBO_EXPECTED_ACCOUNT_SCOPE_ID: expectedAccountScopeId/u);
  assert.match(source, /loadProtectedAutoSendBootstrap/u);
  assert.match(source, /stdio:\s*\["ignore", "ignore", "pipe", "pipe"\]/u);
  assert.doesNotMatch(source, /MYCROBO_AUTO_SEND_SIGNING_SECRET/u);
  assert.match(source, /\^\\d\{5,20\}@s\\\.whatsapp\\\.net\$/u);
});

test("startup surface uses the official MyCrobo brand assets without relaxing isolation", async () => {
  const splash = await readFile(splashUrl, "utf8");

  assert.match(splash, /mycrobo-lockup-v1\.png/);
  assert.match(splash, /default-src 'self'/);
  assert.match(splash, /object-src 'none'/);
  assert.doesNotMatch(splash, /https?:\/\//);
});

test("connection approval remains stable across status polling", async () => {
  const source = await readFile(clientUrl, "utf8");

  assert.match(source, /setupPanel\.dataset\.mode === "consent"/);
  assert.match(source, /id="connectAll" disabled/);
  assert.match(source, /#connectorRisk"\)\?\.addEventListener\("change"/);
  assert.match(source, /button\.disabled = !event\.currentTarget\.checked/);
  assert.match(source, /AbortSignal\.timeout\(20_000\)/);
  assert.match(source, /function renderReauthenticationRecovery\(status\)/u);
  assert.match(source, /Reconnect with QR or phone/u);
  assert.match(source, /window\.mycroboDesktop\.relinkWhatsApp\(\)/u);
  assert.match(source, /function renderAccountVerificationRecovery\(status\)/u);
  assert.match(source, /This WhatsApp account does not match this workspace/u);
  assert.match(source, /Create separate workspace/u);
  assert.match(source, /window\.mycroboDesktop\.addTenant\(\{ name: "New WhatsApp workspace" \}\)/u);
  assert.match(source, /status\.connectionState === "account-verification-required"/u);
  assert.match(source, /status\.connectionState === "reauth-required"/u);
  assert.match(source, /pairingState === "unpaired"/u);
});

test("conversation layout contains long WhatsApp links without horizontal overflow", async () => {
  const styles = await readFile(stylesUrl, "utf8");
  assert.match(styles, /\.conversation \{[^}]*overflow: hidden/u);
  assert.match(styles, /\.messageList \{[^}]*overflow-x: hidden/u);
  assert.match(styles, /\.message \{[^}]*flex: 0 0 auto/u);
  assert.doesNotMatch(styles, /\.message \{[^}]*overflow: hidden/u);
  assert.match(styles, /\.message p \{[^}]*overflow-wrap: anywhere/u);
});
