import assert from "node:assert/strict";
import { copyFile, mkdir, realpath, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { assertProductionRuntimePath, MANAGED_RUNTIME_ROOTS, productionRuntimeFiles } from "./runtime-package-spec.mjs";

const source = await realpath(resolve(process.cwd()));
const suppliedTarget = String(process.env.MYCROBO_PACKAGE_APP || "").trim();
assert.ok(suppliedTarget, "Set MYCROBO_PACKAGE_APP to the exact packaged resources/app directory.");
const target = await realpath(resolve(suppliedTarget));
assert.notEqual(source.toLocaleLowerCase(), target.toLocaleLowerCase(), "Source and package directories must differ.");
assert.match(target.replaceAll("\\", "/"), /MyCroboReboot-[^/]+\/resources\/app$/iu, "Refusing to sync outside an explicit MyCrobo resources/app directory.");
if (!process.argv.includes("--apply")) {
  console.log(JSON.stringify({ ok: true, dryRun: true, source, target, note: "Re-run with --apply after creating a verified package backup." }, null, 2));
  process.exit(0);
}
await mkdir(target, { recursive: true });
// The target was resolved and constrained to an explicit resources/app above.
// Remove only managed package-code roots so stale tests or generated caches
// cannot survive a release sync. Protected Electron user data is elsewhere and
// is never in this list.
for (const entry of MANAGED_RUNTIME_ROOTS) {
  await rm(resolve(target, entry), { recursive: true, force: true });
}
const runtimeFiles = await productionRuntimeFiles(source);
for (const file of runtimeFiles) {
  assertProductionRuntimePath(file);
  const destination = resolve(target, file);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(resolve(source, file), destination);
}
console.log(JSON.stringify({
  ok: true,
  dryRun: false,
  source,
  target,
  copiedFiles: runtimeFiles.length,
  excluded: ["tests", "generated caches", "source-only release tooling", "Go source", "development documentation", ".git", ".github", "node_modules", "audit", "docs"],
}, null, 2));
