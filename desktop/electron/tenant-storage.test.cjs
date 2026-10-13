const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { legacyArtifacts, materializeLegacyTenant, tenantDirectory } = require("./tenant-storage.cjs");

test("legacy tenant materialization copies only an allowlist into a disjoint directory", () => {
  const root = mkdtempSync(join(tmpdir(), "mycrobo-tenant-storage-"));
  writeFileSync(join(root, "messages.db"), "messages");
  writeFileSync(join(root, "linked-device.db"), "session");
  writeFileSync(join(root, "user-state.json"), "state");
  writeFileSync(join(root, "tenant-registry.json"), "global");
  mkdirSync(join(root, "tenants", "tenant-0000000000000002"), { recursive: true });
  writeFileSync(join(root, "tenants", "tenant-0000000000000002", "messages.db"), "other");
  const items = legacyArtifacts(root).map((item) => item.relativePath);
  assert.deepEqual(items, ["linked-device.db", "messages.db", "user-state.json"]);
  const result = materializeLegacyTenant(root, "tenant-0000000000000001");
  assert.equal(readFileSync(join(result.directory, "messages.db"), "utf8"), "messages");
  assert.equal(existsSync(join(result.directory, "tenant-registry.json")), false);
  assert.equal(readFileSync(join(root, "messages.db"), "utf8"), "messages");
  assert.match(readFileSync(result.journal, "utf8"), /verified-copy/u);
  writeFileSync(join(result.directory, "messages.db"), "messages that legitimately grew after import");
  const reopened = materializeLegacyTenant(root, "tenant-0000000000000001");
  assert.equal(reopened.reused, true);
  assert.equal(readFileSync(join(result.directory, "messages.db"), "utf8"), "messages that legitimately grew after import");
});

test("an interrupted migration adopts an evolved workspace only when its protected vault identity matches", () => {
  const root = mkdtempSync(join(tmpdir(), "mycrobo-tenant-storage-"));
  writeFileSync(join(root, "vault-key.bin"), "protected-vault-identity");
  writeFileSync(join(root, "messages.db"), "old messages");
  const destination = tenantDirectory(root, "tenant-0000000000000001");
  writeFileSync(join(destination, "vault-key.bin"), "protected-vault-identity");
  writeFileSync(join(destination, "messages.db"), "new messages after import");
  writeFileSync(join(root, "tenant-migration-tenant-0000000000000001.json"), JSON.stringify({ schema: "mycrobo-tenant-migration.1", tenantId: "tenant-0000000000000001", state: "copying", artifacts: [] }));
  const result = materializeLegacyTenant(root, "tenant-0000000000000001");
  assert.equal(result.reused, true);
  assert.equal(readFileSync(join(destination, "messages.db"), "utf8"), "new messages after import");
  assert.match(readFileSync(result.journal, "utf8"), /adopted-existing/u);
});

test("tenant paths reject traversal and conflicting migration copies", () => {
  const root = mkdtempSync(join(tmpdir(), "mycrobo-tenant-storage-"));
  assert.throws(() => tenantDirectory(root, "../outside"), /identifier/u);
  writeFileSync(join(root, "messages.db"), "one");
  const destination = tenantDirectory(root, "tenant-0000000000000001");
  writeFileSync(join(destination, "messages.db"), "two");
  assert.throws(() => materializeLegacyTenant(root, "tenant-0000000000000001"), /conflicts/u);
});
