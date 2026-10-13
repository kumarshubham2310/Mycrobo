import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["--experimental-strip-types", "--test", "apps/client/pairing-presentation.test.mjs"], {
  cwd: process.cwd(),
  encoding: "utf8",
  stdio: "pipe",
});
process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");
assert.equal(result.status, 0, "QR/phone pairing presentation verification failed.");
console.log(JSON.stringify({ ok: true, qr: "rendered-by-private-bridge", phoneCode: "eight-character-alphanumeric" }, null, 2));
