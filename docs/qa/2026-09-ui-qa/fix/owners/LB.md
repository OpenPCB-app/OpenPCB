# Fix brief — owner LB

6 approved triage entries. Entries marked **shared** are co-owned: implement ONLY the part that lives in your owned files; the lead owner is listed. Screenshot paths are absolute (open with the Read tool for layout only).

## T-049 [S2] A .opclib that omits library.kind installs as an undeletable read-only 'core' source

- Area settings · category bug · estimate S · findings F1C-002
- **Approved scope:** Approved (DEC-L): an .opclib without library.kind must not install as read-only core.
- Summary: The row shows 'core' plus an amber 'read-only' chip and has no Remove button. The backend refuses deletion with 400 'cannot delete core source qa.f1c.nokind; ship a new bundled package to replace it'. At the same time its part is isBuiltin=false and shows an Edit button on the detail page, so a 'read-only' source contains editable parts. The only way out is to craft another pack with the same id and kind 'team', ins…
- Root cause: `src/modules/library/backend/sync/opclib-importer.ts:372` — kind: lib.kind ?? "core" is taken from the untrusted manifest
- Proposed fix: Backend: default missing library.kind to 'third-party' (never core) on .opclib import. — Detail: In importOpclib (opclib-importer.ts:258, :372/:382), do not take kind from the manifest for user installs. installOpclibFromBytes (install-source.ts:40) should pass a trusted kind: 'core' only when lib.id === 'openpcb.core' (and, once the core is signed, only when the signature verifies); otherwise use manifest kind 'team'/'user', and treat a missing or 'core' kind as 'team'. Base isReadOnly and the deleteSource guard (queries.ts:2034) on sourceId === 'openpcb.core', not on kind. LibrariesPanel.tsx:421 then shows…
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f1c/dark/015-settings-nokind-pack-core-readonly.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf1c/dark/004-settings-nokind-pack-core-readonly.png
- F1C-002 repro: Stack B. Build a valid pack 'qa.f1c.nokind' with no 'kind' in library.json. The schema marks it optional with default 'core' (f1c/qa-f1c-nokind.opclib) → Settings → Libraries → Install from file… → pick it → Look at its row in the sources table → curl -X DELETE /api/modules/library/sources/qa.f1c.nokind → Library → open 'QA-f1c pack LED'
  - expected: Only the bundled OpenPCB core, verified by id and signature, can be kind 'core'. A user-installed pack is always removable.
  - actual: The row shows 'core' plus an amber 'read-only' chip and has no Remove button. The backend refuses deletion with 400 'cannot delete core source qa.f1c.nokind; ship a new bundled package to replace it'. At the same time its part is isBuiltin=false and shows an Edit button on the detail page, so a 'read-only' source contains editable parts. The only way out is to craft another pack with the same id and kind 'team', install that, then Remove (which I did to clean up).
  - code: `src/modules/library/backend/sync/opclib-importer.ts:372` kind: lib.kind ?? "core" is taken from the untrusted manifest
  - code: `src/modules/library/backend/sync/opclib-importer.ts:258` isReadOnly derived from the same default
  - code: `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:421` Remove hidden for kind==='core'
  - code: `src/modules/library/backend/queries.ts:2034` deleteSource refuses any kind==='core'

## T-055 [S2] Settings lets the user remove 'Local Library' (user.local), wiping every custom/imported part

- Area settings · category data · estimate S · findings Q2-005
- **shared** with C2; lead: C2
- Summary: Same 'Remove' affordance as a third-party pack; backend deleteSource only protects kind==='core' and deletes all components/symbols/footprints with sourceId user.local without checking design references. Confirm text uses the raw id 'user.local', not 'your 4 custom parts'.
- Root cause: `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:421` — only kind==='core' hides Remove
- Proposed fix: Hide Remove for user.local (kind user) source; backend guard is a decision item. — Detail: LibrariesPanel.tsx:421 render Remove only when kind is not 'core' and not 'user' (or id !== 'user.local'); queries.ts:2034 deleteSource throw ValidationError for kind==='user'. If clearing custom parts is wanted, add a separate guarded 'Delete all custom parts' flow that lists count and designs referencing them.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q2/dark/010-libraries.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq2/dark/010-libraries.png
- Q2-005 repro: Settings > Libraries → Sources table shows 'Local Library / user.local / user' with 4 components and a red 'Remove' button → Click Remove (confirm dialog shown; NOT accepted in this test)
  - expected: The built-in user library (destination of every KiCad import, drawn part and duplicate) is not removable, or removal is strongly guarded (name the parts, warn about designs that reference them, offer export first).
  - actual: Same 'Remove' affordance as a third-party pack; backend deleteSource only protects kind==='core' and deletes all components/symbols/footprints with sourceId user.local without checking design references. Confirm text uses the raw id 'user.local', not 'your 4 custom parts'.
  - code: `src/core/frontend/src/settings/panels/LibrariesPanel.tsx:421` only kind==='core' hides Remove
  - code: `src/modules/library/backend/queries.ts:2034` deleteSource guards only core
  - code: `src/modules/library/backend/sync/bootstrap.ts:236` user.local seeded as the default user source
  - code: `src/modules/library/backend/import/commit-kicad.ts:292` imports land in user.local

## T-253 [S2] Library list and facets disagree (search 'passive' 43 vs 0 sources; SMD 3 of 17; THT 0)

- Area library.browse · category bug · estimate S · findings F1C-013, Q6-001
- **shared** with L1; lead: LB
- **Approved scope:** Approved (DEC-L): one shared predicate for library list and facets.
- Summary: 'passive': 43 rows, header '43 parts · 0 sources', strip '43 of 43', and a completely blank facet rail. 'R': strip '60 of 30' (more rows than the total), header '30 parts · 3 sources', and the part literally named 'R' is not among the 60 rows because every part matches. Via the API: /components?q=R → 69 (all), /facets?q=R → total 30. q=passive → 43 vs 0, q=core → 17 vs 0, q=local → 49 vs 0, q=qa-f1c-tag05 → 1 vs 0.… | Also covers: Q6-001: Mount facet filters don't match the list: SMD shows 3 of 17, THT shows 0 parts, Family+Mo…
- Root cause: `src/modules/library/backend/queries.ts:851` — searchableText includes tagsJson and sourceId
- Proposed fix: Backend: one predicate for list + facets (search and mount/family filters). — Detail: Use one predicate for both endpoints: extract a matchesQuery(component, query) helper, or run facets over the same SQL WHERE. Drop sourceId from the free-text haystack (source already has a facet). Keep tags matching in both. Rank exact and prefix name matches first, so 'R' finds 'R'.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/f1c/dark/050-search-passive-count-mismatch.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vf1c/dark/015-search-passive-count-mismatch.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q6/dark/003-facets-ic-smd.png
- F1C-013 repro: Stack B, Library (69 parts), Table view → Type 'passive' in the search box → Type 'R' → Type 'core', 'local' or a tag such as 'qa-f1c-tag05'
  - expected: The list, the header count, the '<n> of <total>' strip and the facet rail all describe the same result set. Searching 'R' finds the part named 'R'.
  - actual: 'passive': 43 rows, header '43 parts · 0 sources', strip '43 of 43', and a completely blank facet rail. 'R': strip '60 of 30' (more rows than the total), header '30 parts · 3 sources', and the part literally named 'R' is not among the 60 rows because every part matches. Via the API: /components?q=R → 69 (all), /facets?q=R → total 30. q=passive → 43 vs 0, q=core → 17 vs 0, q=local → 49 vs 0, q=qa-f1c-tag05 → 1 vs 0. The list query matches name + description + tagsJson + sourceId. Because every sourceId ('openpcb.core', 'user.local') contains 'r', 'o', 'c' and so on, short queries return the whole library, while computeFacets matches name + description only.
  - code: `src/modules/library/backend/queries.ts:851` searchableText includes tagsJson and sourceId
  - code: `src/modules/library/backend/queries.ts:1792` facets matchesQuery = name/description only
- Q6-001 repro: Stack B, Library (Table view), no search → Facet sidebar: tick Mount › SMD (facet count 16) → Observe list shows '3 of 17' — only 3 user parts (those that literally carry an 'smd' tag); the 13 SMD core parts are missing → Clear all, tick Mount › THT (count 4) → Observe '0 of 0', header '0 parts · 0 sources', every facet section except 'Other' disappears, chip reads 'Tag: through_hole' → Clear all, tick Family › ic (4) then Mount › SMD (4): header says '4 parts', list '0 of 4' + 'No components match the current filters'
  - expected: Ticking a Mount option shows exactly the parts counted next to it (SMD → 16 parts, THT → 4 pin headers/sockets), combinable with other facets.
  - actual: List filter matches mount tokens against the freeform component tags only, while the facet counts come from the default footprint's mountType; THT's raw key 'through_hole' isn't even recognised as a mount tag, so the facets endpoint itself returns total 0. API: GET /components?tags=smd → 3 rows vs /facets?tags=smd total 17; /components?tags=through_hole → 0 and /facets?tags=through_hole → total 0; /components?tags=ic,smd → 0 vs facets total 4. Re-confirmed later: Source Core + Mount SMD + Package sot-23 + Family transistor → every facet count says 3 and header "3 parts", list "0 of 3" with "No components match".
  - code: `src/modules/library/backend/queries.ts:880` searchComponents: non-source filters matched only against row.tagsJson; footprint mountType never consulted
  - code: `src/modules/library/backend/queries.ts:1712` computeFacets adds default-footprint mountType to the mount set — list and facets disagree
  - code: `src/modules/library/backend/tag-bucketing.ts:13` MOUNT_TAGS has 'through-hole'/'tht' but not 'through_hole' (the footprint mountType key emitted by the facet), so the THT token is bucketed as 'other'

## T-256 [S2] Library list silently truncates at 60 parts — later parts (incl. core Resistor/Zener) unreachable without searching

- Area library.browse · category bug · estimate M · findings Q6-002 · known K07
- **shared** with L1; lead: LB
- Summary: Header says '69 parts', result strip says '60 of 69'; table ends at 'QA-Q6-bulk-40' with no load-more, no message. Alphabetically-later parts (QA-q7-*, core 'Resistor', 'Zener Diode') are not in the list at all; Select All only selects the 60 loaded rows. Backend clamps limit to [1,100] with no offset/total, so even raising the frontend limit fails at 101 parts. Light re-check: header '67 parts', strip '60 of 67' (l…
- Root cause: `src/modules/library/frontend/Space.tsx:111` — url.searchParams.set('limit','60')
- Proposed fix: Backend offset+total paging (approved) + infinite scroll/paging in table; header shows true total. — Detail: Add offset/cursor + total to GET /components (queries.ts searchComponents) and load pages on scroll in LibraryTable/grid (or virtualise and fetch all ids). Until then, render a footer row 'Showing 60 of 69 — refine the search to see more' and make Select All say it selects only loaded rows.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q6/dark/020-library-69parts.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/vq6/dark/004-list-end-60cap.png
- Q6-002 repro: Stack B: library with 69 components (45 QA-Q6-bulk-* clones created via POST /components/{id}/clone) → Open Library (Table view), no filters → Read counters and scroll table to the end
  - expected: All 69 parts are browsable (paging / infinite scroll / virtualised list), or a clear 'Showing 60 of 69 — refine search / Load more' affordance.
  - actual: Header says '69 parts', result strip says '60 of 69'; table ends at 'QA-Q6-bulk-40' with no load-more, no message. Alphabetically-later parts (QA-q7-*, core 'Resistor', 'Zener Diode') are not in the list at all; Select All only selects the 60 loaded rows. Backend clamps limit to [1,100] with no offset/total, so even raising the frontend limit fails at 101 parts. Light re-check: header '67 parts', strip '60 of 67' (library grew as other agents added parts).
  - code: `src/modules/library/frontend/Space.tsx:111` url.searchParams.set('limit','60')
  - code: `src/modules/library/frontend/Space.tsx:683` '{components.length} of {totalCount}' is the only hint
  - code: `src/modules/library/backend/queries.ts:819` limit clamped to 100, no offset/cursor, no total in response

## T-270 [S2] 'Duplicate to edit' drops footprint options/pin map/metadata and copy stays locked (STEP upload fails)

- Area library.detail · category data · estimate M · findings Q6-005, Q6-019
- **shared** with L1; lead: LB
- **Approved scope:** Approved (DEC-L): Duplicate to edit copies footprint options, pin map, metadata; copy is editable (STEP upload works).
- Summary: The copy has exactly 1 footprint option (the default) with no pin map: Resistor clone → 1 variant 'R_0603_1608Metric' (pinMap null) vs 9 on the original; 74HC00 (Copy) Pins card says 'No pin map for this footprint.' and the variant label becomes the raw footprint name 'SOIC-14_3.9x8.7mm_P1.27mm'. Manufacturer/MPN/LCSC/datasheet/keywords/supplier/subcategory are not copied either. The Details 'Source' row becomes '—'. | Also covers: Q6-019: Upload STEP on a duplicated part always fails after conversion with 'Cannot update built-…
- Root cause: `src/modules/library/backend/queries.ts:1450` — cloneComponent inserts only the components row (name/description/symbolId/footprintId/tags); component-footprint option rows (pin maps, variant labels) and metadata columns are not copied
- Proposed fix: Backend clone copies footprints/pin map/metadata and clears builtin lock (STEP upload works on copy). — Detail: In cloneComponent copy the component_footprints rows (variant label, isDefault, pinMap) and all metadata columns (manufacturer, MPN, LCSC, supplier, subcategory, datasheetUrl, keywords, provenance) inside one transaction; add a backend test comparing detail payloads of source and clone.
- Evidence: /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q6/dark/011-detail-builtin-scrolled.png, /Users/andrejvysny/workspace/openpcb/OpenPCB/docs/qa/2026-09-ui-qa/evidence/shots/q6/dark/062-clone-upload-valid-step-refused.png
- Q6-005 repro: Stack B, Library → open core 'Resistor' (9 footprint options 0402…2512, each with a pin map) → Click 'Duplicate to edit' → Inspect the copy's detail page (Footprint options, Pins card) — or GET /components/{copyId}/detail → Repeat with 74HC00 Quad NAND SOIC-14
  - expected: The copy is a faithful editable duplicate: same footprint options (with variant labels + pin maps), MPN/manufacturer/datasheet/LCSC/keywords.
  - actual: The copy has exactly 1 footprint option (the default) with no pin map: Resistor clone → 1 variant 'R_0603_1608Metric' (pinMap null) vs 9 on the original; 74HC00 (Copy) Pins card says 'No pin map for this footprint.' and the variant label becomes the raw footprint name 'SOIC-14_3.9x8.7mm_P1.27mm'. Manufacturer/MPN/LCSC/datasheet/keywords/supplier/subcategory are not copied either. The Details 'Source' row becomes '—'.
  - code: `src/modules/library/backend/queries.ts:1450` cloneComponent inserts only the components row (name/description/symbolId/footprintId/tags); component-footprint option rows (pin maps, variant labels) and metadata columns are not copied
- Q6-019 repro: Stack B, Library → open core '74HC00 Quad NAND SOIC-14' → 'Duplicate to edit' (copy here: QA-Q6-74HC00-edited) → On the copy click Edit → 3D model card 'Upload STEP' → Choose a valid STEP (OP07CD.step extracted from fixtures/OP07CD.zip)
  - expected: The user's own copy can get its own 3D model (or the Upload STEP affordance is not offered / explains the footprint is shared with a built-in part and offers to fork it).
  - actual: The file is converted client-side ('Converting 3D model…' → 'Uploading GLB…'), then POST /footprints/openpcb.core.footprint.package.soic-14-…/model → 400 and the card shows: 'Cannot update built-in components (74HC00 Quad NAND SOIC-14). Use "Duplicate to my library" to create an editable copy.' The user IS on the duplicate; there is no 'Duplicate to my library' button (the real label is 'Duplicate to edit'). Cause: cloneComponent only inserts a new components row pointing at the built-in footprint, so every duplicate shares the core footprint and the backend guard rejects any model change. Dead end: duplicates can never get a 3D model.
  - code: `src/modules/library/frontend/ComponentDetailPage.tsx:331` canUploadStep = !isBuiltin && !isPlaceholderFootprint && editing — ignores that the footprint belongs to a built-in
  - code: `src/modules/library/frontend/ComponentDetailPage.tsx:288` uploads to footprintId: effectiveSelectedId (the shared core footprint)
  - code: `src/modules/library/backend/routes.ts:1605` assertFootprintNotBuiltinComponent rejects
  - code: `src/modules/library/backend/queries.ts:1410` guard message references 'Duplicate to my library'

## T-251 [S3] KiCad/library inspect endpoints return 500 for invalid user files

- Area designer.import · category error-handling · estimate XS · findings Q5-022, Q7-007
- **shared** with DB, D4, L1; lead: DB
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
