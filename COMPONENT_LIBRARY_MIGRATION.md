# ComponentLibrary Migration - Exhaustive File & Directory Inventory

**Generated**: 2026-04-08
**Repository**: /Users/andrejvysny/andrejvysny/OpenPCB
**Target Architecture**: Per src-react/TARGET_ARCHITECTURE.md
**Scope**: All files related to ComponentLibrary migration including library browser, symbol/footprint editors, part picker, KiCad import, component search, database schemas, services, stores, hooks, and related UI/rendering.

---

## 1. EXHAUSTIVE PATH LIST (Grouped by Area)

### 1.1 FRONTEND REACT - Current Locations (src-react/src)

#### Library Browser & Component Display
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/library/CategoryTree.tsx` (library tree navigation)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/library/ComponentDetailPage.tsx` (main component detail view)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/library/ComponentDetailPage.test.tsx`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/library/ComponentDetailPanel.tsx` (detail sidebar)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/library/PinTable.tsx` (pin display)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/library/Model3dPlaceholder.tsx` (3D model placeholder)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/library/symbolDataDisplay.ts` (symbol rendering)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/library/index.ts` (barrel export)

#### Symbol Editor
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/symbol-editor/SymbolEditorToolbar.tsx` (toolbar)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/symbol-editor/SymbolMetadataEditor.tsx` (metadata form)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/symbol-editor/PinPalette.tsx` (pin palette UI)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/symbol-editor/PinPropertiesPanel.tsx` (pin props)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/symbol-editor/symbol-editor-store.ts` (Zustand state)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/symbol-editor/viewport.ts` (camera/viewport logic)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/symbol-editor/types.ts` (SymbolDraft, SymbolPin types)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/symbol-editor/kicad-import.ts` (KiCad symbol parser wrapper)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/symbol-editor/kicad-import.test.ts`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/symbol-editor/import-normalization.ts` (import data normalization)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/symbol-editor/tools/pin-tools.ts` (pin editing tools)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/symbol-editor/tools/drawing-tools.ts` (drawing tools)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/symbol-editor/index.ts` (barrel export)

#### Footprint Editor
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/footprint-editor/FootprintEditorToolbar.tsx` (toolbar)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/footprint-editor/FootprintEditorStep.tsx` (editor view)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/footprint-editor/FootprintPresetSelector.tsx` (IPC preset selector)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/footprint-editor/PresetConfigPanel.tsx` (preset configuration)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/footprint-editor/DensitySelector.tsx` (IPC density level)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/footprint-editor/PadPropertiesPanel.tsx` (pad properties)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/footprint-editor/footprint-editor-store.ts` (Zustand state)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/footprint-editor/viewport.ts` (camera/viewport)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/footprint-editor/types.ts` (FootprintDraft, Pad types)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/footprint-editor/preset-utils.ts` (IPC preset calculations)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/footprint-editor/render-utils.ts` (rendering helpers)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/footprint-editor/import-utils.ts` (import/STEP parsing)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/footprint-editor/import-utils.test.ts`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/footprint-editor/index.ts` (barrel export)

#### Component Wizard (Creation Flow)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/wizard/ComponentWizard.tsx` (main wizard container)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/wizard/ComponentWizard.test.tsx`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/wizard/SpecsStep.tsx` (specifications step)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/wizard/ModelStep.tsx` (3D model step)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/wizard/VariantListPanel.tsx` (variant management)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/wizard/VariantMetadataForm.tsx` (variant form)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/wizard/ValidationPanel.tsx` (validation feedback)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/wizard/transformers.ts` (data transformations)

#### Component Editor (View/Edit Published)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/editor/ComponentEditor.tsx` (editor container)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/editor/ComponentEditor.test.tsx`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/editor/ComponentVariantManager.tsx` (variant mgmt)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/editor/component-variant-buffer.ts` (draft buffer)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/editor/symbol-data-buffer.ts` (symbol draft buffer)

#### Unified Import (KiCad/Zip Import UI)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/unified-import/UnifiedImportModal.tsx` (import modal)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/unified-import/index.ts`

#### PCB & Symbol Rendering (Model Integration)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/pcb/symbol-library.ts` (symbol index/lookup)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/pcb/symbol-library.test.ts`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/pcb/symbol-display.ts` (symbol rendering to canvas)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/pcb/canvas/symbols.ts` (symbol canvas primitives)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/pcb/canvas/symbols.test.ts`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/pcb/canvas/canvas2d-symbol-rendering.ts` (2D rendering)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/pcb/palette/ComponentPalette.tsx` (schematic/PCB component palette)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/lib/render-engine/symbol-graphics.ts` (R3F symbol rendering)

#### Render Engine Adapters (R3F for Symbol/Footprint Preview)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/lib/render-engine/adapters/SymbolPreviewR3F.tsx` (symbol 3D preview)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/lib/render-engine/adapters/SymbolPreviewR3F.test.tsx`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/lib/render-engine/adapters/SymbolEditorCanvasR3F.tsx` (editor canvas)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/lib/render-engine/adapters/SymbolEditorCanvasR3F.test.tsx`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/lib/render-engine/adapters/FootprintPreviewR3F.tsx` (footprint 3D preview)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/lib/render-engine/adapters/FootprintPreviewR3F.test.tsx`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/lib/render-engine/adapters/FootprintEditorCanvasR3F.tsx` (editor canvas)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/lib/render-engine/adapters/FootprintEditorCanvasR3F.test.tsx`

#### API Client & Hooks
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/lib/api/component-api.ts` (HTTP client for components, ~672 lines)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/hooks/useComponents.ts` (component CRUD hook)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/hooks/useComponents.test.ts`

#### Stores
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/stores/component-wizard-store.ts` (Zustand wizard state, ~473 lines)

#### Screens
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/screens/LibraryScreen.tsx` (main library/component browser screen)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/screens/LibraryScreen.test.tsx`

#### Type Definitions (Shared)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/occt-import-js.d.ts` (STEP import types)

**Total Frontend Lines**: ~10,564 lines across editors + library

---

### 1.2 BACKEND TS - Current Locations (src-ts/src)

#### Domain Services
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/domain/services/component-family-service.ts` (family management)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/domain/services/component-import-service.ts` (import orchestration)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/domain/services/component-import-service.test.ts`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/domain/services/component-import-heuristics.ts` (import heuristics)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/domain/services/component-import-heuristics.test.ts`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/domain/services/component-validation-service.ts` (validation)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/domain/services/component-validation-service.test.ts`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/domain/services/component-zip-import-service.ts` (ZIP handling)

#### Transport/HTTP Controllers
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/transport/controllers/component-controller.ts` (CRUD, list, search)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/transport/controllers/component-controller.test.ts`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/transport/controllers/component-family-controller.ts` (family CRUD)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/transport/controllers/component-family-controller.test.ts`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/transport/controllers/component-import-controller.ts` (import endpoints)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/transport/controllers/component-import-controller.test.ts`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/transport/controllers/component-preset-controller.ts` (IPC presets)

#### Database Repositories
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/db/repositories/component-repository.ts` (component CRUD, listing, filtering)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/db/repositories/component-repository.test.ts`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/db/repositories/component-family-repository.ts` (family CRUD)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/db/repositories/component-family-repository.test.ts`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/db/repositories/component-draft-repository.ts` (draft storage)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/db/repositories/component-draft-repository.test.ts`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/db/repositories/component-import-job-repository.ts` (import jobs)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/db/repositories/component-provenance-repository.ts` (component provenance)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/db/repositories/preset-catalog-repository.ts` (IPC preset catalog)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/db/repositories/preset-catalog-repository.test.ts`

#### Database Schemas
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/db/schema/component.ts` (component table)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/db/schema/component-variant.ts` (variant table)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/db/schema/component-family.ts` (family table)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/db/schema/component-draft.ts` (draft table)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/db/schema/component-revision.ts` (revision table)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/db/schema/component-import-job.ts` (import job table)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/db/schema/component-provenance.ts` (provenance table)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/db/schema/footprint-option.ts` (footprint variant options)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/db/schema/model-3d-option.ts` (3D model options)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/db/schema/manufacturer-offering.ts` (manufacturer SKU linking)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/db/schema/preset-catalog.ts` (IPC preset catalog)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/db/schema/preset-variant.ts` (preset variant)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/db/schema/package-variant.ts` (package variant)

#### KiCad Parsing Infrastructure
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/infrastructure/parsers/kicad/kicad-symbol-parser.ts` (~main parser)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/infrastructure/parsers/kicad/kicad-symbol-parser.test.ts`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/infrastructure/parsers/kicad/kicad-symbol-parser.format.test.ts`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/infrastructure/parsers/kicad/kicad-footprint-parser.ts` (~main parser)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/infrastructure/parsers/kicad/kicad-footprint-parser.test.ts`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/infrastructure/parsers/kicad/kicad-footprint-parser.format.test.ts`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/infrastructure/parsers/kicad/kicad-model-linker.ts` (3D model linking)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/infrastructure/parsers/kicad/kicad-model-linker.test.ts`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/infrastructure/parsers/kicad/sexpr-parser.ts` (S-expression parser)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/infrastructure/parsers/kicad/kicad-fixtures.test.ts` (test fixtures)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/infrastructure/parsers/kicad/__fixtures__/` (fixture files)

#### Seeding & Presets
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/db/seed/builtin-component-families.ts` (built-in families)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/db/seed/ipc-preset-catalog.ts` (IPC preset seeding)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/domain/services/preset-catalog-service.ts` (preset service)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/domain/services/preset-catalog-service.test.ts`

#### Model Cache
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/infrastructure/cache/model-load-cache.ts` (3D model cache)

---

### 1.3 SHARED TYPES (src-ts/shared)

- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/shared/types/component-library.types.ts` (main types: Component, Variant, etc.)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/shared/types/component-library-schema.types.ts` (schema-derived types)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/shared/types/component-semantics.types.ts` (semantic helpers)

#### Schemas (Core)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/core/schemas/component-library.schema.ts` (Zod schema)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/core/schemas/component-library.schema.test.ts`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/core/schemas/component-semantics.ts`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-ts/src/core/schemas/component-semantics.test.ts`

---

### 1.4 EXISTING MODULE (Stub)

- `/Users/andrejvysny/andrejvysny/OpenPCB/modules/component-library/manifest.json` (module manifest)
- `/Users/andrejvysny/andrejvysny/OpenPCB/modules/component-library/ts/module.ts` (module entry - minimal)
- `/Users/andrejvysny/andrejvysny/OpenPCB/modules/component-library/react/Space.tsx` (module UI entry - minimal)

---

### 1.5 RELATED FILES (Not directly ComponentLibrary but used by it)

#### PCB Editor Integration
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/pcb-editor/schematic-pcb-sync.ts` (syncs symbols with components)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/pcb-editor/schematic-pcb-sync.test.ts`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/pcb-editor/ratsnest.test.ts`

#### 3D Viewer/Model Loading
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/stores/model-loading-store.ts` (3D model async state)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/ai-elements/model-selector.tsx` (model selector UI)

#### IPC 7351 Footprint Generator
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/lib/ipc-7351/calculator.ts` (IPC calculations)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/lib/ipc-7351/calculator.test.ts`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/lib/ipc-7351/fillet-tables.ts`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/lib/ipc-7351/naming.ts`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/lib/ipc-7351/types.ts`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/lib/ipc-7351/index.ts`

#### Test Harnesses
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/testing/SymbolEditorE2EHarness.tsx` (symbol editor test harness)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/testing/FootprintEditorE2EHarness.tsx` (footprint test harness)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/testing/PcbEditorE2EHarness.tsx` (full PCB harness)

#### Router Integration
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/layout/ScreenRouter.tsx` (routes to ComponentDetailPage)

---

## 2. AMBIGUOUS FILES REQUIRING DECISION

### 2.1 IPC 7351 Utilities (Generic Footprint Generation)
**Files**: 
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/lib/ipc-7351/*`

**Question**: Should IPC 7351 stay in `src-react/src/lib/` (reusable across modules) or move into `modules/component-library/react/lib/`?

**Recommendation**: **KEEP in core/react/lib/** — IPC 7351 is a generic calculation library used by footprint-editor and potentially by other design modules. It's not inherently component-library specific.

---

### 2.2 Symbol/Footprint Render Adapters in render-engine
**Files**:
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/lib/render-engine/adapters/SymbolPreviewR3F.tsx`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/lib/render-engine/adapters/SymbolEditorCanvasR3F.tsx`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/lib/render-engine/adapters/FootprintPreviewR3F.tsx`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/lib/render-engine/adapters/FootprintEditorCanvasR3F.tsx`

**Question**: Are these designer-owned (R3F rendering infrastructure) or component-library-owned?

**Recommendation**: **MOVE to modules/component-library/react/components/render/** — These are ComponentLibrary-specific UI adapters for rendering symbols/footprints. Designer has its own PCB/Schematic adapters; component library needs previews.

---

### 2.3 PCB Symbol Integration Files
**Files**:
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/pcb/symbol-library.ts` (symbol index)
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/components/pcb/symbol-display.ts` (symbol to canvas)

**Question**: Designer or ComponentLibrary?

**Recommendation**: **MOVE to modules/designer/react/components/** (Designer owns the PCB/schematic rendering layer; these are rendering infrastructure). ComponentLibrary provides the data; Designer consumes it.

---

### 2.4 Model Loading Store
**File**: `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/stores/model-loading-store.ts`

**Question**: Core app state or ComponentLibrary state?

**Recommendation**: **MOVE to modules/component-library/react/stores/** — 3D model loading is specific to ComponentLibrary's editing/viewing; other modules don't load 3D models for components.

---

### 2.5 Component API Client
**File**: `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/lib/api/component-api.ts`

**Question**: App-level or ComponentLibrary-specific?

**Recommendation**: **DELETE & replace with SDK HTTP calls** — In the modular architecture, modules make HTTP calls through their own handlers. This generic component-api becomes obsolete. Keep as a utility during migration, then migrate each consumer to direct SDK use.

---

### 2.6 Test Harnesses
**Files**:
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/testing/SymbolEditorE2EHarness.tsx`
- `/Users/andrejvysny/andrejvysny/OpenPCB/src-react/src/testing/FootprintEditorE2EHarness.tsx`

**Question**: Keep in app-level testing or move to ComponentLibrary?

**Recommendation**: **MOVE to modules/component-library/tests/** (or keep as reference in old location during migration, then remove). These are ComponentLibrary E2E test utilities.

---

## 3. RECOMMENDED TARGET PATHS (Per TARGET_ARCHITECTURE.md)

### 3.1 Module Structure: modules/component-library/

```
modules/component-library/
├── sdk/
│   ├── index.ts                 # ComponentLibrarySDK interface + re-exports
│   ├── types.ts                 # Part, Symbol, Footprint, SearchParams, MountType
│   └── components.ts            # React UI exports (PartPickerDialog, etc.)
│
├── react/                       # Frontend code
│   ├── screens/
│   │   ├── LibraryBrowser.tsx   # Browse/search parts
│   │   ├── SymbolEditor.tsx     # Create/edit schematic symbols
│   │   ├── FootprintEditor.tsx  # Create/edit PCB footprints
│   │   └── ComponentEditor.tsx  # View/edit published components
│   │
│   ├── stores/
│   │   ├── library.store.ts     # Library state, search, active lib
│   │   ├── symbol-editor.store.ts
│   │   ├── footprint-editor.store.ts
│   │   ├── component-wizard.store.ts
│   │   └── model-loading.store.ts
│   │
│   ├── components/
│   │   ├── library-browser/
│   │   │   ├── CategoryTree.tsx
│   │   │   ├── ComponentDetailPage.tsx
│   │   │   ├── ComponentDetailPanel.tsx
│   │   │   ├── PinTable.tsx
│   │   │   └── Model3dPlaceholder.tsx
│   │   │
│   │   ├── symbol-editor/
│   │   │   ├── SymbolEditorToolbar.tsx
│   │   │   ├── SymbolMetadataEditor.tsx
│   │   │   ├── PinPalette.tsx
│   │   │   ├── PinPropertiesPanel.tsx
│   │   │   ├── viewport.ts
│   │   │   ├── types.ts
│   │   │   ├── tools/
│   │   │   │   ├── pin-tools.ts
│   │   │   │   └── drawing-tools.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── footprint-editor/
│   │   │   ├── FootprintEditorToolbar.tsx
│   │   │   ├── FootprintEditorStep.tsx
│   │   │   ├── FootprintPresetSelector.tsx
│   │   │   ├── PresetConfigPanel.tsx
│   │   │   ├── DensitySelector.tsx
│   │   │   ├── PadPropertiesPanel.tsx
│   │   │   ├── preset-utils.ts
│   │   │   ├── render-utils.ts
│   │   │   ├── import-utils.ts
│   │   │   ├── viewport.ts
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   │
│   │   ├── component-wizard/
│   │   │   ├── ComponentWizard.tsx
│   │   │   ├── SpecsStep.tsx
│   │   │   ├── ModelStep.tsx
│   │   │   ├── VariantListPanel.tsx
│   │   │   ├── VariantMetadataForm.tsx
│   │   │   ├── ValidationPanel.tsx
│   │   │   └── transformers.ts
│   │   │
│   │   ├── component-editor/
│   │   │   ├── ComponentEditor.tsx
│   │   │   ├── ComponentVariantManager.tsx
│   │   │   └── buffers/
│   │   │       ├── component-variant-buffer.ts
│   │   │       └── symbol-data-buffer.ts
│   │   │
│   │   ├── unified-import/
│   │   │   ├── UnifiedImportModal.tsx
│   │   │   └── kicad-import-wrapper.ts
│   │   │
│   │   ├── render/                # R3F adapters for previews
│   │   │   ├── SymbolPreviewR3F.tsx
│   │   │   ├── SymbolEditorCanvasR3F.tsx
│   │   │   ├── FootprintPreviewR3F.tsx
│   │   │   └── FootprintEditorCanvasR3F.tsx
│   │   │
│   │   └── part-picker/           # ★ Cross-module UI component
│   │       ├── PartPickerDialog.tsx
│   │       ├── PartCard.tsx
│   │       └── types.ts
│   │
│   ├── hooks/
│   │   ├── useComponents.ts
│   │   ├── useLibrarySearch.ts
│   │   ├── useKicadImport.ts
│   │   └── useSymbolEditor.ts
│   │
│   ├── lib/
│   │   ├── symbolDataDisplay.ts
│   │   ├── import-normalization.ts
│   │   └── kicad-import-client.ts  # Frontend KiCad parser wrapper
│   │
│   └── index.ts
│
├── backend/                     # TS business logic
│   ├── domain/
│   │   ├── models/
│   │   │   ├── component.ts     # Component definition
│   │   │   ├── symbol.ts        # Symbol (pins, graphics)
│   │   │   ├── footprint.ts     # Footprint (pads, courtyard)
│   │   │   ├── library-source.ts # Library source enum
│   │   │   ├── parameter.ts     # Parametric properties
│   │   │   └── preset.ts        # IPC preset
│   │   │
│   │   ├── services/
│   │   │   ├── library-manager.ts
│   │   │   ├── kicad-importer.ts     # Parse .kicad_sym, .kicad_mod
│   │   │   ├── part-search.ts        # Parametric search
│   │   │   ├── component-family-service.ts
│   │   │   ├── component-import-service.ts
│   │   │   ├── component-validation-service.ts
│   │   │   ├── component-zip-import-service.ts
│   │   │   └── preset-catalog-service.ts
│   │   │
│   │   └── repositories/
│   │       ├── component.repository.ts
│   │       ├── symbol.repository.ts
│   │       ├── footprint.repository.ts
│   │       ├── component-family.repository.ts
│   │       ├── component-draft.repository.ts
│   │       ├── component-import-job.repository.ts
│   │       └── preset-catalog.repository.ts
│   │
│   ├── tools/                   # AI-callable tools
│   │   ├── search-parts.tool.ts
│   │   ├── suggest-alternative.tool.ts
│   │   └── import-kicad.tool.ts
│   │
│   ├── handlers/
│   │   ├── library.handler.ts
│   │   ├── component.handler.ts
│   │   ├── component-family.handler.ts
│   │   ├── component-import.handler.ts
│   │   ├── component-preset.handler.ts
│   │   └── index.ts
│   │
│   ├── db/
│   │   └── schema.ts            # All component-library tables
│   │
│   └── index.ts
│
├── infrastructure/             # KiCad parsing (shared utils)
│   ├── parsers/
│   │   └── kicad/
│   │       ├── kicad-symbol-parser.ts
│   │       ├── kicad-footprint-parser.ts
│   │       ├── kicad-model-linker.ts
│   │       ├── sexpr-parser.ts
│   │       └── __fixtures__/
│   │
│   └── cache/
│       └── model-load-cache.ts
│
├── tests/
│   ├── e2e/
│   │   ├── SymbolEditorE2E.test.tsx
│   │   ├── FootprintEditorE2E.test.tsx
│   │   └── ComponentWizardE2E.test.tsx
│   └── integration/
│       ├── kicad-import.test.ts
│       └── component-service.test.ts
│
├── MODULE_MANIFEST.json
└── index.ts
```

---

### 3.2 Files to DELETE (not migrated)

- `src-react/src/lib/api/component-api.ts` (→ SDK HTTP calls)
- `src-react/src/components/library/` (→ `modules/component-library/react/components/library-browser/`)
- `src-react/src/components/symbol-editor/` (→ moved to module)
- `src-react/src/components/footprint-editor/` (→ moved to module)
- `src-react/src/components/wizard/` (→ moved to module)
- `src-react/src/components/editor/` (→ moved to module)
- `src-react/src/components/unified-import/` (→ moved to module)
- `src-react/src/stores/component-wizard-store.ts` (→ moved to module)
- `src-react/src/stores/model-loading-store.ts` (→ moved to module)
- `src-react/src/hooks/useComponents.ts` (→ SDK in module)
- `src-ts/src/domain/services/component-*.ts` (→ moved to module)
- `src-ts/src/transport/controllers/component-*.ts` (→ moved to module)
- `src-ts/src/db/repositories/component-*.ts` (→ moved to module)
- `src-ts/src/db/schema/component*.ts` (→ moved to module)
- `src-ts/src/infrastructure/parsers/kicad/` (→ moved to module)
- `src-ts/src/db/seed/builtin-component-families.ts` (→ moved to module)
- `src-ts/src/db/seed/ipc-preset-catalog.ts` (→ moved to module)
- `src-ts/shared/types/component-library*.ts` (→ `modules/component-library/sdk/types.ts`)
- `src-ts/src/core/schemas/component-*.ts` (→ moved to module)

---

### 3.3 Files to KEEP in core/ (Not migrated)

- `src-react/src/lib/ipc-7351/` (→ reusable utility, used by component-library but generic)
- `src-react/src/components/pcb/symbol-library.ts` (→ Designer owns rendering)
- `src-react/src/components/pcb/symbol-display.ts` (→ Designer owns rendering)
- `src-react/src/components/pcb-editor/*` (→ Designer module responsibility)
- `src-react/src/screens/LibraryScreen.tsx` needs routing wiring, but screen logic moves to module

---

### 3.4 HTTP Handler Routing in modules/component-library/backend/handlers/index.ts

```typescript
// Hono router registration pattern per TARGET_ARCHITECTURE.md

export function registerComponentLibraryHandlers(router: Hono) {
  // Component CRUD
  router.get('/api/v1/components', ComponentHandler.list);
  router.get('/api/v1/components/:id', ComponentHandler.get);
  router.post('/api/v1/components', ComponentHandler.create);
  router.put('/api/v1/components/:id', ComponentHandler.update);
  router.delete('/api/v1/components/:id', ComponentHandler.delete);

  // Component Family
  router.get('/api/v1/component-families', ComponentFamilyHandler.list);
  router.post('/api/v1/component-families', ComponentFamilyHandler.create);

  // Variants
  router.post('/api/v1/components/:id/variants', VariantHandler.create);
  router.put('/api/v1/components/:id/variants/:variantId', VariantHandler.update);

  // Import
  router.post('/api/v1/import/kicad', ImportHandler.importKicad);
  router.post('/api/v1/import/zip', ImportHandler.importZip);

  // Presets
  router.get('/api/v1/presets', PresetHandler.list);

  // Search
  router.get('/api/v1/components/search', ComponentHandler.search);
}
```

---

### 3.5 SDK Interface (modules/component-library/sdk/index.ts)

```typescript
export interface ComponentLibrarySDK {
  // Part resolution
  resolvePart(libraryRef: string): Promise<Part>;
  getSymbol(symbolId: string): Promise<Symbol>;
  getFootprint(footprintId: string): Promise<Footprint>;

  // Search
  searchParts(params: PartSearchParams): Promise<PartSearchResult>;
  suggestAlternative(partId: string): Promise<Part[]>;

  // Library management
  getLibrarySources(): Promise<LibrarySource[]>;
  importKicadLibrary(path: string): Promise<ImportResult>;

  // Component CRUD
  getComponent(id: string): Promise<Component>;
  listComponents(filters?: ComponentFilter): Promise<Component[]>;
  createComponent(data: CreateComponentInput): Promise<Component>;
  updateComponent(id: string, data: UpdateComponentInput): Promise<Component>;
  deleteComponent(id: string): Promise<void>;

  // Component Family
  getFamily(id: string): Promise<ComponentFamily>;
  listFamilies(): Promise<ComponentFamily[]>;
}

// Re-export React components for cross-module use
export { PartPickerDialog } from '../react/components/part-picker/PartPickerDialog';
export type { PartPickerProps } from '../react/components/part-picker/PartPickerDialog';
```

---

### 3.6 Import Changes for Consumers

**BEFORE** (current):
```typescript
import { ComponentDetailPage } from "@/components/library/ComponentDetailPage";
import { SymbolEditor } from "@/components/symbol-editor";
import { component-api } from "@/lib/api/component-api";
```

**AFTER** (modular):
```typescript
import { ComponentDetailPage } from '@openpcb/component-library/react/screens';
import { SymbolEditor } from '@openpcb/component-library/react/components/symbol-editor';
import type { ComponentLibrarySDK } from '@openpcb/component-library/sdk';

// In Designer module (cross-module SDK use)
const libSDK = container.resolve<ComponentLibrarySDK>('ComponentLibrarySDK');
```

---

## 4. MIGRATION STRATEGY

### Phase 1: Create Module Structure (Week 1)
1. Create `/modules/component-library/{sdk,react,backend,infrastructure}/` directories
2. Create `/modules/component-library/MODULE_MANIFEST.json` with proper config
3. Move type files → `sdk/types.ts`
4. Create SDK interface → `sdk/index.ts`

### Phase 2: Move Backend (Week 2)
1. Move all `src-ts/src/domain/services/component-*` → `modules/component-library/backend/domain/services/`
2. Move all `src-ts/src/db/schema/component*.ts` → `modules/component-library/backend/db/schema.ts`
3. Move all repositories → `modules/component-library/backend/domain/repositories/`
4. Move KiCad parsers → `modules/component-library/infrastructure/parsers/kicad/`
5. Implement handlers in `modules/component-library/backend/handlers/`

### Phase 3: Move Frontend (Week 3)
1. Move React components → `modules/component-library/react/components/`
2. Move stores → `modules/component-library/react/stores/`
3. Move hooks → `modules/component-library/react/hooks/`
4. Create screens → `modules/component-library/react/screens/`
5. Move render adapters → `modules/component-library/react/components/render/`

### Phase 4: Wiring & SDK (Week 4)
1. Implement SDK in `sdk/index.ts`
2. Wire HTTP handlers → Hono router
3. Update DI container in `core/backend/kernel/init.ts`
4. Update router in `core/react/router/module-routes.ts`
5. Delete old files from `src-react/src/` and `src-ts/src/`
6. Update all imports in other modules (Designer, AIService, etc.)

### Phase 5: Testing (Week 5)
1. Update test imports
2. E2E tests for each editor
3. Integration tests for import flow
4. Cross-module SDK testing

---

## 5. UNRESOLVED QUESTIONS & OPEN DECISIONS

1. **3D Model Streaming**: Should 3D model loading be part of SDK or separate HTTP service?

2. **Part Search Index**: Use SQLite FTS5 (current) or external search service (e.g., Meilisearch)?

3. **Symbol/Footprint Caching**: In-memory cache or persistent cache layer?

4. **Variant Inheritance**: Do variants inherit from family defaults or are they fully independent?

5. **Component Revisions**: Track full revision history or just latest + drafts?

6. **Import Conflict Resolution**: How to handle duplicate component names during KiCad import?

7. **AI Tool Integration**: Should component search/suggest be AI tools or just HTTP endpoints?

8. **Preset Library**: Built-in only or allow user to create custom IPC presets?

9. **3D Model Format Support**: Only STEP, or also IGES, VRML, etc.?

10. **Database Migrations**: Run in module or as shared migration in core/backend/db/migrations/?

---

**Total Files Involved**: ~115+ files
**Total Lines**: ~50,000+ lines (estimated)
**Complexity**: High (many interdependencies, multiple rendering layers)
**Estimated Effort**: 3-4 weeks with dedicated team
