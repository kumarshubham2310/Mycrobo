# MyCrobo prototype-to-production journey

Living launch ledger · Baseline verified 29 September 2026 · Asia/Calcutta

This is the single missing-journey tracker from the current MyCrobo prototype to a launch-ready production product. A checkbox may be closed only when the stated evidence exists for the exact release artifact. Code existing, a mock passing, or a feature appearing in the UI is not sufficient evidence by itself.

## Current stage

**Current classification: internal prototype / engineering alpha.**

- Latest source and review package: `1.0.0-alpha.29`.
- Source working tree: 86 modified or untracked entries; not a clean release source.
- Desktop copy previously used: `1.0.0-alpha.12`; it does not contain the alpha.29 algorithm and runtime set.
- Windows executable metadata: still reports `1.0.0-alpha.2`.
- Distribution: unsigned portable build; no installer, updater or tested rollback.
- Formal production-readiness decision: `NO-GO`.
- Historical product evaluation: 10% strict acceptance on the available 20-case holdout; owner-personalization lift was negative.
- History evaluation: none of 85 audited chats reached a verified beginning.
- Automatic sending: disabled and must remain disabled until its own future safety gate is approved.
- No MyCrobo process was running when this baseline was refreshed.

### Baseline gap count

| View | Count |
|---|---:|
| Total tracked launch gaps | 130 |
| P0 — must close before public production launch | 93 |
| P1 — must close before GA unless formally proven non-blocking | 31 |
| P2 — scale/future-platform work | 6 |
| Open | 99 |
| Partial foundations | 24 |
| External authority required | 4 |
| Blocked by an executive decision | 3 |
| Closed with launch evidence | 0 |

`P0` means a blocker to the final public production claim, not that all 93 items belong in one sprint. The gate sequence below determines the implementation order.

## Status vocabulary

| Status | Meaning |
|---|---|
| `OPEN` | Not implemented or not evidenced. |
| `PARTIAL` | A foundation exists, but the launch acceptance evidence is incomplete. |
| `EXTERNAL` | Requires a third party, qualified counsel, certification or platform authority. |
| `BLOCKED` | A prerequisite decision must be made first. |
| `CLOSED` | Implemented and verified against the exact candidate artifact. |

## Journey map

```text
Current prototype
  ↓ Gate 0: one truthful source and exact artifact
Clean internal alpha
  ↓ Gate 1: safe connector, correct history and useful drafts
Design-partner beta
  ↓ Gate 2: proven user value, privacy, security and reliability
Closed paid beta
  ↓ Gate 3: hosted operations, billing, support and distribution
General availability
  ↓ Gate 4: scale, mobile, regions and carefully governed autonomy
Global platform
```

## Gate 0 — establish one truthful product

Gate 0 is passed only when P2P-001 through P2P-010 are closed and the exact built artifact passes every declared check.

### A. Source of truth and release integrity

- [ ] **P2P-001 · P0 · BLOCKED — Select one canonical source repository and branch.** Done when every developer, build, test and package references one version-controlled source location.
- [ ] **P2P-002 · P0 · OPEN — Preserve and reconcile the alpha.12 Desktop copy and alpha.29 source.** Done when user data/session are backed up, code differences are classified, and no newer required behavior is lost.
- [ ] **P2P-003 · P0 · OPEN — Reduce the source tree to zero unexplained changes.** Done when every dirty entry is committed, intentionally ignored or removed through a reviewed, recoverable process.
- [ ] **P2P-004 · P0 · OPEN — Make version identity consistent.** Done when package version, executable metadata, About screen, logs, manifest, installer and updater all report the same version/build ID.
- [ ] **P2P-005 · P0 · OPEN — Define the reproducible build recipe.** Done when a clean machine can generate a byte-identical or formally reproducible artifact from a tagged revision and pinned toolchain.
- [ ] **P2P-006 · P0 · PARTIAL — Bind evidence to the exact artifact.** Done when tests, SBOM, security scans, model/config versions and acceptance results reference the release SHA-256.
- [ ] **P2P-007 · P0 · OPEN — Remove backup source trees and internal fixtures from distribution.** Done when the customer package contains only required runtime files and approved notices.
- [ ] **P2P-008 · P0 · OPEN — Create environment separation.** Done when development, test, staging and production use distinct credentials, endpoints, data and release channels.
- [ ] **P2P-009 · P0 · OPEN — Establish protected release branches and approvals.** Done when required reviews and automated gates prevent unverified artifacts from becoming releases.
- [ ] **P2P-010 · P0 · OPEN — Publish an artifact inventory and provenance attestation.** Done when every binary, native component, model, license and build input can be traced to source and signer.

## Gate 1 — prove the safe core product

Gate 1 creates a design-partner beta. It requires a supported channel decision, reliable account isolation, truthful history coverage, positive draft value and a simplified usable workflow.

### B. Product and WhatsApp channel strategy

- [ ] **P2P-011 · P0 · BLOCKED — Choose the initial ideal customer profile.** Done when one beachhead user, high-frequency problem, willingness-to-pay hypothesis and excluded audiences are documented.
- [ ] **P2P-012 · P0 · BLOCKED — Choose the WhatsApp product path.** Decide between closed personal research, official Business Platform, or two separately governed products.
- [ ] **P2P-013 · P0 · EXTERNAL — Obtain a qualified WhatsApp/Meta policy assessment.** Done when counsel and, where possible, Meta confirm the intended connector and commercial behavior.
- [ ] **P2P-014 · P0 · OPEN — Make connector status explicit in product and contracts.** Done when official/unofficial status, limitations, risk and support responsibility are consistently disclosed.
- [ ] **P2P-015 · P0 · OPEN — Define supported and unsupported messaging behaviors.** Include personal use, business use, bulk behavior, automation, groups, media, templates and history limits.
- [ ] **P2P-016 · P0 · OPEN — Remove public claims not supportable by the chosen channel.** Done when marketing, onboarding and UI match actual history, delivery and account capabilities.
- [ ] **P2P-017 · P1 · OPEN — Create a connector abstraction with conformance tests.** Done when linked-device, official Business and future connectors implement the same safe event and send contracts.
- [ ] **P2P-018 · P1 · OPEN — Define connector deprecation and migration.** Done when users can move without mixing tenants, losing audit data or silently changing capabilities.
- [ ] **P2P-019 · P1 · OPEN — Establish channel incident response.** Done when bans, warnings, breaking protocol changes, outages and credential revocations have playbooks and communication templates.
- [ ] **P2P-020 · P1 · OPEN — Establish channel health SLOs.** Done when connection success, reauth rate, event lag and send acknowledgements have targets and alerts.

### C. Account identity, connection and history integrity

- [ ] **P2P-021 · P0 · PARTIAL — Persist linked-device sessions safely across restart.** Pass close/reopen, reboot, sleep/wake and network-change tests without unnecessary relinking.
- [ ] **P2P-022 · P0 · PARTIAL — Support QR and phone-code pairing end to end.** Pass fresh account, expired code, retry, cancellation and accessibility scenarios.
- [ ] **P2P-023 · P0 · PARTIAL — Prove WhatsApp identity before import.** Done when phone/LID aliases bind to the intended tenant without recurring false mismatch screens.
- [ ] **P2P-024 · P0 · PARTIAL — Support safe logout and a different account login.** Done when sessions, messages, media and learned style never cross workspaces.
- [ ] **P2P-025 · P0 · OPEN — Add an explicit account-switch journey.** Done when the UI identifies the current account and explains whether to reconnect, create a workspace or remain offline.
- [ ] **P2P-026 · P0 · PARTIAL — Guarantee latest-message correctness.** Pass real-profile tests for incoming/outgoing messages, edits, deletes, reactions, calls and multi-device races.
- [ ] **P2P-027 · P0 · PARTIAL — Guarantee chronological ordering and deduplication.** Pass stable message-ID, timestamp conflict, retry and out-of-order event tests.
- [ ] **P2P-028 · P0 · OPEN — Maintain a per-chat history-coverage ledger.** Show earliest local message, latest verified message, reached-beginning state, gaps and provider limitations.
- [ ] **P2P-029 · P0 · OPEN — Stop claiming or implying complete history without proof.** Every UI, model prompt, report and marketing surface must consume the coverage ledger.
- [ ] **P2P-030 · P1 · OPEN — Implement bounded background backfill with fair scheduling.** Done when chats advance without blocking the UI, starving recent chats or creating endless visible scrolling.

### D. Conversation intelligence and personalization

- [ ] **P2P-031 · P0 · PARTIAL — Build a durable conversation-state engine.** Track topics, questions, commitments, facts, supersession, expiry, speaker and source message IDs.
- [ ] **P2P-032 · P0 · PARTIAL — Separate owner and other-party messages with near-perfect accuracy.** Release target: at least 99.99% on representative real data.
- [ ] **P2P-033 · P0 · OPEN — Render and reason over quoted/replied-to messages.** Include quote chain, author, mentions and source visibility.
- [ ] **P2P-034 · P0 · OPEN — Replace shallow token matching with multilingual semantic retrieval.** Support English, Hindi, Gujarati, Roman Hindi, Roman Gujarati and mixed-script usage.
- [ ] **P2P-035 · P0 · PARTIAL — Make the 1,500-cell model probabilistic rather than rigid.** Combine calibrated C/S/T probabilities with story and person evidence; never use a cell as a response library.
- [ ] **P2P-036 · P0 · OPEN — Train and calibrate routing on representative owner data.** Synthetic perfect accuracy cannot count as evidence.
- [ ] **P2P-037 · P0 · PARTIAL — Build evidence-backed per-person Communication DNA.** Cover language, length, warmth, formality, humour, emoji, reply act, timing and context-specific shifts.
- [ ] **P2P-038 · P0 · OPEN — Make relationship identity canonical across direct and shared-group contexts.** Include aliases and privacy-safe group membership evidence.
- [ ] **P2P-039 · P0 · OPEN — Retrieve current truth before style analogies.** Enforce current conversation > same person > shared group > relationship type > global owner style.
- [ ] **P2P-040 · P0 · OPEN — Remove canned fallback acknowledgements.** When evidence is weak, request a fact, offer a clearly generic editable draft or safely abstain.
- [ ] **P2P-041 · P0 · PARTIAL — Generate internally diverse candidates.** Include answer, clarification, acknowledgement, refusal and no-reply where contextually valid.
- [ ] **P2P-042 · P0 · PARTIAL — Evaluate candidates independently.** Score factuality, intent, relationship, language, commitment risk, repetition, recipient and group safety.
- [ ] **P2P-043 · P0 · OPEN — Prevent repetitive phrase and plan reuse.** Measure repetition across recent suggestions without turning user vocabulary into forbidden phrases.
- [ ] **P2P-044 · P0 · OPEN — Make user corrections update behavior safely.** Learn from accept/light edit/rewrite/dismiss/no-reply without treating unsent model text as owner evidence.
- [ ] **P2P-045 · P0 · OPEN — Pass the owner-personalization gate.** At least 200 frozen chronological cases, 20+ people, positive lift over baselines and at least 80% accepted/lightly edited in a blinded design-partner cohort.

### E. Reply necessity, factuality and send safety

- [ ] **P2P-046 · P0 · PARTIAL — Separate reply-necessity classification from generation.** Return reply, optional, no reply, attention, media-required or already-answered.
- [ ] **P2P-047 · P0 · OPEN — Reach group no-reply precision above 98%.** Consider mentions, quotes, responsibility, another member's answer, announcements and resolved discussions.
- [ ] **P2P-048 · P0 · PARTIAL — Block invented facts and stale facts.** Every factual claim must cite current-message evidence or an explicit user-supplied value.
- [ ] **P2P-049 · P0 · PARTIAL — Treat time, money, location and commitments as high-risk.** Never turn historical style into a new promise without current authority.
- [ ] **P2P-050 · P0 · PARTIAL — Recheck exact recipient and latest target immediately before send.** Stale targets and changed chats must invalidate approval.
- [ ] **P2P-051 · P0 · PARTIAL — Require deliberate send without a cumbersome global checkbox.** The editable send action is approval; startup/import consent is separate.
- [ ] **P2P-052 · P0 · OPEN — Prove send idempotency and delivery truth.** Retries must never duplicate a message; UI must distinguish accepted, sent, delivered, failed and unknown.
- [ ] **P2P-053 · P0 · OPEN — Keep automatic sending unavailable through launch.** Any future auto-send requires official channel support, per-chat revocation, narrow policies, safety certification and a separate release decision.

### F. Customer UI, UX and accessibility

- [ ] **P2P-054 · P0 · OPEN — Replace fragmented queues with one Today/Attention inbox.** Use filters for needs reply, promised by me, waiting on them and suggested tasks.
- [ ] **P2P-055 · P0 · OPEN — Make the first-run journey value-led and truthful.** Explain benefit, risk, expected import time and the first useful outcome before requesting full access.
- [ ] **P2P-056 · P0 · OPEN — Create a reliable connection and recovery center.** Show current account, last verified activity, health, reconnect, logout and offline state.
- [ ] **P2P-057 · P0 · OPEN — Persist edited drafts encrypted across restart and update.** Show a clear “saved locally” state and recovery behavior.
- [ ] **P2P-058 · P0 · OPEN — Preserve route, selected chat, search, archive filter and scroll context.** Refresh and polling must not navigate the user.
- [ ] **P2P-059 · P0 · OPEN — Always open conversations at the latest verified message.** Preserve intentional older-position reading and show a new-message control.
- [ ] **P2P-060 · P0 · OPEN — Present quoted, replied-to and mentioned context.** Users must see the same conversational relationship used by the model.
- [ ] **P2P-061 · P1 · OPEN — Turn tasks into truthful suggested work.** Show exact source, confidence, real due date, owner, urgency and correction controls.
- [ ] **P2P-062 · P1 · OPEN — Make dismiss/complete/snooze reversible.** Keep a persistent recent-actions area rather than a seven-second-only undo.
- [ ] **P2P-063 · P1 · OPEN — Simplify Settings to user-controllable variables.** Move legal/explanatory material to appropriate documents and hide unavailable roadmap controls.
- [ ] **P2P-064 · P0 · OPEN — Pass WCAG 2.2 AA contrast and text sizing.** Eliminate 8–10 px functional metadata and insufficient muted-text contrast.
- [ ] **P2P-065 · P0 · OPEN — Pass keyboard and screen-reader journeys.** Cover login, pairing, all routes, conversations, composer, media, errors and admin operations.
- [ ] **P2P-066 · P1 · OPEN — Complete responsive/mobile-window behavior.** Account identity, sign out and connection health must never disappear.
- [ ] **P2P-067 · P1 · OPEN — Localize the product UI.** Add language packs, locale-aware time/number formatting, native scripts and RTL readiness where applicable.
- [ ] **P2P-068 · P1 · OPEN — Run moderated usability studies.** Five or more target users must reach a useful outcome without coaching and without misunderstanding send/history state.

### G. Media and translation

- [ ] **P2P-069 · P0 · PARTIAL — Prove image viewing end to end.** Test fetched, missing, expired, large, corrupt and unsupported images without exposing view-once content.
- [ ] **P2P-070 · P0 · PARTIAL — Prove PDF viewing end to end.** Test local rendering, password protection, malformed files, large documents and safe external opening.
- [ ] **P2P-071 · P0 · PARTIAL — Prove video and audio playback end to end.** Cover codec, size, streaming, unavailable bytes and retry behavior.
- [ ] **P2P-072 · P1 · OPEN — Add transcript/caption pathways.** Provide accessible truth when transcription is unavailable.
- [ ] **P2P-073 · P1 · OPEN — Add OCR/document extraction with provenance.** Never convert uncertain extraction into an unqualified reply fact.
- [ ] **P2P-074 · P1 · PARTIAL — Productize local TranslateGemma provisioning.** Resolve model licensing, download/install, hardware capability, storage, warm-up and failure UX.
- [ ] **P2P-075 · P1 · OPEN — Establish multilingual translation quality gates.** Evaluate meaning, names, numbers, cultural register and code-switching for each supported pair.
- [ ] **P2P-076 · P1 · OPEN — Enforce media cache retention and deletion.** Show storage usage and ensure deletion propagates to thumbnails, OCR and transcripts.

## Gate 2 — design-partner beta to closed paid beta

Gate 2 requires product-value evidence, real multi-tenant security, privacy/legal readiness, dependable operations and a release-quality customer experience.

### H. Hosted tenancy, authentication, admin and billing

- [ ] **P2P-077 · P0 · OPEN — Decide local-license versus hosted-SaaS commercial architecture.** Do not present a local SQLite console as a global control plane.
- [ ] **P2P-078 · P0 · OPEN — Build production identity.** Include verified email, secure password reset, MFA/passkeys, session/device management and brute-force protection.
- [ ] **P2P-079 · P0 · OPEN — Build hosted tenant isolation.** Enforce organization IDs, row-level policies, tenant-specific keys and cross-tenant negative tests.
- [ ] **P2P-080 · P0 · OPEN — Add invitations and membership lifecycle.** Cover acceptance, expiry, removal, ownership transfer and last-owner protection.
- [ ] **P2P-081 · P0 · OPEN — Enforce roles at every service boundary.** UI hiding is never authorization.
- [ ] **P2P-082 · P0 · OPEN — Build a production operator console.** Use remote audited APIs, least privilege, step-up authentication and immutable operator identity.
- [ ] **P2P-083 · P0 · OPEN — Add operator action safeguards.** Confirmation, pending/idempotent behavior, reason capture and audit links for every material mutation.
- [ ] **P2P-084 · P1 · OPEN — Integrate a payment provider.** Use verified webhooks, idempotency, reconciliation, refunds, disputes and failure recovery.
- [ ] **P2P-085 · P1 · OPEN — Implement plan and entitlement enforcement.** Cover seats, drafts, translation, connectors, storage, retention, media/model usage and API quotas.
- [ ] **P2P-086 · P1 · OPEN — Build coupon/promotion governance.** Add validity, redemption limits, stacking rules, abuse prevention and financial audit.
- [ ] **P2P-087 · P1 · OPEN — Add customer billing self-service.** Show plan, trial, usage, invoices, upgrade/downgrade/cancel and effective dates.
- [ ] **P2P-088 · P1 · OPEN — Report realized commercial metrics.** Distinguish configured value, invoiced revenue, collected revenue, refunds and churn.

### I. Security, privacy, legal and disaster recovery

- [ ] **P2P-089 · P0 · OPEN — Complete an architecture threat model.** Cover desktop, connector, gateway, models, tenant plane, supply chain, admin and mobile seams.
- [ ] **P2P-090 · P0 · OPEN — Replace regex-only security scanning with layered assurance.** Add SAST, dependency/native scans, secret scanning, SBOM validation, fuzzing and secure-code review.
- [ ] **P2P-091 · P0 · EXTERNAL — Pass an independent penetration test.** Remediate and retest all critical/high findings for the exact release architecture.
- [ ] **P2P-092 · P0 · OPEN — Establish production secrets and key management.** Use managed KMS/HSM, rotation, revocation, scoped service identity and recovery controls.
- [ ] **P2P-093 · P0 · OPEN — Implement certified account-data export and deletion.** Cover messages, media, derived state, drafts, analytics, audit allowances and backups.
- [ ] **P2P-094 · P0 · OPEN — Implement encrypted backup and restore.** Include consistent snapshots, integrity verification, tenant quarantine and cross-machine recovery.
- [ ] **P2P-095 · P0 · OPEN — Define and test disaster recovery.** Publish RPO/RTO and run corruption, region, credential and key-loss drills.
- [ ] **P2P-096 · P0 · EXTERNAL — Finalize EULA, privacy notices and acceptable-use policy.** Identify entity, jurisdictions, rights, liabilities, AI limits and channel terms.
- [ ] **P2P-097 · P0 · EXTERNAL — Finalize DPA and subprocessor register.** Include roles, regions, transfers, retention, deletion and incident notification.
- [ ] **P2P-098 · P0 · OPEN — Operationalize data-subject rights.** Build verified intake, access, correction, restriction, portability, deletion and appeal workflows.
- [ ] **P2P-099 · P1 · OPEN — Establish vulnerability disclosure and patch SLAs.** Include security contact, intake, triage, CVE handling and customer communication.
- [ ] **P2P-100 · P1 · OPEN — Establish incident response and breach notification.** Run tabletop exercises with engineering, support, legal and leadership.

### J. Reliability, performance and observability

- [ ] **P2P-101 · P0 · PARTIAL — Meet drafting latency SLOs on real hardware.** Define and pass p50/p95/p99 for private and cloud paths under cold/warm/load conditions.
- [ ] **P2P-102 · P0 · OPEN — Run long-duration connector soak tests.** Include high message volume, sleep/wake, flaky networks, phone offline and server restarts.
- [ ] **P2P-103 · P0 · OPEN — Prove crash and restart recovery.** No draft, task state, session or database corruption may occur.
- [ ] **P2P-104 · P0 · OPEN — Add privacy-safe production observability.** Metrics, traces and logs must exclude message/contact/draft content by construction.
- [ ] **P2P-105 · P1 · OPEN — Define service SLOs and error budgets.** Cover API availability, sync lag, draft latency, send processing and admin operations.
- [ ] **P2P-106 · P1 · OPEN — Add alerting and on-call ownership.** Alerts must be actionable, deduplicated and linked to runbooks.
- [ ] **P2P-107 · P1 · OPEN — Add database health and migration protection.** Include transactional migrations, compatibility, rollback, integrity checks and repair.
- [ ] **P2P-108 · P1 · OPEN — Establish capacity and cost limits.** Test worst-case chats, media, tenants, concurrent drafts, model spend and storage growth.

## Gate 3 — closed paid beta to general availability

### K. Testing, release engineering and distribution

- [ ] **P2P-109 · P0 · PARTIAL — Build a representative automated pyramid.** Unit, contract, integration, Electron E2E, connector simulation and real-profile certification must have separate roles.
- [ ] **P2P-110 · P0 · OPEN — Add rendered UI behavior tests.** Use Playwright/WebDriver plus axe and visual regression; source-regex assertions are insufficient.
- [ ] **P2P-111 · P0 · OPEN — Maintain frozen evaluation partitions.** Tuning data, calibration data and release evaluation data must never leak into one another.
- [ ] **P2P-112 · P0 · OPEN — Create real-profile certification without sending live messages.** Verify connection, latest truth, history, draft, media and restart against consented profiles.
- [ ] **P2P-113 · P0 · OPEN — Create a signed Windows installer and uninstaller.** Preserve data on upgrade; clearly offer data removal on uninstall.
- [ ] **P2P-114 · P0 · OPEN — Add a signed secure updater.** Verify signatures, staged rollout, rollback, release notes and failed-update recovery.
- [ ] **P2P-115 · P0 · OPEN — Test rollback against real user-data migrations.** Restore application compatibility without rolling back or corrupting user data.
- [ ] **P2P-116 · P0 · OPEN — Make the release gate fail closed.** No tag or distribution may proceed while any applicable P0 evidence is absent.

### L. Product analytics, commercial validation and support

- [ ] **P2P-117 · P0 · OPEN — Instrument the activation funnel content-free.** Measure account creation, pairing, verified chat, first draft and first useful outcome.
- [ ] **P2P-118 · P0 · OPEN — Measure the core quality loop.** Accepted, light edit, rewrite, dismiss, correct no-reply, latency and time saved.
- [ ] **P2P-119 · P0 · OPEN — Define the north-star metric.** Recommended: weekly useful communication outcomes per activated workspace.
- [ ] **P2P-120 · P0 · OPEN — Prove retention before broadening scope.** Measure activated W1/W4/W8 retention and cohort reasons for churn.
- [ ] **P2P-121 · P1 · OPEN — Run pricing and packaging research.** Start with one simple plan; do not monetize unenforced capacities.
- [ ] **P2P-122 · P1 · OPEN — Build customer support operations.** Add in-product support, safe diagnostic export, response targets, escalation and known-issue communication.
- [ ] **P2P-123 · P1 · OPEN — Build customer education and trust material.** Onboarding, help center, privacy explanations, connector limitations and recovery guides must match the release.
- [ ] **P2P-124 · P1 · OPEN — Establish launch and rollback ownership.** Name the executive decision maker, release manager, incident commander, privacy owner and customer-communications owner.

## Gate 4 — general availability to global platform

### M. Mobile, API and future product expansion

- [ ] **P2P-125 · P2 · OPEN — Define the mobile threat and sync model.** Decide local keys, cross-device encryption, notification privacy, offline behavior and session revocation before building UI.
- [ ] **P2P-126 · P2 · OPEN — Create stable versioned public/internal APIs.** Include scoped OAuth, tenant boundaries, rate limits, idempotency, audit and deprecation policy.
- [ ] **P2P-127 · P2 · OPEN — Build mobile clients only after desktop retention passes.** Meet the same history, factuality, accessibility and send-safety contracts.
- [ ] **P2P-128 · P2 · OPEN — Add additional connectors only through conformance gates.** Do not dilute the core product before one channel and ICP retain users.
- [ ] **P2P-129 · P2 · OPEN — Add regional deployment and residency.** Include data location, transfer controls, failover and jurisdiction-specific operations.
- [ ] **P2P-130 · P2 · OPEN — Treat voice, visual twin and autonomy as separately governed products.** Each requires consent, identity, abuse, disclosure and safety certification beyond the messaging launch.

## Launch acceptance dashboard

These are release gates, not aspirational metrics.

| Area | Minimum launch evidence |
|---|---|
| Owner/other classification | 99.99%+ on representative release evaluation |
| Message chronology | 100% for verified timestamps in the release set |
| Stale-target send prevention | 100% |
| Wrong recipient / cross-contact leakage | 0 failures |
| Unsupported factual claims | Below 0.1% in controlled evaluation |
| Commitment safety | 100% in the release set |
| Group no-reply precision | Above 98% before group recommendations are marketed |
| Correct language/register | Above 90% human-rated, with per-language floors |
| Person-specific acceptance | At least 80% accepted or lightly edited for design-partner beta |
| Full rewrite rate | Below 15% before general availability |
| Draft latency | Product-approved p50/p95/p99 on supported hardware and network profiles |
| History claims | 0 unsupported complete-history claims |
| Automatic send | Disabled for initial launch |
| Tenant isolation | 0 cross-tenant findings in automated and independent testing |
| Accessibility | WCAG 2.2 AA audit passed for all critical journeys |
| Security | Independent pen test passed; no open critical/high findings |
| Distribution | Signed installer/updater, tested rollback and exact artifact evidence |
| Reliability | SLOs, on-call, backup/restore and DR drill passed |
| Legal | Counsel-approved release pack and supported connector position |

## Definition of launch-ready

MyCrobo may be called **production-ready and launch-ready** only when:

1. Every applicable P0 item is `CLOSED` with evidence attached to the exact artifact.
2. No unresolved P1 item can cause data loss, privacy harm, wrong messaging, inaccessible critical journeys, billing error or unsupported customer promise.
3. Gate 0 through Gate 3 have formal sign-off from Product, Engineering, Security, Privacy/Legal and Operations.
4. The exact customer artifact has passed installation, upgrade, rollback, real-profile, accessibility, penetration, performance and disaster-recovery certification.
5. The owner-personalization system demonstrates positive lift and the stated acceptance target in an untouched evaluation and a real-user cohort.
6. Marketing, product behavior, contracts, support and operational capability tell the same truth.

Until those conditions are met, the honest label remains **internal alpha**, **design-partner beta**, or **closed paid beta**, depending on the highest completed gate.

## How this ledger must be maintained

- Change a status only in the same review that links the evidence.
- Evidence must state artifact hash, environment, date, sample size and limitations.
- A mock, screenshot or unit test cannot certify real connector, history, personalization, delivery, billing or disaster-recovery behavior.
- Reopened regressions return the item to `OPEN` or `PARTIAL`; launch progress is never monotonic by assumption.
- Add newly discovered launch gaps as new IDs; do not hide them by rewriting acceptance criteria.
- Review this ledger at every release-candidate decision.
