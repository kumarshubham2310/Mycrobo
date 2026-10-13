# MyCrobo

MyCrobo is an experimental, privacy-conscious communication copilot that studies conversation context and user-authorized communication patterns to recommend editable replies, identify when no reply is needed, and surface conversation-derived decisions, tasks and follow-ups.

## Current status

The current source snapshot is **`1.0.0-alpha.29`**. It is an internal engineering alpha, not a production-ready or officially supported WhatsApp product.

- Automatic sending is disabled.
- Sending requires a deliberate user action and latest-recipient verification.
- Full WhatsApp lifetime history is not claimed.
- The personal linked-device connector is unofficial and may carry platform/account risk.
- The local tenant and operator foundations are not a hosted production SaaS control plane.
- No API key, linked-device session, message database, private chat history, media cache or model weight belongs in this repository.

See [PRODUCTION_JOURNEY.md](PRODUCTION_JOURNEY.md) for the living prototype-to-production gap ledger.

## Version history

Every complete source snapshot available during repository reconstruction has an annotated Git tag. See [VERSION_HISTORY.md](VERSION_HISTORY.md). Missing version numbers were not invented.

```powershell
git tag --list --sort=version:refname
git switch --detach v1.0.0-alpha.29
```

## Repository safety

Read [PUBLIC_REPOSITORY_POLICY.md](PUBLIC_REPOSITORY_POLICY.md) before contributing. The `.gitignore` intentionally blocks credentials, tenant data, WhatsApp sessions, databases, private diagnostics, model weights, executable packages and generated backups.

Before pushing:

```powershell
npm run verify:public
```

If a real secret is ever committed, revoke or rotate it immediately. Deleting it in a later commit does not remove it from Git history.

## Development verification

The repository uses Node's TypeScript stripping for its JavaScript/TypeScript contract suite. The WhatsApp bridge is a separate Go module.

```powershell
pnpm install
pnpm run bridge:build

pnpm test
pnpm run desktop:start

Push-Location services/whatsapp-bridge
go test ./...
go vet ./...
Pop-Location
```

The bridge executable is a generated local artifact and remains ignored by Git. `pnpm test`, `pnpm run desktop:start`, package verification, release-manifest generation and package synchronization all build it when it is missing or older than the Go source. A clean checkout therefore requires Go 1.26 as declared by `services/whatsapp-bridge/go.mod`, but it does not require downloading an unverified executable.

Optional local translation requires separately licensed/provisioned model weights and compatible Python dependencies. The application must not download or publish those weights through this repository.

## Important boundary

Passing automated tests demonstrates implementation behavior; it does not certify complete message history, real-world personalization, connector authorization, production security, accessibility, delivery, billing or legal readiness. Those claims require the artifact-bound evidence listed in the production journey.
