# ELECTRON SHELL

**Purpose:** Thin OS shell — window management, IPC, spawns backend Bun process.

## STRUCTURE

```
electron/
├── main.ts              # Main process entry
├── preload.ts           # contextBridge (IPC)
├── backend-manager.ts   # Spawn + monitor Bun process
├── package.json         # Electron workspace
└── (build configs)
```

## WHERE TO LOOK

| Task          | Location           |
| ------------- | ------------------ |
| Backend spawn | backend-manager.ts |
| IPC handlers  | preload.ts         |
| Window config | main.ts            |

## CONVENTIONS

- Separate workspace in package.json workspaces
- Waits on `http-get://127.0.0.1:1420` before launching
- Spawns Bun backend as child process

## ANTI-PATTERNS

- Must NOT import from src/ (spawns backend instead)
- Pure shell — no business logic
