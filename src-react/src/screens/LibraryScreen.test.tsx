import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LibraryScreen } from "./LibraryScreen";

const mockComponents = [
  {
    id: "built-in-ground",
    displayLabel: "Ground",
    canonicalKey: "ground",
    description: "Ground reference symbol",
    scope: "built_in",
    categoryPath: "Power",
    symbolData: {
      referencePrefix: "GND",
      pinDefinitions: [{ name: "GND", electricalType: "power_in" }],
      properties: {},
    },
    packageVariants: [],
    defaultPackageVariantId: null,
    tags: [],
  },
  {
    id: "built-in-resistor",
    displayLabel: "Resistor",
    canonicalKey: "resistor",
    description: "Generic resistor",
    scope: "built_in",
    categoryPath: "Passives/Resistors",
    symbolData: {
      referencePrefix: "R",
      pinDefinitions: [{ name: "1", electricalType: "passive" }, { name: "2", electricalType: "passive" }],
      properties: {},
    },
    packageVariants: [],
    defaultPackageVariantId: null,
    tags: [],
  },
];

let mockFilters: { search?: string; scope?: string; mountTypes?: string[] } = {};

vi.mock("@/hooks/useComponents", () => ({
  useComponents: vi.fn((initialFilters?: { search?: string }) => {
    mockFilters = initialFilters ?? {};
    const search = initialFilters?.search?.toLowerCase();
    const filtered = search
      ? mockComponents.filter((c) =>
          c.displayLabel.toLowerCase().includes(search)
        )
      : mockComponents;
    return {
      components: filtered,
      loading: false,
      error: null,
      refetch: vi.fn(),
      filters: mockFilters,
      setFilters: vi.fn(),
    };
  }),
}));

vi.mock("@/hooks/useDrafts", () => ({
  useDrafts: vi.fn(() => ({
    drafts: [],
    loading: false,
    refetch: vi.fn(),
  })),
}));

describe("LibraryScreen", () => {
  it("shows only Ground and Resistor cards without fake procurement metadata", () => {
    render(<LibraryScreen />);

    expect(screen.getByText("Ground")).toBeInTheDocument();
    expect(screen.getByText("Resistor")).toBeInTheDocument();
    expect(screen.queryByText("ESP32-S3")).not.toBeInTheDocument();
    expect(screen.queryByText("USB-C Connector")).not.toBeInTheDocument();
    expect(screen.queryByText("$0.002")).not.toBeInTheDocument();
    expect(screen.queryByText("45K")).not.toBeInTheDocument();
  });

  it("filters the built-in list by search query", () => {
    render(<LibraryScreen />);

    fireEvent.change(screen.getByPlaceholderText("Search components..."), {
      target: { value: "ground" },
    });

    expect(screen.getByText("Ground")).toBeInTheDocument();
    expect(screen.queryByText("Resistor")).not.toBeInTheDocument();
  });
});
