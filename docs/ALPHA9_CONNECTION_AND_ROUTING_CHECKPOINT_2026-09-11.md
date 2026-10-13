# MyCrobo alpha9 connection and routing checkpoint

Date: 2026-09-11

Target application: `MyCroboReboot-alpha9-compact-win32-x64/MyCroboReboot.exe`

## Preserved state

- The existing flat account remains the `primary` account profile and continues to use its original files in place.
- Existing message, linked-device, settings, media, and diagnostic stores were not deleted or migrated.
- A byte-for-byte critical-data backup was created before package changes.
- No real WhatsApp message was sent while reproducing or testing this work.

## Connection-start defect

Root cause: after the connection endpoint accepted the request, the frontend waited for saved-chat catalogue calls before it displayed WhatsApp's pairing state. A slow or unavailable catalogue left the screen on `Starting...` even though connection setup had already begun.

Repair:

- Enter the setup state immediately after the connect request is accepted.
- Do not probe saved chats while deciding whether to display setup.
- Bound status and saved-chat requests with timeouts.
- Treat the connector's `preparing` state as a real login state.
- Present both QR and phone-number login from the same setup surface.
- Normalize the provider pairing value to exactly eight uppercase alphanumeric characters and refuse malformed values.
- Keep sync, analysis, and drafting separate from sending.

## Equal multi-tenant workspaces

- There are no primary or secondary tenant roles. Every tenant is an equal workspace with an opaque random identifier.
- The existing account is presented as `My workspace` and remains in its original directory with no destructive data migration.
- The old account-profile registry is preserved as a migration record but is no longer authoritative. `tenant-registry.json` is the active registry.
- Each newly added workspace receives an isolated directory for messages, linked-device session, local state, settings, model credential, vault key, media, and diagnostics.
- Workspace switching stops local services, rotates service tokens, switches the data boundary, and relaunches MyCrobo.
- The tenant registry stores local workspace labels and paths, not phone numbers, message text, or WhatsApp identifiers.
- Duplicate storage paths, invalid tenant identifiers, and path traversal fail closed before a workspace opens.

Remaining production gate: automatic cryptographic binding between a local profile and WhatsApp's verified self-account identity requires a newly signed/allowed bridge executable. Windows Application Control blocked execution of locally rebuilt Go test binaries on this machine, so that binding has not been certified in the selected packaged bridge.

## 1,500-cell reply routing

- The taxonomy remains exactly 15 interaction families x 10 relationship contexts x 10 communication modes.
- Every cell has a stable `Cxx.Sxx.Txx` code.
- Runtime routing calculates a factorized posterior and selects a bounded top-k neighbourhood instead of running 1,500 generations.
- Historical communication mode is learned from the owner's reply, not copied from the incoming sender's mood.
- Retrieval prefers the current conversation story, then same-person episodes, shared context, relationship-level evidence, and finally general tone.
- Duplicate low-information replies such as `haan`, `okay`, and `got it` are capped so richer evidence can compete.
- Candidate generation and independent evaluation reject invented facts, unsafe commitments, credentials, stale targets, and unsupported time/location claims.

## Test evidence actually run

- 67 focused frontend, state, safety, retrieval, relationship, scenario, tenant, media, and desktop-isolation tests: 67 passed, 0 failed.
- Six packaged tenant tests passed after deployment, including legacy migration, new-workspace isolation, switching, and duplicate-path rejection.
- Safe browser-driven setup fixture: QR displayed immediately; phone flow displayed `A1B2-C3D4` as eight cells; expiry and phone instructions displayed; no external request and no real account.
- Installed package hashes for the eleven modified runtime files match the tested working files.
- The installed app and WhatsApp bridge are running, and periodic system status requests are returning HTTP 200.

## Checks not yet certified

- Real QR scan and real phone-number pairing require the account owner to complete WhatsApp's official linked-device steps.
- A real second-account switch/logout/relogin test has not been performed because it would alter a live linked-device session.
- Fresh Go bridge tests could not execute under Windows Application Control; the currently packaged bridge still launches.
- Historical full-account completeness depends on what WhatsApp makes available to the linked-device session and must not be claimed without per-chat cursor/provenance evidence.
