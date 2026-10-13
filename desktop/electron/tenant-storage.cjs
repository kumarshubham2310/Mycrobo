const { createHash, randomBytes } = require("node:crypto");
const { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } = require("node:fs");
const { dirname, join, relative, resolve } = require("node:path");

const TENANT_ID = /^tenant-[a-f0-9]{16}$/u;
const LEGACY_FILE = /^(?:vault-key\.bin|model-provider-key\.bin|user-state\.json|messages(?:\.vault)?\.db(?:-(?:wal|shm))?|linked-device(?:\.vault)?\.db(?:-(?:wal|shm))?|linked-device\.db\.(?:owner|selection)\.json|linked-device\.db\.relink-[A-Z2-7]{16,64}\.db(?:-(?:wal|shm))?)$/u;
const DIAGNOSTIC_FILE = /^operations\.jsonl(?:\.previous)?$/u;

function sha256(file) {
  const digest = createHash("sha256");
  digest.update(readFileSync(file));
  return digest.digest("hex");
}
function assertSafeComponent(path) {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new Error("A tenant storage path is redirected outside MyCrobo.");
}
function tenantDirectory(root, tenantId, { create = true } = {}) {
  if (!TENANT_ID.test(String(tenantId || ""))) throw new Error("The tenant identifier is invalid.");
  const base = resolve(root);
  const tenantsRoot = resolve(base, "tenants");
  const target = resolve(tenantsRoot, tenantId);
  if (relative(base, target).replace(/\\/gu, "/") !== `tenants/${tenantId}`) throw new Error("The tenant storage path escapes MyCrobo.");
  assertSafeComponent(base);
  assertSafeComponent(tenantsRoot);
  assertSafeComponent(target);
  if (create) mkdirSync(target, { recursive: true, mode: 0o700 });
  assertSafeComponent(target);
  return target;
}
function legacyArtifacts(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && LEGACY_FILE.test(entry.name)) files.push({ relativePath: entry.name, source: join(root, entry.name) });
  }
  const diagnostics = join(root, "diagnostics");
  if (existsSync(diagnostics)) {
    assertSafeComponent(diagnostics);
    for (const entry of readdirSync(diagnostics, { withFileTypes: true })) {
      if (entry.isFile() && DIAGNOSTIC_FILE.test(entry.name)) files.push({ relativePath: `diagnostics/${entry.name}`, source: join(diagnostics, entry.name) });
    }
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}
function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  renameSync(temporary, file);
}
function readMigrationJournal(file, tenantId) {
  if (!existsSync(file)) return null;
  try {
    const value = JSON.parse(readFileSync(file, "utf8"));
    if (value?.schema !== "mycrobo-tenant-migration.1" || value?.tenantId !== tenantId) return null;
    return value;
  } catch { return null; }
}
function matchingVaultIdentity(root, destination) {
  const source = join(root, "vault-key.bin");
  const target = join(destination, "vault-key.bin");
  if (!existsSync(source) || !existsSync(target)) return false;
  return lstatSync(source).size === lstatSync(target).size && sha256(source) === sha256(target);
}
function materializeLegacyTenant(root, tenantId) {
  const destination = tenantDirectory(root, tenantId);
  const journal = join(root, `tenant-migration-${tenantId}.json`);
  const previous = readMigrationJournal(journal, tenantId);
  const vaultMatches = matchingVaultIdentity(root, destination);
  if ((previous?.state === "verified-copy" || previous?.state === "adopted-existing") && (!existsSync(join(root, "vault-key.bin")) || vaultMatches)) {
    return { directory: destination, journal, copied: 0, reused: true, artifacts: Array.isArray(previous.artifacts) ? previous.artifacts : [] };
  }
  if (vaultMatches) {
    const artifacts = Array.isArray(previous?.artifacts) ? previous.artifacts : [];
    atomicJson(journal, {
      schema: "mycrobo-tenant-migration.1",
      tenantId,
      destination: `tenants/${tenantId}`,
      state: "adopted-existing",
      reason: "matching-vault-identity",
      artifacts,
    });
    return { directory: destination, journal, copied: 0, reused: true, artifacts };
  }
  const artifacts = legacyArtifacts(root).map((item) => ({ ...item, bytes: lstatSync(item.source).size, sha256: sha256(item.source) }));
  atomicJson(journal, { schema: "mycrobo-tenant-migration.1", tenantId, destination: `tenants/${tenantId}`, state: "copying", artifacts: artifacts.map(({ relativePath, bytes, sha256: digest }) => ({ relativePath, bytes, sha256: digest })) });
  for (const artifact of artifacts) {
    const target = join(destination, ...artifact.relativePath.split("/"));
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    if (existsSync(target)) {
      if (lstatSync(target).size !== artifact.bytes || sha256(target) !== artifact.sha256) throw new Error(`The tenant migration destination conflicts for ${artifact.relativePath}.`);
      continue;
    }
    const temporary = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    copyFileSync(artifact.source, temporary);
    if (lstatSync(temporary).size !== artifact.bytes || sha256(temporary) !== artifact.sha256) throw new Error(`The tenant migration copy could not be verified for ${artifact.relativePath}.`);
    renameSync(temporary, target);
  }
  atomicJson(journal, { schema: "mycrobo-tenant-migration.1", tenantId, destination: `tenants/${tenantId}`, state: "verified-copy", artifacts: artifacts.map(({ relativePath, bytes, sha256: digest }) => ({ relativePath, bytes, sha256: digest })) });
  return { directory: destination, journal, copied: artifacts.length, artifacts: artifacts.map(({ relativePath, bytes, sha256: digest }) => ({ relativePath, bytes, sha256: digest })) };
}

module.exports = { legacyArtifacts, materializeLegacyTenant, tenantDirectory };
