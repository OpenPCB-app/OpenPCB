# v0.1.0-beta.0 Release Dry-Run Checklist

Operational steps to validate the release pipeline end-to-end before publishing `v0.1.0-beta.0` as the first public beta. Do these in order; each step gates the next.

## 0. Pre-flight (local, no pushes)

- [x] `OpenPCB/package.json` version = `0.1.0-beta.0`
- [x] `OpenPCB/electron/package.json` version = `0.1.0-beta.0` (CI verifies match)
- [x] `OpenPCB/src/core/backend/package.json` version = `0.1.0-beta.0`
- [x] `OpenPCB/src/core/frontend/package.json` version = `0.1.0-beta.0`
- [x] `CoreLibrary/package.json` version = `0.1.0-beta.0`
- [x] `OpenPCB/LICENSE` is AGPL-3.0 + `LICENSE-COMMERCIAL.md` exists
- [x] `shared/LICENSE` + each `shared/packages/*/LICENSE` is AGPL-3.0
- [x] `cd OpenPCB && npm run typecheck && npm run gen:check` ✅
- [x] `cd OpenPCB && npm run test:react` ✅ (161 / 161)
- [ ] `cd OpenPCB && npm run test:backend` — known pre-existing flake in `library-opclib-importer-idempotent-reimport.test.ts`; investigate or quarantine before tagging
- [x] `cd CoreLibrary && bun validate --release --strict && bun test && bun pack --version 0.1.0-beta.0` ✅
- [x] `cd shared && npm run typecheck && npm run test && npm run build` ✅
- [x] `gitleaks detect --no-banner --redact` clean across all three public repos

## 1. Commit + push P0 work to `main` on all three public repos

```bash
# OpenPCB
cd OpenPCB
git checkout -b chore/v0.1.0-beta-prep
git add -A   # review with `git diff --cached --stat` before staging
git commit -m "chore(release): v0.1.0-beta.0 prep — license, CI, docs, privacy"
git push -u origin chore/v0.1.0-beta-prep
gh pr create --title "v0.1.0-beta.0 release prep" --body-file .github/RELEASE_TEMPLATE.md

# CoreLibrary (similar)
# shared (similar)
```

PRs must pass the new `ci.yml` workflow. Branch protection should require this.

## 2. Tag CoreLibrary first (OpenPCB downloads its release asset)

```bash
cd CoreLibrary
git checkout master
git pull
git tag -a core-library-v0.1.0-beta.0 -m "OpenPCB Core Library 0.1.0-beta.0"
git push origin core-library-v0.1.0-beta.0
```

Watch `OpenPCB-app/CoreLibrary` Actions tab — `release.yml` should:

1. Validate strict, sign with `OPCLIB_SIGNING_KEY` secret if present.
2. Pack `openpcb-core-library-0.1.0-beta.0.opclib`.
3. Create GitHub release with `.opclib`, `SHA256SUMS`, `openpcb-core.pub`.

If signing fails: investigate `OPCLIB_SIGNING_KEY` + `OPCLIB_KEY_ID` repo secrets/vars.

## 3. Tag OpenPCB v0.1.0-beta.0

```bash
cd OpenPCB
git checkout main   # or master, after the prep PR merges
git pull
git tag -a v0.1.0-beta.0 -m "OpenPCB v0.1.0-beta.0 — first public beta"
git push origin v0.1.0-beta.0
```

`OpenPCB-app/OpenPCB` Actions → `release.yml` should:

1. Download latest CoreLibrary `.opclib` from step 2.
2. Validate manifest (`library.id === "openpcb.core"`).
3. Build frontend + Electron, package via electron-builder for 4 targets.
4. Merge multi-arch mac update feeds.
5. Publish GitHub prerelease with mac dmg/zip, win Setup.exe + portable, linux AppImage/deb/rpm, `latest*.yml`.

## 4. Manual installer smoke tests

For each artifact, on a fresh user account or clean VM if possible:

### macOS arm64 (Apple Silicon)

- [ ] Download `OpenPCB-0.1.0-beta.0-arm64.dmg`
- [ ] Open dmg → drag to Applications → first launch shows Gatekeeper warning
- [ ] Right-click → Open → confirm
- [ ] **Golden path**: New project → place R + C + LED on schematic → wire → switch to PCB → route 1 trace → export Gerber ZIP → open in `gerbv` or KiCad's Gerber viewer
- [ ] Quit + relaunch → state persists

### macOS x64 (Intel)

- [ ] Same checks with `-x64.dmg`

### Windows x64

- [ ] Download `OpenPCB-Setup-0.1.0-beta.0.exe`
- [ ] Run → SmartScreen warns → "More info → Run anyway"
- [ ] Golden path (same as macOS)
- [ ] Try the portable variant if produced

### Linux x64 (Ubuntu 22.04 or similar)

- [ ] AppImage: `chmod +x OpenPCB-0.1.0-beta.0.AppImage && ./OpenPCB-0.1.0-beta.0.AppImage`
- [ ] `.deb`: `sudo apt install ./openpcb_0.1.0-beta.0_amd64.deb`
- [ ] `.rpm` (on Fedora/RHEL if available)
- [ ] Golden path on whichever Linux flavor is convenient

### What "Golden path" really means

Open at minimum: schematic editor, PCB editor, Library palette, Gerber export dialog. Confirm:

- 3D model previews render in Library (STEP → GLB worker runs on import)
- Live DRC marks a deliberate clearance violation when traces are too close
- Gerber ZIP unpacks to 8+ files including `.gbr`, `.drl`, `*-BOM.csv`, `*-PnP.csv`
- Sentry opt-in toggle in Settings → Privacy starts unchecked; toggling it writes `preferences.json` in user data dir; restart-required notice shows

## 5. Publish

If smoke tests pass:

```bash
cd OpenPCB
# release.yml already created a GitHub *prerelease* — promote to release in the UI if appropriate,
# or just leave it as prerelease for v0.1.x-beta.

# Update landing page download links if needed (Cloud/infra/landing/index.html already points to
# /releases/latest so should auto-resolve).
```

Edit the release notes using `.github/RELEASE_TEMPLATE.md` as a starting point.

## 6. Post-release

- [ ] Watch `OpenPCB-app/OpenPCB/issues` for first-day feedback.
- [ ] Triage with `beta-blocker` / `beta-rough-edge` labels.
- [ ] If a blocker surfaces: cut `v0.1.0-beta.1` quickly.

## 7. If anything goes wrong

- **CoreLibrary signing key absent in CI** → re-run after secret added; old .opclib download from a fresh release.
- **OpenPCB release.yml times out on Windows** → matrix is `fail-fast: false`; partial release artifacts still get uploaded; rerun only the failed job from Actions UI.
- **Stale `resources/core-library/openpcb-core-library-1.0.0.opclib`** in OpenPCB tree is intentional for dev — production builds fetch the released version via `corelib:fetch`. Update this bundled file later (low priority, not v0.1.0 blocker).

## Open follow-ups (not v0.1.0 blockers)

- Backend test flake: `library-opclib-importer-idempotent-reimport.test.ts:120` `result.reimport` is `false` when expected `true`. Pre-existing on `master`; investigate root cause or `.skip` with TODO comment before v0.1.0 stable.
- macOS notarization + Windows EV signing (Phase D).
- electron-updater live feed (depends on signing).
- GLB backfill in CoreLibrary (v0.1.1 — see ROADMAP).
- Screenshots + 30s demo GIF for landing page hero (week 3 task per plan).
