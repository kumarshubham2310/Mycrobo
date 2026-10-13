import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TenantUsageMeter } from "./usage-meter.mjs";

test("tenant usage is content-free, month-bounded and enforces plan limits", () => {
  let now = new Date("2026-09-12T12:00:00Z");
  const meter = new TenantUsageMeter({ tenantId: "tenant-a", dataDir: mkdtempSync(join(tmpdir(), "usage-")), limits: { monthlyDrafts: 2, monthlyTranslations: 1 }, now: () => now });
  meter.assertAvailable("drafts");
  meter.record("drafts");
  meter.record("drafts");
  assert.throws(() => meter.assertAvailable("drafts"), /monthly drafts limit/u);
  meter.record("translations");
  assert.throws(() => meter.assertAvailable("translations"), /monthly translations limit/u);
  assert.equal(JSON.stringify(meter.snapshot()).includes("message"), false);
  now = new Date("2026-10-01T00:00:00Z");
  assert.equal(meter.snapshot().drafts, 0);
});

test("unassigned plans remain unmetered for backwards-compatible enrollment", () => {
  const meter = new TenantUsageMeter({ tenantId: "tenant-a", dataDir: mkdtempSync(join(tmpdir(), "usage-")), limits: null });
  assert.doesNotThrow(() => meter.assertAvailable("drafts"));
  assert.equal(meter.snapshot().limits.drafts, null);
});

test("a running tenant meter picks up operator plan-limit changes without chat access", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "usage-live-"));
  const limitsPath = join(dataDir, "plan-entitlement.json");
  writeFileSync(limitsPath, JSON.stringify({ assigned: true, limits: { monthlyDrafts: 2, monthlyTranslations: 4 } }));
  const meter = new TenantUsageMeter({ tenantId: "tenant-a", dataDir, limitsPath });
  meter.record("drafts");
  assert.doesNotThrow(() => meter.assertAvailable("drafts"));
  writeFileSync(limitsPath, JSON.stringify({ assigned: true, limits: { monthlyDrafts: 1, monthlyTranslations: 4 } }));
  assert.throws(() => meter.assertAvailable("drafts"), /monthly drafts limit/u);
});
