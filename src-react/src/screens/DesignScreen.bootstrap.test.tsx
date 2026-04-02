import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useSchematicStore } from "@/stores/schematic-store";
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

vi.mock("./design/DesignHeader", () => ({
  DesignHeader: ({ designName }: { designName: string }) => (
    <div>Header {designName}</div>
  ),
}));

vi.mock("@/components/pcb/toolbar/EditorToolbar", () => ({
  EditorToolbar: () => <div>Mock Toolbar</div>,
}));

vi.mock("@/components/pcb/StatusBar", () => ({
  StatusBar: () => <div>PCB Status</div>,
}));

vi.mock("@/components/ui/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
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

vi.mock("@/hooks/useComponents", () => ({
  useComponents: vi.fn(() => ({
    components: [],
    loading: false,
    error: null,
    refetch: vi.fn(),
    filters: {},
    setFilters: vi.fn(),
  })),
}));

vi.mock("@/components/ThemeProvider", () => ({
  useTheme: () => ({
    preference: "system",
    mode: "dark",
    isReady: true,
    setPreference: vi.fn(),
  }),
}));

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
    fillText: vi.fn(),
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    lineJoin: "round",
    lineCap: "round",
    globalAlpha: 1,
    font: "",
    textAlign: "start",
    textBaseline: "alphabetic",
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
  type: "dragstart" | "dragenter" | "dragover" | "drop" | "dragend",
  options: {
    dataTransfer: DataTransfer;
    clientX?: number;
    clientY?: number;
  },
) {
  const event = new Event(type, { bubbles: true, cancelable: true });

  Object.defineProperties(event, {
    dataTransfer: { value: options.dataTransfer },
    clientX: { value: options.clientX ?? 0 },
    clientY: { value: options.clientY ?? 0 },
  });

  fireEvent(target, event);
}

function resetStore() {
  useSchematicStore.setState((state) => ({
    ...state,
    persisted: {
      document: null,
      projectId: null,
      designId: null,
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
      selectedEntityIds: new Set(),
      activeTool: "select",
      popoverEntityId: null,
      gridSize: 1_270_000,
      showGrid: true,
      placementRotation: 0,
      gridPresetId: "small",
    },
    session: null,
    draggedSymbolKind: null,
  }));
}

describe("DesignScreen real schematic bootstrap", () => {
  beforeAll(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 0),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((
      contextId: string,
    ) =>
      contextId === "2d"
        ? createMockContext()
        : null) as unknown as HTMLCanvasElement["getContext"]);
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
    getSheetContent.mockResolvedValue({ sheet: null, content: null });
    resetStore();
  });

  it("bootstraps an empty in-memory schematic document from design metadata", async () => {
    render(<DesignScreen />);

    await waitFor(() =>
      expect(useSchematicStore.getState().persisted.document).toMatchObject({
        id: "design-1",
        projectId: "project-1",
        name: "Main schematic",
        symbols: [],
        wires: [],
        labels: [],
      }),
    );
    await waitFor(() =>
      expect(useSchematicStore.getState().chrome.viewport.zoom).not.toBe(1),
    );
  });

  it("drops a real resistor onto the real canvas after bootstrap", async () => {
    render(<DesignScreen />);

    await waitFor(() =>
      expect(useSchematicStore.getState().persisted.document?.id).toBe(
        "design-1",
      ),
    );

    const groundButton = screen.getByRole("button", { name: /ground/i });
    const canvas = screen.getByTestId("schematic-canvas");
    const dataTransfer = createDataTransfer();

    dispatchDragEvent(groundButton, "dragstart", { dataTransfer });
    dispatchDragEvent(canvas, "dragenter", {
      dataTransfer,
      clientX: 520,
      clientY: 320,
    });
    dispatchDragEvent(canvas, "dragover", {
      dataTransfer,
      clientX: 520,
      clientY: 320,
    });

    expect(useSchematicStore.getState().session).toMatchObject({
      type: "placement",
      symbolKind: "gnd",
    });

    dispatchDragEvent(canvas, "drop", {
      dataTransfer,
      clientX: 520,
      clientY: 320,
    });
    dispatchDragEvent(groundButton, "dragend", { dataTransfer });

    await waitFor(() =>
      expect(
        useSchematicStore.getState().persisted.document?.symbols,
      ).toHaveLength(1),
    );
    expect(
      useSchematicStore.getState().persisted.document?.symbols[0],
    ).toMatchObject({
      symbolKind: "gnd",
    });
  });
});
