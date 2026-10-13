# Closed-pilot Cloudflare and Supabase deployment

This infrastructure hosts the existing `apps/client` PWA and an optional metadata plane for a closed pilot. It does not replace the desktop application, store or proxy WhatsApp messages, or authorize automatic delivery. Behavioral fingerprint ingestion remains fail-closed until a trusted tenant-key service—not the browser—derives and attests the tenant-keyed HMAC subject. Supabase row-level security remains the final tenant and user boundary for any future metadata write.

## Goal

Deploy the existing PWA as Cloudflare Worker Static Assets in front of Supabase. Select one explicit identity boundary: Cloudflare Access, or the no-card Supabase Auth profile. In Supabase mode the static login shell is public, but every private route verifies the bearer against Supabase Auth and PostgreSQL RLS remains the tenant/user boundary. Keep raw conversations, media, drafts, credentials, and derived private facts on the existing approved local path.

The hosted PWA deliberately returns `trusted_desktop_connector_required` for existing private `/api/*` routes. Live chats on the web require a separately reviewed, tenant-bound, end-to-end-encrypted desktop relay. A public proxy, direct bridge URL or Cloudflare Tunnel to the current gateway is not an acceptable shortcut.

## Blocking prerequisites

Deployment must stop until all of these are available:

1. **Supabase:** an authenticated Supabase CLI login, a project created in the intended organization/region, the project reference, permission to apply migrations, and at least one pilot user in Supabase Auth. The deployer must link the local directory with `supabase link --project-ref YOUR_SUPABASE_PROJECT_REF` before running `supabase db push`.
2. **Cloudflare:** an authenticated Wrangler login with access to the target account and its account ID. Workers Free can host the no-card pilot without creating a Zero Trust organization.
3. **Identity profile:** for the no-card route, use `wrangler.supabase-auth.toml.example`, Supabase Auth, and exact redirect/origin allowlists. For the defence-in-depth Access route, use `wrangler.workers-dev.toml.example`, a Cloudflare Access team domain and application audience (`AUD`), and a named-identity allow policy. Do not turn `CF_ACCESS_REQUIRED` off outside isolated local testing.
4. **Google OAuth:** for the implemented desktop connector, a Google Cloud project, an OAuth consent screen restricted to the intended pilot/test users, and a Desktop/public OAuth client ID using the private loopback PKCE callback. The desktop flow uses no client secret. Request exactly `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/calendar.readonly`; the SQL constraint rejects missing, duplicated, or additional scopes. Keep the client ID outside source control and do not place Google credentials in Worker variables. A future hosted-PWA Google connector would require a separately reviewed hosted OAuth/BFF or encrypted desktop-relay design; it is not enabled by adding a Web client to this deployment.
5. **Key management:** production encryption keys and rotation procedures for OAuth tokens and sync cursors, plus tenant-specific HMAC keys for pseudonymous subject IDs. Key bytes remain outside Supabase. The migration accepts encrypted bytes, nonce, and key version for secrets and stores only HMAC output plus its key version for relationship/chat subjects. Do not insert plaintext tokens or raw provider subject identifiers to work around this blocker.

## Deploy

1. Install the Supabase and Wrangler CLIs using the organization-approved method, then authenticate with `supabase login` and `npx wrangler login`.
2. From the repository root, initialize or link the Supabase CLI without replacing `infrastructure/supabase/migrations/202610080001_closed_pilot_tenant_isolation.sql`. Apply that migration with the linked project's normal migration workflow (`supabase db push`). Review the resulting policies in Supabase before adding pilot members.
3. Copy the chosen example to `infrastructure/cloudflare/wrangler.toml` and replace every `YOUR_...` placeholder. For the no-card route, use `wrangler.supabase-auth.toml.example`. The Supabase anon key is intentionally public because the browser JWT must reach Auth/PostgREST and RLS; never configure a privileged server credential in this Worker.
4. In Supabase Auth settings, allow only the exact Worker origin and password-recovery redirect. Create pilot users explicitly and create an active `tenant_memberships` row for each admitted user. If Access mode is selected instead, create a Cloudflare Access self-hosted application for the exact hostname and restrict it to the named pilot identities.
5. In a separate no-customer-data verification project, prepare the reviewed synthetic fixture and runtime-only credentials exactly as documented in `docs/rebuild/supabase-rls-closed-pilot-verification.md`, then run `pnpm verify:supabase-rls`. A pass must prove RLS and FORCE RLS plus symmetric own-row visibility and cross-tenant read denial on all ten migrated tables. This read-only test-project gate is not permission to place synthetic fixtures in production; write-policy certification requires a separate rollback-guaranteed database test.
6. From the repository root, run `pnpm cloud:web:test`, then `pnpm cloud:web:deploy`. Confirm `/api/healthz` responds; unauthenticated private APIs return `401`; invalid, expired, and cross-tenant tokens are rejected; private desktop APIs return `trusted_desktop_connector_required`; a member can write only their own tenant row; and password recovery returns only to the allowlisted origin.
7. Create each tenant through an authenticated Supabase session. The migration creates the owner's membership automatically. Add other memberships only as the tenant owner and record operational approvals outside the database. Auto-send policy rows remain scoped to the authenticated `tenant_id` plus `user_id`; even a tenant owner does not use those rows to read or overwrite another user's policy.

Local development may copy `.dev.vars.example` to `.dev.vars`, but that file must stay uncommitted and must contain test credentials only.

## Configurable pilot limits

No provider entitlement or free-tier allowance is asserted here. Before launch, the operator must look up the current limits in each provider account and set an approved pilot budget. Record the chosen values in deployment configuration or the operations runbook:

| Control | Deployment placeholder | Pilot decision required |
| --- | --- | --- |
| Worker request size | `BEHAVIOR_MAX_REQUEST_BYTES=8192` | Set at or below the reviewed metadata payload ceiling. |
| Allowed browser origins | `ALLOWED_ORIGINS=https://YOUR_PILOT_APP.example` | Enumerate exact HTTPS origins; no wildcard. |
| Pilot identities | Supabase Auth users and active memberships, optionally Cloudflare Access | Set the approved user list and expiry/review date. |
| Worker requests/budget | `YOUR_CLOUDFLARE_PILOT_REQUEST_LIMIT` | Derive from the current account plan; configure alerts separately. |
| Supabase database/storage/budget | `YOUR_SUPABASE_PILOT_LIMITS` | Derive from the current project plan; configure alerts separately. |
| Google OAuth test users/scopes | Exact Gmail readonly + Calendar readonly set | Use only the two SQL-enforced scope URLs and an explicit test-user list. |
| Auto-send | `tenant` → `relationship` → `chat` policy rows | Configuration may be recorded, but `execution_authorized` is SQL-locked to `false`; no stored mode authorizes sending. |

## Pseudonymous subject-ID contract

Raw chat IDs, contact IDs, phone numbers, JIDs, email addresses, or reversible encodings of them must never be written to relationship, behavioral, or auto-send metadata tables. Before a subject crosses the cloud boundary:

1. Canonicalize the provider identifier locally under a versioned, reviewed canonicalization rule.
2. Prefix a domain separator (`relationship-subject-v1`, `chat-subject-v1`, or `behavioral-subject-v1`) so the same provider identifier cannot be correlated across purposes.
3. Compute HMAC-SHA-256 with the key for that tenant. Do not use an unkeyed hash and do not reuse one tenant's key for another tenant.
4. Store only the 32-byte HMAC and the positive HMAC key version. The behavioral ingress is pinned to closed-pilot key version `1`; its database column records that version. A rotation of behavioral subject keys requires a reviewed ingress-contract change, rather than silently relabelling old rows.

The HMAC key service must derive or retrieve keys using an authenticated tenant binding, keep key material out of Supabase and client-readable configuration, and retain old versions only for the approved rotation/retention window.

## Auto-send policy storage is not send authorization

`auto_send_policy_layers` stores a user-scoped hierarchy: one tenant default, optional relationship overrides, and optional chat overrides. Relationship and chat keys are tenant-keyed HMAC subject IDs with explicit key versions. The stored modes match the policy evaluator (`never`, `draft`, `countdown`, `safe`, and `custom`), and narrower layers may override broader ones.

This is configuration storage only. `execution_authorized` has both a `false` default and a SQL check that makes `true` unrepresentable. No database row, including a `safe` or `custom` mode, grants permission to queue or deliver a message. Enabling execution requires a separate security audit, explicit owner approval, a new migration that removes the hard lock, short-lived authorization enforcement, and end-to-end delivery tests. Until all of those happen, the outbound path must remain disabled.

## Security checks before admitting a pilot user

- Run `node --test contracts/cloud-tenant-isolation.test.mjs`.
- Require a passing `pnpm verify:supabase-rls` result from the dedicated, marked, no-customer-data test project for the exact migration candidate.
- Verify every listed table shows RLS enabled in Supabase and that no client holds the service-role key.
- Exercise two real test tenants: cross-tenant reads and writes must return no rows or an authorization error.
- Within one tenant, exercise two pilot users: relationship, behavioral, preference, sync, OAuth, and auto-send rows belonging to one user must not be readable or writable by the other. Administrative membership does not bypass these content-derived user boundaries.
- Verify OAuth token and cursor values are ciphertext before insertion and that key material is held outside Supabase.
- Attempt OAuth rows with one scope, a duplicate scope, or any scope beyond the exact Gmail readonly and Calendar readonly pair; every attempt must fail the SQL constraint.
- Attempt auto-send rows with raw chat/contact identifiers, missing HMAC key versions, cross-user ownership, or `execution_authorized=true`; every attempt must fail.
- Verify audit events contain only enumerated event/target/outcome fields and hashes, never user text.
- Verify Cloudflare Access rejects a non-pilot identity and the Worker rejects unknown behavioral fields.

Passing these checks proves only the configured metadata boundary. It does not prove WhatsApp synchronization, model quality, Google API approval, production capacity, or authorized message delivery.
