import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSymbolEditorStore } from "@/components/symbol-editor/symbol-editor-store";
import { PIN_DRAG_MIME } from "@/components/symbol-editor/types";
import { Units } from "../coords";
import type { DragDropEvent, InteractionEvent } from "../interaction/types";

const mockState = vi.hoisted(() => ({
  edaCanvasProps: null as Record<string, unknown> | null,
  gridShaderProps: [] as Array<Record<string, unknown>>,
  symbolBodyProps: [] as Array<Record<string, unknown>>,
  pinDotsProps: [] as Array<Record<string, unknown>>,
  textProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/canvas-theme", () => ({
  useCanvasColors: () => ({
    background: "#0f172a",
    gridDot: "#334155",
    originCross: "#f97316",
    bodyStroke: "#e2e8f0",
    bodyFill: "#0b1120",
    pinDot: "#94a3b8",
    pinConnected: "#22c55e",
    pinLabel: "#cbd5e1",
    selectionStroke: "#38bdf8",
  }),
}));

vi.mock("../interaction/EdaCanvas", () => ({
  EdaCanvas: (props: Record<string, unknown>) => {
    mockState.edaCanvasProps = props;
    return (
      <div data-testid={String(props.testId ?? "symbol-editor-canvas")}>
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

vi.mock("../primitives/SymbolBody", () => ({
  SymbolBody: (props: Record<string, unknown>) => {
    mockState.symbolBodyProps.push(props);
    return <div data-testid="symbol-body" />;
  },
}));

vi.mock("../primitives/PinDots", () => ({
  PinDots: (props: Record<string, unknown>) => {
    mockState.pinDotsProps.push(props);
    return <div data-testid="pin-dots" />;
  },
}));

vi.mock("../primitives/EDAText", () => ({
  EDAText: (props: Record<string, unknown>) => {
    mockState.textProps.push(props);
    return (
      <div data-testid="eda-text">{props.children as React.ReactNode}</div>
    );
  },
}));

import { SymbolEditorCanvasR3F } from "./SymbolEditorCanvasR3F";

function resetStore() {
  useSymbolEditorStore.getState().resetDraft("symbol-test");
  useSymbolEditorStore.setState((state) => ({
    ...state,
    chrome: {
      ...state.chrome,
      gridSize: Units.mmToNm(2.54),
      showGrid: true,
      activeTool: "select",
      selection: {
        selectedPinIds: new Set(),
        selectedGraphicIds: new Set(),
      },
    },
  }));
}

function getInteractionHandler() {
  const handler = mockState.edaCanvasProps?.interactionHandler as
    | {
        onPointerDown?: (event: InteractionEvent) => void;
        onPointerMove?: (event: InteractionEvent) => void;
        onPointerUp?: (event: InteractionEvent) => void;
        onDrop?: (event: DragDropEvent) => void;
      }
    | undefined;
  if (!handler) throw new Error("Missing interaction handler");
  return handler;
}

function createInteractionEvent(point: {
  x: number;
  y: number;
}): InteractionEvent {
  return {
    worldPoint: point,
    snappedPoint: point,
    screenPoint: { x: 100, y: 120 },
    modifiers: { shift: false, ctrl: false, meta: false, alt: false },
    button: 0,
  };
}

describe("SymbolEditorCanvasR3F", () => {
  beforeEach(() => {
    mockState.edaCanvasProps = null;
    mockState.gridShaderProps = [];
    mockState.symbolBodyProps = [];
    mockState.pinDotsProps = [];
    mockState.textProps = [];
    resetStore();
  });

  afterEach(() => {
    cleanup();
  });

  it("integrates with EdaCanvas and grid shader", () => {
    useSymbolEditorStore.getState().addPin({
      id: "pin-1",
      name: "A",
      number: "1",
      electricalType: "input",
      side: "left",
      position: { x: 0, y: 0 },
      length: Units.mmToNm(2.54),
    });

    render(<SymbolEditorCanvasR3F />);

    expect(mockState.edaCanvasProps).toMatchObject({
      testId: "symbol-editor-canvas",
      gridSize: Units.mmToNm(2.54),
      enableDragDrop: true,
      backgroundColor: "#0f172a",
    });
    expect(
      (
        mockState.edaCanvasProps?.interactionCoordinateTransform as {
          scenePointToWorldPoint: (point: { x: number; y: number }) => {
            x: number;
            y: number;
          };
        }
      ).scenePointToWorldPoint({ x: 1.25, y: -0.5 }),
    ).toEqual({ x: 1_250_000, y: -500_000 });
    expect(mockState.gridShaderProps[0]).toMatchObject({
      visible: true,
      alpha: 0.3,
    });
    expect(mockState.pinDotsProps[0]).toMatchObject({
      pins: [{ id: "pin-1", x: 0, y: 0, connected: false }],
    });
  });

  it("previews and commits line, rect, and circle drawings", () => {
    render(<SymbolEditorCanvasR3F />);

    act(() => {
      useSymbolEditorStore.getState().setTool("line");
    });
    act(() => {
      getInteractionHandler().onPointerDown?.(
        createInteractionEvent({ x: 100_000, y: 100_000 }),
      );
      getInteractionHandler().onPointerMove?.(
        createInteractionEvent({ x: 1_300_000, y: 100_000 }),
      );
    });
    expect(mockState.symbolBodyProps.at(-1)?.graphics).toHaveLength(1);
    act(() => {
      getInteractionHandler().onPointerUp?.(
        createInteractionEvent({ x: 1_300_000, y: 100_000 }),
      );
    });
    expect(useSymbolEditorStore.getState().draft.graphics.at(-1)?.type).toBe(
      "line",
    );

    act(() => {
      useSymbolEditorStore.getState().setTool("rect");
      getInteractionHandler().onPointerDown?.(
        createInteractionEvent({ x: 0, y: 0 }),
      );
      getInteractionHandler().onPointerMove?.(
        createInteractionEvent({ x: 2_540_000, y: 2_540_000 }),
      );
      getInteractionHandler().onPointerUp?.(
        createInteractionEvent({ x: 2_540_000, y: 2_540_000 }),
      );
    });
    expect(useSymbolEditorStore.getState().draft.graphics.at(-1)?.type).toBe(
      "rect",
    );

    act(() => {
      useSymbolEditorStore.getState().setTool("circle");
      getInteractionHandler().onPointerDown?.(
        createInteractionEvent({ x: 0, y: 0 }),
      );
      getInteractionHandler().onPointerMove?.(
        createInteractionEvent({ x: 2_540_000, y: 0 }),
      );
      getInteractionHandler().onPointerUp?.(
        createInteractionEvent({ x: 2_540_000, y: 0 }),
      );
    });
    expect(useSymbolEditorStore.getState().draft.graphics.at(-1)?.type).toBe(
      "circle",
    );
    expect(useSymbolEditorStore.getState().draft.graphics).toHaveLength(3);
  });

  it("supports pin placement, pin drag, graphic drag, and grid snapping", () => {
    render(<SymbolEditorCanvasR3F />);

    act(() => {
      getInteractionHandler().onDrop?.({
        worldPoint: { x: 1_600_000, y: 700_000 },
        snappedPoint: { x: 1_600_000, y: 700_000 },
        types: [PIN_DRAG_MIME],
        getData: () =>
          JSON.stringify({ electricalType: "output", defaultSide: "right" }),
        dropEffect: "copy",
      });
    });

    const addedPin = useSymbolEditorStore.getState().draft.pins[0]!;
    expect(addedPin.position).toEqual({ x: 2_540_000, y: 0 });

    act(() => {
      getInteractionHandler().onPointerDown?.(
        createInteractionEvent({ x: 2_540_000, y: 0 }),
      );
      getInteractionHandler().onPointerMove?.(
        createInteractionEvent({ x: 5_000_000, y: 2_600_000 }),
      );
      getInteractionHandler().onPointerUp?.(
        createInteractionEvent({ x: 5_000_000, y: 2_600_000 }),
      );
    });
    expect(useSymbolEditorStore.getState().draft.pins[0]!.position).toEqual({
      x: 5_080_000,
      y: 2_540_000,
    });

    act(() => {
      useSymbolEditorStore.getState().addGraphic({
        id: "rect-1",
        zIndex: 0,
        type: "rect",
        x: 0,
        y: 0,
        width: 2_540_000,
        height: 2_540_000,
        filled: false,
        strokeWidth: 254_000,
      });
    });

    act(() => {
      getInteractionHandler().onPointerDown?.(
        createInteractionEvent({ x: 100_000, y: 100_000 }),
      );
      getInteractionHandler().onPointerMove?.(
        createInteractionEvent({ x: 2_600_000, y: 2_600_000 }),
      );
      getInteractionHandler().onPointerUp?.(
        createInteractionEvent({ x: 2_600_000, y: 2_600_000 }),
      );
    });
    const movedGraphic = useSymbolEditorStore
      .getState()
      .draft.graphics.find((graphic) => graphic.id === "rect-1");
    expect(movedGraphic).toMatchObject({ x: 2_540_000, y: 2_540_000 });
  });

  it("integrates delete, undo, and redo shortcuts", () => {
    render(<SymbolEditorCanvasR3F />);

    act(() => {
      useSymbolEditorStore.getState().addPin({
        id: "pin-1",
        name: "A",
        number: "1",
        electricalType: "input",
        side: "left",
        position: { x: 0, y: 0 },
        length: Units.mmToNm(2.54),
      });
      useSymbolEditorStore.getState().selectPin("pin-1");
    });

    fireEvent.keyDown(window, { key: "Delete" });
    expect(useSymbolEditorStore.getState().draft.pins).toHaveLength(0);

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(useSymbolEditorStore.getState().draft.pins).toHaveLength(1);

    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(useSymbolEditorStore.getState().draft.pins).toHaveLength(0);
  });

  it("selects graphics without polluting history and restores them with undo after delete", () => {
    act(() => {
      useSymbolEditorStore.getState().addGraphic({
        id: "rect-1",
        zIndex: 0,
        type: "rect",
        x: -1_270_000,
        y: -1_270_000,
        width: 2_540_000,
        height: 2_540_000,
        filled: false,
        strokeWidth: 254_000,
      });
    });

    render(<SymbolEditorCanvasR3F />);

    const historyBeforeSelection =
      useSymbolEditorStore.getState().history.past.length;

    act(() => {
      getInteractionHandler().onPointerDown?.(
        createInteractionEvent({ x: 0, y: 0 }),
      );
      getInteractionHandler().onPointerUp?.(
        createInteractionEvent({ x: 0, y: 0 }),
      );
    });

    expect(
      Array.from(
        useSymbolEditorStore.getState().chrome.selection.selectedGraphicIds,
      ),
    ).toEqual(["rect-1"]);
    expect(useSymbolEditorStore.getState().history.past).toHaveLength(
      historyBeforeSelection,
    );

    fireEvent.keyDown(window, { key: "Delete" });
    expect(useSymbolEditorStore.getState().draft.graphics).toHaveLength(0);

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(useSymbolEditorStore.getState().draft.graphics).toHaveLength(1);
    expect(useSymbolEditorStore.getState().draft.graphics[0]?.id).toBe(
      "rect-1",
    );
  });
});
