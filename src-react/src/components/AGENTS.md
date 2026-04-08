# React Components

UI component library for OpenPCB desktop application.

## Directory Structure

```
components/
├── ui/              # Radix-based primitives (button, dialog, etc.)
├── pcb/             # Schematic editor (legacy name, actually schematic)
├── pcb-editor/      # PCB layout editor
├── symbol-editor/   # Symbol creation/editing
├── footprint-editor/# Footprint creation/editing
├── 3d-viewer/       # 3D board preview
├── library/         # Component library browser
├── wizard/          # Component creation wizard
├── chat/            # AI chat interface
├── ai-elements/     # AI response renderers
├── sidebar/         # Navigation sidebar
├── design/          # Design system showcase
├── health/          # Connection status indicators
├── update/          # App update UI
└── workspace/       # Workspace management
```

## Component Patterns

### File Naming

- `ComponentName.tsx` - Main component
- `ComponentName.test.tsx` - Vitest tests
- `component-name-store.ts` - Local Zustand store (if needed)
- `types.ts` - Shared TypeScript types

### Canvas Components

Editors use render-engine for WebGL:

```typescript
import { SchematicCanvasR3F } from "@/lib/render-engine";
```

See `lib/render-engine/AGENTS.md` for rendering details.

### UI Primitives

Radix-based, Tailwind-styled:

```typescript
import { Button, Dialog, Input } from "@/components/ui";
```

40+ components in `ui/` directory.

## Key Components

| Component               | Location            | Purpose                         |
| ----------------------- | ------------------- | ------------------------------- |
| `SchematicEditor`       | `pcb/`              | Main schematic canvas + palette |
| `PcbEditor`             | `pcb-editor/`       | PCB layout canvas               |
| `SymbolEditorCanvas`    | `symbol-editor/`    | Symbol drawing                  |
| `FootprintEditorCanvas` | `footprint-editor/` | Footprint design                |
| `ComponentWizard`       | `wizard/`           | Multi-step component creation   |
| `ChatInterface`         | `ChatInterface/`    | AI assistant panel              |
| `GlobalStateProvider`   | `.`                 | App-wide state initialization   |

## State Management

- Global: Zustand stores in `src/stores/`
- Local: `useState` or component-level stores
- Server: React Query for API data

## Testing

```bash
npm run test:react                           # All tests
npm run test:react -- ComponentName.test.tsx # Single file
```

Uses Vitest + happy-dom + @testing-library/react.

## Sub-Directory AGENTS.md

See specialized guidance:

- `ai-elements/AGENTS.md` - AI response rendering
- `symbol-editor/` - Symbol editor specifics (no AGENTS.md yet)
- `pcb/` - Schematic editor internals (no AGENTS.md yet)
