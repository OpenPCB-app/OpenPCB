# NEXT_STEPS

## Mission

Deliver a clean, low-risk component workflow in the next 1–2 weeks with these locked product decisions:

- **Create/import stays in `ComponentWizard`**
- **Opening an existing component shows a read-only `ComponentDetailPage`**
- **Clicking `Edit` opens a full-page rich editor route**
- **That editor is for existing components only**
- **Save/Cancel/Back from editor returns to the same component detail page**
- **Edit scope includes**:
  - symbol editing
  - footprint/variant editing
  - current metadata fields (`displayLabel`, `description`, `categoryPath`, `tags`)
- **Delete policy is hard-block-if-used**
- **Delete UI should be disabled when used, with usage list shown**
- **Cleanup should be aggressive; remove dead/duplicate paths immediately**

---

## Why this plan

This direction fits the current codebase best:

- `ComponentWizard` already works as create/import flow and has dedicated tests.
- `ComponentDetailPage` is already the active runtime inspect surface.
- `ComponentEditor` already contains the rich edit stack needed for symbol + variants + footprint + metadata.
- The highest-value change is **rewiring and simplifying active paths**, not inventing new editing machinery.
- Current delete behavior is unsafe/inconsistent because used components can still be force-deleted, leaving unresolved design references.

This plan therefore optimizes for:
- **minimum architectural churn**
- **maximum reuse of existing rich editor**
- **fewer active UX paths**
- **harder safety around delete**
- **faster testable delivery**

---

## Current validated state

### Active runtime flows today
- `LibraryScreen` is the real hub.
- `New` opens `ComponentWizard`.
- `Import` opens `UnifiedImportModal`.
- Clicking a component opens `ComponentDetailPage`.
- `ComponentDetailPage` is active, but mixes read-only preview with shallow inline metadata editing.
- `ComponentEditor` exists and is tested, but is **not routed**.

### Current problems
1. **Edit path split**
   - detail page has inline edit mode
   - editor component exists separately
   - only one is wired
   - result: duplicated edit concepts

2. **Delete policy drift**
   - frontend currently allows force delete of used components
   - backend supports `?force=true`
   - bulk delete also supports `forceUsed`
   - prior roadmap/docs say delete should be blocked if used

3. **Usage tracking split**
   - effective delete-impact uses `design_sheet.content` scan
   - stale `componentUsage` write path still exists in repository
   - two mental models, one real, one mostly dead

4. **Library delete UX is mismatched to target policy**
   - per-card delete hover action cannot cheaply know usage state up front
   - bulk delete currently has a second “delete including used” branch
   - both conflict with hard-block semantics

5. **Tests/E2E no longer match desired architecture**
   - current E2E assumes direct canonical editor flow after opening component
   - detail page has no dedicated tests
   - active routing + desired routing differ

---

## Target end state

### Runtime model after this phase
- `LibraryScreen`
  - browse/search/filter/select components
  - create via wizard
  - import via existing import flow
  - open detail page for any component

- `ComponentDetailPage`
  - read-only default
  - inspect symbol, variants, footprint, pins, metadata, usage
  - `Edit` opens full-page editor
  - `Delete` only enabled when unused

- `ComponentEditor`
  - edit existing component only
  - rich edit for:
    - symbol
    - variants
    - footprint per variant
    - current metadata fields
  - save persists directly to canonical component APIs
  - save/cancel/back returns to detail page

### Delete behavior after this phase
- used component cannot be deleted from supported UI
- used component cannot be deleted through supported API override
- UI shows why delete is blocked and where it is used

### Data behavior after this phase
- design references remain live-linked to library component/variant records
- save still triggers `refetchAndPropagate()` / `setComponentLibrary(...)`
- open design stays updated after canonical edits

---

## Non-goals for this phase

Do **not** do these now:

- rewrite wizard create/import flow
- add new electrical parameter model
- add datasheet/manufacturer/MPN workflows
- add revision history / snapshots / portability
- add new 3D editing flows
- redesign import architecture unless required by a broken dependency
- keep compatibility layers for dead edit/delete paths once migration is complete

---

## Execution principles

1. **One active path per responsibility**
   - create/import = wizard
   - inspect = detail page
   - edit existing = editor

2. **Delete old code quickly**
   - no temporary parallel edit surfaces
   - no force-delete compat wrappers after policy switch
   - no dead routing states left behind

3. **Preserve live update path**
   - do not regress `refetchAndPropagate()` + `setComponentLibrary(...)`
   - do not break design re-resolution from library

4. **Test each boundary**
   - routing
   - detail/read-only behavior
   - editor save/cancel
   - delete block
   - live propagation
   - Playwright final pass mandatory

---

# Phase 1 — Add explicit editor route and navigation contract

## Goal
Make edit navigation real before changing screen internals.

## Deliverables
- new navigation state for component editor
- new hash route for editor
- detail `Edit` button routes into editor
- editor returns to detail page on save/cancel/back

## Primary files

### `src-react/src/stores/navigation-store.ts`
Add a new screen and navigation function.

#### Changes
- extend `Screen` with a new value, recommended:
  - `"component-editor"`
- add:
  - `navigateToComponentEditor(componentId: string)`
- update `updateUrlHash(...)` to support editor hash
  - recommended shape: `#component-edit-<id>`
- update hash initialization logic
- update hash change listener logic
- ensure current component id is carried into editor state
- decide whether `navigateBack()` needs explicit editor handling or whether editor should navigate explicitly to detail

#### Recommended behavior
Use **explicit navigation** from editor save/cancel:
- `navigateToComponentDetail(componentId)`

Do **not** rely only on `navigateBack()` for editor exit. It is too implicit and can drift.

---

### `src-react/src/layout/ScreenRouter.tsx`
Route the new screen.

#### Changes
- import `ComponentEditor`
- add a `case "component-editor":`
- if no `currentComponentId`, fall back safely
  - recommended fallback: `LibraryScreen`

#### Result
- detail and editor become first-class distinct screens
- create stays in library/wizard, not routing into editor

---

## Acceptance criteria
- direct hash to detail works
- direct hash to editor works
- invalid editor hash falls back cleanly
- no runtime path still treats “new component” as editor route
- current component id survives detail -> editor -> detail

---

# Phase 2 — Make `ComponentDetailPage` strictly read-only

## Goal
Remove inline editing and turn detail page into a clean inspect/action surface.

## Primary file

### `src-react/src/components/library/ComponentDetailPage.tsx`

## Current issues to remove
- `isEditing`
- `editForm`
- inline metadata form
- header save/cancel branch
- inline metadata save logic
- force-delete behavior in confirm action
- inert action buttons that imply unsupported functionality

## Required changes

### A. Remove inline edit state
Delete:
- `isEditing`
- `editForm`
- `handleEditClick`
- `handleCancelEdit`
- `handleSaveEdit`

Replace:
- `Edit` button -> `navigateToComponentEditor(component.id)`

### B. Keep page read-only
Keep:
- symbol preview
- footprint preview
- variant selector
- pin table
- technical metadata
- 3D placeholder if needed as read-only display only

### C. Add usage visibility
Use the existing:
- `deleteImpactLoading`
- `deleteImpact`
- `loadDeleteImpact`

Recommended behavior:
- load delete impact when detail page loads for a component
- display usage info in action sidebar, not only inside modal
- show:
  - usage count
  - up to N design names
  - clear “in use” state

### D. Disable delete when component is used
Delete button behavior:
- enabled only if `usageCount === 0`
- disabled when used
- disabled state includes explanatory text nearby

### E. Remove or defer inert actions
Current detail page contains non-wired actions:
- `Export`
- `Duplicate`
- `Use in Design`
- `Export KiCAD Files`

Recommended for this phase:
- remove them from active UI, or
- replace with non-interactive placeholder badges only if product insists

**Recommendation: remove them now.**
They add noise and test burden.

---

## Optional modal behavior
If keeping a delete modal:
- modal should only appear for unused components
- used components should never reach destructive confirmation state

Preferred UX:
- detail page itself already explains “used in X designs”
- delete button disabled
- modal only for unused components

---

## Acceptance criteria
- opening a component never shows editable controls by default
- clicking `Edit` leaves the detail screen and opens routed editor
- no inline metadata form remains
- used component shows usage list and disabled delete
- unused component can still be deleted

---

# Phase 3 — Convert `ComponentEditor` into routed rich editor for existing components only

## Goal
Reuse the current rich editor, but remove create-mode branching and make navigation correct.

## Primary file

### `src-react/src/components/editor/ComponentEditor.tsx`

## Key rule
**Do not remove symbol / footprint / variant editing.**  
This editor is the rich existing-component editor now.

## Required changes

### A. Make component id required in active runtime
Current component supports create and edit.
This phase should make active runtime usage **edit-only**.

#### Recommended change
- require `componentId` for routed usage
- remove create-only navigation and success behavior from active path
- optionally keep internal create support only if another caller still needs it
- preferred aggressive cleanup: remove create-mode branches entirely once no caller uses them

### B. Keep these existing rich sections
Preserve:
- metadata form
- symbol editor
- variant manager
- footprint editor
- save orchestration for symbol + variants + default variant + footprint payloads
- `refetchAndPropagate()` after save

### C. Update navigation behavior
Current behavior:
- save/cancel returns to library

Required behavior:
- save existing component -> `navigateToComponentDetail(component.id)`
- cancel existing component -> `navigateToComponentDetail(component.id)`
- top-left back action -> `navigateToComponentDetail(component.id)`

### D. Keep live update feedback
Current editor already computes affected open-design symbol count and shows toast.
Keep this behavior if possible.

Recommended toast policy:
- preserve:
  - “Component updated”
  - “X instances in open designs refreshed.”
- then navigate to detail

### E. Remove create-mode branches
Likely removable pieces after wizard owns creation:
- `useComponentMutations()` create flow
- `createComponent(...)`
- `createCanonicalKey(...)`
- create button copy
- create success toast path
- logic depending on `isCreating`

### F. Tighten editor copy
Header should reflect edit mode only, e.g.:
- title = component display label or “Edit Component”
- subtitle = “Edit canonical symbol, footprints, variants, and metadata.”

No “New Component” copy should remain in active editor route if create is wizard-only.

---

## Supporting files likely touched

### `src-react/src/components/editor/ComponentEditor.test.tsx`
Refocus tests around edit-only routing behavior.

Update/add tests for:
- loads existing component
- renders symbol editor
- renders variant manager + footprint editor
- save returns to detail page
- cancel returns to detail page
- back button returns to detail page
- no create-mode assertions remain in active suite

### Optional extractions
If file size becomes awkward, extract:
- header action bar
- metadata panel
- navigation helpers

But only extract if it reduces complexity.
Do not over-abstract.

---

## Acceptance criteria
- editor is only used for existing components in active runtime
- symbol/footprint/variant editing still works
- save updates component and returns to detail
- cancel/back returns to detail without mutation
- no active create path remains in editor

---

# Phase 4 — Enforce hard delete block across frontend and backend

## Goal
Make “delete if used” impossible through supported paths.

---

## Backend changes

### `src-ts/src/transport/controllers/component-controller.ts`

#### Single delete
Current:
- checks usage impact
- allows override with `?force=true`

Required:
- remove `forceUsedDelete`
- if `impact.usageCount > 0`, always return conflict
- delete only when unused

#### Bulk delete
Current:
- accepts `forceUsed?: boolean`
- can delete used components when forced

Required:
- remove `forceUsed`
- decide final bulk behavior:
  - either skip used items and return structured result
  - or reject whole request when any selected component is used

**Recommended near-term backend behavior:**
- skip used items
- return structured blocked list
- do not delete them
- no override path

This is safer and easier to integrate with library UI than all-or-nothing server rejection.

---

### `src-ts/src/transport/router/core-router.ts`
Update route contracts.

#### Required changes
- `/api/components/:id`
  - summary should no longer imply force override exists
- `/api/components/bulk-delete`
  - remove `forceUsed` from request schema
  - update summary text to reflect hard block / skip-used semantics

---

### `src-ts/src/transport/controllers/component-controller.test.ts`
Update tests.

#### Remove
- force-delete success test

#### Add/keep
- unused delete succeeds
- used delete returns conflict
- bulk delete never deletes used components
- bulk delete returns structured blocked/used list

---

## Frontend API and hooks changes

### `src-react/src/lib/api/component-api.ts`

#### Remove
- `deleteComponentWithOptions(...)`
- `forceUsed` option plumbing
- `?force=true` query construction

#### Keep
- single delete API
- delete impact API
- bulk delete API, but without override option

#### Recommended cleanup
Rename legacy family aliases if call-sites are small:
- `bulkDeleteComponentFamilies` -> `bulkDeleteComponents`
- `deleteComponentFamily` -> `deleteComponent`

Aggressive cleanup supports this if usage count is low.

---

### `src-react/src/hooks/useComponents.ts`

#### Required changes
- remove `options?: { forceUsed?: boolean }` from delete signatures
- simplify:
  - `UseComponentMutationsReturn.deleteComponent`
  - `UseComponentDetailReturn.deleteComponent`
- keep `loadDeleteImpact()`
- keep propagation after successful delete

#### Detail hook behavior
For `useComponentDetail`:
- used component delete should surface backend conflict if UI somehow regresses
- after successful delete:
  - refresh library cache
  - clear component
  - return control to detail caller, which will navigate away

---

## Acceptance criteria
- no supported API path force-deletes a used component
- no frontend wrapper exposes force delete
- controller tests reflect permanent hard block
- delete-impact remains readable and authoritative

---

# Phase 5 — Simplify library delete UX to match hard-block policy

## Goal
Stop library UI from fighting the product rule.

## Primary file

### `src-react/src/screens/LibraryScreen.tsx`

## Current problems
- per-card delete hover action can open delete flow before known usage state
- single delete modal still permits destructive action even when used
- bulk delete has “including used” branch
- this is too much delete complexity for a phase whose main goal is clean inspect/edit flow

## Recommended optimized decision
**Make detail page the primary delete surface for this phase.**

### Why
- usage context is naturally available on detail page
- disabled delete + usage list is clear there
- library grid is better focused on browse/search/select/open
- this removes the trickiest mismatch with minimal risk

## Recommended changes

### A. Remove per-card hover delete
Delete:
- hover trash button on cards
- single delete modal state for per-card delete

### B. Decide bulk delete scope
Two viable options:

#### Option 1 — Defer bulk delete entirely this phase (**recommended**)
- remove selection checkboxes
- remove select-all
- remove bulk delete button/modal
- restore later once block policy UX is settled

**Pros**
- fastest
- least confusing
- aligns with aggressive cleanup
- focuses this phase on main path

**Cons**
- temporarily removes batch management affordance

#### Option 2 — Keep bulk delete, but block used items with no override
- preflight selected ids
- modal lists blocked used components
- confirm only deletes unused items, or disables confirm until used items are removed from selection

**Pros**
- preserves power-user function

**Cons**
- more work
- more UI state
- more test surface

### Recommendation
For this 1–2 week slice:
- **remove per-card delete**
- **prefer deferring bulk delete**
- keep delete only on detail page

If bulk delete is product-critical, implement it after detail-page delete is stable.

---

## Acceptance criteria
- library screen does not offer force delete path
- delete behavior is no more permissive in library than in detail
- library remains focused on browse/create/import/open

---

# Phase 6 — Collapse usage tracking to one real source of truth

## Goal
Remove stale usage mechanisms and make delete-impact logic explicit.

## Current state
Real behavior uses:
- `design_sheet.content` scan

Stale/unclear behavior still exists:
- `componentUsage` table
- `recordUsage(...)`
- `removeUsage(...)`

## Primary file

### `src-ts/src/db/repositories/component-repository.ts`

## Required changes

### A. Keep `getDeleteImpact(...)` as authoritative
This is the real source today.

### B. Extract reference detection into one helper
Current scan checks:
- `symbol.libraryPartId === componentId`
- `symbol.properties.component_id === componentId`
- `symbol.properties.componentId === componentId`

Extract this matching logic into one helper so future delete checks and validations do not drift.

### C. Remove stale usage write path if no callers remain
Delete after confirming zero live callers:
- `recordUsage(...)`
- `removeUsage(...)`
- `componentUsage` import usage
- stale tests built around that path

### D. Keep `getUsageCount(...)` only if still useful
If it becomes a trivial wrapper over `getDeleteImpact`, either:
- keep it intentionally, or
- remove it if unused

**Recommendation: remove if unused.**

---

## Supporting files likely touched
- `src-ts/src/db/schema/component.ts`
- `src-ts/src/db/repositories/component-repository.test.ts`
- any stale callers/tests

---

## Acceptance criteria
- one authoritative usage model remains
- repository no longer suggests a dead normalized usage write path exists
- delete-impact tests cover current symbol reference shapes

---

# Phase 7 — Cleanup dead paths and names

## Goal
After routing and delete behavior are stable, remove leftover ambiguity.

## Targets

### Read/remove dead or misleading paths
- `#component-new` behavior in navigation
- import route state if still meaningless as a screen
- inactive detail page action buttons
- dead editor create-mode branches
- dead delete modals/state in library
- family naming aliases if not needed

### Likely files
- `src-react/src/stores/navigation-store.ts`
- `src-react/src/layout/ScreenRouter.tsx`
- `src-react/src/screens/LibraryScreen.tsx`
- `src-react/src/lib/api/component-api.ts`
- `src-react/src/components/library/ComponentDetailPage.tsx`
- `src-react/src/components/editor/ComponentEditor.tsx`

### Nice-to-have cleanup
If scope allows, normalize naming away from “family” where active code already means component:
- `bulkDeleteComponentFamilies`
- `updateComponentFamily`
- `deleteComponentFamily`

Do not block main delivery on this rename if it fans out too broadly.

---

# Detailed file-by-file implementation checklist

## Frontend routing + screens
- [ ] `src-react/src/stores/navigation-store.ts`
  - [ ] add `component-editor` screen
  - [ ] add `navigateToComponentEditor(id)`
  - [ ] add editor hash parsing
  - [ ] remove/neutralize `#component-new` editor semantics
- [ ] `src-react/src/layout/ScreenRouter.tsx`
  - [ ] route `component-editor` -> `ComponentEditor`
  - [ ] preserve `component-detail` -> `ComponentDetailPage`

## Detail page
- [ ] `src-react/src/components/library/ComponentDetailPage.tsx`
  - [ ] remove inline edit mode state
  - [ ] route `Edit` into editor screen
  - [ ] load delete impact on component load
  - [ ] show usage block in read-only page
  - [ ] disable delete when used
  - [ ] simplify/remove inert actions
  - [ ] keep read-only previews and variant selection

## Editor
- [ ] `src-react/src/components/editor/ComponentEditor.tsx`
  - [ ] make routed usage edit-only
  - [ ] keep symbol/variant/footprint/metadata sections
  - [ ] save -> detail page
  - [ ] cancel -> detail page
  - [ ] back -> detail page
  - [ ] remove create-mode active usage
  - [ ] keep propagation + save toast

## Hooks + API
- [ ] `src-react/src/hooks/useComponents.ts`
  - [ ] remove force-delete options from types
  - [ ] simplify delete mutation logic
- [ ] `src-react/src/lib/api/component-api.ts`
  - [ ] delete `deleteComponentWithOptions`
  - [ ] remove `forceUsed`
  - [ ] update bulk delete contract
  - [ ] optionally rename family aliases

## Library
- [ ] `src-react/src/screens/LibraryScreen.tsx`
  - [ ] keep `New` -> wizard
  - [ ] keep `Import`
  - [ ] remove or simplify delete affordances
  - [ ] preferably defer bulk delete

## Backend
- [ ] `src-ts/src/transport/controllers/component-controller.ts`
  - [ ] remove force single delete
  - [ ] remove force bulk delete
  - [ ] keep block/skip-used semantics only
- [ ] `src-ts/src/transport/router/core-router.ts`
  - [ ] update delete route schemas/docs
  - [ ] remove `forceUsed` request schema
- [ ] `src-ts/src/db/repositories/component-repository.ts`
  - [ ] extract component reference scan helper
  - [ ] remove stale usage write path if unused

## Cleanup
- [ ] remove dead tests
- [ ] remove dead imports
- [ ] remove dead UI branches
- [ ] remove dead route states

---

# Test plan

## React/unit/integration

### Add or update tests for `ComponentDetailPage`
Recommended new file:
- `src-react/src/components/library/ComponentDetailPage.test.tsx`

Cover:
- renders read-only details
- no inline edit form
- `Edit` navigates to editor route
- usage block renders when used
- delete disabled when used
- delete enabled when unused

### Update `ComponentEditor` tests
File:
- `src-react/src/components/editor/ComponentEditor.test.tsx`

Cover:
- loads existing component
- symbol editor still renders
- variant manager still renders
- footprint editor still renders
- save returns to detail page
- cancel returns to detail page
- create-mode tests removed or relocated if still meaningful

### Update `LibraryScreen` tests
File:
- `src-react/src/screens/LibraryScreen.test.tsx`

Cover:
- `New` still opens wizard
- import still opens modal
- component click still opens detail
- if delete removed from library, update expectations accordingly

### Update `useComponents` tests
File:
- `src-react/src/hooks/useComponents.test.ts`

Cover:
- delete API no longer accepts force option
- delete-impact path still works
- propagation still happens after successful refresh

### Add navigation tests
Recommended new/updated tests:
- `src-react/src/stores/navigation-store.test.ts`
- possibly router-level screen tests

Cover:
- detail hash
- editor hash
- invalid editor fallback
- explicit navigation methods

---

## Backend tests

### `src-ts/src/transport/controllers/component-controller.test.ts`
Update to assert:
- delete unused -> success
- delete used -> conflict
- no force-delete success path
- bulk delete does not delete used components

### `src-ts/src/db/repositories/component-repository.test.ts`
Update to assert:
- `getDeleteImpact()` remains correct
- deleted/missing designs ignored
- reference scan helper catches supported symbol forms
- stale `componentUsage` assumptions removed if path is deleted

---

# Playwright verification plan

All UI changes must be verified against browser target.

## Scenario 1 — Wizard create -> detail inspect
1. open `/#library`
2. click `New`
3. create component via wizard
4. confirm creation succeeds
5. open created component detail
6. confirm detail is read-only by default

## Scenario 2 — Detail -> editor -> save -> detail
1. open existing component detail
2. click `Edit`
3. confirm full-page editor route opens
4. edit metadata
5. edit symbol
6. edit footprint/variant
7. save
8. confirm navigation back to detail page
9. confirm updated values visible

## Scenario 3 — Detail -> editor -> cancel
1. open existing component detail
2. click `Edit`
3. modify fields
4. click `Cancel`
5. confirm navigation back to detail
6. confirm no persisted changes

## Scenario 4 — Deep-link editor
1. navigate directly to editor hash for existing component
2. confirm editor loads component
3. cancel
4. confirm return to detail page for same component

## Scenario 5 — Live propagation into open design
1. create/import component
2. place component in design
3. keep design open
4. open same component in editor
5. change symbol or variant-visible data
6. save
7. confirm toast appears
8. confirm design updates without reload

## Scenario 6 — Used delete blocked
1. place component in design
2. open component detail
3. confirm usage list is shown
4. confirm delete button is disabled
5. confirm no supported path force deletes it

## Scenario 7 — Unused delete succeeds
1. open unused component detail
2. confirm delete enabled
3. delete
4. confirm return to library
5. confirm component gone

## Scenario 8 — Wizard/import non-regression
1. `New` still uses wizard, not editor
2. import modal still opens and completes
3. imported/created component remains editable via detail -> editor route

---

# Recommended command checklist after implementation

## Type and unit tests
- [ ] `npm run typecheck`
- [ ] `npm run test:ts`
- [ ] `npm run test:react`

## Focused runs during iteration
- [ ] `npx tsc -p tsconfig.base.json --noEmit`
- [ ] `cd src-react && npx vitest run src/components/editor/ComponentEditor.test.tsx`
- [ ] `cd src-react && npx vitest run src/components/library/ComponentDetailPage.test.tsx`
- [ ] `cd src-react && npx vitest run src/screens/LibraryScreen.test.tsx`
- [ ] `cd src-ts && bun test src/transport/controllers/component-controller.test.ts`
- [ ] `cd src-ts && bun test src/db/repositories/component-repository.test.ts`

## Browser verification
- [ ] `npm run dev`
- [ ] `npm run test:e2e`

---

# Risks and mitigations

## Risk 1 — editor still carries too much create-mode baggage
**Mitigation:** remove create-mode branches early once route is wired.

## Risk 2 — delete UX remains inconsistent between detail and library
**Mitigation:** prefer detail-page-only delete for this slice.

## Risk 3 — propagation regresses during editor navigation refactor
**Mitigation:** do not change `refetchAndPropagate()` behavior until routing tests and live update tests pass.

## Risk 4 — usage detection misses some symbol reference shape
**Mitigation:** centralize reference scan helper and test all supported symbol shapes.

## Risk 5 — detail page becomes cluttered
**Mitigation:** remove inert actions and keep it inspect-first.

---

# Recommended implementation order

1. `navigation-store.ts`
2. `ScreenRouter.tsx`
3. `ComponentDetailPage.tsx`
4. `ComponentEditor.tsx`
5. `useComponents.ts`
6. `component-api.ts`
7. `component-controller.ts`
8. `core-router.ts`
9. `component-repository.ts`
10. tests
11. Playwright
12. dead-code deletion sweep

---

# Definition of done

- wizard remains the only active create/import path
- opening an existing component always lands on read-only detail page
- clicking `Edit` opens full-page rich editor
- editor supports symbol + footprint/variant + current metadata editing
- save/cancel/back returns to detail page
- used components cannot be deleted through supported UI/API
- usage list is visible on detail page
- dead inline-edit / force-delete / duplicate active-path code removed
- tests updated to new architecture
- Playwright passes on browser target

---

# Remaining decisions to confirm before implementation

## 1. After wizard publish, where should user land?
Recommended options:
- **simplest:** back to library list
- **better UX:** open new component detail page

## 2. For this phase, should library bulk delete be removed entirely?
Recommended:
- **yes**, defer bulk delete and keep delete on detail page only for now
