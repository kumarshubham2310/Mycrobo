const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { mkdtempSync, readFileSync, readdirSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");
const {
  acquireTenantRuntimeLease,
  createConfirmedQuitCoordinator,
  createServiceHealthMonitor,
  processIsAlive,
  releaseTenantRuntimeLease,
  stopChildAndWait,
} = require("./runtime-lifecycle.cjs");

test("normal quit awaits one confirmed service shutdown before allowing the final quit", async () => {
  let releaseStop;
  let stops = 0;
  let closes = 0;
  let quits = 0;
  let firstPrevented = 0;
  let duplicatePrevented = 0;
  let finalPrevented = 0;
  let coordinator;
  coordinator = createConfirmedQuitCoordinator({
    stopServices: () => new Promise((resolve) => { stops += 1; releaseStop = resolve; }),
    closeControlPlane: () => { closes += 1; },
    completeQuit: () => {
      quits += 1;
      coordinator.beforeQuit({ preventDefault: () => { finalPrevented += 1; } });
    },
  });

  const first = coordinator.beforeQuit({ preventDefault: () => { firstPrevented += 1; } });
  const duplicate = coordinator.beforeQuit({ preventDefault: () => { duplicatePrevented += 1; } });
  assert.strictEqual(duplicate, first);
  assert.equal(stops, 1);
  assert.equal(quits, 0);
  assert.deepEqual(coordinator.snapshot(), { phase: "stopping", pending: true });

  releaseStop();
  assert.deepEqual(await first, { confirmed: true });
  assert.equal(firstPrevented, 1);
  assert.equal(duplicatePrevented, 1);
  assert.equal(finalPrevented, 0);
  assert.equal(stops, 1);
  assert.equal(closes, 1);
  assert.equal(quits, 1);
  assert.deepEqual(coordinator.snapshot(), { phase: "confirmed", pending: false });
});

test("failed confirmed shutdown cancels quit and permits one deliberate retry", async () => {
  const failure = new Error("child did not exit");
  let attempts = 0;
  let failures = 0;
  let quits = 0;
  const coordinator = createConfirmedQuitCoordinator({
    stopServices: async () => {
      attempts += 1;
      if (attempts === 1) throw failure;
    },
    completeQuit: () => { quits += 1; },
    onFailure: (error) => { assert.strictEqual(error, failure); failures += 1; },
  });

  const first = await coordinator.beforeQuit({ preventDefault() {} });
  assert.deepEqual(first, { confirmed: false, error: failure });
  assert.equal(quits, 0);
  assert.equal(failures, 1);
  assert.deepEqual(coordinator.snapshot(), { phase: "idle", pending: false });

  assert.deepEqual(await coordinator.beforeQuit({ preventDefault() {} }), { confirmed: true });
  assert.equal(attempts, 2);
  assert.equal(quits, 1);
});

test("runtime lease rejects a second live owner without touching the first lease", () => {
  const directory = mkdtempSync(join(tmpdir(), "mycrobo-runtime-"));
  const first = acquireTenantRuntimeLease(directory, "tenant-one", { pid: 4101, now: 1_700_000_000_000, kill: () => { const error = new Error("gone"); error.code = "ESRCH"; throw error; } });
  assert.throws(
    () => acquireTenantRuntimeLease(directory, "tenant-one", { pid: 4102, now: 1_700_000_000_100, kill: (pid) => { assert.equal(pid, 4101); } }),
    (error) => error?.code === "MYCROBO_WORKSPACE_ALREADY_RUNNING" && error.ownerPid === 4101,
  );
  assert.equal(JSON.parse(readFileSync(first.path, "utf8")).pid, 4101);
});

test("runtime lease archives a stale record and only its owner can release it", () => {
  const directory = mkdtempSync(join(tmpdir(), "mycrobo-runtime-"));
  const dead = () => { const error = new Error("gone"); error.code = "ESRCH"; throw error; };
  acquireTenantRuntimeLease(directory, "tenant-one", { pid: 4201, now: 1_700_000_000_000, kill: dead });
  const current = acquireTenantRuntimeLease(directory, "tenant-one", { pid: 4202, now: 1_700_000_000_100, kill: dead });
  assert.equal(releaseTenantRuntimeLease({ path: current.path, lease: { ...current.lease, nonce: "wrong" } }), false);
  assert.equal(releaseTenantRuntimeLease(current), true);
  assert.equal(releaseTenantRuntimeLease(current), false);
});

test("process liveness treats permission denial as alive and missing process as dead", () => {
  assert.equal(processIsAlive(44, () => { const error = new Error("denied"); error.code = "EPERM"; throw error; }), true);
  assert.equal(processIsAlive(44, () => { const error = new Error("gone"); error.code = "ESRCH"; throw error; }), false);
  assert.equal(processIsAlive(0), false);
});

test("child shutdown waits for exit before resolving", async () => {
  const child = new EventEmitter();
  child.killed = false;
  child.exitCode = null;
  child.kill = () => {
    child.killed = true;
    setImmediate(() => { child.exitCode = 0; child.emit("exit", 0); });
    return true;
  };
  assert.deepEqual(await stopChildAndWait(child, 1_000), { stopped: true, alreadyStopped: false });
  assert.equal(child.killed, true);
});

test("child shutdown reports an unconfirmed stop instead of allowing a blind relaunch", async () => {
  const child = new EventEmitter();
  child.killed = false;
  child.exitCode = null;
  child.kill = () => { child.killed = true; return true; };
  assert.deepEqual(await stopChildAndWait(child, 100), { stopped: false, timedOut: true });
});

test("repeated simulated crashes archive every stale lease without overlapping owners", () => {
  const directory = mkdtempSync(join(tmpdir(), "mycrobo-runtime-soak-"));
  const dead = () => { const error = new Error("gone"); error.code = "ESRCH"; throw error; };
  let current;
  for (let index = 0; index < 100; index += 1) {
    current = acquireTenantRuntimeLease(directory, "tenant-soak", { pid: 5000 + index, now: 1_700_000_000_000 + index, kill: dead });
    assert.equal(JSON.parse(readFileSync(current.path, "utf8")).pid, 5000 + index);
  }
  assert.equal(readdirSync(directory).filter((name) => name.startsWith("desktop-runtime.lease.json.stale-")).length, 99);
  assert.equal(releaseTenantRuntimeLease(current), true);
});

test("an already-crashed child is treated as stopped without another signal", async () => {
  const child = new EventEmitter();
  child.killed = false;
  child.exitCode = 1;
  child.kill = () => { throw new Error("must not signal an exited process"); };
  assert.deepEqual(await stopChildAndWait(child, 100), { stopped: true, alreadyStopped: true });
});

test("service health monitor ignores one transient miss and recovers after a healthy probe", async () => {
  let recoveries = 0;
  const monitor = createServiceHealthMonitor({ threshold: 2, onUnhealthy: async () => { recoveries += 1; } });
  assert.deepEqual(await monitor.observe(async () => false), { healthy: false, consecutiveFailures: 1, recoveryStarted: false });
  assert.deepEqual(await monitor.observe(async () => true), { healthy: true, consecutiveFailures: 0, recoveryStarted: false });
  assert.equal(recoveries, 0);
});

test("service health monitor triggers one recovery after consecutive failures", async () => {
  let recoveries = 0;
  const monitor = createServiceHealthMonitor({ threshold: 2, onUnhealthy: async () => { recoveries += 1; } });
  await monitor.observe(async () => false);
  assert.deepEqual(await monitor.observe(async () => false), { healthy: false, consecutiveFailures: 2, recoveryStarted: true });
  await monitor.observe(async () => false);
  assert.equal(recoveries, 1);
});

test("service health monitor coalesces overlapping probes", async () => {
  let probes = 0;
  let release;
  const monitor = createServiceHealthMonitor({ threshold: 2 });
  const first = monitor.observe(() => new Promise((resolve) => { probes += 1; release = resolve; }));
  const second = monitor.observe(async () => { probes += 1; return true; });
  release(true);
  assert.deepEqual(await first, { healthy: true, consecutiveFailures: 0, recoveryStarted: false });
  assert.deepEqual(await second, { healthy: true, consecutiveFailures: 0, recoveryStarted: false });
  assert.equal(probes, 1);
});

test("desktop wires the content-free health monitor to a bounded automatic recovery", () => {
  const main = readFileSync(join(__dirname, "main.cjs"), "utf8");
  assert.match(main, /createServiceHealthMonitor\(\{\s*threshold: 2,\s*onUnhealthy: restartUnresponsiveLocalServices/u);
  assert.match(main, /runtimeHealthMonitor\?\.observe\(\(\) => recordConnectorRuntimeStatus/u);
  assert.match(main, /\}, 5_000\);/u);
  assert.match(main, /await stopLocalServices\(\);\s*app\.relaunch/u);
});

test("desktop normal quit uses confirmed shutdown without changing restart and sign-out paths", () => {
  const main = readFileSync(join(__dirname, "main.cjs"), "utf8");
  assert.match(main, /const normalQuit = createConfirmedQuitCoordinator\(\{[\s\S]*?stopServices: stopLocalServices,[\s\S]*?completeQuit: \(\) => app\.quit\(\)/u);
  assert.match(main, /app\.on\("before-quit", \(event\) => \{[\s\S]*?void normalQuit\.beforeQuit\(event\);[\s\S]*?\}\);/u);
  assert.doesNotMatch(main, /app\.on\("before-quit"[\s\S]*?stopChild\(/u);
  assert.match(main, /async function restartUnresponsiveLocalServices\(\)[\s\S]*?await stopLocalServices\(\);[\s\S]*?app\.relaunch/u);
  assert.match(main, /ipcMain\.handle\("mycrobo:sign-out"[\s\S]*?await stopLocalServices\(\);[\s\S]*?app\.relaunch/u);
});
