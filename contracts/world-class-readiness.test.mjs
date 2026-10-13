import assert from "node:assert/strict";
import test from "node:test";
import { evaluateDistributionReadiness, evaluateReadinessRequirements } from "./world-class-readiness.mjs";

const requirement = {
  id: "WCP-0001",
  title: "Exact-build test",
  domain: "release",
  requiresExactArtifact: true,
  requiresIndependent: true,
  requiresAuthority: true,
};

test("readiness cannot pass on a label without exact, independent and authoritative evidence", () => {
  const result = evaluateReadinessRequirements({
    requirements: [requirement],
    artifact: { sha256: "a".repeat(64) },
    evidence: [{
      requirementId: "WCP-0001",
      status: "passed",
      evidenceId: "report-1",
      verifiedAt: "2026-09-13T00:00:00.000Z",
      artifactSha256: "b".repeat(64),
    }],
    nowMs: Date.parse("2026-09-13T01:00:00.000Z"),
  });
  assert.equal(result.decision, "NO-GO");
  assert.equal(result.missing, 1);
  assert.deepEqual(result.results[0].reasons, [
    "exact-artifact-mismatch",
    "independent-verification-missing",
    "authority-approval-missing",
  ]);
});

test("readiness reaches zero missing only when every registered requirement has valid evidence", () => {
  const hash = "c".repeat(64);
  const result = evaluateReadinessRequirements({
    requirements: [requirement],
    artifact: { sha256: hash },
    evidence: [{
      requirementId: "WCP-0001",
      status: "passed",
      evidenceId: "independent-report-1",
      verifiedAt: "2026-09-13T00:00:00.000Z",
      artifactSha256: hash,
      independent: true,
      authorityReference: "approval-record-1",
    }],
  });
  assert.equal(result.decision, "GO");
  assert.equal(result.missing, 0);
});

test("unsigned alpha artifacts cannot be described as distribution ready", () => {
  const result = evaluateDistributionReadiness({
    manifest: {
      version: "1.0.0-alpha.27",
      distribution: { signed: false, installer: false, updater: false },
      verification: {},
    },
    exactArtifactSha256: "d".repeat(64),
  });
  assert.equal(result.missing, 10);
  assert.equal(result.checks.find((item) => item.id === "exact-artifact-hash").passed, true);
});

test("a reproducible-build label cannot pass without clean, pinned provenance", () => {
  const result = evaluateDistributionReadiness({
    manifest: {
      version: "1.0.0",
      distribution: { signed: true, installer: true, updater: true },
      provenance: { sourceTreeClean: false },
      verification: { reproducibleBuild: true },
    },
    exactArtifactSha256: "e".repeat(64),
  });
  assert.equal(result.checks.find((item) => item.id === "reproducible-build").passed, false);
});
