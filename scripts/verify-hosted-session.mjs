import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { validSupabaseWebConfig } from '../apps/client/web-auth-contract.mjs';
import { hostedOrigin } from './verify-hosted-pwa.mjs';

const MAX_JSON_BYTES = 65_536;
const EXPECTED_RUNTIME_BOUNDARY = Object.freeze({
  surface: 'closed-pilot-web',
  desktopConnector: 'not_paired',
  privateChatTransit: false,
  bridgeCredentialsAvailable: false,
  realMessageSending: false,
  googleOAuthAvailable: false,
  trustedRelay: Object.freeze({
    protocol: 'mycrobo.relay-envelope.1',
    stage: 'foundation_installed',
    pairingAvailable: false,
    capabilities: Object.freeze([]),
    ciphertextOnly: true,
  }),
});

async function boundedJson(response, maximum = MAX_JSON_BYTES) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maximum) {
    await response.body?.cancel().catch(() => {});
    throw new Error('Response exceeds the verification size limit.');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maximum) throw new Error('Response exceeds the verification size limit.');
  return JSON.parse(new TextDecoder().decode(bytes));
}

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\u0000') === [...keys].sort().join('\u0000');
}

function validPublicConfig(config) {
  return validSupabaseWebConfig(config);
}

function runtimeBoundaryMatches(value) {
  return exactKeys(value, Object.keys(EXPECTED_RUNTIME_BOUNDARY))
    && Object.entries(EXPECTED_RUNTIME_BOUNDARY).every(([key, expected]) => {
      if (key !== 'trustedRelay') return value[key] === expected;
      return exactKeys(value[key], Object.keys(expected))
        && value[key].protocol === expected.protocol
        && value[key].stage === expected.stage
        && value[key].pairingAvailable === false
        && Array.isArray(value[key].capabilities) && value[key].capabilities.length === 0
        && value[key].ciphertextOnly === true;
    });
}

function credential(value) {
  const normalized = String(value || '').trim();
  return normalized && !/[\r\n\0]/u.test(normalized) ? normalized : '';
}

/**
 * Exercises only the hosted authentication and fail-closed cloud boundary.
 * It never requests chat bodies, stores provider tokens, or invokes delivery.
 */
export async function verifyHostedSession({
  webUrl,
  email,
  password,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10_000,
} = {}) {
  const checks = [];
  const add = (id, status, detail) => checks.push({ id, status, detail });
  const check = (id, passed, detail) => add(id, passed ? 'passed' : 'failed', detail);
  let origin;
  try { origin = hostedOrigin(webUrl); }
  catch {
    add('hosted-url', 'blocked', webUrl ? 'MYCROBO_WEB_URL must be an exact hosted HTTPS origin.' : 'MYCROBO_WEB_URL is not configured.');
    return { schema: 'mycrobo-hosted-session-check.1', status: 'blocked', requests: 0, checks };
  }
  const normalizedEmail = credential(email);
  const normalizedPassword = credential(password);
  if (!normalizedEmail || !normalizedPassword) {
    add('pilot-credentials', 'blocked', 'Set MYCROBO_PILOT_EMAIL and MYCROBO_PILOT_PASSWORD in the invoking process. Values are never printed or persisted.');
    return { schema: 'mycrobo-hosted-session-check.1', status: 'blocked', requests: 0, checks };
  }

  let requests = 0;
  const request = async (url, options = {}) => {
    requests += 1;
    const response = await fetchImpl(url, {
      redirect: 'manual',
      cache: 'no-store',
      credentials: 'omit',
      signal: AbortSignal.timeout(timeoutMs),
      ...options,
    });
    if (response.redirected || !response.url || new URL(response.url).origin !== new URL(url).origin) {
      await response.body?.cancel().catch(() => {});
      throw new Error('Verification request redirected away from its approved origin.');
    }
    return response;
  };

  let config;
  let accessToken = '';
  let supabaseOrigin = '';
  try {
    const configResponse = await request(`${origin}/api/v1/web-config`, { headers: { accept: 'application/json' } });
    config = await boundedJson(configResponse);
    check('public-auth-config', configResponse.status === 200 && validPublicConfig(config), 'Hosted auth configuration is a bounded public Supabase configuration.');
    if (configResponse.status !== 200 || !validPublicConfig(config)) throw new Error('Hosted authentication configuration is invalid.');
    supabaseOrigin = new URL(config.supabaseUrl).origin;

    const signInResponse = await request(`${supabaseOrigin}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: config.supabaseAnonKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ email: normalizedEmail, password: normalizedPassword }),
    });
    const session = await boundedJson(signInResponse);
    accessToken = signInResponse.status === 200 ? String(session?.access_token || '') : '';
    check('pilot-sign-in', signInResponse.status === 200 && accessToken.length >= 32, 'Supabase accepted the closed-pilot account; tokens remain memory-only and are omitted from this report.');
    if (!accessToken) throw new Error('Closed-pilot sign-in failed.');

    const authorization = { authorization: `Bearer ${accessToken}`, accept: 'application/json' };
    const runtimeResponse = await request(`${origin}/api/v1/runtime-boundary`, { headers: authorization });
    const runtime = await boundedJson(runtimeResponse);
    check('authenticated-runtime-boundary', runtimeResponse.status === 200 && runtimeBoundaryMatches(runtime), 'The authenticated PWA reports the exact fail-closed desktop-relay boundary.');

    for (const path of ['/api/v1/chats', '/api/v1/preferences']) {
      const response = await request(`${origin}${path}`, { headers: authorization });
      const body = await boundedJson(response);
      check(`private-route:${path}`, response.status === 503
        && body?.error === 'trusted_desktop_connector_required'
        && body?.realMessageSending === false,
      'The authenticated shell cannot read desktop-private data or send a message before a trusted tenant-bound relay exists.');
    }

    const fingerprintResponse = await request(`${origin}/api/v1/behavioral-fingerprints`, {
      method: 'POST',
      headers: { ...authorization, 'content-type': 'application/json' },
      body: '{}',
    });
    const fingerprint = await boundedJson(fingerprintResponse);
    check('browser-fingerprint-ingest', fingerprintResponse.status === 503
      && fingerprint?.error === 'tenant_hmac_service_required'
      && fingerprint?.stored === false,
    'Browser-supplied identity digests remain rejected until a trusted tenant HMAC service exists.');
  } catch {
    if (!checks.some((item) => item.status === 'failed')) add('authenticated-flow', 'failed', 'The bounded authenticated verification flow failed; credentials, tokens and response bodies are omitted.');
  } finally {
    if (accessToken && supabaseOrigin && config?.supabaseAnonKey) {
      try {
        const logout = await request(`${supabaseOrigin}/auth/v1/logout?scope=local`, {
          method: 'POST',
          headers: { apikey: config.supabaseAnonKey, authorization: `Bearer ${accessToken}` },
        });
        await logout.body?.cancel().catch(() => {});
        check('session-cleanup', logout.ok, 'The verifier invalidated its refreshable provider session and retained no token.');
      } catch {
        add('session-cleanup', 'failed', 'The provider session cleanup request failed; no token was persisted by the verifier.');
      }
    }
  }

  const status = checks.some((item) => item.status === 'failed') ? 'failed'
    : checks.some((item) => item.status === 'blocked') ? 'blocked' : 'passed';
  return {
    schema: 'mycrobo-hosted-session-check.1',
    status,
    requests,
    checks,
    limitations: [
      'This verifies sign-in and cloud fail-closed boundaries only; it does not read chat content, validate another tenant, pair a desktop relay, or send a message.',
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await verifyHostedSession({
    webUrl: process.env.MYCROBO_WEB_URL,
    email: process.env.MYCROBO_PILOT_EMAIL,
    password: process.env.MYCROBO_PILOT_PASSWORD,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === 'passed' ? 0 : report.status === 'blocked' ? 2 : 1;
}
