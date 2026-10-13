import { createHash, sign, verify } from "node:crypto";

export const UPDATE_MANIFEST_SCHEMA = "mycrobo-update.1";

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function versionParts(version) {
  const match = /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:-([0-9A-Za-z.-]+))?$/u.exec(String(version || ""));
  if (!match) throw new Error("A valid semantic version is required.");
  return { numbers: match.slice(1, 4).map(Number), prerelease: match[4] || "" };
}

export function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 3; index += 1) if (a.numbers[index] !== b.numbers[index]) return Math.sign(a.numbers[index] - b.numbers[index]);
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, "en", { numeric: true });
}

function validatePayload(payload) {
  if (payload.schema !== UPDATE_MANIFEST_SCHEMA) throw new Error("The update manifest schema is unsupported.");
  versionParts(payload.version);
  versionParts(payload.minimumVersion);
  if (!["internal", "pilot", "stable"].includes(payload.channel)) throw new Error("The update channel is invalid.");
  if (!/^[A-F0-9]{64}$/u.test(payload.artifactSha256)) throw new Error("A SHA-256 artifact digest is required.");
  if (!Number.isSafeInteger(payload.artifactBytes) || payload.artifactBytes < 1) throw new Error("The artifact size is invalid.");
  const url = new URL(payload.artifactUrl);
  if (url.protocol !== "https:") throw new Error("Production updates require HTTPS.");
  if (!Number.isFinite(Date.parse(payload.createdAt)) || !Number.isFinite(Date.parse(payload.expiresAt))) throw new Error("Valid manifest timestamps are required.");
  return payload;
}

export function signUpdateManifest(payload, privateKey) {
  const normalized = validatePayload({ ...payload, schema: UPDATE_MANIFEST_SCHEMA });
  const signature = sign(null, Buffer.from(canonical(normalized)), privateKey).toString("base64");
  return Object.freeze({ payload: normalized, signature, signatureAlgorithm: "Ed25519" });
}

export function verifyUpdateManifest({ envelope, publicKey, currentVersion, channel, nowMs = Date.now() }) {
  if (envelope?.signatureAlgorithm !== "Ed25519" || !envelope.signature) throw new Error("The update signature is missing or unsupported.");
  const payload = validatePayload(envelope.payload);
  const signatureValid = verify(null, Buffer.from(canonical(payload)), publicKey, Buffer.from(envelope.signature, "base64"));
  if (!signatureValid) throw new Error("The update manifest signature is invalid.");
  if (payload.channel !== channel) throw new Error("The update belongs to a different release channel.");
  if (nowMs > Date.parse(payload.expiresAt)) throw new Error("The update manifest expired.");
  if (compareVersions(currentVersion, payload.minimumVersion) < 0) throw new Error("The installed version cannot safely apply this update directly.");
  if (compareVersions(payload.version, currentVersion) <= 0) throw new Error("Downgrades and same-version replacement are blocked.");
  return Object.freeze({ accepted: true, payload });
}

export function verifyArtifactBytes(bytes, payload) {
  if (bytes.length !== payload.artifactBytes) throw new Error("The downloaded update size does not match the signed manifest.");
  const digest = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  if (digest !== payload.artifactSha256) throw new Error("The downloaded update hash does not match the signed manifest.");
  return true;
}

