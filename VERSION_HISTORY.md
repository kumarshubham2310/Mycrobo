# Version history

This repository preserves the complete source snapshots that were available during reconstruction. Each row is an annotated Git tag. Snapshots are sanitized: packaged executables, credentials, tenant/message/session databases, private media, machine-specific diagnostics, model weights and backup trees are intentionally excluded.

| Tag | Snapshot type |
|---|---|
| `v1.0.0-alpha.3` | Complete available source snapshot |
| `v1.0.0-alpha.4` | Complete available source snapshot |
| `v1.0.0-alpha.5` | Complete pre-repair source snapshot |
| `v1.0.0-alpha.5-repair.1` | Reconstructed complete snapshot from the final tree and ordered pre-change backup |
| `v1.0.0-alpha.5-repair.2` | Reconstructed complete snapshot from the final tree and ordered pre-change backups |
| `v1.0.0-alpha.5-repair.3` | Reconstructed complete snapshot from the final tree and ordered pre-change backups |
| `v1.0.0-alpha.5-repair.4` | Reconstructed complete snapshot from the final tree and ordered pre-change backups |
| `v1.0.0-alpha.5-repair.5` | Reconstructed complete snapshot from the final tree and ordered pre-change backups |
| `v1.0.0-alpha.5-repair.6` | Reconstructed complete snapshot from the final tree and ordered pre-change backups |
| `v1.0.0-alpha.5-repair.7` | Reconstructed complete snapshot from the final tree and ordered pre-change backups |
| `v1.0.0-alpha.5-repair.8` | Reconstructed complete snapshot from the final tree and ordered pre-change backup |
| `v1.0.0-alpha.5-repair.9` | Complete available final repair source snapshot |
| `v1.0.0-alpha.6` | Complete available source snapshot |
| `v1.0.0-alpha.7` | Complete available source snapshot |
| `v1.0.0-alpha.8` | Complete available source snapshot |
| `v1.0.0-alpha.12` | Complete available source snapshot |
| `v1.0.0-alpha.13` | Complete available source snapshot |
| `v1.0.0-alpha.14` | Complete available source snapshot |
| `v1.0.0-alpha.19` | Complete available source snapshot |
| `v1.0.0-alpha.23` | Complete available source snapshot |
| `v1.0.0-alpha.24` | Complete available source snapshot |
| `v1.0.0-alpha.25` | Complete available source snapshot |
| `v1.0.0-alpha.26` | Complete available source snapshot |
| `v1.0.0-alpha.27` | Complete available source snapshot |
| `v1.0.0-alpha.28` | Complete available source snapshot |
| `v1.0.0-alpha.29` | Current sanitized source snapshot on `main` |

No complete source snapshots were found for alpha.1, alpha.2, alpha.9–alpha.11, alpha.15–alpha.18 or alpha.20–alpha.22. Those tags are deliberately absent. A package-folder name is not treated as a software version; the version declared by the source `package.json` controls.

## Tag verification

```powershell
git tag --list --sort=version:refname
git show --no-patch --decorate v1.0.0-alpha.29
```

