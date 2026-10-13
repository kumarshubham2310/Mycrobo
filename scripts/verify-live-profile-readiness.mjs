import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function opaque(value) {
  return createHash("sha256").update(`mycrobo-live-profile-v1\0${String(value || "")}`).digest("hex").slice(0, 16);
}

function runtimeState(value, allowed) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.has(normalized) ? normalized : "unavailable";
}

const CONNECTION_STATES = new Set(["current-read-only", "connecting", "reconnecting", "disconnected", "offline", "blocked", "failed"]);
const PAIRING_STATES = new Set(["paired", "pairing", "unpaired", "qr", "phone-code", "blocked", "failed"]);
const VERIFICATION_STATES = new Set(["verified", "pending", "unverified", "mismatch", "blocked", "failed"]);

async function jsonFile(path) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function fileBytes(path) {
  try { return (await stat(path)).size; } catch { return 0; }
}

export async function inspectPreservedProfile(userDataRoot, options = {}) {
	if (!userDataRoot || !isAbsolute(String(userDataRoot))) throw new Error("An absolute MyCrobo user-data directory is required.");
	const root = resolve(String(userDataRoot));
  const processAlive = options.processAlive || alive;
  const nowMs = Number(options.nowMs || Date.now());
  const tenantsRoot = join(root, "tenants");
  let tenantEntries = [];
  try { tenantEntries = (await readdir(tenantsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()); }
  catch { /* reported as blocked below */ }
  const tenants = [];
  for (const entry of tenantEntries) {
    const directory = join(tenantsRoot, entry.name);
    const names = await readdir(directory).catch(() => []);
    const lease = await jsonFile(join(directory, "desktop-runtime.lease.json"));
    const runtime = await jsonFile(join(directory, "diagnostics", "runtime-status.json"));
    const observedAt = Date.parse(runtime?.observedAt || "");
    const runtimeStatusAgeMs = Number.isFinite(observedAt) ? Math.max(0, nowMs - observedAt) : null;
    const leasePID = Number(lease?.pid || 0);
    const leaseActive = Boolean(lease && processAlive(leasePID));
    const messageBytes = await fileBytes(join(directory, "messages.vault.db")) || await fileBytes(join(directory, "messages.db"));
    const sessionBytes = await fileBytes(join(directory, "linked-device.vault.db")) || await fileBytes(join(directory, "linked-device.db"));
    const lastKnownConnected = runtime?.connected === true && runtime?.connectionState === "current-read-only" && runtime?.accountVerification?.state === "verified";
    let gate = "blocked";
    let reasonCode = "NO_ACTIVE_RUNTIME";
    if (leaseActive && runtimeStatusAgeMs !== null && runtimeStatusAgeMs <= 30_000 && lastKnownConnected) {
      gate = "pass";
      reasonCode = "LIVE_VERIFIED_RUNTIME";
    } else if (leaseActive && runtimeStatusAgeMs !== null && runtimeStatusAgeMs <= 30_000) {
      gate = "blocked";
      reasonCode = "LIVE_RUNTIME_NOT_CURRENT";
    } else if (lease && !leaseActive) {
      gate = "fail";
      reasonCode = "STALE_UNARCHIVED_LEASE";
    }
    tenants.push({
      tenantRef: opaque(entry.name),
      gate,
      reasonCode,
      leasePresent: Boolean(lease),
      leaseActive,
      staleLeaseCount: names.filter((name) => /^desktop-runtime\.lease\.json\.stale-/u.test(name)).length,
      lastRuntimeObservationAt: Number.isFinite(observedAt) ? new Date(observedAt).toISOString() : null,
      runtimeStatusAgeMs,
      lastKnownConnected,
      lastKnownConnectionState: runtimeState(runtime?.connectionState, CONNECTION_STATES),
      lastKnownPairingState: runtimeState(runtime?.pairing?.state, PAIRING_STATES),
      lastKnownAccountVerification: runtimeState(runtime?.accountVerification?.state, VERIFICATION_STATES),
      sessionDatabasePresent: sessionBytes > 0,
      sessionDatabaseBytes: sessionBytes,
      messageDatabasePresent: messageBytes > 0,
      messageDatabaseBytes: messageBytes,
      vaultKeyPresent: (await fileBytes(join(directory, "vault-key.bin"))) > 0,
    });
  }
  const active = tenants.filter((tenant) => tenant.leaseActive);
  return {
    schema: "mycrobo-live-profile-readiness.1",
    generatedAt: new Date(nowMs).toISOString(),
    mutationPerformed: false,
    messageContentRead: false,
    outboundAttempted: false,
    gate: active.some((tenant) => tenant.gate === "pass") ? "pass" : tenants.some((tenant) => tenant.gate === "fail") ? "fail" : "blocked",
    reasonCode: active.some((tenant) => tenant.gate === "pass")
      ? "LIVE_PROFILE_VERIFIED"
      : tenants.some((tenant) => tenant.gate === "fail")
        ? "STALE_UNARCHIVED_LEASE"
        : tenants.length
          ? "NO_LIVE_CONNECTOR_TO_VERIFY"
          : "NO_TENANT_PROFILES_FOUND",
    tenantCount: tenants.length,
    activeRuntimeCount: active.length,
    tenants,
  };
}

export async function readLiveHistoryTruth({ gatewayURL, gatewayToken, windowToken, limit = 50, cursor = 0 }) {
  const base = new URL("/api/v1/diagnostics/history-truth", gatewayURL);
  base.searchParams.set("limit", String(Math.max(1, Math.min(200, Number(limit) || 50))));
  base.searchParams.set("cursor", String(Math.max(0, Number(cursor) || 0)));
  const response = await fetch(base, {
    headers: {
      authorization: `Bearer ${String(gatewayToken || "")}`,
      "x-mycrobo-window": String(windowToken || ""),
    },
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Content-free history truth unavailable (${response.status}).`);
  if (payload?.schema !== "mycrobo-content-free-history-truth.1") throw new Error("Unexpected history-truth schema.");
  return payload;
}

const invoked = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invoked) {
  const root = process.argv[2];
  const report = await inspectPreservedProfile(root);
  if (process.env.MYCROBO_VERIFY_GATEWAY_URL && process.env.MYCROBO_VERIFY_GATEWAY_TOKEN && process.env.MYCROBO_VERIFY_WINDOW_TOKEN) {
    try {
      report.liveHistoryTruth = await readLiveHistoryTruth({
        gatewayURL: process.env.MYCROBO_VERIFY_GATEWAY_URL,
        gatewayToken: process.env.MYCROBO_VERIFY_GATEWAY_TOKEN,
        windowToken: process.env.MYCROBO_VERIFY_WINDOW_TOKEN,
      });
    } catch (error) {
      report.liveHistoryTruth = { gate: "blocked", reasonCode: "LIVE_HISTORY_ENDPOINT_UNAVAILABLE", error: error instanceof Error ? error.message : "unavailable" };
    }
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
