# OneMind Modules

## OVERVIEW

Plugin system providing sandbox isolation, manifest-driven registration, and multi-protocol (HTTP/WS) communication.

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

## STRUCTURE

```text
modules/<module-id>/
├── manifest.json       # Required: metadata, entry points, db settings
├── ts/                 # Bun logic
│   └── module.ts       # Module entry (HTTP/WS endpoints, lifecycle)
└── react/              # React UI
    └── Space.tsx       # Primary UI view (Space)
```

## WHERE TO LOOK

| Component   | Location           | Responsibility                            |
| ----------- | ------------------ | ----------------------------------------- |
| Module SDK  | `modules/_kit/`    | Helper functions (e.g., `createModuleV2`) |
| Entry Point | `ts/module.ts`     | Endpoint registration, lifecycle hooks    |
| UI Entry    | `react/Space.tsx`  | Exported component for primary space      |
| Registry    | `.dist/modules.ts` | Generated list of all loaded modules      |

## MANIFEST RULES

- **id**: Unique module identifier (lowercase, kebab-case).
- **namespace**: Dot-separated namespace (e.g., `space.hello`).
- **kind**: `space` (standalone app) or `plugin` (background/injection).
- **ui.moduleEntry**: Relative path to Bun sidecar script.
- **ui.primarySpace**: Relative path to main React component.
- **db.prefix**: (Optional) Isolated database table prefix.

## LIFECYCLE

1. **Discovery**: `ModuleLoader` scans `modules/*/manifest.json`.
2. **Registration**: Codegen updates registry; sidecar mounts HTTP/WS routes.
3. **onActivate(ctx)**: Triggered when module starts. Register events/tasks here.
4. **onDeactivate(ctx)**: Cleanup hook for stopping long-running processes.

## CONVENTIONS

- **Isolation**: Use `ctx.db` and `ctx.logger`. Avoid global state or `0.0.0.0` binding.
- **Endpoints**: Accessible via `/api/modules/<id>/*` and `/ws/modules/<id>`.
- **Creation**: Always use `npm run module:create` to scaffold new modules.
- **Persistence**: Prefix database tables with `manifest.db.prefix` to prevent collisions.
- **Event Bus**: Communicate between modules via `ctx.events.emit/on`.

## ANTI-PATTERNS

| Forbidden                        | Why                         |
| -------------------------------- | --------------------------- |
| Keep legacy code during refactor | Delete old code immediately |
