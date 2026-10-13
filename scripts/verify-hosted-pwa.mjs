import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PRIVATE_PATHS = Object.freeze(['/api/v1/chats', '/api/v1/preferences', '/api/v1/runtime-boundary', '/api/v1/behavioral-fingerprints']);
const PUBLIC_CONFIG_KEYS = new Set(['authMode', 'supabaseUrl', 'supabaseAnonKey']);
const MAX_BYTES = 1_048_576;

export function hostedOrigin(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use the exact HTTPS origin without credentials, a path, query, or fragment.');
  }
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost') || url.hostname === '[::1]' || /^127\./u.test(url.hostname)) {
    throw new Error('Use the hosted HTTPS origin, not a local desktop gateway.');
  }
  return url.origin;
}

function publicConfigIsBounded(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).some((key) => !PUBLIC_CONFIG_KEYS.has(key))) return false;
  if (config.authMode === 'local-or-access') return Object.keys(config).length === 1;
  if (config.authMode !== 'supabase' || Object.keys(config).length !== 3 || typeof config.supabaseAnonKey !== 'string') return false;
  try {
    const url = new URL(config.supabaseUrl);
    if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/iu.test(url.hostname) || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') return false;
  } catch { return false; }
  const key = config.supabaseAnonKey;
  if (key.length > 4096) return false;
  if (/^sb_publishable_[A-Za-z0-9_-]{16,}$/u.test(key)) return true;
  const parts = key.split('.');
  if (parts.length !== 3 || !parts.every((part) => /^[A-Za-z0-9_-]+$/u.test(part))) return false;
  try {
    // Decode only to reject privileged credentials; this is not JWT authentication.
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')).role === 'anon';
  } catch { return false; }
}

async function boundedBody(response, maximum) {
  if (Number(response.headers.get('content-length')) > maximum) {
    await response.body?.cancel().catch(() => {});
    throw new Error('Response exceeds the verification size limit.');
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > maximum) throw new Error('Response exceeds the verification size limit.');
      chunks.push(Buffer.from(result.value));
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); }
}

function directives(value) {
  return new Map(String(value || '').split(';').map((part) => part.trim().split(/\s+/u)).filter(([name]) => name).map(([name, ...tokens]) => [name.toLowerCase(), tokens]));
}

function pngHasSize(buffer, size) {
  return buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && buffer.toString('ascii', 12, 16) === 'IHDR' && buffer.readUInt32BE(16) === size && buffer.readUInt32BE(20) === size;
}

/** Public GETs only. No cookie jar, authorization, redirects, provider requests or private response bodies. */
export async function verifyHostedPwa(value, { fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  const checks = [];
  const add = (id, status, detail) => checks.push({ id, status, detail });
  const check = (id, ok, detail) => add(id, ok ? 'passed' : 'failed', detail);
  let origin;
  try { origin = hostedOrigin(value); }
  catch {
    add('hosted-url', 'blocked', value ? 'MYCROBO_WEB_URL must be an exact hosted HTTPS origin.' : 'MYCROBO_WEB_URL is not configured.');
    return { schema: 'mycrobo-hosted-pwa-check.1', status: 'blocked', requests: 0, checks };
  }
  let requests = 0;
  async function get(path, { body = true, maxBytes = MAX_BYTES } = {}) {
    const url = new URL(path, origin);
    if (url.origin !== origin || url.search || url.hash || !path.startsWith('/')) throw new Error('Unapproved verification URL.');
    requests += 1;
    const response = await fetchImpl(url.href, {
      method: 'GET', credentials: 'omit', redirect: 'manual', cache: 'no-store',
      headers: { accept: '*/*' }, signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.redirected || (response.url && new URL(response.url).origin !== origin)) throw new Error('The response left the approved origin.');
    const bytes = body && response.status === 200 ? await boundedBody(response, maxBytes) : Buffer.alloc(0);
    if (!body || response.status !== 200) await response.body?.cancel().catch(() => {});
    return { response, bytes, text: bytes.toString('utf8') };
  }
  async function probe(id, action) {
    try { await action(); }
    catch { add(id, 'failed', 'The bounded public request or response validation failed; response contents are omitted.'); }
  }
  add('hosted-url', 'passed', 'Exact HTTPS origin; authentication and redirect following are disabled.');

  await probe('shell', async () => {
    const { response, text } = await get('/');
    if ([301, 302, 303, 307, 308, 401, 403].includes(response.status)) {
      add('shell', 'blocked', `The public shell is gated or redirected (HTTP ${response.status}); installation cannot be verified without sign-in.`);
      return;
    }
    check('shell', response.status === 200 && /text\/html/iu.test(response.headers.get('content-type') || '') && /<html\b/iu.test(text), 'Shell is successful HTML.');
    const manifestTag = (text.match(/<link\b[^>]*>/giu) || []).some((tag) => /\brel\s*=\s*["']manifest["']/iu.test(tag) && /\bhref\s*=\s*["']\/manifest\.webmanifest["']/iu.test(tag));
    check('manifest-link', manifestTag, 'The shell links the expected same-origin manifest.');
    check('pwa-registration', /\bsrc\s*=\s*["']\/pwa-register\.mjs["']/iu.test(text), 'The shell loads the PWA registration module.');
    const csp = directives(response.headers.get('content-security-policy'));
    check('security-csp', csp.get('default-src')?.join(' ') === "'self'" && csp.get('object-src')?.join(' ') === "'none'" && csp.get('base-uri')?.join(' ') === "'none'" && csp.get('frame-ancestors')?.join(' ') === "'none'" && csp.get('script-src')?.join(' ') === "'self'", 'CSP restricts scripts, base URLs, objects and embedding.');
    const headers = response.headers;
    check('security-browser-headers', headers.get('x-content-type-options') === 'nosniff' && headers.get('x-frame-options')?.toUpperCase() === 'DENY' && headers.get('referrer-policy') === 'no-referrer' && headers.get('cross-origin-opener-policy') === 'same-origin' && headers.get('cross-origin-resource-policy') === 'same-origin', 'Browser isolation, MIME and referrer headers match the hosted policy.');
    const permissions = headers.get('permissions-policy') || '';
    check('security-permissions', ['camera', 'microphone', 'geolocation', 'payment', 'usb'].every((name) => new RegExp(`(?:^|,)\\s*${name}=\\(\\)`).test(permissions)), 'Unneeded browser capabilities are disabled.');
    check('shell-cache', /\bno-store\b/iu.test(headers.get('cache-control') || ''), 'The login shell is not stored by HTTP caches.');
    const hsts = headers.get('strict-transport-security') || '';
    check('https-hsts', /(?:^|;)\s*max-age=(\d+)/iu.exec(hsts)?.[1] > 0, 'The host advertises a positive HTTPS-only HSTS policy.');
  });

  await probe('manifest', async () => {
    const { response, text } = await get('/manifest.webmanifest', { maxBytes: 65_536 });
    if (response.status === 401 || response.status === 403 || response.status >= 300 && response.status < 400) {
      add('manifest', 'blocked', 'Manifest access is gated; installed assets have not been verified.');
      return;
    }
    check('manifest-response', response.status === 200 && /application\/(?:manifest\+json|json)/iu.test(response.headers.get('content-type') || ''), 'Manifest has a JSON manifest content type.');
    const manifest = JSON.parse(text);
    check('manifest-install', typeof manifest.name === 'string' && manifest.name.length > 0 && manifest.display === 'standalone' && manifest.start_url === '/' && manifest.scope === '/' && manifest.id === '/', 'App identity, standalone display, start URL and scope match the root-hosted app.');
    for (const size of [192, 512]) {
      const icon = Array.isArray(manifest.icons) && manifest.icons.find((item) => item.sizes === `${size}x${size}` && item.type === 'image/png' && (item.purpose || 'any').split(/\s+/u).includes('any'));
      const allowed = icon && /^\/assets\/[a-zA-Z0-9._-]+\.png$/u.test(icon.src);
      check(`icon-${size}-reference`, Boolean(allowed), 'The required install icon is a same-origin PNG asset.');
      if (!allowed) continue;
      const image = await get(icon.src);
      check(`icon-${size}-bytes`, image.response.status === 200 && /image\/png/iu.test(image.response.headers.get('content-type') || '') && pngHasSize(image.bytes, size), 'Downloaded icon bytes match their declared PNG dimensions.');
    }
  });

  await probe('service-worker', async () => {
    const { response, text } = await get('/service-worker.js', { maxBytes: 262_144 });
    if (response.status === 401 || response.status === 403 || response.status >= 300 && response.status < 400) {
      add('service-worker', 'blocked', 'Worker access is gated; installation cannot be verified.');
      return;
    }
    check('service-worker-response', response.status === 200 && /(?:text|application)\/javascript/iu.test(response.headers.get('content-type') || '') && /addEventListener\(["']install["']/u.test(text), 'Service worker is JavaScript with an install handler.');
    check('service-worker-cache', /\b(?:no-cache|no-store)\b/iu.test(response.headers.get('cache-control') || ''), 'Service worker HTTP caching requires revalidation or is disabled.');
    // A script at /service-worker.js is allowed root scope without this optional header.
    check('service-worker-scope', !response.headers.has('service-worker-allowed') || response.headers.get('service-worker-allowed') === '/', 'Root scope is permitted by script location and any explicit scope header.');
  });

  await probe('registration-module', async () => {
    const { response, text } = await get('/pwa-register.mjs', { maxBytes: 65_536 });
    if ([301, 302, 303, 307, 308, 401, 403].includes(response.status)) {
      add('registration-module', 'blocked', 'PWA registration access is gated; browser registration was not verified.');
      return;
    }
    check('registration-module', response.status === 200 && /(?:text|application)\/javascript/iu.test(response.headers.get('content-type') || '')
      && /serviceWorker\.register\(["']\/service-worker\.js["']/u.test(text)
      && /scope:\s*["']\/["']/u.test(text) && /updateViaCache:\s*["']none["']/u.test(text),
    'The served module registers the expected root-scoped service worker without the HTTP cache.');
  });

  await probe('public-auth-config', async () => {
    const { response, text } = await get('/api/v1/web-config', { maxBytes: 16_384 });
    if ([301, 302, 303, 307, 308, 401, 403].includes(response.status)) {
      add('public-auth-config', 'blocked', 'Public auth configuration is gated; its field boundaries were not verified.');
      return;
    }
    if (response.status === 503) {
      add('public-auth-config', 'blocked', 'The hosted shell is online, but its external identity project is not configured yet.');
      check('public-auth-config-cache', /\bno-store\b/iu.test(response.headers.get('cache-control') || ''), 'Auth configuration disables HTTP storage.');
      return;
    }
    check('public-auth-config', response.status === 200 && /application\/json/iu.test(response.headers.get('content-type') || '') && publicConfigIsBounded(JSON.parse(text)), 'Configuration has only approved public fields and an anon or publishable credential; values are never printed.');
    check('public-auth-config-cache', /\bno-store\b/iu.test(response.headers.get('cache-control') || ''), 'Auth configuration disables HTTP storage.');
  });

  for (const path of PRIVATE_PATHS) await probe(`unauthenticated:${path}`, async () => {
    const { response } = await get(path, { body: false });
    check(`unauthenticated:${path}`, response.status === 401 || response.status === 403, `Private GET must reject without credentials; observed HTTP ${response.status}. Body not read.`);
  });
  const status = checks.some((item) => item.status === 'failed') ? 'failed' : checks.some((item) => item.status === 'blocked') ? 'blocked' : 'passed';
  return { schema: 'mycrobo-hosted-pwa-check.1', status, requests, checks, limitations: ['No sign-in, browser installation, authenticated tenant/RLS behavior, private chat sync or message delivery was tested.'] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await verifyHostedPwa(process.env.MYCROBO_WEB_URL);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === 'passed' ? 0 : report.status === 'blocked' ? 2 : 1;
}
