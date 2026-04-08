# OpenPCB Architecture Documentation

## Overview

**OpenPCB** is a modern desktop PCB (Printed Circuit Board) design application built as a mixed TypeScript/Rust monorepo. It follows a three-layer runtime architecture with a React frontend, Bun backend sidecar, and Rust Tauri desktop shell.

**Version**: v0.1.0 (active development, no backward compatibility required)

---

## Table of Contents

1. [High-Level Architecture](#high-level-architecture)
2. [Project Structure](#project-structure)
3. [Layer 1: React Frontend (src-react/)](#layer-1-react-frontend-src-react)
4. [Layer 2: Bun Backend (src-ts/)](#layer-2-bun-backend-src-ts)
5. [Layer 3: Rust Tauri Shell (src-tauri/)](#layer-3-rust-tauri-shell-src-tauri)
6. [Module System](#module-system)
7. [Cross-Layer Communication](#cross-layer-communication)
8. [Build System & Development Workflow](#build-system--development-workflow)
9. [Code Generation Pipeline](#code-generation-pipeline)
10. [Testing Strategy](#testing-strategy)
11. [Key Architectural Decisions](#key-architectural-decisions)

---

## High-Level Architecture

### Three-Layer Runtime

```
┌─────────────────────────────────────────────────────────────────┐
│                    React Frontend                               │
│         (src-react/ - Vite, React 19, R3F, Tailwind)            │
├─────────────────────────────────────────────────────────────────┤
│                         HTTP/WebSocket                          │
├─────────────────────────────────────────────────────────────────┤
│                    Bun Backend Sidecar                          │
│     (src-ts/ - Hono, Drizzle ORM, AI Providers, Tasks)          │
├─────────────────────────────────────────────────────────────────┤
│                         Stdin/Stdout IPC                        │
├─────────────────────────────────────────────────────────────────┤
│                    Rust Tauri Shell                             │
│  (src-tauri/ - Desktop Integration, Stronghold, Plugins)        │
└─────────────────────────────────────────────────────────────────┘
```

### Communication Flow

1. **React ↔ Bun**: HTTP requests to dynamic port (WebSocket upgrade supported)
2. **Bun ↔ Rust**: Stdin/stdout JSON messages + Tauri commands
3. **Rust → OS**: Native APIs, windowing, secrets vault, file system

---

## Project Structure

```
OpenPCB/
├── src-react/           # React 19 frontend (Vite)
├── src-ts/              # Bun backend sidecar (DDD architecture)
├── src-tauri/           # Rust Tauri desktop shell
├── modules/             # Module manifests and definitions
├── scripts/             # Build and code generation scripts
├── shared/              # Shared types between frontend/backend
├── bin/                 # Compiled Bun sidecar binary output
├── .claude/             # Claude-specific configuration and skills
├── package.json         # Root npm configuration
├── tsconfig.base.json   # Base TypeScript configuration
└── vite.config.ts       # Vite configuration
```

### Key Configuration Files

- `/package.json` - Root workspace configuration
- `/tsconfig.base.json` - Shared TypeScript settings
- `/vite.config.ts` - Vite build configuration
- `/drizzle.config.ts` - Database ORM configuration
- `/playwright.config.ts` - E2E testing configuration
- `/src-tauri/Cargo.toml` - Rust dependencies
- `/src-tauri/tauri.conf.json` - Tauri application config
- `/src-tauri/capabilities/*.json` - Tauri permission capabilities

---

## Layer 1: React Frontend (src-react/)

### Technology Stack

- **Framework**: React 19 (RC)
- **Build Tool**: Vite 6
- **Language**: TypeScript 5.7 (strict mode)
- **Styling**: Tailwind CSS 4, Radix UI
- **3D Rendering**: React Three Fiber (R3F), Three.js
- **State Management**: Zustand
- **Routing**: TanStack Router
- **Forms**: TanStack Form
- **Build Output**: `dist/` → bundled into Tauri app

### Directory Structure

```
src-react/
├── src/
│   ├── components/          # UI components
│   │   ├── ai-elements/     # AI chat components
│   │   ├── render-engine/   # Canvas rendering (R3F)
│   │   ├── ui/              # Reusable UI primitives
│   │   └── ...
│   ├── hooks/               # Custom React hooks
│   ├── screens/             # Page/screen components
│   │   ├── SchematicEditor.tsx
│   │   ├── PCBEditor.tsx
│   │   ├── SymbolEditor.tsx
│   │   ├── FootprintEditor.tsx
│   │   └── ...
│   ├── stores/              # Zustand state stores
│   │   ├── app.store.ts
│   │   ├── schematic.store.ts
│   │   ├── pcb.store.ts
│   │   └── navigation.store.ts
│   ├── generated/           # Auto-generated code
│   │   ├── sdk/             # API client SDK
│   │   ├── rust-bindings/   # Tauri command bindings
│   │   └── modules/         # Generated module types
│   ├── lib/                 # Utilities
│   ├── styles/              # Global styles
│   ├── main.tsx             # React entry point
│   ├── Layout.tsx           # Root layout component (no App.tsx)
│   └── index.html           # HTML shell with theme script
├── public/                  # Static assets
├── package.json
├── tsconfig.json
└── vite.config.ts
```

### Key Entry Points

- **HTML**: `src-react/index.html` - HTML shell with theme pre-apply script
- **React Entry**: `src-react/src/main.tsx` - React 19 mount point
- **Root Component**: `src-react/src/Layout.tsx` - Application root (replaces App.tsx)

### State Management

Uses **Zustand** with separate stores for different domains:

| Store                 | Purpose          | Key State                         |
| --------------------- | ---------------- | --------------------------------- |
| `app.store.ts`        | Global app state | theme, sidebar, dialogs           |
| `schematic.store.ts`  | Schematic editor | symbols, wires, nets, selection   |
| `pcb.store.ts`        | PCB editor       | footprints, traces, layers, board |
| `navigation.store.ts` | Navigation       | active screen, history            |

### Editor Architecture (R3F)

Four specialized canvas editors using React Three Fiber:

1. **SchematicEditor** - Symbol placement, wire routing (Manhattan), net labels
2. **PCBEditor** - Trace routing, via placement, layer management, ratsnest
3. **SymbolEditor** - Symbol creation, pin definition, graphics
4. **FootprintEditor** - Footprint creation, pad placement, courtyard

#### Render Engine Structure

```
src/components/render-engine/
├── RenderEngine.tsx          # Main renderer wrapper
├── scenes/                   # Scene configurations per editor
│   ├── SchematicScene.tsx
│   ├── PCBScene.tsx
│   ├── SymbolScene.tsx
│   └── FootprintScene.tsx
├── wrappers/                 # Component wrappers
│   ├── SymbolWrapper.tsx
│   ├── FootprintWrapper.tsx
│   └── ...
└── primitives/               # R3F primitives
    ├── Grid.tsx
    ├── SelectionBox.tsx
    └── ...
```

#### Rendering Patterns

- **InstancedMesh** for high-count items (pads, vias)
- **Line segments** for traces and wires
- **Text rendering** via texture atlases
- **Hit testing** via raycasting
- **Coordinate systems**: nm ↔ mm ↔ screen space conversion

### Component Hierarchy

```
Layout.tsx
├── Navigation (sidebar/top bar)
├── Screen Router
│   ├── SchematicEditor
│   │   ├── RenderEngine
│   │   ├── ToolBar
│   │   └── PropertiesPanel
│   ├── PCBEditor
│   │   ├── RenderEngine
│   │   ├── LayerPanel
│   │   └── ToolBar
│   ├── SymbolEditor
│   ├── FootprintEditor
│   └── ... other screens
└── Dialogs/Modals
```

### API Integration

Uses auto-generated SDK from OpenAPI specification:

```typescript
// src/generated/sdk/
├── index.ts          # SDK exports
├── axios-client.ts   # Axios HTTP client
├── orval.config.ts   # Orval generation config
└── [generated endpoints]
```

**Pattern**: TanStack Query + generated SDK for server state

---

## Layer 2: Bun Backend (src-ts/)

### Technology Stack

- **Runtime**: Bun
- **HTTP Framework**: Hono (with Zod validator)
- **Database**: SQLite + Drizzle ORM
- **WebSocket**: Hono native
- **AI Integration**: Multiple provider abstraction
- **Architecture**: Domain-Driven Design (DDD)

### Architecture Pattern: Domain-Driven Design

```
src-ts/
├── src/
│   ├── domain/              # Domain layer (business logic)
│   │   ├── models/          # Domain entities
│   │   ├── services/        # Domain services
│   │   │   ├── tools/       # Tool system
│   │   │   ├── queue/       # Task queue
│   │   │   └── ai/          # AI chat management
│   │   └── repositories/    # Repository interfaces
│   ├── infrastructure/      # Infrastructure layer
│   │   ├── ai-providers/    # AI provider implementations
│   │   ├── persistence/     # DB implementations
│   │   └── transport/       # HTTP/WebSocket
│   ├── db/                  # Database layer (Drizzle)
│   │   ├── schema/          # Table schemas
│   │   ├── migrations/      # Drizzle migrations
│   │   └── index.ts         # DatabaseAccess singleton
│   ├── kernel/              # Core runtime
│   │   ├── init.ts          # Kernel initialization
│   │   ├── store.ts         # DI container
│   │   └── tasks/           # Task system
│   ├── modules/             # Module integration
│   ├── transport/           # HTTP router
│   │   └── http-router.ts   # Hono router setup
│   └── main.ts              # Entry point
├── shared/                  # Shared types
└── test/                    # Test setup
```

### Main Entry Point

**File**: `src-ts/src/main.ts`

```typescript
// Initializes:
// 1. DI container (kernel/store.ts)
// 2. Database connection
// 3. Module loader
// 4. HTTP server (Hono)
// 5. Announces port to Rust via stdout
```

### Dependency Injection

Uses a custom lightweight DI container:

**File**: `src-ts/src/kernel/store.ts`

```typescript
class KernelStore {
  register<T>(token: string, factory: () => T): void;
  resolve<T>(token: string): T;
  // Singleton lifecycle management
}
```

### HTTP API Architecture

**Router**: `src-ts/src/transport/http-router.ts`

```typescript
// Hono app with:
// - Zod validation middleware
// - CORS for frontend
// - Route grouping by domain
// - WebSocket upgrade support
```

**API Structure**:

```
/api/v1/
├── /ai/              # AI provider endpoints
├── /tasks/           # Task queue management
├── /chat/            # Chat sessions
├── /tools/           # Tool execution
├── /modules/         # Module API
└── /health           # Health check
```

### Database Layer (Drizzle ORM)

**Location**: `src-ts/src/db/`

**Schema Files**:

- `src-ts/src/db/schema/tasks.ts` - Task definitions
- `src-ts/src/db/schema/chat.ts` - Chat sessions/messages
- `src-ts/src/db/schema/components.ts` - Component library
- `src-ts/src/db/schema/projects.ts` - Project metadata

**Pattern**: DatabaseAccess singleton for connection management

```typescript
// src-ts/src/db/index.ts
class DatabaseAccess {
  private static instance: DatabaseAccess;
  public db: ReturnType<typeof drizzle>;

  static getInstance(): DatabaseAccess;
  async migrate(): Promise<void>;
}
```

### AI Provider System

**Location**: `src-ts/src/infrastructure/ai-providers/`

**Architecture**:

```
ai-providers/
├── engines/              # Provider implementations
│   ├── openai.ts
│   ├── anthropic.ts
│   └── ollama.ts
├── provider-interface.ts # Abstract provider interface
└── provider-factory.ts   # Provider instantiation
```

**Key Feature**: Provider-agnostic abstraction for queue system

### Task Execution & Queue System

**Location**: `src-ts/src/domain/services/queue/`

**Components**:

- `queue-manager.ts` - Queue state management
- `task-executor.ts` - Task execution engine
- `orchestrator.ts` - Queue orchestration
- `stream-service.ts` - SSE/WebSocket streaming

**Pattern**: Task-based async execution with streaming results

### Tool System

**Location**: `src-ts/src/domain/services/tools/`

**Purpose**: AI-callable tool registry

**Structure**:

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: z.ZodSchema;
  execute: (params: any) => Promise<any>;
}
```

---

## Layer 3: Rust Tauri Shell (src-tauri/)

### Technology Stack

- **Framework**: Tauri 2.0 RC
- **Language**: Rust
- **Build Tool**: Cargo
- **Security**: Stronghold (secrets vault)
- **Plugins**: Custom + Official

### Project Structure

```
src-tauri/
├── src/
│   ├── lib.rs              # Library entry (tauri::Builder setup)
│   ├── main.rs             # Binary entry (Windows console hiding)
│   ├── commands.rs         # Tauri command definitions
│   ├── plugins.rs          # Plugin registration
│   ├── secrets.rs          # Stronghold secrets management
│   ├── window.rs           # Window management
│   └── sidecar/
│       └── bun_ts/         # Bun sidecar management
│           ├── bun_runtime.rs   # Process spawning
│           └── bun_bridge.rs    # IPC bridge
├── crates/
│   ├── bridge/             # Rust-Bun bridge
│   │   └── src/lib.rs
│   ├── bridge-macros/      # Procedural macros
│   │   └── src/lib.rs
│   ├── core_bridge/        # Core bridge types
│   │   └── src/lib.rs
│   └── secrets_bridge/     # Secrets bridge
│       └── src/lib.rs
├── capabilities/           # Tauri capability definitions
│   └── default.json
├── tauri.conf.json         # Tauri configuration
├── Cargo.toml              # Rust dependencies
└── build.rs                # Build script
```

### Entry Points

**Binary Entry**: `src-tauri/src/main.rs`

```rust
// Windows-specific: hides console window
// Calls lib::run()
```

**Library Entry**: `src-tauri/src/lib.rs`

```rust
// Tauri::Builder setup
// - Plugin registration
// - Command mounting
// - Sidecar spawning
// - Event handlers
```

### Sidecar Architecture (Bun Integration)

**Purpose**: Spawn Bun backend as managed sidecar process

**Files**:

- `src-tauri/src/sidecar/bun_ts/bun_runtime.rs` - Process management
- `src-tauri/src/sidecar/bun_ts/bun_bridge.rs` - IPC bridge

**Flow**:

```
1. Rust spawns Bun process (src-ts/bin/openpcb-sidecar)
2. Bun starts HTTP server on dynamic port
3. Bun writes {"serverPort": N} to stdout
4. Rust parses port and emits "backend-ready" event
5. React receives port and connects via HTTP
```

### Tauri Commands

**File**: `src-tauri/src/commands.rs`

**Pattern**: Commands call into bridge crates for Bun communication

```rust
#[tauri::command]
async fn get_ai_providers() -> Result<Vec<Provider>, Error> {
    // Call Bun via bridge
}
```

### Bridge Crates

**Purpose**: Type-safe IPC between Rust and Bun

**Structure**:

```
crates/
├── bridge/              # Main bridge interface
├── bridge-macros/       # #[bridge_command] macro
├── core_bridge/         # Core types
└── secrets_bridge/      # Secrets vault bridge
```

**Communication Protocol**:

- Rust → Bun: JSON over stdin
- Bun → Rust: JSON over stdout
- Type generation via Specta

### Security (Stronghold)

**File**: `src-tauri/src/secrets.rs`

**Purpose**: Secure storage for API keys and credentials

**Features**:

- Encrypted vault using Stronghold
- Client-side encryption
- Secure key derivation

### Capabilities

**Location**: `src-tauri/capabilities/default.json`

**Purpose**: Tauri v2 permission system

**Permissions**:

- `core:default` - Core APIs
- `dialog:allow-open` - File dialogs
- `fs:allow-read/write` - File system access
- Custom plugin permissions

---

## Module System

### Overview

Plugin-like module system for extending functionality. Modules define:

- Tools (AI-callable functions)
- Database tables
- IPC handlers
- Lifecycles

### Module Manifest Format

**File**: `modules/MODULE_MANIFEST_SCHEMA.json`

**Example**: `modules/knowledge/MODULE_MANIFEST.json`

```json
{
  "name": "knowledge",
  "version": "1.0.0",
  "description": "Knowledge base module",
  "tables": [
    {
      "name": "knowledge_entries",
      "columns": [...]
    }
  ],
  "tools": [
    {
      "name": "search_knowledge",
      "description": "Search knowledge base",
      "parameters": {...}
    }
  ],
  "handlers": [
    {
      "name": "onInit",
      "type": "lifecycle"
    }
  ]
}
```

### Module SDK (\_kit)

**Location**: `src-ts/src/modules/_kit/`

**Files**:

- `module-loader.ts` - Runtime module loading
- `registry.ts` - Module registry (generated)
- `types.ts` - Module type definitions
- `file-utils.ts` - File utilities

### Code Generation Pipeline

**Command**: `npm run module:codegen` (runs `scripts/gen-modules.ts`)

**Flow**:

```
1. Scan modules/ for MODULE_MANIFEST.json files
2. Validate against schema
3. Generate TypeScript types
4. Generate database migrations
5. Generate SDK bindings
6. Update registry.ts
```

**Generated Files**:

- `src-ts/src/modules/registry.ts` - Module registry
- `src-react/src/generated/modules/` - Frontend types
- Database migrations in `src-ts/src/db/migrations/`

### Built-in Modules

**Location**: `modules/`

| Module             | Purpose                           |
| ------------------ | --------------------------------- |
| `knowledge/`       | Knowledge base with vector search |
| (others may exist) | Check modules/ directory          |

### Module Lifecycle

```
1. Kernel initializes
2. ModuleLoader scans modules/
3. Validates manifests
4. Loads enabled modules
5. Calls onInit lifecycle
6. Registers tools with ToolRegistry
7. Sets up IPC handlers
8. Runs migrations
```

---

## Cross-Layer Communication

### React ↔ Bun (HTTP)

**Protocol**: HTTP/1.1 with WebSocket upgrade

**Client**: Generated Axios client from OpenAPI

**Server**: Hono with Zod validation

**Port Assignment**:

- Bun finds available port
- Writes to stdout: `{"serverPort": 3000}`
- Rust captures and forwards to frontend

### Bun ↔ Rust (Stdin/Stdout IPC)

**Protocol**: Newline-delimited JSON (NDJSON)

**Direction**:

- Bun → Rust: stdout
- Rust → Bun: stdin

**Message Format**:

```json
{"type": "command", "id": "uuid", "payload": {...}}
```

### Rust ↔ OS

**Via Tauri APIs**:

- Window management
- File system access
- Native dialogs
- System notifications

---

## Build System & Development Workflow

### Package Manager

**Primary**: npm (root workspace)
**Bun**: Used for src-ts/ runtime and testing

### Workspace Structure

```json
// root package.json
{
  "workspaces": ["src-react", "src-ts"]
}
```

### npm Scripts

| Script                 | Purpose                               |
| ---------------------- | ------------------------------------- |
| `npm run dev`          | Browser dev mode (frontend + backend) |
| `npm run dev:desktop`  | Tauri desktop app                     |
| `npm run dev:backend`  | Bun sidecar only (port 3000)          |
| `npm run dev:frontend` | Vite only (port 1420)                 |
| `npm run build`        | Full production build                 |
| `npm run bun:compile`  | Compile Bun to binary                 |
| `npm run gen`          | Run all code generation               |
| `npm run gen:check`    | Verify generated files committed      |

### Development Mode

**Browser-first development** (mandatory):

```bash
npm run dev
# Starts: Bun backend + Vite frontend concurrently
```

**Ports**:

- Frontend: 1420 (Vite)
- Backend: Dynamic (announced via stdout)

### TypeScript Configuration

**Base**: `tsconfig.base.json`

- Strict mode enabled
- `noUncheckedIndexedAccess: true`
- Shared compiler options

**Per-Package**:

- `src-react/tsconfig.json` - Frontend-specific
- `src-ts/tsconfig.json` - Backend-specific

### Development Commands Reference

```bash
# Setup
npm run setup          # Install deps, compile Bun, run codegen

# Development
npm run dev            # Browser mode (RECOMMENDED)
npm run dev:desktop    # Tauri desktop
npm run dev:backend    # Bun only
npm run dev:frontend   # Vite only

# Build
npm run build          # Production build
npm run bun:compile    # Compile sidecar binary

# Code Generation
npm run gen            # All codegen
npm run gen:bindings   # Rust→TS bindings (Specta)
npm run gen:openapi    # API spec
npm run gen:sdk:orval  # Generate SDK from OpenAPI
npm run module:codegen # Module registry

# Testing
npm run test:ts        # Bun tests
npm run test:react     # Vitest tests
npm run test:e2e       # Playwright tests
npm run typecheck      # TypeScript strict check
```

---

## Code Generation Pipeline

### Overview

Heavy use of code generation for type safety across layers.

### Generation Targets

| Target           | Source                           | Output                                   | Command          |
| ---------------- | -------------------------------- | ---------------------------------------- | ---------------- |
| Rust→TS Bindings | `src-tauri/src/commands.rs`      | `src-react/src/generated/rust-bindings/` | `gen:bindings`   |
| OpenAPI Spec     | Hono routes                      | `openapi.json`                           | `gen:openapi`    |
| TypeScript SDK   | `openapi.json`                   | `src-react/src/generated/sdk/`           | `gen:sdk:orval`  |
| Module Registry  | `modules/*/MODULE_MANIFEST.json` | `src-ts/src/modules/registry.ts`         | `module:codegen` |
| Module Types     | Manifests                        | `src-react/src/generated/modules/`       | `module:codegen` |

### Generation Tools

1. **Specta** - Rust→TypeScript type export
2. **Orval** - OpenAPI→TypeScript SDK
3. **Drizzle Kit** - Database migrations
4. **Custom scripts** - Module codegen

### Important: Never Edit Generated Files

Files marked with `// @generated` or `// @ts-nocheck` are auto-generated. Edit sources, then regenerate.

---

## Testing Strategy

### Three Test Runners

| Runner         | Purpose          | Location                          |
| -------------- | ---------------- | --------------------------------- |
| **Bun Test**   | Unit/integration | `src-ts/**/*.test.ts` (colocated) |
| **Vitest**     | Component tests  | `src-react/`                      |
| **Playwright** | E2E tests        | `tests/e2e/`                      |

### Bun Test (src-ts/)

**Pattern**: Colocated tests (same dir as source)

```typescript
// src-ts/src/domain/services/task-executor.test.ts
import { describe, it, expect } from "bun:test";

describe("TaskExecutor", () => {
  it("should execute tasks", async () => {
    // Test implementation
  });
});
```

**Setup**: `src-ts/test/setup.ts`

- Sets NODE_ENV
- Configures APP_DATA_DIR

### Vitest (src-react/)

**Configuration**: `vite.config.ts`

**Environment**: `happy-dom`

**Libraries**: `@testing-library/react`

### Playwright (E2E)

**Configuration**: `/playwright.config.ts`

**Pattern**: Browser automation tests

**Requirements**:

- All UI changes MUST be verified via Playwright
- Tests at `tests/e2e/*.spec.ts`
- Supports light/dark theme testing
- Accessibility testing with axe

**Two Approaches**:

1. **Playwright MCP** - Interactive exploration, persistent state
2. **playwright-cli** - Token-efficient, quick verification

### Test Commands

```bash
npm run test:ts        # Bun tests (colocated)
npm run test:react     # Vitest component tests
npm run test:e2e       # Playwright E2E tests
npx playwright test tests/e2e/schematic-editor.spec.ts
npx playwright test --ui  # UI mode for debugging
```

---

## Key Architectural Decisions

### 1. Browser-First Development

**Decision**: Always develop against browser target, not Tauri desktop.

**Rationale**:

- Faster iteration
- Better debugging
- Hot reload works better

**Exception**: Use `dev:desktop` only for native feature testing.

### 2. Three-Layer Separation

**Decision**: Clear separation between React, Bun, and Rust.

**Benefits**:

- Independent scaling
- Clear responsibility boundaries
- Language-appropriate tooling per layer

### 3. Domain-Driven Design (DDD)

**Decision**: DDD architecture for Bun backend.

**Structure**:

- `domain/` - Business logic, pure
- `infrastructure/` - I/O, external services
- `db/` - Persistence details

### 4. Dynamic Port Assignment

**Decision**: Bun finds available port, announces via stdout.

**Benefits**:

- No port conflicts
- Multiple instances possible
- CI-friendly

### 5. Code Generation-Heavy

**Decision**: Extensive code generation for type safety.

**Trade-off**:

- More setup complexity
- But: Type-safe cross-layer communication

### 6. No Backward Compatibility

**Decision**: v0.1.0, delete old code immediately when refactoring.

**Rationale**:

- Active development phase
- No migration burden
- Cleaner codebase

### 7. IPC Standards Compliance

**Decision**: All PCB design follows IPC-7351 standard.

**Applies to**:

- Footprint generation
- Clearance rules
- Trace width calculations
- Layer stackup definitions

### 8. Module System for Extensibility

**Decision**: Module manifests define tools, tables, handlers.

**Benefits**:

- Plugin-like extensibility
- Clear boundaries
- Code generation from manifests

### 9. AI Provider Abstraction

**Decision**: Provider-agnostic AI system with task queue.

**Benefits**:

- Swap providers without changing queue logic
- Consistent interface
- Easy to add new providers

### 10. Strict TypeScript

**Decision**: `strict: true` + `noUncheckedIndexedAccess: true`

**Enforcement**:

- No `as any`
- No `@ts-ignore`
- Must handle undefined index access

---

## File Paths Reference

### Key Source Files

| Purpose       | Path                                  |
| ------------- | ------------------------------------- |
| React Entry   | `src-react/src/main.tsx`              |
| React Layout  | `src-react/src/Layout.tsx`            |
| Bun Entry     | `src-ts/src/main.ts`                  |
| DI Container  | `src-ts/src/kernel/store.ts`          |
| HTTP Router   | `src-ts/src/transport/http-router.ts` |
| Rust Binary   | `src-tauri/src/main.rs`               |
| Rust Library  | `src-tauri/src/lib.rs`                |
| Tauri Config  | `src-tauri/tauri.conf.json`           |
| Module Schema | `modules/MODULE_MANIFEST_SCHEMA.json` |

### Key Configuration Files

| Purpose           | Path                   |
| ----------------- | ---------------------- |
| Root Package      | `package.json`         |
| Base TS Config    | `tsconfig.base.json`   |
| Vite Config       | `vite.config.ts`       |
| Drizzle Config    | `drizzle.config.ts`    |
| Playwright Config | `playwright.config.ts` |
| Cargo Config      | `src-tauri/Cargo.toml` |

### Generated Files (Do Not Edit)

| Purpose         | Path                                     |
| --------------- | ---------------------------------------- |
| Rust Bindings   | `src-react/src/generated/rust-bindings/` |
| API SDK         | `src-react/src/generated/sdk/`           |
| Module Types    | `src-react/src/generated/modules/`       |
| Module Registry | `src-ts/src/modules/registry.ts`         |
| OpenAPI Spec    | `openapi.json`                           |

---

## Anti-Patterns (Explicitly Forbidden)

Per `AGENTS.md`:

| Anti-Pattern                      | Reason                       |
| --------------------------------- | ---------------------------- |
| `as any`                          | Type safety violation        |
| `@ts-ignore` / `@ts-expect-error` | Bypasses type checking       |
| Empty catch blocks                | Swallows errors silently     |
| Hardcoded ports                   | Dynamic assignment required  |
| Direct provider calls from queue  | Keep queue provider-agnostic |
| Non-IPC-7351 footprints           | Manufacturing compliance     |
| Silkscreen over pads              | IPC clearance violation      |
| Legacy code during refactor       | Delete immediately           |
| Skip Playwright verification      | UI changes require testing   |
| Use Tauri desktop for dev         | Use browser mode instead     |

---

## Additional Resources

### Agent Guidelines

Per-directory `AGENTS.md` files:

- `/AGENTS.md` - Root guidelines
- `/src-ts/AGENTS.md` - Bun backend
- `/src-tauri/AGENTS.md` - Rust shell
- `/modules/AGENTS.md` - Module system
- `/src-react/src/hooks/AGENTS.md` - React hooks
- `/src-react/src/components/ai-elements/AGENTS.md` - AI components
- `/src-ts/src/domain/services/tools/AGENTS.md` - Tool system
- `/src-ts/src/domain/services/queue/AGENTS.md` - Task queue
- `/src-ts/src/infrastructure/ai-providers/engines/AGENTS.md` - AI providers

### Claude Skills

`.claude/skills/`:

- `component-library/` - Component system
- `eda-standards/` - PCB manufacturing standards
- `r3f-eda-rendering/` - React Three Fiber rendering
- `pcb-layout/` - PCB editor
- `schematic-editor/` - Schematic editor
- `playwright-cli/` - Browser automation

---

## Summary

OpenPCB is a sophisticated three-layer desktop application for PCB design:

1. **React Frontend** - Modern React 19 with R3F for canvas editing
2. **Bun Backend** - DDD architecture with AI providers and task queues
3. **Rust Shell** - Tauri 2 with secure secrets and sidecar management

Key strengths:

- Type-safe cross-layer communication via code generation
- Modular extensibility via module system
- Browser-first development workflow
- IPC-7351 compliant PCB design
- Comprehensive testing (unit, component, E2E)

Current state: v0.1.0, active development, no backward compatibility constraints.
