import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useComponents,
  useComponentDetail,
  useComponentMutations,
} from "./useComponents";

const listComponentsMock = vi.fn();
const getComponentMock = vi.fn();
const createComponentMock = vi.fn();
const updateComponentMock = vi.fn();
const deleteComponentMock = vi.fn();
const getComponentDeleteImpactMock = vi.fn();
const setComponentLibraryMock = vi.fn();

const baseComponent = {
  id: "component-1",
  displayLabel: "Precision Op Amp",
  canonicalKey: "precision-op-amp",
  description: "Low noise amplifier",
  scope: "workspace",
  categoryPath: "Analog/Amplifiers",
  symbolData: {
    referencePrefix: "U",
    pinDefinitions: [],
    properties: {},
    unitCount: 1,
    bodyGraphics: [],
    rawKicadSource: null,
  },
  packageVariants: [],
  defaultPackageVariantId: null,
  tags: ["analog"],
};

vi.mock("@/lib/api/component-api", () => ({
  listComponents: (...args: unknown[]) => listComponentsMock(...args),
  getComponent: (...args: unknown[]) => getComponentMock(...args),
  createComponent: (...args: unknown[]) => createComponentMock(...args),
  updateComponent: (...args: unknown[]) => updateComponentMock(...args),
  deleteComponent: (...args: unknown[]) => deleteComponentMock(...args),
  deleteComponentWithOptions: (...args: unknown[]) => deleteComponentMock(...args),
  getComponentDeleteImpact: (...args: unknown[]) =>
    getComponentDeleteImpactMock(...args),
}));

vi.mock("@/stores/schematic-store", () => ({
  useSchematicStore: {
    getState: () => ({
      setComponentLibrary: setComponentLibraryMock,
    }),
  },
}));

describe("useComponents", () => {
  beforeEach(() => {
    listComponentsMock.mockReset();
    getComponentMock.mockReset();
    createComponentMock.mockReset();
    updateComponentMock.mockReset();
    deleteComponentMock.mockReset();
    setComponentLibraryMock.mockReset();
    getComponentDeleteImpactMock.mockReset();

    listComponentsMock.mockResolvedValue([baseComponent]);
    getComponentMock.mockResolvedValue(baseComponent);
    createComponentMock.mockResolvedValue(baseComponent);
    updateComponentMock.mockResolvedValue({
      ...baseComponent,
      displayLabel: "Updated Op Amp",
    });
    deleteComponentMock.mockResolvedValue(undefined);
    getComponentDeleteImpactMock.mockResolvedValue({
      usageCount: 0,
      designNames: [],
    });
  });

  it("forwards backend-supported filters to listComponents", async () => {
    const { result } = renderHook(() =>
      useComponents({
        search: "amp",
        mountType: "smd",
        categoryPath: "Analog/Amplifiers",
        tags: ["analog", "precision"],
      }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(listComponentsMock).toHaveBeenCalledWith({
      search: "amp",
      mountType: "smd",
      categoryPath: "Analog/Amplifiers",
      tags: ["analog", "precision"],
    });
    expect(result.current.components).toEqual([baseComponent]);
  });

  it("refetches with updated filters without client-side stopgap filtering", async () => {
    const { result } = renderHook(() => useComponents());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setFilters({ mountType: "through_hole", search: "sensor" });
    });

    await waitFor(() => {
      expect(listComponentsMock).toHaveBeenLastCalledWith({
        mountType: "through_hole",
        search: "sensor",
      });
    });
  });

  it("refetchAndPropagate refreshes the schematic component library", async () => {
    const propagatedComponent = {
      ...baseComponent,
      displayLabel: "Propagated Op Amp",
    };
    listComponentsMock
      .mockResolvedValueOnce([baseComponent])
      .mockResolvedValueOnce([propagatedComponent]);

    const { result } = renderHook(() => useComponents({ search: "amp" }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.refetchAndPropagate();
    });

    expect(listComponentsMock).toHaveBeenLastCalledWith({ search: "amp" });
    expect(result.current.components).toEqual([propagatedComponent]);
    expect(setComponentLibraryMock).toHaveBeenCalledWith([propagatedComponent]);
    expect(result.current.error).toBeNull();
  });

  it("refetchAndPropagate does not overwrite the propagated library on failure", async () => {
    listComponentsMock
      .mockResolvedValueOnce([baseComponent])
      .mockRejectedValueOnce(new Error("backend unavailable"));

    const { result } = renderHook(() => useComponents({ search: "amp" }));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.refetchAndPropagate();
    });

    expect(setComponentLibraryMock).not.toHaveBeenCalled();
    expect(result.current.components).toEqual([baseComponent]);
    expect(result.current.error).toBe("backend unavailable");
  });

  it("creates, updates, and deletes components through the unified mutation layer", async () => {
    const { result } = renderHook(() => useComponentMutations());

    await act(async () => {
      await result.current.createComponent({ displayLabel: "New Component" });
      await result.current.updateComponent("component-1", {
        displayLabel: "Updated Op Amp",
      });
      await result.current.deleteComponent("component-1");
    });

    expect(createComponentMock).toHaveBeenCalledWith({ displayLabel: "New Component" });
    expect(updateComponentMock).toHaveBeenCalledWith("component-1", {
      displayLabel: "Updated Op Amp",
    });
    expect(deleteComponentMock).toHaveBeenCalledWith("component-1", undefined);
    expect(result.current.error).toBeNull();
  });

  it("binds detail queries and mutations to one component id", async () => {
    const { result } = renderHook(() => useComponentDetail("component-1"));

    await waitFor(() => {
      expect(result.current.component?.id).toBe("component-1");
    });

    await act(async () => {
      await result.current.updateComponent({ displayLabel: "Updated Op Amp" });
    });

    expect(updateComponentMock).toHaveBeenCalledWith("component-1", {
      displayLabel: "Updated Op Amp",
    });
    expect(result.current.component?.displayLabel).toBe("Updated Op Amp");

    await act(async () => {
      await result.current.deleteComponent();
    });

    expect(deleteComponentMock).toHaveBeenCalledWith("component-1", undefined);
    expect(result.current.component).toBeNull();
  });
});
