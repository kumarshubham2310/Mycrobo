import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { assertProductionRuntimePath, MANAGED_RUNTIME_ROOTS, productionRuntimeFiles } from "./runtime-package-spec.mjs";

const root = resolve(process.cwd());
const packagedRoot = resolve(process.env.MYCROBO_PACKAGE_APP || "");
assert.ok(process.env.MYCROBO_PACKAGE_APP, "Set MYCROBO_PACKAGE_APP to the exact packaged resources/app directory.");
await access(packagedRoot);

async function filesUnder(base, path) {
  const absolute = resolve(base, path);
  const entries = await readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const next = resolve(absolute, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(base, relative(base, next)));
    else if (entry.isFile()) files.push(relative(base, next).replaceAll("\\", "/"));
  }
  return files;
}
const required = await productionRuntimeFiles(root);
for (const file of required) assertProductionRuntimePath(file);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const comparisons = [];
for (const file of required) {
  const source = await readFile(resolve(root, file));
  const packaged = await readFile(resolve(packagedRoot, file));
  const sourceHash = digest(source);
  const packagedHash = digest(packaged);
  comparisons.push({ file, bytes: source.byteLength, sha256: sourceHash });
  assert.equal(packaged.byteLength, source.byteLength, `${file} byte length differs from source.`);
  assert.equal(packagedHash, sourceHash, `${file} hash differs from source.`);
}

const packagedFiles = [];
for (const entry of MANAGED_RUNTIME_ROOTS) {
  try {
    const info = await import("node:fs/promises").then(({ stat }) => stat(resolve(packagedRoot, entry)));
    if (info.isDirectory()) packagedFiles.push(...await filesUnder(packagedRoot, entry));
    else if (info.isFile()) packagedFiles.push(entry);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
packagedFiles.sort();
assert.deepEqual(packagedFiles, required, "The packaged runtime inventory contains missing or stale source files.");

console.log(JSON.stringify({ ok: true, packagedRoot, compared: comparisons.length, exactInventory: true, comparisons }, null, 2));
