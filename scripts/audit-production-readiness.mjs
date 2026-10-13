import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { evaluateDistributionReadiness, evaluateReadinessRequirements } from "../contracts/world-class-readiness.mjs";

const root = resolve(process.cwd());
const readJson = async (path) => JSON.parse(await readFile(resolve(root, path), "utf8"));

function tableRows(markdown, prefix) {
  const rows = [];
  const expression = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|(?:\s*([^|]+?)\s*\|)?$/gmu;
  for (const match of markdown.matchAll(expression)) {
    const rawId = match[1].trim();
    const id = prefix === "MCR"
      ? (/^\d+$/u.test(rawId) ? `MCR-${rawId.padStart(4, "0")}` : null)
      : (/^WCP-\d{4}$/u.test(rawId) ? rawId : null);
    if (!id) continue;
    const title = prefix === "MCR" ? match[2].trim() : match[3].trim();
    rows.push({
      id,
      title,
      domain: prefix === "MCR" ? "MyCrobo 104-point acceptance" : match[2].trim(),
      currentState: prefix === "MCR" ? match[3].trim() : (match[5] || "").trim(),
      requiresExactArtifact: true,
      requiresIndependent: prefix === "WCP" || /independent|security|accessibility|legal|real-device|send certification/iu.test(title),
      requiresAuthority: /Meta|WhatsApp production authorization|legal|sign installers/iu.test(title),
    });
  }
  return rows;
}

const matrix104 = await readFile(resolve(root, "docs/104_POINT_COMPLETION_MATRIX.md"), "utf8");
const matrix1000 = await readFile(resolve(root, "docs/WORLD_CLASS_1000_POINT_AUDIT.md"), "utf8");
const manifest = await readJson("BUILD_MANIFEST.json");
const ledger = await readJson("docs/rebuild/world-class-evidence-ledger.json");
if (String(ledger.exactBuildVersion || "") !== String(manifest.version || "")) {
  throw new Error(`Evidence ledger version ${ledger.exactBuildVersion || "(missing)"} does not match manifest ${manifest.version || "(missing)"}.`);
}
const requirements104 = tableRows(matrix104, "MCR");
const requirements1000 = tableRows(matrix1000, "WCP");
if (requirements104.length !== 104) throw new Error(`The MyCrobo matrix must contain 104 requirements; found ${requirements104.length}.`);
if (requirements1000.length !== 1000) throw new Error(`The world-class matrix must contain 1,000 requirements; found ${requirements1000.length}.`);

// The Electron executable alone does not identify a portable distribution: the
// application code lives under resources/app and the bridge is a separate
// executable. Bind every production claim to the composite release-bundle hash.
const artifactSha256 = String(manifest.hashes?.["release-bundle"]?.sha256 || "");
const requirements = [...requirements104, ...requirements1000];
const gateReport = evaluateReadinessRequirements({
  requirements,
  evidence: ledger.evidence || [],
  artifact: { sha256: artifactSha256 },
});
const distribution = evaluateDistributionReadiness({ manifest, exactArtifactSha256: artifactSha256 });
const report = {
  schema: "mycrobo-world-class-readiness.1",
  generatedAt: new Date().toISOString(),
  exactBuild: { version: manifest.version, artifactSha256 },
  registeredRequirements: {
    mycroboAcceptance: requirements104.length,
    worldClassAudit: requirements1000.length,
    total: requirements.length,
  },
  implementationFoundations: {
    mycroboMarkedComplete: requirements104.filter((item) => /^Complete/iu.test(item.currentState)).length,
    note: "Implementation labels are not production evidence and do not reduce the missing release count.",
  },
  evidence: {
    passed: gateReport.passed,
    missing: gateReport.missing,
    decision: gateReport.decision,
  },
  distribution,
  productionClaimAllowed: gateReport.missing === 0 && distribution.missing === 0,
  claim: gateReport.missing === 0 && distribution.missing === 0
    ? "MyCrobo is a world-class, production-ready product."
    : "MyCrobo is not yet a world-class, production-ready product.",
  missingRequirementIds: gateReport.results.filter((item) => !item.passed).map((item) => item.id),
  missingDistributionChecks: distribution.checks.filter((item) => !item.passed).map((item) => item.id),
};

const output = resolve(root, "docs/rebuild/world-class-readiness-current.json");
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  output,
  registeredRequirements: report.registeredRequirements,
  evidence: report.evidence,
  distribution: { passed: distribution.passed, missing: distribution.missing },
  productionClaimAllowed: report.productionClaimAllowed,
  claim: report.claim,
}, null, 2));

if (process.argv.includes("--require-ready") && !report.productionClaimAllowed) process.exitCode = 1;
