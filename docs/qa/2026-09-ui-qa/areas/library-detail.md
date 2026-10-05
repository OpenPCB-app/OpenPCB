# library.detail — QA findings

[← index](../README.md) · 18 triage entries · S1 0 · S2 3 · S3 13 · S4 2

| TID | Sev | Title | Findings | Rec | Owner / wave | Scope | Est |
|---|---|---|---|---|---|---|---|
| [T-270](#t-270) | S2 | 'Duplicate to edit' drops footprint options/pin map/metadata and copy stays locked (STEP upload fails) | Q6-005, Q6-019 | decide (DEC-L) | L1 / W2 | backend | M |
| [T-271](#t-271) | S2 | Re-import destroys a part's working 3D model up front; if the GLB upload fails the swallowed PATCH leaves it stuck on 'Converting 3D model…' forever with no retry | Q6-024 | fix-now (DEC-L) | L1 / W2 | frontend | M |
| [T-272](#t-272) | S2 | 'Upload STEP' button in the 3D card's empty state does nothing (dead primary button) | Q6-025 | fix-now | L1 / W2 | frontend | S |
| [T-273](#t-273) | S3 | Detail-page save errors show 'Internal error' / 'Update failed (HTTP 500)' / 'Failed to fetch' in a 10px box with no role=alert and no guidance | F1C-014 | fix-now | L1 / W2 | frontend | S |
| [T-274](#t-274) | S3 | Long part names break the detail header and can't be read in the preview pane, palette or inspector (no wrap, no name tooltip, name absent in the inspector) | F1C-017 | fix-now | L1 / W2 | frontend | S |
| [T-275](#t-275) | S3 | Fullscreen symbol/footprint preview modal doesn't take or trap focus | Q6-014 | fix-now | L1 / W2 | frontend | S |
| [T-276](#t-276) | S3 | After saving an edit on the detail page, Back returns to a stale list (old name, old facets) | Q6-015 | fix-now | L1 / W2 | frontend | XS |
| [T-277](#t-277) | S3 | Library 'Place in design' is a disabled stub and Library→design drag path is broken (MIME mismatch) | Q6-016, F1C-006 | fix-now | L1+D2 / W2 | frontend | M |
| [T-278](#t-278) | S3 | Detail page hides MPN/manufacturer, truncates Details labels and cannot edit part metadata | Q6-017 | fix-now | L1 / W2 | frontend | M |
| [T-279](#t-279) | S3 | Tag editor exposes internal tags (kicad-derived, user, builtin, system) and its input/suggestions lack accessible semantics | Q6-018 | fix-now | L1 / W2 | frontend | S |
| [T-280](#t-280) | S3 | Library 3D card: off-token failure panel and upload errors that leak across parts | Q6-026, Q6-027 | fix-now | L1 / W2 | frontend | S |
| [T-281](#t-281) | S3 | Library 3D preview shows most models lying on their side (Z-up models in a Y-up viewer) | Q6-028 | fix-now | L1 / W2 | frontend | S |
| [T-282](#t-282) | S3 | Footprint previews are framed around invisible F.Fab text, so imported footprints sit off-centre and small | Q6-029 | fix-now | L1 / W2 | frontend | S |
| [T-283](#t-283) | S3 | Unsaved part edits are discarded silently on Back or rail navigation (no dirty guard) | Q6-031 | fix-now | L1 / W2 | frontend | S |
| [T-284](#t-284) | S3 | Light theme: messages inside the always-dark canvas wells use light-theme tokens (dark text, light borders) — low contrast, glaring boxes | Q6-034 | fix-now | L1+F0a / W2 | frontend | S |
| [T-285](#t-285) | S3 | Imported part gets wrong auto tags / package from the footprint (R symbol tagged 'capacitor', package '1608' vs '0603') | Q7-020 | decide (DEC-L) | L1 / W2 | backend | S |
| [T-286](#t-286) | S4 | Every STEP conversion floods the console with ~200 'GLTFExporter: Use MeshStandardMaterial…' warnings | Q6-036 | defer | followup / followup | shared-package | XS |
| [T-287](#t-287) | S4 | Detail page copy nits: fullscreen title upper-cases identifiers; missing part shows a bare 'Component detail not found' box | Q6-037 | fix-now | L1 / W2 | frontend | XS |

## T-270

**'Duplicate to edit' drops footprint options/pin map/metadata and copy stays locked (STEP upload fails)**

- Severity **S2** · category data · status confirmed · themes dark
- Recommendation **decide** · decision DEC-L · owner L1 · wave W2 · scope backend · estimate M
- Findings: Q6-005, Q6-019

**Summary.** The copy has exactly 1 footprint option (the default) with no pin map: Resistor clone → 1 variant 'R_0603_1608Metric' (pinMap null) vs 9 on the original; 74HC00 (Copy) Pins card says 'No pin map for this footprint.' and the variant label becomes the raw footprint name 'SOIC-14_3.9x8.7mm_P1.27mm'. Manufacturer/MPN/LCSC/datasheet/keywords/supplier/subcategory are not copied either. The Details 'Source' row becomes '—'. | Also covers: Q6-019: Upload STEP on a duplicated part always fails after conversion with 'Cannot update built-…

**Root cause.** `src/modules/library/backend/queries.ts:1450` — cloneComponent inserts only the components row (name/description/symbolId/footprintId/tags); component-footprint option rows (pin maps, variant labels) and metadata columns are not copied

**Proposed fix.** Backend clone copies footprints/pin map/metadata and clears builtin lock (STEP upload works on copy). — Detail: In cloneComponent copy the component_footprints rows (variant label, isDefault, pinMap) and all metadata columns (manufacturer, MPN, LCSC, supplier, subcategory, datasheetUrl, keywords, provenance) inside one transaction; add a backend test comparing detail payloads of source and clone.

**Evidence.** [011-detail-builtin-scrolled](../evidence/shots/q6/dark/011-detail-builtin-scrolled.png), [062-clone-upload-valid-step-refused](../evidence/shots/q6/dark/062-clone-upload-valid-step-refused.png)

<details><summary>Q6-005 — 'Duplicate to edit' drops footprint options, pin map and part metadata from the copy (S2, confirmed)</summary>

- Area library.detail · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Stack B, Library → open core 'Resistor' (9 footprint options 0402…2512, each with a pin map)
  2. Click 'Duplicate to edit'
  3. Inspect the copy's detail page (Footprint options, Pins card) — or GET /components/{copyId}/detail
  4. Repeat with 74HC00 Quad NAND SOIC-14
- Expected: The copy is a faithful editable duplicate: same footprint options (with variant labels + pin maps), MPN/manufacturer/datasheet/LCSC/keywords.
- Actual: The copy has exactly 1 footprint option (the default) with no pin map: Resistor clone → 1 variant 'R_0603_1608Metric' (pinMap null) vs 9 on the original; 74HC00 (Copy) Pins card says 'No pin map for this footprint.' and the variant label becomes the raw footprint name 'SOIC-14_3.9x8.7mm_P1.27mm'. Manufacturer/MPN/LCSC/datasheet/keywords/supplier/subcategory are not copied either. The Details 'Source' row becomes '—'.
- Screenshots: [011-detail-builtin-scrolled](../evidence/shots/q6/dark/011-detail-builtin-scrolled.png), [012-after-duplicate](../evidence/shots/q6/dark/012-after-duplicate.png)
- Network: `GET /components/openpcb.core.passive.resistor/detail → 9 footprintVariants, pinMap set`; `GET /components/{clone}/detail → 1 footprintVariant, pinMap null`
- Code: `src/modules/library/backend/queries.ts:1450` — cloneComponent inserts only the components row (name/description/symbolId/footprintId/tags); component-footprint option rows (pin maps, variant labels) and metadata columns are not copied
- Suggested fix: In cloneComponent copy the component_footprints rows (variant label, isDefault, pinMap) and all metadata columns (manufacturer, MPN, LCSC, supplier, subcategory, datasheetUrl, keywords, provenance) inside one transaction; add a backend test comparing detail payloads of source and clone.
- Verification (vq6): **confirmed** — Reproduced via API on a fresh clone (POST /components/openpcb.core.ic.lm358/clone, renamed QA-vq6-…, deleted afterwards): original LM358 detail has 2 footprint options (SOIC-8 + DIP-8, both with pinMap) and manufacturer 'Texas Instruments' / MPN 'LM358DR'; the clone has 1 option 'SOIC-8_3.9x4.9mm_P1.27mm' with pinMap=false and manufacturer/MPN null. Existing q6 copy of 74HC00 likewise: variant label raw footprint name, pinMap false. Code queries.ts:1450-1510 cloneComponent inserts only the components row (no component_footprints rows, no metadata columns). S2 kept (the copy silently loses data the user duplicated it for). · evidence: POST /components/openpcb.core.ic.lm358/clone → 201; GET /components/<clone>/detail → 1 variant, pinMap null, MPN null, GET /components/8c098cbd…/detail → variant SOIC-14_3.9x8.7mm_P1.27mm pinMap null

</details>

<details><summary>Q6-019 — Upload STEP on a duplicated part always fails after conversion with 'Cannot update built-in components … use Duplicate to my library' (S2, confirmed)</summary>

- Area library.detail · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Stack B, Library → open core '74HC00 Quad NAND SOIC-14' → 'Duplicate to edit' (copy here: QA-Q6-74HC00-edited)
  2. On the copy click Edit → 3D model card 'Upload STEP'
  3. Choose a valid STEP (OP07CD.step extracted from fixtures/OP07CD.zip)
- Expected: The user's own copy can get its own 3D model (or the Upload STEP affordance is not offered / explains the footprint is shared with a built-in part and offers to fork it).
- Actual: The file is converted client-side ('Converting 3D model…' → 'Uploading GLB…'), then POST /footprints/openpcb.core.footprint.package.soic-14-…/model → 400 and the card shows: 'Cannot update built-in components (74HC00 Quad NAND SOIC-14). Use "Duplicate to my library" to create an editable copy.' The user IS on the duplicate; there is no 'Duplicate to my library' button (the real label is 'Duplicate to edit'). Cause: cloneComponent only inserts a new components row pointing at the built-in footprint, so every duplicate shares the core footprint and the backend guard rejects any model change. Dead end: duplicates can never get a 3D model.
- Screenshots: [062-clone-upload-valid-step-refused](../evidence/shots/q6/dark/062-clone-upload-valid-step-refused.png)
- Console: `notice spy: library-3d-upload-progress 'Converting 3D model…' → 'Uploading GLB…' → library-3d-upload-error 'Cannot update built-in components (74HC00 Quad NAND SOIC-14). Use "Duplicate to my library"…`
- Network: `POST /api/modules/library/footprints/openpcb.core.footprint.package.soic-14-3-9x8-7mm-p1-27mm/model → 400`
- Code: `src/modules/library/frontend/ComponentDetailPage.tsx:331` — canUploadStep = !isBuiltin && !isPlaceholderFootprint && editing — ignores that the footprint belongs to a built-in
- Code: `src/modules/library/frontend/ComponentDetailPage.tsx:288` — uploads to footprintId: effectiveSelectedId (the shared core footprint)
- Code: `src/modules/library/backend/routes.ts:1605` — assertFootprintNotBuiltinComponent rejects
- Code: `src/modules/library/backend/queries.ts:1410` — guard message references 'Duplicate to my library'
- Suggested fix: Either make Duplicate fork the footprint (copy footprint row + component_footprints) so the copy owns it, or have the detail DTO expose `footprintShared/readOnly` and hide Upload STEP with an explanation; fix the guard copy to match the real button label ('Duplicate to edit').
- Verification (vq6): **confirmed** — Confirmed: a duplicate keeps the core footprintId (clone of LM358 → openpcb.core.footprint.package.soic-8-…); in Edit mode its 3D card offers 'Upload STEP' (canUploadStep = !isBuiltin && !isPlaceholderFootprint && editing, ComponentDetailPage.tsx:331). POST /footprints/openpcb.core.footprint.package.soic-8-3-9x4-9mm-p1-27mm/model → 400 'Cannot update built-in components (LM358 Dual Op-Amp, NE555 Timer SOIC-8). Use "Duplicate to my library"…' (routes.ts:1605, queries.ts:1410) — the real button is 'Duplicate to edit'. Duplicates can therefore never get their own 3D model. S2 kept. · evidence: POST /api/modules/library/footprints/openpcb.core.footprint.package.soic-8-3-9x4-9mm-p1-27mm/model → 400 (guard message above), clone edit mode shows 'Upload STEP' label

</details>


## T-271

**Re-import destroys a part's working 3D model up front; if the GLB upload fails the swallowed PATCH leaves it stuck on 'Converting 3D model…' forever with no retry**

- Severity **S2** · category error-handling · status confirmed · themes light
- Recommendation **fix-now** · decision DEC-L · owner L1 · wave W2 · scope frontend · estimate M
- Findings: Q6-024 · known ref K41

**Summary.** POST /imports/kicad/zip → 200 immediately deletes the existing footprint_models row and writes status 'pending_client_conversion' (hasModel false). Client conversion runs, POST …/model → 500, PATCH …/model (mark failed) → 500 and is swallowed by `.catch(() => undefined)`. Notice sequence: 'Imported with warnings' → 4 ms later 'Converting 3D model' → 'Uploading GLB…' → '3D model conversion failed / Internal error'. A…

**Root cause.** `src/modules/library/frontend/three-d/model-conversion.ts:101` — markPendingModelConversionFailed: .catch(() => undefined) swallows the failed PATCH (K41)

**Proposed fix.** Frontend: surface failed GLB PATCH with Retry; stale 'Converting' -> Retry. Backend keep-old-model-until-new = decision. — Detail: Backend: keep the existing ready GLB (store the new STEP as a candidate) until a new GLB is committed; treat pending_client_conversion older than N minutes as failed in /model/meta. Frontend: retry/queue the failed PATCH and surface it; offer 'Retry conversion' for stale pending states in ThreeDComponentPreview.

**Evidence.** [022-import-upload-500](../evidence/shots/q6/light/022-import-upload-500.png), [018-stuck-converting-after-reload](../evidence/shots/vq6/dark/018-stuck-converting-after-reload.png)

<details><summary>Q6-024 — Re-import destroys a part's working 3D model up front; if the GLB upload fails the swallowed PATCH leaves it stuck on 'Converting 3D model…' forever with no retry (S2, confirmed)</summary>

- Area library.detail · stack B · design None · themes light · viewports 1440x900
- Repro:
  1. Stack B: LM324N (f0ab345c…, footprint c8cdca5a…) has a ready model (GET …/footprints/c8cdca5a…/model/meta → status ready, hasModel true)
  2. Library → route '**/api/modules/library/footprints/*/model' → 500 (simulates a failed GLB upload + a failed status PATCH)
  3. Import library… → fixtures/LM324N.zip (resolves to the existing part)
  4. Unroute, reload, open LM324N → 3D model card
- Expected: The previous model is kept until a new GLB is uploaded; on failure the card shows an error with Retry (and the footprint row is marked failed even if the first PATCH fails).
- Actual: POST /imports/kicad/zip → 200 immediately deletes the existing footprint_models row and writes status 'pending_client_conversion' (hasModel false). Client conversion runs, POST …/model → 500, PATCH …/model (mark failed) → 500 and is swallowed by `.catch(() => undefined)`. Notice sequence: 'Imported with warnings' → 4 ms later 'Converting 3D model' → 'Uploading GLB…' → '3D model conversion failed / Internal error'. After reload the server still reports pending_client_conversion; the card shows a permanent 'Converting 3D model…' box (checked after 12 s and after reload) with no Retry (canRetryConversion requires status failed) — the previously working model is gone. (Restored by Edit → Upload STEP with the extracted LM324N.step.) A non-JSON 500 on the upload would also surface the raw fallback 'Model upload failed (HTTP 500)'.
- Screenshots: [022-import-upload-500](../evidence/shots/q6/light/022-import-upload-500.png), [023-stuck-converting-after-reload](../evidence/shots/q6/light/023-stuck-converting-after-reload.png)
- Console: `notice spy: 'Imported with warnings…' t=648383 → 'Converting 3D model' t=648387 → 'Uploading GLB…' t=648824 → '3D model conversion failed Internal error' t=648832`
- Network: `POST /api/modules/library/imports/kicad/zip → 200`; `POST /api/modules/library/footprints/c8cdca5a-17f7-4970-93d2-e8f78d9ef358/model → 500 (routed)`; `PATCH /api/modules/library/footprints/c8cdca5a-…/model → 500 (routed, swallowed)`; `GET …/c8cdca5a-…/model/meta after reload → {status:'pending_client_conversion', hasModel:false}`
- Code: `src/modules/library/frontend/three-d/model-conversion.ts:101` — markPendingModelConversionFailed: .catch(() => undefined) swallows the failed PATCH (K41)
- Code: `src/modules/library/frontend/three-d/model-conversion.ts:154` — response.json().catch(() => null) → raw 'Model upload failed (HTTP n)' fallback
- Code: `src/modules/library/backend/import/commit-kicad-zip.ts:396` — deletes the existing footprint_models row and inserts pending_client_conversion before any conversion succeeded
- Code: `src/modules/library/frontend/three-d/ThreeDComponentPreview.tsx:290` — canRetryConversion only for status failed → pending state has no retry
- Suggested fix: Backend: keep the existing ready GLB (store the new STEP as a candidate) until a new GLB is committed; treat pending_client_conversion older than N minutes as failed in /model/meta. Frontend: retry/queue the failed PATCH and surface it; offer 'Retry conversion' for stale pending states in ThreeDComponentPreview.
- Verification (vq6): **confirmed** — Reproduced end-to-end on q6's LM324N (f0ab345c…, footprint c8cdca5a…, model ready): routed …/footprints/*/model → 500, Import library… → LM324N.zip: POST /imports/kicad/zip 200, POST …/model 500, PATCH …/model 500 (swallowed); notices 'Imported with warnings' → 'Converting 3D model' (3 ms) → 'Uploading GLB…' → '3D model conversion failed / Internal error'. After unroute + reload, meta = {status:'pending_client_conversion', hasModel:false} (the previously ready GLB is gone) and the card shows 'Converting 3D model…' after 12 s with no Retry. Restored afterwards via Edit → Upload STEP (LM324N.step, sha 5a15097a…) → status ready, same glbSha256 56c64007…. Code: commit-kicad-zip.ts:396 deletes the model row before conversion; model-conversion.ts:101 .catch(() => undefined); ThreeDComponentPreview.tsx:290 retry only for 'failed'. K41 confirmed. S2 kept. · evidence: [018-stuck-converting-after-reload](../evidence/shots/vq6/dark/018-stuck-converting-after-reload.png), POST …/footprints/c8cdca5a…/model → 500; PATCH → 500 (routed), GET …/c8cdca5a…/model/meta after reload → pending_client_conversion, hasModel false, restored: meta → ready, glbSha256 56c64007…

</details>


## T-272

**'Upload STEP' button in the 3D card's empty state does nothing (dead primary button)**

- Severity **S2** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L1 · wave W2 · scope frontend · estimate S
- Findings: Q6-025

**Summary.** Nothing happens — no file chooser, no focus change, no message. The button (data-testid library-3d-upload-step) has no onClick and no file input; the working 'Upload STEP' label only exists in the card header while editing. In light theme the button is --primary #1a1a1d on the #08090a canvas well, so its shape is almost invisible.

**Root cause.** `src/modules/library/frontend/three-d/ThreeDComponentPreview.tsx:146` — <button data-testid='library-3d-upload-step'> without onClick

**Proposed fix.** Wire 'Upload STEP' empty-state button to the file picker. — Detail: Pass an onUpload callback into ThreeDComponentPreview/ThreeDPreviewStatePanel that triggers the same hidden file input as the header (entering edit mode first), or replace the button with helper text; use a secondary/outline style inside the dark well.

**Evidence.** [020-dead-upload-step-view](../evidence/shots/q6/light/020-dead-upload-step-view.png), [013-dead-upload-step](../evidence/shots/vq6/dark/013-dead-upload-step.png)

<details><summary>Q6-025 — 'Upload STEP' button in the 3D card's empty state does nothing (dead primary button) (S2, confirmed)</summary>

- Area library.detail · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, Library → open a custom part without a 3D model (e.g. QA-q7-light-QFN16-preset, /model/meta status 'missing')
  2. Without entering Edit, click the centred 'Upload STEP' button in the 3D model card
- Expected: Opens the STEP file chooser (entering edit mode if required), or the empty state says 'Click Edit to upload a STEP model'.
- Actual: Nothing happens — no file chooser, no focus change, no message. The button (data-testid library-3d-upload-step) has no onClick and no file input; the working 'Upload STEP' label only exists in the card header while editing. In light theme the button is --primary #1a1a1d on the #08090a canvas well, so its shape is almost invisible.
- Screenshots: [020-dead-upload-step-view](../evidence/shots/q6/light/020-dead-upload-step-view.png), [063-missing-model-dead-upload](../evidence/shots/q6/dark/063-missing-model-dead-upload.png)
- Pixel probes: {"file": "shots/q6/light/020-dead-upload-step-view.png", "x": 1056, "y": 576, "hex": "#1a1a1d", "nearestToken": "--primary", "deltaE": 1.0}; {"file": "shots/q6/light/020-dead-upload-step-view.png", "x": 900, "y": 576, "hex": "#08090a", "nearestToken": "--surface-canvas-well", "deltaE": 0.0}
- Code: `src/modules/library/frontend/three-d/ThreeDComponentPreview.tsx:146` — <button data-testid='library-3d-upload-step'> without onClick
- Code: `src/modules/library/frontend/ComponentDetailPage.tsx:331` — canUploadStep only while editing — the header label is the only real upload control
- Suggested fix: Pass an onUpload callback into ThreeDComponentPreview/ThreeDPreviewStatePanel that triggers the same hidden file input as the header (entering edit mode first), or replace the button with helper text; use a secondary/outline style inside the dark well.
- Verification (vq6): **confirmed** — Reproduced: on QA-q7-light-QFN16-preset (no model) clicking the centred 'Upload STEP' (data-testid library-3d-upload-step) does nothing — no file chooser, no edit mode, 0 file inputs on the page. ThreeDComponentPreview.tsx:145-151 renders the button with no onClick. Light probe: button #1c1c1f (--primary) on #08090a well. S2 kept (dead primary action; workaround Edit → header Upload STEP). · evidence: [013-dead-upload-step](../evidence/shots/vq6/dark/013-dead-upload-step.png), [002-dead-upload-step-in-well](../evidence/shots/vq6/light/002-dead-upload-step-in-well.png), probe 1060,558 #1c1c1f --primary; 1040,558 #08090a --surface-canvas-well

</details>


## T-273

**Detail-page save errors show 'Internal error' / 'Update failed (HTTP 500)' / 'Failed to fetch' in a 10px box with no role=alert and no guidance**

- Severity **S3** · category error-handling · status confirmed · themes dark
- Recommendation **fix-now** · owner L1 · wave W2 · scope frontend · estimate S
- Findings: F1C-014 · known ref K40
- Depends on: ['T-004', 'T-006']

**Summary.** The draft is preserved in all three failures, which is good. The messages are raw: 'Internal error' (problem title), 'Update failed (HTTP 500)' (K40) and 'Failed to fetch' (raw TypeError text). The box is 10px text, has no role/aria-live, and sits under the tag editor rather than near the Save button in the header. A successful save just closes the form with no confirmation. Navigating Back with a failed draft disca…

**Root cause.** `src/modules/library/frontend/ComponentDetailPage.tsx:208` — toUserError(payload, `Update failed (HTTP ${status})`)

**Proposed fix.** Detail save errors via problem.ts in kit Banner (role=alert), ≥11px. — Detail: Map errors in handleSave: TypeError → 'You're offline or the backend is unreachable'. 5xx → 'Couldn't save — server error' plus the problem detail when present. Render it with role="alert" at text-xs next to the header Save/Cancel, and show a transient 'Saved' status on success.

**Evidence.** [051-detail-save-500](../evidence/shots/f1c/dark/051-detail-save-500.png), [017-detail-save-500-empty](../evidence/shots/vf1c/dark/017-detail-save-500-empty.png)

<details><summary>F1C-014 — Detail-page save errors show 'Internal error' / 'Update failed (HTTP 500)' / 'Failed to fetch' in a 10px box with no role=alert and no guidance (S3, confirmed)</summary>

- Area library.detail · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Stack B, Library → open custom part 'R' (later renamed QA-f1c-R-accidental) → Edit
  2. Change the name and description
  3. route **/api/modules/library/components/<id> → 500 application/problem+json {title:'Internal error'} → Save
  4. route the same → 500 with an empty body → Save
  5. unroute; network-state-set offline → Save; then online → Save
- Expected: The draft is kept (it is). A readable message sits next to Save and is announced (role=alert), e.g. 'Couldn't save changes — the server returned an error. Your edits are kept; try again.' Offline gets its own message. A successful save gives brief confirmation.
- Actual: The draft is preserved in all three failures, which is good. The messages are raw: 'Internal error' (problem title), 'Update failed (HTTP 500)' (K40) and 'Failed to fetch' (raw TypeError text). The box is 10px text, has no role/aria-live, and sits under the tag editor rather than near the Save button in the header. A successful save just closes the form with no confirmation. Navigating Back with a failed draft discards it silently (Q6-031).
- Screenshots: [051-detail-save-500](../evidence/shots/f1c/dark/051-detail-save-500.png), [052-detail-save-500-nobody](../evidence/shots/f1c/dark/052-detail-save-500-nobody.png), [053-detail-save-offline](../evidence/shots/f1c/dark/053-detail-save-offline.png)
- Network: `PATCH /api/modules/library/components/ea9ed02d-… → 500 (routed)`
- Code: `src/modules/library/frontend/ComponentDetailPage.tsx:208` — toUserError(payload, `Update failed (HTTP ${status})`)
- Code: `src/modules/library/frontend/ComponentDetailPage.tsx:485` — saveError box: text-2xs, no role
- Suggested fix: Map errors in handleSave: TypeError → 'You're offline or the backend is unreachable'. 5xx → 'Couldn't save — server error' plus the problem detail when present. Render it with role="alert" at text-xs next to the header Save/Cancel, and show a transient 'Saved' status on success.
- Verification (vf1c): **confirmed** — Reproduced in vf1c-dark on part QA-f1c-R-accidental (ea9ed02d): Edit > change the description. A routed PATCH 500 with an empty body shows 'Update failed (HTTP 500)' in a 10 px box (font-size 10px, role null, aria-live null) at y=287 while Save is at y=8. Offline, it shows the raw 'Failed to fetch'. The draft is preserved ('vf1c draft kept after failed save'). Cancelled afterwards, with nothing saved and the route removed (route-list empty). Code: ComponentDetailPage.tsx:206-208 toUserError(payload, `Update failed (HTTP ${status})`), and the saveError box at :485 uses text-2xs with no role. K40 confirmed. S3 kept. · evidence: [017-detail-save-500-empty](../evidence/shots/vf1c/dark/017-detail-save-500-empty.png), saveError: {text:'Update failed (HTTP 500)', fontSize:'10px', role:null}; offline -> 'Failed to fetch'

</details>


## T-274

**Long part names break the detail header and can't be read in the preview pane, palette or inspector (no wrap, no name tooltip, name absent in the inspector)**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L1 · wave W2 · scope frontend · estimate S
- Findings: F1C-017

**Summary.** (1) The detail sticky header wraps the 200-char title onto two lines, so the header grows to 53 px at both 1440 and 1100. The same name then appears three times (header, H2, Details 'Component n…', the last one truncated with no tooltip). (2) The preview pane header and Name row are single-line ellipses with no title attribute (only the Description row has a tooltip), so the full name can't be read without opening t…

**Root cause.** `src/modules/library/frontend/ComponentDetailPage.tsx:339` — header <h1 className='text-base font-medium …'> with no truncate/min-w-0

**Proposed fix.** Long names wrap to 2 lines in detail header; tooltip in preview/palette/inspector. — Detail: ComponentDetailPage header: wrap the h1 in min-w-0 flex-1 and add 'truncate' plus title={name}. LibraryPreviewPane/LibraryCard/ComponentCommandPalette: add title={name} and title={description}, or allow a two-line clamp for the name. Palette preview: make the metadata column scroll with the Place button in a separate footer that doesn't overlay content. PartInspectorPanel: add a 'Library part' row with the component name, linked to Library.

**Evidence.** [037-longtext-table-1440](../evidence/shots/f1c/dark/037-longtext-table-1440.png), [019-longname-preview-pane](../evidence/shots/vf1c/dark/019-longname-preview-pane.png)

<details><summary>F1C-017 — Long part names break the detail header and can't be read in the preview pane, palette or inspector (no wrap, no name tooltip, name absent in the inspector) (S3, confirmed)</summary>

- Area library.detail · stack B · design 7c22a0f9-faf8-4d2d-9da7-95c117eac147 · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. Stack B: create part 'QA-f1c-LongName …' (200-char name, 300-char description, 20 tags) via the wizard (id 5cf27157-…)
  2. Library → search 'QA-f1c' → select the row (table), switch to Grid, double-click → detail page, open fullscreen symbol
  3. Designer → QA-f1c-drop → Components (Cmd+K) → search 'QA-f1c-LongName' → place → select R3 → set a 92-char MPN and a 132-char Manufacturer → BOM tab
  4. Repeat at 1100×720, both themes
- Expected: The detail header truncates the title to one line at the standard 34 px header height, with the full name in the page H2. Truncated names and descriptions in the preview pane, grid cards and palette expose the full text (title tooltip or wrap). The schematic inspector shows which library part an instance comes from.
- Actual: (1) The detail sticky header wraps the 200-char title onto two lines, so the header grows to 53 px at both 1440 and 1100. The same name then appears three times (header, H2, Details 'Component n…', the last one truncated with no tooltip). (2) The preview pane header and Name row are single-line ellipses with no title attribute (only the Description row has a tooltip), so the full name can't be read without opening the detail page. The table row has a title tooltip; grid cards and palette rows don't. (3) At 1100×720 the Cmd+K palette's preview column clips the tag chips under the 'Place' button (chips at y 593–607, Place 605–627, next chip row 611–625 fully hidden). (4) The schematic inspector for R3 shows only 'Symbol R' and 'Footprint C_0603_1608Metric'. The library component name and description appear nowhere, and the Outline 'VALUE' column shows the symbol name 'R' when the value is empty. The BOM handles the long MPN/Manufacturer/Description well (ellipsis plus title tooltips). Entering Value '10k 0.1% 25ppm thin-film …' is rejected via the global strip 'Value must include a valid resistor unit (Ω, kΩ, MΩ)', and the typed text is discarded (see Q3-018).
- Screenshots: [037-longtext-table-1440](../evidence/shots/f1c/dark/037-longtext-table-1440.png), [038-longtext-grid-1440](../evidence/shots/f1c/dark/038-longtext-grid-1440.png), [039-longtext-detail-1440](../evidence/shots/f1c/dark/039-longtext-detail-1440.png), [047-longtext-detail-1100](../evidence/shots/f1c/dark/047-longtext-detail-1100.png), [041-longtext-palette](../evidence/shots/f1c/dark/041-longtext-palette.png), [048-longtext-palette-1100](../evidence/shots/f1c/dark/048-longtext-palette-1100.png), [043-longtext-inspector-filled](../evidence/shots/f1c/dark/043-longtext-inspector-filled.png), [044-longtext-bom-1440](../evidence/shots/f1c/dark/044-longtext-bom-1440.png), [008-longtext-detail-1440](../evidence/shots/f1c/light/008-longtext-detail-1440.png), [010-longtext-inspector](../evidence/shots/f1c/light/010-longtext-inspector.png), [011-longtext-bom](../evidence/shots/f1c/light/011-longtext-bom.png)
- Census: `census/f1c-library-detail-longtext-light-1440.json`
- Code: `src/modules/library/frontend/ComponentDetailPage.tsx:339` — header <h1 className='text-base font-medium …'> with no truncate/min-w-0
- Code: `src/modules/library/frontend/components/LibraryPreviewPane.tsx:165` — component.name truncated without title
- Suggested fix: ComponentDetailPage header: wrap the h1 in min-w-0 flex-1 and add 'truncate' plus title={name}. LibraryPreviewPane/LibraryCard/ComponentCommandPalette: add title={name} and title={description}, or allow a two-line clamp for the name. Palette preview: make the metadata column scroll with the Place button in a separate footer that doesn't overlay content. PartInspectorPanel: add a 'Library part' row with the component name, linked to Library.
- Verification (vf1c): **confirmed** — Re-verified on the 200-char part 5cf27157 (vf1c-dark, 1440x900). The detail sticky header is 53 px tall (h1 36 px = 2 lines at 18 px) because the h1 has no truncate/min-w-0 (ComponentDetailPage.tsx:339). The preview pane header span is truncated (scrollWidth > clientWidth) with no title on it or any ancestor, and the Part > Name row has no title either (LibraryPreviewPane.tsx:164-166; only Description has one). The inspector header secondary text is inferComponentClass() ('Resistor') and the rows show only Symbol/Footprint names (SelectionInspector.tsx:173, PartInspectorPanel.tsx:498), so the library component name appears nowhere. The 1100x720 palette clipping was checked on f1c's 048 screenshot: the 'Place' button overlays the tag chip row. The base 39 px header height is already Q11-007; this finding adds the long-name wrap and the missing tooltips (Home equivalent: Q1-023). S3 kept. · evidence: [019-longname-preview-pane](../evidence/shots/vf1c/dark/019-longname-preview-pane.png), [020-longname-detail-header-1440](../evidence/shots/vf1c/dark/020-longname-detail-header-1440.png), [048-longtext-palette-1100](../evidence/shots/f1c/dark/048-longtext-palette-1100.png), detail header height 53px (h1 2 lines); preview header truncated, title=null

</details>


## T-275

**Fullscreen symbol/footprint preview modal doesn't take or trap focus**

- Severity **S3** · category a11y · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L1 · wave W2 · scope frontend · estimate S
- Findings: Q6-014
- Depends on: ['T-014']

**Summary.** Focus stays on the 'Open symbol full screen' button behind the overlay; Tab moves to 'Open footprint full screen' behind the aria-modal dialog. Esc and backdrop click do close it. The overlay is a hand-rolled div (rounded-float + shadow-lg) instead of the kit dialog; canvas has no zoom controls/fit button or hint in fullscreen. Light re-check (Resistor footprint fullscreen): dialog aria-modal=true labelled 'R_0603_1…

**Root cause.** `src/modules/library/frontend/components/PreviewModal.tsx:16` — only a window Esc listener; no initial focus / trap / restore

**Proposed fix.** PreviewModal -> kit Dialog (focus trap/restore, Esc). — Detail: Build PreviewModal on the kit/Radix Dialog (focus trap, initial focus on Close, restore focus) and add the CanvasZoomCluster (zoom in/out/fit) in the modal header.

**Evidence.** [035-fullscreen-symbol-74hc00](../evidence/shots/q6/dark/035-fullscreen-symbol-74hc00.png), [011-fullscreen-symbol-74hc00](../evidence/shots/vq6/dark/011-fullscreen-symbol-74hc00.png)

<details><summary>Q6-014 — Fullscreen symbol/footprint preview modal doesn't take or trap focus (S3, confirmed)</summary>

- Area library.detail · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, open core part detail (74HC00)
  2. Click 'Open symbol full screen'
  3. Check document.activeElement, then press Tab
- Expected: Focus moves into the dialog (close button), Tab cycles inside it, Esc closes and focus returns to the trigger.
- Actual: Focus stays on the 'Open symbol full screen' button behind the overlay; Tab moves to 'Open footprint full screen' behind the aria-modal dialog. Esc and backdrop click do close it. The overlay is a hand-rolled div (rounded-float + shadow-lg) instead of the kit dialog; canvas has no zoom controls/fit button or hint in fullscreen. Light re-check (Resistor footprint fullscreen): dialog aria-modal=true labelled 'R_0603_1608Metric — Footprint', but activeElement stays 'Open footprint full screen' behind it; Esc closes.
- Screenshots: [035-fullscreen-symbol-74hc00](../evidence/shots/q6/dark/035-fullscreen-symbol-74hc00.png), [009-fullscreen-footprint](../evidence/shots/q6/light/009-fullscreen-footprint.png)
- Console: `activeElement after open = BUTTON 'Open symbol full screen' (inDialog=false); after Tab = 'Open footprint full screen' (inDialog=false)`
- Code: `src/modules/library/frontend/components/PreviewModal.tsx:16` — only a window Esc listener; no initial focus / trap / restore
- Suggested fix: Build PreviewModal on the kit/Radix Dialog (focus trap, initial focus on Close, restore focus) and add the CanvasZoomCluster (zoom in/out/fit) in the modal header.
- Verification (vq6): **confirmed** — Reproduced: 'Open symbol full screen' on 74HC00 → dialog aria-modal=true labelled '74HC00 Quad NAND SOIC-14 — Symbol', but activeElement stays the trigger (inDialog=false); Tab moves to 'Open footprint full screen' behind the modal (inDialog=false). Esc closes. PreviewModal.tsx:16-24 has only a window Esc listener, no initial focus/trap/restore. S3 kept. · evidence: [011-fullscreen-symbol-74hc00](../evidence/shots/vq6/dark/011-fullscreen-symbol-74hc00.png), activeElement after open = 'Open symbol full screen' (inDialog=false); after Tab = 'Open footprint full screen' (inDialog=false)

</details>


## T-276

**After saving an edit on the detail page, Back returns to a stale list (old name, old facets)**

- Severity **S3** · category bug · status confirmed · themes dark
- Recommendation **fix-now** · owner L1 · wave W2 · scope frontend · estimate XS
- Findings: Q6-015

**Summary.** The table row still reads '74HC00 Quad NAND SOIC-14 (Copy)' (selected) while the preview pane next to it says 'QA-Q6-74HC00-edited'; facet counts still count the old tags (passive 41, logic unchanged). Only a reload or a search/filter change refetches. Search for the new name works server-side, so the user sees two names for one part.

**Root cause.** `src/modules/library/frontend/Space.tsx:570` — ComponentDetailPage rendered without onUpdated → refreshTick never bumped after save

**Proposed fix.** Refetch list/facets after detail save before Back. — Detail: Pass onUpdated={() => setRefreshTick(v => v + 1)} from LibrarySpace (and dispatch 'openpcb:library-updated' so designer palettes refresh too).

**Evidence.** [041-list-stale-after-edit](../evidence/shots/q6/dark/041-list-stale-after-edit.png), [012-stale-list-after-edit](../evidence/shots/vq6/dark/012-stale-list-after-edit.png)

<details><summary>Q6-015 — After saving an edit on the detail page, Back returns to a stale list (old name, old facets) (S3, confirmed)</summary>

- Area library.detail · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Stack B, Library → double-click custom part '74HC00 Quad NAND SOIC-14 (Copy)' → Edit
  2. Change name to 'QA-Q6-74HC00-edited', description, remove tag 'logic', add 'passive' → Save
  3. Click Back
- Expected: The list row, facets and counts reflect the saved name/tags.
- Actual: The table row still reads '74HC00 Quad NAND SOIC-14 (Copy)' (selected) while the preview pane next to it says 'QA-Q6-74HC00-edited'; facet counts still count the old tags (passive 41, logic unchanged). Only a reload or a search/filter change refetches. Search for the new name works server-side, so the user sees two names for one part.
- Screenshots: [041-list-stale-after-edit](../evidence/shots/q6/dark/041-list-stale-after-edit.png)
- Network: `PATCH /api/modules/library/components/8c098cbd… → 200 (no subsequent GET /components)`
- Code: `src/modules/library/frontend/Space.tsx:570` — ComponentDetailPage rendered without onUpdated → refreshTick never bumped after save
- Code: `src/modules/library/frontend/ComponentDetailPage.tsx:215` — onUpdated?.(updated) is optional and unused by LibrarySpace
- Suggested fix: Pass onUpdated={() => setRefreshTick(v => v + 1)} from LibrarySpace (and dispatch 'openpcb:library-updated' so designer palettes refresh too).
- Verification (vq6): **confirmed** — Reproduced on my own clone: Edit → rename to 'QA-vq6-LM358-edited' → Save → Back: the table row still reads 'QA-vq6-LM358-clone-check' while the preview pane shows 'QA-vq6-LM358-edited'. No save notice. Space.tsx:571-580 renders ComponentDetailPage without onUpdated, so refreshTick is never bumped. Severity S2 → S3: the save persisted correctly (API returns the new name), nothing is lost, and any search/filter change or reload refetches; it is a stale-cache inconsistency with a one-line fix. · evidence: [012-stale-list-after-edit](../evidence/shots/vq6/dark/012-stale-list-after-edit.png), rows=['QA-vq6-LM358-clone-check …'], preview names ['QA-vq6-LM358-edited']

</details>


## T-277

**Library 'Place in design' is a disabled stub and Library→design drag path is broken (MIME mismatch)**

- Severity **S3** · category stub · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L1+D2 · wave W2 · scope frontend · estimate M
- Findings: Q6-016, F1C-006 · known ref K43

**Summary.** Button is disabled (disabled=true) even with a design tab open; its tooltip says 'Open a design to place' — which the user already did — and the built-in banner says 'Duplicate to make an editable copy. Placing is allowed.' There is no place action anywhere in Library (preview pane menu has only Open/Delete). Drag-and-drop from the table is the only path and isn't hinted. | Also covers: F1C-006: No Library → design drag path exists: the MIME types don't match, Library and Designer ar…

**Root cause.** `src/modules/library/frontend/ComponentDetailPage.tsx:352` — <Button disabled title='Open a design to place'>

**Proposed fix.** Wire 'Place in design': open/choose design tab and arm placement ghost with the component; unify drag MIME so Library rows drop onto schematic. — Detail: Either wire it (navigate to Designer active tab + start schematic placement with this componentId via the navigation store) or remove the button and change the banner to 'Drag from the library table onto a schematic to place'.

**Note.** Binding: wire Library 'Place in design'.

**Evidence.** [042-place-in-design-disabled-with-open-design](../evidence/shots/q6/dark/042-place-in-design-disabled-with-open-design.png), [010-detail-74hc00](../evidence/shots/vq6/dark/010-detail-74hc00.png), [018-dnd-library-mime-mid](../evidence/shots/f1c/dark/018-dnd-library-mime-mid.png)

<details><summary>Q6-016 — 'Place in design' is a permanently disabled stub whose tooltip and banner copy contradict it (S3, confirmed)</summary>

- Area library.detail · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, open design 'Dual LED Blinker' in Designer (tab open)
  2. Go to Library → open core 'Capacitor'
  3. Look at header button + read-only banner
- Expected: With a design open the button places the part (or opens the schematic in place mode); without one the tooltip says why.
- Actual: Button is disabled (disabled=true) even with a design tab open; its tooltip says 'Open a design to place' — which the user already did — and the built-in banner says 'Duplicate to make an editable copy. Placing is allowed.' There is no place action anywhere in Library (preview pane menu has only Open/Delete). Drag-and-drop from the table is the only path and isn't hinted.
- Screenshots: [042-place-in-design-disabled-with-open-design](../evidence/shots/q6/dark/042-place-in-design-disabled-with-open-design.png), [010-detail-builtin](../evidence/shots/q6/dark/010-detail-builtin.png), [007-detail-builtin-resistor](../evidence/shots/q6/light/007-detail-builtin-resistor.png)
- Console: `button 'Place in design': disabled=true title='Open a design to place' (design tab 'Dual LED Blinker' open)`
- Code: `src/modules/library/frontend/ComponentDetailPage.tsx:352` — <Button disabled title='Open a design to place'>
- Code: `src/modules/library/frontend/ComponentDetailPage.tsx:431` — 'Placing is allowed.' copy
- Suggested fix: Either wire it (navigate to Designer active tab + start schematic placement with this componentId via the navigation store) or remove the button and change the banner to 'Drag from the library table onto a schematic to place'.
- Verification (vq6): **confirmed** — Confirmed: 'Place in design' is disabled with title 'Open a design to place' on every detail page; ComponentDetailPage.tsx:352-359 hard-codes `disabled` (no condition), so it stays disabled even with a design open, while the banner (:431) says 'Placing is allowed.' This is exactly the kind of disabled placeholder PLAN D6 says to omit (and K43). S3 kept. · evidence: [010-detail-74hc00](../evidence/shots/vq6/dark/010-detail-74hc00.png), button 'Place in design': disabled=true title='Open a design to place'

</details>

<details><summary>F1C-006 — No Library → design drag path exists: the MIME types don't match, Library and Designer are never on screen together, and real drags always end in 'Drop not ready' (S3, confirmed)</summary>

- Area designer.schematic · stack B · design 7c22a0f9-faf8-4d2d-9da7-95c117eac147 · themes dark · viewports 1440x900
- Repro:
  1. Code: Library rows and cards are draggable and write only 'application/x-openpcb-library-component' (LIB/lib/component-drag.ts:8,34). The schematic drop handler reads only 'application/x-openpcb-component-id' (DSG/components/DesignerSidebar.tsx:10; SchematicCanvas.tsx:2989-3012). grep finds no code that ever writes the designer MIME, and no spring-loaded rail or split view lets a drag start in Library and end on a canvas.
  2. Stack B, design QA-f1c-drop, Schem view. Dispatch synthetic dragenter → dragover (100 ms steps) → drop DragEvents on the EdaCanvas drop overlay parent, with a DataTransfer carrying the Library MIME and the Library JSON payload for the core Resistor
  3. Repeat with 'application/x-openpcb-component-id' = 'openpcb.core.passive.resistor' (then the capacitor), dropping after 2–6 s
  4. Repeat with dragenter+dragover+drop in the same tick
  5. Inject a temporary draggable <div> whose dragstart sets 'application/x-openpcb-component-id', then run a real playwright `drag` onto the canvas (native HTML5 DnD)
- Expected: A user can drag a part from the Library onto an open schematic, or the Library offers a working 'Place in design'. The drag shows a ghost and drops where released.
- Actual: (1) Library MIME: no ghost, no error, nothing placed. The drop is silently ignored (rev unchanged). (2) Designer MIME, synthetic, readable DataTransfer: a ghost appears after the placement fetch and the part is placed (R2, C1). (3) Immediate drop: red strip 'Drop not ready yet. Wait for ghost preview.' in developer wording. It pushes the whole toolbar and canvas down 24 px and stayed for more than 3 s with no dismiss. (4) Real native drag: in dragenter/dragover dataTransfer.types is ['application/x-openpcb-component-id'] but getData() returns '' (protected mode, per the HTML spec), so beginDragComponent never runs. Every drop then fails with 'Drop not ready yet…' and nothing is placed, even though the drop event carries the id. So even a correctly-typed drag source would never work. Combined with the permanently disabled 'Place in design' (Q6-016), the Library has no placement path at all. This corrects Q6-016's premise that 'drag-and-drop from the table is the only path'. The only working path is the schematic's Components (Cmd+K) palette.
- Screenshots: [018-dnd-library-mime-mid](../evidence/shots/f1c/dark/018-dnd-library-mime-mid.png), [022-dnd-designer-mime-ghost-visible](../evidence/shots/f1c/dark/022-dnd-designer-mime-ghost-visible.png), [023-dnd-drop-not-ready](../evidence/shots/f1c/dark/023-dnd-drop-not-ready.png), [024-real-html5-drag-designer-mime](../evidence/shots/f1c/dark/024-real-html5-drag-designer-mime.png)
- Console: `real drag capture: enter [["application/x-openpcb-component-id"],""], over [[…],""], drop [[…],"openpcb.core.passive.inductor"]`
- Network: `projection rev stays 4 after the real drag; synthetic designer-MIME drops → rev 3 (R2) and rev 4 (C1)`
- Code: `src/modules/library/frontend/lib/component-drag.ts:8` — DRAG_MIME_TYPE = application/x-openpcb-library-component; comment claims the schematic reads it
- Code: `src/modules/designer/frontend/components/DesignerSidebar.tsx:10` — COMPONENT_DND_MIME = application/x-openpcb-component-id, never written anywhere
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:2998` — onDragOver relies on getData(), which is empty during native dragover
- Code: `src/modules/designer/frontend/components/SchematicCanvas.tsx:3024` — 'Drop not ready yet. Wait for ghost preview.'
- Code: `src/modules/library/frontend/ComponentDetailPage.tsx:352` — 'Place in design' hard-disabled
- Suggested fix: Pick one contract. Export a single MIME constant plus payload type from src/sdks/library (e.g. 'application/x-openpcb-library-component' with the JSON payload from component-drag.ts) and import it in both LibraryTable/LibraryCard and SchematicCanvas (drop COMPONENT_DND_MIME in DesignerSidebar.tsx:10). In SchematicCanvas onDragEnter/onDragOver (:2988-3007), detect the drag with event.types.includes(MIME), because getData() is empty in protected mode, and parse the payload only in onDrop. In onDrop (:3011-3025), when the placement detail isn't loaded yet, await actions.beginDragComponent(id) and then place, instead of calling setError('Drop not ready yet…'). For a reachable user path, either make 'Place in design' (ComponentDetailPage.tsx:352) switch to the active design tab and arm the palette's placement ghost, or stop marking Library rows draggable until a drop target exists.
- Verification (vf1c): **confirmed** — Reproduced on stack B, QA-f1c-drop, Schem. (1) Library rows (LibraryTable, draggable) write only 'application/x-openpcb-library-component' + text/plain (captured via synthetic dragstart). The only reader is SchematicCanvas.tsx:2989/2999/3012 with COMPONENT_DND_MIME 'application/x-openpcb-component-id', which nothing writes (git: the last writer was removed from DesignerSidebar in 820feaa, 2026-05-07, so this predates the redesign). (2) A synthetic drop with the Library MIME was silently ignored (rev unchanged). (3) A same-tick designer-MIME drop showed the red strip 'Drop not ready yet. Wait for ghost preview.' (24 px, no role). (4) A real native drag from an injected draggable source (mouse down/move/up in Chromium): dataTransfer.types = ['application/x-openpcb-component-id'] but getData() = '' in dragenter/dragover, and the drop carried the id. The result was 'Drop not ready yet…' and nothing placed (rev unchanged). So even a correct source can never work. Recalibrated S2 -> S3. No user can currently start a Library->canvas drag (Library and Designer are never on screen together), so the only visible effect is that Library rows are draggable with nowhere to drop. The missing 'place from Library' path is already tracked as Q6-016 (S3, disabled 'Place in design'), and placement works through the schematic Components palette (Cmd+K). This finding correctly refutes Q6-016's premise that drag-and-drop is a working path. · evidence: [009-drop-not-ready-strip](../evidence/shots/vf1c/dark/009-drop-not-ready-strip.png), [010-real-native-drag-not-ready](../evidence/shots/vf1c/dark/010-real-native-drag-not-ready.png), [011-synthetic-designer-mime-ghost](../evidence/shots/vf1c/dark/011-synthetic-designer-mime-ghost.png), native drag capture: [['dragenter',['application/x-openpcb-component-id'],''],['dragover',[…],''],['dragover',[…],''],['drop',[…],'openpcb.core.passive.inductor']], library row dragstart types: ['application/x-openpcb-library-component','text/plain']

</details>


## T-278

**Detail page hides MPN/manufacturer, truncates Details labels and cannot edit part metadata**

- Severity **S3** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L1 · wave W2 · scope frontend · estimate M
- Findings: Q6-017

**Summary.** Details card shows only Component name / Default footprint / Footprint options / Source — no MPN or manufacturer (text 'LM358DR' absent on the page) — and its 96px label column truncates to 'Component n…', 'Default footpr…', 'Footprint opti…'. The card stretches to the Symbol card height leaving ~300px of empty panel. Edit mode only offers Name/Description/Tags, so MPN/manufacturer/datasheet can't be set on custom p…

**Root cause.** `src/modules/library/frontend/components/DetailsCard.tsx:25` — only 4 rows

**Proposed fix.** DetailsCard shows MPN/Manufacturer/LCSC/Datasheet; wider label column. — Detail: Add MPN, Manufacturer, LCSC, Supplier, Subcategory, Datasheet rows to DetailsCard (reuse the preview pane's Part/Specs rows), widen the label column (e.g. PropertyGrid labelWidth 140px here), drop the flex-1 filler, and extend the edit form + PATCH with those fields.

**Evidence.** [036-detail-lm358-top](../evidence/shots/q6/dark/036-detail-lm358-top.png), [010-detail-74hc00](../evidence/shots/vq6/dark/010-detail-74hc00.png)

<details><summary>Q6-017 — Detail page hides MPN/manufacturer, truncates Details labels and cannot edit part metadata (S3, confirmed)</summary>

- Area library.detail · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, Library → select 'LM358 Dual Op-Amp' (preview pane shows MPN LM358DR, Manufacturer Texas Instruments)
  2. Open it (detail page)
  3. Duplicate any part → Edit
- Expected: Detail page is the superset of the preview pane: MPN, manufacturer, LCSC, supplier, datasheet, keywords; labels readable; edit form covers those fields.
- Actual: Details card shows only Component name / Default footprint / Footprint options / Source — no MPN or manufacturer (text 'LM358DR' absent on the page) — and its 96px label column truncates to 'Component n…', 'Default footpr…', 'Footprint opti…'. The card stretches to the Symbol card height leaving ~300px of empty panel. Edit mode only offers Name/Description/Tags, so MPN/manufacturer/datasheet can't be set on custom parts (BOM sourcing relies on them).
- Screenshots: [036-detail-lm358-top](../evidence/shots/q6/dark/036-detail-lm358-top.png), [023-search-lm358](../evidence/shots/q6/dark/023-search-lm358.png), [038-edit-mode](../evidence/shots/q6/dark/038-edit-mode.png), [007-detail-builtin-resistor](../evidence/shots/q6/light/007-detail-builtin-resistor.png), [010-edit-mode](../evidence/shots/q6/light/010-edit-mode.png)
- Code: `src/modules/library/frontend/components/DetailsCard.tsx:25` — only 4 rows
- Code: `src/shared/frontend/ui/property-grid.tsx:11` — grid-cols-[96px_1fr] too narrow for these labels
- Code: `src/modules/library/frontend/ComponentDetailPage.tsx:436` — edit form: name/description/tags only
- Suggested fix: Add MPN, Manufacturer, LCSC, Supplier, Subcategory, Datasheet rows to DetailsCard (reuse the preview pane's Part/Specs rows), widen the label column (e.g. PropertyGrid labelWidth 140px here), drop the flex-1 filler, and extend the edit form + PATCH with those fields.
- Verification (vq6): **confirmed** — Reproduced: LM358 detail Details card lists only Component name / Default footprint / Footprint options / Source — 'LM358DR' and 'Texas Instruments' absent from the page although the API and preview pane carry them; labels truncate to 'Component n…', 'Default footpr…', 'Footprint opti…' (PropertyGrid grid-cols-[96px_1fr]); card stretches with ~300 px empty. Edit form (ComponentDetailPage.tsx:436-485) offers Name/Description/Tags only. S3 kept. · evidence: [010-detail-74hc00](../evidence/shots/vq6/dark/010-detail-74hc00.png), LM358 detail: hasMPN=false, hasTI=false

</details>


## T-279

**Tag editor exposes internal tags (kicad-derived, user, builtin, system) and its input/suggestions lack accessible semantics**

- Severity **S3** · category a11y · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L1 · wave W2 · scope frontend · estimate S
- Findings: Q6-018

**Summary.** Edit mode lists 'kicad-derived' and 'user' as removable chips (removing them silently changes the part's source badge/facet); view mode shows 'builtin' and 'system' as ordinary tag chips on Capacitor and 'user' on the duplicate. The tag textbox has no accessible name (the 'Tags' caption is a <span>); the suggestion list is role=listbox containing listitem>button (no role=option / aria-activedescendant), so arrow-key…

**Root cause.** `src/modules/library/frontend/ComponentDetailPage.tsx:170` — setDraftTags([...detail.component.tags]) — includes provenance/system tags

**Proposed fix.** Hide internal tags in tag editor; combobox/listbox semantics for suggestions. — Detail: Split tags with splitTags() before editing (edit only semantic tags, re-append provenance/system on save), add 'builtin','system','user' to SYSTEM_TAGS; give TagTokenInput an aria-label/id+label and combobox semantics (role=combobox, aria-expanded, options role=option, aria-activedescendant); render field-level errors with aria-invalid + focus the field; show a 'Saved' notice.

**Evidence.** [038-edit-mode](../evidence/shots/q6/dark/038-edit-mode.png), [009-tag-editor-internal-tags](../evidence/shots/vq6/light/009-tag-editor-internal-tags.png)

<details><summary>Q6-018 — Tag editor exposes internal tags (kicad-derived, user, builtin, system) and its input/suggestions lack accessible semantics (S3, confirmed)</summary>

- Area library.detail · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, open custom part 'QA-Q6-74HC00-edited' (a duplicate) → Edit
  2. Look at the Tags field; type 'pa' in it
  3. Open core 'Capacitor' in view mode and look at the tag chips
  4. Clear the Name field and click Save
- Expected: Only user-facing tags are editable; provenance/system tags are hidden or read-only; the input is labelled 'Tags' and suggestions are a combobox/listbox with options; validation errors sit under the offending field with aria-invalid.
- Actual: Edit mode lists 'kicad-derived' and 'user' as removable chips (removing them silently changes the part's source badge/facet); view mode shows 'builtin' and 'system' as ordinary tag chips on Capacitor and 'user' on the duplicate. The tag textbox has no accessible name (the 'Tags' caption is a <span>); the suggestion list is role=listbox containing listitem>button (no role=option / aria-activedescendant), so arrow-key highlighting isn't announced. Empty-name error 'Name must not be empty' appears below the Tags field, focus stays on Save, no aria-invalid on the Name input. Save succeeds with no confirmation notice. Light re-check: chips kicad-derived/user still removable; ArrowDown+Enter in the suggestion list adds the tag (works); Save again produced no notice (notice spy empty).
- Screenshots: [038-edit-mode](../evidence/shots/q6/dark/038-edit-mode.png), [039-tag-suggestions](../evidence/shots/q6/dark/039-tag-suggestions.png), [040-edit-empty-name](../evidence/shots/q6/dark/040-edit-empty-name.png), [042-place-in-design-disabled-with-open-design](../evidence/shots/q6/dark/042-place-in-design-disabled-with-open-design.png), [010-edit-mode](../evidence/shots/q6/light/010-edit-mode.png), [012-tag-suggestions](../evidence/shots/q6/light/012-tag-suggestions.png), [013-after-save](../evidence/shots/q6/light/013-after-save.png)
- Code: `src/modules/library/frontend/ComponentDetailPage.tsx:170` — setDraftTags([...detail.component.tags]) — includes provenance/system tags
- Code: `src/modules/library/frontend/ComponentDetailPage.tsx:474` — 'Tags' is a span, not a label
- Code: `src/modules/library/frontend/components/TagTokenInput.tsx:195` — listbox > li > button, no option role
- Code: `src/modules/library/frontend/ComponentDetailPage.tsx:485` — saveError rendered after the tags block
- Suggested fix: Split tags with splitTags() before editing (edit only semantic tags, re-append provenance/system on save), add 'builtin','system','user' to SYSTEM_TAGS; give TagTokenInput an aria-label/id+label and combobox semantics (role=combobox, aria-expanded, options role=option, aria-activedescendant); render field-level errors with aria-invalid + focus the field; show a 'Saved' notice.
- Verification (vq6): **confirmed** — Reproduced on my clone in Edit mode (light): tag chips include 'kicad-derived' and 'user' with 'Remove tag …' buttons; the tag textbox has aria-label=null and no id/label ('Tags' is a span, ComponentDetailPage.tsx:474); typing 'pa' opens role=listbox whose children are LI (no role) > BUTTON, 0 role=option. View mode: SYSTEM_TAGS in detail-helpers.ts:43 only contains 'placeholder-footprint', so Capacitor's 'builtin'/'system' tags render as semantic chips. beginEdit copies all tags (:170). saveError renders after the tags block (:485). S3 kept. · evidence: [009-tag-editor-internal-tags](../evidence/shots/vq6/light/009-tag-editor-internal-tags.png), listbox children ['LI/null>BUTTON',…], options=0; tag input aria-label=null

</details>


## T-280

**Library 3D card: off-token failure panel and upload errors that leak across parts**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L1 · wave W2 · scope frontend · estimate S
- Findings: Q6-026, Q6-027

**Summary.** The card becomes a dark-red block (#340809, bg-red-950/70) with a 36px rounded-lg saturated #e7000b 'Retry conversion' button — identical in both themes and far outside the flat neutral kit. While editing, the same text also appears in a bordered error line above ('OCCT could not read the STEP file' twice). 'OCCT' is an internal library name. Retry re-runs the same conversion on the same bytes and fails again (minim… | Also covers: Q6-027: 3D upload error/status is never reset: it survives Cancel, and leaks onto a different par…

**Root cause.** `src/modules/library/frontend/three-d/ThreeDComponentPreview.tsx:121` — bg-red-950/70 text-red-200 panel

**Proposed fix.** 3D card failure state on tokens, one message, Retry only when retryable; reset upload state on Cancel/part switch. — Detail: Restyle the failed state with tokens (text-status-danger on bg-surface-canvas-well or status-danger-soft, kit Button size sm), show the message once, map converter errors to user copy, and only show Retry when the stored source might succeed (e.g. network/upload failures); offer 'Upload a different STEP' instead.

**Evidence.** [021-3d-failed-panel](../evidence/shots/q6/light/021-3d-failed-panel.png), [014-3d-failed-panel](../evidence/shots/vq6/dark/014-3d-failed-panel.png), [017-error-after-cancel](../evidence/shots/q6/light/017-error-after-cancel.png)

<details><summary>Q6-026 — 3D conversion failure UI is off-token and unhelpful: saturated red panel + big red Retry, message shown twice, 'OCCT' jargon, Retry offered for files that can never parse (S3, confirmed)</summary>

- Area library.detail · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, Library → open part 'C' (imported from kicad-with-step.zip, model status failed) — or Edit a custom part → Upload STEP → fixtures/garbage.step / minimal.step
  2. Look at the 3D model card; click Retry conversion
  3. Upload a .txt via 'All files' (wrong extension)
- Expected: Token-based error state (status-danger text / soft bg, kit button), one message in user language ('This STEP file could not be read — it may be empty or corrupt'), Retry only when a retry can help, and 'Upload another STEP' as the recovery.
- Actual: The card becomes a dark-red block (#340809, bg-red-950/70) with a 36px rounded-lg saturated #e7000b 'Retry conversion' button — identical in both themes and far outside the flat neutral kit. While editing, the same text also appears in a bordered error line above ('OCCT could not read the STEP file' twice). 'OCCT' is an internal library name. Retry re-runs the same conversion on the same bytes and fails again (minimal.step has an empty MANIFOLD_SOLID_BREP; garbage.step is plain text). Uploading a wrong extension shows 'Select a STEP file (.step or .stp).' above the still-red 'OCCT could not read…' panel, so two different errors are on screen at once.
- Screenshots: [021-3d-failed-panel](../evidence/shots/q6/light/021-3d-failed-panel.png), [060-upload-garbage-step](../evidence/shots/q6/dark/060-upload-garbage-step.png), [061-upload-wrong-ext](../evidence/shots/q6/dark/061-upload-wrong-ext.png), [015-upload-minimal-step-card](../evidence/shots/q6/light/015-upload-minimal-step-card.png)
- Console: `notice spy (light): 'library-3d-upload-progress: Converting 3D model…' → 62 ms → 'library-3d-upload-error: OCCT could not read the STEP file' (garbage.step and minimal.step)`
- Pixel probes: {"file": "shots/q6/light/021-3d-failed-panel.png", "x": 900, "y": 450, "hex": "#340809", "nearestToken": "--primary", "deltaE": 24.1}; {"file": "shots/q6/light/021-3d-failed-panel.png", "x": 1092, "y": 560, "hex": "#e7000b", "nearestToken": "--net-power", "deltaE": 30.7}
- Code: `src/modules/library/frontend/three-d/ThreeDComponentPreview.tsx:121` — bg-red-950/70 text-red-200 panel
- Code: `src/modules/library/frontend/three-d/ThreeDComponentPreview.tsx:130` — h-9 rounded-lg bg-red-600 border-red-400 Retry button
- Code: `src/modules/library/frontend/ComponentDetailPage.tsx:716` — second copy of the error in the card header area
- Suggested fix: Restyle the failed state with tokens (text-status-danger on bg-surface-canvas-well or status-danger-soft, kit Button size sm), show the message once, map converter errors to user copy, and only show Retry when the stored source might succeed (e.g. network/upload failures); offer 'Upload a different STEP' instead.
- Verification (vq6): **confirmed** — Reproduced on part 'C' (failed model): panel bg #340809 (bg-red-950/70), Retry button #e7000b (bg-red-600) 36 px tall; message 'OCCT could not read the STEP file'. Correction: the button radius computes to 2px (rounded-lg is flattened by the D1 radius remap), not a rounded pill. Red palette is not part of the D1 slate/violet remap, so this is off-token on a redesigned target screen (Library detail). Retry re-runs the same bytes (minimal.step can never parse). S3 kept. · evidence: [014-3d-failed-panel](../evidence/shots/vq6/dark/014-3d-failed-panel.png), probe 780,391 #340809; 1040,570 #e7000b; button h=36 radius=2px

</details>

<details><summary>Q6-027 — 3D upload error/status is never reset: it survives Cancel, and leaks onto a different part when the detail page switches component (S3, confirmed)</summary>

- Area library.detail · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, open custom part LM324N → Edit → 3D card 'Upload STEP' → choose a non-STEP file (or garbage.step)
  2. Error line appears; click Cancel (leave edit mode)
  3. While the detail page is open, navigate to another part via a component link (e.g. Assistant @component mention / ComponentResultCard, which calls navigateToModule('library', undefined, {componentId}))
- Expected: Leaving edit mode clears upload status/errors; opening another component shows that component's own state.
- Actual: After Cancel the red 'Select a STEP file (.step or .stp).' line stays in view mode (no Upload control to act on it). Navigating to OP07CD and then to QA-q7-light-QFN16-preset keeps showing the same LM324N error; earlier the 74HC00 copy's error 'Cannot update built-in components (74HC00…)' appeared on the QFN16 part. After a successful upload a stale 'Ready' label also stays under the header until the page unmounts.
- Screenshots: [017-error-after-cancel](../evidence/shots/q6/light/017-error-after-cancel.png), [018-stale-upload-error-other-part](../evidence/shots/q6/light/018-stale-upload-error-other-part.png), [020-dead-upload-step-view](../evidence/shots/q6/light/020-dead-upload-step-view.png), [064-upload-error-persists-after-cancel](../evidence/shots/q6/dark/064-upload-error-persists-after-cancel.png), [063-missing-model-dead-upload](../evidence/shots/q6/dark/063-missing-model-dead-upload.png)
- Code: `src/modules/library/frontend/ComponentDetailPage.tsx:84` — uploadStatus/uploadError state not reset on componentId change
- Code: `src/modules/library/frontend/ComponentDetailPage.tsx:175` — cancelEdit clears saveError only
- Code: `src/modules/library/frontend/Space.tsx:570` — <ComponentDetailPage> not keyed by componentId; navRoute effect (line 194) swaps the id in place
- Suggested fix: Key ComponentDetailPage by componentId in Space.tsx (key={detailComponentId}) and clear uploadError/uploadStatus in cancelEdit and after success (fade 'Ready' → idle).
- Verification (vq6): **confirmed** — Reproduced (light, my clone): Edit → Upload STEP → sample.txt → 'Select a STEP file (.step or .stp).'; Cancel → edit mode off but the error stays; navigateToModule('library', …, {componentId: OP07CD}) → OP07CD page still shows the same error. uploadStatus/uploadError (ComponentDetailPage.tsx:84-85) are never reset on componentId change or in cancelEdit (:175-178); Space.tsx:571 does not key the page by componentId. S3 kept. · evidence: [004-upload-error-after-cancel](../evidence/shots/vq6/light/004-upload-error-after-cancel.png), [005-stale-upload-error-other-part](../evidence/shots/vq6/light/005-stale-upload-error-other-part.png)

</details>


## T-281

**Library 3D preview shows most models lying on their side (Z-up models in a Y-up viewer)**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L1 · wave W2 · scope frontend · estimate S
- Findings: Q6-028

**Summary.** The 0603/2512 chip resistors stand on their long edge with the dark resistive top facing sideways; SOIC-8/14 bodies stand upright with the leads sticking out horizontally. GLB bbox check: core SOIC-14 GLB has its 1.75 mm height on Z, OP07CD's root node maps height to Z — the library canvas uses a Y-up camera with no Z-up→Y-up group rotation (the designer's Board3DCanvas wraps models in rotation [-π/2,0,0]). The impo…

**Root cause.** `src/modules/library/frontend/three-d/ThreeDComponentPreview.tsx:174` — camera position [3,3,3], default Y-up, no Z-up→Y-up group

**Proposed fix.** Library 3D preview applies the same Z-up→Y-up convention as Board3D. — Detail: Wrap <ComponentGLB> in the same Z-up→Y-up group as Board3DCanvas (or set camera.up=[0,0,1] and position the orbit target accordingly); normalise imported GLBs to the same convention at conversion time; add a 'Reset view' button.

**Evidence.** [033-option-2512](../evidence/shots/q6/light/033-option-2512.png), [010-detail-74hc00](../evidence/shots/vq6/dark/010-detail-74hc00.png)

<details><summary>Q6-028 — Library 3D preview shows most models lying on their side (Z-up models in a Y-up viewer) (S3, confirmed)</summary>

- Area library.detail · stack B · design None · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. Stack B, Library → core 'Resistor' → detail 3D model card (default Iso camera)
  2. Pick footprint option 2512 (6332 metric)
  3. Open OP07CD or the 74HC00 copy (SOIC)
- Expected: Parts shown resting on the board plane (top face up), as in the designer 3D view.
- Actual: The 0603/2512 chip resistors stand on their long edge with the dark resistive top facing sideways; SOIC-8/14 bodies stand upright with the leads sticking out horizontally. GLB bbox check: core SOIC-14 GLB has its 1.75 mm height on Z, OP07CD's root node maps height to Z — the library canvas uses a Y-up camera with no Z-up→Y-up group rotation (the designer's Board3DCanvas wraps models in rotation [-π/2,0,0]). The imported LM324N GLB happens to be Y-up and looks upright here, so parts disagree with each other too. There is also no reset-view/fit control.
- Screenshots: [033-option-2512](../evidence/shots/q6/light/033-option-2512.png), [008-detail-resistor-scrolled](../evidence/shots/q6/light/008-detail-resistor-scrolled.png), [067-op07cd-footprint-framing](../evidence/shots/q6/dark/067-op07cd-footprint-framing.png), [010-edit-mode](../evidence/shots/q6/light/010-edit-mode.png)
- Network: `GET /footprints/openpcb.core.footprint.package.soic-14-3-9x8-7mm-p1-27mm/model → mesh extents 6 × 8.7 × 1.75 (Z = height)`; `GET /footprints/9d1e3971…(OP07CD)/model → root matrix maps height to Z`; `GET /footprints/c8cdca5a…(LM324N)/model → height on Y (8.26)`
- Code: `src/modules/library/frontend/three-d/ThreeDComponentPreview.tsx:174` — camera position [3,3,3], default Y-up, no Z-up→Y-up group
- Code: `src/modules/designer/frontend/three-d/Board3DCanvas.tsx:568` — designer wraps Z-up content in rotation [-Math.PI/2,0,0]
- Suggested fix: Wrap <ComponentGLB> in the same Z-up→Y-up group as Board3DCanvas (or set camera.up=[0,0,1] and position the orbit target accordingly); normalise imported GLBs to the same convention at conversion time; add a 'Reset view' button.
- Verification (vq6): **confirmed** — Reproduced: 74HC00 and OP07CD 3D cards show the SOIC body standing on its edge with the leads sticking out sideways. ThreeDComponentPreview.tsx:174 uses a default Y-up camera [3,3,3] with no Z-up→Y-up group, while Board3DCanvas.tsx:568 wraps content in rotation [-π/2,0,0]. Not the designer orientation rule from memory (models must not be re-rotated per part) — this is the missing world-axis conversion in the library viewer only. S3 kept; codeRef line corrected 162→174. · evidence: [010-detail-74hc00](../evidence/shots/vq6/dark/010-detail-74hc00.png), [015-op07cd-detail](../evidence/shots/vq6/dark/015-op07cd-detail.png)

</details>


## T-282

**Footprint previews are framed around invisible F.Fab text, so imported footprints sit off-centre and small**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L1 · wave W2 · scope frontend · estimate S
- Findings: Q6-029

**Summary.** OP07CD's pads sit ~150 px left of centre with large empty space on the right; LM324N's DIP-14 is ~80 px left of centre (pads x 296–397 in a 105–750 canvas). The .kicad_mod places the value text at (7.87, 3.537) on F.Fab — the preview hides F.Fab but still includes its labels in the fit bounds. Same in the preview pane thumbnail.

**Root cause.** `node_modules/@openpcb/r3f-eda-canvas/dist/preview/FootprintPreviewCanvas.js:22` — fitToGeometryOnly → footprintGeometryBounds; default footprintVisualBounds includes labels

**Proposed fix.** Pass fitToGeometryOnly to every library FootprintPreviewCanvas. — Detail: Pass fitToGeometryOnly to every library FootprintPreviewCanvas (LibraryPreviewPane.tsx:144, ComponentDetailPage.tsx:623/636/772, LibraryCard if applicable); optionally make the package exclude labels on PREVIEW_HIDDEN_LAYERS from visual bounds.

**Evidence.** [067-op07cd-footprint-framing](../evidence/shots/q6/dark/067-op07cd-footprint-framing.png), [015-op07cd-detail](../evidence/shots/vq6/dark/015-op07cd-detail.png)

<details><summary>Q6-029 — Footprint previews are framed around invisible F.Fab text, so imported footprints sit off-centre and small (S3, confirmed)</summary>

- Area library.detail · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, Library → open OP07CD (imported from fixtures/OP07CD.zip) → Footprint card; also LM324N
  2. Compare footprint centre with canvas centre
- Expected: The visible geometry (pads + visible graphics) is centred and fills the canvas like core parts.
- Actual: OP07CD's pads sit ~150 px left of centre with large empty space on the right; LM324N's DIP-14 is ~80 px left of centre (pads x 296–397 in a 105–750 canvas). The .kicad_mod places the value text at (7.87, 3.537) on F.Fab — the preview hides F.Fab but still includes its labels in the fit bounds. Same in the preview pane thumbnail.
- Screenshots: [067-op07cd-footprint-framing](../evidence/shots/q6/dark/067-op07cd-footprint-framing.png), [023-stuck-converting-after-reload](../evidence/shots/q6/light/023-stuck-converting-after-reload.png), [015-upload-minimal-step-card](../evidence/shots/q6/light/015-upload-minimal-step-card.png)
- Code: `node_modules/@openpcb/r3f-eda-canvas/dist/preview/FootprintPreviewCanvas.js:22` — fitToGeometryOnly → footprintGeometryBounds; default footprintVisualBounds includes labels
- Code: `src/modules/library/frontend/components/LibraryPreviewPane.tsx:144` — FootprintPreviewCanvas without fitToGeometryOnly
- Code: `src/modules/library/frontend/ComponentDetailPage.tsx:623` — same (also :636, :772)
- Suggested fix: Pass fitToGeometryOnly to every library FootprintPreviewCanvas (LibraryPreviewPane.tsx:144, ComponentDetailPage.tsx:623/636/772, LibraryCard if applicable); optionally make the package exclude labels on PREVIEW_HIDDEN_LAYERS from visual bounds.
- Verification (vq6): **confirmed** — Reproduced: OP07CD footprint card (canvas x 105–750) draws pads at x≈158–390, i.e. ~150 px left of centre. FootprintPreviewCanvas fits to footprintVisualBounds (labels incl. hidden F.Fab text) unless fitToGeometryOnly is passed (dist/preview/FootprintPreviewCanvas.js:22-25); no library caller passes it. Fix is in-repo: pass fitToGeometryOnly at LibraryPreviewPane.tsx:144 and ComponentDetailPage.tsx:623/636/772 (the package already supports it). fixScope changed shared-package → frontend. S3 kept. · evidence: [015-op07cd-detail](../evidence/shots/vq6/dark/015-op07cd-detail.png)

</details>


## T-283

**Unsaved part edits are discarded silently on Back or rail navigation (no dirty guard)**

- Severity **S3** · category bug · status confirmed · themes light
- Recommendation **fix-now** · owner L1 · wave W2 · scope frontend · estimate S
- Findings: Q6-031
- Depends on: ['T-014']

**Summary.** The page closes immediately, no prompt (dialog spy: 0 confirm calls, no [role=dialog]); the edits are lost — the part reopens with the old name, not in edit mode. Esc does nothing in edit mode.

**Root cause.** `src/modules/library/frontend/Space.tsx:576` — onBack={() => setDetailComponentId(null)} with no dirty check

**Proposed fix.** Dirty guard (confirmDialog) on Back/rail navigation from detail edit. — Detail: Track dirty = draft ≠ saved; intercept Back/rail navigation with the kit ConfirmDialog; bind Esc to Cancel and Cmd/Ctrl+Enter to Save while editing.

**Evidence.** [011-tag-typing](../evidence/shots/q6/light/011-tag-typing.png)

<details><summary>Q6-031 — Unsaved part edits are discarded silently on Back or rail navigation (no dirty guard) (S3, confirmed)</summary>

- Area library.detail · stack B · design None · themes light · viewports 1440x900
- Repro:
  1. Stack B, open custom part QA-Q6-74HC00-edited → Edit
  2. Change Name to 'QA-Q6-74HC00-unsaved-change' and type a tag
  3. Click Back (or a rail item)
  4. Reopen the part
- Expected: A 'Discard changes?' confirmation (kit dialog) as the part wizard already does on Esc when dirty; Esc cancels edit mode explicitly.
- Actual: The page closes immediately, no prompt (dialog spy: 0 confirm calls, no [role=dialog]); the edits are lost — the part reopens with the old name, not in edit mode. Esc does nothing in edit mode.
- Screenshots: [011-tag-typing](../evidence/shots/q6/light/011-tag-typing.png)
- Console: `dialog spy: {prompt:0, confirm:0, alert:0} after Back with dirty form`
- Code: `src/modules/library/frontend/Space.tsx:576` — onBack={() => setDetailComponentId(null)} with no dirty check
- Code: `src/modules/library/frontend/ComponentDetailPage.tsx:175` — edit drafts live only in component state
- Suggested fix: Track dirty = draft ≠ saved; intercept Back/rail navigation with the kit ConfirmDialog; bind Esc to Cancel and Cmd/Ctrl+Enter to Save while editing.
- Verification (vq6): **confirmed** — Reproduced: my clone → Edit → Name 'QA-vq6-unsaved-change'; Esc does nothing (still editing); Back → list immediately, no dialog (no [role=dialog], spy confirm=0), the part keeps its saved name. Space.tsx:576 onBack has no dirty check. S3 kept. · evidence: Esc: editing=true; after Back: dlg=false, spy={confirm:0}, API name unchanged 'QA-vq6-LM358-edited'

</details>


## T-284

**Light theme: messages inside the always-dark canvas wells use light-theme tokens (dark text, light borders) — low contrast, glaring boxes**

- Severity **S3** · category visual · status confirmed · themes light
- Recommendation **fix-now** · owner L1+F0a · wave W2 · scope frontend · estimate S
- Findings: Q6-034

**Summary.** 'Converting 3D model…' / 'Loading 3D model metadata…' render text #55555c (light --text-secondary) on #08090a = 2.7:1 inside a bright #cfcfd4 (light --border-control) outline box; the empty-state 'Upload STEP' uses light --primary #1a1a1d on #08090a (invisible edge). The preview-pane canvases are a third black (#131313, hardcoded in the package) next to grid thumbnails on #08090a.

**Root cause.** `src/modules/library/frontend/three-d/ThreeDComponentPreview.tsx:86` — LoadingMessage: border-border-control text-text-secondary on bg-surface-canvas-well

**Proposed fix.** Messages inside dark wells use well tokens (F0a adds --text-on-well/--border-on-well). — Detail: Add canvas-overlay tokens (e.g. --canvas-overlay-text/-border) that stay dark-palette in both themes and use them for every message inside wells; pass backgroundColor=var(--surface-canvas-well) to the preview canvases.

**Evidence.** [023-stuck-converting-after-reload](../evidence/shots/q6/light/023-stuck-converting-after-reload.png), [002-dead-upload-step-in-well](../evidence/shots/vq6/light/002-dead-upload-step-in-well.png)

<details><summary>Q6-034 — Light theme: messages inside the always-dark canvas wells use light-theme tokens (dark text, light borders) — low contrast, glaring boxes (S3, confirmed)</summary>

- Area library.detail · stack B · design None · themes light · viewports 1440x900
- Repro:
  1. Stack B, light theme, open a part whose 3D model is pending ('Converting 3D model…') or missing, or a preview whose detail fails
  2. Pixel-probe the message box inside the canvas well
- Expected: Well overlays use the dark palette (the well is #08090a in both themes) — e.g. a canvas-overlay token set.
- Actual: 'Converting 3D model…' / 'Loading 3D model metadata…' render text #55555c (light --text-secondary) on #08090a = 2.7:1 inside a bright #cfcfd4 (light --border-control) outline box; the empty-state 'Upload STEP' uses light --primary #1a1a1d on #08090a (invisible edge). The preview-pane canvases are a third black (#131313, hardcoded in the package) next to grid thumbnails on #08090a.
- Screenshots: [023-stuck-converting-after-reload](../evidence/shots/q6/light/023-stuck-converting-after-reload.png), [020-dead-upload-step-view](../evidence/shots/q6/light/020-dead-upload-step-view.png), [002-library-table-start](../evidence/shots/q6/light/002-library-table-start.png), [003-grid](../evidence/shots/q6/light/003-grid.png)
- Pixel probes: {"file": "shots/q6/light/023-stuck-converting-after-reload.png", "x": 1023, "y": 406, "hex": "#cfcfd4", "nearestToken": "--border-control", "deltaE": 0.0}; {"file": "shots/q6/light/002-library-table-start.png", "x": 1100, "y": 200, "hex": "#131313", "nearestToken": "--text-strong", "deltaE": 2.0}; {"file": "shots/q6/light/003-grid.png", "x": 350, "y": 150, "hex": "#08090a", "nearestToken": "--surface-canvas-well", "deltaE": 0.0}
- Code: `src/modules/library/frontend/three-d/ThreeDComponentPreview.tsx:86` — LoadingMessage: border-border-control text-text-secondary on bg-surface-canvas-well
- Code: `src/modules/library/frontend/three-d/ThreeDComponentPreview.tsx:142` — empty state text-text-secondary + bg-primary button in the well
- Code: `node_modules/@openpcb/r3f-eda-canvas/dist/preview/FootprintPreviewCanvas.js:17` — backgroundColor = '#131313' default
- Suggested fix: Add canvas-overlay tokens (e.g. --canvas-overlay-text/-border) that stay dark-palette in both themes and use them for every message inside wells; pass backgroundColor=var(--surface-canvas-well) to the preview canvases.
- Verification (vq6): **confirmed** — Reproduced (light): the 3D well is #08090a (intended — wells are theme-invariant dark per D1, cf. rejected Q1-017/Q3-031) but its content uses light tokens: 'Upload STEP' is --primary #1c1c1f on #08090a (probe ΔE 0 for both), and LoadingMessage ('Converting 3D model…'/'Loading 3D model metadata…') uses text-text-secondary + border-border-control (ThreeDComponentPreview.tsx:85-92). The defect is the overlay tokens, not the dark well. S3 kept. · evidence: [002-dead-upload-step-in-well](../evidence/shots/vq6/light/002-dead-upload-step-in-well.png), probe 1060,558 #1c1c1f --primary; 1040,558 #08090a --surface-canvas-well

</details>


## T-285

**Imported part gets wrong auto tags / package from the footprint (R symbol tagged 'capacitor', package '1608' vs '0603')**

- Severity **S3** · category data · status confirmed · themes dark
- Recommendation **decide** · decision DEC-L · owner L1 · wave W2 · scope backend · estimate S
- Findings: Q7-020

**Summary.** Detail tags: qa-q7, capacitor, smd, 0603, 1608 — a resistor labelled 'capacitor' because the footprint name starts with C_. Wizard said Package code 0603; detail says Package 1608 and '1608 pin map'. Library table 'PINS' column shows padCount (drawn part: 4 'pins' for a 3-pin symbol).

**Root cause.** `src/modules/library/backend/import/commit-kicad.ts:220` — tags = dedupe([...userTags, ...footprintTags, …]) - heuristic footprint tags are always merged even when the user edited tags

**Proposed fix.** Backend: derive tags/package from symbol+footprint correctly. — Detail: Don't merge footprint-heuristic tags when the user edited tags (or show them as removable suggestions in Metadata); use one package label (imperial with metric in parentheses) across wizard/detail; rename the table column to 'Pads' or show symbol pin count.

**Evidence.** [095-detail-R0603](../evidence/shots/q7/dark/095-detail-R0603.png)

<details><summary>Q7-020 — Imported part gets wrong auto tags / package from the footprint (R symbol tagged 'capacitor', package '1608' vs '0603') (S3, confirmed)</summary>

- Area library.detail · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. New part → Import file simple_resistor.kicad_sym (R) → Footprints Import C_0603_1608Metric.kicad_mod
  2. Metadata: type your own tag 'qa-q7' → Import
  3. Open the part detail
- Expected: Only the user's tags when they edited Tags (tagsDirty), or clearly marked suggested tags; package shown consistently (0603 / 1608Metric).
- Actual: Detail tags: qa-q7, capacitor, smd, 0603, 1608 — a resistor labelled 'capacitor' because the footprint name starts with C_. Wizard said Package code 0603; detail says Package 1608 and '1608 pin map'. Library table 'PINS' column shows padCount (drawn part: 4 'pins' for a 3-pin symbol).
- Screenshots: [095-detail-R0603](../evidence/shots/q7/dark/095-detail-R0603.png), [086-detail-new-part](../evidence/shots/q7/dark/086-detail-new-part.png)
- Network: `GET /components?limit=100 → QA-q7-drawn-garbage3d padCount=4`
- Code: `src/modules/library/backend/import/commit-kicad.ts:220` — tags = dedupe([...userTags, ...footprintTags, …]) - heuristic footprint tags are always merged even when the user edited tags
- Code: `src/modules/library/frontend/components/LibraryTable.tsx:225` — PINS column renders component.padCount
- Suggested fix: Don't merge footprint-heuristic tags when the user edited tags (or show them as removable suggestions in Metadata); use one package label (imperial with metric in parentheses) across wizard/detail; rename the table column to 'Pads' or show symbol pin count.
- Verification (vq7): **confirmed** — Verified via API on q7's part QA-q7-R0603-import (R symbol + C_0603 footprint): tags ['qa-q7','capacitor','smd','0603','1608'] - user tag plus footprint heuristics ('capacitor' from the C_ prefix). Code confirms unconditional merge. The 'Pins column shows padCount' sub-point is a Run-2 design decision (PLAN Run 2: 'mountType/padCount on the list DTO … Mount/Pins columns'), so only the tag/package parts are defects; S3 kept. · evidence: GET /components/ab68b38d…/detail -> tags ['qa-q7','capacitor','smd','0603','1608'], footprint.packageCode {imperial:'0603', metric:'1608'}, [095-detail-R0603](../evidence/shots/q7/dark/095-detail-R0603.png)

</details>


## T-286

**Every STEP conversion floods the console with ~200 'GLTFExporter: Use MeshStandardMaterial…' warnings**

- Severity **S4** · category console · status confirmed · themes light
- Recommendation **defer** · owner followup · wave followup · scope shared-package · estimate XS
- Findings: Q6-036

**Summary.** 198 identical warnings 'GLTFExporter: Use MeshStandardMaterial or MeshBasicMaterial for best results.' for one conversion (one per mesh), burying real warnings.

**Root cause.** `node_modules/@openpcb/step-to-glb/dist/category-materials.js:52` — new MeshLambertMaterial(...) — GLTFExporter warns once per mesh

**Proposed fix.** @openpcb/step-to-glb: MeshStandardMaterial to silence GLTFExporter warnings. — Detail: In @openpcb/step-to-glb category-materials.js use MeshStandardMaterial (roughness/metalness equivalents) instead of MeshLambertMaterial, then re-pin the package.

**Evidence.** `console: 198 × [WARNING] GLTFExporter: Use MeshStandardMaterial or MeshBasicMaterial for best results.`

<details><summary>Q6-036 — Every STEP conversion floods the console with ~200 'GLTFExporter: Use MeshStandardMaterial…' warnings (S4, confirmed)</summary>

- Area library.detail · stack B · design None · themes light · viewports 1440x900
- Repro:
  1. Stack B, custom part LM324N → Edit → Upload STEP → extracted LM324N.step
  2. console warning
- Expected: No warnings for a successful conversion.
- Actual: 198 identical warnings 'GLTFExporter: Use MeshStandardMaterial or MeshBasicMaterial for best results.' for one conversion (one per mesh), burying real warnings.
- Console: `198 × [WARNING] GLTFExporter: Use MeshStandardMaterial or MeshBasicMaterial for best results.`
- Code: `node_modules/@openpcb/step-to-glb/dist/category-materials.js:52` — new MeshLambertMaterial(...) — GLTFExporter warns once per mesh
- Code: `src/modules/library/frontend/three-d/step-to-glb.ts:1` — shim over @openpcb/step-to-glb
- Suggested fix: In @openpcb/step-to-glb category-materials.js use MeshStandardMaterial (roughness/metalness equivalents) instead of MeshLambertMaterial, then re-pin the package.
- Verification (vq6): **confirmed** — Reproduced: one LM324N.step conversion (restore upload) logged 192× 'GLTFExporter: Use MeshStandardMaterial or MeshBasicMaterial for best results.' Cause located: @openpcb/step-to-glb builds MeshLambertMaterial (dist/category-materials.js:52). S4 kept. · evidence: console warning: 192 × GLTFExporter: Use MeshStandardMaterial …

</details>


## T-287

**Detail page copy nits: fullscreen title upper-cases identifiers; missing part shows a bare 'Component detail not found' box**

- Severity **S4** · category copy · status confirmed · themes light
- Recommendation **fix-now** · owner L1 · wave W2 · scope frontend · estimate XS
- Findings: Q6-037

**Summary.** Fullscreen header reads 'R_0603_1608METRIC — FOOTPRINT' (uppercase transform changes the real footprint name). Missing part: header 'Component', red bordered box 'Component detail not found' and nothing else.

**Root cause.** `src/modules/library/frontend/components/PreviewModal.tsx:39` — title rendered with uppercase caps style

**Proposed fix.** Fullscreen title keeps identifier case; 'Component not found' EmptyState with Back. — Detail: Render the name part of the title without text-transform (caps only for the '— Footprint' suffix); give the not-found state an empty-state layout with copy + 'Back to Library'.

**Evidence.** [009-fullscreen-footprint](../evidence/shots/q6/light/009-fullscreen-footprint.png), [011-fullscreen-symbol-74hc00](../evidence/shots/vq6/dark/011-fullscreen-symbol-74hc00.png)

<details><summary>Q6-037 — Detail page copy nits: fullscreen title upper-cases identifiers; missing part shows a bare 'Component detail not found' box (S4, confirmed)</summary>

- Area library.detail · stack B · design None · themes light · viewports 1440x900
- Repro:
  1. Stack B, core Resistor → Footprint card → 'Open footprint full screen'
  2. Open a component id that no longer exists (e.g. a chat link to a deleted part: navigateToModule('library', undefined, {componentId:'<deleted>'}))
- Expected: Identifiers keep their case ('R_0603_1608Metric — Footprint'); a missing part says it was deleted/not found with a Back to Library action.
- Actual: Fullscreen header reads 'R_0603_1608METRIC — FOOTPRINT' (uppercase transform changes the real footprint name). Missing part: header 'Component', red bordered box 'Component detail not found' and nothing else.
- Screenshots: [009-fullscreen-footprint](../evidence/shots/q6/light/009-fullscreen-footprint.png), [019-detail-unknown-id](../evidence/shots/q6/light/019-detail-unknown-id.png)
- Code: `src/modules/library/frontend/components/PreviewModal.tsx:39` — title rendered with uppercase caps style
- Code: `src/modules/library/frontend/ComponentDetailPage.tsx:417` — error box for load errors
- Suggested fix: Render the name part of the title without text-transform (caps only for the '— Footprint' suffix); give the not-found state an empty-state layout with copy + 'Back to Library'.
- Verification (vq6): **confirmed** — Reproduced: fullscreen header renders '74HC00 QUAD NAND SOIC-14 — SYMBOL' (PreviewModal.tsx:39 'uppercase' on the whole title, so footprint names like R_0603_1608Metric are altered); navigating to a non-existent componentId shows only 'Back / Component / Component detail not found' in a red bordered box (ComponentDetailPage.tsx:416-419). S4 kept. · evidence: [011-fullscreen-symbol-74hc00](../evidence/shots/vq6/dark/011-fullscreen-symbol-74hc00.png), [003-detail-unknown-id](../evidence/shots/vq6/light/003-detail-unknown-id.png)

</details>

