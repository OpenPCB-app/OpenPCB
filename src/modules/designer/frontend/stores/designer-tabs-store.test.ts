import { beforeEach, describe, expect, test, vi } from "vitest";

// jsdom isn't enabled for this workspace; stub localStorage before importing
// the store so zustand/persist can hydrate without crashing.
const memoryStorage: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (k in memoryStorage ? memoryStorage[k] : null),
  setItem: (k: string, v: string) => {
    memoryStorage[k] = v;
  },
  removeItem: (k: string) => {
    delete memoryStorage[k];
  },
  clear: () => {
    for (const k of Object.keys(memoryStorage)) delete memoryStorage[k];
  },
  key: (i: number) => Object.keys(memoryStorage)[i] ?? null,
  get length() {
    return Object.keys(memoryStorage).length;
  },
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useDesignerTabsStore } = await import("./designer-tabs-store");

function reset() {
  useDesignerTabsStore.setState({ openDesignIds: [], activeDesignId: null });
}

describe("designer-tabs-store", () => {
  beforeEach(reset);

  test("openTab appends and activates", () => {
    useDesignerTabsStore.getState().openTab("a");
    useDesignerTabsStore.getState().openTab("b");
    const s = useDesignerTabsStore.getState();
    expect(s.openDesignIds).toEqual(["a", "b"]);
    expect(s.activeDesignId).toBe("b");
  });

  test("openTab on existing id just re-activates without reordering", () => {
    useDesignerTabsStore.getState().openTab("a");
    useDesignerTabsStore.getState().openTab("b");
    useDesignerTabsStore.getState().openTab("a");
    const s = useDesignerTabsStore.getState();
    expect(s.openDesignIds).toEqual(["a", "b"]);
    expect(s.activeDesignId).toBe("a");
  });

  test("closeTab selects right neighbor when closing active", () => {
    const s = useDesignerTabsStore.getState();
    s.openTab("a");
    s.openTab("b");
    s.openTab("c");
    s.setActive("b");
    const result = useDesignerTabsStore.getState().closeTab("b");
    expect(result.nextActiveId).toBe("c");
    const after = useDesignerTabsStore.getState();
    expect(after.openDesignIds).toEqual(["a", "c"]);
    expect(after.activeDesignId).toBe("c");
  });

  test("closeTab falls back to left when no right neighbor", () => {
    const s = useDesignerTabsStore.getState();
    s.openTab("a");
    s.openTab("b");
    s.setActive("b");
    const result = useDesignerTabsStore.getState().closeTab("b");
    expect(result.nextActiveId).toBe("a");
    expect(useDesignerTabsStore.getState().activeDesignId).toBe("a");
  });

  test("closeTab on the only tab yields null active", () => {
    useDesignerTabsStore.getState().openTab("a");
    const result = useDesignerTabsStore.getState().closeTab("a");
    expect(result.nextActiveId).toBeNull();
    const after = useDesignerTabsStore.getState();
    expect(after.openDesignIds).toEqual([]);
    expect(after.activeDesignId).toBeNull();
  });

  test("closeTab on non-active does not change active", () => {
    const s = useDesignerTabsStore.getState();
    s.openTab("a");
    s.openTab("b");
    s.openTab("c");
    s.setActive("b");
    useDesignerTabsStore.getState().closeTab("a");
    expect(useDesignerTabsStore.getState().activeDesignId).toBe("b");
    expect(useDesignerTabsStore.getState().openDesignIds).toEqual(["b", "c"]);
  });

  test("closeOthers keeps only the target", () => {
    const s = useDesignerTabsStore.getState();
    s.openTab("a");
    s.openTab("b");
    s.openTab("c");
    useDesignerTabsStore.getState().closeOthers("b");
    const after = useDesignerTabsStore.getState();
    expect(after.openDesignIds).toEqual(["b"]);
    expect(after.activeDesignId).toBe("b");
  });

  test("closeAll empties the strip", () => {
    const s = useDesignerTabsStore.getState();
    s.openTab("a");
    s.openTab("b");
    useDesignerTabsStore.getState().closeAll();
    const after = useDesignerTabsStore.getState();
    expect(after.openDesignIds).toEqual([]);
    expect(after.activeDesignId).toBeNull();
  });

  test("reorder moves tab to new index", () => {
    const s = useDesignerTabsStore.getState();
    s.openTab("a");
    s.openTab("b");
    s.openTab("c");
    useDesignerTabsStore.getState().reorder(0, 2);
    expect(useDesignerTabsStore.getState().openDesignIds).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  test("reorder is a no-op for out-of-range indices", () => {
    const s = useDesignerTabsStore.getState();
    s.openTab("a");
    s.openTab("b");
    useDesignerTabsStore.getState().reorder(5, 0);
    expect(useDesignerTabsStore.getState().openDesignIds).toEqual(["a", "b"]);
  });

  test("pruneMissing drops unknown ids and reselects active", () => {
    const s = useDesignerTabsStore.getState();
    s.openTab("a");
    s.openTab("b");
    s.openTab("c");
    s.setActive("c");
    useDesignerTabsStore.getState().pruneMissing(new Set(["a", "b"]));
    const after = useDesignerTabsStore.getState();
    expect(after.openDesignIds).toEqual(["a", "b"]);
    expect(after.activeDesignId).toBe("a");
  });

  test("pruneMissing keeps state when nothing changes", () => {
    const s = useDesignerTabsStore.getState();
    s.openTab("a");
    s.openTab("b");
    const before = useDesignerTabsStore.getState();
    useDesignerTabsStore.getState().pruneMissing(new Set(["a", "b"]));
    const after = useDesignerTabsStore.getState();
    expect(after.openDesignIds).toBe(before.openDesignIds);
    expect(after.activeDesignId).toBe(before.activeDesignId);
  });
});
