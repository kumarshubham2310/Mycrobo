import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyHostedSession } from './verify-hosted-session.mjs';

const origin = 'https://pilot.example';
const supabase = 'https://pilot.supabase.co';

function response(url, status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('authenticated hosted verifier proves sign-in and fail-closed private boundaries without returning secrets', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', authorization: options.headers?.authorization || '' });
    if (String(url) === `${origin}/api/v1/web-config`) {
      return Object.defineProperty(response(url, 200, {
        authMode: 'supabase', supabaseUrl: `${supabase}/`, supabaseAnonKey: 'sb_publishable_syntheticPublicTestKeyOnly',
      }), 'url', { value: String(url) });
    }
    if (String(url) === `${supabase}/auth/v1/token?grant_type=password`) {
      return Object.defineProperty(response(url, 200, { access_token: `token-${'x'.repeat(40)}`, refresh_token: 'not-returned' }), 'url', { value: String(url) });
    }
    if (String(url) === `${origin}/api/v1/runtime-boundary`) {
      return Object.defineProperty(response(url, 200, {
        surface: 'closed-pilot-web', desktopConnector: 'not_paired', privateChatTransit: false,
        bridgeCredentialsAvailable: false, realMessageSending: false, googleOAuthAvailable: false,
        trustedRelay: { protocol: 'mycrobo.relay-envelope.1', stage: 'foundation_installed', pairingAvailable: false, capabilities: [], ciphertextOnly: true },
      }), 'url', { value: String(url) });
    }
    if ([`${origin}/api/v1/chats`, `${origin}/api/v1/preferences`].includes(String(url))) {
      return Object.defineProperty(response(url, 503, {
        error: 'trusted_desktop_connector_required', message: 'not paired', retryable: false, realMessageSending: false,
      }), 'url', { value: String(url) });
    }
    if (String(url) === `${origin}/api/v1/behavioral-fingerprints`) {
      return Object.defineProperty(response(url, 503, { error: 'tenant_hmac_service_required', stored: false, retryable: false }), 'url', { value: String(url) });
    }
    if (String(url) === `${supabase}/auth/v1/logout?scope=local`) {
      return Object.defineProperty(new Response(null, { status: 204 }), 'url', { value: String(url) });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const report = await verifyHostedSession({
    webUrl: `${origin}/`, email: 'pilot@example.test', password: 'private-test-password', fetchImpl,
  });
  assert.equal(report.status, 'passed');
  assert.equal(report.requests, 7);
  assert.equal(JSON.stringify(report).includes('pilot@example.test'), false);
  assert.equal(JSON.stringify(report).includes('private-test-password'), false);
  assert.equal(JSON.stringify(report).includes('token-'), false);
  assert.equal(calls.at(-1).url, `${supabase}/auth/v1/logout?scope=local`);
  assert.equal(calls.filter((call) => call.authorization).every((call) => call.authorization.startsWith('Bearer token-')), true);
});

test('authenticated hosted verifier blocks before making requests when credentials are absent', async () => {
  let requests = 0;
  const report = await verifyHostedSession({
    webUrl: `${origin}/`, fetchImpl: async () => { requests += 1; throw new Error('must not run'); },
  });
  assert.equal(report.status, 'blocked');
  assert.equal(report.requests, 0);
  assert.equal(requests, 0);
});

test('authenticated hosted verifier fails closed for an unsafe runtime boundary', async () => {
  const fetchImpl = async (url) => {
    const target = String(url);
    if (target.endsWith('/api/v1/web-config')) return Object.defineProperty(response(url, 200, {
      authMode: 'supabase', supabaseUrl: `${supabase}/`, supabaseAnonKey: 'sb_publishable_syntheticPublicTestKeyOnly',
    }), 'url', { value: target });
    if (target.includes('/auth/v1/token')) return Object.defineProperty(response(url, 200, { access_token: `token-${'x'.repeat(40)}` }), 'url', { value: target });
    if (target.endsWith('/api/v1/runtime-boundary')) return Object.defineProperty(response(url, 200, {
      surface: 'closed-pilot-web', desktopConnector: 'paired', privateChatTransit: true,
      bridgeCredentialsAvailable: true, realMessageSending: true, googleOAuthAvailable: true,
    }), 'url', { value: target });
    if (target.includes('/auth/v1/logout')) return Object.defineProperty(new Response(null, { status: 204 }), 'url', { value: target });
    return Object.defineProperty(response(url, 503, { error: 'trusted_desktop_connector_required', realMessageSending: false }), 'url', { value: target });
  };
  const report = await verifyHostedSession({ webUrl: `${origin}/`, email: 'pilot@example.test', password: 'secret', fetchImpl });
  assert.equal(report.status, 'failed');
  assert.equal(report.checks.find((item) => item.id === 'authenticated-runtime-boundary')?.status, 'failed');
});
