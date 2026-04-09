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

function createPlacementWithLayers(
  id: string,
  x: number,
  layer: "F.Cu" | "B.Cu",
  padLayers: string[],
): PcbPlacement {
  return {
    ...createPlacement(id, x),
    layer,
    footprintData: {
      ...createFootprint(),
      pads: [
        {
          ...createFootprint().pads[0]!,
          layers: padLayers,
        },
      ],
    },
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
  it("supports additive selection toggling", () => {
    const store = usePcbStore.getState();
    store.setDocument(createDocument());

    store.selectEntity("u1");
    store.selectEntity("trace-1", true);
    store.selectEntity("u1", true);

    expect(Array.from(usePcbStore.getState().selectedIds)).toEqual(["trace-1"]);
  });

  it("selects all placements", () => {
    const store = usePcbStore.getState();
    store.setDocument(createDocument());

    usePcbStore.getState().selectAllPlacements();

    expect(Array.from(usePcbStore.getState().selectedIds).sort()).toEqual([
      "u1",
      "u2",
    ]);
  });

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

  it("preserves exact route anchors and keeps route tool active after completion", () => {
    const store = usePcbStore.getState();
    store.setDocument({
      ...createDocument(),
      placements: [createPlacement("u1", 0.13), createPlacement("u2", 10.37)],
      traces: [],
      vias: [],
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
    });
    usePcbStore.setState({ activeTool: "route" });

    store.startRouting(
      { componentId: "u1", padNumber: "1" },
      { x: 0.13, y: 0.11 },
      "F.Cu",
    );
    store.completeRoute({ x: 10.37, y: 0.11 });

    const state = usePcbStore.getState();
    expect(state.document?.traces[0]?.start).toEqual({ x: 0.13, y: 0.11 });
    expect(state.document?.traces.at(-1)?.end).toEqual({ x: 10.37, y: 0.11 });
    expect(state.activeTool).toBe("route");
  });

  it("recomputes routing preview when width changes", () => {
    const store = usePcbStore.getState();
    store.setDocument(createDocument());
    usePcbStore.setState({ activeTool: "route" });

    store.startRouting(
      { componentId: "u1", padNumber: "1" },
      { x: 0, y: 0 },
      "F.Cu",
    );
    store.updateRoutingPreview({ x: 10, y: 5 });
    const initialWidth = usePcbStore.getState().routingSession?.previewSegments[0]?.width;

    store.cycleTraceWidth(1);

    const updatedWidth = usePcbStore.getState().routingSession?.previewSegments[0]?.width;
    expect(updatedWidth).not.toBe(initialWidth);
  });

  it("places a routing via, flips layers, and persists the routed chain on completion", () => {
    const store = usePcbStore.getState();
    store.setDocument(createDocument());
    usePcbStore.setState({ activeTool: "route" });

    store.startRouting(
      { componentId: "u1", padNumber: "1" },
      { x: 0, y: 0 },
      "F.Cu",
    );
    store.updateRoutingPreview({ x: 5, y: 0 });
    store.placeRoutingVia({ x: 5, y: 0 });

    expect(usePcbStore.getState().routingSession?.layer).toBe("B.Cu");
    expect(usePcbStore.getState().routingSession?.committedVias).toHaveLength(1);

    store.completeRoute({ x: 10, y: 0 });

    const state = usePcbStore.getState();
    expect(state.document?.vias).toHaveLength(2);
    expect(state.document?.traces.at(-2)?.layer).toBe("F.Cu");
    expect(state.document?.traces.at(-1)?.layer).toBe("B.Cu");
  });

  it("cancels routing without mutating the document", () => {
    const store = usePcbStore.getState();
    store.setDocument(createDocument());
    usePcbStore.setState({ activeTool: "route" });

    const before = usePcbStore.getState().document;

    store.startRouting(
      { componentId: "u1", padNumber: "1" },
      { x: 0, y: 0 },
      "F.Cu",
    );
    store.updateRoutingPreview({ x: 5, y: 5 });
    store.cancelRouting();

    const state = usePcbStore.getState();
    expect(state.routingSession).toBeNull();
    expect(state.lastCursorPosition).toBeNull();
    expect(state.document).toEqual(before);
  });

  it("does not create undo history when deleting unknown ids", () => {
    const store = usePcbStore.getState();
    store.setDocument(createDocument());
    usePcbStore.setState({ selectedIds: new Set(["missing-id"]) });

    store.deleteSelectedEntities();

    const state = usePcbStore.getState();
    expect(state.document?.placements).toHaveLength(2);
    expect(state.document?.traces).toHaveLength(1);
    expect(state.document?.vias).toHaveLength(1);
    expect(state.canUndo()).toBe(false);
  });

  it("starts routing on the clicked pad layer", () => {
    const store = usePcbStore.getState();
    store.setDocument({
      ...createDocument(),
      placements: [
        createPlacementWithLayers("u1", 0, "B.Cu", ["B.Cu"]),
        createPlacementWithLayers("u2", 10, "F.Cu", ["F.Cu"]),
      ],
      traces: [],
      vias: [],
    });

    store.startRouting({ componentId: "u1", padNumber: "1" }, { x: 0, y: 0 }, "B.Cu");

    const state = usePcbStore.getState();
    expect(state.routingSession?.layer).toBe("B.Cu");
    expect(state.activeLayer).toBe("B.Cu");
  });

  it("clears transient pcb editor state on schematic sync", () => {
    const store = usePcbStore.getState();
    store.setDocument(createDocument());
    usePcbStore.setState({
      selectedIds: new Set(["u1"]),
      activeTool: "route",
      routingSession: {
        netId: "net-1",
        layer: "F.Cu",
        width: 0.25,
        widthPresets: [0.25, 0.5],
        widthIndex: 0,
        elbowDirection: "horizontal_first",
        committedSegments: [],
        committedVias: [],
        startPoint: { x: 0, y: 0 },
        previewSegments: [],
        viaDiameter: 0.8,
        viaDrill: 0.4,
      },
      lastCursorPosition: { x: 1, y: 1 },
    });

    store.syncFromSchematic([], [], {
      componentsById: new Map(),
      importedSymbolLayoutsByComponentId: new Map(),
    });

    const state = usePcbStore.getState();
    expect(state.routingSession).toBeNull();
    expect(state.lastCursorPosition).toBeNull();
    expect(state.selectedIds.size).toBe(0);
    expect(state.activeTool).toBe("select");
  });
});
