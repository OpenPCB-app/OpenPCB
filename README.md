<div align="center">
  <img src="electron/icon.png" alt="OpenPCB" width="120" />
  <h1>OpenPCB</h1>
  <p><strong>Modular, open desktop PCB design suite — schematic capture, PCB layout, design rule checking, manufacturing output and a unified component library in one app.</strong></p>

  <p>
    <a href="https://github.com/OpenPCB-app/OpenPCB/releases/latest"><img alt="latest release" src="https://img.shields.io/github/v/release/OpenPCB-app/OpenPCB?include_prereleases&label=release" /></a>
    <img alt="license" src="https://img.shields.io/badge/license-AGPL--3.0--or--later-blue" />
    <img alt="platforms" src="https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" />
  </p>
</div>

---

OpenPCB takes a board from idea to fabrication in one workspace: draw the schematic, lay out the
PCB, check it against real manufacturing rules, and export the files your fab house asks for. No
separate tools for capture, layout and library management, no account, no cloud service in the
loop — it runs on your machine and your designs stay there.

It is free and open source, dual-licensed AGPL-3.0-or-later and commercially.

> **Status: public beta.** The schematic editor, the component library and the
> manufacturing export path are usable for real boards. PCB layout and DRC are shipped and actively
> hardening. Expect rough edges, and read the [known issues](#known-issues-on-first-launch) before
> your first launch.

## Download

Grab the latest build from [**Releases**](https://github.com/OpenPCB-app/OpenPCB/releases/latest).

| Platform | File                          | Notes                                    |
| -------- | ----------------------------- | ---------------------------------------- |
| macOS    | `.dmg` / `.zip` (arm64 + x64) | Unsigned — see the install guide          |
| Windows  | `Setup.exe` (NSIS installer)  | Unsigned — SmartScreen warns on first run |
| Linux    | `.AppImage` / `.deb` / `.rpm` | AppImage needs `chmod +x`                 |

Every release attaches `SHA256SUMS.txt`. Verify your download before running it:

```bash
shasum -a 256 -c SHA256SUMS.txt --ignore-missing
```

Beta builds are **not code-signed**, so macOS Gatekeeper and Windows SmartScreen will both object
the first time. [`electron/README-BETA-INSTALL.md`](electron/README-BETA-INSTALL.md) has the
per-platform steps, including checksum verification.

## What it does

**Schematic capture.** Place symbols, route wires on a Manhattan grid, add net labels and
junctions. Nets are extracted from geometry rather than hand-maintained, ERC runs over the result,
and everything is undoable — every edit goes through a command with an inverse patch, so undo and
redo survive an app restart.

**PCB layout.** Route traces in Manhattan and 45° modes with live snapping, place vias with a
layer switch, see an MST ratsnest of what is still unconnected, and draw a board outline —
including custom board shapes with dimensioned sketching. Placements sync automatically from the
schematic, so the layout always reflects the current netlist. Length tuning, bundle routing and
walkaround are present but still behind development flags while they finish manual QA.

**Design rule checking.** The route tool checks every trace and via you draw with the same DRC
kernel the batch check runs (clearance, shorts, holes, board edge, keepouts and the item
minimums), refuses an illegal commit with the reason, and the batch check covers the rest, with fabricator
profiles, net-class-aware clearance resolution, IPC-2221B-derived electrical checks, signal
integrity checks for differential pairs, length matching, and stable violation identities so a
waiver you grant stays granted. Violations carry the geometry that produced them, not just a
message.

**Manufacturing export.** Gerber X2, Excellon drill, bill of materials and pick-and-place, bundled
into a single ZIP ready to upload. Silkscreen text is rasterized into the Gerber output rather than
dropped, and the export path handles 2- and 4-layer stackups.

**Component library.** A bundled library of more than two hundred parts ships with the app —
symbols, footprints and 3D models, signed and integrity-checked at build time. You can add your
own: import KiCad `.kicad_sym` and `.kicad_mod` files, generate footprints from IPC-7351B presets,
draw them by hand in the built-in editors, or upload STEP models that are converted to GLB for the
3D board preview. Parts carry the metadata you actually need downstream — subcategory, datasheet
links, keywords and manufacturer part numbers.

**Documentation alongside your designs.** The Knowledge module keeps project notes, datasheets and
reference material in the same app as the board: a page tree with a rich-text editor, PDFs stored
as pages, and text or markdown import.

**AI assistant.** Optional, and pointed at whichever provider you choose — OpenAI, or a local
Ollama or LM Studio endpoint. It can read your design and it can change it: non-destructive edits
apply directly, while destructive ones are held for your explicit approval. It is off until you
configure a provider, and no design data leaves your machine unless you point it at a hosted model.

**A fast canvas.** One React Three Fiber renderer is shared by every editor, with demand rendering
and integer-nanometre geometry throughout — pan and zoom stay smooth on large boards, and the same
coordinates that draw the screen drive DRC and export.

**Cross-platform desktop.** macOS (arm64 and x64), Windows x64, Linux x64. Auto-update is live on
Windows and Linux.

## Known issues on first launch

- **Builds are unsigned.** macOS reports that the developer cannot be verified; Windows SmartScreen
  shows a blue warning. Both are expected for this beta and both have a documented workaround in
  the [install guide](electron/README-BETA-INSTALL.md). Verify `SHA256SUMS.txt` — that is the real
  integrity check while signing is deferred.
- **macOS does not auto-update.** Squirrel.Mac rejects an ad-hoc signature, so the app falls back
  to a notify-only check that links to the latest release. Windows and Linux update in place.
- **The Linux AppImage needs `chmod +x`** before it will run, and its desktop and protocol
  integration depends on your desktop environment. The `.deb` and `.rpm` packages use the system
  registration and are more reliable there.
- **The board panel still shows a fixed "2-layer" label.** The export path handles 4-layer boards
  and the underlying model goes further, but the layer-count picker is not built yet.

## License

OpenPCB is dual-licensed:

- **AGPL-3.0-or-later** for community and open-source use. See [`LICENSE`](LICENSE) for the full
  text.
- **A commercial license** for organizations that cannot meet AGPL's source-disclosure obligations.
  Contact `licensing@openpcb.app`.

## Documentation

| Document                             | For                                                             |
| ------------------------------------ | --------------------------------------------------------------- |
| [`ROADMAP.md`](ROADMAP.md)           | What is shipped, what is next, what is out of scope              |
| [`DEVELOPER.md`](DEVELOPER.md)       | Architecture, running from source, commands, module system       |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Quick start, pre-PR checklist, conventions                       |
| [`SECURITY.md`](SECURITY.md)         | Reporting a vulnerability                                        |

Bug reports and feature requests go to
[GitHub issues](https://github.com/OpenPCB-app/OpenPCB/issues). For architecture-shaping changes,
open an issue before the pull request. By contributing you agree to license your contributions
under AGPL-3.0-or-later.
