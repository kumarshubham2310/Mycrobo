import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["--experimental-strip-types", "--test", "apps/client/chat-presentation.test.mjs", "apps/client/composer-safety.test.mjs", "apps/client/media-presentation.test.mjs", "apps/client/pairing-presentation.test.mjs", "apps/client/shell-source.test.mjs", "services/gateway/desktop-shell.test.mjs"], {
  cwd: process.cwd(),
  encoding: "utf8",
  stdio: "pipe",
});
process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");
assert.equal(result.status, 0, "The non-sending UI verification suite failed.");
console.log(JSON.stringify({ ok: true, mode: "headless-non-sending", outboundCalls: 0 }, null, 2));
