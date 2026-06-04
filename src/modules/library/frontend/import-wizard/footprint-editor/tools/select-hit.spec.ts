import { describe, test, expect, beforeEach } from "vitest";
import type { InteractionEvent } from "../../../../../../shared/frontend/canvas/interaction/types";
import { useFootprintEditorStore } from "../useFootprintEditorStore";
import { createSelectTool } from "./select-tool";

const NM = 1_000_000;

function ev(xMm: number, yMm: number): InteractionEvent {
  const at = { x: xMm * NM, y: yMm * NM };
  return {
    worldPoint: at,
    snappedPoint: at,
    screenPoint: { x: xMm, y: yMm },
    modifiers: { shift: false, ctrl: false, meta: false, alt: false },
  } as InteractionEvent;
}

describe("footprint select hit-testing", () => {
  beforeEach(() => {
    useFootprintEditorStore.getState().reset();
  });

  test("clicking a pad's body selects it", () => {
    const store = useFootprintEditorStore.getState();
    store.addPad({
      number: "1",
      shape: "rect",
      centerMm: { x: 5, y: 5 },
      widthMm: 2,
      heightMm: 2,
      rotationDeg: 0,
      layer: "F.Cu",
    });
    const tool = createSelectTool();
    tool.onPointerDown!(ev(5, 5));

    const padId = useFootprintEditorStore.getState().pads[0]!.id;
    expect([...useFootprintEditorStore.getState().selectedIds]).toEqual([padId]);
  });

  test("clicking the INTERIOR of a circle graphic selects it (not just the ring)", () => {
    const store = useFootprintEditorStore.getState();
    store.addGraphic(
      {
        kind: "circle",
        center: { x: 10, y: 10 },
        radiusMm: 3,
        fill: "none",
        strokeWidthMm: 0.15,
      },
      "F.SilkS",
    );
    const tool = createSelectTool();
    tool.onPointerDown!(ev(10, 10)); // dead center — well inside the ring

    const gId = useFootprintEditorStore.getState().graphics[0]!.id;
    expect([...useFootprintEditorStore.getState().selectedIds]).toEqual([gId]);
  });

  test("clicking empty space clears selection", () => {
    useFootprintEditorStore.getState().addPad({
      number: "1",
      shape: "rect",
      centerMm: { x: 5, y: 5 },
      widthMm: 2,
      heightMm: 2,
      rotationDeg: 0,
      layer: "F.Cu",
    });
    const padId = useFootprintEditorStore.getState().pads[0]!.id;
    useFootprintEditorStore.getState().setSelection(new Set([padId]));
    const tool = createSelectTool();
    tool.onPointerDown!(ev(50, 50)); // far away

    expect(useFootprintEditorStore.getState().selectedIds.size).toBe(0);
  });
});
