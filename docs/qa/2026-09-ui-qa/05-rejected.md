[← index](README.md)


# Rejected, duplicate and needs-info findings

## (f) Rejected findings

| ID | Title | Reason |
|---|---|---|
| F2A-019 | A drawn zone can only be selected by clicking exactly on its outline; clicking the pour d… | Edge-only zone selection is a documented design decision. docs/pcb-hardening/03-zone-keepout-contract.md §12.3: 'polygon zones and keepouts are selected by proximity to their ring (edge only — an interior hit would swallow every marquee start over a pour)'. T… |
| Q1-017 | Design thumbnails are hard-coded dark slate art (#131313 bg, slate-400 wires) that ignore… | Intentional per PLAN, not a redesign defect: (1) D1 defines --surface-canvas-well = #08090a in BOTH themes and the T6 run-log entry says 'card preview SVG pinned to theme=dark (wells are always dark)' — the dark thumbnails in light theme are the decided look;… |
| Q2-029 | Enabling MCP in a non-Electron build shows no connection details or explanation | Environment artefact (browser vs Electron). The shipped product is the Electron app, where window.electronAPI.getMcpConfig exists and McpSection renders the Claude Code/Desktop/HTTP snippets (and the dev-shim note). In the browser dev harness the MCP endpoint… |
| Q3-031 | Place-component palette symbol preview stays black (#131313) in light theme while the sch… | Intentional per the redesign decisions. Canvas and preview wells are theme-invariant dark: D1 defines --surface-canvas-well = #08090a in both themes, design-tokens.md §3 says 'Only the canvas and layer palettes are theme-invariant', and the T6 run log says 'w… |
| K27 (known) | 3D Snapshot button has no accessible label | Refuted: button name 'Snapshot' comes from its visible text. |

Duplicates merged by verifiers (kept inside the target entry):

| Duplicate | → TID | Merged with |
|---|---|---|
| F1B-011 | T-096 | Q3-011 |
| F1B-014 | T-164 | own entry (backend naming split out of Q4-024/Q5-010) |
| F1B-017 | T-152 | Q4-024, F2B-006 |
| F1B-023 | T-129 | Q3-023, Q5-030 |
| F1B-024 | T-025 | Q1-007, Q11-012, Q3-034 |
| F1C-011 | T-297 | F1C-010 |
| F2A-008 | T-317 | Q7-022, Q6-023 |
| F2A-014 | T-132 | F1B-013 |
| F2A-020 | T-146 | Q4-004, F1B-033 |
| Q2-026 | T-024 | Q1-006, Q3-001, Q5-016, Q9-027 |
| Q3-034 | T-025 | Q1-007, Q11-012, F1B-024 |
| Q3-039 | T-032 | Q1-005 |
| Q6-013 | T-294 | Q7-003 |
| Q6-023 | T-317 | Q7-022, F2A-008 |
| Q6-030 | T-255 | Q10-017 |


## Full records

### F1B-011 — 'Delete all 150' deletes one part per request over ~8 s with no confirmation, and needs 150 Undo clicks (≈17 s) to restore

- Status **duplicate** · severity S2 · area designer.schematic
- Actual: No confirmation. The UI dispatches 150 sequential delete_entity commands: after 3 s the inspector still showed '122 parts', parts vanish one by one for ≈8 s while the canvas stays interactive (fps 47). History: undoDepth 150, revision 210 → 362. Restoring took 151 Undo clicks and 17.1 s (schematic has no Cmd+Z, K17). Same root cause as Q3-011 (non-atomic batch), here quantified at scale.
- Verification (vf1b): duplicate — Reproduced on QA-vf1b-stack60: Cmd+A -> 'Delete all 60' -> no confirmation (dialog spy 0). Parts vanished one by one (after 2 s the inspector still read '30 parts'; finished after ~3 s), and history went to undoDepth 60. Same root cause as verified Q3-011 (S2, a multi-delete is N envelopes / N undo entries). This finding adds a second call site: MultiPartInspectorPanel.tsx:45 deleteAll awaits dispatchCommand per part, so each delete also refreshes the projection, which is why it is slow. Fold into Q3-011: route deleteAll through the same batch command, and add the scale data and the missing confirmation for large deletes.

### F1B-014 — Fab bundle (all 14 Gerber/drill/CSV files, ZIP and .gbrjob ProjectId) is named after a truncated design UUID, never the design name (extends Q5-010 from BOM downloads to the manufacturing ZIP)

- Status **duplicate** · severity S3 · area designer.pcb
- Actual: The user (and the fab house) receives several ZIPs that are indistinguishable except for a 32-char UUID fragment; the UUID is cut mid-group (last group truncated to 8 of 12 chars). BOM view names end in '-csv.csv'. Related: Q5-010 reported the UUID naming for BOM-view downloads; this finding covers the manufacturing ZIP, every file inside it and the X2 job file.
- Verification (vf1b): duplicate — Confirmed, but already covered: the export dialog footer on QA-vf1b-empty reads '14 files · openpcb-cb93fe99-63c1-414a-8bf9-ec87ff3c.zip'. The member prefix and the .gbrjob GeneralSpecs.ProjectId.Name = raw UUID (job-file.ts:44) were confirmed via POST /exports/gerber. The ZIP and member UUID naming is verified in Q4-024 ('ZIP named by UUID', fix: slugify the design name). The '-csv.csv' BOM-view names and the ignored Content-Disposition are verified in Q5-010. The only new detail is the .gbrjob ProjectId.Name; add it to Q4-024's fix: exportBundleName(designId) in sdks/designer/pcb-helpers.ts:13 should take the design name and feed job-file.ts ProjectId.Name.

### F1B-017 — Export dialog 'Include inner copper layers (4-layer boards only)' is enabled and checked by default on 2-layer boards and silently does nothing

- Status **duplicate** · severity S4 · area designer.pcb
- Actual: Checkbox is enabled and checked on QA-f1b-stress, Dual LED Blinker and QA-f1b-empty (all 2-layer); toggling it changes nothing — both ZIPs have the same 14 files (no In1/In2).
- Verification (vf1b): duplicate — Reproduced on the 2-layer QA-vf1b-empty: 'Include inner copper layers (4-layer boards only)' is enabled and checked (PcbExportDialog.tsx:258-265, not gated on layerCount). This is exactly the verified Q4-024 (K30).

### F1B-023 — Light theme: PCB comment thread popup timestamps and meta text are 10 px slate-400 on white — 2.0–2.4:1 contrast (unreadable 'now' / '9m')

- Status **duplicate** · severity S3 · area designer.comments
- Actual: Popup body is #ffffff; timestamps render #b5b5b9–#bcbcc0 (text-[10px] text-slate-400 → remapped #a8a8ad) = 2.04–2.37:1. In dark the same span is #a1a1a6 on #111113 (≈7:1), so the problem is light-only. The avatar is a fixed dark disc (#3a3a40 light / #505056 dark, bg-violet-600 remapped) with a '·' placeholder; the pin stays violet #895bf3 in both themes (raw palette already reported in Q5-030/Q3-023 — this finding is the measured light-theme contrast failure).
- Verification (vf1b): duplicate — Measurement reproduced in light on QA-f1b-long: the comment popup body is #ffffff and the timestamps '2h' are computed rgb(168,168,173) (text-slate-400 remapped by D1) at 10 px = 2.37:1. The root cause is the unmigrated raw-palette CommentThreadPopup, already verified as Q5-030 (K45: comment popups on raw palette / raw white light background; fix = restyle with tokens). Fold the contrast measurement into Q5-030. When migrating, use text-text-secondary for the 10 px meta text, since --text-tertiary on white is only 3.9:1. Side note: the stored comment text on this pin is missing its hotkey letters ('QA cen: cec e lng ne…'). That is the textarea-hotkey defect already verified as Q4-019/Q5-024, not a new issue.

### F1B-024 — Schematic Outline row 'Actions' menu uses a fourth menu recipe (bg-surface-raised grey, border-border, 24 px items) — grey #e2e2e5 in light where kit menus are white --menu-bg

- Status **duplicate** · severity S4 · area designer.schematic
- Actual: Outline Actions: class 'min-w-[9rem] rounded-float border border-border bg-surface-raised py-1 shadow-lg', computed bg rgb(226,226,229) and 24 px items; BOM Export ▾: 'bg-menu-bg border-menu-border p-1' → #ffffff in light. In dark both tokens resolve to #1c1c1f so the drift is only visible in light. Additional instance of the menu-recipe drift in Q11-012 (kit dropdown vs context menu vs PCB Add/View).
- Verification (vf1b): duplicate — Reproduced in light: the Outline row 'Actions' menu is 'rounded-float border border-border bg-surface-raised py-1 shadow-lg', computed bg rgb(226,226,229) (--surface-raised), items 23-24 px. This is the same --surface-raised recipe that verified Q11-012 lists for the PCB toolbar Add/View dropdowns, not a fourth recipe. Add OutlinePanel's row menu to Q11-012's list of places to migrate to the kit DropdownMenu.

### F1C-011 — Next morphs into 'Import component' under the keyboard focus, and Shift+Tab from the first field lands on it, so one stray Space imports an unnamed part

- Status **duplicate** · severity S3 · area library.wizard
- Actual: The first space character activated 'Import component' and immediately imported a part named 'R' with the auto tags. The wizard closed, and the rest of the typed text went into the Library search box. No confirmation or success notice was shown. It happened to me during the keyboard walk and produced part ea9ed02d ('R'), which I later renamed QA-f1c-R-accidental. The same holds for a double Space/Enter on Next at step 3.
- Verification (vf1c): duplicate — Reproduced: after clicking Next x3, focus remains on the header button, now labelled 'Import component' (snapshot [active]). Shift+Tab from 'Component name' lands on 'Import component'. The accidental commit is real, but it has the same root cause as F1C-010: no focus management on step change, and Back/Next/Import rendered in the header before the step content (ImportWizardPage.tsx:686-708). F1C-010 lists both as items (2) and (6), and its fix (focus the step heading or first field on step change, move actions after the content) removes this path. Merged into F1C-010 (mergedIds).

### F2A-008 — Golden path ships a dead board: the core NE555 SOIC-8 lands mirrored (pin 1 GND bottom-left, pins counted clockwise), yet ERC/DRC are clean and the export gate says 'DRC passed' — VCC/GND end up on RST/CTRL pins

- Status **duplicate** · severity S1 · area designer.pcb
- Actual: Extension of Q6-023 on the end-to-end flow: F_Cu flashes U1 pad 1 (GND) at (-2.475,-2.022) and pad 4 (VCC) at (-2.475,+1.788) around U1 at (0,-0.117); F_Silkscreen pin-1 triangle at (-2.6,-2.59)…(-2.84,-2.92) i.e. bottom-left; PnP 'U1,NE555,SOIC-8…,0.0000,-0.1170,270.00,Top'. A real NE555 (or JLC placing it at 270°) puts chip pin 1 where pad 4 is: GND↔~RST, TRIG↔OUT, CTRL↔VCC, THR↔DIS — the supply is shorted through the chip on power-up. Nothing in the flow warns: ERC 0, DRC 0 errors, export dialog 'DRC passed with 44 warning(s)'. The same applies to every KiCad-derived core footprint with asymmetric pinout (SOT-23, SOT-223, LED polarity).
- Verification (vf2a): duplicate — Reproduced independently: in QA-vf2a-a the Core NE555 SOIC-8 at rotation 0 draws pad 1 bottom-left, then 2-3-4 upward, 5 top-right and 8 bottom-right (clockwise from the top; shot 016). POST /exports/gerber F_Cu flashes U1 pads in order: (-3.975,-1.905) (-3.975,-0.635) (-3.975,0.635) (-3.975,1.905) (0.975,1.905) (0.975,0.635) (0.975,-0.635) (0.975,-1.905), a mirrored land pattern. The SOIC-8 .fp.json is still Y-down in CoreLibrary beta.1, beta.2 and the current dev pack, so this is not a stack artefact. Same root cause and fix as Q7-022 (confirmed S1; Q6-023 is already merged there). The golden-path evidence (export gate 'DRC passed', PnP rot 270) should be attached to Q7-022.

### F2A-014 — Extension of F1B-013: the GND zone is NOT orphaned (it re-binds by netName) but its stitching vias and GND traces are — so after a schematic GND-port nudge the pour carves clearance around its own vias and the board silently loses GND

- Status **duplicate** · severity S1 · area designer.pcb
- Actual: GND id changes pt:26142006:12740371 → pt:28870061:12740371 (the union-find root was that port). Both zones follow (zone.netName 'GND' is re-resolved in pcb-projection.ts), but the 3 GND vias and 4 GND traces keep the old id (not in netNames). The pour therefore treats them as foreign copper: black clearance rings/channel around the GND vias and the B.Cu J1.2→C2.2 trace (crop f2a/crop-gnd-orphan.png), ratsnest 0→4, DRC 0→6 errors (5× NET_SHORT_CIRCUIT 'trace and pad on different nets overlap', UNCONNECTED_NET GND 4 airwires) + 3× VIA_DANGLING + 4× TRACK_DANGLING. Exported now, the GND vias would be isolated islands in the plane. Moving U1 instead orphans only Net_1/Net_2 traces (5) — zones unaffected. Undo of the port move restores everything.
- Verification (vf2a): duplicate — Reproduced on the golden design: dragged the GND port next to J1 about 2.7 mm in the schematic (rev 143→144). The GND net id changed pt:26142006:12740371 → pt:26142006:10039494 with the same 5 pins. Both zones re-bound by netName, while vias 1dffe009/34d9e23f/af552324 and traces 0479b885/225acf78/977163b2/cdff5b79 kept the dead id; ratsnest went 0→4. The PCB shows black clearance around the GND vias and the B.Cu GND trace (shot 035). Toolbar Undo restored everything (rev 145). Same root cause and fix as F1B-013 (confirmed S1): coordinate net ids persisted on copper. The zone-rebinds-but-vias-don't detail belongs in F1B-013's stop-gap fix.

### F2A-019 — A drawn zone can only be selected by clicking exactly on its outline; clicking the pour does nothing, so Shift+Z 'Cutout' ('Select one unlocked polygon zone first') looks broken

- Status **rejected** · severity S3 · area designer.pcb
- Actual: Only edge-proximity selection works; with a board-sized zone the edge coincides with the board outline, so users hit the outline or nothing. Shift+Z with nothing selected is a silent no-op (the hint only exists as a tooltip on the disabled Cutout checkbox).
- Verification (vf2a): rejected — Edge-only zone selection is a documented design decision. docs/pcb-hardening/03-zone-keepout-contract.md §12.3: 'polygon zones and keepouts are selected by proximity to their ring (edge only — an interior hit would swallow every marquee start over a pour)'. The 'Shift+Z is a silent no-op' part did not reproduce. On the golden (B.Cu active, nothing selected, after clicking inside the pour → 'No selection'), Shift+Z shows the notice 'Select one unlocked polygon zone first — Shift+Z cuts a hole in it' (shot 032). Nothing left to fix beyond the intended behaviour.

### F2A-020 — Extension of F1B-033/Q4-004: after the FIRST click of a route a second hint row ('Enter finish · V via + layer · W width …') is inserted, so the board jumps another 14 px between the start and end click of every trace

- Status **duplicate** · severity S2 · area designer.pcb
- Actual: Three different frames in one trace: idle (oy 26.52 mm), route armed (27.32), route active (28.13) — 0.8 mm per step at 17 px/mm. My first attempt at R3.1→U1.3 missed the pad by 14 px and turned into a runaway route through U1 with '8 conflicts' ([043-routes-2-6](evidence/shots/f2a/dark/043-routes-2-6.png)) that had to be cancelled.
- Verification (vf2a): duplicate — Reproduced: golden PCB canvas top 64 (idle) → 92 (R armed) → 120 (after the first pad click, hint row 'Enter finish V via + layer W width …'); the board moves 14 px at each step. Verified Q4-004 already records exactly this ('canvas box top 64 -> 92 when R arms Route, -> 120 after the first pad click (extra hint row …)', S2) with the same fix (single fixed row / overlay). F1B-033 covers the first row. No new root cause.

### Q1-017 — Design thumbnails are hard-coded dark slate art (#131313 bg, slate-400 wires) that ignore theme and tokens — and don't match the light schematic

- Status **rejected** · severity S3 · area home
- Actual: In light theme every row/card/detail shows a black #131313 box inside a #08090a well (two different near-blacks), wires #94a3b8 (Tailwind slate-400, ΔE 11 from any token) and symbols #e2e8f0 (slate-200) — a blue cast banned by the neutral spec. The light schematic editor itself renders on a light canvas (#f0f4fb), so the preview misrepresents the design; the grid in light theme reads as a wall of black rectangles.
- Verification (vq1): rejected — Intentional per PLAN, not a redesign defect: (1) D1 defines --surface-canvas-well = #08090a in BOTH themes and the T6 run-log entry says 'card preview SVG pinned to theme=dark (wells are always dark)' — the dark thumbnails in light theme are the decided look; (2) the hex values are an exact mirror of the canvas package palette (node_modules/@openpcb/r3f-eda-canvas/dist/theme/canvasTheme.js:30-55: SCHEMATIC_DARK.background #131313, wireColor #94a3b8, PREVIEW_DARK.symbolStroke #e2e8f0, symbolFill #111111), and the canvas palette is an explicit non-goal (§0) with a §9 follow-up — so the thumbnail matches the dark schematic editor by design; (3) the #08090a well is fully covered by the SVG's #131313 background (probe at 400,100 = #131313), so no visible 'two near-blacks'. Residual note for the §9 canvas-palette follow-up: SchematicThumbnail.tsx:14-17 constants must be updated together with SCHEMATIC_DARK/PREVIEW_DARK.

### Q2-026 — App context menu shows 'Ctrl+,' for Settings on macOS

- Status **duplicate** · severity S4 · area shell
- Actual: Hard-coded 'Ctrl+,' (navigator.platform MacIntel).
- Verification (vq2): DUPLICATE — Reproduced (menu shows 'Settings Ctrl+,' on macOS; AppShell.tsx:77 hard-coded) but already covered verbatim by Q1-006 ('…shortcut label says Ctrl+, on macOS', K33). Fold into Q1-006.

### Q2-029 — Enabling MCP in a non-Electron build shows no connection details or explanation

- Status **rejected** · severity S4 · area settings
- Actual: Only the read-only sentence appears; no snippets, no desktop-only note (the shim note needs a config object).
- Verification (vq2): REJECTED — Environment artefact (browser vs Electron). The shipped product is the Electron app, where window.electronAPI.getMcpConfig exists and McpSection renders the Claude Code/Desktop/HTTP snippets (and the dev-shim note). In the browser dev harness the MCP endpoint is not usable anyway (POST /mcp -> 503 with no Electron-issued token). Reproduced the missing note, but it affects only developers running the bare Vite stack; at most a dev nicety.

### Q3-031 — Place-component palette symbol preview stays black (#131313) in light theme while the schematic canvas is light

- Status **rejected** · severity S3 · area designer.schematic
- Actual: Preview well is #131313 (dark) with white strokes inside an otherwise light dialog; the symbol then appears in black on a light canvas after placement.
- Verification (vq3): rejected — Intentional per the redesign decisions. Canvas and preview wells are theme-invariant dark: D1 defines --surface-canvas-well = #08090a in both themes, design-tokens.md §3 says 'Only the canvas and layer palettes are theme-invariant', and the T6 run log says 'wells are always dark'. The palette preview (#131313) matches every other preview surface in light theme: the Library preview pane probes #131313 in light too ([006-library-preview-light](evidence/shots/vq3/light/006-library-preview-light.png)), and the Home thumbnails do the same (Q1-017 was rejected on the same grounds). The outlier is the in-tree light schematic canvas (#f0f4fb, Q3-029), not the preview. Residual note for the §9 canvas-palette follow-up: align preview and schematic-canvas backgrounds together.

### Q3-034 — Canvas context menus use off-kit styling (28 px rows, shadow-lg, panel bg) and show 'Ctrl+A' on macOS

- Status **duplicate** · severity S4 · area designer.schematic
- Actual: Items are 28 px tall (py-1.5), menu uses bg-surface-panel + shadow-lg; empty-canvas menu lists 'Select all  Ctrl+A' on macOS while the toolbar/palette say ⌘K.
- Verification (vq3): duplicate — Reproduced (canvas menus render through the same AppContextMenu, AppContextMenu.tsx:155/193: bg-surface-panel, 28 px rows, shadow-lg), but this is the component already reported and verified as Q1-007 (app context menu styled unlike kit menus). Fold into Q1-007. Fold the hard-coded 'Select all  Ctrl+A' on macOS (SchematicCanvas.tsx:2892) into Q1-006's platform-shortcut-label fix, the same pattern as 'Ctrl+,'.

### Q3-039 — Home list hides every design name at 1100×720 (Name column collapses to 29 px while the 220 px preview column stays)

- Status **duplicate** · severity S2 · area home
- Actual: NAME header is 29 px wide and the rows show only preview, revision, DRC chip and modified time — no design names at all; users must click each row to see its name in the detail panel. (Noticed while navigating for the designer charter; observed at 1440×900 the names are fine.)
- Verification (vq3): duplicate — Same defect as Q1-005, already verified by vq1 (Home list Name column collapses to 0 px at 1100×720, DesignListRow.tsx:7 column template). Out of q3's charter (home). Fold into Q1-005.

### Q6-013 — Multi-unit symbols (74HC00, LM358) render all units and the De Morgan body superimposed in the preview pane, detail card and fullscreen

- Status **duplicate** · severity S2 · area library.detail
- Actual: The R3F symbol preview draws all 5 units of 74HC00 plus the alternate (De Morgan) body on top of each other: pin numbers overprint ('1/4/9/12' → '19', '3/6/8/11' → '81'), an OR-shape and a huge circle overlap the AND body, VCC/GND labels overprint the filled power-unit box. LM358 shows both op-amp units overprinted (pins 3/5, 2/6, 1/7). Symbol payload: unitCount 5, pins carry `unit`, but symbol-render-layer ignores units. Pins table ordering is also unsorted (1,2,3,4,5,6,8,…,13,7,14).
- Verification (vq6): duplicate — Reproduced (74HC00 preview pane, detail card and fullscreen draw all 5 units + De Morgan body superimposed: pins '19'/'81' overprint, OR-shape + circle over the AND body; pins list unsorted 1..6,8..13,7,14). Same root cause as Q7-003 (verified: symbol preview/render path has no unit/body-style filtering anywhere; wizard import shows LM358 units stacked). Fold the affected surfaces (Library preview pane, detail Symbol card, PreviewModal, core 74HC00/LM358) and the unsorted Pins table into Q7-003; the placement consequence is Q3-015 (S1).

### Q6-023 — KiCad footprints are stored Y-down in a Y-up board: every imported/core footprint is mirrored — confirmed in Gerber F.Cu (SOIC-8 pins numbered clockwise) and in the 3D view

- Status **duplicate** · severity S1 · area library.import
- Actual: KiCad-derived footprints keep KiCad's Y-down coordinates, so in the Y-up board space and in the exported Gerber the land pattern is a vertical mirror image: SOIC-8 pins run clockwise from a bottom-left pin 1. A real IC placed on this copper has pins 1↔4, 2↔3, 5↔8, 6↔7 swapped; SOT-23 transistors get pins 1/2 swapped; polarised parts get their marks on the wrong side. The app itself exposes the contradiction: in 3D the (correctly-oriented) model's pin-1 dot sits over copper pad 4. IPC-generated/drawn footprints use the opposite (correct) convention, so a library mixes both handednesses. Same root cause as Q7-022 (reported S2 'needs PCB/Gerber verification') — this is that verification: the manufacturing output is affected, which makes it S1.
- Verification (vq6): duplicate — Verified independently: POST /designs/3f9e4e24…/exports/gerber (stack B) → F_Cu.gbr (%MOMM, Y-up) U1 pads 1(-5.575,-1.905) 2(-5.575,-0.635) 3(-5.575,0.635) 4(-5.575,1.905) 5(-0.625,1.905) … 8(-0.625,-1.905): pins run clockwise viewed from the top on F.Cu, which no rotation can produce → mirrored land pattern in the manufacturing output. Library previews show the same (74HC00 pads 7/8 at the top; OP07CD pin 1 bottom-left with the model's pin-1 dot at the top). Same root cause and dedupeKey as Q7-022, which vq7 already confirmed at S1; this Gerber dump is additional evidence to attach there.

### Q6-030 — At 1100×720 (Electron minimum) the Library table is squeezed to 420 px: names collapse to one character and column headers overlap

- Status **duplicate** · severity S2 · area library.browse
- Actual: Facet rail (220 px) + preview pane (380 px) are fixed width, leaving the table 420 px. Measured grid columns: '24px 13.4px 90px 10.6px 60px 44px 110px' — NAME is 13 px ('7…', 'A…', 'Q…'), PACKAGE 10 px ('s…'); the NAME and FAMILY header labels overprint ('NAMEILY'). Rows of QA-* parts are indistinguishable. The Family, Mount, Pins and Source columns keep their fixed widths.
- Verification (vq6): duplicate — Reproduced at 1100×720 (light): row grid-template-columns '24px 13.4375px 90px 10.5625px 60px 44px 110px', Name cell 13 px. Identical to Q10-017 (already verified S2 by vq10, same measurement and fix).
