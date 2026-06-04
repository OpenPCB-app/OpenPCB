import { describe, test, expect, beforeEach } from "vitest";
import type { InteractionEvent } from "../../../../../../shared/frontend/canvas/interaction/types";
import { useFootprintEditorStore } from "../useFootprintEditorStore";
import { createRectTool } from "./rect-tool";
import { createCircleTool } from "./circle-tool";

const NM = 1_000_000;

function ev(
  xMm: number,
  yMm: number,
  mods: Partial<InteractionEvent["modifiers"]> = {},
): InteractionEvent {
  const at = { x: xMm * NM, y: yMm * NM };
  return {
    worldPoint: at,
    snappedPoint: at,
    screenPoint: { x: 0, y: 0 },
    modifiers: { shift: false, ctrl: false, meta: false, alt: false, ...mods },
  } as InteractionEvent;
}

describe("footprint copper draw → pads", () => {
  beforeEach(() => {
    const store = useFootprintEditorStore.getState();
    store.reset();
    store.setGridVisible(false); // draw at exact mm coords
  });

  test("Rect on F.Cu creates a numbered rect pad (not a graphic)", () => {
    useFootprintEditorStore.getState().setActiveLayer("F.Cu");
    const tool = createRectTool();
    tool.onActivate?.();
    tool.onPointerDown!(ev(0, 0));
    tool.onPointerDown!(ev(2, 1));

    const s = useFootprintEditorStore.getState();
    expect(s.pads).toHaveLength(1);
    expect(s.graphics).toHaveLength(0);
    const pad = s.pads[0]!;
    expect(pad.shape).toBe("rect");
    expect(pad.widthMm).toBeCloseTo(2);
    expect(pad.heightMm).toBeCloseTo(1);
    expect(pad.centerMm.x).toBeCloseTo(1);
    expect(pad.centerMm.y).toBeCloseTo(0.5);
    expect(pad.layer).toBe("F.Cu");
    expect(pad.number).toBe("1");
  });

  test("Rect on a non-copper layer stays an outline graphic", () => {
    useFootprintEditorStore.getState().setActiveLayer("F.SilkS");
    const tool = createRectTool();
    tool.onPointerDown!(ev(0, 0));
    tool.onPointerDown!(ev(2, 1));

    const s = useFootprintEditorStore.getState();
    expect(s.pads).toHaveLength(0);
    expect(s.graphics).toHaveLength(1);
    const g = s.graphics[0]!.graphic;
    expect(g.kind).toBe("rect");
    if (g.kind === "rect") expect(g.fill).toBe("none");
  });

  test("⌘/Ctrl modifier flips a copper Rect to a filled graphic", () => {
    useFootprintEditorStore.getState().setActiveLayer("F.Cu");
    const tool = createRectTool();
    tool.onPointerDown!(ev(0, 0));
    tool.onPointerDown!(ev(2, 1, { meta: true }));

    const s = useFootprintEditorStore.getState();
    expect(s.pads).toHaveLength(0);
    expect(s.graphics).toHaveLength(1);
    const g = s.graphics[0]!.graphic;
    if (g.kind === "rect") expect(g.fill).toBe("solid");
    expect(s.graphics[0]!.layer).toBe("F.Cu");
  });

  test("Circle on B.Cu creates a round pad sized to its diameter", () => {
    useFootprintEditorStore.getState().setActiveLayer("B.Cu");
    const tool = createCircleTool();
    tool.onPointerDown!(ev(0, 0)); // center
    tool.onPointerDown!(ev(0, 1)); // radius 1mm

    const s = useFootprintEditorStore.getState();
    expect(s.pads).toHaveLength(1);
    const pad = s.pads[0]!;
    expect(pad.shape).toBe("circle");
    expect(pad.widthMm).toBeCloseTo(2);
    expect(pad.heightMm).toBeCloseTo(2);
    expect(pad.layer).toBe("B.Cu");
  });

  test("Sequential copper pads auto-number", () => {
    useFootprintEditorStore.getState().setActiveLayer("F.Cu");
    const tool = createRectTool();
    tool.onPointerDown!(ev(0, 0));
    tool.onPointerDown!(ev(1, 1));
    tool.onPointerDown!(ev(3, 0));
    tool.onPointerDown!(ev(4, 1));

    const s = useFootprintEditorStore.getState();
    expect(s.pads.map((p) => p.number)).toEqual(["1", "2"]);
  });
});
