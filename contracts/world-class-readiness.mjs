const STATUS = new Set(["passed", "failed", "blocked", "not-run"]);

function clean(value) {
  return String(value || "").trim();
}

function validIso(value) {
  return Boolean(value) && Number.isFinite(Date.parse(value));
}

export function evaluateReadinessRequirements({
  requirements,
  evidence = [],
  artifact = {},
  nowMs = Date.now(),
}) {
  if (!Array.isArray(requirements) || requirements.length === 0) {
    throw new Error("At least one production requirement is required.");
  }
  const ids = new Set();
  for (const requirement of requirements) {
    const id = clean(requirement?.id);
    if (!id || ids.has(id)) throw new Error("Production requirement IDs must be present and unique.");
    ids.add(id);
  }

  const evidenceById = new Map();
  for (const record of evidence) {
    const id = clean(record?.requirementId);
    if (!ids.has(id)) throw new Error(`Evidence references unknown requirement ${id || "(missing)"}.`);
    if (evidenceById.has(id)) throw new Error(`Evidence for ${id} must be consolidated into one record.`);
    if (!STATUS.has(record.status)) throw new Error(`Evidence for ${id} has an invalid status.`);
    evidenceById.set(id, record);
  }

  const exactArtifactHash = clean(artifact.sha256).toLowerCase();
  const results = requirements.map((requirement) => {
    const record = evidenceById.get(requirement.id);
    const reasons = [];
    if (!record) reasons.push("evidence-not-attached");
    else {
      if (record.status !== "passed") reasons.push(`status:${record.status}`);
      if (!clean(record.evidenceId)) reasons.push("evidence-id-missing");
      if (!validIso(record.verifiedAt)) reasons.push("verification-time-invalid");
      if (record.expiresAt && (!validIso(record.expiresAt) || Date.parse(record.expiresAt) <= nowMs)) reasons.push("evidence-expired");
      if (requirement.requiresExactArtifact === true) {
        const evidenceHash = clean(record.artifactSha256).toLowerCase();
        if (!exactArtifactHash || evidenceHash !== exactArtifactHash) reasons.push("exact-artifact-mismatch");
      }
      if (requirement.requiresIndependent === true && record.independent !== true) reasons.push("independent-verification-missing");
      if (requirement.requiresAuthority === true && !clean(record.authorityReference)) reasons.push("authority-approval-missing");
    }
    return Object.freeze({
      id: requirement.id,
      title: requirement.title,
      domain: requirement.domain,
      passed: reasons.length === 0,
      reasons,
      evidenceId: clean(record?.evidenceId) || null,
    });
  });

  const missing = results.filter((result) => !result.passed);
  return Object.freeze({
    total: results.length,
    passed: results.length - missing.length,
    missing: missing.length,
    decision: missing.length === 0 ? "GO" : "NO-GO",
    claim: missing.length === 0
      ? "All registered production requirements passed for the exact artifact."
      : "MyCrobo is not yet production-ready.",
    results,
  });
}

export function evaluateDistributionReadiness({ manifest = {}, exactArtifactSha256 = "" }) {
  const checks = [
    ["stable-version", !String(manifest.version || "").includes("-")],
    ["signed", manifest.distribution?.signed === true],
    ["installer", manifest.distribution?.installer === true],
    ["secure-updater", manifest.distribution?.updater === true],
    ["rollback-tested", manifest.verification?.rollbackTested === true],
    ["reproducible-build", manifest.verification?.reproducibleBuild === true
      && manifest.provenance?.sourceTreeClean === true
      && /^[a-f0-9]{40,64}$/iu.test(String(manifest.provenance?.sourceRevision || ""))
      && Boolean(manifest.provenance?.sourceDateEpoch)
      && Object.values(manifest.provenance?.recipeHashes || {}).every((value) => /^[a-f0-9]{64}$/iu.test(String(value || "")))],
    ["exact-artifact-hash", /^[a-f0-9]{64}$/iu.test(exactArtifactSha256)],
    ["real-profile-certified", manifest.verification?.realProfileCertified === true],
    ["full-history-truth-certified", manifest.verification?.fullWhatsAppLifetimeHistoryProven === true],
    ["owner-personalization-certified", manifest.verification?.ownerRatedPersonalizationGateComplete === true],
    ["controlled-send-certified", manifest.verification?.controlledSendSafetyCertified === true],
  ].map(([id, passed]) => ({ id, passed }));
  const missing = checks.filter((check) => !check.passed);
  return Object.freeze({ total: checks.length, passed: checks.length - missing.length, missing: missing.length, checks });
}
