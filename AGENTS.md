# Repository Guidelines

## Development Environment Policy

**Browser-first development is mandatory.** Always develop against browser target, not Tauri desktop.

### Preferred Dev Commands

| Task          | Command                | Notes                                              |
| ------------- | ---------------------- | -------------------------------------------------- |
| **Primary**   | `npm run dev`          | Browser dev mode - backend + frontend concurrently |
| Desktop only  | `npm run dev:desktop`  | Tauri desktop app (use for native features)        |
| Backend only  | `npm run dev:backend`  | Bun sidecar on port 3000                           |
| Frontend only | `npm run dev:frontend` | Vite dev server on port 1420                       |

### Browser Automation: Playwright MCP vs playwright-cli

OpenPCB supports two Playwright-based browser automation approaches:

| Approach           | Best For                                                                   | Persistence                             | Context Efficiency              |
| ------------------ | -------------------------------------------------------------------------- | --------------------------------------- | ------------------------------- |
| **Playwright MCP** | Interactive exploration, iterative testing, accessibility-driven workflows | Persistent browser state between calls  | Schema-based tools (structured) |
| **playwright-cli** | Coding tasks, token-efficient commands, quick verification                 | In-memory (use `--persistent` for disk) | Concise CLI commands            |

**Rule of thumb:** Use MCP for exploratory testing and iterative UI validation; use playwright-cli for quick checks during coding.

### Playwright MCP Configuration

Add to your MCP client configuration (`~/.config/opencode/mcp.json`):

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

**OpenPCB-specific MCP configuration** (with correct ports):

```json
{
  "mcpServers": {
    "playwright-openpcb": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--headed"]
    }
  }
}
```

### MCP Usage Patterns for OpenPCB

**1. Quick smoke test after changes:**

```
Navigate to http://127.0.0.1:1420 and verify the schematic editor loads with the palette visible.
```

**2. Interactive feature validation:**

```
Go to http://127.0.0.1:1420/?e2e=schematic, drag a Resistor from the palette to the canvas, and verify the symbol count increases.
```

**3. Accessibility verification:**

```
Navigate to the app and check that all interactive elements have proper ARIA labels and roles.
```

**4. Cross-theme testing:**

```
Open the app, toggle between light and dark themes, and take screenshots of both states for comparison.
```

### Playwright Verification (REQUIRED)

**Every UI change MUST be verified via Playwright.** Manual browser testing is not sufficient.

```bash
# Start development servers with Playwright MCP
npm run dev:browser

# Run E2E tests
npm run test:e2e

# Run specific test file
npx playwright test tests/e2e/schematic-editor.spec.ts

# Run with UI mode for debugging
npx playwright test --ui
```

**Requirements:**

- Use Playwright's trace viewer and screenshots to verify changes
- Test responsive behavior at multiple viewports
- Verify both light and dark themes
- Check accessibility with Playwright's axe integration
- Test with MCP first for quick validation, then write formal E2E tests

### playwright-cli Quick Reference

Use the existing skill at `.claude/skills/playwright-cli/`:

```bash
# Open browser and navigate
playwright-cli open http://127.0.0.1:1420

# Get page snapshot with element refs
playwright-cli snapshot

# Interact using refs from snapshot
playwright-cli click e15
playwright-cli type "test query"

# Take screenshot
playwright-cli screenshot

# Close browser
playwright-cli close
```

For full CLI documentation, see `.claude/skills/playwright-cli/SKILL.md`.

## Development Mode Guidelines

**This is active development - v0.1.0. No backward compatibility required.**

### Refactoring Rules

- **Delete old code immediately** when refactoring - do not keep legacy compatibility layers
- **No deprecation periods** - breaking changes are acceptable
- **Remove unused exports** aggressively
- **Update all callers** when changing APIs - no overloads for backward compat
- **Clean imports** - remove dead imports immediately

### Code Removal Checklist

When replacing functionality:

1. Implement new version
2. Migrate all usages
3. Delete old implementation
4. Delete old tests
5. Update imports/exports
6. Run full test suite

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
npm run dev            # Browser development mode (RECOMMENDED)
npm run dev:desktop    # Tauri desktop app
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
npm run test:e2e       # Playwright E2E tests
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
3. **Playwright** - E2E tests with browser automation

**Patterns:**

- Colocated tests preferred (same dir as source)
- `__tests__/` subdirs for complex modules (tools, oauth)
- Global setup: `src-ts/test/setup.ts` (sets NODE_ENV, APP_DATA_DIR)
- Mock factories for dependencies (see `task-executor.test.ts`)
- **All UI changes require Playwright verification**

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

| Forbidden                            | Why                                                 |
| ------------------------------------ | --------------------------------------------------- |
| Use `as any`                         | Type safety—use discriminated unions                |
| Empty catch blocks                   | Swallows errors silently                            |
| Skip `npm run gen` after API changes | Generated types will be stale                       |
| Hardcode ports                       | Dynamic port assignment required (Bun sidecar)      |
| Remove main.rs pragma                | Breaks Windows console hiding                       |
| Log API keys                         | Security violation                                  |
| Direct provider calls from queue     | Keep queue provider-agnostic                        |
| Non-IPC-7351 footprints              | All land patterns must follow IPC-7351 standard     |
| Arbitrary pad sizes                  | Calculate from body + tolerance using IPC formulas  |
| Silkscreen over pads                 | Violates IPC-7351 clearance rules (0.1mm min)       |
| Missing courtyard layer              | Required for assembly clearance validation          |
| Non-standard footprint naming        | Use IPC-7351 naming convention for interoperability |
| Keep legacy code during refactor     | Development mode - delete old code immediately      |
| Skip Playwright verification         | UI changes require automated browser verification   |
| Use Tauri desktop for development    | Always use browser-based `npm run dev` target       |
| Mix MCP and CLI in same session      | Choose one tool; MCP for exploration, CLI for code  |
