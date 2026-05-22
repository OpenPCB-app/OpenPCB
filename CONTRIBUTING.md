# Contributing to OpenPCB

Thanks for your interest. OpenPCB is in `v0.1.0-beta` — public beta, expect rough edges and rapid change.

## Quick start

```bash
git clone https://github.com/OpenPCB-app/OpenPCB.git
cd OpenPCB
npm install
npm run dev          # browser mode (backend + Vite)
npm run dev:electron # desktop shell
```

Requirements: Node 22+, Bun ≥1.3, npm 10+. `npm install` at the root only — there is no monorepo root in this repo (`shared/` and `CoreLibrary/` are sibling repos consumed via GitHub tags).

## Before opening a PR

Run from the repo root:

```bash
npm run typecheck
npm run gen:check     # codegen must be committed
npm run test:backend  # Bun tests
npm run test:react    # Vitest
npm run test:e2e      # Playwright (Chromium)
```

All four must pass. CI runs the same checks on every PR and blocks merge on failure.

## Conventions

- **Layers** (see `docs/architecture/module-boundaries.md`): `modules/* → sdks/ + shared/ → core/`. Don't cross-import sideways between modules — go through SDKs.
- **R3F rendering**: demand-only (`invalidate()`), never `frameloop="always"`, never Canvas2D, never imperative Three.js mutation. Coordinate pipeline is nm (store) → mm (scene) → px (screen). See `.claude/skills/r3f-eda-rendering/`.
- **Commands**: every designer mutation flows through `CommandEnvelope` with idempotency + inverse patches. See `docs/designer/command-pattern.md`.
- **Codegen**: any module manifest change requires `npm run gen` and committing the generated files in `src/core/frontend/src/generated/`.
- **Style**: match what exists. No new abstractions unless a feature requires them. Functions <50 lines, files <500 lines.

## Commit + PR

- Branches: `type/short-description` (`feat/router-snap`, `fix/via-clearance`).
- Commit messages: imperative, concise.
- One concern per PR. Reference issues with `Fixes #N`.
- Squash-merge is the default.

## Reporting bugs

Open a GitHub issue using the bug report template. Include OS, version (`Help → About`), reproduction steps, and any console / log output.

## Security

Do not file security issues publicly. See [SECURITY.md](SECURITY.md).

## License

OpenPCB is dual-licensed: **AGPL-3.0-or-later** for community use, commercial license available separately. By contributing, you agree your contributions are licensed under AGPL-3.0-or-later and grant OpenPCB the right to relicense your contributions under the commercial license. See [LICENSE](LICENSE) and [LICENSE-COMMERCIAL.md](LICENSE-COMMERCIAL.md).
