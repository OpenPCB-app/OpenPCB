# designer.bom — QA findings

[← index](../README.md) · 14 triage entries · S1 2 · S2 7 · S3 4 · S4 1

| TID | Sev | Title | Findings | Rec | Owner / wave | Scope | Est |
|---|---|---|---|---|---|---|---|
| [T-217](#t-217) | S1 | Renaming a reference designator in the schematic never reaches the PCB: the placement keeps the old refdes and the BOM/JLC BOM lists the part twice (old + new ref), so exports order extra parts and BOM ≠ CPL | F1B-019 | decide (DEC-PCB3) | D4 / W2 | backend | S |
| [T-218](#t-218) | S1 | BOM sourcing edits on a grouped line write to only the first designator, split the line, and redirect further typing into a different line | Q5-001 | fix-now | D4 / W2 | frontend | M |
| [T-219](#t-219) | S2 | BOM autosave loses/truncates edits on line switch, misleading 'Saved' flash, raw errors, never retries | F1A-002, Q5-004, Q5-032 | fix-now | D4 / W2 | frontend | M |
| [T-220](#t-220) | S2 | BOM merges different parts sharing a footprint with no Value; exports write empty Comment/Val | F1B-005, F1B-016 | decide (DEC-B) | D4 / W2 | backend | S |
| [T-221](#t-221) | S2 | BOM at 1100×720: Export ▾ slides under inspector (exports unreachable), headers/totals overflow | F1B-028, Q5-012 | fix-now | D4 / W2 | frontend | S |
| [T-222](#t-222) | S2 | BOM Unit price field cannot accept decimals — typing 0.05 saves 5 | Q5-002 | fix-now | D4 / W2 | frontend | S |
| [T-223](#t-223) | S2 | 'Show in schematic' selects the part but leaves the canvas on an unrelated area; 'PCB' does not frame the part either | Q5-005 | fix-now | D1+D2+D3 / W2 | frontend | S |
| [T-224](#t-224) | S2 | BOM match tiers and counters contradict each other (no-MPN lines tagged 'Suggested', typed MPN tagged 'verified', Missing-MPN counts differ) | Q5-006 | fix-now (DEC-B) | D4 / W2 | frontend | S |
| [T-225](#t-225) | S2 | BOM sourcing/DNP edits are not reflected in the schematic part inspector (two unsynced sources of truth) | Q5-011 | decide (DEC-B) | D4 / W2 | backend | M |
| [T-226](#t-226) | S3 | Empty design BOM says 'No BOM lines match the current filter.' with filter=All, and Export stays enabled | Q5-003 | fix-now | D4 / W2 | frontend | XS |
| [T-227](#t-227) | S3 | BOM inspector keeps showing a line that the active filter hides (or silently jumps to row 1) | Q5-007 | fix-now | D4 / W2 | frontend | XS |
| [T-228](#t-228) | S3 | BOM rows are not keyboard reachable — Tab only visits row checkboxes, arrows/Enter do nothing | Q5-008 | fix-now | D4 / W2 | frontend | S |
| [T-229](#t-229) | S3 | BOM exports: no feedback for Copy TSV / downloads, filenames use a truncated design UUID, CSV silently drops DNP lines while keeping a DNP column | Q5-010 | fix-now | D4+D1 / W2 | frontend | S |
| [T-230](#t-230) | S4 | Only the Designators column sorts; Value/Footprint/Qty/MPN headers are inert (dead sort keys in code) | Q5-009 | fix-now | D4 / W2 | frontend | S |

## T-217

**Renaming a reference designator in the schematic never reaches the PCB: the placement keeps the old refdes and the BOM/JLC BOM lists the part twice (old + new ref), so exports order extra parts and BOM ≠ CPL**

- Severity **S1** · category data · status confirmed · themes dark, light
- Recommendation **decide** · decision DEC-PCB3 · owner D4 · wave W2 · scope backend · estimate S
- Findings: F1B-019

**Summary.** PCB projection placements keep reference 'R1' (partId a8178b98…) while the schematic part is 'R123456789'. BOM view shows '6 lines · 6 parts' for a 5-part design: a phantom 'R1' line (no value, no description) plus 'R123456789 10kΩ', footer still claims 'Synced with schematic r17'. On QA-f1b-netid: bom.csv / bom-jlc.csv ',"R1,R2,R7",R_0603_1608Metric,…,3' for two resistors, while pnp.csv lists only R1 and R2 → JLC B…

**Root cause.** `src/modules/designer/backend/command-executor.ts:2466` — update_part_properties writes schematicParts.reference only; PCB placement reference untouched

**Proposed fix.** Backend: propagate schematic refdes rename to PCB placement. — Detail: pcb-store.ts syncPcbPlacementsFromSchematic: always refresh `reference` (and componentId) from the schematic part when it differs, not only when the footprint changed. Or update the placement row in the update_part_properties handler (command-executor.ts:2449) in the same transaction. Key the BOM merge on partId (writer.ts:233). Add a regression test: rename -> PCB projection reference, bom refs and pnp.csv follow.

**Evidence.** [069-long-pcb](../evidence/shots/f1b/dark/069-long-pcb.png), [021-bom-1100-export-hidden](../evidence/shots/vf1b/dark/021-bom-1100-export-hidden.png)

<details><summary>F1B-019 — Renaming a reference designator in the schematic never reaches the PCB: the placement keeps the old refdes and the BOM/JLC BOM lists the part twice (old + new ref), so exports order extra parts and BOM ≠ CPL (S1, confirmed)</summary>

- Area designer.bom · stack A · design 43a2da78-9d2e-43a0-bcd3-ecebe3f72551 · themes dark, light · viewports 1440x900
- Repro:
  1. Open QA-f1b-long (5 parts: R1, U1, D1, J1, C1) → Schem → select R1
  2. Inspector header: click the 'R1' reference button, type R123456789, Enter (dispatches update_part_properties {reference})
  3. Reload, switch to PCB: Components panel and silkscreen still say 'R1'
  4. Switch to BOM
  5. Minimal API repro on QA-f1b-netid (R1, R2, C1): update_part_properties {partId: R1, reference: 'R7'} → GET /exports/bom.csv, /exports/bom-jlc.csv, /exports/pnp.csv
  6. Same via Outline → row '…' → Rename (F2): renamed R2 → R8 on QA-f1b-netid (light) → schematic [R7, R8, C1], PCB still [R1, R2, C1], bom-jlc.csv ',"R1,R2,R7,R8",R_0603_1608Metric,,4' for two resistors
- Expected: The refdes change propagates to the PCB placement (same partId), silkscreen, PnP and BOM; BOM part count stays equal to the number of parts.
- Actual: PCB projection placements keep reference 'R1' (partId a8178b98…) while the schematic part is 'R123456789'. BOM view shows '6 lines · 6 parts' for a 5-part design: a phantom 'R1' line (no value, no description) plus 'R123456789 10kΩ', footer still claims 'Synced with schematic r17'. On QA-f1b-netid: bom.csv / bom-jlc.csv ',"R1,R2,R7",R_0603_1608Metric,…,3' for two resistors, while pnp.csv lists only R1 and R2 → JLC BOM/CPL mismatch (R7 has no placement), an extra resistor is ordered, and the silkscreen/assembly drawing shows R1 where the schematic says R7. Persisted through reload and further edits (5 more commits).
- Screenshots: [069-long-pcb](../evidence/shots/f1b/dark/069-long-pcb.png), [070-long-bom-duplicate-ref](../evidence/shots/f1b/dark/070-long-bom-duplicate-ref.png), [066-long-r1-inspector](../evidence/shots/f1b/dark/066-long-r1-inspector.png), [022-outline-rename](../evidence/shots/f1b/light/022-outline-rename.png)
- Network: `POST …/43a2da78…/commands update_part_properties {reference:'R123456789'} → ok r14`; `GET …/43a2da78…/projection/pcb → placements [R1,U1,D1,J1,C1]`; `GET …/43a2da78…/bom → rows [[C1],[D1],[J1],[R1],[R123456789],[U1]]`; `GET …/0d2709d2…/exports/bom-jlc.csv → ',"R1,R2,R7",R_0603_1608Metric,,3'`; `GET …/0d2709d2…/exports/pnp.csv → C1,R1,R2`; `GET …/0d2709d2…/exports/bom-jlc.csv after Outline rename → '"R1,R2,R7,R8" … 4'`
- Code: `src/modules/designer/backend/command-executor.ts:2466` — update_part_properties writes schematicParts.reference only; PCB placement reference untouched
- Code: `src/modules/designer/frontend/components/SelectionInspector/SelectionInspector.tsx:146` — inspector refdes rename dispatches update_part_properties {reference}
- Code: `src/modules/designer/backend/export/bom/writer.ts:233` — BOM merges PCB placements and schematic parts by refdes → both refs survive
- Code: `src/modules/designer/backend/pcb/pcb-store.ts:1921` — existing placement's reference refreshed only when footprint JSON changed
- Suggested fix: pcb-store.ts syncPcbPlacementsFromSchematic: always refresh `reference` (and componentId) from the schematic part when it differs, not only when the footprint changed. Or update the placement row in the update_part_properties handler (command-executor.ts:2449) in the same transaction. Key the BOM merge on partId (writer.ts:233). Add a regression test: rename -> PCB projection reference, bom refs and pnp.csv follow.
- Verification (vf1b): **confirmed** — Reproduced on a fresh 3-part design, QA-vf1b-refdes (fa21e39a). update_part_properties {reference:'R7'} on R1 leaves the schematic at [R7,R2,C1] and the PCB at [R1,R2,C1]. GET /bom shows partCount 4 for 3 parts, and bom.csv/bom-jlc.csv list ',"R1,R2,R7",R_0603_1608Metric,…,3' while pnp.csv has R1,R2. The UI shows the same on QA-f1b-long: BOM '6 lines · 6 parts' for 5 parts, a phantom 'R1' line, and 3D refdes 'R1'. Root cause: command-executor.ts:2449 updates only schematicParts.reference, and syncPcbPlacementsFromSchematic (pcb-store.ts:1919-1934) refreshes placement.reference only when the footprint changed. designer/AGENTS.md says re-annotation is supposed to update the reference, so this is a bug, not a design decision. S1 kept: a routine refdes rename silently makes the fab BOM order extra parts, and BOM and CPL disagree. · evidence: [021-bom-1100-export-hidden](../evidence/shots/vf1b/dark/021-bom-1100-export-hidden.png), [019-long-3d-top](../evidence/shots/vf1b/dark/019-long-3d-top.png), API QA-vf1b-refdes: pcb ['R1','R2','C1'] vs sch ['R7','R2','C1']; bom summary partCount 4; bom-jlc.csv ',"R1,R2,R7",R_0603_1608Metric,,3'

</details>


## T-218

**BOM sourcing edits on a grouped line write to only the first designator, split the line, and redirect further typing into a different line**

- Severity **S1** · category data · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D4 · wave W2 · scope frontend · estimate M
- Findings: Q5-001

**Summary.** The PATCH goes to /bom/refs/R1 only: R1 gets 'RC0603' and splits off; R2,R5,R6,R7,R8 stay without MPN. Because the row id (refs joined) disappears, the inspector silently falls back to rows[0] (D1..D8) while focus stays in the MPN input, so the rest of the typing ('FR-07150RL') is autosaved as the MPN of LED D1 (which then also splits). Backend result: D1 mpn='FR-07150RL', R1 mpn='RC0603', R3 alone got the manufactu…

**Root cause.** `src/modules/designer/frontend/components/DesignerBomView.tsx:247` — updateSelected patches selected.refs[0].refdes only

**Proposed fix.** Grouped line edits apply to all designators of the line (one batch) and keep inspector focused on the same line. — Detail: Apply the override to every ref of the line (loop over selected.refs or add a backend PATCH /bom/lines that takes all refdes in one transaction). Track selection by a stable key (e.g. the first refdes) and re-resolve it after the BOM reloads instead of falling back to rows[0]; never switch the inspector row while an input inside it has focus/dirty draft.

**Evidence.** [003-bom-after-mpn-edit](../evidence/shots/q5/dark/003-bom-after-mpn-edit.png), [001-bom-grouped-mpn-edit](../evidence/shots/vq5/dark/001-bom-grouped-mpn-edit.png)

<details><summary>Q5-001 — BOM sourcing edits on a grouped line write to only the first designator, split the line, and redirect further typing into a different line (S1, confirmed)</summary>

- Area designer.bom · stack A · design 370447e2-d91e-43f1-b0a5-e7dc9f6bcafe · themes dark, light · viewports 1440x900
- Repro:
  1. Open 'LED Indicators 5V' → BOM tab
  2. Click the grouped line 'R1,R2,R5,R6,R7,R8' (qty 6); inspector shows '6 parts'
  3. Click MPN, type 'RC0603', pause ~1 s (autosave fires after 650 ms)
  4. Keep typing 'FR-07150RL'
  5. GET /api/modules/designer/designs/370447e2…/bom
- Expected: MPN applies to all 6 designators of the selected line; the inspector stays on the line being edited; the full string 'RC0603FR-07150RL' is saved on that line.
- Actual: The PATCH goes to /bom/refs/R1 only: R1 gets 'RC0603' and splits off; R2,R5,R6,R7,R8 stay without MPN. Because the row id (refs joined) disappears, the inspector silently falls back to rows[0] (D1..D8) while focus stays in the MPN input, so the rest of the typing ('FR-07150RL') is autosaved as the MPN of LED D1 (which then also splits). Backend result: D1 mpn='FR-07150RL', R1 mpn='RC0603', R3 alone got the manufacturer/price typed for line 'R3,R4'. Same for Manufacturer/Supplier/Unit price/Notes/DNP/Assembly side edits and for the bulk Mark/Clear DNP (only refs[0] of each checked line is patched). Before the split, line 'R3,R4' displayed R3's $5 unit price as the line price and $10 ext. for both parts.
- Screenshots: [003-bom-after-mpn-edit](../evidence/shots/q5/dark/003-bom-after-mpn-edit.png), [004-bom-mpn-typing-lands-on-other-line](../evidence/shots/q5/dark/004-bom-mpn-typing-lands-on-other-line.png)
- Network: `PATCH /api/modules/designer/designs/370447e2…/bom/refs/R1 (only first ref)`; `GET …/bom → rows: 'D1' mpn=FR-07150RL, 'D2..D8' none, 'R1' mpn=RC0603, 'R2,R5,R6,R7,R8' none, 'R3' mpn=RC0603FR-07330RL, 'R4' none`
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:247` — updateSelected patches selected.refs[0].refdes only
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:227` — markCheckedDnp patches row.refs[0] only
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:129` — selected falls back to bom.rows[0] when the selected id vanishes
- Code: `src/modules/designer/backend/routes.ts:3158` — PATCH /bom/refs/:refdes is per-designator
- Suggested fix: Apply the override to every ref of the line (loop over selected.refs or add a backend PATCH /bom/lines that takes all refdes in one transaction). Track selection by a stable key (e.g. the first refdes) and re-resolve it after the BOM reloads instead of falling back to rows[0]; never switch the inspector row while an input inside it has focus/dirty draft.
- Verification (vq5): **confirmed** — Reproduced on stack A (own 370447e2). Selected grouped line D3..D8 (qty 6), typed 'VQ5A' in MPN, paused 1.5 s, typed 'BCD': backend then had D3 mpn='VQ5A' (split off), D4..D8 none, and D1's existing MPN overwritten to 'FR-07150RLBCD' while focus stayed in the MPN box and the inspector silently switched to D1. Bulk: checked 'D4,D5,D6,D7,D8' -> Mark DNP -> only D4 became DNP (line became 'D2,D4' + 'D5..D8'). Root cause DesignerBomView.tsx:247-248 (updateSelected patches selected.refs[0] only), :227-229 (markCheckedDnp refs[0] only), :128-129 (selected falls back to bom.rows[0] once the joined-refs id disappears). Pre-existing before the redesign (same code in 186c592^), not a PLAN decision. S1 kept: silent write of user input into a different part's sourcing data. Restored the BOM overrides via API afterwards. The 'R3,R4 showed R3 price' sub-claim was not re-checked (lines already split). · evidence: [001-bom-grouped-mpn-edit](../evidence/shots/vq5/dark/001-bom-grouped-mpn-edit.png), [002-bom-bulk-dnp-first-ref-only](../evidence/shots/vq5/dark/002-bom-bulk-dnp-first-ref-only.png), network: PATCH …/bom/refs/D3 then PATCH …/bom/refs/D1; GET …/bom -> D1 'FR-07150RLBCD', D3 'VQ5A', D4..D8 null, network: bulk Mark DNP -> only PATCH …/bom/refs/D4

</details>


## T-219

**BOM autosave loses/truncates edits on line switch, misleading 'Saved' flash, raw errors, never retries**

- Severity **S2** · category data · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D4 · wave W2 · scope frontend · estimate M
- Findings: F1A-002, Q5-004, Q5-032 · known ref K40
- Depends on: ['T-006']

**Summary.** (a) No PATCH is sent and the value is silently discarded: C1 MPN stays null, and the same happens for Q1 'MMBT3904' on switching to Schem and back. (b) When C1's PATCH returns, setBom() replaces rows, the inspector's [row] effect resets the draft to server values, and the MPN input is wiped mid-typing. Only the tail 'ED-SLOWLY-0123' is saved to R1, and the line then splits (Q5-001) so the inspector silently falls ba… | Also covers: Q5-004: BOM autosave indicator shows 'Saved' for ~4 ms, then snaps back to 'Autosaves changes'; Q5-032: BOM load/save errors: raw detail text with no retry while the footer still claims 'Synced…

**Root cause.** `src/modules/designer/frontend/components/DesignerBomView.tsx:603` — useEffect([row]) resets draft/lastSaved whenever the row object identity changes (every setBom), discarding unsaved typing

**Proposed fix.** Per-line draft state keyed by line id; flush pending save on line/view switch; show Saving/Saved/Failed + Retry (problem.ts); don't overwrite field being typed. — Detail: DesignerBomView.tsx: render <BomInspector key={selected?.refs[0]?.refdes}> and keep the pending patch in a ref; in the autosave effect cleanup (and on unmount) flush a pending, unsaved patch by calling the onUpdate that was bound to that row's refdes (make updateSelected take the refdes explicitly instead of reading `selected`). Reset draft only when the row key changes, not on identity change (this also fixes Q5-004), and do not overwrite fields that are dirty in the draft when a server BOM for another line arriv…

**Evidence.** [063-bom-race-inflight-switch](../evidence/shots/f1a/dark/063-bom-race-inflight-switch.png), [051-bom-typed-q1](../evidence/shots/vf1a/dark/051-bom-typed-q1.png), `console: saveLog=[{Autosaves changes,6},{Saving…,2196},{Saved,2867},{Autosaves changes,2871}]`

<details><summary>F1A-002 — BOM sourcing edits are lost or truncated: switching line/view within the 650 ms autosave drops the value, and a returning save wipes text being typed on another line (S2, confirmed)</summary>

- Area designer.bom · stack A · design 91573bb6-cb22-4ca4-a8d9-58057a1ff45b · themes dark, light · viewports 1440x900
- Repro:
  1. (a) No latency. BOM tab, line C1 selected. Click MPN, type 'FAST-C1', and within ~0.5 s click line J1 (or the Schem tab)
  2. GET /designs/{id}/bom → C1.manufacturerPartNumber
  3. (b) Latency shim 2.5 s. Select line C1, type '-X' into MPN, wait 0.9 s (PATCH in flight), click line 'R1,R2', type 'R-LINE-MPN-TYPED-SLOWLY-0123' at ~150 ms per key
  4. Wait for the saves to settle and GET /bom
- Expected: A typed value is flushed (or kept pending) when the user changes line or view. A save response for line A never touches the draft of line B being edited.
- Actual: (a) No PATCH is sent and the value is silently discarded: C1 MPN stays null, and the same happens for Q1 'MMBT3904' on switching to Schem and back. (b) When C1's PATCH returns, setBom() replaces rows, the inspector's [row] effect resets the draft to server values, and the MPN input is wiped mid-typing. Only the tail 'ED-SLOWLY-0123' is saved to R1, and the line then splits (Q5-001) so the inspector silently falls back to C1 and shows 'SLOW-C1-X'. In race2 the J1 field also blanked for ~0.8 s and then reappeared. Values do land on the correct refdes (Q5's open question); the issue is loss and truncation.
- Screenshots: [063-bom-race-inflight-switch](../evidence/shots/f1a/dark/063-bom-race-inflight-switch.png), [065-bom-race-typing-wiped-2](../evidence/shots/f1a/dark/065-bom-race-typing-wiped-2.png), [111-k10-warning-toast-1440](../evidence/shots/f1a/dark/111-k10-warning-toast-1440.png), [065-bom-typed-before-switch](../evidence/shots/f1a/light/065-bom-typed-before-switch.png)
- Network: `(a) no PATCH /bom/refs/C1 after typing 'FAST-C1' + line switch`; `(b) PATCH /bom/refs/C1 200, PATCH /bom/refs/R1 200 body MPN 'ED-SLOWLY-0123' (user typed 'R-LINE-MPN-TYPED-SLOWLY-0123')`; `GET /bom → C1 'SLOW-C1-X', R1 'ED-SLOWLY-0123', Q1 null (typed 'MMBT3904' then switched view)`
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:603` — useEffect([row]) resets draft/lastSaved whenever the row object identity changes (every setBom), discarding unsaved typing
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:620` — debounced autosave (setTimeout 650 ms at :611); cleanup clears the pending timeout on row change or unmount without flushing
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:247` — updateSelected always calls setBom(result.bom), re-creating every row object
- Suggested fix: DesignerBomView.tsx: render <BomInspector key={selected?.refs[0]?.refdes}> and keep the pending patch in a ref; in the autosave effect cleanup (and on unmount) flush a pending, unsaved patch by calling the onUpdate that was bound to that row's refdes (make updateSelected take the refdes explicitly instead of reading `selected`). Reset draft only when the row key changes, not on identity change (this also fixes Q5-004), and do not overwrite fields that are dirty in the draft when a server BOM for another line arrives.
- Verification (vf1a): **confirmed** — Part (a) reproduced on loopback with no latency: selected line Q1, typed 'VF1A-Q1' into MPN, clicked line R2 150 ms later -> no PATCH /bom/refs/* was sent and GET /bom still has Q1 MPN null; then typed 'VF1A-R2' on R2 and switched Schem -> BOM within 150 ms -> no PATCH, R2 MPN null. Code: DesignerBomView.tsx:620 autosave effect cleanup clears the 650 ms timeout on row change or unmount without flushing; :603 [row] effect resets draft on every row identity change. Part (b) (a returning PATCH wipes the draft being typed on another line) needs an in-flight PATCH, so it is latency-only on loopback; confirmed by code (:247 updateSelected always setBom -> new row identities -> :603 resets the draft) and f1a's latency evidence. Not a duplicate: Q5-001 is refs[0] addressing, Q5-004 is the 'Saved' flicker caused by the same :603 reset; the loss on line/view switch is new. S2 kept: silent loss of typed sourcing data in a normal fast-editing flow. · evidence: [051-bom-typed-q1](../evidence/shots/vf1a/dark/051-bom-typed-q1.png), network: 0 PATCH /bom/refs/* after typing 'VF1A-Q1' + line switch and 'VF1A-R2' + view switch; GET /bom Q1 null, R2 null, [065-bom-race-typing-wiped-2](../evidence/shots/f1a/dark/065-bom-race-typing-wiped-2.png) (f1a, latency part b)

</details>

<details><summary>Q5-004 — BOM autosave indicator shows 'Saved' for ~4 ms, then snaps back to 'Autosaves changes' (S3, confirmed)</summary>

- Area designer.bom · stack A · design 370447e2-d91e-43f1-b0a5-e7dc9f6bcafe · themes dark · viewports 1440x900
- Repro:
  1. Open 'LED Indicators 5V' → BOM, select a line
  2. Type into MPN/Manufacturer/Supplier
  3. Watch the inspector footer (sampled every 5 ms with a MutationObserver-style poll)
- Expected: 'Saving…' then 'Saved' (held for a second or two) so the user gets confirmation.
- Actual: Sequence recorded: 'Autosaves changes' → 'Saving…' (t=2196ms) → 'Saved' (t=2867ms) → 'Autosaves changes' (t=2871ms). The successful save calls setBom(), the row object changes, and the row-reset effect sets saveState back to 'idle' in the same tick. Users never see a success confirmation; a failure would be visible only until the next row change.
- Console: `saveLog=[{Autosaves changes,6},{Saving…,2196},{Saved,2867},{Autosaves changes,2871}]`
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:587` — row-reset effect runs on every new row object and resets saveState to idle
- Suggested fix: Only reset the draft/saveState when the selected row identity (refdes key) changes, not when the same row is re-fetched; hold 'Saved' for ~1.5 s.
- Verification (vq5): **confirmed** — Reproduced with a MutationObserver on the inspector footer while typing in Notes on R3: ['Saving…',0] -> ['Saved',854 ms] -> ['Autosaves changes',857 ms] — 'Saved' is on screen for ~3 ms. Root cause DesignerBomView.tsx:579-596: the row-reset effect depends on the row object; updateSelected's setBom(result.bom) creates a new row object, so the effect resets saveState to 'idle' right after the save resolves. Related to (but a different code path from) Q5-032's no-retry/stuck state; both live in the same BomInspector autosave state machine and should be fixed together. · evidence: console: saveLog=[["Saving…",0],["Saved",854],["Autosaves changes",857]]

</details>

<details><summary>Q5-032 — BOM load/save errors: raw detail text with no retry while the footer still claims 'Synced with schematic'; failed autosave never retries (S3, confirmed)</summary>

- Area designer.bom · stack A · design 370447e2-d91e-43f1-b0a5-e7dc9f6bcafe · themes light · viewports 1440x900
- Repro:
  1. route **/designs/*/bom → 500 {detail:'boom'}; open BOM tab
  2. unroute; route **/bom/refs/** → 500; type in Notes of line R1; unroute; wait; then clear the field
- Expected: An error panel ('Couldn't load the BOM' + detail + Retry) and a footer that doesn't claim sync; failed autosave offers Retry / retries on reconnect and clears when the draft matches the server.
- Actual: Table shows only the raw problem detail 'boom' in red at the top-left; filters read 'All 0 / Missing MPN 0', totals '$0.00', footer '0 missing MPN · Synced with schematic r72', Export stays enabled, inspector 'No BOM row selected.' No retry except switching tabs. On save failure the footer shows 'Autosave failed' and stays so after the backend recovers (no retry); clearing the field back to the saved value still shows 'Autosave failed'. Where detail is absent the fetch helpers surface 'HTTP 500' (K40). Additionally, after a failure, editing the field back to the saved value leaves the footer on 'Saving…' forever (the effect returns early when the draft equals lastSaved without resetting saveState).
- Screenshots: [108-bom-error-500](../evidence/shots/q5/light/108-bom-error-500.png), [109-bom-autosave-failed](../evidence/shots/q5/light/109-bom-autosave-failed.png)
- Network: `GET …/bom → 500 (injected)`; `PATCH …/bom/refs/R1 → 500 (injected)`
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:387` — error rendered as plain text, rest of UI treats bom=null as empty
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:468` — 'Synced with schematic' shown regardless of error
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:617` — catch → error, no retry
- Suggested fix: Render a kit error state with Retry (re-run getBom) and hide counts/footer sync claim while bom is null; add a 'Retry' action to AutosaveState and reset it when draft equals lastSaved.
- Verification (vq5): **confirmed** — Reproduced in light: GET …/bom routed to 500 {detail:'boom'} -> table shows only 'boom', filters 'All 0', footer '0 missing MPN · Synced with schematic r75', Export ▾ enabled, inspector 'No BOM row selected.'; no retry. PATCH …/bom/refs/** routed to 500 -> 'Autosave failed'; after unroute it stays failed (no retry). New detail: deleting the typed text back to the saved value left the footer on 'Saving…' permanently with no request sent — the autosave effect (DesignerBomView.tsx:597-611) returns early when nextKey === lastSaved without resetting saveState. K40 partial (raw detail shown; 'HTTP n' fallback path not hit). · evidence: [003-bom-error-500](../evidence/shots/vq5/light/003-bom-error-500.png), [004-bom-autosave-stuck-saving](../evidence/shots/vq5/light/004-bom-autosave-stuck-saving.png), network: PATCH …/bom/refs/D1 -> 500 (injected); no later PATCH after unroute

</details>


## T-220

**BOM merges different parts sharing a footprint with no Value; exports write empty Comment/Val**

- Severity **S2** · category data · status confirmed · themes dark
- Recommendation **decide** · decision DEC-B · owner D4 · wave W2 · scope backend · estimate S
- Findings: F1B-005, F1B-016

**Summary.** BOM shows 2 lines: 'Q1,Q2,Q3 — SOT-23 — Generic NPN BJT using E-B-C SOT-23 pin order — qty 3' and 'D1,D2 — D_SOD-123 — Generic two-pin diode … — qty 2'. The NMOS and PNP take the NPN's description; the Zener is listed as a generic diode. bom.csv: ',"Q1,Q2,Q3",SOT-23,,,,3,…'; bom-jlc.csv and kicad-bom.csv the same. An assembler would populate three NPN BJTs. The same merge happened on the 150-part stress board (30 Q… | Also covers: F1B-016: BOM/CPL exports write an empty Comment/Val for parts with no Value (and a currency with n…

**Root cause.** `src/modules/designer/backend/export/bom/writer.ts:269` — group key = value|footprint|MPN|LCSC|dnp — componentId not part of the key; description = first non-empty

**Proposed fix.** Backend BOM writer: group by component id + value + footprint; export Comment fallback to part name. — Detail: export/bom/writer.ts aggregateRows: add the component identity (schPart.componentId, or library part id + variant) to the grouping key so different components never merge. The empty-Comment fallback is tracked in F1B-016.

**Evidence.** [039-bom-grouping-npn-nmos](../evidence/shots/f1b/dark/039-bom-grouping-npn-nmos.png), [034-bom-bulk-dnp](../evidence/shots/f1b/dark/034-bom-bulk-dnp.png)

<details><summary>F1B-005 — BOM merges different components that share a footprint and have no Value — NPN, PNP and NMOS transistors become one 'Generic NPN BJT ×3' line (also in CSV/JLC/KiCad exports) (S2, confirmed)</summary>

- Area designer.bom · stack A · design 89009c50-e648-4eee-80f4-2f426b39220e · themes dark · viewports 1440x900
- Repro:
  1. Create a design (QA-f1b-bomgroup) and place NPN Transistor SOT-23, NMOS Transistor SOT-23, PNP Transistor SOT-23, Generic Diode and Zener Diode (default Value is empty for all)
  2. Open BOM
  3. Export ▾ → CSV / JLC BOM / KiCad CSV, or PCB Export… with 'Include BOM CSV'
- Expected: Each distinct component (componentId / library part) gets its own BOM line; parts are only grouped when they are the same component with the same value/footprint/MPN.
- Actual: BOM shows 2 lines: 'Q1,Q2,Q3 — SOT-23 — Generic NPN BJT using E-B-C SOT-23 pin order — qty 3' and 'D1,D2 — D_SOD-123 — Generic two-pin diode … — qty 2'. The NMOS and PNP take the NPN's description; the Zener is listed as a generic diode. bom.csv: ',"Q1,Q2,Q3",SOT-23,,,,3,…'; bom-jlc.csv and kicad-bom.csv the same. An assembler would populate three NPN BJTs. The same merge happened on the 150-part stress board (30 Q = 15 NPN + 15 NMOS in one line) until values were typed.
- Screenshots: [039-bom-grouping-npn-nmos](../evidence/shots/f1b/dark/039-bom-grouping-npn-nmos.png), [030-bom-150](../evidence/shots/f1b/dark/030-bom-150.png)
- Network: `GET /api/modules/designer/designs/89009c50…/exports/bom.csv → ',"D1,D2",D_SOD-123,,,,2,…' / ',"Q1,Q2,Q3",SOT-23,,,,3,…'`
- Code: `src/modules/designer/backend/export/bom/writer.ts:269` — group key = value\|footprint\|MPN\|LCSC\|dnp — componentId not part of the key; description = first non-empty
- Suggested fix: export/bom/writer.ts aggregateRows: add the component identity (schPart.componentId, or library part id + variant) to the grouping key so different components never merge. The empty-Comment fallback is tracked in F1B-016.
- Verification (vf1b): **confirmed** — Reproduced read-only on QA-f1b-bomgroup. GET /bom returns 2 lines: Q1,Q2,Q3 'Generic NPN BJT…' qty 3 (NPN + NMOS + PNP components) and D1,D2 'Generic two-pin diode' qty 2 (generic + zener). bom.csv, bom-jlc.csv and kicad-bom.csv all merge them the same way. Code: writer.ts aggregateRows key = value|footprint|MPN|LCSC|dnp, with no componentId. S2 kept (wrong data in the fab BOM). · evidence: API GET /designs/89009c50…/exports/bom-jlc.csv -> ',"D1,D2",D_SOD-123,,2' / ',"Q1,Q2,Q3",SOT-23,,3'

</details>

<details><summary>F1B-016 — BOM/CPL exports write an empty Comment/Val for parts with no Value (and a currency with no price); DNP policy part already covered by Q5-010 (S3, confirmed)</summary>

- Area designer.bom · stack A · design cc5a12b9-bd16-4e8c-9c00-f94598075fd5 · themes dark · viewports 1440x900
- Repro:
  1. QA-f1b-stress → BOM → select all 150 → bulk DNP
  2. Export ▾ → CSV
  3. Compare with Export ▾ → TSV / KiCad CSV (backend writers)
  4. Dual LED Blinker / QA-f1b-bomgroup: export the fab bundle, open BOM.csv and PnP.csv rows for U1 / Q1,Q2,Q3
- Expected: One consistent DNP policy: either every BOM export lists DNP lines flagged DNP=yes, or none do and the DNP column is removed; the export dialog/menu says which. Parts without a Value export a meaningful Comment (value → component name/description fallback, as the BOM table shows).
- Actual: bom.csv after bulk DNP is only the header line ('Comment,Designator,…,DNP,…'); buildBomCsv filters dnp rows but still writes a DNP column → it is always 'no' in 150/150 rows of the non-DNP export. buildBomTsv and buildKicadBomCsv write DNP rows with yes/1. For parts with empty Value the Comment/Val cell is empty: Dual LED Blinker BOM ',U1,SOIC-8_3.9x4.9mm_P1.27mm,…' and PnP 'U1,,SOIC-8…' although the BOM view shows a description; QA-f1b-bomgroup ',"Q1,Q2,Q3",SOT-23,…' (see also F1B-005). Also one row carries Currency 'USD' with no unit price (C1 on Dual LED Blinker) because the inspector pre-fills USD. Related: Q5-010 noted the dead DNP column in bom.csv; new here are the cross-format disagreement, the header-only file after bulk DNP, and the empty Comment/Val cells.
- Screenshots: [034-bom-bulk-dnp](../evidence/shots/f1b/dark/034-bom-bulk-dnp.png), [039-bom-grouping-npn-nmos](../evidence/shots/f1b/dark/039-bom-grouping-npn-nmos.png)
- Code: `src/modules/designer/backend/export/bom/writer.ts:90` — buildBomCsv filters !row.dnp then writes row.dnp ? 'yes':'no'
- Code: `src/modules/designer/backend/export/bom/writer.ts:100` — buildBomTsv keeps DNP rows
- Code: `src/modules/designer/backend/export/bom/writer.ts:152` — buildKicadBomCsv keeps DNP rows
- Code: `src/modules/designer/backend/export/bom/writer.ts:335` — Comment = row.value only, no fallback
- Suggested fix: export/bom/writer.ts formatBomCsvRow / buildJlcBomCsv / buildKicadBomCsv and the PnP writer: when row.value is empty, fall back to the component name (or MPN, then description) for Comment/Val. Only emit Currency when unitPrice is set. The DNP policy is handled under Q5-010.
- Verification (vf1b): **confirmed** — Partly a duplicate, re-scoped. The DNP part (bom.csv/JLC drop DNP lines but keep an always-'no' DNP column, while KiCad CSV/TSV keep them) is already verified as Q5-010, and a header-only file after bulk DNP is the same filter (writer.ts:90). New and confirmed read-only on Dual LED Blinker: bom.csv ',U1,SOIC-8_3.9x4.9mm_P1.27mm,…' and pnp.csv 'U1,,SOIC-8…' have an empty Comment/Val for a value-less part, and C1 carries Currency 'USD' with no Unit Price. The same empty Comment appears in QA-f1b-bomgroup's BOM/JLC/KiCad rows. S3 kept for the empty Comment/Val, which JLC assembly review uses to identify parts. · evidence: API GET /designs/c2c58a19…/exports/bom.csv -> ',U1,SOIC-8_3.9x4.9mm_P1.27mm,,,,1,no,top,,,' and '10µF,C1,…,USD,', API pnp.csv -> 'U1,,SOIC-8_3.9x4.9mm_P1.27mm,…'

</details>


## T-221

**BOM at 1100×720: Export ▾ slides under inspector (exports unreachable), headers/totals overflow**

- Severity **S2** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D4 · wave W2 · scope frontend · estimate S
- Findings: F1B-028, Q5-012

**Summary.** The button is laid out at x 869–930 while the table pane ends at x 780, so it sits under the 320 px inspector: elementFromPoint at its centre returns the inspector's '1 part' span, a click opens nothing (aria-expanded stays false, 0 menuitems). Only plain CSV remains reachable via ⌘E (and Tab+Enter). Same in dark (shots/f1b/dark/081) and light, with or without a selected line. At 1440×900 the button is visible. Caus… | Also covers: Q5-012: BOM table overflows at 1100×720: header 'UNIT/EXT.' draws over the inspector, price colum…

**Root cause.** `src/modules/designer/frontend/components/DesignerBomView.tsx:320` — grid-cols-[minmax(0,1fr)_320px] — the section inside the 1fr track has min-width:auto

**Proposed fix.** BOM table minmax columns + horizontal scroll inside table; Export button never covered at 1100×720. — Detail: Give the <section> `min-w-0` (and `grid-cols-[minmax(0,1fr)]`), wrap only the table header+rows in an `overflow-x-auto` container, and keep the toolbar at pane width so Export ▾ stays pinned to the pane's right edge. Add a 1100×720 e2e assertion that Export ▾ opens.

**Evidence.** [024-long-bom-1100](../evidence/shots/f1b/light/024-long-bom-1100.png), [021-bom-1100-export-hidden](../evidence/shots/vf1b/dark/021-bom-1100-export-hidden.png), [019-bom-1100x720](../evidence/shots/q5/dark/019-bom-1100x720.png)

<details><summary>F1B-028 — At the 1100×720 minimum window the BOM 'Export ▾' button slides under the inspector and cannot be clicked — JLC BOM, PnP, KiCad CSV and Copy TSV become mouse-unreachable (S2, confirmed)</summary>

- Area designer.bom · stack A · design 43a2da78-9d2e-43a0-bcd3-ecebe3f72551 · themes dark, light · viewports 1100x720
- Repro:
  1. Resize the window to 1100×720
  2. Open any design with BOM lines (QA-f1b-long) → BOM
  3. Look for the Export ▾ button at the right end of the BOM toolbar and click where it is
- Expected: The toolbar stays inside the 700 px table pane; Export ▾ is visible and opens CSV / JLC BOM / PnP / KiCad CSV / Copy TSV.
- Actual: The button is laid out at x 869–930 while the table pane ends at x 780, so it sits under the 320 px inspector: elementFromPoint at its centre returns the inspector's '1 part' span, a click opens nothing (aria-expanded stays false, 0 menuitems). Only plain CSV remains reachable via ⌘E (and Tab+Enter). Same in dark (shots/f1b/dark/081) and light, with or without a selected line. At 1440×900 the button is visible. Cause: the <section> grid item stretches to the fixed BOM column template's min width, and the toolbar's flex-1 spacer pushes Export past the pane (the header overflow itself is Q5-012; this is the functional consequence it did not list).
- Screenshots: [024-long-bom-1100](../evidence/shots/f1b/light/024-long-bom-1100.png), [025-bom-1100-export-click](../evidence/shots/f1b/light/025-bom-1100-export-click.png), [026-bom-1100-noselection](../evidence/shots/f1b/light/026-bom-1100-noselection.png), [081-long-bom-1100](../evidence/shots/f1b/dark/081-long-bom-1100.png), [023-long-bom-1440](../evidence/shots/f1b/light/023-long-bom-1440.png)
- Console: `Export button rect x=869 right=930 y=37.5; table pane width 700 (x 80–780); elementFromPoint → <span class='shrink-0 text-2xs text-text-tertiary'>1 part</span>; after click aria-expanded='false', menu`
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:320` — grid-cols-[minmax(0,1fr)_320px] — the section inside the 1fr track has min-width:auto
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:322` — toolbar row with flex-1 spacer then ExportMenu (line 339) is as wide as the overflowing table
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:413` — fixed gridTemplateColumns COLS forces the min width
- Suggested fix: Give the <section> `min-w-0` (and `grid-cols-[minmax(0,1fr)]`), wrap only the table header+rows in an `overflow-x-auto` container, and keep the toolbar at pane width so Export ▾ stays pinned to the pane's right edge. Add a 1100×720 e2e assertion that Export ▾ opens.
- Verification (vf1b): **confirmed** — Reproduced at 1100x720 dark on QA-f1b-long BOM. The Export ▾ button is laid out at x 869-930 while the table <section> spans x 80-780. elementFromPoint at its centre hits the inspector header row. A real click at (900,49) left aria-expanded='false' with 0 menuitems. JLC BOM, PnP, KiCad CSV and Copy TSV are unreachable by mouse at the minimum window size (⌘E still exports plain CSV). Same root cause and fix as verified Q5-012 (S3, header overflow: 'section min-w-0 + overflow-x-auto'); this is the functional consequence Q5-012 did not list. S2 kept (feature unreachable, workaround: widen the window or use the PCB Export dialog). At triage, fix once with Q5-012. · evidence: [021-bom-1100-export-hidden](../evidence/shots/vf1b/dark/021-bom-1100-export-hidden.png), DOM: btn [869,930], section [80,780], hitIsBtn false; after click menuitems 0

</details>

<details><summary>Q5-012 — BOM table overflows at 1100×720: header 'UNIT/EXT.' draws over the inspector, price columns and totals are cut off; '@ 1' hint clipped at all sizes (S3, confirmed)</summary>

- Area designer.bom · stack A · design 370447e2-d91e-43f1-b0a5-e7dc9f6bcafe · themes dark · viewports 1100x720, 1440x900
- Repro:
  1. Open 'LED Indicators 5V' → BOM
  2. Resize window to 1100×720 (Electron minimum)
- Expected: Table scrolls horizontally inside its pane (or collapses Description) and never paints over the inspector; all columns + totals readable.
- Actual: The fixed column template (24+28+110+140+40+150+56+70 px + fr) exceeds the ~780 px table pane: header labels 'UNIT' and 'EXT.' render on top of the inspector's 'LINE' section header, row Unit/Ext cells and the totals '$' value are clipped, footer segment reads '2 missing MF'. Designators column shrinks to 'D3,D4,D5,…'. In the inspector, the Unit price hint '@ 1' is clipped by the panel edge at both 1100 and 1440 widths. Order-quantity select is 16 px (kit 20/22). (The search field container is 22 px; the 15 px value is its inner input — not an issue.)
- Screenshots: [019-bom-1100x720](../evidence/shots/q5/dark/019-bom-1100x720.png), [001-bom-initial](../evidence/shots/q5/dark/001-bom-initial.png)
- Census: `census/bom-main-dark-1100.json`
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:42` — COLS fixed widths
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:730` — hint '@ 1' in 320px rail
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:451` — h-4 select
- Suggested fix: Give the table section min-w-0 + overflow-x-auto wrapping header+rows+totals together (or drop Description below ~1200px); clip the header row; move '@ 1' into the label ('Unit price @1') or widen the value column; use kit Select (h-[20px]) for Order quantity.
- Verification (vq5): **confirmed** — Reproduced at 1100x720: header 'UNIT' (x 796-852) and 'EXT.' (860-930) paint over the inspector (starts ~780) hiding its 'LINE' section header; Unit/Ext cells and totals '$' value cut; footer '2 missing MF…' truncated; Designators column shrinks to 'D3,D4,D5,…'; '@ 1' hint clipped at the rail edge (also at 1440). Refuted sub-claim: the search field is 22 px (kit SearchField container h-[22px]); the 15 px value is the inner <input>. The Order-quantity <select> is really 16 px (h-4, DesignerBomView.tsx:451). · evidence: [010-bom-1100x720](../evidence/shots/vq5/dark/010-bom-1100x720.png), [001-bom-grouped-mpn-edit](../evidence/shots/vq5/dark/001-bom-grouped-mpn-edit.png), dom: search container 22px / inner input 15px / select 16px

</details>


## T-222

**BOM Unit price field cannot accept decimals — typing 0.05 saves 5**

- Severity **S2** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner D4 · wave W2 · scope frontend · estimate S
- Findings: Q5-002

**Summary.** Each keystroke is converted with Number() and written back via toString(), so the '.' and leading zeros are swallowed: the field shows '5' and unitPrice=5 is autosaved (Unit $5.000, Ext $10.00). '1.5' becomes 15; non-numeric input becomes NaN→null. No way to enter any sub-dollar price, which is every passive.

**Root cause.** `src/modules/designer/frontend/components/DesignerBomView.tsx:726` — value={draft.unitPrice?.toString()} + onChange Number(v)

**Proposed fix.** Unit price keeps raw string draft; parse decimals on commit. — Detail: Keep the raw string in draft state (e.g. unitPriceText) and parse only when saving (normalizePatch), rejecting/flagging invalid input; use inputMode=decimal + pattern.

**Evidence.** [002-bom-unitprice-005-becomes-5](../evidence/shots/q5/dark/002-bom-unitprice-005-becomes-5.png), [003-bom-unitprice-decimal](../evidence/shots/vq5/dark/003-bom-unitprice-decimal.png)

<details><summary>Q5-002 — BOM Unit price field cannot accept decimals — typing 0.05 saves 5 (S2, confirmed)</summary>

- Area designer.bom · stack A · design 370447e2-d91e-43f1-b0a5-e7dc9f6bcafe · themes dark, light · viewports 1440x900
- Repro:
  1. Open 'LED Indicators 5V' → BOM
  2. Select line 'R3,R4'
  3. Click Unit price and type 0.05
- Expected: Field shows 0.05 and saves unitPrice=0.05.
- Actual: Each keystroke is converted with Number() and written back via toString(), so the '.' and leading zeros are swallowed: the field shows '5' and unitPrice=5 is autosaved (Unit $5.000, Ext $10.00). '1.5' becomes 15; non-numeric input becomes NaN→null. No way to enter any sub-dollar price, which is every passive.
- Screenshots: [002-bom-unitprice-005-becomes-5](../evidence/shots/q5/dark/002-bom-unitprice-005-becomes-5.png)
- Network: `GET …/bom → R3 unitPrice=5`
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:726` — value={draft.unitPrice?.toString()} + onChange Number(v)
- Suggested fix: Keep the raw string in draft state (e.g. unitPriceText) and parse only when saving (normalizePatch), rejecting/flagging invalid input; use inputMode=decimal + pattern.
- Verification (vq5): **confirmed** — Reproduced: R3 Unit price, select-all + type '0.05' -> field shows '5', backend unitPrice=5; '1.5' -> 15. Root cause DesignerBomView.tsx:725-728: value={draft.unitPrice?.toString()} + onChange Number(v) round-trips every keystroke, dropping '.' and leading zeros (non-numeric input renders 'NaN'). Workaround exists only by pasting the full string, so S2 kept. R3 price restored to its prior value (5). · evidence: [003-bom-unitprice-decimal](../evidence/shots/vq5/dark/003-bom-unitprice-decimal.png), run-code: typed '0.05' -> inputValue '5'; GET …/bom -> R3 unitPrice 5; typed '1.5' -> unitPrice 15

</details>


## T-223

**'Show in schematic' selects the part but leaves the canvas on an unrelated area; 'PCB' does not frame the part either**

- Severity **S2** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D1+D2+D3 · wave W2 · scope frontend · estimate S
- Findings: Q5-005

**Summary.** Schematic opens with R4 (or R2,R5,R6,R7,R8 for the grouped line) selected in Outline/Properties, but the canvas sits at 80% on D1/GND/+5V; the selected parts are not on screen. The frameToBoundsMm call in requestAnimationFrame runs before the freshly mounted schematic canvas restores its viewport, so it is lost. The PCB button selects R3 but keeps the whole-board view (parts are tiny and overlapping), no zoom-to-sel…

**Root cause.** `src/modules/designer/frontend/Space.tsx:866` — frameToBoundsMm in a single rAF right after setActiveView — lost on the fresh canvas mount

**Proposed fix.** Cross-probe 'Show in schematic'/'PCB' selects AND frames the part (zoom-to-selection) in target view. — Detail: Pass the frame request through the selectionRequest (like pcbSelectionRequest) and let SchematicCanvas/PcbCanvas frame the selection after their projection+viewport are ready.

**Evidence.** [012-bom-show-in-schematic](../evidence/shots/q5/dark/012-bom-show-in-schematic.png), [004-schem-fit](../evidence/shots/vq5/dark/004-schem-fit.png)

<details><summary>Q5-005 — 'Show in schematic' selects the part but leaves the canvas on an unrelated area; 'PCB' does not frame the part either (S2, confirmed)</summary>

- Area designer.bom · stack A · design 370447e2-d91e-43f1-b0a5-e7dc9f6bcafe · themes dark · viewports 1440x900
- Repro:
  1. Open 'LED Indicators 5V' → Schem → Fit schematic
  2. Go to BOM, click line R4 (at 24,40 mm)
  3. Click 'Show in schematic'
  4. Back to BOM, click R3, click 'PCB'
- Expected: View switches and zooms/pans to the selected part(s), which are highlighted.
- Actual: Schematic opens with R4 (or R2,R5,R6,R7,R8 for the grouped line) selected in Outline/Properties, but the canvas sits at 80% on D1/GND/+5V; the selected parts are not on screen. The frameToBoundsMm call in requestAnimationFrame runs before the freshly mounted schematic canvas restores its viewport, so it is lost. The PCB button selects R3 but keeps the whole-board view (parts are tiny and overlapping), no zoom-to-selection.
- Screenshots: [012-bom-show-in-schematic](../evidence/shots/q5/dark/012-bom-show-in-schematic.png), [014-bom-show-in-schem-R4](../evidence/shots/q5/dark/014-bom-show-in-schem-R4.png), [015-bom-show-in-pcb-R3](../evidence/shots/q5/dark/015-bom-show-in-pcb-R3.png)
- Code: `src/modules/designer/frontend/Space.tsx:866` — frameToBoundsMm in a single rAF right after setActiveView — lost on the fresh canvas mount
- Code: `src/modules/designer/frontend/Space.tsx:892` — handleBomShowPcb only sets pcbSelectionRequest
- Code: `src/modules/designer/frontend/pcb/PcbCanvas.tsx:1066` — selectionRequest effect selects but never frames
- Suggested fix: Pass the frame request through the selectionRequest (like pcbSelectionRequest) and let SchematicCanvas/PcbCanvas frame the selection after their projection+viewport are ready.
- Verification (vq5): **confirmed** — Reproduced: BOM line R4 -> 'Show in schematic' switches to Schem with R4 selected in Outline/Properties, but the canvas lands at 80% around D1/+5V; R4 is off-screen. With the canvas already mounted, 'Zoom to selection' frames R4 correctly (89%), so the frame math is fine and the rAF frameToBoundsMm call in Space.tsx:866-873 is lost because the schematic canvas remounts on the tab switch (cameraRef not ready / default camera applied after). BOM 'PCB' selects R3 but keeps the whole-board view (Space.tsx:892-905 sets only pcbSelectionRequest; PcbCanvas.tsx:1066-1091 never frames). Not a PLAN decision (D12 says cross-probe logic untouched — it was already broken). Workaround (Zoom to selection) exists -> S2 kept. · evidence: [004-schem-fit](../evidence/shots/vq5/dark/004-schem-fit.png), [005-bom-show-in-schem-R4](../evidence/shots/vq5/dark/005-bom-show-in-schem-R4.png), [006-bom-show-in-pcb-R3](../evidence/shots/vq5/dark/006-bom-show-in-pcb-R3.png)

</details>


## T-224

**BOM match tiers and counters contradict each other (no-MPN lines tagged 'Suggested', typed MPN tagged 'verified', Missing-MPN counts differ)**

- Severity **S2** · category data · status confirmed · themes dark, light
- Recommendation **fix-now** · decision DEC-B · owner D4 · wave W2 · scope frontend · estimate S
- Findings: Q5-006

**Summary.** (1) Every R/C/L/D line without MPN shows an amber 'Suggested' dot although no suggestion exists and the legend says Missing = 'no MPN'; the MPN cell simultaneously says 'Add part number' in red. (2) After typing any string (e.g. 'RC0603' or even 'FR-07150RL') the line becomes green 'Exact' = 'MPN set and verified against supplier' — nothing is verified. (3) Filter chip 'Missing MPN 4' counts the DNP line while statu…

**Root cause.** `src/modules/designer/frontend/components/DesignerBomView.tsx:83` — severityOf: R/C/L/D without MPN → 'suggested'; any MPN → 'sourced'/Exact

**Proposed fix.** Two honest tiers ('Has MPN' / 'Missing'), DNP excluded from missing counts, one estimate in totals + footer. — Detail: Until supplier matching exists, use two tiers: 'Has MPN' (neutral/success wording without 'verified') and 'Missing'; exclude DNP from all missing counts and render DNP MPN cell neutral; show the same estimate in totals row and footer; pluralise 'part(s)'.

**Evidence.** [001-bom-initial](../evidence/shots/q5/dark/001-bom-initial.png), [001-bom-grouped-mpn-edit](../evidence/shots/vq5/dark/001-bom-grouped-mpn-edit.png)

<details><summary>Q5-006 — BOM match tiers and counters contradict each other (no-MPN lines tagged 'Suggested', typed MPN tagged 'verified', Missing-MPN counts differ) (S2, confirmed)</summary>

- Area designer.bom · stack A · design 370447e2-d91e-43f1-b0a5-e7dc9f6bcafe · themes dark, light · viewports 1440x900
- Repro:
  1. Open 'LED Indicators 5V' → BOM
  2. Hover tier dots; compare with the Match tier legend
  3. Type any MPN on R3
  4. Mark D2 DNP, look at filter chips vs status bar
- Expected: Tier/legend/counters derived from one rule and consistent; 'Exact' only when verified; DNP lines not flagged as errors.
- Actual: (1) Every R/C/L/D line without MPN shows an amber 'Suggested' dot although no suggestion exists and the legend says Missing = 'no MPN'; the MPN cell simultaneously says 'Add part number' in red. (2) After typing any string (e.g. 'RC0603' or even 'FR-07150RL') the line becomes green 'Exact' = 'MPN set and verified against supplier' — nothing is verified. (3) Filter chip 'Missing MPN 4' counts the DNP line while status bar says '3 missing MPN'. (4) DNP line D2 still shows red 'Add part number'. (5) Totals row shows '$0.00' / '$5.00' while the footer shows 'est. — @ 5 boards'. (6) '1 line · 1 parts' pluralisation.
- Screenshots: [001-bom-initial](../evidence/shots/q5/dark/001-bom-initial.png), [007-bom-select-all-bulkbar](../evidence/shots/q5/dark/007-bom-select-all-bulkbar.png), [009-bom-dnp-filter](../evidence/shots/q5/dark/009-bom-dnp-filter.png)
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:83` — severityOf: R/C/L/D without MPN → 'suggested'; any MPN → 'sourced'/Exact
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:136` — counts.missingMpn includes DNP rows; missingMpnCount excludes them
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:421` — '{totals.parts} parts' not pluralised
- Suggested fix: Until supplier matching exists, use two tiers: 'Has MPN' (neutral/success wording without 'verified') and 'Missing'; exclude DNP from all missing counts and render DNP MPN cell neutral; show the same estimate in totals row and footer; pluralise 'part(s)'.
- Verification (vq5): **confirmed** — Confirmed in UI and code. D1 carries a bogus MPN 'FR-07150RL' and its tier dot is 'Exact' while the legend says 'MPN set and verified against supplier' (nothing is verified; severityOf at DesignerBomView.tsx:83-90 returns 'sourced' whenever row.warnings is empty). R/C/L/D lines without MPN get the amber 'Suggested' tier although no suggestion exists, next to red 'Add part number'. Chip 'Missing MPN 3' counts DNP D2 while footer says '2 missing MPN' and totals say '2 without MPN' (:131-140). DNP D2 still shows red 'Add part number'. Totals row '$5.00' vs footer 'est. — @ 5 boards'. '{n} parts' not pluralised (:421). The tier->label mapping itself is PLAN D12, but D6 says elements without backing data must be omitted, not faked; the 'verified against supplier'/'inferred from value + footprint' copy is a false claim. Raised S3->S2 per rubric ('misleading claim': a typo'd MPN is presented as supplier-verified in a purchasing tool). · evidence: [001-bom-grouped-mpn-edit](../evidence/shots/vq5/dark/001-bom-grouped-mpn-edit.png), [007-bom-filter-hides-selected-line](../evidence/shots/vq5/dark/007-bom-filter-hides-selected-line.png), snapshot: row D1 img 'Exact' with MPN 'FR-07150RL'; 'Missing MPN 3' chip vs '2 missing MPN' footer

</details>


## T-225

**BOM sourcing/DNP edits are not reflected in the schematic part inspector (two unsynced sources of truth)**

- Severity **S2** · category data · status confirmed · themes dark
- Recommendation **decide** · decision DEC-B · owner D4 · wave W2 · scope backend · estimate M
- Findings: Q5-011

**Summary.** Schematic inspector shows R3 MPN/Manufacturer empty and D2 DNP unchecked while BOM/exports use the BOM overrides (PnP omits D2). Schematic→BOM does propagate (R4 DNP=true, mpn='SCHEM-MPN-R4' appear in the BOM), so the two stores diverge silently; which one wins when both are set is invisible to the user.

**Root cause.** `src/modules/designer/backend/routes.ts:3158` — BOM overrides stored separately from part fields

**Proposed fix.** Backend: single source of truth for sourcing/DNP (BOM edits visible in part inspector). — Detail: Make the BOM PATCH write the part fields (MPN/Manufacturer/DNP) through the designer command bus, or have the schematic inspector read the merged value (override ?? field) and show an 'overridden in BOM' hint.

**Evidence.** [018-schem-R3-mpn-not-synced-with-bom](../evidence/shots/q5/dark/018-schem-R3-mpn-not-synced-with-bom.png), [008-schem-R3-mpn-empty-vs-bom](../evidence/shots/vq5/dark/008-schem-R3-mpn-empty-vs-bom.png)

<details><summary>Q5-011 — BOM sourcing/DNP edits are not reflected in the schematic part inspector (two unsynced sources of truth) (S2, confirmed)</summary>

- Area designer.bom · stack A · design 370447e2-d91e-43f1-b0a5-e7dc9f6bcafe · themes dark · viewports 1440x900
- Repro:
  1. BOM: set R3 MPN 'RC0603FR-07330RL', Manufacturer 'Yageo'; mark D2 DNP (persisted, verified after reload and via GET …/bom)
  2. Switch to Schem, select R3 → Properties → Fields; select D2 → Attributes
  3. Conversely tick 'DNP (do not populate)' and type MPN on R4 in the schematic inspector, then GET …/bom
- Expected: One MPN/Manufacturer/DNP per designator, shown identically in the schematic inspector, BOM and exports.
- Actual: Schematic inspector shows R3 MPN/Manufacturer empty and D2 DNP unchecked while BOM/exports use the BOM overrides (PnP omits D2). Schematic→BOM does propagate (R4 DNP=true, mpn='SCHEM-MPN-R4' appear in the BOM), so the two stores diverge silently; which one wins when both are set is invisible to the user.
- Screenshots: [018-schem-R3-mpn-not-synced-with-bom](../evidence/shots/q5/dark/018-schem-R3-mpn-not-synced-with-bom.png)
- Network: `GET …/bom → R3 mpn=RC0603FR-07330RL, D2 dnp=true; schematic inspector inputs: MPN='' Manufacturer='' DNP=false`
- Code: `src/modules/designer/backend/routes.ts:3158` — BOM overrides stored separately from part fields
- Suggested fix: Make the BOM PATCH write the part fields (MPN/Manufacturer/DNP) through the designer command bus, or have the schematic inspector read the merged value (override ?? field) and show an 'overridden in BOM' hint.
- Verification (vq5): **confirmed** — Reproduced and strengthened: schematic inspector for R3 shows MPN/Manufacturer empty while the BOM (and exports) use override 'RC0603FR-07330RL'/'Yageo'. Then typed MPN 'SCHEM-R3' in the schematic inspector (committed, revision 73): GET …/bom still returns R3 mpn='RC0603FR-07330RL' — the BOM override silently wins (writer.ts:233 override ?? part props), so the user's schematic edit has no effect on BOM/exports and nothing indicates it. Reverted the schematic field afterwards. S2 kept (wrong data shown in one surface, edits silently ignored). · evidence: [008-schem-R3-mpn-empty-vs-bom](../evidence/shots/vq5/dark/008-schem-R3-mpn-empty-vs-bom.png), [009-schem-R3-mpn-ignored-by-bom](../evidence/shots/vq5/dark/009-schem-R3-mpn-ignored-by-bom.png), network: schematic MPN 'SCHEM-R3' -> rev 73; GET …/bom -> R3 mpn RC0603FR-07330RL

</details>


## T-226

**Empty design BOM says 'No BOM lines match the current filter.' with filter=All, and Export stays enabled**

- Severity **S3** · category copy · status confirmed · themes dark
- Recommendation **fix-now** · owner D4 · wave W2 · scope frontend · estimate XS
- Findings: Q5-003 · known ref K31

**Summary.** Table body reads 'No BOM lines match the current filter.' although nothing is filtered; inspector reads 'No BOM row selected.' plus the Match tier legend; Export menu is enabled and PnP downloads a header-only file (openpcb-a0ce5e9e-…-pnp.csv containing only 'Designator,Val,Package,Mid X,Mid Y,Rotation,Layer'); totals row shows $0.00 while status bar shows 'est. —'.

**Root cause.** `src/modules/designer/frontend/components/DesignerBomView.tsx:404` — single empty message for both empty BOM and no-match

**Proposed fix.** Empty design BOM: 'No parts yet' empty state; Export disabled. — Detail: Branch on allRows.length===0 vs rows.length===0 and render a proper EmptyState; disable ExportMenu items when bom.rows is empty (or show a toast).

**Evidence.** [016-bom-empty-design](../evidence/shots/q5/dark/016-bom-empty-design.png), [008-bom-empty-design](../evidence/shots/vq5/light/008-bom-empty-design.png)

<details><summary>Q5-003 — Empty design BOM says 'No BOM lines match the current filter.' with filter=All, and Export stays enabled (S3, confirmed)</summary>

- Area designer.bom · stack A · design a0ce5e9e-1d68-4e1a-9ce8-7139ce6b…(QA-q5-empty) · themes dark · viewports 1440x900
- Repro:
  1. Designer → New design (+), rename tab to QA-q5-empty
  2. Open BOM tab (filter All 0, search empty)
  3. Open Export ▾ → PnP
- Expected: An empty state that explains there are no parts yet (e.g. 'No parts in this design — place components in the schematic') with a link to Schematic; Export disabled or warns that the BOM is empty.
- Actual: Table body reads 'No BOM lines match the current filter.' although nothing is filtered; inspector reads 'No BOM row selected.' plus the Match tier legend; Export menu is enabled and PnP downloads a header-only file (openpcb-a0ce5e9e-…-pnp.csv containing only 'Designator,Val,Package,Mid X,Mid Y,Rotation,Layer'); totals row shows $0.00 while status bar shows 'est. —'.
- Screenshots: [016-bom-empty-design](../evidence/shots/q5/dark/016-bom-empty-design.png)
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:404` — single empty message for both empty BOM and no-match
- Suggested fix: Branch on allRows.length===0 vs rows.length===0 and render a proper EmptyState; disable ExportMenu items when bom.rows is empty (or show a toast).
- Verification (vq5): **confirmed** — Reproduced on QA-q5-empty (light): filter 'All 0', table body 'No BOM lines match the current filter.', inspector 'No BOM row selected.', totals '$0.00' while footer 'est. — @ 5 boards', Export ▾ enabled. Single message at DesignerBomView.tsx:404-408 for both empty BOM and no-match. K31 confirmed. · evidence: [008-bom-empty-design](../evidence/shots/vq5/light/008-bom-empty-design.png)

</details>


## T-227

**BOM inspector keeps showing a line that the active filter hides (or silently jumps to row 1)**

- Severity **S3** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D4 · wave W2 · scope frontend · estimate XS
- Findings: Q5-007

**Summary.** Table lists only D2..D8/R2../R4 but the inspector still shows 'D1 · 1 part' with its MPN — edits there apply to an invisible line. When no line was explicitly clicked the inspector shows bom.rows[0] regardless of filter/sort.

**Root cause.** `src/modules/designer/frontend/components/DesignerBomView.tsx:129` — selected = bom.rows.find(selectedId) ?? bom.rows[0] (unfiltered)

**Proposed fix.** Inspector follows filter (select first visible line or clear). — Detail: Resolve `selected` against the filtered `rows`; if the selected line is filtered out, clear the inspector or pick rows[0] of the filtered list.

**Evidence.** [005-bom-filter-missing-inspector-shows-hidden-D1](../evidence/shots/q5/dark/005-bom-filter-missing-inspector-shows-hidden-D1.png), [007-bom-filter-hides-selected-line](../evidence/shots/vq5/dark/007-bom-filter-hides-selected-line.png)

<details><summary>Q5-007 — BOM inspector keeps showing a line that the active filter hides (or silently jumps to row 1) (S3, confirmed)</summary>

- Area designer.bom · stack A · design 370447e2-d91e-43f1-b0a5-e7dc9f6bcafe · themes dark · viewports 1440x900
- Repro:
  1. BOM of 'LED Indicators 5V', inspector showing D1 (has an MPN)
  2. Click filter 'Missing MPN' (or 'DNP')
- Expected: Inspector follows the visible selection (first visible line, or an empty 'select a line' state).
- Actual: Table lists only D2..D8/R2../R4 but the inspector still shows 'D1 · 1 part' with its MPN — edits there apply to an invisible line. When no line was explicitly clicked the inspector shows bom.rows[0] regardless of filter/sort.
- Screenshots: [005-bom-filter-missing-inspector-shows-hidden-D1](../evidence/shots/q5/dark/005-bom-filter-missing-inspector-shows-hidden-D1.png), [009-bom-dnp-filter](../evidence/shots/q5/dark/009-bom-dnp-filter.png)
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:129` — selected = bom.rows.find(selectedId) ?? bom.rows[0] (unfiltered)
- Suggested fix: Resolve `selected` against the filtered `rows`; if the selected line is filtered out, clear the inspector or pick rows[0] of the filtered list.
- Verification (vq5): **confirmed** — Reproduced: D1 selected, click 'Missing MPN 3' -> table lists only D2, D3..D8, R2.. while the inspector still shows D1 with its MPN (editable). Root cause DesignerBomView.tsx:128-129 resolves `selected` against unfiltered bom.rows. Separate symptom from Q5-001 (same selection helper, different trigger); one fix (resolve selection by stable key against filtered rows) covers both. · evidence: [007-bom-filter-hides-selected-line](../evidence/shots/vq5/dark/007-bom-filter-hides-selected-line.png)

</details>


## T-228

**BOM rows are not keyboard reachable — Tab only visits row checkboxes, arrows/Enter do nothing**

- Severity **S3** · category keyboard · status confirmed · themes dark
- Recommendation **fix-now** · owner D4 · wave W2 · scope frontend · estimate S
- Findings: Q5-008 · known ref K35

**Summary.** Tab order: Export ▾ → Select all → Designators → 'Select D1' … 'Select R4' (checkboxes only) → Order quantity → Show in schematic. Arrow keys and Enter don't change the inspector (stays D1). Keyboard users cannot open a line in the inspector except the default first row. Rows have no role/tabIndex/aria-selected.

**Root cause.** `src/modules/designer/frontend/components/DesignerBomView.tsx:501` — TableRow onClick only

**Proposed fix.** BOM rows focusable with arrow navigation; Enter opens inspector. — Detail: Give the rows container role=grid/listbox, rows role=row/option + tabIndex (roving) + aria-selected, handle ArrowUp/Down/Home/End/Enter; same for Home design list.

**Evidence.** [017-bom-keyboard-focus](../evidence/shots/q5/dark/017-bom-keyboard-focus.png)

<details><summary>Q5-008 — BOM rows are not keyboard reachable — Tab only visits row checkboxes, arrows/Enter do nothing (S3, confirmed)</summary>

- Area designer.bom · stack A · design 370447e2-d91e-43f1-b0a5-e7dc9f6bcafe · themes dark · viewports 1440x900
- Repro:
  1. BOM of 'LED Indicators 5V', focus the search field
  2. Press Tab repeatedly, then ArrowDown ×2 and Enter on a row checkbox
- Expected: Rows are focusable (roving tabindex / grid role), ArrowUp/Down move the selection and the inspector follows; Enter/Space selects.
- Actual: Tab order: Export ▾ → Select all → Designators → 'Select D1' … 'Select R4' (checkboxes only) → Order quantity → Show in schematic. Arrow keys and Enter don't change the inspector (stays D1). Keyboard users cannot open a line in the inspector except the default first row. Rows have no role/tabIndex/aria-selected.
- Screenshots: [017-bom-keyboard-focus](../evidence/shots/q5/dark/017-bom-keyboard-focus.png)
- Console: `activeElement sequence: BUTTON Export ▾, INPUT Select all, BUTTON Designators ▴, INPUT Select D1 … INPUT Select R4, SELECT Order quantity, BUTTON Show in schematic`
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:501` — TableRow onClick only
- Suggested fix: Give the rows container role=grid/listbox, rows role=row/option + tabIndex (roving) + aria-selected, handle ArrowUp/Down/Home/End/Enter; same for Home design list.
- Verification (vq5): **confirmed** — Reproduced Tab order from the search field: Export ▾ -> Select all -> Designators ▴ -> Select D1 … Select R4 (checkboxes) -> Order quantity -> Show in schematic -> PCB; ArrowDown/Enter did not change the inspector (stays D1). Shared TableRow (src/shared/frontend/ui/data-table.tsx:35-58) is a plain div with no role/tabIndex/aria-selected; BomRow only passes onClick. K35 confirmed for BOM. · evidence: console: tab order BUTTON Export ▾, INPUT Select all, BUTTON Designators ▴, INPUT Select D1..R4, SELECT Order quantity, BUTTON Show in schematic, BUTTON PCB

</details>


## T-229

**BOM exports: no feedback for Copy TSV / downloads, filenames use a truncated design UUID, CSV silently drops DNP lines while keeping a DNP column**

- Severity **S3** · category copy · status confirmed · themes dark
- Recommendation **fix-now** · owner D4+D1 · wave W2 · scope frontend · estimate S
- Findings: Q5-010

**Summary.** Files are named 'openpcb-370447e2-d91e-43f1-b0a5-e7dc9f6b-csv.csv', '…-jlc.csv', '…-kicad.csv', '…-pnp.csv' (UUID truncated, kind duplicated before the extension). Copy TSV gives no confirmation; export failures (res.ok false → throw) are unhandled promise rejections with no UI. 'CSV' omits DNP line D2 entirely yet has a 'DNP' column that is always 'no'; KiCad CSV includes D2 with DNP=1; PnP omits it. Menu is announ…

**Root cause.** `src/modules/designer/frontend/api.ts:716` — downloadBomArtifact filename + throw without UI

**Proposed fix.** Export toast/feedback, 'Copied' confirmation, CSV keeps DNP rows marked (or drop DNP column consistently). — Detail: Name files '<design-name>-BOM.csv', '<design-name>-JLC-BOM.csv', '<design-name>-CPL.csv'; wrap exports in try/catch + toast; show 'Copied N lines' toast; either include DNP rows flagged DNP=yes in generic CSV or drop the column; aria-label='Export'.

**Evidence.** `network: GET …/exports/bom.csv, bom-jlc.csv, kicad-bom.csv, pnp.csv → 200`

<details><summary>Q5-010 — BOM exports: no feedback for Copy TSV / downloads, filenames use a truncated design UUID, CSV silently drops DNP lines while keeping a DNP column (S3, confirmed)</summary>

- Area designer.bom · stack A · design 370447e2-d91e-43f1-b0a5-e7dc9f6bcafe · themes dark · viewports 1440x900
- Repro:
  1. BOM → Export ▾ → CSV / JLC BOM / PnP / KiCad CSV / Copy TSV; also ⌘E
  2. Open the downloaded files
- Expected: Human-readable filenames (design name + kind), a toast for 'Copied N lines' / export errors, and DNP handled consistently.
- Actual: Files are named 'openpcb-370447e2-d91e-43f1-b0a5-e7dc9f6b-csv.csv', '…-jlc.csv', '…-kicad.csv', '…-pnp.csv' (UUID truncated, kind duplicated before the extension). Copy TSV gives no confirmation; export failures (res.ok false → throw) are unhandled promise rejections with no UI. 'CSV' omits DNP line D2 entirely yet has a 'DNP' column that is always 'no'; KiCad CSV includes D2 with DNP=1; PnP omits it. Menu is announced as 'Export ▾' (glyph in accessible name).
- Network: `GET …/exports/bom.csv, bom-jlc.csv, kicad-bom.csv, pnp.csv → 200`
- Code: `src/modules/designer/frontend/api.ts:716` — downloadBomArtifact filename + throw without UI
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:262` — copyTsv no feedback / no catch
- Code: `src/sdks/designer/pcb-helpers.ts:13` — exportBundleName(designId)
- Suggested fix: Name files '<design-name>-BOM.csv', '<design-name>-JLC-BOM.csv', '<design-name>-CPL.csv'; wrap exports in try/catch + toast; show 'Copied N lines' toast; either include DNP rows flagged DNP=yes in generic CSV or drop the column; aria-label='Export'.
- Verification (vq5): **confirmed** — Reproduced Export ▾ -> CSV: file 'openpcb-370447e2-d91e-43f1-b0a5-e7dc9f6b-csv.csv' (exportBundleName slices the UUID to 32 chars, api.ts:736-739 appends '-csv.csv'); CSV omits DNP lines D2 and R4 yet every remaining row has DNP='no' (writer.ts:90 filters !row.dnp while keeping the DNP column). copyTsv (DesignerBomView.tsx:262-265) has no feedback and no catch; downloadBomArtifact throws 'HTTP n' into a void promise (unhandled). Accessible name 'Export ▾' confirmed in the a11y tree. Note the backend already sets a friendlier Content-Disposition 'openpcb-<id>-BOM.csv' that the client ignores. · evidence: .playwright-cli/openpcb-370447e2-d91e-43f1-b0a5-e7dc9f6b-csv.csv (5 rows, no D2/R4, DNP column all 'no')

</details>


## T-230

**Only the Designators column sorts; Value/Footprint/Qty/MPN headers are inert (dead sort keys in code)**

- Severity **S4** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner D4 · wave W2 · scope frontend · estimate S
- Findings: Q5-009

**Summary.** Only Designators toggles; other headers are plain spans. compareRows() implements value/footprint/qty/mpn/lcsc but nothing calls toggleSort with them. No aria-sort. When rows are checked the header row (incl. sort + Select all) is replaced by the bulk bar.

**Root cause.** `src/modules/designer/frontend/components/DesignerBomView.tsx:368` — only refs header is a button

**Proposed fix.** Make Value/Footprint/Qty/MPN headers sortable (compareRows exists) with aria-sort. — Detail: Render every sortable header as a button calling toggleSort(key) with the glyph + aria-sort; keep the header visible while the bulk bar shows (put bulk actions in the toolbar).

**Evidence.** [007-bom-select-all-bulkbar](../evidence/shots/q5/dark/007-bom-select-all-bulkbar.png), [002-bom-bulk-dnp-first-ref-only](../evidence/shots/vq5/dark/002-bom-bulk-dnp-first-ref-only.png)

<details><summary>Q5-009 — Only the Designators column sorts; Value/Footprint/Qty/MPN headers are inert (dead sort keys in code) (S4, confirmed)</summary>

- Area designer.bom · stack A · design 370447e2-d91e-43f1-b0a5-e7dc9f6bcafe · themes dark · viewports 1440x900
- Repro:
  1. BOM → click 'Designators' (toggles ▴/▾)
  2. Click 'Qty', 'Value', 'MPN' headers
- Expected: All data columns sortable (Qty/Value especially), with aria-sort on the active header.
- Actual: Only Designators toggles; other headers are plain spans. compareRows() implements value/footprint/qty/mpn/lcsc but nothing calls toggleSort with them. No aria-sort. When rows are checked the header row (incl. sort + Select all) is replaced by the bulk bar.
- Screenshots: [007-bom-select-all-bulkbar](../evidence/shots/q5/dark/007-bom-select-all-bulkbar.png)
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:368` — only refs header is a button
- Code: `src/modules/designer/frontend/components/DesignerBomView.tsx:933` — unused sort keys
- Suggested fix: Render every sortable header as a button calling toggleSort(key) with the glyph + aria-sort; keep the header visible while the bulk bar shows (put bulk actions in the toolbar).
- Verification (vq5): **confirmed** — Code-confirmed: only the Designators header is a button (DesignerBomView.tsx:365-372); Value/Footprint/Qty/MPN are spans although compareRows implements value/footprint/qty/mpn/lcsc; no aria-sort; bulk bar replaces the header row when rows are checked (:344-362). Pre-existing (pre-redesign BOM also only sorted by refs) and D12 specifies no per-column sort. Downgraded S3->S4: nothing on screen claims the other columns are sortable, so this is a missing enhancement/a11y polish rather than a visible inconsistency. · evidence: src/modules/designer/frontend/components/DesignerBomView.tsx:365, [002-bom-bulk-dnp-first-ref-only](../evidence/shots/vq5/dark/002-bom-bulk-dnp-first-ref-only.png)

</details>

