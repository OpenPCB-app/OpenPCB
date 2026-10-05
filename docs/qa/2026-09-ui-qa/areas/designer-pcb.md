# designer.pcb — QA findings

[← index](../README.md) · 79 triage entries · S1 2 · S2 25 · S3 41 · S4 10

| TID | Sev | Title | Findings | Rec | Owner / wave | Scope | Est |
|---|---|---|---|---|---|---|---|
| [T-132](#t-132) | S1 | PCB copper/net-class/length groups bound to ephemeral coordinate net ids — moving a schematic part orphans routing | F1B-013, F2A-014 | decide (DEC-PCB3) | D3 / W2 | backend | L |
| [T-133](#t-133) | S1 | PCB hotkeys fire while typing (dock composer, comments, selects) and behind Export dialog — text mangled, parts deleted | Q4-019, Q5-024, Q8-023, Q4-040 | fix-now | D3 / W2 | frontend | S |
| [T-134](#t-134) | S2 | Concurrent edits rejected with 'Revision conflict' (drag while saving, Alt+click layer solo) | F1A-003, Q4-011 | fix-now | D1+D3 / W2 | frontend | M |
| [T-135](#t-135) | S2 | PCB sidebar: Layers list paints over Components (click interception) with many parts / at 1100×720 | F1B-001, Q4-042 | fix-now | D1+D3 / W2 | frontend | S |
| [T-136](#t-136) | S2 | New schematic parts land on the PCB in only 24 fixed slots within 4 mm of the board centre — a 150-part design becomes one stacked blob of overlapping footprints | F1B-002 | decide (DEC-PCB3) | D3 / W2 | backend | M |
| [T-137](#t-137) | S2 | PCB canvas freezes with many DRC markers: one wheel notch ≈0.75 s, 10 notches 50 s, hovering 10 px >30 s (4 meshes + 4 materials per marker, rebuilt on every hover) | F1B-004 | fix-now | D3 / W2 | frontend | M |
| [T-138](#t-138) | S2 | Copper-fill render order wrong: F.Cu pour hides top silk text; active inner-layer pour drawn under dimmed F.Cu | F1B-032, F2B-005 | fix-now | D3 / W2 | frontend | S |
| [T-139](#t-139) | S2 | A quick tap on a footprint leaves a hidden drag armed: the next click anywhere teleports that footprint to the click point (R3 jumped onto C2) | F2A-003 | fix-now | D3 / W2 | frontend | S |
| [T-140](#t-140) | S2 | Layers-panel copper-fill droplet is titled 'Show/Hide copper fills' but creates/enables a board-wide SOLID pour: it silently overrides the user's thermal zone (canvas and Gerber) and the canvas draws clearance rings around same-net GND vias that the Gerber does not have | F2A-004 | fix-now | D3 / W2 | frontend | S |
| [T-141](#t-141) | S2 | Route tool ignores the name-based net class DRC uses: VCC/GND are routed at the Default 0.25 mm ('Class Default' in the route row) and the next DRC flags every one of them NETCLASS_TRACE_WIDTH (Power 0.5 / GND 0.4) | F2A-006 | fix-now | D3 / W2 | frontend | XS |
| [T-142](#t-142) | S2 | Route commit refused by the backend shows only 'Command failed' — INVALID_PCB_VIA/INVALID_PCB_* details are dropped, even with the DRC override on | F2B-004 | fix-now | D1 / W2 | frontend | XS |
| [T-143](#t-143) | S2 | 6-layer boards: In3/In4 copper is invisible and unreachable — no layer tab, no Layers row, 'All copper' preset skips them, keys 3/4 go dead, and the layer-pair list only knows 4-layer pairs | F2B-007 | fix-now | D3 / W2 | frontend | M |
| [T-144](#t-144) | S2 | Auto Layout with cloud unreachable says the service 'does not support Auto Layout. Route Board is still available.' | Q10-003 | decide (DEC-C) | D3 / W2 | backend | S |
| [T-145](#t-145) | S2 | DRC count differs between toolbar (errors only) and dock tab / status bar (errors+warnings) | Q4-001 | fix-now | D3 / W2 | frontend | S |
| [T-146](#t-146) | S2 | Canvas jumps 14 px each time a route/tune/notice row appears (resizes mid-gesture) | Q4-004, F1B-033, F2A-020 | decide (P1) | D1 / W2 | decision | M |
| [T-147](#t-147) | S2 | Trace width / via diameter / via drill 'Custom…' use native window.prompt with no validation | Q4-008 | fix-now | D3 / W2 | frontend | S |
| [T-148](#t-148) | S2 | Deleting a footprint on PCB silently re-spawns it at an auto position overlapping another part | Q4-014 | decide (DEC-PCB2) | D3 / W2 | decision | S |
| [T-149](#t-149) | S2 | Vias under a trace end can't be picked: click/right-click always hit the trace, and the Alt+click overlap picker closes the instant it opens | Q4-016 | fix-now | D3 / W2 | frontend | M |
| [T-150](#t-150) | S2 | PCB dialogs lack dialog semantics/focus management (rules, export, outline modals) | Q4-022, Q4-027, Q11-005 | fix-now | D3 / W2 | frontend | M |
| [T-151](#t-151) | S2 | DRC 'out of date' banner is inverted after PCB edits (missing while stale, shown right after a fresh run); tab revision frozen | Q4-023 | fix-now | D3 / W2 | frontend | S |
| [T-152](#t-152) | S2 | Export 'Include inner copper layers' checked on 2-layer boards; unchecking on 4-layer silently ships an unmanufacturable bundle | Q4-024, F1B-017, F2B-006 | fix-now | D3 / W2 | frontend | XS |
| [T-153](#t-153) | S2 | Layer visibility / active-layer / view clicks are recorded as undoable document edits (revision bump, DRC stale) and their undo is a silent no-op | Q4-025 | decide (DEC-PCB1) | D3 / W2 | decision | M |
| [T-154](#t-154) | S2 | Board panel shows un-applied typed size as the board's real size after 'Done' (e.g. 'Circle 80 × 60' for a 60 mm circle) | Q4-026 | fix-now | D3 / W2 | frontend | XS |
| [T-155](#t-155) | S2 | 'Fit to parts' ignores free pads/holes (cuts them off the board) and on an empty board silently resizes to a hard-coded 80 × 56 mm | Q4-028 | fix-now | D3 / W2 | frontend | S |
| [T-156](#t-156) | S2 | PCB Text tool uses window.prompt and drops text onto a hidden silkscreen layer | Q4-030, Q4-031 | fix-now | D3 / W2 | frontend | S |
| [T-157](#t-157) | S2 | Pad/text Rotation field silently rejects 0° and negative angles (can't rotate back to 0); 360 stored un-normalised | Q4-033 | fix-now | D3 / W2 | frontend | XS |
| [T-158](#t-158) | S2 | Layer solo state leaks across design tabs; exiting it writes the other design's layer visibility into the current design | Q4-049 | fix-now | D3 / W2 | frontend | XS |
| [T-159](#t-159) | S3 | Export and DXF import failures surface raw transport/parser text ('Failed to fetch' ×2, 'Ended on code undefined') that lingers after recovery | F1A-011 | fix-now | D3 / W2 | frontend | S |
| [T-160](#t-160) | S3 | If the PCB projection fails to load, PCB shows only grey 'PCB projection unavailable' with no reason or retry, and the workspace error is never rendered | F1A-012 | fix-now | D3 / W2 | frontend | XS |
| [T-161](#t-161) | S3 | Design rules accept and persist impossible net-class values (width 0, width 999 mm, clearance −1) with no validation — the route tool then draws a 0 mm or 999 mm trace | F1B-006 | fix-now | D3 / W2 | frontend | S |
| [T-162](#t-162) | S3 | Net classes are a fixed Default/Power/GND trio: no Add/rename/delete class and no per-class via size in Design rules | F1B-007 | decide (P5) | D3 / proposal | proposal | M |
| [T-163](#t-163) | S3 | Design rules net pickers don't scale: 353 unfilterable Net assignment selects in a 192 px box and 353 length-group chips in an 80 px box; selected members not summarised | F1B-008 | fix-now | D3 / W2 | frontend | M |
| [T-164](#t-164) | S3 | Fab bundle (all 14 Gerber/drill/CSV files, ZIP and .gbrjob ProjectId) is named after a truncated design UUID, never the design name (extends Q5-010 from BOM downloads to the manufacturing ZIP) | F1B-014 | decide (DEC-PCB3) | D3+D4 / W2 | backend | S |
| [T-165](#t-165) | S3 | Design rules → Length match group row overflows the dialog: the 'Remove group' (trash) button is clipped to ~9 px at the dialog edge and '± tol' wraps onto two lines | F1B-018 | fix-now | D3 / W2 | frontend | XS |
| [T-166](#t-166) | S3 | DRC marker hover tooltip: long net names overflow the 280 px card (no wrap, no viewport clamp), and in light theme its 10 px message text is 2.8:1 on a blue-tinted translucent card | F1B-021 | fix-now | D3 / W2 | frontend | XS |
| [T-167](#t-167) | S3 | Tune HUD: key readouts in low-contrast grey (2–2.5:1) and wrap mid-value | F1B-022, F1B-034 | fix-now | D3 / W2 | frontend | XS |
| [T-168](#t-168) | S3 | 'Remove redundant pour traces' is hidden for zones drawn with Z (only shown while a board zone is enabled) and gives no feedback — it returned ok with 0 changes and nothing on screen | F2A-005 | fix-now | D3 / W2 | frontend | S |
| [T-169](#t-169) | S3 | No 'routing complete' indicator: nothing shows how many connections are still unrouted — users must hunt for faint dashed ratsnest lines or run DRC | F2A-017 | fix-now | D3 / W2 | frontend | S |
| [T-170](#t-170) | S3 | Traces on the non-active copper layer can't be clicked, silently — and the route tool leaves the active layer on B.Cu after a via, so the next click on a top trace selects nothing | F2A-018 | fix-now | D3 / W2 | frontend | S |
| [T-171](#t-171) | S3 | S15 export refusals (6+ layers, blind/buried vias) surface as a developer sentence under a DRC gate and 'Export anyway' box; Download is silently disabled, the offending via can't be found from the dialog, and nothing warns earlier | F2B-008 | fix-now | D3 / W2 | frontend | S |
| [T-172](#t-172) | S3 | Layer tab strip overflows (4+ layers at 1440, 2 layers at 1100); canvas squeezed to 458 px at 1100 | F2B-009, Q4-041 | fix-now | D3 / W2 | frontend | S |
| [T-173](#t-173) | S3 | At 1100×720 on a 4-layer board the route parameter row pushes the live route status (length, clear/N conflicts, warnings) off-screen; 'Standard 4L' wraps onto two lines | F2B-010 | fix-now | D3 / W2 | frontend | S |
| [T-174](#t-174) | S3 | No trace/via inspector: selecting a via or trace shows only 'Contents · Vias 1' — a blind via (F.Cu–In1.Cu) looks and inspects exactly like a through via; type, span, size, net and width are nowhere | F2B-011 | decide (P4) | D3 / proposal | proposal | M |
| [T-175](#t-175) | S3 | Light theme: status-danger text on the danger-soft box fails AA — export refusal / DRC-gate text #c2402f on #dececf is 3.3:1 | F2B-013 | fix-now | F0a / F0a | frontend | XS |
| [T-176](#t-176) | S3 | Cloud layout dialogs: signed-out dead end, developer error copy, no focus management | Q10-005, Q10-012 | fix-now | D3 / W2 | frontend | S |
| [T-177](#t-177) | S3 | Cloud layout entry points float over the canvas with shadows at 25 px, and the Auto-route/Auto-place panels cover the dock, layer strip, status bar and their own buttons; naming differs (Route Board… → 'Auto-route') | Q10-014 | fix-now | D3 / W2 | frontend | S |
| [T-178](#t-178) | S3 | Ctrl+H activates the Hole tool instead of cycling the layer display mode | Q4-002 | fix-now | D3 / W2 | frontend | XS |
| [T-179](#t-179) | S3 | Status-bar hint shows 'Click to select…' while Hole/Pad/Text/Zone/Keepout/Tune/Cutout tools are armed | Q4-003 | fix-now | D3 / W2 | frontend | S |
| [T-180](#t-180) | S3 | Route refusal notices show raw DRC codes (NET_SHORT_CIRCUIT, COPPER_OFF_BOARD…) and a developer tooltip | Q4-005 | fix-now | D3 / W2 | frontend | XS |
| [T-181](#t-181) | S3 | PCB status-bar zoom readout is frozen (shows the schematic's zoom, never updates on PCB) | Q4-006 | fix-now | D1 / W2 | frontend | S |
| [T-182](#t-182) | S3 | PCB toolbar dropdowns (Add, View, width, via) have no menu semantics or keyboard support; Esc does not close them | Q4-007 | fix-now | D3 / W2 | frontend | S |
| [T-183](#t-183) | S3 | Via size shown in three different orders/symbols (preset list drill/diameter vs chips Ø diameter ⌀ drill vs status diameter/drill) | Q4-009 | fix-now | D3 / W2 | frontend | XS |
| [T-184](#t-184) | S3 | Flipping to bottom view mirrors about the world origin, pushing the board half off-screen | Q4-010 | fix-now | D3 / W2 | frontend | XS |
| [T-185](#t-185) | S3 | Inactive-layer display mode 'Normal' dims other layers to 22% once a layer is focused; 'Normal' and 'Dim' look identical | Q4-013 | fix-now | D3 / W2 | frontend | XS |
| [T-186](#t-186) | S3 | PCB empty-canvas context menu advertises 'X' for route mode (real key R) and overflows the viewport bottom | Q4-015 | fix-now | D3 / W2 | frontend | XS |
| [T-187](#t-187) | S3 | Raw internal net/item IDs shown to users (status bar 'Trace · 51272803:15620728', DRC list 'trace 4f0646 ↔ net -10160 ↔ net -10277') | Q4-017 | fix-now | D3+D1 / W2 | frontend | S |
| [T-188](#t-188) | S3 | Cmd/Ctrl+A on PCB selects nothing on the board and instead text-highlights the entire app chrome | Q4-018 | fix-now | D3 / W2 | frontend | S |
| [T-189](#t-189) | S3 | Comment mode: PCB 'C' hotkey advertised but dead; Esc doesn't exit; drafts discarded silently | Q4-020, Q5-027 | fix-now | D3+D2 / W2 | frontend | S |
| [T-190](#t-190) | S3 | Board panel buttons use raw Unicode glyphs ('✏ Draw custom shape', '⭳ Import DXF…'); ⭳ renders as a tofu box | Q4-029 | fix-now | D3 / W2 | frontend | XS |
| [T-191](#t-191) | S3 | Free-hole inspector shows X/Y as raw 15-digit floats and read-only, although holes can be dragged | Q4-032 | fix-now | D3 / W2 | frontend | S |
| [T-192](#t-192) | S3 | Measure / sketch dimension labels are world-sized, off-token cyan and drawn under board items — the measured distance can be unreadable | Q4-034 | fix-now | D3 / W2 | frontend | S |
| [T-193](#t-193) | S3 | Footprint Properties are read-only: X/Y/Rotation/Side cannot be typed; multi-selection panel offers no actions | Q4-036 | fix-now | D3 / W2 | frontend | M |
| [T-194](#t-194) | S3 | PCB canvas clear colour is hard-coded #0e1116 (blue-cast) instead of --surface-canvas-well #08090a, in both themes | Q4-038 | fix-now | D3 / W2 | frontend | XS |
| [T-195](#t-195) | S3 | Export dialog checkboxes render in browser-default blue (#0075ff light), off the neutral token palette | Q4-039 | fix-now | D3 / W2 | frontend | XS |
| [T-196](#t-196) | S3 | DRC markers are fixed-size screen diamonds that bury the board at fit zoom (106 markers cover every pad) | Q4-043 | fix-now | D3 / W2 | frontend | M |
| [T-197](#t-197) | S3 | In Route mode before the first click, B switches to bottom copper but T quits Route and arms the Text tool (keymap advertises T/B = layer) | Q4-045 | fix-now | D3 / W2 | frontend | XS |
| [T-198](#t-198) | S3 | Selection filter covers only Traces/Vias/Pads/Components — zones, keepouts, free holes/pads, text and outline can't be filtered | Q4-046 | fix-now | D3 / W2 | frontend | S |
| [T-199](#t-199) | S3 | PCB controls off-spec: 18/20/32px inputs, 13px checkboxes, zone-net select clips 'GND' to 'GN', pour select crushed to 10px | Q4-050, F2A-021, Q4-012 | fix-now | D3 / W2 | frontend | M |
| [T-394](#t-394) | S3 | A drawn zone can only be selected by clicking exactly on its outline; clicking the pour does nothing, so Shift+Z 'Cutout' ('Select one unlocked polygon zone first') looks broken | F2A-019 | wont-fix | — / followup | frontend | S |
| [T-200](#t-200) | S4 | No in-flight feedback for PCB commands: Undo/moves on a slow backend look like no-ops for seconds | F1A-013 | fix-now | D3 / W2 | frontend | XS |
| [T-201](#t-201) | S4 | Export of an empty board (no parts, no copper, default 50×30 outline) reports 'DRC passed — no errors · no warnings' and produces a full 14-file fab bundle of empty layers | F1B-015 | defer | followup / followup | backend | XS |
| [T-202](#t-202) | S4 | PCB layer palette collisions (solder mask = drill black; In1 amber ≈ outline) | F1B-025, F2B-014 | defer | followup / followup | shared-package | S |
| [T-203](#t-203) | S4 | Routed traces end in sub-µm to 4 µm micro-segments at vias and pad terminations (45° + axis elbows built across a tiny residual offset) | F2A-009 | defer | followup / followup | frontend | S |
| [T-204](#t-204) | S4 | Pad-number labels rotate with the footprint: on 180°-rotated parts '1'/'2' are drawn upside-down | F2B-016 | defer | followup / followup | shared-package | XS |
| [T-205](#t-205) | S4 | Via preset menu offers 'Microvia 0.10 / 0.30 mm — HDI / BGA laser-drilled (Phase C)': internal roadmap copy, and picking it places a 0.1 mm THROUGH via | F2B-017 | fix-now | D3 / W2 | frontend | XS |
| [T-206](#t-206) | S4 | Tune (U) and Measure are hotkey-only and Bundle routing is unreachable: no toolbar/menu entry exposes them | Q4-035 | fix-now | D3 / W2 | frontend | S |
| [T-207](#t-207) | S4 | Components panel: Shift/Cmd+click does not multi-select and instead leaves a native text-selection highlight across rows | Q4-037 | fix-now | D3 / W2 | frontend | XS |
| [T-208](#t-208) | S4 | Selection filter panel ignores Esc and survives view switches; only F or its × closes it | Q4-048 | fix-now | D3 / W2 | frontend | XS |
| [T-209](#t-209) | S4 | PCB toolbar tooltips incomplete: Flip part/Fit board omit hotkeys, disabled Flip gives no reason, 'Add' tooltip omits Comment, DRC tooltip is just 'DRC' | Q4-051 | fix-now | D3 / W2 | frontend | XS |

## T-132

**PCB copper/net-class/length groups bound to ephemeral coordinate net ids — moving a schematic part orphans routing**

- Severity **S1** · category data · status confirmed · themes dark
- Recommendation **decide** · decision DEC-PCB3 · owner D3 · wave W2 · scope backend · estimate L
- Findings: F1B-013, F2A-014

**Summary.** Traces: after the move trace.netId is still 'pt:15240000:0' but that id no longer exists (resolves: false) — the routed trace now belongs to no net. The ratsnest edge reappears (0 → 1) and DRC jumps from 10 silk warnings to +2 NET_SHORT_CIRCUIT (the trace 'shorts' its own pads), +1 TRACK_DANGLING, +1 UNCONNECTED_NET. On QA-f1b-stress it already happened during normal editing: 1 of 21 traces (67fe2d…, netId 'pt:74920… | Also covers: F2A-014: Extension of F1B-013: the GND zone is NOT orphaned (it re-binds by netName) but its stitc…

**Root cause.** `src/modules/designer/backend/projection-world.ts:582` — net ids are `pt:<x>:<y>` union-find roots — change whenever a pin moves

**Proposed fix.** Backend: persist stable net identity (net name/uuid) on copper, net classes and length groups; re-bind on projection. — Detail: Stop persisting coordinate net ids. Store the stable pad address (`${placementId}|${padNumber}`, per designer/AGENTS.md IDENTITY) or the net name on traces/vias/zones and in perNetClassAssignments/lengthMatchGroups, then resolve to the live net.id through padNets at projection time. Minimal fix: in pcb-projection.ts re-bind any trace/via whose stored netId is absent from netNames by the net of the pads its endpoints touch. Add a regression test: route, move_part, expect identical DRC and 0 ratsnest.

**Evidence.** [114-tracenet-after-schem-move](../evidence/shots/f1b/dark/114-tracenet-after-schem-move.png), [081-drc-final](../evidence/shots/f2a/dark/081-drc-final.png), [033-schem-before-gnd-move](../evidence/shots/vf2a/dark/033-schem-before-gnd-move.png)

<details><summary>F1B-013 — PCB copper, net-class assignments and length groups are bound to ephemeral coordinate net ids: moving a schematic part (connectivity unchanged) orphans every routed trace on that net — DRC then reports false shorts/dangling tracks and the ratsnest reappears (S1, confirmed)</summary>

- Area designer.pcb · stack A · design 38bbcc7f-b8e5-43ff-9c3e-681206aa3ce4 · themes dark · viewports 1440x900
- Repro:
  1. Create QA-f1b-tracenet: place two resistors 20.32 mm apart and wire R1.2→R2.1 (place_part ×2 + create_wire, same as the UI)
  2. PCB: route the net R1.2–R2.1 (pcb_add_trace F.Cu, netId = the net's id 'pt:15240000:0' — exactly what the route tool stores) → Run DRC: only 10 stock silk warnings, ratsnest 0
  3. Schematic: move R1 and R2 by +10.16 mm each (move_part; the wire still joins the same two pins, the netlist is identical)
  4. PCB projection + Run DRC again
  5. Also (net classes): assign the net to Power and add it to a length group in Design rules (QA-f1b-netid), move the parts, then move a capacitor so its pin lands on the old coordinate
- Expected: Net identity is stable across geometry edits (keyed on a stable pad address or persisted net identity, as src/modules/designer/AGENTS.md 'IDENTITY' requires): traces, vias, zones, net-class assignments and length groups follow the net; a pure schematic move never changes PCB connectivity or DRC.
- Actual: Traces: after the move trace.netId is still 'pt:15240000:0' but that id no longer exists (resolves: false) — the routed trace now belongs to no net. The ratsnest edge reappears (0 → 1) and DRC jumps from 10 silk warnings to +2 NET_SHORT_CIRCUIT (the trace 'shorts' its own pads), +1 TRACK_DANGLING, +1 UNCONNECTED_NET. On QA-f1b-stress it already happened during normal editing: 1 of 21 traces (67fe2d…, netId 'pt:74920000:-40000000') no longer resolves after earlier part moves, and the DRC view shows it as 'trace 67fe2d ↔ Q7.1 ↔ net pt:749 ↔ Net_18' / '… Q7.2 ↔ net pt:749 ↔ Net_330' shorts (raw truncated id because the orphaned net has no name). The UI route tool stores the same coordinate ids (UI-routed trace 88f4fff1 netId 'pt:120000000:-10160000'), so hand-routed boards are affected identically. Every schematic tidy-up after routing therefore silently un-routes the board and the export DRC gate blocks on phantom shorts. Net classes / length groups (original report): the assignment and group entry dangle (perNetClassAssignments still {'pt:14920000:0':'power'} but no net has that id). After C1 is moved onto the old coordinate, projection netNames['pt:14920000:0'] = 'Net_2' is C1's single-pin net — it silently becomes a Power-class net and a member of length group G1. Auto net names also renumber (Net_2→Net_1), so the user cannot recognise the lost assignment. Route width/clearance and NETCLASS/LENGTH DRC follow the wrong net.
- Screenshots: [114-tracenet-after-schem-move](../evidence/shots/f1b/dark/114-tracenet-after-schem-move.png), [113-stress-drc-view-rerun](../evidence/shots/f1b/dark/113-stress-drc-view-rerun.png)
- Network: `POST /designs/0d2709d2…/commands pcb_set_design_rules → ok rev4`; `POST move_part ×2 → ok`; `GET /designs/0d2709d2…/projection/pcb → netNames {'pt:14920000:0':'Net_2' (C1 pad 1 only), 'pt:25080000:10160000':'Net_3' (R1–R2)}, board.perNetClassAssignments {'pt:14920000:0':'power'}`; `QA-f1b-tracenet 38bbcc7f: before move trace.netId pt:15240000:0 resolves:true (Net_2), ratsnest 0, DRC {FAB_SILK_CLEARANCE:8, FAB_SILK_WIDTH:2}`; `after move_part ×2: trace.netId pt:15240000:0 resolves:false, ratsnest 1, DRC {FAB_SILK_CLEARANCE:8, FAB_SILK_WIDTH:2, NET_SHORT_CIRCUIT:2, TRACK_DANGLING:1, UNCONNECTED_NET:1}`; `QA-f1b-stress rev693: traces 21, resolving 20; DRC NET_SHORT_CIRCUIT anchors {trace 67fe2d47…, pad Q7.1, net pt:74920000:-40000000 (not in netNames), net pt:100000000:-36190000}`
- Code: `src/modules/designer/backend/projection-world.ts:582` — net ids are `pt:<x>:<y>` union-find roots — change whenever a pin moves
- Code: `src/sdks/designer/types.ts:886` — perNetClassAssignments keyed netId → classId
- Code: `src/sdks/designer/types.ts:912` — lengthMatchGroups keep dangling net ids 'nets may reappear'
- Code: `src/modules/designer/AGENTS.md:45` — 'Net ids are ephemeral and must never be persisted against'
- Code: `src/modules/designer/backend/pcb/pcb-projection.ts:120` — bindNetName skips entities whose netId is already set, so stale coordinate ids never re-bind (even for named nets)
- Suggested fix: Stop persisting coordinate net ids. Store the stable pad address (`${placementId}|${padNumber}`, per designer/AGENTS.md IDENTITY) or the net name on traces/vias/zones and in perNetClassAssignments/lengthMatchGroups, then resolve to the live net.id through padNets at projection time. Minimal fix: in pcb-projection.ts re-bind any trace/via whose stored netId is absent from netNames by the net of the pads its endpoints touch. Add a regression test: route, move_part, expect identical DRC and 0 ratsnest.
- Verification (vf1b): **confirmed** — Reproduced independently on a fresh design, QA-vf1b-netid (7af2033c). I placed two resistors, wired R1.2-R2.1 (net 'pt:15240000:0'), spread them on the PCB, routed a pcb_add_trace with that netId and assigned the net to Power. Before: trace netId resolves, ratsnest 0, DRC {FAB_SILK_CLEARANCE:8, FAB_SILK_WIDTH:2}. Then I moved R1 and R2 by +10.16 mm in the schematic (netlist unchanged). After: trace netId no longer resolves, ratsnest 1, DRC adds NET_SHORT_CIRCUIT 2 + TRACK_DANGLING 1 + UNCONNECTED_NET 1, and perNetClassAssignments still holds the dead id while the live net is 'pt:25400000:10160000'. On QA-f1b-stress the UI-routed trace 88f4fff1 stores netId 'pt:120000000:-10160000' with netName null, so hand routing is affected too. Refutation check: designer/AGENTS.md documents net-id instability as a design constraint, but it also says 'Never store a net.id' and that traces re-bind by name. pcb-projection.ts bindNetName only re-binds when netId is null (`if (entity.netId || !entity.netName) return entity`), so stored coordinate ids never re-bind, even for named nets. S1 kept: routed copper silently becomes phantom shorts that block export. · evidence: API QA-vf1b-netid before {trace resolves:true, ratsnest:0, drc:{FAB_SILK_CLEARANCE:8,FAB_SILK_WIDTH:2}} after move {resolves:false, ratsnest:1, +NET_SHORT_CIRCUIT:2,TRACK_DANGLING:1,UNCONNECTED_NET:1}, API QA-f1b-stress: trace 88f4fff1 netId pt:120000000:-10160000 netName None; trace 67fe2d47 netId pt:74920000:-40000000 resolves False, src/modules/designer/backend/pcb/pcb-projection.ts:115-124 bindNetName

</details>

<details><summary>F2A-014 — Extension of F1B-013: the GND zone is NOT orphaned (it re-binds by netName) but its stitching vias and GND traces are — so after a schematic GND-port nudge the pour carves clearance around its own vias and the board silently loses GND (S1, duplicate)</summary>

- Area designer.pcb · stack A · design 847e94e7-36e6-4284-b22c-17725e0f5b02 · themes dark · viewports 1440x900
- Repro:
  1. QA-f2a-golden: routed + B.Cu GND thermal pour, DRC 0 errors (rev 125)
  2. Schematic: drag the GND port next to J1 by ~2.7 mm (connectivity unchanged: same 5 GND pins, same wires)
  3. GET /projection/pcb; PCB → Run DRC
- Expected: Zone, vias and traces all keep their GND binding (stable net identity) — a schematic tidy-up never touches PCB connectivity.
- Actual: GND id changes pt:26142006:12740371 → pt:28870061:12740371 (the union-find root was that port). Both zones follow (zone.netName 'GND' is re-resolved in pcb-projection.ts), but the 3 GND vias and 4 GND traces keep the old id (not in netNames). The pour therefore treats them as foreign copper: black clearance rings/channel around the GND vias and the B.Cu J1.2→C2.2 trace (crop f2a/crop-gnd-orphan.png), ratsnest 0→4, DRC 0→6 errors (5× NET_SHORT_CIRCUIT 'trace and pad on different nets overlap', UNCONNECTED_NET GND 4 airwires) + 3× VIA_DANGLING + 4× TRACK_DANGLING. Exported now, the GND vias would be isolated islands in the plane. Moving U1 instead orphans only Net_1/Net_2 traces (5) — zones unaffected. Undo of the port move restores everything.
- Screenshots: [081-drc-final](../evidence/shots/f2a/dark/081-drc-final.png), [102-pcb-after-gndport-move](../evidence/shots/f2a/dark/102-pcb-after-gndport-move.png), `f2a/crop-gnd-orphan.png`, [101-schem-move-gndport](../evidence/shots/f2a/dark/101-schem-move-gndport.png)
- Network: `projection rev133: zones netId pt:28870061:12740371 (resolves) ; vias af552324/34d9e23f/1dffe009 netId pt:26142006:12740371 (orphan) ; traces 0479b885/225acf78/977163b2/cdff5b79 orphan`; `GET /drc rev133: errors 6 (NET_SHORT_CIRCUIT ×5, UNCONNECTED_NET ×1)`
- Code: `src/modules/designer/backend/pcb/pcb-projection.ts:126` — zones re-bind netName→netId each projection; traces/vias keep the stored coordinate id
- Code: `src/modules/designer/backend/projection-world.ts:819` — net id = union-find root 'pt:x:y', changes with any geometry edit of the root point
- Suggested fix: Same fix as F1B-013 (persisted/stable net identity); as a stop-gap re-bind vias and traces exactly like zones (by stored netName, falling back to pad-anchored connectivity), so all copper on a net moves together.
- Verification (vf2a): **duplicate** — Reproduced on the golden design: dragged the GND port next to J1 about 2.7 mm in the schematic (rev 143→144). The GND net id changed pt:26142006:12740371 → pt:26142006:10039494 with the same 5 pins. Both zones re-bound by netName, while vias 1dffe009/34d9e23f/af552324 and traces 0479b885/225acf78/977163b2/cdff5b79 kept the dead id; ratsnest went 0→4. The PCB shows black clearance around the GND vias and the B.Cu GND trace (shot 035). Toolbar Undo restored everything (rev 145). Same root cause and fix as F1B-013 (confirmed S1): coordinate net ids persisted on copper. The zone-rebinds-but-vias-don't detail belongs in F1B-013's stop-gap fix. · evidence: [033-schem-before-gnd-move](../evidence/shots/vf2a/dark/033-schem-before-gnd-move.png), [034-schem-after-gnd-move](../evidence/shots/vf2a/dark/034-schem-after-gnd-move.png), [035-pcb-after-gnd-port-move](../evidence/shots/vf2a/dark/035-pcb-after-gnd-port-move.png), projection rev 144: 3 vias + 4 traces netId pt:26142006:12740371 unresolved; zones pt:26142006:10039494

</details>


## T-133

**PCB hotkeys fire while typing (dock composer, comments, selects) and behind Export dialog — text mangled, parts deleted**

- Severity **S1** · category keyboard · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: Q4-019, Q5-024, Q8-023, Q4-040 · known ref K12
- Depends on: ['T-002']

**Summary.** Text is silently corrupted (letters r,o,t,h,z,k,p,m,u,f,v,w,b… are preventDefault-ed and executed as tool hotkeys). Backspace in the composer did NOT delete a character but deleted the selected trace (projection traces 22 → 21, rev 505→506, selection cleared) — invisible data loss while the user is typing a chat message. F would flip a selected part, R rotate it, Delete delete it. Same in the Properties dock: Backsp… | Also covers: Q5-024: PCB hotkeys fire while typing in the comment composer — letters vanish, tools toggle, and…; Q8-023: Typing in the Assistant dock on the PCB view fires PCB hotkeys: letters are swallowed, to…; Q4-040: PCB hotkeys stay live behind the Export dialog: Delete removes the selected item, R/B swi…

**Root cause.** `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4342` — if (event.target instanceof HTMLInputElement) return; — textarea/select/contenteditable not excluded

**Proposed fix.** PCB keymap uses shared shortcut guard: ignore editable targets (textarea/select/contenteditable) and open modals — no tool switches/deletes while typing. — Detail: Replace the guard with a shared isEditableTarget(e.target) (input, textarea, select, [contenteditable], role=textbox, and anything inside a dialog/dock that isn't the canvas) and apply it to every window keydown listener in the designer (PcbCanvas onKey + onShiftKey, SchematicCanvas, Space Cmd+K/W). Better: attach the keymap to the canvas container with focus-within semantics.

**Evidence.** [094-comment-typing](../evidence/shots/q4/dark/094-comment-typing.png), [005-backspace-composer-deletes-trace](../evidence/shots/vq4/dark/005-backspace-composer-deletes-trace.png), [077-pcb-comment-thread](../evidence/shots/q5/dark/077-pcb-comment-thread.png)

<details><summary>Q4-019 — PCB hotkeys fire while typing in textareas: Assistant/comment text is mangled and Backspace deletes the selected board item (S1, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. Open 'Dual LED Blinker' → PCB view → right dock 'Assistant' tab
  2. Click the 'Ask about this design…' composer and type 'rotate test' → composer shows 'ae es' (r/o/t swallowed; each toggles Route/Board/Text tools behind the scenes)
  3. Click a trace on the board (status 'Trace · GND'), click back into the composer, press Backspace to fix a typo
  4. Same with the PCB comment composer (Add → Comment, click board, type 'rotate test' → 'ae es')
  5. Also in the Properties inspector: select a free pad → focus its 'Shape' <select> and press R → Route tool activates (Route (R) aria-pressed=true); focus its 'Layer' <select> and press Backspace → the pad is deleted (rev 27→28)
- Expected: Keys typed into any text field (textarea, contenteditable, select) never reach the PCB keymap
- Actual: Text is silently corrupted (letters r,o,t,h,z,k,p,m,u,f,v,w,b… are preventDefault-ed and executed as tool hotkeys). Backspace in the composer did NOT delete a character but deleted the selected trace (projection traces 22 → 21, rev 505→506, selection cleared) — invisible data loss while the user is typing a chat message. F would flip a selected part, R rotate it, Delete delete it. Same in the Properties dock: Backspace in the pad 'Layer' <select> deletes the pad; R in the 'Shape' <select> enters Route mode.
- Screenshots: [094-comment-typing](../evidence/shots/q4/dark/094-comment-typing.png), [096-assistant-typing](../evidence/shots/q4/dark/096-assistant-typing.png), [097-backspace-in-composer-deletes-trace](../evidence/shots/q4/dark/097-backspace-in-composer-deletes-trace.png), [156-r-in-select](../evidence/shots/q4/dark/156-r-in-select.png), [005-backspace-composer-deletes-trace](../evidence/shots/vq4/dark/005-backspace-composer-deletes-trace.png), [035-backspace-select-deletes-pad](../evidence/shots/vq4/dark/035-backspace-select-deletes-pad.png)
- Network: `POST /designs/c2c58a19/commands (trace delete) fired while focus was in TEXTAREA 'Ask about this design…'`
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4342` — if (event.target instanceof HTMLInputElement) return; — textarea/select/contenteditable not excluded
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:5012` — Delete/Backspace deletes selection
- Suggested fix: Replace the guard with a shared isEditableTarget(e.target) (input, textarea, select, [contenteditable], role=textbox, and anything inside a dialog/dock that isn't the canvas) and apply it to every window keydown listener in the designer (PcbCanvas onKey + onShiftKey, SchematicCanvas, Space Cmd+K/W). Better: attach the keymap to the canvas container with focus-within semantics.
- Verification (vq4): **confirmed** — Reproduced (S1 kept): with a trace selected, typing 'rotate' in the dock Assistant composer produced 'ae'; Backspace in the TEXTAREA deleted the selected trace (traces 22->21, rev 520->521) and left the text unchanged. In the free-pad inspector R in the 'Shape' <select> armed Route, and Backspace in the 'Layer' <select> deleted the pad (freePads 1->0, rev 39->40). Both restored with Cmd+Z. Guard at PcbCanvas.tsx:4342 only exempts HTMLInputElement. Same root cause as Q5-024 and Q8-023 in other agents' files (cross-file dedupe candidate). · evidence: [005-backspace-composer-deletes-trace](../evidence/shots/vq4/dark/005-backspace-composer-deletes-trace.png), [035-backspace-select-deletes-pad](../evidence/shots/vq4/dark/035-backspace-select-deletes-pad.png)

</details>

<details><summary>Q5-024 — PCB hotkeys fire while typing in the comment composer — letters vanish, tools toggle, and Backspace deletes the selected part (S1, confirmed)</summary>

- Area designer.comments · stack A · design 370447e2-d91e-43f1-b0a5-e7dc9f6bcafe · themes dark · viewports 1440x900
- Repro:
  1. Open 'LED Indicators 5V' → PCB, select R8 in the Components list
  2. Add ▾ → Comment, click an empty board spot, click INTO the composer textarea (activeElement=TEXTAREA)
  3. Type 'x' then press Backspace
  4. Separately: type 'QA-q5 PCB comment: parts overlap at centre' and press ⌘Enter
- Expected: Keystrokes inside a textarea only edit the text; canvas shortcuts are suppressed.
- Actual: PcbCanvas' window keydown handler only ignores <input> targets, so inside the <textarea> it preventDefaults and executes shortcuts: Backspace dispatched POST /commands {type:'pcb_delete_placement', placementId:'39243258…'} (R8 deleted → revision 71→72, re-synced as a new placement id 497fba3c…), while the 'x' stayed in the box (Backspace can't correct typos). Typing a sentence saved the comment as 'QA-q5 C cen: as vela a cene' (P,B,o,m,t,r,l,p… eaten), switched on Route mode, and 'B' twice sent pcb_set_active_layer B.Cu twice with baseRevision 70 → second answered REVISION_CONFLICT and a red 'Revision conflict. Please retry after refresh.' banner appeared. Same applies to the thread 'Reply to thread…' textarea on PCB.
- Screenshots: [077-pcb-comment-thread](../evidence/shots/q5/dark/077-pcb-comment-thread.png), [079-pcb-comment-thread](../evidence/shots/q5/dark/079-pcb-comment-thread.png), [080-pcb-composer-backspace](../evidence/shots/q5/dark/080-pcb-composer-backspace.png)
- Network: `POST …/370447e2…/commands {command:{type:'pcb_delete_placement',placementId:'39243258-7cfc-42f2-876c-e0fef976511a'}} → ok, revision 72 (issued from Backspace in the comment textarea)`; `POST …/commands pcb_set_active_layer B.Cu (baseRevision 70) → ok r71; second identical → {ok:false, code:'REVISION_CONFLICT'}`
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4342` — keymap guard only checks INPUT
- Code: `src/modules/designer/frontend/components/comments/CommentComposerPopup.tsx:86` — Textarea inside canvas overlay
- Suggested fix: Use the shared isEditableShortcutTarget() guard (INPUT/TEXTAREA/SELECT/contenteditable) in the PCB keymap like SchematicCanvas does; additionally stopPropagation of keydown inside the comment popups; serialize PCB commands so rapid hotkeys use the latest revision.
- Verification (vq5): **confirmed** — Reproduced on own 370447e2: selected R8 in Components, Add -> Comment, clicked empty board, clicked into the composer textarea (activeElement TEXTAREA), typed 'x' then Backspace -> POST /commands {type:'pcb_delete_placement', placementId:'497fba3c…'} baseRevision 74 -> ok revision 75; the 'x' stayed in the textarea. R8 was re-created by schematic sync with a new id (3ec0cd1d) at its default position — in a placed/routed board the position/rotation/layer and the part's routing context would be lost. Root cause PcbCanvas.tsx:4342 `if (event.target instanceof HTMLInputElement) return;` (no TEXTAREA/SELECT/contenteditable), unlike SchematicCanvas/Space which use isEditableShortcutTarget. K12 confirmed. S1 kept: ordinary typo correction in a text box deletes a part. · evidence: [023-pcb-composer-backspace](../evidence/shots/vq5/dark/023-pcb-composer-backspace.png), network: POST …/370447e2…/commands {command:{type:'pcb_delete_placement',placementId:'497fba3c-feca-478d-83e9-d82db3c7da5f'}} -> ok r75 (issued from Backspace in the comment textarea)

</details>

<details><summary>Q8-023 — Typing in the Assistant dock on the PCB view fires PCB hotkeys: letters are swallowed, tools switch, selected parts rotate/flip/delete, Cmd+Z undoes the design (S1, confirmed)</summary>

- Area assistant.dock · stack A · design 3d5d1f7c · themes dark · viewports 1440x900
- Repro:
  1. Designer → open 'S3 Smoke — 5 LED indicators (v2)' → PCB tab → Cmd+I (Assistant dock) → click 'Ask about this design…'
  2. Type 'Route the power traces on top layer'
  3. Select D2 in the Components list, click the composer, type 'rf'
  4. Select D1, click composer (contains 'typo'), press Backspace
  5. Press Cmd+Z inside the composer
- Expected: All keystrokes go to the textarea; PCB keymap ignores events whose target is a textarea/select/contenteditable.
- Actual: Composer value became 'e e we aces n  laye' (R,o,t,h,p,o,r,t,c,s,o,t,p,y… swallowed) and the PCB switched to Route (R) mode; z→Zone, k→Keepout tool. With D2 selected, typing 'r' rotated D2 0°→90° (design rev 42→43). With D1 selected, Backspace in the composer deleted D1's placement (POST /commands, rev 40→41, placement id ce73e36f→11fd8b2e re-synced) instead of deleting a character. Cmd+Z in the composer undid the design (rev 42) and left the text untouched. All changes silently mutate the user's board while they type a question. (Restored via Undo afterwards.)
- Screenshots: [022-k12-dock-typing-swallowed](../evidence/shots/vq8/dark/022-k12-dock-typing-swallowed.png), [023-k12-r-rotates-selected](../evidence/shots/vq8/dark/023-k12-r-rotates-selected.png), [053-k12-route-mode-from-dock-typing](../evidence/shots/q8/dark/053-k12-route-mode-from-dock-typing.png), [055-k12-swallowed-chars](../evidence/shots/q8/dark/055-k12-swallowed-chars.png), [056-k12-backspace-deletes-part](../evidence/shots/q8/dark/056-k12-backspace-deletes-part.png), [057-k12-rf-rotates-flips-part](../evidence/shots/q8/dark/057-k12-rf-rotates-flips-part.png)
- Network: `POST /api/modules/designer/designs/3d5d1f7c…/commands 200 (typing 'r' in dock textarea) -> projection D2 rotationDeg 0 -> 90`; `POST /api/modules/designer/designs/3d5d1f7c…/history/undo 200 (Cmd+Z in dock textarea)`; `POST /api/modules/designer/designs/3d5d1f7c…/commands 200 (Backspace in dock textarea)`; `projection/pcb: D2 rotationDeg 0 → 90 after typing 'r' in composer`
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4342` — if (event.target instanceof HTMLInputElement) return; — textarea/select/contenteditable not excluded
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:5012` — Delete/Backspace deletes selection
- Suggested fix: Use a shared isEditableTarget(e.target) guard (input, textarea, select, [contenteditable], role=textbox) at the top of every window keydown handler in PcbCanvas (and the schematic/3D keymaps); also skip when e.defaultPrevented or when focus is inside the dock (closest('[data-dock]')).
- Verification (vq8): **confirmed** — Reproduced on own 3d5d1f7c, PCB tab, Cmd+I dock: typing 'Route the power traces on top layer' into the composer left 'e e we aces n  laye' and toggled Route (R) + 45° on; with D2 selected via Components list, typing 'r' in the composer rotated D2 0->90 (rev 44->45, composer stayed empty); typing 'ab' kept only 'a' ('b' = lock B.Cu) and a further design command was posted; Cmd+Z inside the composer posted /history/undo (rev 46->47) and left the text untouched. Restored with toolbar Undo (rev 48, all placements 0° F.Cu). Backspace-deletes-selection not re-run (destructive); same guard at PcbCanvas.tsx:5012 and identical root cause independently reproduced as Q5-024 (comment composer) - cross-agent duplicate for triage. Guard at PcbCanvas.tsx:4342 only checks HTMLInputElement. S1 kept (silent design mutation while typing). · evidence: [022-k12-dock-typing-swallowed](../evidence/shots/vq8/dark/022-k12-dock-typing-swallowed.png), [023-k12-r-rotates-selected](../evidence/shots/vq8/dark/023-k12-r-rotates-selected.png)

</details>

<details><summary>Q4-040 — PCB hotkeys stay live behind the Export dialog: Delete removes the selected item, R/B switch tool/layer under the modal (S2, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes light, dark · viewports 1440x900, 1100x720
- Repro:
  1. Dual LED Blinker → PCB → click the free mounting hole (bottom-right) to select it
  2. Click 'Export…' (focus stays on the Export… button; dialog opens)
  3. Press Delete
  4. Close the dialog; also: with the dialog open press R, then B
- Expected: A modal owns the keyboard: focus moves into it and canvas hotkeys are suspended until it closes
- Actual: Delete with the Export dialog open deleted the hole (projection holes 1 → 0, rev 513) with no visible feedback behind the backdrop; R armed Route mode (route parameter row appeared above the dialog) and B switched the active layer to Bottom Copper. Cmd+Z restored the hole. Same keymap gap as the Design rules dialog (Q4-022) and textareas (K12/Q4-019): the window keydown handler only ignores HTMLInputElement targets and never checks for an open modal.
- Screenshots: [011-1100-route-row](../evidence/shots/q4/light/011-1100-route-row.png), [013-delete-behind-export](../evidence/shots/q4/light/013-delete-behind-export.png), [006-keys-behind-export](../evidence/shots/vq4/dark/006-keys-behind-export.png)
- Network: `projection freeHoles 1 → 0 at rev 513 while Export dialog open; Cmd+Z → holes 1 rev 514`
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4342` — onKey: only HTMLInputElement targets are ignored
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:743` — exportDialogOpen state exists but is not consulted by the keymap
- Suggested fix: At the top of PcbCanvas onKey (and onShiftKey) return early when any PCB modal is open (exportDialogOpen, rules dialog, cornerOp, edgeDim, DXF modal) or when `document.querySelector('[aria-modal="true"]')` exists / event.target is inside [role=dialog]; move focus into the Export dialog on open.
- Verification (vq4): **confirmed** — Reproduced on c2c58a19: selected the free hole, opened Export… (focus stayed on the Export… button, dialog aria-modal=true), pressed Delete: freeHoles 1->0 (rev 523) behind the backdrop. R then armed Route (param row appeared above the modal) and B switched to Bottom Copper. Restored with Cmd+Z. Distinct from Q4-019: the target here is a <button>, so even a textarea/select guard would not help. The keymap needs modal awareness. · evidence: [006-keys-behind-export](../evidence/shots/vq4/dark/006-keys-behind-export.png)

</details>


## T-134

**Concurrent edits rejected with 'Revision conflict' (drag while saving, Alt+click layer solo)**

- Severity **S2** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D1+D3 · wave W2 · scope frontend · estimate M
- Findings: F1A-003, Q4-011

**Summary.** Both envelopes carry baseRevision 15. J1's move is saved (rev 16); R2's gets {ok:false, code:'REVISION_CONFLICT', expected 15, actual 16}. R2 snaps back, and a 6 s toast says 'Revision conflict. Please retry after refresh.', telling the user to reload after a normal action. While both are in flight, J1 also jumps back to its old position, because the second drag replaces the single committedDragOverride map, then J1… | Also covers: Q4-011: Alt+click layer solo fails with 'Revision conflict. Please retry after refresh.' (two com…

**Root cause.** `src/modules/designer/frontend/hooks/useDesignerWorkspace.ts:505` — baseRevision read from projectionRef, which only advances when a response returns; concurrent PCB envelopes share it

**Proposed fix.** Serialize dispatches in useDesignerWorkspace (queue, rebase baseRevision on each); D3 sends Alt+click solo as one command or awaits. — Detail: useDesignerWorkspace.ts dispatchEnvelope (:485-530): chain every dispatch for a design on a promise queue (queueRef.current = queueRef.current.then(() => send())) so each envelope takes baseRevision from the previous result (same fix as Q4-011). PcbCanvas.tsx: make committedDragOverride a Map merged per placementId and remove only that command's entries when it settles. Replace the 'retry after refresh' copy: on REVISION_CONFLICT for a move, refetch and re-dispatch once.

**Evidence.** [057-drag-race-after-first](../evidence/shots/f1a/dark/057-drag-race-after-first.png), [031-drag-race-after-first](../evidence/shots/vf1a/dark/031-drag-race-after-first.png), [053-alt-solo](../evidence/shots/q4/dark/053-alt-solo.png)

<details><summary>F1A-003 — A PCB edit made while the previous one is still saving is rejected with 'Revision conflict. Please retry after refresh.' and snaps back (S3, confirmed)</summary>

- Area designer.pcb · stack A · design 91573bb6-cb22-4ca4-a8d9-58057a1ff45b · themes dark · viewports 1440x900
- Repro:
  1. PCB view, DRC markers hidden (View ▾ › DRC markers), latency shim 2.5 s (simulates a slow backend)
  2. Drag J1 70 px down, release, and within ~0.5 s drag R2 to a new spot
  3. Watch the canvas for 8 s, then GET projection/pcb
- Expected: Commands are serialized (or rebased): both moves persist, and the first part stays where it was dropped while its save is in flight.
- Actual: Both envelopes carry baseRevision 15. J1's move is saved (rev 16); R2's gets {ok:false, code:'REVISION_CONFLICT', expected 15, actual 16}. R2 snaps back, and a 6 s toast says 'Revision conflict. Please retry after refresh.', telling the user to reload after a normal action. While both are in flight, J1 also jumps back to its old position, because the second drag replaces the single committedDragOverride map, then J1 reappears when the refresh lands. Reproduced 2/2. Same root cause as Q4-011 (Alt+click solo sends two commands with one baseRevision): the PCB command path has no queue.
- Screenshots: [057-drag-race-after-first](../evidence/shots/f1a/dark/057-drag-race-after-first.png), [058-drag-race-after-second](../evidence/shots/f1a/dark/058-drag-race-after-second.png), [059-drag-race-settled](../evidence/shots/f1a/dark/059-drag-race-settled.png), [060-drag-race-conflict-toast](../evidence/shots/f1a/dark/060-drag-race-conflict-toast.png)
- Network: `POST /commands pcb_move_placement J1 baseRevision 15 → {ok:true, revision:16}`; `POST /commands pcb_move_placement R2 baseRevision 15 → {ok:false, code:'REVISION_CONFLICT', conflict:{expected:15, actual:16}}`; `GET projection/pcb → J1 moved, R2 unchanged (15,-8)`
- Code: `src/modules/designer/frontend/hooks/useDesignerWorkspace.ts:505` — baseRevision read from projectionRef, which only advances when a response returns; concurrent PCB envelopes share it
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:3753` — setCommittedDragOverride(optimistic) replaces the previous drag's optimistic map; also cleared to null on selection changes (:3284 etc.)
- Code: `src/modules/designer/frontend/hooks/useDesignerWorkspace.ts:104` — user-facing copy 'Revision conflict. Please retry after refresh.'
- Suggested fix: useDesignerWorkspace.ts dispatchEnvelope (:485-530): chain every dispatch for a design on a promise queue (queueRef.current = queueRef.current.then(() => send())) so each envelope takes baseRevision from the previous result (same fix as Q4-011). PcbCanvas.tsx: make committedDragOverride a Map merged per placementId and remove only that command's entries when it settles. Replace the 'retry after refresh' copy: on REVISION_CONFLICT for a move, refetch and re-dispatch once.
- Verification (vf1a): **confirmed** — Reproduced with the in-page 2.5 s fetch shim: dragged C1, then J1 within 150 ms -> both envelopes base=28; C1 saved (rev 29), J1 -> {ok:false, REVISION_CONFLICT, expected 28, actual 29}; J1 snapped back and a role=alert toast read 'Revision conflict. Please retry after refresh.'; C1 jumped back to its old spot while its save was in flight (second drag replaced the single committedDragOverride). Also in a first attempt, merely clicking a trace while C1's move was in flight made C1 jump back (setCommittedDragOverride(null) on selection change). Severity lowered S2->S3: this is latency-only. On the real loopback stack a pcb_move_placement round trip measured 8-21 ms, so a human cannot start a second drag inside the window; it needs a slow or busy backend. The root cause (no serialized PCB dispatch; baseRevision shared by concurrent envelopes) is the same as Q4-011 (S2), whose robust fix already proposes the dispatchEnvelope promise queue; fix once there. · evidence: [031-drag-race-after-first](../evidence/shots/vf1a/dark/031-drag-race-after-first.png), [032-drag-race-after-second](../evidence/shots/vf1a/dark/032-drag-race-after-second.png), [033-drag-race-conflict-toast](../evidence/shots/vf1a/dark/033-drag-race-conflict-toast.png), [022-drag-race-after-second](../evidence/shots/vf1a/dark/022-drag-race-after-second.png), network: pcb_move_placement f2a87d5f base=28 -> ok rev 29; pcb_move_placement 8097ec81 base=28 -> REVISION_CONFLICT expected 28 actual 29, loopback timing: pcb_move_placement round trip 8-21 ms (curl), projection/pcb 2 ms

</details>

<details><summary>Q4-011 — Alt+click layer solo fails with 'Revision conflict. Please retry after refresh.' (two commands sent with same baseRevision) (S2, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark, light · viewports 1440x900
- Repro:
  1. PCB view, Layers panel
  2. Alt+click the 'Top Copper F.Cu' row (while Bottom Copper is active) — or Alt+click 'Bottom Copper'
  3. Observe toast at top of canvas and inline error in Board properties
- Expected: Layer soloed and made active, no error
- Actual: Two POST /commands are fired back-to-back with the same baseRevision (pcb_set_visible_layers and pcb_set_active_layer, both baseRevision 474); the second returns {ok:false, code:'REVISION_CONFLICT', expected 474, actual 475}. User sees 'Revision conflict. Please retry after refresh.' in a toast and in the Board panel; active layer silently stays on the old layer (status bar still 'Bottom Copper' while Top Copper is soloed). Reproduced in light on QA-q4-board (Alt+click 'Bottom Copper'): toast + Board-panel error 'Revision conflict. Please retry after refresh.'; the layer strip keeps 'Top Copper' selected while B.Cu is SOLO.
- Screenshots: [053-alt-solo](../evidence/shots/q4/dark/053-alt-solo.png), [057-alt-solo-bottom](../evidence/shots/q4/dark/057-alt-solo-bottom.png), [022-alt-solo-toast](../evidence/shots/q4/light/022-alt-solo-toast.png), [010-alt-solo](../evidence/shots/vq4/dark/010-alt-solo.png), [011-unsolo](../evidence/shots/vq4/dark/011-unsolo.png), [012-normal-after-focus](../evidence/shots/vq4/dark/012-normal-after-focus.png), [001-alt-solo-qa](../evidence/shots/vq4/light/001-alt-solo-qa.png)
- Network: `POST /designs/c2c58a19/commands {pcb_set_visible_layers, baseRevision 474} → ok revision 475`; `POST /designs/c2c58a19/commands {pcb_set_active_layer F.Cu, baseRevision 474} → ok:false REVISION_CONFLICT`
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:6590` — void setVisibleLayers(...) then void setActiveLayer(...) not awaited
- Code: `src/modules/designer/frontend/hooks/useDesignerWorkspace.ts:505` — baseRevision read from projectionRef at send time; parallel sends share it
- Code: `src/modules/designer/frontend/hooks/useDesignerWorkspace.ts:104` — conflict message
- Suggested fix: In onToggleSoloLayer (PcbCanvas.tsx:6590) await setVisibleLayers before setActiveLayer (or send both via dispatchCommandsBatch); more robustly serialize PCB dispatches in dispatchEnvelope (useDesignerWorkspace.ts:485) through a promise queue so each envelope takes the previous result's revision. Keep focusedLayer in sync with activeLayer on solo enter/exit.
- Verification (vq4): **confirmed** — Reproduced in both themes: Alt+click 'Bottom Copper' sends two POST /commands back to back; the toast and Board panel show 'Revision conflict. Please retry after refresh.'; the status bar keeps 'Top Copper' while B.Cu is SOLO. After un-solo the canvas dims F.Cu (focus stuck on B.Cu) while active layer = F.Cu. Root cause: onToggleSoloLayer fires `void setVisibleLayers` + `void setActiveLayer` (PcbCanvas.tsx:6590-6594), and dispatchEnvelope reads baseRevision from projectionRef before the first result lands (useDesignerWorkspace.ts:505). Sub-claim 'un-solo loses F.SilkS' NOT reproduced here (F.SilkS was restored on exit), so it is removed. · evidence: [010-alt-solo](../evidence/shots/vq4/dark/010-alt-solo.png), [011-unsolo](../evidence/shots/vq4/dark/011-unsolo.png), [012-normal-after-focus](../evidence/shots/vq4/dark/012-normal-after-focus.png), [001-alt-solo-qa](../evidence/shots/vq4/light/001-alt-solo-qa.png)

</details>


## T-135

**PCB sidebar: Layers list paints over Components (click interception) with many parts / at 1100×720**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D1+D3 · wave W2 · scope frontend · estimate S
- Findings: F1B-001, Q4-042

**Summary.** The Layers section is squeezed to 56 px while its 354 px body stays overflow:visible, so the layer rows (Top Solder Paste … Bottom Courtyard, the Normal/Dim/Hide segment) are painted over component rows C1–C11. elementFromPoint on component rows C1–C4 and C6–C10 returns layer rows (pcb-layer-row-F.Paste/F.Mask/F.Cu/F.CrtYd/B.Cu/B.Mask/B.Paste/B.SilkS/B.CrtYd), so clicking 'C3' actually activates Top Copper instead o… | Also covers: Q4-042: At 1100×720 the Layers list spills over the Components section while routing (rows and he…

**Root cause.** `src/modules/designer/frontend/components/CollapsibleSection.tsx:63` — section 'flex min-h-0 flex-col' shrinks (flex 0 1 auto) and body 'min-h-0 flex-1' has no overflow clipping

**Proposed fix.** CollapsibleSection: flex/min-h-0 so sections share height and scroll internally; no overlap at 1100×720 or with >15 components. — Detail: In DesignerSidebar PCB branch make the Layers section `shrink-0` (or cap it with max-h + overflow-y-auto) and give the Components section `flex-1 min-h-0` with its list `overflow-y-auto`; add `overflow-hidden` to the CollapsibleSection body so a shrunk section can never paint over its sibling.

**Evidence.** [014-pcb-stacked-150](../evidence/shots/f1b/dark/014-pcb-stacked-150.png), [002-pcb-stack60-markers](../evidence/shots/vf1b/dark/002-pcb-stack60-markers.png), [186-1100-routing](../evidence/shots/q4/dark/186-1100-routing.png)

<details><summary>F1B-001 — PCB sidebar: with more than ~15 components the Layers list overflows onto the Components list at 1440×900 — clicks on component rows hit hidden layer rows (S2, confirmed)</summary>

- Area designer.pcb · stack A · design cc5a12b9-bd16-4e8c-9c00-f94598075fd5 · themes dark · viewports 1440x900
- Repro:
  1. Open QA-f1b-stress (150 parts) at 1440×900
  2. Switch to PCB
  3. Look at the left sidebar: Layers section and Components section
  4. Click component row C3 in the Components list
- Expected: Layers and Components sections each get their own height and scroll independently (or the sidebar scrolls); no painted overlap; clicking a component row selects that component.
- Actual: The Layers section is squeezed to 56 px while its 354 px body stays overflow:visible, so the layer rows (Top Solder Paste … Bottom Courtyard, the Normal/Dim/Hide segment) are painted over component rows C1–C11. elementFromPoint on component rows C1–C4 and C6–C10 returns layer rows (pcb-layer-row-F.Paste/F.Mask/F.Cu/F.CrtYd/B.Cu/B.Mask/B.Paste/B.SilkS/B.CrtYd), so clicking 'C3' actually activates Top Copper instead of selecting C3. Happens on any board whose component list + layer list exceed the sidebar height (≈15+ parts at 1440×900) — not only while routing at 1100×720 (Q4-042 is the same root cause). Root cause shared with Q4-042 (reported there only for 1100×720 while routing); this shows it at the primary 1440×900 viewport on any mid-size board, with mis-targeted clicks.
- Screenshots: [014-pcb-stacked-150](../evidence/shots/f1b/dark/014-pcb-stacked-150.png)
- Code: `src/modules/designer/frontend/components/CollapsibleSection.tsx:63` — section 'flex min-h-0 flex-col' shrinks (flex 0 1 auto) and body 'min-h-0 flex-1' has no overflow clipping
- Code: `src/modules/designer/frontend/components/DesignerSidebar.tsx:62` — aside overflow-y-auto never scrolls because both sections shrink instead
- Suggested fix: In DesignerSidebar PCB branch make the Layers section `shrink-0` (or cap it with max-h + overflow-y-auto) and give the Components section `flex-1 min-h-0` with its list `overflow-y-auto`; add `overflow-hidden` to the CollapsibleSection body so a shrunk section can never paint over its sibling.
- Verification (vf1b): **confirmed** — Reproduced at 1440x900 dark on my own 60-part design QA-vf1b-stack60 (a27efb0a): Layers section 176 px, Components 638 px; elementFromPoint at the C2-C6 component rows (y 318-406) returns the layer rows Bottom Copper / Bottom Solder Mask / Paste / Overlay / Courtyard. A real click on the 'C2' row activated Bottom Copper (status bar and layer tab switched to B.Cu) and selected nothing ('No selection'). So it happens at the primary viewport on a 60-part board without routing. Same root cause and fix as verified Q4-042 (S3, only reported at 1100x720 while routing); this finding is the broader case with mis-targeted clicks, so S2 stays. At triage, merge Q4-042 into this one. · evidence: [002-pcb-stack60-markers](../evidence/shots/vf1b/dark/002-pcb-stack60-markers.png), [003-click-c2-hits-layer](../evidence/shots/vf1b/dark/003-click-c2-hits-layer.png), DOM: hit-test y=318..406 -> 'Bottom CopperB.Cu','Bottom Solder MaskB.',...; sections Layers h=176 / Components h=638

</details>

<details><summary>Q4-042 — At 1100×720 the Layers list spills over the Components section while routing (rows and headers drawn on top of each other) (S3, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark · viewports 1100x720
- Repro:
  1. Window 1100×720 → Dual LED Blinker → PCB, left sidebar with Layers + Components expanded
  2. Press R and click a J1 pad to start routing (route row + hint row appear, canvas area shrinks by 56 px)
  3. Look at the bottom of the Layers list
- Expected: Layers section scrolls inside its own bounds; Components header stays below it
- Actual: '▾ Components 11' header (top 453) is painted over the 'Bottom Courtyard B.CrtYd' row (top 452–474); the count '11' overlaps the row's eye icon. DOM: Layers scroller content 354 px inside a 304 px flex parent with overflow:visible. Also on the same screen the route parameter row wraps 'Standard 2L' onto two lines, the 'Net VCC 0.25 mm · netclass Default' status and the status-bar hint are clipped mid-word, and the layer row label truncates to 'Top Cop…' to fit the ROUTING badge.
- Screenshots: [186-1100-routing](../evidence/shots/q4/dark/186-1100-routing.png), [048-1100-routing](../evidence/shots/vq4/dark/048-1100-routing.png)
- Console: `compHeader top=453 \| BCrow top=452 bottom=474; parent DIV h=304 flex 1 1 0% overflow visible, child h=354`
- Code: `src/modules/designer/frontend/pcb/PcbLayersPanel.tsx:1` — layers scroller nested in overflow-visible flex parent
- Code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:798` — 28px parameter-row shell; chips allow wrapping
- Suggested fix: Give the Layers section wrapper min-h-0 + overflow-hidden so its inner scroller is constrained; add whitespace-nowrap to param-row chips and let the row scroll/collapse lower-priority chips (net status) with an ellipsis.
- Verification (vq4): **confirmed** — Reproduced at 1100×720 dark: while routing, the 'Components' header top is 452.5 px and the 'Bottom Courtyard' row spans 452–474, so they are painted over each other. 'Standard 2L' wraps to two lines, and the param row and status hint are clipped. · evidence: [048-1100-routing](../evidence/shots/vq4/dark/048-1100-routing.png)

</details>


## T-136

**New schematic parts land on the PCB in only 24 fixed slots within 4 mm of the board centre — a 150-part design becomes one stacked blob of overlapping footprints**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **decide** · decision DEC-PCB3 · owner D3 · wave W2 · scope backend · estimate M
- Findings: F1B-002

**Summary.** All 150 placements sit within ±3.9 mm of the board centre on 24 distinct positions (hashStringToIndex(part.id) % 24 → radius 1.5–3.9 mm ring slots); up to 11 footprints share the exact same coordinate. The result is an unreadable blob (pads, refdes and silkscreen overprinted), every footprint overlaps others, and individual parts can only be separated by dragging 150 times one by one. Even 2-part designs can collide…

**Root cause.** `src/modules/designer/backend/pcb/pcb-store.ts:1846` — deterministicOffset: 6 slots per ring, base 1.5 mm, step 0.8 mm

**Proposed fix.** Backend: place new schematic parts in a grid/strip outside the board instead of 24 fixed centre slots. — Detail: In syncPcbPlacementsFromSchematic place new footprints with a packing pass: sort by footprint bbox, place left-to-right in rows just outside the board outline (or inside if it fits), advancing by bbox width + clearance and skipping occupied cells; keep the hash only as a tie-breaker.

**Evidence.** [014-pcb-stacked-150](../evidence/shots/f1b/dark/014-pcb-stacked-150.png), [002-pcb-stack60-markers](../evidence/shots/vf1b/dark/002-pcb-stack60-markers.png)

<details><summary>F1B-002 — New schematic parts land on the PCB in only 24 fixed slots within 4 mm of the board centre — a 150-part design becomes one stacked blob of overlapping footprints (S2, confirmed)</summary>

- Area designer.pcb · stack A · design cc5a12b9-bd16-4e8c-9c00-f94598075fd5 · themes dark · viewports 1440x900
- Repro:
  1. Create a design and place 150 parts in the schematic (any mix; here placed via POST /commands place_part on a 20 mm grid)
  2. Open the PCB view
  3. Zoom into the board centre
- Expected: Unplaced footprints are laid out without overlap (e.g. packed in a row/grid beside or on the board, like KiCad's 'update PCB from schematic' spreads new footprints), or at least never exactly coincident, so the user can pick them apart.
- Actual: All 150 placements sit within ±3.9 mm of the board centre on 24 distinct positions (hashStringToIndex(part.id) % 24 → radius 1.5–3.9 mm ring slots); up to 11 footprints share the exact same coordinate. The result is an unreadable blob (pads, refdes and silkscreen overprinted), every footprint overlaps others, and individual parts can only be separated by dragging 150 times one by one. Even 2-part designs can collide because the slot is a hash, not a free position.
- Screenshots: [014-pcb-stacked-150](../evidence/shots/f1b/dark/014-pcb-stacked-150.png), [015-pcb-stack-zoom](../evidence/shots/f1b/dark/015-pcb-stack-zoom.png)
- Network: `GET /api/modules/designer/designs/cc5a12b9…/projection/pcb → 150 placements, 24 distinct positions, x∈[-3.9,3.9] y∈[-3.377,3.377]; most common (0.75,1.3)×11, (-1.55,2.69)×11`
- Code: `src/modules/designer/backend/pcb/pcb-store.ts:1846` — deterministicOffset: 6 slots per ring, base 1.5 mm, step 0.8 mm
- Code: `src/modules/designer/backend/pcb/pcb-store.ts:1935` — index = hashStringToIndex(part.id) % 24 for every new placement
- Suggested fix: In syncPcbPlacementsFromSchematic place new footprints with a packing pass: sort by footprint bbox, place left-to-right in rows just outside the board outline (or inside if it fits), advancing by bbox width + clearance and skipping occupied cells; keep the hash only as a tie-breaker.
- Verification (vf1b): **confirmed** — Reproduced through the API on fresh designs. 60 parts gave 22 distinct PCB positions (x -3.9..3.1 mm, y ±3.377 mm, up to 5 parts on one point). 150 parts gave 24 distinct positions with up to 10 per point. On the 5-part QA-f1b-bomgroup, Q1 and Q3 share (3.1, 0) exactly, so small designs collide too. Code: pcb-store.ts:1935 `hashStringToIndex(part.id) % 24` -> deterministicOffset (1846, 6 slots per ring, 1.5 mm + 0.8 mm/ring). Cloud auto-place is off and cloud-only, so there is no local spread action. S2 kept. · evidence: [002-pcb-stack60-markers](../evidence/shots/vf1b/dark/002-pcb-stack60-markers.png), API QA-vf1b-stack60: placements 60, distinct 22; QA-vf1b-stack150: 150 -> 24 distinct, max share 10, API QA-f1b-bomgroup pnp.csv: Q1 3.1000,0.0000 and Q3 3.1000,0.0000

</details>


## T-137

**PCB canvas freezes with many DRC markers: one wheel notch ≈0.75 s, 10 notches 50 s, hovering 10 px >30 s (4 meshes + 4 materials per marker, rebuilt on every hover)**

- Severity **S2** · category perf · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate M
- Findings: F1B-004

**Summary.** Idle 60 fps; with markers: 10 wheel notches took 50,690 ms (1 fps, 64 long tasks, max 1,609 ms); a single wheel notch = 745 ms long task; 10 mouse-move steps over the markers exceeded a 30 s timeout (hoveredId change rebuilds the whole marker array and re-renders ~204k meshes). Same board before DRC: 55–60 fps for wheel/pan. With the ~784 markers of the spread board it is usable, so the cost is linear in marker coun…

**Root cause.** `src/modules/designer/frontend/pcb/layers/DrcMarkerLayer.tsx:74` — markers memo depends on hoveredId/selectedId → full rebuild on hover

**Proposed fix.** DrcMarkerLayer: instanced meshes, shared materials, no rebuild on hover/zoom. — Detail: Render markers with one InstancedMesh per visual layer (glow/stroke/ring/core) and a per-instance colour attribute; update only the hovered/selected instance matrices; drive constant screen size with a shader uniform (or one group scale) instead of per-group scale in useFrame; decimate/cluster markers below a zoom threshold.

**Evidence.** [017-drc-dock-stacked](../evidence/shots/f1b/dark/017-drc-dock-stacked.png), [002-pcb-stack60-markers](../evidence/shots/vf1b/dark/002-pcb-stack60-markers.png)

<details><summary>F1B-004 — PCB canvas freezes with many DRC markers: one wheel notch ≈0.75 s, 10 notches 50 s, hovering 10 px >30 s (4 meshes + 4 materials per marker, rebuilt on every hover) (S2, confirmed)</summary>

- Area designer.pcb · stack A · design cc5a12b9-bd16-4e8c-9c00-f94598075fd5 · themes dark · viewports 1440x900
- Repro:
  1. Same 150-part board after Run DRC (50,996 markers)
  2. Hover the board and wheel-zoom 10 notches
  3. Move the mouse 10 small steps across markers
  4. Click a violation in the DRC dock
- Expected: Pan/zoom/hover stay at interactive frame rates (KiCad handles tens of thousands of markers); markers drawn with one InstancedMesh per layer and hover handled without rebuilding every marker.
- Actual: Idle 60 fps; with markers: 10 wheel notches took 50,690 ms (1 fps, 64 long tasks, max 1,609 ms); a single wheel notch = 745 ms long task; 10 mouse-move steps over the markers exceeded a 30 s timeout (hoveredId change rebuilds the whole marker array and re-renders ~204k meshes). Same board before DRC: 55–60 fps for wheel/pan. With the ~784 markers of the spread board it is usable, so the cost is linear in marker count.
- Screenshots: [017-drc-dock-stacked](../evidence/shots/f1b/dark/017-drc-dock-stacked.png), [018-drc-51k-zoomout](../evidence/shots/f1b/dark/018-drc-51k-zoomout.png)
- Code: `src/modules/designer/frontend/pcb/layers/DrcMarkerLayer.tsx:74` — markers memo depends on hoveredId/selectedId → full rebuild on hover
- Code: `src/modules/designer/frontend/pcb/layers/DrcMarkerLayer.tsx:110` — markers.map → group + 4 <mesh> + 4 meshBasicMaterial per marker; useFrame rescales every group every frame
- Suggested fix: Render markers with one InstancedMesh per visual layer (glow/stroke/ring/core) and a per-instance colour attribute; update only the hovered/selected instance matrices; drive constant screen size with a shader uniform (or one group scale) instead of per-group scale in useFrame; decimate/cluster markers below a zoom threshold.
- Verification (vf1b): **confirmed** — Reproduced on QA-vf1b-stack60 with 8,171 markers. Five wheel notches ran at 9 fps (15 long tasks, max 193 ms), and ten hover moves at 7 fps (21 long tasks). With the same board and markers hidden (useDrcStore.setMarkersVisible(false)), both ran at 61 fps with 0 long tasks. Code confirmed: DrcMarkerLayer.tsx:74 markers memo depends on hoveredId/selectedId (full rebuild per hover), and :110 renders a group + 4 meshes + 4 meshBasicMaterials per marker, with useFrame rescaling every group each frame. S2 kept. The cost is linear in marker count, and the same object graph also drives the 10-minute teardown in F1B-003. · evidence: [002-pcb-stack60-markers](../evidence/shots/vf1b/dark/002-pcb-stack60-markers.png), measure: markers on wheel {fps:9,longTasks:15,max:193}, hover {fps:7,longTasks:21}; markers off wheel/hover {fps:61,longTasks:0}

</details>


## T-138

**Copper-fill render order wrong: F.Cu pour hides top silk text; active inner-layer pour drawn under dimmed F.Cu**

- Severity **S2** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: F1B-032, F2B-005

**Summary.** The text is cut off at the zone's left edge (x≈810 px) — '…Long PCB overlay text fo' — and does not reappear to the right of the pour; the solid red fill paints over it in both themes and with either copper layer active. Footprint silk/refdes inside the same pour stay visible, so only board-level overlay text is affected. A user placing a label/logo over a ground pour cannot see it in the editor. | Also covers: F2B-005: On multilayer boards the active inner layer's copper pour is painted underneath the (dimm…

**Root cause.** `src/modules/designer/frontend/pcb/layers/CopperFillLayer.tsx:72` — copperFillRenderOrder: F.Cu pour at RENDER_ORDER.PINS − 0.35

**Proposed fix.** Copper-fill render order: active layer pour above inactive (dimmed) pours; board silk above same-side pour. — Detail: Render board-level silk (OverlayLayer text/shapes on F.SilkS/B.SilkS) in a slot above same-side copper objects and pours, e.g. RENDER_ORDER.ANNULAR-0.5 for the view side, or change BASE_RENDER_SLOTS in @openpcb/r3f-eda-canvas so silk > copper fill for the facing side. Add a unit test: F.SilkS object > F.Cu fill (view top) and B.SilkS > B.Cu fill (view bottom).

**Evidence.** [111-silk-under-fcu-zone](../evidence/shots/f1b/dark/111-silk-under-fcu-zone.png), [015-silk-under-fcu-zone](../evidence/shots/vf1b/dark/015-silk-under-fcu-zone.png), [035-4L-In2-active-normal](../evidence/shots/f2b/dark/035-4L-In2-active-normal.png)

<details><summary>F1B-032 — PCB editor draws the F.Cu copper pour over Top Overlay (F.SilkS) text — board silkscreen text disappears wherever it crosses a top zone (S3, confirmed)</summary>

- Area designer.pcb · stack A · design 43a2da78-9d2e-43a0-bcd3-ecebe3f72551 · themes dark, light · viewports 1440x900
- Repro:
  1. QA-f1b-long → PCB: a F.SilkS overlay text 'Long PCB overlay text …' at y≈9.4 mm and a no-net F.Cu zone (red, top-right) that the text runs into
  2. View top, Top Copper or Bottom Copper active, Display mode Normal
  3. Follow the text to the right
- Expected: Silkscreen is printed on top of mask/copper: F.SilkS text (like footprint silk) renders above F.Cu pours, as in KiCad; the Gerber F_Silkscreen contains the full string.
- Actual: The text is cut off at the zone's left edge (x≈810 px) — '…Long PCB overlay text fo' — and does not reappear to the right of the pour; the solid red fill paints over it in both themes and with either copper layer active. Footprint silk/refdes inside the same pour stay visible, so only board-level overlay text is affected. A user placing a label/logo over a ground pour cannot see it in the editor.
- Screenshots: [111-silk-under-fcu-zone](../evidence/shots/f1b/dark/111-silk-under-fcu-zone.png), [030-silk-under-fcu-zone](../evidence/shots/f1b/light/030-silk-under-fcu-zone.png), [030b-silk-under-fcu-zone-zoom](../evidence/shots/f1b/light/030b-silk-under-fcu-zone-zoom.png), [005-long-pcb](../evidence/shots/f1b/light/005-long-pcb.png)
- Network: `GET /projection/pcb → overlayTexts[0].layer 'F.SilkS'; zones [('B.Cu', net), ('F.Cu', no net)]`
- Code: `src/modules/designer/frontend/pcb/layers/CopperFillLayer.tsx:72` — copperFillRenderOrder: F.Cu pour at RENDER_ORDER.PINS − 0.35
- Code: `src/modules/designer/frontend/pcb/layers/OverlayLayer.tsx:93` — overlay text renderOrder = effectiveRenderOrder(layer,'object') — the F.SilkS object slot sits below the F.Cu pour slot
- Suggested fix: Render board-level silk (OverlayLayer text/shapes on F.SilkS/B.SilkS) in a slot above same-side copper objects and pours, e.g. RENDER_ORDER.ANNULAR-0.5 for the view side, or change BASE_RENDER_SLOTS in @openpcb/r3f-eda-canvas so silk > copper fill for the facing side. Add a unit test: F.SilkS object > F.Cu fill (view top) and B.SilkS > B.Cu fill (view bottom).
- Verification (vf1b): **confirmed** — Reproduced on QA-f1b-long PCB in dark and light: the F.SilkS overlay text stops at the left edge of the no-net F.Cu zone (x≈810, '…overlay text fo') and does not continue over or past it. Code confirms the order: OverlayLayer.tsx:96 uses effectiveRenderOrder(F.SilkS,'object') = RENDER_ORDER.F_SILK 9, while the F.Cu pour renders at PINS-0.35 = 9.65 (CopperFillLayer.tsx:72). The package's dedicated F_COPPER_FILL slot (11.65) is also above F_SILK, so the 'Phase 6' migration alone would not fix it. Physically, and in KiCad when F.Cu is not the active layer, silk sits above copper. S3 kept. · evidence: [015-silk-under-fcu-zone](../evidence/shots/vf1b/dark/015-silk-under-fcu-zone.png), [002-long-pcb](../evidence/shots/vf1b/light/002-long-pcb.png), node_modules/@openpcb/r3f-eda-canvas/dist/layers.js:19-66 RENDER_ORDER

</details>

<details><summary>F2B-005 — On multilayer boards the active inner layer's copper pour is painted underneath the (dimmed) F.Cu pour — an In2 ground plane, or a zone just drawn on In2, is invisible unless the layer is soloed (S2, confirmed)</summary>

- Area designer.pcb · stack B · design 2a4c5318-4bea-4e32-841b-2750b998e9d4 · themes dark · viewports 1440x900
- Repro:
  1. Stack B, QA-f2b-4L (KiCad 4-layer import: GND pours on F.Cu, B.Cu and In2.Cu) → PCB
  2. Press 4 (Mid-Layer 2 becomes active; status bar 'Mid-Layer 2 In2.Cu'); Inactive layers = Normal
  3. Compare with Alt+click 'Mid-Layer 2' (solo)
  4. Z → Layer In2.Cu → draw a rectangle zone in the top-left of the board → Enter
- Expected: The active layer (including its pour) renders above the other copper layers, as in KiCad/Altium, so the user sees the plane they are editing; a freshly drawn/selected zone is at least outlined.
- Actual: With In2 active, the In2 GND plane shows only through the holes of the F.Cu pour (cyan islands in the centre); the dimmed F.Cu pour (#86000f) covers the rest of the board. Soloed, the same plane covers the whole board (shot 014). A zone drawn on In2 is created and selected (inspector 'Zone In2.Cu') but nothing of it is visible on the canvas — no fill, no outline, no selection highlight. Traces of the active inner layer are raised (In1 tracks draw on top), pours are not: CopperFillLayer uses a fixed per-layer render order (F.Cu = PINS−0.35 always above IN2_COPPER−0.35) instead of the active-layer-aware effectiveRenderOrder used by traces and zone outlines; In3+ pours fall through to the B.Cu slot.
- Screenshots: [035-4L-In2-active-normal](../evidence/shots/f2b/dark/035-4L-In2-active-normal.png), [014-4L-alt-solo-In2](../evidence/shots/f2b/dark/014-4L-alt-solo-In2.png), [034-4L-zone-drawn](../evidence/shots/f2b/dark/034-4L-zone-drawn.png), `f2b/crop-zone.png`
- Network: `GET /designs/2a4c5318…/projection/pcb → zones incl. ('In2.Cu', no net) created at rev 28`
- Pixel probes: {"file": "shots/f2b/dark/016-4L-In1-normal.png", "x": 450, "y": 600, "hex": "#86000f", "nearestToken": "--net-power", "deltaE": 30.0}; {"file": "shots/vf2b/dark/003-4L-open.png", "x": 450, "y": 600, "hex": "#fa1014", "nearestToken": "--net-power", "deltaE": 31.2}; {"file": "shots/vf2b/dark/004-4L-In2-active-FCu-hidden.png", "x": 450, "y": 600, "hex": "#76d3dc", "nearestToken": "--selection", "deltaE": 20.8}
- Code: `src/modules/designer/frontend/pcb/layers/CopperFillLayer.tsx:55` — copperFillRenderOrder: fixed F > In1 > In2 > B order, In3+ fall to the B.Cu slot
- Code: `node_modules/@openpcb/r3f-eda-canvas/dist/layers.js:396` — effectiveRenderOrder is viewSide-aware only, not active-layer aware (traces use it too)
- Code: `src/modules/designer/frontend/pcb/layers/ZoneOutlineLayer.tsx:129` — zone outline order also below the F.Cu pour mesh
- Suggested fix: Make copper render order active-layer aware in PcbScene: compute an offset that lifts every object of visualState.activeLayer (traces, vias, pads on that layer, CopperFillLayer, ZoneOutlineLayer) above all other copper slots (KiCad/Altium behaviour), e.g. activeLayer ? RENDER_ORDER.F_COPPER + 1 (+0.35 for objects over fill) : base; draw the selected zone's outline/handles in the selection/overlay slot so a zone is never invisible after creation.
- Verification (vf2b): **confirmed** — Reproduced on QA-f2b-4L with In2 active (tab 'Mid-Layer 2', status bar 'Mid-Layer 2 In2.Cu'): the board area probes #fa1014 (F.Cu pour) at (450,600) and (1000,320); after hiding only Top Copper the same pixels probe #76d3dc (the In2 GND plane), i.e. the active layer's plane covers the whole board but is painted under the F.Cu pour and only shows through F.Cu clearance gaps. The unnetted In2 zone f2b drew (projection zone 'In2.Cu', no net) shows no outline or fill in the top-left while F.Cu is visible, and appears once F.Cu is hidden. Correction to the raw root cause: nothing in the PCB scene is active-layer aware - effectiveRenderOrder (r3f-eda-canvas layers.js:396) depends only on layer + viewSide, and copperFillRenderOrder (CopperFillLayer.tsx:55) is a fixed stack (F fill at PINS-0.35 = 9.65 above In1 objects 6 / In2 objects 5); inner tracks look 'on top' only where the F.Cu pour has clearance gaps, so reusing effectiveRenderOrder would not fix it. Workaround exists (hide F.Cu, solo, or 'Hide' inactive mode - the latter is covered by the Components header at 1440 per F1B-001), so S2 kept. · evidence: [003-4L-open](../evidence/shots/vf2b/dark/003-4L-open.png), [004-4L-In2-active-FCu-hidden](../evidence/shots/vf2b/dark/004-4L-In2-active-FCu-hidden.png), [005-4L-In1-active](../evidence/shots/vf2b/dark/005-4L-In1-active.png)

</details>


## T-139

**A quick tap on a footprint leaves a hidden drag armed: the next click anywhere teleports that footprint to the click point (R3 jumped onto C2)**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: F2A-003

**Summary.** POST pcb_move_placement {placementId: R3, positionMm: (-2.135, 8.999)} (= C2's exact position) was sent by the click intended to select C2, then F flipped C2 — R3 and C2 ended stacked. Reproduced 5× (3/3 in one scripted sequence: two instant taps ~1 s apart; e.g. R3 (6.988,3.009) → (12.214,-9.212) = the second tap point), not with 90 ms clicks. Intermittent because it depends on whether React re-renders between poin…

**Root cause.** `src/modules/designer/frontend/pcb/PcbCanvas.tsx:3731` — onPointerUp reads the render-closure dragSession; when pointerup arrives before the re-render that follows pointerdown's setDragSession (:3456) it is null → early return, session never cleared

**Proposed fix.** Clear armed drag on pointerup without movement threshold crossing. — Detail: Mirror dragSession in a ref (set synchronously in onPointerDown next to setDragSession) and read the ref in onPointerUp/onPointerMove; always clear the session on pointerup/pointercancel/lostpointercapture; ignore pointermove updates when event.buttons === 0.

**Evidence.** [038-rot-flip](../evidence/shots/f2a/dark/038-rot-flip.png), [017-after-tap-hover](../evidence/shots/vf2a/dark/017-after-tap-hover.png)

<details><summary>F2A-003 — A quick tap on a footprint leaves a hidden drag armed: the next click anywhere teleports that footprint to the click point (R3 jumped onto C2) (S2, confirmed)</summary>

- Area designer.pcb · stack A · design 847e94e7-36e6-4284-b22c-17725e0f5b02 · themes dark · viewports 1440x900
- Repro:
  1. QA-f2a-golden PCB, board fitted
  2. Tap R3 (mousedown+mouseup in the same frame, like a trackpad tap-to-click), press R to rotate (optional)
  3. Click C2 (or any empty board spot) to select something else
  4. R3 is moved to the clicked point (snapped onto C2's centre); Undo restores it
- Expected: A click (with no pointer travel beyond the drag threshold) only selects; a later click elsewhere never moves the previously clicked part.
- Actual: POST pcb_move_placement {placementId: R3, positionMm: (-2.135, 8.999)} (= C2's exact position) was sent by the click intended to select C2, then F flipped C2 — R3 and C2 ended stacked. Reproduced 5× (3/3 in one scripted sequence: two instant taps ~1 s apart; e.g. R3 (6.988,3.009) → (12.214,-9.212) = the second tap point), not with 90 ms clicks. Intermittent because it depends on whether React re-renders between pointerdown and pointerup.
- Screenshots: [038-rot-flip](../evidence/shots/f2a/dark/038-rot-flip.png)
- Network: `req 1004 pcb_rotate_placement R3 → rev 52`; `req 1007 pcb_move_placement R3 → (-2.135, 8.999) = C2 position → rev 53 (unintended)`; `req 1010 pcb_flip_placement C2 → rev 54`
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:3731` — onPointerUp reads the render-closure dragSession; when pointerup arrives before the re-render that follows pointerdown's setDragSession (:3456) it is null → early return, session never cleared
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:3636` — onPointerMove keeps updating the surviving session with no button pressed (part follows the hovering cursor, moved=true)
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:629` — dragSession is useState only (freePrimitiveDragSession has a ref mirror)
- Suggested fix: Mirror dragSession in a ref (set synchronously in onPointerDown next to setDragSession) and read the ref in onPointerUp/onPointerMove; always clear the session on pointerup/pointercancel/lostpointercapture; ignore pointermove updates when event.buttons === 0.
- Verification (vf2a): **confirmed** — Reproduced on stack A, QA-vf2a-a PCB (dark). (1) A same-frame tap on U1 (pointerdown+pointerup dispatched together) left a live drag session: after moving the mouse with no button pressed, U1 was drawn following the cursor while the projection still had it at (-1.5,0) (shot 017). (2) A second same-frame tap elsewhere committed pcb_move_placement: U1 went from (-1.500,0.000) to (9.427,-8.519), rev 4→5. (3) The same happened with real Playwright input (mouse.down()/mouse.up() back to back, tap, hover, tap): rev 7 U1 at (9.427,-8.519). A slow click in between cancels the stale session without committing (shot 018). Undo restored the parts. Mechanism matches the code. Intermittent in real use (trackpad tap-to-click), so S2. · evidence: [017-after-tap-hover](../evidence/shots/vf2a/dark/017-after-tap-hover.png), [018-after-click-teleport](../evidence/shots/vf2a/dark/018-after-click-teleport.png), [019-two-taps-teleport](../evidence/shots/vf2a/dark/019-two-taps-teleport.png), projection rev 4→5: U1 (-1.500,0.000)→(9.427,-8.519)

</details>


## T-140

**Layers-panel copper-fill droplet is titled 'Show/Hide copper fills' but creates/enables a board-wide SOLID pour: it silently overrides the user's thermal zone (canvas and Gerber) and the canvas draws clearance rings around same-net GND vias that the Gerber does not have**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: F2A-004

**Summary.** Click → rev 111→112, a persisted zone {id:'board:B.Cu', region:{kind:'board'}, net GND, padConnection:'solid'} is added. J1.2 loses its thermal spokes (now solid), and all three GND vias get a dark #05080c ring (pixel probe) as if cleared from the pour, while ratsnest still says 0. Clicking again doesn't remove the zone — it leaves a disabled 'board:B.Cu' row in the design. The droplet showed the 'off' state (struck…

**Root cause.** `src/modules/designer/frontend/pcb/PcbLayersPanel.tsx:517` — button title 'Show copper fills'/'Hide copper fills', no aria-label/aria-pressed; onClick → onToggleBoardZone; off-state only considers the board zone

**Proposed fix.** Droplet toggles fill visibility only; pour creation stays an explicit action (label accordingly). — Detail: Keep the contract semantics but label them honestly: title/aria-label 'Board pour on B.Cu (GND, solid) — click to disable' vs 'Add board pour on B.Cu…', aria-pressed from the board zone's enabled state, and surface the net/pad-connection pickers §12.3 requires before the first enable. When a same-net polygon zone already exists on the layer, confirm (or inherit its padConnection) instead of silently flooding over its thermals. Fix the canvas fill so a same-net board plane does not draw clearance around same-net vi…

**Evidence.** [063-pour-j1](../evidence/shots/f2a/dark/063-pour-j1.png), [025-bcu-before-nomarker](../evidence/shots/vf2a/dark/025-bcu-before-nomarker.png)

<details><summary>F2A-004 — Layers-panel copper-fill droplet is titled 'Show/Hide copper fills' but creates/enables a board-wide SOLID pour: it silently overrides the user's thermal zone (canvas and Gerber) and the canvas draws clearance rings around same-net GND vias that the Gerber does not have (S2, confirmed)</summary>

- Area designer.pcb · stack A · design 847e94e7-36e6-4284-b22c-17725e0f5b02 · themes dark · viewports 1440x900
- Repro:
  1. QA-f2a-golden PCB: draw a B.Cu GND zone with Z, Pads = Thermal relief (thermal spokes visible on J1.2, shots/f2a/dark/063)
  2. Layers panel → Bottom Copper row → droplet icon (struck through, title 'Show copper fills' although the B.Cu pour is plainly visible)
  3. Compare the canvas; GET /projection/pcb zones
- Expected: A control titled Show/Hide copper fills only changes visibility; creating a pour is an explicit action and never overrides an existing zone's pad-connection style. The icon state reflects whether fills are shown.
- Actual: Click → rev 111→112, a persisted zone {id:'board:B.Cu', region:{kind:'board'}, net GND, padConnection:'solid'} is added. J1.2 loses its thermal spokes (now solid), and all three GND vias get a dark #05080c ring (pixel probe) as if cleared from the pour, while ratsnest still says 0. Clicking again doesn't remove the zone — it leaves a disabled 'board:B.Cu' row in the design. The droplet showed the 'off' state (struck through, 'Show copper fills') even while the polygon pour was rendered, so users will click it to 'see' their pour. No aria-label/aria-pressed on the button.
- Screenshots: [063-pour-j1](../evidence/shots/f2a/dark/063-pour-j1.png), [064-fill-toggle-b](../evidence/shots/f2a/dark/064-fill-toggle-b.png), [066-board-zone-off](../evidence/shots/f2a/dark/066-board-zone-off.png), `f2a/crop-fill-before-after.png`
- Network: `POST commands (copper-fill-toggle-B.Cu) → zones: [+ {id:'board:B.Cu', kind:'board', padConnection:'solid', enabled:true}] rev 112`; `second click → board:B.Cu enabled:false (row kept) rev 113`
- Pixel probes: {"file": "shots/f2a/dark/064-fill-toggle-b.png", "x": 915, "y": 612, "hex": "#05080c", "nearestToken": "--surface-canvas-well", "deltaE": 1.4}
- Code: `src/modules/designer/frontend/pcb/PcbLayersPanel.tsx:517` — button title 'Show copper fills'/'Hide copper fills', no aria-label/aria-pressed; onClick → onToggleBoardZone; off-state only considers the board zone
- Code: `src/modules/designer/frontend/pcb/tools/board-zone-controls.ts:26` — boardZoneToggleAction: 'add' creates a board-region zone when none exists (by design, contract 03 §12.3)
- Code: `docs/pcb-hardening/03-zone-keepout-contract.md:499` — §12.3: 'the per-layer copper-fill control is the board zone: toggle = enabled … plus net and pad-connection pickers' — the control is meant to manage a board pour, not visibility
- Suggested fix: Keep the contract semantics but label them honestly: title/aria-label 'Board pour on B.Cu (GND, solid) — click to disable' vs 'Add board pour on B.Cu…', aria-pressed from the board zone's enabled state, and surface the net/pad-connection pickers §12.3 requires before the first enable. When a same-net polygon zone already exists on the layer, confirm (or inherit its padConnection) instead of silently flooding over its thermals. Fix the canvas fill so a same-net board plane does not draw clearance around same-net vias (the Gerber writer already doesn't).
- Verification (vf2a): **confirmed** — Reproduced on the golden design (owned), dark: B.Cu row droplet had title 'Show copper fills', aria-label null, aria-pressed null, while the thermal polygon pour was visibly rendered. One click → rev 138→139, board:B.Cu enabled (GND, solid). J1.2 lost its thermal spokes on canvas. The GND via at D1 (scan y=502) went from #2667dc pour around it to a #05080c ring, and the same happened at the other GND vias. Gerber export at rev 139: B_Cu clear-polarity vertices 1013→649 (thermal gaps gone, so J1.2 is solid in the fab file too), while around each GND via there are still only drill knock-outs (max r 0.204 mm). The via rings are therefore canvas-only and misleading. Partly intentional: contract 03 §12.3 makes this control the board zone's lifecycle control, so creating a zone is by design. But the 'Show/Hide copper fills' title misstates what it does, and it silently changes the manufacturing output. Kept at S2 (misleading claim + silent data change). Undone with Cmd+Z (rev 140). · evidence: [025-bcu-before-nomarker](../evidence/shots/vf2a/dark/025-bcu-before-nomarker.png), [026-bcu-after-toggle](../evidence/shots/vf2a/dark/026-bcu-after-toggle.png), vf2a/crop-fill-toggle-before-after.png, vf2a/B_Cu-139.gbr, pixel scan y=502: before #2667dc…, after #05080c ring

</details>


## T-141

**Route tool ignores the name-based net class DRC uses: VCC/GND are routed at the Default 0.25 mm ('Class Default' in the route row) and the next DRC flags every one of them NETCLASS_TRACE_WIDTH (Power 0.5 / GND 0.4)**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate XS
- Findings: F2A-006

**Summary.** All 18 traces are stored netClassId 'default'; DRC: 7× NETCLASS_TRACE_WIDTH 'Trace 0.250 mm is narrower than net class "Power" width 0.500 mm' / '"GND" width 0.400 mm' (0 errors, 45 warnings total). The user must know to press W for every power trace; a router-default trace immediately becomes a DRC warning.

**Root cause.** `src/modules/designer/frontend/pcb/PcbCanvas.tsx:3089` — route start: sessionClass = perNetClassAssignments[netId] || defaultNetClass — no name-pattern fallback

**Proposed fix.** Route tool resolves net class with the same resolver DRC uses (name-based classes). — Detail: Resolve the route/bundle session class with resolveNetClassId(netNames[netId], netClasses, perNetClassAssignments, netId) at PcbCanvas.tsx:3089 and :2854, and make effectiveNetClassId use the same resolver so the router, the committed trace's netClassId, ratsnest and DRC agree.

**Evidence.** [048-via-pressed](../evidence/shots/f2a/dark/048-via-pressed.png), [021-route-vcc-active](../evidence/shots/vf2a/dark/021-route-vcc-active.png)

<details><summary>F2A-006 — Route tool ignores the name-based net class DRC uses: VCC/GND are routed at the Default 0.25 mm ('Class Default' in the route row) and the next DRC flags every one of them NETCLASS_TRACE_WIDTH (Power 0.5 / GND 0.4) (S2, confirmed)</summary>

- Area designer.pcb · stack A · design 847e94e7-36e6-4284-b22c-17725e0f5b02 · themes dark · viewports 1440x900
- Repro:
  1. Fresh design with a VCC power port and GND ports; no Design-rules net assignments touched
  2. PCB → R → click a VCC pad: route row shows 'W 0.250 mm · Class Default', live status 'Net VCC 0.25 mm · netclass 'Default''
  3. Route VCC/GND traces normally, Run DRC
- Expected: One net-class resolution everywhere: the route tool starts VCC at the Power class width (0.5 mm) and GND at 0.4 mm — the same classes the ratsnest (netClassId 'gnd') and DRC resolve by name — or DRC does not hold traces to a class the router never offered.
- Actual: All 18 traces are stored netClassId 'default'; DRC: 7× NETCLASS_TRACE_WIDTH 'Trace 0.250 mm is narrower than net class "Power" width 0.500 mm' / '"GND" width 0.400 mm' (0 errors, 45 warnings total). The user must know to press W for every power trace; a router-default trace immediately becomes a DRC warning.
- Screenshots: [048-via-pressed](../evidence/shots/f2a/dark/048-via-pressed.png), [076-drc-run1](../evidence/shots/f2a/dark/076-drc-run1.png)
- Network: `GET /drc → countsByCode NETCLASS_TRACE_WIDTH 7`; `projection.pcb.traces[*].netClassId = 'default'; ratsnest netClassId for GND = 'gnd'`
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:3089` — route start: sessionClass = perNetClassAssignments[netId] \|\| defaultNetClass — no name-pattern fallback
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:2854` — bundle routing also starts from defaultNetClass
- Code: `src/shared/drc/rule-resolver.ts:254` — DRC resolves the class with resolveNetClassId (name patterns GND/VCC → gnd/power)
- Code: `src/shared/pcb-areas/net-class-resolver.ts:81` — effectiveNetClassId (commit path) also only honours explicit assignments
- Suggested fix: Resolve the route/bundle session class with resolveNetClassId(netNames[netId], netClasses, perNetClassAssignments, netId) at PcbCanvas.tsx:3089 and :2854, and make effectiveNetClassId use the same resolver so the router, the committed trace's netClassId, ratsnest and DRC agree.
- Verification (vf2a): **confirmed** — Golden PCB (dark): R → click J1.1 (VCC). The route row shows 'W 0.250 mm', 'Class Default' and the live status 'Net VCC 0.25 mm · netclass 'Default''. GET /drc on the golden (rev 134) gives NETCLASS_TRACE_WIDTH ×7: 'Trace 0.250 mm is narrower than net class "Power" width 0.500 mm' ×3 and '… "GND" width 0.400 mm' ×4. Code confirms the split: DRC and ratsnest use resolveNetClassId (name patterns), the route tool uses only explicit assignments. The route was cancelled with Esc, nothing committed. S2: the tool's defaults produce DRC warnings on every power/ground trace, with no trace-width editor to fix them afterwards (F2B-011). · evidence: [021-route-vcc-active](../evidence/shots/vf2a/dark/021-route-vcc-active.png), GET /designs/847e94e7…/drc → countsByCode NETCLASS_TRACE_WIDTH 7

</details>


## T-142

**Route commit refused by the backend shows only 'Command failed' — INVALID_PCB_VIA/INVALID_PCB_* details are dropped, even with the DRC override on**

- Severity **S2** · category error-handling · status confirmed · themes dark
- Recommendation **fix-now** · owner D1 · wave W2 · scope frontend · estimate XS
- Findings: F2B-004

**Summary.** A red 'Command failed ×' toast over the canvas plus a 'Command failed' strip in the Board panel; the route session stays open with 'DRC override ON — commits may violate design rules'. The response carried the reason: {ok:false, code:'INVALID_PCB_VIA', detail:'via diameter is below board minimum'}, but useDesignerWorkspace.commandErrorMessage has no INVALID_PCB_VIA case (nor INVALID_PCB_TRACE/…) and falls through to…

**Root cause.** `src/modules/designer/frontend/hooks/useDesignerWorkspace.ts:521` — throws Error(commandErrorMessage(result)) for every ok:false; default case returns 'Command failed' (:124), no INVALID_PCB_* cases

**Proposed fix.** Surface backend refusal details (INVALID_PCB_* mapped to user copy) instead of 'Command failed'. — Detail: Make dispatchCommand return the ok:false result instead of throwing (or throw an error object carrying the result, e.g. DispatchRejectedError with dispatchResult), so usePcbWorkspace's rejectedCommit/dispatchFailureMessage and PcbCanvas's PCB_COPPER_ILLEGAL branch run; at minimum add INVALID_PCB_TRACE/VIA/ZONE/... cases returning result.detail to commandErrorMessage ('Route not committed: via diameter 0.60 mm is below the board minimum 0.80 mm'). Clear the Board-panel error strip when the route session is cancelle…

**Evidence.** [026-4L-route-commit](../evidence/shots/f2b/dark/026-4L-route-commit.png), [007-4L-route-commit-blocked](../evidence/shots/vf2b/dark/007-4L-route-commit-blocked.png)

<details><summary>F2B-004 — Route commit refused by the backend shows only 'Command failed' — INVALID_PCB_VIA/INVALID_PCB_* details are dropped, even with the DRC override on (S2, confirmed)</summary>

- Area designer.pcb · stack B · design 2a4c5318-4bea-4e32-841b-2750b998e9d4 · themes dark · viewports 1440x900
- Repro:
  1. Stack B, QA-f2b-4L (KiCad import) → PCB → R
  2. Click a GND via, press V twice to change layers (placing vias), click to add a corner
  3. Enter → 'Commit blocked: 6 DRC conflicts — fix the route or [allow violations]' → click 'allow violations' → Enter
- Expected: If the backend refuses the route, the user is told why and what to change, e.g. "Via Ø0.60 mm is below the board minimum Ø0.80 mm — pick a larger via preset or edit Design rules", ideally before commit (the route row already knows the via size and the rules).
- Actual: A red 'Command failed ×' toast over the canvas plus a 'Command failed' strip in the Board panel; the route session stays open with 'DRC override ON — commits may violate design rules'. The response carried the reason: {ok:false, code:'INVALID_PCB_VIA', detail:'via diameter is below board minimum'}, but useDesignerWorkspace.commandErrorMessage has no INVALID_PCB_VIA case (nor INVALID_PCB_TRACE/…) and falls through to the generic default. dispatch-failure.ts (which keeps the detail) is not used on this path. The live route status even showed 'via 0.60/0.30' without flagging it below the 0.80 minimum.
- Screenshots: [026-4L-route-commit](../evidence/shots/f2b/dark/026-4L-route-commit.png), [027-4L-route-committed](../evidence/shots/f2b/dark/027-4L-route-committed.png)
- Network: `POST /api/modules/designer/designs/2a4c5318…/commands (pcb_commit_route) → 200 {ok:false, code:'INVALID_PCB_VIA', detail:'via diameter is below board minimum'}`
- Code: `src/modules/designer/frontend/hooks/useDesignerWorkspace.ts:521` — throws Error(commandErrorMessage(result)) for every ok:false; default case returns 'Command failed' (:124), no INVALID_PCB_* cases
- Code: `src/modules/designer/frontend/pcb/usePcbWorkspace.ts:584` — if (!result.ok) throw rejectedCommit(...) is unreachable - dispatchCommand already threw
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:1743` — PCB_COPPER_ILLEGAL branch reads err.dispatchResult, which is never attached
- Code: `src/modules/designer/frontend/pcb/dispatch-failure.ts:8` — detail-preserving helper exists but the path never reaches it
- Suggested fix: Make dispatchCommand return the ok:false result instead of throwing (or throw an error object carrying the result, e.g. DispatchRejectedError with dispatchResult), so usePcbWorkspace's rejectedCommit/dispatchFailureMessage and PcbCanvas's PCB_COPPER_ILLEGAL branch run; at minimum add INVALID_PCB_TRACE/VIA/ZONE/... cases returning result.detail to commandErrorMessage ('Route not committed: via diameter 0.60 mm is below the board minimum 0.80 mm'). Clear the Board-panel error strip when the route session is cancelled. Pre-validate the via preset against the resolved board minimum in the route row (red chip + tooltip).
- Verification (vf2b): **confirmed** — Reproduced on QA-f2b-4L (dark, 1440x900): R, start a route, V to drop a via, Enter -> 'Commit blocked: 3 DRC conflicts - fix the route or allow violations' -> allow violations -> Enter. The /commands response was {ok:false, code:'INVALID_PCB_VIA', detail:'via diameter is below board minimum'} (fetch spy), yet the UI shows only a 'Command failed x' toast and a 'Command failed' strip in the Board panel; the strip was still there after Esc and a new route session at 1100x720. Root cause is one level deeper than reported: PcbCanvas passes useDesignerWorkspace's dispatchCommand, which throws new Error(commandErrorMessage(result)) for any ok:false (useDesignerWorkspace.ts:516-521) before usePcbWorkspace.commitRoute ever sees the result, so rejectedCommit/dispatchFailureMessage (usePcbWorkspace.ts:32-38, :584) never run. The designed PCB_COPPER_ILLEGAL handling in PcbCanvas (:1743 route, :2439 bundle - 'Commit rejected by DRC: ...') is therefore dead code as well. · evidence: [007-4L-route-commit-blocked](../evidence/shots/vf2b/dark/007-4L-route-commit-blocked.png), [008-4L-route-command-failed](../evidence/shots/vf2b/dark/008-4L-route-command-failed.png), [011-4L-routing-1100](../evidence/shots/vf2b/dark/011-4L-routing-1100.png)

</details>


## T-143

**6-layer boards: In3/In4 copper is invisible and unreachable — no layer tab, no Layers row, 'All copper' preset skips them, keys 3/4 go dead, and the layer-pair list only knows 4-layer pairs**

- Severity **S2** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate M
- Findings: F2B-007

**Summary.** Projection has traces on In3.Cu (4) and In4.Cu (3), but the strip shows only Top, Mid-Layer 1, Mid-Layer 2, Bottom; the Layers panel has no In3/In4 rows; 'All copper' sets visibleLayers to [F.Cu, In1.Cu, In2.Cu, B.Cu] only, so the In3/In4 tracks are never drawn (nothing at the D2-K chain location, shot 054). Keys 3/4 do nothing on a 6-layer board (handler requires layerCount === 4), so In1/In2 are keyboard-unreachab…

**Root cause.** `src/modules/designer/frontend/pcb/PcbLayerTabStrip.tsx:17` — STRIP_LAYERS hard-codes In1/In2 (requiresLayerCount: 4)

**Proposed fix.** Layer tabs/Layers rows/'All copper' preset/keys cover In3/In4 on 6-layer boards. — Detail: Build strip tabs, Layers rows and presets from copperLayersForCount(board.layerCount) (colours already exist via copperLayerColor ramp); make 3/4 (and e.g. 5/6 or +/-) step through inner layers for any count ≥4; call layerPairPresets(board.layerCount) in LayerPairSelect and key the chosen pair per design. Until then, warn at import that In3+ are not editable.

**Evidence.** [051-6L-pcb](../evidence/shots/f2b/dark/051-6L-pcb.png), [012-6L-pcb](../evidence/shots/vf2b/dark/012-6L-pcb.png)

<details><summary>F2B-007 — 6-layer boards: In3/In4 copper is invisible and unreachable — no layer tab, no Layers row, 'All copper' preset skips them, keys 3/4 go dead, and the layer-pair list only knows 4-layer pairs (S2, confirmed)</summary>

- Area designer.pcb · stack B · design 315789a0-b31c-48d7-bd36-b48cc3d3c593 · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. Stack B: Home → Import KiCad… → $QA/f2b/QA-f2b-6L.zip (F.Cu, In1–In4, B.Cu; tracks on In3 (Net-(D2-K) ×4) and In4 (Net-(U1-VDD) ×3)) → QA-f2b-6L
  2. PCB: read the layer tab strip, the Layers panel, Board → Stackup ('Copper layers 6')
  3. Hover canvas, press 3 / 4
  4. Layers → Preset ▾ → All copper
  5. R → layer-pair select; click where the In3 track runs (155.75, 140.3)
- Expected: Every copper layer of the stackup is listed, visible and routable (tabs In1…In4 or 'Mid-Layer 1…4', rows with eye/opacity, 'All copper' = all six, layer keys or a layer picker for In3/In4, layer pairs for adjacent layers In2↔In3, In3↔In4, In4↔B).
- Actual: Projection has traces on In3.Cu (4) and In4.Cu (3), but the strip shows only Top, Mid-Layer 1, Mid-Layer 2, Bottom; the Layers panel has no In3/In4 rows; 'All copper' sets visibleLayers to [F.Cu, In1.Cu, In2.Cu, B.Cu] only, so the In3/In4 tracks are never drawn (nothing at the D2-K chain location, shot 054). Keys 3/4 do nothing on a 6-layer board (handler requires layerCount === 4), so In1/In2 are keyboard-unreachable too. The route tool's 'Smart-via layer pair' offers F↔B, F↔In1, In1↔In2, In2↔B (In2↔B is not an adjacent pair on 6 layers); clicking on the hidden In3 track starts a no-net route on In2 in empty space. The layer pair chosen on the 4-layer design ('In1↔In2') also carries over to this design. Import review showed 'Copper layers 6' with no warning that half the inner stack cannot be viewed/edited. Inconsistently, the Zone tool's Layer select does offer In3.Cu and In4.Cu, so a user can draw a pour on a layer they can never see.
- Screenshots: [051-6L-pcb](../evidence/shots/f2b/dark/051-6L-pcb.png), [053-6L-click-In3-trace](../evidence/shots/f2b/dark/053-6L-click-In3-trace.png), [054-6L-all-copper](../evidence/shots/f2b/dark/054-6L-all-copper.png), [052-6L-route-row](../evidence/shots/f2b/dark/052-6L-route-row.png), [057-6L-zone-layer-select](../evidence/shots/f2b/light/057-6L-zone-layer-select.png)
- Network: `GET /designs/315789a0…/projection/pcb → layerCount 6; traces In3.Cu 4, In4.Cu 3; after 'All copper' visibleLayers ['F.Cu','In1.Cu','In2.Cu','B.Cu','Edge.Cuts','Drill','Metadata']`
- Code: `src/modules/designer/frontend/pcb/PcbLayerTabStrip.tsx:17` — STRIP_LAYERS hard-codes In1/In2 (requiresLayerCount: 4)
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4900` — keys 3/4 gated on layerCount === 4
- Code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:69` — LayerPairSelect uses static LAYER_PAIR_PRESETS (route-layer.ts:26 = layerPairPresets(4))
- Code: `node_modules/@openpcb/r3f-eda-canvas/dist/layers.js:438` — 'All copper' preset visibleLayers hard-coded to F/In1/In2/B
- Code: `docs/pcb-hardening/15-high-speed-runway.md:293` — registered finding 7.3: PcbLayerTabStrip knows In1/In2 only
- Suggested fix: Build strip tabs, Layers rows and presets from copperLayersForCount(board.layerCount) (colours already exist via copperLayerColor ramp); make 3/4 (and e.g. 5/6 or +/-) step through inner layers for any count ≥4; call layerPairPresets(board.layerCount) in LayerPairSelect and key the chosen pair per design. Until then, warn at import that In3+ are not editable.
- Verification (vf2b): **confirmed** — Reproduced on QA-f2b-6L (dark + light, 1440x900): Board Stackup 'Copper layers 6', preset 'All copper', but the tab strip and Layers panel list only Top Copper, Mid-Layer 1, Mid-Layer 2, Bottom Copper; keys 1->Top, 3->no change, 4->no change, 2->Bottom (keys gated on layerCount === 4, PcbCanvas.tsx:4900/4912); route tool 'Smart-via layer pair' offers F<->B, F<->In1, In1<->In2, In2<->B (PcbTopToolbar uses the static LAYER_PAIR_PRESETS = layerPairPresets(4)); the published 'All copper' preset lists F/In1/In2/B only (r3f-eda-canvas layers.js:438), and projection visibleLayers after it has no In3/In4 although 7 traces live there. The Zone tool's layer list uses copperLayersForCount(layerCount) and does offer In3/In4 (AreaToolOptionsBar.tsx:71). Note for triage: the tab-strip part is a registered limitation (docs/pcb-hardening/15-high-speed-runway.md section 7 item 3, owner 'the 4-layer UI backlog item'), but the app still accepts 6-layer imports with no warning and shows a board with invisible copper, so it stays a valid S2. · evidence: [012-6L-pcb](../evidence/shots/vf2b/dark/012-6L-pcb.png), [017-6L-export-422](../evidence/shots/vf2b/light/017-6L-export-422.png), vf2b/data/proj-315789a0-b31c-48d7-bd36-b48cc3d3c593.json

</details>


## T-144

**Auto Layout with cloud unreachable says the service 'does not support Auto Layout. Route Board is still available.'**

- Severity **S2** · category error-handling · status confirmed · themes dark
- Recommendation **decide** · decision DEC-C · owner D3 · wave W2 · scope backend · estimate S
- Findings: Q10-003

**Summary.** Dialog shows red error 'Your OpenPCB Cloud service does not support Auto Layout. Route Board is still available.' with Close / Try again. POST /autolayout → 501 AUTO_LAYOUT_SERVICE_UNSUPPORTED. Both statements are false: the service was never reached, and Route Board then fails with the same connection error (see Q10-004). 'Try again' repeats the same misleading message.

**Root cause.** `src/modules/designer/backend/autolayout/register-routes.ts:98` — getAutoLayoutCapabilities() returns null when unreachable; supportsLayout(null) is false → UNSUPPORTED

**Proposed fix.** Backend: distinguish 'unreachable' (503) from 'unsupported' in autolayout version probe; frontend shows offline copy. — Detail: In register-routes.ts distinguish caps === null (unreachable/timeout) from a reachable service lacking /v1/layout: throw a new AutoLayoutError('AUTO_LAYOUT_SERVICE_UNREACHABLE', 'Can't reach OpenPCB Cloud. Check your internet connection and try again.') mapped to 503, and handle that code in AutoLayoutDialog FailureNotice. Only mention Route Board when the route capability was actually observed.

**Evidence.** [050-C1-autolayout-signedin-idle](../evidence/shots/q10/dark/050-C1-autolayout-signedin-idle.png), [050-autolayout-signedin-idle](../evidence/shots/vq10/dark/050-autolayout-signedin-idle.png)

<details><summary>Q10-003 — Auto Layout with cloud unreachable says the service 'does not support Auto Layout. Route Board is still available.' (S2, confirmed)</summary>

- Area designer.pcb · stack C1 · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. Stack C1, signed in (simulated session, see Q10-002), open 'Dual LED Blinker' → PCB
  2. Click 'Auto Layout…' (bottom-right of canvas) → 'Run Auto Layout'
- Expected: A clear 'OpenPCB Cloud is unreachable — check your connection and try again' message; no claim about service capability; no pointer to another cloud feature that is equally unreachable.
- Actual: Dialog shows red error 'Your OpenPCB Cloud service does not support Auto Layout. Route Board is still available.' with Close / Try again. POST /autolayout → 501 AUTO_LAYOUT_SERVICE_UNSUPPORTED. Both statements are false: the service was never reached, and Route Board then fails with the same connection error (see Q10-004). 'Try again' repeats the same misleading message.
- Screenshots: [050-C1-autolayout-signedin-idle](../evidence/shots/q10/dark/050-C1-autolayout-signedin-idle.png), [052-C1-autolayout-run-5s](../evidence/shots/q10/dark/052-C1-autolayout-run-5s.png)
- Console: `Failed to load resource: 501 (Not Implemented) @ /api/modules/designer/designs/c2c58a19…/autolayout`
- Network: `POST /api/modules/designer/designs/c2c58a19…/autolayout → 501 {"code":"AUTO_LAYOUT_SERVICE_UNSUPPORTED","title":"Your OpenPCB Cloud service does not support Auto Layout. Route Board is still available`
- Code: `src/modules/designer/backend/autolayout/register-routes.ts:98` — getAutoLayoutCapabilities() returns null when unreachable; supportsLayout(null) is false → UNSUPPORTED
- Code: `src/modules/designer/backend/autolayout/capabilities.ts:23` — null = unreachable OR invalid, conflated with 'unsupported'
- Code: `src/modules/designer/backend/autolayout/client.ts:27` — getAutoLayoutVersion returns null on network error (no distinction from a bad response)
- Code: `src/modules/designer/backend/autolayout/service-url.ts:20` — prod default https://autolayout.cloud.openpcb.app, so this reproduces for offline release users
- Suggested fix: In register-routes.ts distinguish caps === null (unreachable/timeout) from a reachable service lacking /v1/layout: throw a new AutoLayoutError('AUTO_LAYOUT_SERVICE_UNREACHABLE', 'Can't reach OpenPCB Cloud. Check your internet connection and try again.') mapped to 503, and handle that code in AutoLayoutDialog FailureNotice. Only mention Route Board when the route capability was actually observed.
- Verification (vq10): **confirmed** — Reproduced signed-in: Auto Layout… → Run Auto Layout → POST /autolayout 501 and the dialog says 'Your OpenPCB Cloud service does not support Auto Layout. Route Board is still available.' with Close / Try again. Route Board… then fails with 'Unable to connect…', so both statements are false. Code: getAutoLayoutVersion() swallows every fetch error and returns null (client.ts:27-41); supportsLayout(null) is false, so unreachable is reported as unsupported. Not a C1 artefact: in a packaged build (NODE_ENV=production) the base URL is https://autolayout.cloud.openpcb.app, and offline the same null path is taken. cloud.autolayout is 'all', so this ships. · evidence: [050-autolayout-signedin-idle](../evidence/shots/vq10/dark/050-autolayout-signedin-idle.png), [051-autolayout-run-offline](../evidence/shots/vq10/dark/051-autolayout-run-offline.png), [052-routeboard-signedin-offline](../evidence/shots/vq10/dark/052-routeboard-signedin-offline.png), network: POST /api/modules/designer/designs/c2c58a19…/autolayout → 501

</details>


## T-145

**DRC count differs between toolbar (errors only) and dock tab / status bar (errors+warnings)**

- Severity **S2** · category consistency · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: Q4-001 · known ref spike

**Summary.** Toolbar DRC button shows '13' (errors only, PcbCanvas drcErrorCount = summary.errors); dock tab badge shows '19' in red and status bar shows '19 DRC' with a red diamond (errors+warnings). Home list row shows '13 errors'. Three different numbers semantics on one screen, no label/tooltip telling which is which; warnings-only boards will still render a red (danger) badge on the dock tab. Re-checked after a later DRC ru…

**Root cause.** `src/modules/designer/frontend/pcb/PcbCanvas.tsx:606` — drcErrorCount = report.summary.errors

**Proposed fix.** One DRC count everywhere (errors+warnings with split tooltip) — toolbar = dock = status bar. — Detail: Pick one metric (recommend errors, with warnings as a secondary amber count 'E 13 · W 6') and share it via a single selector in useDrcStore; use text-status-warning when only warnings exist; add a title like '13 errors, 6 warnings' on all three.

**Evidence.** [001-pcb-initial](../evidence/shots/q4/dark/001-pcb-initial.png), [001-pcb](../evidence/shots/vq4/dark/001-pcb.png)

<details><summary>Q4-001 — DRC count differs between toolbar (errors only) and dock tab / status bar (errors+warnings) (S2, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark, light · viewports 1440x900
- Repro:
  1. Open 'Dual LED Blinker' (13 errors, 6 warnings in last DRC run)
  2. Switch to PCB view
  3. Compare toolbar 'DRC' badge, right-dock 'DRC' tab badge, and status-bar DRC chip
- Expected: One number (or clearly split errors/warnings) used consistently in every DRC indicator; badge colour red only when errors exist
- Actual: Toolbar DRC button shows '13' (errors only, PcbCanvas drcErrorCount = summary.errors); dock tab badge shows '19' in red and status bar shows '19 DRC' with a red diamond (errors+warnings). Home list row shows '13 errors'. Three different numbers semantics on one screen, no label/tooltip telling which is which; warnings-only boards will still render a red (danger) badge on the dock tab. Re-checked after a later DRC run: toolbar 32 vs dock tab 106 vs status bar 106 (both themes); while a route is in progress the status-bar chip switches to the live route count ('1 DRC') — a fourth number with the same label.
- Screenshots: [001-pcb-initial](../evidence/shots/q4/dark/001-pcb-initial.png), [171-dual-led-pcb](../evidence/shots/q4/dark/171-dual-led-pcb.png), [186-1100-routing](../evidence/shots/q4/dark/186-1100-routing.png), [002-pcb](../evidence/shots/q4/light/002-pcb.png), [001-pcb](../evidence/shots/vq4/dark/001-pcb.png), [019-routing](../evidence/shots/vq4/dark/019-routing.png), [030-drc-demo-pcb](../evidence/shots/vq4/dark/030-drc-demo-pcb.png)
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:606` — drcErrorCount = report.summary.errors
- Code: `src/modules/designer/frontend/Space.tsx:930` — drcIssueCount = errors + warnings, dock badge always text-status-danger (:970)
- Code: `src/modules/designer/frontend/Space.tsx:1588` — status bar: pcbLiveDrc ?? errors+warnings — live route count reuses the same chip
- Suggested fix: Pick one metric (recommend errors, with warnings as a secondary amber count 'E 13 · W 6') and share it via a single selector in useDrcStore; use text-status-warning when only warnings exist; add a title like '13 errors, 6 warnings' on all three.
- Verification (vq4): **confirmed** — Reproduced on c2c58a19 (dark+light): toolbar DRC badge 32 (errors only) vs dock tab 106 and status bar 106 (errors+warnings); DRC Demo 3196d811 shows 6 vs 17 vs 17; while routing the status-bar chip switches to the live count ('3 DRC'). Root cause PcbCanvas.tsx:606 (summary.errors) vs Space.tsx:930-931 / :1588-1591 (errors+warnings, pcbLiveDrc override). Not intentional per PLAN D7 (which only routes the DRC button/counter to the dock). · evidence: [001-pcb](../evidence/shots/vq4/dark/001-pcb.png), [019-routing](../evidence/shots/vq4/dark/019-routing.png), [030-drc-demo-pcb](../evidence/shots/vq4/dark/030-drc-demo-pcb.png)

</details>


## T-146

**Canvas jumps 14 px each time a route/tune/notice row appears (resizes mid-gesture)**

- Severity **S2** · category bug · status confirmed · themes dark, light
- Recommendation **decide** · decision P1 · owner D1 · wave W2 · scope decision · estimate M
- Findings: Q4-004, F1B-033, F2A-020

**Summary.** The toolbar stack grows 28 px per row (Route row, hint row, notice row), the canvas shrinks and the orthographic camera stays centred, so all copper moves 14 px vertically. The rubber-band endpoint jumps ~0.7 mm at 80% zoom right after the first click, and again whenever a transient notice ('Via blocked', 'Commit blocked') appears/disappears, causing misplaced clicks. | Also covers: F1B-033: Arming Route (R) or Tune (U) inserts a 28 px parameter bar above the PCB canvas, so the b…; F2A-020: Extension of F1B-033/Q4-004: after the FIRST click of a route a second hint row ('Enter f…

**Root cause.** `src/modules/designer/frontend/Space.tsx:1314` — param-row slot is a shrink-0 flex child above the canvas, so every portalled row shrinks the canvas

**Proposed fix.** Reserve a fixed tool/hint row in PCB view (or render route/notice rows as canvas overlays) so the canvas never resizes mid-gesture. — Detail: Keep the param row a fixed single 28 px row per D10: move the route hint line into the status bar (it is already duplicated there) and render routeNotice/autoFinish notices as an absolutely-positioned overlay inside the canvas (like AreaToolOptionsBar) instead of extra rows in the Space.tsx:1314 slot; optionally reserve the 28 px slot whenever the PCB view is active so arming Route doesn't resize the canvas.

**Evidence.** [018-route-idle](../evidence/shots/vq4/dark/018-route-idle.png), [019-routing](../evidence/shots/vq4/dark/019-routing.png), [001-pcb-initial](../evidence/shots/q4/dark/001-pcb-initial.png)

<details><summary>Q4-004 — Board jumps 14 px under the cursor each time a route/notice row appears (canvas resizes mid-gesture) (S2, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. PCB view at 1440x900, note a pad position (J1 pin 2 at ~463,462)
  2. Press R: the Route parameter row appears → pad now at ~463,476
  3. Click the pad to start routing: second hint row appears → pad now at ~463,490
  4. Press V where the via is refused: a third 'Via blocked…' row appears → board shifts again; row disappears on next action → shifts back
- Expected: Starting a tool/route never moves the design under a stationary cursor (param rows overlay the canvas or reserve fixed space, or the camera compensates)
- Actual: The toolbar stack grows 28 px per row (Route row, hint row, notice row), the canvas shrinks and the orthographic camera stays centred, so all copper moves 14 px vertically. The rubber-band endpoint jumps ~0.7 mm at 80% zoom right after the first click, and again whenever a transient notice ('Via blocked', 'Commit blocked') appears/disappears, causing misplaced clicks.
- Screenshots: [001-pcb-initial](../evidence/shots/q4/dark/001-pcb-initial.png), [005-route-mode-idle](../evidence/shots/q4/dark/005-route-mode-idle.png), [021-routing-start](../evidence/shots/q4/dark/021-routing-start.png), [028-route-via](../evidence/shots/q4/dark/028-route-via.png), [030-route-via3](../evidence/shots/q4/dark/030-route-via3.png), [017-before-route](../evidence/shots/vq4/dark/017-before-route.png), [018-route-idle](../evidence/shots/vq4/dark/018-route-idle.png), [019-routing](../evidence/shots/vq4/dark/019-routing.png), [021-via-blocked2](../evidence/shots/vq4/dark/021-via-blocked2.png)
- Code: `src/modules/designer/frontend/Space.tsx:1314` — param-row slot is a shrink-0 flex child above the canvas, so every portalled row shrinks the canvas
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:6617` — param row / hint / notice rows portalled into paramRowTarget
- Code: `src/modules/designer/frontend/pcb/RouteHud.tsx:31` — routeNotice rendered as an extra row
- Suggested fix: Keep the param row a fixed single 28 px row per D10: move the route hint line into the status bar (it is already duplicated there) and render routeNotice/autoFinish notices as an absolutely-positioned overlay inside the canvas (like AreaToolOptionsBar) instead of extra rows in the Space.tsx:1314 slot; optionally reserve the 28 px slot whenever the PCB view is active so arming Route doesn't resize the canvas.
- Verification (vq4): **confirmed** — Reproduced at 1440x900: canvas box top 64 -> 92 when R arms Route (param row), -> 120 after the first pad click (extra hint row 'Enter finish V via + layer…'), -> 148 when 'Via blocked…' notice appears; the whole editor body (left sidebar too) shifts, the board moves 14 px per row under a stationary cursor mid-gesture. PLAN D10 allows one 28 px param row; the extra hint/notice rows are not in D10 and cause the mid-route jump. Kept S2: it affects every route start in the core routing flow. · evidence: [017-before-route](../evidence/shots/vq4/dark/017-before-route.png), [018-route-idle](../evidence/shots/vq4/dark/018-route-idle.png), [019-routing](../evidence/shots/vq4/dark/019-routing.png), [021-via-blocked2](../evidence/shots/vq4/dark/021-via-blocked2.png)

</details>

<details><summary>F1B-033 — Arming Route (R) or Tune (U) inserts a 28 px parameter bar above the PCB canvas, so the board jumps ~14 px under the cursor; clicking a trace in Tune adds a second row and shifts it again (S3, confirmed)</summary>

- Area designer.pcb · stack A · design cc5a12b9-bd16-4e8c-9c00-f94598075fd5 · themes dark · viewports 1440x900, 1100x720
- Repro:
  1. QA-f1b-stress → PCB, hold the mouse still at (700,500) and read the status-bar X/Y
  2. Press R (route) without moving the mouse and read X/Y again
  3. Esc; press U (Tune), click a routed trace (Net_43)
- Expected: Tool parameters appear in a fixed-height strip or an overlay so the canvas never resizes; the pad/trace under the cursor stays under the cursor when a tool is armed by key (KiCad/Altium keep the canvas fixed).
- Actual: Canvas top moves 64 → 92 px on R and on U (Measure M and Hole H do not); the world point under the stationary cursor changes from (−10.055, −11.243) to (−10.055, −7.633) mm — a 14 px jump — and returns on Esc. In Tune, clicking a trace adds the 28 px HUD row (canvas top 92 → 120) so the trace the user just clicked slides another ~14 px away before 'sweep along the trace' can start (shots 115: trace at y≈600–715 before, ≈615–730 after). At 1100×720 the Tune HUD wraps to 56 px (F1B-034), shifting further.
- Screenshots: [115-tune-long-group-name](../evidence/shots/f1b/dark/115-tune-long-group-name.png), [116-tune-long-group-1100](../evidence/shots/f1b/dark/116-tune-long-group-1100.png), [117-tune-short-group-1100](../evidence/shots/f1b/dark/117-tune-short-group-1100.png)
- Console: `canvas top: idle 64, tuneArmed 92, routeArmed 92, measure 64, holeTool 64, afterEsc 64`; `status X/Y at fixed cursor (700,500): idle [-10.055,-11.243] → route armed [-10.055,-7.633] → Esc [-10.055,-11.243]`
- Code: `src/modules/designer/frontend/Space.tsx:1314` — pcbParamRowSlot is an in-flow shrink-0 div above the canvas — portalled PcbParamRow content changes its height
- Code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:799` — PcbParamRow (RouteHud/TuneHud/BundleHud render into it)
- Suggested fix: Reserve the param strip permanently (fixed 28 px, empty/idle hint when no tool) or render tool HUDs as an absolutely positioned overlay on top of the canvas so the canvas box never changes when a tool is armed; single-line HUD with ellipsis (see F1B-034).
- Verification (vf1b): **confirmed** — Reproduced on QA-f1b-stress with the mouse held at (700,500). Canvas top is 64 idle, 92 after R, 64 after Esc, 92 after U; the world point under the cursor moved from Y -11.243 to -7.633 mm (14 px) on arming. Clicking a trace in Tune moved the canvas top 92 -> 120. Not refuted: PLAN D10 intends the 28 px parameter row to appear only while Route/Tune/Bundle is active, but D5/D10 do not require it to resize the canvas. The in-flow slot (Space.tsx:1314) causes the jump, so the fix should overlay the HUD rather than reserve a permanent strip (which would contradict D10). S3 kept, fixScope design-decision. · evidence: [022-tune-hud](../evidence/shots/vf1b/dark/022-tune-hud.png), run-code: idle top 64 'X -10.313 Y -11.243' -> route top 92 'Y -7.633' -> esc 64 -> tune 92; trace click 92->120

</details>

<details><summary>F2A-020 — Extension of F1B-033/Q4-004: after the FIRST click of a route a second hint row ('Enter finish · V via + layer · W width …') is inserted, so the board jumps another 14 px between the start and end click of every trace (S2, duplicate)</summary>

- Area designer.pcb · stack A · design 847e94e7-36e6-4284-b22c-17725e0f5b02 · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. PCB idle: calibrate (e.g. U1.3 at y=451)
  2. Press R: row 1 appears → board +14 px (U1.3 at 465)
  3. Click a start pad: row 2 (hints) appears → board +14 px again (U1.3 at 479)
  4. Aim at the target pad where it was a moment ago
- Expected: Route rows overlay the canvas or reserve space permanently; pads never move under the cursor mid-gesture.
- Actual: Three different frames in one trace: idle (oy 26.52 mm), route armed (27.32), route active (28.13) — 0.8 mm per step at 17 px/mm. My first attempt at R3.1→U1.3 missed the pad by 14 px and turned into a runaway route through U1 with '8 conflicts' ([043-routes-2-6](../evidence/shots/f2a/dark/043-routes-2-6.png)) that had to be cancelled.
- Screenshots: [041-route-armed](../evidence/shots/f2a/dark/041-route-armed.png), [043-routes-2-6](../evidence/shots/f2a/dark/043-routes-2-6.png), [005-route-active-light](../evidence/shots/f2a/light/005-route-active-light.png), [112-route-active-1100](../evidence/shots/f2a/dark/112-route-active-1100.png), [011-route-active-1100](../evidence/shots/f2a/light/011-route-active-1100.png)
- Code: `src/modules/designer/frontend/Space.tsx:1309` — PcbCanvas portals its docked toolbar / parameter rows into in-flow containers above the canvas
- Suggested fix: Render the route parameter + hint rows as an overlay (absolute) or keep a fixed-height slot always reserved in PCB view.
- Verification (vf2a): **duplicate** — Reproduced: golden PCB canvas top 64 (idle) → 92 (R armed) → 120 (after the first pad click, hint row 'Enter finish V via + layer W width …'); the board moves 14 px at each step. Verified Q4-004 already records exactly this ('canvas box top 64 -> 92 when R arms Route, -> 120 after the first pad click (extra hint row …)', S2) with the same fix (single fixed row / overlay). F1B-033 covers the first row. No new root cause. · evidence: [021-route-vcc-active](../evidence/shots/vf2a/dark/021-route-vcc-active.png), canvas top/height: idle 64/792, armed 92/764, active 120/736

</details>


## T-147

**Trace width / via diameter / via drill 'Custom…' use native window.prompt with no validation**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: Q4-008 · known ref K03
- Depends on: ['T-004', 'T-014']

**Summary.** 3 window.prompt calls (dialog-spy count prompt=3); menu item label 'Custom… (Alt+W)' promises the inline editor but opens a native prompt instead; non-numeric input silently discarded; drill ≥ diameter accepted and a physically impossible via is dropped into the session (only live DRC '6 conflicts' hints at it). Native prompts are unstyled and blocked/unsupported in some Electron configs.

**Root cause.** `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:207` — window.prompt trace width

**Proposed fix.** 'Custom…' width/via -> inline kit NumberInput popover with validation (no window.prompt). — Detail: Replace prompts with an inline numeric input inside the dropdown (reuse the RouteHud 'Trace width (mm)' input pattern); validate drill < diameter − 2×min annular ring and show the error inline; make the 'Custom…' item open the same inline editor as Alt+W.

**Evidence.** [023-width-dropdown](../evidence/shots/q4/dark/023-width-dropdown.png), [022-width-dd](../evidence/shots/vq4/dark/022-width-dd.png)

<details><summary>Q4-008 — Trace width / via diameter / via drill 'Custom…' use native window.prompt with no validation (S2, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. PCB → R → click J1 pin 2 to start routing
  2. Click the 'W 0.500 mm' chip → 'Custom… (Alt+W)' → native prompt 'Custom trace width (mm):'
  3. Click 'Ø 0.80 mm' → 'Custom…' → prompt 'Custom diameter (mm):', type 'abc' → nothing happens, no error
  4. Click '⌀ 0.40 mm' → 'Custom…' → prompt 'Custom drill (mm):', type 1.2 (> 0.80 diameter) → accepted; press V → a via with drill larger than its pad is placed
- Expected: Inline numeric editor (the RouteHud already has one for width, opened by Alt+W) with validation (drill < diameter, ≥ fab min) and inline error text
- Actual: 3 window.prompt calls (dialog-spy count prompt=3); menu item label 'Custom… (Alt+W)' promises the inline editor but opens a native prompt instead; non-numeric input silently discarded; drill ≥ diameter accepted and a physically impossible via is dropped into the session (only live DRC '6 conflicts' hints at it). Native prompts are unstyled and blocked/unsupported in some Electron configs.
- Screenshots: [023-width-dropdown](../evidence/shots/q4/dark/023-width-dropdown.png), [025-alt-w-inline](../evidence/shots/q4/dark/025-alt-w-inline.png), [046-via-dia-dd](../evidence/shots/q4/dark/046-via-dia-dd.png), [047-drill-gt-dia](../evidence/shots/q4/dark/047-drill-gt-dia.png), [048-via-bad-drill](../evidence/shots/q4/dark/048-via-bad-drill.png), [022-width-dd](../evidence/shots/vq4/dark/022-width-dd.png), [023-drill-gt-dia](../evidence/shots/vq4/dark/023-drill-gt-dia.png), [024-drill-dd](../evidence/shots/vq4/dark/024-drill-dd.png)
- Console: `dialog-spy: prompt: Custom trace width (mm): / prompt: Custom diameter (mm): / prompt: Custom drill (mm):`
- Code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:207` — window.prompt trace width
- Code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:294` — window.prompt via diameter/drill
- Suggested fix: Replace prompts with an inline numeric input inside the dropdown (reuse the RouteHud 'Trace width (mm)' input pattern); validate drill < diameter − 2×min annular ring and show the error inline; make the 'Custom…' item open the same inline editor as Alt+W.
- Verification (vq4): **confirmed** — Reproduced: while routing, W chip -> 'Custom… (Alt+W)' opens native prompt 'Custom trace width (mm):' (dialog spy prompt=1); drill chip -> Custom… accepted 1.2 mm with via diameter 0.80 (chip showed '⌀ 1.20 mm', no validation). Code PcbTopToolbar.tsx:207 and :294. Electron has no window.prompt support and electron/src has no shim, so these controls do nothing in the desktop app. · evidence: [022-width-dd](../evidence/shots/vq4/dark/022-width-dd.png), [023-drill-gt-dia](../evidence/shots/vq4/dark/023-drill-gt-dia.png), [024-drill-dd](../evidence/shots/vq4/dark/024-drill-dd.png)

</details>


## T-148

**Deleting a footprint on PCB silently re-spawns it at an auto position overlapping another part**

- Severity **S2** · category data · status confirmed · themes dark
- Recommendation **decide** · decision DEC-PCB2 · owner D3 · wave W2 · scope decision · estimate S
- Findings: Q4-014

**Summary.** POST pcb_delete_placement succeeds (rev 498→499), the schematic sync immediately creates a NEW placement for R3 at X -2.015 Y -3.052, rotation 0 — directly on top of R4's pads. No notice, Components list still shows 11 parts, selection cleared. Undo restores the old placement, but a user who doesn't notice ends up with overlapping parts / broken routing.

**Root cause.** `src/modules/designer/backend/command-executor.ts:1689` — pcb_delete_placement deletes the row

**Proposed fix.** Block PCB delete of schematic-backed footprints with notice 'Delete R3 in the schematic' (frontend); no re-spawn. — Detail: Refuse pcb_delete_placement for schematic-backed placements (or convert it into 'unplace' that keeps position/rotation in a parked area and shows a notice); in the UI, disable Delete for footprints and hint 'Delete R3 in the schematic'.

**Evidence.** [076-delete-part](../evidence/shots/q4/dark/076-delete-part.png), [014-r3-respawned](../evidence/shots/vq4/dark/014-r3-respawned.png)

<details><summary>Q4-014 — Deleting a footprint on PCB silently re-spawns it at an auto position overlapping another part (S2, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. Open 'Dual LED Blinker' → PCB
  2. Click 'R3' in the Components panel (selects + centres R3 at X -6.480 Y -2.967)
  3. Press Delete (hint says 'Del delete')
  4. Click R3 in the Components panel again
- Expected: Either the footprint is removed (and the part shown as unplaced) or deletion is refused with a message ('R3 is driven by the schematic — delete it there'); never a silent move
- Actual: POST pcb_delete_placement succeeds (rev 498→499), the schematic sync immediately creates a NEW placement for R3 at X -2.015 Y -3.052, rotation 0 — directly on top of R4's pads. No notice, Components list still shows 11 parts, selection cleared. Undo restores the old placement, but a user who doesn't notice ends up with overlapping parts / broken routing.
- Screenshots: [076-delete-part](../evidence/shots/q4/dark/076-delete-part.png), [077-r3-respawned](../evidence/shots/q4/dark/077-r3-respawned.png), [014-r3-respawned](../evidence/shots/vq4/dark/014-r3-respawned.png)
- Network: `POST /commands {pcb_delete_placement 84f4d01f} → ok rev 499`; `GET projection/pcb → R3 placement id 7cb794b2 positionMm {-2.015,-3.052}`
- Code: `src/modules/designer/backend/command-executor.ts:1689` — pcb_delete_placement deletes the row
- Code: `src/modules/designer/backend/pcb/pcb-projection.ts:206` — projection read calls syncPcbPlacementsFromSchematic, re-adding the part at an auto position
- Code: `src/modules/designer/backend/pcb/pcb-store.ts:1870` — syncPcbPlacementsFromSchematic
- Suggested fix: Refuse pcb_delete_placement for schematic-backed placements (or convert it into 'unplace' that keeps position/rotation in a parked area and shows a notice); in the UI, disable Delete for footprints and hint 'Delete R3 in the schematic'.
- Verification (vq4): **confirmed** — Reproduced on c2c58a19: selected R3 via the Components panel (84f4d01f at -6.480,-2.967), pressed Delete -> rev 533, R3 re-created as 7cb794b2 at (-2.015,-3.052) overlapping R4; still 11 components, no notice. Cmd+Z restored the original. Backend deletes the row (command-executor.ts:1689) and the projection read re-syncs missing placements from the schematic (pcb-projection.ts:206 -> pcb-store.ts:1870 syncPcbPlacementsFromSchematic). · evidence: [014-r3-respawned](../evidence/shots/vq4/dark/014-r3-respawned.png)

</details>


## T-149

**Vias under a trace end can't be picked: click/right-click always hit the trace, and the Alt+click overlap picker closes the instant it opens**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate M
- Findings: Q4-016

**Summary.** hit order pad → trace → via, so any via with a connected trace is unreachable by click. The 'Disambiguation chooser' listbox is mounted and removed on the same click (MutationObserver saw it added once, it is gone 400 ms later): its window mousedown 'click-outside' listener is registered during the pointerdown that opened it and then fires for that same click's mousedown. Because the popup state is reset, 'Alt+click…

**Root cause.** `src/modules/designer/frontend/pcb/pcb-hit.ts:396` — Order: pad → trace → via → placement

**Proposed fix.** Hit-test prefers vias over trace ends; Alt+click overlap picker stays open until choice/Esc. — Detail: Put vias before traces in the plain-click and context-menu hit order; in PcbDisambiguationPopup register the outside-close listener on the next tick (setTimeout 0) or ignore the event whose timeStamp ≤ open time; add real Trace/Via property sections (net, layer, width/diameter/drill, length) with editable width/size.

**Evidence.** [085-zoom-via](../evidence/shots/q4/dark/085-zoom-via.png), [015-zoom-via](../evidence/shots/vq4/dark/015-zoom-via.png)

<details><summary>Q4-016 — Vias under a trace end can't be picked: click/right-click always hit the trace, and the Alt+click overlap picker closes the instant it opens (S2, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. PCB, zoom in on any via with a trace ending on it (e.g. the via right of R5)
  2. Click the middle of the via → status bar 'Trace · …'
  3. Right-click the via → menu is 'Split and reroute from here / Delete trace / Add comment' (no via menu)
  4. Alt+click the via → no chooser visible, the trace stays selected; repeating Alt+click never cycles to the via
- Expected: Via wins over track on a direct click (KiCad), or the Alt+click chooser stays open listing Trace + Via
- Actual: hit order pad → trace → via, so any via with a connected trace is unreachable by click. The 'Disambiguation chooser' listbox is mounted and removed on the same click (MutationObserver saw it added once, it is gone 400 ms later): its window mousedown 'click-outside' listener is registered during the pointerdown that opened it and then fires for that same click's mousedown. Because the popup state is reset, 'Alt+click again to cycle' always re-picks candidate 0. Only workaround is F → Selection filter → untick Traces. Via right-click shows the trace menu even when traces are filtered out. Via and trace inspectors show only 'CONTENTS · Vias 1 / Traces 1' — no net, width, layer, diameter/drill, and nothing is editable.
- Screenshots: [085-zoom-via](../evidence/shots/q4/dark/085-zoom-via.png), [088-via-selected](../evidence/shots/q4/dark/088-via-selected.png), [089-ctx-via](../evidence/shots/q4/dark/089-ctx-via.png), [090-overlap-picker](../evidence/shots/q4/dark/090-overlap-picker.png), [082-trace-inspector](../evidence/shots/q4/dark/082-trace-inspector.png), [015-zoom-via](../evidence/shots/vq4/dark/015-zoom-via.png), [016-ctx-via](../evidence/shots/vq4/dark/016-ctx-via.png)
- Code: `src/modules/designer/frontend/pcb/pcb-hit.ts:396` — Order: pad → trace → via → placement
- Code: `src/modules/designer/frontend/pcb/PcbDisambiguationPopup.tsx:58` — window mousedown outside-close registered while the opening click is still in flight
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:3225` — Alt+click opens popup from the pointerdown handler
- Suggested fix: Put vias before traces in the plain-click and context-menu hit order; in PcbDisambiguationPopup register the outside-close listener on the next tick (setTimeout 0) or ignore the event whose timeStamp ≤ open time; add real Trace/Via property sections (net, layer, width/diameter/drill, length) with editable width/size.
- Verification (vq4): **confirmed** — Reproduced: clicking the centre of a via with a trace ending on it selects 'Trace · 51272803:15620728'; right-click shows the trace menu (Split and reroute / Delete trace / Add comment); Alt+click mounts the 'Disambiguation chooser' listbox and removes it 6 ms later (MutationObserver log added/removed). Hit order pad->trace->via (pcb-hit.ts:396); popup's window mousedown outside-close (PcbDisambiguationPopup.tsx:58-66) catches the same click that opened it from pointerdown (PcbCanvas.tsx:3225). · evidence: [015-zoom-via](../evidence/shots/vq4/dark/015-zoom-via.png), [016-ctx-via](../evidence/shots/vq4/dark/016-ctx-via.png)

</details>


## T-150

**PCB dialogs lack dialog semantics/focus management (rules, export, outline modals)**

- Severity **S2** · category a11y · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate M
- Findings: Q4-022, Q4-027, Q11-005
- Depends on: ['T-014']

**Summary.** Focus stays on the trigger; Esc does nothing; dialog has no accessible name; 7 net-assignment selects are nameless (census); pressing R/T in a select armed Route and then the Text tool behind the modal (toolbar showed 'Text'). Numeric inputs are 21 px and centre-aligned (kit 22 px, right-aligned elsewhere). | Also covers: Q4-027: Board-outline modals (Fillet/Chamfer corner, Set vertex position, Set edge length, Import…; Q11-005: Modal dialogs don't manage focus: PCB Design rules and Export never take focus, Tab walks…

**Root cause.** `src/modules/designer/frontend/components/PcbDesignRulesDialog.tsx:284` — role=dialog aria-modal, no labelledby, no key handling

**Proposed fix.** Design rules, Export, corner/vertex/edge/DXF modals -> kit Dialog (role, name, Esc, focus trap + restore); hotkeys suppressed while open. — Detail: Render via the kit Dialog (focus trap, Esc, labelledby); aria-label each select `${net} net class`; see Q4-019 for the keymap guard.

**Evidence.** [099-rules-dialog](../evidence/shots/q4/dark/099-rules-dialog.png), [009-rules-dialog](../evidence/shots/vq4/dark/009-rules-dialog.png), [135-fillet-modal](../evidence/shots/q4/dark/135-fillet-modal.png)

<details><summary>Q4-022 — Design rules dialog: no Esc, no focus move/trap, unnamed dialog and selects, and PCB hotkeys fire from its <select>s (S3, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. Board properties → 'Edit rules…'
  2. Check document.activeElement (still the 'Edit rules…' button behind the modal)
  3. Press Esc with focus on an input or the dialog body → dialog stays open
  4. Focus a Net assignments <select> (Auto) and press R then T
- Expected: Focus moves into the dialog and is trapped; Esc = Cancel; role=dialog has aria-labelledby 'Design rules'; selects labelled by their net; keys inside the dialog never reach the canvas
- Actual: Focus stays on the trigger; Esc does nothing; dialog has no accessible name; 7 net-assignment selects are nameless (census); pressing R/T in a select armed Route and then the Text tool behind the modal (toolbar showed 'Text'). Numeric inputs are 21 px and centre-aligned (kit 22 px, right-aligned elsewhere).
- Screenshots: [099-rules-dialog](../evidence/shots/q4/dark/099-rules-dialog.png), [100-rules-select-keys](../evidence/shots/q4/dark/100-rules-select-keys.png), [009-rules-dialog](../evidence/shots/vq4/dark/009-rules-dialog.png)
- Census: `census/designer.pcb-rules-dialog-dark-1440.json`
- Code: `src/modules/designer/frontend/components/PcbDesignRulesDialog.tsx:284` — role=dialog aria-modal, no labelledby, no key handling
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4342` — only HTMLInputElement ignored
- Suggested fix: Render via the kit Dialog (focus trap, Esc, labelledby); aria-label each select `${net} net class`; see Q4-019 for the keymap guard.
- Verification (vq4): **confirmed** — Reproduced: after opening Design rules focus stays on 'Edit rules…' (BUTTON), Esc does not close, dialog has no aria-label/labelledby, all 8 selects have no accessible name; R pressed inside a net-assignment <select> armed Route behind the modal. The hotkey leak shares Q4-019's root cause; the dialog a11y part is distinct. · evidence: [009-rules-dialog](../evidence/shots/vq4/dark/009-rules-dialog.png)

</details>

<details><summary>Q4-027 — Board-outline modals (Fillet/Chamfer corner, Set vertex position, Set edge length, Import DXF) lack dialog semantics; Esc only works from the input (DXF: never) (S3, confirmed)</summary>

- Area designer.pcb · stack A · design 5909d519 · themes dark · viewports 1440x900
- Repro:
  1. QA-q4-board → PCB → Board panel Edit (custom outline) → right-click a corner → 'Fillet corner…' (or 'Chamfer corner…', 'Set position…'; right-click an edge → 'Set length…')
  2. Inspect DOM: no role=dialog / aria-modal / aria-labelledby; click the dialog body or a button, then press Esc → nothing
  3. Board panel → '⭳ Import DXF…' → choose board-rect.dxf → press Esc → dialog stays open (activeElement BODY)
  4. Compare titles: 'Fillet Corner' / 'Chamfer Corner' (CSS capitalize) vs 'Set vertex position', 'Set edge length', 'Import board outline from DXF'
- Expected: Kit Dialog: role=dialog + label, focus trapped and returned, Esc closes from anywhere, sentence-case titles, kit radio/inputs (22px)
- Actual: Hand-rolled fixed overlays (bg-black/40, shadow-xl); Esc handled only in the input onKeyDown (Corner/Edge) or not at all (DXF); focus not trapped; Title Case only on fillet/chamfer; inputs are 32px (h-8) with uppercase 'MM' suffix; DXF loop picker is a native radio rendered in browser-default blue (#99c8ff, off-token). Enter/validation themselves work ('Value is too large for this corner.').
- Screenshots: [135-fillet-modal](../evidence/shots/q4/dark/135-fillet-modal.png), [136-fillet-applied](../evidence/shots/q4/dark/136-fillet-applied.png), [138-set-position-modal](../evidence/shots/q4/dark/138-set-position-modal.png), [139-edge-dim-modal](../evidence/shots/q4/dark/139-edge-dim-modal.png), [146-dxf-inspected](../evidence/shots/q4/dark/146-dxf-inspected.png), [041-fillet-modal](../evidence/shots/vq4/dark/041-fillet-modal.png), [042-fillet-after-esc](../evidence/shots/vq4/dark/042-fillet-after-esc.png)
- Pixel probes: {"file": "shots/q4/dark/146-dxf-inspected.png", "x": 536, "y": 492, "hex": "#99c8ff", "nearestToken": "--status-info", "deltaE": 12.2}
- Code: `src/modules/designer/frontend/pcb/CornerOpModal.tsx:50` — fixed overlay, no role/aria, capitalize title, Esc only on input
- Code: `src/modules/designer/frontend/pcb/EdgeDimModal.tsx:101` — same pattern, h-8 inputs
- Code: `src/modules/designer/frontend/pcb/import/DxfImportModal.tsx:96` — no Esc handler, native radio line 168
- Suggested fix: Wrap all three in the shared kit Dialog (role=dialog, aria-labelledby, focus trap, Esc on the dialog root); drop 'capitalize' and use 'Fillet corner'/'Chamfer corner'; use kit Input (22px) and kit Radio (or accent-[var(--selection)]).
- Verification (vq4): **confirmed** — Reproduced: right-click board corner -> 'Fillet corner…' opens a fixed overlay with no role=dialog (0 dialogs in DOM), the title is lower-case 'fillet corner' with CSS capitalize, the input is 32 px (h-8); after blurring the input, Esc leaves the modal open (h2 still present). CornerOpModal.tsx:50-78 only handles Esc in the input onKeyDown; EdgeDimModal.tsx:89 does the same; DxfImportModal.tsx has no Escape handler and a native radio (:169). · evidence: [041-fillet-modal](../evidence/shots/vq4/dark/041-fillet-modal.png), [042-fillet-after-esc](../evidence/shots/vq4/dark/042-fillet-after-esc.png)

</details>

<details><summary>Q11-005 — Modal dialogs don't manage focus: PCB Design rules and Export never take focus, Tab walks the page behind aria-modal dialogs, focus is not restored on close (S2, confirmed)</summary>

- Area cross-cutting · stack A · design b5a31f3e · themes dark, light · viewports 1440x900
- Repro:
  1. Open GUIDE-VALIDATE. For each dialog: focus its trigger with the keyboard, press Enter, then press Tab 16×, Shift+Tab 3×, Esc; close with Cancel if still open; note document.activeElement at each step
  2. Cmd+K palette: Schem toolbar 'Place component'
  3. Power port picker: Schem toolbar 'Place power port'
  4. PCB Design rules: PCB → Properties (nothing selected) → 'Edit rules…'
  5. PCB Export: PCB toolbar 'Export…'
  6. Home delete: Home → select GUIDE-VALIDATE → detail 'More actions' → Delete (then Cancel — nothing deleted)
- Expected: Focus moves into the dialog on open, Tab/Shift+Tab cycle inside it, Esc closes it, and focus returns to the trigger (WAI-ARIA dialog pattern).
- Actual: Measured (identical in dark and light): Cmd+K palette — focus in ✓, trap ✓, Esc ✓, return ✗ (focus → <body>). Power port picker (role=dialog aria-modal=true) — focus in ✓ (input), trap ✗ (Tab: input → Cancel → <body> → rail Home/Designer/… → design tabs → toolbar while the picker stays open), Esc ✓, return ✗. PCB Design rules (aria-modal=true, no accessible name) — focus stays on 'Edit rules…' behind the overlay, trap ✗ (Tab goes to '21 DRC', rail, tabs, toolbar), Esc ✗ (still open), after Cancel focus → <body>. PCB Export (aria-modal=true) — focus stays on 'Export…', trap ✗ (Tab: DRC, View, Layers rows… behind the dialog), Esc ✓, return ✗. Home delete modal (no role) — focus stays on the hidden menu item 'Delete', Tab can't reach Cancel/Delete, Esc only closes the stale menu (modal stays), after Cancel focus → <body>. Keyboard users therefore operate the page behind 3 of 5 modals, and PCB/global hotkeys stay live there. [vq11] Also verified: with PCB 'Design rules' open (focus left on 'Edit rules…'), pressing R arms the Route tool behind the modal (Route aria-pressed false→true, hint 'Route — click a pad to start').
- Screenshots: [dlg2-pcb-rules-open](../evidence/shots/q11/light/dlg2-pcb-rules-open.png), [dlg2-pcb-export-open](../evidence/shots/q11/light/dlg2-pcb-export-open.png), [dlg2-powerport-open](../evidence/shots/q11/light/dlg2-powerport-open.png), [dlg2-cmdk-open](../evidence/shots/q11/light/dlg2-cmdk-open.png), [dlg2-home-delete-open](../evidence/shots/q11/light/dlg2-home-delete-open.png), [dlg2-pcb-rules-open](../evidence/shots/q11/dark/dlg2-pcb-rules-open.png)
- Census: `census/q11/dlg2-pcb-rules-light.json`
- Code: `src/modules/designer/frontend/components/PcbDesignRulesDialog.tsx:284` — hand-rolled role=dialog aria-modal, no aria-labelledby, no initial focus, no Esc handler
- Code: `src/modules/designer/frontend/pcb/PcbExportDialog.tsx:170` — hand-rolled role=dialog aria-modal, no initial focus/trap
- Code: `src/modules/designer/frontend/components/LabelPicker.tsx:40` — hand-rolled overlay, no trap/return
- Code: `src/modules/designer/frontend/components/ComponentCommandPalette.tsx:288` — Radix Dialog opened without a DialogTrigger → Radix has nothing to restore focus to
- Code: `src/core/frontend/src/screens/HomeScreen.tsx:58` — DeleteConfirmationModal: plain divs, no role/Esc/trap (K26)
- Suggested fix: Move all five onto the kit Radix Dialog (src/core/frontend/src/components/ui/dialog.tsx), which provides focus-in, trap, Esc and return; for programmatically opened dialogs remember document.activeElement on open and restore it in onCloseAutoFocus (Cmd+K palette, LabelPicker). Give the rules dialog aria-labelledby.
- Verification (vq11): **confirmed** — Reproduced in dark on GUIDE-VALIDATE. PCB Design rules: role=dialog aria-modal=true with no aria-labelledby or aria-label. Focus stays on 'Edit rules…' [OUT]; Tab walks 21 DRC → rail → Close tab → New design → PCB → Open the assistant (all outside the dialog); Esc leaves it open; after Cancel focus goes to BODY. Pressing 'r' while it is open arms Route behind the overlay. PCB Export: focus stays on 'Export…'; Tab walks DRC, View, then the Layers rows behind the dialog; Esc closes it. Power port picker: focus moves into the input, but Tab goes Cancel → BODY → rail; Esc closes it and focus lands on 'Schem', not the trigger. Cmd+K palette: focus in and trap work, but Esc returns focus to BODY. Home delete modal: no role=dialog, focus stuck on menuitem 'Delete' (4× Tab stays there), Esc 1 closes only the stale menu, Esc 2 does nothing, and after Cancel focus goes to BODY. Nothing was deleted (GUIDE-VALIDATE still r15). S2 kept: keyboard users operate the page behind 3 of 5 modals and destructive hotkeys stay live. Cross-agent overlaps: Q4-022 (rules dialog), Q1-002 (K26 Home delete), Q5-029 (KiCad import dialog); Q11-013 shares the fix. · evidence: [010-dlg-pcb-rules](../evidence/shots/vq11/dark/010-dlg-pcb-rules.png), [011-dlg-pcb-export](../evidence/shots/vq11/dark/011-dlg-pcb-export.png), [012-dlg-powerport](../evidence/shots/vq11/dark/012-dlg-powerport.png), [013-dlg-cmdk](../evidence/shots/vq11/dark/013-dlg-cmdk.png), [014-home-delete-mouse](../evidence/shots/vq11/dark/014-home-delete-mouse.png), [015-rules-open-r-pressed](../evidence/shots/vq11/dark/015-rules-open-r-pressed.png), verify/vq11/dlg-run.js, homedel-kb.js, hotkey-behind.js

</details>


## T-151

**DRC 'out of date' banner is inverted after PCB edits (missing while stale, shown right after a fresh run); tab revision frozen**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: Q4-023

**Summary.** DesignerDrcView compares the report against Space's state.projection.revision, which is never refreshed by PCB commands (still 449). So stale results look current and fresh results look stale; the design tab label stays 'r449' through 60 PCB revisions. The banner is also flush against the toolbar row with no padding.

**Root cause.** `src/modules/designer/frontend/components/DesignerDrcView.tsx:162` — stale = report.revision !== revision

**Proposed fix.** DRC stale banner compares report revision with live projection revision (after PCB edits), not frozen tab revision. — Detail: Pass the live PCB revision (usePcbWorkspace projection.revision, or a small design-revision store updated from every CommandResult) to DesignerDrcView at Space.tsx:1485/1495/1557 instead of state.projection?.revision; refresh the design list entry (or DesignTabs label) from the same source.

**Evidence.** [042-drc-dock](../evidence/shots/q4/dark/042-drc-dock.png), [007-drc-dock-before-run](../evidence/shots/vq4/dark/007-drc-dock-before-run.png)

<details><summary>Q4-023 — DRC 'out of date' banner is inverted after PCB edits (missing while stale, shown right after a fresh run); tab revision frozen (S2, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19, 3196d811 · themes dark · viewports 1440x900
- Repro:
  1. Open 'Dual LED Blinker' (tab shows r449, last DRC at rev 449)
  2. On PCB add a zone / route a trace (server revision → 505, GET /designs drcStatus.stale:true)
  3. Open DRC dock tab → no stale banner, old 13/6 results presented as current
  4. Click 'Run DRC' → server drcStatus {ranAtRevision 508, stale:false}
  5. Dock now shows 'The board changed since this DRC ran — results may be out of date. Re-run DRC.'
  6. Reproduced on DRC Demo (3196d811): Fit to parts + Cmd+Z (rev 13) → DRC dock → Run DRC → banner 'The board changed since this DRC ran — results may be out of date. Re-run DRC.' appears immediately although GET /designs drcStatus = {ranAtRevision 13, stale:false}; design tab still reads 'r11'
- Expected: Banner appears exactly when report.revision ≠ current PCB revision; design tab shows the current revision
- Actual: DesignerDrcView compares the report against Space's state.projection.revision, which is never refreshed by PCB commands (still 449). So stale results look current and fresh results look stale; the design tab label stays 'r449' through 60 PCB revisions. The banner is also flush against the toolbar row with no padding.
- Screenshots: [042-drc-dock](../evidence/shots/q4/dark/042-drc-dock.png), [104-drc-done](../evidence/shots/q4/dark/104-drc-done.png), [189-drc-demo-run](../evidence/shots/q4/dark/189-drc-demo-run.png), [007-drc-dock-before-run](../evidence/shots/vq4/dark/007-drc-dock-before-run.png), [008-drc-dock-after-run-banner](../evidence/shots/vq4/dark/008-drc-dock-after-run-banner.png), [032-drc-demo-stale-no-banner](../evidence/shots/vq4/dark/032-drc-demo-stale-no-banner.png)
- Network: `GET /api/modules/designer/designs → c2c58a19 revision 508, drcStatus.ranAtRevision 508 stale false`
- Code: `src/modules/designer/frontend/components/DesignerDrcView.tsx:162` — stale = report.revision !== revision
- Code: `src/modules/designer/frontend/Space.tsx:1495` — revision={state.projection?.revision} — schematic projection state, not bumped by PCB commands
- Code: `src/modules/designer/frontend/hooks/useDesignerWorkspace.ts:527` — PCB commands update only projectionRef.revision, not state
- Code: `src/modules/designer/frontend/components/DesignTabs.tsx:252` — tab r{revision} from design list, not refreshed
- Suggested fix: Pass the live PCB revision (usePcbWorkspace projection.revision, or a small design-revision store updated from every CommandResult) to DesignerDrcView at Space.tsx:1485/1495/1557 instead of state.projection?.revision; refresh the design list entry (or DesignTabs label) from the same source.
- Verification (vq4): **confirmed** — Reproduced both halves. c2c58a19: after Run DRC the server reports drcStatus {ranAtRevision 527, stale:false} but the dock shows 'The board changed since this DRC ran…', and the tab label still reads r520. 3196d811: after Fit to parts + undo (rev 15) the server says stale:true (ranAtRevision 13) but the DRC dock shows no banner. DesignerDrcView.tsx:162 compares against Space state.projection.revision (Space.tsx:1485/1495/1557), which PCB commands never update (they only update projectionRef, useDesignerWorkspace.ts:527-531). · evidence: [007-drc-dock-before-run](../evidence/shots/vq4/dark/007-drc-dock-before-run.png), [008-drc-dock-after-run-banner](../evidence/shots/vq4/dark/008-drc-dock-after-run-banner.png), [032-drc-demo-stale-no-banner](../evidence/shots/vq4/dark/032-drc-demo-stale-no-banner.png)

</details>


## T-152

**Export 'Include inner copper layers' checked on 2-layer boards; unchecking on 4-layer silently ships an unmanufacturable bundle**

- Severity **S2** · category consistency · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate XS
- Findings: Q4-024, F1B-017, F2B-006 · known ref K30

**Summary.** Checkbox enabled and checked (no effect: ZIP has 14 files, no In*.gbr). File name 'openpcb-c2c58a19-bef5-488a-bfa4-c6b133ea.zip' and every member prefixed with the truncated UUID. Warning text: 'C1, D1, D2, J1, R1,R2, R3, R4, R5,R6, ….' (inconsistent comma spacing, ellipsis + period). Dialog closes silently after the download with no confirmation. Download itself works (Gerber X2 F/B Cu, Mask, Paste, Silkscreen, Edg… | Also covers: F1B-017: Export dialog 'Include inner copper layers (4-layer boards only)' is enabled and checked…; F2B-006: Unchecking 'Include inner copper layers' on a 4-layer board silently ships an unmanufactu…

**Root cause.** `src/modules/designer/frontend/pcb/PcbExportDialog.tsx:259` — inner copper checkbox not gated on layerCount

**Proposed fix.** Hide 'Include inner copper layers' on 2-layer boards; on 4+ layers always include (remove toggle) so job file never mismatches. — Detail: Render the inner-copper option only when layerCount ≥ 4; slugify the design name for the ZIP/member prefix; join refdes groups with ', ' and drop the trailing period; show a brief 'Exported 14 files' toast/notice.

**Evidence.** [110-export-dialog](../evidence/shots/q4/dark/110-export-dialog.png), [006-keys-behind-export](../evidence/shots/vq4/dark/006-keys-behind-export.png), [036-export-dialog-stress](../evidence/shots/f1b/dark/036-export-dialog-stress.png)

<details><summary>Q4-024 — Export dialog offers a checked 'Include inner copper layers (4-layer boards only)' on a 2-layer board; ZIP named by UUID; sloppy warning copy (S3, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. 'Dual LED Blinker' (Copper layers 2) → PCB → 'Export…'
  2. Read the options and the warning box; tick 'Export anyway (ignore DRC errors)' → 'Export anyway'
- Expected: Inner-copper option hidden/disabled for 2-layer boards; ZIP named after the design ('Dual_LED_Blinker-r508-gerbers.zip'); clean list formatting
- Actual: Checkbox enabled and checked (no effect: ZIP has 14 files, no In*.gbr). File name 'openpcb-c2c58a19-bef5-488a-bfa4-c6b133ea.zip' and every member prefixed with the truncated UUID. Warning text: 'C1, D1, D2, J1, R1,R2, R3, R4, R5,R6, ….' (inconsistent comma spacing, ellipsis + period). Dialog closes silently after the download with no confirmation. Download itself works (Gerber X2 F/B Cu, Mask, Paste, Silkscreen, Edge_Cuts, PTH/NPTH drl, gbrjob, BOM, PnP).
- Screenshots: [110-export-dialog](../evidence/shots/q4/dark/110-export-dialog.png), [111-export-after-download](../evidence/shots/q4/dark/111-export-after-download.png), [006-keys-behind-export](../evidence/shots/vq4/dark/006-keys-behind-export.png), [005-export-dialog](../evidence/shots/vq4/light/005-export-dialog.png)
- Network: `download openpcb-c2c58a19-bef5-488a-bfa4-c6b133ea.zip (14 files, 26 KB)`
- Code: `src/modules/designer/frontend/pcb/PcbExportDialog.tsx:259` — inner copper checkbox not gated on layerCount
- Suggested fix: Render the inner-copper option only when layerCount ≥ 4; slugify the design name for the ZIP/member prefix; join refdes groups with ', ' and drop the trailing period; show a brief 'Exported 14 files' toast/notice.
- Verification (vq4): **confirmed** — Reproduced (dark+light): on the 2-layer Dual LED Blinker, 'Include inner copper layers (4-layer boards only)' is enabled and checked; file line '14 files · openpcb-c2c58a19-bef5-488a-bfa4-c6b133ea.zip'; warning 'C1, D1, D2, J1, R1,R2, R3, R4, R5,R6, ….'. Checkbox not gated on layerCount (PcbExportDialog.tsx:259-266). The silent close after download was not re-tested. · evidence: [006-keys-behind-export](../evidence/shots/vq4/dark/006-keys-behind-export.png), [005-export-dialog](../evidence/shots/vq4/light/005-export-dialog.png)

</details>

<details><summary>F1B-017 — Export dialog 'Include inner copper layers (4-layer boards only)' is enabled and checked by default on 2-layer boards and silently does nothing (S4, duplicate)</summary>

- Area designer.pcb · stack A · design cc5a12b9-bd16-4e8c-9c00-f94598075fd5 · themes dark · viewports 1440x900
- Repro:
  1. Open QA-f1b-stress (Stackup 2 layer) → PCB → Export…
  2. Observe third checkbox
  3. Download ZIP
- Expected: Checkbox hidden or disabled with a note on boards with layerCount 2 (only shown for 4+ layers).
- Actual: Checkbox is enabled and checked on QA-f1b-stress, Dual LED Blinker and QA-f1b-empty (all 2-layer); toggling it changes nothing — both ZIPs have the same 14 files (no In1/In2).
- Screenshots: [036-export-dialog-stress](../evidence/shots/f1b/dark/036-export-dialog-stress.png), [038-export-dialog-dual](../evidence/shots/f1b/dark/038-export-dialog-dual.png), [040-export-empty-design](../evidence/shots/f1b/dark/040-export-empty-design.png)
- Code: `src/modules/designer/frontend/pcb/PcbExportDialog.tsx:258` — includeInner checkbox not gated on board.layerCount
- Suggested fix: Render the checkbox only when board.layerCount > 2 (or disabled with title 'Board has 2 copper layers').
- Verification (vf1b): **duplicate** — Reproduced on the 2-layer QA-vf1b-empty: 'Include inner copper layers (4-layer boards only)' is enabled and checked (PcbExportDialog.tsx:258-265, not gated on layerCount). This is exactly the verified Q4-024 (K30). · evidence: [026-export-empty-design](../evidence/shots/vf1b/dark/026-export-empty-design.png)

</details>

<details><summary>F2B-006 — Unchecking 'Include inner copper layers' on a 4-layer board silently ships an unmanufacturable bundle: In1/In2 dropped while the job file still says 4 layers and B.Cu is 'L4' (S2, confirmed)</summary>

- Area designer.pcb · stack B · design 2a4c5318-4bea-4e32-841b-2750b998e9d4 · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, QA-f2b-4L (4-layer KiCad import with tracks on In1/In2 and a GND plane on In2) → PCB → Export…
  2. Default state: 'Include inner copper layers (4-layer boards only)' enabled + checked → preview '16 files' → Export anyway → ZIP contains In1_Cu.gbr (Copper,L2,Inr) and In2_Cu.gbr (Copper,L3,Inr), gbrjob LayerNumber 4, PTH 'Plated,1,4' — correct
  3. Uncheck the box → preview '14 files', still '1 export warning' (BOM only) → Export anyway → inspect ZIP
- Expected: On a 4-layer board inner copper is not optional (the board cannot be built without it): the checkbox should not exist, or unchecking it must be refused/blocked like the S15 6-layer refusal, or at minimum produce a prominent warning. The bundle must never describe a different board than it contains.
- Actual: The 14-file ZIP has only F_Cu and B_Cu, yet the .gbrjob still declares GeneralSpecs.LayerNumber 4, B_Cu is FileFunction 'Copper,L4,Bot,Signal', and both drill files span 'Plated,1,4' / 'NonPlated,1,4' — a fab would reject it or build a board with no inner copper (the In2 GND plane and 9 inner tracks silently disappear). No warning in the preview, none after download ('Downloaded … — 1 warning(s)', the BOM one). The stale 'Downloaded …zip' success line from the previous download also stays visible after the options change. On 2-layer boards the same checkbox is enabled/checked and does nothing (K30 / Q4-024 / F1B-017).
- Screenshots: [040-4L-export-dialog](../evidence/shots/f2b/dark/040-4L-export-dialog.png), [041-4L-export-inner-unchecked](../evidence/shots/f2b/dark/041-4L-export-inner-unchecked.png), [042-4L-export-noinner-downloaded](../evidence/shots/f2b/dark/042-4L-export-noinner-downloaded.png)
- Network: `POST /designs/2a4c5318…/exports/gerber?format=zip {includeInnerLayers:false} → 200, 14 files`; `gbrjob: LayerNumber 4; B_Cu 'Copper,L4,Bot,Signal'; PTH 'Plated,1,4,PTH,Drill'; no In1_Cu/In2_Cu files`
- Code: `src/modules/designer/backend/export/index.ts:85` — includeInner = options.includeInnerLayers !== false && layerCount === 4 - silently drops inner layers
- Code: `src/modules/designer/backend/export/gerber/job-file.ts:49` — LayerNumber always pcb.board.layerCount
- Code: `src/modules/designer/frontend/pcb/PcbExportDialog.tsx:258` — checkbox shown and checked for every layer count
- Suggested fix: Remove the option (inner layers always emitted when layerCount === 4) or, if a 'copper preview' export is wanted, make it a separate labelled mode that also rewrites LayerNumber/FileFunction; in the backend throw the same 422 refusal as the 6-layer case when includeInnerLayers:false on a 4-layer board. Hide the checkbox on 2-layer boards; clear the 'Downloaded' status when options change.
- Verification (vf2b): **confirmed** — Reproduced in UI and API on QA-f2b-4L: the export dialog shows 'Include inner copper layers (4-layer boards only)' checked; unchecking it changes the preview to '14 files' with only the BOM warning. POST /exports/gerber?format=json with {includeInnerLayers:false} returns 14 files without In1_Cu/In2_Cu while the .gbrjob keeps LayerNumber 4, B_Cu stays 'Copper,L4,Bot,Signal' and PTH/NPTH stay 'Plated,1,4' / 'NonPlated,1,4'; with true it returns the correct 16-file bundle. export/index.ts:85-86 silently honours the flag. Contract 15 section 7.1 refuses 6+ layer boards for exactly this reason ('the job file still claims the full LayerNumber: a different board from the one designed'), so this path contradicts the project's own fail-closed rule. Distinct from K30/Q4-024 (2-layer: the checkbox is a no-op); same control, different failure. fixScope changed to backend-needed because the backend must refuse the option. · evidence: [006-4L-export-inner-unchecked](../evidence/shots/vf2b/dark/006-4L-export-inner-unchecked.png), vf2b/exp/4L-inner-false.json, vf2b/exp/4L-inner-true.json

</details>


## T-153

**Layer visibility / active-layer / view clicks are recorded as undoable document edits (revision bump, DRC stale) and their undo is a silent no-op**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **decide** · decision DEC-PCB1 · owner D3 · wave W2 · scope decision · estimate M
- Findings: Q4-025

**Summary.** Each view click is a design command (pcb_set_visible_layers / pcb_set_active_layer / pcb_set_view_state), bumps the revision (Dual LED Blinker went r449→r510 in one session, mostly from view clicks; a single preset click = 4 revisions), marks DRC stale and pushes an undo entry. Cmd+Z then 'undoes' them with no visible change (F.SilkS stays hidden, active layer stays B.Cu) — two presses consumed, redoDepth 2. With th…

**Root cause.** `src/modules/designer/frontend/pcb/PcbCanvas.tsx:6580` — comment claims view state is 'durable but non-undoable'

**Proposed fix.** Treat layer visibility/active layer/view as view state (per-design localStorage), not undoable document commands. — Detail: Persist view state outside the command log (per-user view-state endpoint or local store), or mark these command types non-undoable and non-revisioning in the command executor.

**Evidence.** [115-new-pcb](../evidence/shots/q4/dark/115-new-pcb.png), [006-keys-behind-export](../evidence/shots/vq4/dark/006-keys-behind-export.png)

<details><summary>Q4-025 — Layer visibility / active-layer / view clicks are recorded as undoable document edits (revision bump, DRC stale) and their undo is a silent no-op (S2, confirmed)</summary>

- Area designer.pcb · stack A · design 5909d519 · themes dark · viewports 1440x900
- Repro:
  1. New design 'QA-q4-board' → PCB (rev 0, undoDepth 0, Undo disabled)
  2. Click the eye on 'Top Overlay' → rev 1, undoDepth 1, Undo enabled
  3. Click layer tab 'Bottom Copper' → rev 2, undoDepth 2
  4. Press Cmd+Z twice
- Expected: View state (visibility, active layer, view side, opacity, preset, display mode) is not part of the design undo history and doesn't bump the design revision
- Actual: Each view click is a design command (pcb_set_visible_layers / pcb_set_active_layer / pcb_set_view_state), bumps the revision (Dual LED Blinker went r449→r510 in one session, mostly from view clicks; a single preset click = 4 revisions), marks DRC stale and pushes an undo entry. Cmd+Z then 'undoes' them with no visible change (F.SilkS stays hidden, active layer stays B.Cu) — two presses consumed, redoDepth 2. With the 200-entry cap, layer toggling pushes real edits out of the undo history.
- Screenshots: [115-new-pcb](../evidence/shots/q4/dark/115-new-pcb.png), [116-undo-view-state](../evidence/shots/q4/dark/116-undo-view-state.png), [006-keys-behind-export](../evidence/shots/vq4/dark/006-keys-behind-export.png)
- Network: `GET /designs/5909d519/history → after eye+tab clicks {canUndo:true, undoDepth:2}; after 2× Cmd+Z {undoDepth:0, redoDepth:2}, projection visibleLayers/activeLayer unchanged`; `c2c58a19 rev 524 activeLayer B.Cu → Cmd+Z → rev 525 activeLayer B.Cu (no-op undo) → Cmd+Z → rev 526 freeHoles 0→1`; `layer tab click 'Top Copper' → rev 526→527`
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:6580` — comment claims view state is 'durable but non-undoable'
- Code: `src/modules/designer/frontend/pcb/usePcbWorkspace.ts:368` — setActiveLayer dispatches a design command
- Suggested fix: Persist view state outside the command log (per-user view-state endpoint or local store), or mark these command types non-undoable and non-revisioning in the command executor.
- Verification (vq4): **confirmed** — Reproduced on c2c58a19: pressing B behind a dialog dispatched pcb_set_active_layer (rev 523->524); the next Cmd+Z bumped rev 524->525 with activeLayer still B.Cu (undo is a no-op), and only the second Cmd+Z restored the deleted hole. Clicking the 'Top Copper' layer tab bumped rev 526->527. Every view click also marks DRC stale (drcStatus is compared by revision). The PcbCanvas.tsx:6580 comment says view state is meant to be 'durable but non-undoable'. · evidence: [006-keys-behind-export](../evidence/shots/vq4/dark/006-keys-behind-export.png)

</details>


## T-154

**Board panel shows un-applied typed size as the board's real size after 'Done' (e.g. 'Circle 80 × 60' for a 60 mm circle)**

- Severity **S2** · category data · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate XS
- Findings: Q4-026

**Summary.** Read-only view shows 'Shape Circle · Width 80 · Height 60' while the canvas and backend still hold a 60×60 circle; same with the earlier rect case (shot 118: panel 'Rectangle 60 × 30', board 50 × 30). The stale buffer stays until the outline next changes, so the user believes the board is resized.

**Root cause.** `src/modules/designer/frontend/pcb/PcbBoardPanel.tsx:418` — read-only Width/Height render widthText/heightText (edit buffers)

**Proposed fix.** Board panel shows applied size only; typed values stay in draft until Apply. — Detail: Render the read-only rows from currentOutline.widthMm/heightMm (roundDimMm), and on Done (onToggleEditMode false) re-seed widthText/heightText from the persisted outline; optionally prompt 'Apply changes?' when buffers differ.

**Evidence.** [118-done-without-apply](../evidence/shots/q4/dark/118-done-without-apply.png), [043-done-unapplied](../evidence/shots/vq4/dark/043-done-unapplied.png)

<details><summary>Q4-026 — Board panel shows un-applied typed size as the board's real size after 'Done' (e.g. 'Circle 80 × 60' for a 60 mm circle) (S2, confirmed)</summary>

- Area designer.pcb · stack A · design 5909d519 · themes dark · viewports 1440x900
- Repro:
  1. New design QA-q4-board → PCB, nothing selected → Properties → Board → Edit
  2. Board is a 60 mm circle (projection outline kind=circle 60×60)
  3. Click 'Rect', type Width 80, do NOT click Apply, click 'Done'
  4. Read the read-only OUTLINE section
- Expected: Read-only view reflects the persisted outline (Circle, Ø60) and un-applied edits are discarded (or Done applies them / asks)
- Actual: Read-only view shows 'Shape Circle · Width 80 · Height 60' while the canvas and backend still hold a 60×60 circle; same with the earlier rect case (shot 118: panel 'Rectangle 60 × 30', board 50 × 30). The stale buffer stays until the outline next changes, so the user believes the board is resized.
- Screenshots: [118-done-without-apply](../evidence/shots/q4/dark/118-done-without-apply.png), [121-done-unapplied-rect80](../evidence/shots/q4/dark/121-done-unapplied-rect80.png), [043-done-unapplied](../evidence/shots/vq4/dark/043-done-unapplied.png)
- Network: `GET /projection/pcb → board.outline {kind:circle,widthMm:60,heightMm:60} (rev 7, unchanged)`
- Code: `src/modules/designer/frontend/pcb/PcbBoardPanel.tsx:418` — read-only Width/Height render widthText/heightText (edit buffers)
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:1170` — buffers only re-seeded when projection outline changes
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:5594` — onToggleEditMode does not reset buffers
- Suggested fix: Render the read-only rows from currentOutline.widthMm/heightMm (roundDimMm), and on Done (onToggleEditMode false) re-seed widthText/heightText from the persisted outline; optionally prompt 'Apply changes?' when buffers differ.
- Verification (vq4): **confirmed** — Reproduced on DRC Demo (rect 50×30): Edit -> Width 80 (no Apply) -> Done: the read-only panel shows 'Rectangle · Width 80 · Height 30' while the projection outline is still rect 50×30 (rev 15). Read-only rows render widthText/heightText edit buffers (PcbBoardPanel.tsx:418-423). The buffer was reset afterwards (no mutation). · evidence: [043-done-unapplied](../evidence/shots/vq4/dark/043-done-unapplied.png)

</details>


## T-155

**'Fit to parts' ignores free pads/holes (cuts them off the board) and on an empty board silently resizes to a hard-coded 80 × 56 mm**

- Severity **S2** · category data · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: Q4-028

**Summary.** Board silently becomes 80 × 56 (rev 8 → 9): fallbackBoardBoundsFromProjection returns a fixed {-40,-28,40,28} box when there are no placements/traces/vias. The same helper ignores free holes, free pads, zones, keepouts and overlay text, so fitting a board that has them cuts them off. On DRC Demo the board shrank to 40.6 × 14 (rev 11→12) and the panel immediately warned '2 items outside outline' — the free pad at (-1…

**Root cause.** `src/modules/designer/frontend/pcb/usePcbWorkspace.ts:229` — fitBoardToParts uses 3D fallback bounds helper

**Proposed fix.** Fit to parts includes free pads/holes/text; empty board shows notice instead of silent 80×56 resize. — Detail: In PcbBoardPanel disable 'Fit to parts' when placements+traces+vias+freeHoles+freePads+zones+texts are all empty (title 'Nothing on the board to fit'); give fitBoardToParts its own bounds helper that includes every board item and returns null when empty.

**Evidence.** [124-fit-to-parts-empty](../evidence/shots/q4/dark/124-fit-to-parts-empty.png), [030-drc-demo-pcb](../evidence/shots/vq4/dark/030-drc-demo-pcb.png)

<details><summary>Q4-028 — 'Fit to parts' ignores free pads/holes (cuts them off the board) and on an empty board silently resizes to a hard-coded 80 × 56 mm (S2, confirmed)</summary>

- Area designer.pcb · stack A · design 5909d519, 3196d811 · themes dark · viewports 1440x900
- Repro:
  1. QA-q4-board (0 components) → PCB → Board panel → Edit
  2. Board is a rounded rect 80 × 60
  3. Click 'Fit to parts'
  4. DRC Demo (3196d811, 50×30 board with 2 free pads, 3 free holes, 5 traces, 1 via) → PCB → Board panel → 'Fit to parts'
- Expected: Button disabled (or a notice 'No parts to fit') when there is nothing on the board; free holes/pads/zones/text also counted when present
- Actual: Board silently becomes 80 × 56 (rev 8 → 9): fallbackBoardBoundsFromProjection returns a fixed {-40,-28,40,28} box when there are no placements/traces/vias. The same helper ignores free holes, free pads, zones, keepouts and overlay text, so fitting a board that has them cuts them off. On DRC Demo the board shrank to 40.6 × 14 (rev 11→12) and the panel immediately warned '2 items outside outline' — the free pad at (-15, 8) and the hole at (16, 8) were left outside the new board. Undone with Cmd+Z.
- Screenshots: [124-fit-to-parts-empty](../evidence/shots/q4/dark/124-fit-to-parts-empty.png), [188-drc-demo-fit-to-parts](../evidence/shots/q4/dark/188-drc-demo-fit-to-parts.png), [030-drc-demo-pcb](../evidence/shots/vq4/dark/030-drc-demo-pcb.png), [031-drc-demo-fit-to-parts](../evidence/shots/vq4/dark/031-drc-demo-fit-to-parts.png)
- Network: `projection outline before {roundrect 80×60 r30} → after {roundrect 80×56 r30}`
- Code: `src/modules/designer/frontend/pcb/usePcbWorkspace.ts:229` — fitBoardToParts uses 3D fallback bounds helper
- Code: `src/modules/designer/frontend/three-d/primitives/geometry-utils.ts:427` — hard-coded 80×56 fallback; only placements/traces/vias considered
- Suggested fix: In PcbBoardPanel disable 'Fit to parts' when placements+traces+vias+freeHoles+freePads+zones+texts are all empty (title 'Nothing on the board to fit'); give fitBoardToParts its own bounds helper that includes every board item and returns null when empty.
- Verification (vq4): **confirmed** — Reproduced on DRC Demo: 'Fit to parts' shrank the board 50×30 -> 40.6×14 (rev 14); Board panel warned '2 items outside outline' (free hole and pad at the top left and top right left outside). Cmd+Z restored 50×30. fitBoardToParts (usePcbWorkspace.ts:229) uses fallbackBoardBoundsFromProjection (geometry-utils.ts:415-437), which reads only placements/traces/vias and returns a hard-coded ±40×±28 box when empty (code-verified for the empty-board case). · evidence: [030-drc-demo-pcb](../evidence/shots/vq4/dark/030-drc-demo-pcb.png), [031-drc-demo-fit-to-parts](../evidence/shots/vq4/dark/031-drc-demo-fit-to-parts.png)

</details>


## T-156

**PCB Text tool uses window.prompt and drops text onto a hidden silkscreen layer**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: Q4-030, Q4-031 · known ref K02
- Depends on: ['T-014']

**Summary.** Browser-native prompt 'Overlay text:' blocks the page (the click's mouseup hangs until the dialog is handled); dialog spy: {prompt:1, log:['prompt: Overlay text:']}. In Electron window.prompt is unsupported, so the Text tool cannot place anything there. Any add failure is swallowed (.catch(() => undefined)). | Also covers: Q4-031: Text tool drops text onto a hidden silkscreen layer with no feedback — placed text is inv…

**Root cause.** `src/modules/designer/frontend/pcb/PcbCanvas.tsx:2996` — window.prompt("Overlay text:", "")

**Proposed fix.** Text tool: inline text popover (no window.prompt); auto-enable silkscreen layer or warn when target layer hidden. — Detail: Place the text immediately with a placeholder ('TEXT') and focus the Properties 'Text' input (already exists in the text inspector), or open a small kit popover at the click point with an input + Enter/Esc; surface add failures via the workspace error strip.

**Evidence.** [157-text-tool](../evidence/shots/q4/dark/157-text-tool.png), [033-qa-board](../evidence/shots/vq4/dark/033-qa-board.png), [158-text-placed](../evidence/shots/q4/dark/158-text-placed.png)

<details><summary>Q4-030 — PCB Text tool asks for the label with a native window.prompt('Overlay text:') (S2, confirmed)</summary>

- Area designer.pcb · stack A · design 5909d519 · themes dark · viewports 1440x900
- Repro:
  1. QA-q4-board → PCB → press T (or Add ▾ → Text)
  2. Click on the board
- Expected: Inline in-canvas text editor or kit dialog (Electron blocks/does not support window.prompt; sandboxed renderer returns null)
- Actual: Browser-native prompt 'Overlay text:' blocks the page (the click's mouseup hangs until the dialog is handled); dialog spy: {prompt:1, log:['prompt: Overlay text:']}. In Electron window.prompt is unsupported, so the Text tool cannot place anything there. Any add failure is swallowed (.catch(() => undefined)).
- Screenshots: [157-text-tool](../evidence/shots/q4/dark/157-text-tool.png), [158-text-placed](../evidence/shots/q4/dark/158-text-placed.png), [033-qa-board](../evidence/shots/vq4/dark/033-qa-board.png)
- Console: `__qaDialogCalls = {"prompt":1,"log":["prompt: Overlay text:"]}`; `__qaDialogCalls.log includes 'prompt: Overlay text:'`
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:2996` — window.prompt("Overlay text:", "")
- Suggested fix: Place the text immediately with a placeholder ('TEXT') and focus the Properties 'Text' input (already exists in the text inspector), or open a small kit popover at the click point with an input + Enter/Esc; surface add failures via the workspace error strip.
- Verification (vq4): **confirmed** — Reproduced: T then a board click opens native prompt 'Overlay text:' on pointerdown; the playwright mousedown blocked until the dialog was dismissed; spy log 'prompt: Overlay text:'. PcbCanvas.tsx:2996. Electron has no window.prompt and there is no shim, so the Text tool cannot place text in the desktop app. · evidence: [033-qa-board](../evidence/shots/vq4/dark/033-qa-board.png)

</details>

<details><summary>Q4-031 — Text tool drops text onto a hidden silkscreen layer with no feedback — placed text is invisible (S3, confirmed)</summary>

- Area designer.pcb · stack A · design 5909d519 · themes dark · viewports 1440x900
- Repro:
  1. QA-q4-board → PCB with 'Top Overlay F.SilkS' hidden (eye off; default preset hides overlay here)
  2. Press T, click the board, enter 'QA text' in the prompt
  3. Look at the canvas; then turn on the Top Overlay eye
- Expected: Tool places on a visible layer, or auto-reveals the target layer, or shows a notice 'Placed on hidden layer F.SilkS'
- Actual: Projection gains overlayText {layer:'F.SilkS', text:'QA text'} (rev 30) but nothing appears on the canvas and no notice/selection is shown; only after toggling the layer eye does the text appear. Layer is always F.SilkS/B.SilkS by view side, independent of the active layer (B.Cu here) or visibility.
- Screenshots: [158-text-placed](../evidence/shots/q4/dark/158-text-placed.png), [159-text-visible](../evidence/shots/q4/dark/159-text-visible.png), [033-qa-board](../evidence/shots/vq4/dark/033-qa-board.png)
- Network: `GET /projection/pcb → overlayTexts[0].layer 'F.SilkS'; board.visibleLayers lacks F.SilkS`
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:2998` — textLayer = mirrorActive ? B.SilkS : F.SilkS, visibility not checked
- Suggested fix: After addOverlayText, if the target layer is not in visibleLayers, add it (setVisibleLayers) or show a pcb-tool-notice 'Text placed on hidden layer Top Overlay — Show'; also select the new text so the inspector opens.
- Verification (vq4): **confirmed** — Confirmed from state and code: QA-q4-board has overlayTexts[0] {layer:'F.SilkS', text:'QA text rho'} while board.visibleLayers lacks F.SilkS, and the canvas shows no text. PcbCanvas.tsx:2997-3001 picks F.SilkS/B.SilkS by view side only, with no visibility check and no selection or notice. · evidence: [033-qa-board](../evidence/shots/vq4/dark/033-qa-board.png)

</details>


## T-157

**Pad/text Rotation field silently rejects 0° and negative angles (can't rotate back to 0); 360 stored un-normalised**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate XS
- Findings: Q4-033

**Summary.** 0 is discarded without any message; the field snaps back to 45 and no command is sent. -90 is also rejected. 360 is accepted and persisted as rotationDeg 360. The same NumericField guard (n > 0) applies to every inspector number, so any legitimately-zero value (rotation, and position once X/Y become editable) is impossible.

**Root cause.** `src/modules/designer/frontend/pcb/PcbSelectionInspector.tsx:71` — commit(): requires n > 0

**Proposed fix.** Rotation accepts 0 and negatives, normalises to [0,360). — Detail: Make the positivity check opt-in (e.g. prop positive?: boolean used only for sizes/drill); for rotation normalise ((v % 360) + 360) % 360; show an inline invalid state instead of silently reverting.

**Evidence.** [162-pad-rot-zero-rejected](../evidence/shots/q4/dark/162-pad-rot-zero-rejected.png), [036-rot-zero-rejected](../evidence/shots/vq4/dark/036-rot-zero-rejected.png)

<details><summary>Q4-033 — Pad/text Rotation field silently rejects 0° and negative angles (can't rotate back to 0); 360 stored un-normalised (S2, confirmed)</summary>

- Area designer.pcb · stack A · design 5909d519 · themes dark · viewports 1440x900
- Repro:
  1. QA-q4-board → PCB → select the free pad (or an overlay text)
  2. Properties → Rotation: type 45, Enter → rotationDeg 45 (rev 33)
  3. Type 0, Enter
  4. Type 360, Enter
- Expected: 0 (and negative angles, normalised to 0–359) accepted
- Actual: 0 is discarded without any message; the field snaps back to 45 and no command is sent. -90 is also rejected. 360 is accepted and persisted as rotationDeg 360. The same NumericField guard (n > 0) applies to every inspector number, so any legitimately-zero value (rotation, and position once X/Y become editable) is impossible.
- Screenshots: [162-pad-rot-zero-rejected](../evidence/shots/q4/dark/162-pad-rot-zero-rejected.png), [036-rot-zero-rejected](../evidence/shots/vq4/dark/036-rot-zero-rejected.png)
- Network: `after '0'+Enter: projection freePads[0].rotationDeg still 45 (rev 33)`; `after '360': rotationDeg 360 (rev 34)`
- Code: `src/modules/designer/frontend/pcb/PcbSelectionInspector.tsx:71` — commit(): requires n > 0
- Code: `src/modules/designer/frontend/pcb/PcbSelectionInspector.tsx:236` — pad Rotation uses NumericField
- Code: `src/modules/designer/frontend/pcb/PcbSelectionInspector.tsx:344` — text Rotation uses NumericField
- Suggested fix: Make the positivity check opt-in (e.g. prop positive?: boolean used only for sizes/drill); for rotation normalise ((v % 360) + 360) % 360; show an inline invalid state instead of silently reverting.
- Verification (vq4): **confirmed** — Reproduced: free pad Rotation (stored 360 from an earlier session) -> typed 0 + Enter -> no command sent (rev stays 41) and the field snaps back to 360. The commit guard `n > 0` (PcbSelectionInspector.tsx:69-74) applies to every NumericField. Kept S2: the most common rotation (0) is silently refused; the non-obvious workaround is typing 360. · evidence: [036-rot-zero-rejected](../evidence/shots/vq4/dark/036-rot-zero-rejected.png)

</details>


## T-158

**Layer solo state leaks across design tabs; exiting it writes the other design's layer visibility into the current design**

- Severity **S2** · category data · status confirmed · themes light
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate XS
- Findings: Q4-049

**Summary.** Dual LED Blinker shows a SOLO badge it never had. Exiting it replaced Dual LED Blinker's visibleLayers [B.Cu, Drill, Edge.Cuts, F.Cu, In1.Cu, In2.Cu, Metadata] with QA-q4-board's pre-solo snapshot [B.Cu, Drill, Edge.Cuts, F.Cu, F.SilkS, Metadata] and persisted it (rev 518 → 520). The global zustand store keeps soloLayer/preSoloVisible/preSoloActive/selectionFilter when hydrateFromProjection switches designId.

**Root cause.** `src/modules/designer/frontend/pcb/pcb-view-store.ts:219` — hydrateFromProjection sets designId/viewState/layers but never resets soloLayer/preSoloVisible/preSoloActive

**Proposed fix.** Layer solo state keyed by design id; exiting restores that design's visibility only. — Detail: In pcb-view-store hydrateFromProjection (pcb-view-store.ts:219), when `designId !== get().designId` reset soloLayer/preSoloVisible/preSoloActive (and selectionFilterPanelOpen) and flush or drop pendingPatch for the previous design before switching.

**Evidence.** [022-alt-solo-toast](../evidence/shots/q4/light/022-alt-solo-toast.png), [001-alt-solo-qa](../evidence/shots/vq4/light/001-alt-solo-qa.png)

<details><summary>Q4-049 — Layer solo state leaks across design tabs; exiting it writes the other design's layer visibility into the current design (S2, confirmed)</summary>

- Area designer.pcb · stack A · design 5909d519, c2c58a19 · themes light · viewports 1440x900
- Repro:
  1. Open two designs as tabs: QA-q4-board and Dual LED Blinker
  2. On QA-q4-board PCB, Alt+click 'Bottom Copper' in Layers (row shows SOLO; see also Q4-011 conflict)
  3. Switch to the Dual LED Blinker tab → PCB: its Bottom Copper row also shows 'SOLO'
  4. Alt+click that row to exit solo; read GET /projection/pcb board.visibleLayers for both designs
- Expected: Solo / selection-filter UI state is per design (reset on design switch); exiting solo only restores that design's own snapshot
- Actual: Dual LED Blinker shows a SOLO badge it never had. Exiting it replaced Dual LED Blinker's visibleLayers [B.Cu, Drill, Edge.Cuts, F.Cu, In1.Cu, In2.Cu, Metadata] with QA-q4-board's pre-solo snapshot [B.Cu, Drill, Edge.Cuts, F.Cu, F.SilkS, Metadata] and persisted it (rev 518 → 520). The global zustand store keeps soloLayer/preSoloVisible/preSoloActive/selectionFilter when hydrateFromProjection switches designId.
- Screenshots: [022-alt-solo-toast](../evidence/shots/q4/light/022-alt-solo-toast.png), [023-routing](../evidence/shots/q4/light/023-routing.png), [024-solo-leaked](../evidence/shots/q4/light/024-solo-leaked.png), [025-solo-exit-other-design](../evidence/shots/q4/light/025-solo-exit-other-design.png), [001-alt-solo-qa](../evidence/shots/vq4/light/001-alt-solo-qa.png), [002-solo-leaked](../evidence/shots/vq4/light/002-solo-leaked.png), [003-solo-exit-other-design](../evidence/shots/vq4/light/003-solo-exit-other-design.png)
- Network: `c2c58a19 projection rev 518 visibleLayers [B.Cu,Drill,Edge.Cuts,F.Cu,In1.Cu,In2.Cu,Metadata] → rev 520 [B.Cu,Drill,Edge.Cuts,F.Cu,F.SilkS,Metadata]`; `c2c58a19 rev 538 visibleLayers [F.Cu,B.Cu,Edge.Cuts,Drill,Metadata,F.SilkS] → rev 539 [B.Cu,Edge.Cuts,Drill,Metadata,F.Cu] after un-solo of leaked state`
- Code: `src/modules/designer/frontend/pcb/pcb-view-store.ts:219` — hydrateFromProjection sets designId/viewState/layers but never resets soloLayer/preSoloVisible/preSoloActive
- Code: `src/modules/designer/frontend/pcb/pcb-view-store.ts:345` — toggleSoloLayer restores preSoloVisible regardless of which design captured it
- Suggested fix: In pcb-view-store hydrateFromProjection (pcb-view-store.ts:219), when `designId !== get().designId` reset soloLayer/preSoloVisible/preSoloActive (and selectionFilterPanelOpen) and flush or drop pendingPatch for the previous design before switching.
- Verification (vq4): **confirmed** — Reproduced in light: Alt+click Bottom Copper on QA-q4-board (SOLO, plus the Q4-011 conflict toast), then opened Dual LED Blinker: its Bottom Copper row shows 'SOLO' while all layers are visible. Alt+click to exit wrote QA-q4-board's pre-solo set into Dual LED Blinker: visibleLayers [F.Cu,B.Cu,Edge.Cuts,Drill,Metadata,F.SilkS] -> [B.Cu,Edge.Cuts,Drill,Metadata,F.Cu] (rev 538->539, F.SilkS lost). Restored by re-enabling Top Overlay (rev 540). pcb-view-store.ts:219-236 hydrateFromProjection never resets soloLayer/preSoloVisible/preSoloActive. · evidence: [001-alt-solo-qa](../evidence/shots/vq4/light/001-alt-solo-qa.png), [002-solo-leaked](../evidence/shots/vq4/light/002-solo-leaked.png), [003-solo-exit-other-design](../evidence/shots/vq4/light/003-solo-exit-other-design.png)

</details>


## T-159

**Export and DXF import failures surface raw transport/parser text ('Failed to fetch' ×2, 'Ended on code undefined') that lingers after recovery**

- Severity **S3** · category copy · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: F1A-011 · known ref K40

**Summary.** Export 500: 'Internal error'. Offline: two stacked identical boxes 'Failed to fetch' / 'Failed to fetch' (summary + download). After reconnecting, the summary recovers but the stale download 'Failed to fetch' stays until the next click. The double-click Download guard works (1 request). DXF: the input has accept='.dxf', but any file picked via 'All files' is sent. The modal shows the backend detail verbatim, 'could…

**Root cause.** `src/modules/designer/frontend/pcb/PcbExportDialog.tsx:139` — handleDownload stores err.message verbatim; download status is not reset when options change or the summary refetch succeeds

**Proposed fix.** Export/DXF errors mapped to user copy, cleared on retry/success. — Detail: PcbExportDialog.tsx: map TypeError('Failed to fetch') to 'Can't reach the OpenPCB backend' and 5xx to 'Export failed (server error)'; reset download status to idle when any option changes or the summary succeeds, and render one error box. parse-dxf.ts:75: throw 'This file isn't a valid DXF' (keep the parser detail for logs only). Show the chosen file name in the DXF drop zone and disable 'Import outline' until a file parses.

**Evidence.** [069-export-zip-500](../evidence/shots/f1a/dark/069-export-zip-500.png), [120-export-zip-500](../evidence/shots/vf1a/dark/120-export-zip-500.png)

<details><summary>F1A-011 — Export and DXF import failures surface raw transport/parser text ('Failed to fetch' ×2, 'Ended on code undefined') that lingers after recovery (S3, confirmed)</summary>

- Area designer.pcb · stack A · design 91573bb6-cb22-4ca4-a8d9-58057a1ff45b · themes dark · viewports 1440x900
- Repro:
  1. PCB → Export…, tick 'Export anyway', route '**/exports/gerber*' → 500, click Export anyway
  2. unroute; network-state-set offline; click Export anyway, then toggle 'Include BOM CSV'
  3. network-state-set online; toggle the checkbox again
  4. Board panel → Edit → '⭳ Import DXF…' → Choose a .dxf file → upload fixtures/sample.txt, then fixtures/garbage.step
- Expected: Human messages ('Couldn't build the ZIP — server error', 'Not a DXF file'), a single error at a time, cleared when the next attempt succeeds, and the chosen file name shown.
- Actual: Export 500: 'Internal error'. Offline: two stacked identical boxes 'Failed to fetch' / 'Failed to fetch' (summary + download). After reconnecting, the summary recovers but the stale download 'Failed to fetch' stays until the next click. The double-click Download guard works (1 request). DXF: the input has accept='.dxf', but any file picked via 'All files' is sent. The modal shows the backend detail verbatim, 'could not parse DXF: Unexpected end of input: EOF group not read before end of file. Ended on code undefined' (and 'Ended on code ' for garbage.step), lowercase and developer-facing. The chosen file name is never shown.
- Screenshots: [069-export-zip-500](../evidence/shots/f1a/dark/069-export-zip-500.png), [070-export-offline](../evidence/shots/f1a/dark/070-export-offline.png), [071-export-offline-summary](../evidence/shots/f1a/dark/071-export-offline-summary.png), [121-dxf-sample-txt](../evidence/shots/f1a/dark/121-dxf-sample-txt.png), [122-dxf-garbage-step](../evidence/shots/f1a/dark/122-dxf-garbage-step.png)
- Network: `POST /exports/gerber?format=zip → 500`; `POST /exports/gerber?format=summary → net::ERR_INTERNET_DISCONNECTED`; `POST /imports/dxf/inspect → 400 {detail:'could not parse DXF: Unexpected end of input: EOF group not read before end of file. Ended on code undefined'}`
- Code: `src/modules/designer/frontend/pcb/PcbExportDialog.tsx:139` — handleDownload stores err.message verbatim; download status is not reset when options change or the summary refetch succeeds
- Code: `src/modules/designer/frontend/pcb/PcbExportDialog.tsx:275` — summary error rendered separately with the same text
- Code: `src/modules/designer/backend/import/dxf/parse-dxf.ts:75` — `could not parse DXF: ${err.message}` passes the dxf-parser exception text to the user
- Suggested fix: PcbExportDialog.tsx: map TypeError('Failed to fetch') to 'Can't reach the OpenPCB backend' and 5xx to 'Export failed (server error)'; reset download status to idle when any option changes or the summary succeeds, and render one error box. parse-dxf.ts:75: throw 'This file isn't a valid DXF' (keep the parser detail for logs only). Show the chosen file name in the DXF drop zone and disable 'Import outline' until a file parses.
- Verification (vf1a): **confirmed** — Reproduced. Export dialog with 'Export anyway' checked: ZIP request routed to 500 -> 'Internal error'; offline -> two 'Failed to fetch' boxes; back online and toggling 'Include BOM CSV' -> the summary recovers but one stale 'Failed to fetch' remains. DXF: 'Import DXF…' > 'Choose a .dxf file' > upload sample.txt -> modal shows 'could not parse DXF: Unexpected end of input: EOF group not read before end of file. Ended on code undefined'; the drop zone still says 'Choose a .dxf file' (no file name). Correction: the DXF text is produced in the backend parser (parse-dxf.ts:75), not routes.ts:3841. Offline is only a stand-in for an unreachable backend on desktop; the DXF wrong-file path is a real user-error path. S3 kept (K40). · evidence: [120-export-zip-500](../evidence/shots/vf1a/dark/120-export-zip-500.png), [121-export-offline](../evidence/shots/vf1a/dark/121-export-offline.png), [122-export-online-stale](../evidence/shots/vf1a/dark/122-export-online-stale.png), [130-dxf-sample-txt](../evidence/shots/vf1a/dark/130-dxf-sample-txt.png)

</details>


## T-160

**If the PCB projection fails to load, PCB shows only grey 'PCB projection unavailable' with no reason or retry, and the workspace error is never rendered**

- Severity **S3** · category error-handling · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate XS
- Findings: F1A-012 · known ref K09

**Summary.** Unlike K09 it doesn't spin forever: it switches to plain 13 px grey text 'PCB projection unavailable' in the middle of the canvas. There is no reason, no Retry, and no role=alert. The Layers section is empty, 'Components 0' is shown, the PCB toolbar is gone, and the Properties dock is blank. usePcbWorkspace stores the failure message in workspace.error, but the alert toast only renders inside the projection branch,…

**Root cause.** `src/modules/designer/frontend/pcb/PcbCanvas.tsx:6189` — !workspace.projection -> 'Loading PCB...' / 'PCB projection unavailable' text only

**Proposed fix.** PCB projection failure state shows reason + Retry. — Detail: Render a kit error state when !projection && error: 'Couldn't load the PCB — <reason>', a Retry button calling workspace.refresh(), role=alert. Retry automatically on window focus and 'online' events.

**Evidence.** [041-k41-pcb-view-proj500](../evidence/shots/f1a/dark/041-k41-pcb-view-proj500.png), [140-pcb-proj500](../evidence/shots/vf1a/dark/140-pcb-proj500.png)

<details><summary>F1A-012 — If the PCB projection fails to load, PCB shows only grey 'PCB projection unavailable' with no reason or retry, and the workspace error is never rendered (S3, confirmed)</summary>

- Area designer.pcb · stack A · design 91573bb6-cb22-4ca4-a8d9-58057a1ff45b · themes dark · viewports 1440x900
- Repro:
  1. route '**/api/modules/designer/designs/*/projection/pcb*' → 500
  2. Open QA-f1a-board → PCB (or click a violation in the DRC view)
  3. unroute and wait 10 s without leaving the view
- Expected: An error state with the reason and a Retry button, recovering automatically or on Retry.
- Actual: Unlike K09 it doesn't spin forever: it switches to plain 13 px grey text 'PCB projection unavailable' in the middle of the canvas. There is no reason, no Retry, and no role=alert. The Layers section is empty, 'Components 0' is shown, the PCB toolbar is gone, and the Properties dock is blank. usePcbWorkspace stores the failure message in workspace.error, but the alert toast only renders inside the projection branch, so it never appears. After unroute nothing retries until the user leaves PCB and comes back (Schem → PCB recovers).
- Screenshots: [041-k41-pcb-view-proj500](../evidence/shots/f1a/dark/041-k41-pcb-view-proj500.png), [123-pcb-proj500-after-unroute-viewswitch](../evidence/shots/f1a/dark/123-pcb-proj500-after-unroute-viewswitch.png)
- Network: `GET /projection/pcb → 500`
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:6189` — !workspace.projection -> 'Loading PCB...' / 'PCB projection unavailable' text only
- Code: `src/modules/designer/frontend/pcb/usePcbWorkspace.ts:136` — refresh() sets error, but the role=alert surface is gated on projection
- Suggested fix: Render a kit error state when !projection && error: 'Couldn't load the PCB — <reason>', a Retry button calling workspace.refresh(), role=alert. Retry automatically on window focus and 'online' events.
- Verification (vf1a): **confirmed** — Reproduced: route **/projection/pcb* -> 500, Schem -> PCB: the canvas shows only 13 px grey 'PCB projection unavailable' on #08090a, no reason, no Retry, no role=alert; Layers empty, Components 0, toolbar gone, Properties dock blank. After unroute and 10 s the text was still there; Schem -> PCB recovered. Code: PcbCanvas.tsx:6189-6191 renders only text when !workspace.projection; usePcbWorkspace.ts:136 stores the message but the alert toast is inside the projection branch. PCB analogue of K09/Q3-025 (not a duplicate: different view and code path). S3 kept. · evidence: [140-pcb-proj500](../evidence/shots/vf1a/dark/140-pcb-proj500.png), DOM: 0 Retry buttons, 0 role=alert; 'PCB projection unavailable' still present 10 s after unroute; gone after Schem -> PCB

</details>


## T-161

**Design rules accept and persist impossible net-class values (width 0, width 999 mm, clearance −1) with no validation — the route tool then draws a 0 mm or 999 mm trace**

- Severity **S3** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: F1B-006

**Summary.** No inline error, Save enabled, dialog closes. Projection afterwards: default traceWidthMm 0, power traceWidthMm 999 / clearanceMm −1. Routing a Default net shows 'W 0.000 mm' and draws a zero-width trace; routing Net_43 shows 'W 999.000 mm · Class Power', the preview floods the entire canvas red and reports 440 conflicts. DRC after save reports nothing about the rules (same 64 errors / 720 warnings). Clearing a fiel…

**Root cause.** `src/modules/designer/frontend/components/PcbDesignRulesDialog.tsx:136` — onChange Number.parseFloat(v) || 0; min={0} only affects the spinner

**Proposed fix.** Validate net-class inputs (min/max, >0) with inline errors; block Save. — Detail: In PcbDesignRulesDialog validate each class (width ≥ minimums.traceWidthMm and ≤ e.g. 10 mm, clearance ≥ clearance floor), show the error under the field and disable Save; keep the raw string in state instead of coercing '' to 0. In pcb-store parseNetClass reject non-positive/non-finite widths and clearances (ValidationError) rather than persisting them.

**Evidence.** [043-netclass-invalid](../evidence/shots/f1b/dark/043-netclass-invalid.png), [007-netclass-invalid-values](../evidence/shots/vf1b/dark/007-netclass-invalid-values.png)

<details><summary>F1B-006 — Design rules accept and persist impossible net-class values (width 0, width 999 mm, clearance −1) with no validation — the route tool then draws a 0 mm or 999 mm trace (S3, confirmed)</summary>

- Area designer.pcb · stack A · design cc5a12b9-bd16-4e8c-9c00-f94598075fd5 · themes dark · viewports 1440x900
- Repro:
  1. PCB → Properties → Edit rules…
  2. Net classes: Default width = 0, Power width = 999, Power clearance = −1
  3. Net assignments: Net_43 → Power
  4. Save & re-run DRC
  5. Route (R) from a Default-class pad, then from U1 pad 1 (Net_43)
- Expected: Inline validation (e.g. width ≥ fab minimum trace width and ≤ a sane max, clearance > 0), Save disabled while invalid, backend rejects non-positive values; DRC flags an invalid rule if one ever gets stored.
- Actual: No inline error, Save enabled, dialog closes. Projection afterwards: default traceWidthMm 0, power traceWidthMm 999 / clearanceMm −1. Routing a Default net shows 'W 0.000 mm' and draws a zero-width trace; routing Net_43 shows 'W 999.000 mm · Class Power', the preview floods the entire canvas red and reports 440 conflicts. DRC after save reports nothing about the rules (same 64 errors / 720 warnings). Clearing a field while typing also silently becomes 0 (parseFloat(...) || 0).
- Screenshots: [043-netclass-invalid](../evidence/shots/f1b/dark/043-netclass-invalid.png), [045-route-power-999](../evidence/shots/f1b/dark/045-route-power-999.png), [046-route-power-999](../evidence/shots/f1b/dark/046-route-power-999.png)
- Network: `GET /projection/pcb → netClasses default 0/0.25, power 999/-1; perNetClassAssignments {pt:120000000:-10160000: power}`
- Code: `src/modules/designer/frontend/components/PcbDesignRulesDialog.tsx:136` — onChange Number.parseFloat(v) \|\| 0; min={0} only affects the spinner
- Code: `src/modules/designer/backend/pcb/pcb-store.ts:532` — parseNetClass keeps any finite traceWidthMm/clearanceMm (asNumber ?? default)
- Suggested fix: In PcbDesignRulesDialog validate each class (width ≥ minimums.traceWidthMm and ≤ e.g. 10 mm, clearance ≥ clearance floor), show the error under the field and disable Save; keep the raw string in state instead of coercing '' to 0. In pcb-store parseNetClass reject non-positive/non-finite widths and clearances (ValidationError) rather than persisting them.
- Verification (vf1b): **confirmed** — Reproduced. In the dialog (QA-vf1b-stack60), Power width 999 was accepted with no inline error and Save stayed enabled. Clearing the Default width field immediately coerced it to '0', and typing 0.3 then displayed '00.3' (parseFloat('')||0 at PcbDesignRulesDialog.tsx:136). Via the API, pcb_set_design_rules with default width 0 and power width 999 / clearance -1 was persisted as-is; DRC reported nothing about the rules. Severity lowered to S3: the harm is bounded. The backend rejects a zero-width trace commit (400 'command.widthMm must be a positive number'), and the DRC resolver takes max(board, classA, classB) clearance (rule-resolver.ts:309), so a negative class clearance has no effect. What remains is missing validation, a confusing 999 mm preview, and the input glitch. · evidence: [007-netclass-invalid-values](../evidence/shots/vf1b/dark/007-netclass-invalid-values.png), API QA-vf1b-refdes fa21e39a: netClasses after save [('default',0,0.25),('power',999,-1)]; pcb_add_trace widthMm 0 -> 400 validation

</details>


## T-162

**Net classes are a fixed Default/Power/GND trio: no Add/rename/delete class and no per-class via size in Design rules**

- Severity **S3** · category stub · status confirmed · themes dark
- Recommendation **decide** · decision P5 · owner D3 · wave proposal · scope proposal · estimate M
- Findings: F1B-007

**Summary.** Only three hard-wired rows (Default, Power, GND) with 'width' and 'clearance' spinbuttons. No 'Add class' button (Length match groups has 'Add group', net classes do not), no delete, no rename, and the via diameter/drill stored per class (PcbNetClass.viaDiameterMm/viaDrillMm, shown in the route chip as 'via 0.80/0.40') cannot be edited anywhere. A user who needs a 'HighCurrent 1.0 mm' or 'USB 0.2 mm' class has no wa…

**Root cause.** `src/modules/designer/frontend/components/PcbDesignRulesDialog.tsx:360` — net classes rendered from the existing array with width/clearance fields only

**Proposed fix.** Net class management (add/rename/delete, per-class via size). — Detail: Add an 'Add class' action and per-row name, via Ø / drill fields and a delete button (reassign its nets to Default on delete) in PcbDesignRulesDialog; the backend (parseNetClasses) already accepts arbitrary ids.

**Evidence.** [041-design-rules-dialog](../evidence/shots/f1b/dark/041-design-rules-dialog.png), [006-design-rules-dialog](../evidence/shots/vf1b/dark/006-design-rules-dialog.png)

<details><summary>F1B-007 — Net classes are a fixed Default/Power/GND trio: no Add/rename/delete class and no per-class via size in Design rules (S3, confirmed)</summary>

- Area designer.pcb · stack A · design cc5a12b9-bd16-4e8c-9c00-f94598075fd5 · themes dark · viewports 1440x900, 1100x720
- Repro:
  1. PCB → Properties → Edit rules…
  2. Look at the 'Net classes' section
- Expected: Pro EDA net-class editor: add a class (name, track width, clearance, via diameter/drill, colour), rename, delete (with reassignment of its nets), like KiCad Board Setup → Net Classes.
- Actual: Only three hard-wired rows (Default, Power, GND) with 'width' and 'clearance' spinbuttons. No 'Add class' button (Length match groups has 'Add group', net classes do not), no delete, no rename, and the via diameter/drill stored per class (PcbNetClass.viaDiameterMm/viaDrillMm, shown in the route chip as 'via 0.80/0.40') cannot be edited anywhere. A user who needs a 'HighCurrent 1.0 mm' or 'USB 0.2 mm' class has no way to create it. Editing a class in use works (Power 0.5→0.6: route chip then shows W 0.600 mm and the committed trace is 0.6 mm), existing traces keep their width.
- Screenshots: [041-design-rules-dialog](../evidence/shots/f1b/dark/041-design-rules-dialog.png), [050-route-committed](../evidence/shots/f1b/dark/050-route-committed.png)
- Network: `projection board.netClasses keys: id,name,traceWidthMm,clearanceMm,viaDiameterMm,viaDrillMm,color,defaultViaProtection`
- Code: `src/modules/designer/frontend/components/PcbDesignRulesDialog.tsx:360` — net classes rendered from the existing array with width/clearance fields only
- Suggested fix: Add an 'Add class' action and per-row name, via Ø / drill fields and a delete button (reassign its nets to Default on delete) in PcbDesignRulesDialog; the backend (parseNetClasses) already accepts arbitrary ids.
- Verification (vf1b): **confirmed** — Seen in the Design rules dialog on QA-vf1b-stack60: Net classes shows only the Default/Power/GND rows with width + clearance. There is no Add/rename/delete and no via diameter/drill fields; 'Add group' exists only for length groups. The backend accepts arbitrary class ids (parseNetClasses). S3 kept (feature gap versus KiCad Board Setup). · evidence: [006-design-rules-dialog](../evidence/shots/vf1b/dark/006-design-rules-dialog.png)

</details>


## T-163

**Design rules net pickers don't scale: 353 unfilterable Net assignment selects in a 192 px box and 353 length-group chips in an 80 px box; selected members not summarised**

- Severity **S3** · category consistency · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate M
- Findings: F1B-008

**Summary.** Net assignments renders one native <select> per net — 353 of them (including every single-pin 'net') inside a max-h-48 (192 px) scroller that shows ~5 rows; no search. Each length group renders all 353 nets as toggle chips in an 80 px scroller (scrollHeight 1221 px) — once you scroll away you cannot see which nets are in the group; chips expose no aria-pressed. The dialog body is a third scroller (and overflows hori…

**Root cause.** `src/modules/designer/frontend/components/PcbDesignRulesDialog.tsx:527` — one <select> per net

**Proposed fix.** Filterable net table (search, ≥2-pad nets default, bulk class select); length-group 'Add net' combobox; one scroller. — Detail: Replace the per-net select list with a filterable table (search box, 'only nets with ≥2 pads' default, class column with a single select for the selected rows); in length groups show members as chips plus an 'Add net' combobox with search; drop the nested fixed-height scrollers so only the dialog body scrolls.

**Evidence.** [042-netclass-assign](../evidence/shots/f1b/dark/042-netclass-assign.png), [006-design-rules-dialog](../evidence/shots/vf1b/dark/006-design-rules-dialog.png)

<details><summary>F1B-008 — Design rules net pickers don't scale: 353 unfilterable Net assignment selects in a 192 px box and 353 length-group chips in an 80 px box; selected members not summarised (S3, confirmed)</summary>

- Area designer.pcb · stack A · design cc5a12b9-bd16-4e8c-9c00-f94598075fd5 · themes dark · viewports 1440x900, 1100x720
- Repro:
  1. On the 150-part board open PCB → Edit rules…
  2. Scroll 'Net assignments' to find Net_43
  3. Add group → pick Net_37 and Net_43 → switch to Absolute
  4. Resize to 1100×720
- Expected: A searchable net list (filter box, only multi-pin/routed nets by default, sort by class), and the group shows its members as removable chips; one scroll container.
- Actual: Net assignments renders one native <select> per net — 353 of them (including every single-pin 'net') inside a max-h-48 (192 px) scroller that shows ~5 rows; no search. Each length group renders all 353 nets as toggle chips in an 80 px scroller (scrollHeight 1221 px) — once you scroll away you cannot see which nets are in the group; chips expose no aria-pressed. The dialog body is a third scroller (and overflows horizontally by 14 px at 1100×720). In Absolute mode the '± tol' label wraps to two lines and the tolerance 'mm' sits on the dialog padding edge.
- Screenshots: [042-netclass-assign](../evidence/shots/f1b/dark/042-netclass-assign.png), [049-length-group-absolute](../evidence/shots/f1b/dark/049-length-group-absolute.png), [053-design-rules-1100](../evidence/shots/f1b/dark/053-design-rules-1100.png), [054-design-rules-1100-bottom](../evidence/shots/f1b/dark/054-design-rules-1100-bottom.png)
- Code: `src/modules/designer/frontend/components/PcbDesignRulesDialog.tsx:527` — one <select> per net
- Suggested fix: Replace the per-net select list with a filterable table (search box, 'only nets with ≥2 pads' default, class column with a single select for the selected rows); in length groups show members as chips plus an 'Add net' combobox with search; drop the nested fixed-height scrollers so only the dialog body scrolls.
- Verification (vf1b): **confirmed** — Reproduced on QA-vf1b-stack60 (60 parts, 0 wires): 168 native <select>s under Net assignments in a 192 px scroller (scrollHeight 6044). A new length group lists 168 chips in an 80 px scroller (scrollHeight 571) with no aria-pressed and no search box. The dialog body is a second, nested scroller (660/754). S3 kept. · evidence: [006-design-rules-dialog](../evidence/shots/vf1b/dark/006-design-rules-dialog.png), [008-length-group-row](../evidence/shots/vf1b/dark/008-length-group-row.png), DOM: selects=168, net-assign 192/6044, chips=168 in 80/571, ariaPressed=null, search inputs=0

</details>


## T-164

**Fab bundle (all 14 Gerber/drill/CSV files, ZIP and .gbrjob ProjectId) is named after a truncated design UUID, never the design name (extends Q5-010 from BOM downloads to the manufacturing ZIP)**

- Severity **S3** · category copy · status confirmed · themes dark
- Recommendation **decide** · decision DEC-PCB3 · owner D3+D4 · wave W2 · scope backend · estimate S
- Findings: F1B-014

**Summary.** The user (and the fab house) receives several ZIPs that are indistinguishable except for a 32-char UUID fragment; the UUID is cut mid-group (last group truncated to 8 of 12 chars). BOM view names end in '-csv.csv'. Related: Q5-010 reported the UUID naming for BOM-view downloads; this finding covers the manufacturing ZIP, every file inside it and the X2 job file.

**Root cause.** `src/sdks/designer/pcb-helpers.ts:13` — exportBundleName(designId) = 'openpcb-' + designId.slice(0,32)

**Proposed fix.** Name fab/BOM downloads + .gbrjob ProjectId after the design (slug); backend exporter takes design name. — Detail: Pass the design name into exportBundleName (slugify [^A-Za-z0-9_-]→'_', max ~40 chars, append short id only on collision/empty name); use it in job-file ProjectId.Name; in api.downloadBomArtifact use the Content-Disposition filename or a kind→label map (BOM, BOM.tsv, JLC-BOM, KiCad-BOM, CPL).

**Evidence.** [036-export-dialog-stress](../evidence/shots/f1b/dark/036-export-dialog-stress.png), [026-export-empty-design](../evidence/shots/vf1b/dark/026-export-empty-design.png)

<details><summary>F1B-014 — Fab bundle (all 14 Gerber/drill/CSV files, ZIP and .gbrjob ProjectId) is named after a truncated design UUID, never the design name (extends Q5-010 from BOM downloads to the manufacturing ZIP) (S3, duplicate)</summary>

- Area designer.pcb · stack A · design cc5a12b9-bd16-4e8c-9c00-f94598075fd5 · themes dark · viewports 1440x900
- Repro:
  1. Open QA-f1b-stress → PCB → Export… : dialog footer reads '14 files · openpcb-cc5a12b9-bd16-4e8c-9c00-f9459807.zip'
  2. Download ZIP and unzip: every file is 'openpcb-cc5a12b9-bd16-4e8c-9c00-f9459807-F_Cu.gbr', '…-PTH.drl', '…-BOM.csv'; the .gbrjob GeneralSpecs.ProjectId.Name is the raw UUID 'cc5a12b9-bd16-4e8c-9c00-f94598075fd5'
  3. Same for Dual LED Blinker (openpcb-c2c58a19-bef5-488a-bfa4-c6b133ea.zip) and QA-f1b-empty
  4. BOM view → Export ▾ → CSV downloads 'openpcb-cc5a12b9-bd16-4e8c-9c00-f9459807-csv.csv' (JLC → '-jlc.csv', PnP → '-pnp.csv') while the server's Content-Disposition for the same endpoint says 'openpcb-<id>-BOM.csv'
- Expected: Bundle and files use a slug of the design name (e.g. 'Dual_LED_Blinker-r540-F_Cu.gbr'), job file ProjectId.Name = design name; BOM downloads named '<design>-BOM.csv' / '<design>-JLC-BOM.csv' / '<design>-CPL.csv'.
- Actual: The user (and the fab house) receives several ZIPs that are indistinguishable except for a 32-char UUID fragment; the UUID is cut mid-group (last group truncated to 8 of 12 chars). BOM view names end in '-csv.csv'. Related: Q5-010 reported the UUID naming for BOM-view downloads; this finding covers the manufacturing ZIP, every file inside it and the X2 job file.
- Screenshots: [036-export-dialog-stress](../evidence/shots/f1b/dark/036-export-dialog-stress.png), [040-export-empty-design](../evidence/shots/f1b/dark/040-export-empty-design.png)
- Code: `src/sdks/designer/pcb-helpers.ts:13` — exportBundleName(designId) = 'openpcb-' + designId.slice(0,32)
- Code: `src/modules/designer/backend/export/gerber/job-file.ts:44` — ProjectId.Name: pcb.designId
- Code: `src/modules/designer/frontend/api.ts:738` — downloadBlob name `${exportBundleName(designId)}-${kind}.${extension}` → '-csv.csv'
- Suggested fix: Pass the design name into exportBundleName (slugify [^A-Za-z0-9_-]→'_', max ~40 chars, append short id only on collision/empty name); use it in job-file ProjectId.Name; in api.downloadBomArtifact use the Content-Disposition filename or a kind→label map (BOM, BOM.tsv, JLC-BOM, KiCad-BOM, CPL).
- Verification (vf1b): **duplicate** — Confirmed, but already covered: the export dialog footer on QA-vf1b-empty reads '14 files · openpcb-cb93fe99-63c1-414a-8bf9-ec87ff3c.zip'. The member prefix and the .gbrjob GeneralSpecs.ProjectId.Name = raw UUID (job-file.ts:44) were confirmed via POST /exports/gerber. The ZIP and member UUID naming is verified in Q4-024 ('ZIP named by UUID', fix: slugify the design name). The '-csv.csv' BOM-view names and the ignored Content-Disposition are verified in Q5-010. The only new detail is the .gbrjob ProjectId.Name; add it to Q4-024's fix: exportBundleName(designId) in sdks/designer/pcb-helpers.ts:13 should take the design name and feed job-file.ts ProjectId.Name. · evidence: [026-export-empty-design](../evidence/shots/vf1b/dark/026-export-empty-design.png), API POST /designs/cb93fe99…/exports/gerber -> .gbrjob ProjectId.Name 'cb93fe99-63c1-414a-8bf9-ec87ff3cadcd'

</details>


## T-165

**Design rules → Length match group row overflows the dialog: the 'Remove group' (trash) button is clipped to ~9 px at the dialog edge and '± tol' wraps onto two lines**

- Severity **S3** · category visual · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate XS
- Findings: F1B-018

**Summary.** Row content is 547 px wide inside a 508 px container (scrollWidth 547 > clientWidth 508, overflow visible): button[aria-label='Remove group G1'] spans x 991–1013 while the dialog panel ends at x 1000, so only a 9 px sliver of the trash icon shows and the rest is cut off. '± tol' breaks into '±' / 'tol'. Same in QA-f1b-stress (shots 048/049). Same at 1100×720 (shot 054: trash sliver at x≈826 against the dialog edge).

**Root cause.** `src/modules/designer/frontend/components/PcbDesignRulesDialog.tsx:460` — '± tol' NumberField label + Remove group button at :466 in a non-wrapping flex row

**Proposed fix.** Length group row wraps cleanly; trash button fixed width inside dialog. — Detail: In the design-rules length-group row allow the name input to shrink (min-w-0 flex-1) and give numeric inputs a fixed w-16, or wrap the row into two lines (name+kind / target+tol+remove); add whitespace-nowrap to the '± tol' label.

**Evidence.** [057-netid-rules-stale-assignment](../evidence/shots/f1b/dark/057-netid-rules-stale-assignment.png), [008-length-group-row](../evidence/shots/vf1b/dark/008-length-group-row.png)

<details><summary>F1B-018 — Design rules → Length match group row overflows the dialog: the 'Remove group' (trash) button is clipped to ~9 px at the dialog edge and '± tol' wraps onto two lines (S3, confirmed)</summary>

- Area designer.pcb · stack A · design 0d2709d2-24bf-463a-b37a-6b5713b46aea · themes dark · viewports 1440x900, 1100x720
- Repro:
  1. Open QA-f1b-netid (or QA-f1b-stress) → PCB → Board properties → Edit rules…
  2. Length match groups → Add group (or view existing G1), set target kind Absolute
  3. Look at the right end of the group row
- Expected: Group row (name, kind, target, tolerance, remove) fits inside the 560 px dialog; the remove button is fully visible and the label reads '± tol' on one line.
- Actual: Row content is 547 px wide inside a 508 px container (scrollWidth 547 > clientWidth 508, overflow visible): button[aria-label='Remove group G1'] spans x 991–1013 while the dialog panel ends at x 1000, so only a 9 px sliver of the trash icon shows and the rest is cut off. '± tol' breaks into '±' / 'tol'. Same in QA-f1b-stress (shots 048/049). Same at 1100×720 (shot 054: trash sliver at x≈826 against the dialog edge).
- Screenshots: [057-netid-rules-stale-assignment](../evidence/shots/f1b/dark/057-netid-rules-stale-assignment.png), [057b-remove-group-clipped-zoom](../evidence/shots/f1b/dark/057b-remove-group-clipped-zoom.png), [049-length-group-absolute](../evidence/shots/f1b/dark/049-length-group-absolute.png), [054-design-rules-1100-bottom](../evidence/shots/f1b/dark/054-design-rules-1100-bottom.png)
- Code: `src/modules/designer/frontend/components/PcbDesignRulesDialog.tsx:460` — '± tol' NumberField label + Remove group button at :466 in a non-wrapping flex row
- Suggested fix: In the design-rules length-group row allow the name input to shrink (min-w-0 flex-1) and give numeric inputs a fixed w-16, or wrap the row into two lines (name+kind / target+tol+remove); add whitespace-nowrap to the '± tol' label.
- Verification (vf1b): **confirmed** — Reproduced on QA-vf1b-stack60: Add group -> Absolute. The row's scrollWidth 547 > clientWidth 508. 'Remove group' spans x 991-1013 while the dialog panel ends at x 1000, so only a sliver of the trash icon shows, and elementFromPoint at its centre does not hit the button. The '± tol' label is 13 px wide and 30 px tall, wrapping onto two lines. S3 kept. · evidence: [008-length-group-row](../evidence/shots/vf1b/dark/008-length-group-row.png), [008b-length-group-row-zoom](../evidence/shots/vf1b/dark/008b-length-group-row-zoom.png)

</details>


## T-166

**DRC marker hover tooltip: long net names overflow the 280 px card (no wrap, no viewport clamp), and in light theme its 10 px message text is 2.8:1 on a blue-tinted translucent card**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate XS
- Findings: F1B-021

**Summary.** The card is max-w-[280px] (x≈766–1046) but the anchor line 'VERY_LONG_NET_LABEL_FOR_QA_VERY_LONG…' and the quoted net in the message run to x≈1302, outside the card background, over the canvas/inspector boundary (1140) and onto the Properties panel. The card is placed at cursor+14 px with no viewport clamping, so near the right edge it runs off-screen. Light theme ([010-drc-tooltip](../evidence/shots/f1b/light/010-drc-tooltip.png)): the card is b…

**Root cause.** `src/modules/designer/frontend/pcb/PcbCanvas.tsx:6410` — tooltip div: max-w-[280px], no break-words/break-all, fixed left=cursor+14 without clamping

**Proposed fix.** Tooltip wraps/clamps to viewport; message text ≥4.5:1 in light. — Detail: Add 'break-all' (or [overflow-wrap:anywhere]) to the anchors and message rows, and clamp left/top against window.innerWidth/innerHeight minus the measured card size (flip to the left of the cursor near the right edge). Use an opaque bg-surface-raised (drop /95 and backdrop-blur) and text-text-secondary for the message so it meets 4.5:1 in light.

**Evidence.** [086-overlap-picker](../evidence/shots/f1b/dark/086-overlap-picker.png), [018-drc-tooltip-overflow](../evidence/shots/vf1b/dark/018-drc-tooltip-overflow.png)

<details><summary>F1B-021 — DRC marker hover tooltip: long net names overflow the 280 px card (no wrap, no viewport clamp), and in light theme its 10 px message text is 2.8:1 on a blue-tinted translucent card (S3, confirmed)</summary>

- Area designer.pcb · stack A · design 43a2da78-9d2e-43a0-bcd3-ecebe3f72551 · themes dark, light · viewports 1440x900
- Repro:
  1. QA-f1b-long has a net labelled VERY_LONG_NET_LABEL_FOR_QA_… (80 chars) and a DRC run with an UNCONNECTED_NET on it
  2. PCB view, hover the Unconnected-net marker near the stacked parts
- Expected: Tooltip text wraps (break-all for identifiers) or truncates with an ellipsis inside the card; the card is clamped to the viewport.
- Actual: The card is max-w-[280px] (x≈766–1046) but the anchor line 'VERY_LONG_NET_LABEL_FOR_QA_VERY_LONG…' and the quoted net in the message run to x≈1302, outside the card background, over the canvas/inspector boundary (1140) and onto the Properties panel. The card is placed at cursor+14 px with no viewport clamping, so near the right edge it runs off-screen. Light theme ([010-drc-tooltip](../evidence/shots/f1b/light/010-drc-tooltip.png)): the card is bg-surface-raised/95 + backdrop-blur, so over the B.Cu pour it renders #d9dce5 (blue cast, nearest --status-info-soft) instead of --surface-raised #e2e2e5; the 10 px layer line and message (#818188 / #85858d) reach only 2.82:1 contrast (dark theme: 4.27:1).
- Screenshots: [086-overlap-picker](../evidence/shots/f1b/dark/086-overlap-picker.png), [086b-drc-tooltip-overflow](../evidence/shots/f1b/dark/086b-drc-tooltip-overflow.png), [010-drc-tooltip](../evidence/shots/f1b/light/010-drc-tooltip.png)
- Pixel probes: {"file": "shots/f1b/light/010-drc-tooltip.png", "x": 1000, "y": 500, "hex": "#d9dce5", "nearestToken": "--status-info-soft@app", "deltaE": 1.5}; {"file": "shots/f1b/light/010-drc-tooltip.png", "x": 800, "y": 541, "hex": "#818188", "nearestToken": "--text-tertiary", "deltaE": 0.5}
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:6410` — tooltip div: max-w-[280px], no break-words/break-all, fixed left=cursor+14 without clamping
- Suggested fix: Add 'break-all' (or [overflow-wrap:anywhere]) to the anchors and message rows, and clamp left/top against window.innerWidth/innerHeight minus the measured card size (flip to the left of the cursor near the right edge). Use an opaque bg-surface-raised (drop /95 and backdrop-blur) and text-text-secondary for the message so it meets 4.5:1 in light.
- Verification (vf1b): **confirmed** — Reproduced on QA-f1b-long by hovering the UNCONNECTED_NET marker at (750,455). The card spans x 764-1044 while the anchor and message rows have scrollWidth 526/486 in a 258 px box; the text runs to x≈1300, over the Properties dock. Light: the card probes #d9dce5 (95% alpha + blur(8px) over the blue pour; nearest --status-info-soft) and the darkest message pixel is #818188, which is 2.82:1 at 10 px. Dark tertiary on raised is 4.27:1. Code: PcbCanvas.tsx:6410, no wrap, no viewport clamp. S3 kept. · evidence: [018-drc-tooltip-overflow](../evidence/shots/vf1b/dark/018-drc-tooltip-overflow.png), [004-drc-tooltip](../evidence/shots/vf1b/light/004-drc-tooltip.png), probe light 1000,475 #d9dce5 (--status-info-soft dE 1.5)

</details>


## T-167

**Tune HUD: key readouts in low-contrast grey (2–2.5:1) and wrap mid-value**

- Severity **S3** · category a11y · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate XS
- Findings: F1B-022, F1B-034

**Summary.** Dark: '≈16.32 / 30.00 mm' is --status-warning (#d9a441, fine) but '13.68 mm short' is #515156 (--text-disabled #55555a) on the #151517 HUD = 2.46:1. Light: the delta span uses --text-disabled #a8a8ae on #ebebed ≈ 2.0:1, and with no target the length '25.06 mm' plus 'set target…' are --text-tertiary #7f7f86 on #ebebed = 3.34:1 at 11 px. (The hint row itself is OK only by accident: PcbParamRow is given both 'text-text… | Also covers: F1B-034: Tune HUD wraps every readout mid-value when the row is full ('≈16.32 /' ⏎ '30.00 mm', 'A…

**Root cause.** `src/modules/designer/frontend/pcb/TuneHud.tsx:90` — delta span className='text-text-disabled'

**Proposed fix.** Tune HUD readouts in text-strong/status tokens; no mid-value wraps (nowrap + truncate). — Detail: TuneHud.tsx: render the delta in the same BAND_CLASS as the length (or text-text-secondary) and the no-target length in text-text; merge PcbParamRow classes with tailwind-merge (or drop its default colour) so callers can override deterministically.

**Evidence.** [052-tune-hud](../evidence/shots/f1b/dark/052-tune-hud.png), [022-tune-hud](../evidence/shots/vf1b/dark/022-tune-hud.png), [115-tune-long-group-name](../evidence/shots/f1b/dark/115-tune-long-group-name.png)

<details><summary>F1B-022 — Tune HUD renders its key readouts in disabled/tertiary grey: the length delta ('13.68 mm short', 'in tolerance') is 2.5:1 in dark and ~2:1 in light; the current length without a target is 3.3:1 in light (S3, confirmed)</summary>

- Area designer.pcb · stack A · design cc5a12b9-bd16-4e8c-9c00-f94598075fd5 · themes dark, light · viewports 1440x900
- Repro:
  1. QA-f1b-stress → PCB (length group 'Group 1', absolute 30 mm) → press U
  2. Click a routed trace on a group net (dark shot 052: Net_43) and on a non-group net (light shot 017: Net_131)
  3. Read the HUD row: net · length · delta
- Expected: The live length and its distance to target — the whole point of the Tune tool — are rendered at ≥4.5:1 (text-text or the band status colour); only the inapplicable 'Enter apply' hint is dimmed.
- Actual: Dark: '≈16.32 / 30.00 mm' is --status-warning (#d9a441, fine) but '13.68 mm short' is #515156 (--text-disabled #55555a) on the #151517 HUD = 2.46:1. Light: the delta span uses --text-disabled #a8a8ae on #ebebed ≈ 2.0:1, and with no target the length '25.06 mm' plus 'set target…' are --text-tertiary #7f7f86 on #ebebed = 3.34:1 at 11 px. (The hint row itself is OK only by accident: PcbParamRow is given both 'text-text-secondary' and 'text-text-disabled' and secondary wins in CSS order.)
- Screenshots: [052-tune-hud](../evidence/shots/f1b/dark/052-tune-hud.png), [017-tune-hud](../evidence/shots/f1b/light/017-tune-hud.png)
- Console: `computed: light '25.06 mm' rgb(127,127,134) 11px; hint kbd rgb(85,85,92)`
- Pixel probes: {"file": "shots/f1b/dark/052-tune-hud.png", "x": 340, "y": 77, "hex": "#515156", "nearestToken": "--text-disabled", "deltaE": 1.0}; {"file": "shots/f1b/light/017-tune-hud.png", "x": 700, "y": 77, "hex": "#ebebed", "nearestToken": "--surface-panel-head", "deltaE": 0}; {"file": "shots/f1b/light/017-tune-hud.png", "x": 200, "y": 77, "hex": "#828288", "nearestToken": "--text-tertiary", "deltaE": 0.6}
- Code: `src/modules/designer/frontend/pcb/TuneHud.tsx:90` — delta span className='text-text-disabled'
- Code: `src/modules/designer/frontend/pcb/TuneHud.tsx:83` — length falls back to text-text-tertiary without a band
- Code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:808` — PcbParamRow hard-codes text-text-secondary, so a passed text-* class conflicts
- Suggested fix: TuneHud.tsx: render the delta in the same BAND_CLASS as the length (or text-text-secondary) and the no-target length in text-text; merge PcbParamRow classes with tailwind-merge (or drop its default colour) so callers can override deterministically.
- Verification (vf1b): **confirmed** — Reproduced on QA-f1b-stress, Tune on the Net_43 trace. Dark: '13.68 mm short' is computed rgb(85,85,90) = --text-disabled on the #151517 row = 2.46:1. Light: the darkest delta pixel is #acacb2 on HUD #ebebed (probed, --surface-panel-head) ≈ 1.9:1, and 'target:…' / 'A 2.00 · pitch' use --text-tertiary #7f7f86 = 3.34:1 at 11 px. Code: TuneHud.tsx:90 delta 'text-text-disabled'. S3 kept. · evidence: [022-tune-hud](../evidence/shots/vf1b/dark/022-tune-hud.png), [005-tune-hud](../evidence/shots/vf1b/light/005-tune-hud.png), probe light 700,70 #ebebed --surface-panel-head dE 0

</details>

<details><summary>F1B-034 — Tune HUD wraps every readout mid-value when the row is full ('≈16.32 /' ⏎ '30.00 mm', 'A 2.00 · pitch' ⏎ '1.00') and never truncates a long length-group name (S4, confirmed)</summary>

- Area designer.pcb · stack A · design cc5a12b9-bd16-4e8c-9c00-f94598075fd5 · themes dark · viewports 1100x720, 1440x900
- Repro:
  1. QA-f1b-stress: rename length group 'Group 1' to a 60-char name (USB_HS_DIFFERENTIAL_PAIR_LENGTH_MATCH_GROUP_FOR_QA_LONG_NAME; via Design rules or pcb_set_design_rules)
  2. PCB → U → click the Net_43 trace (member of the group)
  3. Resize to 1100×720
- Expected: One-line HUD: numeric readouts never break; the group name truncates with ellipsis (full name in title); the hint collapses first.
- Actual: At 1440 the 60-char name fits on one line only because the canvas is wide. At 1100×720 the HUD row is 56 px (scrollWidth 1020 in a 1020 px bar, white-space: normal): '≈16.32 / 30.00 mm', '13.68 mm short', 'target: '…'', 'A 2.00 · pitch 1.00' and the hint each wrap independently into ragged two-line cells. Without a target (Net_334) the row fits on one line at 1100.
- Screenshots: [115-tune-long-group-name](../evidence/shots/f1b/dark/115-tune-long-group-name.png), [116-tune-long-group-1100](../evidence/shots/f1b/dark/116-tune-long-group-1100.png), [117-tune-short-group-1100](../evidence/shots/f1b/dark/117-tune-short-group-1100.png)
- Console: `HUD row at 1100: {x:80,right:1100,h:56,sw:1020,cw:1020,overflowX:visible,whiteSpace:normal}`
- Code: `src/modules/designer/frontend/pcb/TuneHud.tsx:132` — target: '${model.groupName}' rendered untruncated
- Suggested fix: Give each HUD segment `whitespace-nowrap shrink-0`, the group-name span `min-w-0 max-w-[16ch] truncate` with a title, and let the trailing hint `truncate` first.
- Verification (vf1b): **confirmed** — Reproduced at 1100x720 after temporarily renaming QA-f1b-stress's length group to the 60-char name (reverted afterwards, rev 697). Each HUD cell (≈16.32 / 30.00 mm, 13.68 mm short, target:'USB_HS_…', A 2.00 · pitch 1.00, the hint) wraps to 30 px inside the fixed 28 px PcbParamRow. Correction: the row stays 28 px (PcbParamRow h-[28px]) and text overflows it; the 56 px f1b measured is the two stacked rows. With 'Group 1' the HUD fits on one line at 1100, so this needs a long group name. S4 kept. · evidence: [024-tune-long-group-1100](../evidence/shots/vf1b/dark/024-tune-long-group-1100.png), [024b-tune-long-group-1100-zoom](../evidence/shots/vf1b/dark/024b-tune-long-group-1100-zoom.png), [023b-tune-hud-1100-zoom](../evidence/shots/vf1b/dark/023b-tune-hud-1100-zoom.png) (short name fits)

</details>


## T-168

**'Remove redundant pour traces' is hidden for zones drawn with Z (only shown while a board zone is enabled) and gives no feedback — it returned ok with 0 changes and nothing on screen**

- Severity **S3** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: F2A-005

**Summary.** Button rendered only when hasEnabledBoardZone(); with the normal Z workflow it never appears. When clicked: POST pcb_cleanup_pour_traces → {ok:true, revision:116} (unchanged), the B.Cu GND trace stays, no toast/notice — indistinguishable from a broken button.

**Root cause.** `src/modules/designer/frontend/pcb/PcbLayersPanel.tsx:625` — button rendered only when hasEnabledBoardZone(boardZones)

**Proposed fix.** Show 'Remove redundant pour traces' for any zone; toast with count removed (or 'nothing to remove'). — Detail: Gate on any enabled zone; return the removed-trace count from the executor and show it in the PCB notice strip.

**Evidence.** [067-gnd-bottom-trace](../evidence/shots/f2a/dark/067-gnd-bottom-trace.png)

<details><summary>F2A-005 — 'Remove redundant pour traces' is hidden for zones drawn with Z (only shown while a board zone is enabled) and gives no feedback — it returned ok with 0 changes and nothing on screen (S3, confirmed)</summary>

- Area designer.pcb · stack A · design 847e94e7-36e6-4284-b22c-17725e0f5b02 · themes dark · viewports 1440x900
- Repro:
  1. QA-f2a-golden: B.Cu GND polygon zone drawn with Z; route a GND trace on B.Cu under it (J1.2 → C2.2)
  2. Layers panel: no 'Remove redundant pour traces' button
  3. Enable the board zone via the droplet (see F2A-004) → button appears → click it
- Expected: The cleanup is offered whenever any enabled zone exists (the backend already evaluates polygon zones), and reports the outcome ('Removed 2 traces' / 'No redundant traces found').
- Actual: Button rendered only when hasEnabledBoardZone(); with the normal Z workflow it never appears. When clicked: POST pcb_cleanup_pour_traces → {ok:true, revision:116} (unchanged), the B.Cu GND trace stays, no toast/notice — indistinguishable from a broken button.
- Screenshots: [067-gnd-bottom-trace](../evidence/shots/f2a/dark/067-gnd-bottom-trace.png), [068-remove-redundant](../evidence/shots/f2a/dark/068-remove-redundant.png)
- Network: `req 1200 POST commands {type:'pcb_cleanup_pour_traces'} → {ok:true, revision:116} (no change)`
- Code: `src/modules/designer/frontend/pcb/PcbLayersPanel.tsx:625` — button rendered only when hasEnabledBoardZone(boardZones)
- Code: `src/modules/designer/backend/command-executor.ts:1319` — pcb_cleanup_pour_traces already evaluates EVERY effective zone incl. polygon zones (contract §9/S5)
- Code: `src/modules/designer/frontend/pcb/usePcbWorkspace.ts:472` — cleanupPourTraces ignores the result; no count/notice
- Suggested fix: Gate on any enabled zone; return the removed-trace count from the executor and show it in the PCB notice strip.
- Verification (vf2a): **confirmed** — On the golden design the only enabled zone is the thermal polygon zone, and there are 0 'Remove redundant pour traces' buttons in the DOM. Code: the UI gates the button on hasEnabledBoardZone (PcbLayersPanel.tsx:625), while the executor (command-executor.ts:1319, contract 03 §9 'widened from S3a's board-only') handles polygon zones, so the UI gate is stale. usePcbWorkspace.cleanupPourTraces reports nothing on success. I did not re-click the button; the no-op POST is f2a's evidence and matches the code. S3. · evidence: DOM: 0 buttons matching /redundant/ with polygon zone only (golden rev 140), src/modules/designer/frontend/pcb/PcbLayersPanel.tsx:625

</details>


## T-169

**No 'routing complete' indicator: nothing shows how many connections are still unrouted — users must hunt for faint dashed ratsnest lines or run DRC**

- Severity **S3** · category stub · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: F2A-017

**Summary.** No UI element exposes the ratsnest count (projection.ratsnest has it). With 1 airwire left the status bar still read '0 DRC' until a manual DRC run produced 'Net "Net_4" is not fully routed (1 airwire remaining)'. The only live cue is a thin dashed line that is easy to miss under DRC markers (Q4-043) and hidden when Ratsnest is toggled off (Shift+B).

**Root cause.** `src/modules/designer/frontend/pcb/PcbBoardPanel.tsx:494` — Board 'Summary' shows only Components and Nets (netNames count); PLAN D8 asked for 'nets/unrouted from workspace if available' — projection.ratsnest is available

**Proposed fix.** Add 'Unrouted N' to Board Summary + status bar (click frames next airwire); success state at 0. — Detail: Add 'Unrouted N' to the PCB status bar and Board Summary from projection.ratsnest.length (clickable → frame next airwire); show a success state at 0.

**Evidence.** [051-routed](../evidence/shots/f2a/dark/051-routed.png), [020-golden-pcb](../evidence/shots/vf2a/dark/020-golden-pcb.png)

<details><summary>F2A-017 — No 'routing complete' indicator: nothing shows how many connections are still unrouted — users must hunt for faint dashed ratsnest lines or run DRC (S3, confirmed)</summary>

- Area designer.pcb · stack A · design 847e94e7-36e6-4284-b22c-17725e0f5b02 · themes dark · viewports 1440x900
- Repro:
  1. QA-f2a-golden PCB with 1 unrouted connection (Net_4 deleted on purpose) or 4 GND airwires before the pour
  2. Look at the Board Summary (Components 8 · Nets 7), status bar ('0 DRC'), toolbar and Layers panel
- Expected: A persistent count like KiCad's 'Unrouted: N' (status bar or Board Summary), turning into a clear 'All nets routed' state; clicking it cycles/zooms to the next airwire.
- Actual: No UI element exposes the ratsnest count (projection.ratsnest has it). With 1 airwire left the status bar still read '0 DRC' until a manual DRC run produced 'Net "Net_4" is not fully routed (1 airwire remaining)'. The only live cue is a thin dashed line that is easy to miss under DRC markers (Q4-043) and hidden when Ratsnest is toggled off (Shift+B).
- Screenshots: [051-routed](../evidence/shots/f2a/dark/051-routed.png), [077-drc-unrouted](../evidence/shots/f2a/dark/077-drc-unrouted.png)
- Network: `GET /projection/pcb ratsnest length 1 while UI shows no count`
- Code: `src/modules/designer/frontend/pcb/PcbBoardPanel.tsx:494` — Board 'Summary' shows only Components and Nets (netNames count); PLAN D8 asked for 'nets/unrouted from workspace if available' — projection.ratsnest is available
- Suggested fix: Add 'Unrouted N' to the PCB status bar and Board Summary from projection.ratsnest.length (clickable → frame next airwire); show a success state at 0.
- Verification (vf2a): **confirmed** — Golden PCB: Board Summary = Components 8 · Nets 7; status bar shows only the DRC count. grep finds no 'unrouted' / routed-percentage UI outside the cloud autoroute dialog. projection.ratsnest.length is available. PLAN D8 explicitly intended 'nets/unrouted' in the Summary, so this is a gap in the plan's own scope, not an omission under D6. S3. · evidence: [020-golden-pcb](../evidence/shots/vf2a/dark/020-golden-pcb.png), src/modules/designer/frontend/pcb/PcbBoardPanel.tsx:494-502

</details>


## T-170

**Traces on the non-active copper layer can't be clicked, silently — and the route tool leaves the active layer on B.Cu after a via, so the next click on a top trace selects nothing**

- Severity **S3** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: F2A-018

**Summary.** First click: 'No selection', no hover/feedback; after pressing 1 the same click gives 'Trace · Net_4'. Nothing indicates why the click failed; the layer switch done by V is easy to miss (only the small active-layer chip changes).

**Root cause.** `src/modules/designer/frontend/pcb/pcb-hit.ts:177` — hitTrace: `if (trace.layer !== activeLayer) continue;`

**Proposed fix.** Allow selecting traces on non-active layers (or auto-switch layer on click); restore active layer after via placement per preference. — Detail: Hit-test all visible copper layers, preferring the active one; or show a transient notice when a click lands on copper of another layer.

**Evidence.** [052-trace-selected](../evidence/shots/f2a/dark/052-trace-selected.png), [029-click-top-trace-bcu-active](../evidence/shots/vf2a/dark/029-click-top-trace-bcu-active.png)

<details><summary>F2A-018 — Traces on the non-active copper layer can't be clicked, silently — and the route tool leaves the active layer on B.Cu after a via, so the next click on a top trace selects nothing (S3, confirmed)</summary>

- Area designer.pcb · stack A · design 847e94e7-36e6-4284-b22c-17725e0f5b02 · themes dark · viewports 1440x900
- Repro:
  1. Route a trace, press V to drop to B.Cu, finish (active layer is now Bottom Copper)
  2. Esc, click any top-layer (F.Cu) trace
  3. Press 1 (Top) and click it again
- Expected: Clicking visible copper selects it (active layer only as a tie-breaker, as in KiCad), or a hint says 'Switch to Top Copper to select this trace'.
- Actual: First click: 'No selection', no hover/feedback; after pressing 1 the same click gives 'Trace · Net_4'. Nothing indicates why the click failed; the layer switch done by V is easy to miss (only the small active-layer chip changes).
- Screenshots: [052-trace-selected](../evidence/shots/f2a/dark/052-trace-selected.png), [053-trace-selected-top](../evidence/shots/f2a/dark/053-trace-selected-top.png)
- Code: `src/modules/designer/frontend/pcb/pcb-hit.ts:177` — hitTrace: `if (trace.layer !== activeLayer) continue;`
- Code: `src/modules/designer/frontend/pcb/pcb-hit.ts:461` — unified hit-test: traces also filtered to the active layer
- Suggested fix: Hit-test all visible copper layers, preferring the active one; or show a transient notice when a click lands on copper of another layer.
- Verification (vf2a): **confirmed** — Golden PCB (dark): press 2 (Bottom Copper active) and click the visible (dimmed) top VCC trace at (600,367): status 'No selection', no feedback. Press 1 and click the same point: 'Trace · VCC'. The active-layer filter is documented in pcb-hit.ts but has no PLAN or contract rationale. KiCad selects any visible copper and only uses the active layer as a tie-break. S3. · evidence: [029-click-top-trace-bcu-active](../evidence/shots/vf2a/dark/029-click-top-trace-bcu-active.png), [030-click-top-trace-fcu-active](../evidence/shots/vf2a/dark/030-click-top-trace-fcu-active.png), vf2a/crop-trace-select.png

</details>


## T-171

**S15 export refusals (6+ layers, blind/buried vias) surface as a developer sentence under a DRC gate and 'Export anyway' box; Download is silently disabled, the offending via can't be found from the dialog, and nothing warns earlier**

- Severity **S3** · category error-handling · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: F2B-008

**Summary.** Both cases: the dialog still runs DRC and leads with 'DRC found 23x error(s) …' + an 'Export anyway (ignore DRC errors)' checkbox, then the options (with a checked 'Include inner copper layers (4-layer boards only)' even on 6 layers), then a red box with the raw problem detail — 'OpenPCB's Gerber export writes at most four copper layers; this board has more and cannot be manufactured from this export' / 'OpenPCB's d…

**Root cause.** `src/modules/designer/backend/export/index.ts:58` — 422 export-unsupported-via-type (viaIds) / :72 layer count

**Proposed fix.** Export refusal copy in user terms + reason next to disabled Download. — Detail: Throw a typed ProblemError from fetchData (type/title/detail/extensions); in PcbExportDialog branch on export-unsupported-layer-count / -via-type: dedicated blocking panel with count/span and a 'Show on board' button that closes the dialog and selects/zooms viaIds; hide the DRC gate and option checkboxes; set the button title. Check layerCount > 4 / non-through vias client-side to skip the DRC run; add a warning line to the import review and Board ▸ Stackup.

**Evidence.** [055-6L-export-422](../evidence/shots/f2b/dark/055-6L-export-422.png), [017-6L-export-422](../evidence/shots/vf2b/light/017-6L-export-422.png)

<details><summary>F2B-008 — S15 export refusals (6+ layers, blind/buried vias) surface as a developer sentence under a DRC gate and 'Export anyway' box; Download is silently disabled, the offending via can't be found from the dialog, and nothing warns earlier (S3, confirmed)</summary>

- Area designer.pcb · stack B · design 315789a0-b31c-48d7-bd36-b48cc3d3c593 · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, QA-f2b-6L → PCB → Export…; wait for DRC + preview; tick 'Export anyway (ignore DRC errors)'; hover the button
  2. QA-f2b-blind (4-layer with one '(via blind (layers F.Cu In1.Cu))') → PCB → Export…
- Expected: The dialog leads with the blocking reason in user terms and an action — '6 copper layers: OpenPCB exports at most 4. Reduce the stackup or export from KiCad' / '1 blind via (F.Cu–In1.Cu) can't be drilled from this export — [Show via]' using the problem's layerCount / viaIds — hides irrelevant options (DRC ack, inner-layer checkbox), explains the disabled button, and the limitation is flagged before the user gets here (import review, Board ▸ Stackup, DRC).
- Actual: Both cases: the dialog still runs DRC and leads with 'DRC found 23x error(s) …' + an 'Export anyway (ignore DRC errors)' checkbox, then the options (with a checked 'Include inner copper layers (4-layer boards only)' even on 6 layers), then a red box with the raw problem detail — 'OpenPCB's Gerber export writes at most four copper layers; this board has more and cannot be manufactured from this export' / 'OpenPCB's drill export writes through drills only; blind/buried/micro vias cannot be manufactured from this export' (no count, no layer span, no next step, no full stop). The 422 carries layerCount 6 / viaIds ['2383deb3…'], but the dialog discards them — no 'show via' action; the via is only findable by scrolling the DRC list to 'Via type cannot be manufactured 1' (after 176 via-size errors), and even that message says 'JLCPCB 2-layer offers through-hole vias only; its drill depth is not evaluated' on a 4-layer board. Ticking 'Export anyway' relabels the still-disabled button 'Export anyway' with title='' (no reason on hover). The intro still promises 'a ZIP ready for JLCPCB / PCBWay upload'. The preflight does pre-block (summary → 422, Download disabled) but logs a console error. Import review ('Copper layers 6', 'PCB vias 44') and Board ▸ Stackup never mention either limitation.
- Screenshots: [055-6L-export-422](../evidence/shots/f2b/dark/055-6L-export-422.png), [056-6L-export-422-ack](../evidence/shots/f2b/dark/056-6L-export-422-ack.png), [055-6L-export-422](../evidence/shots/f2b/light/055-6L-export-422.png), [077-blind-export-422](../evidence/shots/f2b/dark/077-blind-export-422.png), [077-blind-export-422](../evidence/shots/f2b/light/077-blind-export-422.png), [076-blind-drc-jump](../evidence/shots/f2b/dark/076-blind-drc-jump.png)
- Console: `[ERROR] Failed to load resource: the server responded with a status of 422 (Unprocessable Entity) @ …/designs/315789a0…/exports/gerber?format=summary`
- Network: `POST /designs/315789a0…/exports/gerber?format=summary → 422 {title:'Unsupported layer count', layerCount:6}`; `POST /designs/60743616…/exports/gerber?format=summary → 422 {type:…/export-unsupported-via-type, title:'Unsupported via type', viaIds:['2383deb3-ae8a-4819-9967-65bb1e7f581c']}`
- Code: `src/modules/designer/backend/export/index.ts:58` — 422 export-unsupported-via-type (viaIds) / :72 layer count
- Code: `src/modules/designer/frontend/api.ts:90` — fetchData keeps only problem.detail → Error(message); structured fields lost
- Code: `src/modules/designer/frontend/pcb/PcbExportDialog.tsx:273` — summaryError rendered verbatim; DRC gate + checkboxes still shown; no title for this disabled case
- Suggested fix: Throw a typed ProblemError from fetchData (type/title/detail/extensions); in PcbExportDialog branch on export-unsupported-layer-count / -via-type: dedicated blocking panel with count/span and a 'Show on board' button that closes the dialog and selects/zooms viaIds; hide the DRC gate and option checkboxes; set the button title. Check layerCount > 4 / non-through vias client-side to skip the DRC run; add a warning line to the import review and Board ▸ Stackup.
- Verification (vf2b): **confirmed** — Reproduced on QA-f2b-6L (light) and QA-f2b-blind (dark): the dialog runs DRC and leads with 'DRC found 230/231 error(s)...' + 'Export anyway (ignore DRC errors)', shows the checked 'Include inner copper layers (4-layer boards only)' even on 6 layers, then the raw detail in a red box ('OpenPCB's Gerber export writes at most four copper layers; ...' / 'OpenPCB's drill export writes through drills only; ...'), Download ZIP disabled. Ticking 'Export anyway' relabels the disabled button 'Export anyway' with no title. Console logs the 422 of ?format=summary. The DRC marker on the blind via reads 'Via type "blind" cannot be manufactured: ... JLCPCB 2-layer offers through-hole vias only' on a 4-layer board. Fail-closed refusal itself is intended (contract 15 section 7.1 made the refusal 'readable'), so only the UX quality is at issue; S3 kept. · evidence: [017-6L-export-422](../evidence/shots/vf2b/light/017-6L-export-422.png), [018-6L-export-422-ack](../evidence/shots/vf2b/light/018-6L-export-422-ack.png), [016-blind-export-422](../evidence/shots/vf2b/dark/016-blind-export-422.png), [014-blind-via-zoom](../evidence/shots/vf2b/dark/014-blind-via-zoom.png)

</details>


## T-172

**Layer tab strip overflows (4+ layers at 1440, 2 layers at 1100); canvas squeezed to 458 px at 1100**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: F2B-009, Q4-041

**Summary.** The two Mid-Layer tabs add 170 px: tablist scrollWidth 923 vs clientWidth 798 at 1440, so 'Drill Holes' is clipped mid-word at the canvas edge (1139 px) and the PcbSideModeButton ('Viewing Top', 1174–1258 px) lives inside the same overflow-x scroller with a hidden scrollbar → invisible and mouse-unreachable unless the user discovers horizontal wheel-scrolling. On 2-layer boards the same strip fits and shows 'Viewing… | Also covers: Q4-041: At the 1100×720 minimum window the PCB canvas is squeezed to 458 px; layer tab strip over…

**Root cause.** `src/modules/designer/frontend/pcb/PcbLayerTabStrip.tsx:83` — overflow-x-auto with scrollbarWidth none; side-mode button rendered inside the scroller after flex-1 spacer

**Proposed fix.** Layer tab strip overflow menu/chevrons; flip button pinned; refit on canvas resize. Narrow-window dock collapse = proposal P2. — Detail: Render the side-mode button outside the scrolling tablist (sibling, shrink-0); add edge fades + chevron buttons (or a '…' overflow menu) when scrollWidth > clientWidth; consider short labels (In1/In2) for inner layers.

**Evidence.** [063-strip-2L-vs-6L-1440](../evidence/shots/f2b/dark/063-strip-2L-vs-6L-1440.png), [002-blind-pcb-open](../evidence/shots/vf2b/dark/002-blind-pcb-open.png), [012-1100-pcb](../evidence/shots/q4/light/012-1100-pcb.png)

<details><summary>F2B-009 — On 4+-layer boards the layer tab strip overflows even at 1440×900: 'Drill H…' is cut and the 'Viewing Top/Bottom' flip button is pushed out of view, with no overflow cue (S3, confirmed)</summary>

- Area designer.pcb · stack B · design 315789a0-b31c-48d7-bd36-b48cc3d3c593 · themes dark · viewports 1440x900, 1100x720
- Repro:
  1. Stack B, open QA-f2b-4L or QA-f2b-6L → PCB at 1440×900 (right dock open, default sidebar)
  2. Look at the bottom layer tab strip; compare with QA-f2b-2L
  3. Resize to 1100×720
- Expected: All tabs and the 'Viewing Top' side toggle remain reachable: the toggle pinned outside the scroller, and an overflow chevron/menu (or compact labels 'F.Cu / In1 / In2 / B.Cu') when tabs don't fit.
- Actual: The two Mid-Layer tabs add 170 px: tablist scrollWidth 923 vs clientWidth 798 at 1440, so 'Drill Holes' is clipped mid-word at the canvas edge (1139 px) and the PcbSideModeButton ('Viewing Top', 1174–1258 px) lives inside the same overflow-x scroller with a hidden scrollbar → invisible and mouse-unreachable unless the user discovers horizontal wheel-scrolling. On 2-layer boards the same strip fits and shows 'Viewing Top' at the right. At 1100×720 clientWidth is 458: everything after 'Top Overlay' is hidden (Q4-041 reported the 2-layer 1100 case only).
- Screenshots: [063-strip-2L-vs-6L-1440](../evidence/shots/f2b/dark/063-strip-2L-vs-6L-1440.png), [062-6L-1440-strip](../evidence/shots/f2b/dark/062-6L-1440-strip.png), [011-4L-pcb](../evidence/shots/f2b/dark/011-4L-pcb.png), [061-6L-1100-route](../evidence/shots/f2b/dark/061-6L-1100-route.png)
- Console: `1440: {sw:923, cw:798, stripRight:1139, viewBtn:[1174,1258], 'Drill Holes':1091-1168}`; `1100: {sw:923, cw:458}`
- Code: `src/modules/designer/frontend/pcb/PcbLayerTabStrip.tsx:83` — overflow-x-auto with scrollbarWidth none; side-mode button rendered inside the scroller after flex-1 spacer
- Suggested fix: Render the side-mode button outside the scrolling tablist (sibling, shrink-0); add edge fades + chevron buttons (or a '…' overflow menu) when scrollWidth > clientWidth; consider short labels (In1/In2) for inner layers.
- Verification (vf2b): **confirmed** — Measured on QA-f2b-blind (4-layer) at 1440x900: layer tablist scrollWidth 923 vs clientWidth 798, overflow-x auto with scrollbar-width none, 'Drill Holes' tab spans 1091-1168 against a strip edge at 1139 (clipped 'Drill H'), and the 'Viewing Top' side button lies inside the same scroller at 1174-1258 - invisible and unreachable by mouse. On the 2-layer QA-f2b-2L the same strip fits and 'Viewing Top' is visible. At 1100x720 (4L): scrollWidth 923 vs clientWidth 458. Same component and root cause family as Q4-041 (1100x720, 2-layer); this adds the primary 1440 viewport on multilayer boards and the side-mode button trapped in the scroller - fix together with Q4-041. · evidence: [002-blind-pcb-open](../evidence/shots/vf2b/dark/002-blind-pcb-open.png), [001-2L-pcb](../evidence/shots/vf2b/dark/001-2L-pcb.png), [011-4L-routing-1100](../evidence/shots/vf2b/dark/011-4L-routing-1100.png)

</details>

<details><summary>Q4-041 — At the 1100×720 minimum window the PCB canvas is squeezed to 458 px; layer tab strip overflows with a hidden scroll and the board is not re-fitted (S3, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes light · viewports 1100x720
- Repro:
  1. Dual LED Blinker → PCB with the right dock open (DRC or Properties) at 1440×900, board fitted
  2. Resize the window to 1100×720
- Expected: Canvas keeps the majority of the width (side panels shrink to their minimums or the dock auto-collapses), layer strip collapses into an overflow menu, camera re-fits on resize
- Actual: Left sidebar 260 px + dock 300 px leave a 458×612 canvas (42% of the window); the board stays at the old zoom and is cropped on both sides; the layer tab strip (sw 755 / cw 458) silently scrolls horizontally, cutting 'Top Court…' mid-word with no fade/chevron; Components VALUE column truncated.
- Screenshots: [012-1100-pcb](../evidence/shots/q4/light/012-1100-pcb.png), [010-1100-drc-dock](../evidence/shots/q4/light/010-1100-drc-dock.png), [006-1100-pcb](../evidence/shots/vq4/light/006-1100-pcb.png), [047-1100-pcb](../evidence/shots/vq4/dark/047-1100-pcb.png)
- Console: `overflow: DIV.flex h-[22px] overflow-x-auto sw=755 cw=458 @341,676`
- Code: `src/modules/designer/frontend/pcb/PcbLayerTabStrip.tsx:1` — overflow-x-auto strip without overflow affordance
- Suggested fix: Below ~1280 px default the dock to collapsed or clamp dock+sidebar to ≤40% of width; add an overflow chevron/menu to PcbLayerTabStrip; call cameraControls.fit() on canvas resize when the user hasn't panned/zoomed since the last fit.
- Verification (vq4): **confirmed** — Reproduced at 1100×720 (light and dark): canvas 458 px wide; layer tab strip scrollWidth 755 / clientWidth 458 with no overflow affordance ('Top Court' clipped); board not re-fitted after resize (light). The dock/sidebar widths follow PLAN D7/D10 defaults (300/260); the missing overflow affordance and re-fit are the defects. · evidence: [006-1100-pcb](../evidence/shots/vq4/light/006-1100-pcb.png), [047-1100-pcb](../evidence/shots/vq4/dark/047-1100-pcb.png)

</details>


## T-173

**At 1100×720 on a 4-layer board the route parameter row pushes the live route status (length, clear/N conflicts, warnings) off-screen; 'Standard 4L' wraps onto two lines**

- Severity **S3** · category visual · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: F2B-010

**Summary.** With the 4L-only 'In1↔In2' layer-pair select added, the Route status region spans 946–1454 px in a 1100 px window: 'via 0.60/0.30', length, 'clear'/'N conflicts' and '1 warning' are all beyond the viewport (only 'Net GND 0.20 mm · netc' visible). The 'Standard 4L' via-preset chip wraps to two lines at both 1100 and 1440 while routing; at 1440 the status also runs to the window edge ('2 conflicts 8…' cut). Same famil…

**Root cause.** `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:892` — LayerPairSelect added for layerCount ≥ 4 into the same non-wrapping row

**Proposed fix.** Route param row: live status pinned right, presets truncate before status. — Detail: Give the route row a two-zone layout: fixed parameter chips (whitespace-nowrap) + a status zone that truncates low-priority parts (netclass text, via summary) first and always keeps conflicts/clear visible; or mirror conflicts into the status bar.

**Evidence.** [065-4L-1100-routing](../evidence/shots/f2b/dark/065-4L-1100-routing.png), [011-4L-routing-1100](../evidence/shots/vf2b/dark/011-4L-routing-1100.png)

<details><summary>F2B-010 — At 1100×720 on a 4-layer board the route parameter row pushes the live route status (length, clear/N conflicts, warnings) off-screen; 'Standard 4L' wraps onto two lines (S3, confirmed)</summary>

- Area designer.pcb · stack B · design 2a4c5318-4bea-4e32-841b-2750b998e9d4 · themes dark · viewports 1100x720, 1440x900
- Repro:
  1. Stack B, QA-f2b-4L → PCB, window 1100×720 → Zoom to fit
  2. R, click the GND via at (146.0, 140.0) to start routing, move the cursor
- Expected: The row keeps the safety-relevant status (conflicts/'clear') visible — lower-priority chips collapse or the status moves to its own line/status bar — and chips never wrap internally.
- Actual: With the 4L-only 'In1↔In2' layer-pair select added, the Route status region spans 946–1454 px in a 1100 px window: 'via 0.60/0.30', length, 'clear'/'N conflicts' and '1 warning' are all beyond the viewport (only 'Net GND 0.20 mm · netc' visible). The 'Standard 4L' via-preset chip wraps to two lines at both 1100 and 1440 while routing; at 1440 the status also runs to the window edge ('2 conflicts 8…' cut). Same family as Q4-042 (2-layer, 'Standard 2L').
- Screenshots: [065-4L-1100-routing](../evidence/shots/f2b/dark/065-4L-1100-routing.png), [022-4L-routing-In1](../evidence/shots/f2b/dark/022-4L-routing-In1.png), [024-4L-after-V2](../evidence/shots/f2b/dark/024-4L-after-V2.png)
- Console: `Route status @1100: Net 946-966, GND 976-996, '0.20 mm · netclass Default' 1006-1196, via 1206-1292, '5.6 mm' 1302-1341, 'clear' 1351-1384, '1 warning' 1394-1454 (viewport 1100)`
- Code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:892` — LayerPairSelect added for layerCount ≥ 4 into the same non-wrapping row
- Suggested fix: Give the route row a two-zone layout: fixed parameter chips (whitespace-nowrap) + a status zone that truncates low-priority parts (netclass text, via summary) first and always keeps conflicts/clear visible; or mirror conflicts into the status bar.
- Verification (vf2b): **confirmed** — Measured on QA-f2b-4L while routing GND: at 1100x720 the Route status items sit at Net 946-966 ... '2 conflicts' 1351-1424, '1 warning' 1434-1493 (row scrollWidth 1413 vs clientWidth 1020), so only 'Net GND 0.20 mm . netc' is visible and the conflicts count is off-screen; at 1440x900 the '1 warning' chip ends at 1454 (clipped at the window edge). The 'Standard 4L' via-preset chip wraps to two lines inside a 20 px chip at both widths (screenshots 008/011). Related to the route-row sub-symptom mentioned in Q4-042 (2-layer, 1100) but this is the only finding that owns the route-row overflow as its primary problem; kept S3. · evidence: [011-4L-routing-1100](../evidence/shots/vf2b/dark/011-4L-routing-1100.png), [008-4L-route-command-failed](../evidence/shots/vf2b/dark/008-4L-route-command-failed.png), [010-4L-routing-GND-1440](../evidence/shots/vf2b/dark/010-4L-routing-GND-1440.png), vf2b/route-geom.js

</details>


## T-174

**No trace/via inspector: selecting a via or trace shows only 'Contents · Vias 1' — a blind via (F.Cu–In1.Cu) looks and inspects exactly like a through via; type, span, size, net and width are nowhere**

- Severity **S3** · category stub · status confirmed · themes dark
- Recommendation **decide** · decision P4 · owner D3 · wave proposal · scope proposal · estimate M
- Findings: F2B-011

**Summary.** The blind via renders identically to a through via (same green-yellow ring, black drill). Selecting it gives the generic 'Selection · 1 item selected · CONTENTS Vias 1' panel and status 'Via'; selecting a trace gives 'Traces 1' / 'Trace'. There is no way to learn the via type, span, diameter/drill or net (nor a trace's net/width/layer) from the UI; the Selection filter even describes vias as 'Through-hole vias'. The…

**Root cause.** `src/modules/designer/frontend/pcb/PcbPropertiesPanel.tsx:358` — traces/vias always fall through to the counts-only branch

**Proposed fix.** Trace/via inspector (net, width, layer span, via type) — needs backend edit commands. — Detail: Add ViaPanel and TracePanel to PcbPropertiesPanel's single-selection switch (read-only first: type, span, Ø/drill, net, class; width, layer, length) with edit via existing commands; render non-through vias with a split two-colour annulus and a type badge at zoom; rename the filter description to 'Vias'.

**Evidence.** [073-blind-vs-through](../evidence/shots/f2b/dark/073-blind-vs-through.png), [014-blind-via-zoom](../evidence/shots/vf2b/dark/014-blind-via-zoom.png)

<details><summary>F2B-011 — No trace/via inspector: selecting a via or trace shows only 'Contents · Vias 1' — a blind via (F.Cu–In1.Cu) looks and inspects exactly like a through via; type, span, size, net and width are nowhere (S3, confirmed)</summary>

- Area designer.pcb · stack B · design 60743616-5236-45e6-a8fd-1195e3107cbf · themes dark · viewports 1440x900
- Repro:
  1. Stack B, QA-f2b-blind (KiCad 4-layer import with one '(via blind (layers F.Cu In1.Cu))' at 156.75, 132.5) → PCB, zoom to D1
  2. Compare the blind via with the through via at 158.75, 141.25
  3. Click the via (a click hits the trace first, Q4-016) → press F, keep only 'Vias', click it again
  4. Read the Properties dock and status bar; also select any trace
- Expected: Like KiCad/Altium: a via inspector (type through/blind/buried/micro, layer span, Ø/drill, net, tenting) and a trace inspector (net, layer, width, length), both editable; blind/buried vias drawn distinctly (e.g. split ring coloured by the two span layers).
- Actual: The blind via renders identically to a through via (same green-yellow ring, black drill). Selecting it gives the generic 'Selection · 1 item selected · CONTENTS Vias 1' panel and status 'Via'; selecting a trace gives 'Traces 1' / 'Trace'. There is no way to learn the via type, span, diameter/drill or net (nor a trace's net/width/layer) from the UI; the Selection filter even describes vias as 'Through-hole vias'. The export 422 lists the via by id only, so a user cannot verify which via is blind or fix it (no 'convert to through' action).
- Screenshots: [073-blind-vs-through](../evidence/shots/f2b/dark/073-blind-vs-through.png), [075-blind-via-selected](../evidence/shots/f2b/dark/075-blind-via-selected.png), [006-2L-trace-selected](../evidence/shots/f2b/dark/006-2L-trace-selected.png)
- Network: `GET /designs/60743616…/projection/pcb → via 2383deb3… viaType 'blind', fromLayer F.Cu, toLayer In1.Cu, 0.6/0.3, netName 'Net-(D1-K)'`
- Code: `src/modules/designer/frontend/pcb/PcbPropertiesPanel.tsx:358` — traces/vias always fall through to the counts-only branch
- Code: `src/modules/designer/frontend/pcb/PcbSelectionFilter.tsx:29` — hint 'Through-hole vias'
- Code: `src/sdks/designer/types.ts:2287` — no trace/via property-update command exists (INVALID_PCB_TRACE/VIA only for add)
- Suggested fix: Add ViaPanel and TracePanel to PcbPropertiesPanel's single-selection switch (read-only first: type, span, Ø/drill, net, class; width, layer, length) with edit via existing commands; render non-through vias with a split two-colour annulus and a type badge at zoom; rename the filter description to 'Vias'.
- Verification (vf2b): **confirmed** — Reproduced: on QA-f2b-blind the blind via 2383deb3 (F.Cu-In1.Cu) at 156.75,132.5 renders identically to the through /RST via at 155.25,131.75 (same ring and drill, only its DRC marker differs); a selected trace shows only '1 item selected . Selection . Contents Traces 1' with no net/width/layer. PcbPropertiesPanel.tsx:358-380 sends every trace/via selection to the counts-only branch, and there is no command to edit trace width/net or via size/type (only pcb_update_trace_geometry / delete), so an editable inspector needs backend commands. Severity lowered S2 -> S3: this is a missing capability, not a regression - PLAN D8 defines the PCB Properties content without trace/via panels (multi/other -> 'count + kinds'), nothing that exists is broken, and the analogous gap for power ports (Q3-022) was kept S3. Category changed to stub. · evidence: [014-blind-via-zoom](../evidence/shots/vf2b/dark/014-blind-via-zoom.png), [015-blind-via-boxselect](../evidence/shots/vf2b/dark/015-blind-via-boxselect.png)

</details>


## T-175

**Light theme: status-danger text on the danger-soft box fails AA — export refusal / DRC-gate text #c2402f on #dececf is 3.3:1**

- Severity **S3** · category a11y · status confirmed · themes light
- Recommendation **fix-now** · owner F0a · wave F0a · scope frontend · estimate XS
- Findings: F2B-013

**Summary.** The 12 px error line 'OpenPCB's Gerber export writes at most four copper layers…' and the 'DRC found 230 error(s)…' block render #c34333 (--status-danger #c2402f) on #dececf (--status-danger-soft 12% over --surface-raised #e2e2e5): 3.32:1. The raised dialog surface in light (#e2e2e5) is darker than the app surface, which pulls every tinted status box below AA.

**Root cause.** `src/modules/designer/frontend/pcb/PcbExportDialog.tsx:224` — border-status-danger bg-status-danger-soft text-status-danger text-xs

**Proposed fix.** Light theme: darken --status-danger text or lighten --status-danger-soft so danger text on soft box ≥4.5:1 (same for warning). — Detail: Darken light --status-danger for text use (e.g. a --status-danger-text ≈ #a3301f, ≥4.5:1 on soft tint over surface-raised) or render the message in --text-strong with a red icon/left border.

**Evidence.** [055-6L-export-422](../evidence/shots/f2b/light/055-6L-export-422.png), [017-6L-export-422](../evidence/shots/vf2b/light/017-6L-export-422.png)

<details><summary>F2B-013 — Light theme: status-danger text on the danger-soft box fails AA — export refusal / DRC-gate text #c2402f on #dececf is 3.3:1 (S3, confirmed)</summary>

- Area designer.pcb · stack B · design 315789a0-b31c-48d7-bd36-b48cc3d3c593 · themes light · viewports 1440x900
- Repro:
  1. Light theme, stack B, QA-f2b-6L (or QA-f2b-blind / any board with DRC errors) → PCB → Export…
  2. Probe the red error box text vs its background
- Expected: Body text in status boxes ≥ 4.5:1 (12 px text).
- Actual: The 12 px error line 'OpenPCB's Gerber export writes at most four copper layers…' and the 'DRC found 230 error(s)…' block render #c34333 (--status-danger #c2402f) on #dececf (--status-danger-soft 12% over --surface-raised #e2e2e5): 3.32:1. The raised dialog surface in light (#e2e2e5) is darker than the app surface, which pulls every tinted status box below AA.
- Screenshots: [055-6L-export-422](../evidence/shots/f2b/light/055-6L-export-422.png), [077-blind-export-422](../evidence/shots/f2b/light/077-blind-export-422.png)
- Pixel probes: {"file": "shots/f2b/light/055-6L-export-422.png", "x": 503, "y": 565, "hex": "#dececf", "nearestToken": "--status-danger-soft@app", "deltaE": 5.4}; {"file": "shots/f2b/light/055-6L-export-422.png", "x": 700, "y": 450, "hex": "#e2e2e5", "nearestToken": "--surface-raised", "deltaE": 0.0}; {"file": "shots/vf2b/light/017-6L-export-422.png", "x": 503, "y": 565, "hex": "#dececf", "nearestToken": "--status-danger-soft@app", "deltaE": 5.4}; {"file": "shots/vf2b/light/017-6L-export-422.png", "x": 700, "y": 470, "hex": "#e2e2e5", "nearestToken": "--surface-raised", "deltaE": 0.0}
- Code: `src/modules/designer/frontend/pcb/PcbExportDialog.tsx:224` — border-status-danger bg-status-danger-soft text-status-danger text-xs
- Code: `src/core/frontend/src/index.css:228` — light --status-danger #c2402f; line 197 --surface-raised #e2e2e5
- Suggested fix: Darken light --status-danger for text use (e.g. a --status-danger-text ≈ #a3301f, ≥4.5:1 on soft tint over surface-raised) or render the message in --text-strong with a red icon/left border.
- Verification (vf2b): **confirmed** — Re-probed [017-6L-export-422](../evidence/shots/vf2b/light/017-6L-export-422.png): both red boxes have background #dececf (--status-danger-soft over --surface-raised #e2e2e5, probe dE 5.4 / 0.0); the darkest text pixel #c2402f/#c34333 gives 3.40:1 / 3.32:1, and typical anti-aliased glyph pixels only 2.8-3.0:1 - below the 4.5:1 AA minimum for 12 px text. Token math agrees: #c2402f on 12% #c2402f over #e2e2e5 (= #decfcf) is 3.42:1. Cross-cutting token pair, not specific to this dialog. · evidence: [017-6L-export-422](../evidence/shots/vf2b/light/017-6L-export-422.png), [018-6L-export-422-ack](../evidence/shots/vf2b/light/018-6L-export-422-ack.png)

</details>


## T-176

**Cloud layout dialogs: signed-out dead end, developer error copy, no focus management**

- Severity **S3** · category error-handling · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: Q10-005, Q10-012

**Summary.** Both dialogs immediately POST to the backend (401) and display the developer message 'Cloud sign-in required: x-cloud-bearer header missing' in a red box. Auto-route offers only 'Cancel'; Auto-place has no buttons besides ×. Console: 'Failed to load resource: 401 (Unauthorized)'. In release builds cloud.auth + cloud.autolayout are 'all', so every signed-out user who tries these buttons sees an HTTP header name. | Also covers: Q10-012: Auto Layout dialog: signed-out notice is a dead end (no Sign in action); aria-modal dialo…

**Root cause.** `src/modules/designer/frontend/pcb/PcbCanvas.tsx:6259` — PcbAutoplaceDialog mounted without signedIn (AutoLayoutDialog gets signedIn at :6254)

**Proposed fix.** Route Board/Auto Place get signedIn gate like Auto Layout; signed-out notice with 'Sign in' action; dialog focus + aria-pressed segments. — Detail: Pass signedIn={Boolean(props.autoLayoutSignedIn)} to PcbAutorouteDialog and PcbAutoplaceDialog; when false render the same 'Sign in to OpenPCB Cloud to use Route Board / Auto Place' notice with a 'Sign in…' button calling useNavigationStore.openSettings('account'), and skip the submit effect. Change requireCloudBearer's message to user copy ('Sign in to OpenPCB Cloud to use this feature.').

**Evidence.** [022-C1-autolayout-signedout](../evidence/shots/q10/dark/022-C1-autolayout-signedout.png), [001-pcb-signedout](../evidence/shots/vq10/dark/001-pcb-signedout.png), [004-autolayout-signedout](../evidence/shots/vq10/dark/004-autolayout-signedout.png)

<details><summary>Q10-005 — Route Board… and Auto Place… run while signed out and show 'Cloud sign-in required: x-cloud-bearer header missing' (S3, confirmed)</summary>

- Area designer.pcb · stack C1 · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. Stack C1 (cloud flags on, signed out)
  2. Open 'Dual LED Blinker' → PCB tab (three floating buttons appear bottom-right: Auto Layout…, Route Board…, Auto Place…)
  3. Click 'Route Board…'
  4. Cancel, click 'Auto Place…'
- Expected: Same gate as 'Auto Layout…': no request is sent; the dialog explains that the feature needs an OpenPCB Cloud account and offers a 'Sign in' action (Settings → Account).
- Actual: Both dialogs immediately POST to the backend (401) and display the developer message 'Cloud sign-in required: x-cloud-bearer header missing' in a red box. Auto-route offers only 'Cancel'; Auto-place has no buttons besides ×. Console: 'Failed to load resource: 401 (Unauthorized)'. In release builds cloud.auth + cloud.autolayout are 'all', so every signed-out user who tries these buttons sees an HTTP header name.
- Screenshots: [022-C1-autolayout-signedout](../evidence/shots/q10/dark/022-C1-autolayout-signedout.png), [023-C1-routeboard-signedout](../evidence/shots/q10/dark/023-C1-routeboard-signedout.png), [024-C1-autoplace-signedout](../evidence/shots/q10/dark/024-C1-autoplace-signedout.png)
- Console: `[ERROR] Failed to load resource: 401 (Unauthorized) @ /api/modules/designer/designs/c2c58a19…/autoroute`
- Network: `POST /designs/c2c58a19…/autoroute → 401`; `POST /designs/c2c58a19…/autoplace → 401`
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:6259` — PcbAutoplaceDialog mounted without signedIn (AutoLayoutDialog gets signedIn at :6254)
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:6268` — PcbAutorouteDialog mounted without signedIn
- Code: `src/modules/designer/frontend/pcb/PcbAutorouteDialog.tsx:117` — submit effect runs on open unconditionally
- Code: `src/modules/designer/backend/routes.ts:184` — 'Cloud sign-in required: x-cloud-bearer header missing'
- Suggested fix: Pass signedIn={Boolean(props.autoLayoutSignedIn)} to PcbAutorouteDialog and PcbAutoplaceDialog; when false render the same 'Sign in to OpenPCB Cloud to use Route Board / Auto Place' notice with a 'Sign in…' button calling useNavigationStore.openSettings('account'), and skip the submit effect. Change requireCloudBearer's message to user copy ('Sign in to OpenPCB Cloud to use this feature.').
- Verification (vq10): **confirmed** — Reproduced signed out on C1: Route Board… immediately POSTs /autoroute → 401 and shows 'Cloud sign-in required: x-cloud-bearer header missing' with only Cancel; Auto Place… POSTs /autoplace → 401 and shows the same text with only ×. The sibling Auto Layout… correctly shows a sign-in notice without sending a request. Code: PcbCanvas mounts PcbAutoplaceDialog/PcbAutorouteDialog with no signedIn prop (only AutoLayoutDialog gets signedIn), and requireCloudBearer's message is developer copy. Severity lowered S2→S3: nothing is broken and sign-in is required anyway. The problem is the copy plus the missing sign-in gate/CTA, the same class as Q10-012 (S3). It ships (cloud.auth + cloud.autolayout are 'all'). · evidence: [001-pcb-signedout](../evidence/shots/vq10/dark/001-pcb-signedout.png), [002-routeboard-signedout](../evidence/shots/vq10/dark/002-routeboard-signedout.png), [003-autoplace-signedout](../evidence/shots/vq10/dark/003-autoplace-signedout.png), console: 401 (Unauthorized) @ /api/modules/designer/designs/c2c58a19…/autoroute

</details>

<details><summary>Q10-012 — Auto Layout dialog: signed-out notice is a dead end (no Sign in action); aria-modal dialog doesn't take focus; option segments lack aria-pressed (S3, confirmed)</summary>

- Area designer.pcb · stack C1 · design c2c58a19 · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. Stack C1, signed out, 'Dual LED Blinker' → PCB → 'Auto Layout…'
  2. Read the dialog; press Tab twice and check document.activeElement
  3. Sign in (simulated) and reopen; inspect Scope/Priority/Effort buttons
- Expected: Notice offers a 'Sign in…' button (→ Settings → Account). Opening the dialog moves focus into it and traps Tab (it declares aria-modal=true). Segmented options expose selection (aria-pressed or role=radio) and use the kit segmented control.
- Actual: Only text 'Sign in to OpenPCB Cloud to run Auto Layout.' + Close. Focus stays on the 'Auto Layout…' trigger; Tab goes to 'Auto Place…' behind the dialog (inDialog=false). Scope/Priority/Effort are plain buttons with no aria-pressed (selection is colour-only: solid --selection fill), a different look from the kit segmented controls used elsewhere (e.g. Layers 'Normal/Dim/Hide'); option buttons are 25 px and footer buttons 29 px vs 22 px kit height.
- Screenshots: [022-C1-autolayout-signedout](../evidence/shots/q10/dark/022-C1-autolayout-signedout.png), [022-C1-autolayout-signedout](../evidence/shots/q10/light/022-C1-autolayout-signedout.png), [050-C1-autolayout-signedin-idle](../evidence/shots/q10/dark/050-C1-autolayout-signedin-idle.png), [114-C1-autolayout-signedin-1100](../evidence/shots/q10/light/114-C1-autolayout-signedin-1100.png)
- Code: `src/modules/designer/frontend/pcb/autolayout/AutoLayoutDialog.tsx:168` — signed-out notice has no action
- Code: `src/modules/designer/frontend/pcb/autolayout/AutoLayoutDialog.tsx:145` — role=dialog aria-modal=true without initial focus/trap
- Code: `src/modules/designer/frontend/pcb/autolayout/AutoLayoutDialog.tsx:190` — option buttons without aria-pressed
- Suggested fix: Add a 'Sign in…' button calling useNavigationStore.getState().openSettings('account'); build the dialog on the kit Dialog (focus first control, trap, restore focus to trigger); replace the three button rows with the kit SegmentedControl (role=group + aria-pressed) at 22 px.
- Verification (vq10): **confirmed** — Reproduced: the signed-out Auto Layout dialog shows only the text 'Sign in to OpenPCB Cloud to run Auto Layout.' plus Close, with no sign-in action. On open, activeElement stays 'Auto Layout…' (inDialog=false) and two Tabs land on 'Auto Place…' behind the aria-modal=true dialog. Esc does close it (not claimed). Signed-in: Scope/Priority/Effort buttons have no aria-pressed/role and are 25 px, Close/Run 29 px (kit 22 px). Code matches (AutoLayoutDialog.tsx:145 role=dialog aria-modal with no focus management; :168 notice with no action). · evidence: [004-autolayout-signedout](../evidence/shots/vq10/dark/004-autolayout-signedout.png), [050-autolayout-signedin-idle](../evidence/shots/vq10/dark/050-autolayout-signedin-idle.png), [022-C1-autolayout-signedout](../evidence/shots/q10/light/022-C1-autolayout-signedout.png), dom: option buttons h=25 aria-pressed=null; footer h=29

</details>


## T-177

**Cloud layout entry points float over the canvas with shadows at 25 px, and the Auto-route/Auto-place panels cover the dock, layer strip, status bar and their own buttons; naming differs (Route Board… → 'Auto-route')**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: Q10-014

**Summary.** Buttons are 25 px tall with Tailwind shadow-sm (box-shadow 0 1px 3px rgba(0,0,0,.1)) floating over the board, the only floating canvas buttons in the app. The 'Auto-route' panel (fixed bottom-4 right-4, 360–420 px) at 1100×720 spans x 664–1084, y 534–704: it hides the Properties dock bottom, the layer tab strip, half of 'Route Board…' and the status bar's DRC count/selection. Title mismatch: button 'Route Board…' op…

**Root cause.** `src/modules/designer/frontend/pcb/PcbCanvas.tsx:6207` — absolute bottom-12 right-3 floating buttons, py-1 shadow-sm

**Proposed fix.** Flatten floating layout buttons (no shadow, kit size); anchor route/place panels inside canvas bounds. Toolbar relocation = proposal P3. — Detail: Move the three actions into PcbTopToolbar as a 'Layout ▾' dropdown (Auto Layout…, Route board…, Auto place…) using kit ToolbarButton; render the route/place panels as kit Dialogs or anchor them inside the canvas area above the layer strip (bottom offset ≥ layer strip + status bar); title them 'Route Board' / 'Auto Place' to match.

**Evidence.** [021-C1-pcb-autolayout-buttons](../evidence/shots/q10/dark/021-C1-pcb-autolayout-buttons.png), [001-pcb-signedout](../evidence/shots/vq10/dark/001-pcb-signedout.png)

<details><summary>Q10-014 — Cloud layout entry points float over the canvas with shadows at 25 px, and the Auto-route/Auto-place panels cover the dock, layer strip, status bar and their own buttons; naming differs (Route Board… → 'Auto-route') (S3, confirmed)</summary>

- Area designer.pcb · stack C1 · design c2c58a19 · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. Stack C1, 'Dual LED Blinker' → PCB
  2. Inspect the bottom-right 'Auto Layout… / Route Board… / Auto Place…' buttons
  3. Click 'Route Board…' (fails fast offline) at 1440×900 and at 1100×720
- Expected: Entry points in the PCB toolbar (or a toolbar 'Layout ▾' menu) at kit height with no drop shadow; result panels docked or modal without covering the status bar / dock; one name per feature.
- Actual: Buttons are 25 px tall with Tailwind shadow-sm (box-shadow 0 1px 3px rgba(0,0,0,.1)) floating over the board, the only floating canvas buttons in the app. The 'Auto-route' panel (fixed bottom-4 right-4, 360–420 px) at 1100×720 spans x 664–1084, y 534–704: it hides the Properties dock bottom, the layer tab strip, half of 'Route Board…' and the status bar's DRC count/selection. Title mismatch: button 'Route Board…' opens 'Auto-route'; 'Auto Place…' opens 'Auto-place'.
- Screenshots: [021-C1-pcb-autolayout-buttons](../evidence/shots/q10/dark/021-C1-pcb-autolayout-buttons.png), [023-C1-routeboard-signedout](../evidence/shots/q10/dark/023-C1-routeboard-signedout.png), [112-C1-pcb-1100](../evidence/shots/q10/light/112-C1-pcb-1100.png), [113-C1-pcb-routeboard-panel-1100](../evidence/shots/q10/light/113-C1-pcb-routeboard-panel-1100.png)
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:6207` — absolute bottom-12 right-3 floating buttons, py-1 shadow-sm
- Code: `src/modules/designer/frontend/pcb/PcbAutoplaceDialog.tsx:149` — fixed bottom-4 right-4 … shadow-2xl
- Code: `src/modules/designer/frontend/pcb/PcbAutorouteDialog.tsx:259` — same fixed placement
- Suggested fix: Move the three actions into PcbTopToolbar as a 'Layout ▾' dropdown (Auto Layout…, Route board…, Auto place…) using kit ToolbarButton; render the route/place panels as kit Dialogs or anchor them inside the canvas area above the layer strip (bottom offset ≥ layer strip + status bar); title them 'Route Board' / 'Auto Place' to match.
- Verification (vq10): **confirmed** — Measured all three buttons at 25 px with box-shadow 'rgba(0,0,0,.1) 0 1px 3px, 0 1px 2px -1px' (shadow-sm). At 1100×720 the Auto-route panel spans x664–1084, y534–704 and covers half of 'Route Board…' (x602–696, y603–628), the bottom of the Properties dock, the layer tab strip and the status bar's DRC count. Title mismatch (Route Board… → 'Auto-route', Auto Place… → 'Auto-place') confirmed. Correction: they are not the only floating canvas controls; the zoom cluster (+/−/fit) also floats top-right, but it is flat and kit-sized. Also seen: the Auto Layout and Auto-route panels can be open at the same time (top-right + bottom-right). · evidence: [001-pcb-signedout](../evidence/shots/vq10/dark/001-pcb-signedout.png), [005-routeboard-panel-1100](../evidence/shots/vq10/dark/005-routeboard-panel-1100.png), [052-routeboard-signedin-offline](../evidence/shots/vq10/dark/052-routeboard-signedin-offline.png), dom: buttons h=25, boxShadow shadow-sm; dialog rect [664,534,1084,704] at 1100×720

</details>


## T-178

**Ctrl+H activates the Hole tool instead of cycling the layer display mode**

- Severity **S3** · category keyboard · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate XS
- Findings: Q4-002

**Summary.** The Add button switches to 'Hole' (hole placement tool armed); the Display mode group stays at Normal (aria-pressed Normal:true). The Ctrl+H handler is unreachable because the plain-H hole handler runs first and has no ctrl/meta guard.

**Root cause.** `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4391` — H → hole tool, no !ctrlKey/!metaKey guard, returns early

**Proposed fix.** Plain-H branch ignores Ctrl/Meta so Ctrl+H cycles display mode. — Detail: In PcbCanvas onKey (PcbCanvas.tsx:4390) add `!event.ctrlKey && !event.metaKey && !event.altKey` to the plain H branch (and to P/T/M at :4478/:4490/:4500, which lack it too) so the Ctrl/⌘+H display-mode cycle at :4931 is reachable.

**Evidence.** [006-ctrl-h](../evidence/shots/q4/dark/006-ctrl-h.png), [002-ctrl-h](../evidence/shots/vq4/dark/002-ctrl-h.png)

<details><summary>Q4-002 — Ctrl+H activates the Hole tool instead of cycling the layer display mode (S3, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. Open 'Dual LED Blinker' → PCB view, nothing selected, Select tool
  2. Hover the 'Normal/Dim/Hide' display-mode buttons: tooltip says 'Display mode: … (Ctrl+H)'
  3. Press Ctrl+H over the canvas
- Expected: Inactive-layer display mode cycles Normal → Dim → Hide (KiCad Ctrl+H) and no tool changes
- Actual: The Add button switches to 'Hole' (hole placement tool armed); the Display mode group stays at Normal (aria-pressed Normal:true). The Ctrl+H handler is unreachable because the plain-H hole handler runs first and has no ctrl/meta guard.
- Screenshots: [006-ctrl-h](../evidence/shots/q4/dark/006-ctrl-h.png), [002-ctrl-h](../evidence/shots/vq4/dark/002-ctrl-h.png)
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4391` — H → hole tool, no !ctrlKey/!metaKey guard, returns early
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4932` — Ctrl+H display-mode cycle never reached
- Code: `src/modules/designer/frontend/pcb/PcbLayersPanel.tsx:647` — tooltip advertises Ctrl+H
- Suggested fix: In PcbCanvas onKey (PcbCanvas.tsx:4390) add `!event.ctrlKey && !event.metaKey && !event.altKey` to the plain H branch (and to P/T/M at :4478/:4490/:4500, which lack it too) so the Ctrl/⌘+H display-mode cycle at :4931 is reachable.
- Verification (vq4): **confirmed** — Reproduced: Ctrl+H over the canvas arms the Hole tool (Add button -> 'Hole', aria-pressed) and display mode stays Normal. PcbCanvas.tsx:4390-4399 plain-H branch has no ctrl/meta guard and returns before the Ctrl+H cycle at :4931. Severity lowered to S3: only the advertised shortcut is wrong; the Normal/Dim/Hide buttons work. · evidence: [002-ctrl-h](../evidence/shots/vq4/dark/002-ctrl-h.png)

</details>


## T-179

**Status-bar hint shows 'Click to select…' while Hole/Pad/Text/Zone/Keepout/Tune/Cutout tools are armed**

- Severity **S3** · category copy · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: Q4-003

**Summary.** Hint stays 'Click to select · Shift+click to add · drag to box-select' for hole, pad, text, zone, keepout, zone-cutout and tune tools (only route/measure/board-shape have hints). Zone/keepout/text selections also summarise as a generic '1 selected'. Tune puts its hint in a separate floating status instead.

**Root cause.** `src/modules/designer/frontend/pcb/PcbCanvas.tsx:5474` — statusHint only handles route/measure/boardShape/placement

**Proposed fix.** Status hint per active tool (Hole/Pad/Text/Zone/Keepout/Tune/Cutout). — Detail: Add HINT_* strings for hole/pad/text/zone/keepout/zoneHole/tune/bundle/comment tool modes in statusHint, and zone/keepout cases in statusSelectionSummary ('Zone · GND · F.Cu').

**Evidence.** [007-zone-mode](../evidence/shots/q4/dark/007-zone-mode.png), [002-ctrl-h](../evidence/shots/vq4/dark/002-ctrl-h.png)

<details><summary>Q4-003 — Status-bar hint shows 'Click to select…' while Hole/Pad/Text/Zone/Keepout/Tune/Cutout tools are armed (S3, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. PCB view, nothing selected
  2. Press H (or P, T, Z, K, U, Shift+Z with a zone selected)
  3. Read the status-bar hint
- Expected: Tool-specific hint, e.g. 'Click on the board to place a 3.2 mm hole · Esc exit', 'Click to place vertices · Enter close · Esc cancel'
- Actual: Hint stays 'Click to select · Shift+click to add · drag to box-select' for hole, pad, text, zone, keepout, zone-cutout and tune tools (only route/measure/board-shape have hints). Zone/keepout/text selections also summarise as a generic '1 selected'. Tune puts its hint in a separate floating status instead.
- Screenshots: [007-zone-mode](../evidence/shots/q4/dark/007-zone-mode.png), [016-zone-cutout-mode](../evidence/shots/q4/dark/016-zone-cutout-mode.png), [002-ctrl-h](../evidence/shots/vq4/dark/002-ctrl-h.png)
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:5474` — statusHint only handles route/measure/boardShape/placement
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:5534` — zones/keepouts fall through to '1 selected'
- Suggested fix: Add HINT_* strings for hole/pad/text/zone/keepout/zoneHole/tune/bundle/comment tool modes in statusHint, and zone/keepout cases in statusSelectionSummary ('Zone · GND · F.Cu').
- Verification (vq4): **confirmed** — Reproduced: with the Hole tool armed (Ctrl+H/H) the status bar still reads 'Click to select · Shift+click to add · drag to box-select'. statusHint (PcbCanvas.tsx:5475-5496) only handles route/measure/boardShape/single placement; statusSelectionSummary has no zone/keepout/text cases. · evidence: [002-ctrl-h](../evidence/shots/vq4/dark/002-ctrl-h.png)

</details>


## T-180

**Route refusal notices show raw DRC codes (NET_SHORT_CIRCUIT, COPPER_OFF_BOARD…) and a developer tooltip**

- Severity **S3** · category copy · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate XS
- Findings: Q4-005

**Summary.** 'Via blocked: NET_SHORT_CIRCUIT' and 'Via blocked: COPPER_OFF_BOARD, COPPER_TO_BOARD_EDGE'; warning chip tooltip reads 'Reported by DRC but never blocking (contract 07 §6)'. 'Commit blocked: 4 DRC conflicts' also stays stale after the live count drops to 3 and never says which items conflict.

**Root cause.** `src/modules/designer/frontend/pcb/PcbCanvas.tsx:549` — violationCodeList returns raw DRC codes (used by Via blocked / Commit rejected / Reshape rejected notices)

**Proposed fix.** Map DRC codes to drc-labels in refusal notices; drop developer tooltip. — Detail: Map codes through drc-labels (DRC_LABELS[code] ?? code) in violationCodeList; rewrite the RouteHud warning title; recompute the commit-blocked notice from the live conflict count.

**Evidence.** [028-route-via](../evidence/shots/q4/dark/028-route-via.png), [021-via-blocked2](../evidence/shots/vq4/dark/021-via-blocked2.png)

<details><summary>Q4-005 — Route refusal notices show raw DRC codes (NET_SHORT_CIRCUIT, COPPER_OFF_BOARD…) and a developer tooltip (S3, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. PCB → R, click J1 pin, place a corner
  2. Hover over copper of another net (or near the board edge) and press V
  3. Read the notice row; hover the '4 warnings' text in the route status
- Expected: Human wording from drc-labels ('Via blocked: short circuit with R4.1 (Net_5)', 'too close to board edge'); tooltip 'Warnings are reported by DRC but do not block the commit'
- Actual: 'Via blocked: NET_SHORT_CIRCUIT' and 'Via blocked: COPPER_OFF_BOARD, COPPER_TO_BOARD_EDGE'; warning chip tooltip reads 'Reported by DRC but never blocking (contract 07 §6)'. 'Commit blocked: 4 DRC conflicts' also stays stale after the live count drops to 3 and never says which items conflict.
- Screenshots: [028-route-via](../evidence/shots/q4/dark/028-route-via.png), [029-route-via2](../evidence/shots/q4/dark/029-route-via2.png), [038-route-to-pad](../evidence/shots/q4/dark/038-route-to-pad.png), [021-via-blocked2](../evidence/shots/vq4/dark/021-via-blocked2.png)
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:549` — violationCodeList returns raw DRC codes (used by Via blocked / Commit rejected / Reshape rejected notices)
- Code: `src/modules/designer/frontend/pcb/RouteHud.tsx:181` — title 'Reported by DRC but never blocking (contract 07 §6)'
- Code: `src/modules/designer/frontend/pcb/drc/drc-labels.ts:20` — human labels available
- Suggested fix: Map codes through drc-labels (DRC_LABELS[code] ?? code) in violationCodeList; rewrite the RouteHud warning title; recompute the commit-blocked notice from the live conflict count.
- Verification (vq4): **confirmed** — Reproduced: pressing V over another net's pad while routing shows 'Via blocked: NET_SHORT_CIRCUIT'; warning chip title is 'Reported by DRC but never blocking (contract 07 §6)'. violationCodeList (PcbCanvas.tsx:549-551) joins raw codes; used at :1747, :2133, :2148, :2442, :2558. · evidence: [021-via-blocked2](../evidence/shots/vq4/dark/021-via-blocked2.png)

</details>


## T-181

**PCB status-bar zoom readout is frozen (shows the schematic's zoom, never updates on PCB)**

- Severity **S3** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D1 · wave W2 · scope frontend · estimate S
- Findings: Q4-006

**Summary.** Always 'zoom 80%' regardless of PCB zoom (value is the Space-level zoomPercent set only by SchematicCanvas onZoomChange; PcbCanvas never reports zoom).

**Root cause.** `src/modules/designer/frontend/Space.tsx:1202` — only SchematicCanvas wires onZoomChange={setZoomPercent}

**Proposed fix.** Status-bar zoom reads the active canvas camera (PCB vs schematic). — Detail: Add onZoomChange to PcbCanvas (report camera.zoom → % from the viewport/camera change handler) and keep a per-view zoom state in Space.

**Evidence.** [043-drc-click-violation](../evidence/shots/q4/dark/043-drc-click-violation.png), [003-zoomed-readout](../evidence/shots/vq4/dark/003-zoomed-readout.png)

<details><summary>Q4-006 — PCB status-bar zoom readout is frozen (shows the schematic's zoom, never updates on PCB) (S3, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. Open design, PCB view: status bar shows 'zoom 80%'
  2. Mouse-wheel zoom, click 'Zoom in' twice, or click a DRC violation (auto-zooms ~5x)
  3. Read status bar zoom
- Expected: Zoom % tracks the PCB camera
- Actual: Always 'zoom 80%' regardless of PCB zoom (value is the Space-level zoomPercent set only by SchematicCanvas onZoomChange; PcbCanvas never reports zoom).
- Screenshots: [043-drc-click-violation](../evidence/shots/q4/dark/043-drc-click-violation.png), [044-zoomed-in-readout](../evidence/shots/q4/dark/044-zoomed-in-readout.png), [003-zoomed-readout](../evidence/shots/vq4/dark/003-zoomed-readout.png)
- Code: `src/modules/designer/frontend/Space.tsx:1202` — only SchematicCanvas wires onZoomChange={setZoomPercent}
- Code: `src/modules/designer/frontend/Space.tsx:1598` — PCB status bar uses the same zoomPercent
- Suggested fix: Add onZoomChange to PcbCanvas (report camera.zoom → % from the viewport/camera change handler) and keep a per-view zoom state in Space.
- Verification (vq4): **confirmed** — Reproduced: after zooming ~10x on the PCB the status bar still reads 'zoom 80%' (value left over from the schematic). Only SchematicCanvas wires onZoomChange (Space.tsx:1202); PCB status bar reads the same zoomPercent state (Space.tsx:444, :1584). · evidence: [003-zoomed-readout](../evidence/shots/vq4/dark/003-zoomed-readout.png)

</details>


## T-182

**PCB toolbar dropdowns (Add, View, width, via) have no menu semantics or keyboard support; Esc does not close them**

- Severity **S3** · category a11y · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: Q4-007

**Summary.** Esc leaves the menu open (Add and View verified), ArrowDown does nothing (focus stays on trigger). Add trigger has no aria-expanded/aria-haspopup, menus are plain divs of buttons, trigger buttons use outline-none so there is no focus ring. (Tooltip copy → Q4-051; Measure/Tune entry points → Q4-035.)

**Root cause.** `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:139` — useOutsideClose handles mousedown only

**Proposed fix.** Toolbar dropdowns (Add/View/width/via) -> kit DropdownMenu (menu semantics, Esc, arrows). — Detail: Reuse the kit Menu/Dropdown (with Esc, arrow roving focus, role=menu) for AddDropdown, ViewToggleDropdown, WidthDropdown, ViaSizeDropdown; add Esc to useOutsideClose; add 'Measure (M)' and 'Tune length (U)' entries to a Tools/Add menu.

**Evidence.** [002-add-menu](../evidence/shots/q4/dark/002-add-menu.png), [026-add-menu-after-esc](../evidence/shots/vq4/dark/026-add-menu-after-esc.png)

<details><summary>Q4-007 — PCB toolbar dropdowns (Add, View, width, via) have no menu semantics or keyboard support; Esc does not close them (S3, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. PCB view: click 'Add' (or 'View', or the W width chip while routing)
  2. Press Escape
  3. Press ArrowDown
- Expected: Menu closes on Esc and focus returns to the trigger; arrows move between items; trigger exposes aria-haspopup/aria-expanded; items are role=menuitem(checkbox)
- Actual: Esc leaves the menu open (Add and View verified), ArrowDown does nothing (focus stays on trigger). Add trigger has no aria-expanded/aria-haspopup, menus are plain divs of buttons, trigger buttons use outline-none so there is no focus ring. (Tooltip copy → Q4-051; Measure/Tune entry points → Q4-035.)
- Screenshots: [002-add-menu](../evidence/shots/q4/dark/002-add-menu.png), [003-view-menu](../evidence/shots/q4/dark/003-view-menu.png), [026-add-menu-after-esc](../evidence/shots/vq4/dark/026-add-menu-after-esc.png)
- Code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:139` — useOutsideClose handles mousedown only
- Code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:481` — Add trigger: no aria-haspopup/expanded, outline-none
- Suggested fix: Reuse the kit Menu/Dropdown (with Esc, arrow roving focus, role=menu) for AddDropdown, ViewToggleDropdown, WidthDropdown, ViaSizeDropdown; add Esc to useOutsideClose; add 'Measure (M)' and 'Tune length (U)' entries to a Tools/Add menu.
- Verification (vq4): **confirmed** — Reproduced: Add menu stays open after Escape, ArrowDown leaves focus on the trigger, Add trigger has no aria-expanded/aria-haspopup and uses outline-none. Tooltip-copy and Measure/Tune discoverability sub-points overlap Q4-051 and Q4-035 (kept there); this finding is the menu-semantics/keyboard part. · evidence: [026-add-menu-after-esc](../evidence/shots/vq4/dark/026-add-menu-after-esc.png)

</details>


## T-183

**Via size shown in three different orders/symbols (preset list drill/diameter vs chips Ø diameter ⌀ drill vs status diameter/drill)**

- Severity **S3** · category consistency · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate XS
- Findings: Q4-009

**Summary.** Preset list order is drill/diameter, status is diameter/drill; the two chips differ only by Ø (U+00D8) vs ⌀ (U+2300), visually almost identical — users cannot tell which chip is drill without hovering. 'Net-class default (0.80 mm)' wraps to two lines in the dropdown.

**Root cause.** `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:231` — ViaSizeDropdown

**Proposed fix.** One via notation everywhere: 'Ø0.60 / 0.30 drill' (diameter first). — Detail: Label chips 'Via 0.80' and 'Drill 0.40' (text, not glyphs) and render preset rows as 'Ø0.80 / drill 0.40' matching the status order.

**Evidence.** [045-via-preset-dd](../evidence/shots/q4/dark/045-via-preset-dd.png), [025-via-preset-dd](../evidence/shots/vq4/dark/025-via-preset-dd.png)

<details><summary>Q4-009 — Via size shown in three different orders/symbols (preset list drill/diameter vs chips Ø diameter ⌀ drill vs status diameter/drill) (S3, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. Start routing
  2. Open the via preset dropdown: rows read 'Standard 2L 0.40 / 0.80 mm' (drill / diameter)
  3. Compare chips 'Ø 0.80 mm' (diameter) and '⌀ 0.40 mm' (drill) and the status 'via 0.80/0.40' (diameter/drill)
- Expected: One consistent order and explicit labels (e.g. 'Pad 0.80 · Drill 0.40')
- Actual: Preset list order is drill/diameter, status is diameter/drill; the two chips differ only by Ø (U+00D8) vs ⌀ (U+2300), visually almost identical — users cannot tell which chip is drill without hovering. 'Net-class default (0.80 mm)' wraps to two lines in the dropdown.
- Screenshots: [045-via-preset-dd](../evidence/shots/q4/dark/045-via-preset-dd.png), [046-via-dia-dd](../evidence/shots/q4/dark/046-via-dia-dd.png), [025-via-preset-dd](../evidence/shots/vq4/dark/025-via-preset-dd.png), [019-routing](../evidence/shots/vq4/dark/019-routing.png)
- Code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:231` — ViaSizeDropdown
- Suggested fix: Label chips 'Via 0.80' and 'Drill 0.40' (text, not glyphs) and render preset rows as 'Ø0.80 / drill 0.40' matching the status order.
- Verification (vq4): **confirmed** — Reproduced: via preset rows read 'Standard 2L 0.40 / 0.80 mm' (drill/diameter), chips 'Ø 0.80 mm' / '⌀ 0.40 mm', route status 'via 0.80/0.40' (diameter/drill). · evidence: [025-via-preset-dd](../evidence/shots/vq4/dark/025-via-preset-dd.png), [019-routing](../evidence/shots/vq4/dark/019-routing.png)

</details>


## T-184

**Flipping to bottom view mirrors about the world origin, pushing the board half off-screen**

- Severity **S3** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate XS
- Findings: Q4-010

**Summary.** Board jumps right and is clipped by the dock at x≈1139 (right third of the board invisible); user has to press Fit. The button label is abbreviated 'Viewing Bot'.

**Root cause.** `src/modules/designer/frontend/pcb/PcbCanvas.tsx:2685` — setViewSide without camera compensation

**Proposed fix.** Flip view mirrors about board centre, keeping board centred. — Detail: When toggling viewSide, negate camera.position.x (mirror the camera about the scene X axis) so the same world region stays centred; label 'Viewing Bottom'.

**Evidence.** [050-bottom-view](../evidence/shots/q4/dark/050-bottom-view.png), [044-before-flip](../evidence/shots/vq4/dark/044-before-flip.png)

<details><summary>Q4-010 — Flipping to bottom view mirrors about the world origin, pushing the board half off-screen (S3, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. PCB view, Zoom to fit (board centred)
  2. Click 'Viewing Top' in the layer strip (or press Shift+F)
- Expected: View mirrors about the current view centre (or re-fits), so the board stays where it was on screen
- Actual: Board jumps right and is clipped by the dock at x≈1139 (right third of the board invisible); user has to press Fit. The button label is abbreviated 'Viewing Bot'.
- Screenshots: [050-bottom-view](../evidence/shots/q4/dark/050-bottom-view.png), [052-shiftF-bottom-again](../evidence/shots/q4/dark/052-shiftF-bottom-again.png), [044-before-flip](../evidence/shots/vq4/dark/044-before-flip.png), [045-bottom-view](../evidence/shots/vq4/dark/045-bottom-view.png)
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:2685` — setViewSide without camera compensation
- Code: `src/modules/designer/frontend/pcb/PcbSideModeButton.tsx:19` — 'Viewing Bot' label
- Suggested fix: When toggling viewSide, negate camera.position.x (mirror the camera about the scene X axis) so the same world region stays centred; label 'Viewing Bottom'.
- Verification (vq4): **confirmed** — Reproduced: Shift+F on the fitted Dual LED Blinker moves the board right; its right third is hidden behind the dock; the button label reads 'Viewing Bot'. handleToggleViewSide (PcbCanvas.tsx:2684) only flips viewSide with no camera compensation; label at PcbSideModeButton.tsx:19. · evidence: [044-before-flip](../evidence/shots/vq4/dark/044-before-flip.png), [045-bottom-view](../evidence/shots/vq4/dark/045-bottom-view.png)

</details>


## T-185

**Inactive-layer display mode 'Normal' dims other layers to 22% once a layer is focused; 'Normal' and 'Dim' look identical**

- Severity **S3** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate XS
- Findings: Q4-013

**Summary.** After any layer focus, Normal renders B.Cu at #0c1d3a (22% opacity) and Dim at #0a172d (16%) — practically indistinguishable, and very different from the initial Normal (#2667dc). Flipped parts on the inactive side are near-black (#000107) and easily lost.

**Root cause.** `src/modules/designer/frontend/pcb/pcb-visual-state.ts:30` — mode = hasLayerFocus ? (solo ? 'solo' : 'dim') : 'normal' — displayMode 'normal' maps to 'dim'

**Proposed fix.** 'Normal' leaves inactive layers undimmed; 'Dim' dims — distinct. — Detail: Map displayMode 'normal' to visual mode 'normal' (opacity 1, maybe 0.85 for non-active copper) regardless of layer focus; keep 'dim' ~0.35 so the two are distinguishable.

**Evidence.** [001-pcb-initial](../evidence/shots/q4/dark/001-pcb-initial.png), [001-pcb](../evidence/shots/vq4/dark/001-pcb.png)

<details><summary>Q4-013 — Inactive-layer display mode 'Normal' dims other layers to 22% once a layer is focused; 'Normal' and 'Dim' look identical (S3, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. Open design → PCB: bottom traces bright blue (#2667dc)
  2. Click any layer row / layer tab (e.g. 'Bottom Copper' then 'Top Copper')
  3. Display mode still shows 'Normal' pressed; probe a B.Cu trace
  4. Click 'Dim' and probe again
- Expected: 'Normal' renders inactive layers at full strength (as on first open); 'Dim' visibly dims them
- Actual: After any layer focus, Normal renders B.Cu at #0c1d3a (22% opacity) and Dim at #0a172d (16%) — practically indistinguishable, and very different from the initial Normal (#2667dc). Flipped parts on the inactive side are near-black (#000107) and easily lost.
- Screenshots: [001-pcb-initial](../evidence/shots/q4/dark/001-pcb-initial.png), [073-fit-allcopper](../evidence/shots/q4/dark/073-fit-allcopper.png), [074-dim-probe](../evidence/shots/q4/dark/074-dim-probe.png), [072-after-flip-allcopper](../evidence/shots/q4/dark/072-after-flip-allcopper.png), [001-pcb](../evidence/shots/vq4/dark/001-pcb.png), [012-normal-after-focus](../evidence/shots/vq4/dark/012-normal-after-focus.png), [013-dim](../evidence/shots/vq4/dark/013-dim.png)
- Pixel probes: {"file": "shots/vq4/dark/001-pcb.png", "x": 900, "y": 326, "hex": "#fa1014", "nearestToken": "--net-power", "deltaE": 31.2}; {"file": "shots/vq4/dark/012-normal-after-focus.png", "x": 900, "y": 326, "hex": "#3b0a0e", "nearestToken": "--status-danger-soft@app", "deltaE": 19.0}; {"file": "shots/vq4/dark/013-dim.png", "x": 900, "y": 326, "hex": "#2c090d", "nearestToken": "--status-danger-soft@app", "deltaE": 12.3}
- Code: `src/modules/designer/frontend/pcb/pcb-visual-state.ts:30` — mode = hasLayerFocus ? (solo ? 'solo' : 'dim') : 'normal' — displayMode 'normal' maps to 'dim'
- Code: `src/modules/designer/frontend/pcb/pcb-visual-state.ts:45` — 0.16 vs 0.22
- Suggested fix: Map displayMode 'normal' to visual mode 'normal' (opacity 1, maybe 0.85 for non-active copper) regardless of layer focus; keep 'dim' ~0.35 so the two are distinguishable.
- Verification (vq4): **confirmed** — Reproduced with pixel probes: first-open Normal F.Cu trace #fa1014; after a layer focus (focus stuck on B.Cu) with 'Normal' pressed the same trace is #3b0a0e; with 'Dim' #2c090d, so Normal and Dim look almost the same. pcb-visual-state.ts:30-49 maps displayMode normal to mode 'dim' (0.22) whenever activeLayer focus exists vs dim 0.16. · evidence: [001-pcb](../evidence/shots/vq4/dark/001-pcb.png), [012-normal-after-focus](../evidence/shots/vq4/dark/012-normal-after-focus.png), [013-dim](../evidence/shots/vq4/dark/013-dim.png)

</details>


## T-186

**PCB empty-canvas context menu advertises 'X' for route mode (real key R) and overflows the viewport bottom**

- Severity **S3** · category copy · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate XS
- Findings: Q4-015 · known ref K15
- Depends on: ['T-024']

**Summary.** Item reads 'Enter route mode X' (X does nothing; R is the route hotkey). Menu is 210 px tall at y=720 → bottom 930 > 900 viewport; the last item 'Add comment' is clipped off-screen. The clamp estimates height from ENABLED items × 32 px, but disabled items ('Top layer (F.Cu)', 'Clear selection') also take space. 'Hide ratsnest' shows no ⇧B shortcut.

**Root cause.** `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4150` — shortcut: "X"

**Proposed fix.** Context menu shows R for route; viewport clamping via F0b menu fix. — Detail: shortcut 'R' (and '⇧B' for ratsnest); clamp using the rendered menu's getBoundingClientRect in a layout effect (or count all items + separators).

**Evidence.** [079-ctx-empty](../evidence/shots/q4/dark/079-ctx-empty.png), [027-ctx-empty](../evidence/shots/vq4/dark/027-ctx-empty.png)

<details><summary>Q4-015 — PCB empty-canvas context menu advertises 'X' for route mode (real key R) and overflows the viewport bottom (S3, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. PCB view, Select tool, nothing selected
  2. Right-click empty canvas near the bottom (e.g. 700,760 at 1440x900)
- Expected: 'Enter route mode  R'; menu fully inside the viewport
- Actual: Item reads 'Enter route mode X' (X does nothing; R is the route hotkey). Menu is 210 px tall at y=720 → bottom 930 > 900 viewport; the last item 'Add comment' is clipped off-screen. The clamp estimates height from ENABLED items × 32 px, but disabled items ('Top layer (F.Cu)', 'Clear selection') also take space. 'Hide ratsnest' shows no ⇧B shortcut.
- Screenshots: [079-ctx-empty](../evidence/shots/q4/dark/079-ctx-empty.png), [027-ctx-empty](../evidence/shots/vq4/dark/027-ctx-empty.png)
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4150` — shortcut: "X"
- Code: `src/core/frontend/src/components/AppContextMenu.tsx:17` — menuHeight = enabledCount * 32 + 12 ignores disabled items/separators
- Suggested fix: shortcut 'R' (and '⇧B' for ratsnest); clamp using the rendered menu's getBoundingClientRect in a layout effect (or count all items + separators).
- Verification (vq4): **confirmed** — Reproduced: right-click at (700,760) shows 'Enter route mode  X'; menu top 720 bottom 930 > 900 viewport (last item clipped). AppContextMenu.tsx:17/:45-51 clamps using enabledCount*32+12 (disabled items 'Bottom layer (B.Cu)', 'Clear selection' ignored); shortcut literal 'X' at PcbCanvas.tsx:4149. · evidence: [027-ctx-empty](../evidence/shots/vq4/dark/027-ctx-empty.png)

</details>


## T-187

**Raw internal net/item IDs shown to users (status bar 'Trace · 51272803:15620728', DRC list 'trace 4f0646 ↔ net -10160 ↔ net -10277')**

- Severity **S3** · category copy · status confirmed · themes dark
- Recommendation **fix-now** · owner D3+D1 · wave W2 · scope frontend · estimate S
- Findings: Q4-017

**Summary.** Coordinate-derived net ids and 6-char entity hashes are the primary text of violation rows and the status-bar selection summary; the severity filter buttons are named only by their counts ('13', '6', '0').

**Root cause.** `src/modules/designer/frontend/pcb/PcbCanvas.tsx:5503` — netLabel falls back to raw netId

**Proposed fix.** Display names for anonymous nets/items ('Net-(R4-1)', 'Trace on F.Cu') in status bar and DRC list. — Detail: Generate display names for anonymous nets (from the first pad: 'Net-(R4-1)') in the projection's netNames; format DRC item refs via a shared describeItem() (kind + ref/pad + net name); give severity toggles aria-labels 'Errors 13' etc.

**Evidence.** [042-drc-dock](../evidence/shots/q4/dark/042-drc-dock.png), [029-drc-dock](../evidence/shots/vq4/dark/029-drc-dock.png)

<details><summary>Q4-017 — Raw internal net/item IDs shown to users (status bar 'Trace · 51272803:15620728', DRC list 'trace 4f0646 ↔ net -10160 ↔ net -10277') (S3, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. PCB: click a trace/via on a net without a schematic name → status bar shows 'Trace · 51272803:15620728' / 'Via · 51272803:15620728'
  2. Open the DRC dock tab: rows read 'trace 4f0646 ↔ trace a6aea0', 'trace 1ff5f8 ↔ R4.1 ↔ net -10160 ↔ net -10277'
- Expected: Human names: 'Trace · Net_7 · F.Cu · 0.25 mm', 'Track (Net_3) ↔ R4 pad 1 (GND)'; unnamed nets get a stable readable name ('Net-(R4-Pad1)' like KiCad)
- Actual: Coordinate-derived net ids and 6-char entity hashes are the primary text of violation rows and the status-bar selection summary; the severity filter buttons are named only by their counts ('13', '6', '0').
- Screenshots: [042-drc-dock](../evidence/shots/q4/dark/042-drc-dock.png), [090-overlap-picker](../evidence/shots/q4/dark/090-overlap-picker.png), [029-drc-dock](../evidence/shots/vq4/dark/029-drc-dock.png), [016-ctx-via](../evidence/shots/vq4/dark/016-ctx-via.png)
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:5503` — netLabel falls back to raw netId
- Suggested fix: Generate display names for anonymous nets (from the first pad: 'Net-(R4-1)') in the projection's netNames; format DRC item refs via a shared describeItem() (kind + ref/pad + net name); give severity toggles aria-labels 'Errors 13' etc.
- Verification (vq4): **confirmed** — Reproduced: status bar 'Trace · -117449:10160000' / 'Trace · 51272803:15620728'; DRC dock rows 'trace 4f0646 ↔ net 508000 ↔ net 512728 ↔ Net_8 ↔ Net_11' with message 'unassigned trace bridges nets 5080000:32000000, 51272803:15620728…'; severity toggles named '32', '74', '0'. netLabel falls back to raw netId (PcbCanvas.tsx:5503). · evidence: [029-drc-dock](../evidence/shots/vq4/dark/029-drc-dock.png), [016-ctx-via](../evidence/shots/vq4/dark/016-ctx-via.png)

</details>


## T-188

**Cmd/Ctrl+A on PCB selects nothing on the board and instead text-highlights the entire app chrome**

- Severity **S3** · category keyboard · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: Q4-018 · known ref K18

**Summary.** Status bar stays 'No selection'; the browser's native select-all highlights every label in the rail, tabs, layers panel, component list and properties (window.getSelection() = 'Home Designer Library …'). Related: pressing Esc to close any canvas context menu also clears the current selection (right-click U1 → Esc → 'No selection').

**Root cause.** `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4340` — keymap has no Cmd/Ctrl+A branch

**Proposed fix.** Cmd/Ctrl+A selects all board items (respect selection filter); preventDefault text selection. — Detail: Add Cmd/Ctrl+A → select all visible, unlocked items passing the selection filter (preventDefault); add `select-none` to the designer shell (keep text selectable in inputs); stopPropagation of Esc in AppContextMenu so the canvas doesn't also clear selection.

**Evidence.** [092-cmd-a](../evidence/shots/q4/dark/092-cmd-a.png), [028-cmd-a](../evidence/shots/vq4/dark/028-cmd-a.png)

<details><summary>Q4-018 — Cmd/Ctrl+A on PCB selects nothing on the board and instead text-highlights the entire app chrome (S3, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. PCB view, hover canvas, nothing focused
  2. Press Cmd+A (or Ctrl+A)
- Expected: All board items selected (schematic editor supports Cmd+A); app chrome is user-select:none
- Actual: Status bar stays 'No selection'; the browser's native select-all highlights every label in the rail, tabs, layers panel, component list and properties (window.getSelection() = 'Home Designer Library …'). Related: pressing Esc to close any canvas context menu also clears the current selection (right-click U1 → Esc → 'No selection').
- Screenshots: [092-cmd-a](../evidence/shots/q4/dark/092-cmd-a.png), [091-ctx-placement](../evidence/shots/q4/dark/091-ctx-placement.png), [028-cmd-a](../evidence/shots/vq4/dark/028-cmd-a.png)
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4340` — keymap has no Cmd/Ctrl+A branch
- Suggested fix: Add Cmd/Ctrl+A → select all visible, unlocked items passing the selection filter (preventDefault); add `select-none` to the designer shell (keep text selectable in inputs); stopPropagation of Esc in AppContextMenu so the canvas doesn't also clear selection.
- Verification (vq4): **confirmed** — Reproduced: Cmd+A over the PCB leaves 'No selection' and the browser selection becomes 'Home Designer Library Docs Assistant Schem PCB 3D BOM DRC Local…'. No Cmd/Ctrl+A branch in the keymap (PcbCanvas.tsx:4340-5049). Related sub-point confirmed: Esc on a canvas context menu also cleared the selection. · evidence: [028-cmd-a](../evidence/shots/vq4/dark/028-cmd-a.png)

</details>


## T-189

**Comment mode: PCB 'C' hotkey advertised but dead; Esc doesn't exit; drafts discarded silently**

- Severity **S3** · category keyboard · status confirmed · themes dark
- Recommendation **fix-now** · owner D3+D2 · wave W2 · scope frontend · estimate S
- Findings: Q4-020, Q5-027 · known ref K14

**Summary.** No C handler in the PCB keymap; comment mode is not cleared by Esc; composer opens without focus. | Also covers: Q5-027: Comment mode is sticky: Esc doesn't leave it (schematic or PCB), PCB 'C' shortcut adverti…

**Root cause.** `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:463` — hotkey: 'C' advertised

**Proposed fix.** Build PCB C comment hotkey; Esc exits comment mode (PCB + schematic); discarding a non-empty draft asks. — Detail: Add C (no modifiers) → props.onToggleCommentMode(); on Escape with commentMode → exit; autoFocus the composer textarea.

**Note.** Binding: build PCB C comment hotkey.

**Evidence.** [093-pcb-comment](../evidence/shots/q4/dark/093-pcb-comment.png), [026-add-menu-after-esc](../evidence/shots/vq4/dark/026-add-menu-after-esc.png), [060-schem-comment-mode](../evidence/shots/q5/dark/060-schem-comment-mode.png)

<details><summary>Q4-020 — PCB Add menu advertises 'Comment  C' but C does nothing, and Esc does not exit the Comment tool (S3, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. PCB view, hover canvas, press C → nothing (Add button stays 'Add')
  2. Add ▾ → Comment → toolbar shows 'Comment' pressed
  3. Press Esc (focus on body) → tool stays 'Comment'; only re-picking Add ▾ → Comment turns it off
  4. After placing a pin the composer is not focused (activeElement BODY) so typing goes to the board hotkeys
- Expected: C toggles the comment tool (as on schematic), Esc exits it, composer autofocuses
- Actual: No C handler in the PCB keymap; comment mode is not cleared by Esc; composer opens without focus.
- Screenshots: [093-pcb-comment](../evidence/shots/q4/dark/093-pcb-comment.png), [098-state](../evidence/shots/q4/dark/098-state.png), [026-add-menu-after-esc](../evidence/shots/vq4/dark/026-add-menu-after-esc.png)
- Code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:463` — hotkey: 'C' advertised
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4340` — no 'c' branch; Esc branch does not call onToggleCommentMode
- Suggested fix: Add C (no modifiers) → props.onToggleCommentMode(); on Escape with commentMode → exit; autoFocus the composer textarea.
- Verification (vq4): **confirmed** — Reproduced: C over the canvas does nothing (Add stays 'Add'); after Add -> Comment, Esc with body focus leaves 'Comment' pressed. No 'c' branch and the Escape branch never touches comment mode (PcbCanvas.tsx:4340-5049). PLAN §9 lists the Comment (C) hotkey as a known follow-up; still a user-visible defect. Overlaps Q5-027 (K14) and Q5-025 (composer autofocus) in other files. · evidence: [026-add-menu-after-esc](../evidence/shots/vq4/dark/026-add-menu-after-esc.png)

</details>

<details><summary>Q5-027 — Comment mode is sticky: Esc doesn't leave it (schematic or PCB), PCB 'C' shortcut advertised but dead; Esc/click-away silently discard drafts (S3, confirmed)</summary>

- Area designer.comments · stack A · design 370447e2-d91e-43f1-b0a5-e7dc9f6bcafe · themes dark · viewports 1440x900
- Repro:
  1. Schem: press C (button pressed), blur, press Esc → button still pressed
  2. PCB (fresh reload): press C, click board → no composer (K14)
  3. PCB: Add ▾ → Comment, press Esc, click board → composer opens again; toolbar shows 'Comment' pressed and clicking it only reopens the Add menu
  4. Type a reply draft, press Esc (or click the canvas) → popup closes; reopen → reply box empty
- Expected: Esc cancels the comment tool like every other tool; C toggles it on PCB as the menu label 'Comment C' promises; drafts are kept (or confirmation asked) when the popup closes.
- Actual: Schematic Escape handler has no commentMode branch; PCB keymap has no C binding; both keep the crosshair comment mode until C/menu toggles it or a comment is posted. Composer and reply drafts are dropped without warning on Esc or any outside mousedown. Status-bar hint stays 'Click to select · Shift+click to add · drag to box-select' in comment mode.
- Screenshots: [060-schem-comment-mode](../evidence/shots/q5/dark/060-schem-comment-mode.png), [082-pcb-comment-mode-toolbar](../evidence/shots/q5/dark/082-pcb-comment-mode-toolbar.png)
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:1745` — Escape branch excludes commentMode
- Code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:467` — hotkey 'C' label with no keymap entry
- Code: `src/modules/designer/frontend/components/comments/CommentThreadPopup.tsx:197` — Esc closes, body state lost
- Suggested fix: Add commentMode to both Escape handlers (close draft first, then exit mode); bind C in the PCB keymap; keep composer/reply text in the comments hook keyed by thread id (or confirm discard); show a comment-mode hint ('Click to place a comment · Esc to exit').
- Verification (vq5): **confirmed** — Reproduced: schematic C -> Esc leaves 'Comment' pressed (SchematicCanvas.tsx:1745-1756 Escape branch has no commentMode case). PCB: 'c' does nothing (K14; PcbTopToolbar.tsx:467 advertises 'C', no keymap entry); after Add -> Comment, 2x Esc closed the composer and cleared the selection but a board click opened a new composer (mode sticky); clicking the pressed 'Comment' toolbar button only reopens the Add menu. Status-bar hint stays 'Click to select · Shift+click to add · drag to box-select' in comment mode. Composer/reply bodies are local state of the popups, discarded on Esc/click-away (code). PLAN §9 lists the PCB Comment hotkey as a known follow-up; still unfixed. · evidence: [022-pcb-comment-mode-sticky-after-esc](../evidence/shots/vq5/dark/022-pcb-comment-mode-sticky-after-esc.png), snapshot: schematic 'Comment' [pressed] after C + Escape

</details>


## T-190

**Board panel buttons use raw Unicode glyphs ('✏ Draw custom shape', '⭳ Import DXF…'); ⭳ renders as a tofu box**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate XS
- Findings: Q4-029

**Summary.** Text glyphs '✏' and '⭳' are embedded in the label; U+2B73 has no glyph in the UI font and renders as an empty box ('▯ Import DXF…'); the glyphs also end up in the accessible names ('⭳ Import DXF…'). Dashed-border button style is unique to this panel.

**Root cause.** `src/modules/designer/frontend/pcb/PcbBoardPanel.tsx:309` — ✏ Draw custom shape / ⭳ Import DXF… (also 228, 236, 317)

**Proposed fix.** Replace ✏/⭳ glyphs with Lucide icons in kit Buttons. — Detail: Replace with kit Button variant=secondary size=sm icon={<Pencil/>} / icon={<FileUp/>}; remove glyphs from labels.

**Evidence.** [120-shape-Oval](../evidence/shots/q4/dark/120-shape-Oval.png), [040-board-edit](../evidence/shots/vq4/dark/040-board-edit.png)

<details><summary>Q4-029 — Board panel buttons use raw Unicode glyphs ('✏ Draw custom shape', '⭳ Import DXF…'); ⭳ renders as a tofu box (S3, confirmed)</summary>

- Area designer.pcb · stack A · design 5909d519 · themes dark, light · viewports 1440x900
- Repro:
  1. PCB, nothing selected → Properties → Board → Edit
  2. Look at the dashed 'Draw custom shape' / 'Import DXF…' buttons (and 'Redraw shape' for a custom outline)
- Expected: Lucide icons (Pencil / FileInput) at 12px like every other kit button
- Actual: Text glyphs '✏' and '⭳' are embedded in the label; U+2B73 has no glyph in the UI font and renders as an empty box ('▯ Import DXF…'); the glyphs also end up in the accessible names ('⭳ Import DXF…'). Dashed-border button style is unique to this panel.
- Screenshots: [120-shape-Oval](../evidence/shots/q4/dark/120-shape-Oval.png), [134-ctx-corner](../evidence/shots/q4/dark/134-ctx-corner.png), [040-board-edit](../evidence/shots/vq4/dark/040-board-edit.png), [040-board-edit-crop](../evidence/shots/vq4/dark/040-board-edit-crop.png)
- Code: `src/modules/designer/frontend/pcb/PcbBoardPanel.tsx:309` — ✏ Draw custom shape / ⭳ Import DXF… (also 228, 236, 317)
- Suggested fix: Replace with kit Button variant=secondary size=sm icon={<Pencil/>} / icon={<FileUp/>}; remove glyphs from labels.
- Verification (vq4): **confirmed** — Reproduced: the Board panel buttons are named '✏ Redraw shape' / '⭳ Import DXF…' / '✏ Draw custom shape'; U+2B73 renders as a tofu box. PcbBoardPanel.tsx:228, 236, 309, 317. e2e locators use /Import DXF/ and /Draw custom shape/ regexes, so swapping the glyphs for Lucide icons keeps the D9 names intact. · evidence: [040-board-edit](../evidence/shots/vq4/dark/040-board-edit.png), [040-board-edit-crop](../evidence/shots/vq4/dark/040-board-edit-crop.png)

</details>


## T-191

**Free-hole inspector shows X/Y as raw 15-digit floats and read-only, although holes can be dragged**

- Severity **S3** · category visual · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: Q4-032

**Summary.** 'X 11.92982456140351', 'Y 15.958646616541353' as plain text (comment says 'read-only until a move command exists' but canvas drag moves the hole, rev 22→23). The free-pad inspector has no X/Y at all; hole/pad placements land off-grid.

**Root cause.** `src/modules/designer/frontend/pcb/PcbSelectionInspector.tsx:157` — readOnly NumericField renders {value} unformatted; stale comment

**Proposed fix.** Hole inspector X/Y formatted (3 dp mm) and editable (move command). — Detail: Format readOnly values with toFixed(3); wire X/Y as editable NumericFields using the existing move command used by canvas drag (also allow 0/negative — NumericField currently rejects n <= 0); add X/Y rows to FreePadPanel.

**Evidence.** [150-hole-inspector](../evidence/shots/q4/dark/150-hole-inspector.png), [037-hole-inspector](../evidence/shots/vq4/dark/037-hole-inspector.png)

<details><summary>Q4-032 — Free-hole inspector shows X/Y as raw 15-digit floats and read-only, although holes can be dragged (S3, confirmed)</summary>

- Area designer.pcb · stack A · design 5909d519 · themes dark · viewports 1440x900
- Repro:
  1. QA-q4-board → PCB → press H, click the board
  2. Select the hole
  3. Read Properties → HOLE; then drag the hole on the canvas
- Expected: X/Y formatted to 3 decimals (like the status bar) and editable like other numeric fields; free pads also expose X/Y
- Actual: 'X 11.92982456140351', 'Y 15.958646616541353' as plain text (comment says 'read-only until a move command exists' but canvas drag moves the hole, rev 22→23). The free-pad inspector has no X/Y at all; hole/pad placements land off-grid.
- Screenshots: [150-hole-inspector](../evidence/shots/q4/dark/150-hole-inspector.png), [154-pad-inspector](../evidence/shots/q4/dark/154-pad-inspector.png), [037-hole-inspector](../evidence/shots/vq4/dark/037-hole-inspector.png)
- Code: `src/modules/designer/frontend/pcb/PcbSelectionInspector.tsx:157` — readOnly NumericField renders {value} unformatted; stale comment
- Code: `src/modules/designer/frontend/pcb/PcbSelectionInspector.tsx:77` — readOnly branch has no toFixed
- Suggested fix: Format readOnly values with toFixed(3); wire X/Y as editable NumericFields using the existing move command used by canvas drag (also allow 0/negative — NumericField currently rejects n <= 0); add X/Y rows to FreePadPanel.
- Verification (vq4): **confirmed** — Reproduced: the hole inspector shows X '16.19548872180451' / Y '13.076441102756894' as plain text. The NumericField readOnly branch renders {value} raw (PcbSelectionInspector.tsx:77-83), and the stale comment at :155 says 'read-only until a move command exists'. · evidence: [037-hole-inspector](../evidence/shots/vq4/dark/037-hole-inspector.png)

</details>


## T-192

**Measure / sketch dimension labels are world-sized, off-token cyan and drawn under board items — the measured distance can be unreadable**

- Severity **S3** · category visual · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: Q4-034

**Summary.** Measure label 'xx.62 mm' has its leading digits hidden behind the hole's silk ring (rendered on top) and the measure line strikes through the text; colour is hard-coded #38bdf8 (Tailwind sky-400). Sketch rubber-band length label is ~5px tall at the default 20% zoom ('47.27 mm' illegible, crop in shot 127); both are fixed world sizes (0.9 mm / edge labels 0.6 mm) so they vanish when zoomed out. Board-edit edge labels…

**Root cause.** `src/modules/designer/frontend/pcb/layers/MeasureOverlayLayer.tsx:15` — COLOR = '#38bdf8'

**Proposed fix.** Measure labels screen-sized, token colours, drawn above board items. — Detail: Render measure/sketch labels via the existing DOM HUD pattern (like SketchDimEntry) or scale fontSize by 1/zoom (EDAText screen-space); give them RENDER_ORDER top + a token background; replace #38bdf8 with the canvas theme measure token.

**Evidence.** [169-measure-done](../evidence/shots/q4/dark/169-measure-done.png)

<details><summary>Q4-034 — Measure / sketch dimension labels are world-sized, off-token cyan and drawn under board items — the measured distance can be unreadable (S3, confirmed)</summary>

- Area designer.pcb · stack A · design 5909d519 · themes dark · viewports 1440x900, 1100x720
- Repro:
  1. QA-q4-board (free hole + keepout) at default fit zoom → press M
  2. Click at bottom-left of the board, click at top-right so the midpoint lands near the hole
  3. Read the distance label; separately: press O and start a board sketch, read the edge length label on the rubber-band line
- Expected: Screen-space label (constant ~11px) on an opaque token chip, always drawn above copper/holes, offset from the line
- Actual: Measure label 'xx.62 mm' has its leading digits hidden behind the hole's silk ring (rendered on top) and the measure line strikes through the text; colour is hard-coded #38bdf8 (Tailwind sky-400). Sketch rubber-band length label is ~5px tall at the default 20% zoom ('47.27 mm' illegible, crop in shot 127); both are fixed world sizes (0.9 mm / edge labels 0.6 mm) so they vanish when zoomed out. Board-edit edge labels ('40.00 mm', '25.00 mm') are ~6px tall at 1100×720 fit zoom (shot 184).
- Screenshots: [169-measure-done](../evidence/shots/q4/dark/169-measure-done.png), [127-sketch-first-edge2](../evidence/shots/q4/dark/127-sketch-first-edge2.png), [129-sketch-second](../evidence/shots/q4/dark/129-sketch-second.png), [184-1100-board-edit](../evidence/shots/q4/dark/184-1100-board-edit.png)
- Code: `src/modules/designer/frontend/pcb/layers/MeasureOverlayLayer.tsx:15` — COLOR = '#38bdf8'
- Code: `src/modules/designer/frontend/pcb/layers/MeasureOverlayLayer.tsx:99` — EDAText fontSize 0.9 (world mm), no renderOrder
- Code: `src/modules/designer/frontend/pcb/layers/OutlineEdgeLabels.tsx:19` — FONT_MM = 0.6
- Suggested fix: Render measure/sketch labels via the existing DOM HUD pattern (like SketchDimEntry) or scale fontSize by 1/zoom (EDAText screen-space); give them RENDER_ORDER top + a token background; replace #38bdf8 with the canvas theme measure token.
- Verification (vq4): **confirmed** — Confirmed from the q4 screenshot 169 (the measure label '.62 mm' has its leading digits covered by the hole's silk ring) and code: MeasureOverlayLayer.tsx:15 COLOR '#38bdf8', EDAText fontSize 0.9 world-mm with no renderOrder (:99); OutlineEdgeLabels FONT_MM 0.6. The colour part touches the canvas palette, which PLAN §0 treats as a non-goal, but the legibility and z-order parts are in-tree bugs. · evidence: [169-measure-done](../evidence/shots/q4/dark/169-measure-done.png), [127-sketch-first-edge2](../evidence/shots/q4/dark/127-sketch-first-edge2.png)

</details>


## T-193

**Footprint Properties are read-only: X/Y/Rotation/Side cannot be typed; multi-selection panel offers no actions**

- Severity **S3** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate M
- Findings: Q4-036

**Summary.** U1 shows X 8.020, Y -1.927, Rotation 0.0 as static text (no inputs); the only way to position precisely is dragging. Multi-selection shows only 'CONTENTS Footprints 4 / Traces 1 / Vias 2'. Free text/pad/zone inspectors, in contrast, are editable — inconsistent.

**Root cause.** `src/modules/designer/frontend/pcb/PcbPropertiesPanel.tsx:306` — Location rows are PropertyRow text only

**Proposed fix.** Footprint Properties: editable X/Y/Rotation/Side via existing pcb_move/rotate/flip; multi-select actions (Rotate/Flip/Delete). — Detail: Use the inspector NumericField (after fixing Q4-033) for X/Y/Rotation wired to movePlacement/rotatePlacement; add a Side segmented control (flipPlacement); add Rotate 90°/Flip/Delete buttons to the multi-selection panel.

**Evidence.** [172-footprint-inspector](../evidence/shots/q4/dark/172-footprint-inspector.png)

<details><summary>Q4-036 — Footprint Properties are read-only: X/Y/Rotation/Side cannot be typed; multi-selection panel offers no actions (S3, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. Dual LED Blinker → PCB → Components panel → click 'U1'
  2. Properties → GENERAL / LOCATION
  3. Box-select several parts → Properties
- Expected: Pro-EDA inspector: editable X, Y, Rotation (and side/lock) for footprints, and for multi-selection at least Rotate/Flip/Delete/Align actions
- Actual: U1 shows X 8.020, Y -1.927, Rotation 0.0 as static text (no inputs); the only way to position precisely is dragging. Multi-selection shows only 'CONTENTS Footprints 4 / Traces 1 / Vias 2'. Free text/pad/zone inspectors, in contrast, are editable — inconsistent.
- Screenshots: [172-footprint-inspector](../evidence/shots/q4/dark/172-footprint-inspector.png), [174-box-select](../evidence/shots/q4/dark/174-box-select.png)
- Code: `src/modules/designer/frontend/pcb/PcbPropertiesPanel.tsx:306` — Location rows are PropertyRow text only
- Suggested fix: Use the inspector NumericField (after fixing Q4-033) for X/Y/Rotation wired to movePlacement/rotatePlacement; add a Side segmented control (flipPlacement); add Rotate 90°/Flip/Delete buttons to the multi-selection panel.
- Verification (vq4): **confirmed** — Code-confirmed: PcbPropertiesPanel.tsx:306-317 renders X/Y/Rotation as static PropertyRow text. Partly intentional: PLAN D8 specifies 'multi → count + kinds', so the multi-selection panel matches the plan. D8 does allow editing where a dispatch command exists (rotate/flip, and moves already exist for canvas drag), yet the single-footprint inspector has no inputs. Kept as S3 design-decision. · evidence: [172-footprint-inspector](../evidence/shots/q4/dark/172-footprint-inspector.png), [174-box-select](../evidence/shots/q4/dark/174-box-select.png)

</details>


## T-194

**PCB canvas clear colour is hard-coded #0e1116 (blue-cast) instead of --surface-canvas-well #08090a, in both themes**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate XS
- Findings: Q4-038 · known ref K38

**Summary.** Both themes render #0e1116 (ΔE 3.9 vs #08090a; B channel 0x16 > R 0x0e → visible blue cast next to the neutral #111113 / #f7f7f8 chrome). Board interior probes #05080c–#0d1219, also blue-shifted.

**Root cause.** `src/modules/designer/frontend/pcb/PcbCanvas.tsx:5922` — backgroundColor="#0e1116"

**Proposed fix.** PCB clear colour = --surface-canvas-well token. — Detail: Read the token at runtime (getComputedStyle(document.documentElement).getPropertyValue('--surface-canvas-well')) or pass a theme-map constant '#08090a' to EdaCanvas backgroundColor; align the board-interior fill in the canvas theme package.

**Evidence.** [183-canvas-clear](../evidence/shots/q4/dark/183-canvas-clear.png), [001-pcb](../evidence/shots/vq4/dark/001-pcb.png)

<details><summary>Q4-038 — PCB canvas clear colour is hard-coded #0e1116 (blue-cast) instead of --surface-canvas-well #08090a, in both themes (S3, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark, light · viewports 1440x900
- Repro:
  1. Dual LED Blinker → PCB (dark, then light theme)
  2. Probe empty canvas outside the board (700,780) and (360,200)
- Expected: Canvas well = --surface-canvas-well #08090a (neutral), matching the redesign tokens
- Actual: Both themes render #0e1116 (ΔE 3.9 vs #08090a; B channel 0x16 > R 0x0e → visible blue cast next to the neutral #111113 / #f7f7f8 chrome). Board interior probes #05080c–#0d1219, also blue-shifted.
- Screenshots: [183-canvas-clear](../evidence/shots/q4/dark/183-canvas-clear.png), [002-pcb](../evidence/shots/q4/light/002-pcb.png), [001-pcb](../evidence/shots/vq4/dark/001-pcb.png), [004-pcb-light](../evidence/shots/vq4/light/004-pcb-light.png)
- Pixel probes: {"file": "shots/vq4/dark/001-pcb.png", "x": 700, "y": 780, "hex": "#0e1116", "nearestToken": "--primary-foreground", "deltaE": 1.8}; {"file": "shots/vq4/light/004-pcb-light.png", "x": 700, "y": 780, "hex": "#0e1116", "nearestToken": "--text-strong", "deltaE": 1.8}
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:5922` — backgroundColor="#0e1116"
- Code: `node_modules/@openpcb/r3f-eda-canvas/dist/theme/canvasTheme.js:1` — package theme also carries #0e1116
- Suggested fix: Read the token at runtime (getComputedStyle(document.documentElement).getPropertyValue('--surface-canvas-well')) or pass a theme-map constant '#08090a' to EdaCanvas backgroundColor; align the board-interior fill in the canvas theme package.
- Verification (vq4): **confirmed** — Reproduced with probes: empty PCB canvas is #0e1116 in dark (001-pcb.png 700,780 and 360,200) and in light (004-pcb-light.png); token --surface-canvas-well is #08090a (index.css:202/261). In-tree hard-code at PcbCanvas.tsx:5922. The dark canvas in light theme is intended (run log: 'PCB canvas stays dark'); only the off-token hex is the defect. The board-interior cast is in the @openpcb/r3f-eda-canvas package (PLAN §0 non-goal). Same K38 family as Q3-029 (schematic). · evidence: [001-pcb](../evidence/shots/vq4/dark/001-pcb.png), [004-pcb-light](../evidence/shots/vq4/light/004-pcb-light.png)

</details>


## T-195

**Export dialog checkboxes render in browser-default blue (#0075ff light), off the neutral token palette**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate XS
- Findings: Q4-039
- Depends on: ['T-004']

**Summary.** Native <input type=checkbox> with no accent class → Chromium default #0075ff (ΔE 46 from the nearest token) on all four checkboxes (Export anyway, BOM, PnP, inner copper). Same root cause as the DXF-import loop radio (Q4-027).

**Root cause.** `src/modules/designer/frontend/pcb/PcbExportDialog.tsx:234` — type=checkbox without accent / kit Checkbox (also 245, 253, 261)

**Proposed fix.** Export dialog checkboxes -> kit Checkbox. — Detail: Use the shared kit Checkbox, or add className="accent-[var(--selection)]" to each input (pattern already used in AreaToolOptionsBar.tsx:162).

**Evidence.** [009-export-dialog](../evidence/shots/q4/light/009-export-dialog.png), [005-export-dialog](../evidence/shots/vq4/light/005-export-dialog.png)

<details><summary>Q4-039 — Export dialog checkboxes render in browser-default blue (#0075ff light), off the neutral token palette (S3, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes light, dark · viewports 1440x900
- Repro:
  1. Light theme → Dual LED Blinker → PCB → 'Export…'
  2. Probe the checked 'Include BOM CSV' checkbox
- Expected: Kit checkbox (or accent-[var(--selection)] as AreaToolOptionsBar already does) so checked state uses the neutral selection token
- Actual: Native <input type=checkbox> with no accent class → Chromium default #0075ff (ΔE 46 from the nearest token) on all four checkboxes (Export anyway, BOM, PnP, inner copper). Same root cause as the DXF-import loop radio (Q4-027).
- Screenshots: [009-export-dialog](../evidence/shots/q4/light/009-export-dialog.png), [110-export-dialog](../evidence/shots/q4/dark/110-export-dialog.png), [005-export-dialog](../evidence/shots/vq4/light/005-export-dialog.png), [006-keys-behind-export](../evidence/shots/vq4/dark/006-keys-behind-export.png)
- Pixel probes: {"file": "shots/vq4/light/005-export-dialog.png", "x": 503, "y": 425, "hex": "#0075ff", "nearestToken": "--status-info", "deltaE": 46.0}; {"file": "shots/vq4/dark/006-keys-behind-export.png", "x": 501, "y": 426, "hex": "#99c8ff", "nearestToken": "--status-info", "deltaE": 12.2}
- Code: `src/modules/designer/frontend/pcb/PcbExportDialog.tsx:234` — type=checkbox without accent / kit Checkbox (also 245, 253, 261)
- Suggested fix: Use the shared kit Checkbox, or add className="accent-[var(--selection)]" to each input (pattern already used in AreaToolOptionsBar.tsx:162).
- Verification (vq4): **confirmed** — Reproduced with probes: checked 'Include BOM CSV' is #0075ff in light (ΔE 46 vs nearest token) and #99c8ff in dark (Chromium dark-scheme default). Native inputs have no accent class (PcbExportDialog.tsx:234-265). · evidence: [005-export-dialog](../evidence/shots/vq4/light/005-export-dialog.png), [006-keys-behind-export](../evidence/shots/vq4/dark/006-keys-behind-export.png)

</details>


## T-196

**DRC markers are fixed-size screen diamonds that bury the board at fit zoom (106 markers cover every pad)**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate M
- Findings: Q4-043

**Summary.** Each violation draws a ~20 px layered diamond (glow + ring + core) at constant screen size; at fit zoom the markers overlap each other and completely cover pads/parts (at 1100×720 the board is an orange/pink field). Pad numbers under markers are hidden even when zoomed in (U1 pads 3/4/5/8, shot 172). Only workaround is View ▾ → DRC markers off, which hides all of them.

**Root cause.** `src/modules/designer/frontend/pcb/drc:1` — marker layer (drc-colors / markers) renders one badge per violation

**Proposed fix.** Scale markers with zoom / cluster at fit zoom; draw beneath selection highlight. — Detail: Cluster markers within N px into a count badge at low zoom; hide warnings below a zoom threshold; reduce marker size to ~12 px and drop the glow; draw pad numbers above markers or offset markers to the violation edge.

**Evidence.** [171-dual-led-pcb](../evidence/shots/q4/dark/171-dual-led-pcb.png), [001-pcb](../evidence/shots/vq4/dark/001-pcb.png)

<details><summary>Q4-043 — DRC markers are fixed-size screen diamonds that bury the board at fit zoom (106 markers cover every pad) (S3, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. Dual LED Blinker (32 errors / 74 warnings) → PCB → Fit board
  2. Look at the board at 1440×900 and at 1100×720
- Expected: Markers readable but subordinate to the design: cluster/aggregate at low zoom, scale with zoom, or show only errors by default; copper and pad numbers stay legible
- Actual: Each violation draws a ~20 px layered diamond (glow + ring + core) at constant screen size; at fit zoom the markers overlap each other and completely cover pads/parts (at 1100×720 the board is an orange/pink field). Pad numbers under markers are hidden even when zoomed in (U1 pads 3/4/5/8, shot 172). Only workaround is View ▾ → DRC markers off, which hides all of them.
- Screenshots: [171-dual-led-pcb](../evidence/shots/q4/dark/171-dual-led-pcb.png), [185-1100-route-idle](../evidence/shots/q4/dark/185-1100-route-idle.png), [172-footprint-inspector](../evidence/shots/q4/dark/172-footprint-inspector.png), [002-pcb](../evidence/shots/q4/light/002-pcb.png), [001-pcb](../evidence/shots/vq4/dark/001-pcb.png), [047-1100-pcb](../evidence/shots/vq4/dark/047-1100-pcb.png)
- Code: `src/modules/designer/frontend/pcb/drc:1` — marker layer (drc-colors / markers) renders one badge per violation
- Suggested fix: Cluster markers within N px into a count badge at low zoom; hide warnings below a zoom threshold; reduce marker size to ~12 px and drop the glow; draw pad numbers above markers or offset markers to the violation edge.
- Verification (vq4): **confirmed** — Reproduced: at fit zoom on Dual LED Blinker (106 violations) the constant-size diamond markers cover most pads, worst at 1100×720. The marker design itself is deliberate (redesigned layered badge), but there is no density handling. Kept S3. · evidence: [001-pcb](../evidence/shots/vq4/dark/001-pcb.png), [047-1100-pcb](../evidence/shots/vq4/dark/047-1100-pcb.png)

</details>


## T-197

**In Route mode before the first click, B switches to bottom copper but T quits Route and arms the Text tool (keymap advertises T/B = layer)**

- Severity **S3** · category keyboard · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate XS
- Findings: Q4-045 · known ref K16

**Summary.** T leaves Route (Route (R) aria-pressed=false) and the Add button turns into 'Text ▾' — the next board click opens the Text prompt. 1 and 2 behave correctly (Route stays, layer switches). The 'T/B layer' hint itself is never rendered (HUD uses primaryOnly hints), so the conflicting hint from K16 is not visible — only the behaviour is inconsistent.

**Root cause.** `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4490` — T → Text tool whenever not actively routing (incl. idle Route mode)

**Proposed fix.** Route idle: T/B both switch layer (T no longer arms Text) or fix hint; consistent keymap. — Detail: While toolMode==='route' (idle or routing) treat T/B/1/2/PgUp/PgDn as layer keys before the global tool hotkeys; keep T=Text only in Select mode.

**Evidence.** [192-route-idle-T](../evidence/shots/q4/dark/192-route-idle-T.png), [050-route-idle-T](../evidence/shots/vq4/dark/050-route-idle-T.png)

<details><summary>Q4-045 — In Route mode before the first click, B switches to bottom copper but T quits Route and arms the Text tool (keymap advertises T/B = layer) (S3, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. Dual LED Blinker → PCB → Top Copper active → hover canvas, press R (route idle, 'Route — click a pad to start')
  2. Press B → Route stays on, active layer Bottom Copper
  3. Press T
- Expected: T mirrors B (select Top Copper while staying in Route), as the route keymap table declares ({keys:'T/B', label:'layer'}) and as 1/2 already do
- Actual: T leaves Route (Route (R) aria-pressed=false) and the Add button turns into 'Text ▾' — the next board click opens the Text prompt. 1 and 2 behave correctly (Route stays, layer switches). The 'T/B layer' hint itself is never rendered (HUD uses primaryOnly hints), so the conflicting hint from K16 is not visible — only the behaviour is inconsistent.
- Screenshots: [192-route-idle-T](../evidence/shots/q4/dark/192-route-idle-T.png), [050-route-idle-T](../evidence/shots/vq4/dark/050-route-idle-T.png)
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:4490` — T → Text tool whenever not actively routing (incl. idle Route mode)
- Code: `src/modules/designer/frontend/pcb/tools/route-keymap.ts:34` — { keys: 'T/B', label: 'layer' }
- Suggested fix: While toolMode==='route' (idle or routing) treat T/B/1/2/PgUp/PgDn as layer keys before the global tool hotkeys; keep T=Text only in Select mode.
- Verification (vq4): **confirmed** — Reproduced: R (Route idle) then T -> Route aria-pressed false, Add shows 'Text'. The T branch (PcbCanvas.tsx:4489-4497) only checks routeState !== 'routing', so in idle Route mode it toggles the Text tool before the layer-key block (:4862). route-keymap.ts:34 declares {keys:'T/B', label:'layer'}. As q4 noted, the K16 hint is not rendered (primaryOnly), so K16 is partial. · evidence: [050-route-idle-T](../evidence/shots/vq4/dark/050-route-idle-T.png)

</details>


## T-198

**Selection filter covers only Traces/Vias/Pads/Components — zones, keepouts, free holes/pads, text and outline can't be filtered**

- Severity **S3** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: Q4-046

**Summary.** Only 4 kinds: Traces ('Routed copper segments'), Vias, Pads ('Component pads'), Components. Free holes, free pads, zones, keepouts, overlay text and board outline are always selectable; with a large GND zone every box-select/click inside it competes with the zone.

**Root cause.** `src/modules/designer/frontend/pcb/PcbSelectionFilter.tsx:28` — FILTER_KINDS lists 4 kinds only

**Proposed fix.** Selection filter adds zones, keepouts, free holes/pads, text, outline. — Detail: Extend SelectionFilterKind with zones, keepouts, freeHoles, freePads, texts (and outline) and honour them in pcb-hit / box-select; add All/None shortcuts.

**Evidence.** [019-selection-filter](../evidence/shots/q4/light/019-selection-filter.png), [038-selection-filter](../evidence/shots/vq4/dark/038-selection-filter.png)

<details><summary>Q4-046 — Selection filter covers only Traces/Vias/Pads/Components — zones, keepouts, free holes/pads, text and outline can't be filtered (S3, confirmed)</summary>

- Area designer.pcb · stack A · design 5909d519 · themes light, dark · viewports 1440x900
- Repro:
  1. QA-q4-board (free hole, free pad, overlay text, keepout) → PCB, nothing selected
  2. Press F → 'SELECTION FILTER' panel
  3. Try to exclude the keepout/text/hole from box selection
- Expected: One toggle per selectable primitive (KiCad: Footprints, Text, Tracks, Vias, Pads, Graphics, Zones, Keepouts, Other), so users can box-select e.g. traces over a zone
- Actual: Only 4 kinds: Traces ('Routed copper segments'), Vias, Pads ('Component pads'), Components. Free holes, free pads, zones, keepouts, overlay text and board outline are always selectable; with a large GND zone every box-select/click inside it competes with the zone.
- Screenshots: [019-selection-filter](../evidence/shots/q4/light/019-selection-filter.png), [087-selection-filter](../evidence/shots/q4/dark/087-selection-filter.png), [038-selection-filter](../evidence/shots/vq4/dark/038-selection-filter.png)
- Code: `src/modules/designer/frontend/pcb/PcbSelectionFilter.tsx:28` — FILTER_KINDS lists 4 kinds only
- Suggested fix: Extend SelectionFilterKind with zones, keepouts, freeHoles, freePads, texts (and outline) and honour them in pcb-hit / box-select; add All/None shortcuts.
- Verification (vq4): **confirmed** — Reproduced: F opens 'Selection filter' with only Traces/Vias/Pads/Components (PcbSelectionFilter.tsx:28-31); QA-q4-board's free hole, free pad, text and keepout cannot be filtered. · evidence: [038-selection-filter](../evidence/shots/vq4/dark/038-selection-filter.png)

</details>


## T-199

**PCB controls off-spec: 18/20/32px inputs, 13px checkboxes, zone-net select clips 'GND' to 'GN', pour select crushed to 10px**

- Severity **S3** · category consistency · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate M
- Findings: Q4-050, F2A-021, Q4-012 · known ref K37

**Summary.** Measured via getBoundingClientRect: Board panel inputs 18 px (INPUT_CLASS h-[18px]) and preset buttons 18 px; pad/text/zone/keepout inspector inputs + <select>s 18 px (FIELD_CLASS h-[18px]); route row W/Auto/via chips 20 px but 45°/90° segments 18 px; Corner/Edge/DXF modal inputs 32 px (h-8); keepout/inspector checkboxes 13 px native; Design rules inputs 21 px (Q4-022). Also nameless route-row buttons (only title at… | Also covers: F2A-021: Zone/Keepout options bar: 'Zone net' select is 43 px wide and shows 'GN' for GND (every n…; Q4-012: Layers panel pour row: 'pad connection' select is crushed to 10 px, value unreadable

**Root cause.** `src/modules/designer/frontend/pcb/PcbBoardPanel.tsx:34` — INPUT_CLASS h-[18px]

**Proposed fix.** PCB inputs/selects to kit sizes (22/20px) with min widths; zone net select shows full names; pour 'pad connection' select ≥80px. — Detail: Replace the local INPUT_CLASS/FIELD_CLASS and native selects/checkboxes with the shared kit Input/Select/Checkbox at size sm (20) or md (22); give the route-row SegmentedControl the same height as its sibling chips; add aria-labels to route-row buttons.

**Evidence.** [154-pad-inspector](../evidence/shots/q4/dark/154-pad-inspector.png), [043-done-unapplied](../evidence/shots/vq4/dark/043-done-unapplied.png), [058-zone-tool](../evidence/shots/f2a/dark/058-zone-tool.png)

<details><summary>Q4-050 — PCB control heights are all over the place: 18 px inspector/board inputs, 18 px route segments vs 20 px chips, 32 px modal inputs, 13 px checkboxes (kit = 22 px) (S3, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19, 5909d519 · themes dark, light · viewports 1440x900
- Repro:
  1. PCB → Board panel → Edit: measure Width/Height/Corner radius inputs and size preset buttons
  2. Select a free pad / text / zone / keepout: measure inspector inputs & selects
  3. Press R: measure route-row chips and 45°/90° segments
  4. Open Fillet corner / Set edge length / Import DXF modals: measure inputs
- Expected: Kit standard 22 px controls (20 px sm) everywhere; one checkbox component
- Actual: Measured via getBoundingClientRect: Board panel inputs 18 px (INPUT_CLASS h-[18px]) and preset buttons 18 px; pad/text/zone/keepout inspector inputs + <select>s 18 px (FIELD_CLASS h-[18px]); route row W/Auto/via chips 20 px but 45°/90° segments 18 px; Corner/Edge/DXF modal inputs 32 px (h-8); keepout/inspector checkboxes 13 px native; Design rules inputs 21 px (Q4-022). Also nameless route-row buttons (only title attributes, no aria-label).
- Screenshots: [154-pad-inspector](../evidence/shots/q4/dark/154-pad-inspector.png), [167-keepout-inspector](../evidence/shots/q4/dark/167-keepout-inspector.png), [135-fillet-modal](../evidence/shots/q4/dark/135-fillet-modal.png), [005-route-idle](../evidence/shots/q4/light/005-route-idle.png), [120-shape-Oval](../evidence/shots/q4/dark/120-shape-Oval.png), [043-done-unapplied](../evidence/shots/vq4/dark/043-done-unapplied.png), [041-fillet-modal](../evidence/shots/vq4/dark/041-fillet-modal.png), [046-pour-row](../evidence/shots/vq4/dark/046-pour-row.png)
- Console: `route row: W chip h=20, 45° h=18, 90° h=18, Auto h=20; inspector INPUT/SELECT h=18; modal INPUT h=32; checkbox h=13`
- Code: `src/modules/designer/frontend/pcb/PcbBoardPanel.tsx:34` — INPUT_CLASS h-[18px]
- Code: `src/modules/designer/frontend/pcb/PcbSelectionInspector.tsx:41` — FIELD_CLASS h-[18px]
- Code: `src/modules/designer/frontend/pcb/CornerOpModal.tsx:70` — h-8 input
- Code: `src/modules/designer/frontend/pcb/EdgeDimModal.tsx:24` — h-8 input
- Suggested fix: Replace the local INPUT_CLASS/FIELD_CLASS and native selects/checkboxes with the shared kit Input/Select/Checkbox at size sm (20) or md (22); give the route-row SegmentedControl the same height as its sibling chips; add aria-labels to route-row buttons.
- Verification (vq4): **confirmed** — Confirmed: Board panel Width input measured at 18 px; INPUT_CLASS h-[18px] (PcbBoardPanel.tsx:34) and FIELD_CLASS h-[18px] (PcbSelectionInspector.tsx:41); Fillet modal input measured at 32 px (CornerOpModal.tsx:70, EdgeDimModal.tsx:24); pour-row selects 18 px (PcbLayersPanel.tsx:145). Same K37 family as Q11-009 / Q7-025 / Q9-015 in other files. · evidence: [043-done-unapplied](../evidence/shots/vq4/dark/043-done-unapplied.png), [041-fillet-modal](../evidence/shots/vq4/dark/041-fillet-modal.png), [046-pour-row](../evidence/shots/vq4/dark/046-pour-row.png)

</details>

<details><summary>F2A-021 — Zone/Keepout options bar: 'Zone net' select is 43 px wide and shows 'GN' for GND (every net name is clipped), controls are 18/20 px tall native selects, the floating bar carries a shadow-lg, and in light theme its labels are 2.6–2.8:1 (S3, confirmed)</summary>

- Area designer.pcb · stack A · design 847e94e7-36e6-4284-b22c-17725e0f5b02 · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. PCB → Z (Zone tool)
  2. Look at the floating options bar at the top of the canvas (dark + light)
- Expected: Net select wide enough for typical names (GND, VCC, +3V3, Net_12) or auto-width; kit 22 px controls; flat bar per tokens (no drop shadow).
- Actual: DOM: Zone layer select 53×20, Zone net 43×18 (shows 'GN'), Zone pad connection 126×20 — three widths/two heights in one row; native OS selects/checkbox; bar box-shadow '0 10px 15px -3px rgba(0,0,0,.1), 0 4px 6px -4px rgba(0,0,0,.1)', bg surface-raised/95 + backdrop-blur (off the flat-token rule). The chosen net is the key setting of a pour and is unreadable. Light theme: the bar renders #d8d8db over the (always-dark) canvas and the 'Layer'/'Net'/'Pads' labels are #808087/#7f7f86/#85858c on #d8d8db = 2.76/2.80/2.58:1 contrast (text-tertiary on surface-raised).
- Screenshots: [058-zone-tool](../evidence/shots/f2a/dark/058-zone-tool.png), [059-zone-opts](../evidence/shots/f2a/dark/059-zone-opts.png), `f2a/crop-areabar.png`, [007-zone-tool-light](../evidence/shots/f2a/light/007-zone-tool-light.png), `f2a/crop-areabar-light.png`
- Pixel probes: {"file": "shots/f2a/light/007-zone-tool-light.png", "x": 700, "y": 106, "hex": "#d8d8db", "nearestToken": "--surface-control", "deltaE": 0.9}; {"file": "shots/f2a/dark/058-zone-tool.png", "x": 0, "y": 0, "hex": "n/a", "nearestToken": "see DOM measurements", "deltaE": 0}
- Code: `src/modules/designer/frontend/pcb/AreaToolOptionsBar.tsx:75` — floating bar classes 'shadow-lg backdrop-blur', text-[11px], labels text-text-tertiary on bg-surface-raised/95
- Code: `src/modules/designer/frontend/pcb/AreaToolOptionsBar.tsx:107` — Net uses NetSelect from the inspector
- Code: `src/modules/designer/frontend/pcb/PcbSelectionInspector.tsx:40` — NetSelect uses FIELD_CLASS 'h-[18px] w-full min-w-0' — inside the auto-width flex span it collapses to 43 px
- Suggested fix: Give NetSelect a className/size prop and render it in AreaToolOptionsBar with min-w-[96px] (or content width) at the kit 22 px height, replacing SELECT_CLASS/FIELD_CLASS with the shared kit Select; drop 'shadow-lg backdrop-blur' from the bar; use text-text-secondary (not tertiary) for the Layer/Net/Pads labels on surface-raised so light theme reaches ≥4.5:1.
- Verification (vf2a): **confirmed** — Golden PCB, Z tool. Dark: Zone layer SELECT 53×20, Zone net 43×18 ('No net' clipped to 'No', GND to 'GN'), Zone pad connection 126×20, native checkbox 13×13. Computed box-shadow is Tailwind shadow-lg (0 10px 15px -3px / 0 4px 6px -4px rgba(0,0,0,.1)) with backdrop-filter blur(8px). Light: bar #d8d8db (--surface-control ΔE 0.9); label glyphs 'Layer' #808087, 'Net' #7f7f86, 'Pads' #85858c → contrast 2.76, 2.80 and 2.58:1 (pixel-measured). The heights overlap K37/Q4-050 (which do not list this bar); the clipped net name, shadow/blur and light contrast are new. S3. · evidence: [022-zone-tool](../evidence/shots/vf2a/dark/022-zone-tool.png), [023-zone-net-gnd](../evidence/shots/vf2a/dark/023-zone-net-gnd.png), vf2a/crop-zonebar-gnd-dark.png, [001-zone-tool-light](../evidence/shots/vf2a/light/001-zone-tool-light.png), vf2a/crop-zonebar-light.png

</details>

<details><summary>Q4-012 — Layers panel pour row: 'pad connection' select is crushed to 10 px, value unreadable (S3, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. PCB → Layers panel → Top Copper row → click the droplet 'Show copper fills'
  2. Look at the POUR row under Top Copper
- Expected: Net select and pad-connection select (Solid/Thermal…) both readable
- Actual: 'Top Copper pour net' select takes 173 px, 'Top Copper pad connection' select is 10 px wide (only a sliver of the chevron visible, current value 'Solid' hidden). Both are native <select> at 18 px height (kit standard 22/20). The adjacent 'Remove redundant pour traces' button deletes traces with no preview, no confirmation and no result feedback (clicked: nothing removed, nothing reported).
- Screenshots: [063-copper-fill](../evidence/shots/q4/dark/063-copper-fill.png), [064-remove-redundant](../evidence/shots/q4/dark/064-remove-redundant.png), [046-pour-row](../evidence/shots/vq4/dark/046-pour-row.png), [046-pour-row-crop](../evidence/shots/vq4/dark/046-pour-row-crop.png)
- Code: `src/modules/designer/frontend/pcb/PcbLayersPanel.tsx:590` — NetSelect + pad connection select in one flex row, no min-width
- Code: `src/modules/designer/frontend/pcb/usePcbWorkspace.ts:472` — cleanupPourTraces: no result count surfaced
- Suggested fix: Put pad connection on its own labelled row (or give both selects flex-1 min-w-0 with a min width ~80px); use the kit Select at 20/22px; have pcb_cleanup_pour_traces return removed count and show a notice ('Removed 3 traces — Undo').
- Verification (vq4): **confirmed** — Reproduced: opening the Top Copper row settings shows 'Top Copper pour net' select 173x18 px and 'Top Copper pad connection' select 10x18 px (value hidden). Both use BOARD_ZONE_SELECT_CLASS (PcbLayersPanel.tsx:145, flex-1 min-w-0) next to a NetSelect that takes the width. cleanupPourTraces (usePcbWorkspace.ts:472) reports nothing and has no confirmation (code-verified; the button only shows with an enabled board zone). · evidence: [046-pour-row](../evidence/shots/vq4/dark/046-pour-row.png), [046-pour-row-crop](../evidence/shots/vq4/dark/046-pour-row-crop.png)

</details>


## T-394

**A drawn zone can only be selected by clicking exactly on its outline; clicking the pour does nothing, so Shift+Z 'Cutout' ('Select one unlocked polygon zone first') looks broken**

- Severity **S3** · category bug · status rejected · themes dark
- Recommendation **wont-fix** · owner — · wave followup · scope frontend · estimate S
- Findings: F2A-019

**Summary.** REJECTED — Edge-only zone selection is a documented design decision. docs/pcb-hardening/03-zone-keepout-contract.md §12.3: 'polygon zones and keepouts are selected by proximity to their ring (edge only — an interior hit would swallow every marquee start over a pour)'. The 'Shift+Z is a silent no-op' part did not reproduce. On the golden (B.Cu active, nothing selected, after clicking inside the pour → 'No selection'), Shift+Z s…

**Root cause.** `src/modules/designer/frontend/pcb/tools/use-area-interactions.ts:3` — edge-proximity selection only

**Proposed fix.** None — edge-only zone selection is documented (03-zone-keepout-contract §12.3); Shift+Z notice works.

**Evidence.** [071-cutout](../evidence/shots/f2a/dark/071-cutout.png), [031-click-inside-pour](../evidence/shots/vf2a/dark/031-click-inside-pour.png)

<details><summary>F2A-019 — A drawn zone can only be selected by clicking exactly on its outline; clicking the pour does nothing, so Shift+Z 'Cutout' ('Select one unlocked polygon zone first') looks broken (S3, rejected)</summary>

- Area designer.pcb · stack A · design 847e94e7-36e6-4284-b22c-17725e0f5b02 · themes dark · viewports 1440x900
- Repro:
  1. QA-f2a-golden: B.Cu GND zone covering the board, B.Cu active
  2. Click inside the pour → 'Board · Nothing selected'
  3. Press Shift+Z → nothing happens; clicks then add nothing
  4. Click within ~3 px of the zone edge → 'Zone B.Cu' selected; Shift+Z now arms 'Cutout — click to place vertices, Enter to close'
- Expected: Clicking inside a zone's fill (on its layer, where no other object is hit) selects the zone; Shift+Z without a selection explains what to do.
- Actual: Only edge-proximity selection works; with a board-sized zone the edge coincides with the board outline, so users hit the outline or nothing. Shift+Z with nothing selected is a silent no-op (the hint only exists as a tooltip on the disabled Cutout checkbox).
- Screenshots: [071-cutout](../evidence/shots/f2a/dark/071-cutout.png), [072-cutout-armed](../evidence/shots/f2a/dark/072-cutout-armed.png), [073-cutout-done](../evidence/shots/f2a/dark/073-cutout-done.png)
- Code: `src/modules/designer/frontend/pcb/tools/use-area-interactions.ts:3` — edge-proximity selection only
- Suggested fix: Fall back to interior hit (point-in-polygon on the active layer) when nothing else is hit; show a notice on Shift+Z with no zone selected.
- Verification (vf2a): **rejected** — Edge-only zone selection is a documented design decision. docs/pcb-hardening/03-zone-keepout-contract.md §12.3: 'polygon zones and keepouts are selected by proximity to their ring (edge only — an interior hit would swallow every marquee start over a pour)'. The 'Shift+Z is a silent no-op' part did not reproduce. On the golden (B.Cu active, nothing selected, after clicking inside the pour → 'No selection'), Shift+Z shows the notice 'Select one unlocked polygon zone first — Shift+Z cuts a hole in it' (shot 032). Nothing left to fix beyond the intended behaviour. · evidence: [031-click-inside-pour](../evidence/shots/vf2a/dark/031-click-inside-pour.png), [032-shiftz-nothing-selected](../evidence/shots/vf2a/dark/032-shiftz-nothing-selected.png), vf2a/crop-shiftz.png

</details>


## T-200

**No in-flight feedback for PCB commands: Undo/moves on a slow backend look like no-ops for seconds**

- Severity **S4** · category perf · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate XS
- Findings: F1A-013

**Summary.** Undo stays enabled and nothing changes for ~5 s (undo POST plus projection refetch), then the board jumps. All 3 clicks are sent: two apply (rev 17 → 19), the third returns {ok:false, code:'HISTORY_EMPTY'} and is silently ignored. The history itself is correct (no data issue); the problem is only the lack of pending state, which also lets the user trigger the F1A-003 conflict.

**Root cause.** `src/modules/designer/frontend/pcb/usePcbWorkspace.ts:243` — undo/redo await api + refresh + refreshHistory with no pending flag exposed to the toolbar

**Proposed fix.** Subtle in-flight indicator (status bar 'Saving…') while PCB commands are pending. — Detail: Expose a pendingCommands count from the workspace. Show 'Saving…' in the status bar and disable Undo/Redo while an undo/redo is in flight.

**Evidence.** [061-undo-race-inflight](../evidence/shots/f1a/dark/061-undo-race-inflight.png), [040-undo-race-inflight](../evidence/shots/vf1a/dark/040-undo-race-inflight.png)

<details><summary>F1A-013 — No in-flight feedback for PCB commands: Undo/moves on a slow backend look like no-ops for seconds (S4, confirmed)</summary>

- Area designer.pcb · stack A · design 91573bb6-cb22-4ca4-a8d9-58057a1ff45b · themes dark · viewports 1440x900
- Repro:
  1. Latency shim 2.5 s, PCB view with 2 undoable moves
  2. Click toolbar Undo 3× quickly and watch the canvas and the Undo button for 10 s
  3. GET projection/pcb + response bodies of the /history/undo calls
- Expected: A busy indicator (status-bar 'Saving…' or a disabled Undo while pending), and extra clicks either queue or are ignored with a hint.
- Actual: Undo stays enabled and nothing changes for ~5 s (undo POST plus projection refetch), then the board jumps. All 3 clicks are sent: two apply (rev 17 → 19), the third returns {ok:false, code:'HISTORY_EMPTY'} and is silently ignored. The history itself is correct (no data issue); the problem is only the lack of pending state, which also lets the user trigger the F1A-003 conflict.
- Screenshots: [061-undo-race-inflight](../evidence/shots/f1a/dark/061-undo-race-inflight.png), [062-undo-race-settled](../evidence/shots/f1a/dark/062-undo-race-settled.png)
- Network: `POST /history/undo → {ok:true, revision:18}`; `POST /history/undo → {ok:true, revision:19}`; `POST /history/undo → {ok:false, code:'HISTORY_EMPTY'}`
- Code: `src/modules/designer/frontend/pcb/usePcbWorkspace.ts:243` — undo/redo await api + refresh + refreshHistory with no pending flag exposed to the toolbar
- Suggested fix: Expose a pendingCommands count from the workspace. Show 'Saving…' in the status bar and disable Undo/Redo while an undo/redo is in flight.
- Verification (vf1a): **confirmed** — Reproduced with the 2.5 s shim: three quick toolbar Undo clicks all went through (Undo stayed enabled after each click, isDisabled=false at 90/252/387 ms); nothing changed on the canvas until ~2.5 s, then three undos applied (rev 31 -> 34). Code: usePcbWorkspace.ts:243 undo awaits api.undo + refresh + refreshHistory with no pending flag and ignores {ok:false, HISTORY_EMPTY}. Latency-only; S4 kept. · evidence: [040-undo-race-inflight](../evidence/shots/vf1a/dark/040-undo-race-inflight.png), [041-undo-race-settled](../evidence/shots/vf1a/dark/041-undo-race-settled.png), network: POST /history/undo x3 -> rev 32, 33, 34

</details>


## T-201

**Export of an empty board (no parts, no copper, default 50×30 outline) reports 'DRC passed — no errors · no warnings' and produces a full 14-file fab bundle of empty layers**

- Severity **S4** · category error-handling · status confirmed · themes dark
- Recommendation **defer** · owner followup · wave followup · scope backend · estimate XS
- Findings: F1B-015

**Summary.** ZIP contains F_Cu/B_Cu/Mask/Paste/Silk Gerbers with only headers + M02, PTH/NPTH drill files with no tools ('T0 M30'), a header-only BOM.csv and PnP.csv, and an Edge_Cuts of the auto-created 50×30 mm rectangle — all presented as a clean, ready-to-upload bundle.

**Root cause.** `src/modules/designer/backend/export/preflight.ts:17` — warns only for missing outline, sub-min drills/traces, unsourced BOM lines — no 'empty board' check

**Proposed fix.** Export preflight should refuse/ warn on empty board. — Detail: In runExportPreflight add: placements.length===0 && traces/vias/zones empty → warning 'Board is empty — no copper, parts or drills'; when includeBom/includePnp and no active rows → 'BOM/CPL would be empty'. Consider treating it as blocking like DRC errors.

**Evidence.** [040-export-empty-design](../evidence/shots/f1b/dark/040-export-empty-design.png), [026-export-empty-design](../evidence/shots/vf1b/dark/026-export-empty-design.png)

<details><summary>F1B-015 — Export of an empty board (no parts, no copper, default 50×30 outline) reports 'DRC passed — no errors · no warnings' and produces a full 14-file fab bundle of empty layers (S4, confirmed)</summary>

- Area designer.pcb · stack A · design 2964a68a-fc15-442c-bae6-3b085e74 · themes dark · viewports 1440x900
- Repro:
  1. Create a new design QA-f1b-empty (nothing placed)
  2. PCB → Export…
  3. Dialog: green 'DRC passed — no errors.', footer '14 files · openpcb-2964a68a-….zip · no warnings', Download ZIP enabled
  4. Download and unzip
- Expected: Preflight warns 'Board has no components and no copper — nothing to fabricate' (and ideally that the outline is the untouched default), BOM/PnP checkboxes disabled or noted as empty.
- Actual: ZIP contains F_Cu/B_Cu/Mask/Paste/Silk Gerbers with only headers + M02, PTH/NPTH drill files with no tools ('T0 M30'), a header-only BOM.csv and PnP.csv, and an Edge_Cuts of the auto-created 50×30 mm rectangle — all presented as a clean, ready-to-upload bundle.
- Screenshots: [040-export-empty-design](../evidence/shots/f1b/dark/040-export-empty-design.png)
- Code: `src/modules/designer/backend/export/preflight.ts:17` — warns only for missing outline, sub-min drills/traces, unsourced BOM lines — no 'empty board' check
- Suggested fix: In runExportPreflight add: placements.length===0 && traces/vias/zones empty → warning 'Board is empty — no copper, parts or drills'; when includeBom/includePnp and no active rows → 'BOM/CPL would be empty'. Consider treating it as blocking like DRC errors.
- Verification (vf1b): **confirmed** — Reproduced on a fresh QA-vf1b-empty (0 parts, default 50x30 outline). The export dialog shows 'DRC passed — no errors.' and '14 files · … · no warnings'. Summary warnings are [], the F_Cu Gerber is header + M02 only, PTH/NPTH drill files have 'T0' + 'M30' with no tools, and BOM/PnP are header-only. preflight.ts has no empty-board check. Severity lowered to S4: KiCad and Altium also plot empty layers without warning, it takes an explicit user action, and nothing is lost. An 'empty board' preflight note is polish. · evidence: [026-export-empty-design](../evidence/shots/vf1b/dark/026-export-empty-design.png), API POST /designs/cb93fe99…/exports/gerber?format=summary -> warnings [] , 14 files

</details>


## T-202

**PCB layer palette collisions (solder mask = drill black; In1 amber ≈ outline)**

- Severity **S4** · category visual · status confirmed · themes dark, light
- Recommendation **defer** · owner followup · wave followup · scope shared-package · estimate S
- Findings: F1B-025, F2B-014

**Summary.** Both mask swatches are #0a0d12 (dark panel row #111113 → 1.03:1, effectively an empty slot; light → a black square indistinguishable from 'Drill Holes' #000000). F.Paste #cbd5e1 / B.Paste #94a3b8 / F.SilkS #f8fafc are Tailwind slate-300/400/50 (blue-grey cast). The panel reads PCB_LAYER_COLORS from @openpcb/r3f-eda-canvas, which ignores the app's --color-layer-* tokens. | Also covers: F2B-014: Mid-Layer 1 (In1) is amber #f59e0b next to the amber Board Outline #fbbf24 — inner tracks…

**Root cause.** `node_modules/@openpcb/r3f-eda-canvas/dist/layers.js:79` — 'F.Mask': '#0a0d12', 'B.Mask': '#0a0d12', 'F.Paste': '#cbd5e1', 'B.Paste': '#94a3b8', 'F.SilkS': '#f8fafc'

**Proposed fix.** @openpcb/r3f-eda-canvas layers.js: distinct solder-mask swatches; In1 not amber next to outline. — Detail: In @openpcb/r3f-eda-canvas give the two mask layers distinct swatch colours (or a separate swatch palette from the render colour) aligned with --color-layer-*; or have PcbLayersPanel read the CSS tokens for swatches. Add a 1 px border-control ring around swatches so near-background colours stay visible.

**Evidence.** [089-long-pcb-zones-layers-zoom](../evidence/shots/f1b/dark/089-long-pcb-zones-layers-zoom.png), [014-long-pcb](../evidence/shots/vf1b/dark/014-long-pcb.png), [011-4L-pcb](../evidence/shots/f2b/dark/011-4L-pcb.png)

<details><summary>F1B-025 — PCB Layers panel swatches: Top and Bottom Solder Mask share #0a0d12 — invisible on the dark panel (1.03:1) and identical to the Drill black in light; paste/silk swatches use Tailwind slate (blue cast) instead of the --color-layer-* tokens (S4, confirmed)</summary>

- Area designer.pcb · stack A · design 43a2da78-9d2e-43a0-bcd3-ecebe3f72551 · themes dark, light · viewports 1440x900
- Repro:
  1. Open any design → PCB → Layers panel (dark)
  2. Look at 'Top Solder Mask F.Mask' and 'Bottom Solder Mask B.Mask' swatches; repeat in light
- Expected: Each layer has a distinct, visible swatch matching the design tokens (index.css defines --color-layer-f-mask #5b3a7a, --color-layer-b-mask #3a5a7a, --color-layer-f-paste #b8b8c8).
- Actual: Both mask swatches are #0a0d12 (dark panel row #111113 → 1.03:1, effectively an empty slot; light → a black square indistinguishable from 'Drill Holes' #000000). F.Paste #cbd5e1 / B.Paste #94a3b8 / F.SilkS #f8fafc are Tailwind slate-300/400/50 (blue-grey cast). The panel reads PCB_LAYER_COLORS from @openpcb/r3f-eda-canvas, which ignores the app's --color-layer-* tokens.
- Screenshots: [089-long-pcb-zones-layers-zoom](../evidence/shots/f1b/dark/089-long-pcb-zones-layers-zoom.png), [005-long-pcb-layers-zoom](../evidence/shots/f1b/light/005-long-pcb-layers-zoom.png)
- Pixel probes: {"file": "shots/f1b/dark/089-long-pcb-zones.png", "x": 110, "y": 231, "hex": "#0a0d12", "nearestToken": "--primary-foreground", "deltaE": 2.0}; {"file": "shots/f1b/light/005-long-pcb.png", "x": 110, "y": 231, "hex": "#0a0d12", "nearestToken": "--text-strong", "deltaE": 2.0}; {"file": "shots/f1b/light/005-long-pcb.png", "x": 110, "y": 209, "hex": "#cbd5e1", "nearestToken": "--status-info-soft@app", "deltaE": 5.0}
- Code: `node_modules/@openpcb/r3f-eda-canvas/dist/layers.js:79` — 'F.Mask': '#0a0d12', 'B.Mask': '#0a0d12', 'F.Paste': '#cbd5e1', 'B.Paste': '#94a3b8', 'F.SilkS': '#f8fafc'
- Code: `src/modules/designer/frontend/pcb/PcbLayersPanel.tsx:402` — swatch colour = PCB_LAYER_COLORS[node.id]
- Code: `src/core/frontend/src/index.css:95` — --color-layer-f-mask #5b3a7a / --color-layer-b-mask #3a5a7a unused by the panel
- Suggested fix: In @openpcb/r3f-eda-canvas give the two mask layers distinct swatch colours (or a separate swatch palette from the render colour) aligned with --color-layer-*; or have PcbLayersPanel read the CSS tokens for swatches. Add a 1 px border-control ring around swatches so near-background colours stay visible.
- Verification (vf1b): **confirmed** — Probed. Dark: the F.Mask and B.Mask swatches are both #0a0d12 on the #111113 panel (1.03:1). Light: the same #0a0d12 black squares are indistinguishable from Drill #000000. F.Paste #cbd5e1 and B.Paste #94a3b8 are Tailwind slate. Source: node_modules/@openpcb/r3f-eda-canvas/dist/layers.js:79-84 via PcbLayersPanel.tsx:402, while index.css:95-97 defines unused --color-layer-f-mask/-b-mask/-f-paste tokens. Not refuted by the PLAN: §0 makes the canvas palette a non-goal, and §9 lists it as pending follow-up work, not as an intended final state. S4 kept. · evidence: [014-long-pcb](../evidence/shots/vf1b/dark/014-long-pcb.png), [002-long-pcb](../evidence/shots/vf1b/light/002-long-pcb.png), probe dark 110,231/110,341 #0a0d12; light 94,143 #000000 (Drill)

</details>

<details><summary>F2B-014 — Mid-Layer 1 (In1) is amber #f59e0b next to the amber Board Outline #fbbf24 — inner tracks near the edge read as outline; Mid-Layer 2 cyan vs Bottom Overlay pale cyan (S4, confirmed)</summary>

- Area designer.pcb · stack B · design 2a4c5318-4bea-4e32-841b-2750b998e9d4 · themes dark, light · viewports 1440x900
- Repro:
  1. QA-f2b-4L → PCB → press 3 (In1 active)
  2. Compare layer swatches (Layers panel / tab strip) and In1 tracks with the board outline
- Expected: Each copper layer hue clearly distinct from non-copper layers (KiCad: In1 green-ish, In2 pink-ish, Edge.Cuts yellow).
- Actual: Swatches: In1 #f59e0b vs Edge.Cuts #fbbf24 (ΔE 16.8); on canvas In1 track #e6c84d vs outline #fbbf24 (ΔE 18.6). In2 #06b6d4 vs Bottom Overlay #a5f3fc share the cyan family. Same palette in both themes.
- Screenshots: [011-4L-pcb](../evidence/shots/f2b/dark/011-4L-pcb.png), [012-4L-key3-In1](../evidence/shots/f2b/dark/012-4L-key3-In1.png), [011-4L-pcb](../evidence/shots/f2b/light/011-4L-pcb.png)
- Pixel probes: {"file": "shots/f2b/dark/011-4L-pcb.png", "x": 93, "y": 297, "hex": "#f59e0b", "nearestToken": "--net-bus", "deltaE": 16.8}; {"file": "shots/f2b/dark/011-4L-pcb.png", "x": 93, "y": 121, "hex": "#fbbf24", "nearestToken": "--net-bus", "deltaE": 0.0}; {"file": "shots/f2b/dark/011-4L-pcb.png", "x": 93, "y": 319, "hex": "#06b6d4", "nearestToken": "--selection", "deltaE": 13.1}
- Code: `node_modules/@openpcb/r3f-eda-canvas/dist/layers.js:102` — PCB_TRACE_COLORS In1.Cu #fbbf24 == PCB_LAYER_COLORS Edge.Cuts #fbbf24 (line 89); swatch In1 #f59e0b (line 76)
- Code: `src/modules/designer/frontend/pcb/pcb-layer-colors.ts:12` — copperLayerColor uses PCB_TRACE_COLORS for In1/In2
- Suggested fix: Pick inner-layer hues away from the non-copper palette (e.g. In1 green #4caf50-ish, In2 magenta) in the published canvas palette.
- Verification (vf2b): **confirmed** — Probed [003-4L-open](../evidence/shots/vf2b/dark/003-4L-open.png): Layers swatches In1 #f59e0b vs Board Outline #fbbf24 (dE 16.8), In2 #06b6d4 vs Bottom Overlay #a5f3fc (dE 27.6). Worse than reported on the canvas side: the published PCB_TRACE_COLORS uses In1.Cu = #fbbf24, the exact hex of PCB_LAYER_COLORS Edge.Cuts, and the swatch (#f59e0b) does not even match the canvas trace colour. Canvas palette is an explicit PLAN non-goal/§9 follow-up owned by @openpcb/r3f-eda-canvas, so this belongs to that palette pass; S4 kept. · evidence: [003-4L-open](../evidence/shots/vf2b/dark/003-4L-open.png), [004-4L-In2-active-FCu-hidden](../evidence/shots/vf2b/dark/004-4L-In2-active-FCu-hidden.png)

</details>


## T-203

**Routed traces end in sub-µm to 4 µm micro-segments at vias and pad terminations (45° + axis elbows built across a tiny residual offset)**

- Severity **S4** · category data · status confirmed · themes dark
- Recommendation **defer** · owner followup · wave followup · scope frontend · estimate S
- Findings: F2A-009

**Summary.** e.g. VCC: trace (6.219,-4.802)→(6.219,-6.398096)→(6.2194,-6.398496)→(6.219801,-6.398496) with the via flashed at (6.219801,-6.398496); GND stub (-2.475,-2.022)→(-4.397592,-2.022)→(-4.398245,-2.022653)→(-4.398245,-2.023307). Same on all 5 vias (F_Cu.gbr lines with 0.4–1.9 µm segments); projection shows points like [(6.22,-6.4),(6.22,-6.4),(6.22,-6.4)]. Harmless for fab, but it is dirty geometry (zero-length/µm segmen…

**Root cause.** `src/modules/designer/frontend/pcb/tools/route-preview-geometry.ts:4` — dedupe() drops only exactly-equal consecutive points

**Proposed fix.** Route tool elbow construction leaves µm segments — route via /pcb-hardening-review (routing geometry). — Detail: In buildPreviewPath and buildTracePathThroughAnchors, snap the final anchor onto the last vertex (or skip the elbow) when |Δ| < 1 µm·N (e.g. 5 µm), and drop zero-/µm-length and collinear segments before commit; place the smart via at the committed vertex.

**Note.** Routing geometry correctness — out of scope for this UI run.

**Evidence.** `network: f2a/export/…-F_Cu.gbr: D ('C','0.25') (6.2194,-6.398496)->(6.219801,-6.398496)`

<details><summary>F2A-009 — Routed traces end in sub-µm to 4 µm micro-segments at vias and pad terminations (45° + axis elbows built across a tiny residual offset) (S4, confirmed)</summary>

- Area designer.pcb · stack A · design 847e94e7-36e6-4284-b22c-17725e0f5b02 · themes dark · viewports 1440x900
- Repro:
  1. Route tool: click a pad, click a corner, press V, finish (Enter or click a pad)
  2. GET /projection/pcb traces / open F_Cu.gbr
- Expected: The via centre equals the last committed vertex; the trace ends exactly on it.
- Actual: e.g. VCC: trace (6.219,-4.802)→(6.219,-6.398096)→(6.2194,-6.398496)→(6.219801,-6.398496) with the via flashed at (6.219801,-6.398496); GND stub (-2.475,-2.022)→(-4.397592,-2.022)→(-4.398245,-2.022653)→(-4.398245,-2.023307). Same on all 5 vias (F_Cu.gbr lines with 0.4–1.9 µm segments); projection shows points like [(6.22,-6.4),(6.22,-6.4),(6.22,-6.4)]. Harmless for fab, but it is dirty geometry (zero-length/µm segments in CAM output, extra vertices users must drag).
- Network: `f2a/export/…-F_Cu.gbr: D ('C','0.25') (6.2194,-6.398496)->(6.219801,-6.398496)`
- Code: `src/modules/designer/frontend/pcb/tools/route-preview-geometry.ts:4` — dedupe() drops only exactly-equal consecutive points
- Code: `src/modules/designer/frontend/pcb/tools/route-preview-geometry.ts:118` — buildPreviewPath builds a 45°/axis elbow for any residual offset between the last vertex and the via/pad anchor
- Code: `src/shared/pcb-geometry/pcb-trace-geometry.ts:261` — backend mirror buildTracePathThroughAnchors has the same behaviour
- Suggested fix: In buildPreviewPath and buildTracePathThroughAnchors, snap the final anchor onto the last vertex (or skip the elbow) when |Δ| < 1 µm·N (e.g. 5 µm), and drop zero-/µm-length and collinear segments before commit; place the smart via at the committed vertex.
- Verification (vf2a): **confirmed** — Golden projection: 8 traces contain segments < 5 µm. Via stubs: d133ee98 (6.219,-6.398096)→(6.2194,-6.398496)→(6.219801,-6.398496), 0.57/0.40 µm; 225acf78 0.92/0.65 µm; cdff5b79 0.66/0.47 µm; 0479b885 0.06/0.05 µm. Pad ends too: 4cb4c9a8 0.35 µm, 46ff3b99 1.13 µm, 68cdd018 3.82 µm. Not only vias (title widened). Harmless for fabrication. S4. · evidence: GET /designs/847e94e7…/projection/pcb traces (segments < 5 µm listed in reason)

</details>


## T-204

**Pad-number labels rotate with the footprint: on 180°-rotated parts '1'/'2' are drawn upside-down**

- Severity **S4** · category visual · status confirmed · themes dark
- Recommendation **defer** · owner followup · wave followup · scope shared-package · estimate XS
- Findings: F2B-016

**Summary.** The pad labels on R4, R5, R6, R7 render as inverted '2' and '1' glyphs while 'R5'/'R4' above them are upright.

**Root cause.** `node_modules/@openpcb/r3f-eda-canvas/dist/scene/footprint-render-layer.js:185` — pad number EDAText without counter-rotation

**Proposed fix.** Pad-number labels stay upright on rotated footprints. — Detail: In @openpcb/r3f-eda-canvas FootprintRenderLayer accept the placement's world rotation/mirror (or a textUprightDeg prop) and counter-rotate pad-number text so its net angle is normalised to (-90, 90]; pass placement.rotationDeg from PcbScene.

**Evidence.** [073-blind-vs-through](../evidence/shots/f2b/dark/073-blind-vs-through.png), [013-blind-zoom-R4R7](../evidence/shots/vf2b/dark/013-blind-zoom-R4R7.png)

<details><summary>F2B-016 — Pad-number labels rotate with the footprint: on 180°-rotated parts '1'/'2' are drawn upside-down (S4, confirmed)</summary>

- Area designer.pcb · stack B · design 60743616-5236-45e6-a8fd-1195e3107cbf · themes dark · viewports 1440x900
- Repro:
  1. Stack B, QA-f2b-blind (or any KiCad import) → PCB, zoom on R4/R5/R6/R7 (rotation 180°)
- Expected: Pad numbers stay upright/readable (KiCad normalises pad text to 0°/90°), like the refdes text already does.
- Actual: The pad labels on R4, R5, R6, R7 render as inverted '2' and '1' glyphs while 'R5'/'R4' above them are upright.
- Screenshots: [073-blind-vs-through](../evidence/shots/f2b/dark/073-blind-vs-through.png), `f2b/crop-padlabels.png`
- Code: `node_modules/@openpcb/r3f-eda-canvas/dist/scene/footprint-render-layer.js:185` — pad number EDAText without counter-rotation
- Code: `src/modules/designer/frontend/pcb/PcbScene.tsx:989` — FootprintRenderLayer mounted inside the rotated placement group
- Suggested fix: In @openpcb/r3f-eda-canvas FootprintRenderLayer accept the placement's world rotation/mirror (or a textUprightDeg prop) and counter-rotate pad-number text so its net angle is normalised to (-90, 90]; pass placement.rotationDeg from PcbScene.
- Verification (vf2b): **confirmed** — Reproduced on QA-f2b-blind zoomed onto R4 (rotation 180): the pad labels render as inverted '2' and '1' while the 'R4' refdes is upright. In the shared FootprintRenderLayer (r3f-eda-canvas scene/footprint-render-layer.js:185) the pad-number EDAText has no rotation of its own, so it inherits the placement group's 180-degree rotation; refdes labels get a rotation prop (:201-203). · evidence: [013-blind-zoom-R4R7](../evidence/shots/vf2b/dark/013-blind-zoom-R4R7.png)

</details>


## T-205

**Via preset menu offers 'Microvia 0.10 / 0.30 mm — HDI / BGA laser-drilled (Phase C)': internal roadmap copy, and picking it places a 0.1 mm THROUGH via**

- Severity **S4** · category copy · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate XS
- Findings: F2B-017

**Summary.** The last entry reads 'Microvia 0.10 / 0.30 mm · HDI / BGA laser-drilled (Phase C)'. The route tool always commits viaType 'through', so this preset yields a 0.1 mm-drill through via spanning all layers (below every fab preset's drill minimum). 'Standard 4L — Default for 4-layer (JLCPCB 4L min)' is listed as the default even when the board minimum (0.8 mm) rejects it (see F2B-003).

**Root cause.** `src/modules/designer/backend/pcb/via-presets.ts:73` — description 'HDI / BGA laser-drilled (Phase C)'

**Proposed fix.** Hide 'Microvia (Phase C)' preset until supported (and drop roadmap copy). — Detail: Drop 'Microvia' from the route-time list until microvias exist, remove '(Phase C)', and grey out presets below the resolved board minimum with a tooltip.

**Evidence.** [030-4L-via-preset-menu](../evidence/shots/f2b/dark/030-4L-via-preset-menu.png), [009-4L-via-preset-menu](../evidence/shots/vf2b/dark/009-4L-via-preset-menu.png)

<details><summary>F2B-017 — Via preset menu offers 'Microvia 0.10 / 0.30 mm — HDI / BGA laser-drilled (Phase C)': internal roadmap copy, and picking it places a 0.1 mm THROUGH via (S4, confirmed)</summary>

- Area designer.pcb · stack B · design 2a4c5318-4bea-4e32-841b-2750b998e9d4 · themes dark · viewports 1440x900
- Repro:
  1. QA-f2b-4L → PCB → R → start a route → open the via preset chip ('Standard 4L ▾')
- Expected: Only presets the board/fab can build (or disabled with a reason); no internal phase names in UI copy; a microvia preset should create a microvia (layer-adjacent) or not be listed.
- Actual: The last entry reads 'Microvia 0.10 / 0.30 mm · HDI / BGA laser-drilled (Phase C)'. The route tool always commits viaType 'through', so this preset yields a 0.1 mm-drill through via spanning all layers (below every fab preset's drill minimum). 'Standard 4L — Default for 4-layer (JLCPCB 4L min)' is listed as the default even when the board minimum (0.8 mm) rejects it (see F2B-003).
- Screenshots: [030-4L-via-preset-menu](../evidence/shots/f2b/dark/030-4L-via-preset-menu.png)
- Code: `src/modules/designer/backend/pcb/via-presets.ts:73` — description 'HDI / BGA laser-drilled (Phase C)'
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:2546` — route vias always viaType 'through'
- Suggested fix: Drop 'Microvia' from the route-time list until microvias exist, remove '(Phase C)', and grey out presets below the resolved board minimum with a tooltip.
- Verification (vf2b): **confirmed** — Reproduced on QA-f2b-4L: the via preset menu lists 'Microvia 0.10 / 0.30 mm . HDI / BGA laser-drilled (Phase C)' (via-presets.ts:68-73). Route vias are always sent without viaType and become 'through' (command-executor.ts:536, PcbCanvas.tsx:2546 candidate). Nuance: on this board the 0.10 mm drill is below the 0.40 board minimum, so picking it produces the generic 'Command failed' refusal (F2B-004) rather than a via; on a board whose minimums allow it, a 0.1 mm-drill through via would be created. Internal roadmap copy in UI confirmed; S4 kept. · evidence: [009-4L-via-preset-menu](../evidence/shots/vf2b/dark/009-4L-via-preset-menu.png)

</details>


## T-206

**Tune (U) and Measure are hotkey-only and Bundle routing is unreachable: no toolbar/menu entry exposes them**

- Severity **S4** · category stub · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate S
- Findings: Q4-035 · known ref K13

**Summary.** Tune (pcb.lengthTuning) is reachable only by pressing U; Measure only by M or the empty-canvas context menu; Bundle (K13) not at all. While Tune is active no toolbar button shows a pressed state and the status-bar hint still says 'Click to select…'. The Tune row also shows 'no net' for the picked trace and an 'Enter apply' that is disabled until a target is typed, with no explanation. K13 confirmed: nothing in PcbCa…

**Root cause.** `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:646` — 'Measure (M), Tune (U) and Bundle stay hotkey-only'

**Proposed fix.** Remove dead Bundle leftovers (keep pcb.bundleRouting flag); expose Measure in View/Add menu. — Detail: Add a split button next to Route (Route / Tune length / Bundle) or put Tune/Measure/Bundle in the Add ▾ or a Tools ▾ menu with hotkey hints; show the pressed state while active; label 'Enter apply' with a tooltip 'Set a target length first'.

**Note.** Binding: Bundle — remove dead leftovers, keep flag.

**Evidence.** [177-tune-click-trace](../evidence/shots/q4/dark/177-tune-click-trace.png), [027-ctx-empty](../evidence/shots/vq4/dark/027-ctx-empty.png)

<details><summary>Q4-035 — Tune (U) and Measure are hotkey-only and Bundle routing is unreachable: no toolbar/menu entry exposes them (S4, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. Dual LED Blinker → PCB
  2. Look for a Tune / length-matching control in the toolbar, Add ▾, View ▾, right-click menus
  3. Press U over the canvas → 'Tune — click a routed trace…' row appears
- Expected: Every tool discoverable from the toolbar (e.g. Route ▾ → Tune length (U), Bundle) with the hotkey in the tooltip, like Route (R) / Board (O)
- Actual: Tune (pcb.lengthTuning) is reachable only by pressing U; Measure only by M or the empty-canvas context menu; Bundle (K13) not at all. While Tune is active no toolbar button shows a pressed state and the status-bar hint still says 'Click to select…'. The Tune row also shows 'no net' for the picked trace and an 'Enter apply' that is disabled until a target is typed, with no explanation. K13 confirmed: nothing in PcbCanvas/PcbTopToolbar ever calls setToolMode('bundle') (only 'toolMode === "bundle"' checks exist), so the Bundle tool behind pcb.bundleRouting cannot be entered by any key, button or menu.
- Screenshots: [177-tune-click-trace](../evidence/shots/q4/dark/177-tune-click-trace.png), [178-tune-active](../evidence/shots/q4/dark/178-tune-active.png), [180-tune-target-set](../evidence/shots/q4/dark/180-tune-target-set.png), [027-ctx-empty](../evidence/shots/vq4/dark/027-ctx-empty.png)
- Code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:646` — 'Measure (M), Tune (U) and Bundle stay hotkey-only'
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:348` — 'bundle' tool mode declared; no setter anywhere
- Code: `src/core/contracts/feature-flags/registry.ts:106` — pcb.lengthTuning / pcb.bundleRouting availability 'dev'
- Suggested fix: Add a split button next to Route (Route / Tune length / Bundle) or put Tune/Measure/Bundle in the Add ▾ or a Tools ▾ menu with hotkey hints; show the pressed state while active; label 'Enter apply' with a tooltip 'Set a target length first'.
- Verification (vq4): **confirmed** — Code-confirmed: nothing calls setToolMode('bundle') (only toolMode==='bundle' checks), and PcbTopToolbar.tsx:646 documents that Measure/Tune/Bundle are hotkey-only. Downgraded to S4: Tune and Bundle sit behind pcb.lengthTuning / pcb.bundleRouting, both availability 'dev' (registry.ts:106-114), so release builds never show them. Measure is reachable from the empty-canvas context menu ('Measure distance M'). PLAN Run 2 follow-ups already record 'Bundle tool has no entry point'. Must be fixed before those flags graduate. · evidence: [027-ctx-empty](../evidence/shots/vq4/dark/027-ctx-empty.png)

</details>


## T-207

**Components panel: Shift/Cmd+click does not multi-select and instead leaves a native text-selection highlight across rows**

- Severity **S4** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate XS
- Findings: Q4-037

**Summary.** Only R2 is selected; R1's footprint/value text stays highlighted in browser selection blue for the rest of the session (visible in later screenshots).

**Root cause.** `src/modules/designer/frontend/pcb/PcbComponentsPanel.tsx:1` — row onClick selects single placement

**Proposed fix.** Components panel: Shift/Cmd multi-select, user-select-none on rows. — Detail: Add select-none to rows and honour shiftKey/metaKey in the row click handler (toggle/add to selection).

**Evidence.** [173-multi-rows](../evidence/shots/q4/dark/173-multi-rows.png), [049-shift-click-rows](../evidence/shots/vq4/dark/049-shift-click-rows.png)

<details><summary>Q4-037 — Components panel: Shift/Cmd+click does not multi-select and instead leaves a native text-selection highlight across rows (S4, confirmed)</summary>

- Area designer.pcb · stack A · design c2c58a19 · themes dark · viewports 1440x900
- Repro:
  1. Dual LED Blinker → PCB → Components panel
  2. Click 'R1', then Shift+click 'R2'
- Expected: Range/additive selection like the canvas (Shift+click to add), no text highlight (user-select:none on rows)
- Actual: Only R2 is selected; R1's footprint/value text stays highlighted in browser selection blue for the rest of the session (visible in later screenshots).
- Screenshots: [173-multi-rows](../evidence/shots/q4/dark/173-multi-rows.png), [174-box-select](../evidence/shots/q4/dark/174-box-select.png), [049-shift-click-rows](../evidence/shots/vq4/dark/049-shift-click-rows.png)
- Code: `src/modules/designer/frontend/pcb/PcbComponentsPanel.tsx:1` — row onClick selects single placement
- Suggested fix: Add select-none to rows and honour shiftKey/metaKey in the row click handler (toggle/add to selection).
- Verification (vq4): **confirmed** — Reproduced: click R1 row, Shift+click R2 row → only R2 selected ('R2 · R_0603_1608Metric'); window.getSelection() = 'R_0603_1608Metric 220Ω R2' (native text highlight). · evidence: [049-shift-click-rows](../evidence/shots/vq4/dark/049-shift-click-rows.png)

</details>


## T-208

**Selection filter panel ignores Esc and survives view switches; only F or its × closes it**

- Severity **S4** · category keyboard · status confirmed · themes light
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate XS
- Findings: Q4-048

**Summary.** Esc leaves the panel open; it is still open after DRC view → PCB and overlaps the canvas top-right; pressing F again closes it.

**Root cause.** `src/modules/designer/frontend/pcb/PcbSelectionFilter.tsx:46` — no Escape handling

**Proposed fix.** Selection filter closes on Esc and on view switch. — Detail: Handle Escape in the PCB keymap (close filter first, before clearing selection) and close the panel on view change.

**Evidence.** [019-selection-filter](../evidence/shots/q4/light/019-selection-filter.png), [038-selection-filter](../evidence/shots/vq4/dark/038-selection-filter.png)

<details><summary>Q4-048 — Selection filter panel ignores Esc and survives view switches; only F or its × closes it (S4, confirmed)</summary>

- Area designer.pcb · stack A · design 5909d519 · themes light · viewports 1440x900
- Repro:
  1. PCB, nothing selected → press F → 'SELECTION FILTER' floating panel
  2. Press Esc (canvas hovered)
  3. Switch to the DRC view tab and back to PCB
- Expected: Esc closes transient floating panels (like menus/pickers); panel does not reappear after navigating away
- Actual: Esc leaves the panel open; it is still open after DRC view → PCB and overlaps the canvas top-right; pressing F again closes it.
- Screenshots: [019-selection-filter](../evidence/shots/q4/light/019-selection-filter.png), [022-alt-solo-toast](../evidence/shots/q4/light/022-alt-solo-toast.png), [038-selection-filter](../evidence/shots/vq4/dark/038-selection-filter.png)
- Code: `src/modules/designer/frontend/pcb/PcbSelectionFilter.tsx:46` — no Escape handling
- Suggested fix: Handle Escape in the PCB keymap (close filter first, before clearing selection) and close the panel on view change.
- Verification (vq4): **confirmed** — Reproduced: after F, Esc with the canvas hovered leaves the 'Selection filter' dialog in the accessibility tree; it also survives DRC→PCB view switches. No Escape handling in PcbSelectionFilter.tsx; the keymap Escape branch (PcbCanvas.tsx:4977) doesn't close it. · evidence: [038-selection-filter](../evidence/shots/vq4/dark/038-selection-filter.png)

</details>


## T-209

**PCB toolbar tooltips incomplete: Flip part/Fit board omit hotkeys, disabled Flip gives no reason, 'Add' tooltip omits Comment, DRC tooltip is just 'DRC'**

- Severity **S4** · category copy · status confirmed · themes dark
- Recommendation **fix-now** · owner D3 · wave W2 · scope frontend · estimate XS
- Findings: Q4-051

**Summary.** titles: 'Fit board', 'Flip part' (disabled, no 'select a part' hint, F hotkey missing), 'Add hole, pad, text, zone, or keepout' (menu also has Comment), 'DRC' (badge meaning undefined — see Q4-001). Undo/Redo/Route/Board include hotkeys, so the set is inconsistent.

**Root cause.** `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:650` — frozen accessible names; titles composed by ToolbarButton

**Proposed fix.** Complete toolbar tooltips (hotkeys, disabled reasons, Comment in Add). — Detail: In PcbTopToolbar pass richer titles while keeping aria-labels frozen (D9): 'Flip part (F)' and, when disabled, 'Flip part (F) — select a footprint first'; 'Add hole, pad, text, zone, keepout or comment'; DRC 'Design rule check — {errors} errors, {warnings} warnings' (see Q4-001).

**Evidence.** [120-shape-Oval](../evidence/shots/q4/dark/120-shape-Oval.png), [001-pcb](../evidence/shots/vq4/dark/001-pcb.png)

<details><summary>Q4-051 — PCB toolbar tooltips incomplete: Flip part/Fit board omit hotkeys, disabled Flip gives no reason, 'Add' tooltip omits Comment, DRC tooltip is just 'DRC' (S4, confirmed)</summary>

- Area designer.pcb · stack A · design 5909d519 · themes dark · viewports 1440x900
- Repro:
  1. PCB view, nothing selected
  2. Hover each toolbar button / read title attributes
- Expected: Every tool tooltip names the action + hotkey (Flip part (F), Fit board (Home/0)…), disabled buttons explain why, DRC button says what the badge counts ('Run / show DRC — 32 errors')
- Actual: titles: 'Fit board', 'Flip part' (disabled, no 'select a part' hint, F hotkey missing), 'Add hole, pad, text, zone, or keepout' (menu also has Comment), 'DRC' (badge meaning undefined — see Q4-001). Undo/Redo/Route/Board include hotkeys, so the set is inconsistent.
- Screenshots: [120-shape-Oval](../evidence/shots/q4/dark/120-shape-Oval.png), [001-pcb](../evidence/shots/vq4/dark/001-pcb.png)
- Console: `Fit board \| title=Fit board; Flip part \| title=Flip part \| disabled=true; Add \| title=Add hole, pad, text, zone, or keepout; DRC \| title=DRC`
- Code: `src/modules/designer/frontend/pcb/PcbTopToolbar.tsx:650` — frozen accessible names; titles composed by ToolbarButton
- Suggested fix: In PcbTopToolbar pass richer titles while keeping aria-labels frozen (D9): 'Flip part (F)' and, when disabled, 'Flip part (F) — select a footprint first'; 'Add hole, pad, text, zone, keepout or comment'; DRC 'Design rule check — {errors} errors, {warnings} warnings' (see Q4-001).
- Verification (vq4): **confirmed** — Confirmed via title attributes: 'Fit board', 'Flip part' (disabled, no F hint or reason), 'Add hole, pad, text, zone, or keepout' (the menu also has Comment), 'DRC'. Correction: Fit board has no hotkey in the PCB keymap, so its title is accurate and the suggested '(Home/0)' is dropped. · evidence: [001-pcb](../evidence/shots/vq4/dark/001-pcb.png)

</details>

