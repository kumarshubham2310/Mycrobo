# MyCrobo closed-pilot web surface

This directory deploys the existing `apps/client` PWA and its bounded metadata API as one Cloudflare Worker. It is not a replacement application.

## What this deploys

- The existing PWA files in `apps/client` as Worker Static Assets.
- Same-origin `/api/healthz` and `/api/v1/behavioral-fingerprints` routes.
- Either Cloudflare Access or Supabase Auth enforcement, selected explicitly at deploy time.
- A fail-closed boundary for all private desktop routes. Chats, WhatsApp pairing, media, drafts and delivery are not proxied.

## Verify locally

From the repository root:

```powershell
pnpm cloud:web:test
```

## Temporary Cloudflare domain

This path uses the Cloudflare-provided `workers.dev` hostname. Two authentication profiles are supported:

- `wrangler.workers-dev.toml.example`: Cloudflare Access in front of the complete shell. Cloudflare currently requires billing details even for the Zero Trust Free plan.
- `wrangler.supabase-auth.toml.example`: no-card closed-pilot path. The static sign-in shell is public, while every private API verifies a Supabase session before it can reach the trusted connector; PostgreSQL RLS remains the final tenant/user boundary.

For the no-card path:

```powershell
Copy-Item infrastructure/cloudflare/wrangler.supabase-auth.toml.example infrastructure/cloudflare/wrangler.toml
# Replace the project URL, public anon key, account ID, and exact workers.dev origin.
pnpm dlx wrangler@4 login
pnpm cloud:web:deploy
```

Never put a Supabase privileged server credential in the Worker, browser bundle, or committed configuration. Password sessions are held in `sessionStorage`, so closing the browser tab clears them. Password recovery uses Supabase Auth and requires the deployed origin in the project's redirect allowlist.

For the Access path:

```powershell
Copy-Item infrastructure/cloudflare/wrangler.workers-dev.toml.example infrastructure/cloudflare/wrangler.toml
# Replace every YOUR_... value. Keep CF_ACCESS_REQUIRED=true.
pnpm dlx wrangler@4 login
pnpm cloud:web:deploy
```

Before an Access-mode deploy, create a Cloudflare Access application for:

`https://mycrobo-closed-pilot-web.YOUR_ACCOUNT_SUBDOMAIN.workers.dev`

Allow only named pilot identities and copy its team domain and `AUD` into `wrangler.toml`. Until a valid Access assertion is present, the Worker returns `403` and does not serve the PWA.

## Custom domain or subdomain

Copy `wrangler.toml.example`, replace its placeholders, uncomment `[[routes]]`, and set `pattern` to the intended hostname (for example `pilot.mycrobo.com`). The zone must already be active in the same Cloudflare account. Run the same deploy command. Cloudflare creates the DNS record and certificate for a Worker Custom Domain.

Redirecting another hostname should be configured only after the protected canonical hostname works. Keep authentication on the final destination; never redirect around the selected identity boundary.

## Trusted desktop connector boundary

The hosted shell cannot safely display live WhatsApp data yet. Current desktop routes can return chat text, media, linked-device state and send actions. The Worker deliberately returns `trusted_desktop_connector_required` for those paths.

Opening this boundary requires a separate, reviewed relay with all of these properties:

1. The desktop initiates the connection outbound; no bridge port or WhatsApp credential is public.
2. Every session is bound to tenant, signed-in user, registered device and a short-lived pairing challenge.
3. Chat payloads are end-to-end encrypted between the user's PWA and their registered desktop. The relay stores ciphertext only and cannot read chat content.
4. Every request is bound to the exact relationship graph and chat. Replays, cross-tenant IDs and stale device sessions fail closed.
5. Read, draft and send capabilities are separate. This closed-pilot deployment exposes none of them.
6. Real send remains disabled until its independent authorization, policy revalidation, audit and per-chat controls have passed release review.

Do not work around this boundary by adding a desktop origin URL, Cloudflare Tunnel URL, service token, bridge secret or Supabase service-role key to browser code or committed configuration.

The source now includes the first ciphertext-only relay foundation described in `docs/TRUSTED_DESKTOP_RELAY.md`. `RELAY_FOUNDATION_STAGE = "ciphertext-only-v1"` reports only that the reviewed schema and cryptographic contract are installed. It never enables pairing or any relay capability; the capability list remains empty until the remaining activation gates have independent evidence.
