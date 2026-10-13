const { randomBytes } = require("node:crypto");
const { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } = require("node:fs");
const { join, relative, resolve } = require("node:path");

const SCHEMA = "mycrobo-tenants.1";
const REGISTRY_FILE = "tenant-registry.json";
const LEGACY_SCHEMA = "mycrobo-account-profiles.1";
const LEGACY_REGISTRY_FILE = "account-profiles.json";
const TENANT_ID = /^tenant-[a-f0-9]{16}$/u;

function cleanLabel(value, fallback) {
  const label = String(value || "").replace(/\s+/gu, " ").trim().slice(0, 48);
  return label || fallback;
}

function newTenantId(existing = new Set()) {
  let id;
  do { id = `tenant-${randomBytes(8).toString("hex")}`; } while (existing.has(id));
  return id;
}

function validateRelativePath(value) {
  const path = String(value || "").replace(/\\/gu, "/");
  if (path === ".") return path;
  if (!/^((profiles\/account-[a-f0-9]{16})|(tenants\/tenant-[a-f0-9]{16}))$/u.test(path)) {
    throw new Error("The saved MyCrobo workspace path is invalid.");
  }
  return path;
}

function validateTenant(tenant, index = 0) {
  if (!tenant || !TENANT_ID.test(String(tenant.id || ""))) throw new Error("The saved MyCrobo tenant identifier is invalid.");
  return {
    id: tenant.id,
    label: cleanLabel(tenant.label, `Workspace ${index + 1}`),
    relativePath: validateRelativePath(tenant.relativePath),
    createdAt: Number.isFinite(Date.parse(String(tenant.createdAt || ""))) ? tenant.createdAt : new Date(0).toISOString(),
  };
}

function registryPath(installationRoot) {
  return join(installationRoot, REGISTRY_FILE);
}

function writeRegistry(installationRoot, registry) {
  const target = registryPath(installationRoot);
  const temporary = join(installationRoot, `${REGISTRY_FILE}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(registry, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  renameSync(temporary, target);
}

function defaultRegistry() {
  const id = newTenantId();
  return {
    schema: SCHEMA,
    activeTenantId: id,
    tenants: [{ id, label: "My workspace", relativePath: ".", createdAt: new Date().toISOString() }],
  };
}

function migrateLegacyRegistry(installationRoot) {
  const legacyPath = join(installationRoot, LEGACY_REGISTRY_FILE);
  if (!existsSync(legacyPath)) return null;
  let legacy;
  try { legacy = JSON.parse(readFileSync(legacyPath, "utf8")); }
  catch { throw new Error("The previous local account registry is damaged. MyCrobo preserved all data and stopped before selecting a workspace."); }
  if (legacy?.schema !== LEGACY_SCHEMA || !Array.isArray(legacy.profiles) || !legacy.profiles.length) {
    throw new Error("The previous local account registry is invalid. MyCrobo preserved all data and stopped before selecting a workspace.");
  }
  const used = new Set();
  const mappings = legacy.profiles.map((profile, index) => {
    const id = newTenantId(used);
    used.add(id);
    const legacyId = String(profile?.id || "");
    const expectedPath = legacyId === "primary" ? "." : `profiles/${legacyId}`;
    if (String(profile?.relativePath || "").replace(/\\/gu, "/") !== expectedPath) {
      throw new Error("A previous account workspace points outside its expected private storage.");
    }
    const legacyLabel = cleanLabel(profile?.label, "");
    const generic = legacyLabel === "Primary WhatsApp" || /^WhatsApp account \d+$/u.test(legacyLabel);
    return {
      legacyId,
      tenant: validateTenant({
        id,
        label: generic ? (index === 0 ? "My workspace" : `Workspace ${index + 1}`) : legacyLabel,
        relativePath: expectedPath,
        createdAt: profile?.createdAt,
      }, index),
    };
  });
  const active = mappings.find((item) => item.legacyId === legacy.activeProfileId) || mappings[0];
  return { schema: SCHEMA, activeTenantId: active.tenant.id, tenants: mappings.map((item) => item.tenant) };
}

function loadTenantRegistry(installationRoot) {
  mkdirSync(installationRoot, { recursive: true, mode: 0o700 });
  const target = registryPath(installationRoot);
  if (!existsSync(target)) {
    const registry = migrateLegacyRegistry(installationRoot) || defaultRegistry();
    writeRegistry(installationRoot, registry);
    return registry;
  }
  let parsed;
  try { parsed = JSON.parse(readFileSync(target, "utf8")); }
  catch { throw new Error("The local tenant registry is damaged. MyCrobo preserved every workspace and stopped before opening the wrong one."); }
  if (parsed?.schema !== SCHEMA || !Array.isArray(parsed.tenants) || !parsed.tenants.length) throw new Error("The local tenant registry is invalid.");
  const tenants = parsed.tenants.map(validateTenant);
  if (new Set(tenants.map((tenant) => tenant.id)).size !== tenants.length) throw new Error("The local tenant registry contains duplicate workspaces.");
  if (new Set(tenants.map((tenant) => tenant.relativePath)).size !== tenants.length) throw new Error("Two tenant workspaces point to the same private storage.");
  if (!tenants.some((tenant) => tenant.id === parsed.activeTenantId)) throw new Error("The selected tenant workspace no longer exists.");
  return { schema: SCHEMA, activeTenantId: parsed.activeTenantId, tenants };
}

function tenantDirectory(installationRoot, tenant) {
  const validated = validateTenant(tenant);
  const target = validated.relativePath === "." ? resolve(installationRoot) : resolve(installationRoot, ...validated.relativePath.split("/"));
  const boundary = relative(resolve(installationRoot), target);
  if (boundary.startsWith("..") || boundary.includes(":") || boundary.startsWith("\\")) throw new Error("The tenant workspace escapes private storage.");
  mkdirSync(target, { recursive: true, mode: 0o700 });
  return target;
}

function activeTenant(installationRoot) {
  const registry = loadTenantRegistry(installationRoot);
  const tenant = registry.tenants.find((item) => item.id === registry.activeTenantId);
  return { registry, tenant, directory: tenantDirectory(installationRoot, tenant) };
}

function publicTenants(installationRoot) {
  const registry = loadTenantRegistry(installationRoot);
  return {
    activeTenantId: registry.activeTenantId,
    tenants: registry.tenants.map(({ id, label, createdAt }) => ({ id, label, createdAt, active: id === registry.activeTenantId })),
  };
}

function createTenant(installationRoot, label = "") {
  const registry = loadTenantRegistry(installationRoot);
  const id = newTenantId(new Set(registry.tenants.map((tenant) => tenant.id)));
  const tenant = validateTenant({
    id,
    label: cleanLabel(label, `Workspace ${registry.tenants.length + 1}`),
    relativePath: `tenants/${id}`,
    createdAt: new Date().toISOString(),
  }, registry.tenants.length);
  tenantDirectory(installationRoot, tenant);
  const next = { ...registry, activeTenantId: id, tenants: [...registry.tenants, tenant] };
  writeRegistry(installationRoot, next);
  return { tenant, registry: next };
}

function selectTenant(installationRoot, tenantId) {
  const id = String(tenantId || "");
  if (!TENANT_ID.test(id)) throw new Error("Choose a valid MyCrobo workspace.");
  const registry = loadTenantRegistry(installationRoot);
  const tenant = registry.tenants.find((item) => item.id === id);
  if (!tenant) throw new Error("That MyCrobo workspace does not exist on this device.");
  const next = { ...registry, activeTenantId: tenant.id };
  writeRegistry(installationRoot, next);
  return { tenant, registry: next };
}

module.exports = {
  SCHEMA,
  activeTenant,
  createTenant,
  loadTenantRegistry,
  publicTenants,
  selectTenant,
  tenantDirectory,
};
