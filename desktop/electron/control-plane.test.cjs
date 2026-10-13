const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { ControlPlane } = require("./control-plane.cjs");

function setup() {
  let nowMs = Date.parse("2026-09-12T00:00:00Z");
  const root = mkdtempSync(join(tmpdir(), "mycrobo-control-"));
  const plane = new ControlPlane(root, { now: () => nowMs });
  return { root, plane, advance: (value) => { nowMs += value; } };
}

test("control plane starts empty and bootstraps only from supplied administrator data", () => {
  const { plane } = setup();
  assert.equal(plane.status().bootstrapRequired, true);
  const created = plane.bootstrap({ email: "owner@example.test", displayName: "Workspace Owner", password: "CorrectHorse7Battery", workspaceName: "Consulting" });
  assert.equal(created.session.user.email, "owner@example.test");
  assert.equal(created.session.user.platformAdmin, true);
  assert.equal(created.session.tenant.name, "Consulting");
  assert.match(plane.tenantStorageRelativePath(created.token), /^tenants\/tenant-/u);
  assert.equal(plane.status().bootstrapRequired, false);
  assert.throws(() => plane.bootstrap({ email: "other@example.test", displayName: "Other User", password: "CorrectHorse7Battery", workspaceName: "Other" }), /already configured/u);
  plane.close();
});

test("login resolves the user membership and tenant without exposing another tenant", () => {
  const { plane } = setup();
  const owner = plane.bootstrap({ email: "admin@example.test", displayName: "Admin User", password: "CorrectHorse7Battery", workspaceName: "First" });
  const second = plane.adminCreateTenant(owner.token, { name: "Second" });
  plane.adminCreateUser(owner.token, { email: "member@example.test", displayName: "Member User", password: "DifferentHorse8Battery", tenantId: second.id, role: "member" });
  const member = plane.login({ email: "member@example.test", password: "DifferentHorse8Battery" });
  assert.equal(member.session.tenant.id, second.id);
  assert.deepEqual(plane.listTenants(member.token).tenants.map((item) => item.id), [second.id]);
  assert.throws(() => plane.selectTenant(member.token, owner.session.tenant.id), /not authorized/u);
  plane.close();
});

test("existing platform owner safely regains an older registry tenant without replacing newer workspaces", () => {
  const { plane } = setup();
  const owner = plane.bootstrap({ email: "admin@example.test", displayName: "Admin User", password: "CorrectHorse7Battery", workspaceName: "New workspace" });
  const legacyId = "tenant-0123456789abcdef";
  const result = plane.reconcileImportedTenants([{ id: legacyId, name: "Original workspace", createdAt: "2026-01-01T00:00:00.000Z" }]);
  assert.deepEqual(result, { imported: 1, membershipsAdded: 1 });
  assert.deepEqual(plane.reconcileImportedTenants([{ id: legacyId, name: "Original workspace", createdAt: "2026-01-01T00:00:00.000Z" }]), { imported: 0, membershipsAdded: 0 });
  const signedIn = plane.login({ email: "admin@example.test", password: "CorrectHorse7Battery" });
  assert.equal(signedIn.session.tenant.id, legacyId);
  assert.deepEqual(new Set(plane.listTenants(signedIn.token).tenants.map((tenant) => tenant.id)), new Set([legacyId, owner.session.tenant.id]));
  plane.close();
});

test("administrator manages tenants, users and memberships without hardcoded identities", () => {
  const { plane } = setup();
  const owner = plane.bootstrap({ email: "admin@example.test", displayName: "Admin User", password: "CorrectHorse7Battery", workspaceName: "First" });
  const second = plane.adminCreateTenant(owner.token, { name: "Client Two" });
  assert.equal(plane.listTenants(owner.token).tenants.some((tenant) => tenant.id === second.id), false);
  assert.throws(() => plane.selectTenant(owner.token, second.id), /not authorized/u);
  const user = plane.adminCreateUser(owner.token, { email: "client@example.test", displayName: "Client User", password: "DifferentHorse8Battery", tenantId: second.id, role: "viewer" });
  plane.adminSetMembership(owner.token, { userId: user.id, tenantId: owner.session.tenant.id, role: "member", status: "active" });
  const snapshot = plane.adminSnapshot(owner.token);
  assert.equal(snapshot.tenants.length, 2);
  assert.equal(snapshot.users.length, 2);
  assert.equal(snapshot.memberships.length, 3);
  assert.equal(JSON.stringify(snapshot).includes("password"), false);
  plane.close();
});

test("duplicate accounts return an actionable error without leaking database internals", () => {
  const { plane } = setup();
  const owner = plane.bootstrap({ email: "admin@example.test", displayName: "Admin User", password: "CorrectHorse7Battery", workspaceName: "First" });
  assert.throws(
    () => plane.adminCreateUser(owner.token, { email: "ADMIN@example.test", displayName: "Duplicate", password: "DifferentHorse8Battery", tenantId: owner.session.tenant.id, role: "member" }),
    /already exists in the selected tenant.*user list/u,
  );
  assert.equal(plane.platformDashboard(owner.token).metrics.activeUsers, 1);
  plane.close();
});

test("platform administrators assign one existing login to another isolated tenant without recreating it", () => {
  const { plane } = setup();
  const owner = plane.bootstrap({ email: "admin@example.test", displayName: "Admin User", password: "CorrectHorse7Battery", workspaceName: "First" });
  const second = plane.adminCreateTenant(owner.token, { name: "Second" });
  const user = plane.adminCreateUser(owner.token, { email: "member@example.test", displayName: "Member", password: "DifferentHorse8Battery", tenantId: owner.session.tenant.id, role: "member" });
  const assigned = plane.adminAssignExistingUser(owner.token, { email: "MEMBER@example.test", tenantId: second.id, role: "viewer" });
  assert.deepEqual(assigned, { userId: user.id, tenantId: second.id, role: "viewer", status: "active" });
  const login = plane.login({ email: "member@example.test", password: "DifferentHorse8Battery" });
  assert.deepEqual(new Set(plane.listTenants(login.token).tenants.map((tenant) => tenant.id)), new Set([owner.session.tenant.id, second.id]));
  assert.throws(() => plane.adminAssignExistingUser(owner.token, { email: "member@example.test", tenantId: second.id, role: "member" }), /already has active access/u);
  assert.throws(() => plane.adminAssignExistingUser(owner.token, { email: "missing@example.test", tenantId: second.id, role: "member" }), /No active MyCrobo account/u);
  plane.close();
});

test("tenant administrators cannot enumerate another tenant through the admin panel", () => {
  const { plane } = setup();
  const platform = plane.bootstrap({ email: "platform@example.test", displayName: "Platform Admin", password: "CorrectHorse7Battery", workspaceName: "First" });
  const second = plane.adminCreateTenant(platform.token, { name: "Private Second" });
  plane.adminCreateUser(platform.token, { email: "tenant-owner@example.test", displayName: "Tenant Owner", password: "DifferentHorse8Battery", tenantId: platform.session.tenant.id, role: "owner" });
  plane.adminCreateUser(platform.token, { email: "hidden@example.test", displayName: "Hidden User", password: "AnotherHorse9Battery", tenantId: second.id, role: "member" });
  const tenantOwner = plane.login({ email: "tenant-owner@example.test", password: "DifferentHorse8Battery" });
  const snapshot = plane.adminSnapshot(tenantOwner.token);
  assert.deepEqual(snapshot.tenants.map((item) => item.id), [platform.session.tenant.id]);
  assert.equal(snapshot.users.some((item) => item.email === "hidden@example.test"), false);
  assert.equal(snapshot.memberships.every((item) => item.tenant_id === platform.session.tenant.id), true);
  plane.close();
});

test("sessions are revocable and password guessing is rate limited", () => {
  const { plane, advance } = setup();
  const owner = plane.bootstrap({ email: "admin@example.test", displayName: "Admin User", password: "CorrectHorse7Battery", workspaceName: "First" });
  plane.logout(owner.token);
  assert.equal(plane.sessionFromToken(owner.token), null);
  for (let index = 0; index < 5; index += 1) assert.throws(() => plane.login({ email: "admin@example.test", password: "WrongPassword8" }), /incorrect/u);
  assert.throws(() => plane.login({ email: "admin@example.test", password: "CorrectHorse7Battery" }), /15 minutes/u);
  advance(16 * 60_000);
  assert.equal(plane.login({ email: "admin@example.test", password: "CorrectHorse7Battery" }).session.user.email, "admin@example.test");
  plane.close();
});

test("platform console manages plans, discounted subscriptions, limits and coupon redemption", () => {
  const { plane } = setup();
  const owner = plane.bootstrap({ email: "platform@example.test", displayName: "Platform Owner", password: "CorrectHorse7Battery", workspaceName: "First customer" });
  assert.deepEqual(plane.platformDashboard(owner.token).plans, []);
  const plan = plane.platformCreatePlan(owner.token, {
    code: "GROWTH", name: "Growth", description: "For growing teams", currency: "INR", monthlyPriceMinor: 10_000,
    limits: { seats: 2, whatsappAccounts: 1, monthlyDrafts: 500, monthlyTranslations: 250, historyMessages: 100_000, storageMb: 5_120 },
  });
  const coupon = plane.platformCreateCoupon(owner.token, { code: "LAUNCH25", planId: plan.id, discountPercent: 25, maxRedemptions: 1, expiresAt: "2026-10-01" });
  plane.platformAssignPlan(owner.token, { tenantId: owner.session.tenant.id, planId: plan.id, status: "active", couponCode: coupon.code, currentPeriodEnd: "2026-10-01" });
  const customer = plane.adminCreateUser(owner.token, { email: "customer@example.test", displayName: "Customer User", password: "DifferentHorse8Battery", tenantId: owner.session.tenant.id, role: "member" });
  assert.throws(() => plane.adminCreateUser(owner.token, { email: "third@example.test", displayName: "Third User", password: "AnotherHorse9Battery", tenantId: owner.session.tenant.id, role: "member" }), /seat plan limit/u);
  assert.throws(() => plane.platformUpdatePlan(owner.token, { ...plan, planId: plan.id, monthlyPriceMinor: 12_000, limits: { ...plan.limits, seats: 1 } }), /cannot be lower/u);
  const updated = plane.platformUpdatePlan(owner.token, { ...plan, planId: plan.id, monthlyPriceMinor: 12_000, limits: plan.limits });
  assert.equal(updated.monthlyPriceMinor, 12_000);
  const dashboard = plane.platformDashboard(owner.token);
  assert.equal(dashboard.metrics.tenants, 1);
  assert.equal(dashboard.metrics.activeUsers, 2);
  assert.equal(dashboard.metrics.activeSubscriptions, 1);
  assert.equal(dashboard.metrics.mrrByCurrency[0].amountMinor, 9_000);
  assert.equal(dashboard.tenants[0].effectiveMonthlyPriceMinor, 9_000);
  assert.equal(dashboard.tenants[0].couponCode, "LAUNCH25");
  assert.equal(dashboard.byPlan[0].users, 2);
  assert.throws(() => plane.platformAssignPlan(owner.token, { tenantId: owner.session.tenant.id, planId: plan.id, couponCode: coupon.code }), /coupon is invalid|already used/u);
  assert.ok(customer.id);
  plane.close();
});

test("tenant administrators cannot use the platform commercial control plane", () => {
  const { plane } = setup();
  const platform = plane.bootstrap({ email: "platform@example.test", displayName: "Platform Owner", password: "CorrectHorse7Battery", workspaceName: "Customer" });
  plane.adminCreateUser(platform.token, { email: "tenant@example.test", displayName: "Tenant Admin", password: "DifferentHorse8Battery", tenantId: platform.session.tenant.id, role: "admin" });
  const tenant = plane.login({ email: "tenant@example.test", password: "DifferentHorse8Battery" });
  assert.throws(() => plane.platformDashboard(tenant.token), /Platform administrator/u);
  assert.throws(() => plane.platformCreatePlan(tenant.token, {}), /Platform administrator/u);
  plane.close();
});

test("register creates a new user and independent tenant workspace", () => {
  const { plane } = setup();
  const owner = plane.bootstrap({ email: "owner@example.test", displayName: "Owner", password: "CorrectHorse7Battery", workspaceName: "First" });
  const registered = plane.register({ email: "newuser@example.test", displayName: "New User", password: "DifferentHorse8Battery", workspaceName: "My Workspace" });
  assert.equal(registered.session.user.email, "newuser@example.test");
  assert.equal(registered.session.tenant.name, "My Workspace");
  assert.notEqual(registered.session.tenant.id, owner.session.tenant.id);
  assert.equal(registered.session.tenant.role, "owner");
  assert.throws(() => plane.register({ email: "newuser@example.test", displayName: "Duplicate", password: "DifferentHorse8Battery" }), /already exists/u);
  plane.close();
});
