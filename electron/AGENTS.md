# ELECTRON SHELL

**Purpose:** OS shell — window management, IPC, updater, crash/telemetry, and
**hosting the backend runtime in-process**.

> The backend is NOT a child process. `backend-server.ts` statically imports
> `startBackendRuntime` from `src/core/backend/runtime` and calls it on
> Electron's own Node. There is no `backend-manager.ts` and no Bun at runtime —
> Bun is a dev-only tool. A long-running request therefore shares the main
> process event loop with the UI.

## STRUCTURE

```
electron/
├── src/main/
│   ├── index.ts            # Main entry: boot order, window, app lifecycle
│   ├── backend-server.ts   # Starts the backend runtime IN-PROCESS; env setup
│   ├── mcp-portfile.ts     # MCP token + <APP_DATA_DIR>/mcp.json (0600)
│   ├── deep-link.ts        # openpcb:// scheme + single-instance lock
│   ├── diagnostics-ipc.ts  # diagnostics:* / app:get-versions / mcp:config
│   ├── secure-storage.ts   # safeStorage-backed secure-store.json
│   ├── preferences.ts      # preferences.json (telemetry opt-in)
│   ├── updater.ts, logger.ts, crash.ts, sentry.ts
├── src/preload/index.ts    # contextBridge: window.electronAPI + window.updater
├── src/mcp-shim/index.ts   # stdio ⇄ Streamable HTTP bridge (own tsup entry)
├── build/mcp/              # openpcb-mcp launcher scripts (extraResources)
├── tsup.config.ts          # 4 CJS bundles: main, main/drc-worker, mcp/shim, preload (no `clean` — `npm run build` cleans once)
└── electron-builder.cjs    # Packaging (NOT Electron Forge)
```

## WHERE TO LOOK

| Task                        | Location                                    |
| --------------------------- | ------------------------------------------- |
| Backend startup / env vars  | `src/main/backend-server.ts`                |
| IPC handlers                | `src/main/diagnostics-ipc.ts`, `index.ts`   |
| Renderer-facing API surface | `src/preload/index.ts`                      |
| Window config / security    | `src/main/index.ts`                         |
| Packaging, extraResources   | `electron-builder.cjs`                      |
| MCP discovery for clients   | `src/main/mcp-portfile.ts`, `src/mcp-shim/` |

## CONVENTIONS

- Separate npm workspace; built by `tsup` to CJS (Electron main is CommonJS).
- Dev: waits on `http-get://127.0.0.1:1420` before launching the window.
- Backend binds `127.0.0.1` on an **ephemeral port** (`PORT=0`). The real port
  reaches the renderer over the `backend-ready` IPC, and external MCP clients
  through `mcp.json`. Never assume 3000 — that is the standalone dev backend.
- `OPENPCB_ALLOW_UNAUTHENTICATED_API=true` is set unconditionally; loopback is
  the security boundary for everything except `/api/modules/assistant/mcp`,
  which additionally requires the `OPENPCB_MCP_TOKEN` bearer.
- Only true natives stay external to the bundle (`electron`, `better-sqlite3`,
  `electron-updater`); everything else is inlined.
- The DRC worker (`dist/main/drc-worker.js`, S10) is a `node:worker_threads` entry bundled
  from `src/shared/drc/worker/drc-worker.ts`. It is `asarUnpack`ed and `backend-server.ts`
  points the backend at it with `setDrcWorkerEntry` (dev: `dist/main/…`; packaged:
  `app.asar.unpacked/dist/main/…`); `dev:electron` waits for the file. `closeCurrentRuntime`
  terminates it — `unref()` is not relied on.

## ANTI-PATTERNS

- Do NOT reintroduce a spawned backend or a `backend-manager.ts`.
- Do NOT put business logic here — it belongs in `src/modules/*`.
- Do NOT ship an executable inside `app.asar` (it cannot be spawned); use
  `extraResources`, as the MCP shim does.
- Do NOT hardcode the backend port.
