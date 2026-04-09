import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFootprintEditorStore } from "@/components/footprint-editor/footprint-editor-store";

const mockState = vi.hoisted(() => ({
  edaCanvasProps: null as Record<string, unknown> | null,
  gridShaderProps: [] as Array<Record<string, unknown>>,
  padInstancesProps: [] as Array<Record<string, unknown>>,
  textProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/canvas-theme", () => ({
  useCanvasColors: () => ({
    background: "#111827",
    gridDot: "#475569",
    originCross: "#f97316",
    padFill: "#f59e0b",
    padSelectedStroke: "#38bdf8",
    padNumber: "#e2e8f0",
  }),
}));

vi.mock("@/editor-canvas/interaction", () => ({
  EdaCanvas: (props: Record<string, unknown>) => {
    mockState.edaCanvasProps = props;
    return (
      <div data-testid={String(props.testId ?? "footprint-editor-canvas")}>
        {props.children as React.ReactNode}
      </div>
    );
  },
}));

vi.mock("@/editor-canvas/primitives", () => ({
  GridShader: (props: Record<string, unknown>) => {
    mockState.gridShaderProps.push(props);
    return <div data-testid="grid-shader" />;
  },
  PadInstances: (props: Record<string, unknown>) => {
    mockState.padInstancesProps.push(props);
    return <div data-testid="pad-instances" />;
  },
  EDAText: (props: Record<string, unknown>) => {
    mockState.textProps.push(props);
    return <div data-testid="eda-text">{props.children as React.ReactNode}</div>;
  },
}));

import { FootprintEditorCanvasR3F } from "./FootprintEditorCanvasR3F";

function resetStore() {
  useFootprintEditorStore.getState().resetDraft("footprint-test");
  useFootprintEditorStore.setState((state) => ({
    ...state,
    chrome: {
      ...state.chrome,
      gridSize: 0.5,
      showGrid: true,
      selection: {
        selectedPadIds: new Set(),
        selectedGraphicIds: new Set(),
      },
    },
  }));
}

describe("FootprintEditorCanvasR3F", () => {
  beforeEach(() => {
    mockState.edaCanvasProps = null;
    mockState.gridShaderProps = [];
    mockState.padInstancesProps = [];
    mockState.textProps = [];
    resetStore();
  });

  afterEach(() => {
    cleanup();
  });

  it("integrates with EdaCanvas and renders pad labels", () => {
    act(() => {
      useFootprintEditorStore.getState().addPad({
        id: "pad-1",
        name: "Pad 1",
        number: "1",
        shape: "rect",
        type: "smd",
        position: { x: 1, y: 2 },
        size: { width: 0.6, height: 0.8 },
        rotation: 90,
        layers: ["F.Cu"],
      });
    });

    render(<FootprintEditorCanvasR3F />);

    expect(mockState.edaCanvasProps).toMatchObject({
      testId: "footprint-editor-canvas",
      gridSize: 500_000,
      backgroundColor: "#111827",
    });
    expect(mockState.padInstancesProps[0]).toMatchObject({
      pads: [
        expect.objectContaining({
          id: "pad-1",
          x: 1_000_000,
          y: 2_000_000,
          rotation: 90,
          selected: false,
        }),
      ],
    });
    expect(mockState.textProps.at(-1)?.children).toBe("1");
  });

  it("reflects selection in rendered pad data and clears selection on empty click", () => {
    act(() => {
      useFootprintEditorStore.getState().addPad({
        id: "pad-1",
        name: "Pad 1",
        number: "1",
        shape: "circle",
        type: "thru_hole",
        position: { x: 0, y: 0 },
        size: { width: 1, height: 1 },
        rotation: 0,
        layers: ["F.Cu", "B.Cu"],
      });
      useFootprintEditorStore.getState().selectPad("pad-1");
    });

    render(<FootprintEditorCanvasR3F />);
    const renderedPads = mockState.padInstancesProps[0]?.pads as
      | Array<{ selected: boolean }>
      | undefined;
    expect(renderedPads?.[0]?.selected).toBe(true);

    const handler = mockState.edaCanvasProps?.interactionHandler as
      | {
          onPointerDown?: (event: {
            worldPoint: { x: number; y: number };
            modifiers: { shift: boolean; ctrl: boolean; meta: boolean };
          }) => void;
        }
      | undefined;
    act(() => {
      handler?.onPointerDown?.({
        worldPoint: { x: 5_000_000, y: 5_000_000 },
        modifiers: { shift: false, ctrl: false, meta: false },
      });
    });
    expect(
      useFootprintEditorStore.getState().chrome.selection.selectedPadIds.size,
    ).toBe(0);
  });

  it("supports delete, undo, redo, and select-all shortcuts", () => {
    act(() => {
      useFootprintEditorStore.getState().addPad({
        id: "pad-1",
        name: "Pad 1",
        number: "1",
        shape: "rect",
        type: "smd",
        position: { x: 0.5, y: 0.5 },
        size: { width: 0.6, height: 0.8 },
        rotation: 0,
        layers: ["F.Cu"],
      });
      useFootprintEditorStore.getState().addPad({
        id: "pad-2",
        name: "Pad 2",
        number: "2",
        shape: "oval",
        type: "smd",
        position: { x: 1.5, y: 0.5 },
        size: { width: 0.6, height: 0.8 },
        rotation: 0,
        layers: ["F.Cu"],
      });
    });

    render(<FootprintEditorCanvasR3F />);

    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    expect(
      useFootprintEditorStore.getState().chrome.selection.selectedPadIds.size,
    ).toBe(2);

    fireEvent.keyDown(window, { key: "Delete" });
    expect(useFootprintEditorStore.getState().draft.pads).toHaveLength(0);

    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(useFootprintEditorStore.getState().draft.pads).toHaveLength(2);

    fireEvent.keyDown(window, { key: "z", ctrlKey: true, shiftKey: true });
    expect(useFootprintEditorStore.getState().draft.pads).toHaveLength(0);
  });

  it("preserves grid-sized pad coordinates for adapter snapping expectations", () => {
    act(() => {
      useFootprintEditorStore.getState().addPad({
        id: "pad-grid",
        name: "Pad 3",
        number: "3",
        shape: "roundrect",
        type: "smd",
        position: { x: 1, y: 1.5 },
        size: { width: 1, height: 0.5 },
        rotation: 0,
        layers: ["F.Cu"],
      });
    });

    render(<FootprintEditorCanvasR3F />);
    const pads = mockState.padInstancesProps[0]?.pads as
      | Array<Record<string, unknown>>
      | undefined;
    expect(pads?.[0]).toMatchObject({
      x: 1_000_000,
      y: 1_500_000,
      shape: "roundrect",
    });
  });
});
