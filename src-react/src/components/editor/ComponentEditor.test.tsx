import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComponentEditor } from "./ComponentEditor";

const useComponentDetailMock = vi.fn();
const useComponentMutationsMock = vi.fn();

const navigationState = {
  navigateToLibrary: vi.fn(),
};

const createComponentMock = vi.fn();
const updateComponentMock = vi.fn();
const clearCreateErrorMock = vi.fn();
const clearMutationErrorMock = vi.fn();

const existingComponent = {
  id: "component-1",
  canonicalKey: "resistor-0603",
  displayLabel: "Resistor 0603",
  description: "Generic resistor",
  scope: "workspace",
  symbolData: {
    referencePrefix: "R",
    pinDefinitions: [],
    properties: {},
    unitCount: 1,
    bodyGraphics: [],
    rawKicadSource: null,
  },
  variants: [],
  defaultVariantId: null,
  packageVariants: [],
  defaultPackageVariantId: null,
  categoryPath: "Passives/Resistors",
  tags: ["passive", "smd"],
  createdAt: "2026-04-02T10:00:00.000Z",
  updatedAt: "2026-04-02T10:00:00.000Z",
};

vi.mock("@/hooks/useComponents", () => ({
  useComponentDetail: (...args: unknown[]) => useComponentDetailMock(...args),
  useComponentMutations: (...args: unknown[]) => useComponentMutationsMock(...args),
}));

vi.mock("@/stores/navigation-store", () => ({
  useNavigationStore: (selector: (state: typeof navigationState) => unknown) =>
    selector(navigationState),
}));

describe("ComponentEditor", () => {
  beforeEach(() => {
    navigationState.navigateToLibrary.mockReset();
    createComponentMock.mockReset();
    updateComponentMock.mockReset();
    clearCreateErrorMock.mockReset();
    clearMutationErrorMock.mockReset();

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

  it("renders metadata fields and editor placeholders", () => {
    render(<ComponentEditor componentId="component-1" />);

    expect(screen.getByLabelText("Name")).toHaveValue("Resistor 0603");
    expect(screen.getByLabelText("Description")).toHaveValue("Generic resistor");
    expect(screen.getByLabelText("Category Path")).toHaveValue(
      "Passives/Resistors",
    );
    expect(screen.getByLabelText("Tags")).toHaveValue("passive, smd");
    expect(screen.getByTestId("symbol-placeholder")).toBeInTheDocument();
    expect(screen.getByTestId("footprints-placeholder")).toBeInTheDocument();
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
          canonicalKey: expect.stringMatching(/^voltage-regulator-/),
        }),
      );
      expect(navigationState.navigateToLibrary).toHaveBeenCalledTimes(1);
    });
  });

  it("updates an existing component and returns to the library", async () => {
    updateComponentMock.mockResolvedValue(existingComponent);

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
      });
      expect(navigationState.navigateToLibrary).toHaveBeenCalledTimes(1);
    });
  });

  it("cancels back to the library", () => {
    render(<ComponentEditor componentId="component-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(clearCreateErrorMock).toHaveBeenCalledTimes(1);
    expect(clearMutationErrorMock).toHaveBeenCalledTimes(1);
    expect(navigationState.navigateToLibrary).toHaveBeenCalledTimes(1);
  });
});
