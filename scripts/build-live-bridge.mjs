import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(root, "services", "whatsapp-bridge");
const output = resolve(root, "bin", process.platform === "win32" ? "mycrobo-live-bridge.exe" : "mycrobo-live-bridge");
const buildOnlyWhenNeeded = process.argv.includes("--if-needed");

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (entry.isFile() && (entry.name.endsWith(".go") || entry.name === "go.mod" || entry.name === "go.sum")) files.push(path);
  }
  return files;
}

function isCurrent() {
  if (!existsSync(output)) return false;
  const artifact = statSync(output);
  if (!artifact.isFile() || artifact.size === 0) return false;
  const newestSource = Math.max(...sourceFiles(sourceRoot).map((path) => statSync(path).mtimeMs));
  return artifact.mtimeMs >= newestSource;
}

if (buildOnlyWhenNeeded && isCurrent()) {
  console.log(`MyCrobo live bridge is ready: ${relative(root, output)}`);
  process.exit(0);
}

mkdirSync(dirname(output), { recursive: true });
const temporary = `${output}.building-${process.pid}`;
rmSync(temporary, { force: true });

const build = spawnSync("go", ["build", "-trimpath", "-o", temporary, "./cmd/livebridge"], {
  cwd: sourceRoot,
  env: process.env,
  stdio: "inherit",
  windowsHide: true,
});

if (build.error) {
  rmSync(temporary, { force: true });
  if (build.error.code === "ENOENT") {
    console.error("Go is required to build MyCrobo's private WhatsApp bridge. Install the Go version declared in services/whatsapp-bridge/go.mod, then run `pnpm run bridge:build` again.");
  } else {
    console.error(`The MyCrobo live bridge could not be built: ${build.error.message}`);
  }
  process.exit(1);
}
if (build.status !== 0) {
  rmSync(temporary, { force: true });
  process.exit(build.status || 1);
}

try {
  const artifact = statSync(temporary);
  if (!artifact.isFile() || artifact.size === 0) throw new Error("the compiler produced an empty artifact");
  if (existsSync(output)) {
    try {
      rmSync(output, { force: true });
    } catch {
      const backup = `${output}.stale-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
      renameSync(output, backup);
      try { rmSync(backup, { force: true }); } catch { /* locked by running process; kept until exit */ }
    }
  }
  renameSync(temporary, output);
} catch (error) {
  rmSync(temporary, { force: true });
  console.error(`The MyCrobo live bridge artifact could not be finalized. Close any running MyCrobo instance and retry. ${error.message}`);
  process.exit(1);
}

console.log(`Built MyCrobo live bridge: ${relative(root, output)}`);
