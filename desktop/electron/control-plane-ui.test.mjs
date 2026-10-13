import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const invokedChannels = (source) => [...source.matchAll(/ipcRenderer\.invoke\("([^"]+)"/gu)].map((match) => match[1]).sort();

test("product and platform preloads expose mutually exclusive least-privilege operations", async () => {
  const [product, platform] = await Promise.all([
    read("desktop/electron/preload.cjs"),
    read("desktop/electron/platform-admin-preload.cjs"),
  ]);
  for (const method of ["authStatus", "bootstrapOwner", "signIn", "signOut", "openPlatformAdmin", "sendExact", "openExternal", "relayStatus", "bindRelay", "tenants", "addTenant", "switchTenant", "relinkWhatsApp"]) assert.match(product, new RegExp(`\\b${method}\\(`, "u"));
  for (const method of ["createTenant", "createUser", "assignExistingUser", "setMembership", "platformDashboard", "createPlan", "updatePlan", "setPlanStatus", "createCoupon", "setCouponStatus", "assignPlan", "openProduct"]) assert.match(platform, new RegExp(`\\b${method}\\(`, "u"));
  for (const forbidden of ["adminSnapshot", "createTenant", "createUser", "assignExistingUser", "setMembership", "suspendTenant", "platformDashboard", "createPlan", "updatePlan", "setPlanStatus", "createCoupon", "setCouponStatus", "assignPlan", "openProduct", "mycrobo:admin-", "mycrobo:platform-"]) assert.doesNotMatch(product, new RegExp(forbidden, "u"));
  for (const forbidden of ["sendExact", "openExternal", "relayStatus", "bindRelay", "tenants", "addTenant", "switchTenant", "relinkWhatsApp", "openPlatformAdmin", "mycrobo:send-exact", "mycrobo:open-external", "mycrobo:relay-status", "mycrobo:bind-relay", "mycrobo:relink-whatsapp"]) assert.doesNotMatch(platform, new RegExp(forbidden, "u"));
  for (const unusedAdminMethod of ["adminSnapshot", "suspendTenant", "mycrobo:admin-snapshot", "mycrobo:admin-set-tenant-status"]) assert.doesNotMatch(platform, new RegExp(unusedAdminMethod, "u"));
  assert.deepEqual(invokedChannels(product), [
    "mycrobo:add-tenant", "mycrobo:auth-status", "mycrobo:bind-relay", "mycrobo:bootstrap-owner", "mycrobo:open-external", "mycrobo:open-platform-admin", "mycrobo:relay-status",
    "mycrobo:relink-whatsapp", "mycrobo:send-exact", "mycrobo:sign-in", "mycrobo:sign-out", "mycrobo:switch-tenant", "mycrobo:tenants",
  ]);
  assert.deepEqual(invokedChannels(platform), [
    "mycrobo:admin-assign-existing-user", "mycrobo:admin-create-tenant", "mycrobo:admin-create-user", "mycrobo:admin-set-membership",
    "mycrobo:auth-status", "mycrobo:bootstrap-owner", "mycrobo:open-product", "mycrobo:platform-assign-plan", "mycrobo:platform-create-coupon",
    "mycrobo:platform-create-plan", "mycrobo:platform-dashboard", "mycrobo:platform-set-coupon-status", "mycrobo:platform-set-plan-status",
    "mycrobo:platform-update-plan", "mycrobo:sign-in", "mycrobo:sign-out",
  ]);
  assert.match(product, /bootstrap-owner[\s\S]*workspaceName:/u);
  assert.doesNotMatch(`${product}\n${platform}`, /execute|queryDatabase|readToken|sessionToken/u);
});

test("login and platform console are password-safe and separated from the customer product", async () => {
  const [login, loginApp, app, index, main, platformHtml, platformApp] = await Promise.all([read("desktop/electron/login.html"), read("desktop/electron/login.js"), read("apps/client/app.js"), read("apps/client/index.html"), read("desktop/electron/main.cjs"), read("desktop/electron/platform-admin.html"), read("desktop/electron/platform-admin.js")]);
  assert.match(login, /type="password"/u);
  assert.match(login, /autocomplete="current-password"/u);
  assert.match(index, /id="adminNav"[^>]*data-view="admin"/u);
  assert.match(index, /id="adminNav"[^>]*class="hidden"|class="hidden"[^>]*id="adminNav"/u);
  assert.match(index, /id="openPlatformConsole"/u);
  assert.match(app, /adminNav\?\.classList\.add\("hidden"\)/u);
  assert.match(app, /openPlatformAdmin/u);
  assert.match(app, /form\.elements\.password\.value = ""/u);
  assert.match(main, /platform-console-browser-profile/u);
  assert.match(main, /platformAdminMode \? "platform-admin-preload\.cjs" : "preload\.cjs"/u);
  assert.match(main, /if \(platformAdminMode\) installPlatformAdministrationBroker\(\)/u);
  assert.match(main, /platformAdminPageAllowed/u);
  assert.match(main, /dedicated MyCrobo platform console/u);
  assert.match(main, /app\.setPath\("sessionData", platformBrowserProfile\)/u);
  assert.doesNotMatch(main, /app\.setPath\("userData", platformBrowserProfile\)/u);
  assert.match(main, /recovery: "vault"/u);
  assert.match(loginApp, /recoveryMode === "vault"/u);
  assert.match(main, /installationUserData = sharedInstallationUserData/u);
  assert.match(main, /mycrobo-connector-runtime\.1/u);
  assert.match(main, /runtime-status\.json/u);
  assert.match(main, /prepareFreshLinkedDeviceSession\(tenantData\)/u);
  assert.match(main, /Workspace administrator access is required to reconnect WhatsApp/u);
  assert.doesNotMatch(main.match(/async function recordConnectorRuntimeStatus[\s\S]+?\n\}/u)?.[0] || "", /phoneCode|qrImage|message(?:Text|Body)|chatId/u);
  assert.match(platformHtml, /Step 1 · Customer onboarding/u);
  assert.match(platformHtml, /New account/u);
  assert.match(platformHtml, /Add an existing user to another tenant/u);
  assert.match(platformApp, /assignExistingUser/u);
  assert.match(platformApp, /showSection\("users"\)/u);
  assert.match(platformApp, /newUserTenant.*value = tenant\.id/u);
  assert.doesNotMatch(`${login}\n${index}`, /admin@example\.com|changeme|default password/iu);
});
