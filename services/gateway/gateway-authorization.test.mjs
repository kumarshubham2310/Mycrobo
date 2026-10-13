import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeGatewayCapability,
  GATEWAY_MUTATION_RULES,
  GATEWAY_ROLES,
  gatewayMutationRule,
  roleAllowsGatewayCapability,
} from "./gateway-authorization.mjs";

const EXPECTED_BY_ROLE = Object.freeze({
  viewer: new Set(),
  member: new Set([
    "draft.generate",
    "integration.sync",
    "media.retry",
    "personalization.write",
    "preferences.write",
    "send.approve",
    "send.execute",
    "translation.run",
    "workspace.write",
  ]),
  admin: new Set([
    "connection.manage",
    "draft.generate",
    "integration.manage",
    "integration.sync",
    "media.retry",
    "personalization.write",
    "preferences.write",
    "send.approve",
    "send.execute",
    "translation.run",
    "workspace.write",
  ]),
  owner: new Set([
    "connection.manage",
    "draft.generate",
    "integration.manage",
    "integration.sync",
    "media.retry",
    "personalization.write",
    "preferences.write",
    "privacy.destroy",
    "send.approve",
    "send.execute",
    "translation.run",
    "workspace.write",
  ]),
});

test("gateway mutation allowlist has unique rules and covers every declared route", () => {
  assert.equal(GATEWAY_MUTATION_RULES.length, 25);
  assert.equal(new Set(GATEWAY_MUTATION_RULES.map((rule) => rule.id)).size, GATEWAY_MUTATION_RULES.length);
  for (const rule of GATEWAY_MUTATION_RULES) {
    assert.equal(gatewayMutationRule(rule.method, rule.samplePath), rule, `${rule.id} must be reachable by its sample request`);
    assert.ok(EXPECTED_BY_ROLE.owner.has(rule.capability), `${rule.id} uses an undeclared capability`);
  }
});

test("the complete four-role matrix is enforced for every mutation route", () => {
  assert.deepEqual(GATEWAY_ROLES, ["viewer", "member", "admin", "owner"]);
  for (const role of GATEWAY_ROLES) {
    for (const rule of GATEWAY_MUTATION_RULES) {
      const result = authorizeGatewayCapability({ method: rule.method, pathname: rule.samplePath, role });
      const shouldAllow = EXPECTED_BY_ROLE[role].has(rule.capability);
      assert.equal(result.ok, shouldAllow, `${role} ${shouldAllow ? "must access" : "must be denied"} ${rule.id}`);
      assert.equal(roleAllowsGatewayCapability(role, rule.capability), shouldAllow);
      if (!shouldAllow) assert.equal(result.code, "ROLE_CAPABILITY_DENIED");
    }
  }
});

test("mutations fail closed for missing, invalid and newly introduced routes", () => {
  for (const role of [undefined, "", "platform-admin", "OWNER_FROM_RENDERER"]) {
    const result = authorizeGatewayCapability({ method: "PUT", pathname: "/api/v1/preferences", role });
    assert.equal(result.ok, false);
    assert.equal(result.code, "TRUSTED_ROLE_REQUIRED");
  }
  for (const role of GATEWAY_ROLES) {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const result = authorizeGatewayCapability({ method, pathname: "/api/v1/future-unreviewed-mutation", role });
      assert.equal(result.ok, false);
      assert.equal(result.code, "MUTATION_ROUTE_NOT_ALLOWLISTED");
    }
  }
});

test("read-only requests remain available to viewers", () => {
  for (const pathname of [
    "/api/v1/status",
    "/api/v1/chats",
    "/api/v1/chats/chat-1/messages",
    "/api/v1/preferences",
    "/api/v1/workspace",
    "/api/v1/privacy/export",
    "/api/v1/media/message-1",
  ]) {
    assert.deepEqual(authorizeGatewayCapability({ method: "GET", pathname, role: "viewer" }), { ok: true, mutation: false, role: "viewer" });
  }
});
