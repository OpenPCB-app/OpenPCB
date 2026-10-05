# Fix brief — owner DB

7 approved triage entries. Entries marked **shared** are co-owned: implement ONLY the part that lives in your owned files; the lead owner is listed. Screenshot paths are absolute (open with the Read tool for layout only).

## T-217 [S1] Renaming a reference designator in the schematic never reaches the PCB: the placement keeps the old refdes and the BOM/JLC BOM lists the part twice (old + new ref), so exports order extra parts and BOM ≠ CPL

- Area designer.bom · category data · estimate S · findings F1B-019
- **Approved scope:** Approved (DEC-PCB3): schematic refdes rename propagates to the PCB placement (and BOM).
- Summary: PCB projection placements keep reference 'R1' (partId a8178b98…) while the schematic part is 'R123456789'. BOM view shows '6 lines · 6 parts' for a 5-part design: a phantom 'R1' line (no value, no description) plus 'R123456789 10kΩ', footer still claims 'Synced with schematic r17'. On QA-f1b-netid: bom.csv / bom-jlc.csv ',"R1,R2,R7",R_0603_1608Metric,…,3' for two resistors, while pnp.csv lists only R1 and R2 → JLC B…
- Root cause: `src/modules/designer/backend/command-executor.ts:2466` — update_part_properties writes schematicParts.reference only; PCB placement reference untouched
- Proposed fix: Backend: propagate schematic refdes rename to PCB placement. — Detail: pcb-store.ts syncPcbPlacementsFromSchematic: always refresh `reference` (and componentId) from the schematic part when it differs, not only when the footprint changed. Or update the placement row in the update_part_properties handler (command-executor.ts:2449) in the same transaction. Key the BOM merge on partId (writer.ts:233). Add a regression test: rename -> PCB projection reference, bom refs and pnp.csv follow.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f1b/dark/069-long-pcb.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf1b/dark/021-bom-1100-export-hidden.png
- F1B-019 repro: Open QA-f1b-long (5 parts: R1, U1, D1, J1, C1) → Schem → select R1 → Inspector header: click the 'R1' reference button, type R123456789, Enter (dispatches update_part_properties {reference}) → Reload, switch to PCB: Components panel and silkscreen still say 'R1' → Switch to BOM → Minimal API repro on QA-f1b-netid (R1, R2, C1): update_part_properties {partId: R1, reference: 'R7'} → GET /exports/bom.csv, /exports/bom-jlc.csv, /exports/pnp.csv → Same via Outline → row '…' → Rename (F2): renamed R2 → R8 on QA-f1b-netid (light) → schematic [R7, R8, C1], PCB still [R1, R2, C1], bom-jlc.csv ',"R1,R2,R7,R8",R_0603_1608Metric,,4' for two resistors
  - expected: The refdes change propagates to the PCB placement (same partId), silkscreen, PnP and BOM; BOM part count stays equal to the number of parts.
  - actual: PCB projection placements keep reference 'R1' (partId a8178b98…) while the schematic part is 'R123456789'. BOM view shows '6 lines · 6 parts' for a 5-part design: a phantom 'R1' line (no value, no description) plus 'R123456789 10kΩ', footer still claims 'Synced with schematic r17'. On QA-f1b-netid: bom.csv / bom-jlc.csv ',"R1,R2,R7",R_0603_1608Metric,…,3' for two resistors, while pnp.csv lists only R1 and R2 → JLC BOM/CPL mismatch (R7 has no placement), an extra resistor is ordered, and the silkscreen/assembly drawing shows R1 where the schematic says R7. Persisted through reload and further edits (5 more commits).
  - code: `src/modules/designer/backend/command-executor.ts:2466` update_part_properties writes schematicParts.reference only; PCB placement reference untouched
  - code: `src/modules/designer/frontend/components/SelectionInspector/SelectionInspector.tsx:146` inspector refdes rename dispatches update_part_properties {reference}
  - code: `src/modules/designer/backend/export/bom/writer.ts:233` BOM merges PCB placements and schematic parts by refdes → both refs survive
  - code: `src/modules/designer/backend/pcb/pcb-store.ts:1921` existing placement's reference refreshed only when footprint JSON changed

## T-096 [S2] Multi-delete creates one undo step per entity (8–150 Undo clicks), slow, no confirmation

- Area designer.schematic · category bug · estimate M · findings Q3-011, F1B-011
- **shared** with D2; lead: DB
- **Approved scope:** Approved (DEC-SCH): multi-delete becomes ONE undoable step (composite/batch command in backend, frontend dispatches it).
- Summary: First Undo restores only 1 entity; entity counts after successive Undo clicks: 1,2,3,4,5,7,9,12 — eight Undo clicks to get the design back. A user who presses Undo once believes the rest is lost. Every intermediate state is also a persisted revision. | Also covers: F1B-011: 'Delete all 150' deletes one part per request over ~8 s with no confirmation, and needs 1…
- Root cause: `src/modules/designer/frontend/hooks/useDesignerWorkspace.ts:559` — dispatchCommandsBatch loops dispatchEnvelope() per command — each is its own history entry
- Proposed fix: Backend composite command (one undo entry) for multi-delete/rotate/align; frontend confirm for large deletes now. — Detail: Add a composite/batch command (or a history group id on the envelope) so the backend records a batch as one undoable entry; route delete/rotate/align batches through it.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q3/dark/040-cmd-a.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq3/dark/016-back-to-designer.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f1b/dark/006-stress-schem-selectall.png
- Q3-011 repro: In QA-Q3-sandbox (3 parts, 4 wires, GND/+5V/SDA ports, 1 net label) press ⌘A then Delete → Revision goes 16 → 24; canvas empty → Click toolbar Undo once
  - expected: One user action = one undo step: a single Undo restores the whole deleted selection (same for multi-part rotate via R)
  - actual: First Undo restores only 1 entity; entity counts after successive Undo clicks: 1,2,3,4,5,7,9,12 — eight Undo clicks to get the design back. A user who presses Undo once believes the rest is lost. Every intermediate state is also a persisted revision.
  - code: `src/modules/designer/frontend/hooks/useDesignerWorkspace.ts:559` dispatchCommandsBatch loops dispatchEnvelope() per command — each is its own history entry
  - code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:1850` Delete uses dispatchCommandsBatch; R rotate of several parts too (:1890)
- F1B-011 repro: Open QA-f1b-stress (150 parts, 60 wires) → Schematic → Cmd+A (inspector: '150 parts · Delete all 150') → Click 'Delete all 150' → Click Undo until it disables
  - expected: A bulk delete is one command (one revision, one undo step), completes in well under a second, and a 150-item destructive action asks for confirmation or at least offers an 'Undo' toast.
  - actual: No confirmation. The UI dispatches 150 sequential delete_entity commands: after 3 s the inspector still showed '122 parts', parts vanish one by one for ≈8 s while the canvas stays interactive (fps 47). History: undoDepth 150, revision 210 → 362. Restoring took 151 Undo clicks and 17.1 s (schematic has no Cmd+Z, K17). Same root cause as Q3-011 (non-atomic batch), here quantified at scale.
  - code: `src/modules/designer/frontend/components/SelectionInspector/MultiPartInspectorPanel.tsx:45` deleteAll awaits dispatchCommand(delete_entity) in a for-loop, one envelope per part

## T-097 [S2] Net label tool (L) cannot connect anything: places an un-named 'NET' text that only joins a wire at a nanometre-exact vertex, and same-named labels stay separate nets

- Area designer.schematic · category bug · estimate M · findings Q3-013
- **shared** with D2; lead: DB
- **Approved scope:** Approved (DEC-SCH): net labels join wires they touch and same-name labels merge nets; label tool asks for / shows the net name.
- Summary: Labels are free-floating text: the wire keeps its auto name Net_2, two 'NET' labels produce two distinct nets with the same name, and the label text is drawn centred ON the wire (reads as struck-through 'N̶E̶T̶'). Net labels are only connected when their anchor equals a wire VERTEX to the nanometre, which is unreachable by clicking with snapping disabled. ERC reports nothing. The outline empty-state button 'Add net…
- Root cause: `src/modules/designer/frontend/components/SchematicCanvas.tsx:1907` — L arms label text labelDraftText || 'NET' without a prompt
- Proposed fix: Frontend: L gets name picker + ghost + snap anchor to wire/pin; backend: labels join wires at segment interior and same-name labels merge nets. — Detail: Give L a name picker like H (LabelPicker), render a ghost, snap the label anchor to the nearest wire segment/pin within a few px, and in deriveNetsAndJunctions treat label points like pins (segment-interior T-touch) and merge same-text labels in the named-net union. Rename the outline button to 'Add net portal' or make it arm L.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q3/dark/038-label-placed.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq3/dark/013-label-armed.png
- Q3-013 repro: In QA-Q3-sandbox press L (no name prompt, no ghost preview), click empty canvas → label 'NET' at (0.052,-0.168) → Press L again and click exactly on the R1–D1 wire → label 'NET' stored at y=7.0668 while the wire is at y=7.1 → GET projection/schematic → nets: [..., 'Net_2' (the wire, unchanged), 'NET' (0 wires), 'NET' (0 wires)] → Run ERC
  - expected: L asks for (or offers) a net name, previews the label, snaps its anchor to the wire/pin under the cursor, names that net, and labels with the same text join into one net (KiCad local-label semantics)
  - actual: Labels are free-floating text: the wire keeps its auto name Net_2, two 'NET' labels produce two distinct nets with the same name, and the label text is drawn centred ON the wire (reads as struck-through 'N̶E̶T̶'). Net labels are only connected when their anchor equals a wire VERTEX to the nanometre, which is unreachable by clicking with snapping disabled. ERC reports nothing. The outline empty-state button 'Add net label' actually arms the Net portal (H) tool, and the empty-canvas menu 'Place net label  L' arms this text label — two different things share the name.
  - code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:1907` L arms label text labelDraftText || 'NET' without a prompt
  - code: `src/modules/designer/backend/projection-world.ts:719` labels union only with wire vertices at identical coordinates
  - code: `src/modules/designer/backend/projection-world.ts:726` global named-net union excludes labels

## T-162 [S3] Net classes are a fixed Default/Power/GND trio: no Add/rename/delete class and no per-class via size in Design rules

- Area designer.pcb · category stub · estimate M · findings F1B-007
- **shared** with D3b; lead: DB
- **Approved scope:** Approved proposal P5: add/rename/delete net classes with per-class via size in Design rules.
- Summary: Only three hard-wired rows (Default, Power, GND) with 'width' and 'clearance' spinbuttons. No 'Add class' button (Length match groups has 'Add group', net classes do not), no delete, no rename, and the via diameter/drill stored per class (PcbNetClass.viaDiameterMm/viaDrillMm, shown in the route chip as 'via 0.80/0.40') cannot be edited anywhere. A user who needs a 'HighCurrent 1.0 mm' or 'USB 0.2 mm' class has no wa…
- Root cause: `src/modules/designer/frontend/components/PcbDesignRulesDialog.tsx:360` — net classes rendered from the existing array with width/clearance fields only
- Proposed fix: Net class management (add/rename/delete, per-class via size). — Detail: Add an 'Add class' action and per-row name, via Ø / drill fields and a delete button (reassign its nets to Default on delete) in PcbDesignRulesDialog; the backend (parseNetClasses) already accepts arbitrary ids.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f1b/dark/041-design-rules-dialog.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf1b/dark/006-design-rules-dialog.png
- F1B-007 repro: PCB → Properties → Edit rules… → Look at the 'Net classes' section
  - expected: Pro EDA net-class editor: add a class (name, track width, clearance, via diameter/drill, colour), rename, delete (with reassignment of its nets), like KiCad Board Setup → Net Classes.
  - actual: Only three hard-wired rows (Default, Power, GND) with 'width' and 'clearance' spinbuttons. No 'Add class' button (Length match groups has 'Add group', net classes do not), no delete, no rename, and the via diameter/drill stored per class (PcbNetClass.viaDiameterMm/viaDrillMm, shown in the route chip as 'via 0.80/0.40') cannot be edited anywhere. A user who needs a 'HighCurrent 1.0 mm' or 'USB 0.2 mm' class has no way to create it. Editing a class in use works (Power 0.5→0.6: route chip then shows W 0.600 mm and the committed trace is 0.6 mm), existing traces keep their width.
  - code: `src/modules/designer/frontend/components/PcbDesignRulesDialog.tsx:360` net classes rendered from the existing array with width/clearance fields only

## T-164 [S3] Fab bundle (all 14 Gerber/drill/CSV files, ZIP and .gbrjob ProjectId) is named after a truncated design UUID, never the design name (extends Q5-010 from BOM downloads to the manufacturing ZIP)

- Area designer.pcb · category copy · estimate S · findings F1B-014
- **shared** with D3b; lead: DB
- **Approved scope:** Approved (DEC-PCB3): manufacturing bundle/BOM downloads named after the design name, not the UUID.
- Summary: The user (and the fab house) receives several ZIPs that are indistinguishable except for a 32-char UUID fragment; the UUID is cut mid-group (last group truncated to 8 of 12 chars). BOM view names end in '-csv.csv'. Related: Q5-010 reported the UUID naming for BOM-view downloads; this finding covers the manufacturing ZIP, every file inside it and the X2 job file.
- Root cause: `src/sdks/designer/pcb-helpers.ts:13` — exportBundleName(designId) = 'openpcb-' + designId.slice(0,32)
- Proposed fix: Name fab/BOM downloads + .gbrjob ProjectId after the design (slug); backend exporter takes design name. — Detail: Pass the design name into exportBundleName (slugify [^A-Za-z0-9_-]→'_', max ~40 chars, append short id only on collision/empty name); use it in job-file ProjectId.Name; in api.downloadBomArtifact use the Content-Disposition filename or a kind→label map (BOM, BOM.tsv, JLC-BOM, KiCad-BOM, CPL).
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f1b/dark/036-export-dialog-stress.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf1b/dark/026-export-empty-design.png
- F1B-014 repro: Open QA-f1b-stress → PCB → Export… : dialog footer reads '14 files · openpcb-cc5a12b9-bd16-4e8c-9c00-f9459807.zip' → Download ZIP and unzip: every file is 'openpcb-cc5a12b9-bd16-4e8c-9c00-f9459807-F_Cu.gbr', '…-PTH.drl', '…-BOM.csv'; the .gbrjob GeneralSpecs.ProjectId.Name is the raw UUID 'cc5a12b9-bd16-4e8c-9c00-f94598075fd5' → Same for Dual LED Blinker (openpcb-c2c58a19-bef5-488a-bfa4-c6b133ea.zip) and QA-f1b-empty → BOM view → Export ▾ → CSV downloads 'openpcb-cc5a12b9-bd16-4e8c-9c00-f9459807-csv.csv' (JLC → '-jlc.csv', PnP → '-pnp.csv') while the server's Content-Disposition for the same endpoint says 'openpcb-<id>-BOM.csv'
  - expected: Bundle and files use a slug of the design name (e.g. 'Dual_LED_Blinker-r540-F_Cu.gbr'), job file ProjectId.Name = design name; BOM downloads named '<design>-BOM.csv' / '<design>-JLC-BOM.csv' / '<design>-CPL.csv'.
  - actual: The user (and the fab house) receives several ZIPs that are indistinguishable except for a 32-char UUID fragment; the UUID is cut mid-group (last group truncated to 8 of 12 chars). BOM view names end in '-csv.csv'. Related: Q5-010 reported the UUID naming for BOM-view downloads; this finding covers the manufacturing ZIP, every file inside it and the X2 job file.
  - code: `src/sdks/designer/pcb-helpers.ts:13` exportBundleName(designId) = 'openpcb-' + designId.slice(0,32)
  - code: `src/modules/designer/backend/export/gerber/job-file.ts:44` ProjectId.Name: pcb.designId
  - code: `src/modules/designer/frontend/api.ts:738` downloadBlob name `${exportBundleName(designId)}-${kind}.${extension}` → '-csv.csv'

## T-174 [S3] No trace/via inspector: selecting a via or trace shows only 'Contents · Vias 1' — a blind via (F.Cu–In1.Cu) looks and inspects exactly like a through via; type, span, size, net and width are nowhere

- Area designer.pcb · category stub · estimate M · findings F2B-011
- **shared** with D3a; lead: DB
- **Approved scope:** Approved proposal P4: trace/via inspector (net, width, layer span, via type) with backend edit commands.
- Summary: The blind via renders identically to a through via (same green-yellow ring, black drill). Selecting it gives the generic 'Selection · 1 item selected · CONTENTS Vias 1' panel and status 'Via'; selecting a trace gives 'Traces 1' / 'Trace'. There is no way to learn the via type, span, diameter/drill or net (nor a trace's net/width/layer) from the UI; the Selection filter even describes vias as 'Through-hole vias'. The…
- Root cause: `src/modules/designer/frontend/pcb/PcbPropertiesPanel.tsx:358` — traces/vias always fall through to the counts-only branch
- Proposed fix: Trace/via inspector (net, width, layer span, via type) — needs backend edit commands. — Detail: Add ViaPanel and TracePanel to PcbPropertiesPanel's single-selection switch (read-only first: type, span, Ø/drill, net, class; width, layer, length) with edit via existing commands; render non-through vias with a split two-colour annulus and a type badge at zoom; rename the filter description to 'Vias'.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f2b/dark/073-blind-vs-through.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf2b/dark/014-blind-via-zoom.png
- F2B-011 repro: Stack B, QA-f2b-blind (KiCad 4-layer import with one '(via blind (layers F.Cu In1.Cu))' at 156.75, 132.5) → PCB, zoom to D1 → Compare the blind via with the through via at 158.75, 141.25 → Click the via (a click hits the trace first, Q4-016) → press F, keep only 'Vias', click it again → Read the Properties dock and status bar; also select any trace
  - expected: Like KiCad/Altium: a via inspector (type through/blind/buried/micro, layer span, Ø/drill, net, tenting) and a trace inspector (net, layer, width, length), both editable; blind/buried vias drawn distinctly (e.g. split ring coloured by the two span layers).
  - actual: The blind via renders identically to a through via (same green-yellow ring, black drill). Selecting it gives the generic 'Selection · 1 item selected · CONTENTS Vias 1' panel and status 'Via'; selecting a trace gives 'Traces 1' / 'Trace'. There is no way to learn the via type, span, diameter/drill or net (nor a trace's net/width/layer) from the UI; the Selection filter even describes vias as 'Through-hole vias'. The export 422 lists the via by id only, so a user cannot verify which via is blind or fix it (no 'convert to through' action).
  - code: `src/modules/designer/frontend/pcb/PcbPropertiesPanel.tsx:358` traces/vias always fall through to the counts-only branch
  - code: `src/modules/designer/frontend/pcb/PcbSelectionFilter.tsx:29` hint 'Through-hole vias'
  - code: `src/sdks/designer/types.ts:2287` no trace/via property-update command exists (INVALID_PCB_TRACE/VIA only for add)

## T-251 [S3] KiCad/library inspect endpoints return 500 for invalid user files

- Area designer.import · category error-handling · estimate XS · findings Q5-022, Q7-007
- **shared** with LB, D4, L1; lead: DB
- **Approved scope:** Approved (import mitigation): KiCad/library inspect endpoints return 400/422 problem+json for invalid files instead of 500; frontend shows the reason.
- Summary: LM324N.zip and geckonator → HTTP 500 {type: …/problems/internal-error, detail: 'ZIP archive does not contain a .kicad_pro project file'} (console error 'Failed to load resource: 500'); UI shows the raw detail 'ZIP archive does not contain a .kicad_pro project file' with no hint about KiCad versions. sample.txt → 400 'file must have a .zip extension' (lower-case, fine functionally). Recovery works (Choose ZIP… again,… | Also covers: Q7-007: Inspect endpoint returns HTTP 500 Internal Server Error for an invalid user file
- Root cause: `src/modules/designer/backend/import/kicad-project/inspect.ts:63` — throw new Error(...) → 500; should be ValidationError
- Proposed fix: Inspect endpoints return 400/422 problem with user message for bad archives/files (not 500); KiCad 5 legacy message. — Detail: Throw ValidationError (400/422) from resolveProjectFiles; detect .pro/.sch or kicad_pcb (version < 20211014) and return a dedicated 'legacy KiCad' problem type with conversion instructions.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q5/dark/041-import-invalid-txt.png, console: [ERROR] Failed to load resource: the server responded with a status of 500 (Internal Server Error) @ /api/modules/library/imports/kicad/ins…
- Q5-022 repro: Import KiCad… → choose fixtures/LM324N.zip (library zip, no project) → POST …/imports/kicad-project/inspect → Choose fixtures/geckonator-kicad.zip (KiCad 5: .sch + kicad_pcb version 4, no .kicad_pro) → Choose fixtures/sample.txt
  - expected: 4xx problem+json for invalid input; for a legacy project: 'KiCad 5 projects (.pro/.sch) aren't supported yet — open the project in KiCad 6+ and save it, then import the ZIP'.
  - actual: LM324N.zip and geckonator → HTTP 500 {type: …/problems/internal-error, detail: 'ZIP archive does not contain a .kicad_pro project file'} (console error 'Failed to load resource: 500'); UI shows the raw detail 'ZIP archive does not contain a .kicad_pro project file' with no hint about KiCad versions. sample.txt → 400 'file must have a .zip extension' (lower-case, fine functionally). Recovery works (Choose ZIP… again, Cancel/Esc close).
  - code: `src/modules/designer/backend/import/kicad-project/inspect.ts:63` throw new Error(...) → 500; should be ValidationError
- Q7-007 repro: Library → New part → Import file → choose garbage.step (not a .kicad_sym) → Or: curl -X POST :3200/api/modules/library/imports/kicad/inspect with symbolLibrary.content='this is not a STEP file'
  - expected: 4xx (422/400 ValidationError problem+json) — bad user input is not a server fault; no console error.
  - actual: 500 {type: .../internal-error, title:'Internal Server Error', detail:'Not a valid KiCad symbol library file'}; browser console logs 'Failed to load resource: 500 (Internal Server Error) … /imports/kicad/inspect'. Also pollutes /api/diagnostics error buffer.
  - code: `src/modules/library/backend/routes.ts:1428` POST /imports/kicad/inspect returns success(buildInspectResponse(body)) with no parse-error mapping -> plain Error -> 500
