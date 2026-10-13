import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(process.cwd());
const required = [
  "desktop/electron/main.cjs",
  "desktop/electron/app-root.cjs",
  "desktop/electron/control-plane.cjs",
  "desktop/electron/linked-device-session.cjs",
  "desktop/electron/tenant-storage.cjs",
  "desktop/electron/runtime-lifecycle.cjs",
  "desktop/electron/login.html",
  "desktop/electron/login.js",
  "desktop/electron/platform-admin.html",
  "desktop/electron/platform-admin.css",
  "desktop/electron/platform-admin.js",
  "desktop/electron/platform-admin-preload.cjs",
  "desktop/electron/platform-admin-presentation.mjs",
  "services/gateway/server.mjs",
  "services/gateway/usage-meter.mjs",
  "services/gateway/bridge-source.mjs",
  "services/gateway/draft-provider.mjs",
  "services/gateway/local-translator.mjs",
  "services/translator/translategemma_service.py",
  "contracts/local-translation.mjs",
  "contracts/supabase-rls-verifier.mjs",
  "infrastructure/supabase/verification/closed_pilot_rls_fixture.sql",
  "services/whatsapp-bridge/cmd/livebridge/main.go",
  "services/whatsapp-bridge/internal/whatsmeowlive/live.go",
  "services/whatsapp-bridge/internal/whatsmeowlive/account_binding_test.go",
  "packages/core/draft.ts",
  "packages/core/behavioral-dna.ts",
  "packages/core/autonomy-policy.ts",
  "packages/core/style-policy.ts",
  "packages/core/candidates.ts",
  "packages/core/conversation-backtest.ts",
  "packages/core/phrase-bank.ts",
  "packages/core/scenario-forest.ts",
  "packages/core/scenarios.ts",
  "scripts/backtest-cloning.mjs",
  "scripts/backtest-tooling.mjs",
  "scripts/generate-build-manifest.mjs",
  "scripts/generate-sbom.mjs",
  "scripts/verify-supabase-rls.mjs",
  "scripts/build-live-bridge.mjs",
  "apps/client/app.js",
  "apps/client/manifest.webmanifest",
  "apps/client/service-worker.js",
  "apps/client/pwa-register.mjs",
  "apps/client/relay-protocol.mjs",
  "apps/client/web-auth.mjs",
  "apps/client/web-auth-contract.mjs",
  "apps/client/web-session.mjs",
  "apps/client/web-hosted.mjs",
  "apps/client/assets/mycrobo-lockup-v1.png",
  "AGENTS.md",
];

for (const file of required) await access(resolve(root, file));
const clientSource = await readFile(resolve(root, "apps/client/app.js"), "utf8");
assert.match(clientSource, /if \(webSession\?\.surface === "closed-pilot-web"\) \{\s+await startHostedWorkspace\(webSession\);\s+\} else \{/u, "Hosted startup must not run private desktop bootstrapping.");
const packageJSON = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
assert.equal(packageJSON.main, "desktop/electron/main.cjs", "The desktop entry point changed unexpectedly.");

const bridgeSource = await readFile(resolve(root, "services/gateway/bridge-source.mjs"), "utf8");
assert.match(bridgeSource, /responseEpisodeMaximumItems\s*=.*2_500/u, "The latency-bounded response-episode default is missing.");
assert.match(bridgeSource, /\/v1\/response-episodes\?limit=\$\{responseEpisodeMaximumItems\}/u, "The bounded response-episode feed is not connected.");
const liveBridgeSource = await readFile(resolve(root, "services/whatsapp-bridge/internal/whatsmeowlive/live.go"), "utf8");
assert.match(liveBridgeSource, /GetAltJID\(ctx, jid\)/u, "WhatsApp LID-to-phone account continuity is not verified from the authenticated session store.");
const draftSource = await readFile(resolve(root, "packages/core/draft.ts"), "utf8");
assert.match(draftSource, /trainScenarioForestCached/u, "The probabilistic scenario router is not connected to draft context.");
assert.match(draftSource, /routingBlend/u, "The sparse-aware forest/rule blend is missing.");
const forestSource = await readFile(resolve(root, "packages/core/scenario-forest.ts"), "utf8");
assert.match(forestSource, /storyText\?: string\[\]/u, "The forest is not carrying bounded preceding story features.");
assert.match(forestSource, /weighted-diagonal-gmm/u, "The multimodal thermal mixture is missing.");
const styleSource = await readFile(resolve(root, "packages/core/style-policy.ts"), "utf8");
assert.match(styleSource, /replyModesByIncomingMode/u, "Conditional person-language transitions are missing.");
const auditSource = await readFile(resolve(root, "scripts/backtest-cloning.mjs"), "utf8");
assert.match(auditSource, /selectFrozenStratifiedCases/u, "The frozen stratified evaluation sampler is missing.");
const providerSource = await readFile(resolve(root, "services/gateway/draft-provider.mjs"), "utf8");
assert.match(providerSource, /same-person-semantic-plan/u, "Person-specific semantic planning is missing.");
assert.match(providerSource, /generationRoute/u, "Provider route truth is missing.");
const mainSource = await readFile(resolve(root, "desktop/electron/main.cjs"), "utf8");
assert.match(mainSource, /nodeIntegration:\s*false/u);
assert.match(mainSource, /contextIsolation:\s*true/u);
assert.match(mainSource, /sandbox:\s*true/u);
assert.match(mainSource, /MYCROBO_TENANT_ID/u, "The authenticated tenant is not bound into local services.");
assert.match(mainSource, /requestSingleInstanceLock/u, "The desktop does not prevent competing product instances.");
assert.match(mainSource, /acquireTenantRuntimeLease/u, "The selected tenant does not have an exclusive runtime lease.");
assert.match(mainSource, /MYCROBO_DESKTOP_PARENT_PID/u, "The gateway is not bound to the owning desktop lifetime.");
const controlSource = await readFile(resolve(root, "desktop/electron/control-plane.cjs"), "utf8");
assert.match(controlSource, /CREATE TABLE IF NOT EXISTS memberships/u, "Tenant membership storage is missing.");
assert.match(controlSource, /CREATE TABLE IF NOT EXISTS device_sessions/u, "Authenticated device sessions are missing.");
assert.match(controlSource, /CREATE TABLE IF NOT EXISTS plans/u, "Commercial plan storage is missing.");
assert.match(controlSource, /CREATE TABLE IF NOT EXISTS coupons/u, "Coupon storage is missing.");
assert.match(controlSource, /platformDashboard/u, "The platform operator dashboard is not connected.");
assert.match(mainSource, /platform-admin-session\.bin/u, "The platform console does not have an independent persisted session.");
assert.match(mainSource, /platformAdminMode \? "platform-admin-preload\.cjs" : "preload\.cjs"/u, "Product and platform renderers do not have separate preload capabilities.");
const productPreloadSource = await readFile(resolve(root, "desktop/electron/preload.cjs"), "utf8");
const platformPreloadSource = await readFile(resolve(root, "desktop/electron/platform-admin-preload.cjs"), "utf8");
assert.doesNotMatch(productPreloadSource, /mycrobo:(?:admin|platform)-/u, "The product renderer can discover platform-administration IPC.");
assert.doesNotMatch(platformPreloadSource, /mycrobo:(?:send-exact|open-external|relink-whatsapp)/u, "The platform renderer can discover product messaging or connection IPC.");
const supabaseVerifierSource = await readFile(resolve(root, "contracts/supabase-rls-verifier.mjs"), "utf8");
assert.match(supabaseVerifierSource, /relforcerowsecurity/u, "The closed-pilot deployment verifier does not prove FORCE RLS.");
assert.match(supabaseVerifierSource, /CROSS_TENANT_ACCESS_DETECTED/u, "The closed-pilot deployment verifier does not fail on cross-tenant disclosure.");
for (const table of [
  "tenants",
  "tenant_memberships",
  "devices",
  "google_oauth_connections",
  "sync_cursors",
  "relationship_graph_metadata",
  "behavioral_fingerprints",
  "pwa_preferences",
  "auto_send_policy_layers",
  "audit_events",
  "relay_pairing_challenges",
  "relay_sessions",
  "relay_envelopes",
  "relay_security_events",
]) {
  assert.match(supabaseVerifierSource, new RegExp(`table: ["']${table}["']`, "u"), `The closed-pilot deployment verifier does not exercise ${table}.`);
}
assert.match(supabaseVerifierSource, /TENANT_TABLES\s*=\s*Object\.freeze\(TENANT_TABLE_PROBES\.map/u, "The RLS catalog allowlist can drift from the data-plane probes.");
assert.match(supabaseVerifierSource, /method:\s*["']GET["']/u, "The RLS verifier is not explicitly read-only on the data plane.");
assert.match(supabaseVerifierSource, /mutationsAttempted:\s*0/u, "The RLS verifier does not report its zero-mutation contract.");
assert.doesNotMatch(supabaseVerifierSource, /method:\s*["'](?:PATCH|PUT|DELETE)["']/u, "The RLS verifier must not issue data-plane mutations.");
const supabaseFixtureSource = await readFile(resolve(root, "infrastructure/supabase/verification/closed_pilot_rls_fixture.sql"), "utf8");
assert.match(supabaseFixtureSource, /NEVER APPLY TO A PROJECT CONTAINING CUSTOMER DATA/u);
assert.doesNotMatch(supabaseFixtureSource, /\b(?:delete|truncate|drop)\b/iu, "The operator-applied verification fixture must not remove data or schema objects.");
const relayMigrationSource = await readFile(resolve(root, "infrastructure/supabase/migrations/202610090001_trusted_relay_foundation.sql"), "utf8");
assert.match(relayMigrationSource, /ciphertext bytea not null/u, "The trusted relay does not have a ciphertext-only payload boundary.");
assert.match(relayMigrationSource, /force row level security/u, "The trusted relay migration does not force RLS.");
assert.doesNotMatch(relayMigrationSource, /(?:capability|capabilities)[^\n]*(?:send|deliver)/iu, "The relay foundation must not introduce message delivery capability.");
const translatorSource = await readFile(resolve(root, "services/translator/translategemma_service.py"), "utf8");
assert.match(translatorSource, /AutoModelForImageTextToText/u, "The official TranslateGemma model interface is missing.");
assert.match(translatorSource, /local_files_only=True/u, "Translation must not download model files at runtime.");

console.log(JSON.stringify({ ok: true, root, version: packageJSON.version, requiredFiles: required.length }, null, 2));
