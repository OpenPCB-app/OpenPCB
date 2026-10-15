# Binding decisions for design-doc implementation (user + lead, 2026-10-15)

These override any "open question" default inside H08/H13/H14/H15/H19/P103 docs.

## User decisions
- **Shared tags:** lead may push the shared branch and publish per-package tags (r3f-eda-canvas-v0.1.5, rendering-core-v0.1.4, kicad-import-v0.2.0) after shared commits pass review, then re-pin OpenPCB package.json/package-lock. AgentKit/@openpcb/contracts publication stays external (AGENTKIT-7) — do not tag contracts.
- **H08 merge winner:** user-named nets (GND/PWR symbols, labels, portals, explicit user names) win over auto-named nets; pin count (then copper/assignment weight, then lower seq) decides only among nets of the same naming class. Losing net's assignments dropped and reported; copper on retired id orphaned (export blocker) with one-click rebind.
- **H15 scope:** quarantine every IPC family (incl. chip/SOIC/QFP) lacking a qualified fingerprint; legacy flagged generated footprints block export in every build (dev included) until swapped.
- **KiCad:** user installs brew KiCad 10.x; fixtures pin whatever version is installed (record version + checksums in kicad-ref/VERSION). kicad-cli path: /Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli (env OPENPCB_KICAD_CLI override).

## Lead-accepted design defaults
- H08: split warnings = always-visible "Recent net changes" list + toast only when net had copper/assignments; geometry merges of two+ named nets require confirmation; one display-name override per net, KiCad aliases report-only.
- H13: legacy KiCad project imports resolved by re-import only; no whole-design conversion command.
- H14: keep USBtoUART fixture, commit no derived variants; per-pad mask/zone overrides stay an export blocker + follow-up item.
- H15: T-214 silk-only within H15; CoreLibrary default profile = the G10 gate profile; other DRC findings become proposed Plane follow-ups (lead asks user before creating). Chip presets keep C_* names.
- H19: refuse export when clearance/connectivity/electrical/structural checks are ignored or error-level rules downgraded; block when DRC incomplete; refuse on same-net pour connection conflict; BOM-view pnp.csv goes through full DRC gate; copper on deleted nets blocks export now (dev builds; release stays quarantined).
- P103: unpackaged native evidence = interim; keep rules-save undo session split; Docs .tmp leftover = follow-up item; DB-restore detection deferred to H46; mark-acked deferred with F_FULLFSYNC.
- All: H15 export blocker waits on H19 slot (no interim guard). H19 owns export routes/dialog.
