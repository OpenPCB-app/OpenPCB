import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { usePcbStore } from "@/stores/pcb-store";
import type { ParsedKicadFootprint } from "@/lib/api/component-api";
import { PcbSidebar } from "./PcbSidebar";
import type { PcbDocument, PcbPlacement } from "./pcb-types";

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

function createPlacement(): PcbPlacement {
  return {
    id: "u1",
    schematicSymbolId: "u1",
    componentId: "u1",
    variantId: "variant-1",
    footprintOptionId: "footprint-1",
    reference: "U1",
    value: "MCU",
    position: { x: 12.5, y: 8.75 },
    rotation: 90,
    layer: "F.Cu",
    footprintData: createFootprint(),
  };
}

function createDocument(): PcbDocument {
  return {
    boardOutline: { width: 100, height: 80 },
    manufacturerPreset: "jlcpcb_standard",
    netClasses: [],
    nets: [],
    placements: [createPlacement()],
    traces: [],
    vias: [],
    zones: [],
  };
}

describe("PcbSidebar", () => {
  beforeEach(() => {
    usePcbStore.setState({
      document: createDocument(),
      ratsnest: [],
      routingSession: null,
      lastCursorPosition: null,
      viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
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

  it("matches snapshot without a selection", () => {
    const { container } = render(<PcbSidebar />);
    expect(container).toMatchSnapshot();
  });

  it("matches snapshot with a selected placement", () => {
    usePcbStore.setState({ selectedIds: new Set(["u1"]) });
    const { container } = render(<PcbSidebar />);
    expect(container).toMatchSnapshot();
  });
});
