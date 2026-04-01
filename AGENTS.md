# Repository Guidelines

## Project Structure & Module Organization

OpenPCB is a desktop PCB application built as a mixed TypeScript/Rust monorepo with Tauri 2, React 19, and Bun. `src-react/` contains the React 19 UI (`src/components`, `src/hooks`, `src/screens`, `src/generated`). `src-ts/` is the Bun sidecar and shared backend logic implementing DDD architecture (`src/domain`, `src/infrastructure`, `src/db`, `shared/`). `src-tauri/` is the Rust desktop shell plus bridge crates. Reusable module definitions live in `modules/`, automation lives in `scripts/`.

## PCB Design Standards (IPC 7351)

**All PCB layout, footprint generation, and component placement must comply with IPC 7351 standard.** This includes:

- **Land pattern calculations:** Toe, heel, and side fillet dimensions per IPC-7351B formulas
- **Density levels:** N (Nominal), M (Most), L (Least) — default to N unless specified
- **Naming convention:** `<PackageType><Pitch>P<Length>X<Width>-<PinCount><DensityLevel>` (e.g., `SOIC127P600X175-8N`)
- **Courtyard:** Component body outline + keepout clearance (typically 0.25mm for N level)
- **Silkscreen rules:** 0.1mm minimum clearance from pads, no overlap with solder mask openings
- **Assembly clearance:** Maintain per IPC-7351 Table 3-3 for component-to-component spacing
- **Thermal relief:** Follow IPC-2221 for power/ground plane connections

When generating or validating footprints, always calculate pad geometry from datasheet body dimensions + tolerances using IPC formulas rather than copying manufacturer-provided patterns.

## Architecture Overview

**Three-layer runtime:**

1. **Rust Tauri Shell** (`src-tauri/`) - Desktop integration, window management, secrets vault (Stronghold), plugin system
2. **Bun Sidecar** (`src-ts/`) - HTTP/WebSocket server with Hono, AI providers, task orchestration, Drizzle ORM
3. **React Frontend** (`src-react/`) - Vite-built UI with Tailwind 4, Radix UI, Tiptap editors

**Communication:** React ↔ HTTP → Bun sidecar (dynamic port discovery). Rust spawns Bun process, monitors stdout for `{"serverPort": N}`, emits `backend-ready` event.

## Entry Points

| Layer    | Entry                    | Role                                            |
| -------- | ------------------------ | ----------------------------------------------- |
| Frontend | `src-react/src/main.tsx` | React 19 mount (no App.tsx; Layout.tsx is root) |
| Frontend | `src-react/index.html`   | HTML shell with theme pre-apply script          |
| Bun      | `src-ts/src/main.ts`     | Hono HTTP server, DI container, module loader   |
| Rust     | `src-tauri/src/main.rs`  | Binary entry (calls lib::run)                   |
| Rust     | `src-tauri/src/lib.rs`   | Tauri builder, plugin setup, sidecar spawn      |

## Build, Test, and Development Commands

**Setup:**

```bash
npm run setup          # Install deps, compile Bun, run codegen
npm run dev            # Start Tauri desktop app
npm run dev:frontend   # Vite dev server only (port 1420)
```

**Build:**

```bash
npm run build          # Full production build
npm run bun:compile    # Compile Bun sidecar to binary
npm run gen            # Run all codegen (modules, bindings, bridge, SDK, OpenAPI)
npm run gen:check      # Verify generated files are committed
```

**Test:**

```bash
npm run test:ts        # Bun tests (colocated *.test.ts)
npm run test:react     # Vitest tests (happy-dom)
npm run test:e2e       # Playwright (tests/e2e/ not yet created)
npm run typecheck      # TypeScript strict check all workspaces
```

## Coding Style & Naming Conventions

| Package      | Indent          | Quotes | Trailing | Naming                        |
| ------------ | --------------- | ------ | -------- | ----------------------------- |
| `src-react/` | 2-space         | double | yes      | `Layout.tsx`, `useFeature.ts` |
| `src-ts/`    | 4-space         | -      | -        | Colocated `*.test.ts`         |
| `src-tauri/` | rustfmt default | -      | -        | `snake_case` modules          |

**Strict TypeScript:** `strict: true`, `noUncheckedIndexedAccess: true` in `tsconfig.base.json`. Avoid `any`; use generated types.

## Testing Guidelines

**Three test runners:**

1. **Bun Test** (`src-ts/`) - Unit/integration tests colocated as `*.test.ts`
2. **Vitest** (`src-react/`) - Component tests with `happy-dom`, `@testing-library/react`
3. **Playwright** - E2E tests (config exists, directory not yet implemented)

**Patterns:**

- Colocated tests preferred (same dir as source)
- `__tests__/` subdirs for complex modules (tools, oauth)
- Global setup: `src-ts/test/setup.ts` (sets NODE_ENV, APP_DATA_DIR)
- Mock factories for dependencies (see `task-executor.test.ts`)

## Code Generation

This project is **codegen-heavy**. After changing:

- **Rust commands**: Run `npm run gen:bindings` (Specta → TypeScript)
- **Module manifests**: Run `npm run module:codegen`
- **API routes**: Run `npm run gen:openapi` + `npm run gen:sdk:orval`

**Never edit generated files** marked with `// @generated` or `// @ts-nocheck`.

## Commit & Pull Request Guidelines

History is minimal (`Initial commit`). Use short imperative commit subjects, for example `Add module registry validation`. Keep commits focused. PRs should describe user-visible behavior, list verification commands, link issues when applicable, and include screenshots or recordings for UI work.

## Agent-Specific Instructions

Always read the nearest `AGENTS.md` before editing inside a subtree:

| Area                     | AGENTS.md                                                  |
| ------------------------ | ---------------------------------------------------------- |
| Bun sidecar architecture | `src-ts/AGENTS.md`                                         |
| Tauri Rust shell         | `src-tauri/AGENTS.md`                                      |
| Module/plugin system     | `modules/AGENTS.md`                                        |
| React hooks              | `src-react/src/hooks/AGENTS.md`                            |
| AI chat components       | `src-react/src/components/ai-elements/AGENTS.md`           |
| Tool system              | `src-ts/src/domain/services/tools/AGENTS.md`               |
| Task execution           | `src-ts/src/domain/services/queue/AGENTS.md`               |
| AI providers             | `src-ts/src/infrastructure/ai-providers/engines/AGENTS.md` |

## Anti-Patterns

| Forbidden                            | Why                                                   |
| ------------------------------------ | ----------------------------------------------------- |
| Use `as any`                         | Type safety—use discriminated unions                  |
| Empty catch blocks                   | Swallows errors silently                              |
| Skip `npm run gen` after API changes | Generated types will be stale                         |
| Hardcode ports                       | Dynamic port assignment required (Bun sidecar)        |
| Remove main.rs pragma                | Breaks Windows console hiding                         |
| Log API keys                         | Security violation                                    |
| Direct provider calls from queue     | Keep queue provider-agnostic                          |
| Non-IPC-7351 footprints              | All land patterns must follow IPC-7351 standard       |
| Arbitrary pad sizes                  | Calculate from body + tolerance using IPC formulas    |
| Silkscreen over pads                 | Violates IPC-7351 clearance rules (0.1mm min)         |
| Missing courtyard layer              | Required for assembly clearance validation            |
| Non-standard footprint naming        | Use IPC-7351 naming convention for interoperability   |
