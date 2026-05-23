# resources/core-library/

This directory is **populated at build time**. Binaries are intentionally **never** committed to git (see `OpenPCB/.gitignore` — `*.opclib` and `SHA256SUMS` are ignored).

## What lives here at runtime

- `openpcb-core-library-<version>.opclib` — the active CoreLibrary archive
- `SHA256SUMS` — integrity manifest matching the release

## How it gets here

Two paths, both write to this directory:

| Context  | Command / step                                                     | Source                                                                                            |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Local    | `npm run corelib:fetch` (invoked automatically by `npm run build`) | `scripts/fetch-core-library.ts` → `gh release download` from `OpenPCB-app/CoreLibrary`            |
| CI / tag | `.github/workflows/release.yml` "Fetch CoreLibrary release" step   | Same script, same source, but writes to `.build/core-library/` first; electron-builder reads that |

Both paths run identical verification: SHA-256 vs `SHA256SUMS`, Ed25519 signature vs `OpenPCB/resources/keys/openpcb-core.pub`, manifest `library.id === "openpcb.core"`, components count ≥ 10.

## Why we don't commit the `.opclib`

History showed it goes stale — a 2-component stub sat here for months before being noticed. Build-time fetch guarantees:

- Every release ships against the current canonical library.
- No silent fallback to a stale artifact when CI hiccups.
- The release-workflow record (which CoreLibrary tag was bundled) is auditable in the workflow run logs and the release notes.

## Local dev convenience

If you want to iterate against a sibling `../CoreLibrary` checkout instead of the published release, use `npm run dev:corelib` — it packs the sibling repo into `999.0.0-dev.opclib` and the locator prefers it during `NODE_ENV !== "production"`.
