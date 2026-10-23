import { describe, expect, test } from "vitest";
import type { DesignerSchematicProjection } from "../../../../sdks";
import { detachedErcAnchorTarget } from "./erc-anchor-target";

const projection: DesignerSchematicProjection = {
  designId: "design",
  revision: 1,
  parts: [],
  wires: [],
  nets: [],
  junctions: [],
  labels: [
    { id: "label", text: "SIG", positionNm: { x: 2_000_000, y: 3_000_000 } },
  ],
  primitives: [
    {
      id: "port",
      kind: "pwr",
      railText: "VCC",
      positionNm: { x: 4_000_000, y: 5_000_000 },
      rotationDeg: 0,
    },
  ],
};

describe("ERC detached-anchor navigation", () => {
  test("labels select their entity and frame their actual position", () => {
    expect(
      detachedErcAnchorTarget({ kind: "label", labelId: "label" }, projection),
    ).toEqual({
      selection: { labelIds: ["label"] },
      bounds: { minX: -3, minY: -2, maxX: 7, maxY: 8 },
      label: "SIG",
    });
  });

  test("ports frame their actual position without inventing a canvas selection", () => {
    expect(
      detachedErcAnchorTarget(
        { kind: "primitive", primitiveId: "port" },
        projection,
      ),
    ).toEqual({
      selection: {},
      bounds: { minX: -1, minY: 0, maxX: 9, maxY: 10 },
      label: "VCC",
    });
  });

  test("stale entity ids have no target", () => {
    expect(
      detachedErcAnchorTarget(
        { kind: "label", labelId: "missing" },
        projection,
      ),
    ).toBeNull();
    expect(
      detachedErcAnchorTarget(
        { kind: "primitive", primitiveId: "missing" },
        projection,
      ),
    ).toBeNull();
  });
});
