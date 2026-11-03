const { createHash, randomBytes, scryptSync, timingSafeEqual } = require("node:crypto");
const { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const CONTROL_SCHEMA = "mycrobo-control-plane.1";
const TENANT_ID = /^tenant-[a-f0-9]{16}$/u;
const USER_ID = /^user-[a-f0-9]{24}$/u;
const SESSION_ID = /^session-[a-f0-9]{24}$/u;
const ROLES = new Set(["owner", "admin", "member", "viewer"]);
const USER_STATES = new Set(["active", "disabled"]);
const TENANT_STATES = new Set(["active", "suspended"]);
const SESSION_TTL_MS = 30 * 86_400_000;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
const PLAN_ID = /^plan-[a-f0-9]{16}$/u;
const COUPON_ID = /^coupon-[a-f0-9]{16}$/u;

function nowIso(nowMs = Date.now()) { return new Date(nowMs).toISOString(); }
function opaqueId(prefix, bytes = 12) { return `${prefix}-${randomBytes(bytes).toString("hex")}`; }
function hash(value) { return createHash("sha256").update(String(value || ""), "utf8").digest("hex"); }
function normalizeEmail(value) {
  const email = String(value || "").normalize("NFKC").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]{1,64}@[^\s@]{1,189}\.[^\s@]{2,63}$/u.test(email)) throw new Error("Enter a valid email address.");
  return email;
}
function cleanName(value, label) {
  const name = String(value || "").normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 80);
  if (name.length < 2) throw new Error(`Enter a ${label}.`);
  return name;
}
function validatePassword(value) {
  const password = String(value || "");
  if (password.length < 12 || password.length > 256 || !/[a-z]/u.test(password) || !/[A-Z]/u.test(password) || !/\d/u.test(password)) {
    throw new Error("Use at least 12 characters with an uppercase letter, a lowercase letter and a number.");
  }
  return password;
}
function cleanCode(value, label = "code") {
  const code = String(value || "").normalize("NFKC").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/u.test(code)) throw new Error(`Enter a valid ${label}.`);
  return code;
}
function boundedInteger(value, label, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new Error(`Enter a valid ${label}.`);
  return number;
}
function optionalIso(value, label) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`Enter a valid ${label}.`);
  return parsed.toISOString();
}
function planLimits(value = {}) {
  return {
    seats: boundedInteger(value.seats, "seat limit", 1, 100_000),
    whatsappAccounts: boundedInteger(value.whatsappAccounts, "WhatsApp account limit", 0, 1_000),
    monthlyDrafts: boundedInteger(value.monthlyDrafts, "monthly draft limit", 0, 1_000_000_000),
    monthlyTranslations: boundedInteger(value.monthlyTranslations, "monthly translation limit", 0, 1_000_000_000),
    historyMessages: boundedInteger(value.historyMessages, "history-message limit", 1_000, 1_000_000_000),
    storageMb: boundedInteger(value.storageMb, "storage limit", 100, 1_000_000_000),
  };
}
function publicPlan(row) {
  return {
    id: row.id, code: row.code, name: row.name, description: row.description,
    currency: row.currency, monthlyPriceMinor: Number(row.monthly_price_minor),
    limits: JSON.parse(row.limits_json), status: row.status, createdAt: row.created_at,
  };
}
function passwordDigest(password, salt) {
  return scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
function passwordRecord(password) {
  const salt = randomBytes(16);
  return { salt: salt.toString("base64"), digest: passwordDigest(validatePassword(password), salt).toString("base64") };
}
function passwordMatches(password, saltText, digestText) {
  try {
    const expected = Buffer.from(digestText, "base64");
    const actual = passwordDigest(String(password || ""), Buffer.from(saltText, "base64"));
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch { return false; }
}
function publicUser(row) {
  return { id: row.id, email: row.email, displayName: row.display_name, platformAdmin: row.platform_admin === 1, status: row.status };
}
function publicTenant(row, role = null, selected = false) {
  return { id: row.id, name: row.name, status: row.status, role, selected, createdAt: row.created_at };
}

class ControlPlane {
  constructor(root, { now = () => Date.now() } = {}) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.root = root;
    this.now = now;
    this.databasePath = join(root, "control-plane.db");
    this.db = new DatabaseSync(this.databasePath);
    this.db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL,
        password_salt TEXT NOT NULL, password_digest TEXT NOT NULL, platform_admin INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK(status IN ('active','disabled')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, storage_relative_path TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK(status IN ('active','suspended')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memberships (
        user_id TEXT NOT NULL REFERENCES users(id), tenant_id TEXT NOT NULL REFERENCES tenants(id),
        role TEXT NOT NULL CHECK(role IN ('owner','admin','member','viewer')), status TEXT NOT NULL CHECK(status IN ('active','disabled')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id, tenant_id)
      );
      CREATE TABLE IF NOT EXISTS device_sessions (
        id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL REFERENCES users(id),
        selected_tenant_id TEXT REFERENCES tenants(id), created_at TEXT NOT NULL, last_used_at TEXT NOT NULL,
        expires_at TEXT NOT NULL, revoked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS login_attempts (
        email_hash TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, window_started_at TEXT NOT NULL, locked_until TEXT
      );
      CREATE TABLE IF NOT EXISTS admin_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT, actor_user_id TEXT NOT NULL, tenant_id TEXT,
        action TEXT NOT NULL, target_type TEXT NOT NULL, target_hash TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        currency TEXT NOT NULL, monthly_price_minor INTEGER NOT NULL,
        limits_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','archived')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tenant_subscriptions (
        tenant_id TEXT PRIMARY KEY REFERENCES tenants(id), plan_id TEXT NOT NULL REFERENCES plans(id),
        status TEXT NOT NULL CHECK(status IN ('trialing','active','past_due','cancelled')),
        coupon_id TEXT, started_at TEXT NOT NULL, current_period_end TEXT, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS coupons (
        id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, plan_id TEXT REFERENCES plans(id),
        discount_percent INTEGER NOT NULL, max_redemptions INTEGER NOT NULL,
        redeemed_count INTEGER NOT NULL DEFAULT 0, expires_at TEXT,
        status TEXT NOT NULL CHECK(status IN ('active','disabled','expired')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS coupon_redemptions (
        coupon_id TEXT NOT NULL REFERENCES coupons(id), tenant_id TEXT NOT NULL REFERENCES tenants(id),
        redeemed_at TEXT NOT NULL, actor_user_id TEXT NOT NULL REFERENCES users(id),
        PRIMARY KEY(coupon_id, tenant_id)
      );
      CREATE INDEX IF NOT EXISTS idx_memberships_tenant ON memberships(tenant_id, status);
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON device_sessions(user_id, expires_at);
      CREATE INDEX IF NOT EXISTS idx_subscriptions_plan ON tenant_subscriptions(plan_id, status);
      CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_tenant ON coupon_redemptions(tenant_id);
    `);
    this.db.prepare("INSERT INTO metadata(key,value) VALUES('schema',?) ON CONFLICT(key) DO NOTHING").run(CONTROL_SCHEMA);
    const schema = this.db.prepare("SELECT value FROM metadata WHERE key='schema'").get()?.value;
    if (schema !== CONTROL_SCHEMA) throw new Error("The MyCrobo control database has an unsupported schema.");
  }

  close() { this.db.close(); }
  status() {
    const users = Number(this.db.prepare("SELECT COUNT(*) AS count FROM users").get().count);
    return { schema: CONTROL_SCHEMA, bootstrapRequired: users === 0, databasePath: this.databasePath };
  }
  transaction(work) {
    this.db.exec("BEGIN IMMEDIATE");
    try { const value = work(); this.db.exec("COMMIT"); return value; }
    catch (error) { try { this.db.exec("ROLLBACK"); } catch {} throw error; }
  }
  audit(actorUserId, action, targetType, targetId, tenantId = null) {
    this.db.prepare("INSERT INTO admin_audit(actor_user_id,tenant_id,action,target_type,target_hash,created_at) VALUES(?,?,?,?,?,?)")
      .run(actorUserId, tenantId, action, targetType, hash(targetId), nowIso(this.now()));
  }
  bootstrap({ email, displayName, password, workspaceName, importedTenants = [] }) {
    if (!this.status().bootstrapRequired) throw new Error("MyCrobo administration is already configured.");
    const normalizedEmail = normalizeEmail(email);
    const name = cleanName(displayName, "name");
    const passwordData = passwordRecord(password);
    const userId = opaqueId("user");
    const createdAt = nowIso(this.now());
    const imports = (Array.isArray(importedTenants) ? importedTenants : []).map((item) => ({
      id: TENANT_ID.test(String(item?.id || "")) ? item.id : opaqueId("tenant", 8),
      name: cleanName(item?.name || workspaceName || "My workspace", "workspace name"),
    }));
    const tenants = imports.length ? imports : [{ id: opaqueId("tenant", 8), name: cleanName(workspaceName || "My workspace", "workspace name") }];
    if (new Set(tenants.map((item) => item.id)).size !== tenants.length) throw new Error("Imported tenant identities are duplicated.");
    this.transaction(() => {
      this.db.prepare("INSERT INTO users(id,email,display_name,password_salt,password_digest,platform_admin,status,created_at,updated_at) VALUES(?,?,?,?,?,1,'active',?,?)")
        .run(userId, normalizedEmail, name, passwordData.salt, passwordData.digest, createdAt, createdAt);
      for (const tenant of tenants) {
        const path = `tenants/${tenant.id}`;
        this.db.prepare("INSERT INTO tenants(id,name,storage_relative_path,status,created_at,updated_at) VALUES(?,?,?,'active',?,?)")
          .run(tenant.id, tenant.name, path, createdAt, createdAt);
        this.db.prepare("INSERT INTO memberships(user_id,tenant_id,role,status,created_at,updated_at) VALUES(?,?,'owner','active',?,?)")
          .run(userId, tenant.id, createdAt, createdAt);
      }
      this.audit(userId, "control-plane.bootstrap", "user", userId, tenants[0].id);
    });
    return this.createSessionForUser(userId, tenants[0].id);
  }
  register({ email, displayName, password, workspaceName }) {
    if (this.status().bootstrapRequired) {
      return this.bootstrap({ email, displayName, password, workspaceName });
    }
    const normalizedEmail = normalizeEmail(email);
    const existing = this.db.prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE").get(normalizedEmail);
    if (existing) throw new Error("An account with this email already exists. Sign in instead.");
    const name = cleanName(displayName, "name");
    const passwordData = passwordRecord(password);
    const userId = opaqueId("user");
    const tenantId = opaqueId("tenant", 8);
    const tenantTitle = cleanName(workspaceName || (name ? `${name}'s workspace` : "My workspace"), "workspace name");
    const createdAt = nowIso(this.now());
    const path = `tenants/${tenantId}`;
    this.transaction(() => {
      this.db.prepare("INSERT INTO users(id,email,display_name,password_salt,password_digest,platform_admin,status,created_at,updated_at) VALUES(?,?,?,?,?,0,'active',?,?)")
        .run(userId, normalizedEmail, name, passwordData.salt, passwordData.digest, createdAt, createdAt);
      this.db.prepare("INSERT INTO tenants(id,name,storage_relative_path,status,created_at,updated_at) VALUES(?,?,?,'active',?,?)")
        .run(tenantId, tenantTitle, path, createdAt, createdAt);
      this.db.prepare("INSERT INTO memberships(user_id,tenant_id,role,status,created_at,updated_at) VALUES(?,?,'owner','active',?,?)")
        .run(userId, tenantId, createdAt, createdAt);
      this.audit(userId, "user.register", "user", userId, tenantId);
    });
    return this.createSessionForUser(userId, tenantId);
  }
  reconcileImportedTenants(importedTenants = []) {
    const imports = (Array.isArray(importedTenants) ? importedTenants : []).map((item) => ({
      id: TENANT_ID.test(String(item?.id || "")) ? item.id : "",
      name: cleanName(item?.name || "My workspace", "workspace name"),
      createdAt: Number.isFinite(Date.parse(String(item?.createdAt || ""))) ? new Date(item.createdAt).toISOString() : nowIso(this.now()),
    }));
    if (!imports.length) return { imported: 0, membershipsAdded: 0 };
    if (imports.some((item) => !item.id) || new Set(imports.map((item) => item.id)).size !== imports.length) {
      throw new Error("The legacy workspace registry is invalid.");
    }
    const administrators = this.db.prepare("SELECT id FROM users WHERE platform_admin=1 AND status='active' ORDER BY created_at,id").all();
    if (administrators.length !== 1) {
      throw new Error("Legacy workspaces require exactly one active platform owner for automatic local migration.");
    }
    const ownerId = administrators[0].id;
    let imported = 0;
    let membershipsAdded = 0;
    this.transaction(() => {
      for (const tenant of imports) {
        const existing = this.db.prepare("SELECT id FROM tenants WHERE id=?").get(tenant.id);
        if (!existing) {
          this.db.prepare("INSERT INTO tenants(id,name,storage_relative_path,status,created_at,updated_at) VALUES(?,?,?,'active',?,?)")
            .run(tenant.id, tenant.name, `tenants/${tenant.id}`, tenant.createdAt, tenant.createdAt);
          imported += 1;
        }
        const membership = this.db.prepare("SELECT status FROM memberships WHERE user_id=? AND tenant_id=?").get(ownerId, tenant.id);
        if (!membership) {
          this.db.prepare("INSERT INTO memberships(user_id,tenant_id,role,status,created_at,updated_at) VALUES(?,?,'owner','active',?,?)")
            .run(ownerId, tenant.id, tenant.createdAt, tenant.createdAt);
          membershipsAdded += 1;
        }
        if (!existing || !membership) this.audit(ownerId, "control-plane.import-legacy-tenant", "tenant", tenant.id, tenant.id);
      }
    });
    return { imported, membershipsAdded };
  }
  failedLogin(email) {
    const key = hash(email);
    const now = this.now();
    const row = this.db.prepare("SELECT * FROM login_attempts WHERE email_hash=?").get(key);
    const started = row ? Date.parse(row.window_started_at) : 0;
    const failures = !row || now - started > LOCK_MS ? 1 : Number(row.failures) + 1;
    const lockedUntil = failures >= MAX_FAILURES ? nowIso(now + LOCK_MS) : null;
    this.db.prepare("INSERT INTO login_attempts(email_hash,failures,window_started_at,locked_until) VALUES(?,?,?,?) ON CONFLICT(email_hash) DO UPDATE SET failures=excluded.failures,window_started_at=excluded.window_started_at,locked_until=excluded.locked_until")
      .run(key, failures, !row || now - started > LOCK_MS ? nowIso(now) : row.window_started_at, lockedUntil);
  }
  clearLoginFailures(email) { this.db.prepare("DELETE FROM login_attempts WHERE email_hash=?").run(hash(email)); }
  login({ email, password }) {
    const normalizedEmail = normalizeEmail(email);
    const attempt = this.db.prepare("SELECT * FROM login_attempts WHERE email_hash=?").get(hash(normalizedEmail));
    if (attempt?.locked_until && Date.parse(attempt.locked_until) > this.now()) throw new Error("Too many attempts. Try again in 15 minutes.");
    const user = this.db.prepare("SELECT * FROM users WHERE email=? COLLATE NOCASE").get(normalizedEmail);
    if (!user || user.status !== "active" || !passwordMatches(password, user.password_salt, user.password_digest)) {
      this.failedLogin(normalizedEmail);
      throw new Error("Email or password is incorrect.");
    }
    this.clearLoginFailures(normalizedEmail);
    const tenant = this.db.prepare("SELECT t.id FROM tenants t JOIN memberships m ON m.tenant_id=t.id WHERE m.user_id=? AND m.status='active' AND t.status='active' ORDER BY m.created_at,t.created_at LIMIT 1").get(user.id);
    if (!tenant) throw new Error("This account has no active MyCrobo workspace.");
    return this.createSessionForUser(user.id, tenant.id);
  }
  createSessionForUser(userId, tenantId) {
    const token = randomBytes(32).toString("base64url");
    const sessionId = opaqueId("session");
    const created = this.now();
    this.db.prepare("INSERT INTO device_sessions(id,token_hash,user_id,selected_tenant_id,created_at,last_used_at,expires_at) VALUES(?,?,?,?,?,?,?)")
      .run(sessionId, hash(token), userId, tenantId, nowIso(created), nowIso(created), nowIso(created + SESSION_TTL_MS));
    return { token, session: this.sessionFromToken(token) };
  }
  sessionFromToken(token) {
    const row = this.db.prepare("SELECT s.*,u.email,u.display_name,u.platform_admin,u.status AS user_status FROM device_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?").get(hash(token));
    if (!row || row.revoked_at || Date.parse(row.expires_at) <= this.now() || row.user_status !== "active") return null;
    const membership = this.db.prepare("SELECT m.role,m.status AS membership_status,t.* FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=? AND m.tenant_id=?").get(row.user_id, row.selected_tenant_id);
    if (!membership || membership.membership_status !== "active" || membership.status !== "active") return null;
    this.db.prepare("UPDATE device_sessions SET last_used_at=? WHERE id=?").run(nowIso(this.now()), row.id);
    return {
      id: row.id,
      user: { id: row.user_id, email: row.email, displayName: row.display_name, platformAdmin: row.platform_admin === 1, status: row.user_status },
      tenant: publicTenant(membership, membership.role, true),
      expiresAt: row.expires_at,
    };
  }
  requireSession(token) {
    const session = this.sessionFromToken(token);
    if (!session) throw new Error("Sign in to continue.");
    return session;
  }
  tenantStorageOwnerUserId(tenantId) {
    if (!TENANT_ID.test(String(tenantId || ""))) throw new Error("Choose a valid workspace.");
    const owner = this.db.prepare(`
      SELECT user_id
        FROM memberships
       WHERE tenant_id=?
       ORDER BY created_at ASC, user_id ASC
       LIMIT 1
    `).get(tenantId);
    if (!owner?.user_id) throw new Error("The original tenant data owner could not be verified.");
    return owner.user_id;
  }
  requireAdmin(token) {
    const session = this.requireSession(token);
    if (!session.user.platformAdmin && !["owner", "admin"].includes(session.tenant.role)) throw new Error("Administrator access is required.");
    return session;
  }
  logout(token) { this.db.prepare("UPDATE device_sessions SET revoked_at=? WHERE token_hash=?").run(nowIso(this.now()), hash(token)); return { signedOut: true }; }
  listTenants(token) {
    const session = this.requireSession(token);
    const rows = this.db.prepare("SELECT t.*,m.role FROM tenants t JOIN memberships m ON m.tenant_id=t.id WHERE m.user_id=? AND m.status='active' ORDER BY t.created_at").all(session.user.id);
    return { activeTenantId: session.tenant.id, tenants: rows.map((row) => publicTenant(row, row.role, row.id === session.tenant.id)) };
  }
  selectTenant(token, tenantId) {
    const session = this.requireSession(token);
    if (!TENANT_ID.test(String(tenantId || ""))) throw new Error("Choose a valid workspace.");
    const tenant = this.db.prepare("SELECT * FROM tenants WHERE id=? AND status='active'").get(tenantId);
    const member = this.db.prepare("SELECT role FROM memberships WHERE user_id=? AND tenant_id=? AND status='active'").get(session.user.id, tenantId);
    if (!tenant || !member) throw new Error("You are not authorized for that workspace.");
    this.db.prepare("UPDATE device_sessions SET selected_tenant_id=?,last_used_at=? WHERE id=?").run(tenantId, nowIso(this.now()), session.id);
    this.audit(session.user.id, "session.select-tenant", "tenant", tenantId, tenantId);
    return this.sessionFromToken(token);
  }
  adminSnapshot(token) {
    const session = this.requireAdmin(token);
    const tenants = session.user.platformAdmin
      ? this.db.prepare("SELECT t.*,COUNT(CASE WHEN m.status='active' THEN 1 END) AS member_count FROM tenants t LEFT JOIN memberships m ON m.tenant_id=t.id GROUP BY t.id ORDER BY t.created_at").all()
      : this.db.prepare("SELECT t.*,COUNT(CASE WHEN m.status='active' THEN 1 END) AS member_count FROM tenants t LEFT JOIN memberships m ON m.tenant_id=t.id WHERE t.id=? GROUP BY t.id").all(session.tenant.id);
    const users = session.user.platformAdmin
      ? this.db.prepare("SELECT id,email,display_name,platform_admin,status,created_at FROM users ORDER BY created_at").all()
      : this.db.prepare("SELECT DISTINCT u.id,u.email,u.display_name,u.platform_admin,u.status,u.created_at FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.tenant_id=? ORDER BY u.created_at").all(session.tenant.id);
    const memberships = session.user.platformAdmin
      ? this.db.prepare("SELECT user_id,tenant_id,role,status,created_at FROM memberships ORDER BY created_at").all()
      : this.db.prepare("SELECT user_id,tenant_id,role,status,created_at FROM memberships WHERE tenant_id=? ORDER BY created_at").all(session.tenant.id);
    return { actor: session.user, tenants: tenants.map((row) => ({ ...publicTenant(row), memberCount: Number(row.member_count) })), users: users.map(publicUser), memberships };
  }
  adminCreateTenant(token, { name }) {
    const actor = this.requireAdmin(token);
    if (!actor.user.platformAdmin) throw new Error("Platform administrator access is required to create a workspace.");
    const id = opaqueId("tenant", 8);
    const createdAt = nowIso(this.now());
    this.transaction(() => {
      this.db.prepare("INSERT INTO tenants(id,name,storage_relative_path,status,created_at,updated_at) VALUES(?,?,?,'active',?,?)").run(id, cleanName(name, "workspace name"), `tenants/${id}`, createdAt, createdAt);
      this.audit(actor.user.id, "tenant.create", "tenant", id, id);
    });
    return publicTenant(this.db.prepare("SELECT * FROM tenants WHERE id=?").get(id), null, false);
  }
  adminCreateUser(token, { email, displayName, password, tenantId, role = "member", platformAdmin = false }) {
    const actor = this.requireAdmin(token);
    if (!actor.user.platformAdmin) throw new Error("Platform administrator access is required to create users.");
    if (!ROLES.has(role)) throw new Error("Choose a valid workspace role.");
    const normalizedEmail = normalizeEmail(email);
    const existingUser = this.db.prepare("SELECT id FROM users WHERE email=?").get(normalizedEmail);
    if (existingUser) {
      const existingMembership = this.db.prepare("SELECT status FROM memberships WHERE user_id=? AND tenant_id=?").get(existingUser.id, String(tenantId || ""));
      if (existingMembership) throw new Error("This account already exists in the selected tenant. Manage its role and access in the user list.");
      throw new Error("This email already belongs to a MyCrobo account. Assign the existing account to this tenant instead of creating it again.");
    }
    const tenant = this.db.prepare("SELECT id FROM tenants WHERE id=? AND status='active'").get(String(tenantId || ""));
    if (!tenant) throw new Error("Choose an active workspace.");
    this.assertSeatAvailable(tenantId);
    const userId = opaqueId("user");
    const createdAt = nowIso(this.now());
    const record = passwordRecord(password);
    this.transaction(() => {
      this.db.prepare("INSERT INTO users(id,email,display_name,password_salt,password_digest,platform_admin,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'active',?,?)")
        .run(userId, normalizedEmail, cleanName(displayName, "name"), record.salt, record.digest, platformAdmin === true ? 1 : 0, createdAt, createdAt);
      this.db.prepare("INSERT INTO memberships(user_id,tenant_id,role,status,created_at,updated_at) VALUES(?,?,?,'active',?,?)").run(userId, tenantId, role, createdAt, createdAt);
      this.audit(actor.user.id, "user.create", "user", userId, tenantId);
    });
    return publicUser(this.db.prepare("SELECT * FROM users WHERE id=?").get(userId));
  }
  adminAssignExistingUser(token, { email, tenantId, role = "member" }) {
    const actor = this.requireAdmin(token);
    if (!actor.user.platformAdmin) throw new Error("Platform administrator access is required to assign existing accounts.");
    if (!ROLES.has(role)) throw new Error("Choose a valid workspace role.");
    const normalizedEmail = normalizeEmail(email);
    const user = this.db.prepare("SELECT id,status FROM users WHERE email=?").get(normalizedEmail);
    if (!user || user.status !== "active") throw new Error("No active MyCrobo account was found for that email.");
    const normalizedTenantId = String(tenantId || "");
    const tenant = this.db.prepare("SELECT id FROM tenants WHERE id=? AND status='active'").get(normalizedTenantId);
    if (!tenant) throw new Error("Choose an active workspace.");
    const current = this.db.prepare("SELECT status FROM memberships WHERE user_id=? AND tenant_id=?").get(user.id, normalizedTenantId);
    if (current?.status === "active") throw new Error("This account already has active access to the selected tenant.");
    if (current?.status !== "active") this.assertSeatAvailable(normalizedTenantId);
    const at = nowIso(this.now());
    this.db.prepare("INSERT INTO memberships(user_id,tenant_id,role,status,created_at,updated_at) VALUES(?,?,?,'active',?,?) ON CONFLICT(user_id,tenant_id) DO UPDATE SET role=excluded.role,status='active',updated_at=excluded.updated_at")
      .run(user.id, normalizedTenantId, role, at, at);
    this.audit(actor.user.id, "membership.assign-existing", "membership", `${user.id}:${normalizedTenantId}:${role}`, normalizedTenantId);
    return { userId: user.id, tenantId: normalizedTenantId, role, status: "active" };
  }
  adminSetMembership(token, { userId, tenantId, role, status = "active" }) {
    const actor = this.requireAdmin(token);
    if (!actor.user.platformAdmin) throw new Error("Platform administrator access is required to manage access.");
    if (!USER_ID.test(String(userId || "")) || !TENANT_ID.test(String(tenantId || "")) || !ROLES.has(role) || !["active", "disabled"].includes(status)) throw new Error("Choose a valid user, workspace, role and access state.");
    if (actor.user.id === userId && actor.tenant.id === tenantId && status !== "active") throw new Error("You cannot disable the membership used by your current session.");
    const current = this.db.prepare("SELECT status FROM memberships WHERE user_id=? AND tenant_id=?").get(userId, tenantId);
    if (status === "active" && current?.status !== "active") this.assertSeatAvailable(tenantId);
    const createdAt = nowIso(this.now());
    this.db.prepare("INSERT INTO memberships(user_id,tenant_id,role,status,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,tenant_id) DO UPDATE SET role=excluded.role,status=excluded.status,updated_at=excluded.updated_at")
      .run(userId, tenantId, role, status, createdAt, createdAt);
    this.audit(actor.user.id, "membership.set", "membership", `${userId}:${tenantId}:${role}:${status}`, tenantId);
    return { userId, tenantId, role, status };
  }
  adminSetTenantStatus(token, { tenantId, status }) {
    const actor = this.requireAdmin(token);
    if (!actor.user.platformAdmin || !TENANT_ID.test(String(tenantId || "")) || !TENANT_STATES.has(status)) throw new Error("Choose a valid workspace state.");
    if (tenantId === actor.tenant.id && status !== "active") throw new Error("Switch away before suspending the current workspace.");
    const result = this.db.prepare("UPDATE tenants SET status=?,updated_at=? WHERE id=?").run(status, nowIso(this.now()), tenantId);
    if (!result.changes) throw new Error("Workspace was not found.");
    this.audit(actor.user.id, "tenant.status", "tenant", `${tenantId}:${status}`, tenantId);
    return { tenantId, status };
  }
  tenantStorageRelativePath(token) {
    const session = this.requireSession(token);
    const tenant = this.db.prepare("SELECT storage_relative_path FROM tenants WHERE id=?").get(session.tenant.id);
    if (!tenant || tenant.storage_relative_path !== `tenants/${session.tenant.id}`) throw new Error("The authenticated workspace has an invalid private storage binding.");
    return tenant.storage_relative_path;
  }

  activeEntitlement(tenantId) {
    const row = this.db.prepare("SELECT p.*,s.status AS subscription_status,s.current_period_end,s.coupon_id FROM tenant_subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.tenant_id=?").get(tenantId);
    if (!row) return { assigned: false, plan: null, limits: null, subscriptionStatus: "unassigned" };
    const plan = publicPlan(row);
    const accessAllowed = ["trialing", "active"].includes(row.subscription_status) && row.status === "active";
    const limits = accessAllowed ? plan.limits : { ...plan.limits, whatsappAccounts: 0, monthlyDrafts: 0, monthlyTranslations: 0 };
    return { assigned: true, accessAllowed, plan, limits, subscriptionStatus: row.subscription_status, currentPeriodEnd: row.current_period_end || null, couponId: row.coupon_id || null };
  }
  entitlement(token) {
    const session = this.requireSession(token);
    return this.activeEntitlement(session.tenant.id);
  }
  assertSeatAvailable(tenantId) {
    const entitlement = this.activeEntitlement(tenantId);
    if (!entitlement.assigned) return;
    const active = Number(this.db.prepare("SELECT COUNT(*) AS count FROM memberships WHERE tenant_id=? AND status='active'").get(tenantId).count);
    if (active >= entitlement.limits.seats) throw new Error(`This workspace has reached its ${entitlement.limits.seats}-seat plan limit.`);
  }
  requirePlatformAdmin(token) {
    const session = this.requireSession(token);
    if (!session.user.platformAdmin) throw new Error("Platform administrator access is required.");
    return session;
  }
  platformCreatePlan(token, input) {
    const actor = this.requirePlatformAdmin(token);
    const id = opaqueId("plan", 8);
    const at = nowIso(this.now());
    const currency = String(input?.currency || "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/u.test(currency)) throw new Error("Enter a three-letter currency code.");
    const limits = planLimits(input?.limits || {});
    this.db.prepare("INSERT INTO plans(id,code,name,description,currency,monthly_price_minor,limits_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'active',?,?)")
      .run(id, cleanCode(input?.code, "plan code"), cleanName(input?.name, "plan name"), String(input?.description || "").trim().slice(0, 300), currency, boundedInteger(input?.monthlyPriceMinor, "monthly price", 0, 10_000_000_000), JSON.stringify(limits), at, at);
    this.audit(actor.user.id, "plan.create", "plan", id);
    return publicPlan(this.db.prepare("SELECT * FROM plans WHERE id=?").get(id));
  }
  platformUpdatePlan(token, input) {
    const actor = this.requirePlatformAdmin(token);
    const planId = String(input?.planId || "");
    if (!PLAN_ID.test(planId)) throw new Error("Choose a valid plan.");
    const existing = this.db.prepare("SELECT id FROM plans WHERE id=?").get(planId);
    if (!existing) throw new Error("Plan not found.");
    const currency = String(input?.currency || "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/u.test(currency)) throw new Error("Enter a three-letter currency code.");
    const limits = planLimits(input?.limits || {});
    const overLimit = this.db.prepare(`
      SELECT s.tenant_id,COUNT(m.user_id) AS active_users
      FROM tenant_subscriptions s
      LEFT JOIN memberships m ON m.tenant_id=s.tenant_id AND m.status='active'
      WHERE s.plan_id=? AND s.status IN ('trialing','active')
      GROUP BY s.tenant_id HAVING COUNT(m.user_id)>? LIMIT 1
    `).get(planId, limits.seats);
    if (overLimit) throw new Error(`An enrolled workspace has ${Number(overLimit.active_users)} active users. The seat limit cannot be lower than current use.`);
    const at = nowIso(this.now());
    this.db.prepare("UPDATE plans SET code=?,name=?,description=?,currency=?,monthly_price_minor=?,limits_json=?,updated_at=? WHERE id=?")
      .run(cleanCode(input?.code, "plan code"), cleanName(input?.name, "plan name"), String(input?.description || "").trim().slice(0, 300), currency, boundedInteger(input?.monthlyPriceMinor, "monthly price", 0, 10_000_000_000), JSON.stringify(limits), at, planId);
    this.audit(actor.user.id, "plan.update", "plan", planId);
    for (const row of this.db.prepare("SELECT tenant_id FROM tenant_subscriptions WHERE plan_id=?").all(planId)) this.persistEntitlementSnapshot(row.tenant_id);
    return publicPlan(this.db.prepare("SELECT * FROM plans WHERE id=?").get(planId));
  }
  platformSetPlanStatus(token, { planId, status }) {
    const actor = this.requirePlatformAdmin(token);
    if (!PLAN_ID.test(String(planId || "")) || !["active", "archived"].includes(status)) throw new Error("Choose a valid plan state.");
    if (status === "archived" && this.db.prepare("SELECT 1 FROM tenant_subscriptions WHERE plan_id=? AND status IN ('trialing','active') LIMIT 1").get(planId)) {
      throw new Error("Move active and trial tenants to another plan before archiving this plan.");
    }
    const result = this.db.prepare("UPDATE plans SET status=?,updated_at=? WHERE id=?").run(status, nowIso(this.now()), planId);
    if (!result.changes) throw new Error("Plan not found.");
    this.audit(actor.user.id, "plan.status", "plan", `${planId}:${status}`);
    return { planId, status };
  }
  platformCreateCoupon(token, input) {
    const actor = this.requirePlatformAdmin(token);
    const id = opaqueId("coupon", 8);
    const at = nowIso(this.now());
    const code = input?.code ? cleanCode(input.code, "coupon code") : `MC-${randomBytes(5).toString("hex").toUpperCase()}`;
    const planId = String(input?.planId || "").trim() || null;
    if (planId && !this.db.prepare("SELECT id FROM plans WHERE id=? AND status='active'").get(planId)) throw new Error("Choose an active plan or all plans.");
    const expiresAt = optionalIso(input?.expiresAt, "coupon expiry");
    if (expiresAt && Date.parse(expiresAt) <= this.now()) throw new Error("Coupon expiry must be in the future.");
    this.db.prepare("INSERT INTO coupons(id,code,plan_id,discount_percent,max_redemptions,expires_at,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'active',?,?)")
      .run(id, code, planId, boundedInteger(input?.discountPercent, "discount percentage", 1, 100), boundedInteger(input?.maxRedemptions, "redemption limit", 1, 1_000_000), expiresAt, at, at);
    this.audit(actor.user.id, "coupon.create", "coupon", id);
    return this.db.prepare("SELECT * FROM coupons WHERE id=?").get(id);
  }
  platformSetCouponStatus(token, { couponId, status }) {
    const actor = this.requirePlatformAdmin(token);
    if (!COUPON_ID.test(String(couponId || "")) || !["active", "disabled", "expired"].includes(status)) throw new Error("Choose a valid coupon state.");
    const result = this.db.prepare("UPDATE coupons SET status=?,updated_at=? WHERE id=?").run(status, nowIso(this.now()), couponId);
    if (!result.changes) throw new Error("Coupon not found.");
    this.audit(actor.user.id, "coupon.status", "coupon", `${couponId}:${status}`);
    return { couponId, status };
  }
  platformAssignPlan(token, { tenantId, planId, status = "active", couponCode = "", currentPeriodEnd = null }) {
    const actor = this.requirePlatformAdmin(token);
    if (!TENANT_ID.test(String(tenantId || "")) || !PLAN_ID.test(String(planId || "")) || !["trialing", "active", "past_due", "cancelled"].includes(status)) throw new Error("Choose a valid workspace, plan and subscription state.");
    if (!this.db.prepare("SELECT id FROM tenants WHERE id=?").get(tenantId) || !this.db.prepare("SELECT id FROM plans WHERE id=? AND status='active'").get(planId)) throw new Error("Workspace or active plan not found.");
    const activeSeats = Number(this.db.prepare("SELECT COUNT(*) AS count FROM memberships WHERE tenant_id=? AND status='active'").get(tenantId).count);
    const limits = JSON.parse(this.db.prepare("SELECT limits_json FROM plans WHERE id=?").get(planId).limits_json);
    if (["active", "trialing"].includes(status) && activeSeats > limits.seats) throw new Error(`This workspace has ${activeSeats} active users; choose a plan with at least that many seats.`);
    let couponId = null;
    this.transaction(() => {
      if (String(couponCode || "").trim()) {
        const coupon = this.db.prepare("SELECT * FROM coupons WHERE code=? COLLATE NOCASE").get(cleanCode(couponCode, "coupon code"));
        if (!coupon || coupon.status !== "active" || (coupon.plan_id && coupon.plan_id !== planId) || (coupon.expires_at && Date.parse(coupon.expires_at) <= this.now()) || Number(coupon.redeemed_count) >= Number(coupon.max_redemptions)) throw new Error("This coupon is invalid, expired, exhausted, or not valid for the selected plan.");
        if (this.db.prepare("SELECT 1 FROM coupon_redemptions WHERE coupon_id=? AND tenant_id=?").get(coupon.id, tenantId)) throw new Error("This workspace has already used that coupon.");
        couponId = coupon.id;
        this.db.prepare("INSERT INTO coupon_redemptions(coupon_id,tenant_id,redeemed_at,actor_user_id) VALUES(?,?,?,?)").run(coupon.id, tenantId, nowIso(this.now()), actor.user.id);
        this.db.prepare("UPDATE coupons SET redeemed_count=redeemed_count+1,updated_at=? WHERE id=?").run(nowIso(this.now()), coupon.id);
      }
      const at = nowIso(this.now());
      const periodEnd = optionalIso(currentPeriodEnd, "billing period end");
      this.db.prepare("INSERT INTO tenant_subscriptions(tenant_id,plan_id,status,coupon_id,started_at,current_period_end,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET plan_id=excluded.plan_id,status=excluded.status,coupon_id=excluded.coupon_id,current_period_end=excluded.current_period_end,updated_at=excluded.updated_at")
        .run(tenantId, planId, status, couponId, at, periodEnd, at);
      this.audit(actor.user.id, "subscription.assign", "subscription", `${tenantId}:${planId}:${status}`, tenantId);
    });
    this.persistEntitlementSnapshot(tenantId);
    return this.activeEntitlement(tenantId);
  }
  persistEntitlementSnapshot(tenantId) {
    if (!TENANT_ID.test(String(tenantId || ""))) throw new Error("Choose a valid workspace.");
    const directory = join(this.root, "tenants", tenantId);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const destination = join(directory, "plan-entitlement.json");
    const temporary = `${destination}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.activeEntitlement(tenantId), null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temporary, destination);
    return destination;
  }
  tenantUsage(tenantId) {
    const file = join(this.root, "tenants", tenantId, "usage-summary.json");
    if (!existsSync(file)) return { period: null, drafts: 0, translations: 0, updatedAt: null };
    try {
      const value = JSON.parse(readFileSync(file, "utf8"));
      if (value?.tenantId !== tenantId) return { period: null, drafts: 0, translations: 0, updatedAt: null };
      return { period: String(value.period || ""), drafts: Math.max(0, Number(value.drafts) || 0), translations: Math.max(0, Number(value.translations) || 0), updatedAt: value.updatedAt || null };
    } catch { return { period: null, drafts: 0, translations: 0, updatedAt: null }; }
  }
  platformDashboard(token) {
    const actor = this.requirePlatformAdmin(token);
    const plans = this.db.prepare("SELECT * FROM plans ORDER BY monthly_price_minor,created_at").all().map(publicPlan);
    const tenants = this.db.prepare("SELECT t.*,COUNT(CASE WHEN m.status='active' THEN 1 END) AS active_users,s.plan_id,s.status AS subscription_status,s.current_period_end,s.coupon_id,p.code AS plan_code,p.name AS plan_name,p.monthly_price_minor,p.currency,c.code AS coupon_code,c.discount_percent FROM tenants t LEFT JOIN memberships m ON m.tenant_id=t.id LEFT JOIN tenant_subscriptions s ON s.tenant_id=t.id LEFT JOIN plans p ON p.id=s.plan_id LEFT JOIN coupons c ON c.id=s.coupon_id GROUP BY t.id ORDER BY t.created_at DESC").all().map((row) => ({
      ...publicTenant(row), activeUsers: Number(row.active_users), planId: row.plan_id || null,
      planCode: row.plan_code || null, planName: row.plan_name || "Unassigned",
      subscriptionStatus: row.subscription_status || "unassigned", currentPeriodEnd: row.current_period_end || null,
      monthlyPriceMinor: Number(row.monthly_price_minor || 0), currency: row.currency || null,
      couponCode: row.coupon_code || null, discountPercent: Number(row.discount_percent || 0),
      effectiveMonthlyPriceMinor: Math.round(Number(row.monthly_price_minor || 0) * (100 - Number(row.discount_percent || 0)) / 100),
      usage: this.tenantUsage(row.id),
    }));
    const coupons = this.db.prepare("SELECT c.*,p.name AS plan_name FROM coupons c LEFT JOIN plans p ON p.id=c.plan_id ORDER BY c.created_at DESC").all().map((row) => ({ id: row.id, code: row.code, planId: row.plan_id || null, planName: row.plan_name || "All plans", discountPercent: Number(row.discount_percent), maxRedemptions: Number(row.max_redemptions), redeemedCount: Number(row.redeemed_count), expiresAt: row.expires_at || null, status: row.status }));
    const users = this.db.prepare(`
      SELECT u.id AS user_id,u.email,u.display_name,u.status AS user_status,u.platform_admin,
             m.tenant_id,m.role,m.status AS membership_status,t.name AS tenant_name,
             s.plan_id,p.name AS plan_name
      FROM memberships m
      JOIN users u ON u.id=m.user_id
      JOIN tenants t ON t.id=m.tenant_id
      LEFT JOIN tenant_subscriptions s ON s.tenant_id=m.tenant_id
      LEFT JOIN plans p ON p.id=s.plan_id
      ORDER BY t.name,u.display_name,u.email
    `).all().map((row) => ({ userId: row.user_id, email: row.email, displayName: row.display_name, userStatus: row.user_status, platformAdmin: row.platform_admin === 1, tenantId: row.tenant_id, tenantName: row.tenant_name, role: row.role, membershipStatus: row.membership_status, planId: row.plan_id || null, planName: row.plan_name || "Unassigned" }));
    const activeUsers = Number(this.db.prepare("SELECT COUNT(DISTINCT user_id) AS count FROM memberships WHERE status='active'").get().count);
    const activeSubscriptions = tenants.filter((tenant) => ["active", "trialing"].includes(tenant.subscriptionStatus));
    const byPlan = plans.map((plan) => ({ planId: plan.id, name: plan.name, tenants: activeSubscriptions.filter((tenant) => tenant.planId === plan.id).length, users: activeSubscriptions.filter((tenant) => tenant.planId === plan.id).reduce((sum, tenant) => sum + tenant.activeUsers, 0) }));
    const mrrByCurrency = Object.entries(activeSubscriptions.reduce((totals, tenant) => { if (tenant.currency) totals[tenant.currency] = (totals[tenant.currency] || 0) + tenant.effectiveMonthlyPriceMinor; return totals; }, {})).map(([currency, amountMinor]) => ({ currency, amountMinor }));
    return { actor: actor.user, generatedAt: nowIso(this.now()), metrics: { tenants: tenants.length, activeUsers, activeSubscriptions: activeSubscriptions.length, coupons: coupons.filter((coupon) => coupon.status === "active").length, mrrByCurrency }, byPlan, tenants, users, plans, coupons };
  }
}

module.exports = { CONTROL_SCHEMA, ControlPlane, ROLES, TENANT_ID, USER_ID, SESSION_ID, PLAN_ID, COUPON_ID };
