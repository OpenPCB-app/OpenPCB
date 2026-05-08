---
name: library
description: "Component library system — symbols, footprints, KiCad import, IPC-7351B preset generator, drawn-footprint editor, and library↔designer integration. Use this skill whenever implementing or modifying: component creation, KiCad .kicad_sym/.kicad_mod parsing, footprint editor canvas, built-in component seeding, library CRUD API, component search/filter, or library↔schematic linking. Trigger on mentions of: component, symbol, footprint, KiCad import, kicad_sym, kicad_mod, library palette, ComponentDetailPage, footprint editor, IPC-7351B, or built-in components."
---

# Library Skill

The library module owns the catalog of components consumed by the designer module. Module id: `library`. API base path: `/api/modules/library/*`. Table prefix: `library_`. SDK token: `MODULE_SDK_TOKENS.LIBRARY` → `LibrarySDK`.

## Data model (current, flat — no variants)

Three tables, all prefixed `library_`:

```
library_components   id, name, description, symbolId, footprintId, tags (json), is_builtin
library_symbols      id, name, data (json — ParsedKicadSymbol)
library_footprints   id, name, data (json — ParsedKicadFootprint)
```

Variants / families / presets / provenance / 3D-model storage are **not** in the current model. Defer until product need is concrete.

Migrations: `src/modules/library/backend/migrations/0000_init.sql`, `0001_builtin_flag.sql`.

## SDK surface

```ts
// src/sdks/library/types.ts
interface LibrarySDK {
  resolveComponent(id: string): Promise<LibraryComponent | null>;
  getSymbol(id: string): Promise<LibrarySymbol | null>;
  getFootprint(id: string): Promise<LibraryFootprint | null>;
  searchComponents(p: LibrarySearchParams): Promise<LibraryComponent[]>;
}
```

Module token: `MODULE_SDK_TOKENS.LIBRARY = "LibrarySDK"`. Designer module depends on this SDK to resolve components for placement.

## HTTP routes

- `GET /api/modules/library/status` — `{ moduleId, namespace, status, componentCount }`
- `GET /api/modules/library/components?q&limit&tags` — search
- `GET /api/modules/library/components/:id` — single
- `GET /api/modules/library/components/:id/detail` — symbol + footprint preview models inlined
- `GET /api/modules/library/symbols/:id`, `GET /api/modules/library/footprints/:id`
- `POST /api/modules/library/imports/kicad/inspect` — inspect uploaded `.kicad_sym` + `.kicad_mod` content, return preview models without persisting
- `POST /api/modules/library/imports/kicad` — commit a chosen symbol+footprint pair as a new component
- `POST /api/modules/library/imports/drawn` — commit a user-drawn symbol/footprint
- `POST /api/modules/library/imports/generated` — commit an IPC-7351B-generated footprint with a chosen symbol

## Built-in seeding

`src/modules/library/backend/builtins/seed.ts` runs on every backend boot, transactionally.

- Idempotent: keyed by `is_builtin = 1` + `sourceHash`.
- Currently seeds 2 components: a generic resistor and a generic capacitor. Both use a placeholder footprint (`builtins/placeholder-footprint.ts`).
- `is_builtin = 1` rows are protected from delete/update by route guards.

When adding new built-ins: edit `seed.ts`, set a fresh `sourceHash`, add the symbol/footprint payload via `builtins/render-models.ts` helpers.

## KiCad import (parsers)

Located at `src/modules/library/backend/infrastructure/parsers/kicad/`:

| File                        | Purpose                                                         |
| --------------------------- | --------------------------------------------------------------- |
| `sexpr-parser.ts`           | S-expression tokenizer/parser                                   |
| `kicad-symbol-parser.ts`    | `.kicad_sym` → `ParsedKicadSymbol` (pins, graphics, properties) |
| `kicad-footprint-parser.ts` | `.kicad_mod` → `ParsedKicadFootprint` (pads, graphics, 3D refs) |
| `kicad-model-linker.ts`     | Resolves 3D model file references                               |
| `heuristics.ts`             | Pad-shape inference and grouping                                |
| `__fixtures__/`             | 12 KiCad files used by parser + integration tests               |

Test fixtures at `src/modules/library/backend/infrastructure/parsers/kicad/__fixtures__/` (e.g. `simple_capacitor.kicad_sym`, `C_0603_1608Metric.kicad_mod`). Reference these from tests with `path.resolve(import.meta.dir, "../../../modules/library/backend/infrastructure/parsers/kicad/__fixtures__/<file>")`.

## Import flow (frontend wizard)

`src/modules/library/frontend/import-wizard/`:

1. **Upload step** — user drops `.kicad_sym` / `.kicad_mod` files OR picks "design from scratch" (drawn) OR "preset" (IPC-7351B).
2. **Inspect** — calls `/imports/kicad/inspect` (KiCad path) for parsed previews.
3. **Selection** — pick which symbol + which footprint (when files contain multiple).
4. **Metadata** — name, description, tags.
5. **Commit** — branches into one of three commit endpoints:
   - `commit-kicad.ts` → `POST /imports/kicad`
   - `commit-generated.ts` → `POST /imports/generated` (IPC-7351B preset generator builds pads from package code)
   - `commit-drawn.ts` → `POST /imports/drawn` (footprint editor canvas output)

## Footprint editor

`src/modules/library/frontend/import-wizard/footprint-editor/`:

- `useFootprintEditorStore.ts` — Zustand store (pads, layers, selection, tool, history).
- `use-footprint-editor-tool.ts` — tool reducer (select / pad / line / circle / arc / text).
- Overlay panels: `PadPropertyPanel`, `LayerPanel`, `FootprintPreviewOverlay`, `FootprintSelectionOverlay`.
- Renders into the shared canvas (`src/shared/frontend/canvas/`); follows R3F + demand-rendering rules — see `/r3f-eda-rendering` skill.

## Library ↔ designer linking

When the designer places a component, it stores `{ componentId, footprintId }` (top-level) on the part entity. The designer's PCB sub-system pulls the footprint payload via `LibrarySDK.getFootprint(footprintId)` for rendering.

Net ↔ pad correlation currently relies on `pin.number == pad.number`. An explicit `pinmap` field on `LibraryComponent` is on the Phase 4 backlog.

Component resolution for placement:

- `DesignerSDK.resolveLibraryComponentForPlacement(id)` → `{ component, symbol, footprint }`.
- If component is missing (deleted from library after placement), the designer falls back to a minimal stub.

## Key files

| Area                | Path                                                           |
| ------------------- | -------------------------------------------------------------- |
| Manifest            | `src/modules/library/manifest.json`                            |
| Backend entry       | `src/modules/library/backend/index.ts`                         |
| Schema              | `src/modules/library/backend/schema.ts`                        |
| Queries / SDK       | `src/modules/library/backend/queries.ts`                       |
| Seed                | `src/modules/library/backend/builtins/seed.ts`                 |
| Routes              | `src/modules/library/backend/routes.ts`                        |
| KiCad parsers       | `src/modules/library/backend/infrastructure/parsers/kicad/`    |
| Import endpoints    | `src/modules/library/backend/import/`                          |
| Frontend Space      | `src/modules/library/frontend/Space.tsx`                       |
| ComponentDetailPage | `src/modules/library/frontend/ComponentDetailPage.tsx`         |
| Import wizard       | `src/modules/library/frontend/import-wizard/`                  |
| Footprint editor    | `src/modules/library/frontend/import-wizard/footprint-editor/` |
| SDK contract        | `src/sdks/library/types.ts`, `src/sdks/library/index.ts`       |

## Anti-patterns

| Don't                                            | Do instead                                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Reach into `core/backend` from module code       | Import only from `core/contracts/*`, `sdks/*`, `shared/*`                           |
| Add variant/family fields ahead of product need  | Stay flat; reopen the data model when a real consumer demands it                    |
| Mutate `is_builtin = 1` rows                     | Routes already block — keep the guard                                               |
| Store fixture paths as `data/...` from repo root | Resolve via `import.meta.dir` against the module's `__fixtures__/`                  |
| Skip canonical re-resolution after load          | The designer always re-resolves placed components against the current library state |
