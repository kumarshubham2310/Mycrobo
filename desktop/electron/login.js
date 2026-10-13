import { loginMode, userFacingAuthError, validateLoginInput } from "./login-state.mjs";

const api = window.mycroboDesktop;
const form = document.querySelector("#authForm");
const bootstrapFields = document.querySelector("#bootstrapFields");
const title = document.querySelector("#authTitle");
const description = document.querySelector("#authDescription");
const eyebrow = document.querySelector("#authEyebrow");
const errorNode = document.querySelector("#authError");
const submit = document.querySelector("#submitAuth");
const authenticatedState = document.querySelector("#authenticatedState");
const boundary = document.querySelector("#authBoundary");
const passwordInput = document.querySelector("#passwordInput");
const passwordToggle = document.querySelector("#passwordToggle");
const passwordToggleLabel = document.querySelector("#passwordToggleLabel");
const eyeNormal = document.querySelector(".eyeNormal");
const eyeSlash = document.querySelector(".eyeSlash");
const authSwitch = document.querySelector("#authSwitch");
const authSwitchPrompt = document.querySelector("#authSwitchPrompt");
const toggleAuthMode = document.querySelector("#toggleAuthMode");
const platformMode = new URLSearchParams(window.location.search).get("platform") === "1";
const recoveryMode = new URLSearchParams(window.location.search).get("recovery");
let currentStatus = null;
let mode = "login";

function setPasswordVisibility(reveal) {
  if (!passwordInput || !passwordToggle) return;
  passwordInput.type = reveal ? "text" : "password";
  passwordToggle.setAttribute("aria-pressed", String(reveal));
  passwordToggle.setAttribute("aria-label", `${reveal ? "Hide" : "Show"} password`);
  passwordToggle.title = `${reveal ? "Hide" : "Show"} password`;
  if (passwordToggleLabel) passwordToggleLabel.textContent = reveal ? "Hide" : "Show";
  if (eyeNormal && eyeSlash) {
    eyeNormal.classList.toggle("hidden", reveal);
    eyeSlash.classList.toggle("hidden", !reveal);
  }
}

if (passwordToggle && passwordInput) {
  passwordToggle.addEventListener("click", () => {
    setPasswordVisibility(passwordInput.type === "password");
    passwordInput.focus();
  });
}

if (platformMode) {
  document.title = "Platform Console sign in · MyCrobo";
  boundary.innerHTML = "<b>Commercial access only.</b> The platform console cannot read chat contents, link WhatsApp, or send a message.";
}

function updateModeUI() {
  const isSetup = mode === "bootstrap" || mode === "signup";
  form.classList.toggle("hidden", mode === "authenticated");
  authenticatedState.classList.toggle("hidden", mode !== "authenticated");
  bootstrapFields.classList.toggle("hidden", !isSetup);
  form.elements.displayName.required = isSetup;
  form.elements.password.autocomplete = isSetup ? "new-password" : "current-password";

  if (authSwitch) {
    authSwitch.classList.toggle("hidden", mode === "bootstrap" || mode === "authenticated");
  }

  if (mode === "bootstrap") {
    eyebrow.textContent = platformMode ? "Platform ownership setup" : "Secure first-time setup";
    title.textContent = "Create the first owner";
    description.textContent = platformMode
      ? "Create the first platform administrator and the first tenant. MyCrobo has no hardcoded administrator or password."
      : "Set up your own account and workspace. MyCrobo has no default administrator or password.";
    submit.textContent = platformMode ? "Create platform account" : "Create secure workspace";
  } else if (mode === "signup") {
    eyebrow.textContent = platformMode ? "Platform account setup" : "Create your account";
    title.textContent = platformMode ? "Create platform account" : "Sign up for MyCrobo";
    description.textContent = platformMode
      ? "Create a new administrator account in the platform console."
      : "Set up your account and private workspace. Your chat data stays locally encrypted.";
    submit.textContent = platformMode ? "Create account" : "Sign up";
    if (authSwitchPrompt) authSwitchPrompt.textContent = "Already have an account?";
    if (toggleAuthMode) toggleAuthMode.textContent = "Sign in";
  } else if (mode === "login") {
    eyebrow.textContent = platformMode ? "MyCrobo operations" : "Welcome back";
    title.textContent = platformMode ? "Platform administrator sign in" : "Sign in to MyCrobo";
    description.textContent = platformMode
      ? "Manage tenants, subscriptions, plan limits and coupons in the separate operator console."
      : "Unlock only the workspaces assigned to your account.";
    submit.textContent = platformMode ? "Open platform console" : "Sign in";
    if (authSwitchPrompt) authSwitchPrompt.textContent = "Don't have an account?";
    if (toggleAuthMode) toggleAuthMode.textContent = "Sign up";
  } else {
    eyebrow.textContent = "Signed in";
    title.textContent = currentStatus?.user?.displayName ? `Welcome, ${currentStatus.user.displayName}` : platformMode ? "Platform console is ready" : "Your workspace is ready";
    description.textContent = platformMode ? "Your operator session is active." : currentStatus?.tenant?.name ? `${currentStatus.tenant.name} is selected.` : "Choose an authorized workspace to continue.";
  }
}

function showStatus(status) {
  currentStatus = status;
  const computed = loginMode(status);
  if (computed === "authenticated" || computed === "bootstrap") {
    mode = computed;
  } else if (mode !== "signup") {
    mode = computed;
  }
  updateModeUI();
}

toggleAuthMode?.addEventListener("click", (event) => {
  event.preventDefault();
  errorNode.textContent = "";
  mode = mode === "signup" ? "login" : "signup";
  updateModeUI();
  if (mode === "signup") {
    form.elements.displayName?.focus();
  } else {
    form.elements.email?.focus();
  }
});

async function refresh() {
  if (!api?.authStatus) throw new Error("This build does not include secure account sign-in.");
  showStatus(await api.authStatus());
  if (recoveryMode === "vault") errorNode.textContent = userFacingAuthError({ code: "MYCROBO_VAULT_KEY_UNREADABLE" });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorNode.textContent = "";
  submit.disabled = true;
  const values = Object.fromEntries(new FormData(form));
  try {
    const isSignup = mode === "bootstrap" || mode === "signup";
    const input = validateLoginInput(values, { bootstrap: isSignup });
    if (isSignup) await api.bootstrapOwner(input);
    else await api.signIn(input);
    form.elements.password.value = "";
    setPasswordVisibility(false);
    await refresh();
  } catch (error) {
    form.elements.password.value = "";
    setPasswordVisibility(false);
    errorNode.textContent = userFacingAuthError(error);
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#continueButton").addEventListener("click", () => window.close());
refresh().catch((error) => {
  title.textContent = "Sign in is unavailable";
  description.textContent = "MyCrobo kept your private workspaces locked.";
  errorNode.textContent = userFacingAuthError(error);
  form.classList.remove("hidden");
  submit.disabled = true;
});
