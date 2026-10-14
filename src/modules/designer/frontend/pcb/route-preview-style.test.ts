import { describe, expect, it } from "vitest";
import {
  ROUTE_PREVIEW_ILLEGAL,
  ROUTE_PREVIEW_ILLEGAL_OPACITY,
} from "./drc/drc-colors";
import { routePreviewStyle } from "./route-preview-style";

describe("routePreviewStyle", () => {
  it("keeps the layer color when legal", () => {
    expect(
      routePreviewStyle({ blocked: false, blockingCount: 0, layerColor: "#f00" }),
    ).toEqual({ color: "#f00", opacity: 1, illegal: false });
  });
  it("is illegal when walkaround is blocked", () => {
    expect(
      routePreviewStyle({ blocked: true, blockingCount: 0, layerColor: "#f00" }),
    ).toEqual({
      color: ROUTE_PREVIEW_ILLEGAL,
      opacity: ROUTE_PREVIEW_ILLEGAL_OPACITY,
      illegal: true,
    });
  });
  it("is illegal when live DRC has blocking violations", () => {
    expect(
      routePreviewStyle({ blocked: false, blockingCount: 2, layerColor: "#00f" })
        .illegal,
    ).toBe(true);
  });
});
