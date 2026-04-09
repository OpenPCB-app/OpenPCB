import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePcbStore } from "@/stores/pcb-store";
import type { ParsedKicadFootprint } from "@/lib/api/component-api";
import type {
  PcbDocument,
  PcbPlacement,
  PadReference,
} from "@/components/pcb-editor/pcb-types";
import type { InteractionEvent } from "../interaction/types";
import { Units } from "../coords";
import { createPcbAdapterSceneTransform } from "./pcb-adapter-transform";

const mockState = vi.hoisted(() => ({
  edaCanvasProps: null as Record<string, unknown> | null,
  gridShaderProps: [] as Array<Record<string, unknown>>,
  sceneProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/canvas-theme", () => ({
  useCanvasColors: () => ({
    background: "#020617",
    gridDot: "#475569",
    padFill: "#f59e0b",
    padSelectedStroke: "#38bdf8",
  }),
}));

vi.mock("../interaction/EdaCanvas", () => ({
  EdaCanvas: (props: Record<string, unknown>) => {
    mockState.edaCanvasProps = props;
    return (
      <div data-testid={String(props.testId ?? "pcb-canvas")}>
        {props.children as React.ReactNode}
      </div>
    );
  },
}));

vi.mock("../primitives/GridShader", () => ({
  GridShader: (props: Record<string, unknown>) => {
    mockState.gridShaderProps.push(props);
    return <div data-testid="grid-shader" />;
  },
}));

vi.mock("../scenes/PcbScene", () => ({
  PcbScene: (props: Record<string, unknown>) => {
    mockState.sceneProps.push(props);
    return <div data-testid="pcb-scene" />;
  },
}));

import { PcbCanvasR3F } from "./PcbCanvasR3F";

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
    reference: id.toUpperCase(),
    value: id.toUpperCase(),
    position: { x, y },
    rotation: 0,
    layer: "F.Cu",
    footprintData: createFootprint(),
  };
}

const TEST_DOCUMENT: PcbDocument = {
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
  placements: [createPlacement("u1", 20, 50), createPlacement("u2", 60, 50)],
  traces: [],
  vias: [],
  zones: [],
};

function resetStore() {
  usePcbStore.setState({
    document: structuredClone(TEST_DOCUMENT),
    ratsnest: [],
    routingSession: null,
    lastCursorPosition: null,
    viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
    activeLayer: "F.Cu",
    visibleLayers: new Set(["F.Cu", "B.Cu", "F.SilkS", "Edge.Cuts"]),
    gridSize: 0.5,
    selectedIds: new Set(),
    activeTool: "select",
  });
}

function getInteractionHandler() {
  const handler = mockState.edaCanvasProps?.interactionHandler as
    | {
        onPointerDown?: (event: InteractionEvent) => void;
        onPointerMove?: (event: InteractionEvent) => void;
      }
    | undefined;

  if (!handler) {
    throw new Error("Missing interaction handler");
  }

  return handler;
}

function createInteractionEvent(worldPoint: {
  x: number;
  y: number;
}): InteractionEvent {
  return {
    worldPoint,
    snappedPoint: worldPoint,
    screenPoint: { x: 50, y: 60 },
    modifiers: {
      shift: false,
      ctrl: false,
      meta: false,
      alt: false,
    },
    button: 0,
  };
}

function createStorePointEvent(pointMm: {
  x: number;
  y: number;
}): InteractionEvent {
  const transform = createPcbAdapterSceneTransform(TEST_DOCUMENT.boardOutline);
  return createInteractionEvent(transform.storePointToWorldPointNm(pointMm));
}

function startRouting() {
  const padRef: PadReference = { componentId: "u1", padNumber: "1" };
  act(() => {
    usePcbStore.getState().startRouting(padRef, { x: 20, y: 50 }, "F.Cu");
  });
}

describe("PcbCanvasR3F", () => {
  beforeEach(() => {
    mockState.edaCanvasProps = null;
    mockState.gridShaderProps = [];
    mockState.sceneProps = [];
    resetStore();
  });

  afterEach(() => {
    cleanup();
  });

  it("adapts PCB store state into EdaCanvas and scene props", () => {
    render(<PcbCanvasR3F />);

    expect(mockState.edaCanvasProps).toMatchObject({
      testId: "pcb-canvas",
      gridSize: Units.mmToNm(0.5),
      initialZoom: 4,
      backgroundColor: "#020617",
    });
    expect(mockState.gridShaderProps[0]).toMatchObject({
      gridSize: 0.5,
      visible: true,
      alpha: 0.25,
    });
    expect(mockState.sceneProps[0]).toMatchObject({
      document: expect.objectContaining({
        boardOutline: { width: 100, height: 100 },
      }),
      config: expect.objectContaining({ editable: true, activeLayer: "F.Cu" }),
    });
  });

  it("translates nm interaction points into snapped PCB millimeters", () => {
    startRouting();
    render(<PcbCanvasR3F />);

    const handler = getInteractionHandler();
    act(() => {
      handler.onPointerDown?.(createStorePointEvent({ x: 20.6, y: 50.4 }));
    });

    expect(usePcbStore.getState().routingSession).toMatchObject({
      startPoint: { x: 20.5, y: 50.5 },
      committedSegments: expect.any(Array),
    });
  });

  it("updates routing preview from nm world coordinates", () => {
    startRouting();
    render(<PcbCanvasR3F />);

    const handler = getInteractionHandler();
    act(() => {
      handler.onPointerMove?.(createStorePointEvent({ x: 21.1, y: 50.9 }));
    });

    expect(usePcbStore.getState().lastCursorPosition).toEqual({ x: 21, y: 51 });
    expect(
      usePcbStore.getState().routingSession?.previewSegments.length,
    ).toBeGreaterThan(0);
  });

  it("integrates PCB keyboard shortcuts for routing and selection", () => {
    render(<PcbCanvasR3F />);
    startRouting();

    fireEvent.keyDown(window, { key: "w" });
    expect(usePcbStore.getState().routingSession?.width).toBe(0.3);

    fireEvent.keyDown(window, { key: "f" });
    expect(usePcbStore.getState().routingSession?.elbowDirection).toBe(
      "vertical_first",
    );

    fireEvent.keyDown(window, { key: "v" });
    expect(usePcbStore.getState().routingSession?.committedVias.length).toBe(1);
    expect(usePcbStore.getState().activeLayer).toBe("B.Cu");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(usePcbStore.getState().routingSession).toBeNull();

    act(() => {
      usePcbStore.setState({ selectedIds: new Set(["u1"]) });
    });
    fireEvent.keyDown(window, { key: "Delete" });
    expect(
      usePcbStore
        .getState()
        .document?.placements.map((placement) => placement.id),
    ).toEqual(["u2"]);
  });
});
