import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { couponInput, moneyMinor, normalizeDashboard, planInput, subscriptionInput } from "./platform-admin-presentation.mjs";

test("platform presentation validates commercial plan, coupon and subscription inputs", () => {
  assert.equal(moneyMinor("1299.50"), 129950);
  const plan = planInput({ planId: "plan-0011223344556677", name: "Growth", code: "growth", currency: "inr", monthlyPrice: "999", seats: "5", whatsappAccounts: "1", monthlyDrafts: "1000", monthlyTranslations: "500", historyMessages: "100000", storageMb: "5120" });
  assert.equal(plan.code, "GROWTH");
  assert.equal(plan.monthlyPriceMinor, 99900);
  assert.equal(plan.limits.seats, 5);
  assert.equal(plan.planId, "plan-0011223344556677");
  assert.throws(() => planInput({ name: "X", code: "bad code", currency: "rupees" }), /Complete the plan/u);
  assert.equal(couponInput({ code: "launch25", discountPercent: "25", maxRedemptions: "100" }).code, "LAUNCH25");
  assert.deepEqual(subscriptionInput({ tenantId: "tenant-a", planId: "plan-a", status: "active", couponCode: "trial" }), { tenantId: "tenant-a", planId: "plan-a", status: "active", couponCode: "TRIAL", currentPeriodEnd: null });
});

test("platform console is a dedicated commercial process without chat or send controls", async () => {
  const root = new URL("../../", import.meta.url);
  const [html, script, main, productPreload, platformPreload] = await Promise.all([
    readFile(new URL("desktop/electron/platform-admin.html", root), "utf8"),
    readFile(new URL("desktop/electron/platform-admin.js", root), "utf8"),
    readFile(new URL("desktop/electron/main.cjs", root), "utf8"),
    readFile(new URL("desktop/electron/preload.cjs", root), "utf8"),
    readFile(new URL("desktop/electron/platform-admin-preload.cjs", root), "utf8"),
  ]);
  for (const label of ["Overview", "Tenants", "Plans", "Coupons", "Generate coupon", "Tenant plans and limits"]) assert.match(html, new RegExp(label, "u"));
  assert.match(script, /api\.updatePlan/u);
  assert.match(main, /platform-admin-session\.bin/u);
  assert.match(main, /--platform-admin/u);
  assert.match(main, /platformAdminMode \? "platform-admin-preload\.cjs" : "preload\.cjs"/u);
  assert.match(main, /if \(platformAdminMode\) installPlatformAdministrationBroker\(\)/u);
  const platformBrokerStart = main.indexOf("function installPlatformAdministrationBroker()");
  const platformBrokerEnd = main.indexOf("function installPlatformConsoleLauncherBroker()", platformBrokerStart);
  assert.ok(platformBrokerStart >= 0 && platformBrokerEnd > platformBrokerStart);
  const platformBroker = main.slice(platformBrokerStart, platformBrokerEnd);
  const outsidePlatformBroker = main.slice(0, platformBrokerStart) + main.slice(platformBrokerEnd);
  assert.match(platformBroker, /platformAdminPageAllowed/u);
  assert.match(platformBroker, /requirePlatformAdmin/u);
  assert.doesNotMatch(outsidePlatformBroker, /ipcMain\.handle\("mycrobo:(?:admin|platform)-(?!admin)/u);
  assert.doesNotMatch(productPreload, /mycrobo:(?:admin|platform)-/u);
  assert.doesNotMatch(platformPreload, /mycrobo:(?:send-exact|open-external|relink-whatsapp)/u);
  assert.doesNotMatch(`${html}\n${script}`, /sendExact|WhatsApp message|chat history/iu);
  assert.deepEqual(normalizeDashboard(null).plans, []);
});
