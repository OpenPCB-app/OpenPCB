import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ComponentDetailPage } from "./ComponentDetailPage";

const mockState = vi.hoisted(() => ({
  camera: {
    position: { x: 0, y: 0 },
    zoom: 1,
    updateProjectionMatrix: vi.fn(),
  },
  invalidate: vi.fn(),
}));

vi.mock("@react-three/fiber", () => ({
  useThree: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      camera: mockState.camera,
      size: { width: 640, height: 250 },
      invalidate: mockState.invalidate,
    }),
}));

const navigationState = {
  navigateBack: vi.fn(),
  navigateToDesign: vi.fn(),
  navigateToComponentDetail: vi.fn(),
  setDesignTab: vi.fn(),
  currentComponentId: "component-1",
};

const useComponentDetailMock = vi.fn();
const createComponentMock = vi.fn();
const parseKicadSymbolImportMock = vi.fn();
const toastMock = vi.fn();

const detailActions = {
  clearMutationError: vi.fn(),
  loadDeleteImpact: vi.fn(),
  deleteComponent: vi.fn(),
};

vi.mock("@/hooks/useComponents", () => ({
  useComponentDetail: (...args: unknown[]) => useComponentDetailMock(...args),
}));

vi.mock("@/lib/api/component-api", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/component-api")
  >("@/lib/api/component-api");
  return {
    ...actual,
    createComponent: (...args: unknown[]) => createComponentMock(...args),
    parseKicadSymbolImport: (...args: unknown[]) =>
      parseKicadSymbolImportMock(...args),
  };
});

vi.mock("@/components/ui/use-toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

vi.mock("../../stores/navigation-store", () => ({
  useNavigationStore: (selector: (state: typeof navigationState) => unknown) =>
    selector(navigationState),
}));

vi.mock("@/lib/render-engine/interaction/EdaCanvas", () => ({
  EdaCanvas: ({
    children,
    testId,
  }: {
    children: React.ReactNode;
    testId?: string;
  }) => <div data-testid={testId ?? "eda-canvas"}>{children}</div>,
}));

vi.mock("@/lib/render-engine/primitives/GridShader", () => ({
  GridShader: () => <div data-testid="grid-shader" />,
}));

vi.mock("@/lib/render-engine/primitives/SymbolBody", () => ({
  SymbolBody: () => <div data-testid="symbol-body" />,
}));

vi.mock("@/lib/render-engine/primitives/PinDots", () => ({
  PinDots: () => <div data-testid="pin-dots" />,
}));

vi.mock("@/lib/render-engine/primitives/PadInstances", () => ({
  PadInstances: () => <div data-testid="pad-instances" />,
}));

vi.mock("@/lib/render-engine/primitives/EDAText", () => ({
  EDAText: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("./Model3dPlaceholder", () => ({
  Model3dPlaceholder: () => <div>3D Preview</div>,
}));

vi.mock("./PinTable", () => ({
  PinTable: () => <div>Pin Table</div>,
}));

function makeComponent() {
  return {
    id: "component-1",
    displayLabel: "ATTINY13A-SU",
    canonicalKey: "attiny13a-su",
    description: "Tiny MCU",
    scope: "workspace",
    categoryPath: "MCU",
    tags: ["avr"],
    symbolData: {
      referencePrefix: "U",
      pinDefinitions: [
        { id: "pin-1", name: "VCC", electricalType: "power_in" },
        { id: "pin-2", name: "GND", electricalType: "power_in" },
      ],
      pins: [],
      properties: {},
      rawKicadSource: "(symbol attiny13a-su)",
    },
    variants: [
      {
        id: "variant-1",
        componentId: "component-1",
        canonicalCode: "SOIC-8",
        humanLabel: "SOIC-8",
        imperialAlias: null,
        metricAlias: null,
        mountType: "smd",
        dimensions: null,
        isDefault: true,
        pinRemapTable: null,
        defaultFootprintOptionId: "footprint-1",
        footprintOptions: [
          {
            id: "footprint-1",
            variantId: "variant-1",
            label: "IPC Nominal",
            isDefault: true,
            kicadPayload: {
              rawSource:
                '(footprint soic-8 (pad "1" smd rect (at -0.95 0 0) (size 0.6 1.2)) (pad "2" smd rect (at 0.95 0 0) (size 0.6 1.2)))',
              pads: [
                {
                  number: "1",
                  type: "smd",
                  shape: "rect",
                  position: { x: -0.95, y: 0 },
                  size: { width: 0.6, height: 1.2 },
                  rotation: 0,
                  layers: ["F.Cu"],
                },
                {
                  number: "2",
                  type: "smd",
                  shape: "rect",
                  position: { x: 0.95, y: 0 },
                  size: { width: 0.6, height: 1.2 },
                  rotation: 0,
                  layers: ["F.Cu"],
                },
              ],
            },
            model3dOptions: [],
            densityLevel: null,
            ipcName: null,
          },
          {
            id: "footprint-2",
            variantId: "variant-1",
            label: "IPC Most",
            isDefault: false,
            kicadPayload: {
              pads: [
                {
                  number: "1",
                  type: "smd",
                  shape: "rect",
                  position: { x: -1.2, y: 0 },
                  size: { width: 0.8, height: 1.4 },
                  rotation: 0,
                  layers: ["F.Cu"],
                },
              ],
            },
            model3dOptions: [],
            densityLevel: null,
            ipcName: null,
          },
        ],
      },
      {
        id: "variant-2",
        componentId: "component-1",
        canonicalCode: "QFN-32",
        humanLabel: "QFN-32",
        imperialAlias: null,
        metricAlias: null,
        mountType: "smd",
        dimensions: null,
        isDefault: false,
        pinRemapTable: null,
        defaultFootprintOptionId: "footprint-3",
        footprintOptions: [
          {
            id: "footprint-3",
            variantId: "variant-2",
            label: "QFN Default",
            isDefault: true,
            kicadPayload: {
              pads: [
                {
                  number: "1",
                  type: "smd",
                  shape: "rect",
                  position: { x: 0, y: 0 },
                  size: { width: 0.4, height: 0.8 },
                  rotation: 0,
                  layers: ["F.Cu"],
                },
              ],
            },
            model3dOptions: [],
            densityLevel: null,
            ipcName: null,
          },
        ],
      },
    ],
    defaultVariantId: "variant-1",
  };
}

function renderPage() {
  return render(
    <ThemeProvider>
      <ComponentDetailPage />
    </ThemeProvider>,
  );
}

describe("ComponentDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    detailActions.clearMutationError.mockReset();
    detailActions.loadDeleteImpact.mockReset();
    detailActions.deleteComponent.mockReset();

    useComponentDetailMock.mockReturnValue({
      component: makeComponent(),
      loading: false,
      error: null,
      mutationError: null,
      deleting: false,
      deleteImpactLoading: false,
      deleteImpact: {
        usageCount: 2,
        designNames: ["Main Board", "Power Board"],
      },
      ...detailActions,
    });

    createComponentMock.mockResolvedValue({
      id: "component-copy",
      displayLabel: "ATTINY13A-SU Copy",
    });
    detailActions.deleteComponent.mockResolvedValue(undefined);
    parseKicadSymbolImportMock.mockResolvedValue({ symbol: { id: "parsed" } });

    vi.stubGlobal("open", vi.fn());
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  it("loads and displays component details", async () => {
    renderPage();

    expect(
      screen.getByRole("heading", { name: "ATTINY13A-SU" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Tiny MCU")).toBeInTheDocument();
    expect(screen.getByText("2 pins")).toBeInTheDocument();
    await waitFor(() => {
      expect(parseKicadSymbolImportMock).toHaveBeenCalledWith(
        "(symbol attiny13a-su)",
      );
    });
  });

  it("renders the symbol preview", async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("symbol-preview")).toBeInTheDocument();
      expect(screen.getByText("VCC")).toBeInTheDocument();
    });
  });

  it("renders the footprint preview", () => {
    renderPage();

    expect(screen.getByTestId("footprint-preview")).toBeInTheDocument();
    expect(screen.getByTestId("pad-instances")).toBeInTheDocument();
  });

  it("switches package variants", () => {
    renderPage();

    fireEvent.change(screen.getByLabelText("Package Variant"), {
      target: { value: "variant-2" },
    });

    expect(screen.getByDisplayValue("QFN-32")).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Footprint variant"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("footprint-preview")).toBeInTheDocument();
  });

  it("switches footprint options within the selected variant", () => {
    renderPage();

    const footprintSelect = screen.getByLabelText(
      "Footprint variant",
    ) as HTMLSelectElement;

    fireEvent.change(footprintSelect, {
      target: { value: "footprint-2" },
    });

    expect(footprintSelect.value).toBe("footprint-2");
    expect(
      screen.getByRole("option", { name: /IPC Most/i }),
    ).toBeInTheDocument();
  });

  it("exports JSON and KiCad payloads", () => {
    renderPage();

    fireEvent.click(screen.getAllByRole("button", { name: "Export" })[0]!);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Component exported" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Export KiCAD Files" }));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(3);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "KiCad files exported" }),
    );
  });

  it("duplicates the component", async () => {
    renderPage();

    fireEvent.click(screen.getAllByRole("button", { name: "Duplicate" })[0]!);

    await waitFor(() => {
      expect(createComponentMock).toHaveBeenCalledTimes(1);
    });
    expect(navigationState.navigateToComponentDetail).toHaveBeenCalledWith(
      "component-copy",
    );
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Component duplicated" }),
    );
  });

  it("opens delete confirmation and deletes with usage-aware force flag", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(detailActions.clearMutationError).toHaveBeenCalled();
    expect(detailActions.loadDeleteImpact).toHaveBeenCalled();
    expect(
      screen.getByRole("heading", { name: "Delete Component" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Used in 2 designs/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete Component" }));

    await waitFor(() => {
      expect(detailActions.deleteComponent).toHaveBeenCalledWith({
        forceUsed: true,
      });
    });
    expect(navigationState.navigateBack).toHaveBeenCalled();
  });
});
