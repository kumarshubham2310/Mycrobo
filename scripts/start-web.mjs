import { spawn, execSync } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync, chmodSync } from "node:fs";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const electronExe = resolve(root, "node_modules", "electron", "dist", isWin ? "electron.exe" : "electron");
const nodeExe = (isWin && existsSync(electronExe)) ? electronExe : process.execPath;
const bridgeExe = resolve(root, "bin", isWin ? "mycrobo-live-bridge.exe" : "mycrobo-live-bridge");

if (!existsSync(nodeExe)) {
  console.error("Node runtime not found. Please install Node.js 22+ LTS.");
  process.exit(1);
}

// Make sure Linux bridge binary is executable if present
if (!isWin && existsSync(bridgeExe)) {
  try { chmodSync(bridgeExe, 0o755); } catch { }
}

function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.unref();
    s.once("error", rej);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
}

// Load environment variables from .env if present
const envFile = resolve(root, ".env");
if (existsSync(envFile)) {
  try {
    const lines = readFileSync(envFile, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let val = (match[2] || "").trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  } catch { }
}

const appDataRoot = process.env.APPDATA || (process.env.HOME ? resolve(process.env.HOME, ".config") : resolve(root, ".data"));

function discoverDesktopTenant() {
  if (!isWin) return null; // Windows desktop profile discovery only on Windows desktop

  const searchBases = [
    resolve(appDataRoot, "Electron"),
    resolve(appDataRoot, "mycrobo-reboot"),
  ];

  for (const base of searchBases) {
    const tenantsDir = resolve(base, "tenants");
    if (!existsSync(tenantsDir)) continue;
    try {
      const candidates = [];
      for (const name of readdirSync(tenantsDir)) {
        if (!/^tenant-[a-f\d]{16}$/u.test(name)) continue;
        const tenantPath = resolve(tenantsDir, name);
        if (!existsSync(resolve(tenantPath, "vault-key.bin"))) continue;
        let dbSize = 0;
        try {
          const dbFile = resolve(tenantPath, "messages.vault.db");
          if (existsSync(dbFile)) dbSize = statSync(dbFile).size;
        } catch { }
        candidates.push({ tenantPath, tenantId: name, base, dbSize });
      }

      candidates.sort((a, b) => b.dbSize - a.dbSize);
      if (candidates.length > 0) {
        const selected = candidates[0];
        const vaultKeyPath = resolve(selected.tenantPath, "vault-key.bin");
        const cpDb = resolve(selected.base, "control-plane.db");
        const tempOut = resolve(root, `scratch_unlock_${Date.now()}.tmp`);
        const tempScript = resolve(root, `scratch_unlock_${Date.now()}.cjs`);

        try {
          writeFileSync(tempScript, `
            const { app, safeStorage } = require("electron");
            const { DatabaseSync } = require("node:sqlite");
            const { readFileSync, writeFileSync } = require("node:fs");

            app.whenReady().then(() => {
              try {
                const vaultKey = safeStorage.decryptString(readFileSync(${JSON.stringify(vaultKeyPath)}));
                let userId = "";
                try {
                  const db = new DatabaseSync(${JSON.stringify(cpDb)}, { open: true, readOnly: true });
                  const row = db.prepare("SELECT user_id FROM memberships WHERE tenant_id = ? LIMIT 1").get(${JSON.stringify(selected.tenantId)});
                  userId = row?.user_id || "";
                  db.close();
                } catch {}
                writeFileSync(${JSON.stringify(tempOut)}, JSON.stringify({ vaultKey, userId }), "utf8");
              } catch (e) {
                writeFileSync(${JSON.stringify(tempOut)}, JSON.stringify({ error: e.message }), "utf8");
              }
              app.exit(0);
            });
          `, "utf8");

          execSync(`powershell -Command "Start-Process -FilePath '${electronExe}' -ArgumentList '${tempScript}' -Wait"`, { cwd: root });

          if (existsSync(tempOut)) {
            const data = JSON.parse(readFileSync(tempOut, "utf8"));
            if (data.vaultKey && !data.error) {
              const userId = /^user-[a-f\d]{24}$/u.test(data.userId) ? data.userId : `user-${selected.tenantId.slice(7)}00000000`;
              return {
                tenantData: selected.tenantPath,
                tenantId: selected.tenantId,
                userId,
                vaultKey: data.vaultKey,
              };
            }
          }
        } catch (e) {
          console.warn("Could not unlock desktop tenant:", e.message);
        } finally {
          try { unlinkSync(tempScript); } catch { }
          try { unlinkSync(tempOut); } catch { }
        }
      }
    } catch { }
  }
  return null;
}

const activeDesktopTenant = discoverDesktopTenant();

let tenantData;
let tenantId;
let userId;
let vaultKey;
let messageDbKeyHex;

if (activeDesktopTenant) {
  console.log(`Connected to active Desktop WhatsApp workspace: ${activeDesktopTenant.tenantId}`);
  tenantData = activeDesktopTenant.tenantData;
  tenantId = activeDesktopTenant.tenantId;
  userId = activeDesktopTenant.userId;
  vaultKey = activeDesktopTenant.vaultKey;
  messageDbKeyHex = Buffer.from(vaultKey, "base64").toString("hex");
} else {
  console.log("Starting web workspace mode...");
  const defaultBase = resolve(appDataRoot, "mycrobo-reboot");
  let resolvedTenantId = "tenant-0000000000000001";
  let resolvedUserId = "user-000000000000000000000001";
  tenantData = resolve(defaultBase, "web-tenant");
  mkdirSync(tenantData, { recursive: true });

  const ownerJsonPath = resolve(tenantData, "whatsapp-owner.json");
  if (existsSync(ownerJsonPath)) {
    try {
      const ownerData = JSON.parse(readFileSync(ownerJsonPath, "utf8"));
      if (ownerData.tenantId) {
        resolvedTenantId = ownerData.tenantId;
        if (ownerData.userId) resolvedUserId = ownerData.userId;
      }
    } catch {}
  }

  tenantId = resolvedTenantId;
  userId = resolvedUserId;

  const keyFile = resolve(tenantData, "db-key.bin");
  if (existsSync(keyFile)) {
    const raw = readFileSync(keyFile, "utf8").trim();
    if (/^[0-9a-fA-F]{64}$/u.test(raw)) {
      messageDbKeyHex = raw.toLowerCase();
      vaultKey = Buffer.from(raw, "hex").toString("base64");
    } else {
      const buf = Buffer.from(raw, "base64");
      if (buf.length === 32) {
        vaultKey = raw;
        messageDbKeyHex = buf.toString("hex");
      } else {
        const fresh = randomBytes(32);
        vaultKey = fresh.toString("base64");
        messageDbKeyHex = fresh.toString("hex");
        writeFileSync(keyFile, vaultKey, "utf8");
      }
    }
  } else {
    const rawBytes = randomBytes(32);
    vaultKey = rawBytes.toString("base64");
    messageDbKeyHex = rawBytes.toString("hex");
    writeFileSync(keyFile, vaultKey, { encoding: "utf8" });
  }
}

// ─── Per-Tenant Bridge Manager ───────────────────────────────────────────────
// Each tenant gets its own bridge process with isolated session & message DBs.
// The gateway spawns bridges on-demand when a tenant first requests pairing.
// ─────────────────────────────────────────────────────────────────────────────

const bridgeChildren = new Map(); // tenantId → { child, port, token, tenantDataDir }
let gatewayChild = null;
let shuttingDown = false;

function cleanShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const [tid, entry] of bridgeChildren) {
    if (entry.child && !entry.child.killed) {
      try { entry.child.kill(); } catch { }
    }
  }
  if (gatewayChild && !gatewayChild.killed) {
    try { gatewayChild.kill(); } catch { }
  }
}

process.on("SIGINT", () => { cleanShutdown(); process.exit(0); });
process.on("SIGTERM", () => { cleanShutdown(); process.exit(0); });
process.on("exit", cleanShutdown);

if (!existsSync(bridgeExe)) {
  console.log("Bridge executable not found. Attempting to build...");
  try {
    const buildScript = resolve(root, "scripts", "build-live-bridge.mjs");
    if (existsSync(buildScript)) {
      execSync(`"${process.execPath}" "${buildScript}"`, { cwd: root, stdio: "inherit" });
      if (!isWin && existsSync(bridgeExe)) {
        try { chmodSync(bridgeExe, 0o755); } catch { }
      }
    }
  } catch (err) {
    console.warn("Could not build live bridge automatically:", err.message);
  }
}

function resolveGoBinary() {
  const candidates = [
    "go",
    "/usr/local/go/bin/go",
    "/usr/bin/go",
    "/snap/bin/go",
    process.env.GOROOT ? resolve(process.env.GOROOT, "bin", "go") : null,
    process.env.HOME ? resolve(process.env.HOME, "go", "bin", "go") : null,
  ].filter(Boolean);
  for (const cand of candidates) {
    if (cand === "go") continue;
    if (existsSync(cand)) return cand;
  }
  return "go";
}

// Spawn a bridge for the default tenant (backward compatible)
async function spawnBridgeForTenant(tid, tData, dbKeyHex) {
  if (bridgeChildren.has(tid)) return bridgeChildren.get(tid);

  const tDir = tData || resolve(appDataRoot, "mycrobo-reboot", `tenant-data-${tid}`);
  mkdirSync(tDir, { recursive: true });

  // Ensure per-tenant DB key
  let tenantDbKeyHex = dbKeyHex;
  if (!tenantDbKeyHex) {
    const keyFile = resolve(tDir, "db-key.bin");
    if (existsSync(keyFile)) {
      const raw = readFileSync(keyFile, "utf8").trim();
      if (/^[0-9a-fA-F]{64}$/u.test(raw)) {
        tenantDbKeyHex = raw.toLowerCase();
      } else {
        const buf = Buffer.from(raw, "base64");
        if (buf.length === 32) {
          tenantDbKeyHex = buf.toString("hex");
        }
      }
    }
    if (!tenantDbKeyHex) {
      const freshKey = randomBytes(32);
      tenantDbKeyHex = freshKey.toString("hex");
      writeFileSync(resolve(tDir, "db-key.bin"), freshKey.toString("base64"), "utf8");
    }
  }

  const bridgePort = await freePort();
  const bridgeToken = randomBytes(32).toString("hex");

  const bridgeArgs = [
    "-listen", `127.0.0.1:${bridgePort}`,
    "-api-token", bridgeToken,
    "-messages-database", resolve(tDir, "messages.db"),
    "-session-database", resolve(tDir, "linked-device.db"),
    "-enable-text-send",
    "-parent-pid", String(process.pid),
  ];

  const extraPaths = ["/usr/local/go/bin", "/usr/local/bin", "/usr/bin", "/bin", "/snap/bin"];
  const currentPath = process.env.PATH || "";
  const mergedPath = [...new Set([...extraPaths, ...currentPath.split(process.platform === "win32" ? ";" : ":")])].filter(Boolean).join(process.platform === "win32" ? ";" : ":");

  const bridgeEnv = {
    ...process.env,
    PATH: mergedPath,
    MYCROBO_BRIDGE_TOKEN: bridgeToken,
    MYCROBO_MESSAGE_DB_KEY: tenantDbKeyHex,
    MYCROBO_AUTO_REBIND_ACCOUNT: "true",
  };

  if (!isWin && existsSync(bridgeExe)) {
    try { chmodSync(bridgeExe, 0o755); } catch { }
  }

  console.log(`[BridgeManager] Spawning bridge for tenant ${tid} on 127.0.0.1:${bridgePort}...`);

  const label = tid.slice(0, 12);
  let child = null;
  let spawnFailed = false;

  const attachOutput = (c, name) => {
    c.stdout?.on("data", (chunk) => {
      const msg = chunk.toString().trim();
      if (msg) console.log(`[Bridge:${label}:${name}] ${msg}`);
    });
    c.stderr?.on("data", (chunk) => {
      const msg = chunk.toString().trim();
      if (msg) console.warn(`[Bridge:${label}:${name}:err] ${msg}`);
    });
  };

  if (existsSync(bridgeExe)) {
    try {
      child = spawn(bridgeExe, bridgeArgs, {
        cwd: root,
        env: bridgeEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      attachOutput(child, "bin");
      child.on("error", (err) => {
        console.warn(`[Bridge:${label}] Executable error: ${err.message}`);
        spawnFailed = true;
      });
    } catch (err) {
      console.warn(`[Bridge:${label}] spawn failed: ${err.message}`);
      spawnFailed = true;
    }
  } else {
    spawnFailed = true;
  }

  // Check if binary exited immediately
  if (child) {
    await new Promise((r) => setTimeout(r, 600));
    if (child.exitCode !== null || spawnFailed) {
      console.warn(`[Bridge:${label}] Binary stopped (exit ${child.exitCode}); falling back to go run ./cmd/livebridge...`);
      try { child.kill(); } catch { }
      child = null;
      spawnFailed = true;
    }
  }

  // Fallback to go run
  if (!child || spawnFailed) {
    try {
      const goBin = resolveGoBinary();
      console.log(`[Bridge:${label}] Spawning via '${goBin} run ./cmd/livebridge'...`);
      child = spawn(goBin, ["run", "./cmd/livebridge", ...bridgeArgs], {
        cwd: resolve(root, "services", "whatsapp-bridge"),
        env: bridgeEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.on("error", (err) => {
        console.error(`[Bridge:${label}] Go run process error: ${err.message}`);
      });
    } catch (e) {
      console.warn(`[Bridge:${label}] Go run fallback failed: ${e.message}`);
      return null;
    }
  }

  if (!child) return null;

  child.stdout?.on("data", (chunk) => {
    const msg = chunk.toString().trim();
    if (msg) console.log(`[Bridge:${tid.slice(0, 12)}] ${msg}`);
  });
  child.stderr?.on("data", (chunk) => {
    const msg = chunk.toString().trim();
    if (msg) console.log(`[Bridge:${tid.slice(0, 12)}] ${msg}`);
  });
  child.on("exit", (code) => {
    bridgeChildren.delete(tid);
    if (!shuttingDown && code !== 0) {
      console.error(`[BridgeManager] Bridge for tenant ${tid} stopped with code ${code}.`);
    }
  });

  // Wait for health check
  const deadline = Date.now() + 45_000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${bridgePort}/v1/health`, {
        headers: { authorization: `Bearer ${bridgeToken}` },
        signal: AbortSignal.timeout(1_000),
      });
      if (res.ok) {
        ready = true;
        break;
      }
    } catch { }
    await new Promise((r) => setTimeout(r, 150));
  }

  if (!ready) {
    console.warn(`[BridgeManager] Bridge for tenant ${tid} failed to respond in time.`);
    try { child.kill(); } catch { }
    return null;
  }

  const entry = {
    child,
    port: bridgePort,
    token: bridgeToken,
    url: `http://127.0.0.1:${bridgePort}`,
    tenantDataDir: tDir,
    tenantDbKeyHex,
  };
  bridgeChildren.set(tid, entry);
  console.log(`[BridgeManager] Bridge for tenant ${tid} is ready on port ${bridgePort}`);
  return entry;
}

// Spawn bridge for the default/bootstrap tenant
let defaultBridgeUrl = null;
let defaultBridgeToken = null;

const hasBridgeSource = existsSync(bridgeExe) || existsSync(resolve(root, "services", "whatsapp-bridge", "cmd", "livebridge", "main.go"));
if (hasBridgeSource) {
  const defaultEntry = await spawnBridgeForTenant(tenantId, tenantData, messageDbKeyHex);
  if (defaultEntry) {
    defaultBridgeUrl = defaultEntry.url;
    defaultBridgeToken = defaultEntry.token;
  } else {
    console.warn("Default bridge failed to start. Continuing in fixture mode...");
  }
} else {
  console.warn("Bridge binary not found. Running in fixture demo mode.");
}

// Build bridge manager config for the gateway
const bridgeManagerConfig = {
  bridgeExePath: bridgeExe,
  appDataRoot,
  rootDir: root,
  defaultTenantId: tenantId,
  hasBridgeExe: existsSync(bridgeExe) || existsSync(resolve(root, "services", "whatsapp-bridge", "cmd", "livebridge", "main.go")),
  // Active bridges at startup — gateway will manage additional ones dynamically
  activeBridges: {},
};

for (const [tid, entry] of bridgeChildren) {
  bridgeManagerConfig.activeBridges[tid] = {
    url: entry.url,
    token: entry.token,
    tenantDataDir: entry.tenantDataDir,
    pid: entry.child?.pid || null,
  };
}

const gatewayPort = process.env.MYCROBO_GATEWAY_PORT || "4177";
if (!isWin) {
  try {
    execSync(`fuser -k -9 ${gatewayPort}/tcp 2>/dev/null || true`);
  } catch { }
}
const gatewayEnv = {
  ...process.env,
  ELECTRON_RUN_AS_NODE: "1",
  MYCROBO_GATEWAY_PORT: gatewayPort,
  MYCROBO_USER_DATA_DIR: tenantData,
  MYCROBO_TENANT_ID: tenantId,
  MYCROBO_AUTH_USER_ID: userId,
  MYCROBO_AUTH_ROLE: "owner",
  MYCROBO_USER_STATE_KEY: vaultKey,
  // Per-tenant bridge manager config (gateway creates bridge sources on-demand)
  MYCROBO_BRIDGE_MANAGER: JSON.stringify(bridgeManagerConfig),
  // Keep backward compat: default tenant bridge URL/token
  ...(defaultBridgeUrl ? {
    MYCROBO_BRIDGE_URL: defaultBridgeUrl,
    MYCROBO_BRIDGE_TOKEN: defaultBridgeToken,
  } : {}),
  ...(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY ? {
    MYCROBO_MODEL_PROCESSING_CONSENT: "true",
  } : {}),
};

console.log(`Starting MyCrobo Web Gateway on http://localhost:${gatewayPort}...`);
const supportsStripTypes = Number(process.versions.node.split(".")[0]) >= 22;
const gatewayArgs = supportsStripTypes
  ? ["--experimental-strip-types", resolve(root, "services", "gateway", "server.mjs")]
  : [resolve(root, "services", "gateway", "server.mjs")];
gatewayChild = spawn(nodeExe, gatewayArgs, {
  cwd: root,
  stdio: "inherit",
  env: gatewayEnv,
});

gatewayChild.on("exit", (code) => {
  cleanShutdown();
  process.exit(code ?? 0);
});
