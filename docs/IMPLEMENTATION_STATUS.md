# MyCrobo reboot — implementation status

**Build stage:** closed-pilot production foundation continuing toward alpha.30; externally gated; not a production release

## Alpha.30 trusted-relay foundation

- Added the desktop half of identity preparation without pretending it is pairing. The local desktop proves the same normalized account email and an active, explicitly selected Supabase tenant, then stores its tokens and P-256 private key only through Windows-protected Electron `safeStorage` inside the current local tenant. Passwords are never retained.
- The desktop pins both the Cloudflare origin and Supabase project, rejects elevated/unexpected public configuration, account mismatch, inactive or ambiguous membership, cross-local-tenant bindings and unreadable protected storage. Product and platform-console IPC remain mutually exclusive.
- Desktop preparation intentionally does not register a remote desktop device: bearer login is not binary attestation. Its truthful terminal state is `identity_bound_key_protected`, with pairing, cloud registration and capabilities still disabled. No chat content is read or uploaded and no delivery route is added.
- Added explicit PWA browser-device preparation. The private P-256 key is re-imported as non-exportable, stored only in tenant/user-scoped IndexedDB, and never serialized. The Worker derives the user from the authenticated Supabase session and registers only the public key through forced RLS.
- Browser registration does not imply pairing: the endpoint returns no private capability, the hosted UI states that the desktop is not paired, and chat transit, drafting and sending remain unavailable.
- Added a browser-compatible P-256 ECDH + HKDF-SHA-256 + AES-256-GCM envelope contract. Keys are non-exportable, private capabilities require both tenant-keyed relationship and chat HMAC bindings, and replay protection rejects duplicate or reordered sequence numbers.
- Added an additive Supabase migration for short-lived pairing challenges, immutable relay sessions, ciphertext-only envelopes and append-only security events. All four tables are tenant/user scoped with forced RLS; session creation requires an exact consumed pairing challenge.
- Relay capabilities are restricted to connection status, chat read and draft request. Send/delivery is not representable.
- The hosted capability response and UI now distinguish an installed cryptographic foundation from an actually paired connector. Pairing, private chat transit, drafting and sending remain off.
- Extended the two-principal RLS verifier and synthetic fixture from 10 to 14 tenant-owned tables. The additive migration was applied to the dedicated no-customer-data project and its forced-RLS policy inventory was read back successfully. A fresh two-principal certification remains required after every material schema change.

## Alpha.29 closed-pilot foundation

- The cloud schema is tenant- and user-scoped with forced PostgreSQL row-level security, immutable membership provenance, opaque HMAC subject identifiers, and a verifier that checks every migrated public table plus two synthetic principals on a dedicated no-customer-data project. Live RLS certification still requires the external Supabase pilot project.
- Graph-Grounded Context Protocol keeps factual evidence inside the selected tenant and target relationship graph. Cross-relationship learning accepts only fixed-shape, content-free behavioral fingerprints from at least three opaque source graphs and cannot transfer text, topics, entities, embeddings, comments or facts.
- The existing client is an installable PWA with a bounded static-shell service worker. Hosted mode exposes no desktop pairing, chat, attachment, drafting or delivery APIs; private browser APIs stay closed until an authenticated tenant-bound relay exists.
- Gmail and Google Calendar use exact read-only OAuth scopes, tenant/user-bound encrypted credentials, PKCE, bounded requests, revocation quarantine, content-free Gmail counts/digests and availability-only Calendar blocks. No Gmail subject, snippet, address or body is retained by the current connector.
- Automatic-delivery preferences support tenant defaults plus relationship and chat overrides, but stored policy is not execution authority. Delivery requires a protected host bootstrap, exact build/safety bindings, explicit current consent, fresh account/chat/message state, a passing draft-safety decision, durable outbox/authorization records and a one-use bridge approval immediately before provider delivery. The shipped pilot is unprovisioned and therefore remains unable to send automatically.
- Settings now reports each protected automatic-delivery execution gate independently instead of hiding every unavailable state behind a generic development-lock label. Policy and consent controls remain unable to activate or bypass host certification.
- The hosted shell is deployed fail-closed with a bounded public Supabase configuration. Public live-origin verification passes; an opt-in authenticated verifier can now prove a pilot sign-in plus the exact no-relay/no-private-chat/no-send boundary without printing or persisting credentials or tokens. The Windows alpha.29 runtime has exact source/package parity evidence, but signing, updater, rollback, real-provider certification and independent acceptance evidence remain open.

## Alpha.6 increment

- Full media is now fetched only when opened. A 128 MiB least-recently-updated
  full-attachment cache preserves message text, chronology, thumbnails and
  encrypted download references while preventing history import from consuming
  unbounded disk space.
- SQLite checkpoints its write-ahead journal at startup/shutdown, applies an
  8 MiB journal limit, and compacts after material media-cache reclamation.
- Settings shows truthful database-plus-journal use, attachment-cache use and
  the retention policy without exposing filenames or message content.
- The conversation rail renders in accessible batches of 80 rather than adding
  every saved conversation to the DOM. Search still runs across all locally
  saved names and messages.
- Exact repeated connector echoes are collapsed at presentation time for chat
  titles and previews; the saved source record remains untouched.
- Primary navigation now uses a consistent vector icon family instead of mixed
  text glyphs.
- `docs/WORLD_CLASS_1000_POINT_AUDIT.md` contains exactly 1,000 independently
  addressable production, design, accessibility, reliability, security and
  operational criteria. It is explicitly a release standard, not a completion
  claim.

## Alpha.5 increment

- Browser-safe MP4/WebM video and PDF payloads are downloaded into the bounded
  local media cache and displayed inside the app. Images continue to use the
  existing private viewer; view-once media remains unavailable by design.
- A separate **Needs your decision** tab lists evidence-backed incoming questions,
  current-fact/choice requests and attachments that require human judgement.
  Direct-chat unresolved questions remain listed even if a later message arrives.
  Group conversations are intentionally excluded from this personal queue and
  remain available only in Chats for reference.
- A separate **Tasks** tab contains only current commitments detected in the
  owner's own messages. Done/not-a-task states are stored locally and never imply
  that a WhatsApp message was sent.
- Communication promises and other-person commitments are separated into a
  **Follow-ups** notification tab. Group commitments never appear in either
  Tasks or Follow-ups.
- Internal long LID identifiers are replaced with an evidence-resolved contact
  name or phone number; when neither is available, the UI says “Unsaved contact”.
- **Write my own** is independent of AI drafting. It always opens for a verified
  source message; sending remains gated by live freshness and stale-target checks.
- Automated UI verification covers video/PDF visibility, manual composition,
  all work queues, stable refresh, stale-search cancellation, deliberate history
  paging, snooze/undo, real settings controls and zero outbound calls.
- Navigation now has one durable state owner: Decisions, Tasks, Follow-ups and
  Settings survive status polling and a page reload instead of snapping back to
  Chats. Queue state is saved locally, including a recoverable **Not needed**
  action for decisions.
- Decision detection is limited to fresh, direct, actionable requests. Broadcast
  links, rhetorical/legal text and uncaptioned ordinary media are suppressed.
  Tasks require a concrete owner action; deliverable communication promises are
  Follow-ups; vague or expired items are omitted or collapsed under **Older
  items to review** until the user expands them.
real-account completeness and controlled-send certification remain open  
**Product claim:** prototype in progress, not production ready  
**Outbound state:** exact-recipient text sending is initiated only by the user's
recipient-labelled Send click; invisible exact-body approval and stale-target
checks remain. No WhatsApp message was sent during this validation.

## Implemented

- Isolated reboot; the earlier application is not used by this runtime.
- Real local linked-device bridge based on `whatsmeow`, with separate durable
  session and message databases.
- One explicit consent for importing all active and archived conversations.
- WhatsApp Web and all traversal mechanics absent from the product UI.
- Active and archived discovery/storage/UI collections kept separate.
- Phone-JID/LID aliases reconciled only from protocol evidence; the provider JID
  and internal canonical chat ID are stored separately.
- Verified source timestamps, authenticated owner/other direction, and
  non-conversational system/media classifications.
- Authenticated server-sent live updates plus a lightweight latest-message
  barrier and bounded polling fallback; the UI opens at the newest message and
  does not traverse full history merely to detect freshness.
- Paired sessions with durable one-shot all-chat consent automatically resume
  their read-only connection after an app restart. A paired session without
  that consent remains disconnected.
- Sequential per-chat older-history requests with durable progress. There is no
  arbitrary message/page cap; only provider-confirmed end is complete.
- Partial, stalled, timed-out and failed histories remain explicit.
- Backend search across locally saved chat names and message text, scoped
  separately to active or archived conversations.
- The newest bounded conversation page is rendered first; a deliberate
  **Load earlier messages** control pages backward without infinite scroll and
  preserves the reader's exact visual anchor.
- The primary chat list suppresses unresolved linked-device/group IDs,
  newsletters, broadcasts and empty unsaved-number records. Recognizable chats
  remain available, real unsaved phone identities are formatted with `+`, and
  conversations are ordered by their latest readable message.
- Story packets with explicit `OWNER`/`OTHER` speakers, evidence IDs and
  stale-target rejection.
- General and person-specific tone sample pools built only from verified
  outgoing text. Messages containing time, location, availability or future
  commitments are excluded from verbatim tone examples; only safe lexical
  examples and derived style statistics remain available.
- Conservative group no-reply policy and metadata exclusion.
- Deterministic 1,500-scenario temperature record without presenting it as an
  unsupported tone percentage.
- A conservative private local drafting fallback is always available. It uses
  the verified story and person-specific acknowledgement style without
  inventing facts. Requests involving time, availability, location, current
  status or a future action produce an editable required-fact placeholder,
  never a historical promise. An optional server-side
  OpenAI Responses API provider uses structured output, `store:false`, and no
  hard-coded key/model. Every provider is blocked unless the selected chat is
  current and its available-history end is confirmed.
- Every draft provider is followed by a deterministic safety gate. An
  unsupported current fact or commitment is replaced by a required-input
  placeholder with explicit provenance semantics. Story events record target,
  age, temporal status and whether a fact came from the owner or was merely
  requested by someone else.
- Exact-recipient text sending is isolated behind two invisible server calls: a
  two-minute approval binds the canonical recipient, current target message,
  complete edited body and idempotency key; send rechecks current latest state,
  records a durable audit, requires a provider acknowledgement and refuses
  blind retry after an ambiguous outcome. Both server layers reject unresolved
  placeholders.
- The client flow is draft → edit → `Send to <recipient>`. There is no
  per-message checkbox or ordinary review dialog. Send remains disabled while
  a required current fact is unresolved, and a stale/error result preserves the
  user's edited text.
- Versioned mobile/offline contracts that do not depend on Electron or a
  WhatsApp DOM.
- Append-only message-event journal with edit/delete revisions, provenance,
  expiry/supersession and durable conversation snapshots for topics, open
  questions, commitments, facts, latest intent and awaiting-party state.
- Evidence-backed identity and contextual relationship models plus
  privacy-bounded multilingual retrieval ordered by current conversation,
  same person, shared groups, analogous relationship and general owner style.
- Three-to-five internal draft candidates with an independent evaluator;
  unsupported commitments, credentials, foreign evidence and generic-assistant
  tells fail closed before the existing deterministic draft safety gate.
- Consent-gated minimal cloud-model envelopes, local fallback, 1,500-cell
  evidence registry/runtime routing, media reasoning provenance and
  tenant/device/scope-bound mobile contracts.
- Local validated preferences for conversation-matched/preferred reply language,
  reply length, live updates and compact/comfortable density. Each control has
  an implemented effect; unsupported settings are absent.

## Evidence completed on this workstation

- JavaScript/TypeScript core, gateway, desktop-shell, client safety and contract
  suite: **126/126 JavaScript tests passed**, plus all Go bridge, storage, state, connector and HTTP tests.
- Go bridge, HTTP API, storage and connector suites passed, including durable
  state integration and bridge-level rejection of unresolved current-fact
  placeholders. The pure conversation-state test package compiled, but Windows
  Application Control blocked its newly named test executable; the same core
  chronology/request/edit-delete regressions passed through the permitted
  bridge integration suite.
- Go static analysis: passed.
- Live bridge executable: compiled successfully.
- Browser interaction checks: chat opening, exact latest display, automatic
  scroll to newest, owner/other labels, archive separation, active and archived
  history search, no-reply display, draft-error recovery and working buttons.
- A paired real WhatsApp account was used for a read-only freshness regression:
  after restart the connector moved from `catching-up` to
  `current-read-only`, the selected conversation acquired the missing live
  continuation, its list preview and open conversation agreed on the newest
  message, speaker labels stayed explicit, and it opened at the latest end.
  No attachment or chat send was performed.
- Automated client checks prove that ordinary sending contains no confirmation
  checkbox or review dialog, required-fact placeholders disable Send, and
  replacing a placeholder enables the one recipient-labelled action. Gateway
  and bridge bypass attempts containing placeholders are rejected.
- Official Go vulnerability scan: zero reachable/imported vulnerabilities; one
  unused-module advisory is recorded in `THREAT_MODEL.md`.
- Compact Windows alpha.6 built separately at
  `outputs/MyCroboReboot-alpha6-compact-win32-x64/MyCroboReboot.exe`.
- The approved MyCrobo identity is applied to the executable/window icon,
  branded startup screen, application header, versioned installer artwork and
  seven-slide pictorial guide. The guide passed per-slide render review,
  template-fidelity checks and overflow testing.
- The packaged alpha.6 was launched and visually inspected against its saved
  local workspace. Settings, archived navigation and a 6,875-message saved
  conversation opened correctly at the latest end without sending. Its bridge and gateway
  started on random loopback ports, direct unauthenticated bridge access
  returned `401`, the browser response contained CSP and `X-Frame-Options:
  DENY`, the old WhatsApp Web UI was absent, and all child processes stopped
  with the app.
- On the same saved workspace, the runtime directory decreased from 940.86 MiB
  to 237.78 MiB after bounded media-cache maintenance and journal truncation.
  The compact package decreased from 417.54 MiB to 370.98 MiB while retaining
  every shipped locale and required Chromium license.
- Product navigation now has one durable visibility controller. Decisions,
  Tasks, Follow-ups and Settings remain selected through two-second connection
  polling, workspace refreshes and a page reload; scroll anchors and expanded
  dismissed/snoozed sections remain independent for each queue.
- Queue quality now fails toward less interruption: promotional and rhetorical
  broadcasts, uncaptioned ordinary media and stale questions are excluded from
  Decisions; `Not needed` is persisted by evidence identifier with immediate
  Undo. Tasks require fresh, concrete owner action evidence. Non-deliverable
  promises are excluded from Follow-ups, and old unconfirmed work starts in a
  collapsed review section instead of competing with current work.
- The release evidence and key runtime hashes are recorded in
  `BUILD_MANIFEST.json`.

## Release blockers still open

1. The user must explicitly accept the unofficial connector disclosure and scan
   a QR code for a controlled read-only account test.
2. Active and archived counts, five sampled history boundaries, a newly received
   unique latest message, speaker direction and group no-reply must be reconciled
   against that source account.
3. The chosen model must be configured, then tone/multilingual/story quality must
   pass a versioned blind evaluation. No precise tone-match percentage is
   allowed before calibration.
4. External security/privacy approval remains open, together with an
   encrypted-at-rest product vault, deletion/backup, performance/soak and
   recovery certification. Keyboard focus, semantic controls and reduced-motion
   support are implemented but still require independent accessibility review.
5. The current Windows alpha is an unsigned portable executable, not a signed
   installer, and has no updater. A source-controlled build manifest now exists,
   but code signing, installer/updater engineering and mobile clients remain
   release blockers.
6. Text sending is implemented but remains uncertified until a separately
   authorized controlled send proves provider acknowledgement, post-send latest
   state, idempotency and recovery. Attachments remain unavailable. The current
   no-send instruction is preserved.
7. A branded pictorial guide is available for the current verified
   prototype. Its product screenshots must still be recaptured from the exact
   signed release candidate after the real-account read-only gates pass.

## Next acceptance sequence

1. Start the read-only bridge and gateway.
2. In MyCrobo, accept the single all-chat import disclosure and scan the QR code.
3. Keep the phone online while per-chat receipts move to complete or an explicit
   partial/provider-limited state.
4. Run the manual linked-account checklist in `QA_RELEASE_GATES.md` without
   pressing any recipient-labelled Send button.
5. Configure and evaluate drafting only after latest/history/speaker gates pass.
6. Package, sign, capture screenshots from that build, and create the user guide.
