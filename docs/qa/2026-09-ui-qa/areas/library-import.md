# library.import — QA findings

[← index](../README.md) · 4 triage entries · S1 0 · S2 3 · S3 1 · S4 0

| TID | Sev | Title | Findings | Rec | Owner / wave | Scope | Est |
|---|---|---|---|---|---|---|---|
| [T-288](#t-288) | S2 | A third-party .opclib silently takes over core parts that share its IDs; removing that pack then deletes the core parts | F1C-001 | decide (DEC-L) | L1 / W2 | backend | S |
| [T-289](#t-289) | S2 | ZIP import reuses another part's footprint by content hash and overwrites that part's 3D model state | Q6-020 | decide (DEC-L) | L1 / W2 | backend | M |
| [T-290](#t-290) | S2 | Import warnings are never visible: the 'Imported with warnings' notice is replaced by 3D-conversion notices within milliseconds and '+N more' can't be opened | Q6-021 | fix-now | L1 / W2 | frontend | S |
| [T-291](#t-291) | S3 | Re-importing an archive silently creates a duplicate part with the same name, or re-converts the 3D model without saying the part already existed | Q6-022 | decide (DEC-L) | L1 / W2 | backend | S |

## T-288

**A third-party .opclib silently takes over core parts that share its IDs; removing that pack then deletes the core parts**

- Severity **S2** · category data · status confirmed · themes dark
- Recommendation **decide** · decision DEC-L · owner L1 · wave W2 · scope backend · estimate S
- Findings: F1C-001

**Summary.** The install succeeds with no warning (201, result updated: 1 component, 1 symbol, 3 footprints). The core card drops to 'Components 16' but still says 'Up to date'. The sources table shows 'QA-f1c Hijack Pack · team · 1'. The core LED is now isBuiltin=false, which makes it editable and deletable as a user part. deleteSource removes every component, symbol and footprint whose sourceId is the pack, so 'Remove' on the…

**Root cause.** `src/modules/library/backend/sync/opclib-importer.ts:691` — upsertComponent overwrites sourceId/isBuiltin of any existing id without an ownership check

**Proposed fix.** Backend: refuse/namespace third-party .opclib ids that collide with core. — Detail: In importOpclib (src/modules/library/backend/sync/opclib-importer.ts:250), before the transaction, look up every manifest symbol, footprint and component id. If a row already exists with a different sourceId, throw a ValidationError that names the conflicting ids (at minimum for rows owned by openpcb.core). Also reject non-core packs whose ids start with the reserved 'openpcb.core.' prefix. As a second guard, have deleteSource (queries.ts:2021) delete only rows whose sourceId matches and which no other source's co…

**Evidence.** [017-settings-hijack-pack-core-16](../evidence/shots/f1c/dark/017-settings-hijack-pack-core-16.png), [001-settings-libraries-baseline](../evidence/shots/vf1c/dark/001-settings-libraries-baseline.png)

<details><summary>F1C-001 — A third-party .opclib silently takes over core parts that share its IDs; removing that pack then deletes the core parts (S2, confirmed)</summary>

- Area library.import · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Stack B. Build a valid team pack 'qa.f1c.hijack' (kind 'team', correct digest) that contains one component with the core id 'openpcb.core.opto.led' plus the core LED symbol and 3 footprint ids (scratchpad f1c/mkpack.mjs, output f1c/qa-f1c-hijack.opclib)
  2. Settings → Libraries → Install from file… → pick it
  3. Look at the core card and sources table; GET /components/openpcb.core.opto.led
  4. (Not executed, by code:) click Remove on 'QA-f1c Hijack Pack' → confirm
- Expected: Install is refused, or at least warns, when a package declares ids owned by another source, especially openpcb.core. A pack can never change which source owns an existing part.
- Actual: The install succeeds with no warning (201, result updated: 1 component, 1 symbol, 3 footprints). The core card drops to 'Components 16' but still says 'Up to date'. The sources table shows 'QA-f1c Hijack Pack · team · 1'. The core LED is now isBuiltin=false, which makes it editable and deletable as a user part. deleteSource removes every component, symbol and footprint whose sourceId is the pack, so 'Remove' on the pack would delete the core LED along with its symbol and footprints. I restored the core LED by reinstalling core beta.2 and then removed the empty pack. Verified afterwards: core 17, LED isBuiltin=true, 3 variants. Verifier also ran the Remove step: after Remove on the hijack pack, GET /components/openpcb.core.opto.led, /symbols/openpcb.core.symbol.opto.led and /footprints/openpcb.core.footprint.opto.led-0603-1608metric all return 404, the core card stays at 16, and /designer/library/components/openpcb.core.opto.led/placement returns 404. Boot does not repair this: bootstrap.ts skips the bundled import when the same core version is already installed (shouldImportBundledRelease), so the parts stay gone until the core is reinstalled or updated.
- Screenshots: [017-settings-hijack-pack-core-16](../evidence/shots/f1c/dark/017-settings-hijack-pack-core-16.png)
- Network: `POST /api/modules/library/sources/install → 201 {sourceId:'qa.f1c.hijack', updated:{symbols:1,footprints:3,components:1,variants:3}}`; `GET /components/openpcb.core.opto.led → isBuiltin:false after hijack`
- Code: `src/modules/library/backend/sync/opclib-importer.ts:691` — upsertComponent overwrites sourceId/isBuiltin of any existing id without an ownership check
- Code: `src/modules/library/backend/sync/opclib-importer.ts:457` — symbols update sets sourceId: lib.id for existing ids (same for footprints at :499)
- Code: `src/modules/library/backend/queries.ts:2045` — deleteSource deletes components/symbols/footprints by sourceId
- Suggested fix: In importOpclib (src/modules/library/backend/sync/opclib-importer.ts:250), before the transaction, look up every manifest symbol, footprint and component id. If a row already exists with a different sourceId, throw a ValidationError that names the conflicting ids (at minimum for rows owned by openpcb.core). Also reject non-core packs whose ids start with the reserved 'openpcb.core.' prefix. As a second guard, have deleteSource (queries.ts:2021) delete only rows whose sourceId matches and which no other source's components reference (the footprint join table cascades on footprint delete).
- Verification (vf1c): **confirmed** — Reproduced on stack B (vf1c-dark). Installing f1c/qa-f1c-hijack.opclib through Settings > Libraries > Install from file gave no UI feedback. The core card dropped to 'Components 16', the sources table gained 'QA-f1c Hijack Pack · team · 1', and GET /components/openpcb.core.opto.led returned isBuiltin:false. I then executed the Remove step that f1c only inferred from code. The native confirm named 'qa.f1c.hijack'; after accepting, the core LED component, its symbol and all 3 LED footprints returned 404, and designer placement of the core LED returned 404. Code: symbols/footprints update branches set sourceId: lib.id with no ownership check (opclib-importer.ts:452-462, 494-504); upsertComponent overwrites sourceId/isBuiltin (:691-760); deleteSource deletes by sourceId (queries.ts:2041-2064). Restored by reinstalling core beta.2: core 17, LED isBuiltin=true, 3 variants, placement 200. Not intentional, and it is plausible in practice: a team pack that forks a core part under the same id triggers it. S2 kept rather than S1 because it needs a pack that reuses core ids, and placed designs keep their snapshots. · evidence: [001-settings-libraries-baseline](../evidence/shots/vf1c/dark/001-settings-libraries-baseline.png), [002-settings-hijack-installed-core-16](../evidence/shots/vf1c/dark/002-settings-hijack-installed-core-16.png), [003-settings-after-hijack-remove-core-16](../evidence/shots/vf1c/dark/003-settings-after-hijack-remove-core-16.png), GET /components/openpcb.core.opto.led after install -> isBuiltin:false; after Remove -> 404 (symbol 404, footprint 404, designer placement 404), restore: POST /sources/install core beta.2 -> core 17, LED isBuiltin:true, footprintVariants 3

</details>


## T-289

**ZIP import reuses another part's footprint by content hash and overwrites that part's 3D model state**

- Severity **S2** · category data · status confirmed · themes dark
- Recommendation **decide** · decision DEC-L · owner L1 · wave W2 · scope backend · estimate M
- Findings: Q6-020

**Summary.** A new component 'C' (2f8b35b3…) is created that points at the SAME footprint row as QA-q7-R0603-import. The import then stores minimal.step as the pending source of that shared footprint, the client conversion fails and PATCHes it to status 'failed' — so the other part's 3D card now shows the red 'OCCT could not read the STEP file / Retry conversion' state (it was 'missing' before). Nothing in the UI says a footprin…

**Root cause.** `src/modules/library/backend/import/commit-kicad.ts:197` — findExistingFootprintId reuses any footprint with same name+sourceHash, even if owned by another component

**Proposed fix.** Backend: don't reuse another part's footprint row by content hash (or copy-on-write 3D state). — Detail: Only attach/replace a 3D model on a footprint that the new component exclusively owns (or that has no model yet); when reusing a footprint that already has a model, skip persistPendingSourceStep and surface 'footprint reused from <part>' in the import result.

**Evidence.** [056-import-kicad-with-step](../evidence/shots/q6/dark/056-import-kicad-with-step.png)

<details><summary>Q6-020 — ZIP import reuses another part's footprint by content hash and overwrites that part's 3D model state (S2, confirmed)</summary>

- Area library.import · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Stack B: part 'QA-q7-R0603-import' exists (footprint 3c416239…, model/meta status 'missing')
  2. Library → Import library… → fixtures/kicad-with-step.zip (C_0603_1608Metric + simple_capacitor + minimal.step)
  3. GET /api/modules/library/footprints/3c416239-8f14-45c3-98d0-c2033c168cf9/model/meta
- Expected: A new import either gets its own footprint row, or, if it deliberately reuses an identical footprint, never replaces/marks another part's existing 3D model without asking.
- Actual: A new component 'C' (2f8b35b3…) is created that points at the SAME footprint row as QA-q7-R0603-import. The import then stores minimal.step as the pending source of that shared footprint, the client conversion fails and PATCHes it to status 'failed' — so the other part's 3D card now shows the red 'OCCT could not read the STEP file / Retry conversion' state (it was 'missing' before). Nothing in the UI says a footprint was reused. The same path means a re-imported archive with a different/broken STEP silently replaces the 3D model of every part sharing that footprint; when the import resolves to an existing part (reused:true) the STEP is re-converted and re-uploaded anyway (POST …/model 201 on the 3rd LM324N import).
- Screenshots: [056-import-kicad-with-step](../evidence/shots/q6/dark/056-import-kicad-with-step.png), [059-c-3d-failed-after-retry](../evidence/shots/q6/dark/059-c-3d-failed-after-retry.png)
- Network: `POST /api/modules/library/imports/kicad/zip → 201 (component C, footprintId 3c416239…)`; `GET …/footprints/3c416239…/model/source → 200`; `PATCH …/footprints/3c416239…/model → 200 (status failed)`; `GET …/footprints/3c416239…/model/meta → {status:'failed', sourceFilename:'minimal.step', errorMessage:'OCCT could not read the STEP file'}`; `components?q=… → C and QA-q7-R0603-import both footprintId 3c416239-8f14-45c3-98d0-c2033c168cf9`
- Code: `src/modules/library/backend/import/commit-kicad.ts:197` — findExistingFootprintId reuses any footprint with same name+sourceHash, even if owned by another component
- Code: `src/modules/library/backend/import/commit-kicad-zip.ts:627` — persistPendingSourceStep runs on the (possibly shared / reused) footprint regardless of result.reused
- Code: `src/modules/library/frontend/three-d/model-conversion.ts:86` — markPendingModelConversionFailed PATCHes the shared footprint to failed
- Suggested fix: Only attach/replace a 3D model on a footprint that the new component exclusively owns (or that has no model yet); when reusing a footprint that already has a model, skip persistPendingSourceStep and surface 'footprint reused from <part>' in the import result.
- Verification (vq6): **confirmed** — Confirmed from live state + code: component 'C' (from kicad-with-step.zip) and QA-q7-R0603-import both point at footprint 3c416239-8f14-45c3-98d0-c2033c168cf9; its model meta is {status:'failed', sourceFilename:'minimal.step', errorMessage:'OCCT could not read the STEP file'}, so q7's part now shows the failed 3D state from q6's import. commit-kicad.ts:197 findExistingFootprintId reuses any footprint with the same hash/name regardless of owner, and commit-kicad-zip.ts:627 persistPendingSourceStep deletes/replaces that footprint's model row unconditionally (also when result.reused). Nothing in the UI mentions reuse. Related to Q6-024 (same persistPendingSourceStep replace-before-success). S2 kept. · evidence: GET /components/2f8b35b3… and /ab68b38d… → footprintId 3c416239… for both, GET /footprints/3c416239…/model/meta → status failed, minimal.step

</details>


## T-290

**Import warnings are never visible: the 'Imported with warnings' notice is replaced by 3D-conversion notices within milliseconds and '+N more' can't be opened**

- Severity **S2** · category error-handling · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L1 · wave W2 · scope frontend · estimate S
- Findings: Q6-021

**Summary.** Recorded sequence for OP07CD.zip: t=89254ms 'Imported with warnings — 3D model was associated by symbol/archive filename…' → t=89257 (3 ms later) 'Converting 3D model' → 'Uploading GLB…' → '3D model ready / Ready'. For kicad-with-step.zip: 'Imported with warnings — 3D model reference C_0603_1608Metric.step was not found in the import payload +3 more' → 90 ms later '3D model conversion failed'. There is a single noti…

**Root cause.** `src/modules/library/frontend/Space.tsx:347` — conversion onProgress calls setNotice and clobbers the warnings notice set at :378

**Proposed fix.** Import warnings persist (not replaced by 3D notices); '+N more' expands. — Detail: Keep import warnings in a persistent place (e.g. a dismissible 'Imported with N warnings' banner on the new part's detail page listing all warnings, reuse WarningsPanel from the wizard); use a separate progress indicator for 3D conversion (the 3D card already has one) instead of the shared notice slot.

**Evidence.** [053-import-op07cd](../evidence/shots/q6/dark/053-import-op07cd.png), [017-import-op07cd-notice](../evidence/shots/vq6/dark/017-import-op07cd-notice.png)

<details><summary>Q6-021 — Import warnings are never visible: the 'Imported with warnings' notice is replaced by 3D-conversion notices within milliseconds and '+N more' can't be opened (S2, confirmed)</summary>

- Area library.import · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, Library → Import library… → fixtures/OP07CD.zip (or kicad-with-step.zip)
  2. Watch the top-right notice (a MutationObserver on [role=status] records every text)
- Expected: Import warnings (e.g. '3D model reference … was not found', 'model associated by filename') stay visible until dismissed and the full list can be reviewed; progress/success notices don't overwrite them.
- Actual: Recorded sequence for OP07CD.zip: t=89254ms 'Imported with warnings — 3D model was associated by symbol/archive filename…' → t=89257 (3 ms later) 'Converting 3D model' → 'Uploading GLB…' → '3D model ready / Ready'. For kicad-with-step.zip: 'Imported with warnings — 3D model reference C_0603_1608Metric.step was not found in the import payload +3 more' → 90 ms later '3D model conversion failed'. There is a single notice slot, so the warnings are overwritten before a human can read them; the other 3 warnings are only a '+3 more' count with no way to view them, and the part's detail page shows nothing about warnings. Progress ('Converting 3D model') uses the success (green) variant; everything auto-dismisses after 5 s. The import also jumps straight to the detail page, so the list context is lost.
- Screenshots: [053-import-op07cd](../evidence/shots/q6/dark/053-import-op07cd.png), [056-import-kicad-with-step](../evidence/shots/q6/dark/056-import-kicad-with-step.png)
- Console: `window.__notices = [{t:'status: Imported with warnings3D model was associated by symbol/archive filename…', at:89254},{t:'status: Converting 3D modelConverting 3D model...', at:89257},{t:'status: Conv`; `kicad-with-step: [{'Imported with warnings3D model reference C_0603_1608Metric.step was not found in the import payload +3 more', at:308976},{'3D model conversion failedOCCT could not read the STEP fi`; `light (LM324N.zip import): 'Imported with warnings — 3D model was associated by symbol/archive filename…' t=648383 → 'Converting 3D model' t=648387 (4 ms later)`
- Code: `src/modules/library/frontend/Space.tsx:347` — conversion onProgress calls setNotice and clobbers the warnings notice set at :378
- Code: `src/modules/library/frontend/Space.tsx:378` — only warnings[0] + '+N more' shown
- Code: `src/modules/library/frontend/Space.tsx:553` — notice auto-dismiss 5000 ms
- Suggested fix: Keep import warnings in a persistent place (e.g. a dismissible 'Imported with N warnings' banner on the new part's detail page listing all warnings, reuse WarningsPanel from the wizard); use a separate progress indicator for 3D conversion (the 3D card already has one) instead of the shared notice slot.
- Verification (vq6): **confirmed** — Reproduced by re-importing fixtures/OP07CD.zip with the notice spy: 'Imported with warnings — 3D model was associated by symbol/archive filename…' at t=698850 → 'Converting 3D model' at t=698852 (2 ms later) → 'Uploading GLB…' → '3D model ready'. Same with LM324N.zip (4 ms). Code Space.tsx:336-380: one notice slot; onProgress setNotice clobbers the warning; only warnings[0] + '+N more' is ever shown; 5 s auto-dismiss (:553); progress uses variant 'success'. No other surface lists import warnings. S2 kept (warnings are effectively never shown). · evidence: [017-import-op07cd-notice](../evidence/shots/vq6/dark/017-import-op07cd-notice.png), __notices=[{Imported with warnings…,698850},{Converting 3D model,698852},{Uploading GLB…,699027},{3D model ready,699034}]

</details>


## T-291

**Re-importing an archive silently creates a duplicate part with the same name, or re-converts the 3D model without saying the part already existed**

- Severity **S3** · category bug · status confirmed · themes dark
- Recommendation **decide** · decision DEC-L · owner L1 · wave W2 · scope backend · estimate S
- Findings: Q6-022

**Summary.** First re-import → 201 Created, a second 'LM324N' (f0ab345c…) with its own footprint but the SAME symbol row; the list now has two identical 'LM324N' rows (only distinguishable by footprint id). The notice shown is just '3D model ready'. Second re-import → 200 reused, yet the user again only sees '3D model ready' (the 'Existing component opened' notice is suppressed whenever a STEP conversion runs) and the model is r…

**Root cause.** `src/modules/library/backend/import/commit-kicad.ts:262` — reuse only when BOTH symbol and footprint hashes match; otherwise a new same-named component is created

**Proposed fix.** Backend: detect re-import of same archive; prompt update vs duplicate. — Detail: On import, detect an existing component with the same name/MPN and ask (open existing / import as copy / replace); when result.reused, show 'Existing component opened' and skip the model conversion.

**Evidence.** [058-import-lm324n-reimport](../evidence/shots/q6/dark/058-import-lm324n-reimport.png)

<details><summary>Q6-022 — Re-importing an archive silently creates a duplicate part with the same name, or re-converts the 3D model without saying the part already existed (S3, confirmed)</summary>

- Area library.import · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Stack B: 'LM324N' already exists (imported earlier from LM324N.zip)
  2. Library → Import library… → fixtures/LM324N.zip
  3. Search 'LM324'
  4. Import LM324N.zip once more
- Expected: The user is told the part already exists ('Existing component opened' / 'Import as a copy?') and no duplicate row with an identical name appears.
- Actual: First re-import → 201 Created, a second 'LM324N' (f0ab345c…) with its own footprint but the SAME symbol row; the list now has two identical 'LM324N' rows (only distinguishable by footprint id). The notice shown is just '3D model ready'. Second re-import → 200 reused, yet the user again only sees '3D model ready' (the 'Existing component opened' notice is suppressed whenever a STEP conversion runs) and the model is re-converted and re-uploaded.
- Screenshots: [058-import-lm324n-reimport](../evidence/shots/q6/dark/058-import-lm324n-reimport.png)
- Network: `POST /imports/kicad/zip → 201 (new LM324N f0ab345c…, footprint c8cdca5a…, symbolId f231856c… shared with existing LM324N 35721acb…)`; `POST /imports/kicad/zip → 200 (reused) then POST /footprints/c8cdca5a…/model → 201`
- Code: `src/modules/library/backend/import/commit-kicad.ts:262` — reuse only when BOTH symbol and footprint hashes match; otherwise a new same-named component is created
- Code: `src/modules/library/frontend/Space.tsx:394` — 'Existing component opened' only when !hasPendingModelConversion
- Suggested fix: On import, detect an existing component with the same name/MPN and ask (open existing / import as copy / replace); when result.reused, show 'Existing component opened' and skip the model conversion.
- Verification (vq6): **confirmed** — Reproduced the reused path: re-importing OP07CD.zip → POST /imports/kicad/zip 200 (reused, still one OP07CD row), then model/source GET and POST …/footprints/9d1e3971…/model 201 — the model is re-converted and re-uploaded; the user only sees warnings → '3D model ready', never 'Existing component opened' (Space.tsx:390 requires !hasPendingModelConversion and no warnings). Duplicate path confirmed from state: two 'LM324N' rows (35721acb…, f0ab345c…) share symbol f231856c… with different footprints; commit-kicad.ts:262 reuses only when BOTH hashes match. S3 kept. · evidence: POST /imports/kicad/zip → 200; POST /footprints/9d1e3971…/model → 201, GET /components/35721acb… and f0ab345c… → same symbolId f231856c…, footprints ff4ccf37… vs c8cdca5a…

</details>

