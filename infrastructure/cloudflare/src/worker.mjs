import { validSupabaseWebConfig } from '../../../apps/client/web-auth-contract.mjs';

const BEHAVIOR_FIELDS = new Set([
  'tenant_id',
  'subject_hash',
  'sample_started_at',
  'sample_ended_at',
  'observation_count',
  'reply_delay_p50_ms',
  'reply_delay_p90_ms',
  'question_rate',
  'emoji_rate',
  'brevity_score',
  'initiation_rate',
  'schema_version',
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const P256_PUBLIC_KEY_BASE64URL = /^[A-Za-z0-9_-]{87}$/;
const ACCESS_JWKS_TTL_MS = 5 * 60 * 1000;
const accessJwksCache = new Map();

function isFiniteNumber(value, minimum, maximum) {
  return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function optionalMetric(value, minimum, maximum, integer = false) {
  return value === undefined || value === null
    || (isFiniteNumber(value, minimum, maximum) && (!integer || Number.isInteger(value)));
}

export function validateBehaviorFingerprintPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  if (Object.keys(payload).some((key) => !BEHAVIOR_FIELDS.has(key))) return false;
  if (!UUID.test(payload.tenant_id ?? '') || !SHA256_HEX.test(payload.subject_hash ?? '')) return false;
  const started = Date.parse(payload.sample_started_at);
  const ended = Date.parse(payload.sample_ended_at);
  if (!Number.isFinite(started) || !Number.isFinite(ended) || started > ended) return false;
  if (!Number.isInteger(payload.observation_count)
    || payload.observation_count < 1 || payload.observation_count > 1000000) return false;
  if (!optionalMetric(payload.reply_delay_p50_ms, 0, 604800000, true)) return false;
  if (!optionalMetric(payload.reply_delay_p90_ms, 0, 604800000, true)) return false;
  for (const key of ['question_rate', 'emoji_rate', 'brevity_score', 'initiation_rate']) {
    if (!optionalMetric(payload[key], 0, 1)) return false;
  }
  return payload.schema_version === undefined || payload.schema_version === 1;
}

function json(status, value, origin = null) {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff',
  });
  if (origin) {
    headers.set('access-control-allow-origin', origin);
    headers.set('vary', 'Origin');
  }
  return new Response(JSON.stringify(value), { status, headers });
}

function withBrowserSecurityHeaders(response, requestUrl) {
  const headers = new Headers(response.headers);
  headers.set('content-security-policy', [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self' https://*.supabase.co",
  ].join('; '));
  headers.set('cross-origin-opener-policy', 'same-origin');
  headers.set('cross-origin-resource-policy', 'same-origin');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  const path = new URL(requestUrl).pathname;
  if (path === '/' || path === '/index.html' || path === '/service-worker.js' || path === '/manifest.webmanifest') {
    headers.set('cache-control', 'no-cache, no-store, must-revalidate');
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function desktopConnectorRequired(origin = null) {
  return json(503, {
    error: 'trusted_desktop_connector_required',
    message: 'This web surface is not paired with a tenant-bound desktop connector.',
    retryable: false,
    realMessageSending: false,
  }, origin);
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  // Browsers attach Origin to same-origin module-script and fetch requests.
  // The deployment allowlist governs cross-origin callers; it must never
  // reject the application's own origin or the authenticated shell cannot
  // load its JavaScript modules.
  if (origin === new URL(request.url).origin) return origin;
  const configured = (env.ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  return configured.includes(origin) ? origin : false;
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function accessJwk(expectedIssuer, kid) {
  const now = Date.now();
  let cached = accessJwksCache.get(expectedIssuer);
  if (!cached || cached.expiresAt <= now || !cached.keys.some((candidate) => candidate.kid === kid)) {
    const response = await fetch(`${expectedIssuer}/cdn-cgi/access/certs`);
    if (!response.ok) throw new Error('Cloudflare Access key discovery failed.');
    const body = await response.json();
    if (!Array.isArray(body.keys)) throw new Error('Cloudflare Access key discovery returned an invalid key set.');
    cached = { keys: body.keys, expiresAt: now + ACCESS_JWKS_TTL_MS };
    accessJwksCache.set(expectedIssuer, cached);
  }
  return cached.keys.find((candidate) => candidate.kid === kid) ?? null;
}

async function verifyCloudflareAccess(request, env) {
  if (env.CF_ACCESS_REQUIRED !== 'true') {
    const hostname = new URL(request.url).hostname;
    const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
    return env.ALLOW_INSECURE_LOCAL_DEV === 'true' && loopback;
  }
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token || !env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
    const teamDomain = env.CF_ACCESS_TEAM_DOMAIN.replace(/\/$/, '');
    const expectedIssuer = teamDomain.startsWith('https://') ? teamDomain : `https://${teamDomain}`;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    const now = Math.floor(Date.now() / 1000);
    if (header.alg !== 'RS256' || !header.kid || claims.iss !== expectedIssuer
      || !audiences.includes(env.CF_ACCESS_AUD) || claims.exp <= now || (claims.nbf && claims.nbf > now)) return false;
    const jwk = await accessJwk(expectedIssuer, header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
    );
    return crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', key, decodeBase64Url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
  } catch {
    return false;
  }
}

function supabasePublicConfig(env) {
  const config = { authMode: 'supabase', supabaseUrl: String(env.SUPABASE_URL || ''), supabaseAnonKey: String(env.SUPABASE_ANON_KEY || '') };
  return validSupabaseWebConfig(config) ? Object.freeze({ ...config, supabaseUrl: new URL(config.supabaseUrl).origin }) : null;
}

async function verifySupabaseSession(request, env) {
  const config = supabasePublicConfig(env);
  const authorization = request.headers.get('authorization');
  if (!config || !authorization?.startsWith('Bearer ')) return false;
  try {
    const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      headers: { apikey: config.supabaseAnonKey, authorization },
    });
    if (!response.ok) return null;
    const user = await response.json().catch(() => null);
    return UUID.test(String(user?.id || '')) ? Object.freeze({ id: String(user.id).toLowerCase() }) : null;
  } catch {
    return null;
  }
}

function decodedBase64Url(value) {
  if (!P256_PUBLIC_KEY_BASE64URL.test(String(value || ''))) return null;
  try {
    const bytes = decodeBase64Url(value);
    return bytes.length === 65 && bytes[0] === 4 ? bytes : null;
  } catch {
    return null;
  }
}

function hex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function validateRelayBrowserRegistration(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== 2 || !UUID.test(String(value.deviceId || ''))) return null;
  const publicKey = decodedBase64Url(value.publicKey);
  return publicKey ? Object.freeze({ deviceId: String(value.deviceId).toLowerCase(), publicKey }) : null;
}

async function relayBrowserDeviceRegistration(request, env, identity, origin) {
  if (env.RELAY_FOUNDATION_STAGE !== 'ciphertext-only-v1') {
    return json(503, { error: 'relay_foundation_not_provisioned', registered: false }, origin);
  }
  const tenantId = String(request.headers.get('x-mycrobo-tenant-id') || '').toLowerCase();
  if (!UUID.test(tenantId)) return json(400, { error: 'verified_tenant_required', registered: false }, origin);
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > 4096) {
    return json(413, { error: 'registration_payload_too_large', registered: false }, origin);
  }
  const raw = await request.text();
  if (raw.length > 4096) return json(413, { error: 'registration_payload_too_large', registered: false }, origin);
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return json(400, { error: 'invalid_registration_payload', registered: false }, origin); }
  const registration = validateRelayBrowserRegistration(parsed);
  if (!registration) return json(400, { error: 'invalid_registration_payload', registered: false }, origin);

  const config = supabasePublicConfig(env);
  const authorization = request.headers.get('authorization');
  const upstream = await fetch(`${config.supabaseUrl}/rest/v1/devices?on_conflict=id`, {
    method: 'POST',
    headers: {
      apikey: config.supabaseAnonKey,
      authorization,
      'content-type': 'application/json',
      accept: 'application/json',
      prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify({
      id: registration.deviceId,
      tenant_id: tenantId,
      user_id: identity.id,
      device_public_key: `\\x${hex(registration.publicKey)}`,
      key_algorithm: 'p256',
      device_kind: 'web_client',
      device_state: 'active',
      last_seen_at: new Date().toISOString(),
    }),
  });
  const rows = await upstream.json().catch(() => []);
  const registered = upstream.ok && Array.isArray(rows) && rows.length === 1
    && rows[0]?.id === registration.deviceId && rows[0]?.tenant_id === tenantId
    && rows[0]?.user_id === identity.id && rows[0]?.device_kind === 'web_client';
  if (!registered) {
    return json(409, { error: 'browser_device_registration_rejected', registered: false }, origin);
  }
  return json(201, {
    registered: true,
    deviceId: registration.deviceId,
    deviceKind: 'web_client',
    pairingAvailable: false,
    capabilities: [],
  }, origin);
}

function browserAssetRequest(request, url) {
  return request.method === 'GET'
    && !url.pathname.startsWith('/api/')
    && !url.pathname.startsWith('/v1/')
    && !url.pathname.startsWith('/oauth/');
}

function trustedRelayBoundary(env) {
  // This flag describes only the reviewed cryptographic/storage foundation.
  // Pairing and every private capability remain unavailable until their own
  // authenticated routes, device attestation and release evidence exist.
  const foundationInstalled = env.RELAY_FOUNDATION_STAGE === 'ciphertext-only-v1';
  return Object.freeze({
    protocol: 'mycrobo.relay-envelope.1',
    stage: foundationInstalled ? 'foundation_installed' : 'not_provisioned',
    pairingAvailable: false,
    capabilities: Object.freeze([]),
    ciphertextOnly: true,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = allowedOrigin(request, env);
    if (origin === false) return json(403, { error: 'origin_not_allowed' });
    if (request.method === 'OPTIONS') {
      if (!origin) return json(403, { error: 'origin_required' });
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': origin,
          'access-control-allow-methods': 'POST, OPTIONS',
          'access-control-allow-headers': 'Authorization, Content-Type, X-MyCrobo-Tenant-Id',
          'access-control-max-age': '600',
          vary: 'Origin',
        },
      });
    }
    if (url.pathname === '/healthz' || url.pathname === '/api/healthz') {
      return request.method === 'GET'
        ? json(200, { status: 'ok', surface: 'closed-pilot-web' }, origin)
        : json(405, { error: 'method_not_allowed' }, origin);
    }

    if (url.pathname === '/api/v1/web-config') {
      if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' }, origin);
      if (env.AUTH_MODE === 'supabase') {
        const config = supabasePublicConfig(env);
        return config
          ? json(200, config, origin)
          : json(503, { error: 'supabase_auth_not_configured' }, origin);
      }
      return json(200, { authMode: 'local-or-access' }, origin);
    }

    // The no-card closed-pilot route serves only the public application shell
    // before sign-in. Every API and metadata request still requires a current
    // Supabase session; PostgreSQL RLS remains the final tenant/user boundary.
    let supabaseIdentity = null;
    if (env.AUTH_MODE === 'supabase') {
      if (browserAssetRequest(request, url)) {
        if (!env.ASSETS?.fetch) return json(503, { error: 'static_assets_binding_required' }, origin);
        return withBrowserSecurityHeaders(await env.ASSETS.fetch(request), request.url);
      }
      supabaseIdentity = await verifySupabaseSession(request, env);
      if (!supabaseIdentity) {
        return json(401, { error: 'supabase_session_required' }, origin);
      }
    } else if (!await verifyCloudflareAccess(request, env)) {
      return json(403, { error: 'cloudflare_access_required' }, origin);
    }

    if (url.pathname === '/api/v1/runtime-boundary' && request.method === 'GET') {
      return json(200, {
        surface: 'closed-pilot-web',
        desktopConnector: 'not_paired',
        privateChatTransit: false,
        bridgeCredentialsAvailable: false,
        realMessageSending: false,
        googleOAuthAvailable: false,
        trustedRelay: trustedRelayBoundary(env),
      }, origin);
    }

    if (url.pathname === '/api/v1/relay/browser-device') {
      if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' }, origin);
      if (!supabaseIdentity) return json(503, { error: 'supabase_device_registration_required', registered: false }, origin);
      return relayBrowserDeviceRegistration(request, env, supabaseIdentity, origin);
    }

    if ((url.pathname === '/v1/behavioral-fingerprints'
      || url.pathname === '/api/v1/behavioral-fingerprints') && request.method === 'POST') {
      // A browser-supplied digest is not proof that the subject identifier was
      // derived with the tenant's secret HMAC key. Keep this route closed until
      // a trusted tenant-key service can derive and attest the opaque subject.
      // Do not read or forward the caller's body while the boundary is absent.
      return json(503, {
        error: 'tenant_hmac_service_required',
        stored: false,
        retryable: false,
      }, origin);
    }

    // The existing desktop APIs include private chats, pairing and delivery.
    // They must never be silently proxied through a public Worker. A future
    // relay has to prove tenant, user, device, relationship and chat bindings,
    // and encrypt private payloads end-to-end before this boundary can open.
    if (url.pathname.startsWith('/api/')) return desktopConnectorRequired(origin);

    if (!env.ASSETS?.fetch) return json(503, { error: 'static_assets_binding_required' }, origin);
    return withBrowserSecurityHeaders(await env.ASSETS.fetch(request), request.url);
  },
};
