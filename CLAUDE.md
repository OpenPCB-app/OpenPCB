# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

OpenPCB is a desktop PCB design application — a mixed TypeScript/Rust monorepo with three runtime layers:

1. **React Frontend** (`src-react/`) — Vite 7, React 19, Tailwind 4, Radix UI, Zustand, Tiptap editors
2. **Bun Sidecar** (`src-ts/`) — Hono HTTP server, Drizzle ORM (SQLite), AI providers, DDD architecture
3. **Rust Tauri Shell** (`src-tauri/`) — Tauri 2, window management, secrets vault (Stronghold), sidecar spawning

Communication: React → HTTP → Bun sidecar (dynamic port). Rust spawns Bun, reads `{"serverPort": N}` from stdout, emits `backend-ready` event.

## PCB Design Standards

**IPC 7351 Compliance:** All component footprints, land patterns, and PCB layout work must conform to IPC 7351 standard ("Generic Requirements for Surface Mount Design and Land Pattern Standard").

- **Land pattern naming:** Follow IPC-7351 naming convention (e.g., `SOIC127P600X175-8N`)
- **Density levels:** Support N (Nominal), M (Most), L (Least) producibility levels
- **Pad geometry:** Toe, heel, side fillet calculations per IPC-7351B formulas
- **Courtyard:** Include component body + clearance zone
- **Silkscreen:** Must not overlap pads; 0.1mm minimum clearance
- **Reference designators:** Place outside component courtyard

## Commands

```bash
# Setup & Dev
npm run setup              # Install all deps, compile Bun sidecar, run codegen
npm run dev                # Launch full Tauri desktop app
npm run dev:frontend       # Vite dev server only (port 1420)

# Build
npm run build              # Full production build (Bun + React + Tauri)
npm run bun:compile        # Compile Bun sidecar to binary
npm run gen                # All codegen (modules, bindings, bridge, SDK, OpenAPI)

# Test
npm run test:ts            # Bun tests (src-ts/, colocated *.test.ts)
npm run test:react         # Vitest (src-react/, happy-dom)
npm run test:e2e           # Playwright (not yet populated)

# Single test
cd src-ts && bun test path/to/file.test.ts
cd src-react && npx vitest run path/to/file.test.ts

# Typecheck
npm run typecheck          # All workspaces
npx tsc -p src-react/tsconfig.json --noEmit
cd src-ts && npx tsc --noEmit

# Rust
cargo check --manifest-path src-tauri/Cargo.toml

# Database
npm run db:generate        # Generate Drizzle migrations
npm run db:push            # Push schema to DB
npm run db:studio          # Drizzle Studio GUI
```

## Code Generation

**Codegen-heavy project.** After changing:

- Rust commands → `npm run gen:bindings` (Specta → TypeScript)
- Module manifests → `npm run module:codegen`
- API routes → `npm run gen:openapi` + `npm run gen:sdk:orval`
- Any of above → `npm run gen` (runs all)

Never edit files marked `// @generated` or `// @ts-nocheck`.

## Architecture

### Three-Layer Runtime

```
React (Vite :1420) ──HTTP──▶ Bun Sidecar (dynamic port) ◀──IPC──▶ Tauri Rust Shell
```

### Bun Sidecar DDD (`src-ts/src/`)

- `kernel/` — Tasks, init, low-level types
- `domain/services/` — ChatManager, TaskSystem, StreamService, queue orchestration
- `infrastructure/` — AI providers (OpenAI, Ollama, OpenRouter), cache, config
- `transport/` — Hono HTTP controllers and router
- `db/` — Drizzle schema, repositories
- `modules/` — Module loader, context, events

### Rust Shell (`src-tauri/`)

- `lib.rs` — Tauri builder, plugin setup, sidecar spawn, Specta export
- `commands.rs` — Tauri IPC commands (all need `#[specta::specta]`)
- `secrets.rs` — Stronghold vault for API keys
- `sidecar/bun_ts/` — Bun process spawning, port discovery, health checks
- `crates/bridge/` — BridgeRouter namespace-based request routing

### Module System (`modules/`)

- Each module: `manifest.json` + `ts/module.ts` + `react/Space.tsx`
- Sandbox isolation via `ctx.db`, `ctx.logger`, `ctx.events`
- Endpoints at `/api/modules/<id>/*` and `/ws/modules/<id>`
- Scaffold new modules with `npm run module:create`

### Schematic Canvas (`src-react/src/components/pcb/canvas/`)

- Custom Canvas2D renderer for schematic capture
- Viewport transforms, hit-testing, wire routing, symbol rendering
- State in `src-react/src/stores/schematic-store.ts` (Zustand)

## Package Managers

- **Root + src-react:** npm (workspaces)
- **src-ts:** Bun (separate `bun.lock`)
- **Rust:** Cargo workspace (src-tauri + 4 crates)

## Coding Conventions

| Package   | Indent  | Quotes | Notes                                          |
| --------- | ------- | ------ | ---------------------------------------------- |
| src-react | 2-space | double | Trailing commas, `Layout.tsx`, `useFeature.ts` |
| src-ts    | 4-space | —      | Colocated `*.test.ts`                          |
| src-tauri | rustfmt | —      | `snake_case` modules                           |

- TypeScript strict mode: `noUncheckedIndexedAccess: true`, no `any`
- Singleton services use init/get pattern in Bun sidecar
- Per-chat serialization via ChatTaskLock in task system

## Anti-Patterns

- **No `as any`** — use discriminated unions and generated types
- **No hardcoded ports** — Bun sidecar uses dynamic port assignment
- **No empty catch blocks** — always handle or rethrow
- **No direct provider calls from queue** — keep queue provider-agnostic
- **Don't remove `main.rs` pragma** — breaks Windows console hiding
- **Don't skip Stronghold for secrets** — no env vars for API keys
- **Don't log API keys**
- **No non-IPC-7351 footprints** — all land patterns must follow IPC-7351 standard
- **No arbitrary pad dimensions** — calculate from component body + tolerance using IPC formulas

## Subtree AGENTS.md Files

Read the nearest `AGENTS.md` before editing inside a subtree:

- `src-ts/AGENTS.md` — Bun sidecar, task system, DDD layers
- `src-tauri/AGENTS.md` — Rust shell, bridge pattern, sidecar communication
- `modules/AGENTS.md` — Module system, manifest rules, lifecycle
- Additional AGENTS.md files exist in `src-react/src/hooks/`, `src-react/src/components/ai-elements/`, `src-ts/src/domain/services/tools/`, `src-ts/src/domain/services/queue/`, `src-ts/src/infrastructure/ai-providers/engines/`
