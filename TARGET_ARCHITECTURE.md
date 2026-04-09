# OpenPCB Target Architecture v2

## Decisions summary

| Decision | Choice |
|---|---|
| Desktop shell | **Electron** (Chromium — replacing Tauri) |
| Backend runtime | **Bun** (TS) — main business logic |
| Future compute | Rust / C++ via FFI (not this phase) |
| Data model | ECS (Entity-Component-System) |
| Business model | Freemium (free core + paid cloud) |
| Target user | Hobbyists & makers |
| Rendering | R3F (React Three Fiber) |
| AI depth | Deep (routing, DRC, component suggest) |
| Format priority | KiCad (.kicad_*) |
| Module communication | **SDK-based** (typed public interfaces) |
| Modules | Designer, ComponentLibrary, Knowledge, AIService |

---

## Runtime architecture

Two-process model replacing the previous three-layer Tauri architecture:

```
┌─────────────────────────────────────────────────────────────┐
│              Electron Renderer (Chromium)                     │
│        React 19, R3F, Zustand, TanStack Router               │
│        Module frontends (designer, library, etc.)             │
├─────────────────────────────────────────────────────────────┤
│              Electron IPC (contextBridge / preload)           │
├─────────────────────────────────────────────────────────────┤
│              Electron Main Process                            │
│        Window management, native menus, file dialogs          │
│        Spawns + manages Bun child process                     │
├──────────────────────────────────┬──────────────────────────┤
│        Bun Backend (TS)          │    Rust / C++ (future)    │
│  Module backends, SQLite,        │    Autorouter, DRC        │
│  AI orchestration, HTTP/WS       │    via FFI / NAPI         │
│  on dynamic port                 │    (not this phase)       │
└──────────────────────────────────┴──────────────────────────┘
```

### Why Electron over Tauri

- **Chromium guarantees** consistent rendering for R3F / WebGL
- **No Webview2/WebKitGTK** platform inconsistencies
- **Mature ecosystem** — better tooling, debugging, DevTools
- **Simpler IPC** — contextBridge instead of Rust bridge crates
- **Node/Bun interop** — main process can directly manage Bun backend

### Process communication

```
React (renderer)  ──HTTP/WS──►  Bun backend (child process)
React (renderer)  ──IPC─────►  Electron main (native APIs)
Bun backend       ──FFI─────►  Rust/C++ (future)
```

- **React ↔ Bun**: HTTP requests + WebSocket to dynamic port (same as current)
- **React ↔ Electron main**: IPC via contextBridge for native features (file dialogs, menus, window controls)
- **Bun ↔ Rust/C++**: FFI or NAPI (future phase, not implemented now)

### Electron main process responsibilities

The main process is thin — it only handles what requires OS-level access:

- Window lifecycle (create, resize, minimize, close)
- Native menus and keyboard shortcuts
- File open/save dialogs
- System tray
- Auto-updater
- Spawning and monitoring the Bun backend process
- Forwarding the backend port to the renderer via IPC

---

## Module system

### Four modules

| Module | Responsibility | Dependencies |
|---|---|---|
| **Designer** | Schematic + PCB editing, ECS, commands, DRC/ERC, export | ComponentLibrary SDK, AIService SDK |
| **ComponentLibrary** | Parts, symbols, footprints, KiCad import, library management | AIService SDK |
| **Knowledge** | Knowledge base, vector search, document indexing | AIService SDK |
| **AIService** | AI provider abstraction, chat, tools, task queue, streaming | None (leaf module) |

### SDK communication pattern

Modules never import each other's internals. Every cross-module call goes through a **typed SDK interface**:

```typescript
// modules/component-library/sdk/index.ts
// This is the ONLY thing other modules can import from component-library

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
}

export interface Part { /* ... */ }
export interface Symbol { /* ... */ }
export interface Footprint { /* ... */ }
export interface PartSearchParams { /* ... */ }
// ... all public types
```

```typescript
// modules/ai-service/sdk/index.ts

export interface AIServiceSDK {
  // Chat
  chat(params: ChatParams): Promise<ChatResponse>;
  streamChat(params: ChatParams): AsyncIterable<ChatChunk>;

  // Completions
  complete(params: CompletionParams): Promise<string>;

  // Embeddings
  embed(text: string): Promise<number[]>;

  // Tool execution
  executeTool(toolName: string, params: unknown): Promise<ToolResult>;

  // Provider management
  getProviders(): Promise<AIProvider[]>;
  getActiveProvider(): Promise<AIProvider>;
}
```

```typescript
// modules/designer/sdk/index.ts

export interface DesignerSDK {
  // Project
  getProject(projectId: string): Promise<Project>;
  getDesignState(projectId: string): Promise<DesignState>;

  // Commands
  dispatch(command: Command): Promise<CommandResult>;

  // Queries
  getEntities(query: EntityQuery): Promise<Entity[]>;
  getNetlist(projectId: string): Promise<Netlist>;

  // Checks
  runDRC(projectId: string): Promise<DRCResult>;
  runERC(projectId: string): Promise<ERCResult>;
}
```

```typescript
// modules/knowledge/sdk/index.ts

export interface KnowledgeSDK {
  search(query: string, options?: SearchOptions): Promise<SearchResult[]>;
  addEntry(entry: KnowledgeEntry): Promise<string>;
  getEntry(entryId: string): Promise<KnowledgeEntry>;
  deleteEntry(entryId: string): Promise<void>;
}
```

### SDK implementation wiring

SDKs are interfaces. The DI container wires implementations at startup:

```typescript
// In kernel/init.ts (startup)
import type { ComponentLibrarySDK } from '@openpcb/component-library/sdk';
import { ComponentLibraryService } from './modules/component-library/backend/domain/services';

const container = new KernelStore();

// Register SDK implementations
container.register<ComponentLibrarySDK>('ComponentLibrarySDK', () => 
  new ComponentLibraryService(container.resolve('db'))
);

container.register<AIServiceSDK>('AIServiceSDK', () =>
  new AIServiceImpl(container.resolve('providerFactory'))
);

// Designer gets its dependencies injected
container.register<DesignerSDK>('DesignerSDK', () =>
  new DesignerService(
    container.resolve('ComponentLibrarySDK'),  // injected via SDK
    container.resolve('AIServiceSDK'),          // injected via SDK
    container.resolve('db')
  )
);
```

### Import rules

```
✅  import type { Part } from '@openpcb/component-library/sdk'
✅  import { ComponentLibrarySDK } from '@openpcb/component-library/sdk'
❌  import { KicadImporter } from '@openpcb/component-library/backend/...'
❌  import { LibraryBrowser } from '@openpcb/component-library/react/...'
```

Exception: React components explicitly exported for cross-module UI use (like `PartPickerDialog`) are re-exported through the SDK:

```typescript
// modules/component-library/sdk/index.ts
// Also exports React components intended for cross-module use
export { PartPickerDialog } from '../react/components/part-picker/PartPickerDialog';
export type { PartPickerProps } from '../react/components/part-picker/PartPickerDialog';
```

---

## Project structure

```
OpenPCB/
├── electron/                    # Electron shell
│   ├── main.ts                  # Main process entry
│   ├── preload.ts               # contextBridge (IPC)
│   ├── backend-manager.ts       # Spawn + monitor Bun process
│   └── menus.ts                 # Native menus
│
├── modules/                     # ★ All domain code lives here
│   ├── designer/
│   │   ├── sdk/                 # Public SDK interface
│   │   ├── react/               # Frontend code
│   │   ├── backend/             # TS business logic
│   │   ├── MODULE_MANIFEST.json
│   │   └── index.ts
│   │
│   ├── component-library/
│   │   ├── sdk/
│   │   ├── react/
│   │   ├── backend/
│   │   ├── MODULE_MANIFEST.json
│   │   └── index.ts
│   │
│   ├── knowledge/
│   │   ├── sdk/
│   │   ├── react/
│   │   ├── backend/
│   │   ├── MODULE_MANIFEST.json
│   │   └── index.ts
│   │
│   └── ai-service/
│       ├── sdk/
│       ├── react/
│       ├── backend/
│       ├── MODULE_MANIFEST.json
│       └── index.ts
│
├── core/                        # Shared non-module code
│   ├── react/                   # App shell frontend
│   │   ├── Layout.tsx
│   │   ├── router/
│   │   ├── stores/              # app.store, navigation.store
│   │   ├── components/ui/       # Shared primitives
│   │   └── hooks/               # Shared hooks
│   │
│   ├── backend/                 # Shared backend infra
│   │   ├── kernel/              # DI container, init, module loader
│   │   ├── transport/           # Hono HTTP router
│   │   ├── db/                  # Database connection, shared migrations
│   │   └── main.ts              # Bun entry point
│   │
│   └── shared/                  # Types shared between React + backend
│       ├── types.ts
│       └── constants.ts
│
├── generated/                   # Auto-generated code
│   ├── sdk/                     # API client SDK (Orval)
│   └── modules/                 # Module type registry
│
├── scripts/                     # Build and codegen scripts
├── tests/                       # E2E tests (Playwright)
├── package.json
├── tsconfig.base.json
├── vite.config.ts
└── electron-builder.json        # Electron packaging config
```

---

## Module details

### Designer module

```
modules/designer/
├── sdk/
│   ├── index.ts                 # DesignerSDK interface + public types
│   ├── types.ts                 # Entity, Component, Command, Project types
│   └── events.ts                # Design change events
│
├── react/
│   ├── screens/
│   │   ├── SchematicEditor.tsx
│   │   └── PCBEditor.tsx
│   ├── stores/
│   │   ├── designer.store.ts    # ★ Unified ECS entity store
│   │   ├── schematic-view.store.ts  # Zoom, pan, selection, active tool
│   │   └── pcb-view.store.ts        # Layers, active tool, cursor mode
│   ├── components/
│   │   ├── render-engine/       # R3F scenes, wrappers, primitives
│   │   │   ├── RenderEngine.tsx
│   │   │   ├── scenes/
│   │   │   │   ├── SchematicScene.tsx
│   │   │   │   └── PCBScene.tsx
│   │   │   ├── primitives/      # Grid, SelectionBox, etc.
│   │   │   └── wrappers/        # SymbolWrapper, FootprintWrapper
│   │   ├── toolbars/
│   │   │   ├── SchematicToolbar.tsx
│   │   │   └── PCBToolbar.tsx
│   │   └── panels/
│   │       ├── PropertiesPanel.tsx
│   │       ├── LayerPanel.tsx
│   │       └── NetPanel.tsx
│   └── hooks/
│       ├── useCommand.ts        # Dispatch commands to backend
│       ├── useUndo.ts           # Ctrl+Z / Ctrl+Y
│       ├── useDesignEntities.ts # Query ECS entities
│       └── usePartPicker.ts     # Opens ComponentLibrary's PartPicker
│
├── backend/
│   ├── domain/
│   │   ├── models/
│   │   │   ├── entity.ts        # ECS Entity definition
│   │   │   ├── components/      # ECS Component types
│   │   │   │   ├── position.ts
│   │   │   │   ├── symbol-ref.ts
│   │   │   │   ├── footprint-ref.ts
│   │   │   │   ├── net-connection.ts
│   │   │   │   ├── value.ts
│   │   │   │   ├── wire.ts      # Schematic wire
│   │   │   │   ├── trace.ts     # PCB trace
│   │   │   │   └── via.ts
│   │   │   ├── project.ts
│   │   │   └── design-rules.ts
│   │   │
│   │   ├── services/
│   │   │   ├── ecs-engine.ts    # ★ Entity-Component query engine
│   │   │   ├── command-bus.ts   # ★ All mutations via commands
│   │   │   ├── commands/        # Command implementations
│   │   │   │   ├── place-component.cmd.ts
│   │   │   │   ├── move-entities.cmd.ts
│   │   │   │   ├── delete-entities.cmd.ts
│   │   │   │   ├── route-wire.cmd.ts
│   │   │   │   ├── route-trace.cmd.ts
│   │   │   │   ├── assign-net.cmd.ts
│   │   │   │   └── change-value.cmd.ts
│   │   │   ├── undo-redo.ts     # Command history stack
│   │   │   ├── netlist.ts       # Extract netlist from entities
│   │   │   ├── erc.ts           # Electrical Rule Check
│   │   │   ├── drc.ts           # Design Rule Check (basic TS version)
│   │   │   └── annotation.ts   # Forward/back annotation
│   │   │
│   │   └── repositories/
│   │       ├── project.repository.ts
│   │       └── entity.repository.ts
│   │
│   ├── tools/                   # AI-callable tools
│   │   ├── place-component.tool.ts
│   │   ├── route-trace.tool.ts
│   │   ├── run-drc.tool.ts
│   │   ├── suggest-fix.tool.ts
│   │   └── get-design-state.tool.ts
│   │
│   ├── handlers/                # HTTP routes
│   │   ├── project.handler.ts
│   │   ├── entity.handler.ts
│   │   ├── command.handler.ts
│   │   └── export.handler.ts    # Gerber, KiCad export
│   │
│   └── db/
│       └── schema.ts            # entities, projects, nets tables
│
├── MODULE_MANIFEST.json
└── index.ts
```

### ComponentLibrary module

```
modules/component-library/
├── sdk/
│   ├── index.ts                 # ComponentLibrarySDK interface
│   ├── types.ts                 # Part, Symbol, Footprint, SearchParams
│   └── components.ts            # Re-exported React components
│       # export { PartPickerDialog } from '../react/...'
│
├── react/
│   ├── screens/
│   │   ├── LibraryBrowser.tsx    # Browse/search parts
│   │   ├── SymbolEditor.tsx      # Create/edit schematic symbols
│   │   └── FootprintEditor.tsx   # Create/edit PCB footprints
│   ├── stores/
│   │   └── library.store.ts     # Library state, search, active lib
│   ├── components/
│   │   ├── part-picker/         # ★ Cross-module UI (exported via SDK)
│   │   │   ├── PartPickerDialog.tsx
│   │   │   └── PartCard.tsx
│   │   ├── symbol-canvas/       # R3F canvas for symbol editing
│   │   ├── footprint-canvas/    # R3F canvas for footprint editing
│   │   └── import-wizard/       # KiCad library import UI
│   └── hooks/
│       ├── useLibrarySearch.ts
│       └── useKicadImport.ts
│
├── backend/
│   ├── domain/
│   │   ├── models/
│   │   │   ├── component.ts     # Part definition (R, C, IC, etc.)
│   │   │   ├── symbol.ts        # Schematic symbol (pins, graphics)
│   │   │   ├── footprint.ts     # PCB footprint (pads, courtyard, silk)
│   │   │   ├── library-source.ts # built-in | kicad | community
│   │   │   └── parameter.ts     # Parametric properties
│   │   ├── services/
│   │   │   ├── library-manager.ts
│   │   │   ├── kicad-importer.ts     # Parse .kicad_sym, .kicad_mod
│   │   │   ├── part-search.ts        # Parametric search engine
│   │   │   └── ipc7351-generator.ts  # Generate standard footprints
│   │   └── repositories/
│   │       ├── component.repository.ts
│   │       ├── symbol.repository.ts
│   │       └── footprint.repository.ts
│   │
│   ├── tools/                   # AI-callable tools
│   │   ├── search-parts.tool.ts
│   │   └── suggest-alternative.tool.ts
│   │
│   ├── handlers/
│   │   ├── library.handler.ts
│   │   ├── component.handler.ts
│   │   └── import.handler.ts
│   │
│   └── db/
│       └── schema.ts            # components, symbols, footprints, params
│
├── MODULE_MANIFEST.json
└── index.ts
```

### AIService module

```
modules/ai-service/
├── sdk/
│   ├── index.ts                 # AIServiceSDK interface
│   └── types.ts                 # ChatParams, Provider, ToolResult, etc.
│
├── react/
│   ├── screens/
│   │   └── AISettings.tsx       # Provider config, API key management
│   ├── stores/
│   │   └── ai.store.ts          # Active provider, chat state
│   ├── components/
│   │   ├── chat/                # Chat panel UI
│   │   │   ├── ChatPanel.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   └── ToolCallDisplay.tsx
│   │   └── provider-config/     # API key forms
│   └── hooks/
│       ├── useChat.ts
│       └── useAIStream.ts
│
├── backend/
│   ├── domain/
│   │   ├── models/
│   │   │   ├── chat-session.ts
│   │   │   ├── message.ts
│   │   │   └── provider.ts
│   │   ├── services/
│   │   │   ├── chat-manager.ts      # Session management
│   │   │   ├── tool-registry.ts     # Collects tools from all modules
│   │   │   ├── tool-executor.ts     # Execute tools on behalf of AI
│   │   │   ├── stream-service.ts    # SSE/WebSocket streaming
│   │   │   └── queue/
│   │   │       ├── queue-manager.ts
│   │   │       ├── task-executor.ts
│   │   │       └── orchestrator.ts
│   │   └── repositories/
│   │       └── chat.repository.ts
│   │
│   ├── providers/               # AI provider implementations
│   │   ├── provider-interface.ts
│   │   ├── provider-factory.ts
│   │   ├── openai.ts
│   │   ├── anthropic.ts
│   │   └── ollama.ts
│   │
│   ├── handlers/
│   │   ├── chat.handler.ts
│   │   ├── provider.handler.ts
│   │   └── tool.handler.ts
│   │
│   └── db/
│       └── schema.ts            # chat_sessions, messages tables
│
├── MODULE_MANIFEST.json
└── index.ts
```

### Knowledge module

```
modules/knowledge/
├── sdk/
│   ├── index.ts                 # KnowledgeSDK interface
│   └── types.ts                 # KnowledgeEntry, SearchResult
│
├── react/
│   ├── screens/
│   │   └── KnowledgeBase.tsx
│   ├── stores/
│   │   └── knowledge.store.ts
│   ├── components/
│   │   └── entry-editor/
│   └── hooks/
│       └── useKnowledgeSearch.ts
│
├── backend/
│   ├── domain/
│   │   ├── models/
│   │   │   └── knowledge-entry.ts
│   │   ├── services/
│   │   │   ├── knowledge-service.ts
│   │   │   └── vector-search.ts
│   │   └── repositories/
│   │       └── knowledge.repository.ts
│   ├── tools/
│   │   └── search-knowledge.tool.ts
│   ├── handlers/
│   │   └── knowledge.handler.ts
│   └── db/
│       └── schema.ts
│
├── MODULE_MANIFEST.json
└── index.ts
```

---

## Core infrastructure

### core/react/ — App shell

```
core/react/
├── Layout.tsx                   # Root layout (sidebar, top bar, content area)
├── main.tsx                     # React entry point
├── router/
│   ├── index.ts                 # TanStack Router setup
│   └── module-routes.ts         # Collects routes from all modules
├── stores/
│   ├── app.store.ts             # Theme, sidebar, dialogs
│   └── navigation.store.ts      # Active screen, history
├── components/
│   └── ui/                      # Shared primitives (Button, Dialog, Input, etc.)
└── hooks/
    ├── useBackendPort.ts        # Get dynamic port from Electron IPC
    ├── useTheme.ts
    └── useElectronIPC.ts        # Typed IPC bridge
```

### core/backend/ — Shared backend

```
core/backend/
├── main.ts                      # ★ Bun entry point
├── kernel/
│   ├── init.ts                  # Bootstrap: load modules, wire DI
│   ├── store.ts                 # DI container
│   └── module-loader.ts         # Scan modules/, validate manifests, register
├── transport/
│   └── http-router.ts           # Hono — auto-registers module handlers
├── db/
│   ├── index.ts                 # DatabaseAccess singleton (SQLite + Drizzle)
│   └── migrations/              # Shared migrations
└── secrets/
    └── keystore.ts              # API key storage (electron-keytar or encrypted file)
```

### Startup sequence

```
1. Electron main starts
2. Electron spawns Bun child process (core/backend/main.ts)
3. Bun kernel initializes:
   a. Create DI container
   b. Initialize database
   c. ModuleLoader scans modules/*/MODULE_MANIFEST.json
   d. For each module:
      - Validate manifest
      - Load backend/index.ts
      - Register SDK implementation in DI container
      - Register HTTP handlers in Hono router
      - Register AI tools in AIService's tool registry
      - Run database migrations
   e. Start HTTP server on dynamic port
   f. Write {"serverPort": N} to stdout
4. Electron main captures port, sends to renderer via IPC
5. React app connects to Bun backend via HTTP/WebSocket
```

---

## Electron shell

### electron/main.ts

```typescript
import { app, BrowserWindow, ipcMain } from 'electron';
import { BackendManager } from './backend-manager';

let mainWindow: BrowserWindow;
let backendManager: BackendManager;

app.on('ready', async () => {
  // Start Bun backend
  backendManager = new BackendManager();
  const port = await backendManager.start();

  // Create window
  mainWindow = new BrowserWindow({
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  // Send port to renderer
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('backend-port', port);
  });

  mainWindow.loadFile('dist/index.html');
});

app.on('before-quit', () => {
  backendManager.stop();
});
```

### electron/preload.ts

```typescript
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Backend port
  onBackendPort: (callback: (port: number) => void) =>
    ipcRenderer.on('backend-port', (_e, port) => callback(port)),

  // Native file dialogs
  showOpenDialog: (options: OpenDialogOptions) =>
    ipcRenderer.invoke('show-open-dialog', options),
  showSaveDialog: (options: SaveDialogOptions) =>
    ipcRenderer.invoke('show-save-dialog', options),

  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getPlatform: () => process.platform,
});
```

### electron/backend-manager.ts

```typescript
import { spawn, ChildProcess } from 'child_process';

export class BackendManager {
  private process: ChildProcess | null = null;

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.process = spawn('bun', ['run', 'core/backend/main.ts'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.process.stdout?.on('data', (data) => {
        const msg = data.toString().trim();
        try {
          const parsed = JSON.parse(msg);
          if (parsed.serverPort) resolve(parsed.serverPort);
        } catch { /* not a JSON message */ }
      });

      this.process.on('error', reject);
    });
  }

  stop() {
    this.process?.kill();
  }
}
```

---

## ECS data model

### Why ECS

PCB design objects are compositional by nature. A resistor is a Position + SymbolRef + FootprintRef + Value + NetConnection. ECS makes this explicit:

- **Undo/redo** — snapshot only changed components
- **AI queries** — "all caps > 100nF on F.Cu" maps to component filters
- **Extensibility** — new component types without schema migrations
- **KiCad mapping** — clean bidirectional conversion
- **Performance** — systems iterate only relevant entities

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
```

### SQLite storage

```sql
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  type TEXT NOT NULL,
  components TEXT NOT NULL,        -- JSON blob
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_entities_type ON entities(project_id, type);
CREATE INDEX idx_entities_sheet ON entities(project_id,
  json_extract(components, '$.position.sheet'));
CREATE INDEX idx_entities_layer ON entities(project_id,
  json_extract(components, '$.position.layer'));
```

---

## Command pattern

All design mutations flow through commands. User clicks and AI tool calls use the same path:

```
User click  ─┐
              ├──►  Command  ──►  CommandBus  ──►  ECS state  ──►  Zustand notify  ──►  R3F re-render
AI tool     ─┘                        │
                                 History stack (undo/redo)
```

### Command interface

```typescript
interface Command<TPayload = unknown> {
  id: string;
  type: string;
  payload: TPayload;
  timestamp: number;

  validate(state: DesignState): ValidationResult;
  execute(state: DesignState): CommandResult;
  undo(state: DesignState): CommandResult;
}

interface CommandResult {
  success: boolean;
  affectedEntities: EntityId[];
  error?: string;
}
```

---

## AI integration

### Tool registration

Each module registers AI-callable tools via its manifest. AIService collects all tools at startup:

```json
// modules/designer/MODULE_MANIFEST.json
{
  "name": "designer",
  "tools": [
    {
      "name": "place_component",
      "description": "Place a component on the schematic",
      "parameters": { "libraryRef": "string", "x": "number", "y": "number" }
    },
    {
      "name": "run_drc",
      "description": "Run design rule check on the PCB",
      "parameters": { "projectId": "string" }
    }
  ]
}
```

### AI context flow

When AI needs to act on a design, it uses the DesignerSDK:

```
User: "Place a 10k resistor near the MCU"
  └── AIService receives message
      └── AI model calls tool: place_component
          └── AIService.toolExecutor calls DesignerSDK.dispatch(PlaceComponentCommand)
              └── Designer's CommandBus validates + executes
                  └── ECS state updated → frontend re-renders
```

---

## Module manifest (extended)

```json
{
  "name": "designer",
  "version": "1.0.0",
  "description": "Schematic and PCB design editor",
  "dependencies": ["component-library", "ai-service"],

  "tables": [
    { "name": "projects", "columns": ["id TEXT PK", "name TEXT", "..."] },
    { "name": "entities", "columns": ["id TEXT PK", "project_id TEXT FK", "..."] }
  ],

  "tools": [
    { "name": "place_component", "description": "...", "parameters": {} },
    { "name": "route_trace", "description": "...", "parameters": {} },
    { "name": "run_drc", "description": "...", "parameters": {} }
  ],

  "handlers": [
    { "type": "http", "prefix": "/api/v1/designer" },
    { "type": "websocket", "channel": "designer-state" }
  ],

  "frontend": {
    "routes": [
      { "path": "/schematic/:projectId", "screen": "SchematicEditor" },
      { "path": "/pcb/:projectId", "screen": "PCBEditor" }
    ]
  }
}
```

---

## Freemium boundary

| Feature | Free (local) | Paid (cloud) |
|---|---|---|
| Schematic + PCB editor | yes | yes |
| Basic DRC/ERC | yes | yes |
| Local component library | yes | yes |
| KiCad import/export | yes | yes |
| Symbol/footprint editor | yes | yes |
| Gerber export | yes | yes |
| AI chat (limited) | yes | yes |
| AI autorouting | — | yes |
| AI component suggestion | — | yes |
| Community component library | — | yes |
| Cloud project backup | — | yes |
| Advanced DRC rules | — | yes |
| SPICE simulation | — | yes |

---

## Migration path (from current architecture)

### Phase 1: Replace Tauri with Electron
1. Create `electron/` folder with main, preload, backend-manager
2. Remove `src-tauri/` entirely (Rust shell, bridge crates, Stronghold)
3. Replace Stronghold with electron-keytar or encrypted-file keystore
4. Update backend port announcement to work with Electron's process spawn
5. Update vite config for Electron renderer build

### Phase 2: Restructure into modules
1. Create `modules/` folder with the four modules
2. Move schematic/PCB screens, stores, render-engine → `modules/designer/react/`
3. Move symbol/footprint editors, library browser → `modules/component-library/react/`
4. Move AI providers, chat, queue → `modules/ai-service/backend/`
5. Move knowledge → `modules/knowledge/` (minimal changes)
6. Create `core/react/` with Layout, shared UI, router
7. Create `core/backend/` with kernel, transport, db
8. Update all imports

### Phase 3: Create SDKs
1. Define SDK interfaces for each module
2. Extract public types into sdk/types.ts per module
3. Wire SDK implementations via DI container
4. Replace all cross-module internal imports with SDK imports
5. Enforce import rules via eslint boundaries plugin

### Phase 4: ECS + Command pattern
1. Define ECS entity and component types in designer module
2. Implement ECS engine (query, create, update, delete)
3. Implement CommandBus with undo/redo
4. Migrate existing mutations to commands
5. Wire WebSocket state sync to frontend

### Phase 5: AI tool integration
1. Define tools in MODULE_MANIFEST for each module
2. Implement tool executor in AIService
3. Wire tools to CommandBus (designer tools dispatch commands)
4. Implement get-design-state tool for AI context

---

## Open questions

1. **SDK transport** — Should backend SDKs use direct function calls (in-process) or HTTP between modules? Direct calls are simpler for a desktop app with one Bun process.

2. **Frontend SDK pattern** — Should React-side SDK calls go through the HTTP API, or through a shared Zustand store? HTTP keeps modules decoupled; shared stores are faster.

3. **ECS storage granularity** — Components as one JSON blob per entity (simpler) vs separate rows per component type (faster queries)?

4. **Module hot-loading** — Should modules be loadable/unloadable at runtime for future plugin marketplace?

5. **Electron vs Electron Forge vs electron-vite** — Which Electron build toolchain to use?