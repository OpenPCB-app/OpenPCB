[← index](README.md)

# Summary

## (a) Summary

- **Raw findings:** 480 — confirmed 461 (2 partially), duplicates 15 (merged), rejected 4. Raw severity: S1 21 · S2 124 · S3 258 · S4 77.
- **Triage entries:** 395 root causes (390 live + 5 rejected/refuted). Recommendation: fix-now 325 · decide 43 · defer 22 · wont-fix 5.
- **By wave (live):** F0a 12 · F0b 7 · G 1 · W2 272 · W3 61 · W4 9 · followup 23 · proposal 5.
- **By scope (live):** frontend 328 · backend 38 · shared-package 15 · proposal 5 · decision 4.

### Severity × area (live entries)

| Area | S1 | S2 | S3 | S4 | Total | fix-now | decide | defer |
|---|---|---|---|---|---|---|---|---|
| cross-cutting | 1 | 2 | 15 | 5 | 23 | 21 | 1 | 1 |
| shell |  | 1 | 2 | 2 | 5 | 5 |  |  |
| home |  | 4 | 8 | 8 | 20 | 19 |  | 1 |
| settings |  | 8 | 19 | 5 | 32 | 29 | 3 |  |
| designer.shell |  | 1 | 6 | 3 | 10 | 10 |  |  |
| designer.schematic | 2 | 9 | 16 | 6 | 33 | 25 | 3 | 5 |
| designer.comments |  | 3 | 3 | 2 | 8 | 7 |  | 1 |
| designer.pcb | 2 | 25 | 41 | 10 | 78 | 65 | 9 | 4 |
| designer.drc | 2 | 1 | 4 |  | 7 | 5 |  | 2 |
| designer.bom | 2 | 7 | 4 | 1 | 14 | 11 | 3 |  |
| designer.3d |  | 5 | 7 | 1 | 13 | 11 |  | 2 |
| designer.import | 2 | 2 | 5 |  | 9 | 3 | 6 |  |
| library.browse |  | 5 | 11 | 1 | 17 | 15 | 2 |  |
| library.detail |  | 3 | 13 | 2 | 18 | 15 | 2 | 1 |
| library.import |  | 3 | 1 |  | 4 | 1 | 3 |  |
| library.wizard |  | 5 | 9 | 3 | 17 | 13 | 3 | 1 |
| library.symbol-editor |  | 3 | 3 | 1 | 7 | 7 |  |  |
| library.footprint-editor | 2 | 1 | 2 |  | 5 | 3 | 2 |  |
| assistant.space |  | 12 | 19 | 3 | 34 | 29 | 4 | 1 |
| assistant.dock |  | 3 | 2 |  | 5 | 4 | 1 |  |
| docs | 3 | 7 | 13 | 1 | 24 | 22 | 1 | 1 |
| tasks |  |  | 1 | 2 | 3 | 3 |  |  |
| cloud |  | 2 |  | 2 | 4 | 2 |  | 2 |
| **Total** | **16** | **112** | **204** | **58** | **390** | | | |

### All S1 (release blockers)

| TID | Finding ids | Title | Owner | Wave | Rec | Evidence |
|---|---|---|---|---|---|---|
| T-001 | Q10-001 | Schematic/PCB/3D canvases render black offline (canvas fonts fetched from cdn.jsdelivr.net) | F0b | F0b | **decide** | [020-C1-designer-schem-signedout](evidence/shots/q10/dark/020-C1-designer-schem-signedout.png) |
| T-091 | F2A-002 | GND/PWR port dropped onto a pin looks attached but is not connected: placement ignores the hit pin and uses t… | D2 | W2 | **fix-now** | [021-vcc-port](evidence/shots/f2a/dark/021-vcc-port.png) |
| T-092 | Q3-015 | Placing a multi-unit IC (74HC00, LM358) stacks every unit on one origin — gate pins coincide and are auto-sho… | D2 | W2 | **decide** | [047-erc-violations](evidence/shots/q3/dark/047-erc-violations.png) |
| T-132 | F1B-013, F2A-014 | PCB copper/net-class/length groups bound to ephemeral coordinate net ids — moving a schematic part orphans ro… | D3 | W2 | **decide** | [114-tracenet-after-schem-move](evidence/shots/f1b/dark/114-tracenet-after-schem-move.png) |
| T-133 | Q4-019, Q5-024, Q8-023, Q4-040 | PCB hotkeys fire while typing (dock composer, comments, selects) and behind Export dialog — text mangled, par… | D3 | W2 | **fix-now** | [094-comment-typing](evidence/shots/q4/dark/094-comment-typing.png) |
| T-210 | F1A-001, Q4-021 | Design rules 'Save & re-run DRC' silently loses edits on conflict and re-runs DRC with old rules; Board-panel… | D3 | W2 | **fix-now** | [116-rules-dock-edit](evidence/shots/f1a/dark/116-rules-dock-edit.png) |
| T-211 | F1B-003 | DRC view hangs the whole app for 10+ minutes on a large report — the violation list renders every row with no… | D3 | W2 | **fix-now** | [017-drc-dock-stacked](evidence/shots/f1b/dark/017-drc-dock-stacked.png) |
| T-217 | F1B-019 | Renaming a reference designator in the schematic never reaches the PCB: the placement keeps the old refdes an… | D4 | W2 | **decide** | [069-long-pcb](evidence/shots/f1b/dark/069-long-pcb.png) |
| T-218 | Q5-001 | BOM sourcing edits on a grouped line write to only the first designator, split the line, and redirect further… | D4 | W2 | **fix-now** | [003-bom-after-mpn-edit](evidence/shots/q5/dark/003-bom-after-mpn-edit.png) |
| T-244 | F2B-001 | KiCad project import: every 90°/270°-rotated part gets pads 1/2 swapped under its imported traces, and the wh… | D4 | W2 | **decide** | [003-2L-pcb](evidence/shots/f2b/dark/003-2L-pcb.png) |
| T-245 | F2B-002 | KiCad import leaves 78% of imported copper without a net: trace/via netName '/VBUS', 'Net-(D1-K)' never binds… | D4 | W2 | **decide** | [004-2L-drc-dock](evidence/shots/f2b/dark/004-2L-drc-dock.png) |
| T-316 | Q7-013 | IPC preset generator emits wrong land patterns (SOT pad count/layout, QFN EP shorts signal pads) | L4a | W3 | **decide** | [046-preset-sot23-B](evidence/shots/q7/dark/046-preset-sot23-B.png) |
| T-317 | Q7-022, Q6-023, F2A-008 | KiCad-derived footprints (wizard + CoreLibrary) stored Y-down: every land pattern mirrored in PCB/Gerber (dea… | followup | followup | **decide** | [042-footprint-import-cpelec](evidence/shots/q7/dark/042-footprint-import-cpelec.png) |
| T-360 | Q9-001 | Title save wipes unsaved body text typed in the same second (editor reset to stale server content) | K1 | W2 | **fix-now** | network: #321 PATCH /pages/d76ea8b4…/meta 200 |
| T-361 | Q9-008 | App white-screens when opening a text page after a PDF page or after deleting the open page (FixedToolbar use… | K1 | W2 | **fix-now** | [022-crash-pdf-to-text](evidence/shots/q9/dark/022-crash-pdf-to-text.png) |
| T-362 | Q9-028 | Undo after switching pages pastes the previous page's content into the current page and autosaves it (history… | K1 | W2 | **fix-now** | [015-undo-cross-page](evidence/shots/q9/light/015-undo-cross-page.png) |

8 S1s are frontend fix-now in this run; 8 need a decision because the root cause is backend or inside an `@openpcb/*` package (T-001, T-092, T-132, T-217, T-244, T-245, T-316, T-317) — see (d) DEC-PKG / DEC-PCB3 / DEC-SCH / DEC-IMP.

### Workload by owner (live, fix-now + decide)

| Owner | Wave | Entries | S1 | S2 | S3 | S4 | XS | S | M | L |
|---|---|---|---|---|---|---|---|---|---|---|
| F0a | F0a | 12 |  | 1 | 10 | 1 | 2 | 6 | 4 |  |
| F0b | F0b | 7 | 1 | 2 | 3 | 1 | 2 | 5 |  |  |
| G | G | 1 |  | 1 |  |  |  |  |  | 1 |
| C1 | W2 | 21 |  | 4 | 9 | 8 | 10 | 9 | 2 |  |
| C2 | W2 | 33 |  | 10 | 19 | 4 | 11 | 16 | 6 |  |
| D1 | W2 | 21 |  | 11 | 6 | 4 | 5 | 11 | 5 |  |
| D2 | W2 | 31 | 2 | 7 | 17 | 5 | 13 | 12 | 5 | 1 |
| D3 | W2 | 73 | 4 | 22 | 41 | 6 | 25 | 34 | 13 | 1 |
| D4 | W2 | 32 | 4 | 12 | 14 | 2 | 9 | 14 | 9 |  |
| L1 | W2 | 36 |  | 11 | 23 | 2 | 6 | 22 | 8 |  |
| K1 | W2 | 27 | 3 | 7 | 14 | 3 | 7 | 16 | 4 |  |
| L2 | W3 | 14 |  | 5 | 7 | 2 | 1 | 8 | 3 | 2 |
| L3 | W3 | 10 |  | 3 | 5 | 2 |  | 8 | 2 |  |
| L4a | W3 | 3 | 1 |  | 2 |  |  | 2 | 1 |  |
| L4b | W3 | 1 |  | 1 |  |  |  |  | 1 |  |
| A1 | W3 | 17 |  | 8 | 8 | 1 | 9 | 5 | 2 | 1 |
| A2 | W3 | 13 |  | 5 | 8 |  | 4 | 6 | 3 |  |
| A3 | W3 | 6 |  | 1 | 4 | 1 | 1 | 5 |  |  |
| W4 | W4 | 9 |  |  | 6 | 3 | 2 | 5 | 2 |  |

Note: D3 (PCB + DRC + rules/export dialogs) is the largest bucket — consider splitting it into D3a canvas/toolbar/layers/inspector and D3b DRC view + rules/export/outline dialogs (disjoint files) to keep W2 balanced.
