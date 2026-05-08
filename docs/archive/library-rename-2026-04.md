# `library` Module Cleanup & Rename

## Context

The module infrastructure refactor (previous plan — completed) left `src/modules/component-library/` in a mixed state: a small new clean surface (`manifest.json`, two barrels, `backend/index.ts`, `backend/schema.ts`, `frontend/Space.tsx`) layered on top of ~131 orphaned legacy files (old rich domain model, repositories, wizards, editors, render-engine adapters). The legacy tree is **not imported** by the new entry points, but it bloats the module, contains broken imports, and obscures what actually runs.

Two parallel decisions were made:

1. **Cleanup** — delete the legacy subtrees, preserve only the KiCad parsers and import heuristics, polish the new clean code.
2. **Rename** — the module is called "component-library" but uses "part" as its data noun and "ComponentLibrarySpace" as its React export. Everything collapses to the single word **`library`** / **`Library`**: the directory, the module id, the namespace, the API path, the SDK token, the SDK interface, the Space export, **and** the data noun (`part` → `component`). The module handles symbols, footprints, and components — "Library" says exactly that without stuttering.

**Out of scope**: variants, families, presets, provenance/audit, the full wizard, symbol/footprint editors, actual KiCad import endpoint, 3D model support, symbol preview rendering. All deferred.

## Decisions

| Area                       | Decision                                                                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data model                 | Keep minimal: `components`, `symbols`, `footprints` (3 flat tables). No variants, no families, no presets.                                                                                        |
| Directory                  | `src/modules/component-library/` → `src/modules/library/`                                                                                                                                         |
| Module id                  | `"component-library"` → `"library"` (in manifest + `backend/index.ts` definition)                                                                                                                 |
| Module label               | `"Component Library"` → `"Library"` (manifest)                                                                                                                                                    |
| Namespace                  | `"space.componentlibrary"` → `"space.library"`                                                                                                                                                    |
| Table prefix               | `component_library_*` → `library_*` (so tables become `library_components`, `library_symbols`, `library_footprints`)                                                                              |
| API base path              | `/api/modules/component-library/*` → `/api/modules/library/*` (automatic once module id changes; Space.tsx URL literal must follow)                                                               |
| SDK token key              | `MODULE_SDK_TOKENS.COMPONENT_LIBRARY` → `MODULE_SDK_TOKENS.LIBRARY`                                                                                                                               |
| SDK token value            | `"ComponentLibrarySDK"` → `"LibrarySDK"`                                                                                                                                                          |
| SDK interface              | `ComponentLibrarySDK` → `LibrarySDK`                                                                                                                                                              |
| SDK type names             | `ComponentLibraryPart` → `LibraryComponent`; `ComponentLibrarySymbol` → `LibrarySymbol`; `ComponentLibraryFootprint` → `LibraryFootprint`; `ComponentLibrarySearchParams` → `LibrarySearchParams` |
| Data noun                  | `part` → `component` (table, routes, methods, seed IDs, variables)                                                                                                                                |
| SDK method names           | `resolvePart` → `resolveComponent`; `searchParts` → `searchComponents`; `getSymbol`/`getFootprint` unchanged                                                                                      |
| Space React export         | `ComponentLibrarySpace` → `LibrarySpace`                                                                                                                                                          |
| Legacy pruning             | Aggressive: delete everything except KiCad parsers and import heuristics.                                                                                                                         |
| KiCad parsers              | P1 — preserved at `backend/infrastructure/parsers/kicad/` with their tests and fixtures. Not wired this pass.                                                                                     |
| Other salvage              | `component-import-heuristics.{ts,test.ts}` **moved** to `backend/infrastructure/parsers/kicad/heuristics.{ts,test.ts}` to consolidate KiCad salvage.                                              |
| Space UI                   | `New` / `Import` / `Select-all` / mount filter become "Coming soon" disabled no-ops (visible, non-interactive, tooltip). Search + card grid stay functional.                                      |
| backend/index.ts           | Split into `index.ts`, `queries.ts`, `seed.ts`, `routes.ts`. Fix fire-and-forget seed inserts via `db.transaction`.                                                                               |
| Frontend type source       | `Space.tsx` imports `LibraryComponent` from `core/contracts/modules/sdk` (single source of truth).                                                                                                |
| Existing module-level test | Rewrite `src/core/backend/tests/component-library-route-migration.test.ts` in place as `src/core/backend/tests/library-integration.test.ts` with new names/routes; delete the old file.           |
| Deletion method            | `rm -rf` (no `git rm` per user preference). Directory rename via `mv` (git auto-detects).                                                                                                         |

## Target tree (post-cleanup)

```
src/modules/library/                              (was component-library/)
├── manifest.json                                 EDITED (id, label, namespace)
├── module.backend.ts                             EDITED (re-exports manifest + definition — no code change)
├── module.frontend.ts                            EDITED (imports mod.LibrarySpace)
├── backend/
│   ├── index.ts                                  REWRITTEN (~40 lines, ModuleDefinition barrel)
│   ├── queries.ts                                NEW (mappers + getDb + search/resolve/get + buildSdk)
│   ├── seed.ts                                   NEW (transactional seedIfEmpty)
│   ├── routes.ts                                 NEW (registerRoutes for 5 routes)
│   ├── schema.ts                                 EDITED (table prefix library_*, `components` table)
│   ├── drizzle.config.ts                         (unchanged)
│   ├── migrations/
│   │   ├── 0000_init.sql                         REGENERATED
│   │   └── meta/
│   │       ├── 0000_init_snapshot.json           REGENERATED
│   │       └── _journal.json                     (unchanged)
│   └── infrastructure/
│       └── parsers/
│           └── kicad/                            (unchanged core + 2 new files)
│               ├── heuristics.ts                 MOVED from domain/services/
│               ├── heuristics.test.ts            MOVED from domain/services/
│               ├── sexpr-parser.ts
│               ├── kicad-symbol-parser.ts
│               ├── kicad-footprint-parser.ts
│               ├── kicad-model-linker.ts
│               ├── *.test.ts                     (6 existing parser tests)
│               └── __fixtures__/                 (12 KiCad files)
└── frontend/
    ├── Space.tsx                                 EDITED (rename export, import LibraryComponent, disable decorative controls)
    └── index.ts                                  EDITED (export LibrarySpace)

src/core/contracts/modules/
├── sdk.ts                                        EDITED (LibraryComponent/Symbol/Footprint/SearchParams/LibrarySDK)
└── sdk-map.ts                                    EDITED (LIBRARY: "LibrarySDK")

src/core/backend/tests/
├── library-integration.test.ts                   RENAMED+REWRITTEN from component-library-route-migration.test.ts
└── (unchanged: diagnostics, health, module-runtime, router-runtime, routing-and-errors)
```

Everything not in the tree above gets deleted.

## Change set

### A. Salvage moves (run BEFORE deletions)

Inside the module at its old path:

1. `mv src/modules/component-library/backend/domain/services/component-import-heuristics.ts src/modules/component-library/backend/infrastructure/parsers/kicad/heuristics.ts`
2. `mv src/modules/component-library/backend/domain/services/component-import-heuristics.test.ts src/modules/component-library/backend/infrastructure/parsers/kicad/heuristics.test.ts`
3. Edit `heuristics.test.ts`: update the one internal import from `./component-import-heuristics` → `./heuristics`.
4. Verify `heuristics.ts` has no broken imports before the move (earlier analysis: clean — pure regex/string logic, no `@shared/*`).

### B. Deletions

All `rm -rf`. Runs at the old path `src/modules/component-library/` before directory rename.

**Backend legacy**:

- `backend/core/` (response-builder)
- `backend/db/` (bridge, decorators, errors, query-logger, repositories/, schema/, seeds/)
- `backend/domain/` — now empty after salvage move; remove the whole subtree
- `backend/handlers/` (4 controllers + tests)
- `backend/schemas/` (library schema + semantics + tests)
- `backend/infrastructure/cache/` (model-load-cache.ts)
- Any resulting empty dirs.

**Frontend legacy**:

- `react/` — entire subtree (~63 files: old `Space.tsx`, `components/`, `render-engine/`, `hooks/`, `stores/`).

**Expected deletion count**: ~120 files. Module drops from ~145 files to ~30.

### C. Module directory rename

One command: `mv src/modules/component-library src/modules/library`.

Verify afterwards:

- `src/core/frontend/src/components/ModuleSpaceHost.tsx` uses `import.meta.glob('../../../../modules/*/module.frontend.ts')` — glob auto-picks up the new directory; no edit needed.
- `src/core/backend/modules/manifest-discovery.ts` scans `src/modules/*/manifest.json` — auto-picks up.
- Grep `src -l "component-library\|ComponentLibrary\|component_library\|componentlibrary"` — only expected hits should be the files listed in section D (which we're about to edit), plus any legacy strings already deleted.

### D. Identifier rename (after directory move)

**`src/modules/library/manifest.json`**:

```json
{
  "id": "library",
  "label": "Library",
  "version": "0.1.0",
  "apiVersion": 2,
  "namespace": "space.library",
  "kind": "space",
  "sidebar": {
    "label": "Library",
    "icon": "Box",
    "order": 20,
    "group": "design"
  },
  "runtime": {
    "backendEntry": "module.backend.ts",
    "frontendEntry": "module.frontend.ts"
  },
  "dependsOn": [],
  "defaultPinned": false
}
```

**`src/modules/library/backend/index.ts`** — `definition.id` changes from `"component-library"` to `"library"` (plus the other edits in section E).

**`src/modules/library/backend/schema.ts`**:

- Table name strings: `"component_library_symbols"` → `"library_symbols"`, `"component_library_footprints"` → `"library_footprints"`, `"component_library_parts"` → `"library_components"`.
- Drizzle table variable: `parts` → `components`.
- Any exported type `PartRow` → `ComponentRow`.

**`src/core/contracts/modules/sdk-map.ts`**:

```ts
export const MODULE_SDK_TOKENS = {
  LIBRARY: "LibrarySDK",
} as const;

export type ModuleSdkToken =
  (typeof MODULE_SDK_TOKENS)[keyof typeof MODULE_SDK_TOKENS];
```

**`src/core/contracts/modules/sdk.ts`** — full rewrite:

```ts
/**
 * Public SDK contracts modules implement or consume via ctx.sdk.
 */

export interface LibraryComponent {
  id: string;
  name: string;
  description: string;
  symbolId: string;
  footprintId: string;
  tags: string[];
}

export interface LibrarySymbol {
  id: string;
  name: string;
  data: Record<string, unknown>;
}

export interface LibraryFootprint {
  id: string;
  name: string;
  data: Record<string, unknown>;
}

export interface LibrarySearchParams {
  query?: string;
  limit?: number;
  tags?: string[];
}

export interface LibrarySDK {
  resolveComponent(componentId: string): Promise<LibraryComponent | null>;
  getSymbol(symbolId: string): Promise<LibrarySymbol | null>;
  getFootprint(footprintId: string): Promise<LibraryFootprint | null>;
  searchComponents(params: LibrarySearchParams): Promise<LibraryComponent[]>;
}
```

**`src/modules/library/frontend/Space.tsx`**:

- Rename export: `export function ComponentLibrarySpace` → `export function LibrarySpace`
- Remove local `interface ComponentLibraryPart { ... }`
- Add `import type { LibraryComponent } from "../../../core/contracts/modules/sdk";`
- Update variable names: `parts` → `components`, `setParts` → `setComponents`, per-card `part` prop → `component`
- Update fetch URL literal: `/api/modules/component-library/parts` → `/api/modules/library/components`
- Update response parser: `payload.data?.parts` → `payload.data?.components`

**`src/modules/library/frontend/index.ts`**:

```ts
export { LibrarySpace } from "./Space";
```

**`src/modules/library/module.frontend.ts`** — update the lazy import adapter reference:

```ts
Space: lazy(async () => {
  const mod = await import("./frontend");
  return { default: mod.LibrarySpace };
}),
```

### E. Backend polish (split + transactional seed)

**`backend/queries.ts`** (new) — extract from current `index.ts`:

- `getDb(ctx)`, `parseJsonObject`, `parseJsonStringArray`
- `mapComponent(row)`, `mapSymbol(row)`, `mapFootprint(row)`
- `searchComponents(ctx, params)`, `resolveComponent(ctx, componentId)`, `getSymbol(ctx, symbolId)`, `getFootprint(ctx, footprintId)`
- `buildSdk(ctx): LibrarySDK`

Imports from `../../../core/contracts/modules/sdk` (and `backend-module` for ctx type, `./schema` for tables).

**`backend/seed.ts`** (new) — `seedIfEmpty(ctx)`:

- Read count via `db.select(...).from(components).get()`.
- If empty, wrap all three inserts in a single synchronous `db.transaction((tx) => { tx.insert(symbols)…; tx.insert(footprints)…; tx.insert(components)… })` callback.
- Non-async if possible (bun:sqlite is synchronous); otherwise keep async just for the count query but drop fire-and-forget on the inserts.
- Rename seed IDs: `part-r-10k-0603` → `comp-r-10k-0603`, `part-c-100nf-0603` → `comp-c-100nf-0603`, `part-c-10uf-0805` → `comp-c-10uf-0805`.

**`backend/routes.ts`** (new) — `registerRoutes(router, ctx)`:

- `GET /status` → `{ ok, data: { moduleId, namespace, status, componentCount } }`
- `GET /components?q&limit&tags` → `{ ok, data: { components: LibraryComponent[] } }`
- `GET /components/:componentId` → 200 `{ ok, data: { component } }` or 404 `{ ok: false, error }`
- `GET /symbols/:symbolId` → 200/404 (unchanged semantics)
- `GET /footprints/:footprintId` → 200/404 (unchanged semantics)
- Uses helpers from `queries.ts`; no direct DB access.

**`backend/index.ts`** (rewritten, ~40 lines):

```ts
import type { ModuleDefinition } from "../../../core/contracts/modules/backend-module";
import { MODULE_SDK_TOKENS } from "../../../core/contracts/modules/sdk-map";
import { buildSdk } from "./queries";
import { registerRoutes } from "./routes";
import { seedIfEmpty } from "./seed";

export const definition: ModuleDefinition = {
  id: "library",

  async onActivate(ctx) {
    seedIfEmpty(ctx);
    ctx.logger.info("library activated", {
      tablePrefix: ctx.db.tablePrefix,
    });
  },

  async registerSdk(ctx) {
    if (!ctx.sdk.has(MODULE_SDK_TOKENS.LIBRARY)) {
      ctx.sdk.registerValue(MODULE_SDK_TOKENS.LIBRARY, buildSdk(ctx));
    }
  },

  async registerRoutes(router, ctx) {
    registerRoutes(router, ctx);
  },
};

export default definition;
```

### F. Migration regeneration

- `rm src/modules/library/backend/migrations/0000_init.sql`
- `rm src/modules/library/backend/migrations/meta/0000_init_snapshot.json`
- `cd src/modules/library/backend && bunx drizzle-kit generate`
- Verify `_journal.json` entry still reads `"tag": "0000_init"` (if drizzle-kit generates a different tag, update the file to preserve naming) and points to the regenerated snapshot.
- Pre-prod: no data migration needed. Dev DB must be wiped manually: `rm -f dev-data/openpcb.sqlite`.

### G. Frontend "Coming soon" pass (`Space.tsx`)

- **New** button: `disabled`, `title="Coming soon"`, cursor-not-allowed style, no onClick.
- **Import** button: same treatment.
- **Mount filter chips** (SMD / Through-hole / Virtual): rendered as disabled (muted opacity, non-clickable), `title="Coming soon"`.
- **Select All** checkbox (header row): `disabled`, `title="Coming soon"`.
- **Per-card checkbox** in `LibraryCard`: `disabled`, `title="Coming soon"`.
- **Dead-code cleanup**: remove `activeMountFilter` state, `toggleMountFilter`, `MountFilter` type, `MOUNT_FILTERS` array, and the `mount` query-param branch in `buildSearchUrl` (backend never supported it — dead after controls are disabled).
- Keep the search input + debounced fetch + card grid fully functional.

### H. Integration test rewrite

Rename `src/core/backend/tests/component-library-route-migration.test.ts` → `src/core/backend/tests/library-integration.test.ts` (plain `mv`, git auto-detects rename).

Rewrite contents to match the new module identity:

```ts
import { describe, expect, test } from "bun:test";
import path from "node:path";
import type { LibrarySDK } from "../../contracts/modules/sdk";
import { MODULE_SDK_TOKENS } from "../../contracts/modules/sdk-map";
import { createHttpServer } from "../http/create-http-server";
import { DiagnosticsStore } from "../diagnostics/diagnostics-store";
import { ModuleRuntime } from "../modules/module-loader";
import { ModuleRouterRegistry } from "../router/module-registry";

describe("library module integration", () => {
  test("boots, seeds, serves routes, registers SDK", async () => {
    const repoRoot = path.resolve(import.meta.dir, "../../..");
    const moduleRegistry = new ModuleRouterRegistry();
    const moduleRuntime = new ModuleRuntime({
      moduleRegistry,
      workspaceRoot: repoRoot,
    });
    await moduleRuntime.bootstrap();

    const snapshot = moduleRuntime.snapshot();
    expect(snapshot.loadedModules.includes("library")).toBe(true);

    const sdkRegistry = moduleRuntime.getSdkRegistry();
    expect(sdkRegistry.has(MODULE_SDK_TOKENS.LIBRARY)).toBe(true);

    const librarySdk = sdkRegistry.resolve<LibrarySDK>(
      MODULE_SDK_TOKENS.LIBRARY,
    );

    const components = await librarySdk.searchComponents({
      query: "capacitor",
      limit: 20,
    });
    expect(components.length).toBeGreaterThan(0);
    const resolved = await librarySdk.resolveComponent(components[0]!.id);
    expect(resolved?.id).toBe(components[0]!.id);

    const server = createHttpServer({
      diagnosticsStore: new DiagnosticsStore(),
      moduleRegistry,
      moduleRuntime,
    });

    const statusResponse = await server.fetch(
      new Request("http://localhost/api/modules/library/status"),
    );
    expect(statusResponse.status).toBe(200);
    const statusBody = (await statusResponse.json()) as {
      data: { componentCount: number };
    };
    expect(statusBody.data.componentCount).toBeGreaterThanOrEqual(3);

    const searchResponse = await server.fetch(
      new Request("http://localhost/api/modules/library/components?q=resistor"),
    );
    expect(searchResponse.status).toBe(200);
    const searchBody = (await searchResponse.json()) as {
      data?: {
        components?: Array<{
          id: string;
          symbolId: string;
          footprintId: string;
        }>;
      };
    };
    const first = searchBody.data?.components?.[0];
    expect(first?.id).toBeDefined();

    const symbolResponse = await server.fetch(
      new Request(
        `http://localhost/api/modules/library/symbols/${first?.symbolId}`,
      ),
    );
    expect(symbolResponse.status).toBe(200);

    const footprintResponse = await server.fetch(
      new Request(
        `http://localhost/api/modules/library/footprints/${first?.footprintId}`,
      ),
    );
    expect(footprintResponse.status).toBe(200);
  });
});
```

Note: the existing test uses `sdkRegistry.resolve<T>(token)` — verify this method exists on the current `RuntimeSdkRegistry` class (it may be `.get<T>()` now per the updated contract). Adjust the test to use whichever the current runtime exposes. If `resolve` is gone, use `get`.

## Phased execution

Each phase ends with `tsc --noEmit` clean in both workspaces and all backend tests green. No commits — user commits manually.

**Phase 1 — Salvage moves + deletions** (still at `src/modules/component-library/`):

- Move heuristics + test into `backend/infrastructure/parsers/kicad/heuristics.{ts,test.ts}`.
- Fix one internal import in `heuristics.test.ts`.
- `rm -rf` all legacy subtrees (backend/core, backend/db, backend/domain, backend/handlers, backend/schemas, backend/infrastructure/cache, react/).
- Verify backend boots + kicad parser tests still green.

**Phase 2 — Module directory rename**:

- `mv src/modules/component-library src/modules/library`.
- Don't edit identifiers yet — module still has id "component-library" internally, so the existing `component-library-route-migration.test.ts` still passes against the old id **if** the dir rename alone doesn't change identity.
- Actually: id is read from manifest, which still says "component-library" at this point. Boot should still work. Verify.

**Phase 3 — Identifier rename** (within `src/modules/library/`):

- Edit `manifest.json`: id, label, namespace.
- Edit `backend/index.ts`: `id: "library"`.
- Edit `backend/schema.ts`: table name strings (prefix `library_` instead of `component_library_`) and Drizzle table var `parts` → `components`, type `PartRow` → `ComponentRow`.
- Edit `src/core/contracts/modules/sdk-map.ts`: `LIBRARY: "LibrarySDK"`.
- Edit `src/core/contracts/modules/sdk.ts`: full rewrite with Library\* types + `LibrarySDK` interface.
- Edit current `backend/index.ts`: update all references (`resolvePart` → `resolveComponent`, `searchParts` → `searchComponents`, `parts` table var → `components`, `ComponentLibraryPart` type → `LibraryComponent`, route paths `/parts` → `/components`, route param `partId` → `componentId`, `partCount` → `componentCount`, seed IDs `part-*` → `comp-*`, token `COMPONENT_LIBRARY` → `LIBRARY`).
- Edit `frontend/Space.tsx`: rename export to `LibrarySpace`, import `LibraryComponent`, rename state vars, update fetch URL to `/api/modules/library/components`, update response parser.
- Edit `frontend/index.ts`: `export { LibrarySpace } from "./Space";`.
- Edit `module.frontend.ts`: `mod.LibrarySpace` in the lazy adapter.
- At this phase the existing `component-library-route-migration.test.ts` will fail — expected; it gets rewritten in Phase 6.

**Phase 4 — Regenerate migration**:

- `rm backend/migrations/0000_init.sql backend/migrations/meta/0000_init_snapshot.json`
- `cd src/modules/library/backend && bunx drizzle-kit generate`
- Verify generated SQL creates `library_components`, `library_symbols`, `library_footprints` (not `component_library_*`).
- Verify `_journal.json` still reads tag `0000_init`; fix up if drizzle-kit renames it.
- `rm -f dev-data/openpcb.sqlite`.
- Smoke: boot backend and confirm migration applies, seed runs, `curl /api/modules/library/components` returns 3 components with `comp-*` IDs.

**Phase 5 — Split backend/index.ts**:

- Create `queries.ts` (mappers, getDb, query fns, buildSdk).
- Create `seed.ts` (transactional seedIfEmpty).
- Create `routes.ts` (registerRoutes).
- Slim `index.ts` to the `ModuleDefinition` barrel shown in section E.
- Verify backend + all 5 routes still work end-to-end.

**Phase 6 — Integration test rewrite**:

- `mv src/core/backend/tests/component-library-route-migration.test.ts src/core/backend/tests/library-integration.test.ts`
- Rewrite contents per section H.
- Verify the test passes + all other backend tests still green.

**Phase 7 — Frontend "Coming soon" pass**:

- Disable decorative controls in `Space.tsx` with `title="Coming soon"` (New, Import, mount chips, Select-all, per-card checkboxes).
- Remove dead `activeMountFilter` / `MOUNT_FILTERS` / `toggleMountFilter` / `mount` query-param code.
- Verify `npx tsc --noEmit` + `npm run build` in `src/core/frontend`.
- Visual smoke: backend running, frontend built + previewed, Library sidebar item opens the space, search + grid work, decorative controls are visibly disabled with tooltips.

**Phase 8 — Final verification** (see Verification section).

## Critical files

**Read before editing**:

- `src/modules/component-library/backend/index.ts` (~335 lines; will be split + renamed)
- `src/modules/component-library/backend/schema.ts` (table prefix + var rename)
- `src/modules/component-library/frontend/Space.tsx` (export rename + vars + URL + disable decoration)
- `src/modules/component-library/manifest.json` (id/label/namespace)
- `src/core/contracts/modules/sdk.ts` (full rewrite)
- `src/core/contracts/modules/sdk-map.ts` (token rename)
- `src/core/backend/tests/component-library-route-migration.test.ts` (existing integration-level test; will be renamed + rewritten)
- `src/modules/component-library/backend/domain/services/component-import-heuristics.ts` (confirm clean before move)
- `src/core/backend/modules/sdk-registry.ts` (verify whether the method is `resolve<T>` or `get<T>`; integration test uses one of them)
- `src/core/backend/modules/module-loader.ts` (verify `moduleRuntime.getSdkRegistry()` still exists)
- `src/core/frontend/src/components/ModuleSpaceHost.tsx` (confirm glob path unaffected by dir rename)
- `src/core/backend/modules/manifest-discovery.ts` (confirm `src/modules/*` scan unaffected)
- `src/modules/component-library/module.frontend.ts` (lazy `mod.*` name)

## Verification

1. `git status` — shows:
   - ~120 deletions in `src/modules/component-library/`
   - 1 directory rename (`src/modules/component-library/` → `src/modules/library/`) as an `R` entry
   - Edits on manifest.json, schema.ts, Space.tsx, sdk.ts, sdk-map.ts, frontend/index.ts, module.frontend.ts
   - 3 new backend files (queries.ts, seed.ts, routes.ts) + rewritten index.ts
   - 1 renamed test (`library-integration.test.ts`)
2. `cd src/core/backend && bun install && bun test` — all tests green:
   - New `library-integration.test.ts`
   - Moved `heuristics.test.ts`
   - All existing KiCad parser tests
   - `module-runtime.test.ts`, `health.test.ts`, `diagnostics.test.ts`, `router-runtime.test.ts`, `routing-and-errors.test.ts`
3. `cd src/core/backend && npx tsc --noEmit` — zero errors.
4. `cd src/core/frontend && npx tsc --noEmit && npm run build` — zero errors; `module.frontend` still code-splits into its own chunk.
5. Backend smoke: `OPENPCB_DB_PATH=/tmp/library-smoke.sqlite PORT=3901 bun src/core/backend/main.ts` →
   - Logs `loadedModules: ["library"]`
   - Logs migration applied
   - `curl http://localhost:3901/api/modules/library/components | jq` returns 3 components with `comp-*` IDs
   - `curl http://localhost:3901/api/modules/library/status | jq` returns `{ ok: true, data: { moduleId: "library", componentCount: 3, ... } }`
   - `curl http://localhost:3901/api/modules/library/components/comp-r-10k-0603` returns the component
6. Frontend smoke: backend + frontend running; Library sidebar item visible with Box icon; clicking opens LibrarySpace; search filters components; New/Import/SelectAll/Mount visible but disabled with "Coming soon" tooltips.
7. File count: `find src/modules/library -type f | wc -l` — ~30 (down from ~145).
8. Grep sanity:
   - `grep -rn "component-library\|ComponentLibrary\|component_library\|componentlibrary\|ComponentLibrarySpace" src` — zero hits (all renamed).
   - `grep -rn "\\bparts\\b\\|\\bpart\\b\\|PartRow\\|searchParts\\|resolvePart" src/modules/library src/core/contracts/modules/sdk.ts` — zero hits (excluding false positives like "partition" if any).
   - `grep -rn "COMPONENT_LIBRARY" src` — zero hits.

## Out of scope

- Re-wiring KiCad import (parsers + heuristics stay orphaned but preserved).
- Variants, families, presets, provenance/audit — deferred.
- 3D model support — deferred.
- Symbol/footprint editors — deferred.
- Component wizard — deferred.
- Symbol preview rendering (no R3F / shared-canvas integration).
- ESLint boundary enforcement (`modules → {shared, core/contracts}` only) — follow-up PR.
- Any changes outside `src/modules/{component-library,library}/`, `src/core/contracts/modules/sdk*.ts`, and `src/core/backend/tests/{component-library-route-migration,library-integration}.test.ts`.

## Unresolved questions

1. **Table pluralization stutter** — `library_components` reads fine; `component_library_components` would have stuttered. Confirming the final table name set: `library_symbols`, `library_footprints`, `library_components`. Any preference otherwise?
2. **Heuristics value** — With variants deferred, the heuristics module's practical value drops (it specifically groups footprints into variant sets). Worth keeping in `parsers/kicad/heuristics.ts`, or drop alongside the other domain services?
3. **Additional count fields in `/status`** — While renaming `partCount` → `componentCount`, worth adding `symbolCount` / `footprintCount` too, or leave status minimal?
4. **SDK registry method name** — `resolve<T>()` vs `get<T>()`. Earlier contract work defined `get<T>()` but the existing test uses `resolve<T>()`. I'll verify live and align; flagging here so you know the test may get that line adjusted.
