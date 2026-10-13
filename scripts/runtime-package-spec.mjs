import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

// Production resources/app contains only files executed or rendered by the
// desktop product. Tests, source-only release tooling, Go source, generated
// caches and documentation remain in the audited repository, not the shipped
// runtime. Keep this list explicit so a new file cannot silently enter a build.
export const PRODUCTION_RUNTIME_PATHS = Object.freeze([
  "package.json",
  "config/cloud-closed-pilot.json",
  "apps/client/admin-presentation.mjs",
  "apps/client/app.js",
  "apps/client/assets",
  "apps/client/autonomy-presentation.mjs",
  "apps/client/chat-presentation.mjs",
  "apps/client/composer-safety.mjs",
  "apps/client/index.html",
  "apps/client/media-presentation.mjs",
  "apps/client/manifest.webmanifest",
  "apps/client/pairing-presentation.mjs",
  "apps/client/pwa-register.mjs",
  "apps/client/relay-protocol.mjs",
  "apps/client/relay-device.mjs",
  "apps/client/service-worker.js",
  "apps/client/styles.css",
  "apps/client/web-auth-contract.mjs",
  "apps/client/web-auth.mjs",
  "apps/client/web-session.mjs",
  "apps/client/web-hosted.mjs",
  "bin/mycrobo-live-bridge.exe",
  "contracts/local-translation.mjs",
  "desktop/electron/account-profiles.cjs",
  "desktop/electron/auto-send-bootstrap.cjs",
  "desktop/electron/app-root.cjs",
  "desktop/electron/control-plane.cjs",
  "desktop/electron/cloud-relay-identity.cjs",
  "desktop/electron/linked-device-session.cjs",
  "desktop/electron/login-state.mjs",
  "desktop/electron/login.css",
  "desktop/electron/login.html",
  "desktop/electron/login.js",
  "desktop/electron/main.cjs",
  "desktop/electron/model-credential.cjs",
  "desktop/electron/platform-admin-presentation.mjs",
  "desktop/electron/platform-admin.css",
  "desktop/electron/platform-admin.html",
  "desktop/electron/platform-admin.js",
  "desktop/electron/platform-admin-preload.cjs",
  "desktop/electron/preload.cjs",
  "desktop/electron/runtime-lifecycle.cjs",
  "desktop/electron/splash.html",
  "desktop/electron/tenant-registry.cjs",
  "desktop/electron/tenant-storage.cjs",
  "packages/core/approval.ts",
  "packages/core/auto-send-authorization.ts",
  "packages/core/auto-send-policy.ts",
  "packages/core/auto-send-safety-context.ts",
  "packages/core/autonomy-policy.ts",
  "packages/core/behavioral-dna.ts",
  "packages/core/candidates.ts",
  "packages/core/conversation-backtest.ts",
  "packages/core/conversation.ts",
  "packages/core/domain.ts",
  "packages/core/draft.ts",
  "packages/core/graph-grounded-context.ts",
  "packages/core/identity.ts",
  "packages/core/media-reasoning.ts",
  "packages/core/personalization-learning.ts",
  "packages/core/phrase-bank.ts",
  "packages/core/relationship.ts",
  "packages/core/retrieval.ts",
  "packages/core/scenario-forest.ts",
  "packages/core/scenarios.ts",
  "packages/core/style-policy.ts",
  "packages/core/tone.ts",
  "services/gateway/bridge-source.mjs",
  "services/gateway/auto-send-bridge-delivery.mjs",
  "services/gateway/auto-send-host-bootstrap.mjs",
  "services/gateway/auto-send-coordinator.mjs",
  "services/gateway/auto-send-gateway-runtime.mjs",
  "services/gateway/auto-send-ledger.mjs",
  "services/gateway/auto-send-outbox.mjs",
  "services/gateway/auto-send-runtime.mjs",
  "services/gateway/context-sources.mjs",
  "services/gateway/draft-provider.mjs",
  "services/gateway/fixture-data.mjs",
  "services/gateway/google-context-connector.mjs",
  "services/gateway/google-workspace-contracts.mjs",
  "services/gateway/gateway-authorization.mjs",
  "services/gateway/history-diagnostics.mjs",
  "services/gateway/local-translator.mjs",
  "services/gateway/model-policy.mjs",
  "services/gateway/parent-watchdog.mjs",
  "services/gateway/product-intelligence.mjs",
  "services/gateway/runtime-security.mjs",
  "services/gateway/server.mjs",
  "services/gateway/usage-meter.mjs",
  "services/gateway/user-state.mjs",
  "services/gateway/workspace-items.mjs",
  "services/translator/README.md",
  "services/translator/requirements.txt",
  "services/translator/translategemma_service.py",
]);

export const MANAGED_RUNTIME_ROOTS = Object.freeze([
  "package.json", "apps", "branding", "config", "contracts", "desktop", "packages", "services", "scripts", "bin",
]);

function normalized(path) {
  return path.split(sep).join("/");
}

async function filesUnder(root, path) {
  const absolute = resolve(root, path);
  const entries = await readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const next = resolve(absolute, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(root, relative(root, next)));
    else if (entry.isFile()) files.push(normalized(relative(root, next)));
  }
  return files;
}

export async function productionRuntimeFiles(root) {
  const files = [];
  for (const path of PRODUCTION_RUNTIME_PATHS) {
    const absolute = resolve(root, path);
    const info = await stat(absolute);
    if (info.isDirectory()) files.push(...await filesUnder(root, path));
    else if (info.isFile()) files.push(normalized(path));
  }
  return [...new Set(files)].sort();
}

async function resolveSourceDependency(root, importer, reference) {
  const base = resolve(root, dirname(importer), reference);
  for (const candidate of [base, `${base}.mjs`, `${base}.cjs`, `${base}.js`, `${base}.ts`]) {
    try {
      if ((await stat(candidate)).isFile()) return normalized(relative(root, candidate));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return "";
}

export async function runtimeDependencyIssues(root, suppliedFiles = null) {
  const files = suppliedFiles || await productionRuntimeFiles(root);
  const inventory = new Set(files);
  const issues = [];
  for (const importer of files.filter((path) => /\.(?:mjs|cjs|js|ts)$/u.test(path))) {
    const source = await readFile(resolve(root, importer), "utf8");
    const relativeReferences = [...source.matchAll(/(?:from\s+|require\s*\(|import\s*\()\s*["'](\.{1,2}\/[^"']+)["']/gu)]
      .map((match) => match[1]);
    for (const reference of relativeReferences) {
      const dependency = await resolveSourceDependency(root, importer, reference);
      if (!dependency || !inventory.has(dependency)) issues.push({ importer, reference, dependency });
    }
  }
  return issues;
}

export function assertProductionRuntimePath(path) {
  const value = String(path || "").replaceAll("\\", "/");
  if (!value || value.startsWith("/") || value.includes("../") || value.includes("/../") || value === "..") {
    throw new Error(`Unsafe production runtime path: ${value || "<empty>"}`);
  }
  if (/(?:^|\/)(?:__pycache__|\.test-bin|node_modules)(?:\/|$)/u.test(value)
      || /(?:\.test\.(?:mjs|cjs|js)|_test\.go|test_[^/]*\.py|\.pyc|\.not-shipped)$/u.test(value)) {
    throw new Error(`Development-only file cannot be packaged: ${value}`);
  }
  return value;
}
