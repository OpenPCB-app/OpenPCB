import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { usePcbStore } from "@/stores/pcb-store";
import { PcbToolbar } from "./PcbToolbar";

describe("PcbToolbar", () => {
  beforeEach(() => {
    usePcbStore.setState({
      document: null,
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

  it("matches snapshot while idle", () => {
    const { container } = render(<PcbToolbar />);
    expect(container).toMatchSnapshot();
  });

  it("matches snapshot while routing and disables undo/redo", () => {
    usePcbStore.setState({
      activeTool: "route",
      routingSession: {
        netId: "net-1",
        layer: "B.Cu",
        width: 0.5,
        widthPresets: [0.25, 0.5],
        widthIndex: 1,
        elbowDirection: "horizontal_first",
        committedSegments: [],
        committedVias: [],
        startPoint: { x: 0, y: 0 },
        previewSegments: [],
        viaDiameter: 0.8,
        viaDrill: 0.4,
      },
    });

    const { container, getByRole } = render(<PcbToolbar />);
    expect(getByRole("button", { name: "Undo" })).toBeDisabled();
    expect(getByRole("button", { name: "Redo" })).toBeDisabled();
    expect(container).toMatchSnapshot();
  });
});
