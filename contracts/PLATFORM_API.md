# MyCrobo platform API contract 1

**Contract version:** `mycrobo-platform.1`  
**Status:** shared contract foundation; hosted authentication and mobile clients
remain unimplemented.

Desktop, web, iOS and Android clients must implement this contract rather than
recreating conversation truth or send policy on-device.

## Request context

Every non-public request carries:

- a unique request ID;
- the negotiated contract version;
- an authenticated user, tenant and device principal;
- a short-lived access token with an operation-specific scope; and
- an idempotency key for sync mutations and send commits.

Provider JIDs are never client-facing resource identifiers. Clients use opaque
MyCrobo IDs. A service rejects missing tenant/device context, expired tokens and
missing scopes before reading data.

## Capabilities

Clients negotiate capabilities at session start. Contract 1 declares:

| Capability | Supported |
|---|---:|
| Cursor pagination | Yes |
| Separate archived collection | Yes |
| Story provenance | Yes |
| Media reasoning metadata | Yes |
| Exact-approval send | Yes |
| Reconciliation after resume | Yes |
| Offline send | **No** |

An incompatible version or missing required capability returns
`CLIENT_UPGRADE_REQUIRED`. A client may not silently downgrade safety.

## Pagination

Conversation and event list endpoints use a server-signed opaque cursor. The
cursor is bound to:

- tenant;
- active or archived collection;
- snapshot revision; and
- next offset/key.

The maximum page size is 100. A cursor cannot be reused for another tenant,
collection or snapshot. The client reconciles against a newer snapshot after
resume rather than merging provider-order guesses.

## Draft revisions

Every draft has an integer revision. `PATCH` supplies the expected revision.
If another device changed the draft, the service returns
`DRAFT_REVISION_CONFLICT`, preserves both states and asks the user to review the
newest draft. Last-write-wins is prohibited for message text.

## Offline behavior

- Reading an encrypted local cache is allowed and visibly marked stale.
- Draft analysis may be queued if it has no outbound side effect.
- Approval/send is blocked offline.
- Reconnect never executes an old send intent.
- The user must reconfirm recipient, edited body, attachments and latest target
  online before an approval token can be minted.

## Structured errors

Errors have a stable code plus:

```json
{
  "retryable": false,
  "userAction": "review-latest-draft",
  "preservedState": true,
  "correlationId": "request-mobile-001"
}
```

Error text is explanatory only. Client behavior is driven by the stable code.

## Observability

Telemetry uses allowlisted metric names, numeric values, machine-readable
low-cardinality labels and correlation IDs. It cannot contain message/draft
text, participant identifiers, phone numbers, provider JIDs, URLs, filenames or
media-derived text.

## Send invariant

All clients share the same server-side latest checkpoint, exact-recipient/body
fingerprint, one-use approval and idempotency gateway. No mobile notification,
background task, sync completion, retry queue or reconnect can become approval.

Executable reference and contract tests are in `contracts/production.mjs` and
`contracts/production.test.mjs`.
