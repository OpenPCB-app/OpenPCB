# CORE BACKEND

**Purpose:** Bun HTTP runtime, module loader, router infrastructure.

## STRUCTURE

```
src/core/backend/
├── main.ts              # Entry — boots ModuleRuntime → createHttpServer
├── http/                # Server, CORS, request context, problem-details
├── router/              # HttpRouter, ModuleRouter, route matcher, registry
├── modules/             # Module loader, manifest discovery, SDK registry
├── db/                  # SQLite client, module-db-factory, transaction runner
├── migrations/          # Module-migrator (per-module SQL migrations)
├── controllers/         # Health, diagnostics, module-runtime-diagnostics
└── tests/               # Bun test suite for router/runtime/health
```

## WHERE TO LOOK

| Task                | Location                                 |
| ------------------- | ---------------------------------------- |
| Add HTTP route      | router/HttpRouter.ts                     |
| Module lifecycle    | modules/module-loader.ts (ModuleRuntime) |
| Manifest discovery  | modules/manifest-discovery.ts            |
| SDK registration    | modules/sdk-registry.ts                  |
| Request context     | http/request-context.ts                  |
| Database per module | db/module-db-factory.ts                  |

## KEY ABSTRACTIONS

- **ModuleRuntime**: Discovers manifests, topological load, runs migrations, calls onActivate
- **ModuleRouterRegistry**: Collects routes from all modules, mounts at /api/v1/{module}
- **RuntimeSdkRegistry**: Cross-module SDK resolution without direct imports

## ANTI-PATTERNS

- **WorkspaceRoot bug**: module-loader resolves to src/core/ not repo root. Override with OPENPCB_WORKSPACE_ROOT env var.
- No business logic here — pure infrastructure only.
