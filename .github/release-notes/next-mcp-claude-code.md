<!--
  Draft section for the next release's notes. Fold it into
  `.github/release-notes/v<version>.md` (from RELEASE_TEMPLATE.md) at tag time,
  then delete this file. Written when the `mcp.server` feature flag was
  graduated to "all" — the flip is the release event (CLAUDE.md → Feature flags).
-->

## Highlights — use Claude Code as your OpenPCB agent

- **Claude Code integration (MCP).** Claude Code — using the Claude subscription you already
  have — can now drive OpenPCB: everything the built-in Assistant does (find parts, build and wire
  schematics, review, ERC, DRC, BOM), plus work the built-in Assistant cannot do yet: **PCB
  footprint placement, trace and via routing, board outline, design rules and net classes, copper
  zones, keepouts, DRC waivers, renaming, deleting and focusing designs, and undo/redo.** Claude
  Desktop and other MCP clients work too.
- **One-click setup.** Settings → Assistant → *MCP server · Claude Code* → **Connect Claude Code**
  installs an OpenPCB plugin for Claude Code (the tools plus workflow skills: build a circuit,
  review a schematic, DRC triage, BOM check, PCB layout, connection help). Commands for setting it
  up by hand are in the same panel.
- **You stay in control.**
  - The MCP server and "Allow writes" are both **off** until you turn them on.
  - With writes on, edits apply immediately and land in your normal undo history (Ctrl+Z).
  - Deletions, design-rule and net-class changes, DRC waivers, ignoring DRC rule classes and
    deleting a design wait for your approval in the assistant panel; Claude waits for your
    decision. An approval card for a design that has changed since is refused, never applied.
  - DRC results Claude reports always include waived and hidden violations — it cannot present a
    board with suppressed problems as clean.
  - Each Claude Code session is kept apart: it can undo only its own most recent change (never
    yours or another session's), and only it can follow its proposals.
  - Every call Claude makes is logged in a per-session "MCP · Claude Code" chat on the design, and
    the canvas updates live as it works.
  - OpenPCB only ever updates or removes the Claude Code registration it created itself.
- **Robust connection.** Claude Code connects through a launcher OpenPCB keeps up to date, so the
  setup survives app updates, moves and restarts; while OpenPCB is closed, Claude Code is told to
  ask you to start it instead of failing.

## Fixes

- Pressing Ctrl+Z right after the Assistant edited a design could undo one of your own earlier
  changes instead of the Assistant's edit. Undo now always reverses the most recent change,
  whoever made it.

## Known issues (MCP)

- On Windows, Claude Code runs OpenPCB's own executable for the connection. If you move or
  reinstall OpenPCB elsewhere, Settings → Assistant → MCP shows **Update connection** (or **Update
  plugin**); click it once.
- The connection runs OpenPCB's own binary as Node. On the Linux **AppImage** and the Windows
  **portable** build this was not verified on real hardware before release. If Claude Code cannot
  connect: on Linux, installing Node.js is a workaround (the launcher falls back to it); on Windows,
  use the installer build.
- On macOS, run OpenPCB from the Applications folder. Opened straight from the disk image or
  Downloads, macOS gives it a temporary path; Settings shows a warning and Claude Code may lose it
  after you quit.
- After updating OpenPCB, click **Update plugin** in Settings, then run `/reload-plugins` in open
  Claude Code sessions, so Claude Code picks up new tools and skills.

<!-- Maintainer note, not for the published notes: the launcher depends on
     Electron's RunAsNode fuse staying enabled (see electron/AGENTS.md). -->
