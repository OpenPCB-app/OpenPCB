import type { ReactNode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSchematicStore } from "@/stores/schematic-store";
import type { SchematicDocument } from "@/components/pcb/types";
import { DesignScreen } from "./DesignScreen";

let designTab: "schematic" | "pcb" | "3d" | "bom" = "schematic";

vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizablePanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ResizableHandle: () => <div data-testid="resize-handle" />,
}));

vi.mock("@/stores/navigation-store", () => ({
  useNavigationStore: (
    selector: (state: {
      designTab: typeof designTab;
      currentProjectId: string;
      currentDesignId: string;
      navigateToProject: ReturnType<typeof vi.fn>;
      navigateToHome: ReturnType<typeof vi.fn>;
    }) => unknown,
  ) =>
    selector({
      designTab,
      currentProjectId: "project-1",
      currentDesignId: "design-1",
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
      projects: [{ id: "project-1", name: "Motor Driver" }],
      workspaces: [{ id: "workspace-1", name: "Workspace" }],
      activeWorkspaceId: "workspace-1",
    }),
}));

vi.mock("@/hooks/useDesigns", () => ({
  useDesigns: () => ({
    designs: [{ id: "design-1", name: "Main schematic" }],
  }),
}));

vi.mock("./design/DesignHeader", () => ({
  DesignHeader: ({ designName }: { designName: string }) => (
    <div>Header {designName}</div>
  ),
}));

vi.mock("@/components/pcb/toolbar/EditorToolbar", () => ({
  EditorToolbar: () => <div>Mock Toolbar</div>,
}));

vi.mock("@/components/pcb/palette/ComponentPalette", () => ({
  ComponentPalette: ({
    controller,
  }: {
    controller: {
      beginPlacement: (kind: "resistor" | "capacitor") => void;
    };
  }) => (
    <div>
      <button onClick={() => controller.beginPlacement("resistor")}>Begin placement</button>
      <button
        draggable
        onDragStart={() => controller.beginPlacement("capacitor")}
      >
        Drag placement
      </button>
    </div>
  ),
}));

vi.mock("@/components/pcb/canvas/SchematicCanvas", () => ({
  SchematicCanvas: ({
    controller,
  }: {
    controller: {
      beginWire: (sourcePinId: string) => void;
    };
  }) => (
    <button onClick={() => controller.beginWire("pin-1")}>Begin wire</button>
  ),
}));

vi.mock("@/components/pcb/StatusBar", () => ({
  StatusBar: () => <div>PCB Status</div>,
}));

const TEST_DOCUMENT: SchematicDocument = {
  id: "doc-1",
  projectId: "project-1",
  updatedAt: "2026-03-31T00:00:00Z",
  version: 1,
  formatVersion: "pcb.schematic-project-document/v1",
  name: "Main schematic",
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
      properties: {
        Footprint: "R_0603",
        Tolerance: "1%",
      },
    },
  ],
  wires: [
    {
      id: "wire-1",
      entityType: "wire",
      position: { x: 0, y: 0 },
      rotation: 0,
      mirrored: false,
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      sourcePinId: "pin-1",
      targetPinId: "pin-2",
      net: "NET1",
    },
  ],
  labels: [],
};

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
        symbolBounds: {
          "symbol-1": {
            minX: 20,
            minY: 10,
            maxX: 80,
            maxY: 30,
          },
        },
        connectorAnchors: {
          "pin-1": { x: 0, y: 0 },
          "pin-2": { x: 100, y: 0 },
        },
      },
    },
    chrome: {
      viewport: { offsetX: 5, offsetY: 10, zoom: 2 },
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

describe("DesignScreen schematic shell", () => {
  beforeEach(() => {
    designTab = "schematic";
    resetStore();
  });

  it("mounts schematic interactions through DesignScreen", () => {
    render(<DesignScreen />);

    expect(screen.getByText("Mock Toolbar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Begin placement" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Begin wire" })).toBeInTheDocument();
    expect(screen.getByText("PCB Status")).toBeInTheDocument();
  });

  it("routes palette click and drag starts through the shared placement controller", async () => {
    const user = userEvent.setup();
    render(<DesignScreen />);

    await user.click(screen.getByRole("button", { name: "Begin placement" }));
    expect(useSchematicStore.getState().session).toMatchObject({
      type: "placement",
      symbolKind: "resistor",
    });

    fireEvent.dragStart(screen.getByRole("button", { name: "Drag placement" }));
    expect(useSchematicStore.getState().session).toMatchObject({
      type: "placement",
      symbolKind: "capacitor",
    });
  });

  it("centralizes Escape cancel semantics without mutating the document", async () => {
    const user = userEvent.setup();
    render(<DesignScreen />);

    const documentCountsBefore = {
      symbols: useSchematicStore.getState().persisted.document?.symbols.length ?? 0,
      wires: useSchematicStore.getState().persisted.document?.wires.length ?? 0,
      labels: useSchematicStore.getState().persisted.document?.labels.length ?? 0,
    };

    await user.click(screen.getByRole("button", { name: "Begin wire" }));
    expect(useSchematicStore.getState().session).toMatchObject({
      type: "wire",
      sourcePinId: "pin-1",
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(useSchematicStore.getState().session).toBeNull();
    expect(useSchematicStore.getState().chrome.selectedEntityIds).toEqual(new Set());
    expect({
      symbols: useSchematicStore.getState().persisted.document?.symbols.length ?? 0,
      wires: useSchematicStore.getState().persisted.document?.wires.length ?? 0,
      labels: useSchematicStore.getState().persisted.document?.labels.length ?? 0,
    }).toEqual(documentCountsBefore);
  });

  it("shows a floating popover for a single selected symbol and reanchors on viewport changes", () => {
    useSchematicStore.getState().selectEntities(["symbol-1"]);

    render(<DesignScreen />);

    expect(screen.getByRole("dialog", { name: "Symbol properties" })).toBeInTheDocument();
    expect(screen.getAllByText("R1")).toHaveLength(2);
    expect(screen.getByText("10k")).toBeInTheDocument();
    expect(screen.getByText("R_0603")).toBeInTheDocument();
    expect(screen.getByText("Tolerance")).toBeInTheDocument();
    expect(screen.getByText("1%")).toBeInTheDocument();
    expect(screen.getByTestId("floating-properties-popover")).toHaveStyle({
      left: "177px",
      top: "50px",
    });

    act(() => {
      useSchematicStore.getState().setViewport({ offsetX: 15, offsetY: 20, zoom: 3 });
    });

    expect(screen.getByTestId("floating-properties-popover")).toHaveStyle({
      left: "267px",
      top: "80px",
    });
  });

  it("hides the popover for multi-select and empty selection", () => {
    useSchematicStore.getState().selectEntities(["symbol-1"]);
    render(<DesignScreen />);

    act(() => {
      useSchematicStore.getState().selectEntities(["symbol-1", "wire-1"]);
    });
    expect(screen.queryByRole("dialog", { name: "Symbol properties" })).not.toBeInTheDocument();

    act(() => {
      useSchematicStore.getState().clearSelection();
    });
    expect(screen.queryByRole("dialog", { name: "Symbol properties" })).not.toBeInTheDocument();
  });

  it("keeps the popover open when the inert backdrop is clicked", async () => {
    const user = userEvent.setup();
    useSchematicStore.getState().selectEntities(["symbol-1"]);
    render(<DesignScreen />);

    await user.click(screen.getByTestId("floating-properties-backdrop"));

    expect(screen.getByRole("dialog", { name: "Symbol properties" })).toBeInTheDocument();
    expect(useSchematicStore.getState().chrome.selectedEntityIds).toEqual(new Set(["symbol-1"]));
    expect(useSchematicStore.getState().chrome.popoverEntityId).toBe("symbol-1");
  });

  it("closes on Escape only when a text field is not focused", () => {
    useSchematicStore.getState().selectEntities(["symbol-1"]);
    render(<DesignScreen />);

    const input = globalThis.document.createElement("input");
    globalThis.document.body.append(input);
    input.focus();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.getByRole("dialog", { name: "Symbol properties" })).toBeInTheDocument();

    input.blur();
    input.remove();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(screen.queryByRole("dialog", { name: "Symbol properties" })).not.toBeInTheDocument();
    expect(useSchematicStore.getState().chrome.selectedEntityIds).toEqual(new Set(["symbol-1"]));
  });
});
