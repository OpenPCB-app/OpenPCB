import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHitTestCache } from "@/components/pcb/canvas/hit-test";
import { PALETTE_SYMBOL_KIND_MIME } from "@/components/pcb/symbol-library";
import type { InteractionEvent, DragDropEvent } from "../interaction/types";
import { useSchematicStore } from "@/stores/schematic-store";
import type { SchematicDocument } from "@/components/pcb/types";

const mockState = vi.hoisted(() => ({
  edaCanvasProps: null as Record<string, unknown> | null,
  gridShaderProps: [] as Array<Record<string, unknown>>,
  sceneProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/canvas-theme", () => ({
  useCanvasColors: () => ({
    background: "#111827",
    gridDot: "#334155",
    originCross: "#f97316",
    bodyStroke: "#e2e8f0",
    bodyFill: "#020617",
    selectionStroke: "#38bdf8",
    pinDot: "#94a3b8",
    pinConnected: "#22c55e",
    pinLabel: "#cbd5e1",
  }),
}));

vi.mock("../interaction/EdaCanvas", () => ({
  EdaCanvas: (props: Record<string, unknown>) => {
    mockState.edaCanvasProps = props;
    return (
      <div data-testid={String(props.testId ?? "schematic-canvas")}>
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

vi.mock("../scenes/SchematicScene", () => ({
  SchematicScene: (props: Record<string, unknown>) => {
    mockState.sceneProps.push(props);
    return <div data-testid="schematic-scene" />;
  },
}));

import { SchematicCanvasR3F } from "./SchematicCanvasR3F";

const TEST_DOCUMENT: SchematicDocument = {
  id: "schematic-doc-1",
  projectId: "project-1",
  updatedAt: "2026-03-31T00:00:00Z",
  version: 1,
  formatVersion: "pcb.schematic-project-document/v1",
  name: "Wrapper schematic",
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

function resetStore() {
  useSchematicStore.setState((state) => ({
    ...state,
    persisted: {
      document: structuredClone(TEST_DOCUMENT),
      projectId: "project-1",
      designId: TEST_DOCUMENT.id,
    },
    derived: {
      connectivity: null,
      documentBounds: null,
      hitTestCache: createHitTestCache(TEST_DOCUMENT.symbols),
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
    draggedSymbolKind: null,
  }));
}

function getInteractionHandler() {
  const handler = mockState.edaCanvasProps?.interactionHandler as
    | {
        onPointerDown?: (event: InteractionEvent) => void;
        onPointerMove?: (event: InteractionEvent) => void;
        onPointerUp?: (event: InteractionEvent) => void;
        onDragEnter?: (event: DragDropEvent) => void;
        onDrop?: (event: DragDropEvent) => void;
      }
    | undefined;

  if (!handler) {
    throw new Error("Missing interaction handler");
  }

  return handler;
}

function createInteractionEvent(
  worldPoint: { x: number; y: number },
  overrides: Partial<InteractionEvent> = {},
): InteractionEvent {
  return {
    worldPoint,
    snappedPoint: worldPoint,
    screenPoint: { x: 100, y: 100 },
    modifiers: {
      shift: false,
      ctrl: false,
      meta: false,
      alt: false,
    },
    button: 0,
    ...overrides,
  };
}

function createDragEvent(
  snappedPoint: { x: number; y: number },
  overrides: Partial<DragDropEvent> = {},
): DragDropEvent {
  return {
    worldPoint: snappedPoint,
    snappedPoint,
    types: [],
    getData: () => "",
    dropEffect: "copy",
    ...overrides,
  };
}

describe("SchematicCanvasR3F", () => {
  beforeEach(() => {
    mockState.edaCanvasProps = null;
    mockState.gridShaderProps = [];
    mockState.sceneProps = [];
    resetStore();
    window.history.pushState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
  });

  it("adapts store state into EdaCanvas and scene props", () => {
    render(<SchematicCanvasR3F />);

    expect(mockState.edaCanvasProps).toMatchObject({
      testId: "schematic-canvas",
      gridSize: 1_270_000,
      enableDragDrop: true,
      backgroundColor: "#111827",
    });
    expect(mockState.gridShaderProps[0]).toMatchObject({
      gridSize: 1.27,
      visible: true,
      alpha: 0.3,
    });
    expect(mockState.sceneProps[0]).toMatchObject({
      document: expect.objectContaining({ id: TEST_DOCUMENT.id }),
      config: expect.objectContaining({ editable: true, gridSize: 1_270_000 }),
    });
  });

  it("handles placement, wiring, and selection pointer flows", () => {
    render(<SchematicCanvasR3F />);

    act(() => {
      useSchematicStore.getState().beginPlacement("gnd");
    });
    act(() => {
      getInteractionHandler().onPointerDown?.(
        createInteractionEvent({ x: 1_600_000, y: 700_000 }),
      );
    });

    const positions =
      useSchematicStore
        .getState()
        .persisted.document?.symbols.map((symbol) => symbol.position) ?? [];
    expect(positions).toContainEqual({ x: 1_270_000, y: 1_270_000 });

    act(() => {
      useSchematicStore.getState().activateTool("wire");
    });
    act(() => {
      getInteractionHandler().onPointerDown?.(
        createInteractionEvent({ x: 1_270_000, y: 0 }),
      );
    });
    expect(useSchematicStore.getState().session).toMatchObject({
      type: "wire",
      sourcePinId: "pin-2",
    });

    act(() => {
      getInteractionHandler().onPointerMove?.(
        createInteractionEvent({ x: 1_905_000, y: 1_270_000 }),
      );
    });
    expect(useSchematicStore.getState().session).toMatchObject({
      type: "wire",
      previewPoints: expect.any(Array),
    });

    act(() => {
      useSchematicStore.getState().cancelSession();
      useSchematicStore.getState().activateTool("select");
    });
    act(() => {
      getInteractionHandler().onPointerDown?.(
        createInteractionEvent({ x: 635_000, y: 0 }),
      );
    });
    expect([...useSchematicStore.getState().chrome.selectedEntityIds]).toEqual([
      "symbol-1",
    ]);
  });

  it("applies grid snapping for drag-drop symbol placement", () => {
    render(<SchematicCanvasR3F />);

    act(() => {
      getInteractionHandler().onDragEnter?.(
        createDragEvent(
          { x: 1_270_000, y: 2_540_000 },
          {
            types: [PALETTE_SYMBOL_KIND_MIME],
            getData: (mime) => (mime === PALETTE_SYMBOL_KIND_MIME ? "gnd" : ""),
          },
        ),
      );
    });

    expect(useSchematicStore.getState().session).toMatchObject({
      type: "placement",
      symbolKind: "gnd",
      previewPosition: { x: 1_270_000, y: 2_540_000 },
    });

    act(() => {
      getInteractionHandler().onDrop?.(
        createDragEvent(
          { x: 2_540_000, y: 2_540_000 },
          {
            types: [PALETTE_SYMBOL_KIND_MIME],
          },
        ),
      );
    });

    const positions =
      useSchematicStore
        .getState()
        .persisted.document?.symbols.map((symbol) => symbol.position) ?? [];
    expect(positions).toContainEqual({ x: 2_540_000, y: 2_540_000 });
  });

  it("integrates keyboard shortcuts for tool toggles, cancel, and delete", () => {
    render(<SchematicCanvasR3F />);

    fireEvent.keyDown(window, { key: "w" });
    expect(useSchematicStore.getState().chrome.activeTool).toBe("wire");

    act(() => {
      useSchematicStore.getState().beginPlacement("gnd");
    });
    fireEvent.keyDown(window, { key: "r" });
    expect(useSchematicStore.getState().session).toMatchObject({
      type: "placement",
      rotation: 90,
    });

    fireEvent.keyDown(window, { key: "Escape" });
    expect(useSchematicStore.getState().session).toBeNull();

    act(() => {
      useSchematicStore.getState().selectEntities(["symbol-2"]);
    });
    fireEvent.keyDown(window, { key: "Delete" });
    expect(
      useSchematicStore
        .getState()
        .persisted.document?.symbols.map((symbol) => symbol.id),
    ).toEqual(["symbol-1"]);
  });
});
