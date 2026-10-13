import { couponInput, normalizeDashboard, planInput, subscriptionInput } from "./platform-admin-presentation.mjs";

const api = window.mycroboDesktop;
const $ = (selector) => document.querySelector(selector);
const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
let dashboard = null;

function showSection(name) {
  const selected = document.querySelector(`[data-section="${name}"]`);
  if (!selected) return;
  document.querySelectorAll("[data-section]").forEach((item) => item.classList.toggle("active", item === selected));
  document.querySelectorAll("[data-panel]").forEach((item) => item.classList.toggle("hidden", item.dataset.panel !== name));
  const titles = { overview: ["Business overview", "Plans, customers, usage and access—separate from the customer application."], tenants: ["Tenant subscriptions", "Upgrade, downgrade and monitor each customer workspace."], users: ["Users and access", "See which plan each user belongs to and control their tenant access."], plans: ["Plan catalog", "Define commercial tiers and enforceable workspace limits."], coupons: ["Coupon management", "Create bounded promotions and track every redemption."] };
  $("#pageTitle").textContent = titles[name][0];
  $("#pageDescription").textContent = titles[name][1];
}

function formMessage(selector, message = "", error = false) {
  const node = $(selector);
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("hidden", !message);
  node.classList.toggle("error", Boolean(message) && error);
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.remove("hidden");
  window.setTimeout(() => node.classList.add("hidden"), 3000);
}

function money(value, currency) {
  if (!currency) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format((Number(value) || 0) / 100);
}

function selectOptions(plans, selected = "") {
  return plans.filter((plan) => plan.status === "active").map((plan) => `<option value="${escapeHTML(plan.id)}"${plan.id === selected ? " selected" : ""}>${escapeHTML(plan.name)} · ${escapeHTML(plan.code)}</option>`).join("");
}

function resetPlanForm() {
  const form = $("#planForm");
  form.reset();
  form.elements.planId.value = "";
  form.elements.currency.value = "INR";
  form.elements.seats.value = "5";
  form.elements.whatsappAccounts.value = "1";
  form.elements.monthlyDrafts.value = "1000";
  form.elements.monthlyTranslations.value = "1000";
  form.elements.historyMessages.value = "100000";
  form.elements.storageMb.value = "5120";
  $("#planFormTitle").textContent = "Create plan";
  $("#savePlan").textContent = "Create plan";
  $("#cancelPlanEdit").classList.add("hidden");
}

function editPlan(planId) {
  const plan = dashboard?.plans.find((item) => item.id === planId);
  if (!plan) return;
  const form = $("#planForm");
  for (const [name, value] of Object.entries({
    planId: plan.id, name: plan.name, code: plan.code, description: plan.description,
    currency: plan.currency, monthlyPrice: Number(plan.monthlyPriceMinor) / 100,
    seats: plan.limits.seats, whatsappAccounts: plan.limits.whatsappAccounts,
    monthlyDrafts: plan.limits.monthlyDrafts, monthlyTranslations: plan.limits.monthlyTranslations,
    historyMessages: plan.limits.historyMessages, storageMb: plan.limits.storageMb,
  })) form.elements[name].value = value;
  $("#planFormTitle").textContent = `Edit ${plan.name}`;
  $("#savePlan").textContent = "Save plan limits";
  $("#cancelPlanEdit").classList.remove("hidden");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function render() {
  if (!dashboard) return;
  $("#adminIdentity").textContent = dashboard.actor?.email || "Platform administrator";
  $("#metricTenants").textContent = dashboard.metrics.tenants;
  $("#metricSubscriptions").textContent = dashboard.metrics.activeSubscriptions;
  $("#metricUsers").textContent = dashboard.metrics.activeUsers;
  $("#metricCoupons").textContent = dashboard.metrics.coupons;
  $("#mrr").innerHTML = dashboard.metrics.mrrByCurrency?.length
    ? dashboard.metrics.mrrByCurrency.map((item) => `<article><span>${escapeHTML(item.currency)}</span><b>${escapeHTML(money(item.amountMinor, item.currency))}</b><small>After assigned coupon discounts</small></article>`).join("")
    : "<p>No active paid subscriptions yet.</p>";
  $("#planDistribution").innerHTML = dashboard.byPlan.length
    ? dashboard.byPlan.map((item) => `<article><b>${escapeHTML(item.name)}</b><p>${item.tenants} tenant${item.tenants === 1 ? "" : "s"} · ${item.users} active user${item.users === 1 ? "" : "s"}</p></article>`).join("")
    : "<p>Create a plan to begin.</p>";
  $("#couponPlan").innerHTML = '<option value="">All plans</option>' + selectOptions(dashboard.plans);
  $("#newUserTenant").innerHTML = dashboard.tenants.filter((tenant) => tenant.status === "active").map((tenant) => `<option value="${escapeHTML(tenant.id)}">${escapeHTML(tenant.name)} · ${escapeHTML(tenant.planName)}</option>`).join("");
  $("#existingUserTenant").innerHTML = $("#newUserTenant").innerHTML;

  $("#planList").innerHTML = dashboard.plans.length ? dashboard.plans.map((plan) => `<article class="itemRow"><div><b>${escapeHTML(plan.name)}</b> <span class="badge">${escapeHTML(plan.code)}</span><p>${escapeHTML(money(plan.monthlyPriceMinor, plan.currency))}/month · ${plan.limits.seats} seats · ${plan.limits.monthlyDrafts} drafts · ${plan.limits.monthlyTranslations} translations</p></div><div><button data-edit-plan="${escapeHTML(plan.id)}">Edit</button><button class="danger" data-plan-status="${escapeHTML(plan.id)}" data-next="${plan.status === "active" ? "archived" : "active"}">${plan.status === "active" ? "Archive" : "Restore"}</button></div></article>`).join("") : "<p>No plans created.</p>";
  $("#couponList").innerHTML = dashboard.coupons.length ? dashboard.coupons.map((coupon) => `<article class="itemRow"><div><b>${escapeHTML(coupon.code)}</b> <span class="badge">${escapeHTML(coupon.status)}</span><p>${coupon.discountPercent}% · ${escapeHTML(coupon.planName)} · ${coupon.redeemedCount}/${coupon.maxRedemptions} used${coupon.expiresAt ? ` · expires ${escapeHTML(new Date(coupon.expiresAt).toLocaleDateString())}` : ""}</p></div>${coupon.status === "active" ? `<div><button class="danger" data-coupon-status="${escapeHTML(coupon.id)}">Disable</button></div>` : ""}</article>`).join("") : "<p>No coupons generated.</p>";
  $("#tenantList").innerHTML = dashboard.tenants.length ? dashboard.tenants.map((tenant) => {
    const plan = dashboard.plans.find((item) => item.id === tenant.planId);
    const draftLimit = plan?.limits?.monthlyDrafts;
    const translationLimit = plan?.limits?.monthlyTranslations;
    const price = tenant.discountPercent > 0 ? `${money(tenant.effectiveMonthlyPriceMinor, tenant.currency)} after ${tenant.discountPercent}% ${escapeHTML(tenant.couponCode)} discount` : money(tenant.monthlyPriceMinor, tenant.currency);
    return `<article class="tenantCard"><div class="tenantMeta"><b>${escapeHTML(tenant.name)}</b><span class="badge">${escapeHTML(tenant.subscriptionStatus)}</span><small>${tenant.activeUsers} active user${tenant.activeUsers === 1 ? "" : "s"} · ${escapeHTML(tenant.planName)} · ${escapeHTML(price)}</small><div class="usage"><span>${tenant.usage?.drafts || 0}${Number.isInteger(draftLimit) ? ` / ${draftLimit}` : ""} drafts this month</span><span>${tenant.usage?.translations || 0}${Number.isInteger(translationLimit) ? ` / ${translationLimit}` : ""} translations this month</span></div></div><form class="tenantForm"><input type="hidden" name="tenantId" value="${escapeHTML(tenant.id)}"><label>Plan<select name="planId" required><option value="">Choose plan</option>${selectOptions(dashboard.plans, tenant.planId)}</select></label><label>Status<select name="status"><option value="trialing"${tenant.subscriptionStatus === "trialing" ? " selected" : ""}>Trial</option><option value="active"${tenant.subscriptionStatus === "active" ? " selected" : ""}>Active</option><option value="past_due"${tenant.subscriptionStatus === "past_due" ? " selected" : ""}>Past due</option><option value="cancelled"${tenant.subscriptionStatus === "cancelled" ? " selected" : ""}>Cancelled</option></select></label><label>New coupon<input name="couponCode" placeholder="Optional"></label><label>Period end<input name="currentPeriodEnd" type="date" value="${tenant.currentPeriodEnd ? escapeHTML(String(tenant.currentPeriodEnd).slice(0, 10)) : ""}"></label><button type="submit">Update</button></form></article>`;
  }).join("") : "<p>No tenants enrolled.</p>";
  $("#userList").innerHTML = dashboard.users.length ? dashboard.users.map((user) => {
    const protectedActor = user.userId === dashboard.actor?.id;
    return `<form class="userRow"><div><b>${escapeHTML(user.displayName || user.email)}</b>${user.platformAdmin ? ' <span class="badge">Platform admin</span>' : ""}<p>${escapeHTML(user.email)} · ${escapeHTML(user.tenantName)} · ${escapeHTML(user.planName)}</p></div><input type="hidden" name="userId" value="${escapeHTML(user.userId)}"><input type="hidden" name="tenantId" value="${escapeHTML(user.tenantId)}"><label>Role<select name="role"${protectedActor ? " disabled" : ""}><option value="viewer"${user.role === "viewer" ? " selected" : ""}>Viewer</option><option value="member"${user.role === "member" ? " selected" : ""}>Member</option><option value="admin"${user.role === "admin" ? " selected" : ""}>Admin</option><option value="owner"${user.role === "owner" ? " selected" : ""}>Owner</option></select></label><label>Access<select name="status"${protectedActor ? " disabled" : ""}><option value="active"${user.membershipStatus === "active" ? " selected" : ""}>Active</option><option value="disabled"${user.membershipStatus === "disabled" ? " selected" : ""}>Disabled</option></select></label><button type="submit"${protectedActor ? " disabled title=\"Your own active operator access is protected\"" : ""}>Save access</button></form>`;
  }).join("") : "<p>No users enrolled.</p>";
  $("#notice").textContent = `Updated ${new Date().toLocaleTimeString()} · commercial changes are enforced by the local control plane.`;
}

async function load() {
  try {
    $("#refresh").disabled = true;
    dashboard = normalizeDashboard(await api.platformDashboard());
    render();
  } catch (error) {
    $("#notice").textContent = error?.message || "Platform data could not be loaded.";
  } finally { $("#refresh").disabled = false; }
}

document.querySelectorAll("[data-section]").forEach((button) => button.addEventListener("click", () => showSection(button.dataset.section)));

$("#refresh").addEventListener("click", load);
$("#openProduct").addEventListener("click", () => api.openProduct());
$("#adminSignOut").addEventListener("click", async () => { await api.signOut(); window.location.reload(); });
$("#cancelPlanEdit").addEventListener("click", resetPlanForm);
$("#tenantCreateForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  formMessage("#tenantCreateStatus");
  button.disabled = true;
  try {
    const tenant = await api.createTenant({ name: String(new FormData(form).get("name") || "") });
    form.reset();
    await load();
    showSection("users");
    $("#newUserTenant").value = tenant.id;
    formMessage("#userCreateStatus", `${tenant.name} was created. Add its first user below.`);
    toast("Tenant created with isolated storage.");
  } catch (error) {
    formMessage("#tenantCreateStatus", error?.message || "Tenant could not be created.", true);
  } finally { button.disabled = false; }
});
$("#userCreateForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const values = Object.fromEntries(new FormData(form));
  formMessage("#userCreateStatus");
  button.disabled = true;
  try {
    await api.createUser({ ...values, platformAdmin: values.platformAdmin === "on" });
    form.reset();
    form.elements.password.value = "";
    formMessage("#userCreateStatus", "The new account was created and added to the selected tenant.");
    toast("User account created.");
    await load();
  } catch (error) {
    form.elements.password.value = "";
    formMessage("#userCreateStatus", error?.message || "User account could not be created.", true);
  } finally { button.disabled = false; }
});
$("#existingUserForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  formMessage("#existingUserStatus");
  button.disabled = true;
  try {
    await api.assignExistingUser(Object.fromEntries(new FormData(form)));
    form.reset();
    formMessage("#existingUserStatus", "The existing account can now access the selected tenant.");
    toast("Tenant access granted without copying workspace data.");
    await load();
  } catch (error) {
    formMessage("#existingUserStatus", error?.message || "Tenant access could not be granted.", true);
  } finally { button.disabled = false; }
});
$("#planForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const input = planInput(Object.fromEntries(new FormData(event.currentTarget)));
    if (input.planId) await api.updatePlan(input); else await api.createPlan(input);
    toast(input.planId ? "Plan and limits updated." : "Plan created.");
    resetPlanForm();
    await load();
  } catch (error) { toast(error?.message || "Plan could not be saved."); }
});
$("#couponForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try { await api.createCoupon(couponInput(Object.fromEntries(new FormData(event.currentTarget)))); event.currentTarget.reset(); toast("Coupon generated."); await load(); }
  catch (error) { toast(error?.message || "Coupon could not be generated."); }
});
$("#tenantList").addEventListener("submit", async (event) => {
  const form = event.target.closest("form");
  if (!form) return;
  event.preventDefault();
  try { await api.assignPlan(subscriptionInput(Object.fromEntries(new FormData(form)))); toast("Tenant plan updated."); await load(); }
  catch (error) { toast(error?.message || "Subscription could not be updated."); }
});
$("#userList").addEventListener("submit", async (event) => {
  const form = event.target.closest("form");
  if (!form) return;
  event.preventDefault();
  try { await api.setMembership(Object.fromEntries(new FormData(form))); toast("User access updated."); await load(); }
  catch (error) { toast(error?.message || "User access could not be updated."); }
});
$("#planList").addEventListener("click", async (event) => {
  const edit = event.target.closest("[data-edit-plan]");
  if (edit) return editPlan(edit.dataset.editPlan);
  const status = event.target.closest("[data-plan-status]");
  if (!status) return;
  try { await api.setPlanStatus({ planId: status.dataset.planStatus, status: status.dataset.next }); await load(); }
  catch (error) { toast(error?.message || "Plan could not be updated."); }
});
$("#couponList").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-coupon-status]");
  if (!button) return;
  try { await api.setCouponStatus({ couponId: button.dataset.couponStatus, status: "disabled" }); await load(); }
  catch (error) { toast(error?.message || "Coupon could not be updated."); }
});

resetPlanForm();
load();
