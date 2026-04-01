import { act, fireEvent, render } from "@testing-library/react";
import { useEffect } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useSchematicStore } from "@/stores/schematic-store";
import { useSchematicInteractionController } from "../useSchematicInteractionController";
import type { SchematicDocument } from "../types";
import { createHitTestCache } from "./hit-test";
import { SchematicCanvas } from "./SchematicCanvas";
import { schematicToScreen, screenToSchematic, snapToGrid } from "./viewport";
import { buildOrthogonalWirePathWithWaypoints } from "./wires";

const TEST_DOCUMENT: SchematicDocument = {
  id: "doc-1",
  projectId: "project-1",
  updatedAt: "2026-03-31T00:00:00Z",
  version: 1,
  formatVersion: "pcb.schematic-project-document/v1",
  name: "Canvas wiring",
  revision: 1,
  symbols: [
    {
      id: "symbol-1",
      entityType: "symbol",
      symbolKind: "resistor",
      symbolTemplate: "resistor",
      reference: "R1",
      value: "10k",
      position: { x: 0, y: 0 },
      rotation: 0,
      mirrored: false,
      pins: [
        { id: "pin-1", name: "1", position: { x: 0, y: 0 } },
        { id: "pin-2", name: "2", position: { x: 1_270_000, y: 0 } },
      ],
      properties: {},
    },
    {
      id: "symbol-2",
      entityType: "symbol",
      symbolKind: "connector",
      symbolTemplate: "connector",
      reference: "J1",
      value: "HDR2",
      position: { x: 1_905_000, y: 635_000 },
      rotation: 0,
      mirrored: false,
      pins: [
        { id: "pin-3", name: "1", position: { x: 0, y: 635_000 } },
        { id: "pin-4", name: "2", position: { x: 0, y: -635_000 } },
      ],
      properties: {},
    },
  ],
  wires: [],
  labels: [],
};

const viewport = { offsetX: 0, offsetY: 0, zoom: 0.0001 };

function getSymbolBodyCenterScreen(symbolId: string) {
  const state = useSchematicStore.getState();
  const bounds = state.derived.hitTestCache.symbolBounds[symbolId];

  if (!bounds) {
    throw new Error(`Missing bounds for ${symbolId}`);
  }

  return schematicToScreen(
    (bounds.minX + bounds.maxX) / 2,
    (bounds.minY + bounds.maxY) / 2,
    state.chrome.viewport,
  );
}

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());

  vi.spyOn(
    HTMLDivElement.prototype,
    "getBoundingClientRect",
  ).mockImplementation(
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
  vi.spyOn(
    HTMLCanvasElement.prototype,
    "getBoundingClientRect",
  ).mockImplementation(
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
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((
    contextId: string,
  ) => {
    if (contextId !== "2d") {
      return null;
    }
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      scale: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      arc: vi.fn(),
      rect: vi.fn(),
      strokeRect: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      setLineDash: vi.fn(),
      closePath: vi.fn(),
      fillText: vi.fn(),
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      lineJoin: "round",
      lineCap: "round",
      globalAlpha: 1,
      font: "",
      textAlign: "start",
      textBaseline: "alphabetic",
    };

    return context as unknown as CanvasRenderingContext2D;
  }) as unknown as HTMLCanvasElement["getContext"]);
});

function resetStore() {
  useSchematicStore.setState((state) => ({
    ...state,
    persisted: {
      document: TEST_DOCUMENT,
      projectId: "project-1",
      sheetId: "sheet-1",
    },
    derived: {
      connectivity: null,
      documentBounds: null,
      hitTestCache: createHitTestCache(TEST_DOCUMENT.symbols),
    },
    chrome: {
      viewport,
      selectedEntityIds: new Set(),
      activeTool: "select",
      popoverEntityId: null,
      gridSize: 1_270_000,
      showGrid: true,
      placementRotation: 0,
      gridPresetId: "small",
    },
    session: null,
  }));
}

function getCanvas(container: HTMLElement): HTMLCanvasElement {
  const canvas = container.querySelector("canvas");

  if (!canvas) {
    throw new Error("canvas missing");
  }

  return canvas;
}

function beginWireAt(
  canvas: HTMLCanvasElement,
  point: { x: number; y: number },
) {
  fireEvent.mouseDown(canvas, {
    button: 0,
    clientX: point.x,
    clientY: point.y,
  });
}

function clickCanvasPoint(
  canvas: HTMLCanvasElement,
  point: { x: number; y: number },
) {
  fireEvent.mouseDown(canvas, {
    button: 0,
    clientX: point.x,
    clientY: point.y,
  });
}

function moveCanvasPoint(
  canvas: HTMLCanvasElement,
  point: { x: number; y: number },
) {
  fireEvent.mouseMove(canvas, {
    clientX: point.x,
    clientY: point.y,
  });
}

function normalizeCoordinate(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function normalizePoints(points: Array<{ x: number; y: number }>) {
  return points.map((point) => ({
    x: normalizeCoordinate(point.x),
    y: normalizeCoordinate(point.y),
  }));
}

function EscapeCancelableCanvas() {
  const controller = useSchematicInteractionController();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        controller.cancelSession();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [controller]);

  return <SchematicCanvas controller={controller} />;
}

describe("SchematicCanvas wiring flow", () => {
  beforeEach(() => {
    resetStore();
  });

  it("selects on click without starting a drag", () => {
    const { container } = render(<SchematicCanvas />);
    const canvas = getCanvas(container);
    const start = getSymbolBodyCenterScreen("symbol-1");

    fireEvent.mouseDown(canvas, {
      button: 0,
      clientX: start.x,
      clientY: start.y,
    });
    fireEvent.mouseUp(canvas, {
      button: 0,
      clientX: start.x,
      clientY: start.y,
    });

    const state = useSchematicStore.getState();
    expect(state.chrome.selectedEntityIds).toEqual(new Set(["symbol-1"]));
    expect(state.session).toBeNull();
    expect(state.persisted.document?.symbols).toEqual([
      expect.objectContaining({ id: "symbol-1", position: { x: 0, y: 0 } }),
      expect.objectContaining({
        id: "symbol-2",
        position: { x: 1_905_000, y: 635_000 },
      }),
    ]);
  });

  it("moves a symbol after dragging beyond the threshold", () => {
    const { container } = render(<SchematicCanvas />);
    const canvas = getCanvas(container);
    const start = getSymbolBodyCenterScreen("symbol-1");

    fireEvent.mouseDown(canvas, {
      button: 0,
      clientX: start.x,
      clientY: start.y,
    });
    fireEvent.mouseMove(canvas, {
      clientX: start.x + 10,
      clientY: start.y,
    });
    fireEvent.mouseMove(canvas, {
      clientX: start.x + 140,
      clientY: start.y,
    });
    fireEvent.mouseUp(canvas, {
      button: 0,
      clientX: start.x + 140,
      clientY: start.y,
    });

    const state = useSchematicStore.getState();
    expect(state.chrome.selectedEntityIds).toEqual(new Set(["symbol-1"]));
    expect(state.session).toBeNull();
    expect(state.persisted.document?.symbols).toEqual([
      expect.objectContaining({
        id: "symbol-1",
        position: { x: 1_270_000, y: 0 },
      }),
      expect.objectContaining({
        id: "symbol-2",
        position: { x: 1_905_000, y: 635_000 },
      }),
    ]);
  });

  it("moves all selected symbols when dragging a multi-selection", () => {
    const { container } = render(<SchematicCanvas />);
    const canvas = getCanvas(container);
    const symbol1Start = getSymbolBodyCenterScreen("symbol-1");
    const symbol2Start = getSymbolBodyCenterScreen("symbol-2");

    fireEvent.mouseDown(canvas, {
      button: 0,
      clientX: symbol1Start.x,
      clientY: symbol1Start.y,
    });
    fireEvent.mouseUp(canvas, {
      button: 0,
      clientX: symbol1Start.x,
      clientY: symbol1Start.y,
    });
    fireEvent.mouseDown(canvas, {
      button: 0,
      clientX: symbol2Start.x,
      clientY: symbol2Start.y,
      ctrlKey: true,
    });
    fireEvent.mouseUp(canvas, {
      button: 0,
      clientX: symbol2Start.x,
      clientY: symbol2Start.y,
      ctrlKey: true,
    });

    expect(useSchematicStore.getState().chrome.selectedEntityIds).toEqual(
      new Set(["symbol-1", "symbol-2"]),
    );

    fireEvent.mouseDown(canvas, {
      button: 0,
      clientX: symbol2Start.x,
      clientY: symbol2Start.y,
    });
    fireEvent.mouseMove(canvas, {
      clientX: symbol2Start.x + 10,
      clientY: symbol2Start.y,
    });
    fireEvent.mouseMove(canvas, {
      clientX: symbol2Start.x + 140,
      clientY: symbol2Start.y,
    });
    fireEvent.mouseUp(canvas, {
      button: 0,
      clientX: symbol2Start.x + 140,
      clientY: symbol2Start.y,
    });

    const state = useSchematicStore.getState();
    expect(state.chrome.selectedEntityIds).toEqual(
      new Set(["symbol-1", "symbol-2"]),
    );
    expect(state.session).toBeNull();
    expect(state.persisted.document?.symbols).toEqual([
      expect.objectContaining({
        id: "symbol-1",
        position: { x: 1_270_000, y: 0 },
      }),
      expect.objectContaining({
        id: "symbol-2",
        position: { x: 3_175_000, y: 635_000 },
      }),
    ]);
  });

  it("adds a snapped waypoint when clicking canvas during a wire session", () => {
    const { container } = render(<SchematicCanvas />);
    const canvas = getCanvas(container);
    const activeViewport = useSchematicStore.getState().chrome.viewport;
    const gridSize = useSchematicStore.getState().chrome.gridSize;
    const source = schematicToScreen(1_270_000, 0, activeViewport);
    const waypointBase = schematicToScreen(
      2_540_000,
      1_270_000,
      activeViewport,
    );
    const waypointClick = { x: waypointBase.x + 11, y: waypointBase.y - 9 };
    const expectedWaypoint = snapToGrid(
      screenToSchematic(waypointClick.x, waypointClick.y, activeViewport),
      gridSize,
    );

    beginWireAt(canvas, source);
    clickCanvasPoint(canvas, waypointClick);

    expect(useSchematicStore.getState().session).toMatchObject({
      type: "wire",
      sourcePinId: "pin-2",
      waypoints: [expectedWaypoint],
    });
  });

  it("builds preview paths through multiple waypoints", () => {
    const { container } = render(<SchematicCanvas />);
    const canvas = getCanvas(container);
    const activeViewport = useSchematicStore.getState().chrome.viewport;
    const gridSize = useSchematicStore.getState().chrome.gridSize;
    const source = schematicToScreen(1_270_000, 0, activeViewport);
    const firstWaypointBase = schematicToScreen(
      2_540_000,
      1_270_000,
      activeViewport,
    );
    const secondWaypointBase = schematicToScreen(
      3_810_000,
      2_540_000,
      activeViewport,
    );
    const previewCursor = schematicToScreen(
      4_445_000,
      1_905_000,
      activeViewport,
    );
    const firstWaypointClick = {
      x: firstWaypointBase.x + 11,
      y: firstWaypointBase.y - 9,
    };
    const secondWaypointClick = {
      x: secondWaypointBase.x - 12,
      y: secondWaypointBase.y + 8,
    };
    const firstWaypoint = snapToGrid(
      screenToSchematic(
        firstWaypointClick.x,
        firstWaypointClick.y,
        activeViewport,
      ),
      gridSize,
    );
    const secondWaypoint = snapToGrid(
      screenToSchematic(
        secondWaypointClick.x,
        secondWaypointClick.y,
        activeViewport,
      ),
      gridSize,
    );

    beginWireAt(canvas, source);
    clickCanvasPoint(canvas, firstWaypointClick);
    clickCanvasPoint(canvas, secondWaypointClick);
    moveCanvasPoint(canvas, previewCursor);

    const session = useSchematicStore.getState().session;
    expect(session).toMatchObject({
      type: "wire",
      sourcePinId: "pin-2",
      waypoints: [firstWaypoint, secondWaypoint],
      targetPinId: null,
    });
    expect(session?.type).toBe("wire");
    expect(
      normalizePoints(session?.type === "wire" ? session.previewPoints : []),
    ).toEqual(
      normalizePoints(
        buildOrthogonalWirePathWithWaypoints(
          { x: 1_270_000, y: 0 },
          [firstWaypoint, secondWaypoint],
          screenToSchematic(previewCursor.x, previewCursor.y, activeViewport),
        ),
      ),
    );
  });

  it("completes a wire on a different connector using accumulated waypoints", () => {
    const { container } = render(<SchematicCanvas />);
    const canvas = getCanvas(container);
    const activeViewport = useSchematicStore.getState().chrome.viewport;
    const gridSize = useSchematicStore.getState().chrome.gridSize;
    const source = schematicToScreen(1_270_000, 0, activeViewport);
    const firstWaypointBase = schematicToScreen(
      2_540_000,
      1_270_000,
      activeViewport,
    );
    const secondWaypointBase = schematicToScreen(
      3_810_000,
      2_540_000,
      activeViewport,
    );
    const firstWaypointClick = {
      x: firstWaypointBase.x + 11,
      y: firstWaypointBase.y - 9,
    };
    const secondWaypointClick = {
      x: secondWaypointBase.x - 12,
      y: secondWaypointBase.y + 8,
    };
    const target = schematicToScreen(1_905_000, 1_270_000, activeViewport);
    const firstWaypoint = snapToGrid(
      screenToSchematic(
        firstWaypointClick.x,
        firstWaypointClick.y,
        activeViewport,
      ),
      gridSize,
    );
    const secondWaypoint = snapToGrid(
      screenToSchematic(
        secondWaypointClick.x,
        secondWaypointClick.y,
        activeViewport,
      ),
      gridSize,
    );

    beginWireAt(canvas, source);
    clickCanvasPoint(canvas, firstWaypointClick);
    clickCanvasPoint(canvas, secondWaypointClick);
    moveCanvasPoint(canvas, target);
    clickCanvasPoint(canvas, target);

    const wire = useSchematicStore.getState().persisted.document?.wires[0];

    expect(useSchematicStore.getState().session).toBeNull();
    expect(wire).toMatchObject({
      sourcePinId: "pin-2",
      targetPinId: "pin-3",
    });
    expect(normalizePoints(wire?.points ?? [])).toEqual(
      normalizePoints(
        buildOrthogonalWirePathWithWaypoints(
          { x: 1_270_000, y: 0 },
          [firstWaypoint, secondWaypoint],
          { x: 1_905_000, y: 1_270_000 },
        ),
      ),
    );
  });

  it("cancels a waypoint wire session on Escape without mutating wires", () => {
    const { container } = render(<EscapeCancelableCanvas />);
    const canvas = getCanvas(container);
    const activeViewport = useSchematicStore.getState().chrome.viewport;
    const source = schematicToScreen(1_270_000, 0, activeViewport);
    const waypointBase = schematicToScreen(
      2_540_000,
      1_270_000,
      activeViewport,
    );
    const waypointClick = { x: waypointBase.x + 11, y: waypointBase.y - 9 };
    const wireCountBefore =
      useSchematicStore.getState().persisted.document?.wires.length;

    beginWireAt(canvas, source);
    clickCanvasPoint(canvas, waypointClick);

    expect(useSchematicStore.getState().session).toMatchObject({
      type: "wire",
      waypoints: [expect.any(Object)],
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(useSchematicStore.getState().session).toBeNull();
    expect(useSchematicStore.getState().persisted.document?.wires).toHaveLength(
      wireCountBefore ?? 0,
    );
  });
});
