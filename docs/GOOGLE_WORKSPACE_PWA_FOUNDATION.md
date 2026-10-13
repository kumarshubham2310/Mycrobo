# PWA and Google Workspace foundation

## Delivered boundary

The existing MyCrobo client is the installable application. `manifest.webmanifest`, the service-worker registration, and the offline shell extend that client; they do not create a replacement frontend. Chromium receives explicit 192 px and 512 px PNG icons derived from the existing MyCrobo application icon.

The service worker stores only an explicit list of static shell files. It never caches `/api/`, `/oauth/`, `/media/`, messages, attachments, provider responses, or dynamically discovered requests. When offline, navigation can reopen the static shell, while private data still requires the authoritative local gateway.

The Google integration now has both a strict contract layer and an active local runtime. `google-workspace-contracts.mjs` defines:

- authorization-code flow with PKCE and one-time state bound to an exact tenant and user;
- only `gmail.readonly` and `calendar.readonly` scopes;
- a required non-exportable, encrypted-at-rest token vault scoped by tenant, user and provider;
- Gmail `historyId` and Calendar state contracts for future incremental synchronization;
- an ordered disconnect plan that stops watches, revokes access, deletes vault credentials, clears pending OAuth and sync state, and removes derived Gmail/Calendar data.

`google-context-connector.mjs`, the private gateway, and the Electron broker implement the current closed-pilot path:

- a tenant/user-bound encrypted AES-256-GCM vault under the protected workspace;
- one-time encrypted PKCE state that survives a local runtime restart;
- a private loopback OAuth callback route and an allowlisted external Google authorization-page launcher;
- authorization-code exchange, access-token refresh, and provider revocation;
- at most 25 recent Gmail message identifiers listed to derive a content-free count, with only bounded counts and opaque sync digests retained—never senders, recipients, subjects, snippets or message bodies;
- Calendar reads reduced to availability blocks rather than event titles or descriptions;
- a bounded local refresh cadence and explicit user-triggered refresh;
- disconnect that retains encrypted local state until Google confirms revocation, then removes tokens and derived context.

The current runtime intentionally has no public webhook receiver, Gmail Pub/Sub consumer, or Calendar watch channel. It uses bounded foreground/background polling. Those incremental push components remain future work and must not be represented as implemented.

## Configuration and login prerequisites

Before a production login or sync is enabled, provide all of the following outside source control:

1. A Google Cloud project with Gmail API and Google Calendar API enabled.
2. An OAuth consent screen in testing mode, the named pilot users, and a Desktop/public OAuth client ID. A client secret is not used by this PKCE desktop flow.
3. Exact authorized callback URIs using HTTPS or the private loopback gateway callback.
4. The tenant/user-bound local vault key already provided by the protected desktop workspace.
5. A review of Google verification/test-user limits and the intended retention policy before admitting pilot users.
6. Incremental Gmail Pub/Sub and Calendar watch infrastructure only if the pilot later replaces the current bounded polling model.

Automated tests use injected transports and do not contact Google. A live login, token refresh, bounded Gmail/Calendar read, provider revocation, quota response, and reconnect still require an authorized Google Cloud pilot configuration and must be verified before a launch claim.
