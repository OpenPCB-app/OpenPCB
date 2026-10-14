import { afterEach, describe, expect, it, vi } from "vitest";
import { clampMenuPosition, shouldOpenAppMenu } from "./context-menu-policy";

const input = {
  tagName: "INPUT",
  getAttribute: () => null,
  closest: () => null,
} as unknown as EventTarget;

afterEach(() => vi.unstubAllGlobals());

describe("shell menu policy", () => {
  it("leaves an already consumed row event alone", () => {
    expect(shouldOpenAppMenu({ defaultPrevented: true, target: null })).toBe(
      false,
    );
  });
  it("recognizes native editable targets along a shadow composed path", () => {
    expect(
      shouldOpenAppMenu({
        defaultPrevented: false,
        target: null,
        nativeEvent: { composedPath: () => [input] },
      }),
    ).toBe(false);
  });
  it("leaves native Copy available for selected non-editable text", () => {
    vi.stubGlobal("window", {
      getSelection: () => ({ toString: () => "Selected text" }),
    });
    expect(shouldOpenAppMenu({ defaultPrevented: false, target: null })).toBe(
      false,
    );
  });
  it("clamps rendered dimensions including disabled rows, labels and separators", () => {
    expect(
      clampMenuPosition(
        { x: 1099, y: 719 },
        { width: 304, height: 184 },
        { width: 1100, height: 720 },
      ),
    ).toEqual({ x: 788, y: 528 });
  });
  it("keeps the viewport margin for a negative event position", () => {
    expect(
      clampMenuPosition(
        { x: -5, y: -5 },
        { width: 100, height: 100 },
        { width: 1100, height: 720 },
      ),
    ).toEqual({ x: 8, y: 8 });
  });
});
