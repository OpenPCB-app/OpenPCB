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
│   ├── mcp-portfile.ts     # MCP token + <APP_DATA_DIR>/mcp.json (0600, atomic, never over a live owner)
│   ├── mcp-launcher{,-content}.ts  # stable <APP_DATA_DIR>/mcp/openpcb-mcp{,.cmd} launcher + snippets
│   ├── claude-plugin{,-content}.ts # local Claude Code plugin marketplace in <APP_DATA_DIR>/claude-code/
│   ├── claude-code-cli.ts  # one-click connect: drives the user's `claude` CLI (execFile, fixed argv)
│   ├── claude-registration.ts # what OpenPCB registered with Claude Code (exact ownership)
│   ├── win-cmd.ts          # cmd-shim resolution + cmd.exe escaping (fallback only)
│   ├── deep-link.ts        # openpcb:// scheme + single-instance lock
│   ├── diagnostics-ipc.ts  # diagnostics:* / app:get-versions / mcp:config / mcp:claude-code:*
│   ├── secure-storage.ts   # safeStorage-backed secure-store.json
│   ├── preferences.ts      # preferences.json (telemetry opt-in)
│   ├── updater.ts, logger.ts, crash.ts, sentry.ts
├── src/preload/index.ts    # contextBridge: window.electronAPI + window.updater
├── src/mcp-shim/           # stdio ⇄ Streamable HTTP bridge (own tsup entry): index.ts wiring +
│                           #   Electron-free bridge.ts / upstream.ts / portfile.ts (Bun-tested)
├── build/mcp/              # in-bundle openpcb-mcp launchers (extraResources; not what users register)
├── resources/claude-plugin/ # plugin template: README + skills (extraResources → claude-plugin/)
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
| MCP launcher / Claude Code  | `src/main/mcp-launcher*.ts`, `src/main/claude-plugin*.ts`, `src/main/claude-code-cli.ts` |

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

## MCP LAUNCHER, PLUGIN AND CLAUDE CODE

Operational contract in root `CLAUDE.md` (MCP section); user guide in
`docs/assistant/mcp-claude-code.md`.

- **Users register a stable entry point, never a bundle path.** On every launch, after the
  portfile, `backend-server.ts` calls `installMcpLauncher` (copies `resources/mcp/shim.js` to
  `<APP_DATA_DIR>/mcp/` and rewrites `openpcb-mcp{,.cmd}` + `launcher.json` atomically) and
  `writeClaudePluginMarketplace` (stages, then swaps `<APP_DATA_DIR>/claude-code/marketplace`).
  Both are non-fatal. Bundle paths move: an AppImage mounts at a new `/tmp/.mount_*` each run, the
  portable Windows build extracts to temp, an unsigned macOS app runs translocated from the DMG or
  Downloads.
- **Exec resolution** (`resolveLauncherExec`): `$APPIMAGE` → `$PORTABLE_EXECUTABLE_FILE` → the
  previous good exec when macOS is translocated/`/Volumes/` (and a Settings warning) →
  `process.execPath`. The launcher runs that binary with `ELECTRON_RUN_AS_NODE=1`, falling back to
  a system `node`.
- **`RunAsNode` fuse dependency.** The launcher, and the in-bundle `build/mcp/` scripts, need
  Electron's `RunAsNode` fuse **enabled** (the default; no fuse config exists today). Flipping it
  off — a common hardening step — silently degrades MCP to "needs a system Node". Change both
  together or not at all.
- **Unverified on real builds:** whether the AppImage runtime and the portable wrapper pass
  `ELECTRON_RUN_AS_NODE` and the script argument through to Electron. Smoke-test before a release
  that changes packaging.
- **Windows keeps cmd.exe out of the MCP transport** (`stdioServerConfig`): clients run the app
  exe on `<APP_DATA_DIR>\mcp\shim.js` with `ELECTRON_RUN_AS_NODE=1` in their env. (Node cannot
  spawn a `.cmd` without a shell since CVE-2024-27980, and `cmd /c` would put cmd's quoting rules
  between every path and the client.) The exe path is baked into the registration, so a moved app
  is detected against `claude-code/registration.json` and Settings offers "Update". The `.cmd`
  launcher is still written as a manual fallback (`%` doubled, UTF-8 via `chcp 65001`).
- **The plugin's `.mcp.json` holds `stdioServerConfig`** — Claude Code copies installed plugins into
  its cache, so anything version-specific must be refreshed through "Update plugin"
  (`marketplace update` + `plugin update`). `plugin.json` carries the app version for that check.
- **`claude-code-cli.ts` security posture:** runs only on an explicit Settings click, `execFile`
  with a fixed argv (never user text), a timeout on every run. A Windows npm `claude.cmd` is
  resolved to the `node` + `cli.js` it wraps (`win-cmd.ts` `cmdShimTarget`) and spawned directly;
  only an unreadable `.cmd` goes through `cmd.exe /d /s /c` with cross-spawn's escaping (ported,
  tested against cross-spawn). Registration uses `claude mcp add … -e K=V -- cmd args` — no JSON
  argument. A macOS GUI app does not inherit the shell PATH, hence the login-shell probe and known
  install paths.
- **Ownership is exact** (`claude-registration.ts`): `<APP_DATA_DIR>/claude-code/registration.json`
  records mode, server entry, plugin, marketplace and a stable installation id. A registration is
  OpenPCB's only when `claude mcp get` shows user scope and the same command + args (+ env) as the
  record or as what the app would register now; a same-named marketplace must be at our path.
  Nothing else is ever updated or removed.
- The `*-content.ts` files, `win-cmd.ts`, `claude-code-cli.ts`, `claude-registration.ts` and
  `src/mcp-shim/{bridge,upstream,portfile,instance}.ts` must stay free of `electron` imports:
  `mcp-claude-code-setup.test.ts` and `mcp-shim-bridge.test.ts` run them under Bun.
- **Bridge instance id** (`mcp-shim/instance.ts`): `OPENPCB_MCP_INSTANCE`, else a hash of Claude
  Code's `CLAUDE_CODE_SESSION_ID` (Claude Code sets it on stdio MCP servers), else random. It is
  the session half of the MCP actor — ownership of proposals, undo and idempotency.

## ANTI-PATTERNS

- Do NOT reintroduce a spawned backend or a `backend-manager.ts`.
- Do NOT put business logic here — it belongs in `src/modules/*`.
- Do NOT ship an executable inside `app.asar` (it cannot be spawned); use
  `extraResources`, as the MCP shim does.
- Do NOT hardcode the backend port.
