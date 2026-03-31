import { fireEvent, render } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicDocument } from "../types";
import { schematicToScreen } from "./viewport";
import { createHitTestCache } from "./hit-test";
import { SchematicCanvas } from "./SchematicCanvas";
import { useSchematicStore } from "@/stores/schematic-store";

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

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());

  vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockImplementation(
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
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockImplementation(
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
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
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
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
      lineJoin: "round",
      lineCap: "round",
      globalAlpha: 1,
    };

    return context as unknown as CanvasRenderingContext2D;
  });
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
    },
    session: null,
  }));
}

describe("SchematicCanvas wiring flow", () => {
  beforeEach(() => {
    resetStore();
  });

  it("starts preview on connector click, ignores empty clicks, and commits on second connector", () => {
    const { container } = render(<SchematicCanvas />);
    const canvas = container.querySelector("canvas");

    if (!canvas) {
      throw new Error("canvas missing");
    }

    const source = schematicToScreen(1_270_000, 0, viewport);
    const hoverPoint = { x: 160, y: 90 };
    const target = schematicToScreen(1_905_000, 1_270_000, viewport);

    fireEvent.mouseDown(canvas, {
      button: 0,
      clientX: source.x,
      clientY: source.y,
    });

    expect(useSchematicStore.getState().session).toMatchObject({
      type: "wire",
      sourcePinId: "pin-2",
    });

    fireEvent.mouseMove(canvas, {
      clientX: hoverPoint.x,
      clientY: hoverPoint.y,
    });

    expect(useSchematicStore.getState().session).toMatchObject({
      type: "wire",
      previewPoints: [
        { x: 1_270_000, y: 0 },
        { x: 1_600_000, y: 0 },
        { x: 1_600_000, y: 900_000 },
      ],
      targetPinId: null,
    });

    fireEvent.mouseDown(canvas, {
      button: 0,
      clientX: hoverPoint.x,
      clientY: hoverPoint.y,
    });

    expect(useSchematicStore.getState().persisted.document?.wires).toHaveLength(0);
    expect(useSchematicStore.getState().session).toMatchObject({ type: "wire" });

    fireEvent.mouseMove(canvas, {
      clientX: target.x,
      clientY: target.y,
    });
    fireEvent.mouseDown(canvas, {
      button: 0,
      clientX: target.x,
      clientY: target.y,
    });

    expect(useSchematicStore.getState().session).toBeNull();
    expect(useSchematicStore.getState().persisted.document?.wires).toEqual([
      expect.objectContaining({
        sourcePinId: "pin-2",
        targetPinId: "pin-3",
        points: [
          { x: 1_270_000, y: 0 },
          { x: 1_905_000, y: 0 },
          { x: 1_905_000, y: 1_270_000 },
        ],
      }),
    ]);
  });
});
