const assert = require("node:assert/strict");
const { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");

const { activeTenant, createTenant, loadTenantRegistry, publicTenants, selectTenant } = require("./tenant-registry.cjs");

test("a new installation creates an equal tenant workspace without primary or secondary roles", () => {
  const root = mkdtempSync(join(tmpdir(), "mycrobo-tenants-"));
  const active = activeTenant(root);
  assert.match(active.tenant.id, /^tenant-[a-f0-9]{16}$/u);
  assert.equal(active.tenant.label, "My workspace");
  assert.equal(active.directory, root);
  const text = readFileSync(join(root, "tenant-registry.json"), "utf8");
  assert.doesNotMatch(text, /primary|secondary/iu);
});

test("the existing account registry migrates without moving data or keeping rank labels", () => {
  const root = mkdtempSync(join(tmpdir(), "mycrobo-tenants-"));
  const originalDatabase = join(root, "messages.vault.db");
  writeFileSync(originalDatabase, "existing-data", "utf8");
  writeFileSync(join(root, "account-profiles.json"), JSON.stringify({
    schema: "mycrobo-account-profiles.1",
    activeProfileId: "primary",
    profiles: [{ id: "primary", label: "Primary WhatsApp", relativePath: ".", createdAt: "2026-01-01T00:00:00.000Z" }],
  }), "utf8");
  const active = activeTenant(root);
  assert.equal(active.directory, root);
  assert.equal(active.tenant.label, "My workspace");
  assert.equal(readFileSync(originalDatabase, "utf8"), "existing-data");
  assert.equal(existsSync(join(root, "account-profiles.json")), true);
});

test("each added tenant receives isolated storage and private settings", () => {
  const root = mkdtempSync(join(tmpdir(), "mycrobo-tenants-"));
  const first = activeTenant(root);
  writeFileSync(join(first.directory, "messages.db"), "tenant-one", "utf8");
  const created = createTenant(root);
  const second = activeTenant(root);
  assert.equal(second.tenant.id, created.tenant.id);
  assert.notEqual(second.directory, first.directory);
  assert.match(second.directory, /tenants[\\/]tenant-/u);
  assert.equal(existsSync(join(second.directory, "messages.db")), false);
  assert.equal(existsSync(join(second.directory, "user-state.json")), false);
  assert.equal(existsSync(join(second.directory, "vault-key.bin")), false);
});

test("switching tenants restores the exact isolated workspace and rejects traversal", () => {
  const root = mkdtempSync(join(tmpdir(), "mycrobo-tenants-"));
  const first = activeTenant(root);
  const second = createTenant(root).tenant;
  selectTenant(root, first.tenant.id);
  assert.equal(activeTenant(root).directory, root);
  selectTenant(root, second.id);
  const listed = publicTenants(root);
  assert.equal(listed.tenants.length, 2);
  assert.equal(listed.tenants.find((tenant) => tenant.active)?.id, second.id);
  assert.throws(() => selectTenant(root, "../../foreign"), /valid/iu);
});

test("duplicate tenant storage paths fail closed", () => {
  const root = mkdtempSync(join(tmpdir(), "mycrobo-tenants-"));
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "tenant-registry.json"), JSON.stringify({
    schema: "mycrobo-tenants.1",
    activeTenantId: "tenant-0000000000000001",
    tenants: [
      { id: "tenant-0000000000000001", label: "One", relativePath: ".", createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "tenant-0000000000000002", label: "Two", relativePath: ".", createdAt: "2026-01-01T00:00:00.000Z" },
    ],
  }), "utf8");
  assert.throws(() => loadTenantRegistry(root), /same private storage/iu);
});
