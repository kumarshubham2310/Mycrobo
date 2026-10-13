const { contextBridge, ipcRenderer } = require("electron");

const limits = (input) => Object.fromEntries(
  ["seats", "whatsappAccounts", "monthlyDrafts", "monthlyTranslations", "historyMessages", "storageMb"]
    .map((key) => [key, Number(input?.[key])]),
);

// This bridge is loaded only by the dedicated --platform-admin process. It
// deliberately has no chat, WhatsApp connection, model, media or send methods.
contextBridge.exposeInMainWorld("mycroboDesktop", Object.freeze({
  authStatus() {
    return ipcRenderer.invoke("mycrobo:auth-status");
  },
  bootstrapOwner(input) {
    return ipcRenderer.invoke("mycrobo:bootstrap-owner", {
      displayName: String(input?.displayName || ""),
      email: String(input?.email || ""),
      password: String(input?.password || ""),
      workspaceName: String(input?.tenantName || input?.workspaceName || ""),
    });
  },
  signIn(input) {
    return ipcRenderer.invoke("mycrobo:sign-in", {
      email: String(input?.email || ""),
      password: String(input?.password || ""),
    });
  },
  signOut() {
    return ipcRenderer.invoke("mycrobo:sign-out");
  },
  createTenant(input) {
    return ipcRenderer.invoke("mycrobo:admin-create-tenant", { name: String(input?.name || "") });
  },
  createUser(input) {
    return ipcRenderer.invoke("mycrobo:admin-create-user", {
      displayName: String(input?.displayName || ""),
      email: String(input?.email || ""),
      password: String(input?.password || ""),
      tenantId: String(input?.tenantId || ""),
      role: String(input?.role || ""),
      platformAdmin: input?.platformAdmin === true,
    });
  },
  assignExistingUser(input) {
    return ipcRenderer.invoke("mycrobo:admin-assign-existing-user", {
      email: String(input?.email || ""),
      tenantId: String(input?.tenantId || ""),
      role: String(input?.role || ""),
    });
  },
  setMembership(input) {
    return ipcRenderer.invoke("mycrobo:admin-set-membership", {
      tenantId: String(input?.tenantId || ""),
      userId: String(input?.userId || ""),
      role: String(input?.role || ""),
      status: String(input?.status || ""),
    });
  },
  platformDashboard() {
    return ipcRenderer.invoke("mycrobo:platform-dashboard");
  },
  createPlan(input) {
    return ipcRenderer.invoke("mycrobo:platform-create-plan", {
      name: String(input?.name || ""), code: String(input?.code || ""), description: String(input?.description || ""),
      currency: String(input?.currency || ""), monthlyPriceMinor: Number(input?.monthlyPriceMinor), limits: limits(input?.limits),
    });
  },
  updatePlan(input) {
    return ipcRenderer.invoke("mycrobo:platform-update-plan", {
      planId: String(input?.planId || ""), name: String(input?.name || ""), code: String(input?.code || ""), description: String(input?.description || ""),
      currency: String(input?.currency || ""), monthlyPriceMinor: Number(input?.monthlyPriceMinor), limits: limits(input?.limits),
    });
  },
  setPlanStatus(input) {
    return ipcRenderer.invoke("mycrobo:platform-set-plan-status", { planId: String(input?.planId || ""), status: String(input?.status || "") });
  },
  createCoupon(input) {
    return ipcRenderer.invoke("mycrobo:platform-create-coupon", { code: String(input?.code || ""), planId: String(input?.planId || ""), discountPercent: Number(input?.discountPercent), maxRedemptions: Number(input?.maxRedemptions), expiresAt: input?.expiresAt ? String(input.expiresAt) : null });
  },
  setCouponStatus(input) {
    return ipcRenderer.invoke("mycrobo:platform-set-coupon-status", { couponId: String(input?.couponId || ""), status: String(input?.status || "") });
  },
  assignPlan(input) {
    return ipcRenderer.invoke("mycrobo:platform-assign-plan", { tenantId: String(input?.tenantId || ""), planId: String(input?.planId || ""), status: String(input?.status || ""), couponCode: String(input?.couponCode || ""), currentPeriodEnd: input?.currentPeriodEnd ? String(input.currentPeriodEnd) : null });
  },
  openProduct() {
    return ipcRenderer.invoke("mycrobo:open-product");
  },
}));
