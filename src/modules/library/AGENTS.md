# COMPONENT-LIBRARY MODULE

**Purpose:** Only concrete module — manages parts, symbols, footprints, KiCad import.

## STRUCTURE

```
src/modules/component-library/
├── manifest.json              # Module metadata, routes, dependencies
├── module.backend.ts          # Barrel: exports { manifest, definition }
├── module.frontend.ts         # Frontend entry
├── backend/
│   ├── handlers/              # HTTP route handlers (component-controller.test.ts)
│   ├── domain/services/       # ComponentImportService (719 lines)
│   ├── db/repositories/       # ComponentRepository (600 lines), ComponentFamilyRepository (604 lines)
│   ├── schemas/               # Component semantics, validation (417 lines + tests)
│   └── infrastructure/        # Parsers (KiCad), cache (ModelLoadCache)
├── react/
│   ├── components/
│   │   ├── footprint-editor/  # Preset utils (1003 lines), store (708 lines), types (523 lines)
│   │   ├── symbol-editor/     # KiCad import (1349 lines), store (587 lines)
│   │   ├── component-wizard/  # Transformers (562 lines)
│   │   ├── component-editor/  # Symbol data buffer (443 lines)
│   │   └── library/           # Library browser UI
│   ├── stores/                # Component wizard store (473 lines)
│   └── render-engine/         # Adapters for canvas rendering
└── frontend/                  # Module-specific frontend entry
```

## WHERE TO LOOK

| Task              | Location                                            |
| ----------------- | --------------------------------------------------- |
| KiCad import      | react/components/symbol-editor/kicad-import.ts      |
| Footprint presets | react/components/footprint-editor/preset-utils.ts   |
| Component CRUD    | backend/handlers/component-controller.test.ts       |
| DB queries        | backend/db/repositories/                            |
| Import service    | backend/domain/services/component-import-service.ts |

## COMPLEXITY HOTSPOTS

- kicad-import.ts (1349 lines) — KiCad symbol parsing
- preset-utils.ts (1003 lines) — Footprint preset generation
- component-import-service.ts (719 lines) — Import orchestration
- footprint-editor-store.ts (708 lines) — Editor state management

## NOTES

- Copy this structure for new modules
- Heavy use of shared/ canvas engine
- KiCad parser in infrastructure/parsers/kicad/
