import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { inspectPreservedProfile } from "../../scripts/verify-live-profile-readiness.mjs";

test("live-profile verifier reads only content-free runtime and file metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycrobo-live-profile-"));
  const tenant = join(root, "tenants", "tenant-secret-id");
  await mkdir(join(tenant, "diagnostics"), { recursive: true });
  await writeFile(join(tenant, "desktop-runtime.lease.json"), JSON.stringify({ pid: 4401, tenantId: "tenant-secret-id" }));
  await writeFile(join(tenant, "messages.vault.db"), "encrypted-message-bytes");
  await writeFile(join(tenant, "linked-device.vault.db"), "encrypted-session-bytes");
  await writeFile(join(tenant, "vault-key.bin"), "protected-key");
  await writeFile(join(tenant, "diagnostics", "runtime-status.json"), JSON.stringify({
    observedAt: "2026-09-13T10:00:00.000Z",
    connected: true,
    connectionState: "current-read-only",
    pairing: { state: "paired" },
    accountVerification: { state: "verified" },
  }));
  const report = await inspectPreservedProfile(root, { nowMs: Date.parse("2026-09-13T10:00:10.000Z"), processAlive: (pid) => pid === 4401 });
  assert.equal(report.gate, "pass");
  assert.equal(report.activeRuntimeCount, 1);
  assert.equal(report.mutationPerformed, false);
  assert.equal(report.messageContentRead, false);
  assert.equal(report.outboundAttempted, false);
  assert.equal(report.tenants[0].sessionDatabasePresent, true);
  assert.equal(report.tenants[0].messageDatabasePresent, true);
  assert.doesNotMatch(JSON.stringify(report), /tenant-secret-id|encrypted-message-bytes|encrypted-session-bytes|protected-key/iu);
});

test("live-profile verifier distinguishes preserved offline data from a verified live connector", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycrobo-offline-profile-"));
  const tenant = join(root, "tenants", "tenant-offline");
  await mkdir(join(tenant, "diagnostics"), { recursive: true });
  await writeFile(join(tenant, "messages.vault.db"), "encrypted");
  await writeFile(join(tenant, "linked-device.vault.db"), "encrypted");
  await writeFile(join(tenant, "diagnostics", "runtime-status.json"), JSON.stringify({ observedAt: "2026-09-12T10:00:00Z", connected: true, connectionState: "current-read-only", pairing: { state: "paired" }, accountVerification: { state: "verified" } }));
  const report = await inspectPreservedProfile(root, { nowMs: Date.parse("2026-09-13T10:00:00Z"), processAlive: () => false });
  assert.equal(report.gate, "blocked");
  assert.equal(report.reasonCode, "NO_LIVE_CONNECTOR_TO_VERIFY");
  assert.equal(report.tenants[0].lastKnownConnected, true);
  assert.equal(report.tenants[0].leaseActive, false);
});

test("live-profile verifier allowlists runtime states instead of echoing diagnostic content", async () => {
  const root = await mkdtemp(join(tmpdir(), "mycrobo-content-free-state-"));
  const tenant = join(root, "tenants", "tenant-private");
  await mkdir(join(tenant, "diagnostics"), { recursive: true });
  await writeFile(join(tenant, "diagnostics", "runtime-status.json"), JSON.stringify({
    observedAt: "2026-09-13T10:00:00Z",
    connected: false,
    connectionState: "private person 919999999999",
    pairing: { state: "private pairing details" },
    accountVerification: { state: "private account details" },
  }));
  const report = await inspectPreservedProfile(root, { nowMs: Date.parse("2026-09-13T10:00:10Z"), processAlive: () => false });
  assert.equal(report.tenants[0].lastKnownConnectionState, "unavailable");
  assert.equal(report.tenants[0].lastKnownPairingState, "unavailable");
  assert.equal(report.tenants[0].lastKnownAccountVerification, "unavailable");
  assert.doesNotMatch(JSON.stringify(report), /private person|919999999999|private pairing|private account/iu);
});
