# src-tauri/ — Rust Tauri Desktop Shell

Tauri 2 app lifecycle, Bun sidecar spawning, secrets vault, bridge IPC. Window management and native integration.

## Development Mode Guidelines

**This is active development - v0.1.0. No backward compatibility required.**

**Browser-first development is mandatory.** Always develop against browser target (`npm run dev`), not Tauri desktop (`npm run dev:desktop`).

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

## Structure

```
src-tauri/
├── src/
│   ├── main.rs              # Entry: calls lib::run() (DO NOT REMOVE pragma)
│   ├── lib.rs               # Tauri Builder, plugins, bridge router, sidecar spawn
│   ├── commands.rs          # Tauri commands with #[specta]
│   ├── secrets.rs           # Stronghold API key storage
│   └── sidecar/
│       └── bun_ts/
│           ├── bun_bridge.rs   # Bridge interface (status, restart)
│           └── bun_runtime.rs  # Spawn/manage Bun process
├── crates/
│   ├── bridge/              # BridgeRouter, request/response routing
│   └── bridge-macros/       # Proc macros for bridge handlers
├── binaries/                # Compiled Bun sidecar (bun-backend-{triple})
├── tauri.conf.json          # Vite port 1420, window size, CSP
├── tauri.macos.conf.json    # macOS: overlay title bar
└── Cargo.toml               # Tauri 2, Specta, Stronghold, Sentry
```

## Where to Look

| Task               | File                            | Notes                               |
| ------------------ | ------------------------------- | ----------------------------------- |
| App initialization | `lib.rs`                        | Plugins, setup handler, async spawn |
| Bun sidecar spawn  | `sidecar/bun_ts/bun_runtime.rs` | Port discovery, health checks       |
| Bridge commands    | `crates/bridge/src/lib.rs`      | Namespace routing, error mapping    |
| Secrets storage    | `secrets.rs`                    | Stronghold vault for API keys       |
| Type generation    | `lib.rs`                        | Specta export in debug builds       |

## Sidecar Communication

**Startup sequence:**

1. Tauri spawns Bun: `bun --watch src-ts/src/main.ts` (dev) or `bun-backend` binary (prod)
2. Bun logs JSON to stdout: `{"serverPort": <PORT>}`
3. Rust reads stdout, extracts port
4. Emits Tauri event: `backend-ready { url, port }`
5. React captures event, sets backend URL

**Health check:** Exponential backoff (100ms→800ms), 5 retries after port discovery

## Bridge Pattern

```rust
// Commands via BridgeRouter
BridgeRequest { namespace: "space.hello", action: "greet", payload }
    → BridgeRouter.route()
    → BridgeNamespaceHandler.handle()
    → BridgeResponse { success, data, error }
```

**Manual registration required** in `lib.rs:create_bridge_router()`

## Conventions

- **Specta types**: Add `#[specta::specta]` to commands, run `npm run gen`
- **Plugins**: log, stronghold, shell, opener, updater, sentry
- **CSP**: Allows `localhost:*` for backend/WebSocket
- **No direct Tauri IPC for chat**: Use HTTP to Bun sidecar

## Anti-Patterns

| Forbidden                         | Why                                     |
| --------------------------------- | --------------------------------------- |
| Remove main.rs pragma             | Breaks Windows console hiding           |
| Skip stronghold for secrets       | Security: no env vars for API keys      |
| Log API keys                      | Security violation                      |
| Hardcode port                     | Dynamic port assignment required        |
| Use Tauri desktop for development | Use browser-based `npm run dev` instead |
| Keep legacy code during refactor  | Delete old code immediately             |

## Build

```bash
# Development
cargo check --manifest-path src-tauri/Cargo.toml

# Type generation
npm run bindings:generate   # Specta → src-ts/src/tauri-bindings.ts

# Full build
npm run build              # Bun compile + React bundle + Tauri binary
```
