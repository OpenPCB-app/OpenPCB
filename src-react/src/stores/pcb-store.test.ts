import { beforeEach, describe, expect, it } from "vitest";
import type { ParsedKicadFootprint } from "@/lib/api/component-api";
import { createDefaultPcbViewport, type PcbDocument, type PcbPlacement, type TraceSegment, type Via } from "@/components/pcb-editor/pcb-types";
import { usePcbStore } from "./pcb-store";

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

function createPlacement(id: string, x: number): PcbPlacement {
  return {
    id,
    schematicSymbolId: id,
    componentId: id,
    variantId: "variant-1",
    footprintOptionId: "footprint-1",
    reference: id,
    value: id,
    position: { x, y: 0 },
    rotation: 0,
    layer: "F.Cu",
    footprintData: createFootprint(),
  };
}

function createDocument(): PcbDocument {
  const placements = [createPlacement("u1", 0), createPlacement("u2", 10)];
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

  return {
    boardOutline: { width: 100, height: 100 },
    manufacturerPreset: "jlcpcb_standard",
    netClasses: [],
    nets: [
      {
        id: "net-1",
        name: "NET1",
        netClass: "default",
        padRefs: [
          { componentId: "u1", padNumber: "1" },
          { componentId: "u2", padNumber: "1" },
        ],
      },
    ],
    placements,
    traces,
    vias,
    zones: [],
  };
}

beforeEach(() => {
  usePcbStore.setState({
    document: null,
    ratsnest: [],
    routingSession: null,
    lastCursorPosition: null,
    viewport: createDefaultPcbViewport(),
    activeLayer: "F.Cu",
    visibleLayers: new Set([
      "F.Cu",
      "B.Cu",
      "F.SilkS",
      "B.SilkS",
      "F.Mask",
      "B.Mask",
      "F.CrtYd",
      "Edge.Cuts",
      "ratsnest",
    ]),
    gridSize: 0.5,
    selectedIds: new Set(),
    activeTool: "select",
  });
});

describe("pcb-store deleteSelectedEntities", () => {
  it("deletes mixed selected entities and undo restores them", () => {
    const store = usePcbStore.getState();
    store.setDocument(createDocument());

    usePcbStore.setState({ selectedIds: new Set(["u1", "trace-1", "via-1"]) });
    usePcbStore.getState().deleteSelectedEntities();

    const afterDelete = usePcbStore.getState();
    expect(afterDelete.document?.placements.map((item) => item.id)).toEqual(["u2"]);
    expect(afterDelete.document?.traces).toHaveLength(0);
    expect(afterDelete.document?.vias).toHaveLength(0);
    expect(afterDelete.selectedIds.size).toBe(0);

    afterDelete.undo();

    const afterUndo = usePcbStore.getState();
    expect(afterUndo.document?.placements).toHaveLength(2);
    expect(afterUndo.document?.traces).toHaveLength(1);
    expect(afterUndo.document?.vias).toHaveLength(1);
  });
});
