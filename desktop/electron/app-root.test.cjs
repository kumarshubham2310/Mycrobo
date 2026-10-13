const assert = require("node:assert/strict");
const test = require("node:test");
const { join, resolve } = require("node:path");

const { resolveApplicationRoot } = require("./app-root.cjs");

test("source launch resolves the repository root instead of nesting desktop/electron twice", () => {
  const sourceDirectory = join("C:\\workspace", "desktop", "electron");
  assert.equal(resolveApplicationRoot({
    isPackaged: false,
    appPath: sourceDirectory,
    sourceDirectory,
  }), resolve("C:\\workspace"));
});

test("packaged launch trusts Electron's packaged application root", () => {
  const packaged = join("C:\\portable", "resources", "app");
  assert.equal(resolveApplicationRoot({
    isPackaged: true,
    appPath: packaged,
    sourceDirectory: join("C:\\ignored", "desktop", "electron"),
  }), resolve(packaged));
});

test("development resolution fails closed without a source directory", () => {
  assert.throws(() => resolveApplicationRoot({ isPackaged: false, appPath: "C:\\wrong" }), /source directory/u);
});
