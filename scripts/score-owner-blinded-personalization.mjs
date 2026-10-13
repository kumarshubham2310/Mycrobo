import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { summarizeOwnerBlindedPersonalization } from "./backtest-tooling.mjs";

const inputPath = String(process.env.MYCROBO_OWNER_BLIND_INPUT || "").trim();
const outputPath = resolve(process.env.MYCROBO_OWNER_BLIND_REPORT || "docs/OWNER_BLIND_PERSONALIZATION_REPORT.json");
const assignmentSeed = String(process.env.MYCROBO_OWNER_BLIND_SEED || "mycrobo-owner-blind-v1");
const minimumRatedCases = Math.max(1, Number(process.env.MYCROBO_OWNER_BLIND_MINIMUM_CASES || 200));

if (!inputPath) {
  throw new Error("Set MYCROBO_OWNER_BLIND_INPUT to a local content-free rating ledger. No chat database is read by this scorer.");
}

const input = JSON.parse(await readFile(resolve(inputPath), "utf8"));
const report = summarizeOwnerBlindedPersonalization({
  ratings: input?.ratings,
  expectedBindings: input?.expectedBindings,
  availableChatAuditIds: input?.availableChatAuditIds,
  assignmentSeed,
  minimumRatedCases,
});

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
