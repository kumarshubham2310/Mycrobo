# Gateway role and capability enforcement

## Trust boundary

The local gateway accepts the workspace role only through `MYCROBO_AUTH_ROLE`,
which the Electron main process derives from the authenticated control-plane
membership before launching the gateway. Tests can provide the equivalent
`authRole` constructor option. HTTP headers, query parameters and JSON bodies
are never consulted for a role.

Bearer-token, per-window capability, loopback, host and origin checks remain the
first request-level authentication boundary. The role/capability decision runs
immediately after it and before a mutation handler can read a body or call a
store, connector, model, media retry or send primitive. The Google OAuth
callback is the one browser callback without the bearer header; it is still
role-gated before its state-bound connector completion can persist anything.

## Role matrix

| Capability | Viewer | Member | Tenant admin | Owner |
| --- | ---: | ---: | ---: | ---: |
| Read chats, media, status, settings and diagnostics | Yes | Yes | Yes | Yes |
| Generate a draft or local translation | No | Yes | Yes | Yes |
| Save preferences, feedback, tasks and decisions | No | Yes | Yes | Yes |
| Retry attachment retrieval and refresh an existing integration | No | Yes | Yes | Yes |
| Stage and execute a manually approved send | No | Yes | Yes | Yes |
| Pair/log out WhatsApp or start connector imports | No | No | Yes | Yes |
| Add/remove tenant-wide context integrations | No | No | Yes | Yes |
| Delete local user state or verified plaintext recovery copies | No | No | No | Yes |

Exact send still requires the separate native send-broker secret and one-use
approval transaction. Role permission does not bypass recipient, latest-message,
placeholder, bridge-readiness or user-confirmation safeguards.

## Deny-by-default behavior

`gateway-authorization.mjs` is the complete state-changing route registry. Any
`POST`, `PUT`, `PATCH` or `DELETE` request not present in that registry returns
`MUTATION_ROUTE_NOT_ALLOWLISTED`, even for an owner. A registered mutation with
no valid trusted launch role returns `TRUSTED_ROLE_REQUIRED`. A valid role
without the route capability returns `ROLE_CAPABILITY_DENIED`.

The registry includes 25 concrete route families, including the state-changing
Google OAuth `GET` callback. Tests exercise all four roles against every route,
prove viewers cannot mutate any of them, prove member/admin boundary denials,
prove renderer role-spoof fields are ignored, and prove future unreviewed
mutations fail closed for every role.

## Remaining release evidence

- A signed packaged build still needs an independent local penetration test of
  the Electron-to-gateway boundary; unit/integration tests are not that review.
- Role changes made in the control plane take effect after the tenant desktop
  session is restarted. Immediate live membership revocation is not yet pushed
  into an already-running gateway process.
- Controlled real-send certification remains intentionally absent. No test in
  this authorization work contacted WhatsApp or sent a message.
- External OAuth threat-model review and a real Google test tenant are still
  required to certify callback/state behavior beyond the local mock boundary.
