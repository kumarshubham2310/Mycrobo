import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { verifyHostedPwa } from '../scripts/verify-hosted-pwa.mjs';
import worker from '../infrastructure/cloudflare/src/worker.mjs';

const origin = 'https://mycrobo-pilot.example';
const anonKey = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from('{"role":"anon"}').toString('base64url')}.syntheticSignature`;
function fixture(modify = () => {}) {
  const calls = [];
  const env = { AUTH_MODE: 'supabase', SUPABASE_URL: 'https://pilot.supabase.co', SUPABASE_ANON_KEY: anonKey,
    ASSETS: { async fetch(request) {
      const pathname = new URL(request.url).pathname;
      const file = pathname === '/' ? 'index.html' : pathname.slice(1);
      const body = await readFile(new URL(`../apps/client/${file}`, import.meta.url));
      const type = file.endsWith('.png') ? 'image/png' : file.endsWith('.webmanifest') ? 'application/manifest+json' : /\.m?js$/u.test(file) ? 'text/javascript' : 'text/html';
      return new Response(body, { headers: { 'content-type': type } });
    } },
  };
  return { calls, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    const response = await worker.fetch(new Request(url, options), env);
    response.headers.set('strict-transport-security', 'max-age=31536000');
    return modify(new URL(url).pathname, response) || response;
  } };
}

test('hosted checker uses current PWA assets with only bounded unauthenticated same-origin GETs', async () => {
  const run = fixture();
  const report = await verifyHostedPwa(origin, run);
  assert.equal(report.status, 'passed', JSON.stringify(report.checks.filter((item) => item.status !== 'passed')));
  assert.equal(report.requests, 11);
  for (const { url, options } of run.calls) {
    assert.equal(new URL(url).origin, origin);
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.body, undefined);
    assert.deepEqual(options.headers, { accept: '*/*' });
    assert.doesNotMatch(url, /\/send|\/draft|\/oauth/u);
  }
  assert.doesNotMatch(JSON.stringify(report), new RegExp(anonKey.replaceAll('.', '\\.')));
});

test('missing, local, credentialed or non-origin URLs block before any request', async () => {
  for (const value of [undefined, 'http://pilot.example', 'https://localhost', 'https://127.0.0.1', 'https://user:password@pilot.example', `${origin}/app`, `${origin}/?key=secret`]) {
    const report = await verifyHostedPwa(value, { fetchImpl: () => { throw new Error('must not fetch'); } });
    assert.equal(report.status, 'blocked');
    assert.equal(report.requests, 0);
    assert.doesNotMatch(JSON.stringify(report), /password|key=secret/u);
  }
});

test('private data exposed without sign-in fails and its body is never read or printed', async () => {
  const run = fixture((path) => path === '/api/v1/chats' ? new Response('private-message-do-not-print') : null);
  const report = await verifyHostedPwa(origin, run);
  assert.equal(report.status, 'failed');
  assert.equal(report.checks.find((item) => item.id === 'unauthenticated:/api/v1/chats').status, 'failed');
  assert.doesNotMatch(JSON.stringify(report), /private-message/u);
});

test('privileged or extra public auth fields are rejected without revealing values', async () => {
  for (const change of [{ secret: 'private-value' }, { supabaseAnonKey: `e30.${Buffer.from('{"role":"service_role"}').toString('base64url')}.signature` }, { supabaseUrl: 'https://pilot.supabase.co@evil.example' }]) {
    const run = fixture((path) => path === '/api/v1/web-config' ? Response.json({ authMode: 'supabase', supabaseUrl: 'https://pilot.supabase.co', supabaseAnonKey: anonKey, ...change }, { headers: { 'cache-control': 'no-store' } }) : null);
    const report = await verifyHostedPwa(origin, run);
    assert.equal(report.checks.find((item) => item.id === 'public-auth-config').status, 'failed');
    assert.doesNotMatch(JSON.stringify(report), /private-value|service_role|evil\.example/u);
  }
});

test('HTML returned in place of PNG and incorrect worker scope are detected', async () => {
  const run = fixture((path, response) => {
    if (path.endsWith('-192.png')) return new Response('<html>fallback</html>', { headers: { 'content-type': 'image/png' } });
    if (path === '/service-worker.js') response.headers.set('service-worker-allowed', '/narrow/');
  });
  const report = await verifyHostedPwa(origin, run);
  assert.equal(report.checks.find((item) => item.id === 'icon-192-bytes').status, 'failed');
  assert.equal(report.checks.find((item) => item.id === 'service-worker-scope').status, 'failed');
});

test('a missing registration module cannot be mistaken for a working installation', async () => {
  const run = fixture((path) => path === '/pwa-register.mjs' ? new Response('<html>SPA fallback</html>', { headers: { 'content-type': 'text/html' } }) : null);
  const report = await verifyHostedPwa(origin, run);
  assert.equal(report.checks.find((item) => item.id === 'registration-module').status, 'failed');
});

test('redirects to authentication are reported blocked and never followed', async () => {
  const calls = [];
  const report = await verifyHostedPwa(origin, { fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new URL(url).pathname.startsWith('/api/v1/') && !url.endsWith('web-config')
      ? new Response(null, { status: 403 })
      : new Response(null, { status: 302, headers: { location: 'https://login.example/secret' } });
  } });
  assert.equal(report.status, 'blocked');
  assert.ok(calls.every((call) => new URL(call.url).origin === origin));
  assert.doesNotMatch(JSON.stringify(report), /login\.example|secret/u);
});

test('an unconfigured external identity project is reported blocked rather than insecure', async () => {
  const run = fixture((path) => path === '/api/v1/web-config'
    ? Response.json({ error: 'supabase_auth_not_configured' }, { status: 503, headers: { 'cache-control': 'no-store' } })
    : null);
  const report = await verifyHostedPwa(origin, run);
  assert.equal(report.status, 'blocked');
  assert.equal(report.checks.find((item) => item.id === 'public-auth-config').status, 'blocked');
  assert.equal(report.checks.find((item) => item.id === 'public-auth-config-cache').status, 'passed');
});

test('oversized responses and missing security headers prevent a passing report', async () => {
  const run = fixture((path, response) => {
    if (path === '/api/v1/web-config') response.headers.set('content-length', '99999999');
    if (path === '/') { response.headers.delete('content-security-policy'); response.headers.delete('strict-transport-security'); }
  });
  const report = await verifyHostedPwa(origin, run);
  assert.equal(report.status, 'failed');
  for (const id of ['public-auth-config', 'security-csp', 'https-hsts']) assert.equal(report.checks.find((item) => item.id === id).status, 'failed');
});
