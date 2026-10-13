import {
  activeMembershipPath,
  resolveActiveMembershipSelection,
  WEB_SESSION_STORAGE_KEY,
  WEB_SELECTED_TENANT_STORAGE_KEY,
  recoverySessionFromHash,
  sessionFromAuthPayload,
  usableWebSession,
  validSupabaseWebConfig,
  webAuthConfigurationMode,
  hostedSessionDescriptor,
} from "/web-auth-contract.mjs";
import { createAuthenticatedWebFetch } from "/web-session.mjs";

const nativeFetch = window.fetch.bind(window);
let activeSession = null;
let fetchWrapped = false;
let sessionController = null;
let currentIdentity = null;

function authHeaders(config, session = null) {
  return {
    apikey: config.supabaseAnonKey,
    ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}),
  };
}

function saveSession(session) {
  activeSession = session;
  try {
    if (session) sessionStorage.setItem(WEB_SESSION_STORAGE_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(WEB_SESSION_STORAGE_KEY);
  } catch { /* The authenticated session may remain in memory for this page only. */ }
}

function readSession() {
  try { return JSON.parse(sessionStorage.getItem(WEB_SESSION_STORAGE_KEY) || "null"); } catch { return null; }
}

function saveSelectedTenantId(tenantId) {
  try {
    if (tenantId) localStorage.setItem(WEB_SELECTED_TENANT_STORAGE_KEY, String(tenantId));
    else localStorage.removeItem(WEB_SELECTED_TENANT_STORAGE_KEY);
  } catch { /* The user can select again when browser storage is unavailable. */ }
}

function readSelectedTenantId() {
  try { return localStorage.getItem(WEB_SELECTED_TENANT_STORAGE_KEY); } catch { return null; }
}

async function supabaseRequest(config, path, options = {}) {
  const headers = new Headers(options.headers || {});
  for (const [key, value] of Object.entries(authHeaders(config, options.session))) headers.set(key, value);
  const { session: _session, ...requestOptions } = options;
  const response = await nativeFetch(`${config.supabaseUrl}${path}`, { ...requestOptions, headers, cache: "no-store", credentials: "omit", redirect: "error", signal: AbortSignal.timeout(10_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload?.msg === "string" ? payload.msg : typeof payload?.error_description === "string" ? payload.error_description : "Authentication could not be completed.");
  return payload;
}

async function refreshSession(config, session) {
  if (!session?.refresh_token) return null;
  try {
    const payload = await supabaseRequest(config, "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    return sessionFromAuthPayload(payload);
  } catch {
    return null;
  }
}

async function activeMembershipDirectory(config, session) {
  const user = await supabaseRequest(config, "/auth/v1/user", { session });
  if (!user?.id) return null;
  const membershipPath = activeMembershipPath(user.id);
  if (!membershipPath) return null;
  const rows = await supabaseRequest(config, membershipPath, { session });
  const resolution = resolveActiveMembershipSelection(rows);
  if (resolution.status === "invalid-directory") return null;
  return { user, memberships: resolution.memberships };
}

function identityFor(directory, membership) {
  if (!directory?.user || !membership) return null;
  return { user: directory.user, membership, membershipCount: directory.memberships.length };
}

function workspaceSelectionOverlay(directory, { allowCancel = false, currentTenantId = null } = {}) {
  const node = document.createElement("section");
  node.className = "webAuthOverlay";
  node.setAttribute("aria-labelledby", "webWorkspaceTitle");
  node.innerHTML = `<div class="webAuthCard"><img src="/assets/mycrobo-lockup-v1.png" alt="MyCrobo" /><p class="webAuthEyebrow">Closed pilot</p><h1 id="webWorkspaceTitle">Choose a workspace</h1><p>Your account has access to more than one active workspace. Choose which isolated workspace to open.</p><form id="webWorkspaceForm"><label>Workspace<select id="webWorkspaceSelect" name="tenant_id" required></select></label><button type="submit">Open workspace</button></form><button class="webAuthLink ${allowCancel ? "" : "hidden"}" id="webWorkspaceCancel" type="button">Keep current workspace</button><p class="webAuthError" id="webWorkspaceError" role="alert"></p><aside><b>One workspace at a time.</b><span>Only the selected workspace ID is remembered. Messages, tokens and relationship data are never stored with this choice.</span></aside></div>`;
  const select = node.querySelector("#webWorkspaceSelect");
  for (const [index, membership] of directory.memberships.entries()) {
    const option = document.createElement("option");
    option.value = membership.tenant_id;
    option.textContent = `Workspace ${index + 1} · ${membership.membership_role} · ${membership.tenant_id.slice(0, 8)}`;
    select.append(option);
  }
  const current = directory.memberships.find((membership) => membership.tenant_id === currentTenantId);
  select.value = current?.tenant_id || directory.memberships[0]?.tenant_id || "";
  document.body.append(node);
  return node;
}

async function selectWorkspace(directory, { forceChoice = false, allowCancel = false, currentTenantId = null } = {}) {
  let resolution = resolveActiveMembershipSelection(directory?.memberships || [], forceChoice ? null : readSelectedTenantId());
  if (resolution.status === "stale-selection") {
    saveSelectedTenantId(null);
    resolution = resolveActiveMembershipSelection(resolution.memberships);
  }
  if (resolution.membership && (!forceChoice || resolution.memberships.length === 1)) {
    saveSelectedTenantId(resolution.membership.tenant_id);
    return identityFor(directory, resolution.membership);
  }
  if (resolution.status === "invalid-directory" || resolution.status === "no-membership") return null;
  const overlay = workspaceSelectionOverlay(directory, { allowCancel, currentTenantId });
  return new Promise((resolve) => {
    overlay.querySelector("#webWorkspaceForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const tenantId = overlay.querySelector("#webWorkspaceSelect").value;
      const selected = directory.memberships.find((membership) => membership.tenant_id === tenantId) || null;
      if (!selected) {
        overlay.querySelector("#webWorkspaceError").textContent = "That workspace is no longer available. Sign in again to refresh access.";
        return;
      }
      saveSelectedTenantId(selected.tenant_id);
      overlay.remove();
      resolve(identityFor(directory, selected));
    });
    overlay.querySelector("#webWorkspaceCancel").addEventListener("click", () => {
      if (!allowCancel) return;
      overlay.remove();
      resolve(null);
    });
  });
}

function installAuthenticatedFetch(config, identity) {
  currentIdentity = identity;
  if (fetchWrapped) return;
  fetchWrapped = true;
  sessionController = createAuthenticatedWebFetch({
    origin: window.location.origin, fetchImpl: nativeFetch,
    now: () => Date.now(),
    readSession: () => activeSession, saveSession,
    async refreshSession(previous) {
      const refreshed = await refreshSession(config, previous);
      if (!refreshed) return null;
      const directory = await activeMembershipDirectory(config, refreshed);
      const resolution = resolveActiveMembershipSelection(directory?.memberships || [], readSelectedTenantId());
      const identity = identityFor(directory, resolution.status === "selected" ? resolution.membership : null);
      if (!identity || identity.user.id !== currentIdentity?.user.id || identity.membership.tenant_id !== currentIdentity?.membership.tenant_id) {
        saveSelectedTenantId(null);
        await supabaseRequest(config, "/auth/v1/logout", { method: "POST", session: refreshed }).catch(() => {});
        return null;
      }
      currentIdentity = identity;
      return refreshed;
    },
    async onAuthRequired() {
      await interactiveSignIn(config);
      window.location.reload();
    },
  });
  window.fetch = sessionController.fetch;
  window.mycroboWebSession = Object.freeze({
    descriptor: hostedSessionDescriptor(identity),
    async switchWorkspace() {
      const directory = await activeMembershipDirectory(config, activeSession).catch(() => null);
      if (!directory || directory.user.id !== currentIdentity?.user.id) {
        saveSelectedTenantId(null);
        sessionController.invalidate();
        return;
      }
      const nextIdentity = await selectWorkspace(directory, {
        forceChoice: true,
        allowCancel: true,
        currentTenantId: currentIdentity.membership.tenant_id,
      });
      if (!nextIdentity) return;
      const previous = activeSession;
      sessionController.invalidate({ reauthenticate: false });
      saveSession(previous);
      currentIdentity = nextIdentity;
      window.location.reload();
    },
    async signOut() {
      const previous = activeSession;
      saveSelectedTenantId(null);
      sessionController.invalidate({ reauthenticate: false });
      if (previous) {
        await supabaseRequest(config, "/auth/v1/logout", { method: "POST", session: previous }).catch(() => {});
      }
      window.location.reload();
    },
  });
}

function authOverlay() {
  const node = document.createElement("section");
  node.className = "webAuthOverlay";
  node.setAttribute("aria-labelledby", "webAuthTitle");
  const eyeIcon = `<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="2.7" stroke="currentColor" stroke-width="1.8"/></svg>`;
  node.innerHTML = `<div class="webAuthCard"><img src="/assets/mycrobo-lockup-v1.png" alt="MyCrobo" /><p class="webAuthEyebrow">Closed pilot</p><h1 id="webAuthTitle">Sign in to MyCrobo</h1><p id="webAuthDescription">Open only the workspaces assigned to your account.</p><form id="webAuthForm"><label>Email<input name="email" type="email" autocomplete="username" required /></label><label>Password<span class="webPasswordField"><input id="webPassword" name="password" type="password" autocomplete="current-password" required minlength="8" /><button class="webPasswordToggle" id="webPasswordToggle" type="button" aria-controls="webPassword" aria-pressed="false" aria-label="Show password">${eyeIcon}<span id="webPasswordToggleLabel">Show</span></button></span></label><button type="submit">Sign in</button></form><form id="webResetForm" class="hidden"><label>New password<span class="webPasswordField"><input id="webResetPassword" name="password" type="password" autocomplete="new-password" required minlength="12" /><button class="webPasswordToggle" id="webResetPasswordToggle" type="button" aria-controls="webResetPassword" aria-pressed="false" aria-label="Show new password">${eyeIcon}<span id="webResetPasswordToggleLabel">Show</span></button></span></label><button type="submit">Save new password</button></form><p class="webAuthError" id="webAuthError" role="alert"></p><button class="webAuthLink" id="webForgot" type="button">Forgot password?</button><aside><b>Your data stays separated.</b><span>The browser receives only your authenticated tenant session. WhatsApp data remains unavailable until a trusted desktop relay is paired.</span></aside></div>`;
  const wirePasswordToggle = (inputSelector, buttonSelector, labelSelector, subject) => {
    const input = node.querySelector(inputSelector);
    const button = node.querySelector(buttonSelector);
    const label = node.querySelector(labelSelector);
    button.addEventListener("click", () => {
      const reveal = input.type === "password";
      input.type = reveal ? "text" : "password";
      button.setAttribute("aria-pressed", String(reveal));
      button.setAttribute("aria-label", `${reveal ? "Hide" : "Show"} ${subject}`);
      label.textContent = reveal ? "Hide" : "Show";
    });
  };
  wirePasswordToggle("#webPassword", "#webPasswordToggle", "#webPasswordToggleLabel", "password");
  wirePasswordToggle("#webResetPassword", "#webResetPasswordToggle", "#webResetPasswordToggleLabel", "new password");
  document.body.append(node);
  return node;
}

function showFatalAuth(message) {
  const overlay = authOverlay();
  overlay.querySelector("#webAuthTitle").textContent = "Web login is not ready";
  overlay.querySelector("#webAuthDescription").textContent = message;
  overlay.querySelector("#webAuthForm").classList.add("hidden");
  overlay.querySelector("#webForgot").classList.add("hidden");
}

async function interactiveSignIn(config, recoverySession = null) {
  const overlay = authOverlay();
  const signInForm = overlay.querySelector("#webAuthForm");
  const resetForm = overlay.querySelector("#webResetForm");
  const errorNode = overlay.querySelector("#webAuthError");
  const description = overlay.querySelector("#webAuthDescription");
  const forgot = overlay.querySelector("#webForgot");

  if (recoverySession) {
    signInForm.classList.add("hidden");
    resetForm.classList.remove("hidden");
    forgot.classList.add("hidden");
    overlay.querySelector("#webAuthTitle").textContent = "Choose a new password";
    description.textContent = "This recovery link is valid only for this browser session.";
  }

  return new Promise((resolve) => {
    signInForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = signInForm.querySelector("button");
      button.disabled = true;
      errorNode.textContent = "";
      try {
        const payload = await supabaseRequest(config, "/auth/v1/token?grant_type=password", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: signInForm.elements.email.value.trim(), password: signInForm.elements.password.value }),
        });
        const session = sessionFromAuthPayload(payload);
        const directory = session && await activeMembershipDirectory(config, session);
        const identity = directory && await selectWorkspace(directory);
        if (!identity) throw new Error("This account has no active MyCrobo workspace.");
        saveSession(session);
        installAuthenticatedFetch(config, identity);
        overlay.remove();
        resolve(hostedSessionDescriptor(identity));
      } catch (error) {
        errorNode.textContent = error instanceof Error ? error.message : "Sign-in failed.";
        button.disabled = false;
      }
    });

    forgot.addEventListener("click", async () => {
      const email = signInForm.elements.email.value.trim();
      if (!email) { errorNode.textContent = "Enter your email first."; return; }
      forgot.disabled = true;
      errorNode.textContent = "";
      try {
        await supabaseRequest(config, "/auth/v1/recover", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, redirect_to: `${window.location.origin}/` }),
        });
        description.textContent = "If that pilot account exists, a password-reset email has been sent.";
      } catch (error) {
        errorNode.textContent = error instanceof Error ? error.message : "The reset email could not be requested.";
      } finally {
        forgot.disabled = false;
      }
    });

    resetForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const button = resetForm.querySelector("button");
      button.disabled = true;
      errorNode.textContent = "";
      try {
        await supabaseRequest(config, "/auth/v1/user", {
          method: "PUT",
          session: recoverySession,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: resetForm.elements.password.value }),
        });
        history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
        saveSession(null);
        overlay.querySelector("#webAuthTitle").textContent = "Password updated";
        description.textContent = "Sign in with your new password.";
        resetForm.classList.add("hidden");
        signInForm.classList.remove("hidden");
        forgot.classList.remove("hidden");
      } catch (error) {
        errorNode.textContent = error instanceof Error ? error.message : "The password could not be updated.";
      } finally {
        button.disabled = false;
      }
    });
  });
}

async function initializeWebAuth() {
  let response;
  try { response = await nativeFetch("/api/v1/web-config", { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000) }); }
  catch {
    showFatalAuth("The closed-pilot identity service could not be reached safely.");
    return new Promise(() => {});
  }
  const config = await response.json().catch(() => ({}));
  const mode = webAuthConfigurationMode(response.status, config, {
    nativeDesktop: typeof window.mycroboDesktop?.authStatus === "function", origin: window.location.origin,
  });
  if (mode === "not-applicable") return null;
  if (mode === "access") {
    const descriptor = hostedSessionDescriptor(null, "cloudflare-access");
    window.mycroboWebSession = Object.freeze({ descriptor, signOut() { window.location.assign("/cdn-cgi/access/logout"); } });
    return descriptor;
  }
  if (mode === "blocked" || !validSupabaseWebConfig(config)) {
    showFatalAuth("The closed-pilot identity service has not been configured yet.");
    return new Promise(() => {});
  }

  config.supabaseUrl = new URL(config.supabaseUrl).origin;
  const recovery = recoverySessionFromHash(window.location.hash);
  if (recovery) return interactiveSignIn(config, recovery);

  let session = readSession();
  if (!usableWebSession(session)) session = await refreshSession(config, session);
  const directory = session && await activeMembershipDirectory(config, session).catch(() => null);
  const identity = directory && await selectWorkspace(directory);
  if (identity) {
    saveSession(session);
    installAuthenticatedFetch(config, identity);
    return hostedSessionDescriptor(identity);
  }
  if (session) await supabaseRequest(config, "/auth/v1/logout", { method: "POST", session }).catch(() => {});
  saveSelectedTenantId(null);
  saveSession(null);
  return interactiveSignIn(config);
}

export const webAuthReady = initializeWebAuth();
