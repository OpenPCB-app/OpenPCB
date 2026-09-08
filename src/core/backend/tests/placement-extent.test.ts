/**
 * `placementKeepoutExtentMm` (zone/keepout contract §4): the three-branch
 * resolution of a placement's world extent for the keepout `footprints`
 * restriction. Every branch must be a SUPERSET of the part, and the branches
 * must be tried in order — a pad-only hull misses the body.
 */
import { describe, expect, test } from "bun:test";
import { placementKeepoutExtentMm } from "../../../modules/designer/backend/pcb/placement-extent";
import { boundsOfPoints } from "../../../shared/pcb-geometry/region-rings";
import type { PcbPlacedPart, PcbPointMm } from "../../../sdks/designer";

type Preview = PcbPlacedPart["footprint"]["preview"];

function placement(
  opts: {
    positionMm?: PcbPointMm;
    rotationDeg?: number;
    layer?: PcbPlacedPart["layer"];
    mirrored?: boolean;
    graphics?: unknown[];
    bounds?: { minX: number; minY: number; maxX: number; maxY: number } | null;
  } = {},
): PcbPlacedPart {
  return {
    id: "U1",
    partId: "U1",
    componentId: "c",
    reference: "U1",
    positionMm: opts.positionMm ?? { x: 0, y: 0 },
    rotationDeg: opts.rotationDeg ?? 0,
    mirrored: opts.mirrored ?? false,
    layer: opts.layer ?? "F.Cu",
    footprint: {
      footprintId: "fp",
      name: "FP",
      mountType: null,
      sourceHash: null,
      preview: {
        kind: "footprint",
        units: "mm",
        name: "FP",
        pads: [],
        graphics: (opts.graphics ?? []) as never,
        labels: [],
        bounds: opts.bounds === undefined ? null : opts.bounds,
        warnings: [],
      } as unknown as Preview,
    },
  };
}

/** A closed courtyard rectangle as loose render-model line graphics. */
function courtyardLines(half: number): unknown[] {
  const c = [
    { x: -half, y: -half },
    { x: half, y: -half },
    { x: half, y: half },
    { x: -half, y: half },
  ];
  return c.map((a, i) => ({
    kind: "line",
    layer: "F.CrtYd",
    a,
    b: c[(i + 1) % c.length]!,
  }));
}

const PAD_RING: PcbPointMm[] = [
  { x: -0.5, y: -0.25 },
  { x: 0.5, y: -0.25 },
  { x: 0.5, y: 0.25 },
  { x: -0.5, y: 0.25 },
];

describe("placementKeepoutExtentMm", () => {
  test("the courtyard wins over the preview bounds", () => {
    const extent = placementKeepoutExtentMm(
      placement({
        graphics: courtyardLines(3),
        // Deliberately SMALLER than the courtyard: if bounds won, the extent
        // would understate the part and the verdict could go fail-open.
        bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
      }),
      [],
    );
    expect(extent).not.toBeNull();
    expect(boundsOfPoints(extent!)).toEqual({
      minX: -3,
      minY: -3,
      maxX: 3,
      maxY: 3,
    });
  });

  test("the bounds fallback rotates with the part", () => {
    const extent = placementKeepoutExtentMm(
      placement({
        positionMm: { x: 10, y: 20 },
        rotationDeg: 90,
        bounds: { minX: -2, minY: -1, maxX: 2, maxY: 1 },
      }),
      [],
    );
    expect(extent).not.toBeNull();
    // A 4x2 local box rotated 90° is 2x4 in world, centred on the position.
    expect(boundsOfPoints(extent!)).toEqual({
      minX: 9,
      minY: 18,
      maxX: 11,
      maxY: 22,
    });
  });

  test("the bounds fallback mirrors with a B.Cu part", () => {
    const bounds = { minX: 0, minY: -1, maxX: 4, maxY: 1 };
    const front = placementKeepoutExtentMm(placement({ bounds }), []);
    const back = placementKeepoutExtentMm(
      placement({ bounds, layer: "B.Cu" }),
      [],
    );
    expect(boundsOfPoints(front!)).toEqual({
      minX: 0,
      minY: -1,
      maxX: 4,
      maxY: 1,
    });
    // Mirrored about x: the box that ran to +4 now runs to -4.
    expect(boundsOfPoints(back!)).toEqual({
      minX: -4,
      minY: -1,
      maxX: 0,
      maxY: 1,
    });
  });

  test("falls back to the pad-ring box when nothing else is known", () => {
    const extent = placementKeepoutExtentMm(placement(), [
      PAD_RING,
      PAD_RING.map((p) => ({ x: p.x + 3, y: p.y })),
    ]);
    expect(extent).not.toBeNull();
    expect(boundsOfPoints(extent!)).toEqual({
      minX: -0.5,
      minY: -0.25,
      maxX: 3.5,
      maxY: 0.25,
    });
  });

  test("no courtyard, no bounds and no pads ⇒ no extent", () => {
    expect(placementKeepoutExtentMm(placement(), [])).toBeNull();
  });

  test("a degenerate preview bounds rectangle is not an extent", () => {
    expect(
      placementKeepoutExtentMm(
        placement({ bounds: { minX: 1, minY: 1, maxX: 1, maxY: 5 } }),
        [],
      ),
    ).toBeNull();
  });
});
