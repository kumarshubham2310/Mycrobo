import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import worker from './src/worker.mjs';

const configPath = new URL('./wrangler.toml.example', import.meta.url);
const previewConfigPath = new URL('./wrangler.workers-dev.toml.example', import.meta.url);
const supabaseAuthConfigPath = new URL('./wrangler.supabase-auth.toml.example', import.meta.url);
const assetIgnorePath = new URL('../../apps/client/.assetsignore', import.meta.url);
const [config, previewConfig, supabaseAuthConfig, assetIgnore] = await Promise.all([
  readFile(configPath, 'utf8'),
  readFile(previewConfigPath, 'utf8'),
  readFile(supabaseAuthConfigPath, 'utf8'),
  readFile(assetIgnorePath, 'utf8'),
]);

function testEnvironment(overrides = {}) {
  let assetFetches = 0;
  return {
    env: {
      CF_ACCESS_REQUIRED: 'false',
      ALLOW_INSECURE_LOCAL_DEV: 'true',
      ALLOWED_ORIGINS: 'http://127.0.0.1',
      ASSETS: {
        async fetch() {
          assetFetches += 1;
          return new Response('<!doctype html><title>MyCrobo</title>', {
            headers: { 'content-type': 'text/html; charset=utf-8' },
          });
        },
      },
      ...overrides,
    },
    assetFetchCount: () => assetFetches,
  };
}

test('Wrangler serves the existing client as a Worker-protected SPA', () => {
  assert.match(config, /directory = "\.\.\/\.\.\/apps\/client"/);
  assert.match(config, /binding = "ASSETS"/);
  assert.match(config, /not_found_handling = "single-page-application"/);
  assert.match(config, /run_worker_first = true/);
  assert.match(config, /workers_dev = false/);
  assert.match(config, /CF_ACCESS_REQUIRED = "true"/);
  assert.match(previewConfig, /workers_dev = true/);
  assert.match(previewConfig, /CF_ACCESS_REQUIRED = "true"/);
  assert.match(supabaseAuthConfig, /AUTH_MODE = "supabase"/);
  assert.match(supabaseAuthConfig, /workers_dev = true/);
  assert.doesNotMatch(`${config}\n${previewConfig}\n${supabaseAuthConfig}`, /service[_-]?role|client[_-]?secret|private[_-]?key/i);
  assert.match(assetIgnore, /^\*\.test\.mjs\s*$/u);
});

test('Supabase mode serves only the public shell before sign-in and exposes bounded public configuration', async () => {
  const runtime = testEnvironment({
    AUTH_MODE: 'supabase',
    SUPABASE_URL: 'https://pilot.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_syntheticPublicTestKeyOnly',
    ALLOW_INSECURE_LOCAL_DEV: undefined,
  });
  const shell = await worker.fetch(new Request('https://pilot.example/'), runtime.env);
  assert.equal(shell.status, 200);
  assert.equal(runtime.assetFetchCount(), 1);

  const configResponse = await worker.fetch(new Request('https://pilot.example/api/v1/web-config'), runtime.env);
  assert.equal(configResponse.status, 200);
  assert.deepEqual(await configResponse.json(), {
    authMode: 'supabase',
    supabaseUrl: 'https://pilot.supabase.co',
    supabaseAnonKey: 'sb_publishable_syntheticPublicTestKeyOnly',
  });

  const privateResponse = await worker.fetch(new Request('https://pilot.example/api/v1/chats'), runtime.env);
  assert.equal(privateResponse.status, 401);
  assert.deepEqual(await privateResponse.json(), { error: 'supabase_session_required' });
});

test('same-origin module requests remain loadable without opening cross-origin access', async () => {
  const runtime = testEnvironment({
    AUTH_MODE: 'supabase',
    SUPABASE_URL: 'https://pilot.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_syntheticPublicTestKeyOnly',
    ALLOWED_ORIGINS: '',
    ALLOW_INSECURE_LOCAL_DEV: undefined,
  });
  const sameOrigin = await worker.fetch(new Request('https://pilot.example/app.js', {
    headers: { origin: 'https://pilot.example' },
  }), runtime.env);
  assert.equal(sameOrigin.status, 200);
  assert.equal(runtime.assetFetchCount(), 1);
  // Same-origin modules do not need CORS response headers. The request must
  // load, while a foreign Origin remains rejected below.
  assert.equal(sameOrigin.headers.get('access-control-allow-origin'), null);

  const crossOrigin = await worker.fetch(new Request('https://pilot.example/app.js', {
    headers: { origin: 'https://attacker.example' },
  }), runtime.env);
  assert.equal(crossOrigin.status, 403);
  assert.deepEqual(await crossOrigin.json(), { error: 'origin_not_allowed' });
  assert.equal(runtime.assetFetchCount(), 1);
});

test('privileged public keys and credentialed or non-origin project URLs fail closed without disclosure', async () => {
  const roleKey = `e30.${Buffer.from('{"role":"service_role"}').toString('base64url')}.syntheticSignature`;
  const settings = [
    { SUPABASE_ANON_KEY: roleKey },
    { SUPABASE_ANON_KEY: 'sb_secret_syntheticPrivilegedTestValue' },
    { SUPABASE_URL: 'https://user:password@pilot.supabase.co' },
    { SUPABASE_URL: 'https://pilot.supabase.co/rest/v1' },
    { SUPABASE_URL: 'https://pilot.supabase.co?x=1' },
    { SUPABASE_URL: 'https://nested.pilot.supabase.co' },
  ];
  for (const override of settings) {
    const runtime = testEnvironment({ AUTH_MODE: 'supabase', SUPABASE_URL: 'https://pilot.supabase.co', SUPABASE_ANON_KEY: 'sb_publishable_syntheticPublicTestKeyOnly', ...override });
    const response = await worker.fetch(new Request('https://pilot.example/api/v1/web-config'), runtime.env);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'supabase_auth_not_configured' });
    const privateResponse = await worker.fetch(new Request('https://pilot.example/api/v1/runtime-boundary', { headers: { authorization: 'Bearer synthetic-session' } }), runtime.env);
    assert.equal(privateResponse.status, 401);
  }
});

test('authenticated hosted capability remains metadata-only including unavailable Google OAuth', async () => {
  const runtime = testEnvironment({ RELAY_FOUNDATION_STAGE: 'ciphertext-only-v1' });
  const response = await worker.fetch(new Request('http://127.0.0.1/api/v1/runtime-boundary'), runtime.env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { surface: 'closed-pilot-web', desktopConnector: 'not_paired', privateChatTransit: false, bridgeCredentialsAvailable: false, realMessageSending: false, googleOAuthAvailable: false, trustedRelay: { protocol: 'mycrobo.relay-envelope.1', stage: 'foundation_installed', pairingAvailable: false, capabilities: [], ciphertextOnly: true } });
  for (const path of ['/api/v1/integrations/google/connect', '/api/v1/status', '/api/v1/chats']) {
    const rejected = await worker.fetch(new Request(`http://127.0.0.1${path}`), runtime.env);
    assert.equal(rejected.status, 503);
    assert.equal((await rejected.json()).error, 'trusted_desktop_connector_required');
  }
});

test('relay foundation metadata never enables pairing or a private capability', async () => {
  for (const stage of [undefined, 'ciphertext-only-v1', 'unexpected']) {
    const runtime = testEnvironment({ RELAY_FOUNDATION_STAGE: stage });
    const response = await worker.fetch(new Request('http://127.0.0.1/api/v1/runtime-boundary'), runtime.env);
    const body = await response.json();
    assert.equal(body.trustedRelay.stage, stage === 'ciphertext-only-v1' ? 'foundation_installed' : 'not_provisioned');
    assert.equal(body.trustedRelay.pairingAvailable, false);
    assert.deepEqual(body.trustedRelay.capabilities, []);
    assert.equal(body.privateChatTransit, false);
    assert.equal(body.realMessageSending, false);
  }
});

test('behavioral fingerprint ingestion stays closed until a trusted tenant HMAC service exists', async () => {
  const runtime = testEnvironment();
  const response = await worker.fetch(new Request('http://127.0.0.1/api/v1/behavioral-fingerprints', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tenant_id: '018f3f2e-f7e7-4e39-8a88-6c4e76829f11',
      subject_hash: 'a'.repeat(64),
      sample_started_at: '2026-10-01T00:00:00.000Z',
      sample_ended_at: '2026-10-02T00:00:00.000Z',
      observation_count: 12,
    }),
  }), runtime.env);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'tenant_hmac_service_required',
    stored: false,
    retryable: false,
  });
  assert.equal(runtime.assetFetchCount(), 0);
});

test('Supabase mode validates the bearer with Auth before reaching any private route', async () => {
  const runtime = testEnvironment({
    AUTH_MODE: 'supabase',
    SUPABASE_URL: 'https://pilot.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_syntheticPublicTestKeyOnly',
    ALLOW_INSECURE_LOCAL_DEV: undefined,
  });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ id: '028f3f2e-f7e7-4e39-8a88-6c4e76829f12' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const response = await worker.fetch(new Request('https://pilot.example/api/v1/chats', {
      headers: { authorization: 'Bearer verified-session' },
    }), runtime.env);
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'trusted_desktop_connector_required');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://pilot.supabase.co/auth/v1/user');
    assert.equal(calls[0].options.headers.apikey, 'sb_publishable_syntheticPublicTestKeyOnly');
    assert.equal(calls[0].options.headers.authorization, 'Bearer verified-session');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('browser relay registration derives the user from Auth and lets RLS bind the selected tenant', async () => {
  const runtime = testEnvironment({
    AUTH_MODE: 'supabase',
    SUPABASE_URL: 'https://pilot.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_syntheticPublicTestKeyOnly',
    RELAY_FOUNDATION_STAGE: 'ciphertext-only-v1',
    ALLOW_INSECURE_LOCAL_DEV: undefined,
  });
  const tenantId = '018f3f2e-f7e7-4e39-8a88-6c4e76829f11';
  const userId = '028f3f2e-f7e7-4e39-8a88-6c4e76829f12';
  const deviceId = '038f3f2e-f7e7-4e39-8a88-6c4e76829f13';
  const publicKey = Buffer.from([4, ...Array(64).fill(7)]).toString('base64url');
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/auth/v1/user')) return Response.json({ id: userId });
    const body = JSON.parse(options.body);
    assert.equal(body.tenant_id, tenantId);
    assert.equal(body.user_id, userId);
    assert.equal(body.id, deviceId);
    assert.equal(body.device_kind, 'web_client');
    assert.equal(body.key_algorithm, 'p256');
    assert.match(body.device_public_key, /^\\x04[0-9a-f]{128}$/u);
    return Response.json([body], { status: 201 });
  };
  try {
    const response = await worker.fetch(new Request('https://pilot.example/api/v1/relay/browser-device', {
      method: 'POST',
      headers: {
        authorization: 'Bearer verified-session',
        'content-type': 'application/json',
        'x-mycrobo-tenant-id': tenantId,
      },
      body: JSON.stringify({ deviceId, publicKey }),
    }), runtime.env);
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      registered: true, deviceId, deviceKind: 'web_client', pairingAvailable: false, capabilities: [],
    });
    assert.equal(calls.length, 2);
    assert.match(calls[1].url, /\/rest\/v1\/devices\?on_conflict=id$/u);
    assert.equal(calls[1].options.headers.authorization, 'Bearer verified-session');
    assert.equal(calls[1].options.headers.prefer, 'resolution=merge-duplicates,return=representation');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('browser relay registration rejects malformed or cross-workspace-shaped input before storage', async () => {
  const runtime = testEnvironment({
    AUTH_MODE: 'supabase',
    SUPABASE_URL: 'https://pilot.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_syntheticPublicTestKeyOnly',
    RELAY_FOUNDATION_STAGE: 'ciphertext-only-v1',
    ALLOW_INSECURE_LOCAL_DEV: undefined,
  });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ id: '028f3f2e-f7e7-4e39-8a88-6c4e76829f12' });
  };
  try {
    const response = await worker.fetch(new Request('https://pilot.example/api/v1/relay/browser-device', {
      method: 'POST',
      headers: { authorization: 'Bearer verified-session', 'content-type': 'application/json', 'x-mycrobo-tenant-id': 'not-a-tenant' },
      body: JSON.stringify({ deviceId: 'not-a-device', publicKey: 'private material is forbidden' }),
    }), runtime.env);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'verified_tenant_required', registered: false });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Supabase mode fails closed for invalid configuration or rejected sessions', async () => {
  const missing = testEnvironment({ AUTH_MODE: 'supabase', SUPABASE_URL: 'https://not-configured.invalid', SUPABASE_ANON_KEY: 'disabled' });
  const configResponse = await worker.fetch(new Request('https://pilot.example/api/v1/web-config'), missing.env);
  assert.equal(configResponse.status, 503);

  const runtime = testEnvironment({
    AUTH_MODE: 'supabase',
    SUPABASE_URL: 'https://pilot.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_syntheticPublicTestKeyOnly',
    ALLOW_INSECURE_LOCAL_DEV: undefined,
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 401 });
  try {
    const response = await worker.fetch(new Request('https://pilot.example/api/v1/runtime-boundary', {
      headers: { authorization: 'Bearer rejected-session' },
    }), runtime.env);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'supabase_session_required' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('static PWA is served with restrictive browser headers and no cache for its shell', async () => {
  const runtime = testEnvironment();
  const response = await worker.fetch(new Request('http://127.0.0.1/'), runtime.env);
  assert.equal(response.status, 200);
  assert.equal(runtime.assetFetchCount(), 1);
  assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(response.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000; includeSubDomains');
  assert.equal(response.headers.get('cache-control'), 'no-cache, no-store, must-revalidate');
});

test('same-origin cloud health route does not touch the static asset binding', async () => {
  const runtime = testEnvironment();
  const response = await worker.fetch(new Request('http://127.0.0.1/api/healthz'), runtime.env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', surface: 'closed-pilot-web' });
  assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000; includeSubDomains');
  assert.equal(runtime.assetFetchCount(), 0);
});

test('private desktop APIs fail closed instead of exposing chats or delivery', async () => {
  const runtime = testEnvironment();
  for (const path of ['/api/v1/chats', '/api/v1/pairing-phone', '/api/v1/chats/a/send']) {
    const response = await worker.fetch(new Request(`http://127.0.0.1${path}`), runtime.env);
    assert.equal(response.status, 503, path);
    assert.deepEqual(await response.json(), {
      error: 'trusted_desktop_connector_required',
      message: 'This web surface is not paired with a tenant-bound desktop connector.',
      retryable: false,
      realMessageSending: false,
    });
  }
  assert.equal(runtime.assetFetchCount(), 0);
});

test('Access remains mandatory in deployed configuration', async () => {
  const runtime = testEnvironment({
    CF_ACCESS_REQUIRED: 'true',
    CF_ACCESS_TEAM_DOMAIN: 'https://pilot.cloudflareaccess.com',
    CF_ACCESS_AUD: 'pilot-aud',
  });
  const response = await worker.fetch(new Request('https://pilot.example/'), runtime.env);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'cloudflare_access_required' });
  assert.equal(runtime.assetFetchCount(), 0);
});

test('Access fails closed when its production flag is absent or mistyped', async () => {
  for (const value of [undefined, 'false', 'TRUE', 'yes']) {
    const runtime = testEnvironment({
      CF_ACCESS_REQUIRED: value,
      ALLOW_INSECURE_LOCAL_DEV: undefined,
      ALLOWED_ORIGINS: 'https://pilot.example',
    });
    const response = await worker.fetch(new Request('https://pilot.example/'), runtime.env);
    assert.equal(response.status, 403, String(value));
    assert.deepEqual(await response.json(), { error: 'cloudflare_access_required' });
    assert.equal(runtime.assetFetchCount(), 0);
  }
});

test('the insecure bypass is accepted only when explicit and loopback', async () => {
  const runtime = testEnvironment({ ALLOW_INSECURE_LOCAL_DEV: 'true' });
  const response = await worker.fetch(new Request('http://127.0.0.1/'), runtime.env);
  assert.equal(response.status, 200);

  const remote = testEnvironment({
    ALLOW_INSECURE_LOCAL_DEV: 'true',
    ALLOWED_ORIGINS: 'https://pilot.example',
  });
  const rejected = await worker.fetch(new Request('https://pilot.example/'), remote.env);
  assert.equal(rejected.status, 403);
});

test('cross-origin API access is rejected before cloud or desktop routing', async () => {
  const runtime = testEnvironment();
  const response = await worker.fetch(new Request('http://127.0.0.1/api/v1/chats', {
    headers: { origin: 'https://attacker.example' },
  }), runtime.env);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'origin_not_allowed' });
  assert.equal(runtime.assetFetchCount(), 0);
});
