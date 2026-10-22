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
  tenantId = "tenant-0000000000000001";
  userId = "user-000000000000000000000001";
  tenantData = resolve(defaultBase, "web-tenant");
  mkdirSync(tenantData, { recursive: true });

  const keyFile = resolve(tenantData, "db-key.bin");
  if (existsSync(keyFile)) {
    vaultKey = readFileSync(keyFile, "utf8").trim();
    messageDbKeyHex = Buffer.from(vaultKey, "base64").toString("hex");
  } else {
    const rawBytes = randomBytes(32);
    vaultKey = rawBytes.toString("base64");
    messageDbKeyHex = rawBytes.toString("hex");
    writeFileSync(keyFile, vaultKey, { encoding: "utf8" });
  }
}

let bridgeChild = null;
let gatewayChild = null;
let shuttingDown = false;

function cleanShutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (bridgeChild && !bridgeChild.killed) {
    try { bridgeChild.kill(); } catch { }
  }
  if (gatewayChild && !gatewayChild.killed) {
    try { gatewayChild.kill(); } catch { }
  }
}

process.on("SIGINT", () => { cleanShutdown(); process.exit(0); });
process.on("SIGTERM", () => { cleanShutdown(); process.exit(0); });
process.on("exit", cleanShutdown);

let bridgeUrl = null;
let bridgeToken = null;

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

if (existsSync(bridgeExe)) {
  const bridgePort = await freePort();
  bridgeToken = randomBytes(32).toString("hex");

  const bridgeArgs = [
    "-listen", `127.0.0.1:${bridgePort}`,
    "-messages-database", resolve(tenantData, "messages.db"),
    "-session-database", resolve(tenantData, "linked-device.db"),
    "-enable-text-send",
    "-parent-pid", String(process.pid),
  ];

  function wireBridge(child) {
    if (!child) return;
    bridgeChild = child;
    child.stdout?.on("data", (chunk) => {
      const msg = chunk.toString().trim();
      if (msg) console.log(`[Bridge] ${msg}`);
    });
    child.stderr?.on("data", (chunk) => {
      const msg = chunk.toString().trim();
      if (msg) console.log(`[Bridge] ${msg}`);
    });
    child.on("exit", (code) => {
      if (!shuttingDown && code !== 0) {
        console.error(`Live bridge stopped with code ${code}.`);
      }
    });
  }

  console.log(`Starting MyCrobo live WhatsApp bridge on 127.0.0.1:${bridgePort}...`);
  try {
    const directChild = spawn(bridgeExe, bridgeArgs, {
      cwd: root,
      env: {
        ...process.env,
        MYCROBO_BRIDGE_TOKEN: bridgeToken,
        MYCROBO_MESSAGE_DB_KEY: messageDbKeyHex,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    wireBridge(directChild);
    directChild.on("error", (err) => {
      console.warn(`Direct bridge spawn failed (${err.message}). Trying via go run...`);
      try {
        const goBridge = spawn("go", ["run", "./cmd/livebridge", ...bridgeArgs], {
          cwd: resolve(root, "services", "whatsapp-bridge"),
          env: {
            ...process.env,
            MYCROBO_BRIDGE_TOKEN: bridgeToken,
            MYCROBO_MESSAGE_DB_KEY: messageDbKeyHex,
          },
          stdio: ["ignore", "pipe", "pipe"],
        });
        wireBridge(goBridge);
      } catch (e) {
        console.warn(`Go run bridge fallback failed: ${e.message}`);
      }
    });
  } catch (err) {
    console.warn(`Could not spawn bridge executable directly (${err.message}). Trying via go run...`);
    try {
      const goBridge = spawn("go", ["run", "./cmd/livebridge", ...bridgeArgs], {
        cwd: resolve(root, "services", "whatsapp-bridge"),
        env: {
          ...process.env,
          MYCROBO_BRIDGE_TOKEN: bridgeToken,
          MYCROBO_MESSAGE_DB_KEY: messageDbKeyHex,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      wireBridge(goBridge);
    } catch (e) {
      console.warn(`Go run bridge fallback failed: ${e.message}`);
    }
  }

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${bridgePort}/v1/health`, {
        headers: { authorization: `Bearer ${bridgeToken}` },
        signal: AbortSignal.timeout(1_000),
      });
      if (res.ok) {
        bridgeUrl = `http://127.0.0.1:${bridgePort}`;
        console.log("Live WhatsApp bridge is ready!");
        break;
      }
    } catch { }
    await new Promise((r) => setTimeout(r, 150));
  }

  if (!bridgeUrl) {
    console.warn("Live bridge failed to respond in time. Continuing with gateway in fixture mode...");
  }
} else {
  console.warn("Bridge binary not found. Running in fixture demo mode.");
}

const gatewayPort = process.env.MYCROBO_GATEWAY_PORT || "4177";
const gatewayEnv = {
  ...process.env,
  ELECTRON_RUN_AS_NODE: "1",
  MYCROBO_GATEWAY_PORT: gatewayPort,
  MYCROBO_USER_DATA_DIR: tenantData,
  MYCROBO_TENANT_ID: tenantId,
  MYCROBO_AUTH_USER_ID: userId,
  MYCROBO_AUTH_ROLE: "owner",
  MYCROBO_USER_STATE_KEY: vaultKey,
  ...(bridgeUrl ? {
    MYCROBO_BRIDGE_URL: bridgeUrl,
    MYCROBO_BRIDGE_TOKEN: bridgeToken,
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
