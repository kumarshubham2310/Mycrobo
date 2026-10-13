# MyCrobo WhatsApp Intelligence and API Proposal

Status: implemented architecture addendum and production proposal  
Date: 1 September 2026  
Applies to: MyCrobo Desktop `1.0.0-alpha.12`

## Executive decision

MyCrobo needs two different APIs, for two different jobs:

1. **A reasoning API is useful for high-judgment reply drafting.** It must not be called for sync, search, ordering, sender classification, reply-necessity, simple acknowledgements, or sending. Those operations are local and deterministic.
2. **The official WhatsApp Cloud API is the correct future transport for WhatsApp Business users.** It is not a drop-in replacement for cloning a personal WhatsApp account. The desktop personal connector therefore remains a separate, explicitly unofficial local linked-device connector until an official personal-account interface exists.

The recommended product is a dual-connector system:

| Connector | Intended account | Transport | Product status |
|---|---|---|---|
| Personal Pilot | Personal WhatsApp | Local linked-device session | Private alpha; provider limits and account risk must remain explicit |
| Business Cloud | WhatsApp Business Platform | Official Meta Cloud API and signed webhooks | Production path after Meta onboarding, verification and controlled-send certification |

The model API and WhatsApp transport API must remain independent. A customer can use local drafting with either connector, or model-assisted drafting with either connector after consent.

## What is implemented in this change

### Evidence-gated response selection

Each candidate is evaluated with the architecture formula in operational form:

```text
z_i = persona_i + relationship_i + context_i + channel_i + evidence_i - risk_i

valid_i = audience_i × factuality_i × freshness_i × scope_i

selected = argmax(z_i) only where valid_i = 1
```

The implementation uses:

- Same-person interaction replies as the strongest style evidence.
- Same-person standalone owner messages as secondary evidence.
- The matching one-of-ten relationship profile only when person evidence is weak.
- General owner tone only as the final style fallback.
- Current story and target-message evidence for meaning.
- Explicit language/register matching for English, Roman Hindi and Roman Gujarati.
- Observed reply length, emoji behavior and address forms only when enough evidence exists.
- A hard rejection of credential-like content, foreign evidence, invented numbers, unsupported current time references, stale commitments and generic assistant language.
- A hard rejection of cold generic acknowledgements for affectionate messages.
- No synthetic “tone-match percentage.”

This is a ranking engine, not a trained neural ranker. It is deterministic, auditable and safe for the present release. A learned ranker should be trained only after enough real accepted/edited/discarded outcomes exist and should remain behind the same hard gates.

### Model context minimization

The cloud envelope now keeps:

- The latest 32 story events.
- Older events only when durable questions, commitments or facts cite them.
- At most 48 story events and approximately 12,000 story characters.
- At most 8 same-person interaction pairs.
- At most 8 same-person owner examples.
- At most 6 same-profile examples.
- At most 4 general examples.
- At most 8 open questions, 8 commitments and 12 durable facts.

Secrets are redacted before the request. Chat titles and full account identities are not included. The transmitted input has exactly two top-level domains: `chat` and `characteristics`. Conversation-state objects, coverage, safety metadata, freshness objects, sync details and user-state records remain local. Requests are stateless (`store: false`), do not use tools or grounding, and do not carry a previous-interaction identifier across chats. The output is a strict three-candidate JSON schema with bounded output tokens. Gemini output blocks are assembled before JSON parsing because one structured result may be split across multiple model-output text blocks.

### Cost-aware hybrid routing

#### Credential handling

The desktop build must never compile an API credential into JavaScript, package
resources, a portable executable, settings export or diagnostic record. Alpha.12
loads an optional model credential from a separate encrypted file in Electron's
per-user application-data directory. Electron `safeStorage` delegates protection
to the operating system; on Windows the stored ciphertext is bound to the signed-in
Windows user. The credential is decrypted only at desktop startup and is passed
only to the isolated local gateway process through its restricted environment.

Provisioning reads the credential from standard input so it does not appear in a
command-line argument. Rotation atomically replaces the protected blob. Removal
deletes the provider blob without touching WhatsApp history, conversation state or
learned tone. The credential is excluded from UI status payloads, logs, usage
records, exported settings, crash text and release evidence.

The runtime now follows this sequence:

```text
latest-message verification
        ↓
reply-necessity decision
        ↓
local story / relationship retrieval
        ↓
current-fact and risk gates
        ↓
deterministic intent route
   ┌────┴───────────────┐
   ↓                    ↓
local candidate      one model call
   └────┬───────────────┘
        ↓
same independent candidate evaluator
        ↓
editable draft
```

No model call is made when:

- The owner already typed the intended reply.
- The reply is a deterministic greeting, thanks, acknowledgement, link acknowledgement, departure/arrival acknowledgement, emoji response or simple wish.
- The exact date or time is the only missing input.
- The history is partial and lacks enough bounded current-story or same-person evidence.
- The daily call or monthly cost budget is reached.
- The selected model does not have a reviewed price record.
- The provider is unavailable.

In all of those cases, the private local engine remains available.

### Content-free API accounting

The encrypted user-state vault records only:

- Model name.
- Route (`standard` or `escalated`).
- Input, cached-input and output token counts.
- Estimated micro-USD cost.
- Timestamp.

It never records prompts, message bodies, candidate text or recipient names. Records older than 40 days are removed and the ledger is bounded to 10,000 entries.

Default controls are configurable at deployment:

| Control | Default |
|---|---:|
| Primary quality model | `gemini-3.7-flash` |
| Capacity fallback | `gemini-3.6-flash` after a timeout or 429/5xx only |
| Flagship escalation | Off; 3.7 is already the primary quality route |
| Estimated input cap | 6,000 tokens per call |
| Output-plus-thinking cap | 1,600 tokens per call |
| Daily calls | 300 |
| Monthly model spend | USD 10 |

These are safety defaults, not commercial pricing promises. Vendor prices are kept in a dated, replaceable price snapshot. Unknown-price models fail closed instead of bypassing the cost limit.

## Recommended API operating policy

### Standard route

Use the cost-efficient structured-output model for multilingual interpretation, indirect questions, ambiguous context and relationship-aware rewriting. Use low reasoning for ordinary drafts and medium reasoning for emotional or relational judgment.

### Escalated route

Enable the flagship model only for a small high-judgment set:

- Emotional or relationship-sensitive conversations.
- Conflict, apology, trust or important promises.
- Long stories with multiple unresolved facts.
- Enough same-person evidence to make subtle comparison meaningful.

Escalation should be decided before the first call. Do not call the standard model and then call the flagship model for the same draft unless the first response fails a hard factuality gate; doing both routinely doubles cost and latency.

### Approximate call economics at the 1 September 2026 price snapshot

For a representative successful request containing 3,000 input tokens and 250 output tokens at the 2026 introductory rates:

| Model | No cached input | 2,000 input tokens cached |
|---|---:|---:|
| `gemini-3.7-flash` | about USD 0.00319 | about USD 0.00184 |
| `gemini-3.6-flash` | about USD 0.00319 | about USD 0.00184 |

At 1,000 representative calls, this is approximately USD 3.19 without cached input. Actual billing uses the provider usage response—including Gemini thought tokens—and the dated local price snapshot; these examples are not a vendor quote.

### Implemented Gemini provider decision

The current Google AI Studio credential was validated against Google's model-list endpoint without sending WhatsApp content. A live structured-output smoke test then used synthetic conversation data only. It established three operational facts now reflected in the implementation:

- Gemini 3.7 Flash is the primary quality route, but can temporarily return provider capacity errors.
- Gemini 3.6 Flash accepted the same strict schema and is the one-attempt production fallback for HTTP 429/5xx responses.
- Gemini thinking tokens share the output ceiling, so the Gemini route reserves 1,600 output-plus-thinking tokens rather than truncating the final JSON.

The fallback is not used for invalid credentials, malformed requests, safety failures, history gaps or local budget denial. Those cases remain local or fail closed. Neither provider call can send a WhatsApp message.

### Why not use an API for every message

Per-message calls would be inferior because they would:

- Lose the conversation story unless repeatedly resending it.
- Spend tokens on messages that need no reply.
- Increase privacy exposure.
- Create cost proportional to sync volume rather than user value.
- Add latency to history import.
- Make deterministic sender, chronology and safety problems dependent on probabilistic output.

The correct unit of paid reasoning is a verified draft request, not an ingested message.

## Phone-number device linking repair

### Root cause

WhatsApp phone-code pairing uses the same short-lived login socket as QR pairing. The provider library documents an overall login window of roughly 160 seconds. The old MyCrobo flow could retain that expired socket indefinitely. “Try again” reused it, while the native connection guard remained marked as started. The gateway also attempted to parse a plain-text bridge error as JSON and replaced the actionable error with a generic one.

### Implemented state machine

```text
unpaired
   ↓
preparing
   ↓ provider emits first QR
scan-required ────── request phone code ─────→ phone-code
   │                                             │
   ├──── scan succeeds ─────────────────────────→ paired
   │                                             │
   └──── socket expires/error ───────────────→ expired / retryable-error
                                                   │
                                                   └── fresh socket → scan-required
```

Repairs include:

- A separate pairing-session deadline, rather than treating the visible QR expiry as the whole socket lifetime.
- Automatic fresh-session creation when the remaining socket lifetime is too short for phone linking.
- Serialized pairing and connection operations to prevent duplicate requests.
- Sequence numbers so an expired old QR consumer cannot overwrite a new pairing state.
- Waiting for a provider-emitted first QR before requesting a phone code.
- Phone-code expiry capped by the actual session deadline.
- A dedicated `POST /v1/link/restart` recovery path.
- A visible recovery screen for expired, retryable and update-required states.
- Safe error categories: timeout, rate limit, network, provider rejection and client outdated.
- Preservation of local chat history across every pairing retry.
- No phone number or pairing code in settings, chat history or diagnostics.
- Plain-text native errors are safely preserved by the gateway instead of being discarded.

### Phone-link edge cases

| Edge case | Required behavior | Coverage |
|---|---|---|
| Missing or malformed number | Reject before provider call | Automated |
| National leading zero | Explain international format | Automated |
| Letters, extension syntax or Unicode lookalike digits | Reject | Automated |
| More than 15 or fewer than 7 digits | Reject | Automated |
| Already-linked local device | Refuse a second pairing | Implemented |
| Request arrives before first provider QR | Wait for ready state or fail safely | Implemented |
| QR/socket has little lifetime remaining | Replace socket before requesting code | Implemented |
| Old QR consumer completes after restart | Ignore through sequence guard | Implemented |
| Duplicate clicks | Serialize requests; UI disables the button | Implemented |
| Code expires while displayed | Offer a fresh connection and new code | Implemented/UI automated |
| Provider rate limit | Show a wait-and-retry message | Automated classification |
| Network interruption | Show retryable network state | Automated classification |
| Connector protocol outdated | Block retry and require update | Automated classification |
| User switches from phone code to QR | Use a live QR or restart the session | Implemented |
| User switches numbers | Replace pending phone cache with a fresh request | Implemented |
| App restarts before phone confirmation | New process starts a new unpaired session | Implemented |
| Phone confirms after local expiry | Trust only provider pairing success; refresh state | Implemented |
| Provider returns malformed code | Refuse to display it | Existing automated UI coverage |
| Full number leaks to response/log | Return only the last four digits; content-free logs | Automated |

### Remaining live certification gate

Automated tests can prove validation, state transitions, error handling and absence of sending. They cannot prove that WhatsApp accepted a real account on a real phone. Before calling this production-ready, run a controlled live matrix with dedicated test accounts on current Android and iOS versions:

1. Fresh code and successful link.
2. Delayed entry near expiry.
3. Wrong code and recovery.
4. Network loss on desktop and phone.
5. Provider rate limit.
6. Logout and relink.
7. App restart during pairing.
8. QR-to-phone and phone-to-QR switching.
9. Existing maximum linked-device count.
10. WhatsApp client update incompatibility.

No chat message is needed for this pairing certification.

## Official WhatsApp Business API proposal

Build the Business Cloud connector as a separate service with:

- Meta Embedded Signup.
- A tenant-bound WhatsApp Business Account and phone-number identity.
- Signed webhook verification before ingestion.
- Immutable inbound and status events.
- The same identity graph, conversation state, reply-necessity, retrieval and candidate evaluator used by Personal Pilot.
- A transport-specific send gateway with exact recipient, body, revision, idempotency and approval.
- Template and customer-service-window policy enforcement where applicable.
- Tenant-isolated secrets in a production KMS, never the desktop vault.
- Delivery/read/failure state reconciliation from webhooks.
- Rate limiting, retry queues and dead-letter handling that never reinterpret a failed send as delivered.

Do not make the Business Cloud connector pretend to import a complete personal WhatsApp history. Its coverage receipt must begin at the earliest provider event actually available and state that limit.

## Release gates

The implementation is suitable for the next internal build only after all automated Node and Go suites pass, UI pairing recovery is visually verified, the clean desktop package is rebuilt from the canonical source, and package parity is proven. Public production release still requires:

- Controlled live phone-link certification.
- A real API key configured through the operating-system-protected secret path.
- Model quality evaluation on consented representative data.
- Meta approval for the official Business connector.
- Independent security, privacy, accessibility and legal review.
- Signed desktop binaries and verified update rollback.
- Production billing alerts and tenant-level cost enforcement.

## Source contracts reviewed

- Google Gemini API keys, Interactions API, structured outputs, current models and pricing: `https://ai.google.dev/gemini-api/docs/`
- Official Meta WhatsApp Business Platform collection: `https://www.postman.com/meta/whatsapp-business-platform/overview`
- WhatsApp Business terms and coexistence status: `https://faq.whatsapp.com/1017485114093363`
- Current pinned linked-device provider contract: local `go.mau.fi/whatsmeow` source, revision `33cfac511629`, especially `pair-code.go` and `qrchan.go`
