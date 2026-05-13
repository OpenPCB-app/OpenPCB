# OpenPCB macOS Beta Install

This is an unsigned/ad-hoc-signed beta build for trusted testers.

macOS may warn that the developer cannot be verified. This build is not Developer ID signed and is not notarized.

## Open the app

1. Move `OpenPCB (Electron).app` to `Applications`.
2. Right-click the app.
3. Click `Open`.
4. Confirm `Open` again.

If macOS still blocks it, open `System Settings` → `Privacy & Security` → `Open Anyway`.

Technical testers can also remove quarantine:

```bash
xattr -dr com.apple.quarantine "/Applications/OpenPCB (Electron).app"
open "/Applications/OpenPCB (Electron).app"
```

## Verify download checksum

```bash
shasum -a 256 OpenPCB-0.1.0-mac-arm64.zip
shasum -a 256 OpenPCB-0.1.0-mac-arm64.dmg
```

Compare the output with `SHA256SUMS.txt` from the release.
