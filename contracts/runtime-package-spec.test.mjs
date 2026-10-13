import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";

import {
  assertProductionRuntimePath,
  productionRuntimeFiles,
  runtimeDependencyIssues,
} from "../scripts/runtime-package-spec.mjs";

const root = resolve(import.meta.dirname, "..");

test("production runtime inventory excludes tests and generated development artifacts", async () => {
  const files = await productionRuntimeFiles(root);
  assert.ok(files.length >= 60, "An unexpectedly small inventory likely omitted runtime code.");
  assert.ok(files.includes("desktop/electron/main.cjs"));
  assert.ok(files.includes("desktop/electron/preload.cjs"));
  assert.ok(files.includes("desktop/electron/platform-admin-preload.cjs"));
  assert.ok(files.includes("services/gateway/server.mjs"));
  assert.ok(files.includes("services/gateway/gateway-authorization.mjs"));
  assert.ok(files.includes("bin/mycrobo-live-bridge.exe"));
  for (const file of files) assert.doesNotThrow(() => assertProductionRuntimePath(file));
});

test("production runtime inventory is closed over local JavaScript dependencies", async () => {
  const files = await productionRuntimeFiles(root);
  assert.deepEqual(await runtimeDependencyIssues(root, files), []);
});

test("development-only and traversal paths fail closed", () => {
  for (const file of ["../secret", "apps/client/app.test.mjs", "services/translator/__pycache__/worker.pyc", "bin/.test-bin/helper"]) {
    assert.throws(() => assertProductionRuntimePath(file));
  }
});
