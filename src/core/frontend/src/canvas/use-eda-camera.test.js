import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDA_WHEEL_OPTIONS,
  isLikelyTrackpadWheelEvent,
  normalizePanDelta,
  normalizeZoomDelta,
} from "../../../../shared/frontend/canvas/camera/use-eda-camera";

function wheelEvent(overrides = {}) {
  return {
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
    ...overrides,
  };
}

describe("use-eda-camera wheel policy", () => {
  it("keeps strict defaults for shared navigation", () => {
    expect(DEFAULT_EDA_WHEEL_OPTIONS).toEqual({
      enabled: true,
      pinchZoom: true,
      trackpadScroll: "pan",
      zoomAnchor: "cursor",
    });
  });

  it("detects likely trackpad pixel scroll and ignores pinch gestures", () => {
    expect(
      isLikelyTrackpadWheelEvent(wheelEvent({ deltaY: 2.35, deltaMode: 0 })),
    ).toBe(true);
    expect(
      isLikelyTrackpadWheelEvent(wheelEvent({ deltaY: 5, deltaMode: 0 })),
    ).toBe(true);
    expect(
      isLikelyTrackpadWheelEvent(wheelEvent({ deltaY: 100, deltaMode: 0 })),
    ).toBe(false);
    expect(
      isLikelyTrackpadWheelEvent(
        wheelEvent({ deltaY: 3, deltaMode: 0, ctrlKey: true }),
      ),
    ).toBe(false);
    expect(
      isLikelyTrackpadWheelEvent(
        wheelEvent({ deltaY: 3, deltaMode: 0, metaKey: true }),
      ),
    ).toBe(false);
    expect(
      isLikelyTrackpadWheelEvent(wheelEvent({ deltaY: 1, deltaMode: 1 })),
    ).toBe(false);
    // horizontal component detects trackpad two-finger scroll
    expect(
      isLikelyTrackpadWheelEvent(
        wheelEvent({ deltaX: 12, deltaY: 100, deltaMode: 0 }),
      ),
    ).toBe(true);
    // mouse wheel: large delta, no horizontal, integer — not trackpad
    expect(
      isLikelyTrackpadWheelEvent(
        wheelEvent({ deltaX: 0, deltaY: 120, deltaMode: 0 }),
      ),
    ).toBe(false);
  });

  it("normalizes zoom deltas with correct sign and pinch amplification", () => {
    expect(
      normalizeZoomDelta(wheelEvent({ deltaY: -100, deltaMode: 0 })),
    ).toBeGreaterThan(0);
    expect(
      normalizeZoomDelta(wheelEvent({ deltaY: 100, deltaMode: 0 })),
    ).toBeLessThan(0);

    const plain = normalizeZoomDelta(wheelEvent({ deltaY: -2, deltaMode: 0 }));
    const pinch = normalizeZoomDelta(
      wheelEvent({ deltaY: -2, deltaMode: 0, ctrlKey: true }),
    );
    expect(Math.abs(pinch)).toBeGreaterThan(Math.abs(plain));
  });

  it("keeps pan normalization deterministic for line and page modes", () => {
    expect(
      normalizePanDelta(wheelEvent({ deltaX: 1, deltaY: 2, deltaMode: 0 })),
    ).toEqual({
      dx: 1,
      dy: 2,
    });
    expect(
      normalizePanDelta(wheelEvent({ deltaX: 1, deltaY: 2, deltaMode: 1 })),
    ).toEqual({
      dx: 40,
      dy: 80,
    });
    expect(
      normalizePanDelta(wheelEvent({ deltaX: 1, deltaY: 2, deltaMode: 2 })),
    ).toEqual({
      dx: 800,
      dy: 1600,
    });
  });
});
