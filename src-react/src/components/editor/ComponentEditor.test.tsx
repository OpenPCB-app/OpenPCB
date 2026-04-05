import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComponentEditor } from "./ComponentEditor";

const useComponentDetailMock = vi.fn();
const useComponentMutationsMock = vi.fn();
const refetchAndPropagateMock = vi.fn();

const navigationState = {
  navigateToLibrary: vi.fn(),
};

const createComponentMock = vi.fn();
const updateComponentMock = vi.fn();
const clearCreateErrorMock = vi.fn();
const clearMutationErrorMock = vi.fn();
const setSymbolDraftMock = vi.fn();
const resetSymbolDraftMock = vi.fn();
const loadSymbolDraftFromComponentMock = vi.fn();
const transformSymbolDraftToComponentSymbolDataMock = vi.fn();
const setFootprintDraftMock = vi.fn();
const resetFootprintDraftMock = vi.fn();

const toastMock = vi.fn();

vi.mock("@/components/ui/use-toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

const mockSchematicDocument = {
  symbols: [] as any[],
};

vi.mock("@/stores/schematic-store", () => ({
  useSchematicStore: {
    getState: () => ({
      persisted: {
        document: mockSchematicDocument,
      },
    }),
  },
}));

const addComponentVariantMock = vi.fn();
const updateComponentVariantApiMock = vi.fn();
const removeComponentVariantApiMock = vi.fn();
const setDefaultComponentVariantApiMock = vi.fn();

let symbolIsDirty = false;
let footprintIsDirty = false;
let footprintDraftState = createMockFootprintDraft();

const symbolDraft = {
  id: "symbol-draft-1",
  metadata: {
    name: "Resistor 0603",
    description: "Generic resistor",
    referencePrefix: "R",
  },
  body: {
    kind: "ic_box",
    width: 7_620_000,
    height: 10_160_000,
  },
  pins: [],
  graphics: [],
  importPreservation: null,
};

const transformedSymbolData = {
  referencePrefix: "R",
  pinDefinitions: [],
  pins: [],
  properties: {},
  unitCount: 1,
  bodyGraphics: [],
  rawKicadSource: null,
};

function createMockFootprintDraft(id = "footprint-draft-1") {
  return {
    id,
    metadata: {
      name: "Default",
      reference: "REF**",
      description: "",
    },
    preset: "soic",
    config: {
      padCount: 8,
      pitch: 1.27,
      bodyLength: 4.9,
      bodyWidth: 3.9,
      bodyHeight: 1.75,
      leadSpan: 6.0,
      leadWidth: 0.4,
      leadLength: 0.8,
      heelFillet: 0.25,
      toeFillet: 0.5,
      sideFillet: 0.03,
      courtyardMargin: 0.25,
      silkscreenWidth: 0.12,
    },
    configMode: "manual" as const,
    densityLevel: "nominal" as const,
    pads: [],
    graphics: [],
    importPreservation: null,
  };
}

const existingComponent = {
  id: "component-1",
  canonicalKey: "resistor-0603",
  displayLabel: "Resistor 0603",
  description: "Generic resistor",
  scope: "workspace",
  symbolData: {
    referencePrefix: "R",
    pinDefinitions: [],
    pins: [],
    properties: {},
    unitCount: 1,
    bodyGraphics: [],
    rawKicadSource: null,
  },
  variants: [],
  defaultVariantId: null,
  categoryPath: "Passives/Resistors",
  tags: ["passive", "smd"],
  createdAt: "2026-04-02T10:00:00.000Z",
  updatedAt: "2026-04-02T10:00:00.000Z",
};

vi.mock("@/hooks/useComponents", () => ({
  useComponentDetail: (...args: unknown[]) => useComponentDetailMock(...args),
  useComponentMutations: (...args: unknown[]) =>
    useComponentMutationsMock(...args),
  useComponents: () => ({
    refetchAndPropagate: refetchAndPropagateMock,
  }),
}));

vi.mock("@/stores/navigation-store", () => ({
  useNavigationStore: (selector: (state: typeof navigationState) => unknown) =>
    selector(navigationState),
}));

vi.mock("@/lib/api/component-api", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/api/component-api")
  >("@/lib/api/component-api");

  return {
    ...actual,
    addComponentVariant: (...args: unknown[]) =>
      addComponentVariantMock(...args),
    updateComponentVariant: (...args: unknown[]) =>
      updateComponentVariantApiMock(...args),
    removeComponentVariant: (...args: unknown[]) =>
      removeComponentVariantApiMock(...args),
    setDefaultComponentVariant: (...args: unknown[]) =>
      setDefaultComponentVariantApiMock(...args),
  };
});

vi.mock("@/components/symbol-editor", () => ({
  SymbolEditorToolbar: () => <div data-testid="symbol-editor-toolbar" />,
  SymbolEditorCanvas: () => <div data-testid="symbol-editor-canvas" />,
  PinPalette: () => <div data-testid="symbol-editor-pin-palette" />,
  SymbolMetadataEditor: () => <div data-testid="symbol-editor-metadata" />,
  PinPropertiesPanel: () => <div data-testid="symbol-editor-pin-properties" />,
  useIsDirty: () => symbolIsDirty,
  useSymbolEditorStore: (
    selector: (state: {
      draft: typeof symbolDraft;
      setDraft: typeof setSymbolDraftMock;
      resetDraft: typeof resetSymbolDraftMock;
      chrome: {
        selection: {
          selectedPinIds: Set<string>;
          selectedGraphicIds: Set<string>;
        };
      };
    }) => unknown,
  ) =>
    selector({
      draft: symbolDraft,
      setDraft: setSymbolDraftMock,
      resetDraft: resetSymbolDraftMock,
      chrome: {
        selection: {
          selectedPinIds: new Set(),
          selectedGraphicIds: new Set(),
        },
      },
    }),
}));

vi.mock("@/components/footprint-editor", () => ({
  useFootprintEditorStore: (
    selector: (state: {
      draft: ReturnType<typeof createMockFootprintDraft>;
      setDraft: typeof setFootprintDraftMock;
      resetDraft: typeof resetFootprintDraftMock;
    }) => unknown,
  ) =>
    selector({
      draft: footprintDraftState,
      setDraft: setFootprintDraftMock,
      resetDraft: resetFootprintDraftMock,
    }),
  useIsDirty: () => footprintIsDirty,
  createEmptyDraft: (id: string) => createMockFootprintDraft(id),
  FootprintEditorStep: () => <div data-testid="footprint-editor-step" />,
}));

vi.mock("./symbol-data-buffer", () => ({
  loadSymbolDraftFromComponent: (...args: unknown[]) =>
    loadSymbolDraftFromComponentMock(...args),
  transformSymbolDraftToComponentSymbolData: (...args: unknown[]) =>
    transformSymbolDraftToComponentSymbolDataMock(...args),
}));

describe("ComponentEditor", () => {
  beforeEach(() => {
    symbolIsDirty = false;
    footprintIsDirty = false;
    footprintDraftState = createMockFootprintDraft();
    navigationState.navigateToLibrary.mockReset();
    createComponentMock.mockReset();
    updateComponentMock.mockReset();
    clearCreateErrorMock.mockReset();
    clearMutationErrorMock.mockReset();
    setSymbolDraftMock.mockReset();
    resetSymbolDraftMock.mockReset();
    setFootprintDraftMock.mockReset();
    resetFootprintDraftMock.mockReset();
    loadSymbolDraftFromComponentMock.mockReset();
    transformSymbolDraftToComponentSymbolDataMock.mockReset();
    addComponentVariantMock.mockReset();
    updateComponentVariantApiMock.mockReset();
    removeComponentVariantApiMock.mockReset();
    setDefaultComponentVariantApiMock.mockReset();
    refetchAndPropagateMock.mockReset();
    toastMock.mockReset();
    mockSchematicDocument.symbols = [];

    setFootprintDraftMock.mockImplementation(
      (draft: ReturnType<typeof createMockFootprintDraft>) => {
        footprintDraftState = draft;
      },
    );

    loadSymbolDraftFromComponentMock.mockResolvedValue({
      draft: symbolDraft,
      warning: null,
    });
    transformSymbolDraftToComponentSymbolDataMock.mockReturnValue(
      transformedSymbolData,
    );

    useComponentMutationsMock.mockReturnValue({
      createComponent: createComponentMock,
      creating: false,
      updating: false,
      deleting: false,
      error: null,
      clearError: clearCreateErrorMock,
    });

    useComponentDetailMock.mockReturnValue({
      component: existingComponent,
      loading: false,
      error: null,
      mutationError: null,
      saving: false,
      deleting: false,
      clearMutationError: clearMutationErrorMock,
      refetch: vi.fn(),
      updateComponent: updateComponentMock,
      deleteComponent: vi.fn(),
    });
  });

  it("renders metadata fields and integrated symbol editor", async () => {
    render(<ComponentEditor componentId="component-1" />);

    expect(screen.getByLabelText("Name")).toHaveValue("Resistor 0603");
    expect(screen.getByLabelText("Description")).toHaveValue(
      "Generic resistor",
    );
    expect(screen.getByLabelText("Category Path")).toHaveValue(
      "Passives/Resistors",
    );
    expect(screen.getByLabelText("Tags")).toHaveValue("passive, smd");
    expect(screen.getByTestId("component-symbol-editor")).toBeInTheDocument();
    expect(screen.getByTestId("symbol-editor-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("symbol-editor-canvas")).toBeInTheDocument();
    expect(screen.getByText("Footprints / Variants")).toBeInTheDocument();
    expect(screen.getByText("Variant 1")).toBeInTheDocument();
    expect(
      screen.getByTestId("component-footprint-editor"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("footprint-editor-step")).toBeInTheDocument();
    expect(screen.getByTestId("variant-dirty-indicator")).toHaveTextContent(
      "Saved",
    );

    await waitFor(() => {
      expect(loadSymbolDraftFromComponentMock).toHaveBeenCalledWith(
        existingComponent,
      );
      expect(setSymbolDraftMock).toHaveBeenCalledWith(symbolDraft);
      expect(screen.getByTestId("symbol-dirty-indicator")).toHaveTextContent(
        "Saved",
      );
    });
  });

  it("shows modified state when symbol editor is dirty", async () => {
    symbolIsDirty = true;

    render(<ComponentEditor componentId="component-1" />);

    await waitFor(() => {
      expect(screen.getByTestId("symbol-dirty-indicator")).toHaveTextContent(
        "Modified",
      );
    });
  });

  it("adds variants from the variant manager", async () => {
    render(<ComponentEditor componentId="component-1" />);

    await waitFor(() => {
      expect(screen.getByText("Variant 1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Add Variant" }));

    expect(screen.getByText("Variant 2")).toBeInTheDocument();
    expect(screen.getByTestId("variant-dirty-indicator")).toHaveTextContent(
      "Modified",
    );
  });

  it("sets a new default variant", async () => {
    render(<ComponentEditor componentId="component-1" />);

    await waitFor(() => {
      expect(screen.getByText("Variant 1")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Add Variant" }));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Set Variant 2 as default variant",
      }),
    );

    expect(
      screen.getByRole("button", { name: "Set Variant 1 as default variant" }),
    ).not.toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Set Variant 2 as default variant" }),
    ).toBeDisabled();
  });

  it("creates a component and returns to the library", async () => {
    useComponentDetailMock.mockReturnValue({
      component: null,
      loading: false,
      error: null,
      mutationError: null,
      saving: false,
      deleting: false,
      clearMutationError: clearMutationErrorMock,
      refetch: vi.fn(),
      updateComponent: updateComponentMock,
      deleteComponent: vi.fn(),
    });
    createComponentMock.mockResolvedValue({ id: "created-component" });

    render(<ComponentEditor />);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Voltage Regulator" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Linear regulator" },
    });
    fireEvent.change(screen.getByLabelText("Category Path"), {
      target: { value: "Power/Regulators" },
    });
    fireEvent.change(screen.getByLabelText("Tags"), {
      target: { value: "power, linear,  regulator " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Component" }));

    await waitFor(() => {
      expect(createComponentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          displayLabel: "Voltage Regulator",
          description: "Linear regulator",
          categoryPath: "Power/Regulators",
          tags: ["power", "linear", "regulator"],
          symbolData: transformedSymbolData,
          canonicalKey: expect.stringMatching(/^voltage-regulator-/),
        }),
      );
      expect(
        transformSymbolDraftToComponentSymbolDataMock,
      ).toHaveBeenCalledWith(symbolDraft, undefined);
      expect(refetchAndPropagateMock).toHaveBeenCalledTimes(1);
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Component created",
        }),
      );
      expect(navigationState.navigateToLibrary).toHaveBeenCalledTimes(1);
    });
  });

  it("includes variants in the create payload", async () => {
    useComponentDetailMock.mockReturnValue({
      component: null,
      loading: false,
      error: null,
      mutationError: null,
      saving: false,
      deleting: false,
      clearMutationError: clearMutationErrorMock,
      refetch: vi.fn(),
      updateComponent: updateComponentMock,
      deleteComponent: vi.fn(),
    });
    createComponentMock.mockResolvedValue({ id: "created-component" });

    render(<ComponentEditor />);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Variant Payload Component" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Variant" }));
    fireEvent.click(screen.getByRole("button", { name: "Create Component" }));

    await waitFor(() => {
      expect(createComponentMock).toHaveBeenCalled();
      expect(navigationState.navigateToLibrary).toHaveBeenCalledTimes(1);
    });

    const createPayload = createComponentMock.mock.calls[0]?.[0] as {
      variants: Array<{
        componentId: string;
        canonicalCode: string;
        humanLabel: string;
        isDefault: boolean;
      }>;
    };

    expect(createPayload.variants).toHaveLength(2);
    expect(createPayload.variants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          componentId: "temp",
          canonicalCode: "variant-1",
          humanLabel: "Variant 1",
          isDefault: true,
        }),
        expect.objectContaining({
          componentId: "temp",
          canonicalCode: "variant-2",
          humanLabel: "Variant 2",
          isDefault: false,
        }),
      ]),
    );
  });

  it("updates an existing component and returns to the library", async () => {
    updateComponentMock.mockResolvedValue(existingComponent);

    mockSchematicDocument.symbols = [
      { id: "sym-1", componentId: "component-1" },
      { id: "sym-2", componentId: "component-1" },
    ];

    render(<ComponentEditor componentId="component-1" />);

    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Updated resistor description" },
    });
    fireEvent.change(screen.getByLabelText("Tags"), {
      target: { value: "passive, precision" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save Component" }));

    await waitFor(() => {
      expect(updateComponentMock).toHaveBeenCalledWith({
        displayLabel: "Resistor 0603",
        description: "Updated resistor description",
        categoryPath: "Passives/Resistors",
        tags: ["passive", "precision"],
        symbolData: transformedSymbolData,
      });
      expect(
        transformSymbolDraftToComponentSymbolDataMock,
      ).toHaveBeenCalledWith(symbolDraft, existingComponent.symbolData);
      expect(refetchAndPropagateMock).toHaveBeenCalledTimes(1);
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Component updated",
          description: "2 instances in open designs refreshed.",
        }),
      );
      expect(navigationState.navigateToLibrary).toHaveBeenCalledTimes(1);
    });
  });

  it("cancels back to the library", async () => {
    render(<ComponentEditor componentId="component-1" />);

    await waitFor(() => {
      expect(loadSymbolDraftFromComponentMock).toHaveBeenCalledWith(
        existingComponent,
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(clearCreateErrorMock).toHaveBeenCalledTimes(1);
    expect(clearMutationErrorMock).toHaveBeenCalledTimes(1);
    expect(navigationState.navigateToLibrary).toHaveBeenCalledTimes(1);
  });
});
