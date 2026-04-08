# Plan: Symbol Editor Drawing Tools — E2E Tests + Crash Fix

## Context

Drawing any primitive (rect, line, circle) onto the Symbol Editor canvas in the New Component Wizard causes the render to crash — grid disappears, nothing renders. The goal is to:

1. Create a dedicated e2e harness for the symbol editor (bypassing wizard backend flow)
2. Write Playwright tests that cover drawing all primitives + pin drop
3. Use those tests to catch and fix the crash

## Likely Crash Root Cause (from analysis)

The render loop in `SymbolEditorCanvas.tsx:763-778` has **no error handling**:

```js
const loop = () => {
  if (!running) return;
  render(); // ← if this throws, loop dies permanently
  rafRef.current = requestAnimationFrame(loop);
};
```

If any render function throws (NaN coordinates, invalid canvas state, etc.), the rAF never reschedules and the entire canvas dies. Additionally, `strokeWidth: 0.254` in `drawing-tools.ts` is suspiciously small (0.254 nm vs expected ~254,000 nm for 0.254mm) — though this alone wouldn't crash rendering, it indicates a unit mismatch.

## Step 1: Create `SymbolEditorE2EHarness.tsx`

**New file:** `src-react/src/testing/SymbolEditorE2EHarness.tsx`

Follow the pattern of `SchematicEditorE2EHarness.tsx`:

- Mount `SymbolEditorCanvas`, `SymbolEditorToolbar`, `PinPalette` directly
- Initialize store via `useSymbolEditorStore.setState()` with empty draft
- Add `E2EDebugPanel` exposing key state via `data-testid`:
  - `e2e-graphics-count` — `draft.graphics.length`
  - `e2e-pins-count` — `draft.pins.length`
  - `e2e-active-tool` — `chrome.activeTool`
  - `e2e-last-graphic-type` — type of last graphic in array
  - `e2e-selected-pins` — selected pin count
  - `e2e-selected-graphics` — selected graphic count
  - `e2e-viewport-zoom` — viewport zoom value
- Fixed canvas container: `800×600px`

**Modify:** `src-react/src/main.tsx`

- Add `?e2e=symbol-editor` route → render `SymbolEditorE2EHarness`

## Step 2: Write Playwright Tests

**New file:** `tests/e2e/symbol-editor.spec.ts`

### Test Suite: `symbol-editor drawing tools`

**Common setup (beforeEach):**

```
1. page.goto("/?e2e=symbol-editor")
2. Verify harness loads: expect(getByText("Symbol Editor E2E")).toBeVisible()
3. Verify canvas: expect(getByTestId("symbol-editor-canvas")).toBeVisible()
4. Verify initial state: e2e-graphics-count = "0", e2e-pins-count = "0"
```

### Test 1: `canvas renders grid on initial load`

- Assert canvas is visible
- Assert `e2e-active-tool` = "select"
- Take screenshot baseline (`symbol-editor-initial.png`)

### Test 2: `draw rectangle via tool button + mouse drag`

- Click button with title "Rectangle (R)"
- Assert `e2e-active-tool` = "rect"
- Get canvas bounds
- Dispatch: mousedown at (200, 200), mousemove to (400, 350), mouseup at (400, 350)
- Assert `e2e-graphics-count` = "1"
- Assert `e2e-last-graphic-type` = "rect"
- Assert canvas still visible (no crash)
- Take screenshot (`symbol-editor-rect.png`)

### Test 3: `draw line via tool button + mouse drag`

- Click button with title "Line (L)"
- Dispatch: mousedown at (100, 100), mousemove to (500, 400), mouseup at (500, 400)
- Assert `e2e-graphics-count` = "1"
- Assert `e2e-last-graphic-type` = "line"
- Take screenshot (`symbol-editor-line.png`)

### Test 4: `draw circle via tool button + mouse drag`

- Click button with title "Circle (C)"
- Dispatch: mousedown at (400, 300), mousemove to (500, 300), mouseup at (500, 300)
- Assert `e2e-graphics-count` = "1"
- Assert `e2e-last-graphic-type` = "circle"
- Take screenshot (`symbol-editor-circle.png`)

### Test 5: `draw multiple primitives sequentially`

- Draw rect, then line, then circle (using tool buttons + mouse events)
- Assert `e2e-graphics-count` = "3" after all three
- Assert canvas still renders (grid visible, no crash)
- Take screenshot (`symbol-editor-multi.png`)

### Test 6: `undo removes last drawn primitive`

- Draw a rectangle
- Assert `e2e-graphics-count` = "1"
- Press Ctrl+Z (or Cmd+Z on mac)
- Assert `e2e-graphics-count` = "0"
- Canvas still renders

### Test 7: `drag pin from palette onto canvas`

- Locate the "Input" pin button in PinPalette
- Dispatch dragstart → dragover canvas → drop at (300, 300) → dragend
- Assert `e2e-pins-count` = "1"
- Take screenshot (`symbol-editor-pin.png`)

### Test 8: `canvas survives rapid tool switching and drawing`

- Rapidly switch between rect, line, circle tools
- Draw small shapes with each
- Assert no console errors captured
- Assert `e2e-graphics-count` matches expected count

### Canvas interaction helper function:

```typescript
async function drawOnCanvas(
  canvas: Locator,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas not visible");
  await canvas.dispatchEvent("mousedown", {
    clientX: box.x + start.x,
    clientY: box.y + start.y,
    button: 0,
    buttons: 1,
  });
  await canvas.dispatchEvent("mousemove", {
    clientX: box.x + end.x,
    clientY: box.y + end.y,
    button: 0,
    buttons: 1,
  });
  await canvas.dispatchEvent("mouseup", {
    clientX: box.x + end.x,
    clientY: box.y + end.y,
    button: 0,
    buttons: 0,
  });
}
```

## Step 3: Fix the Crash (after tests confirm failure)

Based on analysis, likely fixes:

1. **Wrap render() in try/catch** so rAF loop survives errors (+ console.error for debugging)
2. **Fix strokeWidth units** in `drawing-tools.ts`: `0.254` → `254_000` (nanometers) or verify the intended unit system
3. **Add guard clauses** in each `renderXxxGraphic` function for NaN/Infinity coordinates

## Critical Files

| File                                                            | Action                                   |
| --------------------------------------------------------------- | ---------------------------------------- |
| `src-react/src/testing/SymbolEditorE2EHarness.tsx`              | **Create** — e2e harness                 |
| `src-react/src/main.tsx`                                        | **Modify** — add symbol-editor e2e route |
| `tests/e2e/symbol-editor.spec.ts`                               | **Create** — Playwright tests            |
| `src-react/src/components/symbol-editor/SymbolEditorCanvas.tsx` | **Modify** — crash fix                   |
| `src-react/src/components/symbol-editor/tools/drawing-tools.ts` | **Modify** — fix strokeWidth units       |

## Existing code to reuse

- `SchematicEditorE2EHarness.tsx` pattern for harness structure
- `DebugValue` component pattern for exposing state
- `dragPaletteItemToCanvas()` from `schematic-editor.spec.ts` for pin drag test
- `useCanvasColors` hook from `@/lib/canvas-theme`
- `createCenteredViewport` from `symbol-editor/viewport.ts`

## Verification

1. `npm run dev:frontend` — start Vite
2. Open `http://localhost:1420/?e2e=symbol-editor` — verify harness renders
3. `npx playwright test tests/e2e/symbol-editor.spec.ts` — run tests
4. Tests should FAIL initially (confirming the crash bug)
5. Apply fixes, re-run tests, all should PASS
6. Run existing test suite: `npx playwright test` — no regressions
