import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
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
      viewport: { offsetX: 0, offsetY: 0, zoom: 1 },
      selectedEntityIds: new Set(["symbol-1"]),
      activeTool: "select",
      popoverEntityId: "symbol-1",
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
});
