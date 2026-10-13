const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

export function loginMode(status) {
  if (status?.authenticated === true) return "authenticated";
  return status?.bootstrapRequired === true ? "bootstrap" : "login";
}

export function validateLoginInput(input, { bootstrap = false } = {}) {
  const email = String(input?.email || "").trim().toLocaleLowerCase();
  const password = String(input?.password || "");
  const displayName = String(input?.displayName || "").replace(/\s+/gu, " ").trim();
  const rawTenantName = String(input?.tenantName || "").replace(/\s+/gu, " ").trim();
  const tenantName = rawTenantName || (displayName ? `${displayName}'s workspace` : "My workspace");
  if (!EMAIL.test(email) || email.length > 254) throw new Error("Enter a valid email address.");
  if (password.length < 12 || password.length > 256) throw new Error("Use at least 12 characters for your password.");
  if (bootstrap && (displayName.length < 2 || displayName.length > 80)) throw new Error("Enter your name.");
  if (bootstrap && rawTenantName && (rawTenantName.length < 2 || rawTenantName.length > 80)) throw new Error("Enter a workspace name.");
  return { email, password, ...(bootstrap ? { displayName, tenantName } : {}) };
}

export function userFacingAuthError(error) {
  const code = String(error?.code || "");
  const rawMessage = String(error?.message || "");
  if (code === "RATE_LIMITED") return "Too many attempts. Wait briefly and try again.";
  if (code === "BOOTSTRAP_CONSUMED") return "Setup was completed in another window. Sign in instead.";
  if (code === "SESSION_REVOKED") return "This session was signed out. Please sign in again.";
  if (code === "MYCROBO_VAULT_KEY_UNREADABLE" || /decrypt(?:ing)?|ciphertext|safeStorage|private vault cannot be unlocked/iu.test(rawMessage)) {
    return "This workspace's private vault could not be unlocked. Your files were preserved. Sign in again to use another assigned workspace, or contact MyCrobo support for recovery.";
  }
  let cleanMessage = rawMessage
    .replace(/^Error:\s*Error invoking remote method '[^']+':\s*/u, "")
    .replace(/^Error invoking remote method '[^']+':\s*/u, "")
    .trim();
  while (cleanMessage.startsWith("Error: ")) {
    cleanMessage = cleanMessage.slice(7).trim();
  }
  if (cleanMessage && /already exists|already belongs|incorrect|attempts|not authorized|workspace role|valid email|12 characters|letter and a number|Enter (?:a |your )?(?:name|workspace|valid)|configured|active (?:MyCrobo )?(?:workspace|account|user)|Sign in to continue/iu.test(cleanMessage)) {
    return cleanMessage;
  }
  if (/Error invoking remote method/iu.test(rawMessage)) return "MyCrobo could not open this workspace. Your private data was not changed. Please try again.";
  return error instanceof Error && cleanMessage ? cleanMessage : "Sign in could not be completed.";
}
