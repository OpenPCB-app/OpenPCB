import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDesigns } from "./useDesigns";

const fetchDesigns = vi.fn();
const createDesign = vi.fn();
const updateDesign = vi.fn();
const deleteDesign = vi.fn();

type AppStoreState = {
  designsByScope: Record<string, Array<{ id: string; name: string }>>;
  fetchDesigns: typeof fetchDesigns;
  createDesign: typeof createDesign;
  updateDesign: typeof updateDesign;
  deleteDesign: typeof deleteDesign;
};

let storeState: AppStoreState;

vi.mock("@/stores/app-store", () => ({
  useAppStore: (selector: (state: AppStoreState) => unknown) => selector(storeState),
}));

describe("useDesigns", () => {
  beforeEach(() => {
    fetchDesigns.mockReset();
    createDesign.mockReset();
    updateDesign.mockReset();
    deleteDesign.mockReset();

    storeState = {
      designsByScope: {},
      fetchDesigns,
      createDesign,
      updateDesign,
      deleteDesign,
    };
  });

  it("returns a stable empty list when no designs are cached yet", () => {
    const { result, rerender } = renderHook(() =>
      useDesigns({ workspaceId: "workspace-1", projectId: "project-1" }),
    );

    const firstDesigns = result.current.designs;
    rerender();

    expect(result.current.designs).toBe(firstDesigns);
  });
});
