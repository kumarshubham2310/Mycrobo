const { contextBridge, ipcRenderer } = require("electron");

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
  openPlatformAdmin() {
    return ipcRenderer.invoke("mycrobo:open-platform-admin");
  },
  sendExact(input) {
    return ipcRenderer.invoke("mycrobo:send-exact", {
      chatId: String(input?.chatId || ""),
      recipient: String(input?.recipient || ""),
      body: String(input?.body || ""),
      targetMessageId: String(input?.targetMessageId || ""),
      idempotencyKey: String(input?.idempotencyKey || ""),
    });
  },
  openExternal(url) {
    return ipcRenderer.invoke("mycrobo:open-external", { url: String(url || "") });
  },
  relayStatus() {
    return ipcRenderer.invoke("mycrobo:relay-status");
  },
  bindRelay(input) {
    return ipcRenderer.invoke("mycrobo:bind-relay", {
      email: String(input?.email || ""),
      password: String(input?.password || ""),
      cloudTenantId: String(input?.cloudTenantId || ""),
    });
  },
  tenants() {
    return ipcRenderer.invoke("mycrobo:tenants");
  },
  addTenant(input = {}) {
    return ipcRenderer.invoke("mycrobo:add-tenant", { name: String(input?.name || "New workspace") });
  },
  switchTenant(tenantId) {
    return ipcRenderer.invoke("mycrobo:switch-tenant", { tenantId: String(tenantId || "") });
  },
  relinkWhatsApp() {
    return ipcRenderer.invoke("mycrobo:relink-whatsapp");
  },
}));
