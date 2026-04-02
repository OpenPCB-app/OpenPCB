import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryScreen } from "./LibraryScreen";

const useComponentsMock = vi.fn();

const navigationState = {
  navigateToComponentDetail: vi.fn(),
};

const refetchMock = vi.fn();

const mockComponents = [
  {
    id: "workspace-ground",
    displayLabel: "Ground Reference",
    canonicalKey: "ground-reference",
    description: "Ground reference symbol",
    scope: "workspace",
    categoryPath: "Power",
    symbolData: {
      referencePrefix: "GND",
      pinDefinitions: [{ name: "GND", electricalType: "power_in" }],
      properties: {},
    },
    packageVariants: [
      {
        id: "variant-ground",
        humanLabel: "Symbol Only",
      },
    ],
    defaultPackageVariantId: "variant-ground",
    tags: [],
  },
  {
    id: "workspace-resistor",
    displayLabel: "Resistor",
    canonicalKey: "resistor",
    description: "Generic resistor",
    scope: "workspace",
    categoryPath: "Passives/Resistors",
    symbolData: {
      referencePrefix: "R",
      pinDefinitions: [
        { name: "1", electricalType: "passive" },
        { name: "2", electricalType: "passive" },
      ],
      properties: {},
    },
    packageVariants: [
      {
        id: "variant-resistor-0603",
        humanLabel: "0603",
      },
      {
        id: "variant-resistor-0805",
        humanLabel: "0805",
      },
    ],
    defaultPackageVariantId: "variant-resistor-0603",
    tags: [],
  },
];

let latestFilters: Record<string, unknown> = {};

vi.mock("@/hooks/useComponents", () => ({
  useComponents: (...args: unknown[]) => useComponentsMock(...args),
}));

vi.mock("@/stores/navigation-store", () => ({
  useNavigationStore: (selector: (state: typeof navigationState) => unknown) =>
    selector(navigationState),
}));

vi.mock("@/components/unified-import/UnifiedImportModal", () => ({
  UnifiedImportModal: () => null,
}));

describe("LibraryScreen", () => {
  beforeEach(() => {
    latestFilters = {};
    refetchMock.mockReset();
    navigationState.navigateToComponentDetail.mockReset();

    useComponentsMock.mockImplementation((initialFilters?: Record<string, unknown>) => {
      latestFilters = initialFilters ?? {};
      const search = typeof initialFilters?.search === "string"
        ? initialFilters.search.toLowerCase()
        : null;
      const filtered = search
        ? mockComponents.filter((component) =>
            component.displayLabel.toLowerCase().includes(search),
          )
        : mockComponents;

      return {
        components: filtered,
        loading: false,
        error: null,
        refetch: refetchMock,
        filters: initialFilters ?? {},
        setFilters: vi.fn(),
      };
    });
  });

  it("renders workspace components without scope or draft affordances", () => {
    render(<LibraryScreen />);

    expect(screen.getByText("Ground Reference")).toBeInTheDocument();
    expect(screen.getByText("Resistor")).toBeInTheDocument();
    expect(screen.queryByText("Pending Drafts")).not.toBeInTheDocument();
    expect(screen.queryByText("Built-in")).not.toBeInTheDocument();
    expect(screen.queryByText("Workspace")).not.toBeInTheDocument();
    expect(screen.queryByText("Continue")).not.toBeInTheDocument();
  });

  it("passes search and single mount filters into useComponents", () => {
    render(<LibraryScreen />);

    fireEvent.change(screen.getByPlaceholderText("Search components..."), {
      target: { value: "ground" },
    });

    expect(latestFilters).toMatchObject({ search: "ground" });
    expect(screen.getByText("Ground Reference")).toBeInTheDocument();
    expect(screen.queryByText("Resistor")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "SMD" }));
    expect(latestFilters).toMatchObject({ search: "ground", mountType: "smd" });

    fireEvent.click(screen.getByRole("button", { name: "SMD" }));
    expect(latestFilters).toMatchObject({ search: "ground", mountType: undefined });
  });

  it("opens the canonical editor when creating a component", async () => {
    render(<LibraryScreen />);

    fireEvent.click(screen.getByRole("button", { name: "New" }));

    await waitFor(() => {
      expect(navigationState.navigateToComponentDetail).toHaveBeenCalledWith();
    });
  });
});
