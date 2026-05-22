# OpenPCB v0.1.0-beta.N

> Public beta. Unsigned binaries — expect Gatekeeper / SmartScreen warnings on first launch (steps below). Not yet recommended for production designs.

## Highlights

- _List shipped features and notable fixes since the previous tag._

## Install

### macOS (Apple Silicon / Intel)

1. Download `OpenPCB-<version>-arm64.dmg` (Apple Silicon) or `OpenPCB-<version>-x64.dmg` (Intel).
2. Open the `.dmg`, drag OpenPCB into Applications.
3. First launch: right-click OpenPCB.app → **Open** → **Open** in the Gatekeeper dialog (because the build is unsigned during beta).

### Windows

1. Download `OpenPCB-Setup-<version>.exe`.
2. SmartScreen will warn — click **More info** → **Run anyway**.
3. Follow the installer prompts.

### Linux

- AppImage: `chmod +x OpenPCB-<version>.AppImage && ./OpenPCB-<version>.AppImage`
- `.deb`: `sudo apt install ./openpcb_<version>_amd64.deb`
- `.rpm`: `sudo rpm -i openpcb-<version>.x86_64.rpm`

## Scope of this beta

- Schematic capture and 2-layer PCB layout are the supported design path.
- Manufacturing export (Gerber X2 + Excellon + BOM + PnP, single ZIP) is validated for fab houses that accept those formats.
- 4-layer boards, differential pairs, copper zones, segment-drag editing, autorouting — **not in this release**.
- Assistant module ships disabled in production builds.
- Cloud sync is not available; OpenPCB runs fully offline.

## Known issues

- Binaries are unsigned. macOS Gatekeeper and Windows SmartScreen will warn.
- electron-updater is wired but the update feed is not live yet; install new versions manually.
- See [open issues with the `beta-blocker` label](https://github.com/OpenPCB-app/OpenPCB/issues?q=is%3Aopen+label%3Abeta-blocker) for current rough edges.

## Feedback

Open issues at <https://github.com/OpenPCB-app/OpenPCB/issues>. Security reports: see [SECURITY.md](https://github.com/OpenPCB-app/OpenPCB/blob/main/SECURITY.md).

## License

Dual-licensed: AGPL-3.0-or-later for community use, commercial license available at licensing@openpcb.app.
