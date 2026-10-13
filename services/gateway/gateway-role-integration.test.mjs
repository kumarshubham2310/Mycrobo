import assert from "node:assert/strict";
import test from "node:test";

import { GATEWAY_MUTATION_RULES } from "./gateway-authorization.mjs";
import { createGatewayServer } from "./server.mjs";
import { MemoryUserStateStore } from "./user-state.mjs";

const TOKEN = "gateway-role-test-token";
const WINDOW = "gateway-role-test-window";

async function withServer(role, options, run) {
  const server = createGatewayServer({
    authRole: role,
    gatewayToken: TOKEN,
    windowToken: WINDOW,
    userStateStore: new MemoryUserStateStore(),
    draftProvider: null,
    ...options,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function authenticatedHeaders(extra = {}) {
  return {
    authorization: `Bearer ${TOKEN}`,
    "x-mycrobo-window": WINDOW,
    "content-type": "application/json",
    ...extra,
  };
}

test("viewer is read-only across the complete mutation-route registry and renderer role spoofing cannot elevate access", async () => {
  let bridgeMutations = 0;
  let oauthCompletions = 0;
  const bridgeSource = new Proxy({}, {
    get(_target, property) {
      if (property === "status") return async () => ({ connected: false, connectionState: "offline" });
      return async () => { bridgeMutations += 1; return {}; };
    },
  });
  const googleConnector = {
    available: true,
    async complete() { oauthCompletions += 1; return {}; },
  };
  await withServer("viewer", { bridgeSource, googleConnector }, async (origin) => {
    const status = await fetch(`${origin}/api/v1/status`, { headers: authenticatedHeaders() });
    assert.equal(status.status, 200, "viewer must retain authenticated read access");

    for (const rule of GATEWAY_MUTATION_RULES) {
      if (rule.id === "google-oauth-callback") continue;
      const response = await fetch(`${origin}${rule.samplePath}`, {
        method: rule.method,
        headers: authenticatedHeaders({ "x-mycrobo-role": "owner" }),
        body: rule.method === "GET" ? undefined : JSON.stringify({ role: "owner", authRole: "owner" }),
      });
      const payload = await response.json();
      assert.equal(response.status, 403, `viewer mutation ${rule.id} must be denied before route execution`);
      assert.equal(payload.code, "ROLE_CAPABILITY_DENIED", `${rule.id} must be denied by the role capability gate`);
    }

    const oauth = await fetch(`${origin}/oauth/google/callback?state=spoofed&code=spoofed`, {
      headers: { "x-mycrobo-role": "owner" },
    });
    assert.equal(oauth.status, 403);
    assert.match(await oauth.text(), /cannot change connected services/iu);
  });
  assert.equal(bridgeMutations, 0);
  assert.equal(oauthCompletions, 0);
});

test("member cannot cross into tenant-administration or owner-destruction capabilities", async () => {
  const administrativeRules = GATEWAY_MUTATION_RULES.filter((rule) => ["connection.manage", "integration.manage", "privacy.destroy"].includes(rule.capability));
  await withServer("member", {}, async (origin) => {
    for (const rule of administrativeRules) {
      if (rule.id === "google-oauth-callback") continue;
      const response = await fetch(`${origin}${rule.samplePath}`, {
        method: rule.method,
        headers: authenticatedHeaders({ "x-mycrobo-role": "owner" }),
        body: JSON.stringify({ role: "owner" }),
      });
      assert.equal(response.status, 403, `member must not cross into ${rule.capability} through ${rule.id}`);
      assert.equal((await response.json()).code, "ROLE_CAPABILITY_DENIED");
    }
  });
});

test("tenant admin cannot invoke owner-only local destruction", async () => {
  const ownerOnlyRules = GATEWAY_MUTATION_RULES.filter((rule) => rule.capability === "privacy.destroy");
  await withServer("admin", {}, async (origin) => {
    for (const rule of ownerOnlyRules) {
      const response = await fetch(`${origin}${rule.samplePath}`, {
        method: rule.method,
        headers: authenticatedHeaders(),
        body: JSON.stringify({}),
      });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, "ROLE_CAPABILITY_DENIED");
    }
  });
});

test("authenticated mutations fail closed when the trusted launch role is absent", async () => {
  await withServer("", {}, async (origin) => {
    const response = await fetch(`${origin}/api/v1/preferences`, {
      method: "PUT",
      headers: authenticatedHeaders({ "x-mycrobo-role": "owner" }),
      body: JSON.stringify({ role: "owner", density: "compact" }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "TRUSTED_ROLE_REQUIRED");
  });
});

test("authenticated but unreviewed future mutations are denied for every trusted role", async () => {
  for (const role of ["viewer", "member", "admin", "owner"]) {
    await withServer(role, {}, async (origin) => {
      const response = await fetch(`${origin}/api/v1/future-unreviewed-mutation`, {
        method: "POST",
        headers: authenticatedHeaders(),
        body: JSON.stringify({}),
      });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, "MUTATION_ROUTE_NOT_ALLOWLISTED");
    });
  }
});
