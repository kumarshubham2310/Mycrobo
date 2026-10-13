import assert from "node:assert/strict";
import test from "node:test";
import { loginMode, userFacingAuthError, validateLoginInput } from "./login-state.mjs";

test("login mode fails closed and recognizes first-time setup", () => {
  assert.equal(loginMode(null), "login");
  assert.equal(loginMode({ bootstrapRequired: true }), "bootstrap");
  assert.equal(loginMode({ authenticated: true, bootstrapRequired: true }), "authenticated");
});

test("credentials require normalized email and a nontrivial password", () => {
  assert.deepEqual(validateLoginInput({ email: " USER@Example.com ", password: "long-passphrase" }), { email: "user@example.com", password: "long-passphrase" });
  assert.throws(() => validateLoginInput({ email: "user@example.com", password: "short" }), /12 characters/u);
  assert.throws(() => validateLoginInput({ email: "not-an-email", password: "long-passphrase" }), /valid email/u);
});

test("bootstrap requires human name and supports optional workspace name", () => {
  assert.deepEqual(validateLoginInput({ email: "owner@example.com", password: "long-passphrase", displayName: " Owner ", tenantName: " My team " }, { bootstrap: true }), { email: "owner@example.com", password: "long-passphrase", displayName: "Owner", tenantName: "My team" });
  assert.deepEqual(validateLoginInput({ email: "owner@example.com", password: "long-passphrase", displayName: " Owner " }, { bootstrap: true }), { email: "owner@example.com", password: "long-passphrase", displayName: "Owner", tenantName: "Owner's workspace" });
  assert.throws(() => validateLoginInput({ email: "owner@example.com", password: "long-passphrase" }, { bootstrap: true }), /name/u);
  assert.match(userFacingAuthError({ code: "RATE_LIMITED" }), /Too many attempts/u);
});

test("authentication errors never expose safeStorage or remote IPC internals", () => {
  const vault = userFacingAuthError(new Error("Error invoking remote method 'mycrobo:sign-in': Error while decrypting the ciphertext provided to safeStorage.decryptString."));
  assert.match(vault, /private vault could not be unlocked/u);
  assert.doesNotMatch(vault, /safeStorage|ciphertext|remote method/iu);
  const remote = userFacingAuthError(new Error("Error invoking remote method 'mycrobo:sign-in': Error: internal detail"));
  assert.match(remote, /could not open this workspace/u);
  assert.doesNotMatch(remote, /remote method|internal detail/iu);
  const exists = userFacingAuthError(new Error("Error invoking remote method 'mycrobo:bootstrap-owner': Error: An account with this email already exists. Sign in instead."));
  assert.equal(exists, "An account with this email already exists. Sign in instead.");
  const pwd = userFacingAuthError(new Error("Error invoking remote method 'mycrobo:bootstrap-owner': Error: Use at least 12 characters with an uppercase letter, a lowercase letter and a number."));
  assert.equal(pwd, "Use at least 12 characters with an uppercase letter, a lowercase letter and a number.");
});
