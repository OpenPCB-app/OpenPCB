import { beforeEach, describe, expect, it } from "vitest";
import type { InteractionEvent } from "../../../../shared/frontend/canvas/interaction/types";
import { eventToEditorMm, snapEditorPointMm } from "./grid-snap";
import { useSymbolEditorStore } from "./editor/useSymbolEditorStore";
import { createPinTool } from "./editor/tools/pin-tool";
import { createSelectTool as createSymbolSelectTool } from "./editor/tools/select-tool";
import { useFootprintEditorStore } from "./footprint-editor/useFootprintEditorStore";
import { createPadTool } from "./footprint-editor/tools/pad-tool";
import { createLineTool } from "./footprint-editor/tools/line-tool";

const NM = 1_000_000;

function ev(xMm: number, yMm: number): InteractionEvent {
  const at = { x: xMm * NM, y: yMm * NM };
  return {
    worldPoint: at,
    snappedPoint: at,
    screenPoint: { x: 0, y: 0 },
    modifiers: { shift: false, ctrl: false, meta: false, alt: false },
    button: 0,
  } as InteractionEvent;
}

describe("library editor snap policy", () => {
  it("snaps on integer nanometres, including negatives and half ties", () => {
    const grid = { gridSizeMm: 1.27, snapEnabled: true };
    expect(snapEditorPointMm({ x: 3.9, y: -3.9 }, grid)).toEqual({
      x: 3.81,
      y: -3.81,
    });
    // Ties follow Math.round toward +infinity, as in the designer.
    expect(snapEditorPointMm({ x: 0.635, y: -0.635 }, grid)).toEqual({
      x: 1.27,
      y: 0,
    });
    expect(snapEditorPointMm({ x: 0, y: -0 }, grid)).toEqual({ x: 0, y: 0 });
  });

  it("snap off keeps off-grid points at nanometre precision", () => {
    const grid = { gridSizeMm: 1.27, snapEnabled: false };
    expect(eventToEditorMm(ev(1.2345678, -0.0000004), grid)).toEqual({
      x: 1.234568,
      y: 0,
    });
  });
});

describe("snapping is independent of grid visibility", () => {
  beforeEach(() => {
    useSymbolEditorStore.getState().reset();
    useFootprintEditorStore.getState().reset();
  });

  it("symbol pin placement snaps with the grid hidden", () => {
    const store = useSymbolEditorStore.getState();
    store.setGridVisible(false);
    const tool = createPinTool();
    tool.onActivate?.();
    tool.onPointerDown?.(ev(3.9, -1.2));
    expect(useSymbolEditorStore.getState().pins[0]!.positionMm).toEqual({
      x: 3.81,
      y: -1.27,
    });
  });

  it("symbol pin placement stays off-grid with snap off and the grid shown", () => {
    const store = useSymbolEditorStore.getState();
    store.setGridVisible(true);
    store.setSnapEnabled(false);
    const tool = createPinTool();
    tool.onActivate?.();
    tool.onPointerDown?.(ev(3.9, -1.2));
    expect(useSymbolEditorStore.getState().pins[0]!.positionMm).toEqual({
      x: 3.9,
      y: -1.2,
    });
  });

  it("footprint pad and line tools follow the snap setting", () => {
    const store = useFootprintEditorStore.getState();
    store.setGridVisible(false);
    const pad = createPadTool();
    pad.onActivate?.();
    pad.onPointerDown?.(ev(1.0, -1.0));
    expect(useFootprintEditorStore.getState().pads[0]!.centerMm).toEqual({
      x: 1.27,
      y: -1.27,
    });

    store.setGridVisible(true);
    store.setSnapEnabled(false);
    store.setActiveLayer("F.SilkS");
    const line = createLineTool();
    line.onActivate?.();
    line.onPointerDown?.(ev(0.1, 0.2));
    line.onPointerDown?.(ev(1.3, 0.2));
    const graphic = useFootprintEditorStore.getState().graphics[0]!.graphic;
    expect(graphic).toMatchObject({
      kind: "line",
      a: { x: 0.1, y: 0.2 },
      b: { x: 1.3, y: 0.2 },
    });
  });

  it("drag-move snaps the grabbed anchor with the grid hidden", () => {
    const store = useSymbolEditorStore.getState();
    store.addPin({
      name: "1",
      number: "1",
      electricalType: "passive",
      positionMm: { x: 0, y: 0 },
      lengthMm: 2.54,
      rotationDeg: 180,
    });
    store.setGridVisible(false);
    // Keep alignment-guide magnetism out of the grid assertion.
    if (useSymbolEditorStore.getState().alignmentGuidesVisible)
      store.toggleAlignmentGuidesVisible();
    const tool = createSymbolSelectTool();
    tool.onActivate?.();
    tool.onPointerDown?.(ev(0, 0));
    tool.onPointerMove?.({ ...ev(2.0, 0.4), screenPoint: { x: 50, y: 0 } });
    tool.onPointerUp?.(ev(2.0, 0.4));
    expect(useSymbolEditorStore.getState().pins[0]!.positionMm).toEqual({
      x: 2.54,
      y: 0,
    });
  });

  it("paste at the cursor snaps with the grid hidden", () => {
    const store = useFootprintEditorStore.getState();
    store.setActiveLayer("F.SilkS");
    store.addGraphic(
      {
        kind: "line",
        a: { x: 0, y: 0 },
        b: { x: 1.27, y: 0 },
        strokeWidthMm: 0.15,
      },
      "F.SilkS",
    );
    store.selectAll();
    store.copySelection();
    store.setGridVisible(false);
    store.setCursorMm({ x: 5.1, y: 0.2 });
    store.paste();
    const pasted = useFootprintEditorStore.getState().graphics[1]!.graphic;
    // Clipboard anchor is the copied bbox centre (0.635, 0) → lands on (5.08, 0).
    expect(pasted).toMatchObject({
      a: { x: 5.08 - 0.635, y: 0 },
      b: { x: 5.08 + 0.635, y: 0 },
    });
  });
});
