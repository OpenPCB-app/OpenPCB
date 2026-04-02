# Component Library + Designer Integration Phased Roadmap

## TL;DR
> **Summary**: Rebuild the current component system from scratch around a workspace-only canonical library in v1. Designs store component/variant references only and always resolve the latest library state; later phases add revision history, portable snapshots, and advanced import/export.
> **Deliverables**:
> - Clean v1 live-linked component architecture (workspace scope only)
> - Unified library/editor/designer data flow for symbol + footprint + basic variants
> - Immediate design propagation on component edits with visible update feedback
> - v2/v3/v4 implementation phases for revisions, portability, and advanced interoperability
> **Effort**: XL
> **Parallel**: YES - 3 waves
> **Critical Path**: 1 → 2 → 3 → 6 → 7 → 8 → 9 → 10 → 12

## Context
### Original Request
User requested an extremely thorough review of the current component-library/designer integration, Flux.ai comparison research, and a final specification for how the component library and editor should work together. During interview, the user re-scoped implementation into multiple phases.

### Interview Summary
- Rebuild from scratch; do not migrate or preserve the current broken component implementation.
- **v1**: workspace-only scope; direct canonical editing in the library; symbol + footprint core model; basic variants supported; import supported; export deferred; no snapshots; no revisions; no 3D; no MPN/offering data.
- In v1, all component changes live-update consuming designs, including risky changes. Designs store references only and resolve the latest library state.
- Editing from a design opens the same canonical library editor. Delete is blocked if the component is in use. Visible toast/banner required when live updates affect designs.
- **v2** adds revisions/history.
- **v3** adds snapshots/portability.
- **v4** adds advanced import/export interoperability.
- TDD where practical; Playwright verification required for UI.

### Metis Review (gaps addressed)
- Defaulted `basic variants` to: one canonical component with multiple selectable concrete variant records, each carrying its own footprint and symbol/footprint resolution metadata.
- Defaulted v1 import to create canonical library items only; no merge/reconcile/dedup overwrite path in v1.
- Defaulted design reload semantics to always resolve latest library data on open, since designs store references only.
- Defaulted v1 canonical identity to stable `component_id` plus `variant_id`; symbol/footprint signatures remain import heuristics only.
- Accepted v1 no-lock policy as an explicit speed-over-safety tradeoff for early single-workspace development, to be revisited in later phases.

## Work Objectives
### Core Objective
Deliver a phased implementation roadmap where v1 establishes a single canonical workspace component library that is the live source of truth for designer/editor usage, and later phases add safety and portability without reintroducing fragmented state ownership.

### Deliverables
- New canonical backend contracts and storage model for v1 live-linked components
- New library/editor frontend flow replacing wizard/draft-first architecture
- Design runtime integration that resolves latest library component state by reference
- Live propagation and user feedback for open designs after component edits
- v1 backend/frontend/E2E verification suite
- Explicit v2/v3/v4 task breakdown for revisions, snapshots, and advanced import/export

### Definition of Done (verifiable conditions with commands)
- `npm run typecheck` passes
- `npm run test:ts` passes with new component-library backend tests
- `npm run test:react` passes with new library/editor/design integration tests
- `npm run test:e2e` passes with live-link Playwright coverage
- No legacy draft/revision-driven component wizard flow remains on active code paths for v1
- Library edits update open designs and newly loaded designs consistently using the same canonical source

### Must Have
- One canonical source of truth in v1: workspace library records
- One canonical editing path in v1: direct library editor
- One canonical runtime resolution path in v1: component/variant reference lookup
- Visible user feedback when live updates propagate into designs
- Hard delete prevention for components currently referenced by designs
- No compatibility layers keeping old broken component flows alive

### Must NOT Have (guardrails, AI slop patterns, scope boundaries)
- No embedded snapshots in v1
- No revisions/history in v1
- No team/shared/public library scope in v1
- No 3D model, MPN/offering, or approval/governance workflows in v1
- No duplicate import pipelines surviving after v1 rewrite
- No refetch-coupled pseudo-sync between separate editor stores as the final v1 architecture

## Verification Strategy
> ZERO HUMAN INTERVENTION — all verification is agent-executed.
- Test decision: TDD where practical using Bun tests + Vitest + Playwright
- QA policy: Every task has agent-executed scenarios
- Evidence: `.sisyphus/evidence/task-{N}-{slug}.{ext}`

## Execution Strategy
### Parallel Execution Waves
> Target: 5-8 tasks per wave. <3 per wave (except final) = under-splitting.
> Extract shared dependencies as Wave-1 tasks for max parallelism.

Wave 1: backend/domain reset + storage/contracts + import simplification + library data layer

Wave 2: unified editor + design runtime + live propagation

Wave 3: verification + later-phase implementation foundations (v2/v3/v4)

### Dependency Matrix (full, all tasks)
| Task | Depends On | Blocks |
|---|---|---|
| 1 | - | 2,3,4,5 |
| 2 | 1 | 3,4,9,13,14,15 |
| 3 | 1,2 | 5,6,7,8,10,11 |
| 4 | 1,2 | 5,11,15 |
| 5 | 1,3,4 | 6,9,10,12 |
| 6 | 3,5 | 7,8,10,12 |
| 7 | 3,5,6 | 8,10,12 |
| 8 | 3,5,6,7 | 9,10,12,13 |
| 9 | 2,5,8 | 10,12,14 |
| 10 | 3,5,6,7,8,9 | 12 |
| 11 | 2,3,4,6,7,8,9,10 | 12 |
| 12 | 5,6,7,8,9,10,11 | F1-F4 |
| 13 | 2,3,8 | 14,15 |
| 14 | 2,9,13 | 15 |
| 15 | 2,4,13,14 | F1-F4 |

### Agent Dispatch Summary (wave → task count → categories)
- Wave 1 → 5 tasks → deep, unspecified-high
- Wave 2 → 5 tasks → deep, visual-engineering, unspecified-high
- Wave 3 → 5 tasks → unspecified-high, deep, visual-engineering

## TODOs
> Implementation + Test = ONE task. Never separate.
> EVERY task MUST have: Agent Profile + Parallelization + QA Scenarios.

- [ ] 1. Replace legacy component contracts with v1 live-link model

  **What to do**: Remove draft-, revision-, 3D-, offering-, and built-in-scope-first assumptions from the active component contracts. Define the new v1 canonical types around `workspace` components with direct-editable symbol data, basic variants, footprint payloads, stable `component_id` + `variant_id`, and design-side reference objects only. Delete or stop exporting legacy contracts that would keep wizard/publish/revision flows alive.
  **Must NOT do**: Do not keep compatibility wrappers for draft publish, revision snapshot payloads, model-3d options, manufacturer offerings, or built-in/shared scope in v1.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: contract reset touches frontend/backend type boundaries and sets all later phase foundations.
  - Skills: `[]` — No special skill required beyond repo exploration already completed.
  - Omitted: `['git-master']` — No git operation needed during implementation.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 2,3,4,5 | Blocked By: none

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `src-ts/src/core/schemas/component-library.schema.ts:14-237` — Current monolithic contract; replace with v1-focused types and remove deferred-phase fields from active use.
  - Pattern: `src-react/src/stores/component-wizard-store.ts:16-64` — Existing frontend draft payload couples symbol/footprint/model/spec stages; use as removal target, not final pattern.
  - Pattern: `src-ts/src/transport/controllers/component-draft-controller.ts:33-181` — Current patch/publish lifecycle demonstrates the legacy draft-first flow that v1 must replace.
  - Pattern: `src-react/src/lib/api/component-api.ts:120-260` — Frontend currently exposes draft/import-oriented API shapes; update to match new v1 contracts.
  - External: `https://docs.flux.ai/reference/reference-library` — Reference inspiration for centralized library concept only; do not copy revision/update model into v1.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npx tsc -p tsconfig.base.json --noEmit` passes after contract replacement.
  - [ ] Searching active source for removed v1-excluded concepts in component runtime paths shows no remaining draft/revision-driven dependency: `rg "ComponentDraft|ComponentRevision|Model3DOption|ManufacturerOffering" src-react src-ts` returns only deferred-phase code locations or deleted-file references explained in commit diff.
  - [ ] Shared SDK/frontend API types compile against the new canonical component + variant contract.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Type system accepts the new v1 contract set
    Tool: Bash
    Steps: Run `npx tsc -p tsconfig.base.json --noEmit`
    Expected: Exit code 0; no type errors referencing removed draft/revision fields on active v1 paths
    Evidence: .sisyphus/evidence/task-1-contract-reset.txt

  Scenario: Legacy draft/revision contract usage is eliminated from active runtime code
    Tool: Bash
    Steps: Run `rg "ComponentDraft|ComponentRevision|publishComponentDraft|patchComponentDraft" src-react src-ts`
    Expected: No matches in active v1 library/designer runtime files; only deferred-phase scaffolding or deleted-history references remain
    Evidence: .sisyphus/evidence/task-1-contract-reset-grep.txt
  ```

  **Commit**: YES | Message: `refactor(components): replace legacy draft contracts` | Files: `src-ts/src/core/schemas/*`, `src-react/src/lib/api/*`, `src-react/src/stores/*`, `src-ts/shared/*`

- [ ] 2. Build v1 storage model and repositories for canonical workspace components

  **What to do**: Replace the current component persistence model with a v1 schema centered on workspace components and basic variants only. Ensure each component stores canonical symbol data plus one-or-more variant records with concrete footprint payloads and default variant selection. Add design-usage lookup support so delete operations can block when components are referenced.
  **Must NOT do**: Do not include revision tables, snapshot tables, 3D asset tables, offering tables, or scope layering for v1.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: schema/repository design sets identity, delete rules, and future extensibility.
  - Skills: `[]` — No extra skill needed.
  - Omitted: `['frontend-ui-ux']` — Pure backend/domain task.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 3,4,9,13,14,15 | Blocked By: 1

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `src-ts/src/core/schemas/component-library.schema.ts:174-237` — Current family/variant/draft/revision split; keep family+variant essence, remove deferred-phase persistence.
  - Pattern: `src-ts/src/transport/controllers/component-family-controller.ts:8-88` — Existing delete/update behavior; replace with v1 delete-block-if-used policy and full direct-editable component persistence.
  - Pattern: `src-ts/src/transport/controllers/component-family-controller.ts:90-178` — Current list/get/category endpoints show aggregation shape expected by UI.
  - API/Type: `src-react/src/components/pcb/symbol-library.ts:64-153` — Designer currently expects resolved family data to construct symbols; repository output must support a simpler but equivalent v1 runtime shape.
  - Test: `src-ts/src/db/repositories/component-family-repository.test.ts` — Existing repository test location/pattern for in-memory SQLite validation.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Repository tests cover create/read/update/delete-block/list/default-variant behavior for the new v1 schema.
  - [ ] Attempting to delete a referenced component returns a deterministic failure response.
  - [ ] The only active persistence entities for v1 component runtime are component records, variant records, and design reference usage support.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Repository enforces v1 component lifecycle
    Tool: Bash
    Steps: Run `npm run test:ts -- component-family-repository`
    Expected: Tests pass for create, update, list, default variant selection, and delete-block-if-used behavior
    Evidence: .sisyphus/evidence/task-2-storage-tests.txt

  Scenario: Delete fails when component is referenced
    Tool: Bash
    Steps: Run targeted controller/repository tests that create a design reference and then call delete
    Expected: Operation fails with explicit error/assertion; component remains readable afterward
    Evidence: .sisyphus/evidence/task-2-delete-block.txt
  ```

  **Commit**: YES | Message: `feat(components): add v1 canonical storage` | Files: `src-ts/src/db/schema/*`, `src-ts/src/db/repositories/*`, `src-ts/src/core/schemas/*`

- [ ] 3. Replace draft/publish endpoints with direct v1 component CRUD APIs

  **What to do**: Remove the active draft-first component API surface and replace it with direct component CRUD endpoints for workspace components and variants. Support list/get/create/update/delete, variant management, delete-block-if-used enforcement, and immediate persistence of canonical edits. Update router wiring and frontend API client accordingly.
  **Must NOT do**: Do not preserve publish/discard/validate draft endpoints as active v1 workflow. Do not add revision-history endpoints yet.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: multi-file backend/API refactor with clear contracts but broad call-site updates.
  - Skills: `[]` — No special skill required.
  - Omitted: `['playwright-cli']` — Not a browser task.

  **Parallelization**: Can Parallel: NO | Wave 1 | Blocks: 5,6,7,8,10,11 | Blocked By: 1,2

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `src-ts/src/transport/controllers/component-draft-controller.ts:20-181` — Entire legacy create/patch/publish lifecycle to remove or quarantine from v1.
  - Pattern: `src-ts/src/transport/controllers/component-family-controller.ts:55-178` — Existing list/get/update/delete controller structure to keep as route-shape starting point.
  - Pattern: `src-react/src/lib/api/component-api.ts:35-118` — Existing family client functions to preserve naming style while broadening direct-edit coverage.
  - Pattern: `src-react/src/lib/api/component-api.ts:203-260` — Existing draft client functions to delete/replace.
  - Test: `src-ts/src/transport/controllers/component-family-controller.test.ts` — Use as base for HTTP/controller coverage style.

  **Acceptance Criteria** (agent-executable only):
  - [ ] API tests pass for direct create/update/delete/list/get and variant edit flows.
  - [ ] No active frontend code calls `createComponentDraft`, `patchComponentDraft`, `publishComponentDraft`, or `discardComponentDraft` for v1 flows.
  - [ ] Delete endpoint returns deterministic failure when component usage exists.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Direct component CRUD works end-to-end at controller level
    Tool: Bash
    Steps: Run `npm run test:ts -- component-family-controller`
    Expected: Tests pass for create/list/get/update/delete and variant-management cases under the new v1 routes
    Evidence: .sisyphus/evidence/task-3-crud-tests.txt

  Scenario: Legacy draft endpoints are no longer used by frontend v1 paths
    Tool: Bash
    Steps: Run `rg "createComponentDraft|patchComponentDraft|publishComponentDraft|discardComponentDraft" src-react`
    Expected: No matches on active component-library/designer screens/hooks
    Evidence: .sisyphus/evidence/task-3-no-draft-api.txt
  ```

  **Commit**: YES | Message: `refactor(api): switch components to direct crud` | Files: `src-ts/src/transport/controllers/*`, `src-ts/src/transport/router/*`, `src-react/src/lib/api/*`, tests

- [ ] 4. Collapse import into one v1 create-only canonical ingestion flow

  **What to do**: Keep import in v1, but simplify it to one canonical flow that creates library components and basic variants directly from imported symbol/footprint sources. Remove duplicated import pipelines and any preview/publish/reconcile semantics that belong to later phases. Preserve enough provenance internally for later improvements, but do not expose merge/update logic yet.
  **Must NOT do**: Do not keep both direct import and ZIP-job import as active v1 paths. Do not add export, dedupe merge, or revision-aware import reconciliation in v1.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: parser plumbing exists, but orchestration and UX boundaries need consolidation.
  - Skills: `[]` — No extra skill needed.
  - Omitted: `['writing']` — This is implementation, not doc-only work.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 5,11,15 | Blocked By: 1,2

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `src-ts/src/transport/controllers/component-import-controller.ts` — Existing direct import path to simplify into v1 canonical ingestion.
  - Pattern: `src-ts/src/domain/services/component-import-service.ts` — Existing parser/grouping service; reuse parsing where valid, replace orchestration semantics.
  - Pattern: `src-ts/src/domain/services/component-zip-import-service.ts` — Existing ZIP-job flow to delete or reduce to one canonical importer.
  - Pattern: `src-react/src/screens/LibraryScreen.tsx:211-224` — Current import entrypoint in library UI.
  - Test: `src-ts/src/domain/services/component-import-service.test.ts` — Parsing/preview coverage to adapt for create-only v1 import behavior.

  **Acceptance Criteria** (agent-executable only):
  - [ ] A single import entrypoint creates canonical workspace components compatible with the v1 CRUD/runtime model.
  - [ ] Duplicate import orchestration paths are removed from active router/UI usage.
  - [ ] KiCad symbol/footprint import tests still pass or are replaced with equivalent v1 ingestion tests.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Imported KiCad component becomes a usable canonical library component
    Tool: Bash
    Steps: Run targeted import-service/controller tests with existing KiCad fixtures
    Expected: Import creates a v1 component + variant record retrievable through the direct CRUD API
    Evidence: .sisyphus/evidence/task-4-import-flow.txt

  Scenario: Only one active import path remains
    Tool: Bash
    Steps: Run `rg "import-zip|previewImport|confirmImport|UnifiedImportModal" src-react src-ts`
    Expected: Matches correspond to the single retained v1 import flow only; removed pipeline references are gone from active routes/UI
    Evidence: .sisyphus/evidence/task-4-single-import-path.txt
  ```

  **Commit**: YES | Message: `refactor(import): unify v1 component ingestion` | Files: `src-ts/src/domain/services/*import*`, `src-ts/src/transport/controllers/*import*`, `src-react/src/components/*import*`, tests

- [ ] 5. Replace legacy library data flow with a unified v1 component data layer

  **What to do**: Rework the frontend component-library state so the library screen, detail flows, import results, and designer lookup all consume one canonical v1 component/variant query + mutation layer. Remove draft-list resume/discard behavior, remove built-in/workspace split from the active UI, and align filtering with the new backend capabilities.
  **Must NOT do**: Do not leave `useDrafts`, wizard-resume behavior, or client-side stopgap filtering as part of the final v1 library flow.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: frontend data wiring change across hooks, API wrapper, and library screen.
  - Skills: `[]` — No extra skill needed.
  - Omitted: `['playwright-cli']` — Implementation first; browser validation comes later.

  **Parallelization**: Can Parallel: YES | Wave 1 | Blocks: 6,9,10,12 | Blocked By: 1,3,4

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `src-react/src/screens/LibraryScreen.tsx:33-154` — Current screen is coupled to wizard open/close and draft refresh.
  - Pattern: `src-react/src/screens/LibraryScreen.tsx:172-225` — Current library actions/search/import header; keep overall library-screen role, replace underlying flow.
  - Pattern: `src-react/src/hooks/useComponents.ts:26-77` — Existing hook already centralizes fetch/refetch; extend into canonical v1 data layer and remove client-side hacks.
  - Pattern: `src-react/src/lib/api/component-api.ts:35-118` — Preserve API wrapper style for new direct CRUD surface.
  - Pattern: `src-react/src/hooks/useDrafts.ts` — Removal target for v1.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Library screen loads components through one v1 data layer with no draft dependency.
  - [ ] Built-in scope toggle and draft-resume/discard affordances are removed from active v1 UI.
  - [ ] Filtering behavior matches backend-supported query semantics rather than extra client-only post-filtering.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Library data layer renders without draft workflow dependencies
    Tool: Bash
    Steps: Run `npm run test:react -- useComponents LibraryScreen`
    Expected: Updated hook/screen tests pass and do not rely on useDrafts or wizard-resume state
    Evidence: .sisyphus/evidence/task-5-library-data-layer.txt

  Scenario: Legacy draft UI hooks are gone from active library flow
    Tool: Bash
    Steps: Run `rg "useDrafts|resumeDraft|discardComponentDraft|wizardOpen" src-react/src/screens src-react/src/hooks src-react/src/components`
    Expected: No active v1 library flow matches remain except deliberate deleted-file references in tests or non-component areas
    Evidence: .sisyphus/evidence/task-5-no-draft-ui.txt
  ```

  **Commit**: YES | Message: `refactor(ui): unify component library data flow` | Files: `src-react/src/screens/*`, `src-react/src/hooks/*`, `src-react/src/lib/api/*`, tests

- [ ] 6. Replace the wizard with a canonical library component editor shell

  **What to do**: Remove the step-based component wizard as the primary editing surface and replace it with one canonical component editor opened from the library and from designs. Use a direct-edit shell with at least symbol and footprint/variant sections, save-to-library actions, and dirty-state handling that writes to canonical component records via the new CRUD API.
  **Must NOT do**: Do not preserve the four-step wizard mental model, publish terminology, or draft-resume UI in v1.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: editor-shell UX, navigation, and interaction design matter here.
  - Skills: `[]` — No special skill required.
  - Omitted: `['frontend-ui-ux']` — Not necessary unless the executor wants extra design polish beyond plan scope.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 7,8,10,12 | Blocked By: 3,5

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `src-react/src/stores/component-wizard-store.ts:16-64` — Existing wizard payload shape shows what to delete/simplify.
  - Pattern: `src-react/src/stores/component-wizard-store.ts:154-252` — Current multi-step/draft store; removal target.
  - Pattern: `src-react/src/screens/LibraryScreen.tsx:147-154` — Current screen swaps to `ComponentWizard`; replace with canonical editor entry.
  - Pattern: `src-react/src/lib/api/component-api.ts:74-118` — Use direct family update/create/delete API style as the new editor persistence surface.
  - Test: `src-react/src/stores/component-wizard-store.test.ts` — Replace/remove wizard-specific tests with canonical editor-shell tests.

  **Acceptance Criteria** (agent-executable only):
  - [ ] A canonical component editor can be opened from the library without draft/publish vocabulary.
  - [ ] The editor writes directly to v1 component CRUD APIs and exposes symbol + footprint/variant editing entrypoints.
  - [ ] Wizard-specific active code paths are removed from v1 entry flows.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Canonical editor replaces wizard as the library edit surface
    Tool: Bash
    Steps: Run `npm run test:react -- LibraryScreen component-editor`
    Expected: Tests show library actions open the new editor shell and save through direct CRUD calls
    Evidence: .sisyphus/evidence/task-6-editor-shell.txt

  Scenario: Wizard flow is no longer active in v1 paths
    Tool: Bash
    Steps: Run `rg "ComponentWizard|publish|wizardStep|completedSteps" src-react/src`
    Expected: No matches in active v1 library/editor entry files beyond deletions or deferred cleanup stubs
    Evidence: .sisyphus/evidence/task-6-no-wizard.txt
  ```

  **Commit**: YES | Message: `refactor(ui): replace component wizard with editor` | Files: `src-react/src/screens/*`, `src-react/src/components/*`, `src-react/src/stores/*`, tests

- [ ] 7. Integrate symbol editing into direct canonical component saves

  **What to do**: Keep the symbol editor’s rich editing capabilities, but rewire it so its draft state becomes a transient UI buffer inside the canonical component editor rather than a separate persistence concept. Save operations should transform symbol-editor state directly into canonical library component payloads.
  **Must NOT do**: Do not keep a separate persisted symbol draft lifecycle or independent source-of-truth store outside the canonical editor flow.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: symbol state translation and save semantics must be exact.
  - Skills: `[]` — No extra skill needed.
  - Omitted: `['playwright-cli']` — Verification later.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 8,10,12 | Blocked By: 3,5,6

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `src-react/src/components/symbol-editor/symbol-editor-store.ts:1-6` — Explicitly documents current store separation from schematic editor; this separation must cease being a persistence boundary.
  - Pattern: `src-react/src/components/symbol-editor/symbol-editor-store.ts:34-91` — Current symbol editor state/actions to preserve functionally.
  - Pattern: `src-react/src/components/symbol-editor/symbol-editor-store.ts:161-255` — Current local-draft mutation behavior to wrap in canonical editor save flow.
  - Pattern: `src-ts/src/core/schemas/component-library.schema.ts:78-97` — Canonical symbol payload structure to align with.
  - API/Type: `src-react/src/lib/api/component-api.ts:74-118` — Direct CRUD API surface for persistence.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Symbol edits can be created, modified, and saved through the canonical component editor without a draft API.
  - [ ] Symbol-editor tests cover load/edit/save transformations into the new canonical component model.
  - [ ] No active symbol edit flow requires the old wizard store.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Symbol edit changes persist directly to canonical component data
    Tool: Bash
    Steps: Run `npm run test:react -- symbol-editor`
    Expected: Tests pass for loading a component symbol, editing metadata/pins/graphics, and saving directly via v1 CRUD calls
    Evidence: .sisyphus/evidence/task-7-symbol-editor.txt

  Scenario: Symbol editor no longer depends on wizard persistence
    Tool: Bash
    Steps: Run `rg "component-wizard|wizardStep|draftId" src-react/src/components/symbol-editor src-react/src/screens`
    Expected: No active symbol editor save path depends on wizard state
    Evidence: .sisyphus/evidence/task-7-no-wizard-dependency.txt
  ```

  **Commit**: YES | Message: `refactor(symbols): save directly to canonical components` | Files: `src-react/src/components/symbol-editor/*`, `src-react/src/components/*editor*`, tests

- [ ] 8. Integrate footprint editing and basic variants into canonical components

  **What to do**: Rewire the footprint editor into the canonical component editor and add v1 basic variant support. A v1 component may have multiple basic variants, each resolving to one concrete footprint payload and variant metadata, with one default variant. Keep the model simple enough to support design placement and import, without introducing revisions or full family/offerings complexity.
  **Must NOT do**: Do not add 3D model assets, manufacturer offerings, approval flows, or revision-aware variant history in v1.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: footprint state, variant identity, and default-selection semantics affect storage + design runtime.
  - Skills: `[]` — No extra skill required.
  - Omitted: `['writing']` — Not a doc-only task.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 9,10,12,13 | Blocked By: 3,5,6,7

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `src-react/src/components/footprint-editor/footprint-editor-store.ts:1-6` — Current footprint editor already lives separately; keep editor richness, change ownership semantics.
  - Pattern: `src-react/src/components/footprint-editor/footprint-editor-store.ts:34-100` — Current draft/selection/history action surface to preserve functionally.
  - Pattern: `src-react/src/components/footprint-editor/footprint-editor-store.ts:160-251` — Current local footprint-draft mutation behavior to adapt into canonical save flow.
  - Pattern: `src-ts/src/core/schemas/component-library.schema.ts:129-188` — Current footprint/variant schema is the best starting shape; trim to v1 essentials.
  - Pattern: `src-react/src/hooks/useComponents.ts:39-47` — Current mount-type filtering reveals variant presence in UI; replace with backend-supported variant queries as needed.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Canonical component editor can add/edit/remove variants and choose a default variant.
  - [ ] Each variant persists one concrete footprint payload compatible with design/runtime lookup.
  - [ ] Footprint editor save path no longer depends on wizard or publish semantics.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Variants and footprints persist through the canonical editor
    Tool: Bash
    Steps: Run `npm run test:react -- footprint-editor` plus targeted backend variant CRUD tests
    Expected: Tests pass for creating a component, adding multiple variants, selecting default, and saving footprint payloads
    Evidence: .sisyphus/evidence/task-8-footprint-variants.txt

  Scenario: Deferred rich-data features remain excluded
    Tool: Bash
    Steps: Run `rg "model3d|datasheet|manufacturer|offering" src-react src-ts`
    Expected: No active v1 component runtime/editor files depend on deferred rich-data fields
    Evidence: .sisyphus/evidence/task-8-no-rich-data.txt
  ```

  **Commit**: YES | Message: `feat(components): add v1 basic variants` | Files: `src-react/src/components/footprint-editor/*`, `src-react/src/components/*editor*`, `src-ts/src/core/schemas/*`, `src-ts/src/db/*`, tests

- [ ] 9. Rewire design placement/runtime to use canonical component and variant references

  **What to do**: Replace any current family-object embedding assumptions in designer placement/runtime with stable `component_id` + `variant_id` references. On placement and on document load, resolve the latest canonical component/variant from the library and render from that data. Ensure v1 stores references only, not embedded component payloads.
  **Must NOT do**: Do not embed snapshots, revision IDs, or duplicated component payload blobs into design documents in v1.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: runtime entity resolution affects schematic behavior, persistence, and later-phase evolution.
  - Skills: `[]` — No extra skill needed.
  - Omitted: `['frontend-ui-ux']` — Primarily data/runtime work.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 10,12,14 | Blocked By: 2,5,8

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `src-react/src/components/pcb/symbol-library.ts:17-21` — Existing comment already expects physical components from the library DB.
  - Pattern: `src-react/src/components/pcb/symbol-library.ts:64-153` — Current `createSymbolFromFamily`/`createSymbolEntity` runtime resolution path to adapt from family objects to component+variant reference flow.
  - Pattern: `src-react/src/stores/schematic-store.test.ts:12-81` — Current schematic document fixture shape; update tests and persistence model for v1 references.
  - Pattern: `src-react/src/stores/schematic-store.test.ts:117-220` — Existing store test style for persisted/chrome/session separation.
  - Test: `tests/e2e/schematic-editor.spec.ts:37-112` — Existing schematic placement E2E coverage to extend for library-backed live-link behavior.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Design documents persist component/variant references only for live-linked parts.
  - [ ] Placing a component from the library resolves a valid symbol from the latest canonical library data.
  - [ ] Reloading a design after a component edit resolves the updated library definition without migration logic.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Design reload resolves latest library component by reference
    Tool: Bash
    Steps: Run `npm run test:react -- schematic-store`
    Expected: Tests pass for placing a library component by reference, reloading document data, and resolving the latest component/variant state
    Evidence: .sisyphus/evidence/task-9-design-references.txt

  Scenario: No snapshot fields are introduced into v1 document model
    Tool: Bash
    Steps: Run `rg "snapshot|sourceRevision|embeddedComponent|componentPayload" src-react/src/components/pcb src-react/src/stores src-ts/src/core`
    Expected: No active v1 design model fields indicate embedded component snapshots
    Evidence: .sisyphus/evidence/task-9-no-snapshots.txt
  ```

  **Commit**: YES | Message: `refactor(design): resolve components by live reference` | Files: `src-react/src/components/pcb/*`, `src-react/src/stores/*`, shared document types, tests

- [ ] 10. Implement immediate design propagation and live-update feedback UX

  **What to do**: When a canonical component is edited and saved, update any open design sessions using that component and show a clear toast/banner stating what changed and how many instances/designs were affected. Ensure library data invalidation and design re-resolution happen through one deterministic propagation path rather than ad-hoc refetches.
  **Must NOT do**: Do not introduce revision prompts, manual upgrade flows, or silent background mutations with no user feedback.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: live-update UX and interaction clarity are critical even in a simplified v1.
  - Skills: `[]` — No extra skill required.
  - Omitted: `['playwright-cli']` — Playwright validation belongs in Task 12.

  **Parallelization**: Can Parallel: YES | Wave 2 | Blocks: 12 | Blocked By: 3,5,6,7,8,9

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `src-react/src/hooks/useComponents.ts:34-68` — Current fetch/refetch lifecycle; replace fragile refetch coupling with one live invalidation/update path.
  - Pattern: `src-react/src/screens/LibraryScreen.tsx:70-77` — Current post-publish refetch/navigation callback is too narrow; replace with canonical post-save update behavior.
  - Pattern: `src-react/src/components/pcb/symbol-library.ts:119-153` — Runtime symbol creation path must receive updated canonical data after save.
  - Test: `tests/e2e/schematic-editor.spec.ts:38-112` — Existing interaction test style; extend to assert live updates and visible banners.
  - External: `https://docs.flux.ai/reference/reference-library` — Inspiration for visible library-driven update awareness; do not import revision workflow yet.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Saving a component causes open designs using it to re-render/update without reload.
  - [ ] A visible toast/banner identifies that component-linked designs or instances were updated.
  - [ ] The propagation path is deterministic and covered by tests, not dependent on manual refresh timing.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Open design updates immediately after component save
    Tool: Bash
    Steps: Run targeted React/store tests covering component save -> design invalidation -> symbol rerender
    Expected: Tests pass and assert changed symbol/variant data becomes visible in the open design state without reload
    Evidence: .sisyphus/evidence/task-10-live-propagation.txt

  Scenario: User sees explicit live-update feedback
    Tool: Bash
    Steps: Run targeted component-library UI tests for save action and banner/toast rendering
    Expected: Tests assert a visible update notice containing the affected component name and impact count
    Evidence: .sisyphus/evidence/task-10-update-feedback.txt
  ```

  **Commit**: YES | Message: `feat(components): add live design propagation` | Files: `src-react/src/hooks/*`, `src-react/src/screens/*`, `src-react/src/components/pcb/*`, tests

- [ ] 11. Add v1 backend and React regression coverage for the replacement architecture

  **What to do**: Expand the test suite so the new v1 component architecture is protected at repository, controller, service, hook, and store layers. Cover canonical CRUD, variants, import create-only flow, delete blocking, direct editor saves, design reference resolution, and propagation-side invariants.
  **Must NOT do**: Do not rely on manual verification or keep outdated legacy tests asserting draft/publish flows as if they still mattered in v1.

  **Recommended Agent Profile**:
  - Category: `unspecified-high` — Reason: broad cross-layer test refactor with many deletions/additions.
  - Skills: `[]` — No extra skill required.
  - Omitted: `['playwright-cli']` — Playwright isolated in Task 12.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: 12 | Blocked By: 2,3,4,6,7,8,9,10

  **References** (executor has NO interview context — be exhaustive):
  - Test: `src-ts/src/domain/services/component-validation-service.test.ts` — Use comprehensive matrix style; repurpose for v1 invariants where validation still exists.
  - Test: `src-ts/src/transport/controllers/component-family-controller.test.ts` — Baseline for controller/API tests.
  - Test: `src-react/src/stores/component-wizard-store.test.ts` — Removal target; replace with canonical editor tests.
  - Test: `src-react/src/stores/schematic-store.test.ts:112-220` — Existing schematic-store test style for runtime behavior.
  - Test: `src-ts/src/domain/services/component-import-service.test.ts` — Adapt to new canonical import behavior.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npm run test:ts` passes with v1 CRUD/import/delete-block coverage.
  - [ ] `npm run test:react` passes with canonical editor/live-link runtime coverage.
  - [ ] Removed legacy tests are replaced by v1 assertions instead of skipped or commented-out coverage.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Backend v1 regression suite passes
    Tool: Bash
    Steps: Run `npm run test:ts`
    Expected: All backend tests pass, including new v1 component CRUD/import/delete-block cases and no failing legacy draft-flow tests remain
    Evidence: .sisyphus/evidence/task-11-test-ts.txt

  Scenario: Frontend v1 regression suite passes
    Tool: Bash
    Steps: Run `npm run test:react`
    Expected: All React tests pass, including canonical editor, variant editing, live-link design resolution, and update-feedback cases
    Evidence: .sisyphus/evidence/task-11-test-react.txt
  ```

  **Commit**: YES | Message: `test(components): cover v1 live-link architecture` | Files: `src-ts/**/*.test.ts`, `src-react/**/*.test.ts`, `tests/helpers/*`

- [ ] 12. Add Playwright coverage for the v1 live-link workflow

  **What to do**: Add browser E2E coverage for the actual user-critical v1 path: create/import component in library, open it in the canonical editor, modify symbol/footprint/variant data, place it in a design, edit it again, and verify open design updates live with visible notification. Include delete-block and basic variant selection scenarios.
  **Must NOT do**: Do not stop at unit tests. Do not ship UI changes without browser verification.

  **Recommended Agent Profile**:
  - Category: `visual-engineering` — Reason: browser workflow coverage and selector stability across UI-heavy flows.
  - Skills: `['playwright-cli']` — Useful for iterating selectors and browser-state checks before finalizing E2E tests.
  - Omitted: `['frontend-ui-ux']` — Not needed unless UI redesign occurs while testing.

  **Parallelization**: Can Parallel: NO | Wave 3 | Blocks: F1-F4 | Blocked By: 5,6,7,8,9,10,11

  **References** (executor has NO interview context — be exhaustive):
  - Test: `tests/e2e/schematic-editor.spec.ts:1-112` — Existing Playwright style, helper structure, and drag/drop interaction approach.
  - Pattern: `src-react/src/screens/LibraryScreen.tsx:172-225` — Library entry actions to cover in browser.
  - Pattern: `src-react/src/components/pcb/symbol-library.ts:119-153` — Placement path to verify via UI.
  - Pattern: `src-react/src/hooks/AGENTS.md` — Playwright verification is mandatory for UI changes.
  - External: `https://docs.flux.ai/reference/reference-library` — Inspiration for visible update awareness only; no revision prompts in v1.

  **Acceptance Criteria** (agent-executable only):
  - [ ] `npm run test:e2e` passes with new v1 library/editor/design integration coverage.
  - [ ] E2E verifies visible update banner/toast after live component edits.
  - [ ] E2E verifies delete is blocked when a component is in use.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Live-linked component edits update an open design in browser
    Tool: Playwright
    Steps: Open browser app; create or import a library component; place it into a design; reopen same component in canonical editor; change symbol/variant data; save; inspect open design canvas and banner/toast
    Expected: Canvas reflects updated library component without page reload and a visible notification appears
    Evidence: .sisyphus/evidence/task-12-live-link-e2e.txt

  Scenario: Delete is blocked for referenced component
    Tool: Playwright
    Steps: Create or select a library component already placed in a design; attempt delete from library UI
    Expected: Delete is prevented with explicit error/disabled state and the component remains placeable/readable
    Evidence: .sisyphus/evidence/task-12-delete-block-e2e.txt
  ```

  **Commit**: YES | Message: `test(e2e): verify live-linked component workflow` | Files: `tests/e2e/*`, supporting fixtures/selectors

- [ ] 13. Implement v2 immutable revisions and history-aware component editing

  **What to do**: Introduce immutable component revisions and revision history browsing on top of the stable v1 component + variant model. Replace raw direct-overwrite semantics with create-new-revision saves, revision lists, diffs/metadata, and history visibility in library UI, while preserving the v1 live-link runtime as the baseline until v3 changes project storage.
  **Must NOT do**: Do not jump straight to snapshots/portability here. Do not add local forks/overrides yet.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: identity/history semantics require careful layering over the v1 model.
  - Skills: `[]` — No extra skill required.
  - Omitted: `['playwright-cli']` — Browser coverage can be added after implementation with standard tooling.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: 14,15 | Blocked By: 2,3,8

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `src-ts/src/core/schemas/component-library.schema.ts:194-237` — Prior draft/revision schema shows where history concepts existed before; rebuild cleanly on top of v1 contracts.
  - Pattern: `src-ts/src/transport/controllers/component-draft-controller.ts:165-181` — Old revision creation logic is not reusable as-is, but highlights the previous save-to-revision seam.
  - Pattern: `src-react/src/screens/LibraryScreen.tsx` — Library UI will need revision/history affordances later.
  - External: `https://docs.flux.ai/reference/reference-version-control` — Use for high-level version-history expectations, not exact product cloning.
  - External: `https://docs.flux.ai/tutorials/tutorial-reviewing-part-updates` — Reference for review-oriented update UX inspiration.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Saving a component in v2 creates a new immutable revision instead of mutating history in place.
  - [ ] Library UI exposes revision history and basic diff/review metadata.
  - [ ] Backend/API tests prove earlier revisions remain readable and unchanged after later edits.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Revision creation preserves immutable history
    Tool: Bash
    Steps: Run targeted backend tests that edit the same component multiple times and query revision history
    Expected: Each save creates a new revision; prior revision payloads stay unchanged
    Evidence: .sisyphus/evidence/task-13-revisions.txt

  Scenario: Revision history is visible in UI
    Tool: Playwright
    Steps: Open a component with multiple revisions in library UI; inspect history panel/list and diff metadata
    Expected: User can see ordered revisions and identify the latest one without ambiguity
    Evidence: .sisyphus/evidence/task-13-history-ui.txt
  ```

  **Commit**: YES | Message: `feat(components): add immutable revision history` | Files: `src-ts/src/db/*`, `src-ts/src/transport/*`, `src-react/src/screens/*`, `src-react/src/components/*`, tests

- [ ] 14. Implement v3 project snapshots and portability on top of source links

  **What to do**: Change project storage from reference-only v1 to embedded component snapshots plus source-link metadata. Projects must become portable/offline-safe while still tracking the upstream library component/variant/revision they originated from. Add manual update/adoption flow scaffolding so designs can compare embedded snapshots with newer library revisions.
  **Must NOT do**: Do not reintroduce live-runtime dependency on library state once snapshots are added. Do not add local forks yet unless strictly required for snapshot upgrade mechanics.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: project format and runtime resolution semantics change materially here.
  - Skills: `[]` — No extra skill required.
  - Omitted: `['writing']` — Implementation task, not spec-only.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: 15 | Blocked By: 2,9,13

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `src-react/src/stores/schematic-store.test.ts:12-81` — Current design document fixture shape to evolve from reference-only toward embedded snapshot + source-link semantics.
  - Pattern: `src-react/src/components/pcb/symbol-library.ts:64-153` — Runtime resolution path to switch from latest-library lookup to snapshot-first rendering.
  - External: `https://docs.flux.ai/reference/reference-sharing-and-permissions` — Use only for thinking about portability/sharing implications, not permissions scope in this phase.
  - External: `https://docs.flux.ai/reference/reference-version-control` — Revision/source-link relationship guidance.
  - Oracle guardrail: project runtime must resolve from embedded snapshot first once v3 begins.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Projects can open and render correctly without library access after component insertion.
  - [ ] Each placed instance stores embedded component snapshot data plus source-link metadata.
  - [ ] Manual update detection can identify when library source is newer than embedded project snapshot.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Project opens correctly without live library dependency
    Tool: Bash
    Steps: Run targeted tests that create a project with embedded component snapshots, then load it with library lookup disabled/mocked absent
    Expected: Project still renders and validates from embedded snapshot data
    Evidence: .sisyphus/evidence/task-14-portability.txt

  Scenario: Source-link update detection works
    Tool: Playwright
    Steps: Open a project containing embedded component snapshots; publish a newer library revision; reopen or refresh project update panel
    Expected: UI reports update availability without mutating the project automatically
    Evidence: .sisyphus/evidence/task-14-source-link-update.txt
  ```

  **Commit**: YES | Message: `feat(projects): add component snapshots and source links` | Files: `src-react/src/components/pcb/*`, `src-react/src/stores/*`, `src-ts/src/core/*`, tests

- [ ] 15. Implement v4 advanced import/export bundles and interoperability

  **What to do**: Add robust import/export for reusable component/library bundles and portable project/component interchange. Preserve canonical IDs, provenance, schema versioning, and compatibility validation. This phase is where export leaves the backlog and becomes a supported, testable product surface.
  **Must NOT do**: Do not silently overwrite existing component identities on import. Do not ship bundle formats without schema versioning and explicit incompatibility errors.

  **Recommended Agent Profile**:
  - Category: `deep` — Reason: interoperability touches storage contracts, file formats, provenance, and later migration rules.
  - Skills: `[]` — No special skill required.
  - Omitted: `['playwright-cli']` — Browser validation is secondary to file-format correctness here.

  **Parallelization**: Can Parallel: YES | Wave 3 | Blocks: F1-F4 | Blocked By: 2,4,13,14

  **References** (executor has NO interview context — be exhaustive):
  - Pattern: `src-ts/src/domain/services/component-import-service.ts` — Current parser/import foundation to extend into bundle interoperability.
  - Pattern: `src-ts/src/domain/services/component-zip-import-service.ts` — Existing ZIP concepts may inform bundle packaging, but must be redesigned around later-phase canonical IDs and schema versions.
  - Pattern: `src-ts/src/core/schemas/component-library.schema.ts:243-254` — Provenance schema is a good seed for bundle metadata.
  - External: `https://docs.flux.ai/reference/reference-library` — Central library interoperability inspiration.
  - External: `https://docs.flux.ai/tutorials/tutorial-add-part-library` — Import usability inspiration only.

  **Acceptance Criteria** (agent-executable only):
  - [ ] Components and/or libraries can be exported as versioned bundles and re-imported without losing canonical identity or provenance.
  - [ ] Import rejects incompatible bundle schema versions with explicit errors.
  - [ ] Import never silently overwrites an existing component identity.

  **QA Scenarios** (MANDATORY — task incomplete without these):
  ```
  Scenario: Bundle export/import round-trip preserves identity and provenance
    Tool: Bash
    Steps: Run targeted tests exporting a component/library bundle, importing it into a clean workspace, and reading canonical IDs/provenance back
    Expected: Canonical identity, provenance, and expected payloads survive the round-trip
    Evidence: .sisyphus/evidence/task-15-bundle-roundtrip.txt

  Scenario: Incompatible bundle version is rejected safely
    Tool: Bash
    Steps: Run targeted tests importing a malformed or future-version bundle
    Expected: Import fails with explicit incompatibility error and no partial writes
    Evidence: .sisyphus/evidence/task-15-bundle-reject.txt
  ```

  **Commit**: YES | Message: `feat(components): add advanced bundle import export` | Files: `src-ts/src/domain/services/*import*`, `src-ts/src/transport/*`, bundle schemas, tests

## Final Verification Wave (MANDATORY — after ALL implementation tasks)
> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.
- [ ] F1. Plan Compliance Audit — oracle

  **Tool**: task (oracle)
  **Steps**: Run an oracle review against the completed implementation and this plan file; verify each completed task matches its acceptance criteria, file targets, and v1/v2/v3/v4 scope boundaries.
  **Expected**: Oracle reports no missing mandated tasks, no skipped guardrails, and no phase leakage into v1.
  **Evidence**: `.sisyphus/evidence/f1-plan-compliance.txt`

- [ ] F2. Code Quality Review — unspecified-high

  **Tool**: task (unspecified-high)
  **Steps**: Review changed backend/frontend/tests for maintainability, dead legacy code removal, contract consistency, and refactor cleanliness.
  **Expected**: Reviewer approves with no unresolved high-severity quality or architecture findings.
  **Evidence**: `.sisyphus/evidence/f2-code-quality.txt`

- [ ] F3. Agent-executed QA — unspecified-high (+ Playwright if UI)

  **Tool**: task (unspecified-high) + Playwright
  **Steps**: Run the defined automated verification commands (`npm run typecheck`, `npm run test:ts`, `npm run test:react`, `npm run test:e2e`) and browser-check the live-link workflow, delete-block flow, and update-feedback UX.
  **Expected**: All automated checks pass and Playwright confirms the implemented user journeys behave exactly as specified.
  **Evidence**: `.sisyphus/evidence/f3-agent-qa.txt`

- [ ] F4. Scope Fidelity Check — deep

  **Tool**: task (deep)
  **Steps**: Compare final implementation against the approved phase contract; confirm v1 does not contain snapshots, revisions, 3D, MPNs, shared scopes, or other deferred features unless a later-phase task explicitly implemented them.
  **Expected**: Deep review confirms v1 remains intentionally minimal and later-phase work is only present where planned.
  **Evidence**: `.sisyphus/evidence/f4-scope-fidelity.txt`

## Commit Strategy
- Commit after each major milestone, not each file:
  1. v1 contract/storage reset
  2. v1 editor/runtime/live-link integration
  3. v1 verification suite
  4. v2 revisions/history
  5. v3 snapshots/portability
  6. v4 advanced import/export
- Use short imperative commit messages aligned with repo history guidance.

## Success Criteria
- v1 fully replaces current broken component stack with one canonical live-linked workspace library
- Component edits in library are reflected in open and newly loaded designs without manual republish flows
- v1 excludes snapshots, revisions, 3D, MPNs, and shared scopes by design rather than accidental omission
- v2/v3/v4 have explicit implementation-ready follow-up tasks rather than vague backlog bullets
