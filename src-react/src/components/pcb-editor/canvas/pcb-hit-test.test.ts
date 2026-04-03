import { describe, expect, it } from "vitest";
import type { ParsedKicadFootprint } from "@/lib/api/component-api";
import { hitTestPcb } from "./pcb-hit-test";
import type { PcbPlacement, TraceSegment, Via } from "../pcb-types";

function createFootprint(): ParsedKicadFootprint {
  return {
    name: "test-footprint",
    description: "",
    tags: [],
    pads: [
      {
        number: "1",
        type: "thru_hole",
        shape: "circle",
        position: { x: 0, y: 0 },
        size: { width: 1, height: 1 },
        rotation: 0,
        layers: ["F.Cu", "B.Cu"],
        drillDiameter: 0.5,
      },
    ],
    graphics: [],
    model3dRefs: [],
    attributes: { type: "through_hole" },
    warnings: [],
    rawSource: "",
  };
}

function createPlacement(id: string, x: number, y: number): PcbPlacement {
  return {
    id,
    schematicSymbolId: id,
    componentId: id,
    variantId: "variant-1",
    footprintOptionId: "footprint-1",
    reference: id,
    value: id,
    position: { x, y },
    rotation: 0,
    layer: "F.Cu",
    footprintData: createFootprint(),
  };
}

describe("hitTestPcb", () => {
  it("hits vias before traces and placements", () => {
    const placements = [createPlacement("u1", 20, 20)];
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

    const result = hitTestPcb(placements, traces, vias, { x: 5, y: 0 }, "F.Cu");

    expect(result).toEqual({ kind: "via", viaId: "via-1" });
  });

  it("hits traces when no via or pad is present", () => {
    const result = hitTestPcb(
      [],
      [
        {
          id: "trace-1",
          start: { x: 0, y: 0 },
          end: { x: 10, y: 0 },
          width: 0.25,
          layer: "F.Cu",
          net: "net-1",
        },
      ],
      [],
      { x: 5, y: 0.05 },
      "F.Cu",
    );

    expect(result).toEqual({ kind: "trace", traceId: "trace-1" });
  });
});
