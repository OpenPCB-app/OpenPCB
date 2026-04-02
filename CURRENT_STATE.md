# CURRENT_STATE.md

## Designer Editor + Component Library — Current State Baseline

Last analyzed: 2026-04-02  
Scope: current implementation only. This document describes what exists now, how it is wired, what is actively used, and where the current architecture is transitional.

---

## 1. Purpose

This document captures the current implementation of:

- the **Designer editor**
- the **Component Library**
- the **linkage between them**

Primary audience: **Software Architect**.  
Goal: provide a reliable baseline before planning refactors, convergence work, target architecture, or specification alignment.

This is intentionally focused on **actual codepaths and runtime behavior**, not roadmap docs or intended future state.

---

## 2. Executive Summary

Current state is **functional, substantial, and clearly transitional**.

### What is already working

- The **Designer** is a real browser-based schematic editor with:
  - document load/save
  - unsaved in-memory drafts
  - palette-driven placement
  - wire creation with waypoints
  - selection + drag move
  - floating symbol properties popover
  - grid, zoom, pan, hit testing, viewport fit
- The **Component Library** is a real data-backed feature with:
  - list/search/filter
  - import
  - create
  - delete with usage impact
  - detail page with previews
  - variant-aware data model
- **Designer ↔ Library integration is already real**:
  - designer palette loads library components
  - placed symbols store component references
  - open schematic documents re-resolve against latest library data
  - library refreshes propagate into designer runtime
  - missing links degrade gracefully instead of hard-failing

### What is architecturally unsettled

- Library authoring is split across **three different surfaces**:
  1. `LibraryScreen` + `ComponentWizard` for create
  2. `ComponentDetailPage` for shallow edit
  3. `ComponentEditor` for rich create/edit, but not routed
- Shared schema, controller serialization, and DB persistence are **not fully aligned**.
- The runtime library-link model is implemented, but persistence still uses a **mixed reference format**.
- There are still artifacts from older or parallel models: drafts, revisions, family terminology, synthetic workspace-record APIs.

### Core architectural conclusion

The strongest current foundation is the **runtime canonical-library resolution model** inside Designer.  
The weakest area is the **Library authoring architecture**, which has not yet converged to one active, canonical edit flow.

---

## 3. System Context

Relevant runtime layers:

- **React frontend**: screens, editors, hooks, Zustand stores
- **Bun sidecar backend**: HTTP controllers, repositories, design/content persistence
- **Shared contracts**: component-library schema and schematic document schema

Core implementation locations:

- Designer shell: `src-react/src/screens/DesignScreen.tsx`
- Schematic runtime store: `src-react/src/stores/schematic-store.ts`
- Canvas runtime: `src-react/src/components/pcb/canvas/SchematicCanvas.tsx`
- Palette: `src-react/src/components/pcb/palette/ComponentPalette.tsx`
- Library list screen: `src-react/src/screens/LibraryScreen.tsx`
- Library detail page: `src-react/src/components/library/ComponentDetailPage.tsx`
- Rich component editor: `src-react/src/components/editor/ComponentEditor.tsx`
- Wizard create flow: `src-react/src/components/wizard/ComponentWizard.tsx`
- Library API wrapper: `src-react/src/lib/api/component-api.ts`
- Shared component schema: `src-ts/src/core/schemas/component-library.schema.ts`
- Backend component controller: `src-ts/src/transport/controllers/component-controller.ts`
- Backend repository: `src-ts/src/db/repositories/component-repository.ts`

---

## 4. Navigation and Active Screen Topology

Navigation is hash-based.

Relevant routes are defined in `src-react/src/navigation/routes.ts` and wired in `src-react/src/stores/navigation-store.ts` and `src-react/src/layout/ScreenRouter.tsx`.

### Relevant current routes

- `#design`
- `#design-project:<projectId>:<designId>`
- `#design-workspace:<designId>`
- `#library`
- `#import`
- `#component-<componentId>`

### Active route mapping

- `design` → `DesignScreen`
- `library` → `LibraryScreen`
- `import` → `LibraryScreen`
- `component-detail` → `ComponentDetailPage`

### Important current routing behavior

- `#component-new` does **not** open a dedicated editor route.
- New component creation is explicitly redirected back into the **library screen flow**, where `ComponentWizard` is opened inline/full-screen.
- `ComponentEditor` is **not part of the active route map**.

This means the currently active UX is:

- **Create** → Wizard
- **Edit existing** → Detail page (metadata-level edit)
- **Rich editor** → Exists, but hidden from routing

This is one of the most important current-state architectural facts.

---

## 5. Designer Editor — Current State

## 5.1 Designer shell responsibilities

`DesignScreen.tsx` is the main shell and currently owns multiple concerns at once:

- design/workspace context resolution
- initial unsaved draft creation
- loading persisted sheet content
- save orchestration
- draft close/discard prompts
- keyboard shortcuts
- main panel layout
- designer tab switching
- fallback/error states
- placeholder AI side panel

This screen is not just a view; it is a **workflow shell** for the schematic editor.

### Implemented shell features

- open persisted design
- open empty in-memory draft when no design selected but workspace exists
- save persisted design
- convert unsaved draft into a real design on first save
- close with save/discard confirmation for non-empty unsaved drafts
- retry failed load

Refs:

- `src-react/src/screens/DesignScreen.tsx`
- `src-react/src/screens/design/DesignHeader.tsx`

---

## 5.2 Designer tabs

Tabs are defined in `DesignHeader.tsx`:

- `schematic`
- `pcb`
- `3d`
- `bom`

### Current reality

- **Schematic**: implemented
- **PCB**: placeholder only
- **3D**: placeholder only
- **BOM**: placeholder only

So current Designer is effectively a **schematic editor with future-tab placeholders**.

---

## 5.3 Schematic runtime architecture

Main runtime state lives in one Zustand store: `useSchematicStore`.

### Main state partitions

- `persisted`
  - current document
  - project id
  - design id
- `derived`
  - connectivity
  - document bounds
  - hit-test cache
- `chrome`
  - viewport
  - current selection
  - active tool
  - popover target
  - grid settings
  - placement rotation
- `session`
  - interaction state machine for placement / wire / drag
- `draggedSymbolKind`
- `componentLibraryIndex`

### Architectural meaning

This store combines:

- persisted document state
- editing session state
- derived geometry caches
- runtime library resolution state

This creates a single strong integration point, but also means the store is **highly coupled** and broad in responsibility.

Refs:

- `src-react/src/stores/schematic-store.ts`
- `src-react/src/stores/schematic-store.test.ts`

---

## 5.4 Schematic document model

Frontend editor model is defined in `src-react/src/components/pcb/types.ts`.

### Runtime symbol shape adds editor-specific fields

Compared with persisted shared symbols, runtime editor symbols may contain:

- `symbolKind`
- `componentId`
- `variantId`
- `linkStatus`
- `value`
- `mirrored`
- normalized `reference`

### Persisted schematic model

Shared persisted schematic document is defined in:

- `src-ts/shared/types/pcb.types.ts`
- validated by `src-ts/src/core/schemas/pcb-project.schema.ts`

Persisted schematic symbols carry:

- `libraryPartId?`
- `reference?`
- `position`
- `rotation?`
- `pins`
- `properties?`

### Current reference persistence model

When the frontend saves symbols back to persisted document (`toSchematicProjectDocument()`), it writes:

- `libraryPartId`
- `properties.component_id`
- `properties.variant_id`
- `properties.value`

When it loads them back (`toEditorSchematicSymbol()`), it reconstructs:

- `componentId` from `properties.component_id`
- `variantId` from `properties.variant_id`

### Key architectural consequence

Current persistence uses a **mixed reference strategy**:

- top-level `libraryPartId`
- properties-based `component_id`
- properties-based `variant_id`

This is stable enough to function, but it is not a clean single-format link model.

Refs:

- `src-react/src/components/pcb/types.ts`
- `src-ts/shared/types/pcb.types.ts`
- `src-ts/src/core/schemas/pcb-project.schema.ts`

---

## 5.5 Canvas implementation

The schematic editor canvas is implemented in `src-react/src/components/pcb/canvas/SchematicCanvas.tsx`.

### Rendering model

- one HTML `<canvas>` fills the available editor area
- `ResizeObserver` resizes canvas to container size
- canvas is DPR-aware
- rendering runs in a continuous `requestAnimationFrame` loop

### Draw order

Current render order is:

1. background clear
2. grid
3. wires
4. junctions
5. symbols
6. placement preview symbol
7. wire preview
8. selection overlays

### Architectural implication

This is a straightforward immediate-mode canvas renderer.  
It is simple and centralised, but it re-renders continuously rather than being event-driven or dirty-region based.

Refs:

- `src-react/src/components/pcb/canvas/SchematicCanvas.tsx`
- `src-react/src/components/pcb/canvas/grid.ts`
- `src-react/src/components/pcb/canvas/wires.ts`
- `src-react/src/components/pcb/canvas/symbols.ts`

---

## 5.6 Coordinate systems, snapping, viewport, hit testing

### Units

Schematic geometry uses **nanometer-scale numeric units**.

### Viewport model

Viewport operations are implemented in `viewport.ts`:

- `screenToSchematic`
- `schematicToScreen`
- `domEventToScreen`
- `snapToGrid`
- `fitViewportToBounds`
- zoom clamping

### Grid behavior

- fixed grid presets exist in runtime types
- snapping is applied when grid is enabled
- placement and drag movement are world-space snapped

### Hit testing

Hit testing uses a derived cache from symbol geometry:

- symbol bounds
- connector anchors

Current hit model is focused on:

- symbol bodies
- pin connectors

Important simplification: hit testing is not a full entity graph; it is a screen-space cache-based helper.

Refs:

- `src-react/src/components/pcb/canvas/viewport.ts`
- `src-react/src/components/pcb/canvas/hit-test.ts`
- `src-react/src/components/pcb/canvas/viewport.test.ts`
- `src-react/src/components/pcb/canvas/hit-test.test.ts`

---

## 5.7 Interaction model

Current schematic interaction state machine supports:

- placement
- wire session
- drag session
- selection/no active session

### Placement

- initiated by palette click or drag
- preview follows pointer
- commit places symbol and exits session
- rotation is tracked in chrome state

### Wiring

- click connector to begin
- click intermediate points to add waypoints
- click valid target connector to commit
- route is orthogonal Manhattan-style with waypoints

### Selection and move

- click body to select
- additive multi-select through modifiers
- drag threshold before entering drag session
- drag updates positions from captured initial positions

### Shell-level keyboard support

- `Escape`
  - closes popover if open
  - otherwise cancels active editing session
- `Delete` / `Backspace`
  - delete selected entities when text input is not focused

Refs:

- `src-react/src/components/pcb/canvas/SchematicCanvas.tsx`
- `src-react/src/components/pcb/useSchematicInteractionController.ts`
- `src-react/src/stores/schematic-store.ts`
- `src-react/src/components/pcb/canvas/SchematicCanvas.test.tsx`
- `src-react/src/screens/DesignScreen.test.tsx`

---

## 5.8 Properties UI

Current properties affordance is the floating popover:

- shown for a single selected symbol
- anchored from symbol bounds
- closes independently of selection

Current edit support is minimal:

- `Value` is inline-editable only for power symbols (`gnd`, `vcc`)
- other rows are informational

There is also a side properties summary panel implementation, but the current Designer shell prominently uses the floating popover.

Architecturally, this means schematic editing is currently centered on **placement/wiring**, not rich property authoring.

Refs:

- `src-react/src/components/pcb/properties/FloatingPropertiesPopover.tsx`
- `src-react/src/components/pcb/properties/PropertiesPanel.tsx`

---

## 5.9 Implemented user-visible Designer features

Current implemented Designer user features:

- open/load schematic
- create unsaved draft in workspace context
- save schematic
- place palette symbols/components
- use built-in GND and VCC symbols
- place library-backed physical components
- select and multi-select symbols
- drag selected symbols
- create orthogonal wires with waypoints
- zoom and pan
- toggle/use grid presets
- delete selected entities
- open floating symbol properties
- show status bar
- show placeholder AI panel

### Important current absences or simplifications

- no implemented PCB layout tab
- no implemented 3D viewer tab
- no implemented BOM tab
- no undo/redo surfaced in explored Designer runtime
- no full net derivation beyond junction detection
- no normalized usage/index sync from schematic saves into backend component usage table in active explored path

---

## 6. Designer Palette and Library Consumption

The palette is implemented in `src-react/src/components/pcb/palette/ComponentPalette.tsx`.

### Current palette composition

There are two categories of placeable items:

1. **Embedded symbols**
   - `gnd`
   - `vcc`
2. **Library components**
   - fetched from backend through `useComponents()`

The file explicitly documents the rule:

> Embedded net-defining symbols (GND/VCC only). All physical components come from the Component Library.

### Grouping

Library components are grouped by mapped `categoryPath`, using palette symbol categories.

### Refresh behavior

Palette has its own refresh button and its own `useComponents()` call.

### Architectural implication

Palette is not a passive consumer of some centralized designer library cache.  
It independently fetches component data and then pushes results into the schematic store.

Refs:

- `src-react/src/components/pcb/palette/ComponentPalette.tsx`
- `src-react/src/hooks/useComponents.ts`

---

## 7. Designer ↔ Library Linkage

This is the strongest current subsystem boundary.

## 7.1 Runtime linkage model

Designer consumes library data through the following path:

1. component list fetched via `useComponents()`
2. fetched components propagated into `useSchematicStore.setComponentLibrary()`
3. store builds `componentLibraryIndex`
4. document symbols are resolved against canonical component + variant data
5. placement also uses the same index

Main files:

- `src-react/src/hooks/useComponents.ts`
- `src-react/src/stores/schematic-store.ts`
- `src-react/src/components/pcb/symbol-library.ts`
- `src-react/src/components/pcb/types.ts`

---

## 7.2 Library-backed placement semantics

When a library component is placed:

- `symbolKind` becomes the component id
- `componentId` is stored
- `variantId` is resolved and stored
- `libraryPartId` is set to component id
- `linkStatus` is `ok`
- reference is generated from `symbolData.referencePrefix`
- pins are generated from canonical `pinDefinitions`
- symbol value comes from component symbol properties or display label fallback

This means placed symbols are **not merely static snapshots**. They are strongly linked runtime entities.

Refs:

- `src-react/src/components/pcb/symbol-library.ts`
- `src-react/src/stores/schematic-store.test.ts`

---

## 7.3 Canonical re-resolution semantics

Whenever the document is loaded or the component library index is refreshed:

- symbols with `componentId` are re-resolved against the current canonical library state

If component + variant still exist:

- pins, value, symbol template, and related runtime symbol fields are refreshed

If component cannot be resolved:

- symbol is marked `linkStatus: "missing"`
- prior minimal state remains so the design can still open

### This is a major current-state behavior

Designer is already built around **live canonical resolution**, not isolated per-document ownership of full component definition.

Validated by tests:

- canonical data overrides stale loaded symbol value/pins
- library edits refresh loaded symbol definitions on reload
- missing links survive persistence/reload in degraded form

Refs:

- `src-react/src/components/pcb/symbol-library.ts`
- `src-react/src/stores/schematic-store.ts`
- `src-react/src/stores/schematic-store.test.ts`

---

## 7.4 Current propagation entry points

Propagation from library changes into designer happens in multiple places:

- `ComponentPalette` pushes fetched components into schematic store
- `useComponents.refetchAndPropagate()` does the same explicitly
- `useComponentDetail.deleteComponent()` reloads latest list and pushes it into store
- `ComponentEditor` calls `refetchAndPropagate()` after save

### Architectural consequence

Integration exists, but it is **not centralized into one synchronization boundary**.  
There are multiple callers that each know how to refresh Designer runtime.

This is workable, but fragile for refactor.

Refs:

- `src-react/src/components/pcb/palette/ComponentPalette.tsx`
- `src-react/src/hooks/useComponents.ts`
- `src-react/src/components/editor/ComponentEditor.tsx`

---

## 8. Component Library — Current State

## 8.1 Active Library UX

Current actively routed Library UX consists of:

- `LibraryScreen`
- `ComponentDetailPage`
- `ComponentWizard` for create

This is the active path users encounter today.

### `LibraryScreen` currently implements

- component grid/list cards
- search
- mount-type filter
- select-all / selection state
- single delete
- bulk delete
- import modal launch
- create wizard launch

### `ComponentDetailPage` currently implements

- component inspect view
- symbol preview
- footprint preview
- 3D placeholder view
- variant selection
- footprint selection
- shallow edit of top-level metadata
- delete with usage impact check

Refs:

- `src-react/src/screens/LibraryScreen.tsx`
- `src-react/src/components/library/ComponentDetailPage.tsx`

---

## 8.2 LibraryScreen behavior in detail

### Search/filter

`LibraryScreen` passes search and single mount filter directly into `useComponents()`.

Backend-supported filter inputs currently surfaced in UI:

- `search`
- `mountType`

Shared hook also supports `categoryPath` and `tags`, but those are not currently surfaced by the active screen.

### Selection/delete

Current list supports:

- card checkbox selection
- select all
- bulk delete
- force-include used components during bulk delete after conflict feedback

### Import

Library import is launched through `UnifiedImportModal`.

### Create

Clicking **New** swaps `LibraryScreen` into a full-screen `ComponentWizard` flow.

### Important missing list-level capabilities

Not actively present in current LibraryScreen UI:

- category tree navigation
- tag filter UI
- sort controls
- duplicate action on list cards
- export action on list cards
- routed entry into `ComponentEditor`

Refs:

- `src-react/src/screens/LibraryScreen.tsx`
- `src-react/src/screens/LibraryScreen.test.tsx`

---

## 8.3 Detail page behavior in detail

`ComponentDetailPage` is the active routed view for existing components.

### Current functionality

- loads one component by route id
- resolves active/default variant
- resolves active/default footprint option
- shows:
  - symbol preview
  - footprint preview
  - model placeholder
  - technical specifications
  - pin table
- edit mode allows changes to:
  - `displayLabel`
  - `description`
  - `categoryPath`

### Important limitation

The active detail-page edit mode does **not** author:

- symbol geometry
- pins
- variants
- footprint geometry
- 3D configuration
- richer metadata model

### Placeholder or incomplete actions

Buttons are present for:

- Export
- Duplicate
- Use in Design

In explored code, these do not represent fully wired end-to-end flows. The clearly implemented actions are edit and delete.

Architecturally, `ComponentDetailPage` is primarily an **inspection + metadata edit page**, not the canonical authoring shell.

Refs:

- `src-react/src/components/library/ComponentDetailPage.tsx`

---

## 9. Library Authoring Architecture

This is the most transitional part of the system.

## 9.1 Current authoring surfaces

There are currently three meaningful authoring surfaces:

### 1. `ComponentWizard` — active create path

- launched from `LibraryScreen`
- multi-step flow
- draft-like autosave behavior
- final publish action

### 2. `ComponentDetailPage` — active shallow edit path

- routed for existing components
- edits top-level metadata only

### 3. `ComponentEditor` — rich create/edit path, not routed

- symbol editor
- variant manager
- footprint editor integration
- direct canonical save behavior

### Architectural conclusion

The system does **not currently have one canonical, active authoring path**.

---

## 9.2 ComponentWizard current implementation

`ComponentWizard` is the active create flow.

### Step structure

Current steps:

1. Symbol
2. Footprint
3. 3D Model
4. Specs

### Runtime behavior

On open:

- creates a backend “workspace component record”
- initializes wizard Zustand store
- resets symbol and footprint editor stores

During editing:

- symbol step syncs symbol editor state into wizard draft
- footprint step syncs footprint editor state into wizard draft
- debounced autosave persists draft through `patchWorkspaceComponentRecord()`

On final save:

- performs a final patch
- calls `publishWorkspaceComponentRecord()`

### Important current-state nuance

Although the UI still presents this as a draft/publish workflow, the frontend API layer has already collapsed much of it into real component CRUD under the hood.

Refs:

- `src-react/src/components/wizard/ComponentWizard.tsx`
- `src-react/src/stores/component-wizard-store.ts`
- `src-react/src/lib/api/component-api.ts`

---

## 9.3 Wizard state model

Wizard state includes:

- `draftId`
- `draft`
- `isDirty`
- `isSaving`
- current step
- completed steps
- validation placeholders

The draft payload can contain:

- display label
- description
- symbol draft
- footprint draft
- model data
- specs data
- default variant / variants / component refs

Architecturally, this still reflects a **multi-phase draft-first authoring model**, even though the underlying persistence has become more direct.

Refs:

- `src-react/src/stores/component-wizard-store.ts`

---

## 9.4 ComponentEditor current implementation

`ComponentEditor` is the strongest candidate for a future canonical editor, but it is not active in routing.

### What it already supports

- create mode and edit mode
- top-level metadata editing
- symbol editor integration
- footprint editor integration
- multiple variants
- add/remove/update variant
- default variant switching
- save to canonical component + variant endpoints
- post-save library refresh propagation into Designer
- user feedback when open design instances are refreshed

### Save behavior

#### Create mode

- creates component with variants in one payload

#### Edit mode

- updates component metadata
- diffs current local variants against server variants
- removes deleted variants
- updates existing variants
- creates missing variants
- sets default variant
- refreshes library and propagates to open Designer state

### Architectural significance

`ComponentEditor` is not a stub. It is tested, integrated with real APIs, and already aligned with a more direct canonical-library editing model than the current active routed UX.

Refs:

- `src-react/src/components/editor/ComponentEditor.tsx`
- `src-react/src/components/editor/ComponentEditor.test.tsx`
- `src-react/src/components/editor/ComponentVariantManager.tsx`

---

## 9.5 Symbol, footprint, and variant authoring internals

The library authoring subsystem is built on real internal editors.

### Symbol editor role

Used in both wizard and rich editor.

Current role:

- symbol geometry editing
- body preset selection
- pin palette and pin editing
- metadata editing
- import support

### Footprint editor role

Used in wizard and inside `ComponentVariantManager` for the currently selected variant.

Current role:

- footprint draft editing
- import support
- conversion to payload for component variant persistence

### Variant manager role

Bridges canonical component model and per-variant footprint authoring.

Current responsibilities:

- variant selection
- add/remove variant
- default variant state
- variant metadata normalization
- per-selected-variant footprint payload sync

Architecturally, these sub-editors are real. The unsettled part is not their existence; it is **which top-level authoring shell should own them**.

Refs:

- `src-react/src/components/editor/ComponentEditor.tsx`
- `src-react/src/components/editor/component-variant-buffer.ts`
- `src-react/src/components/symbol-editor/*`
- `src-react/src/components/footprint-editor/*`

---

## 10. Library API and Frontend Data Layer

Frontend library data access is implemented primarily through:

- `src-react/src/lib/api/component-api.ts`
- `src-react/src/hooks/useComponents.ts`

## 10.1 Current hook layer

### `useComponents()`

Provides:

- list fetch
- loading/error state
- filter state
- `refetch()`
- `refetchAndPropagate()`

### `useComponentDetail()`

Provides:

- single component fetch
- update
- delete
- delete impact loading

### `useComponentMutations()`

Provides:

- create
- update
- delete

### Architectural observation

This hook layer is functional, but it also contains **cross-feature side effects**, because it knows how to propagate library changes into the schematic store.

Refs:

- `src-react/src/hooks/useComponents.ts`
- `src-react/src/hooks/useComponents.test.ts`

---

## 10.2 Current API wrapper surface

`component-api.ts` exposes two different styles of API:

### Real canonical component APIs

- `listComponents`
- `getComponent`
- `createComponent`
- `updateComponent`
- `deleteComponentWithOptions`
- `getComponentDeleteImpact`
- variant CRUD
- `setDefaultComponentVariant`
- import parse/import execute APIs

### Synthetic workspace-record APIs

- `listWorkspaceComponentRecords`
- `createWorkspaceComponentRecord`
- `patchWorkspaceComponentRecord`
- `discardWorkspaceComponentRecord`
- `validateWorkspaceComponentRecord`
- `publishWorkspaceComponentRecord`

### Important current-state fact

The workspace-record API is not a full independent backend draft system anymore.

Concrete signs:

- `listWorkspaceComponentRecords()` returns `[]`
- `createWorkspaceComponentRecord()` creates a real component
- `patchWorkspaceComponentRecord()` syncs directly into component + variant APIs
- `validateWorkspaceComponentRecord()` always returns success after fetch
- `publishWorkspaceComponentRecord()` returns existing component id and `revision: null`

Architecturally, these are **compatibility shims for the wizard flow**, not a strong first-class domain boundary.

Refs:

- `src-react/src/lib/api/component-api.ts`

---

## 11. Backend Component Model

## 11.1 Shared schema / contract model

Authoritative shared component schema lives in:

- `src-ts/src/core/schemas/component-library.schema.ts`

### Shared contract shape

#### Component

- `id`
- `canonicalKey`
- `displayLabel`
- `description`
- `scope`
- `symbolData`
- `variants[]`
- `defaultVariantId`
- `categoryPath`
- `tags`

#### Symbol data

- `referencePrefix`
- `pinDefinitions`
- `properties`
- `unitCount`
- `bodyGraphics`
- `rawKicadSource`
- `symbolTemplate`

#### Variant

- `canonicalCode`
- `humanLabel`
- aliases
- `mountType`
- `dimensions`
- `isDefault`
- `pinRemapTable`
- `footprintOptions[]`
- `defaultFootprintOptionId`

#### Footprint option

- `label`
- `kicadPayload`
- `model3dOptions`
- `densityLevel`
- `ipcName`

This contract is richer than the current storage model.

Refs:

- `src-ts/src/core/schemas/component-library.schema.ts`

---

## 11.2 DB storage model

Current storage tables:

### `components`

- canonical key
- display label
- description
- scope
- symbol data JSON
- default variant id
- category path
- tags JSON

### `component_variants`

- component id
- canonical code
- human label
- aliases
- mount type
- dimensions
- is default
- pin remap table
- `footprintPayload`
- `defaultFootprintId`

### `component_usage`

- component id
- design id
- variant id

Refs:

- `src-ts/src/db/schema/component.ts`
- `src-ts/src/db/schema/component-variant.ts`

---

## 11.3 Backend limitation: footprint model mismatch

This is one of the clearest current mismatches.

### Shared schema says

- one variant can have **multiple footprint options**
- footprints can include model3d options, density level, IPC name

### DB currently stores

- one `footprintPayload`
- one `defaultFootprintId`

### Controller workaround

`component-controller.ts` synthesizes a `footprintOptions` array by wrapping the single stored footprint payload into a one-item default footprint response.

This keeps frontend contract stable, but it means current persistence is effectively **single-footprint-per-variant**, while shared contracts and some frontend code operate as if the model were richer.

Refs:

- `src-ts/src/transport/controllers/component-controller.ts`
- `src-ts/src/db/schema/component-variant.ts`
- `src-ts/src/core/schemas/component-library.schema.ts`

---

## 11.4 Backend route surface and semantics

Current component-related backend surface includes:

- `GET /api/components`
- `POST /api/components`
- `GET /api/components/:id`
- `PATCH /api/components/:id`
- `DELETE /api/components/:id`
- `GET /api/components/:id/delete-impact`
- `POST /api/components/bulk-delete`
- variant CRUD routes
- default variant route
- import parse/import routes

### Current semantics

- create/update accept loose input and normalize in controller
- delete blocks if used, unless `force=true`
- bulk delete skips used/not-found until confirmed
- variant routes are component-scoped and membership-checked
- create injects placeholder variant if needed
- removing last variant is blocked

Refs:

- `src-ts/src/transport/controllers/component-controller.ts`
- `src-ts/src/db/repositories/component-repository.ts`

---

## 12. Design Persistence and Delete-Impact Semantics

## 12.1 Design content persistence

Persisted schematic content is saved as a full JSON blob in `design_sheet.content`.

Save/load is handled by `DesignService`:

- validates the design exists
- enforces 5MB serialized content limit
- hashes serialized content
- upserts one row per `(designId, sheetIndex)`
- updates parent design `updatedAt`

Refs:

- `src-ts/src/domain/services/design-service.ts`

---

## 12.2 Delete-impact logic

Delete impact is implemented in `ComponentRepository.getDeleteImpact()`.

### Current behavior

It scans all non-deleted design sheets and looks at persisted schematic symbol content.

It considers a design as using a component if any symbol matches by:

- `libraryPartId === componentId`
- or `properties.component_id === componentId`
- or legacy-like `properties.componentId === componentId`

### Important architectural implication

Delete impact is based on **document-content scanning**, not on the `component_usage` table.

This means there are currently **two parallel notions of usage** in the backend:

1. `component_usage` table
2. actual sheet JSON scan

In explored active semantics, delete impact trusts the **sheet JSON**.

Refs:

- `src-ts/src/db/repositories/component-repository.ts`
- `src-ts/src/db/repositories/component-repository.test.ts`

---

## 12.3 Current deletion policy across Library and Designer

Current policy is:

- attempt delete
- if component is in use, show conflict/usage info
- user may confirm force delete
- existing placed instances remain in designs

This is reflected consistently in:

- library UI messaging
- backend delete semantics
- designer missing-link fallback behavior

Architecturally, current system chooses **degraded continuity** over hard prevention.

---

## 13. Current Features by Area

## 13.1 Designer current features

- open/load schematic content
- create unsaved workspace draft
- save schematic content
- designer tab shell
- place power symbols (GND/VCC)
- place library-backed components
- generate references on placement
- wire creation with waypoints
- symbol selection and drag move
- multi-select
- delete selected entities
- grid presets and snap behavior
- zoom/pan/reset viewport
- floating symbol popover
- static layer list
- placeholder AI side panel

## 13.2 Library current features

- list components
- search
- single mount filter
- selection / select all
- single delete with impact preview
- bulk delete with conflict/force path
- import launch
- create via wizard
- detail page with symbol/footprint/3D preview blocks
- shallow metadata edit on detail page
- variant selection in detail page
- footprint-option selection in detail page

## 13.3 Backend/library platform current features

- canonical component CRUD
- variant CRUD
- default variant support
- list filtering by search/category/tags/mount type at API level
- delete impact API
- bulk delete API
- design content persistence
- component import parsing/execution API

---

## 14. Key Architectural Strengths

### 1. Runtime canonical resolution already exists

The most architecturally valuable current feature is that Designer already treats library data as canonical runtime source of truth.

### 2. Missing-link degradation exists

The system can open designs even after component deletion or library mismatch.

### 3. Rich editor work is already substantial

`ComponentEditor` is real, tested, and already aligned with a more direct editing model.

### 4. Test coverage defines many current semantics clearly

Important integration rules are encoded in tests, reducing ambiguity for refactor planning.

### 5. Shared contracts already describe a richer component domain

Even though storage lags, schema shape provides a useful direction for future convergence.

---

## 15. Main Architectural Problems and Transitional Seams

## 15.1 Split authoring architecture

The active UX is split across:

- wizard for create
- detail page for shallow edit
- hidden rich editor for full edit/create

This is the single largest frontend architecture inconsistency.

## 15.2 Mixed persistence/link formats

Current link information is split across:

- `libraryPartId`
- `properties.component_id`
- `properties.variant_id`
- legacy tolerance for `properties.componentId`

## 15.3 Propagation logic is duplicated

Library changes are propagated into Designer from multiple entry points rather than through one synchronization boundary.

## 15.4 Schema/controller/storage mismatch

Shared contracts support a richer footprint model than current DB persistence.

## 15.5 Synthetic draft APIs still shape the UI

Wizard APIs still present a draft/publish model even though implementation is mostly direct canonical CRUD behind a shim layer.

## 15.6 Overloaded designer shell and store

`DesignScreen` and `useSchematicStore` both carry broad cross-cutting responsibility.

## 15.7 Parallel usage models in backend

`component_usage` exists, but delete-impact currently trusts document scanning.

---

## 16. Test Suite as Executable Specification

The following tests currently define important behavior better than prose comments do.

### Designer

- `src-react/src/stores/schematic-store.test.ts`
  - canonical resolution
  - missing-link persistence
  - placement reference semantics
- `src-react/src/components/pcb/canvas/SchematicCanvas.test.tsx`
  - selection, drag, wire behavior
- `src-react/src/components/pcb/drag-placement.test.tsx`
  - palette drag/drop placement behavior
- `src-react/src/components/pcb/canvas/viewport.test.ts`
  - coordinate/snap/fit rules
- `src-react/src/components/pcb/canvas/hit-test.test.ts`
  - hit precedence rules
- `src-react/src/screens/DesignScreen.test.tsx`
  - shell behavior, keyboard handling, load/retry

### Library

- `src-react/src/hooks/useComponents.test.ts`
  - filter forwarding and propagation semantics
- `src-react/src/screens/LibraryScreen.test.tsx`
  - active list UI assumptions
- `src-react/src/components/wizard/ComponentWizard.test.tsx`
  - draft/autosave/publish flow
- `src-react/src/components/editor/ComponentEditor.test.tsx`
  - rich editor create/edit/variant behavior

### Backend

- `src-ts/src/db/repositories/component-repository.test.ts`
  - CRUD, variant rules, delete-impact scan behavior
- `src-ts/src/transport/controllers/component-controller.test.ts`
  - route semantics and delete conflict/force behavior

---

## 17. Architect Takeaways

### Current strongest baseline

If the architecture effort wants a stable foundation, the best current anchor is:

> **Designer consumes a canonical workspace component library and re-resolves placed symbols against latest component state.**

That behavior already exists and is test-backed.

### Current weakest area

The most urgent convergence problem is:

> **Component Library authoring does not currently have one active canonical edit path.**

### Recommended interpretation of current state

Treat the system as:

- **runtime-canonical**
- **UI-transitional**
- **schema-ahead-of-storage**
- **link-stable-but-not-clean**
- **refactorable because semantics are test-backed**

---

## 18. Priority Issues for Future Architecture Work

These are not implementation proposals, just the most important issues exposed by the current baseline.

1. **Converge authoring flow**
   - choose the canonical editor path
   - remove split between wizard/detail/hidden editor

2. **Standardize persisted component references**
   - remove mixed/legacy formats

3. **Align storage with shared component contract**
   - especially footprint-option model

4. **Centralize library → designer propagation**
   - remove duplicated refresh side effects

5. **Decide deletion semantics for used components**
   - keep degradable force-delete or move to hard-block policy

6. **Resolve backend usage-source ambiguity**
   - document scan vs normalized usage index

---

## 19. Key File Reference Index

### Designer

- `src-react/src/screens/DesignScreen.tsx`
- `src-react/src/screens/design/DesignHeader.tsx`
- `src-react/src/stores/schematic-store.ts`
- `src-react/src/components/pcb/types.ts`
- `src-react/src/components/pcb/palette/ComponentPalette.tsx`
- `src-react/src/components/pcb/symbol-library.ts`
- `src-react/src/components/pcb/canvas/SchematicCanvas.tsx`
- `src-react/src/components/pcb/canvas/viewport.ts`
- `src-react/src/components/pcb/canvas/hit-test.ts`
- `src-react/src/components/pcb/canvas/wires.ts`
- `src-react/src/components/pcb/canvas/symbols.ts`
- `src-react/src/components/pcb/properties/FloatingPropertiesPopover.tsx`

### Library

- `src-react/src/screens/LibraryScreen.tsx`
- `src-react/src/components/library/ComponentDetailPage.tsx`
- `src-react/src/components/wizard/ComponentWizard.tsx`
- `src-react/src/stores/component-wizard-store.ts`
- `src-react/src/components/editor/ComponentEditor.tsx`
- `src-react/src/components/editor/ComponentVariantManager.tsx`
- `src-react/src/components/editor/component-variant-buffer.ts`
- `src-react/src/hooks/useComponents.ts`
- `src-react/src/lib/api/component-api.ts`

### Backend / Shared contracts

- `src-ts/src/core/schemas/component-library.schema.ts`
- `src-ts/src/core/schemas/pcb-project.schema.ts`
- `src-ts/shared/types/pcb.types.ts`
- `src-ts/src/transport/controllers/component-controller.ts`
- `src-ts/src/db/repositories/component-repository.ts`
- `src-ts/src/db/schema/component.ts`
- `src-ts/src/db/schema/component-variant.ts`
- `src-ts/src/domain/services/design-service.ts`

### Tests

- `src-react/src/stores/schematic-store.test.ts`
- `src-react/src/components/pcb/canvas/SchematicCanvas.test.tsx`
- `src-react/src/components/pcb/drag-placement.test.tsx`
- `src-react/src/components/pcb/canvas/viewport.test.ts`
- `src-react/src/components/pcb/canvas/hit-test.test.ts`
- `src-react/src/screens/DesignScreen.test.tsx`
- `src-react/src/hooks/useComponents.test.ts`
- `src-react/src/screens/LibraryScreen.test.tsx`
- `src-react/src/components/wizard/ComponentWizard.test.tsx`
- `src-react/src/components/editor/ComponentEditor.test.tsx`
- `src-ts/src/db/repositories/component-repository.test.ts`
- `src-ts/src/transport/controllers/component-controller.test.ts`

---

## 20. Bottom Line

Current OpenPCB already has a meaningful Designer ↔ Library integration model in production code:

- library-backed placement works
- canonical re-resolution works
- missing-link survival works
- save/load works

The main architectural problem is not absence of capability.  
It is **lack of convergence**:

- too many authoring paths
- too many compatibility layers
- too many partially overlapping models

That makes the current codebase a good baseline for architecture work: the important behavior exists, but the ownership boundaries are not yet clean.
