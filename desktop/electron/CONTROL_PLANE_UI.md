# Desktop renderer capability contract

The desktop uses two mutually exclusive context-isolated preload bridges. Neither renderer receives a database handle, password digest, bearer token, chat-store handle or unrestricted IPC primitive.

## Customer product

- `authStatus()` returns `{ authenticated, bootstrapRequired, user, tenant }` using public user/workspace fields only.
- `bootstrapOwner({ displayName, email, password, tenantName })` is available only while the empty control plane is in first-run bootstrap state.
- `signIn({ email, password })` and `signOut()` establish or revoke the device session in the Electron main process.
- Product-only methods cover exact reviewed sending, approved external connection pages, workspace selection and WhatsApp relinking.
- `openPlatformAdmin()` is only a launcher. The main process re-authorizes a platform administrator and starts a distinct `--platform-admin` process.
- No tenant-user, plan, coupon, subscription or platform-dashboard IPC channel is exposed or registered in the product process.

## Platform console

- `platform-admin-preload.cjs` exposes only the account bootstrap/sign-in boundary and the commercial operations used by `platform-admin.html`.
- No chat, media, drafting, WhatsApp, connector, workspace-switching or send capability is exposed or registered in the platform-console process.
- Every commercial handler requires the dedicated platform process, the exact platform-console main frame and a current platform-administrator session.
- Unused administration methods are not exposed merely because the control-plane class supports them.

The customer product still exposes `tenants()`, `addTenant()` and `switchTenant(id)` for its isolated workspace picker. Every IPC handler re-authorizes from the main-process session; renderer visibility is defense in depth, not the authorization boundary.
