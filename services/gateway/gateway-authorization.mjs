const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const GATEWAY_ROLES = Object.freeze(["viewer", "member", "admin", "owner"]);

const ROLE_CAPABILITIES = Object.freeze({
  viewer: Object.freeze([]),
  member: Object.freeze([
    "draft.generate",
    "integration.sync",
    "media.retry",
    "personalization.write",
    "preferences.write",
    "send.approve",
    "send.execute",
    "translation.run",
    "workspace.write",
  ]),
  admin: Object.freeze([
    "connection.manage",
    "draft.generate",
    "integration.manage",
    "integration.sync",
    "media.retry",
    "personalization.write",
    "preferences.write",
    "send.approve",
    "send.execute",
    "translation.run",
    "workspace.write",
  ]),
  owner: Object.freeze([
    "connection.manage",
    "draft.generate",
    "integration.manage",
    "integration.sync",
    "media.retry",
    "personalization.write",
    "preferences.write",
    "privacy.destroy",
    "send.approve",
    "send.execute",
    "translation.run",
    "workspace.write",
  ]),
});

const exact = (value) => (pathname) => pathname === value;
const pattern = (value) => (pathname) => value.test(pathname);

// This is the complete allowlist for state-changing gateway operations. A new
// POST/PUT/PATCH/DELETE route is denied until it is deliberately added here.
// Google OAuth callback is included even though OAuth requires a GET because a
// successful callback persists connector state.
export const GATEWAY_MUTATION_RULES = Object.freeze([
  Object.freeze({ id: "google-oauth-callback", method: "GET", samplePath: "/oauth/google/callback", capability: "connection.manage", matches: exact("/oauth/google/callback") }),
  Object.freeze({ id: "translation-run", method: "POST", samplePath: "/api/v1/translation", capability: "translation.run", matches: exact("/api/v1/translation") }),
  Object.freeze({ id: "whatsapp-logout", method: "POST", samplePath: "/api/v1/integrations/whatsapp/logout", capability: "connection.manage", matches: exact("/api/v1/integrations/whatsapp/logout") }),
  Object.freeze({ id: "google-connect", method: "POST", samplePath: "/api/v1/integrations/google/start", capability: "connection.manage", matches: exact("/api/v1/integrations/google/start") }),
  Object.freeze({ id: "google-sync", method: "POST", samplePath: "/api/v1/integrations/google/sync", capability: "integration.sync", matches: exact("/api/v1/integrations/google/sync") }),
  Object.freeze({ id: "google-disconnect", method: "DELETE", samplePath: "/api/v1/integrations/google", capability: "integration.manage", matches: exact("/api/v1/integrations/google") }),
  Object.freeze({ id: "context-import", method: "POST", samplePath: "/api/v1/integrations/import", capability: "integration.manage", matches: exact("/api/v1/integrations/import") }),
  Object.freeze({ id: "context-remove", method: "DELETE", samplePath: "/api/v1/integrations/contacts", capability: "integration.manage", matches: pattern(/^\/api\/v1\/integrations\/(?:contacts|calendar)$/u) }),
  Object.freeze({ id: "user-state-reset", method: "DELETE", samplePath: "/api/v1/privacy/user-state", capability: "privacy.destroy", matches: exact("/api/v1/privacy/user-state") }),
  Object.freeze({ id: "legacy-recovery-delete", method: "DELETE", samplePath: "/api/v1/privacy/legacy-recovery", capability: "privacy.destroy", matches: exact("/api/v1/privacy/legacy-recovery") }),
  Object.freeze({ id: "phone-pairing", method: "POST", samplePath: "/api/v1/pairing-phone", capability: "connection.manage", matches: exact("/api/v1/pairing-phone") }),
  Object.freeze({ id: "qr-pairing", method: "POST", samplePath: "/api/v1/pairing-use-qr", capability: "connection.manage", matches: exact("/api/v1/pairing-use-qr") }),
  Object.freeze({ id: "pairing-restart", method: "POST", samplePath: "/api/v1/pairing-restart", capability: "connection.manage", matches: exact("/api/v1/pairing-restart") }),
  Object.freeze({ id: "media-retry", method: "POST", samplePath: "/api/v1/media/message-1/retry", capability: "media.retry", matches: pattern(/^\/api\/v1\/media\/[^/]+\/retry$/u) }),
  Object.freeze({ id: "preferences-update", method: "PUT", samplePath: "/api/v1/preferences", capability: "preferences.write", matches: exact("/api/v1/preferences") }),
  Object.freeze({ id: "chat-style-update", method: "PUT", samplePath: "/api/v1/chats/chat-1/style", capability: "preferences.write", matches: pattern(/^\/api\/v1\/chats\/[^/]+\/style$/u) }),
  Object.freeze({ id: "draft-feedback", method: "POST", samplePath: "/api/v1/chats/chat-1/draft-feedback", capability: "personalization.write", matches: pattern(/^\/api\/v1\/chats\/[^/]+\/draft-feedback$/u) }),
  Object.freeze({ id: "personalization-outcome", method: "POST", samplePath: "/api/v1/chats/chat-1/personalization-outcome", capability: "personalization.write", matches: pattern(/^\/api\/v1\/chats\/[^/]+\/personalization-outcome$/u) }),
  Object.freeze({ id: "task-update", method: "POST", samplePath: "/api/v1/tasks/task-1", capability: "workspace.write", matches: pattern(/^\/api\/v1\/(?:tasks|followups)\/[^/]+$/u) }),
  Object.freeze({ id: "decision-update", method: "POST", samplePath: "/api/v1/decisions/decision-1", capability: "workspace.write", matches: pattern(/^\/api\/v1\/decisions\/[^/]+$/u) }),
  Object.freeze({ id: "whatsapp-import", method: "POST", samplePath: "/api/v1/connect", capability: "connection.manage", matches: exact("/api/v1/connect") }),
  Object.freeze({ id: "draft-generate", method: "POST", samplePath: "/api/v1/chats/chat-1/draft", capability: "draft.generate", matches: pattern(/^\/api\/v1\/chats\/[^/]+\/draft$/u) }),
  Object.freeze({ id: "send-approve", method: "POST", samplePath: "/api/v1/chats/chat-1/send-approval", capability: "send.approve", matches: pattern(/^\/api\/v1\/chats\/[^/]+\/send-approval$/u) }),
  Object.freeze({ id: "send-execute", method: "POST", samplePath: "/api/v1/chats/chat-1/send", capability: "send.execute", matches: pattern(/^\/api\/v1\/chats\/[^/]+\/send$/u) }),
  Object.freeze({ id: "legacy-send-execute", method: "POST", samplePath: "/api/v1/send", capability: "send.execute", matches: exact("/api/v1/send") }),
]);

function normalizedMethod(method) {
  return String(method || "GET").toUpperCase();
}

export function normalizeGatewayRole(role) {
  const normalized = String(role || "").trim().toLowerCase();
  return GATEWAY_ROLES.includes(normalized) ? normalized : "";
}

export function gatewayMutationRule(method, pathname) {
  const normalized = normalizedMethod(method);
  return GATEWAY_MUTATION_RULES.find((rule) => rule.method === normalized && rule.matches(String(pathname || ""))) || null;
}

export function roleAllowsGatewayCapability(role, capability) {
  const normalized = normalizeGatewayRole(role);
  return Boolean(normalized && ROLE_CAPABILITIES[normalized].includes(String(capability || "")));
}

export function authorizeGatewayCapability({ method, pathname, role }) {
  const normalized = normalizedMethod(method);
  const path = String(pathname || "");
  const rule = gatewayMutationRule(normalized, path);
  const isMutation = MUTATING_METHODS.has(normalized) || path === "/oauth/google/callback";
  if (!isMutation) return Object.freeze({ ok: true, mutation: false, role: normalizeGatewayRole(role) || null });
  if (!rule) return Object.freeze({ ok: false, mutation: true, status: 403, code: "MUTATION_ROUTE_NOT_ALLOWLISTED" });
  const trustedRole = normalizeGatewayRole(role);
  if (!trustedRole) return Object.freeze({ ok: false, mutation: true, status: 403, code: "TRUSTED_ROLE_REQUIRED", capability: rule.capability });
  if (!roleAllowsGatewayCapability(trustedRole, rule.capability)) {
    return Object.freeze({ ok: false, mutation: true, status: 403, code: "ROLE_CAPABILITY_DENIED", role: trustedRole, capability: rule.capability });
  }
  return Object.freeze({ ok: true, mutation: true, role: trustedRole, capability: rule.capability, ruleId: rule.id });
}
