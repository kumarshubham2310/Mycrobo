const assert = require("node:assert/strict");
const test = require("node:test");

const compatibility = require("./account-profiles.cjs");
const tenants = require("./tenant-registry.cjs");

test("legacy module resolves to the equal-tenant registry", () => {
  assert.equal(compatibility.SCHEMA, "mycrobo-tenants.1");
  assert.equal(compatibility.activeTenant, tenants.activeTenant);
  assert.equal(compatibility.createTenant, tenants.createTenant);
  assert.equal(compatibility.selectTenant, tenants.selectTenant);
});
