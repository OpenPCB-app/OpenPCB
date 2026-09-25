import { describe, expect, it } from "vitest";
import { nextRovingIndex } from "./roving";

describe("nextRovingIndex", () => {
  it("moves and wraps horizontally", () => {
    expect(nextRovingIndex({ key: "ArrowRight", current: 0, count: 3 })).toBe(1);
    expect(nextRovingIndex({ key: "ArrowRight", current: 2, count: 3 })).toBe(0);
    expect(nextRovingIndex({ key: "ArrowLeft", current: 0, count: 3 })).toBe(2);
  });

  it("jumps with Home/End", () => {
    expect(nextRovingIndex({ key: "Home", current: 2, count: 4 })).toBe(0);
    expect(nextRovingIndex({ key: "End", current: 0, count: 4 })).toBe(3);
  });

  it("skips disabled items", () => {
    const isDisabled = (i: number) => i === 1;
    expect(nextRovingIndex({ key: "ArrowRight", current: 0, count: 3, isDisabled })).toBe(2);
    expect(nextRovingIndex({ key: "Home", current: 2, count: 3, isDisabled: (i) => i === 0 })).toBe(1);
  });

  it("uses Up/Down for vertical and ignores other keys", () => {
    expect(nextRovingIndex({ key: "ArrowDown", current: 0, count: 2, orientation: "vertical" })).toBe(1);
    expect(nextRovingIndex({ key: "ArrowRight", current: 0, count: 2, orientation: "vertical" })).toBeNull();
    expect(nextRovingIndex({ key: "a", current: 0, count: 2 })).toBeNull();
  });

  it("returns null when nothing is focusable", () => {
    expect(nextRovingIndex({ key: "ArrowRight", current: 0, count: 0 })).toBeNull();
    expect(nextRovingIndex({ key: "ArrowRight", current: 0, count: 2, isDisabled: () => true })).toBeNull();
  });
});
