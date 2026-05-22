# Release smoke — cross-OS install + deep-link

Per-platform install + `openpcb://` protocol verification for unsigned builds.
Run after every `gh workflow run release.yml` to confirm artifacts work on a
fresh user account.

## Trigger a build

```bash
gh workflow run release.yml -f artifact_suffix=smoke
gh run watch  # or open Actions tab
```

When the matrix completes, download artifacts from the run page (or `gh run
download <run-id>`). Expect six artifacts: `openpcb-mac-arm64`,
`openpcb-mac-x64`, `openpcb-win-x64`, `openpcb-linux-x64-AppImage`,
`openpcb-linux-x64-deb`, `openpcb-linux-x64-rpm`.

## macOS arm64 (.dmg)

1. Double-click the `.dmg`, drag to Applications
2. First launch: Gatekeeper will block. Either:
   - `xattr -d com.apple.quarantine /Applications/OpenPCB.app`
   - or right-click → Open → confirm
3. App launches → home screen visible
4. Open a fresh terminal: `open 'openpcb://invite?token=smoke'`
5. **Expected**: OpenPCB foregrounds and the Accept Invite modal opens

Screenshot to `docs/release-screencaps/mac-arm64-deeplink.png`.

## Linux (AppImage)

1. `chmod +x ./OpenPCB-*.AppImage && ./OpenPCB-*.AppImage`
2. First run registers `x-scheme-handler/openpcb` automatically
3. From another terminal: `xdg-open 'openpcb://invite?token=smoke'`
4. **Expected**: Accept Invite modal opens in the running OpenPCB

If MimeType handler doesn't stick after a reboot, install the `.deb` or
`.rpm` instead — those use the system `.desktop` registration.

Screenshot to `docs/release-screencaps/linux-deeplink.png`.

## Windows (NSIS .exe)

1. Run installer → Next → Install
2. SmartScreen will warn (unsigned). Click "More info" → "Run anyway"
3. App launches → home screen visible
4. From `cmd` (not PowerShell, which mangles `://`):
   ```cmd
   start "" "openpcb://invite?token=smoke"
   ```
5. **Expected**: Accept Invite modal opens

Screenshot to `docs/release-screencaps/windows-deeplink.png`.

## Pass criteria

- All three platforms install + launch
- Deep-link wakes the running app + opens the Accept Invite modal on each
- No crash reports from `~/Library/Logs/DiagnosticReports/` (mac),
  `~/.config/OpenPCB/logs/` (linux), `%APPDATA%\OpenPCB\logs\` (windows)

## Known issues

- **macOS Gatekeeper** keeps re-quarantining on each download. The `xattr`
  step is required until we sign + notarize (Phase D).
- **Windows portable .exe** does not register the protocol globally —
  prefer the NSIS installer for smoke runs.
- **Linux AppImage** integration is desktop-environment-dependent. GNOME
  and KDE both work; tested as of 2026-05-22.
