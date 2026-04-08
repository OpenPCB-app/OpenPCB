import { describe, expect, it } from "vitest";
import {
  getWheelNavigationAction,
  normalizeZoomDelta,
  normalizePanDelta,
} from "@/lib/render-engine/camera/use-eda-camera";

function makeWheelEvent(
  overrides: Partial<
    Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode" | "ctrlKey">
  >,
): WheelEvent {
  return {
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    ...overrides,
  } as unknown as WheelEvent;
}

describe("normalizeZoomDelta", () => {
  it("returns positive value for scroll-up (zoom in) in pixel mode", () => {
    const e = makeWheelEvent({ deltaY: -100, ctrlKey: true });
    expect(normalizeZoomDelta(e)).toBeGreaterThan(0);
  });

  it("returns negative value for scroll-down (zoom out) in pixel mode", () => {
    const e = makeWheelEvent({ deltaY: 100, ctrlKey: true });
    expect(normalizeZoomDelta(e)).toBeLessThan(0);
  });

  it("applies ctrlKey multiplier (10x) for pinch events", () => {
    const withCtrl = normalizeZoomDelta(
      makeWheelEvent({ deltaY: -3, ctrlKey: true }),
    );
    const without = normalizeZoomDelta(
      makeWheelEvent({ deltaY: -3, ctrlKey: false }),
    );
    expect(withCtrl).toBeCloseTo(without * 10);
  });

  it("handles deltaMode LINE (Firefox mouse wheel)", () => {
    const e = makeWheelEvent({ deltaY: -3, deltaMode: 1, ctrlKey: true });
    const result = normalizeZoomDelta(e);
    // LINE mode uses 0.05 multiplier vs 0.002 for pixel mode
    expect(result).toBeGreaterThan(0);
    expect(Math.abs(result)).toBeGreaterThan(0);
  });

  it("handles deltaMode PAGE", () => {
    const e = makeWheelEvent({ deltaY: -1, deltaMode: 2, ctrlKey: true });
    const result = normalizeZoomDelta(e);
    expect(result).toBeGreaterThan(0);
  });
});

describe("normalizePanDelta", () => {
  it("passes through pixel-mode deltas unchanged", () => {
    const e = makeWheelEvent({ deltaX: 15, deltaY: -20, deltaMode: 0 });
    expect(normalizePanDelta(e)).toEqual({ dx: 15, dy: -20 });
  });

  it("multiplies line-mode deltas by 40", () => {
    const e = makeWheelEvent({ deltaX: 1, deltaY: -3, deltaMode: 1 });
    expect(normalizePanDelta(e)).toEqual({ dx: 40, dy: -120 });
  });

  it("multiplies page-mode deltas by 800", () => {
    const e = makeWheelEvent({ deltaX: 1, deltaY: -1, deltaMode: 2 });
    expect(normalizePanDelta(e)).toEqual({ dx: 800, dy: -800 });
  });

  it("returns zero deltas for zero input", () => {
    const e = makeWheelEvent({ deltaX: 0, deltaY: 0 });
    expect(normalizePanDelta(e)).toEqual({ dx: 0, dy: 0 });
  });
});

describe("getWheelNavigationAction", () => {
  it("treats plain mouse-wheel input as zoom", () => {
    const e = makeWheelEvent({ deltaY: 100, deltaMode: 1, ctrlKey: false });
    expect(getWheelNavigationAction(e)).toBe("zoom");
  });

  it("treats shift-wheel input as pan", () => {
    const e = makeWheelEvent({
      deltaY: 100,
      deltaMode: 0,
      ctrlKey: false,
      shiftKey: true,
    } as Partial<WheelEvent>);
    expect(getWheelNavigationAction(e as WheelEvent)).toBe("pan");
  });

  it("treats trackpad-like pixel deltas as pan", () => {
    const e = makeWheelEvent({ deltaY: 20, deltaMode: 0, ctrlKey: false });
    expect(getWheelNavigationAction(e)).toBe("pan");
  });

  it("treats pinch gestures as zoom", () => {
    const e = makeWheelEvent({ deltaY: 3, deltaMode: 0, ctrlKey: true });
    expect(getWheelNavigationAction(e)).toBe("zoom");
  });
});
