const { randomBytes } = require("node:crypto");
const { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

function processIsAlive(pid, kill = process.kill) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function readLease(path) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function archiveStaleLease(path, now = Date.now()) {
  if (!existsSync(path)) return null;
  const archived = `${path}.stale-${now}-${randomBytes(4).toString("hex")}.json`;
  renameSync(path, archived);
  return archived;
}

function acquireTenantRuntimeLease(tenantData, tenantId, options = {}) {
  const pid = Number(options.pid || process.pid);
  const now = Number(options.now || Date.now());
  const kill = options.kill || process.kill;
  const path = join(tenantData, "desktop-runtime.lease.json");
  const existing = readLease(path);
  if (existing && Number(existing.pid) !== pid && processIsAlive(Number(existing.pid), kill)) {
    const error = new Error("This workspace is already open in another MyCrobo window. Use that window or close it before trying again.");
    error.code = "MYCROBO_WORKSPACE_ALREADY_RUNNING";
    error.ownerPid = Number(existing.pid);
    throw error;
  }
  if (existsSync(path)) archiveStaleLease(path, now);
  const lease = Object.freeze({
    schema: "mycrobo-desktop-runtime-lease.1",
    tenantId: String(tenantId),
    pid,
    nonce: randomBytes(24).toString("hex"),
    startedAt: new Date(now).toISOString(),
  });
  writeFileSync(path, `${JSON.stringify(lease, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return Object.freeze({ path, lease });
}

function releaseTenantRuntimeLease(runtimeLease) {
  if (!runtimeLease?.path || !runtimeLease?.lease?.nonce) return false;
  const current = readLease(runtimeLease.path);
  if (!current || current.nonce !== runtimeLease.lease.nonce || Number(current.pid) !== Number(runtimeLease.lease.pid)) return false;
  try {
    unlinkSync(runtimeLease.path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function stopChildAndWait(child, timeoutMs = 5_000) {
  if (!child || child.exitCode !== null) return Promise.resolve({ stopped: true, alreadyStopped: true });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish({ stopped: false, timedOut: true }), Math.max(100, timeoutMs));
    child.once?.("exit", () => finish({ stopped: true, alreadyStopped: false }));
    child.once?.("error", () => finish({ stopped: child.exitCode !== null, error: true }));
    try {
      const signalled = child.kill();
      if (signalled === false && child.exitCode !== null) finish({ stopped: true, alreadyStopped: true });
    } catch {
      finish({ stopped: child.exitCode !== null, error: true });
    }
  });
}

function createServiceHealthMonitor({ threshold = 2, onUnhealthy = async () => {} } = {}) {
  const safeThreshold = Math.max(1, Math.min(10, Number(threshold) || 2));
  let consecutiveFailures = 0;
  let observation = null;
  let recoveryStarted = false;
  const observeOnce = async (probe) => {
    let healthy = false;
    try { healthy = await probe() === true; } catch { healthy = false; }
    if (healthy) {
      consecutiveFailures = 0;
      return { healthy: true, consecutiveFailures, recoveryStarted };
    }
    consecutiveFailures += 1;
    if (consecutiveFailures >= safeThreshold && !recoveryStarted) {
      recoveryStarted = true;
      await onUnhealthy();
    }
    return { healthy: false, consecutiveFailures, recoveryStarted };
  };
  return {
    observe(probe) {
      if (observation) return observation;
      observation = observeOnce(probe).finally(() => { observation = null; });
      return observation;
    },
    snapshot() { return { consecutiveFailures, recoveryStarted }; },
  };
}

function createConfirmedQuitCoordinator({ stopServices, closeControlPlane = () => {}, completeQuit, onFailure = () => {} } = {}) {
  if (typeof stopServices !== "function") throw new TypeError("A confirmed service-stop function is required.");
  if (typeof completeQuit !== "function") throw new TypeError("A final quit function is required.");
  let phase = "idle";
  let shutdown = null;

  const beforeQuit = (event) => {
    if (phase === "confirmed") return shutdown;
    event?.preventDefault?.();
    if (shutdown) return shutdown;
    phase = "stopping";
    shutdown = (async () => {
      try {
        await stopServices();
        closeControlPlane();
        phase = "confirmed";
        completeQuit();
        return { confirmed: true };
      } catch (error) {
        phase = "idle";
        shutdown = null;
        onFailure(error);
        return { confirmed: false, error };
      }
    })();
    return shutdown;
  };

  return Object.freeze({
    beforeQuit,
    snapshot: () => Object.freeze({ phase, pending: Boolean(shutdown) && phase === "stopping" }),
  });
}

module.exports = {
  acquireTenantRuntimeLease,
  archiveStaleLease,
  createConfirmedQuitCoordinator,
  createServiceHealthMonitor,
  processIsAlive,
  readLease,
  releaseTenantRuntimeLease,
  stopChildAndWait,
};
