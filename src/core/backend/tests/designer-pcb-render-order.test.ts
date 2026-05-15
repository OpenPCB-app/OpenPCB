import { describe, expect, test } from "bun:test";
import {
  PCB_LAYER_METADATA,
  RENDER_ORDER,
  effectiveRenderOrder,
  type PcbLayerId,
} from "../../../shared/frontend/canvas/layers";

const BASE_RENDER_SLOTS: Record<PcbLayerId, { object: number; fill?: number }> = {
  "F.Cu": { object: RENDER_ORDER.F_COPPER, fill: RENDER_ORDER.F_COPPER_FILL },
  "In1.Cu": { object: RENDER_ORDER.IN1_COPPER, fill: RENDER_ORDER.IN1_COPPER_FILL },
  "In2.Cu": { object: RENDER_ORDER.IN2_COPPER, fill: RENDER_ORDER.IN2_COPPER_FILL },
  "B.Cu": { object: RENDER_ORDER.B_COPPER, fill: RENDER_ORDER.B_COPPER_FILL },
  "F.Mask": { object: RENDER_ORDER.F_MASK },
  "B.Mask": { object: RENDER_ORDER.B_MASK },
  "F.Paste": { object: RENDER_ORDER.F_PASTE },
  "B.Paste": { object: RENDER_ORDER.B_PASTE },
  "F.SilkS": { object: RENDER_ORDER.F_SILK },
  "B.SilkS": { object: RENDER_ORDER.B_SILK },
  "F.CrtYd": { object: RENDER_ORDER.COURTYARD },
  "B.CrtYd": { object: RENDER_ORDER.COURTYARD - 0.5 },
  "F.Fab": { object: RENDER_ORDER.F_FAB },
  "B.Fab": { object: RENDER_ORDER.B_FAB },
  "Edge.Cuts": { object: RENDER_ORDER.EDGE_CUTS },
  Drill: { object: RENDER_ORDER.DRILL },
  Metadata: { object: RENDER_ORDER.METADATA },
};

const PHYSICAL_COUNTERPART: Partial<Record<PcbLayerId, PcbLayerId>> = {
  "F.Cu": "B.Cu",
  "B.Cu": "F.Cu",
  "F.Mask": "B.Mask",
  "B.Mask": "F.Mask",
  "F.Paste": "B.Paste",
  "B.Paste": "F.Paste",
  "F.SilkS": "B.SilkS",
  "B.SilkS": "F.SilkS",
  "F.CrtYd": "B.CrtYd",
  "B.CrtYd": "F.CrtYd",
  "F.Fab": "B.Fab",
  "B.Fab": "F.Fab",
};

const annotationLayers: PcbLayerId[] = ["Edge.Cuts", "Drill", "Metadata"];
const copperLayers: PcbLayerId[] = ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"];

describe("effectiveRenderOrder layer matrix", () => {
  test("top view object slots match base render slots for every PCB layer", () => {
    for (const layerId of Object.keys(PCB_LAYER_METADATA) as PcbLayerId[]) {
      expect(effectiveRenderOrder(layerId, "top", "object")).toBe(
        BASE_RENDER_SLOTS[layerId].object,
      );
    }
  });

  test("bottom view object slots use physical counterparts and leave inner copper in place", () => {
    for (const layerId of Object.keys(PCB_LAYER_METADATA) as PcbLayerId[]) {
      const counterpart = PHYSICAL_COUNTERPART[layerId] ?? layerId;
      expect(effectiveRenderOrder(layerId, "bottom", "object")).toBe(
        BASE_RENDER_SLOTS[counterpart].object,
      );
    }
  });

  test("annotation layers keep the same object slot regardless of view side", () => {
    for (const layerId of annotationLayers) {
      expect(effectiveRenderOrder(layerId, "top", "object")).toBe(
        BASE_RENDER_SLOTS[layerId].object,
      );
      expect(effectiveRenderOrder(layerId, "bottom", "object")).toBe(
        BASE_RENDER_SLOTS[layerId].object,
      );
      expect(PCB_LAYER_METADATA[layerId].reverseOnFlip).toBe(false);
    }
  });

  test("fill slots for copper layers match base fill slots", () => {
    for (const layerId of copperLayers) {
      const fillSlot = BASE_RENDER_SLOTS[layerId].fill;
      if (fillSlot === undefined) {
        throw new Error(`${layerId} must define a copper fill render slot`);
      }
      expect(effectiveRenderOrder(layerId, "top", "fill")).toBe(
        fillSlot,
      );
    }
  });

  test("F.Cu fill renders below F.Cu objects", () => {
    expect(effectiveRenderOrder("F.Cu", "top", "fill")).toBeLessThan(
      effectiveRenderOrder("F.Cu", "top", "object"),
    );
  });

  test("bottom view brings B.Cu above F.Cu", () => {
    expect(effectiveRenderOrder("B.Cu", "bottom", "object")).toBeGreaterThan(
      effectiveRenderOrder("F.Cu", "bottom", "object"),
    );
  });
});
