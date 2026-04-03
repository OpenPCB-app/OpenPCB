import type { ReactNode } from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedKicadFootprint } from "@/lib/api/component-api";
import { usePcbStore } from "@/stores/pcb-store";
import { useSchematicStore } from "@/stores/schematic-store";
import { DesignScreen } from "./DesignScreen";
import type { PcbDocument, PcbPlacement } from "@/components/pcb-editor/pcb-types";

let designTab: "schematic" | "pcb" | "3d" | "bom" = "pcb";
let currentProjectId: string | null = null;
let currentDesignId: string | null = null;

vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div data-testid="resize-handle" />,
}));

vi.mock("@/stores/navigation-store", () => ({
  useNavigationStore: (
    selector: (state: {
      designTab: typeof designTab;
      currentProjectId: string | null;
      currentDesignId: string | null;
      navigateToDesign: ReturnType<typeof vi.fn>;
      navigateToProject: ReturnType<typeof vi.fn>;
      navigateToHome: ReturnType<typeof vi.fn>;
    }) => unknown,
  ) =>
    selector({
      designTab,
      currentProjectId,
      currentDesignId,
      navigateToDesign: vi.fn(),
      navigateToProject: vi.fn(),
      navigateToHome: vi.fn(),
    }),
}));

vi.mock("@/stores/app-store", () => ({
  useAppStore: (
    selector: (state: {
      projects: Array<{ id: string; name: string }>;
      workspaces: Array<{ id: string; name: string }>;
      activeWorkspaceId: string;
    }) => unknown,
  ) =>
    selector({
      projects: [],
      workspaces: [{ id: "workspace-1", name: "Workspace" }],
      activeWorkspaceId: "workspace-1",
    }),
}));

vi.mock("@/hooks/useDesigns", () => ({
  useDesigns: () => ({
    designs: [],
    create: vi.fn(),
  }),
}));

vi.mock("@/lib/api/design-api", () => ({
  getSheetContent: vi.fn(),
  saveSheetContent: vi.fn(),
}));

vi.mock("./design/DesignHeader", () => ({
  DesignHeader: () => <div>Header</div>,
}));

vi.mock("@/components/pcb/toolbar/EditorToolbar", () => ({
  EditorToolbar: () => <div>Schematic Toolbar</div>,
}));

vi.mock("@/components/pcb/palette/ComponentPalette", () => ({
  ComponentPalette: () => <div>Palette</div>,
}));

vi.mock("@/components/pcb/canvas/SchematicCanvas", () => ({
  SchematicCanvas: () => <div>Schematic Canvas</div>,
}));

vi.mock("@/components/pcb/StatusBar", () => ({
  StatusBar: () => <div>Status</div>,
}));

vi.mock("@/components/pcb/useSchematicInteractionController", () => ({
  useSchematicInteractionController: () => ({
    cancelSession: vi.fn(),
    beginPlacement: vi.fn(),
    beginWire: vi.fn(),
  }),
}));

vi.mock("@/components/pcb/properties/FloatingPropertiesPopover", () => ({
  FloatingPropertiesPopover: () => null,
}));

vi.mock("@/components/pcb-editor/canvas/PcbCanvas", () => ({
  PcbCanvas: () => <div>PCB Canvas</div>,
}));

vi.mock("@/components/pcb-editor/PcbSidebar", () => ({
  PcbSidebar: () => <div>PCB Sidebar</div>,
}));

vi.mock("@/components/pcb-editor/PcbToolbar", () => ({
  PcbToolbar: () => <div>PCB Toolbar</div>,
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

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

function createPlacement(id: string): PcbPlacement {
  return {
    id,
    schematicSymbolId: id,
    componentId: id,
    variantId: "variant-1",
    footprintOptionId: "footprint-1",
    reference: id.toUpperCase(),
    value: id.toUpperCase(),
    position: { x: 10, y: 10 },
    rotation: 0,
    layer: "F.Cu",
    footprintData: createFootprint(),
  };
}

function createDocument(): PcbDocument {
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
    placements: [createPlacement("u1"), createPlacement("u2")],
    traces: [
      {
        id: "trace-1",
        start: { x: 10, y: 10 },
        end: { x: 20, y: 10 },
        width: 0.25,
        layer: "F.Cu",
        net: "net-1",
      },
    ],
    vias: [],
    zones: [],
  };
}

function resetStores() {
  useSchematicStore.setState((state) => ({
    ...state,
    persisted: {
      document: null,
      projectId: null,
      designId: null,
    },
    derived: {
      ...state.derived,
      connectivity: null,
      documentBounds: null,
      hitTestCache: {
        symbolBounds: {},
        connectorAnchors: {},
      },
    },
    chrome: {
      ...state.chrome,
      selectedEntityIds: new Set(),
      popoverEntityId: null,
    },
    session: null,
  }));

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
}

describe("DesignScreen PCB keyboard shortcuts", () => {
  beforeEach(() => {
    designTab = "pcb";
    currentProjectId = null;
    currentDesignId = null;
    resetStores();
  });

  it("cancels routing and returns to select on Escape", () => {
    usePcbStore.setState({
      activeTool: "route",
      lastCursorPosition: { x: 14, y: 10 },
      routingSession: {
        netId: "net-1",
        layer: "F.Cu",
        width: 0.25,
        widthPresets: [0.25, 0.5],
        widthIndex: 0,
        elbowDirection: "horizontal_first",
        committedSegments: [],
        committedVias: [],
        startPoint: { x: 10, y: 10 },
        previewSegments: [],
        viaDiameter: 0.8,
        viaDrill: 0.4,
      },
    });

    render(<DesignScreen />);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(usePcbStore.getState().routingSession).toBeNull();
    expect(usePcbStore.getState().activeTool).toBe("select");
  });

  it("deletes selected pcb entities unless a text input is focused", () => {
    usePcbStore.setState({ selectedIds: new Set(["trace-1"]) });
    render(<DesignScreen />);

    const input = document.createElement("input");
    document.body.append(input);
    input.focus();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", cancelable: true }));
    });
    expect(usePcbStore.getState().document?.traces).toHaveLength(1);

    input.blur();
    input.remove();

    const backspaceEvent = new KeyboardEvent("keydown", {
      key: "Backspace",
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(backspaceEvent);
    });

    expect(backspaceEvent.defaultPrevented).toBe(true);
    expect(usePcbStore.getState().document?.traces).toHaveLength(0);
  });

  it("dispatches select-all, undo, and redo shortcuts", () => {
    render(<DesignScreen />);

    const store = usePcbStore.getState();
    const selectAllSpy = vi.spyOn(store, "selectAllPlacements");
    const undoSpy = vi.spyOn(store, "undo");
    const redoSpy = vi.spyOn(store, "redo");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true }));
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true }),
      );
    });

    expect(selectAllSpy).toHaveBeenCalledTimes(1);
    expect(undoSpy).toHaveBeenCalledTimes(1);
    expect(redoSpy).toHaveBeenCalledTimes(1);
  });

  it("rotates and flips the selected placement when not routing", () => {
    usePcbStore.setState({ selectedIds: new Set(["u1"]) });
    render(<DesignScreen />);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "r" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }));
    });

    const placement = usePcbStore.getState().document?.placements.find((item) => item.id === "u1");
    expect(placement?.rotation).toBe(90);
    expect(placement?.layer).toBe("B.Cu");
  });

  it("cycles width, flips elbow, and places a via while routing", () => {
    usePcbStore.setState({
      activeTool: "route",
      lastCursorPosition: { x: 15, y: 10 },
      routingSession: {
        netId: "net-1",
        layer: "F.Cu",
        width: 0.25,
        widthPresets: [0.25, 0.5],
        widthIndex: 0,
        elbowDirection: "horizontal_first",
        committedSegments: [],
        committedVias: [],
        startPoint: { x: 10, y: 10 },
        previewSegments: [],
        viaDiameter: 0.8,
        viaDrill: 0.4,
      },
    });

    render(<DesignScreen />);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "w" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "v" }));
    });

    const routingSession = usePcbStore.getState().routingSession;
    expect(routingSession?.width).toBe(0.5);
    expect(routingSession?.elbowDirection).toBe("vertical_first");
    expect(routingSession?.committedVias).toHaveLength(1);
    expect(routingSession?.layer).toBe("B.Cu");
  });
});
