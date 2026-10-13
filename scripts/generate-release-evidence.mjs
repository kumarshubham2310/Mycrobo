import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(process.cwd());
const manifestPath = resolve(root, "BUILD_MANIFEST.json");
const outputPath = resolve(root, "docs/rebuild/world-class-evidence-ledger.json");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
let previous = null;
try {
  previous = JSON.parse(await readFile(outputPath, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

// Evidence is never inferred from source labels or an ordinary local test run.
// Preserve only previously attached records for this exact version; the
// readiness contract will independently reject stale, expired, non-independent
// or artifact-mismatched records.
const sameVersion = String(previous?.exactBuildVersion || "") === String(manifest.version || "");
const ledger = {
  schema: "mycrobo-world-class-evidence-ledger.1",
  exactBuildVersion: String(manifest.version || ""),
  exactArtifactSha256: String(manifest.hashes?.["release-bundle"]?.sha256 || ""),
  generatedAt: new Date().toISOString(),
  evidence: sameVersion && Array.isArray(previous?.evidence) ? previous.evidence : [],
  note: "No pass is created automatically. Evidence must be attached to the exact release artifact by an authorized or independent verifier as required.",
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  ok: true,
  output: outputPath,
  exactBuildVersion: ledger.exactBuildVersion,
  evidenceRecordsPreserved: ledger.evidence.length,
  exactArtifactBound: Boolean(ledger.exactArtifactSha256),
}, null, 2));
