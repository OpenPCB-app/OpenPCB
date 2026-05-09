# SDK CONTRACTS

**Purpose:** Cross-module type contracts — token-based dependency injection between modules.

## STRUCTURE

```
src/sdks/
├── index.ts           # MODULE_SDK_TOKENS = { LIBRARY, DESIGNER }
├── library/
│   ├── index.ts       # Re-exports
│   └── types.ts       # LibrarySDK interface
└── designer/
    ├── index.ts       # Re-exports
    ├── types.ts       # DesignerCommand union + projections
    └── events.ts      # DesignerInvalidatedEvent
```

## WHERE TO LOOK

| Task                      | Location             |
| ------------------------- | -------------------- |
| Add Library SDK method    | `library/types.ts`   |
| Add Designer command      | `designer/types.ts`  |
| Add cross-module event    | `designer/events.ts` |
| Register new module token | `index.ts`           |

## CONVENTIONS

- Token-based DI: `ctx.sdk.get<T>(MODULE_SDK_TOKENS.LIBRARY)`
- Modules publish SDKs in `registerSdk()` lifecycle hook
- No implementations here — pure interfaces + types
- Frontend gets generated typed stubs in `src/core/frontend/src/generated/sdk/`

## NOTES

- LibrarySDK: `resolveComponent`, `getSymbol`, `getFootprint`, `searchComponents`
- DesignerSDK: `createDesign`, `dispatchCommand`, `undo/redo`, `getSchematicProjection`, `getPcbProjection`
- Adding a command requires updating `DesignerCommand` union in `designer/types.ts`
