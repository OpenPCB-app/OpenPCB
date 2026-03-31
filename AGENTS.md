# Repository Guidelines

## Project Structure & Module Organization
OpenPCB is a desktop PCB application built as a mixed TypeScript/Rust monorepo. `src-react/` contains the React 19 UI (`src/components`, `src/hooks`, `src/screens`, `src/generated`). `src-ts/` is the Bun sidecar and shared backend logic (`src/domain`, `src/infrastructure`, `src/db`, `shared/`). `src-tauri/` is the Rust desktop shell plus bridge crates. Reusable module definitions live in `modules/`, automation lives in `scripts/`, and end-to-end coverage uses `playwright.config.ts`.

## Build, Test, and Development Commands
Use the root scripts unless you are working in a single package:

- `npm run setup` installs root and `src-ts` dependencies, then runs codegen.
- `npm run dev` starts the Tauri desktop app.
- `npm run dev:frontend` runs the Vite UI only.
- `npm run typecheck` runs shared TypeScript builds.
- `npm run build` compiles the Bun sidecar, frontend, and Tauri app.
- `npm run gen` regenerates bindings, module registry output, SDK files, and OpenAPI artifacts.
- `npm run test:ts`, `npm run test:react`, `npm run test:e2e` run Bun, Vitest, and Playwright tests.

## Coding Style & Naming Conventions
Follow the existing local style in each package. TypeScript in `src-react/` uses 2-space indentation, double quotes, and trailing commas; React components are PascalCase files such as `Layout.tsx`, hooks use `useFeature.ts`, and tests are `*.test.ts(x)`. Backend TypeScript in `src-ts/` currently uses 4-space indentation and colocated `*.test.ts` files. Rust follows standard `rustfmt` formatting and snake_case modules. Avoid `any`; shared contracts are generated and should be refreshed with `npm run gen`.

## Testing Guidelines
Frontend tests use Vitest with `happy-dom` and `src/**/*.test.{ts,tsx}` discovery. Backend tests use `bun test`; integration coverage also appears under `src-ts/tests/integration/`. Add tests next to the changed code when practical, and run the smallest relevant command before opening a PR.

## Commit & Pull Request Guidelines
History is minimal (`Initial commit`), so use short imperative commit subjects, for example `Add module registry validation`. Keep commits focused. PRs should describe user-visible behavior, list verification commands, link issues when applicable, and include screenshots or recordings for UI work.

## Agent-Specific Instructions
Always read the nearest `AGENTS.md` before editing inside a subtree. Important examples include `src-ts/AGENTS.md`, `src-tauri/AGENTS.md`, `modules/AGENTS.md`, and focused guides under `src-react/src/` and `src-ts/src/domain/services/`.
