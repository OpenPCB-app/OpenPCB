# CoreLibrary release trust

`npm run corelib:fetch` is a production integrity gate in every `NODE_ENV`.
It never discovers a latest release. `resources/core-library-release.json`
is the reviewed release policy: repository, minimum component count and one
production pin containing tag, version, exact artifact filename, full archive
SHA-256, signing key ID and canonical SPKI DER SHA-256 fingerprint.

## Current release blocker

The production pin is deliberately `null`: no inspected release qualifies.
The historical `v0.1.0-beta.1` archive has SHA-256
`dd0c1cd4a13128a2db7270722a3f558bdc346ccf4c1f44806b01e2fc7e29f66a`.
Its manifest is unsigned, and its released public key is a retired placeholder.
That hash is rejected evidence, never a production pin or an offline fallback.
The existing committed production key `resources/keys/openpcb-core-2026.pub`
has canonical SPKI DER SHA-256
`290626471afc520df2f222a948a6bf937fee7571fa5412eb86ef72ff663bb0da`.
Do not replace it with the historical release key.

The production key was provisioned separately in
[CoreLibrary commit b0548ccc](https://github.com/OpenPCB-app/CoreLibrary/commit/b0548cccfd965d33a1efc74a595316ffdd219a7e)
and adopted in
[OpenPCB commit 0eb100d9](https://github.com/OpenPCB-app/OpenPCB/commit/0eb100d9a4ded3587202b25254195a5efe62412a).
The released placeholder's canonical SPKI DER SHA-256 is
`c58f527ae94925955e46136b54ccb0eea04b922f95e6955b2eb774b701c31ab1`;
this is a different key, not an LF/CRLF representation mismatch.

A maintainer with access to the CoreLibrary release environment must verify
`secrets.OPCLIB_SIGNING_KEY` matches the existing production public key and
`vars.OPCLIB_KEY_ID` is `openpcb-core-2026`, then publish a **new** signed version.
The source release workflow already requires signing material and verifies both
published packs against its committed public key; that workflow alone does not
qualify the historical unsigned release. Review
the source provenance, actual manifest signature, exact payload and public-key
fingerprint before committing a production pin. Never rewrite the historical
release to conceal its provenance. Then qualify fresh Linux and Mac checkouts;
synthetic signed test packs do not qualify a source release or close H02.

## Verification and rotation

The fetcher requires exactly the pinned archive, `SHA256SUMS` and
`openpcb-core.pub`. It parses exact checksum filename records, refuses duplicate
records, compares the archive with both the checksum file and independent
committed hash, and requires a manifest Ed25519 signature resolved only through
committed `resources/keys/*.pub`. The released key must equal that signing key
in canonical SPKI DER; LF/CRLF PEM representation differences are harmless.
The pinned key ID and fingerprint must also agree. The package reader checks
the manifest digest and referenced symbol, footprint and model payload hashes.
The full archive pin covers every remaining byte, including component files.
Existing ZIP limits remain enforced. Library ID, version and component count
must match policy.

Key rotation requires separately authenticated maintainer/source provenance,
review of the new public fingerprint, and a new signed release and pin in Git.
Fetching a public key from a release never adds trust. Remove a revoked key
from the committed trust store: cached releases using it then fail verification.
Production private signing keys belong only in the authorized release environment, never
in OpenPCB, its fixtures, logs or cache.

## Cache, overrides and development

Successful verification populates `.build/core-library-cache/<archive-sha256>/`
with the pinned archive, checksum file and public key. Every cache read repeats
all verification against current committed policy and keys. A poisoned cache
fails rather than silently redownloading. Remove the poisoned cache explicitly
before retrying. `--offline` and the legacy `OPENPCB_SKIP_CORELIB_FETCH=1`
both require this validated pinned cache; neither skips verification or succeeds
without an artifact. `--tag`, positional tags and `OPENPCB_CORELIB_TAG` may
only repeat the committed tag. Repository and count environment overrides may
only repeat committed policy. There is no downgrade or unsigned override.

Only fully verified bytes are staged beside destinations, then published by
atomic file renames into `.build/core-library/` and `resources/core-library/`.
Verification failure leaves all previous artifacts and checksums intact.
Symlink destinations/cache paths and mismatched existing pinned artifacts are
refused. Older differently named artifacts are removed only after publication.
Atomicity is per file; an operating-system write failure may interrupt a batch.
The next fetch revalidates cache and pinned destinations before success.

`npm run corelib:pack:dev` remains the explicitly separate unsigned development
path. It writes `../CoreLibrary/dist/openpcb-core-library-999.0.0-dev.opclib`.
It does not populate the production cache or production resource directories,
and production fetching never reads that sibling artifact.

Focused regressions: `bun test scripts/core-library`. CI and release builds run
them before the required production fetch gate. Passing synthetic regressions
does not bypass a missing or unqualified upstream release.
