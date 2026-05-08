# LIBRARY MODULE

**Purpose:** Component catalog — symbols, footprints, components, KiCad import. Consumed by `designer` via `LibrarySDK`.

## STRUCTURE

```
src/modules/library/
├── manifest.json                    # id: "library", namespace: "space.library"
├── module.backend.ts                # Barrel: exports { manifest, definition }
├── module.frontend.ts               # Frontend entry (lazy LibrarySpace)
├── backend/
│   ├── index.ts                     # ModuleDefinition (~40 lines)
│   ├── schema.ts                    # Drizzle tables (library_components/symbols/footprints)
│   ├── queries.ts                   # SDK impl + DB query helpers
│   ├── routes.ts                    # 5+ HTTP routes incl. import endpoints
│   ├── builtins/
│   │   ├── seed.ts                  # Idempotent seeding of built-in components
│   │   ├── placeholder-footprint.ts
│   │   ├── render-models.ts
│   │   └── migrate-preview-models.ts
│   ├── import/
│   │   ├── inspect-kicad.ts
│   │   ├── commit-kicad.ts          # Branch: KiCad files
│   │   ├── commit-generated.ts      # Branch: IPC-7351B preset generator
│   │   ├── commit-drawn.ts          # Branch: drawn-footprint editor output
│   │   ├── build-preview-models.ts
│   │   └── validate-pads.ts
│   ├── infrastructure/parsers/kicad/   # S-expression + symbol/footprint/heuristics + 12 fixtures
│   └── migrations/                  # 0000_init.sql, 0001_builtin_flag.sql
├── frontend/
│   ├── Space.tsx                    # LibrarySpace
│   ├── ComponentDetailPage.tsx
│   ├── LibraryCard.tsx
│   └── import-wizard/
│       ├── ImportWizardPage.tsx
│       ├── useImportWizardStore.ts
│       └── footprint-editor/        # Pad/layer panels + tool reducer
└── contracts/
    └── import.ts
```

## WHERE TO LOOK

| Task                      | Location                                                               |
| ------------------------- | ---------------------------------------------------------------------- |
| Add HTTP route            | `backend/routes.ts`                                                    |
| Add SDK method            | `backend/queries.ts` + update `src/sdks/library/types.ts`              |
| Add a built-in component  | `backend/builtins/seed.ts` (bump `sourceHash`)                         |
| KiCad parsers             | `backend/infrastructure/parsers/kicad/`                                |
| Schema change             | `backend/schema.ts` + new file in `backend/migrations/`                |
| Add an import path        | `backend/import/commit-*.ts`                                           |
| Wizard step               | `frontend/import-wizard/ImportWizardPage.tsx`                          |
| Footprint editor tool     | `frontend/import-wizard/footprint-editor/use-footprint-editor-tool.ts` |
| ComponentDetailPage edits | `frontend/ComponentDetailPage.tsx`                                     |

## DATA MODEL (current)

Flat — three tables, no variants/families/presets/provenance:

- `library_components` (id, name, description, symbolId, footprintId, tags, is_builtin)
- `library_symbols` (id, name, data — ParsedKicadSymbol JSON)
- `library_footprints` (id, name, data — ParsedKicadFootprint JSON)

Built-in seeding flag: `is_builtin = 1` rows are protected from delete/update by route guards.

## SDK SURFACE

`src/sdks/library/types.ts`:

```ts
interface LibrarySDK {
  resolveComponent(id): Promise<LibraryComponent | null>;
  getSymbol(id): Promise<LibrarySymbol | null>;
  getFootprint(id): Promise<LibraryFootprint | null>;
  searchComponents(p: LibrarySearchParams): Promise<LibraryComponent[]>;
}
```

Token: `MODULE_SDK_TOKENS.LIBRARY` → `"LibrarySDK"`.

## NOTES

- Layering rule: import only from `core/contracts/*`, `sdks/*`, `shared/*`. Never `core/backend/*` or `core/frontend/*` directly.
- Test fixtures under `backend/infrastructure/parsers/kicad/__fixtures__/`. Resolve paths via `path.resolve(import.meta.dir, ...)`, never hard-coded `data/...`.
- See `.claude/skills/library/SKILL.md` for the longer-form domain reference.
