import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

test("every source entry point prepares the ignored live bridge artifact", async () => {
  const packageJSON = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const scripts = packageJSON.scripts || {};
  assert.equal(scripts["bridge:build"], "node scripts/build-live-bridge.mjs");
  for (const name of ["test", "desktop:start", "verify:package", "package:sync", "release:manifest"]) {
    assert.match(scripts[name] || "", /^node scripts\/build-live-bridge\.mjs --if-needed && /u, `${name} can run without preparing the bridge`);
  }
});

test("CI uses the same bridge builder as local source setup", async () => {
  const workflow = await readFile(resolve(root, ".github", "workflows", "quality.yml"), "utf8");
  assert.match(workflow, /run: pnpm run bridge:build/u);
  assert.match(workflow, /uses: actions\/upload-artifact@v7[\s\S]*name: mycrobo-live-bridge-windows[\s\S]*path: bin\/mycrobo-live-bridge\.exe/u);
  assert.match(workflow, /if-no-files-found: error/u);
});
