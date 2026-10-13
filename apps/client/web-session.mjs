import { shouldAttachWebSession, usableWebSession } from "./web-auth-contract.mjs";

// Refresh is serialized before a request. A rejected request is returned as-is:
// replaying a POST could duplicate an operation whose outcome is uncertain.
export function createAuthenticatedWebFetch({ origin, fetchImpl, readSession, saveSession, refreshSession, onAuthRequired, now = Date.now }) {
  let refreshInFlight = null;
  let generation = 0;
  let reauthenticationStarted = false;

  function invalidate({ reauthenticate = true } = {}) {
    generation += 1;
    saveSession(null);
    if (reauthenticate && !reauthenticationStarted) {
      reauthenticationStarted = true;
      void Promise.resolve().then(onAuthRequired).catch(() => {});
    }
  }

  async function currentSession() {
    const session = readSession();
    if (usableWebSession(session, now())) return session;
    if (!refreshInFlight) {
      const startedAt = generation;
      refreshInFlight = (async () => {
        let refreshed = null;
        try { if (session?.refresh_token) refreshed = await refreshSession(session); } catch { /* reauthenticate below */ }
        if (generation !== startedAt) return null;
        if (!usableWebSession(refreshed, now())) { invalidate(); return null; }
        saveSession(refreshed);
        return refreshed;
      })().finally(() => { refreshInFlight = null; });
    }
    return refreshInFlight;
  }

  async function authenticatedFetch(input, options = {}) {
    if (!shouldAttachWebSession(input, origin)) return fetchImpl(input, options);
    const requestGeneration = generation;
    const session = await currentSession();
    if (!session || generation !== requestGeneration || readSession()?.access_token !== session.access_token) throw new Error("Sign in again to continue.");
    const headers = new Headers(options.headers || (input instanceof Request ? input.headers : undefined));
    headers.set("authorization", `Bearer ${session.access_token}`);
    const response = await fetchImpl(input, { ...options, headers, credentials: "omit", redirect: "error", cache: "no-store" });
    if (response.status === 401 && generation === requestGeneration && readSession()?.access_token === session.access_token) invalidate();
    return response;
  }

  return Object.freeze({ fetch: authenticatedFetch, invalidate });
}
