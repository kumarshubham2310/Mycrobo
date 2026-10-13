import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const root = resolve(process.cwd());
const run = promisify(execFile);
const packageJSON = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const artifact = String(process.env.MYCROBO_RELEASE_ARTIFACT || "").trim();
const bridge = resolve(root, "bin/mycrobo-live-bridge.exe");
const runtimeEvidencePath = resolve(root, "docs/rebuild/release-evidence-current.json");
const digestFile = async (path) => {
  try {
    await access(path);
    const bytes = await readFile(path);
    return { bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") };
  } catch { return null; }
};
const hashes = {};
const sourceDigest = async (path) => {
  const result = await digestFile(resolve(root, path));
  return result?.sha256 || null;
};
const bridgeHash = await digestFile(bridge);
if (bridgeHash) hashes["bin/mycrobo-live-bridge.exe"] = bridgeHash;
if (artifact) {
  const artifactHash = await digestFile(resolve(artifact));
  if (artifactHash) hashes["MyCroboReboot.exe"] = artifactHash;
}
try {
  const runtimeEvidence = JSON.parse(await readFile(runtimeEvidencePath, "utf8"));
  if (runtimeEvidence.version !== packageJSON.version) {
    throw new Error(`Runtime evidence version ${runtimeEvidence.version} does not match ${packageJSON.version}.`);
  }
  const runtimeEntries = Object.entries(runtimeEvidence.hashes || {})
    .map(([path, value]) => [path.replaceAll("\\\\", "/"), String(value?.sha256 || "").toLowerCase()])
    .filter(([, sha256]) => /^[a-f0-9]{64}$/u.test(sha256))
    .sort(([left], [right]) => left.localeCompare(right));
  if (runtimeEntries.length === 0) throw new Error("Runtime evidence contains no file hashes.");
  const runtimeTreeSha256 = createHash("sha256")
    .update(runtimeEntries.map(([path, sha256]) => `${path}\0${sha256}\n`).join(""))
    .digest("hex");
  hashes["resources/app.runtime-tree"] = { files: runtimeEntries.length, sha256: runtimeTreeSha256 };
} catch (error) {
  if (process.env.MYCROBO_REQUIRE_RUNTIME_EVIDENCE === "1") throw error;
}
if (hashes["MyCroboReboot.exe"] && hashes["resources/app.runtime-tree"] && hashes["bin/mycrobo-live-bridge.exe"]) {
  const releaseBundleSha256 = createHash("sha256")
    .update([
      hashes["MyCroboReboot.exe"].sha256,
      hashes["resources/app.runtime-tree"].sha256,
      hashes["bin/mycrobo-live-bridge.exe"].sha256,
    ].join("\0"))
    .digest("hex");
  hashes["release-bundle"] = {
    components: ["MyCroboReboot.exe", "resources/app.runtime-tree", "bin/mycrobo-live-bridge.exe"],
    sha256: releaseBundleSha256,
  };
}
const sourceFiles = Number(process.env.MYCROBO_SECURITY_FILES || 0);
const nodeTests = Number(process.env.MYCROBO_NODE_TEST_TOTAL || 0);
const parityFiles = Number(process.env.MYCROBO_PARITY_FILES || 0);
let sourceRevision = null;
let sourceTreeClean = false;
try {
  sourceRevision = (await run("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim() || null;
  sourceTreeClean = (await run("git", ["status", "--porcelain"], { cwd: root })).stdout.trim() === "";
} catch { /* source archives may intentionally omit Git metadata */ }
const manifest = {
  schemaVersion: "3.0",
  product: "MyCrobo",
  version: packageJSON.version,
  generatedAt: new Date().toISOString(),
  mode: process.env.MYCROBO_MANIFEST_MODE || "local-internal-alpha",
  distribution: {
    kind: "portable-internal-alpha",
    signed: false,
    installer: false,
    updater: false,
  },
  provenance: {
    sourceRevision,
    sourceTreeClean,
    sourceDateEpoch: String(process.env.SOURCE_DATE_EPOCH || "").trim() || null,
    toolchain: {
      node: process.version,
      packageManager: String(process.env.npm_config_user_agent || "").trim() || null,
      go: String(process.env.MYCROBO_GO_VERSION || "").trim() || null,
      electron: String(process.env.MYCROBO_ELECTRON_VERSION || "").trim() || null,
      wrapperProduct: String(process.env.MYCROBO_WRAPPER_VERSION || "").trim() || null,
    },
    recipeHashes: {
      manifestGenerator: await sourceDigest("scripts/generate-build-manifest.mjs"),
      evidenceGenerator: await sourceDigest("scripts/generate-release-evidence.mjs"),
      runtimePackageSpec: await sourceDigest("scripts/runtime-package-spec.mjs"),
      packageSynchronizer: await sourceDigest("scripts/sync-package-source.mjs"),
      packageVerifier: await sourceDigest("scripts/verify-package.mjs"),
      readinessContract: await sourceDigest("contracts/world-class-readiness.mjs"),
      readinessAuditor: await sourceDigest("scripts/audit-production-readiness.mjs"),
      qualityWorkflow: await sourceDigest(".github/workflows/quality.yml"),
      lockfile: await sourceDigest("pnpm-lock.yaml"),
    },
  },
  hashes,
  verification: {
    nodeTests: nodeTests > 0 ? { passed: nodeTests, failed: 0 } : { status: "not-recorded-in-this-run" },
    goBridgeTests: process.env.MYCROBO_GO_TESTS || "not-recorded-in-this-run",
    goVet: process.env.MYCROBO_GO_VET || "not-recorded-in-this-run",
    sourceSecurityScan: sourceFiles > 0 ? { files: sourceFiles, findings: 0 } : { status: "not-recorded-in-this-run" },
    packageCriticalSourceParity: parityFiles > 0 ? { files: parityFiles, status: "passed" } : { status: "not-recorded-in-this-run" },
    rollbackTested: false,
    reproducibleBuild: false,
    realWhatsAppOutboundTested: false,
    realWhatsAppMessageSentDuringVerification: false,
    fullWhatsAppLifetimeHistoryProven: false,
    ownerRatedPersonalizationGateComplete: false,
  },
  releaseClaim: "Internal review-only alpha. Automatic sending remains disabled. This unsigned portable build is not approved for public production release.",
};
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
const sourceManifestPath = resolve(root, "BUILD_MANIFEST.json");
await writeFile(sourceManifestPath, manifestText, "utf8");
let packagedManifestPath = null;
if (hashes["MyCroboReboot.exe"] && artifact) {
  const candidate = resolve(dirname(resolve(artifact)), "BUILD_MANIFEST.json");
  if (candidate !== sourceManifestPath) {
    await writeFile(candidate, manifestText, "utf8");
    packagedManifestPath = candidate;
  }
}
console.log(JSON.stringify({
  ok: true,
  version: manifest.version,
  hashes: Object.keys(hashes).length,
  packagedManifestMirrored: Boolean(packagedManifestPath),
}, null, 2));
