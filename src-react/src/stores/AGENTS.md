# Zustand Stores

State management layer using Zustand with 4-part state architecture.

## State Architecture

Every store follows this pattern:

```typescript
interface XxxState {
  persisted: {
    /* DB-synced state */
  };
  derived: {
    /* computed from persisted */
  };
  chrome: {
    /* UI-only state (viewport, panels) */
  };
  session: {
    /* ephemeral interaction state */
  };
}
```

## Store Files

| Store                    | Purpose                   | Key State                                    |
| ------------------------ | ------------------------- | -------------------------------------------- |
| `schematic-store`        | Schematic editor          | document, viewport, toolMode, wiring session |
| `pcb-store`              | PCB layout editor         | board, layers, routing session               |
| `app-store`              | Global app state          | theme, sidebarOpen, currentProject           |
| `auth-store`             | Authentication            | user, tokens, license                        |
| `chat-store`             | AI chat interface         | messages, streaming state                    |
| `component-wizard-store` | Component creation wizard | step, formData                               |
| `navigation-store`       | Router state              | currentPath, history                         |
| `model-loading-store`    | 3D model loading          | loadingProgress, errors                      |
| `update-store`           | App update status         | updateAvailable, downloadProgress            |

## Patterns

### Undo/Redo

Stores with editable documents include undo manager:

```typescript
undo: () => void;
redo: () => void;
canUndo: () => boolean;
canRedo: () => boolean;
```

See `createUndoManager()` in `lib/undo-manager`.

### Viewport Management

Editor stores share viewport actions:

- `setViewport(viewport)` - direct set
- `pan(dx, dy)` - relative pan
- `zoomAt(x, y, factor)` - zoom toward point
- `resetViewport()` - fit content

### Interaction Sessions

Temporary state during mouse operations:

```typescript
session: {
  kind: "idle" | "placing" | "wiring" | "dragging" | "selecting";
  // kind-specific payload...
}
```

## Testing

Each store has colocated `*.test.ts`:

- Test state transitions in isolation
- Mock external dependencies (API calls)
- Use `act()` for async state updates

## Anti-Patterns

- **Don't** access stores outside React (use DI for services)
- **Don't** put derived state in `persisted` (compute it)
- **Don't** mix chrome/session state (chrome persists across sessions)
- **Don't** mutate state directly (use set() or immer)
