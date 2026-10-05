# library.browse — QA findings

[← index](../README.md) · 17 triage entries · S1 0 · S2 5 · S3 11 · S4 1

| TID | Sev | Title | Findings | Rec | Owner / wave | Scope | Est |
|---|---|---|---|---|---|---|---|
| [T-253](#t-253) | S2 | Library list and facets disagree (search 'passive' 43 vs 0 sources; SMD 3 of 17; THT 0) | F1C-013, Q6-001 | decide (DEC-L) | L1 / W2 | backend | S |
| [T-254](#t-254) | S2 | Library list replaced by a bare red error line on load/delete/import failure; no retry | F2C-006, Q6-003 | fix-now | L1 / W2 | frontend | S |
| [T-255](#t-255) | S2 | Library table at 1100×720: Name column 13 px, headers overprint | Q10-017, Q6-030 | fix-now | L1 / W2 | frontend | S |
| [T-256](#t-256) | S2 | Library list silently truncates at 60 parts — later parts (incl. core Resistor/Zener) unreachable without searching | Q6-002 | fix-now | L1 / W2 | backend | M |
| [T-257](#t-257) | S2 | Deleting library parts uses a native window.confirm that doesn't name the part | Q6-004 | fix-now | L1 / W2 | frontend | S |
| [T-258](#t-258) | S3 | Part source/provenance shown four ways; .opclib pack parts show as USER/KICAD and editable | F1C-005, Q6-006 | decide (DEC-L) | L1 / W2 | backend | M |
| [T-259](#t-259) | S3 | Library header/facets wrong in loading/empty/no-results/facet-failure states ('0 parts · 0 sources') | F2C-007, Q6-009, F1C-015 | fix-now | L1 / W2 | frontend | S |
| [T-260](#t-260) | S3 | Library search shows a '/' shortcut hint that does nothing, and the search box has no accessible name | Q6-007 | fix-now | L1 / W2 | frontend | XS |
| [T-261](#t-261) | S3 | Mount/pin-type values leak raw enum keys and mixed casing ('SMD' vs 'smd' vs 'through_hole' vs 'unknown') | Q6-008 | fix-now | L1 / W2 | frontend | S |
| [T-262](#t-262) | S3 | Library table keyboard/selection model is incomplete: no Home/End/PgUp/PgDn, no Shift/Cmd multi-select, no Delete key, focus looks like hover, rows have no roles | Q6-010 | fix-now | L1 / W2 | frontend | M |
| [T-263](#t-263) | S3 | Every search keystroke / facet toggle blanks the table to 'Loading components...' and remounts the preview canvases (2× TypeError each time) | Q6-011 | fix-now | L1 / W2 | frontend | S |
| [T-264](#t-264) | S3 | Preview 'No symbol/footprint preview' and 'Loading preview…' overlays use un-generated slate classes → bright button-like outline boxes | Q6-012 | fix-now | F0a / F0a | shared-package | S |
| [T-265](#t-265) | S3 | Facet options reorder and vanish as you tick them (sorted by live counts), so the next click lands on a different option | Q6-032 | fix-now | L1 / W2 | frontend | S |
| [T-266](#t-266) | S3 | Library table/preview use 9.5px source badges and near-invisible facet counts (text-disabled, ≈1.9:1 contrast) | Q6-033 | fix-now | L1 / W2 | frontend | XS |
| [T-267](#t-267) | S3 | Library notice toast sits on top of the header actions (Import library…, New part) for 5 s and uses a drop shadow | Q6-035 | fix-now | L1 / W2 | frontend | XS |
| [T-268](#t-268) | S3 | R3F 'Cannot read properties of null (reading addEventListener)' thrown when the wizard closes after import | Q7-028 | fix-now | L2 / W3 | frontend | S |
| [T-269](#t-269) | S4 | Preview pane keeps showing the previously selected part while the new selection loads, and Open/actions then target a different part than the one displayed | F1C-016 | fix-now | L1 / W2 | frontend | XS |

## T-253

**Library list and facets disagree (search 'passive' 43 vs 0 sources; SMD 3 of 17; THT 0)**

- Severity **S2** · category bug · status confirmed · themes dark, light
- Recommendation **decide** · decision DEC-L · owner L1 · wave W2 · scope backend · estimate S
- Findings: F1C-013, Q6-001

**Summary.** 'passive': 43 rows, header '43 parts · 0 sources', strip '43 of 43', and a completely blank facet rail. 'R': strip '60 of 30' (more rows than the total), header '30 parts · 3 sources', and the part literally named 'R' is not among the 60 rows because every part matches. Via the API: /components?q=R → 69 (all), /facets?q=R → total 30. q=passive → 43 vs 0, q=core → 17 vs 0, q=local → 49 vs 0, q=qa-f1c-tag05 → 1 vs 0.… | Also covers: Q6-001: Mount facet filters don't match the list: SMD shows 3 of 17, THT shows 0 parts, Family+Mo…

**Root cause.** `src/modules/library/backend/queries.ts:851` — searchableText includes tagsJson and sourceId

**Proposed fix.** Backend: one predicate for list + facets (search and mount/family filters). — Detail: Use one predicate for both endpoints: extract a matchesQuery(component, query) helper, or run facets over the same SQL WHERE. Drop sourceId from the free-text haystack (source already has a facet). Keep tags matching in both. Rank exact and prefix name matches first, so 'R' finds 'R'.

**Evidence.** [050-search-passive-count-mismatch](../evidence/shots/f1c/dark/050-search-passive-count-mismatch.png), [015-search-passive-count-mismatch](../evidence/shots/vf1c/dark/015-search-passive-count-mismatch.png), [003-facets-ic-smd](../evidence/shots/q6/dark/003-facets-ic-smd.png)

<details><summary>F1C-013 — Library search list and header/facets use different matching: 'passive' lists 43 parts under '0 sources' with an empty facet rail, and 'R' shows '60 of 30' (S2, confirmed)</summary>

- Area library.browse · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, Library (69 parts), Table view
  2. Type 'passive' in the search box
  3. Type 'R'
  4. Type 'core', 'local' or a tag such as 'qa-f1c-tag05'
- Expected: The list, the header count, the '<n> of <total>' strip and the facet rail all describe the same result set. Searching 'R' finds the part named 'R'.
- Actual: 'passive': 43 rows, header '43 parts · 0 sources', strip '43 of 43', and a completely blank facet rail. 'R': strip '60 of 30' (more rows than the total), header '30 parts · 3 sources', and the part literally named 'R' is not among the 60 rows because every part matches. Via the API: /components?q=R → 69 (all), /facets?q=R → total 30. q=passive → 43 vs 0, q=core → 17 vs 0, q=local → 49 vs 0, q=qa-f1c-tag05 → 1 vs 0. The list query matches name + description + tagsJson + sourceId. Because every sourceId ('openpcb.core', 'user.local') contains 'r', 'o', 'c' and so on, short queries return the whole library, while computeFacets matches name + description only.
- Screenshots: [050-search-passive-count-mismatch](../evidence/shots/f1c/dark/050-search-passive-count-mismatch.png), [049-detail-save-500](../evidence/shots/f1c/dark/049-detail-save-500.png), [012-search-passive-count-mismatch](../evidence/shots/f1c/light/012-search-passive-count-mismatch.png)
- Network: `GET /components?q=R&limit=100 → 69 rows; GET /facets?q=R → total 30`; `GET /components?q=passive → 43; GET /facets?q=passive → total 0`
- Code: `src/modules/library/backend/queries.ts:851` — searchableText includes tagsJson and sourceId
- Code: `src/modules/library/backend/queries.ts:1792` — facets matchesQuery = name/description only
- Suggested fix: Use one predicate for both endpoints: extract a matchesQuery(component, query) helper, or run facets over the same SQL WHERE. Drop sourceId from the free-text haystack (source already has a facet). Keep tags matching in both. Rank exact and prefix name matches first, so 'R' finds 'R'.
- Verification (vf1c): **confirmed** — Reproduced on stack B (library now 70 parts). API: q=R -> list 70 / facets total 31; q=passive -> 43 / 0; q=core -> 17 / 0; q=local -> 50 / 0. UI (vf1c-dark): 'passive' -> header '43 parts · 0 sources', strip '43 of 43', empty facet rail; 'R' -> header '31 parts · 3 sources', strip '60 of 31', 60 rows. Code: searchComponents' token haystack is lower(name || description || tagsJson || sourceId) (queries.ts:851), so 1-2 letter tokens match every row through 'openpcb.core'/'user.local'. computeFacets' matchesQuery uses name/description only (queries.ts:1792). Related to Q6-001 (same list-vs-facets divergence, but for tag filters, a different predicate), so fix both with one shared predicate. The '60' cap is K07/Q6-002. The part literally named 'R' has since been renamed, so that sub-claim couldn't be re-checked, but 60 of 70 rows returned for 'R' confirms short queries match nearly everything. S2 kept (wrong result counts, and search is unusable for short queries). · evidence: [015-search-passive-count-mismatch](../evidence/shots/vf1c/dark/015-search-passive-count-mismatch.png), [016-search-R-60-of-31](../evidence/shots/vf1c/dark/016-search-R-60-of-31.png), GET /components?q=R&limit=100 -> 70; /facets?q=R -> total 31; q=passive 43 vs 0; q=core 17 vs 0; q=local 50 vs 0

</details>

<details><summary>Q6-001 — Mount facet filters don't match the list: SMD shows 3 of 17, THT shows 0 parts, Family+Mount always 0 (S2, confirmed)</summary>

- Area library.browse · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, Library (Table view), no search
  2. Facet sidebar: tick Mount › SMD (facet count 16)
  3. Observe list shows '3 of 17' — only 3 user parts (those that literally carry an 'smd' tag); the 13 SMD core parts are missing
  4. Clear all, tick Mount › THT (count 4)
  5. Observe '0 of 0', header '0 parts · 0 sources', every facet section except 'Other' disappears, chip reads 'Tag: through_hole'
  6. Clear all, tick Family › ic (4) then Mount › SMD (4): header says '4 parts', list '0 of 4' + 'No components match the current filters'
- Expected: Ticking a Mount option shows exactly the parts counted next to it (SMD → 16 parts, THT → 4 pin headers/sockets), combinable with other facets.
- Actual: List filter matches mount tokens against the freeform component tags only, while the facet counts come from the default footprint's mountType; THT's raw key 'through_hole' isn't even recognised as a mount tag, so the facets endpoint itself returns total 0. API: GET /components?tags=smd → 3 rows vs /facets?tags=smd total 17; /components?tags=through_hole → 0 and /facets?tags=through_hole → total 0; /components?tags=ic,smd → 0 vs facets total 4. Re-confirmed later: Source Core + Mount SMD + Package sot-23 + Family transistor → every facet count says 3 and header "3 parts", list "0 of 3" with "No components match".
- Screenshots: [003-facets-ic-smd](../evidence/shots/q6/dark/003-facets-ic-smd.png), [004-facet-smd-only](../evidence/shots/q6/dark/004-facet-smd-only.png), [005-facet-tht-only](../evidence/shots/q6/dark/005-facet-tht-only.png), [032-active-chips](../evidence/shots/q6/dark/032-active-chips.png)
- Network: `GET /api/modules/library/components?limit=60&tags=smd → 3 components`; `GET /api/modules/library/facets?tags=smd → total 17`; `GET /api/modules/library/components?limit=60&tags=through_hole → 0`; `GET /api/modules/library/facets?tags=through_hole → total 0, mount []`
- Code: `src/modules/library/backend/queries.ts:880` — searchComponents: non-source filters matched only against row.tagsJson; footprint mountType never consulted
- Code: `src/modules/library/backend/queries.ts:1712` — computeFacets adds default-footprint mountType to the mount set — list and facets disagree
- Code: `src/modules/library/backend/tag-bucketing.ts:13` — MOUNT_TAGS has 'through-hole'/'tht' but not 'through_hole' (the footprint mountType key emitted by the facet), so the THT token is bucketed as 'other'
- Suggested fix: Share one predicate between searchComponents and computeFacets: bucket each filter token with bucketTag (add 'through_hole' to MOUNT_TAGS or normalise mountType keys), and match mount tokens against tags ∪ {default footprint mountType} in searchComponents (the row already carries footprintDataJson). Add a backend test asserting /components count == facet count for every facet option.
- Verification (vq6): **confirmed** — Reproduced on stack B (vq6-dark). Mount›SMD: header '61 parts', strip '8 of 61', 8 rows (only parts carrying a literal 'smd' tag). Mount›THT: '0 parts · 0 sources', '0 of 0', only the 'Other' facet section left, chip 'Tag: through_hole'. Family›ic + Mount›SMD: header '7 parts', list '2 of 7'. API agrees: /components?tags=smd → 8 rows vs /facets?tags=smd total 61; tags=through_hole → 0 rows and facets total 0. Code: searchComponents (queries.ts:880-897) matches non-source tokens only against tagsJson, while normalizeForFacets (queries.ts:1712) adds the default footprint's mountType; tag-bucketing.ts MOUNT_TAGS lacks 'through_hole', so the THT token is bucketed as 'other' in computeFacets. Not intentional (Run 2 added mount facet labels expecting them to filter). S2 kept: a primary filter returns wrong results. · evidence: [001-mount-smd](../evidence/shots/vq6/dark/001-mount-smd.png), [002-mount-tht](../evidence/shots/vq6/dark/002-mount-tht.png), [003-ic-smd](../evidence/shots/vq6/dark/003-ic-smd.png), GET /components?limit=100&tags=smd → 8; /facets?tags=smd → total 61, GET /components?tags=through_hole → 0; /facets?tags=through_hole → total 0, mount []

</details>


## T-254

**Library list replaced by a bare red error line on load/delete/import failure; no retry**

- Severity **S2** · category error-handling · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L1 · wave W2 · scope frontend · estimate S
- Findings: F2C-006, Q6-003 · known ref K08
- Depends on: ['T-006']

**Summary.** First open: the header says '76 parts · 3 sources' (from /facets), the count row says '0 of 76', and under it is a single 12px red line 'HTTP 500' (raw status, no explanation). The preview pane says 'Select a part to preview'. Search 'ne5' gives '1 part · 1 source' / '0 of 1' / 'HTTP 500'. The facet 'ic' gives '7 parts · 2 sources' / '0 of 7' / 'HTTP 500'. The facet rail and chips keep working, so the UI looks like… | Also covers: Q6-003: A failed delete or failed ZIP import wipes the whole component list and leaves a bare err…

**Root cause.** `src/modules/library/frontend/Space.tsx:511` — throws `HTTP ${status}` and ignores the problem+json title/detail

**Proposed fix.** Keep list on failed delete/import; show Banner with problem.ts copy + Retry/Dismiss; list-load failure empty state with Retry. — Detail: library/frontend/Space.tsx: in the list effect (:494-536) parse problem+json title/detail instead of `HTTP ${status}` (:511-513). Replace the bare line (:729-733) with a kit error state ('Couldn't load components', detail, Retry button that does setRefreshTick(v => v + 1)); hide the 'N of M' strip and the header part count while error is set. Keep this slot for list-load errors only; action failures go to NoticeViewport per Q6-003.

**Evidence.** [070-lib-list-500-first-open](../evidence/shots/f2c/dark/070-lib-list-500-first-open.png), [215-lib-list-500](../evidence/shots/vf2c/dark/215-lib-list-500.png), [028-delete-500](../evidence/shots/q6/dark/028-delete-500.png)

<details><summary>F2C-006 — If the Library list request fails, the table becomes a bare red 'HTTP 500' line with '0 of 76' — no message, no Retry. It recovers only after you change the search or a facet (S3, confirmed)</summary>

- Area library.browse · stack B · design None · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. Stack B. route '**/api/modules/library/components?**' → 500 problem+json (detail requests /components/:id/detail are not matched)
  2. Open Library from Home (first open)
  3. Type 'ne5' in search; clear it; tick Family › ic
  4. unroute; wait 3 s; then toggle the facet again
- Expected: An inline error state in the table area: 'Couldn't load components' with the server's reason and a Retry button, plus a neutral count (not '0 of 76'). Recovery through Retry, or automatically on focus/refresh.
- Actual: First open: the header says '76 parts · 3 sources' (from /facets), the count row says '0 of 76', and under it is a single 12px red line 'HTTP 500' (raw status, no explanation). The preview pane says 'Select a part to preview'. Search 'ne5' gives '1 part · 1 source' / '0 of 1' / 'HTTP 500'. The facet 'ic' gives '7 parts · 2 sources' / '0 of 7' / 'HTTP 500'. The facet rail and chips keep working, so the UI looks like the filter matched nothing. After unroute nothing refetches: the error stays until the query or a facet changes, or you leave Library and come back. The same bare error line is the delete/ZIP-import failure surface (K08/Q6-003), so this confirms K08 for the list-load path too.
- Screenshots: [070-lib-list-500-first-open](../evidence/shots/f2c/dark/070-lib-list-500-first-open.png), [071-lib-list-500-search](../evidence/shots/f2c/dark/071-lib-list-500-search.png), [072-lib-list-500-facet](../evidence/shots/f2c/dark/072-lib-list-500-facet.png), [073-lib-list-recovered](../evidence/shots/f2c/dark/073-lib-list-recovered.png), [116-1100-lib-list-500-light](../evidence/shots/f2c/light/116-1100-lib-list-500-light.png), [215-lib-list-500](../evidence/shots/vf2c/dark/215-lib-list-500.png), [216-lib-list-after-unroute](../evidence/shots/vf2c/dark/216-lib-list-after-unroute.png), [234-1100-lib-list-500](../evidence/shots/vf2c/light/234-1100-lib-list-500.png)
- Console: `Failed to load resource: 500 @ /api/modules/library/components?limit=60`; `… ?q=ne5&limit=60`; `… ?tags=ic&limit=60`
- Network: `GET /api/modules/library/components?limit=60 → 500`; `GET /api/modules/library/facets → 200 (header counts keep claiming 76 parts)`
- Pixel probes: {"file": "computed style", "x": 300, "y": 76, "hex": "#c2402f", "nearestToken": "--status-danger", "deltaE": 0}
- Code: `src/modules/library/frontend/Space.tsx:511` — throws `HTTP ${status}` and ignores the problem+json title/detail
- Code: `src/modules/library/frontend/Space.tsx:729` — error rendered as a bare text-status-danger line, no retry/dismiss
- Code: `src/modules/library/frontend/Space.tsx:564` — counts come from facets.total even when the list failed → '0 of 76'
- Code: `src/modules/library/frontend/Space.tsx:536` — list effect deps are [searchUrl, refreshTick]; nothing bumps refreshTick on error, focus or online
- Suggested fix: library/frontend/Space.tsx: in the list effect (:494-536) parse problem+json title/detail instead of `HTTP ${status}` (:511-513). Replace the bare line (:729-733) with a kit error state ('Couldn't load components', detail, Retry button that does setRefreshTick(v => v + 1)); hide the 'N of M' strip and the header part count while error is set. Keep this slot for list-load errors only; action failures go to NoticeViewport per Q6-003.
- Verification (vf2c): **confirmed** — Reproduced on stack B: route **/api/modules/library/components?** → 500 problem+json, Home › Library (dark 1440): header '76 parts · 3 sources', strip '0 of 76', one red 11px 'HTTP 500' line (#c2402f), 'Select a part to preview', 0 Retry buttons. After unroute + 4 s: still 'HTTP 500' / '0 of 76' (no refetch). Light 1100x720: same. Relation: same error slot as K08/Q6-003 (action failures, S2) and the same no-retry pattern as F1D-003 (other lists); neither fix covers the Library list-load path, so kept as its own finding with knownRef K08. S3 kept: unlike F1D-003 the error is visible, only unhelpful and not recoverable in place. · evidence: [215-lib-list-500](../evidence/shots/vf2c/dark/215-lib-list-500.png), [216-lib-list-after-unroute](../evidence/shots/vf2c/dark/216-lib-list-after-unroute.png), [234-1100-lib-list-500](../evidence/shots/vf2c/light/234-1100-lib-list-500.png), GET /api/modules/library/components?limit=60 → 500 (routed); GET /api/modules/library/facets → 200

</details>

<details><summary>Q6-003 — A failed delete or failed ZIP import wipes the whole component list and leaves a bare error line with no retry/dismiss (S2, confirmed)</summary>

- Area library.browse · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, Library table, select custom part QA-Q6-bulk-02
  2. route '**/api/modules/library/components/delete' → 500 application/problem+json {title:'Internal error'}
  3. Preview pane ⋯ Component actions → Delete → accept the confirm
  4. Observe list; then unroute and wait
  5. Second path (ZIP import): Library → Import library… → choose fixtures/sample.txt (the file picker's accept='.zip' can be overridden with 'All files')
  6. Observe the list area
- Expected: List stays intact; an error toast/inline banner says 'Couldn't delete QA-Q6-bulk-02 — Internal error' with Retry; the row remains selectable.
- Actual: All 60 rows disappear and are replaced by a single red 'Internal error' line under the chip row; the counter still says '60 of 69' and the preview pane still shows the part. No retry, no dismiss; the error persists after the backend recovers (unroute) until the user edits the search/filters or reloads. Same setError() path is used for ZIP-import failures. Re-confirmed for ZIP import (2nd session): POST /imports/kicad/zip → 400 and all rows are replaced by the lowercase backend string 'file must have a .zip extension'; the counter still reads '60 of 63', facets and the preview pane (74HC00) stay populated, so the screen contradicts itself. The only recovery is changing search/filters or reloading. Light re-check (bulk delete of 9 QA-Q6-bulk-3x parts, route **/api/modules/library/components/* → 500 text/plain): the list is replaced by the raw fallback 'Delete failed (HTTP 500)' (K40 wording) while the bulk bar still says '9 selected · Delete · Clear' and the facets still count 9 parts. After the sample.txt import error, re-applying the same (empty) search did not refetch — the error line stayed until the query text actually changed.
- Screenshots: [028-delete-500](../evidence/shots/q6/dark/028-delete-500.png), [051-import-sample-txt](../evidence/shots/q6/dark/051-import-sample-txt.png), [052-import-sample-txt-notice](../evidence/shots/q6/dark/052-import-sample-txt-notice.png), [026-bulk-delete-500](../evidence/shots/q6/light/026-bulk-delete-500.png), [027-import-sample-txt](../evidence/shots/q6/light/027-import-sample-txt.png)
- Network: `POST /api/modules/library/components/delete → 500 (injected)`; `POST /api/modules/library/imports/kicad/zip → 400 (sample.txt)`; `light: POST /api/modules/library/components/delete → 500 text/plain (routed) → list shows 'Delete failed (HTTP 500)'`
- Code: `src/modules/library/frontend/Space.tsx:290` — deleteComponents catch → setError(message) (the list-load error slot)
- Code: `src/modules/library/frontend/Space.tsx:748` — table only renders when !error — any action error hides the list
- Code: `src/modules/library/frontend/Space.tsx:405` — ZIP import failure also calls setError → same list wipe
- Suggested fix: Keep the fetch error (`error`) for list loading only; route action failures (delete, ZIP import) to the existing NoticeViewport (variant error, no auto-dismiss) or an inline dismissible banner with Retry. Never gate the table on action errors.
- Verification (vq6): **confirmed** — Reproduced both paths in dark and light. (1) route POST …/components/delete → 500 problem+json, delete QA-Q6-bulk-02 via ⋯ → Delete → accept: rows 60 → 0, a single red 'Internal error' line, strip still '60 of 67', preview pane still shows bulk-02; after unroute + 3 s the error line stays and there is no retry/dismiss control (0 buttons). The part was NOT deleted (detail still 200). (2) Import library… → fixtures/sample.txt: POST /imports/kicad/zip 400 → rows replaced by 'file must have a .zip extension' while strip reads '60 of 68' (also shown in the toast). Code: Space.tsx:290 and :405 call setError (the list-load slot) and the table renders only when !error (Space.tsx:747). Known K08. S2 kept. · evidence: [006-delete-500-list-wiped](../evidence/shots/vq6/dark/006-delete-500-list-wiped.png), [016-import-sample-txt](../evidence/shots/vq6/dark/016-import-sample-txt.png), [007-import-notice-covers-header](../evidence/shots/vq6/light/007-import-notice-covers-header.png), POST /api/modules/library/components/delete → 500 (routed), POST /api/modules/library/imports/kicad/zip → 400

</details>


## T-255

**Library table at 1100×720: Name column 13 px, headers overprint**

- Severity **S2** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L1 · wave W2 · scope frontend · estimate S
- Findings: Q10-017, Q6-030

**Summary.** Table area is 420 px wide (facet rail 220 + preview pane 380 are fixed). Row cells measure: icon 14, Name 13 px ('7…', 'A…'), Family 90, Package 10 px, Mount 60, Pins 44, Source 110. Header 'NAME' and 'FAMILY' labels draw over each other ('NAMFAMILY'). The only thing identifying a part is gone. | Also covers: Q6-030: At 1100×720 (Electron minimum) the Library table is squeezed to 420 px: names collapse to…

**Root cause.** `src/modules/library/frontend/components/LibraryTable.tsx:35` — COLS = '24px 1.4fr 90px 1.1fr 60px 44px 110px' — 328 px fixed, fr columns get the ~23 px remainder

**Proposed fix.** minmax() Name/Package columns; collapse facet rail or preview below ~1280px. — Detail: Use minmax() for Name/Package (e.g. '24px minmax(160px,1.4fr) 90px minmax(80px,1.1fr) 60px 44px 90px') with horizontal scroll, and/or make the preview pane collapsible/narrower (<1280 px → 300 px or overlay) and hide the Source column under a container-query breakpoint.

**Evidence.** [116-C1-library-header-sync-1100](../evidence/shots/q10/dark/116-C1-library-header-sync-1100.png), [061-library-table-1100](../evidence/shots/vq10/dark/061-library-table-1100.png), [030-library-table-1100](../evidence/shots/q6/light/030-library-table-1100.png)

<details><summary>Q10-017 — At the 1100×720 minimum window the Library table's Name column collapses to 13 px — part names are unreadable and the NAME/FAMILY headers overprint (S2, confirmed)</summary>

- Area library.browse · stack C1 · design None · themes dark · viewports 1100x720
- Repro:
  1. Any stack; resize to 1100×720
  2. Open Library (Table view, a part selected so the preview pane is open)
- Expected: Name stays the widest, readable column (min ~160 px); fixed columns shrink/hide or the preview pane/facet rail collapses first.
- Actual: Table area is 420 px wide (facet rail 220 + preview pane 380 are fixed). Row cells measure: icon 14, Name 13 px ('7…', 'A…'), Family 90, Package 10 px, Mount 60, Pins 44, Source 110. Header 'NAME' and 'FAMILY' labels draw over each other ('NAMFAMILY'). The only thing identifying a part is gone.
- Screenshots: [116-C1-library-header-sync-1100](../evidence/shots/q10/dark/116-C1-library-header-sync-1100.png)
- Code: `src/modules/library/frontend/components/LibraryTable.tsx:35` — COLS = '24px 1.4fr 90px 1.1fr 60px 44px 110px' — 328 px fixed, fr columns get the ~23 px remainder
- Code: `src/modules/library/frontend/components/LibraryPreviewPane.tsx:82` — w-[380px] shrink-0 preview pane
- Code: `src/modules/library/frontend/components/FacetSidebar.tsx:63` — w-[220px] shrink-0 facet rail
- Suggested fix: Use minmax() for Name/Package (e.g. '24px minmax(160px,1.4fr) 90px minmax(80px,1.1fr) 60px 44px 90px') with horizontal scroll, and/or make the preview pane collapsible/narrower (<1280 px → 300 px or overlay) and hide the Source column under a container-query breakpoint.
- Verification (vq10): **confirmed** — Reproduced at 1100×720 with a row selected: the table row is 420 px wide and the computed grid-template-columns is '24px 13.4375px 90px 10.5625px 60px 44px 110px', so Name is 13 px ('7…', 'A…'), Package 11 px, and the header shows 'NAMFAMILY' overprinted. Fixed columns (328 px) plus facet rail 220 px and preview pane 380 px leave nothing for the fr columns. Consistent with the Home equivalents Q1-005/Q3-039 (S2). Workaround: widen the window or close the preview. · evidence: [061-library-table-1100](../evidence/shots/vq10/dark/061-library-table-1100.png), dom: row width 420; gridTemplateColumns '24px 13.4375px 90px 10.5625px 60px 44px 110px'

</details>

<details><summary>Q6-030 — At 1100×720 (Electron minimum) the Library table is squeezed to 420 px: names collapse to one character and column headers overlap (S2, duplicate)</summary>

- Area library.browse · stack B · design None · themes dark, light · viewports 1100x720
- Repro:
  1. Stack B, resize window to 1100×720
  2. Library, Table view (facet rail and preview pane visible — they can't be hidden)
- Expected: Part names stay readable (the name is the primary column); the preview pane or facet rail collapses, or the table scrolls horizontally.
- Actual: Facet rail (220 px) + preview pane (380 px) are fixed width, leaving the table 420 px. Measured grid columns: '24px 13.4px 90px 10.6px 60px 44px 110px' — NAME is 13 px ('7…', 'A…', 'Q…'), PACKAGE 10 px ('s…'); the NAME and FAMILY header labels overprint ('NAMEILY'). Rows of QA-* parts are indistinguishable. The Family, Mount, Pins and Source columns keep their fixed widths.
- Screenshots: [030-library-table-1100](../evidence/shots/q6/light/030-library-table-1100.png), [071-library-table-1100](../evidence/shots/q6/dark/071-library-table-1100.png)
- Census: `census/library-table-light-1100.json`
- Code: `src/modules/library/frontend/components/LibraryTable.tsx:35` — COLS = '24px 1.4fr 90px 1.1fr 60px 44px 110px' — fr columns get the leftovers
- Code: `src/modules/library/frontend/components/LibraryPreviewPane.tsx:82` — w-[380px] shrink-0
- Code: `src/modules/library/frontend/components/FacetSidebar.tsx:63` — w-[220px] shrink-0
- Suggested fix: Give NAME a minmax(180px,1.4fr) track and let Package/Source drop below ~1280 px, make the preview pane collapsible/resizable (or narrower, e.g. 300 px, under 1280 px) and allow the facet rail to collapse; fall back to overflow-x:auto on the table.
- Verification (vq6): **duplicate** — Reproduced at 1100×720 (light): row grid-template-columns '24px 13.4375px 90px 10.5625px 60px 44px 110px', Name cell 13 px. Identical to Q10-017 (already verified S2 by vq10, same measurement and fix). · evidence: [006-library-table-1100](../evidence/shots/vq6/light/006-library-table-1100.png), gridTemplateColumns '24px 13.4375px 90px 10.5625px 60px 44px 110px'

</details>


## T-256

**Library list silently truncates at 60 parts — later parts (incl. core Resistor/Zener) unreachable without searching**

- Severity **S2** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L1 · wave W2 · scope backend · estimate M
- Findings: Q6-002 · known ref K07

**Summary.** Header says '69 parts', result strip says '60 of 69'; table ends at 'QA-Q6-bulk-40' with no load-more, no message. Alphabetically-later parts (QA-q7-*, core 'Resistor', 'Zener Diode') are not in the list at all; Select All only selects the 60 loaded rows. Backend clamps limit to [1,100] with no offset/total, so even raising the frontend limit fails at 101 parts. Light re-check: header '67 parts', strip '60 of 67' (l…

**Root cause.** `src/modules/library/frontend/Space.tsx:111` — url.searchParams.set('limit','60')

**Proposed fix.** Backend offset+total paging (approved) + infinite scroll/paging in table; header shows true total. — Detail: Add offset/cursor + total to GET /components (queries.ts searchComponents) and load pages on scroll in LibraryTable/grid (or virtualise and fetch all ids). Until then, render a footer row 'Showing 60 of 69 — refine the search to see more' and make Select All say it selects only loaded rows.

**Note.** Approved backend work.

**Evidence.** [020-library-69parts](../evidence/shots/q6/dark/020-library-69parts.png), [004-list-end-60cap](../evidence/shots/vq6/dark/004-list-end-60cap.png)

<details><summary>Q6-002 — Library list silently truncates at 60 parts — later parts (incl. core Resistor/Zener) unreachable without searching (S2, confirmed)</summary>

- Area library.browse · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B: library with 69 components (45 QA-Q6-bulk-* clones created via POST /components/{id}/clone)
  2. Open Library (Table view), no filters
  3. Read counters and scroll table to the end
- Expected: All 69 parts are browsable (paging / infinite scroll / virtualised list), or a clear 'Showing 60 of 69 — refine search / Load more' affordance.
- Actual: Header says '69 parts', result strip says '60 of 69'; table ends at 'QA-Q6-bulk-40' with no load-more, no message. Alphabetically-later parts (QA-q7-*, core 'Resistor', 'Zener Diode') are not in the list at all; Select All only selects the 60 loaded rows. Backend clamps limit to [1,100] with no offset/total, so even raising the frontend limit fails at 101 parts. Light re-check: header '67 parts', strip '60 of 67' (library grew as other agents added parts).
- Screenshots: [020-library-69parts](../evidence/shots/q6/dark/020-library-69parts.png), [021-library-60cap-bottom](../evidence/shots/q6/dark/021-library-60cap-bottom.png), [002-library-table-start](../evidence/shots/q6/light/002-library-table-start.png)
- Network: `GET /api/modules/library/components?limit=60 → 60 rows (69 in DB)`
- Code: `src/modules/library/frontend/Space.tsx:111` — url.searchParams.set('limit','60')
- Code: `src/modules/library/frontend/Space.tsx:683` — '{components.length} of {totalCount}' is the only hint
- Code: `src/modules/library/backend/queries.ts:819` — limit clamped to 100, no offset/cursor, no total in response
- Suggested fix: Add offset/cursor + total to GET /components (queries.ts searchComponents) and load pages on scroll in LibraryTable/grid (or virtualise and fetch all ids). Until then, render a footer row 'Showing 60 of 69 — refine the search to see more' and make Select All say it selects only loaded rows.
- Verification (vq6): **confirmed** — Reproduced: library has 67-68 parts; strip '60 of 68', exactly 60 rows, last row QA-Q6-bulk-38, no load-more/refine hint; core 'Resistor' and 'Zener Diode' are not among the rows (reachable only via search). Space.tsx:111 limit=60; queries.ts:819 clamps to 100 with no offset/total. Known K07. S2 kept (parts unreachable from browse; search is the workaround). · evidence: [004-list-end-60cap](../evidence/shots/vq6/dark/004-list-end-60cap.png), rows=60, last=[QA-Q6-bulk-36,37,38], hasResistor=false, hasZener=false

</details>


## T-257

**Deleting library parts uses a native window.confirm that doesn't name the part**

- Severity **S2** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L1 · wave W2 · scope frontend · estimate S
- Findings: Q6-004 · known ref K06
- Depends on: ['T-014']

**Summary.** Browser-native confirm 'Delete 1 component? This will also remove orphaned symbols and footprints.' (dialog spy: confirm=1). The part name is not shown, the style is OS-native (breaks the Electron look / can be suppressed), and after accepting there is no success feedback — the preview silently jumps to the first row of the list instead of the next neighbour. Same confirm is used for bulk delete.

**Root cause.** `src/modules/library/frontend/Space.tsx:266` — window.confirm in deleteComponents

**Proposed fix.** kit confirmDialog naming the part(s). — Detail: Replace window.confirm with the kit confirmation dialog (same one Home uses for design delete once fixed), include part names (first 3 + 'and N more'), then setNotice({variant:'success', title:'Deleted', message:name}) and select the next row.

**Evidence.** [027-actions-menu-custom](../evidence/shots/q6/dark/027-actions-menu-custom.png), [005-actions-menu](../evidence/shots/vq6/dark/005-actions-menu.png)

<details><summary>Q6-004 — Deleting library parts uses a native window.confirm that doesn't name the part (S2, confirmed)</summary>

- Area library.browse · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, Library table, select custom part QA-Q6-bulk-01
  2. Preview pane ⋯ Component actions → Delete
- Expected: In-app confirmation dialog (kit modal, focus-trapped, Esc/Enter) naming the part(s): 'Delete QA-Q6-bulk-01? Its symbol/footprint are removed if unused.' followed by a success notice.
- Actual: Browser-native confirm 'Delete 1 component? This will also remove orphaned symbols and footprints.' (dialog spy: confirm=1). The part name is not shown, the style is OS-native (breaks the Electron look / can be suppressed), and after accepting there is no success feedback — the preview silently jumps to the first row of the list instead of the next neighbour. Same confirm is used for bulk delete.
- Screenshots: [027-actions-menu-custom](../evidence/shots/q6/dark/027-actions-menu-custom.png), [024-actions-menu](../evidence/shots/q6/light/024-actions-menu.png)
- Console: `window.__qaDialogCalls = {confirm:1, log:['confirm: Delete 1 component? This will also remove orphaned symbols and footprints.']}`; `light: dialog spy confirm=1 'Delete 1 component? This will also remove orphaned symbols and footprints.' (QA-Q6-bulk-39); bulk: 'Delete 9 components? …'`
- Code: `src/modules/library/frontend/Space.tsx:266` — window.confirm in deleteComponents
- Code: `src/modules/library/frontend/Space.tsx:287` — success path: only clears selection + refresh, no notice
- Suggested fix: Replace window.confirm with the kit confirmation dialog (same one Home uses for design delete once fixed), include part names (first 3 + 'and N more'), then setNotice({variant:'success', title:'Deleted', message:name}) and select the next row.
- Verification (vq6): **confirmed** — Reproduced: ⋯ Component actions → Delete opens a browser-native confirm; dialog spy {confirm:1, log:['confirm: Delete 1 component? This will also remove orphaned symbols and footprints.']} — part name not shown. Code Space.tsx:266 window.confirm; success path (:287-288) only clears selection + refreshTick, no notice. Known K06 (this site). Native confirm = S2 per protocol. · evidence: [005-actions-menu](../evidence/shots/vq6/dark/005-actions-menu.png), __qaDialogCalls={confirm:1, log:['confirm: Delete 1 component? This will also remove orphaned symbols and footprints.']}

</details>


## T-258

**Part source/provenance shown four ways; .opclib pack parts show as USER/KICAD and editable**

- Severity **S3** · category consistency · status confirmed · themes dark, light
- Recommendation **decide** · decision DEC-L · owner L1 · wave W2 · scope backend · estimate M
- Findings: F1C-005, Q6-006

**Summary.** The facet rail correctly lists 'QA-f1c Team Pack 3'. The table SOURCE badge, however, reads KICAD for the LED and NE555 and USER for the Resistor. The detail Details card shows 'Source —'. Tags show internal 'builtin' and 'system' tags copied from the core part. An Edit button is offered; any edit is silently reverted by the next install of the same pack, because upsertComponent overwrites name/description/tags. | Also covers: Q6-006: A part's 'source' is shown four different ways (facet vs table badge vs detail row vs pro…

**Root cause.** `src/modules/library/frontend/detail-helpers.ts:170` — componentSourceKey only knows core/kicad/user; the list DTO has no sourceId

**Proposed fix.** Frontend: one sourceLabel helper; backend: store .opclib pack provenance on parts. — Detail: Add sourceId and sourceName to the components list DTO (searchComponents). Render the pack name in LibraryTable/LibraryPreviewPane/DetailsCard. Treat parts from any source with isReadOnly or kind!=='user' like built-ins (Duplicate to edit). Hide system tags ('builtin', 'system') in the detail tag row. Related to Q6-006.

**Evidence.** [007-library-team-pack-search](../evidence/shots/f1c/dark/007-library-team-pack-search.png), [004-library-pack-parts-source-badges](../evidence/shots/vf1c/light/004-library-pack-parts-source-badges.png), [022-copy-row-selected](../evidence/shots/q6/dark/022-copy-row-selected.png)

<details><summary>F1C-005 — Parts from an installed .opclib pack show as USER/KICAD, have no Source and are editable, so pack provenance is lost (S3, confirmed)</summary>

- Area library.browse · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Stack B: install 'QA-f1c Team Pack' (qa.f1c.pack, kind team, 3 parts) via Settings → Libraries → Install from file…
  2. Library → search 'QA-f1c pack'
  3. Read the SOURCE column, the preview pane and the detail page of 'QA-f1c pack Resistor'
- Expected: Pack parts show the pack name ('QA-f1c Team Pack') everywhere the source appears (table badge, preview, detail 'Source'). They are read-only like core parts (Duplicate to edit), because reinstalling the pack overwrites them.
- Actual: The facet rail correctly lists 'QA-f1c Team Pack 3'. The table SOURCE badge, however, reads KICAD for the LED and NE555 and USER for the Resistor. The detail Details card shows 'Source —'. Tags show internal 'builtin' and 'system' tags copied from the core part. An Edit button is offered; any edit is silently reverted by the next install of the same pack, because upsertComponent overwrites name/description/tags.
- Screenshots: [007-library-team-pack-search](../evidence/shots/f1c/dark/007-library-team-pack-search.png), [008-detail-team-pack-part](../evidence/shots/f1c/dark/008-detail-team-pack-part.png)
- Code: `src/modules/library/frontend/detail-helpers.ts:170` — componentSourceKey only knows core/kicad/user; the list DTO has no sourceId
- Code: `src/modules/library/backend/sync/opclib-importer.ts:710` — update branch overwrites name/description/tags on reinstall
- Suggested fix: Add sourceId and sourceName to the components list DTO (searchComponents). Render the pack name in LibraryTable/LibraryPreviewPane/DetailsCard. Treat parts from any source with isReadOnly or kind!=='user' like built-ins (Duplicate to edit). Hide system tags ('builtin', 'system') in the detail tag row. Related to Q6-006.
- Verification (vf1c): **confirmed** — Reproduced in vf1c-light after reinstalling qa.f1c.pack. The facet rail shows 'Source › QA-f1c Team Pack 3', but the SOURCE column reads 'kicad' for the pack LED and NE555 and 'user' for the pack Resistor. The Resistor detail page shows 'Source —', displays the internal 'builtin' and 'system' tags, and offers an enabled Edit button. Code: componentSourceKey (detail-helpers.ts:170-183) derives the badge from isBuiltin plus KiCad tags only, because the list DTO has no sourceId (GET /components/:id also returns no sourceId). formatSourceLabel (:83-104) returns '—' for non-builtin parts without provenance. upsertComponent's update branch overwrites name, description and tags on reinstall (opclib-importer.ts:750-760), so user edits to pack parts are lost. The badge and Source-row mismatch shares its root cause with Q6-006 (fix once in the list DTO). The unique part here is that pack parts are editable and then silently overwritten on reinstall. Pack removed again afterwards (DELETE -> removed:3). S3 kept. · evidence: [004-library-pack-parts-source-badges](../evidence/shots/vf1c/light/004-library-pack-parts-source-badges.png), [005-detail-pack-resistor-source-dash](../evidence/shots/vf1c/light/005-detail-pack-resistor-source-dash.png), table rows: 'QA-f1c pack LED … kicad', 'QA-f1c pack NE555 … kicad', 'QA-f1c pack Resistor … user'; detail 'Source —', tags builtin,system, Edit enabled

</details>

<details><summary>Q6-006 — A part's 'source' is shown four different ways (facet vs table badge vs detail row vs provenance chip) (S3, confirmed)</summary>

- Area library.browse · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, Library table
  2. Compare Source facet options with the SOURCE column for user parts
  3. Select '74HC00 Quad NAND SOIC-14 (Copy)' then open it; open core '74HC00 Quad NAND SOIC-14'
- Expected: One source vocabulary everywhere (e.g. Core / Local / Imported-KiCad) derived from one field.
- Actual: Facet lists 'Local Library' (49) and 'User' (3) but the table shows USER for both; the duplicated 74HC00 is 'Local Library' in the facet, 'KICAD' badge in table + preview, 'Source —' in the detail Details card, plus a dashed 'Imported from KiCad' chip. Core parts carry the same 'Imported from KiCad' chip while Details says 'Core library'. Users cannot tell what 'Local Library' vs 'User' means.
- Screenshots: [022-copy-row-selected](../evidence/shots/q6/dark/022-copy-row-selected.png), [010-detail-builtin](../evidence/shots/q6/dark/010-detail-builtin.png), [012-after-duplicate](../evidence/shots/q6/dark/012-after-duplicate.png), [025-bulk-select](../evidence/shots/q6/light/025-bulk-select.png)
- Network: `GET /components?tags=source:user → ATMEGA16U4-AU, ATMEGA8A-MU, ATTINY13A-SU`; `GET /components?tags=source:user.local → 74HC00 (Copy), LM324N, QA-* parts`
- Code: `src/modules/library/frontend/detail-helpers.ts:170` — componentSourceKey: badge from tags (kicad-derived → 'kicad')
- Code: `src/modules/library/frontend/detail-helpers.ts:83` — formatSourceLabel: Details row from provenance → '—' for clones
- Code: `src/modules/library/frontend/detail-helpers.ts:64` — splitTags: 'kicad-derived' → 'Imported from KiCad' chip even on core parts
- Code: `src/modules/library/backend/queries.ts:1497` — clone sets sourceId 'user.local' (facet 'Local Library')
- Suggested fix: Derive a single `sourceLabel` server-side (from sourceId + provenance) and put it on the list DTO; use it for the facet label, the table/preview badge and the Details row. Merge 'user' and 'user.local' into one 'Local' bucket; don't show the KiCad-provenance chip on core parts (or phrase it 'Derived from KiCad library').
- Verification (vq6): **confirmed** — Reproduced: facet Source lists 'Local Library 48 / OpenPCB Core Library 17 / User 3', but the SOURCE column shows USER for both ATMEGA* (sourceId 'user') and QA-Q6-bulk-* (user.local), KICAD for the 74HC00 copy, CORE for core; core detail pages show the dashed 'Imported from KiCad' chip while Details → Source reads 'Core library'. Code: componentSourceKey (detail-helpers.ts:170-183) derives the badge from isBuiltin/tags, formatSourceLabel (:83) from provenance ('—' for clones), facets from sourceId. S3 kept. · evidence: [008-preview-detail-500](../evidence/shots/vq6/dark/008-preview-detail-500.png), [010-detail-74hc00](../evidence/shots/vq6/dark/010-detail-74hc00.png), table rows: ATMEGA16U4-AU … USER, QA-Q6-bulk-02 … USER, QA-Q6-74HC00-edited … KICAD

</details>


## T-259

**Library header/facets wrong in loading/empty/no-results/facet-failure states ('0 parts · 0 sources')**

- Severity **S3** · category error-handling · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L1 · wave W2 · scope frontend · estimate S
- Findings: F2C-007, Q6-009, F1C-015

**Summary.** The left rail is an empty 220px column with no message. The header reads '60 parts · 0 sources' and the count row '60 of 60', although the library has 76 parts in 3 sources (the list is capped at 60, Q6-002). This tells the user the list is complete while 16 parts are unreachable. The only trace is a console 500. After unroute nothing refetches until the search text changes (then '76 parts · 3 sources', rail back). | Also covers: Q6-009: No-results search state says 'Import a component to get started', zeroes the header count…; F1C-015: The true empty library and the loading list both render as 'No components match the curre…

**Root cause.** `src/modules/library/frontend/Space.tsx:434` — `const { facets } = useLibraryFacets(...)` drops the hook's `error`

**Proposed fix.** Distinct states: loading skeleton, empty library (CTA), no-results (Clear filters), facets failed (Retry); header counts from list total. — Detail: library/frontend/Space.tsx:434 destructure `error` (and add a refetch to useLibraryFacets, e.g. bump refreshToken). When it is set, render 'Filters unavailable · Retry' in the facet rail and replace the header/strip counts (:564-565, :611, :683) with '60 shown' (no total, no source count) instead of falling back to components.length and facets.source.length = 0.

**Evidence.** [074-lib-facets-500](../evidence/shots/f2c/dark/074-lib-facets-500.png), [217-lib-facets-500](../evidence/shots/vf2c/dark/217-lib-facets-500.png), [024-no-results](../evidence/shots/q6/dark/024-no-results.png)

<details><summary>F2C-007 — A failed /facets request is silent: the filter rail disappears and the header claims '60 parts · 0 sources' / '60 of 60' while the library has 76 parts in 3 sources (S3, confirmed)</summary>

- Area library.browse · stack B · design None · themes dark · viewports 1440x900
- Repro:
  1. Stack B. route '**/api/modules/library/facets**' → 500
  2. Home → Library
  3. Read the header, count row and left rail
  4. unroute; wait; type and delete a character in search
- Expected: The facet rail shows 'Filters unavailable — Retry' and the header keeps a truthful count, or none, instead of inventing one from the truncated list.
- Actual: The left rail is an empty 220px column with no message. The header reads '60 parts · 0 sources' and the count row '60 of 60', although the library has 76 parts in 3 sources (the list is capped at 60, Q6-002). This tells the user the list is complete while 16 parts are unreachable. The only trace is a console 500. After unroute nothing refetches until the search text changes (then '76 parts · 3 sources', rail back).
- Screenshots: [074-lib-facets-500](../evidence/shots/f2c/dark/074-lib-facets-500.png), [217-lib-facets-500](../evidence/shots/vf2c/dark/217-lib-facets-500.png)
- Console: `Failed to load resource: 500 @ /api/modules/library/facets`
- Network: `GET /api/modules/library/facets → 500`; `GET /api/modules/library/components?limit=60 → 200`
- Code: `src/modules/library/frontend/Space.tsx:434` — `const { facets } = useLibraryFacets(...)` drops the hook's `error`
- Code: `src/modules/library/frontend/hooks/useLibraryFacets.ts:70` — error captured but never surfaced
- Code: `src/modules/library/frontend/Space.tsx:564` — totalCount falls back to components.length (the 60-item page) and sourceCount to 0
- Suggested fix: library/frontend/Space.tsx:434 destructure `error` (and add a refetch to useLibraryFacets, e.g. bump refreshToken). When it is set, render 'Filters unavailable · Retry' in the facet rail and replace the header/strip counts (:564-565, :611, :683) with '60 shown' (no total, no source count) instead of falling back to components.length and facets.source.length = 0.
- Verification (vf2c): **confirmed** — Reproduced on stack B (dark): route **/api/modules/library/facets** → 500, Home › Library: empty 220px left rail with no message, header '60 parts · 0 sources', strip '60 of 60', 60 rows, no error text; the API reports total 76 and 3 sources, and the table itself shows CORE/USER/KICAD badges. After unroute + 3 s: unchanged. Distinct root from F1C-013 (backend facets/list query mismatch) and Q6-009 (no-results state): here the hook's error is dropped. The '60' depends on the Q6-002 cap. S3 kept: the list itself is correct, only filters and counts are wrong, and it needs a facets failure. · evidence: [217-lib-facets-500](../evidence/shots/vf2c/dark/217-lib-facets-500.png), GET /api/modules/library/facets → 500 (routed), curl /api/modules/library/facets → total 76, 3 sources

</details>

<details><summary>Q6-009 — No-results search state says 'Import a component to get started', zeroes the header counts and empties the facet rail (S3, confirmed)</summary>

- Area library.browse · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, Library (69 parts)
  2. Type 'zzqx-nomatch' in search
- Expected: 'No parts match "zzqx-nomatch"' with a Clear search action; header keeps the library size (69 parts) or says '0 of 69'; facet rail keeps its sections (with 0 counts) or shows a short note.
- Actual: Header reads 'Library 0 parts · 0 sources' (as if the library were empty), body says 'No components match the current filters.' + 'Import a component to get started.' (the 'Try clearing some filters' hint only appears for facet filters, never for search), the table header disappears and the facet rail is blank with no message. Preview says 'Select a part to preview'.
- Screenshots: [024-no-results](../evidence/shots/q6/dark/024-no-results.png), [002-search-no-results](../evidence/shots/q6/dark/002-search-no-results.png), [005-no-results](../evidence/shots/q6/light/005-no-results.png)
- Code: `src/modules/library/frontend/Space.tsx:564` — header count = filtered facets.total
- Code: `src/modules/library/frontend/Space.tsx:741` — hint only considers activeTags, not the query
- Code: `src/modules/library/frontend/components/FacetSidebar.tsx:68` — sections with 0 options return null → blank rail
- Suggested fix: Keep an unfiltered total for the header; branch the empty state on query/tags: search miss → 'No parts match “q”' + [Clear search]; facet miss → 'Try clearing some filters' + [Clear all]; truly empty library → Import CTA. Render a muted 'No filters for this result' line in the rail.
- Verification (vq6): **confirmed** — Reproduced with 'zzqx-nomatch': header '0 parts · 0 sources', strip '0 of 0', body 'No components match the current filters.' + 'Import a component to get started.', facet rail completely blank (0 sections), preview 'Select a part to preview'. Code Space.tsx:564 totalCount from filtered facets.total; :741-743 hint only checks activeTags. S3 kept. · evidence: [007-no-results](../evidence/shots/vq6/dark/007-no-results.png)

</details>

<details><summary>F1C-015 — The true empty library and the loading list both render as 'No components match the current filters' / '0 parts · 0 sources', with no CTA or loading indicator (S4, confirmed)</summary>

- Area library.browse · stack B · design None · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. Stack B. Capture the real shape: GET /components → {ok:true,data:{components:[…]}}; GET /facets → {ok:true,data:{facets:{source,family,package,mount,other,total}}}
  2. In-page fetch shim (f1c/fetchshim.js, mode 'empty') returns {ok:true,data:{components:[]}} and empty facets; navigate Home → Library
  3. Shim mode 'delay' (2.5 s on every GET /api/modules/library/*); navigate Home → Library and screenshot at 0.5 s
- Expected: Empty: 'Your library is empty', with the reason (e.g. the core library is missing or was removed) and primary actions New part / Import library… / Settings → Libraries. No 'filters' wording when no filter is active. Loading: a skeleton or spinner, and header counts shown as '—' until the data arrives.
- Actual: True empty: the header reads 'Library 0 parts · 0 sources' and the strip '0 of 0' next to a disabled 'Select All'. The body says 'No components match the current filters.' (no filter is active) with a plain-text hint 'Import a component to get started.' and no buttons. The facet rail is a blank column and the preview says 'Select a part to preview'. Grid view is identical. Loading: for the whole 2.5 s the header claims '0 parts · 0 sources' and '0 of 0', the facet rail is blank, and the only indicator is a small left-aligned 'Loading components...' line (three ASCII dots). The shell looks exactly like an empty library that is loading. Q6-009 covers the search no-results variant.
- Screenshots: [054-library-true-empty](../evidence/shots/f1c/dark/054-library-true-empty.png), [055-library-true-empty-grid](../evidence/shots/f1c/dark/055-library-true-empty-grid.png), [058-library-loading-list](../evidence/shots/f1c/dark/058-library-loading-list.png), [013-library-true-empty](../evidence/shots/f1c/light/013-library-true-empty.png), [014-library-true-empty-1100](../evidence/shots/f1c/light/014-library-true-empty-1100.png), [015-library-loading](../evidence/shots/f1c/light/015-library-loading.png)
- Network: `shim log: facets, core-library/status, components?limit=60`
- Census: `census/f1c-library-empty-light-1440.json`
- Code: `src/modules/library/frontend/Space.tsx:726` — loading replaces the list with 'Loading components...'
- Code: `src/modules/library/frontend/Space.tsx:738` — empty copy always says 'match the current filters'
- Suggested fix: In LibrarySpace, distinguish three states. (a) loading → skeleton rows plus header counts rendered as '—'. (b) empty with no query and no filters → an EmptyState kit component ('Library is empty') with New part / Import library… buttons and a link to Settings → Libraries when the openpcb.core source is absent. (c) no matches → 'No parts match "<q>"' plus a Clear filters button. Hide Select All when there are zero rows.
- Verification (vf1c): **confirmed** — Reproduced with the f1c fetch shim in vf1c-light. Empty mode: 'Library | 0 parts · 0 sources | 0 of 0 | Select All | No components match the current filters. | Import a component to get started. | Select a part to preview'. Delay mode (2.5 s): '0 parts · 0 sources | 0 of 0 | Select All | Loading components...'. Code: Space.tsx:723-745 (a single undifferentiated empty block) and :564 (totalCount from facets). Recalibrated S3 -> S4 because neither state is realistically visible. On the real stack a MutationObserver measured the zero-count header for about 11 ms and 'Loading components...' for about 28 ms after clicking Library ([89,'0'],[93,'L0'],[100,'L70'],[121,'70']). A truly empty library needs the core source gone, which the app never allows (core is undeletable and re-seeded). This is the same pattern as F1D-002 (S4, Home/Assistant). The empty-copy block is the same code as Q6-009 (no-results state), so fix it once by distinguishing loading, empty and no-matches. · evidence: [010-library-true-empty](../evidence/shots/vf1c/light/010-library-true-empty.png), [011-library-loading-zero-counts](../evidence/shots/vf1c/light/011-library-loading-zero-counts.png), real-stack timing after rail click: [[89,'0 parts'],[93,'Loading + 0'],[100,'Loading + 70'],[121,'70']] ms

</details>


## T-260

**Library search shows a '/' shortcut hint that does nothing, and the search box has no accessible name**

- Severity **S3** · category a11y · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L1 · wave W2 · scope frontend · estimate XS
- Findings: Q6-007 · known ref K24
- Depends on: ['T-002']

**Summary.** '/' does nothing (activeElement stays BODY). Accessibility tree shows an unnamed `searchbox` (no aria-label; the wrapping <label> only contains the aria-hidden '/' hint). Facet filter boxes are correctly named ('Filter family options').

**Root cause.** `src/modules/library/frontend/Space.tsx:615` — SearchField with shortcutHint='/' but no key handler and no aria-label

**Proposed fix.** '/' focuses search (shortcut guard) or drop hint; aria-label on search. — Detail: Add aria-label='Search library' and a window keydown handler for '/' (ignored while typing in inputs/textarea/contenteditable) that focuses + selects the search input; Esc in the field already clears.

**Evidence.** [024-no-results](../evidence/shots/q6/dark/024-no-results.png)

<details><summary>Q6-007 — Library search shows a '/' shortcut hint that does nothing, and the search box has no accessible name (S3, confirmed)</summary>

- Area library.browse · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, Library, click empty space so nothing is focused (activeElement = BODY)
  2. Press '/'
  3. Inspect the search box in the accessibility snapshot
- Expected: '/' focuses the search (as Home's search does) and the input is announced as 'Search library'.
- Actual: '/' does nothing (activeElement stays BODY). Accessibility tree shows an unnamed `searchbox` (no aria-label; the wrapping <label> only contains the aria-hidden '/' hint). Facet filter boxes are correctly named ('Filter family options').
- Screenshots: [024-no-results](../evidence/shots/q6/dark/024-no-results.png)
- Console: `activeElement after '/' = BODY; input aria-label=null, labels=['/']`
- Code: `src/modules/library/frontend/Space.tsx:615` — SearchField with shortcutHint='/' but no key handler and no aria-label
- Code: `src/shared/frontend/ui/search-field.tsx:35` — hint rendered aria-hidden inside the label
- Suggested fix: Add aria-label='Search library' and a window keydown handler for '/' (ignored while typing in inputs/textarea/contenteditable) that focuses + selects the search input; Esc in the field already clears.
- Verification (vq6): **confirmed** — Reproduced: with activeElement BODY, pressing '/' leaves focus on BODY. Accessibility snapshot shows an unnamed 'searchbox'; input aria-label=null, its wrapping <label> text is only the aria-hidden '/' hint. search-field.tsx renders the hint but no component wires a '/' handler for Library (Space.tsx:614-620). Known K24. S3 kept. · evidence: activeElement after '/' = BODY; input aria-label=null, labels=['/']

</details>


## T-261

**Mount/pin-type values leak raw enum keys and mixed casing ('SMD' vs 'smd' vs 'through_hole' vs 'unknown')**

- Severity **S3** · category copy · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L1 · wave W2 · scope frontend · estimate S
- Findings: Q6-008

**Summary.** Table shows 'SMD'/'THT'; preview Footprints shows 'smd' and 'through_hole'; preview Specs + detail Footprint card show 'smd'; LM324N shows '—' in the table but the facet lists it as 'Unknown' and the detail 'unknown'. Package column is '—' for most parts (derived from tags only) while the preview Specs shows the real package (e.g. Capacitor '0402 (1005 metric) SMD'). The active-filter chip for the Mount facet also s…

**Root cause.** `src/modules/library/frontend/components/LibraryPreviewPane.tsx:217` — variant.mountType raw

**Proposed fix.** Label maps for mount/pin types (SMD, THT, Passive…). — Detail: Export a formatMountType() (MOUNT_LABELS) from detail-helpers and use it in LibraryTable, LibraryPreviewPane (footprints + specs) and ComponentDetailPage; fill the table Package column from the default footprint's variantLabel/packageCode when no package tag exists (server DTO).

**Evidence.** [023-search-lm358](../evidence/shots/q6/dark/023-search-lm358.png), [005-actions-menu](../evidence/shots/vq6/dark/005-actions-menu.png)

<details><summary>Q6-008 — Mount/pin-type values leak raw enum keys and mixed casing ('SMD' vs 'smd' vs 'through_hole' vs 'unknown') (S3, confirmed)</summary>

- Area library.browse · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, Library table
  2. Look at the MOUNT column (SMD/THT)
  3. Select 'LM358 Dual Op-Amp' → preview Footprints list and Specs
  4. Open the part → Footprint card 'Mount'
  5. Select LM324N
- Expected: One display vocabulary: SMD / THT / Mixed / Unknown everywhere (the facet already maps keys via MOUNT_LABELS).
- Actual: Table shows 'SMD'/'THT'; preview Footprints shows 'smd' and 'through_hole'; preview Specs + detail Footprint card show 'smd'; LM324N shows '—' in the table but the facet lists it as 'Unknown' and the detail 'unknown'. Package column is '—' for most parts (derived from tags only) while the preview Specs shows the real package (e.g. Capacitor '0402 (1005 metric) SMD'). The active-filter chip for the Mount facet also shows the raw key ("Mount: smd") while the checkbox says "SMD" ([032-active-chips](../evidence/shots/q6/dark/032-active-chips.png)).
- Screenshots: [023-search-lm358](../evidence/shots/q6/dark/023-search-lm358.png), [001-library-table](../evidence/shots/q6/dark/001-library-table.png), [011-detail-builtin-scrolled](../evidence/shots/q6/dark/011-detail-builtin-scrolled.png), [032-active-chips](../evidence/shots/q6/dark/032-active-chips.png), [002-library-table-start](../evidence/shots/q6/light/002-library-table-start.png), [015-upload-minimal-step-card](../evidence/shots/q6/light/015-upload-minimal-step-card.png)
- Code: `src/modules/library/frontend/components/LibraryPreviewPane.tsx:217` — variant.mountType raw
- Code: `src/modules/library/frontend/components/LibraryPreviewPane.tsx:272` — Specs Mount raw
- Code: `src/modules/library/frontend/ComponentDetailPage.tsx:654` — detail Mount raw
- Code: `src/modules/library/frontend/components/FacetSidebar.tsx:41` — MOUNT_LABELS exists but only used by the facet
- Code: `src/modules/library/frontend/components/LibraryTable.tsx:219` — Package column from tags only
- Suggested fix: Export a formatMountType() (MOUNT_LABELS) from detail-helpers and use it in LibraryTable, LibraryPreviewPane (footprints + specs) and ComponentDetailPage; fill the table Package column from the default footprint's variantLabel/packageCode when no package tag exists (server DTO).
- Verification (vq6): **confirmed** — Reproduced: table MOUNT column shows 'SMD'/'THT' (server displayMountType), but the preview Footprints row and Specs show raw 'smd', the detail Footprint card 'Mount smd', LM324N shows '—' in the table while the facet says 'Unknown', and the active chip reads 'Mount: smd' next to the 'SMD' checkbox. Package column '—' for Capacitor/bulk parts while Specs show '1608'. Code: LibraryPreviewPane.tsx:217 and :272, ComponentDetailPage.tsx:654 render raw mountType; MOUNT_LABELS (FacetSidebar.tsx:41) is used only by the facet; LibraryTable.tsx:218 package from tags only. S3 kept. · evidence: [005-actions-menu](../evidence/shots/vq6/dark/005-actions-menu.png), [009-74hc00-preview](../evidence/shots/vq6/dark/009-74hc00-preview.png), [015-op07cd-detail](../evidence/shots/vq6/dark/015-op07cd-detail.png), chip aria-label 'Remove filter Mount: smd'

</details>


## T-262

**Library table keyboard/selection model is incomplete: no Home/End/PgUp/PgDn, no Shift/Cmd multi-select, no Delete key, focus looks like hover, rows have no roles**

- Severity **S3** · category keyboard · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L1 · wave W2 · scope frontend · estimate M
- Findings: Q6-010

**Summary.** End/PageDown only scroll the container (focused row ATMEGA8A-MU scrolls out of view, selection unchanged); no multi-select gesture exists in table view — the checkbox column only appears after 'Select All'; Delete does nothing. Rows have no role/aria-selected (screen readers get plain text). focus-visible uses the same bg as hover (#… surface-hover), so the keyboard row is indistinguishable from the mouse-hover row.…

**Root cause.** `src/modules/library/frontend/components/LibraryTable.tsx:113` — handleKeyDown handles only ArrowUp/ArrowDown/Enter

**Proposed fix.** Table: Home/End/PgUp/PgDn, Shift/Cmd multi-select, Delete key, distinct focus vs hover, row names. — Detail: Give the table role=grid/rows role=row + aria-selected; handle Home/End/PageUp/PageDown in handleKeyDown; add Space/Cmd-click to toggle bulk selection and Shift-click ranges; Delete/Backspace → deleteComponents for custom rows; use an inset 1px selection outline for focus-visible; add a skip target (e.g. ArrowDown from the search box focuses the first row).

**Evidence.** [025-keyboard-focus-row](../evidence/shots/q6/dark/025-keyboard-focus-row.png), [008-keyboard-focus-vs-hover](../evidence/shots/vq6/light/008-keyboard-focus-vs-hover.png)

<details><summary>Q6-010 — Library table keyboard/selection model is incomplete: no Home/End/PgUp/PgDn, no Shift/Cmd multi-select, no Delete key, focus looks like hover, rows have no roles (S3, confirmed)</summary>

- Area library.browse · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, Library table: click 'AMS1117-3.3 SOT-223'
  2. ArrowDown ×2 (works: ATMEGA8A-MU selected + focused)
  3. Press End, PageDown, Home
  4. Shift/Cmd+click another row; press Delete on a custom row
  5. Tab from the search box towards the table
- Expected: Grid/listbox semantics (role=grid/row, aria-selected), Home/End/PageUp/PageDown move the selection, Shift/Cmd-click or Space toggles bulk selection, Delete deletes the selected custom part(s) (with confirm), a distinct focus indicator.
- Actual: End/PageDown only scroll the container (focused row ATMEGA8A-MU scrolls out of view, selection unchanged); no multi-select gesture exists in table view — the checkbox column only appears after 'Select All'; Delete does nothing. Rows have no role/aria-selected (screen readers get plain text). focus-visible uses the same bg as hover (#… surface-hover), so the keyboard row is indistinguishable from the mouse-hover row. Reaching the table by Tab requires tabbing through every facet checkbox (~40 stops). Light: the keyboard-selected row (ATMEGA8A-MU after 2× ArrowDown) is #e6e6e9 = --surface-hover, i.e. focus-visible overrides the selected fill (#e2e2e5) and is pixel-identical to a mouse-hovered row. Focus is not restored after returning from the detail page: Enter opens the part, Back → document.activeElement = BODY (selection kept); same after opening a Grid card and Back — keyboard users must Tab through ~40 facet checkboxes again. Selection model also differs by view: Grid shows a checkbox on every custom card at all times (45 of 60 cards), Table only shows the checkbox column after Select All.
- Screenshots: [025-keyboard-focus-row](../evidence/shots/q6/dark/025-keyboard-focus-row.png), [008-keyboard-nav](../evidence/shots/q6/dark/008-keyboard-nav.png), [006-keyboard-row](../evidence/shots/q6/light/006-keyboard-row.png), [003-grid](../evidence/shots/q6/light/003-grid.png)
- Console: `after End: activeElement still 'ATMEGA8A-MU', table scrolled to QA-Q6-bulk-40`
- Pixel probes: {"file": "shots/q6/light/006-keyboard-row.png", "x": 700, "y": 158, "hex": "#e6e6e9", "nearestToken": "--surface-hover", "deltaE": 0.0}; {"file": "shots/q6/light/006-keyboard-row.png", "x": 700, "y": 300, "hex": "#e6e6e9", "nearestToken": "--surface-hover", "deltaE": 0.0}
- Code: `src/modules/library/frontend/components/LibraryTable.tsx:113` — handleKeyDown handles only ArrowUp/ArrowDown/Enter
- Code: `src/modules/library/frontend/components/LibraryTable.tsx:182` — focus-visible:bg-surface-hover (same as hover)
- Code: `src/modules/library/frontend/Space.tsx:221` — selectionMode only when selectedIds.size>0 — no way to start it from a row
- Suggested fix: Give the table role=grid/rows role=row + aria-selected; handle Home/End/PageUp/PageDown in handleKeyDown; add Space/Cmd-click to toggle bulk selection and Shift-click ranges; Delete/Backspace → deleteComponents for custom rows; use an inset 1px selection outline for focus-visible; add a skip target (e.g. ArrowDown from the search box focuses the first row).
- Verification (vq6): **confirmed** — Reproduced: click AMS1117 row, ArrowDown ×2 selects+focuses ATMEGA8A-MU; End/PageDown only scroll (focused row top -354 px, selection unchanged); rows have role=null/aria-selected=null; no multi-select gesture in table view; Back from detail leaves activeElement=BODY. Light pixel probe: keyboard-focused selected row #e6e6e9 and the mouse-hovered row #e6e6e9 are identical (--surface-hover, ΔE 0). Code LibraryTable.tsx:113-131 handles only ArrowUp/ArrowDown/Enter; :182 focus-visible:bg-surface-hover. S3 kept. · evidence: [008-keyboard-focus-vs-hover](../evidence/shots/vq6/light/008-keyboard-focus-vs-hover.png), after End/PageDown activeElement still 'ATMEGA8A-MU', rect.top=-354, probe 700,158 #e6e6e9 --surface-hover; 700,300 (hovered) #e6e6e9

</details>


## T-263

**Every search keystroke / facet toggle blanks the table to 'Loading components...' and remounts the preview canvases (2× TypeError each time)**

- Severity **S3** · category console · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L1 · wave W2 · scope frontend · estimate S
- Findings: Q6-011

**Summary.** All rows unmount and 'Loading components...' text replaces the table on every debounced query/filter change (observer: 'loading' + 'norows' recorded), causing a visible flash and scroll reset. When the selected row leaves/re-enters the result set the preview pane unmounts/remounts both R3F canvases; each remount logs 2× 'TypeError: Cannot read properties of null (reading \'addEventListener\') at Object.connect … onC…

**Root cause.** `src/modules/library/frontend/Space.tsx:724` — loading replaces the list

**Proposed fix.** Keep previous rows while refetching (stale-while-revalidate); don't remount preview canvases. — Detail: Keep rendering the previous `components` while loading (show a thin progress bar in the chip row instead); keep the preview pane on the last part until a new one is chosen. In @openpcb/r3f-eda-canvas guard events.connect when the event source element is gone (or pass eventSource explicitly).

**Evidence.** [023-search-lm358](../evidence/shots/q6/dark/023-search-lm358.png)

<details><summary>Q6-011 — Every search keystroke / facet toggle blanks the table to 'Loading components...' and remounts the preview canvases (2× TypeError each time) (S3, confirmed)</summary>

- Area library.browse · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, Library table with a row selected
  2. Install a MutationObserver (or watch closely) and type 'capa' in search / toggle any facet
  3. Check console
- Expected: Previous rows stay visible (dimmed) while the refetch runs; preview pane keeps its canvases; no console errors.
- Actual: All rows unmount and 'Loading components...' text replaces the table on every debounced query/filter change (observer: 'loading' + 'norows' recorded), causing a visible flash and scroll reset. When the selected row leaves/re-enters the result set the preview pane unmounts/remounts both R3F canvases; each remount logs 2× 'TypeError: Cannot read properties of null (reading \'addEventListener\') at Object.connect … onCreated' followed by 'THREE.WebGLRenderer: Context Lost'.
- Screenshots: [023-search-lm358](../evidence/shots/q6/dark/023-search-lm358.png)
- Console: `TypeError: Cannot read properties of null (reading 'addEventListener') at Object.connect (@react-three/fiber) at onCreated — ×2 per preview remount`; `[LOG] THREE.WebGLRenderer: Context Lost. ×2`; `light: 2× TypeError: Cannot read properties of null (reading 'addEventListener') after typing/clearing 'zzqx-nomatch'`
- Code: `src/modules/library/frontend/Space.tsx:724` — loading replaces the list
- Code: `src/modules/library/frontend/Space.tsx:543` — selection dropped when row leaves result set → preview canvases unmount
- Code: `node_modules/@openpcb/r3f-eda-canvas/dist/interaction/EdaCanvas.js:60` — onCreated → events.connect on a null target during remount
- Suggested fix: Keep rendering the previous `components` while loading (show a thin progress bar in the chip row instead); keep the preview pane on the last part until a new one is chosen. In @openpcb/r3f-eda-canvas guard events.connect when the event source element is gone (or pass eventSource explicitly).
- Verification (vq6): **confirmed** — Reproduced: MutationObserver while typing 'capa' recorded ['loading/rows=0','/rows=3'] — every refetch unmounts all rows behind 'Loading components...'. Typing a no-match query and clearing it (selected row leaves/re-enters the set) added 2 more 'TypeError: Cannot read properties of null (reading 'addEventListener') at Object.connect … onCreated' and 2 'THREE.WebGLRenderer: Context Lost' logs. Code Space.tsx:723-727 (loading replaces list) and :543-549 (selection dropped → preview canvases unmount). Note: the TypeError itself is the same R3F onCreated race already verified as Q7-028 (stack is R3F's internal Canvas onCreated, not EdaCanvas.js); this finding's distinct defect is the list flash/remount. S3 kept. · evidence: __lf=['loading/rows=0','/rows=3'] while typing 'capa', console: addEventListener TypeError count 4 → 6, Context Lost 6 after one clear

</details>


## T-264

**Preview 'No symbol/footprint preview' and 'Loading preview…' overlays use un-generated slate classes → bright button-like outline boxes**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner F0a · wave F0a · scope shared-package · estimate S
- Findings: Q6-012

**Summary.** 'No symbol preview' / 'No footprint preview' render as rounded boxes with a bright #c4c4c9 1px outline on a #131313 canvas — they look like buttons. Cause: the overlay classes (border-slate-700/60, bg-slate-900/55, text-slate-300, rounded-md; loading overlay bg-slate-900 + slate spinner; error boundary red-800/red-950) live in @openpcb/r3f-eda-canvas, which Tailwind does not scan, so the border colour falls back to…

**Root cause.** `node_modules/@openpcb/r3f-eda-canvas/dist/preview/PreviewCanvasShell.js:35` — EmptyStateOverlay: border-slate-700/60 bg-slate-900/55 text-slate-300 (alpha variants not generated)

**Proposed fix.** Add @source for node_modules/@openpcb/r3f-eda-canvas/dist in index.css so package overlay classes generate; follow-up: package should not depend on host Tailwind. — Detail: In @openpcb/r3f-eda-canvas replace slate/red palette classes with semantic token classes (text-text-tertiary, no box; status-danger for errors) and default backgroundColor to var(--surface-canvas-well); meanwhile add `@source "../../../../node_modules/@openpcb/r3f-eda-canvas/dist"` in index.css so its classes are generated. Show a Retry link in the preview pane on detail errors.

**Evidence.** [031-preview-detail-500](../evidence/shots/q6/dark/031-preview-detail-500.png), [008-preview-detail-500](../evidence/shots/vq6/dark/008-preview-detail-500.png)

<details><summary>Q6-012 — Preview 'No symbol/footprint preview' and 'Loading preview…' overlays use un-generated slate classes → bright button-like outline boxes (S3, confirmed)</summary>

- Area library.browse · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, Library table
  2. route '**/api/modules/library/components/*/detail' → 500 (or select any part whose detail has no preview)
  3. Select 'Generic Diode'
  4. Pixel-probe the empty-state boxes
- Expected: Muted text on the canvas well (text-tertiary, no box) matching the kit empty states; loading/error overlays on tokens.
- Actual: 'No symbol preview' / 'No footprint preview' render as rounded boxes with a bright #c4c4c9 1px outline on a #131313 canvas — they look like buttons. Cause: the overlay classes (border-slate-700/60, bg-slate-900/55, text-slate-300, rounded-md; loading overlay bg-slate-900 + slate spinner; error boundary red-800/red-950) live in @openpcb/r3f-eda-canvas, which Tailwind does not scan, so the border colour falls back to currentColor. Preview canvases are also hardcoded #131313 (not --surface-canvas-well #08090a / schematic well #101012). The preview pane error itself is a bare 'Internal error' line with header 'Component' and no retry.
- Screenshots: [031-preview-detail-500](../evidence/shots/q6/dark/031-preview-detail-500.png), [034-preview-detail-500](../evidence/shots/q6/light/034-preview-detail-500.png)
- Network: `GET /components/*/detail → 500 (injected)`
- Pixel probes: {"file": "shots/q6/dark/031-preview-detail-500.png", "x": 1096, "y": 143, "hex": "#c4c4c9", "nearestToken": "(slate-300 remap / currentColor)", "deltaE": 0}; {"file": "shots/q6/dark/031-preview-detail-500.png", "x": 1080, "y": 100, "hex": "#131313", "nearestToken": "--surface-panel", "deltaE": 1.4}
- Code: `node_modules/@openpcb/r3f-eda-canvas/dist/preview/PreviewCanvasShell.js:35` — EmptyStateOverlay: border-slate-700/60 bg-slate-900/55 text-slate-300 (alpha variants not generated)
- Code: `node_modules/@openpcb/r3f-eda-canvas/dist/preview/PreviewCanvasShell.js:32` — CanvasLoadingOverlay 'Loading preview...' bg-slate-900 + slate spinner
- Code: `src/core/frontend/src/index.css:3` — @source covers ../../../modules and ../../../shared only
- Code: `src/modules/library/frontend/components/LibraryPreviewPane.tsx:138` — preview error rendered as bare text, no retry
- Suggested fix: In @openpcb/r3f-eda-canvas replace slate/red palette classes with semantic token classes (text-text-tertiary, no box; status-danger for errors) and default backgroundColor to var(--surface-canvas-well); meanwhile add `@source "../../../../node_modules/@openpcb/r3f-eda-canvas/dist"` in index.css so its classes are generated. Show a Retry link in the preview pane on detail errors.
- Verification (vq6): **confirmed** — Reproduced (route …/components/*/detail → 500, select Generic Diode): the 'No symbol preview' box has classes 'rounded-md border border-slate-700/60 bg-slate-900/55 text-slate-300' but computed border = rgb(196,196,201) (currentColor, the slate-300 remap) and background transparent — the /60 and /55 alpha variants are not generated because @openpcb/r3f-eda-canvas is outside the Tailwind @source list (index.css:3-4). Pixel: border #c4c4c9 on #131313 well. Preview pane error is a bare 'Internal error' line under header 'Component', no retry. Correction: the #131313 well colour itself is the package's PREVIEW default and part of the deferred canvas-palette work (PLAN §0 non-goal / §9), so only the unrendered overlay classes + no-retry error are counted here. Code refs corrected to dist paths. S3 kept. · evidence: [008-preview-detail-500](../evidence/shots/vq6/dark/008-preview-detail-500.png), computed: border rgb(196,196,201) 1px, bg rgba(0,0,0,0) on overlay div, probe 1150,129 #c4c4c9; 1150,100 #131313

</details>


## T-265

**Facet options reorder and vanish as you tick them (sorted by live counts), so the next click lands on a different option**

- Severity **S3** · category bug · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L1 · wave W2 · scope frontend · estimate S
- Findings: Q6-032

**Summary.** After ticking, 'OpenPCB Core Library' jumps to the top and 'User' disappears; Family re-sorts to connector 4, ic 4, diode 3, passive 3, transistor 3, bjt 2 — the row under the pointer changes after each click. The header also reads '4 parts · 2 sources' while only one source is selected (it counts facet options, not sources in the result).

**Root cause.** `src/modules/library/backend/queries.ts:1829` — facet options sorted by count desc on every request

**Proposed fix.** Stable facet option order (alphabetical, counts don't reorder); keep checked options visible. — Detail: Keep a stable sort (alphabetical, or the unfiltered order captured on first render) and keep checked + zero-count options visible (disabled); compute the header 'sources' from the result rows.

**Evidence.** [002-library-table-start](../evidence/shots/q6/light/002-library-table-start.png)

<details><summary>Q6-032 — Facet options reorder and vanish as you tick them (sorted by live counts), so the next click lands on a different option (S3, confirmed)</summary>

- Area library.browse · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, Library, no filters: Source order is Local Library 47 / OpenPCB Core Library 17 / User 3; Family order passive, ic, connector, diode, transistor, bjt
  2. Tick Family › ic
  3. Tick Source › OpenPCB Core Library
- Expected: Stable option order while a facet session is active (checked options pinned, zero-count options kept but disabled), so users can tick several options in a row.
- Actual: After ticking, 'OpenPCB Core Library' jumps to the top and 'User' disappears; Family re-sorts to connector 4, ic 4, diode 3, passive 3, transistor 3, bjt 2 — the row under the pointer changes after each click. The header also reads '4 parts · 2 sources' while only one source is selected (it counts facet options, not sources in the result).
- Screenshots: [002-library-table-start](../evidence/shots/q6/light/002-library-table-start.png), [004-facets-chips](../evidence/shots/q6/light/004-facets-chips.png)
- Code: `src/modules/library/backend/queries.ts:1829` — facet options sorted by count desc on every request
- Code: `src/modules/library/frontend/components/FacetSidebar.tsx:172` — zero-count styling exists but zero options are dropped upstream
- Code: `src/modules/library/frontend/Space.tsx:565` — sourceCount = facets.source.length
- Suggested fix: Keep a stable sort (alphabetical, or the unfiltered order captured on first render) and keep checked + zero-count options visible (disabled); compute the header 'sources' from the result rows.
- Verification (vq6): **confirmed** — Confirmed via the facets API the UI renders: unfiltered Source [Local Library 48, OpenPCB Core Library 17, User 3]; with tags=ic 'User' disappears ([Local 4, Core 4]); with ic + source:openpcb.core Family re-sorts to connector 4, ic 4, diode 3, passive 3… (queries.ts:1829 sorts by count desc on every request; zero-count options are dropped). Header shows '2 sources' with one source selected (Space.tsx:565 = facets.source.length). S3 kept. · evidence: GET /facets?tags=ic → source [Local Library 4, OpenPCB Core Library 4], GET /facets?tags=ic,source:openpcb.core → family [connector 4, ic 4, diode 3, passive 3, …]

</details>


## T-266

**Library table/preview use 9.5px source badges and near-invisible facet counts (text-disabled, ≈1.9:1 contrast)**

- Severity **S3** · category a11y · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L1 · wave W2 · scope frontend · estimate XS
- Findings: Q6-033 · known ref K36

**Summary.** Census: 29 row SOURCE badges ('core', 'user', 'kicad') + the preview-pane header badge render at 9.5px (K36 confirmed for LibraryTable.tsx:227 and LibraryPreviewPane.tsx:95). Facet counts use --text-disabled: #b4b4b9 on #f7f7f8 = 1.93:1 (light), #505055 on #111113 = 2.35:1 (dark). SOURCE text #8e8e95 on #f2f2f3 = 2.9:1 (light). '60 of 67' #94949a on #f2f2f3 = 2.7:1. Tag suggestion count #b1b1b6 on #e2e2e5 = 1.65:1.

**Root cause.** `src/modules/library/frontend/components/LibraryTable.tsx:227` — text-[9.5px] source badge

**Proposed fix.** Source badges ≥10px; facet counts text-tertiary. — Detail: Use text-2xs (10px) for the badges and text-text-tertiary for facet/suggestion counts and the 'N of M' strip.

**Evidence.** [002-library-table-start](../evidence/shots/q6/light/002-library-table-start.png), [001-library-table](../evidence/shots/vq6/light/001-library-table.png)

<details><summary>Q6-033 — Library table/preview use 9.5px source badges and near-invisible facet counts (text-disabled, ≈1.9:1 contrast) (S3, confirmed)</summary>

- Area library.browse · stack B · design None · themes dark, light · viewports 1440x900, 1100x720
- Repro:
  1. Stack B, Library Table view
  2. Run DOM census; pixel-probe the facet counts, SOURCE column and the tag-suggestion count in Edit mode
- Expected: Text ≥10px; informational numbers at ≥4.5:1 (or ≥3:1 for large/secondary) using text-tertiary/secondary tokens — disabled grey only for disabled items.
- Actual: Census: 29 row SOURCE badges ('core', 'user', 'kicad') + the preview-pane header badge render at 9.5px (K36 confirmed for LibraryTable.tsx:227 and LibraryPreviewPane.tsx:95). Facet counts use --text-disabled: #b4b4b9 on #f7f7f8 = 1.93:1 (light), #505055 on #111113 = 2.35:1 (dark). SOURCE text #8e8e95 on #f2f2f3 = 2.9:1 (light). '60 of 67' #94949a on #f2f2f3 = 2.7:1. Tag suggestion count #b1b1b6 on #e2e2e5 = 1.65:1.
- Screenshots: [002-library-table-start](../evidence/shots/q6/light/002-library-table-start.png), [050-library-table-start](../evidence/shots/q6/dark/050-library-table-start.png), [012-tag-suggestions](../evidence/shots/q6/light/012-tag-suggestions.png)
- Pixel probes: {"file": "shots/q6/light/002-library-table-start.png", "x": 285, "y": 71, "hex": "#b4b4b9", "nearestToken": "--text-disabled", "deltaE": 2.0}; {"file": "shots/q6/dark/050-library-table-start.png", "x": 285, "y": 71, "hex": "#505055", "nearestToken": "--text-disabled", "deltaE": 1.0}; {"file": "shots/q6/light/012-tag-suggestions.png", "x": 1388, "y": 297, "hex": "#b1b1b6", "nearestToken": "--text-disabled", "deltaE": 2.5}
- Census: `census/library-table-light-1100.json`
- Code: `src/modules/library/frontend/components/LibraryTable.tsx:227` — text-[9.5px] source badge
- Code: `src/modules/library/frontend/components/LibraryPreviewPane.tsx:95` — text-[9.5px] source badge
- Code: `src/modules/library/frontend/components/FacetSidebar.tsx:174` — counts use text-text-disabled
- Suggested fix: Use text-2xs (10px) for the badges and text-text-tertiary for facet/suggestion counts and the 'N of M' strip.
- Verification (vq6): **confirmed** — Confirmed: LibraryTable.tsx:227 and LibraryPreviewPane.tsx:95 use text-[9.5px] (K36). Contrast from fresh screenshots: facet count #b2b2b7 on #f7f7f8 = 1.97:1 (light), ≈2.2:1 in dark (#4c4c51 AA on #111113; token #55555a); SOURCE 'CORE' #8e8e95 on #e2e2e5 = 2.5:1; '60 of 68' #8d8d94 on #f2f2f3 = 2.95:1. FacetSidebar.tsx:173-174 uses text-text-disabled for live counts. Overlaps the cross-cutting sub-10px item Q11-014 (raw) for the badge part only. S3 kept. · evidence: [001-library-table](../evidence/shots/vq6/light/001-library-table.png), [008-preview-detail-500](../evidence/shots/vq6/dark/008-preview-detail-500.png), light: facet 1.97:1, SOURCE 2.52:1, strip 2.95:1

</details>


## T-267

**Library notice toast sits on top of the header actions (Import library…, New part) for 5 s and uses a drop shadow**

- Severity **S3** · category visual · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L1 · wave W2 · scope frontend · estimate XS
- Findings: Q6-035
- Depends on: ['T-004']

**Summary.** The notice is fixed at top:12px/right:12px, z-50, directly over 'Import library…' and 'New part' (only the right edge of the buttons remains visible), so the user can't retry the import until it auto-dismisses; it carries shadow-lg (gradient #d9d9da→#e8e8e8 below the box in light). The error notice duplicates the inline list error ('ZIP import failed / file must have a .zip extension' + red line in the table).

**Root cause.** `src/modules/library/frontend/Space.tsx:131` — fixed right-3 top-3 z-50 … shadow-lg

**Proposed fix.** Library notices -> kit Toast below header (no shadow); import warnings persist until dismissed. — Detail: Move the viewport to top-[46px] (below the header) or bottom-right, drop shadow-lg for a 1px border, and don't duplicate the error inline + toast (see Q6-003).

**Evidence.** [027-import-sample-txt](../evidence/shots/q6/light/027-import-sample-txt.png), [016-import-sample-txt](../evidence/shots/vq6/dark/016-import-sample-txt.png)

<details><summary>Q6-035 — Library notice toast sits on top of the header actions (Import library…, New part) for 5 s and uses a drop shadow (S3, confirmed)</summary>

- Area library.browse · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, Library → Import library… → choose fixtures/sample.txt (or any import)
  2. Look at the top-right header while the notice is shown
- Expected: Notices don't cover primary controls (anchor below the 34px header or bottom-right) and follow the flat, shadow-less kit.
- Actual: The notice is fixed at top:12px/right:12px, z-50, directly over 'Import library…' and 'New part' (only the right edge of the buttons remains visible), so the user can't retry the import until it auto-dismisses; it carries shadow-lg (gradient #d9d9da→#e8e8e8 below the box in light). The error notice duplicates the inline list error ('ZIP import failed / file must have a .zip extension' + red line in the table).
- Screenshots: [027-import-sample-txt](../evidence/shots/q6/light/027-import-sample-txt.png), [051-import-sample-txt](../evidence/shots/q6/dark/051-import-sample-txt.png)
- Pixel probes: {"file": "shots/q6/light/027-import-sample-txt.png", "x": 1243, "y": 38, "hex": "#c2402f", "nearestToken": "--status-danger", "deltaE": 0.0}; {"file": "shots/q6/light/027-import-sample-txt.png", "x": 1300, "y": 62, "hex": "#ddddde", "nearestToken": "--divider", "deltaE": 1.0}
- Code: `src/modules/library/frontend/Space.tsx:131` — fixed right-3 top-3 z-50 … shadow-lg
- Suggested fix: Move the viewport to top-[46px] (below the header) or bottom-right, drop shadow-lg for a 1px border, and don't duplicate the error inline + toast (see Q6-003).
- Verification (vq6): **confirmed** — Reproduced in both themes: the notice box sits at (1243,12) 185×49 over 'Import library…' (x 1219) and 'New part'; computed box-shadow includes rgba(0,0,0,.1) 0 10px 15px -3px (shadow-lg); the same error is duplicated as the inline list line (Q6-003). Correction: the notice has a × dismiss button, so the header buttons are reachable after dismissing — not blocked for the full 5 s. S3 kept. · evidence: [016-import-sample-txt](../evidence/shots/vq6/dark/016-import-sample-txt.png), [007-import-notice-covers-header](../evidence/shots/vq6/light/007-import-notice-covers-header.png), boxShadow … rgba(0,0,0,0.1) 0px 10px 15px -3px, rgba(0,0,0,0.1) 0px 4px 6px -4px

</details>


## T-268

**R3F 'Cannot read properties of null (reading addEventListener)' thrown when the wizard closes after import**

- Severity **S3** · category console · status confirmed · themes light
- Recommendation **fix-now** · owner L2 · wave W3 · scope frontend · estimate S
- Findings: Q7-028

**Summary.** Two uncaught 'TypeError: Cannot read properties of null (reading 'addEventListener') at Object.connect … at onCreated' (R3F events.connect on a canvas whose DOM target is gone) at the moment the wizard unmounted and the list/preview canvases mounted (t=363.9 s). UI kept working.

**Root cause.** `node_modules/@react-three/fiber/dist/react-three-fiber.esm.js:86` — Canvas onCreated calls state.events.connect(divRef.current) - divRef is null when the Canvas unmounted before creation finished (fast wizard -> list/preview canvas swap)

**Proposed fix.** Defer preview canvas unmount after wizard close (startTransition/keyed settle). — Detail: Avoid mounting/unmounting preview EdaCanvases in the same tick as the wizard teardown (key the preview pane on a settled selection or defer with startTransition), and/or upgrade @react-three/fiber past the guard-less connect; wrap preview canvases in an error boundary (K01).

**Evidence.** `console: [363901ms] TypeError: Cannot read properties of null (reading 'addEventListener') at Object.connect (chunk-3VGA43YQ.js:10469) at onCreated…`

<details><summary>Q7-028 — R3F 'Cannot read properties of null (reading addEventListener)' thrown when the wizard closes after import (S3, confirmed)</summary>

- Area library.browse · stack B · design None · themes light · viewports 1440x900
- Repro:
  1. Light theme, Library → New part → Draw symbol → Footprints Preset QFN-16 → 3D minimal.step → Metadata name → Import component
  2. Watch console
- Expected: No uncaught errors.
- Actual: Two uncaught 'TypeError: Cannot read properties of null (reading 'addEventListener') at Object.connect … at onCreated' (R3F events.connect on a canvas whose DOM target is gone) at the moment the wizard unmounted and the list/preview canvases mounted (t=363.9 s). UI kept working.
- Console: `[363901ms] TypeError: Cannot read properties of null (reading 'addEventListener') at Object.connect (chunk-3VGA43YQ.js:10469) at onCreated (…:10693)`; `[363904ms] same`
- Code: `node_modules/@react-three/fiber/dist/react-three-fiber.esm.js:86` — Canvas onCreated calls state.events.connect(divRef.current) - divRef is null when the Canvas unmounted before creation finished (fast wizard -> list/preview canvas swap)
- Suggested fix: Avoid mounting/unmounting preview EdaCanvases in the same tick as the wizard teardown (key the preview pane on a settled selection or defer with startTransition), and/or upgrade @react-three/fiber past the guard-less connect; wrap preview canvases in an error boundary (K01).
- Verification (vq7): **confirmed** — Intermittent. My own light import (drawn + QFN-16 preset + minimal.step) produced no error, but the identical TypeError stack (Object.connect <- onCreated) appears three times in stack-B console logs: q7's session at 84.9 s and 363.9 s and another stack-B session at 593.6 s. Stack shows R3F's internal Canvas onCreated, not EdaCanvas.js:64 as cited, so codeRef corrected. S3 kept (uncaught error, UI keeps working). · evidence: .playwright-cli/console-2026-09-25T10-45-20-604Z.log (L6, L17), .playwright-cli/console-2026-09-25T12-11-59-223Z.log (593600ms)

</details>


## T-269

**Preview pane keeps showing the previously selected part while the new selection loads, and Open/actions then target a different part than the one displayed**

- Severity **S4** · category data · status confirmed · themes dark, light
- Recommendation **fix-now** · owner L1 · wave W2 · scope frontend · estimate XS
- Findings: F1C-016

**Summary.** The Capacitor row is highlighted, but the pane header, Name, Description, Footprints (SOIC-14), Pins (14) and Specs, plus both symbol and footprint previews, still describe '74HC00 Quad NAND SOIC-14'. The only hint is a small 'Loading component detail…' line. 'Open' and the '···' menu act on the selected id (Capacitor) while displaying 74HC00. On localhost the window is short, but it grows with slow disks or large d…

**Root cause.** `src/modules/library/frontend/hooks/useComponentDetail.ts:58` — setLoading(true) on componentId change without clearing detail → stale payload rendered

**Proposed fix.** Clear preview when selection changes; actions target the displayed id. — Detail: In useComponentDetail, clear the detail (setDetail(null)) when componentId changes, or store {id, detail} and ignore a detail whose id !== componentId. Have LibraryPreviewPane render the header from the list row (name, source) while the detail loads.

**Evidence.** [059-preview-pane-loading](../evidence/shots/f1c/dark/059-preview-pane-loading.png), [018-preview-stale-while-loading](../evidence/shots/vf1c/dark/018-preview-stale-while-loading.png)

<details><summary>F1C-016 — Preview pane keeps showing the previously selected part while the new selection loads, and Open/actions then target a different part than the one displayed (S4, confirmed)</summary>

- Area library.browse · stack B · design None · themes dark, light · viewports 1440x900
- Repro:
  1. Stack B, Library table with 74HC00 (the first row) previewed
  2. Shim every GET /api/modules/library/* with a 2.5 s delay (f1c/fetchshim.js mode 'delay')
  3. Click the 'Capacitor' row and look at the preview pane at 0.7 s
- Expected: Once a new row is selected, the pane shows that part's name immediately, from the list row data, with a skeleton for the detail-only sections. It never shows another part's pins, footprints or previews.
- Actual: The Capacitor row is highlighted, but the pane header, Name, Description, Footprints (SOIC-14), Pins (14) and Specs, plus both symbol and footprint previews, still describe '74HC00 Quad NAND SOIC-14'. The only hint is a small 'Loading component detail…' line. 'Open' and the '···' menu act on the selected id (Capacitor) while displaying 74HC00. On localhost the window is short, but it grows with slow disks or large detail payloads. Light run, no previous detail loaded yet: the header reads 'Loading...' but both wells say 'No symbol preview' / 'No footprint preview' (a claim that nothing exists) while the data is still loading, and 'Open' is enabled.
- Screenshots: [059-preview-pane-loading](../evidence/shots/f1c/dark/059-preview-pane-loading.png), [016-preview-stale-while-loading](../evidence/shots/f1c/light/016-preview-stale-while-loading.png)
- Code: `src/modules/library/frontend/hooks/useComponentDetail.ts:58` — setLoading(true) on componentId change without clearing detail → stale payload rendered
- Code: `src/modules/library/frontend/components/LibraryPreviewPane.tsx:67` — component = detail?.component used for header/body regardless of componentId
- Suggested fix: In useComponentDetail, clear the detail (setDetail(null)) when componentId changes, or store {id, detail} and ignore a detail whose id !== componentId. Have LibraryPreviewPane render the header from the list row (name, source) while the detail loads.
- Verification (vf1c): **confirmed** — Reproduced under the 2.5 s delay shim (vf1c-dark). With 74HC00 selected in the table, the preview pane still showed 'Capacitor' with 'Loading component detail…'. Code: useComponentDetail (:56-58) sets loading without clearing detail, and LibraryPreviewPane (:67) renders detail.component regardless of componentId. Recalibrated S3 -> S4. On the real local backend the stale window is about 24 ms (observer: [0,'74HC00…'] -> [24,'Capacitor']). The Electron backend is always local, so users essentially never see it and can't act on the wrong part in that window. It is latent until detail payloads get large. Fix is still XS. · evidence: [018-preview-stale-while-loading](../evidence/shots/vf1c/dark/018-preview-stale-while-loading.png), real-stack header switch after row click: 24 ms

</details>

