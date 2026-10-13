# Read-only hosted PWA verification

From the repository root, set the exact deployed HTTPS origin and run:

```powershell
$env:MYCROBO_WEB_URL = 'https://YOUR_DEPLOYED_APP.example'
node scripts/verify-hosted-pwa.mjs
```

The command makes bounded, unauthenticated GET requests only to that origin. It does not sign in, follow redirects, load a cookie jar, call a model provider, provision infrastructure, write metadata, request a draft, or invoke message delivery. It never prints configuration credentials or private API response bodies. It does not read the desktop profile.

Checks cover the public HTML shell, manifest link and install metadata, real 192/512 PNG dimensions, service-worker JavaScript/content type/cache headers/root scope, CSP and browser security headers, HSTS, bounded public auth configuration, and unauthenticated rejection by representative private APIs. Only the expected manifest and same-origin PNG install assets can be followed. The existing protected Worker and actual local PWA assets are used in the checker regression tests.

Run the focused tests with:

```powershell
node --test contracts/hosted-pwa-verification.test.mjs
```

Exit `0` means these public HTTP checks passed. Exit `1` means a check failed. Exit `2` means a required check is blocked, including an absent `MYCROBO_WEB_URL` or an Access sign-in gate. Gated assets are not reported as verified. Supply the final canonical origin directly; redirects remain unverified.

A passing report does not certify browser installation or offline behavior, authenticated RLS/tenant isolation, real sign-in/recovery, private chat synchronization, provider quality, or authorized delivery. Those need their own controlled checks. HSTS may be configured at the hosting edge; this command checks the header actually delivered to clients.

For the closed pilot, a second verifier exercises a real Supabase sign-in and only the hosted fail-closed boundary:

```powershell
$env:MYCROBO_WEB_URL = 'https://YOUR_DEPLOYED_APP.example'
$env:MYCROBO_PILOT_EMAIL = 'approved-pilot-user@example.com'
$env:MYCROBO_PILOT_PASSWORD = Read-Host 'Pilot password' -MaskInput
pnpm run cloud:web:verify-session
Remove-Item Env:MYCROBO_PILOT_EMAIL, Env:MYCROBO_PILOT_PASSWORD
```

The authenticated verifier keeps credentials and provider tokens in memory only, omits them from its report, signs out its refreshable Supabase session in a `finally` cleanup, and never requests a draft or delivery. It proves that the pilot account can sign in, the runtime boundary remains an exact read-only/no-relay/no-send boundary, desktop-private chat and preference routes return `trusted_desktop_connector_required`, and browser-supplied relationship digests remain rejected until a trusted tenant HMAC service exists. A passing report still does not prove cross-tenant RLS, desktop relay pairing, raw chat synchronization or delivery; use the dedicated Supabase two-user RLS verifier and controlled release evidence for those claims.

## Signed-in pilot behavior

Hosted sign-in now opens a small pilot workspace showing the signed-in account, a visible sign-out button, and the result of the authenticated `/api/v1/runtime-boundary` check. While the desktop relay is unavailable, the client does not start desktop polls, QR/phone linking, drafting, sending, import or Google OAuth controls. The Worker explicitly reports `googleOAuthAvailable: false`; Google connection remains a desktop capability. Desktop gateways continue using the existing native experience.

Browser and Worker share a strict public Supabase configuration validator. Only canonical project origins and anon-role JWTs or publishable project keys are accepted. A missing configuration endpoint bypasses web authentication only in an explicit native or loopback desktop context. Remote configuration failures keep the login gate closed.

Near-expiry sessions refresh once before a private request, even when several requests arrive together. Refresh rechecks account and membership continuity. Rejected writes are never automatically replayed. Failed refresh or a current-session 401 clears the session and opens sign-in; logout and late responses cannot resurrect or invalidate a different session.

The installed static shell tries the network with a bounded wait and falls back to previously validated local assets when offline. Redirects, error pages, private responses and HTML masquerading as scripts do not replace the shell. Cache cleanup is limited to MyCrobo's own cache prefix. The browser-model and service-worker tests use synthetic credentials and mocked requests; they do not contact Supabase or send real messages.
