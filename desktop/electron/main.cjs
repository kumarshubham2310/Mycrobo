const { app, BrowserWindow, ipcMain, safeStorage, session, shell } = require("electron");
const { createHash, randomBytes } = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");
const { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { createServer } = require("node:net");
const { join } = require("node:path");
const { loadModelCredential, removeModelCredential, storeModelCredential } = require("./model-credential.cjs");
const { loadTenantRegistry } = require("./tenant-registry.cjs");
const { ControlPlane } = require("./control-plane.cjs");
const { prepareFreshLinkedDeviceSession, resolveLinkedDeviceDatabase } = require("./linked-device-session.cjs");
const { materializeLegacyTenant, tenantDirectory, tenantUserDirectory } = require("./tenant-storage.cjs");
const { acquireTenantRuntimeLease, createConfirmedQuitCoordinator, createServiceHealthMonitor, releaseTenantRuntimeLease, stopChildAndWait } = require("./runtime-lifecycle.cjs");
const { resolveApplicationRoot } = require("./app-root.cjs");
const { loadProtectedAutoSendBootstrap } = require("./auto-send-bootstrap.cjs");
const { createCloudRelayIdentity } = require("./cloud-relay-identity.cjs");

let bridgeProcess;
let gatewayProcess;
let mainWindow;
let splashWindow;
let shuttingDown = false;
let allowedOrigin;
let showingStartupFailure = false;
let gatewayService = null;
let runtimeStatusTimer = null;
let runtimeHealthMonitor = null;
let installationUserData = null;
let currentTenant = null;
let controlPlane = null;
let desktopSessionToken = null;
let currentIdentitySession = null;
let runtimeLease = null;
let localServicesStopping = null;
let cloudRelayIdentity = null;
const platformAdminMode = process.argv.includes("--platform-admin");
const applicationRoot = resolveApplicationRoot({
  isPackaged: app.isPackaged,
  appPath: app.getAppPath(),
  sourceDirectory: __dirname,
});

// The operator console and the customer product may be open at the same time.
// Keep one Windows-protected safeStorage identity for all local MyCrobo
// surfaces, while separating Chromium session/cache data for the operator
// console. Changing userData here would also change Chromium's OS-crypt key and
// could make a tenant vault created by one surface unreadable by the other.
const sharedInstallationUserData = app.getPath("userData");
if (platformAdminMode) {
  const platformBrowserProfile = join(sharedInstallationUserData, "platform-console-browser-profile");
  mkdirSync(platformBrowserProfile, { recursive: true, mode: 0o700 });
  app.setPath("sessionData", platformBrowserProfile);
}

// Product and platform-console profiles intentionally use separate locks. A
// second product launch must focus the existing window instead of starting a
// competing WhatsApp bridge and gateway for the same private workspace.
const instanceLockAcquired = app.requestSingleInstanceLock({ surface: platformAdminMode ? "platform-console" : "product" });
if (!instanceLockAcquired) app.quit();
else app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

// The operator console and the customer product are separate security surfaces.
// A console sign-out must never invalidate or overwrite the product session.
const DESKTOP_SESSION_FILE = platformAdminMode ? "platform-admin-session.bin" : "desktop-session.bin";

function restrictedChildEnvironment(additions = {}) {
  const allowed = ["APPDATA", "COMSPEC", "LOCALAPPDATA", "NUMBER_OF_PROCESSORS", "OS", "PATH", "PATHEXT", "PROCESSOR_ARCHITECTURE", "PROGRAMDATA", "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "WINDIR"];
  const environment = {};
  for (const key of allowed) if (process.env[key]) environment[key] = process.env[key];
  return { ...environment, ...additions };
}

function protectUserDataDirectory(userData) {
  mkdirSync(userData, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    chmodSync(userData, 0o700);
    return;
  }
  const account = process.env.USERDOMAIN && process.env.USERNAME
    ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}`
    : process.env.USERNAME;
  if (!account) throw new Error("The current Windows account could not be identified for private storage.");
  const result = spawnSync("icacls.exe", [userData, "/inheritance:r", "/grant:r", `${account}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F"], {
    windowsHide: true,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error("MyCrobo could not secure its private storage for this Windows account.");
}

function loadOrCreateVaultKey(userData) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows secure storage is unavailable; MyCrobo will not open an unprotected private vault.");
  const keyPath = join(userData, "vault-key.bin");
  if (existsSync(keyPath)) {
    try { return safeStorage.decryptString(readFileSync(keyPath)); }
    catch {
      const error = new Error("This workspace's private vault cannot be unlocked by the current Windows-protected profile. MyCrobo preserved every file and stopped before opening the workspace.");
      error.code = "MYCROBO_VAULT_KEY_UNREADABLE";
      throw error;
    }
  }
  const key = randomBytes(32).toString("base64");
  writeFileSync(keyPath, safeStorage.encryptString(key), { mode: 0o600, flag: "wx" });
  return key;
}

function userTenantDirectory(identity) {
  if (!identity?.tenant?.id || !identity?.user?.id) throw new Error("Authenticate before opening private user storage.");
  const ownerUserId = controlPlane.tenantStorageOwnerUserId(identity.tenant.id);
  return tenantUserDirectory(installationUserData, identity.tenant.id, identity.user.id, ownerUserId);
}

function expectedWhatsAppAccountScope(userData) {
  const ownerPath = join(userData, "linked-device.db.owner.json");
  if (!existsSync(ownerPath)) return "";
  try {
    const owner = String(JSON.parse(readFileSync(ownerPath, "utf8"))?.owner || "").trim().toLowerCase();
    if (!/^\d{5,20}@s\.whatsapp\.net$/u.test(owner)) return "";
    return createHash("sha256").update(owner).digest("hex");
  } catch { return ""; }
}

function savedSessionPath() { return join(installationUserData, DESKTOP_SESSION_FILE); }
function loadSavedSessionToken() {
  if (!safeStorage.isEncryptionAvailable() || !existsSync(savedSessionPath())) return null;
  try { return safeStorage.decryptString(readFileSync(savedSessionPath())); }
  catch { return null; }
}
function saveSessionToken(token) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Windows secure storage is unavailable; MyCrobo will not persist a login token.");
  writeFileSync(savedSessionPath(), safeStorage.encryptString(String(token)), { mode: 0o600 });
}
function clearSavedSessionToken() {
  try { require("node:fs").unlinkSync(savedSessionPath()); } catch (error) { if (error?.code !== "ENOENT") throw error; }
}

function installGatewayAuthentication(origin, gatewayToken, windowToken) {
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`${origin}/*`] }, (details, callback) => {
    callback({
      requestHeaders: {
        ...details.requestHeaders,
        Authorization: `Bearer ${gatewayToken}`,
        "X-MyCrobo-Window": windowToken,
      },
    });
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitFor(url, options = {}, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(1_500) });
      if (response.ok) return;
      lastError = new Error(`Local service returned ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw lastError || new Error("Local service did not start.");
}

function executableBridge(root) {
  return join(root, "bin", process.platform === "win32" ? "mycrobo-live-bridge.exe" : "mycrobo-live-bridge");
}

async function stopLocalServices() {
  if (localServicesStopping) return localServicesStopping;
  localServicesStopping = (async () => {
    clearInterval(runtimeStatusTimer);
    runtimeStatusTimer = null;
    runtimeHealthMonitor = null;
    const [gatewayResult, bridgeResult] = await Promise.all([
      stopChildAndWait(gatewayProcess, 7_500),
      stopChildAndWait(bridgeProcess, 7_500),
    ]);
    if (!gatewayResult.stopped || !bridgeResult.stopped) {
      const error = new Error("MyCrobo could not confirm that its private services stopped. Restart was cancelled to protect the WhatsApp session.");
      error.code = "MYCROBO_SERVICE_SHUTDOWN_UNCONFIRMED";
      throw error;
    }
    gatewayProcess = null;
    bridgeProcess = null;
    gatewayService = null;
    releaseTenantRuntimeLease(runtimeLease);
    runtimeLease = null;
    return { gatewayResult, bridgeResult };
  })();
  try { return await localServicesStopping; }
  finally { localServicesStopping = null; }
}

function detachedAppArguments(extra = []) {
  return app.isPackaged ? extra : [applicationRoot, ...extra];
}

async function recordConnectorRuntimeStatus(url, headers, tenantData) {
  try {
    const response = await fetch(`${url}api/v1/status`, { headers, cache: "no-store", signal: AbortSignal.timeout(4_000) });
    if (!response.ok) return;
    const status = await response.json();
    const diagnostic = {
      schema: "mycrobo-connector-runtime.1",
      observedAt: new Date().toISOString(),
      connected: status?.connected === true,
      connectionState: String(status?.connectionState || "unknown").slice(0, 64),
      sendAvailable: status?.sendAvailable === true,
      pairing: {
        state: String(status?.pairing?.state || "unknown").slice(0, 64),
        failureCode: status?.pairing?.failureCode ? String(status.pairing.failureCode).slice(0, 64) : null,
        retryable: status?.pairing?.retryable === true,
      },
      accountVerification: status?.accountVerification && typeof status.accountVerification === "object"
        ? {
            state: String(status.accountVerification.state || "unknown").slice(0, 48),
            failure: status.accountVerification.failure ? String(status.accountVerification.failure).slice(0, 64) : null,
            expectedOwnerConfigured: status.accountVerification.expectedOwnerConfigured === true,
            expectedOwnerMatched: status.accountVerification.expectedOwnerMatched === true,
            authenticatedAliasCount: Math.max(0, Math.min(8, Number(status.accountVerification.authenticatedAliasCount || 0))),
            hasPhoneAlias: status.accountVerification.hasPhoneAlias === true,
            hasLIDAlias: status.accountVerification.hasLIDAlias === true,
          }
        : null,
      bridge: String(status?.bridge || "unknown").slice(0, 64),
      build: String(status?.version || app.getVersion()).slice(0, 64),
    };
    const diagnostics = join(tenantData, "diagnostics");
    mkdirSync(diagnostics, { recursive: true, mode: 0o700 });
    writeFileSync(join(diagnostics, "runtime-status.json"), `${JSON.stringify(diagnostic, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    return true;
  } catch {
    // Content-free diagnostics must never delay startup. The caller uses only
    // this boolean reachability signal; no chat content enters the watchdog.
    return false;
  }
}

async function restartUnresponsiveLocalServices() {
  if (shuttingDown || localServicesStopping || platformAdminMode) return;
  shuttingDown = true;
  try {
    await stopLocalServices();
    app.relaunch({ args: process.argv.slice(1) });
    app.exit(0);
  } catch (error) {
    shuttingDown = false;
    showStartupFailure(error instanceof Error
      ? `MyCrobo detected an unresponsive private service but could not restart it safely. ${error.message}`
      : "MyCrobo detected an unresponsive private service but could not restart it safely.");
  }
}

async function startLocalServices(identitySession) {
  const root = applicationRoot;
  const bridgePort = await freePort();
  const gatewayPort = await freePort();
  const token = randomBytes(32).toString("hex");
  const gatewayToken = randomBytes(32).toString("hex");
  const windowToken = randomBytes(32).toString("hex");
  const sendBrokerToken = randomBytes(32).toString("hex");
  if (!identitySession?.user?.id || !identitySession?.tenant?.id || !desktopSessionToken) throw new Error("Authenticate before opening a MyCrobo workspace.");
  const authorized = controlPlane.requireSession(desktopSessionToken);
  if (authorized.user.id !== identitySession.user.id || authorized.tenant.id !== identitySession.tenant.id) throw new Error("The workspace authorization changed before startup.");
  currentTenant = authorized.tenant;
  const tenantData = userTenantDirectory(authorized);
  protectUserDataDirectory(tenantData);
  runtimeLease = acquireTenantRuntimeLease(tenantData, authorized.tenant.id);
  controlPlane.persistEntitlementSnapshot(authorized.tenant.id);
  const userStateKey = loadOrCreateVaultKey(tenantData);
  const protectedModelCredential = loadModelCredential({ userData: tenantData, safeStorage });
  const expectedAccountScopeId = expectedWhatsAppAccountScope(tenantData);
  let autoSendHostBootstrap = null;
  try {
    autoSendHostBootstrap = loadProtectedAutoSendBootstrap({
      userData: tenantData,
      safeStorage,
      expected: {
        tenantId: authorized.tenant.id,
        userId: authorized.user.id,
        accountId: expectedAccountScopeId,
        buildVersion: app.getVersion(),
      },
    });
  } catch { /* invalid or unavailable protected configuration remains disabled */ }
  const commonEnv = restrictedChildEnvironment({
    MYCROBO_BRIDGE_TOKEN: token,
    MYCROBO_MESSAGE_DB_KEY: Buffer.from(userStateKey, "base64").toString("hex"),
    MYCROBO_EXPECTED_ACCOUNT_SCOPE_ID: expectedAccountScopeId,
  });
  delete commonEnv.OPENAI_API_KEY;
  delete commonEnv.MYCROBO_OPENAI_MODEL;
  delete commonEnv.GEMINI_API_KEY;
  delete commonEnv.MYCROBO_GEMINI_MODEL;
  delete commonEnv.MYCROBO_GOOGLE_CLIENT_SECRET;

  const bridgeArguments = [
    "-listen", `127.0.0.1:${bridgePort}`,
    "-messages-database", join(tenantData, "messages.db"),
    "-session-database", resolveLinkedDeviceDatabase(tenantData),
  ];
  bridgeArguments.push("-enable-text-send");
  bridgeArguments.push("-parent-pid", String(process.pid));
  bridgeProcess = spawn(executableBridge(root), bridgeArguments, { cwd: root, env: commonEnv, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  let bridgeError = "";
  bridgeProcess.stderr.on("data", (chunk) => { bridgeError = `${bridgeError}${chunk}`.slice(-4_000); });
  bridgeProcess.once("exit", (code) => {
    if (!shuttingDown && code !== 0) showStartupFailure(`The private message service stopped unexpectedly. ${bridgeError}`);
  });
  await waitFor(`http://127.0.0.1:${bridgePort}/v1/health`, { headers: { authorization: `Bearer ${token}` } }, 120_000);

  const gatewayEnv = {
    ...commonEnv,
    ELECTRON_RUN_AS_NODE: "1",
    MYCROBO_BRIDGE_URL: `http://127.0.0.1:${bridgePort}`,
    MYCROBO_GATEWAY_PORT: String(gatewayPort),
    MYCROBO_USER_DATA_DIR: tenantData,
    MYCROBO_TENANT_ID: currentTenant.id,
    MYCROBO_AUTH_USER_ID: authorized.user.id,
    MYCROBO_AUTH_ROLE: authorized.tenant.role,
    MYCROBO_PLAN_ENTITLEMENT: JSON.stringify(controlPlane.entitlement(desktopSessionToken)),
    MYCROBO_PLAN_ENTITLEMENT_PATH: join(tenantData, "plan-entitlement.json"),
    MYCROBO_USER_STATE_KEY: userStateKey,
    MYCROBO_GATEWAY_TOKEN: gatewayToken,
    MYCROBO_WINDOW_TOKEN: windowToken,
    MYCROBO_SEND_BROKER_TOKEN: sendBrokerToken,
    MYCROBO_GATEWAY_HOST: `127.0.0.1:${gatewayPort}`,
    MYCROBO_GATEWAY_ORIGIN: `http://127.0.0.1:${gatewayPort}`,
    MYCROBO_BUILD_VERSION: app.getVersion(),
    MYCROBO_BUILD_CHANNEL: "internal-alpha",
    MYCROBO_BUILD_ID: `${app.getVersion()}-${process.arch}`,
    MYCROBO_DESKTOP_PARENT_PID: String(process.pid),
  };
  if (protectedModelCredential) {
    gatewayEnv.MYCROBO_MODEL_PROVIDER = protectedModelCredential.provider;
    if (protectedModelCredential.provider === "gemini") {
      gatewayEnv.GEMINI_API_KEY = protectedModelCredential.key;
      gatewayEnv.MYCROBO_GEMINI_MODEL = protectedModelCredential.model;
    } else {
      gatewayEnv.OPENAI_API_KEY = protectedModelCredential.key;
      gatewayEnv.MYCROBO_OPENAI_MODEL = protectedModelCredential.model;
    }
    gatewayEnv.MYCROBO_MODEL_PROCESSING_CONSENT = "true";
  } else if (String(process.env.MYCROBO_MODEL_PROCESSING_CONSENT || "").toLowerCase() === "true"
    && process.env.GEMINI_API_KEY) {
    gatewayEnv.MYCROBO_MODEL_PROVIDER = "gemini";
    gatewayEnv.GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    gatewayEnv.MYCROBO_GEMINI_MODEL = process.env.MYCROBO_GEMINI_MODEL || "gemini-3.7-flash";
    gatewayEnv.MYCROBO_MODEL_PROCESSING_CONSENT = "true";
  } else if (String(process.env.MYCROBO_MODEL_PROCESSING_CONSENT || "").toLowerCase() === "true"
    && process.env.OPENAI_API_KEY) {
    gatewayEnv.MYCROBO_MODEL_PROVIDER = "openai";
    gatewayEnv.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    gatewayEnv.MYCROBO_OPENAI_MODEL = process.env.MYCROBO_OPENAI_MODEL || "gpt-5.6-luna";
    gatewayEnv.MYCROBO_MODEL_PROCESSING_CONSENT = "true";
  }
  if (process.env.MYCROBO_GOOGLE_CLIENT_ID) gatewayEnv.MYCROBO_GOOGLE_CLIENT_ID = process.env.MYCROBO_GOOGLE_CLIENT_ID;
  gatewayProcess = spawn(process.execPath, ["--experimental-strip-types", join(root, "services", "gateway", "server.mjs")], {
    cwd: root,
    env: gatewayEnv,
    windowsHide: true,
    stdio: ["ignore", "ignore", "pipe", "pipe"],
  });
  gatewayProcess.stdio[3].on("error", () => {});
  gatewayProcess.stdio[3].end(autoSendHostBootstrap ? JSON.stringify(autoSendHostBootstrap) : "");
  let gatewayError = "";
  gatewayProcess.stderr.on("data", (chunk) => { gatewayError = `${gatewayError}${chunk}`.slice(-4_000); });
  gatewayProcess.once("exit", (code) => {
    if (!shuttingDown && code !== 0) showStartupFailure(`The private application service stopped unexpectedly. ${gatewayError}`);
  });
  const url = `http://127.0.0.1:${gatewayPort}/`;
  const statusHeaders = { authorization: `Bearer ${gatewayToken}`, "x-mycrobo-window": windowToken };
  await waitFor(`${url}api/v1/status`, { headers: statusHeaders });
  await recordConnectorRuntimeStatus(url, statusHeaders, tenantData);
  clearInterval(runtimeStatusTimer);
  runtimeHealthMonitor = createServiceHealthMonitor({
    threshold: 2,
    onUnhealthy: restartUnresponsiveLocalServices,
  });
  runtimeStatusTimer = setInterval(() => {
    void runtimeHealthMonitor?.observe(() => recordConnectorRuntimeStatus(url, statusHeaders, tenantData));
  }, 5_000);
  runtimeStatusTimer.unref?.();
  return { url, gatewayToken, windowToken, sendBrokerToken };
}

async function restartIntoTenant(tenantId) {
  if (!installationUserData || !desktopSessionToken) throw new Error("Sign in before switching workspaces.");
  const previousTenantId = currentTenant?.id || controlPlane.requireSession(desktopSessionToken).tenant.id;
  const result = controlPlane.selectTenant(desktopSessionToken, tenantId);
  shuttingDown = true;
  try { await stopLocalServices(); }
  catch (error) {
    try { controlPlane.selectTenant(desktopSessionToken, previousTenantId); } catch { /* the original error remains authoritative */ }
    shuttingDown = false;
    throw error;
  }
  app.relaunch({ args: process.argv.slice(1) });
  app.exit(0);
  return { restarting: true, activeTenantId: result.tenant.id };
}

async function restartForFreshWhatsAppSession() {
  if (!installationUserData || !desktopSessionToken || !currentTenant?.id) throw new Error("Sign in before reconnecting WhatsApp.");
  const identity = controlPlane.requireSession(desktopSessionToken);
  if (identity.tenant.id !== currentTenant.id || !["owner", "admin"].includes(identity.tenant.role)) {
    throw new Error("Workspace administrator access is required to reconnect WhatsApp.");
  }
  const tenantData = userTenantDirectory(identity);
  shuttingDown = true;
  try { await stopLocalServices(); }
  catch (error) { shuttingDown = false; throw error; }
  prepareFreshLinkedDeviceSession(tenantData);
  app.relaunch({ args: process.argv.slice(1) });
  app.exit(0);
  return { restarting: true };
}

function installTenantBroker() {
  const verify = (event) => {
    if (!allowedOrigin || new URL(event.senderFrame.url).origin !== allowedOrigin) throw new Error("The tenant request did not come from the private MyCrobo window.");
  };
  ipcMain.handle("mycrobo:tenants", async (event) => {
    verify(event);
    return controlPlane.listTenants(desktopSessionToken);
  });
  ipcMain.handle("mycrobo:add-tenant", async (event, input) => {
    verify(event);
    const tenant = controlPlane.adminCreateTenant(desktopSessionToken, { name: String(input?.name || "New workspace") });
    tenantDirectory(installationUserData, tenant.id);
    return restartIntoTenant(tenant.id);
  });
  ipcMain.handle("mycrobo:switch-tenant", async (event, input) => {
    verify(event);
    return restartIntoTenant(String(input?.tenantId || ""));
  });
  ipcMain.handle("mycrobo:relink-whatsapp", async (event) => {
    verify(event);
    return restartForFreshWhatsAppSession();
  });
}

function authenticationPageAllowed(event) {
  if (!mainWindow || mainWindow.isDestroyed() || event?.sender !== mainWindow.webContents || event?.senderFrame !== mainWindow.webContents.mainFrame) return false;
  const url = String(event?.senderFrame?.url || "");
  if (allowedOrigin) {
    try { if (new URL(url).origin === allowedOrigin) return true; } catch {}
  }
  return url.startsWith("file://") && /\/(?:login|platform-admin)\.html$/iu.test(new URL(url).pathname);
}

function platformAdminPageAllowed(event) {
  if (!platformAdminMode || !mainWindow || mainWindow.isDestroyed() || event?.sender !== mainWindow.webContents || event?.senderFrame !== mainWindow.webContents.mainFrame) return false;
  const url = String(event.senderFrame.url || "");
  try { return url.startsWith("file://") && /\/platform-admin\.html$/iu.test(new URL(url).pathname); }
  catch { return false; }
}

async function openPlatformAdmin(token) {
  const identity = controlPlane.requireSession(token);
  if (!identity.user.platformAdmin) throw new Error("Platform administrator access is required.");
  desktopSessionToken = token;
  currentIdentitySession = identity;
  saveSessionToken(token);
  allowedOrigin = null;
  mainWindow.setTitle("MyCrobo Platform Console");
  await mainWindow.loadFile(join(applicationRoot, "desktop", "electron", "platform-admin.html"));
  return identity;
}

async function openAuthenticatedWorkspace(token) {
  const identity = controlPlane.requireSession(token);
  desktopSessionToken = token;
  currentIdentitySession = identity;
  try {
    const { url, gatewayToken, windowToken, sendBrokerToken } = await startLocalServices(identity);
    gatewayService = { url, gatewayToken, windowToken, sendBrokerToken };
    allowedOrigin = new URL(url).origin;
    installGatewayAuthentication(allowedOrigin, gatewayToken, windowToken);
    await mainWindow.loadURL(url);
    saveSessionToken(token);
    startConversationBacktestIfRequested({ url, gatewayToken, windowToken });
    return identity;
  } catch (error) {
    try { await stopLocalServices(); } catch { /* the original startup error remains authoritative */ }
    try { controlPlane.logout(token); } catch {}
    desktopSessionToken = null;
    currentIdentitySession = null;
    clearSavedSessionToken();
    throw error;
  }
}

function startConversationBacktestIfRequested({ url, gatewayToken, windowToken }) {
  if (String(process.env.MYCROBO_RUN_CONVERSATION_BACKTEST || "").toLowerCase() !== "true") return;
  const tenantAuditDir = join(userTenantDirectory(controlPlane.requireSession(desktopSessionToken)), "diagnostics");
  mkdirSync(tenantAuditDir, { recursive: true, mode: 0o700 });
  const reportPath = String(process.env.MYCROBO_BACKTEST_REPORT || join(tenantAuditDir, "conversation-backtest.json"));
  const audit = spawn(process.execPath, ["--experimental-strip-types", join(applicationRoot, "scripts", "backtest-cloning.mjs")], {
    env: restrictedChildEnvironment({
      ELECTRON_RUN_AS_NODE: "1",
      NODE_PATH: process.env.NODE_PATH || "",
      MYCROBO_BACKTEST_GATEWAY_URL: url.replace(/\/$/u, ""),
      MYCROBO_BACKTEST_GATEWAY_TOKEN: gatewayToken,
      MYCROBO_BACKTEST_WINDOW_TOKEN: windowToken,
      MYCROBO_BACKTEST_REPORT: reportPath,
      MYCROBO_BACKTEST_CHECKPOINT: process.env.MYCROBO_BACKTEST_CHECKPOINT || `${reportPath}.checkpoint.json`,
      MYCROBO_BACKTEST_RESUME: process.env.MYCROBO_BACKTEST_RESUME || "true",
      MYCROBO_BACKTEST_PARTITION: process.env.MYCROBO_BACKTEST_PARTITION || "evaluation",
      MYCROBO_BACKTEST_SELECTION_SEED: process.env.MYCROBO_BACKTEST_SELECTION_SEED || "",
      MYCROBO_BACKTEST_CASE_OFFSET: process.env.MYCROBO_BACKTEST_CASE_OFFSET || "0",
      MYCROBO_BACKTEST_CHATS: process.env.MYCROBO_BACKTEST_CHATS || "80",
      MYCROBO_BACKTEST_MESSAGES: process.env.MYCROBO_BACKTEST_MESSAGES || "800",
      MYCROBO_BACKTEST_CASES: process.env.MYCROBO_BACKTEST_CASES || "800",
    }),
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true,
  });
  audit.once("exit", (code) => app.exit(Number(code || 0)));
  audit.once("error", () => app.exit(1));
}

function importedTenantRecords() {
  if (!existsSync(join(installationUserData, "tenant-registry.json")) && !existsSync(join(installationUserData, "account-profiles.json"))) return [];
  const registry = loadTenantRegistry(installationUserData);
  return registry.tenants.map((tenant) => ({ id: tenant.id, name: tenant.label, createdAt: tenant.createdAt, legacyRelativePath: tenant.relativePath }));
}

function prepareImportedTenantStorage(records) {
  for (const tenant of records) {
    if (tenant.legacyRelativePath === ".") materializeLegacyTenant(installationUserData, tenant.id);
    else {
      const source = join(installationUserData, ...tenant.legacyRelativePath.split("/"));
      const destination = tenantDirectory(installationUserData, tenant.id);
      if (require("node:path").resolve(source) !== require("node:path").resolve(destination)) {
        throw new Error("A legacy secondary workspace requires an explicit verified migration before administrator enrollment.");
      }
    }
  }
}

function installAuthenticationBroker() {
  const verify = (event) => { if (!authenticationPageAllowed(event)) throw new Error("The authentication request did not come from MyCrobo."); };
  ipcMain.handle("mycrobo:auth-status", async (event) => {
    verify(event);
    const candidate = desktopSessionToken ? controlPlane.sessionFromToken(desktopSessionToken) : null;
    const sessionRecord = platformAdminMode && !candidate?.user?.platformAdmin ? null : candidate;
    return { ...controlPlane.status(), authenticated: Boolean(sessionRecord), session: sessionRecord };
  });
  ipcMain.handle("mycrobo:bootstrap-owner", async (event, input) => {
    verify(event);
    const status = controlPlane.status();
    let created;
    if (status.bootstrapRequired) {
      const imported = importedTenantRecords();
      prepareImportedTenantStorage(imported);
      created = controlPlane.bootstrap({
        email: input?.email,
        displayName: input?.displayName,
        password: input?.password,
        workspaceName: input?.workspaceName || input?.tenantName,
        importedTenants: imported.map(({ id, name }) => ({ id, name })),
      });
    } else {
      created = controlPlane.register({
        email: input?.email,
        displayName: input?.displayName,
        password: input?.password,
        workspaceName: input?.workspaceName || input?.tenantName,
      });
    }
    if (platformAdminMode) await openPlatformAdmin(created.token);
    else await openAuthenticatedWorkspace(created.token);
    return { authenticated: true, session: created.session };
  });
  ipcMain.handle("mycrobo:sign-in", async (event, input) => {
    verify(event);
    const loggedIn = controlPlane.login({ email: input?.email, password: input?.password });
    if (platformAdminMode) await openPlatformAdmin(loggedIn.token);
    else await openAuthenticatedWorkspace(loggedIn.token);
    return { authenticated: true, session: loggedIn.session };
  });
  ipcMain.handle("mycrobo:sign-out", async (event) => {
    verify(event);
    shuttingDown = true;
    try { await stopLocalServices(); }
    catch (error) { shuttingDown = false; throw error; }
    if (desktopSessionToken) controlPlane.logout(desktopSessionToken);
    clearSavedSessionToken();
    await session.defaultSession.clearStorageData();
    app.relaunch({ args: platformAdminMode ? ["--platform-admin"] : [] });
    app.exit(0);
    return { signedOut: true };
  });
}

function installPlatformAdministrationBroker() {
  const verify = (event) => {
    if (!platformAdminPageAllowed(event)) throw new Error("The commercial administration request did not come from the dedicated MyCrobo platform console.");
    controlPlane.requirePlatformAdmin(desktopSessionToken);
  };
  ipcMain.handle("mycrobo:admin-create-tenant", async (event, input) => { verify(event); const tenant = controlPlane.adminCreateTenant(desktopSessionToken, input || {}); tenantDirectory(installationUserData, tenant.id); return tenant; });
  ipcMain.handle("mycrobo:admin-create-user", async (event, input) => { verify(event); return controlPlane.adminCreateUser(desktopSessionToken, input || {}); });
  ipcMain.handle("mycrobo:admin-assign-existing-user", async (event, input) => { verify(event); return controlPlane.adminAssignExistingUser(desktopSessionToken, input || {}); });
  ipcMain.handle("mycrobo:admin-set-membership", async (event, input) => { verify(event); return controlPlane.adminSetMembership(desktopSessionToken, input || {}); });
  ipcMain.handle("mycrobo:platform-dashboard", async (event) => { verify(event); return controlPlane.platformDashboard(desktopSessionToken); });
  ipcMain.handle("mycrobo:platform-create-plan", async (event, input) => { verify(event); return controlPlane.platformCreatePlan(desktopSessionToken, input || {}); });
  ipcMain.handle("mycrobo:platform-update-plan", async (event, input) => { verify(event); return controlPlane.platformUpdatePlan(desktopSessionToken, input || {}); });
  ipcMain.handle("mycrobo:platform-set-plan-status", async (event, input) => { verify(event); return controlPlane.platformSetPlanStatus(desktopSessionToken, input || {}); });
  ipcMain.handle("mycrobo:platform-create-coupon", async (event, input) => { verify(event); return controlPlane.platformCreateCoupon(desktopSessionToken, input || {}); });
  ipcMain.handle("mycrobo:platform-set-coupon-status", async (event, input) => { verify(event); return controlPlane.platformSetCouponStatus(desktopSessionToken, input || {}); });
  ipcMain.handle("mycrobo:platform-assign-plan", async (event, input) => { verify(event); return controlPlane.platformAssignPlan(desktopSessionToken, input || {}); });
  ipcMain.handle("mycrobo:open-product", async (event) => {
    verify(event);
    const child = spawn(process.execPath, detachedAppArguments(), { cwd: applicationRoot, detached: true, windowsHide: false, stdio: "ignore" });
    child.unref();
    return { opened: true };
  });
}

function installPlatformConsoleLauncherBroker() {
  ipcMain.handle("mycrobo:open-platform-admin", async (event) => {
    if (!allowedOrigin || event?.sender !== mainWindow?.webContents || event?.senderFrame !== mainWindow?.webContents?.mainFrame || new URL(event.senderFrame.url).origin !== allowedOrigin) {
      throw new Error("The platform console request did not come from the private MyCrobo product window.");
    }
    controlPlane.requirePlatformAdmin(desktopSessionToken);
    const child = spawn(process.execPath, detachedAppArguments(["--platform-admin"]), { cwd: applicationRoot, detached: true, windowsHide: false, stdio: "ignore" });
    child.unref();
    return { opened: true };
  });
}

async function gatewayJSON(path, input) {
  if (!gatewayService) throw new Error("The private application service is unavailable.");
  const response = await fetch(new URL(path, gatewayService.url), {
    method: "POST",
    headers: {
      authorization: `Bearer ${gatewayService.gatewayToken}`,
      "x-mycrobo-window": gatewayService.windowToken,
      "x-mycrobo-send-broker": gatewayService.sendBrokerToken,
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "The exact send could not be completed.");
  return payload;
}

function installNativeSendBroker() {
  ipcMain.handle("mycrobo:send-exact", async (event, input) => {
    if (!allowedOrigin || new URL(event.senderFrame.url).origin !== allowedOrigin) throw new Error("The send request did not come from the private MyCrobo window.");
    const identity = controlPlane.requireSession(desktopSessionToken);
    if (identity.tenant.id !== currentTenant?.id || identity.tenant.role === "viewer") throw new Error("This login is not authorized to send from the selected workspace.");
    const chatId = String(input?.chatId || "");
    const recipient = String(input?.recipient || "").replace(/\s+/gu, " ").trim().slice(0, 120);
    const body = String(input?.body || "");
    const targetMessageId = String(input?.targetMessageId || "");
    const idempotencyKey = String(input?.idempotencyKey || "");
    if (!chatId || chatId.length > 256 || !recipient || !body.trim() || [...body].length > 800 || !targetMessageId || !/^[a-zA-Z0-9._:-]{16,128}$/u.test(idempotencyKey)) {
      throw new Error("The recipient, complete reply and verified latest message are required.");
    }
    const approval = await gatewayJSON(`/api/v1/chats/${encodeURIComponent(chatId)}/send-approval`, { body, targetMessageId, idempotencyKey });
    const receipt = await gatewayJSON(`/api/v1/chats/${encodeURIComponent(chatId)}/send`, { body, targetMessageId, idempotencyKey, approvalToken: approval.approval_token });
    return { receipt };
  });
}

function installExternalConnectionBroker() {
  ipcMain.handle("mycrobo:open-external", async (event, input) => {
    if (!allowedOrigin || new URL(event.senderFrame.url).origin !== allowedOrigin) throw new Error("The connection request did not come from the private MyCrobo window.");
    const identity = controlPlane.requireSession(desktopSessionToken);
    if (identity.tenant.id !== currentTenant?.id || !["owner", "admin"].includes(identity.tenant.role)) throw new Error("Workspace administrator access is required to connect an account.");
    const url = new URL(String(input?.url || ""));
    if (url.protocol !== "https:" || url.hostname !== "accounts.google.com" || url.pathname !== "/o/oauth2/v2/auth") throw new Error("Only the verified Google authorization page can be opened.");
    await shell.openExternal(url.toString());
    return { opened: true };
  });
}

function installCloudRelayIdentityBroker() {
  const verify = (event) => {
    if (!allowedOrigin || event?.sender !== mainWindow?.webContents || event?.senderFrame !== mainWindow?.webContents?.mainFrame || new URL(event.senderFrame.url).origin !== allowedOrigin) {
      throw new Error("The cloud identity request did not come from the private MyCrobo window.");
    }
    const identity = controlPlane.requireSession(desktopSessionToken);
    if (identity.tenant.id !== currentTenant?.id) throw new Error("The selected workspace changed. Reload MyCrobo before preparing this desktop.");
    return identity;
  };
  ipcMain.handle("mycrobo:relay-status", async (event) => {
    const identity = verify(event);
    return cloudRelayIdentity.status({ tenantData: userTenantDirectory(identity), identity });
  });
  ipcMain.handle("mycrobo:bind-relay", async (event, input) => {
    const identity = verify(event);
    if (!["owner", "admin"].includes(identity.tenant.role)) throw new Error("Workspace administrator access is required to prepare cloud access.");
    return cloudRelayIdentity.bind({
      tenantData: userTenantDirectory(identity),
      identity,
      email: String(input?.email || ""),
      password: String(input?.password || ""),
      cloudTenantId: String(input?.cloudTenantId || ""),
    });
  });
}

function showStartupFailure(message) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  showingStartupFailure = true;
  const safe = String(message).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  void mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html><meta charset="utf-8"><title>MyCrobo could not start</title><style>body{font:16px system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:#f5f8f6;color:#17382c}.card{max-width:560px;padding:32px;border:1px solid #d7e3dc;border-radius:20px;background:white}p{line-height:1.55;color:#607169}</style><div class="card"><h1>MyCrobo could not start</h1><p>${safe}</p><p>No WhatsApp message was sent.</p></div>`)}`);
}

function createWindow() {
  const root = applicationRoot;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 360,
    minHeight: 620,
    backgroundColor: "#f8faf9",
    show: false,
    autoHideMenuBar: true,
    title: "MyCrobo",
    icon: join(root, "apps", "client", "assets", "mycrobo-app-v2.ico"),
    webPreferences: {
      preload: join(root, "desktop", "electron", platformAdminMode ? "platform-admin-preload.cjs" : "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (showingStartupFailure && url.startsWith("data:text/html")) return;
    try {
      if (!allowedOrigin || new URL(url).origin !== allowedOrigin) event.preventDefault();
    } catch {
      event.preventDefault();
    }
  });
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
  });
  return mainWindow;
}

function createSplashWindow() {
  const root = applicationRoot;
  splashWindow = new BrowserWindow({
    width: 520,
    height: 320,
    frame: false,
    resizable: false,
    movable: true,
    show: false,
    alwaysOnTop: true,
    backgroundColor: "#f8f8f5",
    icon: join(root, "apps", "client", "assets", "mycrobo-app-v2.ico"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  });
  splashWindow.setMenuBarVisibility(false);
  splashWindow.once("ready-to-show", () => splashWindow?.show());
  void splashWindow.loadFile(join(root, "desktop", "electron", "splash.html"));
  return splashWindow;
}

const provisioningMode = process.argv.includes("--provision-model-credential-from-stdin")
  || process.argv.includes("--provision-gemini-credential-from-stdin");
const provisioningProvider = process.argv.includes("--provision-gemini-credential-from-stdin") ? "gemini" : "openai";
const removalMode = process.argv.includes("--remove-model-credential");

if (instanceLockAcquired) app.whenReady().then(async () => {
  installationUserData = sharedInstallationUserData;
  protectUserDataDirectory(installationUserData);
  controlPlane = new ControlPlane(installationUserData);
  cloudRelayIdentity = createCloudRelayIdentity({
    configPath: join(applicationRoot, "config", "cloud-closed-pilot.json"),
    safeStorage,
  });
  if (!controlPlane.status().bootstrapRequired) {
    const imported = importedTenantRecords();
    if (imported.length) {
      prepareImportedTenantStorage(imported);
      controlPlane.reconcileImportedTenants(imported.map(({ id, name, createdAt }) => ({ id, name, createdAt })));
    }
  }
  desktopSessionToken = loadSavedSessionToken();
  currentIdentitySession = desktopSessionToken ? controlPlane.sessionFromToken(desktopSessionToken) : null;
  if (!currentIdentitySession && desktopSessionToken) {
    desktopSessionToken = null;
    clearSavedSessionToken();
  }
  if (removalMode) {
    try {
      if (!currentIdentitySession) throw new Error("Sign in to MyCrobo before removing a workspace credential.");
      const tenantData = userTenantDirectory(currentIdentitySession);
      protectUserDataDirectory(tenantData);
      const removed = removeModelCredential(tenantData);
      process.stdout.write(removed ? "MyCrobo model credential removed.\n" : "No MyCrobo model credential was configured.\n");
      app.exit(0);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : "The model credential could not be removed."}\n`);
      app.exit(1);
    }
    return;
  }
  if (provisioningMode) {
    try {
      if (!currentIdentitySession) throw new Error("Sign in to MyCrobo before provisioning a workspace credential.");
      const secret = readFileSync(0, "utf8");
      const tenantData = userTenantDirectory(currentIdentitySession);
      protectUserDataDirectory(tenantData);
      storeModelCredential({ userData: tenantData, safeStorage, secret, provider: provisioningProvider });
      process.stdout.write("MyCrobo model credential stored in Windows-protected storage.\n");
      app.exit(0);
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : "The model credential could not be stored."}\n`);
      app.exit(1);
    }
    return;
  }
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  if (!platformAdminMode) createSplashWindow();
  createWindow();
  installAuthenticationBroker();
  if (platformAdminMode) installPlatformAdministrationBroker();
  else {
    installNativeSendBroker();
    installExternalConnectionBroker();
    installCloudRelayIdentityBroker();
    installTenantBroker();
    installPlatformConsoleLauncherBroker();
  }
  try {
    if (platformAdminMode && currentIdentitySession && !currentIdentitySession.user.platformAdmin) currentIdentitySession = null;
    if (currentIdentitySession) {
      if (platformAdminMode) await openPlatformAdmin(desktopSessionToken);
      else await openAuthenticatedWorkspace(desktopSessionToken);
    } else {
      await mainWindow.loadFile(join(applicationRoot, "desktop", "electron", "login.html"), platformAdminMode ? { query: { platform: "1" } } : undefined);
    }
  } catch (error) {
    if (error?.code === "MYCROBO_VAULT_KEY_UNREADABLE") {
      const query = { recovery: "vault", ...(platformAdminMode ? { platform: "1" } : {}) };
      await mainWindow.loadFile(join(applicationRoot, "desktop", "electron", "login.html"), { query });
      return;
    }
    showStartupFailure(error instanceof Error ? error.message : "Unknown startup error.");
  }
});

app.on("window-all-closed", () => app.quit());
const normalQuit = createConfirmedQuitCoordinator({
  stopServices: stopLocalServices,
  closeControlPlane: () => {
    try { controlPlane?.close(); } catch {}
  },
  completeQuit: () => app.quit(),
  onFailure: (error) => {
    shuttingDown = false;
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
    showStartupFailure(error instanceof Error
      ? `MyCrobo could not confirm that its private services stopped, so it cancelled the quit to protect the workspace. ${error.message}`
      : "MyCrobo could not confirm that its private services stopped, so it cancelled the quit to protect the workspace.");
  },
});
app.on("before-quit", (event) => {
  shuttingDown = true;
  clearInterval(runtimeStatusTimer);
  void normalQuit.beforeQuit(event);
});
