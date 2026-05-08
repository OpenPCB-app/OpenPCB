# SHARED DOMAIN PLATFORM

**Purpose:** ECS engine, command pattern, canvas, shared types — used by all modules.

## STRUCTURE

```
src/shared/
├── frontend/
│   └── canvas/              # Reusable canvas/rendering engine
│       ├── primitives/      # Grid, crosshair, selection highlight (6 files)
│       ├── interaction/     # Hit testing, drag, selection box
│       ├── camera/          # Zoom, pan, viewport
│       ├── utils/           # Screen↔world transforms
│       └── types.ts         # Canvas-specific types
└── backend/
    └── (shared backend utilities)
```

## WHERE TO LOOK

| Task                  | Location                     |
| --------------------- | ---------------------------- |
| Canvas primitives     | frontend/canvas/primitives/  |
| Camera controls       | frontend/canvas/camera/      |
| Interaction           | frontend/canvas/interaction/ |
| Coordinate transforms | frontend/canvas/utils/       |

## KEY ABSTRACTIONS

- **CanvasHost**: R3F wrapper, mounts scenes
- **Camera**: Viewport, zoom, pan state
- **Primitives**: Grid, crosshair, selection
- **Interaction**: Hit testing, drag handlers

## CONVENTIONS

- Used by designer + library modules
- React Three Fiber (R3F) based
- Screen/world coordinate conversions in utils/

## NOTES

- ECS engine referenced in docs but not yet visible in current codebase
- Command pattern lives here (see docs/COMMAND_PATTERN.md)
