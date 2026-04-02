# PHASE 1 — Component Library Implementation Plan

**Scope**: Component Library end-to-end: DB upgrade, Wizard multi-variant support, built-in component seeding, reference format standardization, detail page cleanup.

**Acceptance criteria**:

1. Component library is fully working — list, search, filter, create, inspect, delete.
2. User can create new components via the Component Wizard with a custom-drawn schematic symbol + one or more footprint variants.
3. A component can hold multiple variants (e.g. 0402, 0805, through-hole) — each variant has its own footprint and mount type.
4. Built-in components exist on first startup: GND, VCC, Generic Resistor (with 0402, 0805, 1206 SMD + through-hole variants).
5. Placed schematic symbols use a single standardized reference format (`componentId` + `variantId` at top level).
6. Detail page is read-only (inspect + delete only). All editing goes through the Wizard.

**Out of scope for Phase 1**: PCB view, undo/redo, net labels, netlist generation, properties panel in schematic editor, keyboard shortcuts beyond what exists.

---

## Architecture decisions (locked)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Primary authoring surface | **ComponentWizard** — fix & extend | Already functional with working symbol + footprint sub-editors. Lower risk than routing the hidden ComponentEditor. |
| DB footprint model | **Upgrade to `footprintOptions[]` array** | Eliminates schema/storage mismatch now. Avoids technical debt compounding when PCB view is added later. |
| Built-in component delivery | **Seed DB on first startup from KiCad files** | Reuses existing KiCad parser. Single source of truth in `.kicad_sym` / `.kicad_mod` files. |
| Variant semantics | **Variant = package + mount type** | One variant can be "0805 SMD", another "axial through-hole". Covers all passive component use cases. |
| Edit story | **Detail page = read-only inspect. Edit = reopen Wizard pre-filled.** | Avoids split authoring. Single canonical edit path. |
| Reference format | **Standardize to top-level `componentId` + `variantId`** | Remove mixed `libraryPartId` / `properties.component_id` / `properties.variant_id` formats. |

---

## Work breakdown

Phase 1 contains **6 milestones** executed in dependency order.

```
M1 ──→ M2 ──→ M3 ──→ M4
               ↑       ↑
               M5 ─────┘
               ↑
               M6
```

- **M1**: DB migration (footprintOptions[]) — blocks everything
- **M2**: Backend API alignment — depends on M1
- **M3**: Wizard multi-variant support — depends on M2
- **M4**: Built-in component seeding — depends on M2, M5
- **M5**: Reference format standardization — can start in parallel with M3
- **M6**: Detail page cleanup — depends on M3

---

## M1 — DB migration: footprintOptions[]

**Goal**: Upgrade `component_variants` table so each variant stores an array of footprint options instead of a single footprint payload. Align DB with the shared contract in `component-library.schema.ts`.

**Estimated effort**: 1–2 days

### Current state

`component_variants` table has:

```
footprintPayload  JSON     -- single footprint object
defaultFootprintId TEXT     -- single default id
```

The shared schema in `component-library.schema.ts` already defines:

```typescript
footprintOptions: FootprintOption[];  // array
defaultFootprintOptionId: string;
```

The controller in `component-controller.ts` currently wraps the single payload into a one-item array to satisfy the frontend contract.

### Target state

`component_variants` table becomes:

```
footprintOptions   JSON     -- array of FootprintOption objects
defaultFootprintOptionId TEXT
```

Each `FootprintOption` object in the array:

```typescript
{
  id: string;           // UUID, generated on creation
  label: string;        // "IPC nominal", "Hand solder", etc.
  kicadPayload: object; // parsed .kicad_mod content
  densityLevel?: "nominal" | "most" | "least";
  ipcName?: string;
}
```

### Tasks

#### M1.1 — Write DB migration

- **File**: new migration file in DB migrations directory
- **Action**: 
  - Add column `footprintOptions` (JSON, default `'[]'`)
  - Add column `defaultFootprintOptionId` (TEXT, nullable)
  - Migrate existing data: for each row where `footprintPayload` is not null, wrap it into a single-item `footprintOptions` array with a generated UUID as `id` and `"default"` as `label`. Set `defaultFootprintOptionId` to that UUID.
  - Drop columns `footprintPayload` and `defaultFootprintId`
- **Rollback**: reverse column operations
- **Test**: migration up/down on a DB with existing variant rows

#### M1.2 — Update DB schema definition

- **File**: `src-ts/src/db/schema/component-variant.ts`
- **Action**: replace `footprintPayload` and `defaultFootprintId` columns with `footprintOptions` and `defaultFootprintOptionId`
- **Test**: TypeScript compiles, existing repository tests still pass after update

#### M1.3 — Update repository layer

- **File**: `src-ts/src/db/repositories/component-repository.ts`
- **Action**:
  - Update all variant CRUD methods to read/write `footprintOptions` array
  - `createVariant()`: accept `footprintOptions[]`, generate UUIDs for options if not provided, set `defaultFootprintOptionId` to first option's id if not specified
  - `updateVariant()`: accept full `footprintOptions[]` replacement
  - Remove any single-footprint-to-array wrapping logic
- **Test**: update `component-repository.test.ts`:
  - Create variant with 0 footprint options → succeeds (empty array)
  - Create variant with 1 footprint option → default set automatically
  - Create variant with 3 footprint options → all stored, default correct
  - Update variant: add/remove/reorder footprint options
  - Read variant: `footprintOptions` is always an array

### Acceptance

- [ ] Migration runs without error on existing DB
- [ ] Existing variants are preserved with their footprint data intact
- [ ] Repository CRUD works with `footprintOptions[]`
- [ ] All existing `component-repository.test.ts` tests pass (updated for new schema)

---

## M2 — Backend API alignment

**Goal**: Update the controller layer to work natively with `footprintOptions[]` and remove the compatibility shim. Ensure the API contract matches the shared schema exactly.

**Estimated effort**: 1–2 days

### Current state

`component-controller.ts` synthesizes a `footprintOptions` array by wrapping the single stored footprint into a one-item response. The frontend already consumes the `footprintOptions[]` shape.

### Tasks

#### M2.1 — Remove controller shim

- **File**: `src-ts/src/transport/controllers/component-controller.ts`
- **Action**:
  - Remove the code that wraps `footprintPayload` into a synthetic `footprintOptions` array
  - Read `footprintOptions` directly from repository result
  - Pass `footprintOptions` through to API response unchanged
- **Test**: API response shape matches shared schema exactly

#### M2.2 — Update variant CRUD routes

- **File**: `src-ts/src/transport/controllers/component-controller.ts`
- **Action**:
  - `POST /api/components/:id/variants` — accept `footprintOptions[]` in request body
  - `PATCH /api/components/:id/variants/:variantId` — accept partial `footprintOptions[]` update (full replacement of the array)
  - Validate: each footprint option must have `label` and `kicadPayload`
  - Auto-generate `id` for footprint options if not provided by client
  - If `defaultFootprintOptionId` not provided, set to first option's id
- **Test**: update `component-controller.test.ts`:
  - Create variant via API with multiple footprint options
  - Update variant to add/remove footprint options
  - GET component returns full `footprintOptions[]` per variant

#### M2.3 — Update workspace-record API shim (Wizard compatibility)

- **File**: `src-ts/src/transport/controllers/component-controller.ts` (or wherever workspace-record routes live)
- **Action**:
  - `patchWorkspaceComponentRecord()` must forward `footprintOptions[]` when the wizard sends variant data
  - Since workspace-record APIs are already thin wrappers around real CRUD, this may require minimal changes — but verify the footprint data path end-to-end from Wizard → workspace-record API → variant API → DB
- **Test**: Wizard create flow produces a component with correct `footprintOptions[]` in DB

#### M2.4 — Update shared schema validation

- **File**: `src-ts/src/core/schemas/component-library.schema.ts`
- **Action**: Verify the `FootprintOption` type definition matches the DB shape. If there are optional fields (`densityLevel`, `ipcName`), mark them explicitly optional. Ensure `id` is required in the stored form.
- **Test**: TypeScript strict mode passes

### Acceptance

- [ ] Controller no longer wraps single footprint into array — passes through directly
- [ ] API accepts and returns `footprintOptions[]` per variant
- [ ] Workspace-record API path (used by Wizard) correctly handles multi-footprint variants
- [ ] All controller tests pass
- [ ] Frontend `component-api.ts` works without changes (it already consumes `footprintOptions[]`)

---

## M3 — Wizard multi-variant support

**Goal**: Extend the ComponentWizard to support creating and managing multiple variants per component. Currently the Wizard creates exactly one variant with one footprint.

**Estimated effort**: 3–5 days

### Current state

The Wizard has 4 steps: Symbol → Footprint → 3D Model → Specs. The footprint step creates one footprint for one implicit default variant. The Wizard state (`component-wizard-store.ts`) stores a single footprint draft.

### Target UX flow

```
Step 1: Symbol (unchanged)
  - Draw symbol or import .kicad_sym
  - Define pins, body shape, reference prefix

Step 2: Variants & Footprints (replaces old Footprint step)
  - Shows a variant list panel on the left
  - Default: one variant named "Default" is created
  - User can:
    - Add variant (button below list)
    - Select variant from list
    - Remove variant (with confirmation if > 1)
  - For selected variant, right panel shows:
    - Variant metadata: canonicalCode, humanLabel, mountType (dropdown: SMD/through-hole)
    - Footprint editor (existing canvas editor, scoped to this variant)
    - Import .kicad_mod button (existing, scoped to this variant)
  - Each variant stores its own footprint independently

Step 3: 3D Model (unchanged — placeholder for Phase 1)

Step 4: Specs (unchanged)
  - displayLabel, description, categoryPath, tags
```

### Tasks

#### M3.1 — Extend wizard store for multi-variant state

- **File**: `src-react/src/stores/component-wizard-store.ts`
- **Action**:
  - Replace single footprint draft with a `variants[]` array in the draft payload
  - Each variant in state:
    ```typescript
    interface WizardVariantDraft {
      id: string;                  // temp UUID
      canonicalCode: string;       // e.g. "0805"
      humanLabel: string;          // e.g. "0805 (2012 metric)"
      mountType: "smd" | "through_hole";
      isDefault: boolean;
      footprintDraft: FootprintDraft; // existing footprint editor state shape
    }
    ```
  - Add state fields:
    - `variants: WizardVariantDraft[]`
    - `activeVariantId: string | null` — which variant's footprint is shown in editor
  - Add actions:
    - `addVariant()` — push new variant with empty footprint, auto-name "Variant N"
    - `removeVariant(id)` — remove (blocked if only 1 variant remains)
    - `setActiveVariant(id)` — switch footprint editor to this variant's draft
    - `updateVariantMetadata(id, patch)` — update code/label/mountType
    - `updateVariantFootprint(id, footprintDraft)` — sync footprint editor state into variant
    - `setDefaultVariant(id)` — mark one variant as default
  - On wizard open: initialize with one default variant
  - On step 2 enter: set `activeVariantId` to first variant
- **Test**: 
  - Add/remove variant state transitions
  - Active variant switching preserves each variant's footprint draft independently
  - Default variant flag logic
  - Cannot remove last variant

#### M3.2 — Build variant list panel UI

- **File**: new file `src-react/src/components/wizard/VariantListPanel.tsx`
- **Action**:
  - Vertical list of variant items showing: `canonicalCode` (bold) + `mountType` badge
  - Selected variant highlighted
  - Click to select → updates `activeVariantId` in store
  - "Add variant" button at bottom of list
  - Each item has a delete icon (hidden when only 1 variant)
  - Default variant has a star/badge indicator
  - Right-click or menu on item: "Set as default"
- **Styling**: match existing Wizard step styling (consult current CSS)

#### M3.3 — Build variant metadata form

- **File**: new file `src-react/src/components/wizard/VariantMetadataForm.tsx`
- **Action**:
  - Small form above the footprint editor:
    - `canonicalCode` — text input, placeholder "e.g. 0805"
    - `humanLabel` — text input, placeholder "e.g. 0805 (2012 metric)"
    - `mountType` — dropdown: "SMD" / "Through-hole"
  - Changes dispatch to `updateVariantMetadata()` in wizard store
  - Form resets when `activeVariantId` changes

#### M3.4 — Refactor Wizard step 2 to use variant-scoped footprint editing

- **File**: `src-react/src/components/wizard/ComponentWizard.tsx` (step 2 section)
- **Action**:
  - Replace the current flat footprint step layout with a split layout:
    - Left: `VariantListPanel` (~200px width)
    - Right: `VariantMetadataForm` (top) + existing footprint editor (bottom)
  - The footprint editor must be **scoped to the active variant**:
    - When `activeVariantId` changes, save current footprint editor state into the previous variant's `footprintDraft`, then load the new variant's `footprintDraft` into the footprint editor
    - This swap must preserve all footprint editor state (pads, outlines, imported data)
  - The existing footprint sub-editor (`src-react/src/components/footprint-editor/*`) should not need internal changes — only the data it receives/emits changes
  - KiCad `.kicad_mod` import: the existing import button should feed into the active variant's footprint draft

**Critical implementation detail**: The footprint editor likely has its own Zustand store or internal state. When switching variants, the pattern is:
1. Serialize current footprint editor state → save into `variants[prevId].footprintDraft`
2. Load `variants[newId].footprintDraft` → deserialize into footprint editor state
3. If the footprint editor store has a `loadDraft()` or `reset()` method, use it. If not, may need to add one.

#### M3.5 — Update Wizard save/publish to handle multiple variants

- **File**: `src-react/src/stores/component-wizard-store.ts` + `src-react/src/lib/api/component-api.ts`
- **Action**:
  - On autosave (`patchWorkspaceComponentRecord`): send all variants with their footprint data
  - On final publish: ensure all variants are included in the payload
  - Map wizard variant drafts to API variant format:
    ```typescript
    // For each WizardVariantDraft, produce:
    {
      canonicalCode: draft.canonicalCode,
      humanLabel: draft.humanLabel,
      mountType: draft.mountType,
      isDefault: draft.isDefault,
      footprintOptions: [{
        id: generateUUID(),
        label: "Default",
        kicadPayload: convertFootprintDraftToKicadPayload(draft.footprintDraft)
      }],
      defaultFootprintOptionId: /* the generated id above */
    }
    ```
  - Note: for Phase 1, each variant gets exactly **one** footprint option. The `footprintOptions[]` array exists for future extensibility (multiple density levels per package). The variant itself represents the package variation.
  
- **Test**:
  - Create component with 1 variant → 1 variant in DB with `footprintOptions[1]`
  - Create component with 3 variants → 3 variants in DB, each with `footprintOptions[1]`
  - Default variant flag persisted correctly

#### M3.6 — Update Wizard edit mode (reopen existing component)

- **File**: `src-react/src/components/wizard/ComponentWizard.tsx` + wizard store
- **Action**:
  - When Wizard is opened in edit mode (from detail page "Edit" button — see M6):
    - Fetch component + all variants from API
    - Populate wizard store: `variants[]` from API variants, each with footprint draft deserialized from `footprintOptions[0].kicadPayload`
    - Populate symbol step from component's `symbolData`
    - Populate specs step from component metadata
  - On save in edit mode:
    - Diff local variants vs server variants (like `ComponentEditor` already does)
    - Create new variants, update existing, remove deleted
    - Update component metadata
- **Test**:
  - Open existing component in Wizard → all variants loaded
  - Add a variant in edit mode → new variant created on save
  - Remove a variant in edit mode → variant deleted on save
  - Edit variant metadata → updated on save

### Acceptance

- [ ] User can create a component with 1 variant (existing behavior preserved)
- [ ] User can add additional variants with different package codes and mount types
- [ ] Each variant has its own independently editable footprint
- [ ] Switching between variants preserves footprint state
- [ ] Created component appears in library with correct variant count
- [ ] Wizard can reopen an existing component and edit its variants

---

## M4 — Built-in component seeding

**Goal**: On first application startup, seed the database with GND, VCC, and Generic Resistor (4 variants: 0402, 0805, 1206 SMD + axial through-hole). Use existing KiCad parser on shipped `.kicad_sym` / `.kicad_mod` files.

**Estimated effort**: 2–3 days

### Component specifications

#### GND (ground symbol)

- **Type**: Power symbol (net-defining)
- **Reference prefix**: `#PWR`
- **Symbol**: Standard GND symbol (3 horizontal lines decreasing in width)
- **Value**: `GND`
- **Variants**: none (power symbols have no footprint)
- **Category**: `Power/Ground`
- **Behavior**: currently embedded in palette as `gnd` symbol kind. Seeding it as a real library component allows the symbol-library resolution to treat it uniformly. Keep the embedded symbol rendering path as a fallback.

#### VCC (power supply symbol)

- **Type**: Power symbol (net-defining)
- **Reference prefix**: `#PWR`
- **Symbol**: Standard VCC symbol (upward arrow or bar)
- **Value**: `VCC`
- **Variants**: none
- **Category**: `Power/Supply`
- **Behavior**: same as GND — currently embedded, seed as library component.

#### Generic Resistor

- **Type**: Passive component
- **Reference prefix**: `R`
- **Symbol**: Rectangle body, 2 pins (IEC style) — use standard KiCad `R` symbol from `Device.kicad_sym`
- **Value**: empty (user fills in, e.g. "10k")
- **Category**: `Passives/Resistors`
- **Variants**:

| Variant code | Label | Mount type | Footprint source |
|---|---|---|---|
| `0402` | 0402 (1005 metric) | SMD | `R_0402_1005Metric.kicad_mod` |
| `0805` | 0805 (2012 metric) | SMD | `R_0805_2012Metric.kicad_mod` |
| `1206` | 1206 (3216 metric) | SMD | `R_1206_3216Metric.kicad_mod` |
| `THT` | Axial, L=6.3mm, D=2.5mm | Through-hole | `R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal.kicad_mod` |

- **Default variant**: `0805`

### Tasks

#### M4.1 — Ship KiCad source files

- **Directory**: `src-ts/src/seed/kicad-sources/`
- **Action**:
  - Copy the following KiCad library files into the project:
    - `Device.kicad_sym` (contains R, C, L symbols — only R is used in Phase 1, but ship the full file for future use)
    - `power.kicad_sym` (contains GND, VCC, +3V3, +5V — seed GND and VCC now)
    - `R_0402_1005Metric.kicad_mod`
    - `R_0805_2012Metric.kicad_mod`
    - `R_1206_3216Metric.kicad_mod`
    - `R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal.kicad_mod`
  - Source: KiCad's official libraries (MIT licensed, freely redistributable)
  - Verify: each file parses successfully with the existing KiCad parser

#### M4.2 — Write seed script

- **File**: `src-ts/src/seed/seed-builtin-components.ts`
- **Action**:
  - Export an async function `seedBuiltinComponents(repository: ComponentRepository)`
  - On invocation:
    1. Check if built-in components already exist (query by `scope: "builtin"` or by known `canonicalKey`). If they exist, **skip** — do not duplicate or overwrite.
    2. Parse `power.kicad_sym` → extract GND and VCC symbol data using existing parser
    3. Parse `Device.kicad_sym` → extract Resistor symbol data
    4. Parse each `.kicad_mod` file → extract footprint payload
    5. Create components via repository:

  ```typescript
  // GND
  await repository.createComponent({
    canonicalKey: "builtin:gnd",
    displayLabel: "GND",
    description: "Ground reference symbol",
    scope: "builtin",
    categoryPath: "Power/Ground",
    tags: ["power", "ground"],
    symbolData: parsedGndSymbol, // from parser
    defaultVariantId: null,      // no variants for power symbols
  });
  // (no variants created for GND)

  // VCC
  await repository.createComponent({
    canonicalKey: "builtin:vcc",
    displayLabel: "VCC",
    description: "Positive supply voltage symbol",
    scope: "builtin",
    categoryPath: "Power/Supply",
    tags: ["power", "supply"],
    symbolData: parsedVccSymbol,
    defaultVariantId: null,
  });

  // Generic Resistor
  const resistor = await repository.createComponent({
    canonicalKey: "builtin:resistor",
    displayLabel: "Resistor",
    description: "Generic resistor — set value after placement",
    scope: "builtin",
    categoryPath: "Passives/Resistors",
    tags: ["passive", "resistor"],
    symbolData: parsedResistorSymbol,
  });

  // Resistor variants
  const v0805 = await repository.createVariant(resistor.id, {
    canonicalCode: "0805",
    humanLabel: "0805 (2012 metric)",
    mountType: "smd",
    isDefault: true,
    footprintOptions: [{
      id: generateUUID(),
      label: "IPC nominal",
      kicadPayload: parsedR0805Footprint,
    }],
  });
  // ... repeat for 0402, 1206, THT

  await repository.setDefaultVariant(resistor.id, v0805.id);
  ```

- **Error handling**: if any single component fails to seed, log the error and continue with others. Don't crash the app on seed failure.

#### M4.3 — Integrate seed into application startup

- **File**: application entry point / server bootstrap (wherever the Bun backend initializes)
- **Action**:
  - After DB migrations run, call `seedBuiltinComponents(repository)`
  - Runs on every startup but is idempotent (skips if already seeded)
  - Log: `"Built-in components: seeded 3 components"` or `"Built-in components: already present, skipping"`
- **Test**: 
  - Fresh DB → components seeded
  - Restart → no duplicates
  - Delete a built-in component → re-seeded on next restart (or NOT — decide: should built-ins be re-seedable? **Recommendation**: yes, re-seed if missing, to prevent broken state)

#### M4.4 — Migrate embedded GND/VCC to library-backed symbols

- **File**: `src-react/src/components/pcb/palette/ComponentPalette.tsx` + `src-react/src/components/pcb/symbol-library.ts`
- **Action**:
  - Currently GND and VCC are hardcoded as "embedded symbols" in the palette, separate from library components
  - After seeding, they exist as real library components
  - **Phase 1 approach**: keep embedded rendering path as fallback, but add the seeded GND/VCC to the library component list. The palette should show them from the library, not from the hardcoded embedded list.
  - Update palette logic:
    - Remove hardcoded `gnd` and `vcc` from embedded symbols list
    - They will now appear in the library components section (fetched via `useComponents()`)
    - The rendering path in `symbol-library.ts` should recognize `builtin:gnd` and `builtin:vcc` canonical keys and use the existing symbol rendering code
  - **Fallback safety**: if library fetch fails or components are missing, the old embedded symbols still render (graceful degradation — this already exists via the missing-link system)
- **Test**:
  - Palette shows GND and VCC from library (not hardcoded)
  - Placing GND from library palette creates a symbol with `componentId` pointing to the seeded component
  - Existing schematics with old-style embedded GND/VCC still open (missing-link degradation)

#### M4.5 — Verify library display of built-in components

- **Action** (manual verification + automated test):
  - LibraryScreen shows GND, VCC, Resistor in component list
  - Search for "resistor" → finds it
  - Filter by mount type "SMD" → shows Resistor (because it has SMD variants)
  - ComponentDetailPage for Resistor:
    - Shows symbol preview
    - Shows variant list: 0402, 0805, 1206, THT
    - Shows footprint preview for selected variant
    - Variant selector works
  - Built-in components should be **non-deletable** (or deletable with re-seed on restart)
    - **Decision**: mark `scope: "builtin"` components as non-deletable in the UI. Hide or disable the delete button. Backend: block delete for `scope: "builtin"`.

### Acceptance

- [ ] Fresh app startup seeds GND, VCC, Resistor into DB
- [ ] Restart does not create duplicates
- [ ] Resistor has 4 variants with correct footprint data
- [ ] Palette shows GND/VCC from library (not hardcoded)
- [ ] LibraryScreen displays all 3 built-in components
- [ ] Detail page shows variants with footprint previews
- [ ] Built-in components are protected from deletion

---

## M5 — Reference format standardization

**Goal**: Standardize how placed schematic symbols reference their source component. Eliminate the current mixed format. All symbols use `componentId` + `variantId` as top-level persisted fields.

**Estimated effort**: 1–2 days

### Current state (mixed format)

When saving a symbol to the persisted document (`toSchematicProjectDocument()`):

```typescript
// Currently writes ALL of these:
symbol.libraryPartId = componentId;
symbol.properties.component_id = componentId;
symbol.properties.variant_id = variantId;
```

When loading (`toEditorSchematicSymbol()`):

```typescript
// Currently reads from properties:
componentId = symbol.properties?.component_id;
variantId = symbol.properties?.variant_id;
// Also tolerates legacy: symbol.properties?.componentId
```

### Target format

Persisted symbol shape:

```typescript
interface PersistedSchematicSymbol {
  id: string;
  componentId: string;          // ← single canonical field
  variantId: string;            // ← single canonical field
  position: { x: number; y: number };
  rotation?: number;
  mirrored?: boolean;
  pins: PersistedPin[];
  properties?: {
    value?: string;             // user-set value like "10k"
    // NO component_id, variant_id, or componentId here
  };
  // NO libraryPartId field
}
```

### Tasks

#### M5.1 — Update persistence serialization

- **File**: `src-react/src/components/pcb/types.ts` (or wherever `toSchematicProjectDocument` lives)
- **Action**:
  - `toSchematicProjectDocument()`: write `componentId` and `variantId` at top level. Stop writing `libraryPartId`, `properties.component_id`, `properties.variant_id`.
  - `toEditorSchematicSymbol()`: read from `componentId` and `variantId` at top level. Add migration fallback: if top-level fields are missing, try `libraryPartId` → `componentId`, `properties.component_id` → `componentId`, `properties.variant_id` → `variantId`. Also handle legacy `properties.componentId`.
  - The fallback ensures old saved documents still load correctly.
- **Test**:
  - Save a symbol → persisted JSON has `componentId` + `variantId` at top level, no `libraryPartId`, no `properties.component_id`
  - Load old-format document (with `libraryPartId` + `properties.component_id`) → correctly resolves

#### M5.2 — Update shared persisted types

- **File**: `src-ts/shared/types/pcb.types.ts`
- **Action**:
  - Add `componentId?: string` and `variantId?: string` to the persisted symbol type
  - Mark `libraryPartId` as deprecated (keep in type for backward compat, but document it's legacy)
- **Test**: TypeScript compiles

#### M5.3 — Update schema validation

- **File**: `src-ts/src/core/schemas/pcb-project.schema.ts`
- **Action**:
  - Add `componentId` and `variantId` as optional fields in the schematic symbol schema
  - Keep `libraryPartId` as optional (for old document loading)
  - Validation should accept both formats
- **Test**: schema validates old and new format documents

#### M5.4 — Update schematic store resolution

- **File**: `src-react/src/stores/schematic-store.ts`
- **Action**:
  - Canonical resolution should use `symbol.componentId` (not `symbol.properties.component_id`)
  - The `componentLibraryIndex` lookup uses `componentId` as key — verify this is consistent
- **Test**: update `schematic-store.test.ts`:
  - Placement creates symbol with top-level `componentId` + `variantId`
  - Re-resolution uses top-level `componentId`
  - Old-format symbols (with `libraryPartId`) are migrated on load

#### M5.5 — Update delete-impact scanner

- **File**: `src-ts/src/db/repositories/component-repository.ts` (`getDeleteImpact`)
- **Action**:
  - Currently scans for `libraryPartId === componentId` OR `properties.component_id === componentId` OR `properties.componentId === componentId`
  - Add scan for top-level `componentId` field
  - Keep old scan paths for backward compat with un-migrated documents
- **Test**: delete-impact correctly finds usage in new-format documents

### Acceptance

- [ ] New saves use clean `componentId` + `variantId` at top level
- [ ] Old documents with `libraryPartId` / `properties.component_id` still load correctly
- [ ] Schematic store resolution works with new format
- [ ] Delete-impact scanner finds references in both old and new formats
- [ ] No data loss on format migration

---

## M6 — Detail page cleanup

**Goal**: Make ComponentDetailPage read-only for Phase 1. Add an "Edit in Wizard" button that reopens the component in the Wizard in edit mode. Remove inline edit capabilities.

**Estimated effort**: 1 day

### Current state

`ComponentDetailPage` has a shallow edit mode that allows changing `displayLabel`, `description`, and `categoryPath` inline. This creates a split authoring path alongside the Wizard.

### Tasks

#### M6.1 — Remove inline edit mode from detail page

- **File**: `src-react/src/components/library/ComponentDetailPage.tsx`
- **Action**:
  - Remove the edit toggle / edit mode state
  - Remove inline-editable fields (make all fields display-only)
  - Keep: symbol preview, footprint preview, variant selector, pin table, specs display, 3D placeholder
  - Keep: delete button (with existing impact check flow)
  - Remove or disable: Export button, Duplicate button (placeholders per codebase map)

#### M6.2 — Add "Edit" button that opens Wizard

- **File**: `src-react/src/components/library/ComponentDetailPage.tsx`
- **Action**:
  - Add an "Edit" button in the detail page header (next to delete button)
  - On click: navigate to Wizard in edit mode, passing `componentId` as parameter
  - For `scope: "builtin"` components: hide or disable the Edit button (built-ins are not user-editable)
- **Navigation**: this requires the Wizard to accept a `componentId` parameter for edit mode. The Wizard already has edit mode support per M3.6. Wire the navigation:
  - Option A: hash route like `#component-edit:<componentId>` → opens `LibraryScreen` with `ComponentWizard` in edit mode
  - Option B: pass componentId through navigation store state
  - **Recommended**: Option A for clean URL semantics

#### M6.3 — Add variant display improvements

- **File**: `src-react/src/components/library/ComponentDetailPage.tsx`
- **Action**:
  - Variant selector should show all variants with their `canonicalCode`, `humanLabel`, and `mountType` badge
  - Selecting a variant updates the footprint preview
  - Show which variant is the default (star or "Default" badge)
  - This should already partially work from the existing detail page — verify and polish

### Acceptance

- [ ] Detail page shows component info in read-only mode
- [ ] No inline edit fields visible
- [ ] "Edit" button navigates to Wizard with component pre-loaded
- [ ] Built-in components have no Edit button
- [ ] Variant selector shows all variants with metadata
- [ ] Delete flow still works as before

---

## Test strategy

### Automated tests to add or update

| Area | Test file | What to verify |
|------|-----------|---------------|
| DB migration | New migration test | Up/down, data preservation |
| Repository | `component-repository.test.ts` | `footprintOptions[]` CRUD, multi-variant create |
| Controller | `component-controller.test.ts` | API contract, multi-variant endpoints |
| Wizard store | `ComponentWizard.test.tsx` | Multi-variant state, add/remove/switch |
| Schematic store | `schematic-store.test.ts` | New reference format, backward compat |
| Seeding | New test file | Idempotent seed, correct data shape |

### Manual test checklist

- [ ] Fresh install → built-ins seeded → library shows 3 components
- [ ] Create new component with 1 variant via Wizard → appears in library
- [ ] Create new component with 3 variants via Wizard → all variants visible in detail page
- [ ] Edit existing component via Wizard → changes persisted
- [ ] Delete user-created component → removed from library
- [ ] Attempt delete built-in → blocked
- [ ] Place Resistor on schematic → symbol renders, properties show variant
- [ ] Place GND on schematic → renders correctly (from library, not embedded)
- [ ] Save schematic with placed components → JSON uses new reference format
- [ ] Load old-format schematic → symbols resolve correctly (backward compat)
- [ ] Re-start app → no duplicate built-ins

---

## File change summary

### New files

| File | Purpose |
|------|---------|
| `src-ts/src/seed/seed-builtin-components.ts` | Seed script for built-in components |
| `src-ts/src/seed/kicad-sources/*.kicad_sym` | KiCad symbol source files |
| `src-ts/src/seed/kicad-sources/*.kicad_mod` | KiCad footprint source files |
| `src-react/src/components/wizard/VariantListPanel.tsx` | Variant list UI in Wizard |
| `src-react/src/components/wizard/VariantMetadataForm.tsx` | Variant metadata form in Wizard |
| DB migration file | `footprintOptions[]` migration |

### Modified files

| File | Changes |
|------|---------|
| `src-ts/src/db/schema/component-variant.ts` | Replace `footprintPayload` → `footprintOptions` |
| `src-ts/src/db/repositories/component-repository.ts` | Multi-footprint CRUD, delete-impact update |
| `src-ts/src/transport/controllers/component-controller.ts` | Remove shim, accept `footprintOptions[]`, block builtin delete |
| `src-ts/src/core/schemas/component-library.schema.ts` | Verify/update FootprintOption type |
| `src-ts/shared/types/pcb.types.ts` | Add `componentId`/`variantId`, deprecate `libraryPartId` |
| `src-ts/src/core/schemas/pcb-project.schema.ts` | Accept new reference format |
| `src-react/src/stores/component-wizard-store.ts` | Multi-variant state management |
| `src-react/src/components/wizard/ComponentWizard.tsx` | Step 2 refactor, edit mode support |
| `src-react/src/components/library/ComponentDetailPage.tsx` | Read-only mode, Edit button |
| `src-react/src/components/pcb/palette/ComponentPalette.tsx` | Remove hardcoded GND/VCC |
| `src-react/src/components/pcb/symbol-library.ts` | Recognize builtin canonical keys |
| `src-react/src/components/pcb/types.ts` | New reference serialization |
| `src-react/src/stores/schematic-store.ts` | Use top-level `componentId` |
| `src-react/src/lib/api/component-api.ts` | Workspace-record footprint forwarding |
| App bootstrap / server entry | Call seed on startup |

### Test files to update

| File | Changes |
|------|---------|
| `src-ts/src/db/repositories/component-repository.test.ts` | `footprintOptions[]` tests |
| `src-ts/src/transport/controllers/component-controller.test.ts` | API contract tests |
| `src-react/src/components/wizard/ComponentWizard.test.tsx` | Multi-variant tests |
| `src-react/src/stores/schematic-store.test.ts` | Reference format tests |

---

## Risk register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Footprint editor state swap** — switching active variant may lose footprint data if editor store doesn't support clean serialize/deserialize | High | Medium | Spike M3.4 first. Test with a simple 2-variant component before building full UI. If editor state is hard to swap, use separate editor instances (hidden/shown). |
| **KiCad parser edge cases** — some `.kicad_mod` files may not parse cleanly, especially the through-hole resistor with complex pad shapes | Medium | Low | Parse all seed files early (M4.1). If THT footprint fails, fall back to a simpler THT footprint or SMD-only for Phase 1. |
| **Workspace-record API shim** — the wizard save path goes through synthetic workspace-record APIs that are already shimmed. Adding multi-variant data through this shim may break | High | Medium | Trace the full save path end-to-end in M2.3 before starting M3. If the shim is too fragile, bypass it and use real component + variant CRUD APIs directly from the Wizard. |
| **Old schematic backward compat** — changing reference format may break loading of existing saved schematics | High | Low | M5.1 includes explicit fallback readers for all old formats. Add a test case that loads a known old-format document. |
| **Embedded GND/VCC migration** — removing hardcoded symbols from palette could break existing schematics that use the old `symbolKind: "gnd"` format | High | Medium | Keep the rendering fallback in `symbol-library.ts` for `symbolKind: "gnd"` and `"vcc"`. Only change the placement path (new placements use library components). Old placements continue to work via missing-link degradation. |

---

## Execution order summary

```
Week 1:   M1 (DB migration) → M2 (API alignment)
Week 2:   M3.1-M3.3 (Wizard store + variant UI components)
          M5 (reference format — can run in parallel)
Week 3:   M3.4-M3.6 (Wizard footprint scoping + save + edit mode)
Week 4:   M4 (built-in seeding) → M6 (detail page cleanup)
Week 4+:  Integration testing, bug fixes, manual QA
```

**Total estimated effort**: 2–3 weeks for a solo developer.