import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SchematicCanvas } from "./canvas/SchematicCanvas";
import { ComponentPalette } from "./palette/ComponentPalette";
import { useSchematicInteractionController } from "./useSchematicInteractionController";
import type { SchematicDocument } from "./types";
import { useSchematicStore } from "@/stores/schematic-store";

const TEST_DOCUMENT: SchematicDocument = {
  id: "doc-1",
  projectId: "project-1",
  updatedAt: "2026-03-31T00:00:00Z",
  version: 1,
  formatVersion: "pcb.schematic-project-document/v1",
  name: "Main schematic",
  revision: 1,
  symbols: [],
  wires: [],
  labels: [],
};

function createMockContext(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    rect: vi.fn(),
    arc: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    setLineDash: vi.fn(),
    clearRect: vi.fn(),
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    lineJoin: "round",
    lineCap: "round",
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
}

function createDataTransfer(): DataTransfer {
  const data = new Map<string, string>();

  return {
    dropEffect: "none",
    effectAllowed: "all",
    setData: (format: string, value: string) => {
      data.set(format, value);
    },
    getData: (format: string) => data.get(format) ?? "",
    clearData: (format?: string) => {
      if (format) {
        data.delete(format);
        return;
      }

      data.clear();
    },
    files: [] as unknown as FileList,
    items: [] as unknown as DataTransferItemList,
    types: [],
    setDragImage: vi.fn(),
  } as unknown as DataTransfer;
}

function dispatchDragEvent(
  target: Element,
  type: "dragstart" | "dragover" | "dragleave" | "drop" | "dragend",
  options: {
    dataTransfer: DataTransfer;
    clientX?: number;
    clientY?: number;
    relatedTarget?: EventTarget | null;
  },
) {
  const event = new Event(type, { bubbles: true, cancelable: true });

  Object.defineProperties(event, {
    dataTransfer: { value: options.dataTransfer },
    clientX: { value: options.clientX ?? 0 },
    clientY: { value: options.clientY ?? 0 },
    relatedTarget: { value: options.relatedTarget ?? null },
  });

  fireEvent(target, event);
}

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
      hitTestCache: {
        symbolBounds: {},
        connectorAnchors: {},
      },
    },
    chrome: {
      viewport: { offsetX: 0, offsetY: 0, zoom: 1 / 12_700 },
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

function PaletteCanvasHarness() {
  const controller = useSchematicInteractionController();

  return (
    <div>
      <ComponentPalette controller={controller} />
      <div style={{ width: 800, height: 600 }}>
        <SchematicCanvas controller={controller} />
      </div>
    </div>
  );
}

describe("palette drag placement", () => {
  beforeEach(() => {
    resetStore();

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
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => createMockContext(),
    );
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

  it("shows snapped ghost preview during palette drag and commits one symbol on drop", () => {
    const { container } = render(<PaletteCanvasHarness />);
    const resistorButton = screen.getByRole("button", { name: /resistor/i });
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    const canvasSurface = canvas?.parentElement;
    expect(canvasSurface).not.toBeNull();

    const dataTransfer = createDataTransfer();

    dispatchDragEvent(resistorButton, "dragstart", { dataTransfer });
    dispatchDragEvent(canvasSurface!, "dragover", {
      dataTransfer,
      clientX: 105,
      clientY: 205,
    });

    expect(useSchematicStore.getState().session).toMatchObject({
      type: "placement",
      symbolKind: "resistor",
      previewPosition: { x: 1_270_000, y: 2_540_000 },
    });

    dispatchDragEvent(canvasSurface!, "drop", {
      dataTransfer,
      clientX: 105,
      clientY: 205,
    });
    dispatchDragEvent(resistorButton, "dragend", { dataTransfer });

    const state = useSchematicStore.getState();
    expect(state.persisted.document?.symbols).toHaveLength(1);
    expect(state.persisted.document?.symbols[0]).toMatchObject({
      entityType: "symbol",
      symbolKind: "resistor",
      position: { x: 1_270_000, y: 2_540_000 },
    });
    expect(state.session).toBeNull();
  });

  it("does not create a symbol when the drag ends outside the canvas", () => {
    const { container } = render(<PaletteCanvasHarness />);
    const resistorButton = screen.getByRole("button", { name: /resistor/i });
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    const canvasSurface = canvas?.parentElement;
    expect(canvasSurface).not.toBeNull();

    const dataTransfer = createDataTransfer();

    dispatchDragEvent(resistorButton, "dragstart", { dataTransfer });
    dispatchDragEvent(canvasSurface!, "dragover", {
      dataTransfer,
      clientX: 105,
      clientY: 205,
    });
    dispatchDragEvent(canvasSurface!, "dragleave", {
      dataTransfer,
      relatedTarget: null,
    });
    dispatchDragEvent(resistorButton, "dragend", { dataTransfer });

    const state = useSchematicStore.getState();
    expect(state.persisted.document?.symbols).toHaveLength(0);
    expect(state.session).toBeNull();
  });

  it("keeps palette click placement working through the same placement session", () => {
    const { container } = render(<PaletteCanvasHarness />);
    const resistorButton = screen.getByRole("button", { name: /resistor/i });
    const canvas = container.querySelector("canvas") as HTMLCanvasElement;

    fireEvent.click(resistorButton);
    fireEvent.mouseMove(canvas, { clientX: 105, clientY: 205 });

    expect(useSchematicStore.getState().session).toMatchObject({
      type: "placement",
      symbolKind: "resistor",
      previewPosition: { x: 1_270_000, y: 2_540_000 },
    });

    fireEvent.mouseDown(canvas, { button: 0, clientX: 105, clientY: 205 });

    const state = useSchematicStore.getState();
    expect(state.persisted.document?.symbols).toHaveLength(1);
    expect(state.persisted.document?.symbols[0]).toMatchObject({
      symbolKind: "resistor",
      position: { x: 1_270_000, y: 2_540_000 },
    });
    expect(state.session).toBeNull();
  });
});
