# Fix Drag-and-Drop Component Placement onto Schematic Canvas

## Context

User can grab components from the left sidebar palette but nothing happens on drop onto the canvas. GND and resistor symbols are **correctly defined** (drawing, pins, bounds, templates all valid). The bug is in the event handling and CSS layering, not in the symbol definitions.

## Root Causes

### 1. CRITICAL: Stale Closure in `readDraggedSymbolKind`

**File**: `src-react/src/components/pcb/canvas/SchematicCanvas.tsx:77-93`

`readDraggedSymbolKind` has 3 fallback tiers:

1. `dataTransfer.getData()` -- **returns "" in Chrome/Edge during `dragover`** (browser security)
2. `draggedSymbolKind` -- captured via **closure** from `useSchematicStore` selector
3. `session?.symbolKind` -- captured via **closure** from `useSchematicStore` selector

`onDragStart` in ComponentPalette updates the Zustand store synchronously, but React batches re-renders. The first `dragover` events fire before SchematicCanvas re-renders, so closure values are still `null`. All 3 tiers fail -> `handleDragOver` never calls `event.preventDefault()` -> browser never fires `drop` event.

Tests pass because `fireEvent` triggers synchronous React re-renders (not how real browsers work).

**Fix**: Replace closure fallbacks with `useSchematicStore.getState()` direct access (same pattern already used at lines 97 and 155 in the same file).

### 2. SECONDARY: FloatingPropertiesPopover Blocks Drag Events

**File**: `src-react/src/components/pcb/properties/FloatingPropertiesPopover.tsx:89`

```tsx
<div className="absolute inset-0 z-20">  <!-- NO pointer-events-none! -->
```

This div covers the entire canvas at z-20. It's a sibling of SchematicCanvas (in DesignScreen.tsx:324-326), so drag events hitting it do NOT propagate to the canvas container. After placing the first symbol (which is auto-selected -> popover renders), ALL subsequent drag operations fail.

**Fix**: Add `pointer-events-none` to the outer div. The dialog child already has `pointer-events-auto`.

### 3. MINOR: Defensive handleDrop Ordering

**File**: `src-react/src/components/pcb/canvas/SchematicCanvas.tsx:486`

`setPaletteDragSymbolKind(null)` is called before `commitPlacement`. Not currently harmful, but fragile.

**Fix**: Move after `commitPlacement`.

## Changes

### File 1: `src-react/src/components/pcb/canvas/SchematicCanvas.tsx`

**readDraggedSymbolKind (lines 77-93)** -- use `useSchematicStore.getState()` instead of closure:

```typescript
const readDraggedSymbolKind = useCallback(
  (dataTransfer: DataTransfer | null): SymbolKind | null => {
    const dragKind =
      dataTransfer?.getData(PALETTE_SYMBOL_KIND_MIME) ||
      dataTransfer?.getData("text/plain");
    if (dragKind) return dragKind as SymbolKind;
    const state = useSchematicStore.getState();
    if (state.draggedSymbolKind) return state.draggedSymbolKind;
    return state.session?.type === "placement"
      ? state.session.symbolKind
      : null;
  },
  [],
);
```

**handleDrop (lines 475-501)** -- reorder cleanup after commit:

```typescript
// Move setPaletteDragSymbolKind(null) to AFTER commitPlacement
```

### File 2: `src-react/src/components/pcb/properties/FloatingPropertiesPopover.tsx`

**Line 89** -- add pointer-events-none:

```tsx
<div className="pointer-events-none absolute inset-0 z-20" ...>
```

### File 3: `src-react/src/components/pcb/drag-placement.test.tsx`

Add test: "reads symbol kind via getState when closure values are stale"

- Set store state directly (bypass React re-render)
- Fire dragover with empty DataTransfer
- Verify placement session gets preview position

## Verification

1. `cd src-react && npx vitest run src/components/pcb/drag-placement.test.tsx`
2. `cd src-react && npx vitest run --reporter=verbose`
3. `npx tsc -p src-react/tsconfig.json --noEmit`
4. Manual: drag resistor + GND to canvas, verify ghost preview + placement
5. Manual: after first placement (popover visible), verify second placement works
