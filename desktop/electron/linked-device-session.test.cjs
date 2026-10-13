const test = require("node:test");
const assert = require("node:assert/strict");
const { existsSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { prepareFreshLinkedDeviceSession, resolveLinkedDeviceDatabase } = require("./linked-device-session.cjs");

function workspace() { return mkdtempSync(join(tmpdir(), "mycrobo-linked-session-")); }

test("workspace startup honors an explicit preserved linked-device selection", () => {
  const root = workspace();
  const name = "linked-device.db.relink-E7PPULWRXGQADHQCV2SP2WY36Z.db";
  writeFileSync(join(root, name), "preserved session");
  writeFileSync(join(root, "linked-device.db.selection.json"), JSON.stringify({ version: 1, session: name }));
  assert.equal(resolveLinkedDeviceDatabase(root), join(root, name));
});

test("workspace startup accepts an already encrypted selected session", () => {
  const root = workspace();
  const name = "linked-device.db.relink-RYU42WJ53YEJT6CHGF4ZWGME7S.db";
  writeFileSync(join(root, "linked-device.db.relink-RYU42WJ53YEJT6CHGF4ZWGME7S.vault.db"), "encrypted session");
  writeFileSync(join(root, "linked-device.db.selection.json"), JSON.stringify({ version: 1, session: name }));
  assert.equal(resolveLinkedDeviceDatabase(root), join(root, name));
});

test("invalid missing and traversal selections fail closed to the workspace default", () => {
  for (const value of ["../linked-device.db", "linked-device.db", "linked-device.db.relink-TOO-SHORT.db", "linked-device.db.relink-E7PPULWRXGQADHQCV2SP2WY36Z.db"]) {
    const root = workspace();
    writeFileSync(join(root, "linked-device.db.selection.json"), JSON.stringify({ version: 1, session: value }));
    assert.equal(resolveLinkedDeviceDatabase(root), join(root, "linked-device.db"));
  }
});

test("relinking selects a fresh reversible session without replacing preserved sessions", () => {
  const root = workspace();
  const previous = "linked-device.db.relink-E7PPULWRXGQADHQCV2SP2WY36Z.db";
  writeFileSync(join(root, previous), "preserved session");
  writeFileSync(join(root, "linked-device.db.selection.json"), JSON.stringify({ version: 1, session: previous }));
  const fresh = prepareFreshLinkedDeviceSession(root, { token: "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567" });
  assert.ok(existsSync(join(root, previous)), "the previous session must remain recoverable");
  assert.ok(existsSync(fresh.database), "the new session store must exist before restart");
  assert.equal(readFileSync(fresh.database, "utf8"), "");
  assert.equal(resolveLinkedDeviceDatabase(root), fresh.database);
  const selection = JSON.parse(readFileSync(join(root, "linked-device.db.selection.json"), "utf8"));
  assert.equal(selection.reason, "user-requested-relink");
  assert.equal(selection.session, fresh.name);
});
