# Public repository data policy

This repository contains sanitized MyCrobo source snapshots. It intentionally excludes real WhatsApp messages, contact identifiers, media, linked-device sessions, tenant databases, local credentials, API keys, model weights, executable packages and machine-specific diagnostics.

## Never commit

- `.env` files or provider credentials.
- OAuth secrets, access tokens, refresh tokens, private keys or signing material.
- WhatsApp linked-device databases, session state or account bindings.
- Message, workspace, tenant, control-plane or media-cache databases.
- Real chat exports, screenshots, attachments, backtest cases or diagnostics derived from private conversations.
- Local model weights or licensed model files.
- Packaged Electron applications, native binaries or backup application trees.

Use synthetic fixtures with fictitious identities. Before every push, review the staged diff and run the repository's public-snapshot verification command when present.

If a secret is committed, removing it in a later commit is insufficient. Revoke or rotate it immediately and purge it from Git history before publishing again.
