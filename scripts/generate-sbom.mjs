import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(process.cwd());
const packageJSON = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const goModule = await readFile(resolve(root, "services/whatsapp-bridge/go.mod"), "utf8");
const dependencies = [...goModule.matchAll(/^\s*([^\s()]+)\s+v([^\s]+)(?:\s+\/\/ indirect)?$/gmu)].map((match) => ({
  type: "library",
  name: match[1],
  version: match[2],
  purl: `pkg:golang/${encodeURIComponent(match[1])}@${encodeURIComponent(match[2])}`,
}));
const output = resolve(process.env.MYCROBO_SBOM || "docs/rebuild/sbom-current.json");
const serial = createHash("sha256").update(`${packageJSON.name}:${packageJSON.version}:${dependencies.map((item) => item.purl).join("|")}`).digest("hex");
const document = {
  bomFormat: "CycloneDX",
  specVersion: "1.6",
  serialNumber: `urn:uuid:${serial.slice(0, 8)}-${serial.slice(8, 12)}-${serial.slice(12, 16)}-${serial.slice(16, 20)}-${serial.slice(20, 32)}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: { type: "application", name: "MyCrobo", version: packageJSON.version },
    properties: [
      { name: "mycrobo:scope", value: "source-declared Go modules and root JavaScript package" },
      { name: "mycrobo:limitation", value: "Packaged Electron/Chromium inventory requires installer-stage tooling" },
    ],
  },
  components: dependencies,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: true, output, components: dependencies.length }, null, 2));
