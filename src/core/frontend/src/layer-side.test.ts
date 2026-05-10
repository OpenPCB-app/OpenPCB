import { describe, expect, test } from "vitest";
import {
  flipLayerSide,
  placementContributingLayers,
} from "@shared/frontend/canvas/scene/layer-side";

describe("flipLayerSide", () => {
  test("swaps F.* and B.* prefixes for paired layers", () => {
    expect(flipLayerSide("F.Cu")).toBe("B.Cu");
    expect(flipLayerSide("B.Cu")).toBe("F.Cu");
    expect(flipLayerSide("F.SilkS")).toBe("B.SilkS");
    expect(flipLayerSide("B.SilkS")).toBe("F.SilkS");
    expect(flipLayerSide("F.Mask")).toBe("B.Mask");
    expect(flipLayerSide("F.Paste")).toBe("B.Paste");
    expect(flipLayerSide("F.CrtYd")).toBe("B.CrtYd");
    expect(flipLayerSide("F.Fab")).toBe("B.Fab");
  });

  test("passes layer-agnostic layers through unchanged", () => {
    expect(flipLayerSide("*.Cu")).toBe("*.Cu");
    expect(flipLayerSide("Edge.Cuts")).toBe("Edge.Cuts");
  });

  test("passes undefined / empty through", () => {
    expect(flipLayerSide(undefined)).toBeUndefined();
    expect(flipLayerSide("")).toBe("");
  });

  test("is involutive: flip(flip(x)) === x", () => {
    for (const layer of [
      "F.Cu",
      "B.Cu",
      "F.SilkS",
      "B.SilkS",
      "F.Mask",
      "B.Mask",
      "F.Paste",
      "B.Paste",
      "F.CrtYd",
      "B.CrtYd",
      "F.Fab",
      "B.Fab",
      "*.Cu",
      "Edge.Cuts",
    ]) {
      expect(flipLayerSide(flipLayerSide(layer))).toBe(layer);
    }
  });
});

describe("placementContributingLayers", () => {
  test("F.Cu placement contributes F.* layers", () => {
    const set = placementContributingLayers("F.Cu");
    expect(set.has("F.Cu")).toBe(true);
    expect(set.has("F.SilkS")).toBe(true);
    expect(set.has("B.Cu")).toBe(false);
    expect(set.has("B.SilkS")).toBe(false);
  });

  test("B.Cu placement contributes B.* layers", () => {
    const set = placementContributingLayers("B.Cu");
    expect(set.has("B.Cu")).toBe(true);
    expect(set.has("B.SilkS")).toBe(true);
    expect(set.has("F.Cu")).toBe(false);
    expect(set.has("F.SilkS")).toBe(false);
  });

  test("through-hole + edge layers always contribute", () => {
    expect(placementContributingLayers("F.Cu").has("*.Cu")).toBe(true);
    expect(placementContributingLayers("B.Cu").has("*.Cu")).toBe(true);
    expect(placementContributingLayers("F.Cu").has("Edge.Cuts")).toBe(true);
  });
});
