import { act, fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePcbStore } from "@/stores/pcb-store";
import type { ParsedKicadFootprint } from "@/lib/api/component-api";
import { PcbCanvas } from "./PcbCanvas";
import { pcbToScreen } from "./pcb-viewport";
import type { PcbDocument, PcbPlacement, TraceSegment, Via } from "../pcb-types";

function createMockContext(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    setLineDash: vi.fn(),
    clearRect: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    closePath: vi.fn(),
    fillText: vi.fn(),
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    lineJoin: "round",
    lineCap: "round",
    globalAlpha: 1,
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
  } as unknown as CanvasRenderingContext2D;
}

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

function createDocument(): PcbDocument {
  const traces: TraceSegment[] = [
    {
      id: "trace-1",
      start: { x: 20, y: 50 },
      end: { x: 40, y: 50 },
      width: 0.25,
      layer: "F.Cu",
      net: "net-1",
    },
  ];
  const vias: Via[] = [
    {
      id: "via-1",
      position: { x: 40, y: 50 },
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
    placements: [createPlacement("u1", 20, 50), createPlacement("u2", 60, 50)],
    traces,
    vias,
    zones: [],
  };
}

function clickAt(canvas: HTMLElement, x: number, y: number, options?: { ctrlKey?: boolean; metaKey?: boolean }) {
  fireEvent.mouseDown(canvas, {
    button: 0,
    clientX: x,
    clientY: y,
    ctrlKey: options?.ctrlKey,
    metaKey: options?.metaKey,
  });
  fireEvent.mouseUp(canvas, { button: 0, clientX: x, clientY: y });
}

describe("PcbCanvas", () => {
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

    vi.restoreAllMocks();
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 0));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((
      ((contextId: string) =>
        contextId === "2d" ? createMockContext() : null) as unknown as HTMLCanvasElement["getContext"]
    ));
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          right: 800,
          bottom: 600,
          width: 800,
          height: 600,
          toJSON: () => ({}),
        }) as DOMRect,
    );
  });

  it("starts and completes a route by clicking source and target pads", () => {
    usePcbStore.setState({
      document: {
        ...createDocument(),
        traces: [],
        vias: [],
      },
      activeTool: "route",
    });

    const { getByTestId } = render(
      <div style={{ width: 800, height: 600 }}>
        <PcbCanvas />
      </div>,
    );
    const canvas = getByTestId("pcb-canvas");
    const viewport = usePcbStore.getState().viewport;
    const source = pcbToScreen(20, 50, viewport);
    const target = pcbToScreen(60, 50, viewport);

    act(() => {
      clickAt(canvas, source.x, source.y);
    });
    expect(usePcbStore.getState().routingSession).not.toBeNull();

    act(() => {
      clickAt(canvas, target.x, target.y);
    });

    const state = usePcbStore.getState();
    expect(state.routingSession).toBeNull();
    expect(state.document?.traces).toHaveLength(1);
    expect(state.document?.traces[0]).toMatchObject({
      start: { x: 20, y: 50 },
      end: { x: 60, y: 50 },
      layer: "F.Cu",
    });
  });

  it("supports additive trace and via selection through ctrl-click", () => {
    const { getByTestId } = render(
      <div style={{ width: 800, height: 600 }}>
        <PcbCanvas />
      </div>,
    );
    const canvas = getByTestId("pcb-canvas");
    const viewport = usePcbStore.getState().viewport;
    const tracePoint = pcbToScreen(30, 50, viewport);
    const viaPoint = pcbToScreen(40, 50, viewport);

    act(() => {
      clickAt(canvas, tracePoint.x, tracePoint.y);
      clickAt(canvas, viaPoint.x, viaPoint.y, { ctrlKey: true });
    });

    expect(Array.from(usePcbStore.getState().selectedIds).sort()).toEqual([
      "trace-1",
      "via-1",
    ]);
  });
});
