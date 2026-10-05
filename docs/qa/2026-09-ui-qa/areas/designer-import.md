# designer.import — QA findings

[← index](../README.md) · 9 triage entries · S1 2 · S2 2 · S3 5 · S4 0

| TID | Sev | Title | Findings | Rec | Owner / wave | Scope | Est |
|---|---|---|---|---|---|---|---|
| [T-244](#t-244) | S1 | KiCad project import: every 90°/270°-rotated part gets pads 1/2 swapped under its imported traces, and the whole board comes in as a Y-mirror of the KiCad design | F2B-001 | decide (DEC-IMP) | D4 / W2 | backend | M |
| [T-245](#t-245) | S1 | KiCad import leaves 78% of imported copper without a net: trace/via netName '/VBUS', 'Net-(D1-K)' never binds to the schematic's 'VBUS', 'Net_1' — DRC floods with false same-net clearance errors and fab net attributes disagree | F2B-002 | decide (DEC-IMP) | D4 / W2 | backend | M |
| [T-246](#t-246) | S2 | Imported board rules contradict the imported net class: KiCad Default vias 0.6/0.3 but board minimum stays at OpenPCB's 0.8/0.4 — all 44 vias fail DRC ×4, synthetic 'GND'/'Power' classes add 123 warnings, and every via the router places is rejected | F2B-003 | decide (DEC-IMP) | D4 / W2 | backend | S |
| [T-247](#t-247) | S2 | KiCad project import silently drops parts (USB-C J1) and the wizard never shows the commit warnings | Q5-019 | fix-now | D1+D4 / W2 | frontend | M |
| [T-248](#t-248) | S3 | A 4/6-layer KiCad import opens with every inner layer hidden — the In2 ground plane and inner tracks look missing until the user finds the eye icons | F2B-012 | decide (DEC-IMP) | D4 / W2 | backend | XS |
| [T-249](#t-249) | S3 | KiCad import silently drops all board-level graphics: 7 silkscreen texts ('USB to UART', knockout 'Ampnics', GND/VCC/RX/TX/RST pin legends) never reach the PCB or the Gerber | F2B-015 | decide (DEC-IMP) | D4 / W2 | backend | M |
| [T-250](#t-250) | S3 | KiCad import wizard copy is stale and alarming: claims only name/layers/outline import, lists every component as 'missing', shows raw warning codes | Q5-021 | fix-now | D4 / W2 | frontend | XS |
| [T-251](#t-251) | S3 | KiCad/library inspect endpoints return 500 for invalid user files | Q5-022, Q7-007 | decide (DEC-IMP) | D4+L1 / W2 | backend | XS |
| [T-252](#t-252) | S3 | KiCad import dialog is a hand-rolled always-dark modal: no focus management/trap, unlabelled name field, off-token slate/violet/amber/emerald styling | Q5-029 | fix-now | D4 / W2 | frontend | S |

## T-244

**KiCad project import: every 90°/270°-rotated part gets pads 1/2 swapped under its imported traces, and the whole board comes in as a Y-mirror of the KiCad design**

- Severity **S1** · category data · status confirmed · themes dark, light
- Recommendation **decide** · decision DEC-IMP · owner D4 · wave W2 · scope backend · estimate M
- Findings: F2B-001

**Summary.** insert-pcb.ts copies KiCad positions, rotations, track and via coordinates verbatim into the Y-up board, so the board is a vertical mirror image (OpenPCB F_Cu: J2 pin 1 at Y=+131.925, KiCad's Gerber at Y=−131.925, i.e. pin 1 bottom instead of top). Worse, the mirroring is not consistent: comparing all 66 OpenPCB F_Cu pad flashes to KiCad's Gerber (Y negated), 48 match but all 18 pads of the 9 parts rotated 90°/270°…

**Root cause.** `src/modules/designer/backend/import/kicad-project/insert-pcb.ts:143` — placement positionMm {fp.at.xMm, fp.at.yMm} and rotationDeg copied verbatim from Y-down KiCad

**Proposed fix.** Backend import: correct Y-mirror and pad rotation for 90/270° parts. — Detail: Define one KiCad->OpenPCB transform and apply it everywhere in insert-pcb.ts / commit.ts: y' = -y for placement positions, track and via points, zone/keepout polygons and the Edge.Cuts outline; KEEP rotationDeg unchanged (KiCad's positive angle is CCW as seen on screen, i.e. already math-CCW in a Y-up frame). This is only correct together with the Q7-022 fix (footprint geometry flipped to Y-up in @openpcb/kicad-import); with both, pad = (x, -y) + R_ccw(theta)(px, -py), which equals KiCad's Gerber pad flash. Verify…

**Evidence.** [003-2L-pcb](../evidence/shots/f2b/dark/003-2L-pcb.png), [001-2L-pcb](../evidence/shots/vf2b/dark/001-2L-pcb.png)

<details><summary>F2B-001 — KiCad project import: every 90°/270°-rotated part gets pads 1/2 swapped under its imported traces, and the whole board comes in as a Y-mirror of the KiCad design (S1, confirmed)</summary>

- Area designer.import · stack B · design 4ed2e1e5-3333-49d1-b27e-c1b3d2ef2dd4 · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B: Home → Import KiCad… → Choose ZIP… → $QA/f2b/QA-f2b-2L.zip (the unmodified USBtoUART project) → name QA-f2b-2L → Import design
  2. PCB tab: compare with the project's own Docs/top_image.png (KiCad render): J2's square pin-1 (GND) pad is at the TOP in KiCad and at the BOTTOM in OpenPCB; R3 top vs bottom, D1 top-right vs bottom-right
  3. Export… → Export anyway → Download ZIP; compare F_Cu pad flashes (%TO.P) with the KiCad Gerbers shipped in the project (grbr.zip)
  4. Run DRC → 17 NET_SHORT_CIRCUIT errors
- Expected: Imported board is the same board KiCad would manufacture: KiCad Y-down coordinates converted to OpenPCB Y-up (y → −y, rotation handedness adjusted), each pad landing under the trace that KiCad routed to it; exported Gerber pads coincide with KiCad's own Gerbers.
- Actual: insert-pcb.ts copies KiCad positions, rotations, track and via coordinates verbatim into the Y-up board, so the board is a vertical mirror image (OpenPCB F_Cu: J2 pin 1 at Y=+131.925, KiCad's Gerber at Y=−131.925, i.e. pin 1 bottom instead of top). Worse, the mirroring is not consistent: comparing all 66 OpenPCB F_Cu pad flashes to KiCad's Gerber (Y negated), 48 match but all 18 pads of the 9 parts rotated 90°/270° (C1–C4, R1, R2, D3–D5) have pad 1 and pad 2 swapped (0.64 mm / 1.32 mm off). The imported traces therefore end on the wrong pads: DRC reports 17 'Short circuit: unassigned copper chain bridges nets …' errors on a board that is clean in KiCad. A fab built from this export would get a mirrored board with swapped passives/TVS diodes.
- Screenshots: [003-2L-pcb](../evidence/shots/f2b/dark/003-2L-pcb.png), `f2b/src/KiCad_Example_Project_USBtoUART/Docs/top_image.png`, [004-2L-drc-dock](../evidence/shots/f2b/dark/004-2L-drc-dock.png)
- Console: `padcmp: 48 pads match KiCad (Y negated), 18 mismatch: C1.1 (146.5,136.82) vs KiCad (146.5,136.18); C1.2 swapped; D3.1 (147.0,138.68) vs (147.0,140.0); R1.1 (144.5,134.18) vs (144.5,134.82) …`; `OpenPCB F_Cu %TO.P,J2,1% X163.625 Y131.925 vs KiCad F_Cu %TO.P,J2,1,Pin_1% X163.625 Y-131.925`
- Network: `POST /imports/kicad-project → 201 (no warning about coordinates or gr_text)`; `GET /designs/4ed2e1e5…/projection/pcb → placements C1 {146.5,136.5} rot 270 … overlayTexts: 0`; `GET /designs/4ed2e1e5…/drc → 17 × NET_SHORT_CIRCUIT`
- Code: `src/modules/designer/backend/import/kicad-project/insert-pcb.ts:143` — placement positionMm {fp.at.xMm, fp.at.yMm} and rotationDeg copied verbatim from Y-down KiCad
- Code: `src/modules/designer/backend/import/kicad-project/insert-pcb.ts:169` — track points copied verbatim (no Y flip)
- Code: `src/modules/designer/backend/import/kicad-project/insert-pcb.ts:210` — via centreMm verbatim
- Code: `src/modules/designer/backend/import/kicad-project/commit.ts:368` — outline polygon passed through buildBoardSettings unflipped (same transform must apply)
- Code: `node_modules/@openpcb/kicad-import/dist/build-preview-models.js:121` — footprint pad/graphic geometry kept Y-down (Q7-022 / Q6-023)
- Suggested fix: Define one KiCad->OpenPCB transform and apply it everywhere in insert-pcb.ts / commit.ts: y' = -y for placement positions, track and via points, zone/keepout polygons and the Edge.Cuts outline; KEEP rotationDeg unchanged (KiCad's positive angle is CCW as seen on screen, i.e. already math-CCW in a Y-up frame). This is only correct together with the Q7-022 fix (footprint geometry flipped to Y-up in @openpcb/kicad-import); with both, pad = (x, -y) + R_ccw(theta)(px, -py), which equals KiCad's Gerber pad flash. Verify back-side (B.Cu, mirrored) placements separately. Add a round-trip test that imports USBtoUART and asserts every exported F_Cu/B_Cu pad flash equals KiCad's Gerber pad flash (the 66-pad comparison in vf2b/padcheck.py is a ready oracle).
- Verification (vf2b): **confirmed** — Reproduced independently: fresh API export (POST /exports/gerber?format=json) of QA-f2b-2L (rev 0, stack B) compared with the project's own KiCad Gerbers (grbr.zip) using my own script vf2b/padcheck.py: 48 of 66 F_Cu pad flashes equal KiCad with Y negated, 0 match verbatim (the whole board is a vertical mirror of what KiCad manufactures; J2 pin 1 at Y+131.925 vs KiCad Y-131.925), and all 18 mismatching pads are exactly the pad-1/pad-2 pairs of the 90/270-degree parts C1-C4, R1, R2, D3-D5, each landing on the other pad's KiCad location. Canvas shows D1/C labels at the bottom where KiCad's top_image has them at the top. Persisted DRC: 17 NET_SHORT_CIRCUIT. Root cause re-derived: insert-pcb.ts:141-147 copies position and rotation verbatim, :163-181 track points, :210 via centres; the footprint pad offsets are also still Y-down (Q7-022), so pad = P + R_ccw(theta)*p_ydown, which agrees with KiCad only when sin(theta)=0. Not an environment artefact and not intended (the Y-up world is established by the cursor readout and the Gerber writer). Related to but distinct from Q7-022 (S1, footprint geometry): fixing only Q7-022 still leaves the 90/270 swap and additionally breaks 0-degree parts with vertical pad rows (J2), so both fixes must land together. The raw suggestedFix's rotation rule is wrong and has been corrected (KiCad's CCW-on-screen angle is already the math-CCW angle in a Y-up frame, so the rotation value must be kept). · evidence: [001-2L-pcb](../evidence/shots/vf2b/dark/001-2L-pcb.png), f2b/src/KiCad_Example_Project_USBtoUART/Docs/top_image.png, vf2b/exp/2L/openpcb-4ed2e1e5-3333-49d1-b27e-c1b3d2ef-F_Cu.gbr, vf2b/padcheck.py, vf2b/data/drc-2L.json

</details>


## T-245

**KiCad import leaves 78% of imported copper without a net: trace/via netName '/VBUS', 'Net-(D1-K)' never binds to the schematic's 'VBUS', 'Net_1' — DRC floods with false same-net clearance errors and fab net attributes disagree**

- Severity **S1** · category data · status confirmed · themes dark, light
- Recommendation **decide** · decision DEC-IMP · owner D4 · wave W2 · scope backend · estimate M
- Findings: F2B-002

**Summary.** Only GND binds. 142 of 183 traces and 15 of 44 vias have netId null (netName '/VBUS' ×43, '/D+' ×14, 'Net-(D2-K)' ×13, '/D-' ×13, 'Net-(D1-K)' ×11, '/RX' ×11 …). The schematic names the same nets 'VBUS', 'D+', 'Net_1'…'Net_38', and bindNetName matches by exact (case-folded) name only. Effects: DRC reports TRACE_TO_TRACE_CLEARANCE errors between two traces of the same KiCad net ('/RX'↔'/RX' 0.154 mm, '/VBUS'↔'/VBUS'…

**Root cause.** `src/modules/designer/backend/import/kicad-project/insert-pcb.ts:162` — netId null at insert, relies on projection name binding

**Proposed fix.** Backend import: bind KiCad net names ('/VBUS', 'Net-(D1-K)') to schematic nets. — Detail: At import time resolve each KiCad net to a schematic net by pad membership (KiCad pad (net N) + footprint ref/pad → schematic pin → net id) and persist netId on traces/vias/zones; at minimum normalise hierarchical '/' prefixes. Name schematic nets after the KiCad net names (keep 'Net-(D1-K)') and merge same-named labels into one net. Add an import warning when any copper stays unbound.

**Evidence.** [004-2L-drc-dock](../evidence/shots/f2b/dark/004-2L-drc-dock.png), [001-2L-pcb](../evidence/shots/vf2b/dark/001-2L-pcb.png)

<details><summary>F2B-002 — KiCad import leaves 78% of imported copper without a net: trace/via netName '/VBUS', 'Net-(D1-K)' never binds to the schematic's 'VBUS', 'Net_1' — DRC floods with false same-net clearance errors and fab net attributes disagree (S1, confirmed)</summary>

- Area designer.import · stack B · design 4ed2e1e5-3333-49d1-b27e-c1b3d2ef2dd4 · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B: import $QA/f2b/QA-f2b-2L.zip (unmodified USBtoUART project) as QA-f2b-2L
  2. GET /api/modules/designer/designs/4ed2e1e5…/projection/pcb (read-only) and count traces/vias whose netId is null
  3. PCB → DRC dock → Run DRC; inspect TRACE_TO_TRACE_CLEARANCE entries
  4. Board panel Summary 'Nets'; Edit rules… → Net assignments list
  5. Export… → Export anyway → Download; grep %TO.N in F_Cu.gbr
- Expected: Every imported track/via/zone is bound to its net (KiCad hierarchical names '/VBUS' ≡ label 'VBUS'; auto names 'Net-(D1-K)' mapped by pad membership, not by name); nets keep the KiCad names; DRC on a KiCad-clean board reports only genuine issues.
- Actual: Only GND binds. 142 of 183 traces and 15 of 44 vias have netId null (netName '/VBUS' ×43, '/D+' ×14, 'Net-(D2-K)' ×13, '/D-' ×13, 'Net-(D1-K)' ×11, '/RX' ×11 …). The schematic names the same nets 'VBUS', 'D+', 'Net_1'…'Net_38', and bindNetName matches by exact (case-folded) name only. Effects: DRC reports TRACE_TO_TRACE_CLEARANCE errors between two traces of the same KiCad net ('/RX'↔'/RX' 0.154 mm, '/VBUS'↔'/VBUS' 0.054 mm, '/D-'↔'/D-' 0.050 mm — 14 of 14 are same-net), UNCONNECTED_NET ×10 ('Net "RX" is not fully routed') for routed nets, and short-circuit messages name 'unassigned copper chains'. Board Summary shows 'Nets 51' for a 36-net design; Net assignments list shows 'VBUS' twice and anonymous 'Net_1…Net_38' instead of 'Net-(U1-VDD)' etc. (4 schematic nets named VBUS, 2 each D+/D−/RST). The exported F_Cu Gerber tags the same electrical net with two names (%TO.N,/VBUS on 38 track objects vs pad nets 'VBUS'/'Net_12'), so a fab netlist compare would flag opens.
- Screenshots: [004-2L-drc-dock](../evidence/shots/f2b/dark/004-2L-drc-dock.png), [005-2L-design-rules](../evidence/shots/f2b/dark/005-2L-design-rules.png)
- Console: `F_Cu.gbr %TO.N counts: /VBUS 38, /D+ 12, /D- 12, Net-(D2-K) 11 … and Net_1, Net_10, Net_11 … for pads`
- Network: `GET /designs/4ed2e1e5…/projection/pcb → traces netId null: 142/183; vias netId null: 15/44; netNames: 51 ids / 45 unique names`; `GET /designs/4ed2e1e5…/drc → 230 errors / 318 warnings: TRACE_TO_TRACE_CLEARANCE 14 (all same KiCad net), NET_SHORT_CIRCUIT 17, UNCONNECTED_NET 10`
- Code: `src/modules/designer/backend/import/kicad-project/insert-pcb.ts:162` — netId null at insert, relies on projection name binding
- Code: `src/modules/designer/backend/pcb/pcb-projection.ts:121` — netIdByName.get(entity.netName.trim().toUpperCase()): '/VBUS' != 'VBUS', 'Net-(D1-K)' != 'Net_N'
- Code: `src/modules/designer/backend/import/kicad-project/insert-schematic.ts:1` — schematic nets named Net_N / duplicated labels instead of KiCad net names (see Q3-013 for label merging)
- Suggested fix: At import time resolve each KiCad net to a schematic net by pad membership (KiCad pad (net N) + footprint ref/pad → schematic pin → net id) and persist netId on traces/vias/zones; at minimum normalise hierarchical '/' prefixes. Name schematic nets after the KiCad net names (keep 'Net-(D1-K)') and merge same-named labels into one net. Add an import warning when any copper stays unbound.
- Verification (vf2b): **confirmed** — Reproduced from the current projection of QA-f2b-2L (GET /projection/pcb, read-only): 142/183 traces and 15/44 vias have netId null; the unbound netNames are '/VBUS' 43, '/D+' 14, 'Net-(D2-K)' 13, '/D-' 13, 'Net-(D1-K)' 11, '/RX' 11 ...; only 'GND' (41 traces) binds. The schematic side has 51 net ids with 'VBUS' x4, D+/D-/RST x2 and 38 anonymous 'Net_N' names although the .kicad_pcb declares 36 nets with KiCad names. pcb-projection.ts:107-121 binds by exact upper-cased name only, so '/VBUS' never meets 'VBUS'. Persisted DRC shows the consequences: TRACE_TO_TRACE_CLEARANCE 14 (sampled messages are same-KiCad-net pairs), UNCONNECTED_NET 10 ('Net "RX" is not fully routed'), NET_SHORT_CIRCUIT messages naming 'unassigned copper chain'. Board panel Summary reads 'Nets 51' (screenshot). Independent of F2B-001 (name-based, not geometry). Severity kept S1: the imported board loses the net membership of 78% of its copper and DRC/ratsnest on it are meaningless; mitigating note for triage: netName is persisted and binding happens at projection time, so a bindNetName fix heals existing imports retroactively. The duplicate VBUS/D+/D-/RST nets share the root cause of Q3-013 (same-named labels stay separate nets) on the schematic side. · evidence: [001-2L-pcb](../evidence/shots/vf2b/dark/001-2L-pcb.png), vf2b/data/proj-4ed2e1e5-3333-49d1-b27e-c1b3d2ef2dd4.json, vf2b/data/drc-2L.json

</details>


## T-246

**Imported board rules contradict the imported net class: KiCad Default vias 0.6/0.3 but board minimum stays at OpenPCB's 0.8/0.4 — all 44 vias fail DRC ×4, synthetic 'GND'/'Power' classes add 123 warnings, and every via the router places is rejected**

- Severity **S2** · category data · status confirmed · themes dark
- Recommendation **decide** · decision DEC-IMP · owner D4 · wave W2 · scope backend · estimate S
- Findings: F2B-003

**Summary.** Design rules keep OpenPCB defaults (min via Ø 0.80 / drill 0.40, annular 0.20, drill 0.40) while the Default class is imported as via 0.6/0.3, so all 44 KiCad vias raise VIA_DIAMETER_MIN + VIA_DRILL_MIN + DRILL_SIZE_MIN + ANNULAR_RING_MIN = 176 of the 230 DRC errors ('Via pad diameter 0.600 mm is below the minimum 0.800 mm'). 'netClassesIngested: 3' although the project defines one class: OpenPCB's 'Power' and 'GND'…

**Root cause.** `src/modules/designer/backend/import/kicad-project/commit.ts:373` — mergeNetClasses(base.netClasses, report.netClasses) keeps Power/GND

**Proposed fix.** Backend import: board minimums from KiCad setup/net classes. — Detail: In buildBoardSettings: replace (not merge) net classes with the project's; clamp board minimums to ≤ the smallest imported class value (or use KiCad's built-in defaults when 'rules' is empty) and pick fabricator from layerCount (jlcpcb_4l for 4 layers); resolve the router's class from the same resolver DRC uses. Add an import warning listing any rule that had to be defaulted.

**Evidence.** [005-2L-design-rules](../evidence/shots/f2b/dark/005-2L-design-rules.png), [001-2L-pcb](../evidence/shots/vf2b/dark/001-2L-pcb.png)

<details><summary>F2B-003 — Imported board rules contradict the imported net class: KiCad Default vias 0.6/0.3 but board minimum stays at OpenPCB's 0.8/0.4 — all 44 vias fail DRC ×4, synthetic 'GND'/'Power' classes add 123 warnings, and every via the router places is rejected (S2, confirmed)</summary>

- Area designer.import · stack B · design 2a4c5318-4bea-4e32-841b-2750b998e9d4 · themes dark · viewports 1440x900
- Repro:
  1. Stack B: import $QA/f2b/QA-f2b-2L.zip (KiCad project: only a 'Default' net class, via 0.6/0.3, empty 'rules' block) → PCB → DRC dock → Run DRC
  2. Board panel → Edit rules…: Minimums and Net classes
  3. Import QA-f2b-4L.zip → PCB → R, press V mid-route (via preset shows 'Standard 4L' Ø0.60/⌀0.30 = the imported Default class) → allow violations → Enter
- Expected: Imported rules are internally consistent and reflect the KiCad project: board minimums not stricter than the project's own net-class vias (KiCad's built-in minimums, or the fab preset, when the project leaves 'rules' empty); only the net classes the project defines; the via size the router proposes is one the board accepts. A 4-layer import should also get a 4-layer fab preset.
- Actual: Design rules keep OpenPCB defaults (min via Ø 0.80 / drill 0.40, annular 0.20, drill 0.40) while the Default class is imported as via 0.6/0.3, so all 44 KiCad vias raise VIA_DIAMETER_MIN + VIA_DRILL_MIN + DRILL_SIZE_MIN + ANNULAR_RING_MIN = 176 of the 230 DRC errors ('Via pad diameter 0.600 mm is below the minimum 0.800 mm'). 'netClassesIngested: 3' although the project defines one class: OpenPCB's 'Power' and 'GND' classes are merged in and GND is auto-assigned to 'GND' (0.4 mm track, 0.8/0.4 via, 0.25 clearance) → 59 NETCLASS_TRACE_WIDTH + 32 NETCLASS_VIA_DIAMETER + 32 NETCLASS_VIA_DRILL warnings and 4 TRACE_TO_PAD errors at 0.25 mm. The route tool disagrees with DRC: while routing GND the status reads "0.20 mm · netclass 'Default'" and 'Class Default'. On the 4-layer import every smart via (V) is refused at commit — POST /commands pcb_commit_route → {ok:false, code:'INVALID_PCB_VIA', detail:'via diameter is below board minimum'} — even with 'allow violations' on. The 4-layer board also keeps fabricator 'jlcpcb_2l'.
- Screenshots: [005-2L-design-rules](../evidence/shots/f2b/dark/005-2L-design-rules.png), [004-2L-drc-dock](../evidence/shots/f2b/dark/004-2L-drc-dock.png), [026-4L-route-commit](../evidence/shots/f2b/dark/026-4L-route-commit.png), [027-4L-route-committed](../evidence/shots/f2b/dark/027-4L-route-committed.png)
- Network: `GET /designs/4ed2e1e5…/drc → ANNULAR_RING_MIN 44, DRILL_SIZE_MIN 44, VIA_DIAMETER_MIN 44, VIA_DRILL_MIN 44; NETCLASS_* (class "GND") 123`; `POST /designs/2a4c5318…/commands pcb_commit_route → INVALID_PCB_VIA 'via diameter is below board minimum'`; `GET /designs/2a4c5318…/projection/pcb → board.layerCount 4, fabricator 'jlcpcb_2l'`
- Code: `src/modules/designer/backend/import/kicad-project/commit.ts:373` — mergeNetClasses(base.netClasses, report.netClasses) keeps Power/GND
- Code: `src/modules/designer/backend/import/kicad-project/commit.ts:379` — applyKicadDesignRules keeps OpenPCB minimums when KiCad 'rules' is empty; fabricator never derived from layerCount
- Code: `src/modules/designer/backend/pcb/pcb-defaults.ts:64` — default min via 0.8/0.4
- Code: `src/shared/pcb-areas/net-class-resolver.ts:32` — GND name heuristic assigns the synthetic 'gnd' class
- Code: `src/modules/designer/backend/command-executor.ts:645` — commit gate rejects the class-sized via even with legality 'report'
- Suggested fix: In buildBoardSettings: replace (not merge) net classes with the project's; clamp board minimums to ≤ the smallest imported class value (or use KiCad's built-in defaults when 'rules' is empty) and pick fabricator from layerCount (jlcpcb_4l for 4 layers); resolve the router's class from the same resolver DRC uses. Add an import warning listing any rule that had to be defaulted.
- Verification (vf2b): **confirmed** — Verified from the projections and code: all four imports carry designRules.minimums viaDiameter 0.80 / viaDrill 0.40 / drill 0.40 / annular 0.20 (OpenPCB defaults, pcb-defaults.ts:60-66) next to the imported 'Default' class 0.6/0.3; netClasses = Default + Power + GND (mergeNetClasses keeps the OpenPCB defaults, commit.ts:563); the .kicad_pro has 'rules': {} and one class. Persisted 2L DRC: ANNULAR_RING_MIN 44, DRILL_SIZE_MIN 44, VIA_DIAMETER_MIN 44, VIA_DRILL_MIN 44, NETCLASS_TRACE_WIDTH 59, NETCLASS_VIA_DIAMETER/DRILL 32+32. GND is classified 'gnd' by the name heuristic (net-class-resolver.ts classIdForName). Reproduced the router side on QA-f2b-4L: routing from the GND via the status shows "GND 0.20 mm . netclass 'Default'" and 'via 0.60/0.30' while DRC judges GND with the 0.4 mm GND class; committing the route with 'allow violations' returned {ok:false, code:'INVALID_PCB_VIA', detail:'via diameter is below board minimum'} (captured from the /commands response). layerCount 4 with fabricator 'jlcpcb_2l' confirmed. The commit.ts comment says absent KiCad minimums deliberately keep OpenPCB defaults 'rather than inventing a number', but KiCad's own defaults are documented, not invented, and the result contradicts the imported class, so the choice is not a valid refutation. · evidence: [001-2L-pcb](../evidence/shots/vf2b/dark/001-2L-pcb.png), [008-4L-route-command-failed](../evidence/shots/vf2b/dark/008-4L-route-command-failed.png), [010-4L-routing-GND-1440](../evidence/shots/vf2b/dark/010-4L-routing-GND-1440.png), vf2b/data/drc-2L.json

</details>


## T-247

**KiCad project import silently drops parts (USB-C J1) and the wizard never shows the commit warnings**

- Severity **S2** · category data · status confirmed · themes dark
- Recommendation **fix-now** · owner D1+D4 · wave W2 · scope frontend · estimate M
- Findings: Q5-019

**Summary.** Only 18 parts: J1 (Connector:USB_C_Receptacle_USB2.0_16P, footprint USB_C_Receptacle_HRO_TYPE-C-31-M-12) is dropped from schematic, PCB and BOM. The commit response contains warnings 'component_unresolved … has 2 pad(s) with empty number (indices: 0, 1). Every pad must have a non-empty number', 'schematic_part_skipped_no_component J1', 'pcb_placement_skipped_no_part J1', but onImported() closes the wizard in the sam…

**Root cause.** `src/modules/designer/frontend/Space.tsx:1637` — onImported closes the wizard → DoneStage unreachable

**Proposed fix.** Keep wizard Done stage open listing commit warnings (skipped parts) with 'Open design'; pad-number root cause in @openpcb/kicad-import (follow-up). — Detail: Let validate-pads accept unnumbered NPTH/mechanical pads (assign synthetic ids or keep them as non-electrical) in @openpcb/kicad-import; in the wizard keep the Done stage open (list warnings grouped by severity, 'Open design' button) and only navigate on user confirmation; mark skipped parts in the review step (inspect can predict validation failures).

**Evidence.** [044-import-review](../evidence/shots/q5/dark/044-import-review.png), [006-import-review](../evidence/shots/vq5/light/006-import-review.png)

<details><summary>Q5-019 — KiCad project import silently drops parts (USB-C J1) and the wizard never shows the commit warnings (S2, confirmed)</summary>

- Area designer.import · stack A · design 70d12af0-c3c1-46e7-a9f7-d5b352df1eb0 · themes dark · viewports 1440x900
- Repro:
  1. Home → Import KiCad… → Choose ZIP… → fixtures/KiCad_Example_Project_USBtoUART.zip
  2. Review shows 'SCH symbols 19', 'PCB footprints 19'; rename to QA-q5-USBtoUART → Import design
  3. Wizard closes immediately and opens the design; inspect Schem outline / PCB / BOM
  4. Response of POST /imports/kicad-project
- Expected: All 19 parts imported (mechanical/NPTH pads with empty numbers are normal in KiCad footprints), or at minimum a Done step listing what was skipped and why, with the imported design flagged.
- Actual: Only 18 parts: J1 (Connector:USB_C_Receptacle_USB2.0_16P, footprint USB_C_Receptacle_HRO_TYPE-C-31-M-12) is dropped from schematic, PCB and BOM. The commit response contains warnings 'component_unresolved … has 2 pad(s) with empty number (indices: 0, 1). Every pad must have a non-empty number', 'schematic_part_skipped_no_component J1', 'pcb_placement_skipped_no_part J1', but onImported() closes the wizard in the same tick, so the DoneStage (warnings count, deferred list) is never rendered. Schematic keeps J1's dangling wires/labels; PCB traces run to an empty connector area; board shows '1 item outside outline'. Nothing tells the user the import is incomplete.
- Screenshots: [044-import-review](../evidence/shots/q5/dark/044-import-review.png), [046-import-result](../evidence/shots/q5/dark/046-import-result.png), [049-import-schem-panned](../evidence/shots/q5/dark/049-import-schem-panned.png), [050-import-pcb](../evidence/shots/q5/dark/050-import-pcb.png), [051-import-bom](../evidence/shots/q5/dark/051-import-bom.png)
- Network: `POST /api/modules/designer/imports/kicad-project → 201, warnings: component_unresolved J1 (empty pad numbers), schematic_part_skipped_no_component J1, pcb_placement_skipped_no_part J1, 65 synthetic ne`
- Code: `src/modules/designer/frontend/Space.tsx:1637` — onImported closes the wizard → DoneStage unreachable
- Code: `src/modules/designer/frontend/components/KicadProjectImportWizard.tsx:90` — setStage('done') then onImported(result)
- Code: `node_modules/@openpcb/kicad-import/dist/validate-pads.js:19` — rejects footprints with unnumbered (mechanical) pads
- Suggested fix: Let validate-pads accept unnumbered NPTH/mechanical pads (assign synthetic ids or keep them as non-electrical) in @openpcb/kicad-import; in the wizard keep the Done stage open (list warnings grouped by severity, 'Open design' button) and only navigate on user confirmation; mark skipped parts in the review step (inspect can predict validation failures).
- Verification (vq5): **confirmed** — Verified without a second commit (a commit on stack A would ingest library parts; library mutations are reserved for stack B): q5's imported design 70d12af0 has 18 schematic parts and 18 PCB placements with no J1 (183 traces, 44 vias). The fixture's J1 footprint USB_C_Receptacle_HRO_TYPE-C-31-M-12 has two np_thru_hole pads with empty numbers, which @openpcb/kicad-import validateFootprintPads rejects (dist/validate-pads.js:13-20). The wizard sets stage 'done' and calls onImported in the same tick (KicadProjectImportWizard.tsx:88-90) and Space.tsx:1637-1642 closes the wizard in onImported, so DoneStage (:152, :393) is unreachable. Re-inspecting the ZIP shows only the net-class warning in the review step — the J1 failure is not predicted. S2 kept. · evidence: [006-import-review](../evidence/shots/vq5/light/006-import-review.png), api: GET …/70d12af0…/projection/schematic -> 18 parts, no J1; projection/pcb -> 18 placements, no J1, fixture: J1 pads ('', np_thru_hole) x2

</details>


## T-248

**A 4/6-layer KiCad import opens with every inner layer hidden — the In2 ground plane and inner tracks look missing until the user finds the eye icons**

- Severity **S3** · category bug · status confirmed · themes dark, light
- Recommendation **decide** · decision DEC-IMP · owner D4 · wave W2 · scope backend · estimate XS
- Findings: F2B-012

**Summary.** GET projection right after import: layerCount 4, visibleLayers ['F.Cu','B.Cu','F.SilkS','Edge.Cuts','Drill','Metadata'] — In1/In2 not included (the importer keeps createDefaultPcbBoardSettings' 2-layer visibility). Mid-Layer 1/2 rows render greyed with the eye-off icon, the 7 In1 tracks, 4 In2 tracks and the In2 GND pour are not drawn. The same on the 6-layer and blind imports (and In3/In4 can't be shown at all, see…

**Root cause.** `src/modules/designer/backend/import/kicad-project/commit.ts:366` — buildBoardSettings spreads 2-layer defaults (visibleLayers) and only overrides layerCount

**Proposed fix.** Backend import: default-visible inner layers for 4/6-layer boards. — Detail: In buildBoardSettings add copperLayersForCount(layerCount) to visibleLayers (or derive default visibility from layerCount in createDefaultPcbBoardSettings); same when Board ▸ Stackup changes the layer count.

**Evidence.** [011-4L-pcb](../evidence/shots/f2b/dark/011-4L-pcb.png), [002-blind-pcb-open](../evidence/shots/vf2b/dark/002-blind-pcb-open.png)

<details><summary>F2B-012 — A 4/6-layer KiCad import opens with every inner layer hidden — the In2 ground plane and inner tracks look missing until the user finds the eye icons (S3, confirmed)</summary>

- Area designer.import · stack B · design 2a4c5318-4bea-4e32-841b-2750b998e9d4 · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B: import $QA/f2b/QA-f2b-4L.zip (tracks on In1/In2, GND zone on In2) → PCB tab
  2. Look at the canvas and the Layers panel rows 'Mid-Layer 1 / Mid-Layer 2'
- Expected: Imported copper layers that carry objects are visible on open (KiCad shows all enabled copper layers); at minimum all copper of the stackup is visible by default.
- Actual: GET projection right after import: layerCount 4, visibleLayers ['F.Cu','B.Cu','F.SilkS','Edge.Cuts','Drill','Metadata'] — In1/In2 not included (the importer keeps createDefaultPcbBoardSettings' 2-layer visibility). Mid-Layer 1/2 rows render greyed with the eye-off icon, the 7 In1 tracks, 4 In2 tracks and the In2 GND pour are not drawn. The same on the 6-layer and blind imports (and In3/In4 can't be shown at all, see F2B-007).
- Screenshots: [011-4L-pcb](../evidence/shots/f2b/dark/011-4L-pcb.png), [051-6L-pcb](../evidence/shots/f2b/dark/051-6L-pcb.png)
- Network: `GET /designs/2a4c5318…/projection/pcb (rev 0) → board.visibleLayers ['F.Cu','B.Cu','F.SilkS','Edge.Cuts','Drill','Metadata'], layerCount 4`
- Code: `src/modules/designer/backend/import/kicad-project/commit.ts:366` — buildBoardSettings spreads 2-layer defaults (visibleLayers) and only overrides layerCount
- Code: `src/modules/designer/backend/pcb/pcb-defaults.ts:43` — default visibleLayers F/B only
- Suggested fix: In buildBoardSettings add copperLayersForCount(layerCount) to visibleLayers (or derive default visibility from layerCount in createDefaultPcbBoardSettings); same when Board ▸ Stackup changes the layer count.
- Verification (vf2b): **confirmed** — Reproduced on the untouched QA-f2b-blind (rev 0, 4-layer import): GET /projection/pcb -> layerCount 4, visibleLayers ['F.Cu','B.Cu','F.SilkS','Edge.Cuts','Drill','Metadata']; in both themes the Mid-Layer 1/2 rows open greyed with 'Show layer' buttons and the 7 In1 / 4 In2 tracks and the In2 GND pour are not drawn. buildBoardSettings (commit.ts:366-378) spreads createDefaultPcbBoardSettings (visibleLayers F/B only, pcb-defaults.ts:43) and overrides only layerCount. · evidence: [002-blind-pcb-open](../evidence/shots/vf2b/dark/002-blind-pcb-open.png), [019-blind-pcb-inner-hidden](../evidence/shots/vf2b/light/019-blind-pcb-inner-hidden.png)

</details>


## T-249

**KiCad import silently drops all board-level graphics: 7 silkscreen texts ('USB to UART', knockout 'Ampnics', GND/VCC/RX/TX/RST pin legends) never reach the PCB or the Gerber**

- Severity **S3** · category data · status confirmed · themes dark
- Recommendation **decide** · decision DEC-IMP · owner D4 · wave W2 · scope backend · estimate M
- Findings: F2B-015

**Summary.** The .kicad_pcb has 7 gr_text on F.SilkS (one 'knockout'); projection overlayTexts: 0, overlayShapes: 0; the pin-header legend (GND/VCC/RX/TX/RST) and product name are gone from the PCB, 3D and F_Silkscreen.gbr, and the commit response has no warning about it (warnings list only J1, net-class metadata, zone split). ParsedKicadPcb has no field for board graphics at all.

**Root cause.** `src/modules/library/backend/infrastructure/parsers/kicad/kicad-pcb-parser.ts:43` — ParsedKicadPcb has no board graphics/text

**Proposed fix.** Backend/parser: import board-level silkscreen graphics/text. — Detail: Parse gr_text/gr_line/gr_rect/gr_poly/gr_circle on F/B.SilkS (and F/B.Fab if supported) into overlayTexts/overlayShapes (respect knockout, justify, mirror for B side); emit 'board_graphics_skipped' warnings for unsupported layers.

**Evidence.** [003-2L-pcb](../evidence/shots/f2b/dark/003-2L-pcb.png), [001-2L-pcb](../evidence/shots/vf2b/dark/001-2L-pcb.png)

<details><summary>F2B-015 — KiCad import silently drops all board-level graphics: 7 silkscreen texts ('USB to UART', knockout 'Ampnics', GND/VCC/RX/TX/RST pin legends) never reach the PCB or the Gerber (S3, confirmed)</summary>

- Area designer.import · stack B · design 4ed2e1e5-3333-49d1-b27e-c1b3d2ef2dd4 · themes dark · viewports 1440x900
- Repro:
  1. Stack B: import $QA/f2b/QA-f2b-2L.zip (the unmodified USBtoUART project) → PCB
  2. Compare with the project's Docs/top_image.png; GET /projection/pcb → overlayTexts / overlayShapes
  3. Export → compare F_Silkscreen.gbr with the KiCad Gerber in grbr.zip
- Expected: Board-level gr_text / gr_line / gr_poly on F/B.SilkS (and other user layers the app supports) import as overlay texts/shapes; anything skipped is listed as an import warning.
- Actual: The .kicad_pcb has 7 gr_text on F.SilkS (one 'knockout'); projection overlayTexts: 0, overlayShapes: 0; the pin-header legend (GND/VCC/RX/TX/RST) and product name are gone from the PCB, 3D and F_Silkscreen.gbr, and the commit response has no warning about it (warnings list only J1, net-class metadata, zone split). ParsedKicadPcb has no field for board graphics at all.
- Screenshots: [003-2L-pcb](../evidence/shots/f2b/dark/003-2L-pcb.png), `f2b/src/KiCad_Example_Project_USBtoUART/Docs/top_image.png`
- Network: `GET /designs/4ed2e1e5…/projection/pcb → overlayTexts [], overlayShapes []`; `POST /imports/kicad-project → warnings without any gr_text/graphics entry`
- Code: `src/modules/library/backend/infrastructure/parsers/kicad/kicad-pcb-parser.ts:43` — ParsedKicadPcb has no board graphics/text
- Code: `src/modules/designer/backend/import/kicad-project/insert-pcb.ts:95` — inserts placements, traces, vias, zones only
- Suggested fix: Parse gr_text/gr_line/gr_rect/gr_poly/gr_circle on F/B.SilkS (and F/B.Fab if supported) into overlayTexts/overlayShapes (respect knockout, justify, mirror for B side); emit 'board_graphics_skipped' warnings for unsupported layers.
- Verification (vf2b): **confirmed** — Verified: the .kicad_pcb has 7 gr_text on F.SilkS ('Ampnics' knockout, 'USB to UART', GND/VCC/RX/TX/RST); QA-f2b-2L projection has overlayTexts 0, overlayShapes 0 and warnings []; ParsedKicadPcb (kicad-pcb-parser.ts:43-66) has no field for board text/graphics and insertPcbEntities inserts only placements, traces, vias, zones, keepouts. The 2L canvas has no pin legend; the KiCad render shows it. S3 kept (import fidelity, source file untouched). · evidence: [001-2L-pcb](../evidence/shots/vf2b/dark/001-2L-pcb.png), f2b/src/KiCad_Example_Project_USBtoUART/Docs/top_image.png, vf2b/data/proj-4ed2e1e5-3333-49d1-b27e-c1b3d2ef2dd4.json

</details>


## T-250

**KiCad import wizard copy is stale and alarming: claims only name/layers/outline import, lists every component as 'missing', shows raw warning codes**

- Severity **S3** · category copy · status confirmed · themes dark
- Recommendation **fix-now** · owner D4 · wave W2 · scope frontend · estimate XS
- Findings: Q5-021

**Summary.** Footnote: 'v1 imports the project name, layer count, board outline and net classes. Schematic and PCB entity ingestion lands in the next iteration.' — false, the commit imports schematic, PCB placements, 183 traces, 44 vias and zones. Review header 'COMPONENTS (0 REUSE / 14 MISSING)' tags every footprint as amber 'missing'/'missing ×4' although the import ingests them into the library (the one that really fails, J1,…

**Root cause.** `src/modules/designer/frontend/components/KicadProjectImportWizard.tsx:248` — stale v1 footnote

**Proposed fix.** Update KiCad import wizard copy (what imports, statuses), human warnings. — Detail: Replace footnote with what is imported (schematic, PCB, zones, net classes; new library parts created); rename 'missing' → 'new — will be added to library' vs 'reuse'; map warning codes to plain sentences, hide info-level ones behind 'Details'.

**Evidence.** [040-import-pick](../evidence/shots/q5/dark/040-import-pick.png), [005-import-pick](../evidence/shots/vq5/light/005-import-pick.png)

<details><summary>Q5-021 — KiCad import wizard copy is stale and alarming: claims only name/layers/outline import, lists every component as 'missing', shows raw warning codes (S3, confirmed)</summary>

- Area designer.import · stack A · design None · themes dark · viewports 1440x900
- Repro:
  1. Home → Import KiCad…
  2. Read the pick-stage footnote; choose KiCad_Example_Project_USBtoUART.zip; read review stage
- Expected: Accurate description of what gets imported; component status that reflects what the commit will do; human-readable warnings.
- Actual: Footnote: 'v1 imports the project name, layer count, board outline and net classes. Schematic and PCB entity ingestion lands in the next iteration.' — false, the commit imports schematic, PCB placements, 183 traces, 44 vias and zones. Review header 'COMPONENTS (0 REUSE / 14 MISSING)' tags every footprint as amber 'missing'/'missing ×4' although the import ingests them into the library (the one that really fails, J1, is not distinguished). Warning list shows internal codes '[net_class_unknown_rules] … preserved as opaque metadata: bus_width, diff_pair_gap…'. File header comment in the component still says 'Schematic + PCB entities are surfaced as deferred'.
- Screenshots: [040-import-pick](../evidence/shots/q5/dark/040-import-pick.png), [044-import-review](../evidence/shots/q5/dark/044-import-review.png)
- Code: `src/modules/designer/frontend/components/KicadProjectImportWizard.tsx:248` — stale v1 footnote
- Code: `src/modules/designer/frontend/components/KicadProjectImportWizard.tsx:318` — reuse/missing wording
- Code: `src/modules/designer/frontend/components/KicadProjectImportWizard.tsx:365` — raw [code]
- Suggested fix: Replace footnote with what is imported (schematic, PCB, zones, net classes; new library parts created); rename 'missing' → 'new — will be added to library' vs 'reuse'; map warning codes to plain sentences, hide info-level ones behind 'Details'.
- Verification (vq5): **confirmed** — Reproduced (inspect only, no commit): pick stage footnote 'v1 imports the project name, layer count, board outline and net classes. Schematic and PCB entity ingestion lands in the next iteration.' (KicadProjectImportWizard.tsx:249-250) is false given the imported design has schematic, 183 traces and 44 vias; file header comment :10-12 is stale too. Review warning shows raw '[net_class_unknown_rules]' (:365-366). Nuance: on re-inspect after q5's import the header now reads 'Components (6 reuse / 8 missing)' (not 0/14), and the J1 footprint/symbol that will actually fail are tagged 'missing' exactly like parts that will be created, so the finding stands (status wording does not distinguish 'new' from 'will fail'). · evidence: [005-import-pick](../evidence/shots/vq5/light/005-import-pick.png), [006-import-review](../evidence/shots/vq5/light/006-import-review.png)

</details>


## T-251

**KiCad/library inspect endpoints return 500 for invalid user files**

- Severity **S3** · category error-handling · status confirmed · themes dark
- Recommendation **decide** · decision DEC-IMP · owner D4+L1 · wave W2 · scope backend · estimate XS
- Findings: Q5-022, Q7-007

**Summary.** LM324N.zip and geckonator → HTTP 500 {type: …/problems/internal-error, detail: 'ZIP archive does not contain a .kicad_pro project file'} (console error 'Failed to load resource: 500'); UI shows the raw detail 'ZIP archive does not contain a .kicad_pro project file' with no hint about KiCad versions. sample.txt → 400 'file must have a .zip extension' (lower-case, fine functionally). Recovery works (Choose ZIP… again,… | Also covers: Q7-007: Inspect endpoint returns HTTP 500 Internal Server Error for an invalid user file

**Root cause.** `src/modules/designer/backend/import/kicad-project/inspect.ts:63` — throw new Error(...) → 500; should be ValidationError

**Proposed fix.** Inspect endpoints return 400/422 problem with user message for bad archives/files (not 500); KiCad 5 legacy message. — Detail: Throw ValidationError (400/422) from resolveProjectFiles; detect .pro/.sch or kicad_pcb (version < 20211014) and return a dedicated 'legacy KiCad' problem type with conversion instructions.

**Evidence.** [041-import-invalid-txt](../evidence/shots/q5/dark/041-import-invalid-txt.png), `console: [ERROR] Failed to load resource: the server responded with a status of 500 (Internal Server Error) @ /api/modules/library/imports/kicad/ins…`

<details><summary>Q5-022 — KiCad inspect returns 500 Internal Server Error for bad user archives; KiCad 5 legacy project gets an unhelpful message (S3, confirmed)</summary>

- Area designer.import · stack A · design None · themes dark · viewports 1440x900
- Repro:
  1. Import KiCad… → choose fixtures/LM324N.zip (library zip, no project) → POST …/imports/kicad-project/inspect
  2. Choose fixtures/geckonator-kicad.zip (KiCad 5: .sch + kicad_pcb version 4, no .kicad_pro)
  3. Choose fixtures/sample.txt
- Expected: 4xx problem+json for invalid input; for a legacy project: 'KiCad 5 projects (.pro/.sch) aren't supported yet — open the project in KiCad 6+ and save it, then import the ZIP'.
- Actual: LM324N.zip and geckonator → HTTP 500 {type: …/problems/internal-error, detail: 'ZIP archive does not contain a .kicad_pro project file'} (console error 'Failed to load resource: 500'); UI shows the raw detail 'ZIP archive does not contain a .kicad_pro project file' with no hint about KiCad versions. sample.txt → 400 'file must have a .zip extension' (lower-case, fine functionally). Recovery works (Choose ZIP… again, Cancel/Esc close).
- Screenshots: [041-import-invalid-txt](../evidence/shots/q5/dark/041-import-invalid-txt.png), [042-import-nonproject-zip](../evidence/shots/q5/dark/042-import-nonproject-zip.png), [055-import-kicad5](../evidence/shots/q5/dark/055-import-kicad5.png)
- Console: `[ERROR] Failed to load resource: the server responded with a status of 500 (Internal Server Error) @ …/imports/kicad-project/inspect`
- Network: `POST /imports/kicad-project/inspect → 400 (sample.txt)`; `POST /imports/kicad-project/inspect → 500 (LM324N.zip)`; `POST /imports/kicad-project/inspect → 500 (geckonator-kicad.zip)`
- Code: `src/modules/designer/backend/import/kicad-project/inspect.ts:63` — throw new Error(...) → 500; should be ValidationError
- Suggested fix: Throw ValidationError (400/422) from resolveProjectFiles; detect .pro/.sch or kicad_pcb (version < 20211014) and return a dedicated 'legacy KiCad' problem type with conversion instructions.
- Verification (vq5): **confirmed** — Reproduced via direct POST to the inspect endpoint: LM324N.zip and geckonator-kicad.zip -> HTTP 500 problem 'internal-error', detail 'ZIP archive does not contain a .kicad_pro project file'; sample.txt -> 400 'file must have a .zip extension'. Root cause inspect.ts:62-70 throws plain Error (-> 500) instead of ValidationError; no legacy-KiCad detection. · evidence: curl: POST /api/modules/designer/imports/kicad-project/inspect LM324N.zip -> 500, geckonator-kicad.zip -> 500, sample.txt -> 400

</details>

<details><summary>Q7-007 — Inspect endpoint returns HTTP 500 Internal Server Error for an invalid user file (S3, confirmed)</summary>

- Area library.import · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Library → New part → Import file → choose garbage.step (not a .kicad_sym)
  2. Or: curl -X POST :3200/api/modules/library/imports/kicad/inspect with symbolLibrary.content='this is not a STEP file'
- Expected: 4xx (422/400 ValidationError problem+json) — bad user input is not a server fault; no console error.
- Actual: 500 {type: .../internal-error, title:'Internal Server Error', detail:'Not a valid KiCad symbol library file'}; browser console logs 'Failed to load resource: 500 (Internal Server Error) … /imports/kicad/inspect'. Also pollutes /api/diagnostics error buffer.
- Console: `[ERROR] Failed to load resource: the server responded with a status of 500 (Internal Server Error) @ /api/modules/library/imports/kicad/inspect`
- Network: `POST /api/modules/library/imports/kicad/inspect → 500`
- Code: `src/modules/library/backend/routes.ts:1428` — POST /imports/kicad/inspect returns success(buildInspectResponse(body)) with no parse-error mapping -> plain Error -> 500
- Suggested fix: Wrap buildInspectResponse (and commit routes) parse failures in ValidationError (422) in routes.ts, or have @openpcb/kicad-parsers throw a typed KicadParseError the route maps to 4xx.
- Verification (vq7): **confirmed** — Reproduced by curl: POST :3200/api/modules/library/imports/kicad/inspect with content 'this is not a STEP file' -> HTTP 500 problem+json type internal-error, detail 'Not a valid KiCad symbol library file'; browser console logs the 500 for the same UI action. · evidence: curl -> HTTP 500 {"type":"https://openpcb.dev/problems/internal-error","title":"Internal Server Error","detail":"Not a valid KiCad symbol library file"}, console: [ERROR] Failed to load resource: 500 ... /api/modules/library/imports/kicad/inspect

</details>


## T-252

**KiCad import dialog is a hand-rolled always-dark modal: no focus management/trap, unlabelled name field, off-token slate/violet/amber/emerald styling**

- Severity **S3** · category a11y · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D4 · wave W2 · scope frontend · estimate S
- Findings: Q5-029 · known ref K45
- Depends on: ['T-014']

**Summary.** The modal (bg-slate-900, rounded-lg, shadow-xl, bg-slate-950/70 backdrop, emerald/amber chips, red-950 error box) stays dark in light theme (probe: dialog body #111113 on a light app). activeElement stays BODY; Tab goes to 'Close LED Indicators 5V', 'Close QA-q5-empty', 'New design', 'Schem' behind the aria-modal dialog. The name input's accessible name is its placeholder 'USB to UART converter' (label not associate…

**Root cause.** `src/modules/designer/frontend/components/KicadProjectImportWizard.tsx:111` — hand-rolled overlay + slate classes

**Proposed fix.** KiCad import dialog -> kit Dialog, tokens, labelled fields, focus management. — Detail: Port to the shared Dialog primitive (Radix: focus trap, initial focus, restore focus, Esc), use token classes/kit Button/Input/StatusChip, bind label via id/htmlFor.

**Evidence.** [103-import-pick](../evidence/shots/q5/light/103-import-pick.png), [005-import-pick](../evidence/shots/vq5/light/005-import-pick.png)

<details><summary>Q5-029 — KiCad import dialog is a hand-rolled always-dark modal: no focus management/trap, unlabelled name field, off-token slate/violet/amber/emerald styling (S3, confirmed)</summary>

- Area designer.import · stack A · design None · themes light, dark · viewports 1440x900, 1100x720
- Repro:
  1. Light theme: Home → Import KiCad… (opens over the Designer)
  2. Check document.activeElement, press Tab ×4
  3. Choose the USBtoUART ZIP and inspect the review step
- Expected: Kit Dialog: themed surfaces, 2px radii, initial focus on 'Choose ZIP…', Tab trapped inside, return focus on close, 'Design name' label bound to its input, status chips via status tokens.
- Actual: The modal (bg-slate-900, rounded-lg, shadow-xl, bg-slate-950/70 backdrop, emerald/amber chips, red-950 error box) stays dark in light theme (probe: dialog body #111113 on a light app). activeElement stays BODY; Tab goes to 'Close LED Indicators 5V', 'Close QA-q5-empty', 'New design', 'Schem' behind the aria-modal dialog. The name input's accessible name is its placeholder 'USB to UART converter' (label not associated). Stat cards use text-[10px] uppercase labels; chips text-[10px]. Esc and Cancel/Close do work.
- Screenshots: [103-import-pick](../evidence/shots/q5/light/103-import-pick.png), [104-import-review](../evidence/shots/q5/light/104-import-review.png), [105-import-review-1100](../evidence/shots/q5/light/105-import-review-1100.png), [044-import-review](../evidence/shots/q5/dark/044-import-review.png)
- Console: `activeElement after open: BODY; Tab → BUTTON Close LED Indicators 5V inDialog=false …`
- Pixel probes: {"file": "shots/q5/light/104-import-review.png", "x": 720, "y": 450, "hex": "#111113", "nearestToken": "--text-strong (used as dialog bg in light)", "deltaE": 0.6}
- Code: `src/modules/designer/frontend/components/KicadProjectImportWizard.tsx:111` — hand-rolled overlay + slate classes
- Code: `src/modules/designer/frontend/components/KicadProjectImportWizard.tsx:276` — label without htmlFor
- Suggested fix: Port to the shared Dialog primitive (Radix: focus trap, initial focus, restore focus, Esc), use token classes/kit Button/Input/StatusChip, bind label via id/htmlFor.
- Verification (vq5): **confirmed** — Reproduced in light: Home -> Import KiCad… opens the dialog over the Designer with activeElement BODY; Tab goes to 'Close LED Indicators 5V', 'New design', 'Schem', 'Assistant' (all inDialog=false) behind the aria-modal dialog. Dialog body probes #111113 in light theme (slate classes with no dark: variants; the D1 remap makes them fixed dark neutrals). Name textbox accessible name is its placeholder 'USB to UART converter' (label at :276 not bound). Correction: 'violet-600' buttons render neutral via the D1 remap; emerald/amber chips, red-950 error box and shadow-xl are genuinely off-token. Esc/Cancel close correctly. PLAN §9 lists the import wizard in the remap-stopgap follow-up bucket; the a11y/focus issues are independent of that. · evidence: [005-import-pick](../evidence/shots/vq5/light/005-import-pick.png), [006-import-review](../evidence/shots/vq5/light/006-import-review.png), probe: dialog body #111113 (light), console: activeElement BODY; Tab -> BUTTON Close LED Indicators 5V inDialog=false …

</details>

