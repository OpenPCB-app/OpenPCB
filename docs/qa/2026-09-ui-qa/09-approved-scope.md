[← index](README.md)

# Approved scope (user decisions, 2026-09-25)

- **S1 rooted outside the UI** (T-001, T-316, T-317, T-244/245, T-092, T-132, T-217 partially): mitigate now, dedicated sessions later. T-317 (Y-down footprints) and T-244/T-245 (KiCad import) are RELEASE BLOCKERS for dedicated sessions.
- **Backend bundles approved:** Designer (refdes → PCB, design-named exports, one-step multi-delete undo, net-label merge) and Library (single list/facet predicate, user.local guard, kind≠core, Duplicate fix) — plus the pre-approved grid 1.27 mm and Library paging. NOT approved: BOM/Docs/Auto-Layout backend (DEC-B/K/C), Assistant backend (DEC-A).
- **Proposals approved:** P1 fixed PCB tool row, P2 narrow-window layout, P3 PCB 'Layout ▾' menu, P4 trace/via inspector, P5 net-class management. P6 (part-wizard restructure) stays a proposal.
- **All fix-now entries approved** + frontend decision defaults (layer visibility = view state, block PCB delete of schematic-backed parts, truthful key-storage and privacy copy).
- Commits: fixes committed per verified area on master (not pushed); this QA archive stays gitignored.

Approved entries: **344**; not in this pass: **51**. Per-owner fix briefs: `fix/owners/*.md`; protocol `fix/FIX_PROTOCOL.md`; kit spec `fix/KIT_SPEC.md`.

## Not in this pass

| TID | Sev | Title | Why |
|---|---|---|---|
| T-023 | S4 | Console noise: THREE.Clock deprecation + 'WebGLRenderer: Context Lost' logged on every preview canvas mount/un | Not in this pass (defer). |
| T-042 | S4 | Home renders every design row/card with its SVG thumbnail at once: a 0.36–0.54 s main-thread block at 300 desi | Not in this pass (defer). |
| T-058 | S3 | Removing a library source never says its parts are placed in designs, and those parts quietly lose their libra | Deferred (DEC-L rest). |
| T-098 | S2 | ERC shows green 'No ERC violations' for a schematic with unconnected pins and floating power/GND ports, portal | Not in this pass (defer). |
| T-105 | S3 | Symbol text rendering: '~{RST}' literal, pin names overprint ('CONTVCC'), labels inside bodies, fit ignores te | Not in this pass (defer). |
| T-116 | S3 | Schematic canvas palette ignores the neutral redesign: violet selection (light) vs amber selection (dark) vs c | Not in this pass (defer). |
| T-119 | S4 | Place-component search ranks an imported KiCad 'Device:R' above the Core 'Resistor' for the query 'resistor' ( | Not in this pass (defer). |
| T-120 | S4 | Wheel zoom-out goes down to 1% where the whole schematic vanishes, while the −/+ buttons clamp at 10% | Not in this pass (defer). |
| T-130 | S4 | Comment list for a cloud-linked design blocks on an un-timed cloud fetch (12 s per request when the cloud host | Not in this pass (defer). |
| T-132 | S1 | PCB copper/net-class/length groups bound to ephemeral coordinate net ids — moving a schematic part orphans rou | Deferred to a dedicated backend/hardening session (stable net identity). |
| T-136 | S2 | New schematic parts land on the PCB in only 24 fixed slots within 4 mm of the board centre — a 150-part design | Deferred (new-part PCB placement) to a dedicated backend session. |
| T-144 | S2 | Auto Layout with cloud unreachable says the service 'does not support Auto Layout. Route Board is still availa | Deferred (DEC-C backend not approved). |
| T-201 | S4 | Export of an empty board (no parts, no copper, default 50×30 outline) reports 'DRC passed — no errors · no war | Not in this pass (defer). |
| T-202 | S4 | PCB layer palette collisions (solder mask = drill black; In1 amber ≈ outline) | Not in this pass (defer). |
| T-203 | S4 | Routed traces end in sub-µm to 4 µm micro-segments at vias and pad terminations (45° + axis elbows built acros | Not in this pass (defer). |
| T-204 | S4 | Pad-number labels rotate with the footprint: on 180°-rotated parts '1'/'2' are drawn upside-down | Not in this pass (defer). |
| T-214 | S3 | Built-in core footprints fail the default JLCPCB DRC preset out of the box: every placed part adds ~5 silkscre | Not in this pass (defer). |
| T-216 | S3 | DRC messages expose internal rule keys ('pthAnnularRingMm', 'minNpthDrillMm') and repeat the numbers with an o | Not in this pass (defer). |
| T-220 | S2 | BOM merges different parts sharing a footprint with no Value; exports write empty Comment/Val | Deferred (DEC-B backend not approved). |
| T-225 | S2 | BOM sourcing/DNP edits are not reflected in the schematic part inspector (two unsynced sources of truth) | Deferred (DEC-B backend not approved). |
| T-238 | S3 | Core 'Pin Header 1x02 2.54mm' (footprint …_Vertical) renders in 3D as a header lying flat on the board with it | Not in this pass (defer). |
| T-239 | S3 | 3D refdes labels are not occluded by the board: viewed from below, every top-side refdes (R1, R2, U1, D1, R3,  | Not in this pass (defer). |
| T-244 | S1 | KiCad project import: every 90°/270°-rotated part gets pads 1/2 swapped under its imported traces, and the who | Deferred to dedicated KiCad-import session (release blocker). |
| T-245 | S1 | KiCad import leaves 78% of imported copper without a net: trace/via netName '/VBUS', 'Net-(D1-K)' never binds  | Deferred to dedicated KiCad-import session (release blocker). |
| T-246 | S2 | Imported board rules contradict the imported net class: KiCad Default vias 0.6/0.3 but board minimum stays at  | Deferred to dedicated KiCad-import session. |
| T-248 | S3 | A 4/6-layer KiCad import opens with every inner layer hidden — the In2 ground plane and inner tracks look miss | Deferred to dedicated KiCad-import session. |
| T-249 | S3 | KiCad import silently drops all board-level graphics: 7 silkscreen texts ('USB to UART', knockout 'Ampnics', G | Deferred to dedicated KiCad-import session. |
| T-258 | S3 | Part source/provenance shown four ways; .opclib pack parts show as USER/KICAD and editable | Deferred (DEC-L rest). |
| T-285 | S3 | Imported part gets wrong auto tags / package from the footprint (R symbol tagged 'capacitor', package '1608' v | Deferred (DEC-L rest). |
| T-286 | S4 | Every STEP conversion floods the console with ~200 'GLTFExporter: Use MeshStandardMaterial…' warnings | Not in this pass (defer). |
| T-288 | S2 | A third-party .opclib silently takes over core parts that share its IDs; removing that pack then deletes the c | Deferred (DEC-L rest). |
| T-289 | S2 | ZIP import reuses another part's footprint by content hash and overwrites that part's 3D model state | Deferred (DEC-L rest). |
| T-291 | S3 | Re-importing an archive silently creates a duplicate part with the same name, or re-converts the 3D model with | Deferred (DEC-L rest). |
| T-298 | S3 | Grid never renders in any wizard/preview canvas: GridShader's uPixelsPerUnit uniform is stuck at 1 so every fr | Not in this pass (defer). |
| T-304 | S3 | Metadata step lacks core part fields (value, MPN, manufacturer, datasheet); reference prefix only editable for | Proposal P6 not approved. |
| T-305 | S3 | 3D Model step has no 3D preview, placement or orientation controls — model is attached blind | Proposal P6 not approved. |
| T-308 | S4 | Wizard steps are laid out inconsistently (section header styles, sidebar widths, which side holds the pin/pad  | Proposal P6 not approved. |
| T-317 | S1 | KiCad-derived footprints (wizard + CoreLibrary) stored Y-down: every land pattern mirrored in PCB/Gerber (dead | Deferred: dedicated session to fix @openpcb/kicad-import Y-down footprints + rebuild CoreLibrary + migrate (RELEASE BLOCKER). |
| T-322 | S2 | An unreachable default provider ends every run with 'Retrying this answer in chat-only mode.' and nothing else | Deferred (DEC-A backend). |
| T-327 | S2 | Assistant reports 'R99 has been added' but the part got reference R6 — placement tool can't set a reference an | Deferred (DEC-A backend). |
| T-340 | S3 | Multi-step answers glue each iteration's text together with no separator ('…LED components.The design…', '…bri | Deferred (DEC-A backend). |
| T-354 | S4 | Chats are never auto-titled and 'New' immediately persists an empty 'New chat' row (list fills with identical  | Not in this pass (defer). |
| T-355 | S2 | A hung local provider blocks the chat: provider calls have no timeout, and once the dock remounts mid-run (clo | Deferred (DEC-A backend). |
| T-380 | S3 | Docs search only matches titles — body text and imported .md/.txt content are not searchable | Not in this pass (defer). |
| T-389 | S4 | Realtime websocket reconnect loop logs a console error every ~10 s forever while a linked design is open offli | Not in this pass (defer). |
| T-390 | S4 | 'Open from Cloud' dialog offline: raw 'Failed to fetch' above a contradictory empty state pointing to a non-ex | Not in this pass (defer). |
| T-391 | S3 | Design thumbnails are hard-coded dark slate art (#131313 bg, slate-400 wires) that ignore theme and tokens — a | Not in this pass (wont-fix). |
| T-392 | S4 | Enabling MCP in a non-Electron build shows no connection details or explanation | Not in this pass (wont-fix). |
| T-393 | S3 | Place-component palette symbol preview stays black (#131313) in light theme while the schematic canvas is ligh | Not in this pass (wont-fix). |
| T-394 | S3 | A drawn zone can only be selected by clicking exactly on its outline; clicking the pour does nothing, so Shift | Not in this pass (wont-fix). |
| T-395 | S4 | 3D Snapshot button has no accessible label (K27) | Not in this pass (wont-fix). |