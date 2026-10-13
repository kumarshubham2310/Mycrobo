import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const METRICS = Object.freeze({ drafts: "monthlyDrafts", translations: "monthlyTranslations" });

function month(now = new Date()) { return now.toISOString().slice(0, 7); }
function cleanCount(value) { return Math.max(0, Number.isSafeInteger(Number(value)) ? Number(value) : 0); }

export class TenantUsageMeter {
  constructor({ tenantId, dataDir, limits = null, limitsPath = "", now = () => new Date() }) {
    this.tenantId = String(tenantId || "").trim();
    this.dataDir = String(dataDir || "").trim();
    this.limits = limits && typeof limits === "object" ? limits : null;
    this.limitsPath = String(limitsPath || "").trim();
    this.now = now;
    this.path = this.dataDir ? join(this.dataDir, "usage-summary.json") : "";
  }
  load() {
    const period = month(this.now());
    if (!this.path || !existsSync(this.path)) return { schema: 1, tenantId: this.tenantId, period, drafts: 0, translations: 0, updatedAt: null };
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8"));
      if (parsed?.tenantId !== this.tenantId || parsed?.period !== period) return { schema: 1, tenantId: this.tenantId, period, drafts: 0, translations: 0, updatedAt: null };
      return { schema: 1, tenantId: this.tenantId, period, drafts: cleanCount(parsed.drafts), translations: cleanCount(parsed.translations), updatedAt: parsed.updatedAt || null };
    } catch { return { schema: 1, tenantId: this.tenantId, period, drafts: 0, translations: 0, updatedAt: null }; }
  }
  limit(metric) {
    const key = METRICS[metric];
    const limits = this.currentLimits();
    if (!key || !limits) return null;
    const value = Number(limits[key]);
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  currentLimits() {
    if (!this.limitsPath || !existsSync(this.limitsPath)) return this.limits;
    try {
      const entitlement = JSON.parse(readFileSync(this.limitsPath, "utf8"));
      return entitlement?.assigned === true && entitlement?.limits && typeof entitlement.limits === "object" ? entitlement.limits : null;
    } catch { return this.limits; }
  }
  assertAvailable(metric) {
    const limit = this.limit(metric);
    if (limit === null) return;
    const used = cleanCount(this.load()[metric]);
    if (used >= limit) {
      const error = new Error(`This workspace has reached its monthly ${metric} limit.`);
      error.code = "PLAN_LIMIT_REACHED";
      throw error;
    }
  }
  record(metric) {
    if (!Object.hasOwn(METRICS, metric) || !this.path) return this.load();
    const value = this.load();
    value[metric] = cleanCount(value[metric]) + 1;
    value.updatedAt = this.now().toISOString();
    const temporary = `${this.path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temporary, this.path);
    return value;
  }
  snapshot() {
    const value = this.load();
    return { ...value, limits: { drafts: this.limit("drafts"), translations: this.limit("translations") } };
  }
}

export function createTenantUsageMeterFromEnv(environment = process.env) {
  let entitlement = null;
  try { entitlement = environment.MYCROBO_PLAN_ENTITLEMENT ? JSON.parse(environment.MYCROBO_PLAN_ENTITLEMENT) : null; } catch { entitlement = null; }
  return new TenantUsageMeter({
    tenantId: environment.MYCROBO_TENANT_ID,
    dataDir: environment.MYCROBO_USER_DATA_DIR,
    limits: entitlement?.assigned === true ? entitlement.limits : null,
    limitsPath: environment.MYCROBO_PLAN_ENTITLEMENT_PATH,
  });
}
