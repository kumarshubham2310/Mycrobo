import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

import { createGatewayServer } from "./server.mjs";

const esmRequire = createRequire(import.meta.url);
const { ControlPlane } = esmRequire("../../desktop/electron/control-plane.cjs");

test("gateway enforces tenant isolation between owner and newly registered users", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "mycrobo-auth-test-"));
  t.after(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  const controlPlane = new ControlPlane(root);
  const ownerTenantId = "tenant-0000000000000001";
  const server = createGatewayServer({
    controlPlane,
    tenantId: ownerTenantId,
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  t.after(() => new Promise((resolve) => server.close(resolve)));

  // 1. Unauthenticated request to /api/v1/chats must return 401
  const unauthRes = await fetch(`http://127.0.0.1:${port}/api/v1/chats`);
  assert.equal(unauthRes.status, 401);

  // 2. Auth status reports bootstrapRequired = true
  const statusRes = await fetch(`http://127.0.0.1:${port}/api/v1/auth/status`).then((r) => r.json());
  assert.equal(statusRes.authenticated, false);
  assert.equal(statusRes.bootstrapRequired, true);

  // 3. Bootstrap owner
  const bootstrapRes = await fetch(`http://127.0.0.1:${port}/api/v1/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "owner@mycrobo.com",
      password: "Password1234!",
      displayName: "Owner User",
      workspaceName: "Owner Workspace",
    }),
  }).then((r) => r.json());

  assert.equal(bootstrapRes.authenticated, true);
  assert.ok(bootstrapRes.token);
  const ownerToken = bootstrapRes.token;

  // 4. Owner fetches chats -> receives chats
  const ownerChatsRes = await fetch(`http://127.0.0.1:${port}/api/v1/chats`, {
    headers: { authorization: `Bearer ${ownerToken}` },
  });
  assert.equal(ownerChatsRes.status, 200);
  const ownerChats = await ownerChatsRes.json();
  assert.ok(Array.isArray(ownerChats.chats));
  assert.ok(ownerChats.chats.length > 0);

  // 5. Register a second user (User 2)
  const user2Res = await fetch(`http://127.0.0.1:${port}/api/v1/auth/signup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "user2@example.com",
      password: "Password1234!",
      displayName: "User Two",
      workspaceName: "User Two Workspace",
    }),
  }).then((r) => r.json());

  assert.equal(user2Res.authenticated, true);
  assert.ok(user2Res.token);
  const user2Token = user2Res.token;

  // 6. User 2 fetches chats -> MUST receive empty list, NEVER the owner's chats!
  const user2ChatsRes = await fetch(`http://127.0.0.1:${port}/api/v1/chats`, {
    headers: { authorization: `Bearer ${user2Token}` },
  });
  assert.equal(user2ChatsRes.status, 200);
  const user2Chats = await user2ChatsRes.json();
  assert.deepEqual(user2Chats.chats, []);

  // 7. User 2 trying to access owner's chat directly -> 404
  const chatToAccess = ownerChats.chats[0].id;
  const directAccessRes = await fetch(`http://127.0.0.1:${port}/api/v1/chats/${encodeURIComponent(chatToAccess)}/messages`, {
    headers: { authorization: `Bearer ${user2Token}` },
  });
  assert.equal(directAccessRes.status, 404);
});
