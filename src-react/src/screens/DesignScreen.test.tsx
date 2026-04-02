import type { ReactNode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSchematicStore } from "@/stores/schematic-store";
import type { SchematicDocument } from "@/components/pcb/types";
import * as designApi from "@/lib/api/design-api";
import { DesignScreen } from "./DesignScreen";

let designTab: "schematic" | "pcb" | "3d" | "bom" = "schematic";
const navigateToProject = vi.fn();
const navigateToHome = vi.fn();
const navigateToDesign = vi.fn();
const createDesign = vi.fn();
let currentProjectId: string | null = "project-1";
let currentDesignId: string | null = "design-1";
let designs = [
  {
    id: "design-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    name: "Main schematic",
    createdAt: "2026-03-31T00:00:00Z",
    updatedAt: "2026-03-31T00:00:00Z",
  },
];

vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ResizablePanel: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ResizableHandle: () => <div data-testid="resize-handle" />,
}));

vi.mock("@/stores/navigation-store", () => ({
  useNavigationStore: (
    selector: (state: {
      designTab: typeof designTab;
      currentProjectId: string | null;
      currentDesignId: string | null;
      navigateToDesign: typeof navigateToDesign;
      navigateToProject: typeof navigateToProject;
      navigateToHome: typeof navigateToHome;
    }) => unknown,
  ) =>
    selector({
      designTab,
      currentProjectId,
      currentDesignId,
      navigateToDesign,
      navigateToProject,
      navigateToHome,
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
    designs,
    create: createDesign,
  }),
}));

vi.mock("@/lib/api/design-api", () => ({
  getSheetContent: vi.fn(),
  saveSheetContent: vi.fn(),
}));

const getSheetContent = vi.mocked(designApi.getSheetContent);
const saveSheetContent = vi.mocked(designApi.saveSheetContent);

vi.mock("./design/DesignHeader", () => ({
  DesignHeader: ({
    designName,
    onSave,
    onClose,
  }: {
    designName: string;
    onSave?: () => void;
    onClose?: () => void;
  }) => (
    <div>
      <div>Header {designName}</div>
      {onSave && (
        <button type="button" onClick={onSave}>
          Save design
        </button>
      )}
      {onClose && (
        <button type="button" onClick={onClose}>
          Close design
        </button>
      )}
    </div>
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
      beginPlacement: (kind: "resistor" | "gnd") => void;
    };
  }) => (
    <div>
      <button
        type="button"
        draggable
        onDragStart={() => controller.beginPlacement("gnd")}
      >
        Ground
      </button>
      <button
        type="button"
        draggable
        onDragStart={() => controller.beginPlacement("resistor")}
      >
        Resistor
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
    <button type="button" onClick={() => controller.beginWire("pin-1")}>
      Begin wire
    </button>
  ),
}));

vi.mock("@/components/pcb/StatusBar", () => ({
  StatusBar: () => <div>PCB Status</div>,
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

const TEST_DOCUMENT: SchematicDocument = {
  id: "design-1",
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
      designId: TEST_DOCUMENT.id,
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
      gridPresetId: "small",
    },
    session: null,
  }));
}

describe("DesignScreen schematic shell", () => {
  beforeEach(() => {
    designTab = "schematic";
    currentProjectId = "project-1";
    currentDesignId = "design-1";
    designs = [
      {
        id: "design-1",
        workspaceId: "workspace-1",
        projectId: "project-1",
        name: "Main schematic",
        createdAt: "2026-03-31T00:00:00Z",
        updatedAt: "2026-03-31T00:00:00Z",
      },
    ];
    navigateToDesign.mockReset();
    navigateToProject.mockReset();
    navigateToHome.mockReset();
    createDesign.mockReset();
    getSheetContent.mockReset();
    saveSheetContent.mockReset();
    getSheetContent.mockResolvedValue({ sheet: null, content: null });
    saveSheetContent.mockResolvedValue({
      sheet: {
        id: "sheet-1",
        designId: "design-1",
        sheetIndex: 0,
        title: "Sheet 1",
        contentHash: null,
      },
    });
    resetStore();
  });

  it("opens clean in-memory designer without creating backend draft", async () => {
    currentProjectId = null;
    currentDesignId = null;
    designs = [];
    useSchematicStore.setState((state) => ({
      ...state,
      persisted: {
        ...state.persisted,
        document: null,
        designId: null,
      },
    }));

    render(<DesignScreen />);

    await waitFor(() =>
      expect(useSchematicStore.getState().persisted.document).toMatchObject({
        name: "Untitled design",
        symbols: [],
        wires: [],
        labels: [],
      }),
    );
    expect(useSchematicStore.getState().persisted.designId).toBeNull();
    expect(createDesign).not.toHaveBeenCalled();
    expect(navigateToDesign).not.toHaveBeenCalled();
  });

  it("keeps in-memory draft when revisiting design screen", async () => {
    currentProjectId = null;
    currentDesignId = null;
    designs = [];

    render(<DesignScreen />);

    await waitFor(() =>
      expect(useSchematicStore.getState().persisted.document).not.toBeNull(),
    );
    const firstDraftId = useSchematicStore.getState().persisted.document?.id;

    render(<DesignScreen />);

    await waitFor(() =>
      expect(useSchematicStore.getState().persisted.document?.id).toBe(
        firstDraftId,
      ),
    );
  });

  it("creates backend design only on explicit save of non-empty draft", async () => {
    const user = userEvent.setup();
    currentProjectId = null;
    currentDesignId = null;
    designs = [];
    createDesign.mockResolvedValue({
      id: "design-new",
      workspaceId: "workspace-1",
      projectId: null,
      name: "Untitled design",
      updatedAt: "2026-03-31T00:00:00Z",
    });

    render(<DesignScreen />);

    await waitFor(() =>
      expect(useSchematicStore.getState().persisted.document).not.toBeNull(),
    );

    act(() => {
      useSchematicStore.setState((state) => {
        const document = state.persisted.document;
        if (!document) {
          return state;
        }

        return {
          ...state,
          persisted: {
            ...state.persisted,
            document: {
              ...document,
              labels: [
                {
                  id: "label-1",
                  entityType: "label",
                  text: "NET_LABEL",
                  position: { x: 0, y: 0 },
                  rotation: 0,
                  mirrored: false,
                  net: null,
                },
              ],
            },
          },
        };
      });
    });

    await user.click(screen.getByRole("button", { name: "Save design" }));

    await waitFor(() =>
      expect(createDesign).toHaveBeenCalledWith({ name: "Untitled design" }),
    );
    await waitFor(() =>
      expect(saveSheetContent).toHaveBeenCalledWith(
        "design-new",
        0,
        expect.objectContaining({ id: "design-new" }),
      ),
    );
  });

  it("mounts schematic interactions through DesignScreen", () => {
    render(<DesignScreen />);

    expect(screen.getByText("Mock Toolbar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ground" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Resistor" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Begin wire" }),
    ).toBeInTheDocument();
    expect(screen.getByText("PCB Status")).toBeInTheDocument();
  });

  it("shows blocking retry panel when opening another design fails", async () => {
    currentProjectId = "project-2";
    currentDesignId = "design-2";
    designs = [
      {
        id: "design-2",
        workspaceId: "workspace-1",
        projectId: "project-2",
        name: "Broken design",
        createdAt: "2026-03-31T00:00:00Z",
        updatedAt: "2026-03-31T00:00:00Z",
      },
    ];
    getSheetContent.mockRejectedValue(new Error("network failed"));

    render(<DesignScreen />);

    await waitFor(() =>
      expect(screen.getByText("Failed to open design")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("keeps current canvas when reloading active design fails", async () => {
    getSheetContent.mockRejectedValueOnce(new Error("network failed"));

    render(<DesignScreen />);

    await waitFor(() =>
      expect(screen.queryByText("Failed to open design")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Begin wire" })).toBeInTheDocument();
  });

  it("routes palette drag starts through the shared placement controller", () => {
    render(<DesignScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Resistor" }));
    expect(useSchematicStore.getState().session).toBeNull();

    fireEvent.dragStart(screen.getByRole("button", { name: "Ground" }));
    expect(useSchematicStore.getState().session).toMatchObject({
      type: "placement",
      symbolKind: "gnd",
    });
  });

  it("centralizes Escape cancel semantics without mutating the document", async () => {
    const user = userEvent.setup();
    render(<DesignScreen />);

    const documentCountsBefore = {
      symbols:
        useSchematicStore.getState().persisted.document?.symbols.length ?? 0,
      wires: useSchematicStore.getState().persisted.document?.wires.length ?? 0,
      labels:
        useSchematicStore.getState().persisted.document?.labels.length ?? 0,
    };

    await user.click(screen.getByRole("button", { name: "Begin wire" }));
    expect(useSchematicStore.getState().session).toMatchObject({
      type: "wire",
      sourcePinId: "pin-1",
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(useSchematicStore.getState().session).toBeNull();
    expect(useSchematicStore.getState().chrome.selectedEntityIds).toEqual(
      new Set(),
    );
    expect({
      symbols:
        useSchematicStore.getState().persisted.document?.symbols.length ?? 0,
      wires: useSchematicStore.getState().persisted.document?.wires.length ?? 0,
      labels:
        useSchematicStore.getState().persisted.document?.labels.length ?? 0,
    }).toEqual(documentCountsBefore);
  });

  it("deletes selected entities with Delete", () => {
    useSchematicStore.getState().selectEntities(["symbol-1"]);
    render(<DesignScreen />);

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Delete", cancelable: true }),
      );
    });

    expect(useSchematicStore.getState().persisted.document?.symbols).toEqual(
      [],
    );
    expect(useSchematicStore.getState().persisted.document?.wires).toEqual([]);
    expect(useSchematicStore.getState().chrome.selectedEntityIds).toEqual(
      new Set(),
    );
  });

  it("deletes selected entities with Backspace and prevents navigation", () => {
    useSchematicStore.getState().selectEntities(["symbol-1"]);
    render(<DesignScreen />);

    const event = new KeyboardEvent("keydown", {
      key: "Backspace",
      cancelable: true,
    });

    act(() => {
      window.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(useSchematicStore.getState().persisted.document?.symbols).toEqual(
      [],
    );
    expect(useSchematicStore.getState().persisted.document?.wires).toEqual([]);
  });

  it("ignores Delete and Backspace when a text field is focused", () => {
    useSchematicStore.getState().selectEntities(["symbol-1"]);
    render(<DesignScreen />);

    const input = globalThis.document.createElement("input");
    globalThis.document.body.append(input);
    input.focus();

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Delete", cancelable: true }),
      );
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Backspace", cancelable: true }),
      );
    });

    expect(
      useSchematicStore.getState().persisted.document?.symbols,
    ).toHaveLength(1);
    expect(useSchematicStore.getState().persisted.document?.wires).toHaveLength(
      1,
    );
    expect(useSchematicStore.getState().chrome.selectedEntityIds).toEqual(
      new Set(["symbol-1"]),
    );

    input.blur();
    input.remove();
  });

  it("does nothing for Delete and Backspace when nothing is selected", () => {
    render(<DesignScreen />);

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Delete", cancelable: true }),
      );
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Backspace", cancelable: true }),
      );
    });

    expect(
      useSchematicStore.getState().persisted.document?.symbols,
    ).toHaveLength(1);
    expect(useSchematicStore.getState().persisted.document?.wires).toHaveLength(
      1,
    );
    expect(useSchematicStore.getState().chrome.selectedEntityIds).toEqual(
      new Set(),
    );
  });

  it("shows a floating popover for a single selected symbol and reanchors on viewport changes", () => {
    useSchematicStore.getState().selectEntities(["symbol-1"]);

    render(<DesignScreen />);

    expect(
      screen.getByRole("dialog", { name: "Symbol properties" }),
    ).toBeInTheDocument();
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
      useSchematicStore
        .getState()
        .setViewport({ offsetX: 15, offsetY: 20, zoom: 3 });
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
    expect(
      screen.queryByRole("dialog", { name: "Symbol properties" }),
    ).not.toBeInTheDocument();

    act(() => {
      useSchematicStore.getState().clearSelection();
    });
    expect(
      screen.queryByRole("dialog", { name: "Symbol properties" }),
    ).not.toBeInTheDocument();
  });

  it("closes the popover when the backdrop is clicked while preserving selection", async () => {
    const user = userEvent.setup();
    useSchematicStore.getState().selectEntities(["symbol-1"]);
    render(<DesignScreen />);

    await user.click(screen.getByTestId("floating-properties-backdrop"));

    expect(
      screen.queryByRole("dialog", { name: "Symbol properties" }),
    ).not.toBeInTheDocument();
    expect(useSchematicStore.getState().chrome.selectedEntityIds).toEqual(
      new Set(["symbol-1"]),
    );
    expect(useSchematicStore.getState().chrome.popoverEntityId).toBeNull();
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
    expect(
      screen.getByRole("dialog", { name: "Symbol properties" }),
    ).toBeInTheDocument();

    input.blur();
    input.remove();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(
      screen.queryByRole("dialog", { name: "Symbol properties" }),
    ).not.toBeInTheDocument();
    expect(useSchematicStore.getState().chrome.selectedEntityIds).toEqual(
      new Set(["symbol-1"]),
    );
  });
});
