# OpenPCB Target Architecture Proposal

## Summary of decisions

| Decision | Choice |
|---|---|
| Deployment | Desktop-first (Tauri) |
| Collaboration | Not planned |
| Heavy compute | Local backend process (Rust + TS) |
| Data model | **ECS (Entity-Component-System)** — proposed |
| Business model | Freemium (free core + paid cloud) |
| Target user | Hobbyists & makers |
| Rendering | R3F — keep |
| AI depth | Deep (routing, DRC, component suggest) |
| Format priority | KiCad (.kicad_*) |
| Cloud backend | Not separate — Rust/TS runs locally |
| Component library | Built-in + KiCad import + community |

---

## Module architecture

Three modules (plus future ones), each owning its frontend + backend code:

### 1. `designer` module
**Owns**: project state, ECS entities, schematic editing, PCB layout, DRC/ERC, export

- The **core editing experience** — schematic + PCB editors
- Contains the **ECS engine** and **command bus** (all mutations via commands)
- Depends on `component-library` for part resolution (one-way dependency)
- AI tools: `place-component`, `route-trace`, `run-drc`, `suggest-fix`

### 2. `component-library` module
**Owns**: parts, symbols, footprints, library sources, KiCad import

- **Symbol Editor** and **Footprint Editor** live here (they create library parts, not design instances)
- **Library Browser** for searching/browsing parts
- KiCad `.kicad_sym` / `.kicad_mod` parser lives here
- IPC-7351 footprint generator lives here
- AI tools: `search-parts`, `suggest-alternative`
- **Freemium boundary**: cloud community library = paid, local libraries = free

### 3. `knowledge` module (existing)
**Owns**: AI knowledge base, vector search

No changes needed.

### Future modules
- `simulation` — SPICE, signal integrity
- `manufacturing` — BOM, ordering, Gerber preview, cost estimation

---

## Frontend structure — src-react/src/

```
src-react/src/
├── core/                               # App shell (non-module)
│   ├── Layout.tsx                      # Root layout
│   ├── router/                         # TanStack Router setup
│   ├── stores/
│   │   ├── app.store.ts                # Theme, sidebar, dialogs
│   │   └── navigation.store.ts         # Active screen, history
│   ├── components/
│   │   └── ui/                         # Shared primitives (Button, Dialog, Input...)
│   └── hooks/                          # Shared hooks (useBackendPort, useTheme...)
│
├── modules/
│   ├── designer/
│   │   ├── screens/
│   │   │   ├── SchematicEditor.tsx      # Schematic editing screen
│   │   │   └── PCBEditor.tsx            # PCB layout screen
│   │   ├── stores/
│   │   │   ├── designer.store.ts        # ★ Unified ECS entity store
│   │   │   ├── schematic-view.store.ts  # View state: zoom, pan, selection, active tool
│   │   │   └── pcb-view.store.ts        # View state: layers visible, active tool, cursor
│   │   ├── components/
│   │   │   ├── render-engine/           # R3F scenes, wrappers, primitives
│   │   │   │   ├── SchematicScene.tsx
│   │   │   │   ├── PCBScene.tsx
│   │   │   │   ├── primitives/          # Grid, SelectionBox, etc.
│   │   │   │   └── wrappers/            # SymbolWrapper, FootprintWrapper
│   │   │   ├── toolbars/                # SchematicToolbar, PCBToolbar
│   │   │   └── panels/                  # PropertiesPanel, LayerPanel, NetPanel
│   │   ├── hooks/
│   │   │   ├── useCommand.ts            # Dispatch commands to backend
│   │   │   ├── useUndo.ts               # Undo/redo shortcuts
│   │   │   ├── useDesignEntities.ts     # Query ECS entities
│   │   │   └── usePartPicker.ts         # Opens component-library's PartPicker
│   │   └── index.ts                     # Module registration (routes, stores)
│   │
│   ├── component-library/
│   │   ├── screens/
│   │   │   ├── LibraryBrowser.tsx        # Browse/search parts
│   │   │   ├── SymbolEditor.tsx          # Create/edit schematic symbols
│   │   │   └── FootprintEditor.tsx       # Create/edit PCB footprints
│   │   ├── stores/
│   │   │   └── library.store.ts          # Library state, search results, active lib
│   │   ├── components/
│   │   │   ├── part-picker/              # ★ Exported for designer to use
│   │   │   │   ├── PartPickerDialog.tsx  # Modal part selector
│   │   │   │   └── PartCard.tsx          # Part preview card
│   │   │   ├── symbol-canvas/            # R3F canvas for symbol editing
│   │   │   ├── footprint-canvas/         # R3F canvas for footprint editing
│   │   │   └── import-wizard/            # KiCad library import UI
│   │   ├── hooks/
│   │   │   ├── useLibrarySearch.ts
│   │   │   └── useKicadImport.ts
│   │   └── index.ts
│   │
│   └── knowledge/                        # Existing, no changes
│       └── ...
│
├── generated/                            # Keep as-is
│   ├── sdk/
│   ├── rust-bindings/
│   └── modules/
│
├── styles/
└── main.tsx
```

### Key frontend patterns

**designer.store.ts** — The unified ECS store is the single source of truth for all design entities. Both SchematicEditor and PCBEditor read from the same store but render different component aspects (Symbol vs Footprint).

```typescript
// designer.store.ts — simplified
interface DesignerState {
  // ECS
  entities: Map<EntityId, Entity>;
  
  // Project
  activeProjectId: string | null;
  activeSheet: string;     // for schematic
  
  // Derived (computed from entities)
  nets: Map<NetId, Net>;
  
  // Actions (dispatch commands to backend)
  dispatch: (command: Command) => Promise<void>;
  
  // Queries (filter entities by components)
  getEntitiesWithComponent: <T>(type: ComponentType) => Entity[];
  getEntitiesOnSheet: (sheetId: string) => Entity[];
  getEntitiesOnLayer: (layerId: string) => Entity[];
}
```

**View stores are separate** — `schematic-view.store.ts` and `pcb-view.store.ts` hold transient UI state (zoom level, selection, active tool, cursor position). These do NOT go through the command bus because they're not undo-able design mutations.

**Cross-module import** — Designer uses the PartPicker component from component-library:
```typescript
// In designer/hooks/usePartPicker.ts
import { PartPickerDialog } from '../../component-library/components/part-picker';
```

---

## Backend structure — src-ts/src/

```
src-ts/src/
├── kernel/                              # Core runtime (keep)
│   ├── init.ts
│   ├── store.ts                         # DI container
│   └── tasks/
│
├── infrastructure/                      # Shared infra (keep)
│   ├── ai-providers/                    # OpenAI, Anthropic, Ollama
│   ├── persistence/
│   └── transport/
│
├── transport/                           # HTTP router (keep)
│   └── http-router.ts                   # Hono — auto-registers module routes
│
├── modules/
│   ├── _kit/                            # Module SDK (keep)
│   │   ├── module-loader.ts
│   │   ├── registry.ts                  # Generated
│   │   └── types.ts
│   │
│   ├── designer/
│   │   ├── domain/
│   │   │   ├── models/
│   │   │   │   ├── entity.ts            # ★ ECS Entity definition
│   │   │   │   ├── components/          # ★ ECS Component types
│   │   │   │   │   ├── position.ts      # x, y, rotation, sheet/layer
│   │   │   │   │   ├── symbol-ref.ts    # Reference to library symbol
│   │   │   │   │   ├── footprint-ref.ts # Reference to library footprint
│   │   │   │   │   ├── net-connection.ts # Pin-to-net mapping
│   │   │   │   │   ├── value.ts         # Component value + parameters
│   │   │   │   │   ├── wire.ts          # Wire segment (schematic)
│   │   │   │   │   ├── trace.ts         # Trace segment (PCB)
│   │   │   │   │   └── via.ts           # Via (PCB)
│   │   │   │   ├── project.ts           # Project metadata
│   │   │   │   ├── sheet.ts             # Schematic sheet
│   │   │   │   └── design-rules.ts      # DRC rules
│   │   │   │
│   │   │   ├── services/
│   │   │   │   ├── command-bus.ts        # ★ All mutations via typed commands
│   │   │   │   ├── commands/            # ★ Command implementations
│   │   │   │   │   ├── place-component.cmd.ts
│   │   │   │   │   ├── move-entities.cmd.ts
│   │   │   │   │   ├── delete-entities.cmd.ts
│   │   │   │   │   ├── route-wire.cmd.ts
│   │   │   │   │   ├── route-trace.cmd.ts
│   │   │   │   │   ├── assign-net.cmd.ts
│   │   │   │   │   ├── change-value.cmd.ts
│   │   │   │   │   └── set-design-rules.cmd.ts
│   │   │   │   ├── undo-redo.ts          # Command history stack
│   │   │   │   ├── ecs-engine.ts         # ★ Entity-Component query engine
│   │   │   │   ├── netlist.ts            # Extract netlist from entities
│   │   │   │   ├── erc.ts               # Electrical Rule Check
│   │   │   │   ├── drc.ts               # Design Rule Check
│   │   │   │   └── annotation.ts        # Forward/back annotation
│   │   │   │
│   │   │   └── repositories/
│   │   │       ├── project.repository.ts
│   │   │       └── entity.repository.ts  # Persist ECS to SQLite
│   │   │
│   │   ├── tools/                        # AI-callable tools
│   │   │   ├── place-component.tool.ts   # AI places a component
│   │   │   ├── route-trace.tool.ts       # AI routes a trace
│   │   │   ├── run-drc.tool.ts           # AI triggers DRC
│   │   │   ├── suggest-fix.tool.ts       # AI suggests DRC fixes
│   │   │   └── get-design-state.tool.ts  # AI reads current state
│   │   │
│   │   ├── handlers/                     # HTTP routes
│   │   │   ├── project.handler.ts        # CRUD projects
│   │   │   ├── entity.handler.ts         # CRUD entities
│   │   │   ├── command.handler.ts        # POST /commands
│   │   │   └── export.handler.ts         # Gerber, KiCad export
│   │   │
│   │   └── db/
│   │       └── schema.ts                 # entities, components, projects, nets
│   │
│   ├── component-library/
│   │   ├── domain/
│   │   │   ├── models/
│   │   │   │   ├── component.ts          # Part definition (R, C, IC, etc.)
│   │   │   │   ├── symbol.ts             # Schematic symbol (pins, graphics)
│   │   │   │   ├── footprint.ts          # PCB footprint (pads, courtyard, silk)
│   │   │   │   ├── library-source.ts     # Built-in | KiCad | Community
│   │   │   │   └── parameter.ts          # Parametric properties
│   │   │   │
│   │   │   ├── services/
│   │   │   │   ├── library-manager.ts    # CRUD library sources
│   │   │   │   ├── kicad-importer.ts     # Parse .kicad_sym, .kicad_mod
│   │   │   │   ├── part-search.ts        # Parametric search engine
│   │   │   │   └── ipc7351-generator.ts  # Generate standard footprints
│   │   │   │
│   │   │   └── repositories/
│   │   │       ├── component.repository.ts
│   │   │       ├── symbol.repository.ts
│   │   │       └── footprint.repository.ts
│   │   │
│   │   ├── tools/                        # AI-callable
│   │   │   ├── search-parts.tool.ts      # "Find a 100nF 0402 cap"
│   │   │   └── suggest-alternative.tool.ts # "What's compatible with X?"
│   │   │
│   │   ├── handlers/
│   │   │   ├── library.handler.ts        # CRUD libraries
│   │   │   ├── component.handler.ts      # CRUD parts
│   │   │   ├── symbol.handler.ts
│   │   │   ├── footprint.handler.ts
│   │   │   └── import.handler.ts         # KiCad import endpoint
│   │   │
│   │   └── db/
│   │       └── schema.ts                 # components, symbols, footprints, params
│   │
│   └── knowledge/                        # Existing
│       └── ...
│
└── main.ts
```

---

## ECS data model

### Why ECS over relational or document-based

**Relational** (current approach): Tables for components, projects, etc. Problem: adding a new property or component type requires schema migration. Queries like "all capacitors on layer F.Cu with value > 100nF" require complex JOINs.

**Document/JSON**: Store entire project as JSON blob. Problem: partial updates require read-modify-write of entire document. No granular querying.

**ECS** (proposed): Best of both worlds for PCB design because:

1. **Compositional by nature** — a resistor IS a Position + SymbolRef + FootprintRef + Value + NetConnection. Different entity types are just different component combos
2. **Undo/redo is trivial** — snapshot only the changed components, not the whole state
3. **AI queries map naturally** — "find all entities with ValueComponent where value > 100nF and PositionComponent.layer == 'F.Cu'"
4. **KiCad mapping is clean** — KiCad's .kicad_sch and .kicad_pcb files are essentially entity lists with component data
5. **Extensible without migrations** — new component types are just new TypeScript types + new JSON keys in the components column
6. **Performance** — systems only iterate entities that have the components they care about

### Entity structure

```typescript
type EntityId = string;  // UUID
type ComponentType = 
  | 'position' 
  | 'symbol_ref' 
  | 'footprint_ref' 
  | 'value' 
  | 'net_connection'
  | 'wire'
  | 'trace'
  | 'via'
  | 'board_outline'
  | 'text_label'
  | 'net_label';

interface Entity {
  id: EntityId;
  type: EntityType;  // 'component' | 'wire' | 'trace' | 'via' | 'label' | ...
  components: Record<ComponentType, unknown>;
}

// Example: a resistor on the schematic
const resistor: Entity = {
  id: "e-3f8a-...",
  type: "component",
  components: {
    position: { x: 25400000, y: 12700000, rotation: 0, sheet: "sheet-1" },
    symbol_ref: { libraryRef: "Device:R", symbolId: "sym-abc" },
    footprint_ref: { libraryRef: "Resistor_SMD:R_0402", fpId: "fp-xyz" },
    value: { value: "10k", unit: "ohm", parameters: { tolerance: "1%", package: "0402" } },
    net_connection: { 
      pins: [
        { pinIndex: 0, netId: "net-vcc" },
        { pinIndex: 1, netId: "net-gnd" }
      ]
    }
  }
};
```

### SQLite schema for ECS

```sql
-- Core entity table
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  type TEXT NOT NULL,              -- 'component', 'wire', 'trace', etc.
  components TEXT NOT NULL,        -- JSON blob of all components
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Indexed component fields for fast queries
CREATE INDEX idx_entities_type ON entities(project_id, type);
CREATE INDEX idx_entities_sheet ON entities(project_id, 
  json_extract(components, '$.position.sheet'));
CREATE INDEX idx_entities_layer ON entities(project_id, 
  json_extract(components, '$.position.layer'));
CREATE INDEX idx_entities_net ON entities(project_id, type)
  WHERE json_extract(components, '$.net_connection') IS NOT NULL;
```

---

## Command pattern

### Command interface

```typescript
interface Command<TPayload = unknown> {
  id: string;                    // UUID
  type: string;                  // e.g. 'place-component'
  payload: TPayload;
  timestamp: number;
  
  // Execution
  execute(state: DesignState): CommandResult;
  undo(state: DesignState): CommandResult;
  
  // Validation
  validate(state: DesignState): ValidationResult;
}

interface CommandResult {
  success: boolean;
  affectedEntities: EntityId[];  // For targeted re-render
  error?: string;
}
```

### Command bus

```typescript
class CommandBus {
  private history: Command[] = [];
  private undoneStack: Command[] = [];
  
  async dispatch(command: Command): Promise<CommandResult> {
    const validation = command.validate(this.state);
    if (!validation.valid) return { success: false, error: validation.error };
    
    const result = command.execute(this.state);
    if (result.success) {
      this.history.push(command);
      this.undoneStack = [];  // Clear redo stack
      this.persist(result.affectedEntities);
      this.notify(result.affectedEntities);  // Push to frontend via WebSocket
    }
    return result;
  }
  
  async undo(): Promise<CommandResult> { /* pop from history, push to undone */ }
  async redo(): Promise<CommandResult> { /* pop from undone, push to history */ }
}
```

### Example command

```typescript
class PlaceComponentCommand implements Command<PlaceComponentPayload> {
  type = 'place-component' as const;
  
  constructor(public payload: PlaceComponentPayload) {
    this.id = crypto.randomUUID();
    this.timestamp = Date.now();
  }
  
  validate(state: DesignState): ValidationResult {
    // Check: does the library part exist?
    // Check: is the position within board bounds?
    // Check: is the sheet valid?
    return { valid: true };
  }
  
  execute(state: DesignState): CommandResult {
    const entity = createEntityFromLibraryPart(
      this.payload.libraryRef,
      this.payload.position
    );
    state.entities.set(entity.id, entity);
    this._createdId = entity.id;  // Store for undo
    return { success: true, affectedEntities: [entity.id] };
  }
  
  undo(state: DesignState): CommandResult {
    state.entities.delete(this._createdId);
    return { success: true, affectedEntities: [this._createdId] };
  }
}
```

---

## AI integration architecture

AI tools are registered per module via MODULE_MANIFEST.json. The command pattern means AI and user share the exact same mutation path:

```
User clicks "Place R1"  →  PlaceComponentCommand  →  CommandBus  →  ECS state
AI says "place a 10k"   →  PlaceComponentCommand  →  CommandBus  →  ECS state
```

### Designer AI tools

| Tool | Description | Uses command? |
|---|---|---|
| `place-component` | Place a part at coordinates | Yes |
| `route-trace` | Route a trace between pads | Yes |
| `run-drc` | Execute design rule check | No (read-only) |
| `suggest-fix` | Suggest fixes for DRC violations | Returns suggestions |
| `get-design-state` | Read current schematic/PCB state | No (read-only) |
| `auto-assign-footprints` | Map symbols to footprints | Yes (batch) |

### Component Library AI tools

| Tool | Description |
|---|---|
| `search-parts` | Parametric search ("100nF 0402 X5R cap") |
| `suggest-alternative` | Find compatible replacements |

### AI context

For deep AI integration, the AI needs access to the full design context. The `get-design-state` tool returns a structured summary:

```typescript
{
  project: { name, sheets, boardOutline },
  entities: {
    components: [{ ref: "R1", value: "10k", footprint: "0402", nets: ["VCC","GND"] }],
    unconnected: ["U1.pin3", "C4.pin2"],
    drcViolations: [{ type: "clearance", entities: ["R1","C3"], distance: 0.1 }]
  },
  designRules: { minTraceWidth: 0.15, minClearance: 0.15 }
}
```

---

## Module manifest evolution

Current manifests define tables, tools, handlers. For the new architecture, extend to include frontend registration:

```json
{
  "name": "designer",
  "version": "1.0.0",
  "description": "Schematic and PCB design editor",
  "dependencies": ["component-library"],
  
  "tables": [
    { "name": "projects", "columns": [...] },
    { "name": "entities", "columns": [...] }
  ],
  
  "tools": [
    { "name": "place-component", "description": "...", "parameters": {...} },
    { "name": "route-trace", "description": "...", "parameters": {...} },
    { "name": "run-drc", "description": "...", "parameters": {...} }
  ],
  
  "handlers": [
    { "type": "http", "prefix": "/api/v1/designer" },
    { "type": "websocket", "channel": "designer-state" }
  ],
  
  "frontend": {
    "routes": [
      { "path": "/schematic/:projectId", "screen": "SchematicEditor" },
      { "path": "/pcb/:projectId", "screen": "PCBEditor" }
    ],
    "navigation": [
      { "label": "Schematic", "icon": "circuit", "route": "/schematic" },
      { "label": "PCB", "icon": "board", "route": "/pcb" }
    ]
  }
}
```

---

## Freemium boundary

| Feature | Free (local) | Paid (cloud) |
|---|---|---|
| Schematic editor | ✓ | ✓ |
| PCB editor | ✓ | ✓ |
| Basic DRC | ✓ | ✓ |
| Local component library | ✓ | ✓ |
| KiCad import/export | ✓ | ✓ |
| Symbol/footprint editor | ✓ | ✓ |
| Gerber export | ✓ | ✓ |
| AI chat assistant | limited | ✓ |
| AI autorouting | — | ✓ |
| AI component suggestion | — | ✓ |
| Community component library | — | ✓ |
| Cloud project backup | — | ✓ |
| Advanced DRC rules | — | ✓ |
| SPICE simulation | — | ✓ |

---

## Migration path from current → target

### Phase 1: Restructure folders
1. Create `src-react/src/core/` — move Layout, shared stores, shared UI
2. Create `src-react/src/modules/designer/` — move schematic/PCB screens, stores, render-engine
3. Create `src-react/src/modules/component-library/` — move symbol/footprint editors
4. Update imports and routing

### Phase 2: Backend module split
1. Create `src-ts/src/modules/designer/` — move project/entity domain logic
2. Create `src-ts/src/modules/component-library/` — move component/symbol/footprint logic
3. Create MODULE_MANIFEST.json for both modules
4. Wire into module loader

### Phase 3: ECS data model
1. Define ECS entity and component types
2. Build ECS engine (query, create, update, delete entities)
3. Migrate existing relational data to ECS
4. Update frontend stores to use ECS

### Phase 4: Command pattern
1. Implement CommandBus with undo/redo
2. Convert all existing mutations to commands
3. Wire WebSocket notifications for state changes
4. Update frontend to dispatch commands

### Phase 5: AI tools
1. Register AI tools per module via manifests
2. Implement `get-design-state` for AI context
3. Implement mutation tools (place, route, fix)
4. Connect AI provider system to tool registry

---

## Open questions for further discussion

1. **ECS storage granularity** — store components as JSON blob per entity (simpler) or normalize into separate tables per component type (faster queries)?
2. **Frontend ECS sync** — full state in Zustand store, or lazy-load entities as viewport moves?
3. **Command serialization** — persist command history for project-level undo across sessions?
4. **Module hot-loading** — should modules be loadable at runtime (plugin marketplace)?
5. **Rust compute** — should DRC/autorouter move to Rust for performance, called via Tauri commands?
