import { describe, expect, it } from "vitest";
import { calculateRatsnest } from "./ratsnest";
import type { PcbNet, PcbPlacement, TraceSegment, Via } from "./pcb-types";
import type { ParsedKicadFootprint } from "@/lib/api/component-api";

function createFootprint(padPositions: Array<{ number: string; x: number; y: number }>): ParsedKicadFootprint {
  return {
    name: "test-footprint",
    description: "",
    tags: [],
    pads: padPositions.map((pad) => ({
      number: pad.number,
      type: "thru_hole",
      shape: "circle",
      position: { x: pad.x, y: pad.y },
      size: { width: 1, height: 1 },
      rotation: 0,
      layers: ["F.Cu", "B.Cu"],
      drillDiameter: 0.5,
    })),
    graphics: [],
    model3dRefs: [],
    attributes: { type: "through_hole" },
    warnings: [],
    rawSource: "",
  };
}

function createPlacement(
  id: string,
  schematicSymbolId: string,
  x: number,
  y: number,
  layer: "F.Cu" | "B.Cu" = "F.Cu",
): PcbPlacement {
  return {
    id,
    schematicSymbolId,
    componentId: schematicSymbolId,
    variantId: "variant-1",
    footprintOptionId: "footprint-1",
    reference: schematicSymbolId,
    value: schematicSymbolId,
    position: { x, y },
    rotation: 0,
    layer,
    footprintData: createFootprint([{ number: "1", x: 0, y: 0 }]),
  };
}

function createNet(...componentIds: string[]): PcbNet {
  return {
    id: "net-1",
    name: "NET1",
    netClass: "default",
    padRefs: componentIds.map((componentId) => ({ componentId, padNumber: "1" })),
  };
}

describe("calculateRatsnest", () => {
  it("returns one ratsnest line for two disconnected pads", () => {
    const nets = [createNet("u1", "u2")];
    const placements = [
      createPlacement("u1", "u1", 0, 0),
      createPlacement("u2", "u2", 10, 0),
    ];

    const result = calculateRatsnest(nets, placements, [], []);

    expect(result).toHaveLength(1);
    expect(result[0]?.start).toEqual({ x: 0, y: 0 });
    expect(result[0]?.end).toEqual({ x: 10, y: 0 });
  });

  it("removes ratsnest when a trace connects both pads", () => {
    const nets = [createNet("u1", "u2")];
    const placements = [
      createPlacement("u1", "u1", 0, 0),
      createPlacement("u2", "u2", 10, 0),
    ];
    const traces: TraceSegment[] = [
      {
        id: "trace-1",
        start: { x: 0, y: 0 },
        end: { x: 10, y: 0 },
        width: 0.25,
        layer: "F.Cu",
        net: "net-1",
      },
    ];

    const result = calculateRatsnest(nets, placements, traces, []);

    expect(result).toHaveLength(0);
  });

  it("keeps ratsnest for a partial trace that does not reach the target pad", () => {
    const nets = [createNet("u1", "u2")];
    const placements = [
      createPlacement("u1", "u1", 0, 0),
      createPlacement("u2", "u2", 10, 0),
    ];
    const traces: TraceSegment[] = [
      {
        id: "trace-1",
        start: { x: 0, y: 0 },
        end: { x: 5, y: 0 },
        width: 0.25,
        layer: "F.Cu",
        net: "net-1",
      },
    ];

    const result = calculateRatsnest(nets, placements, traces, []);

    expect(result).toHaveLength(1);
  });

  it("treats trace-via-trace chains as connected", () => {
    const nets = [createNet("u1", "u2")];
    const placements = [
      createPlacement("u1", "u1", 0, 0, "F.Cu"),
      createPlacement("u2", "u2", 10, 0, "B.Cu"),
    ];
    const traces: TraceSegment[] = [
      {
        id: "trace-1",
        start: { x: 0, y: 0 },
        end: { x: 5, y: 0 },
        width: 0.25,
        layer: "F.Cu",
        net: "net-1",
      },
      {
        id: "trace-2",
        start: { x: 5, y: 0 },
        end: { x: 10, y: 0 },
        width: 0.25,
        layer: "B.Cu",
        net: "net-1",
      },
    ];
    const vias: Via[] = [
      {
        id: "via-1",
        position: { x: 5, y: 0 },
        padDiameter: 0.8,
        drillDiameter: 0.4,
        net: "net-1",
        type: "through",
        layers: ["F.Cu", "B.Cu"],
        tented: true,
      },
    ];

    const result = calculateRatsnest(nets, placements, traces, vias);

    expect(result).toHaveLength(0);
  });
});
