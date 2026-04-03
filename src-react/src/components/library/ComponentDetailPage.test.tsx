import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComponentDetailPage } from "./ComponentDetailPage";

const navigationState = {
  navigateBack: vi.fn(),
  navigateToDesign: vi.fn(),
  navigateToComponentDetail: vi.fn(),
  setDesignTab: vi.fn(),
  currentComponentId: "component-1",
};

const useComponentDetailMock = vi.fn();
const createComponentMock = vi.fn();
const toastMock = vi.fn();

vi.mock("@/hooks/useComponents", () => ({
  useComponentDetail: (...args: unknown[]) => useComponentDetailMock(...args),
}));

vi.mock("@/lib/api/component-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/component-api")>(
    "@/lib/api/component-api",
  );
  return {
    ...actual,
    createComponent: (...args: unknown[]) => createComponentMock(...args),
  };
});

vi.mock("@/components/ui/use-toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

vi.mock("../../stores/navigation-store", () => ({
  useNavigationStore: (
    selector: (state: typeof navigationState) => unknown,
  ) => selector(navigationState),
}));

vi.mock("./SymbolPreview", () => ({
  SymbolPreview: () => <div>Symbol Preview</div>,
}));

vi.mock("./FootprintPreview", () => ({
  FootprintPreview: () => <div>Footprint Preview</div>,
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
      pinDefinitions: [{ id: "pin-1", name: "VCC", electricalType: "power_in" }],
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
            label: "SOIC-8",
            isDefault: true,
            kicadPayload: { rawSource: "(footprint soic-8)" },
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

describe("ComponentDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useComponentDetailMock.mockReturnValue({
      component: makeComponent(),
      loading: false,
      error: null,
      mutationError: null,
      deleting: false,
      deleteImpactLoading: false,
      deleteImpact: null,
      clearMutationError: vi.fn(),
      loadDeleteImpact: vi.fn(),
      deleteComponent: vi.fn(),
    });

    createComponentMock.mockResolvedValue({
      id: "component-copy",
      displayLabel: "ATTINY13A-SU Copy",
    });

    vi.stubGlobal("open", vi.fn());
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  it("navigates to schematic design from Use in Design", () => {
    render(<ComponentDetailPage />);

    fireEvent.click(screen.getByRole("button", { name: "Use in Design" }));

    expect(navigationState.setDesignTab).toHaveBeenCalledWith("schematic");
    expect(navigationState.navigateToDesign).toHaveBeenCalled();
  });

  it("duplicates the component and opens the duplicated detail page", async () => {
    render(<ComponentDetailPage />);

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

  it("exports component json from the header export action", () => {
    render(<ComponentDetailPage />);

    fireEvent.click(screen.getAllByRole("button", { name: "Export" })[0]!);

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Component exported" }),
    );
  });

  it("exports available kicad files from the actions panel", () => {
    render(<ComponentDetailPage />);

    fireEvent.click(screen.getByRole("button", { name: "Export KiCAD Files" }));

    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "KiCad files exported" }),
    );
  });
});
