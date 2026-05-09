# DESIGNER MODULE

**Purpose:** Schematic + PCB editor — ECS-based design world, command pattern, undo/redo, projections.

## STRUCTURE

```
src/modules/designer/
├── manifest.json              # id: "designer", depends on library
├── module.backend.ts          # Barrel export
├── module.frontend.ts         # Frontend entry
├── backend/
│   ├── index.ts               # ModuleDefinition
│   ├── schema.ts              # Drizzle tables
│   ├── routes.ts              # HTTP routes + parse helpers (~944 lines)
│   ├── store.ts               # Design CRUD + command dispatch (~600 lines)
│   ├── command-executor.ts    # All 25+ command handlers (~982 lines)
│   ├── projection-world.ts    # ECS bridge, net derivation (~696 lines)
│   ├── wire-geometry.ts       # Wire point parsing, vertex insertion
│   ├── history-*.ts           # Persistence, state, patches
│   ├── pcb/
│   │   ├── pcb-store.ts       # PCB entity persistence (~784 lines)
│   │   ├── pcb-projection.ts  # PCB read-only snapshot
│   │   ├── pcb-trace-geometry.ts  # Trace validation (~437 lines)
│   │   ├── ratsnest.ts        # MST net segments (~239 lines)
│   │   └── migrations/        # 0000…0004_pcb_foundation.sql
│   └── migrations/            # Designer schema migrations
└── frontend/
    ├── components/
    │   ├── SchematicCanvas.tsx    # Main schematic canvas (~2385 lines)
    │   └── LibrarySymbolPalette.tsx
    └── pcb/
        ├── PcbCanvas.tsx          # PCB canvas (~918 lines)
        ├── layers/                # Layer visibility, rendering
        └── tools/                 # PCB-specific tools
```

## WHERE TO LOOK

| Task                | Location                                  |
| ------------------- | ----------------------------------------- |
| Add command handler | `backend/command-executor.ts`             |
| Add HTTP route      | `backend/routes.ts`                       |
| Change schema       | `backend/schema.ts` + migration           |
| Schematic canvas    | `frontend/components/SchematicCanvas.tsx` |
| PCB canvas          | `frontend/pcb/PcbCanvas.tsx`              |
| PCB entity CRUD     | `backend/pcb/pcb-store.ts`                |
| Net derivation      | `backend/projection-world.ts`             |
| Trace geometry      | `backend/pcb/pcb-trace-geometry.ts`       |
| Ratsnest            | `backend/pcb/ratsnest.ts`                 |
| Undo/redo           | `backend/history-*.ts`                    |

## KEY ABSTRACTIONS

- **CommandEnvelope**: `{ commandId, sessionId, aggregateId, baseRevision, issuedAt, command }`
- **DesignerStore**: design CRUD + command dispatch + history (undo/redo)
- **Projection**: read-only `DesignerSchematicProjection` / `DesignerPcbProjection`
- **ECS World**: schematic parts/wires/labels as entities+components; patches for undo
- **Revision-based OCC**: `baseRevision` in envelope; `REVISION_CONFLICT` on mismatch

## ANTI-PATTERNS

- Never put business logic in `core/backend/*`
- Never import `core/backend/*` or `core/frontend/*` from here
- Never invent manufacturing constants — use `/eda-standards`
- Schematic canvas is 2385 lines — split interactions into hooks, don't grow further

## NOTES

- Depends on `library` module; resolves symbols/footprints via `LibrarySDK`
- PCB tab renders in dark mode regardless of app theme (single token set)
- Trace modes: `manhattan-90` | `manhattan-45`
- Copper layers: `F.Cu` | `B.Cu`
- Command log provides idempotency (duplicate `commandId` rejected)
