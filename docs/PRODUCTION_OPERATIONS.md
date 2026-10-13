# MyCrobo production operations and external acceptance plan

This runbook is executable guidance for the exact release candidate. It does not convert missing third-party evidence into approval.

## Runtime security baseline

- The desktop gateway binds to loopback and requires a random bearer token plus a separate per-window capability on every request.
- Host and Origin are exact, external navigation and window creation are denied, browser permissions are denied, and the renderer runs with context isolation, Chromium sandboxing and no Node integration.
- Read and write request budgets are separate. Headers, requests, keep-alive and outbound provider calls have bounded timeouts.
- Child processes receive an environment allowlist instead of the complete desktop environment.
- Ordinary renderer requests cannot send. The bridge's exact-send primitive is reachable only through a separate random broker capability held by the Electron main process; the native Windows confirmation shows the exact recipient and body before the one-use approval/send transaction.
- The MyCrobo user-data directory receives an owner-and-SYSTEM-only Windows DACL. Settings, Communication DNA choices, decisions and content-free feedback are encrypted with AES-256-GCM; the key is protected by Electron `safeStorage`. Message and linked-device SQLite stores use the Adiantum encrypted VFS. Existing plaintext stores are copied into integrity-checked encrypted vault files before the bridge switches to them; recovery-source deletion remains an explicit lifecycle action.
- Diagnostic records contain correlation ID, route class, method, status and duration only. The log rotates and contains no chat, contact, message, draft, URL or filename values.

## Production connector decision

Two connector modes are deliberately separate:

1. **Personal linked-device pilot:** local and useful for research, but unofficial and ineligible for a public production claim until platform/legal approval says otherwise.
2. **WhatsApp Business Platform:** supported webhook and outbound transport contracts are implemented in `contracts/whatsapp-business.mjs`. It receives messages from registration onward and cannot import a personal account's earlier WhatsApp history. Webhooks require Meta HMAC verification. Outbound use requires an exact approved recipient/body/idempotency packet.

The Meta Graph API version has no source-code default. Release management must record an explicitly approved, currently supported version for the exact candidate.

## Incident response

### Severity and immediate containment

- **Critical:** unintended send, cross-account disclosure, signing-key compromise, authentication bypass or unrecoverable data corruption. Stop distribution, disable connector credentials, revoke update/session keys, preserve content-free evidence and notify the executive, security and privacy owners immediately.
- **High:** local vault bypass, wrong-recipient near miss, repeatable latest-message mismatch, webhook forgery or cloud-context over-disclosure. Disable the affected capability and issue a stop-ship decision within one business day.
- **Medium/Low:** triage into the release risk register with an owner, target, evidence and expiry.

### Required drill evidence

For every release candidate, record timestamps and outcomes for: gateway-token revocation, device-session revocation, update-key revocation, connector-token rotation, rollback, corrupt-settings recovery, low-disk media eviction, model outage, provider rate limiting and an ambiguous outbound acknowledgement. Drills use synthetic data and a synthetic connector unless a separately authorised controlled recipient is approved.

## Backup, export, deletion and retention

- Settings exposes an export of local MyCrobo metadata and an explicit reset of preferences, per-chat styles, task decisions and draft feedback. The control does not falsely claim to delete WhatsApp history.
- Message chronology and source evidence are durable. Re-fetchable full attachments use a bounded least-recent cache; media bytes are evicted before message evidence.
- A complete-account delete/unpair workflow must be certified against the bridge database, linked-device session, encrypted settings, diagnostics, backups and update cache before public release. Deletion must be recoverable only when the user chose an encrypted backup.
- Production backup/restore must be encrypted, versioned, integrity-authenticated and tested on a separate machine and app version. A filesystem copy is not a certified backup.

## Release pipeline

1. Freeze source and assign a version, channel, build ID and source revision.
2. Run `verify:source`, `verify:ui`, `security:scan`, package parity and Go static analysis.
3. Generate CycloneDX SBOM, SLSA-style provenance and machine-readable readiness evidence with `release:evidence`.
4. Build twice on isolated builders and compare the unpacked application source hashes. Record any unavoidable Electron container differences.
5. Sign the executable/installer with `scripts/sign-release.ps1` using a commercial code-signing certificate and trusted RFC-3161 timestamp.
6. Sign update metadata with a separately controlled Ed25519 release key. Verify channel, minimum version, expiry, artifact size and SHA-256 before installation. Downgrades and same-version replacement are blocked.
7. Exercise installer, upgrade, rollback, uninstall and deletion on clean supported Windows versions.
8. Attach independent penetration, accessibility, privacy/legal and connector-approval reports to the exact artifact SHA-256.
9. Obtain named engineering, QA, product, security/privacy, operations and independent-assessor sign-offs.

## Mobile and hosted rollout

- Mobile sessions are tenant, user, device, audience, scope, expiry and token-revocation bound. One-use request nonces prevent replay.
- Cursors remain signed and restricted to one tenant, collection and snapshot. Draft edits use revisions and surface conflicts rather than overwriting another device.
- Raw WhatsApp data stays in the selected tenant region and is never placed in logs, crash reports, analytics labels or notification text.
- iOS keys must use Keychain/Secure Enclave where available; Android keys must use Keystore/StrongBox where available. Native caches are encrypted and remote wipe/revocation is tested.
- App-store builds require platform privacy declarations, data-safety forms, deletion URLs, support contacts, age/region decisions and store review. These are external approvals, not build-script outputs.

## External evidence that cannot be self-issued

- Meta Business and WhatsApp Business Platform approval.
- Commercial code-signing certificate identity and timestamp trust.
- Production hosting, DNS, TLS, HSM/KMS and monitoring accounts.
- Independent penetration test and remediation retest.
- Independent WCAG 2.2 AA assessment.
- Privacy/legal approval, lawful-basis record, EULA/privacy notice, DPA and subprocessor register.
- Apple and Google developer accounts and app-store approval.
- Named operational owners and an explicitly consenting controlled-send recipient.

Until those records are attached to the exact signed hash, the release evaluator must remain NO-GO for public production.
