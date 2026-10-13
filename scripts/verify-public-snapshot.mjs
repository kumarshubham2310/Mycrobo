import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { extname, normalize } from "node:path";

const tracked = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);

const forbiddenExtensions = new Set([
  ".exe", ".dll", ".node", ".msi", ".msix", ".appx", ".dmg", ".deb", ".rpm",
  ".zip", ".7z", ".rar", ".tar", ".tgz", ".db", ".sqlite", ".sqlite3", ".p12",
  ".pfx", ".jks", ".safetensors", ".gguf", ".onnx", ".pt", ".pth", ".ckpt"
]);

const forbiddenPath = /(^|\/)(tenants|profiles|user-data|userdata|diagnostics|media-cache|attachments-cache|model-cache|node_modules|repair-backups|package-backups)(\/|$)/iu;
const forbiddenName = /(^|\/)(\.env(?:\..+)?|messages.*\.db.*|linked-device.*\.(?:db|sqlite\d*|bin|json).*|workspace\.db.*|control-plane\.db.*|.*\.vault\.db.*|desktop-session\.bin|platform-admin-session\.bin|model-provider-key\.bin|operations\.jsonl.*)$/iu;

const contentRules = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  ["github-token", /(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})/u],
  ["provider-token", /sk-[A-Za-z0-9_-]{24,}/u],
  ["google-key", /AIza[0-9A-Za-z_-]{30,}/u],
  ["personal-email", new RegExp(["catirth", "mpatel"].join(""), "iu")],
  ["local-user-path", /C:[\\/]Users[\\/]ER(?:[\\/]|$)/iu]
];

const failures = [];
for (const file of tracked) {
  const portable = normalize(file).replaceAll("\\", "/");
  if (forbiddenExtensions.has(extname(portable).toLowerCase())) failures.push(`forbidden-extension:${portable}`);
  if (forbiddenPath.test(portable)) failures.push(`forbidden-path:${portable}`);
  if (forbiddenName.test(portable)) failures.push(`forbidden-name:${portable}`);
  if (statSync(file).size > 5_000_000) continue;
  let text;
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  for (const [rule, pattern] of contentRules) {
    if (pattern.test(text)) failures.push(`${rule}:${portable}`);
  }
  for (const match of text.matchAll(/AKIA[0-9A-Z]{16}/gu)) {
    if (match[0] !== "AKIAIOSFODNN7EXAMPLE") failures.push(`aws-key:${portable}`);
  }
  const isFixture = /(?:\.test\.|\.spec\.|_test\.go$|(^|\/)(test|tests|testdata|fixtures?)(\/|$))/iu.test(portable);
  if (!isFixture && /\d{8,}@[sg]\.whatsapp\.net/u.test(text)) failures.push(`whatsapp-identifier:${portable}`);
}

if (failures.length) {
  console.error("Public snapshot verification failed. Values are intentionally not printed.");
  for (const failure of [...new Set(failures)].sort()) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Public snapshot verification passed for ${tracked.length} tracked files.`);
}
