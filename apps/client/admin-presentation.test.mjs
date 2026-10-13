import assert from "node:assert/strict";
import test from "node:test";
import { canOpenAdmin, normalizeAdminSnapshot, validateAdminUser, validateMembership, validateTenant } from "./admin-presentation.mjs";

test("admin visibility is denied by default and granted only to authorized roles", () => {
  assert.equal(canOpenAdmin(null), false);
  assert.equal(canOpenAdmin({ authenticated: true, user: {}, tenant: { role: "member" } }), false);
  assert.equal(canOpenAdmin({ authenticated: true, user: {}, tenant: { role: "admin" } }), true);
  assert.equal(canOpenAdmin({ authenticated: true, user: { platformAdmin: true }, tenant: { role: "member" } }), true);
});

test("snapshot normalization accepts database and presentation field names without markup execution", () => {
  const value = normalizeAdminSnapshot({
    tenants: [{ id: "tenant_12345678", name: "<Alpha>", status: "active", memberCount: 2 }],
    users: [{ id: "user_1234567890", display_name: "A <script>", email: "a@example.com", platform_admin: 1 }],
    memberships: [{ user_id: "user_1234567890", tenant_id: "tenant_12345678", role: "owner", status: "active" }],
  });
  assert.equal(value.tenants[0].name, "<Alpha>");
  assert.equal(value.users[0].displayName, "A <script>");
  assert.equal(value.users[0].platformAdmin, true);
  assert.equal(value.memberships[0].role, "owner");
});

test("admin inputs are validated and passwords are never returned from snapshots", () => {
  assert.deepEqual(validateTenant({ name: "  Product   team " }), { name: "Product team" });
  const user = validateAdminUser({ displayName: " Test User ", email: "TEST@Example.com", password: "a-secure-passphrase", tenantId: "tenant_12345678", role: "admin" });
  assert.equal(user.email, "test@example.com");
  assert.equal(user.role, "admin");
  assert.deepEqual(validateMembership({ userId: "user_x", tenantId: "tenant_x", role: "viewer", status: "disabled" }), { userId: "user_x", tenantId: "tenant_x", role: "viewer", status: "disabled" });
  assert.throws(() => validateAdminUser({ email: "no", password: "short" }), /name|email|password/u);
  assert.equal("password" in normalizeAdminSnapshot({ users: [{ id: "u", password: "secret" }] }).users[0], false);
});
