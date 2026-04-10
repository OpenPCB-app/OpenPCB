# CORE FRONTEND

**Purpose:** React 19 app shell — RuntimeProvider → BootstrapProvider → ThemeProvider → AppShell → AppRouter.

## STRUCTURE

```
src/core/frontend/src/
├── main.tsx             # React entry point
├── App.tsx              # Root provider stack
├── providers/           # RuntimeProvider, BootstrapProvider, ThemeProvider
├── shell/               # AppShell, sidebar, loading gates
├── router/              # Route switch, module route collection
├── stores/              # navigation.store, app.store (zustand)
├── components/          # UI primitives, layout components
├── screens/             # HomeScreen, module screens
├── hooks/               # useBackendPort, useElectronIPC, useTheme
└── settings/            # Settings UI panels
```

## WHERE TO LOOK

| Task             | Location                     |
| ---------------- | ---------------------------- |
| Add provider     | providers/ (wrap in App.tsx) |
| Add route        | router/ModuleRoutes.tsx      |
| Sidebar item     | shell/AppSidebar.tsx         |
| Navigation state | stores/navigation.store.ts   |
| Settings panel   | settings/panels/             |

## CONVENTIONS

- Vite 7 + Tailwind 4
- Path alias `@` → `src/core/frontend/src`
- Path alias `@modules` → `src/modules`
- Port 1420, proxies `/api` and `/ws` to backend :3000

## NOTES

- Frontend fetches module registry from backend
- Lazy-loads module frontends via dynamic imports
