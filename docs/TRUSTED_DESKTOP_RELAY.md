# Trusted desktop relay foundation

## Current status

The alpha.30 source contains the reviewed cryptographic and tenant-storage foundation for a future private desktop-to-PWA relay. The PWA can explicitly prepare and register its browser device identity. The desktop can now verify that its local login email matches a Supabase login, require an explicit active cloud tenant when more than one is available, and create a Windows-protected P-256 desktop identity bound to that exact local user and tenant. It is intentionally **not a connected relay yet**. Remote desktop registration, device pairing, private chat transit, drafting and delivery remain unavailable on the hosted PWA.

The foundation exists to prevent a later implementation from exposing the local gateway or treating a browser session as proof of a trusted desktop.

## Trust boundaries

```text
WhatsApp linked-device session
  -> local desktop bridge only
  -> MyCrobo desktop connector
       owns the desktop private key
       validates the displayed pairing challenge
       binds tenant + user + desktop device + web device
  -> Supabase relay tables
       forced RLS
       short-lived ciphertext only
       no WhatsApp credential
       no session key
       no plaintext message, draft, media or contact ID
  -> authenticated PWA
       owns the web private key
       decrypts only envelopes bound to its device/session/chat
```

Cloudflare serves the PWA and validates the Supabase login before returning capability metadata. It does not proxy the local gateway, hold a relay private key, or expose a send route.

## Browser-device preparation

The signed-in PWA exposes one deliberate **Prepare encrypted web connection** action after it verifies that the ciphertext-only foundation is installed. That action:

1. scopes the key record to the selected tenant and authenticated Supabase user;
2. creates a P-256 ECDH pair in memory;
3. immediately re-imports the private half as a non-exportable `CryptoKey`;
4. stores that non-exportable key only in browser IndexedDB;
5. sends only the uncompressed public point and a random device UUID to the Worker;
6. lets the Worker derive the user from the verified bearer session; and
7. writes through the public Supabase REST interface so forced RLS must approve the selected tenant and user.

The Worker has no service-role key and cannot bypass RLS. A successful browser registration still returns `pairingAvailable: false` and an empty capability list. It never reads a private key, message, contact, relationship graph, draft or WhatsApp credential.

## Desktop identity preparation

The desktop Connections screen exposes one bounded **Prepare this desktop** action. It fetches public deployment configuration only from the pinned closed-pilot HTTPS origin and rejects a different Supabase project, an elevated key, unexpected configuration fields, a different authenticated email, an inactive membership or an unselected tenant when the account belongs to multiple tenants.

The submitted password is sent directly to the pinned Supabase password endpoint for that one verification and is cleared from the renderer immediately. It is never written to disk. The resulting session tokens and an exportable PKCS#8 desktop private key are serialized only inside Electron `safeStorage`, in the current local tenant directory. The protected record is bound to the local control-plane user, local tenant, cloud user, cloud tenant, email, device ID and public key. A binding copied to another local user, tenant or Windows protection profile fails closed.

This step deliberately does **not** insert a `desktop_connector` device row. An ordinary bearer session proves the person and tenant but does not attest that the request came from the reviewed desktop binary. Therefore the returned status is only `identity_bound_key_protected`; remote registration, pairing and all capabilities remain false or empty.

## Cryptographic contract

- Each desktop and web client has a distinct P-256 ECDH key pair.
- Private keys are non-exportable Web Crypto keys. Only the uncompressed public point is exchanged.
- The peers derive a 256-bit shared secret with ECDH and derive a non-exportable AES-256-GCM session key through HKDF-SHA-256.
- HKDF is bound to the tenant ID, authenticated user ID, relay session ID and key epoch.
- Every envelope uses a fresh 96-bit nonce and authenticates a canonical additional-data record containing:
  - tenant and user;
  - session, sender device and recipient device;
  - strictly increasing sequence number;
  - capability;
  - tenant-keyed relationship and chat HMAC subjects for private operations;
  - key epoch, issue time and expiry.
- An envelope lives for at most five minutes and is limited to 512 KiB of plaintext plus the authentication tag.
- The replay guard rejects duplicate or reordered sequence numbers.
- The cloud stores ciphertext, nonce and the SHA-256 digest of authenticated data. It never stores the session key or plaintext.

The current capability allowlist is exactly `connection_status`, `chat_read`, and `draft_request`. There is no `send` or `delivery` capability.

## Database enforcement

Migration `202610090001_trusted_relay_foundation.sql` adds:

- `relay_pairing_challenges`: ten-minute, terminal pairing challenges bound to one tenant, user, desktop device, web device and session digest.
- `relay_sessions`: immutable device/binding/capability identity with bounded expiry and explicit revocation.
- `relay_envelopes`: ciphertext-only, replay-keyed, five-minute envelopes.
- `relay_security_events`: append-only, content-free security outcomes.

All four tables enable and force RLS. Ordinary authenticated clients receive no delete privilege. Cryptographic identity fields are immutable. A session insert requires a matching consumed pairing challenge; an envelope insert requires a live session, an allowed capability and the exact two registered devices.

Tenant administrators do not gain another user's relay contents. Policies remain scoped to `auth.uid()` in addition to tenant membership.

## Activation gates

The foundation must not be described as a working relay until all of these are implemented and independently verified:

1. Trusted desktop registration/attestation. Local identity matching and operating-system-protected key persistence are implemented, but remote registration remains closed until it cannot be forged by an ordinary web client.
2. Human-visible pairing code/QR with a transcript signed by the registered desktop device.
3. Worker or trusted function validation of the signed pairing transcript without a service-role credential in the browser.
4. Desktop and PWA clients that poll/subscribe only to their bound session and enforce the replay guard before decryption.
5. Read-only synthetic chat synchronization tests across two users and two tenants.
6. Revocation, expiry, key rotation, lost-device recovery and offline queue tests.
7. Load, abuse, rate-limit, retention and incident-response evidence.
8. Independent security review.

Drafting is a later, separately reviewable capability. Automatic or manual delivery is outside this relay foundation and remains locked by the independent delivery authorization system.
