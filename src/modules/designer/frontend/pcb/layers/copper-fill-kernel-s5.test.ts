/**
 * S5 copper-pour kernel — the contract's own guarantees
 * (docs/pcb-hardening/04-copper-pour-contract.md §2–§8, §12).
 *
 * These are the properties the old fill could not state: the extent is the S2
 * board region (not an analytic parametric inset), obstacles come from the S1
 * records with their layer policy, the per-obstacle-net clearance holds against
 * the TRUE geometry (not the sampled polygon), thermal spokes sit in the pad's
 * own frame, precedence and zone holes carve the extent, a failed boolean is
 * distinguishable from an empty one, and the output is byte-identical under any
 * input permutation.
 */
import { describe, expect, test } from "vitest";
import type {
  PcbBoardCutout,
  PcbBoardOutline,
  PcbFreePad,
  PcbPlacedPart,
  PcbPointMm,
  PcbTrace,
  PcbVia,
} from "../../../../../sdks";
import type { FootprintRenderSourcePad } from "../../../../../shared/rendering";
import {
  buildCopperFillIslands,
  buildCopperFillPourPaths,
  type CopperFillIsland,
  type CopperFillPourParams,
} from "./copper-fill-geometry";

const RECT_OUTLINE: PcbBoardOutline = {
  kind: "rect",
  widthMm: 20,
  heightMm: 12,
  centerMm: { x: 0, y: 0 },
};

/** Chord + rounding slack: the offset's arc error plus one output rounding. */
const TOL_MM = 0.006;

function params(p: Partial<CopperFillPourParams> = {}): CopperFillPourParams {
  return {
    layer: "F.Cu",
    layerCount: 2,
    outline: RECT_OUTLINE,
    placements: [],
    traces: [],
    vias: [],
    pourNetId: "gnd",
    padNetIds: new Map(),
    clearanceMm: 0.5,
    clearanceForItem: () => 0,
    copperToBoardEdgeMm: 0.5,
    cornerRadiusMm: 0,
    minThicknessMm: 0,
    minIslandAreaMm2: 0,
    ...p,
  };
}

function islandsOf(p: Partial<CopperFillPourParams> = {}): CopperFillIsland[] {
  const result = buildCopperFillIslands(params(p));
  expect(result.status).toBe("ok");
  return result.islands;
}

/** Every vertex of every ring of every island. */
function allVertices(islands: readonly CopperFillIsland[]): PcbPointMm[] {
  return islands.flatMap((island) => island.rings.flat());
}

function freePad(id: string, o: Partial<PcbFreePad> = {}): PcbFreePad {
  return {
    id,
    centerMm: { x: 0, y: 0 },
    rotationDeg: 0,
    padType: "smd",
    shape: "rect",
    widthMm: 1,
    heightMm: 1,
    drillMm: null,
    layer: "F.Cu",
    netId: null,
    solderMaskExpansionMm: null,
    solderPasteExpansionMm: null,
    lockedAt: null,
    ...o,
  };
}

function trace(id: string, o: Partial<PcbTrace> = {}): PcbTrace {
  return {
    id,
    netId: "gnd",
    netClassId: "default",
    layer: "F.Cu",
    widthMm: 0.4,
    pointsNm: [
      { x: 0, y: 0 },
      { x: 2_000_000, y: 0 },
    ],
    segmentMode: "manhattan-90",
    ...o,
  };
}

function via(id: string, o: Partial<PcbVia> = {}): PcbVia {
  return {
    id,
    netId: "gnd",
    netClassId: "default",
    centerMm: { x: 5, y: 0 },
    diameterMm: 0.8,
    drillMm: 0.4,
    fromLayer: "F.Cu",
    toLayer: "B.Cu",
    viaType: "through",
    ...o,
  } as PcbVia;
}

function placement(
  id: string,
  pads: FootprintRenderSourcePad[],
  o: Partial<PcbPlacedPart> = {},
): PcbPlacedPart {
  return {
    id,
    partId: id,
    componentId: "c1",
    reference: id,
    positionMm: { x: 0, y: 0 },
    rotationDeg: 0,
    mirrored: false,
    layer: "F.Cu",
    footprint: {
      footprintId: "fp",
      name: "FP",
      preview: { pads, graphics: [], courtyard: null },
    },
    ...o,
  } as unknown as PcbPlacedPart;
}

// --- geometry probes ---------------------------------------------------------

function pointToSegmentDistance(
  p: PcbPointMm,
  a: PcbPointMm,
  b: PcbPointMm,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(
    0,
    Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2),
  );
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance from `p` to the closest edge of `ring` (0 when p lies on it). */
function distanceToRing(p: PcbPointMm, ring: readonly PcbPointMm[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    best = Math.min(
      best,
      pointToSegmentDistance(p, ring[i]!, ring[(i + 1) % ring.length]!),
    );
  }
  return best;
}

function distanceToIslands(
  p: PcbPointMm,
  islands: readonly CopperFillIsland[],
): number {
  let best = Infinity;
  for (const island of islands)
    for (const ring of island.rings) best = Math.min(best, distanceToRing(p, ring));
  return best;
}

function pointInRing(p: PcbPointMm, ring: readonly PcbPointMm[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Is `p` copper? Inside an island's outer ring and outside all of its holes. */
function isCopper(p: PcbPointMm, islands: readonly CopperFillIsland[]): boolean {
  return islands.some((island) => {
    const [outer, ...holes] = island.rings;
    if (!outer || !pointInRing(p, outer)) return false;
    return holes.every((hole) => !pointInRing(p, hole));
  });
}

/** Euclidean distance from `p` to an origin-centred rectangle (0 inside). */
function distanceToRect(p: PcbPointMm, hw: number, hh: number): number {
  return Math.hypot(
    Math.max(Math.abs(p.x) - hw, 0),
    Math.max(Math.abs(p.y) - hh, 0),
  );
}

/** `count` points spread around a rectangle's true boundary. */
function sampleRect(
  cx: number,
  cy: number,
  w: number,
  h: number,
  count: number,
): PcbPointMm[] {
  const out: PcbPointMm[] = [];
  const perimeter = 2 * (w + h);
  for (let i = 0; i < count; i += 1) {
    let t = (perimeter * i) / count;
    if (t < w) out.push({ x: cx - w / 2 + t, y: cy - h / 2 });
    else if ((t -= w) < h) out.push({ x: cx + w / 2, y: cy - h / 2 + t });
    else if ((t -= h) < w) out.push({ x: cx + w / 2 - t, y: cy + h / 2 });
    else out.push({ x: cx - w / 2, y: cy + h / 2 - (t - w) });
  }
  return out;
}

/** `count` points on an ellipse's true boundary. */
function sampleEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  count: number,
): PcbPointMm[] {
  const out: PcbPointMm[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = (2 * Math.PI * i) / count;
    out.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
  }
  return out;
}

/**
 * `count` points on the TRUE boundary of a horizontal stadium (capsule):
 * a segment from (-hl, 0) to (hl, 0) inflated by `r`, with exact rounded
 * caps (not the polygonal approximation the kernel produces).
 */
function sampleStadiumX(hl: number, r: number, count: number): PcbPointMm[] {
  const out: PcbPointMm[] = [];
  const perimeter = 4 * hl + 2 * Math.PI * r;
  for (let i = 0; i < count; i += 1) {
    let t = (perimeter * i) / count;
    if (t < 2 * hl) {
      out.push({ x: -hl + t, y: r });
      continue;
    }
    t -= 2 * hl;
    if (t < Math.PI * r) {
      const ang = Math.PI / 2 - t / r;
      out.push({ x: hl + r * Math.cos(ang), y: r * Math.sin(ang) });
      continue;
    }
    t -= Math.PI * r;
    if (t < 2 * hl) {
      out.push({ x: hl - t, y: -r });
      continue;
    }
    t -= 2 * hl;
    const ang = -Math.PI / 2 - t / r;
    out.push({ x: -hl + r * Math.cos(ang), y: r * Math.sin(ang) });
  }
  return out;
}

/**
 * Does an unbroken ray of copper reach from just outside the pad ring to
 * `rMax` at bearing `deg`? True only when a thermal spoke bridges that
 * direction.
 */
function rayHasContinuousCopper(
  islands: readonly CopperFillIsland[],
  deg: number,
  rMax: number,
): boolean {
  const a = (deg * Math.PI) / 180;
  for (let r = 0.05; r <= rMax; r += 0.02) {
    if (!isCopper({ x: Math.cos(a) * r, y: Math.sin(a) * r }, islands)) {
      return false;
    }
  }
  return true;
}

// --- (a) the extent IS the board region, inset ------------------------------

describe("(a) extent = board region inset by the edge clearance (§3.1)", () => {
  const EDGE = 0.6;

  function assertClearOfBoundary(
    islands: readonly CopperFillIsland[],
    boundary: readonly PcbPointMm[],
  ): void {
    expect(islands.length).toBeGreaterThan(0);
    expect(boundary.length).toBeGreaterThanOrEqual(200);
    let worst = Infinity;
    for (const p of boundary) worst = Math.min(worst, distanceToIslands(p, islands));
    expect(worst).toBeGreaterThanOrEqual(EDGE - TOL_MM);
  }

  test("rect", () => {
    const islands = islandsOf({ copperToBoardEdgeMm: EDGE });
    assertClearOfBoundary(islands, sampleRect(0, 0, 20, 12, 240));
    // 20×12 inset by EDGE + ε on all sides.
    const inset = EDGE + 0.01;
    expect(islands[0]!.areaMm2).toBeCloseTo(
      (20 - 2 * inset) * (12 - 2 * inset),
      1,
    );
  });

  test("roundrect", () => {
    const outline: PcbBoardOutline = {
      kind: "roundrect",
      widthMm: 20,
      heightMm: 12,
      centerMm: { x: 0, y: 0 },
      cornerRadiusMm: 3,
    };
    // Straight runs only: the true corner arcs are farther from the fill than
    // the straight edges, so sampling the flats is the binding constraint.
    const boundary: PcbPointMm[] = [];
    for (let i = 0; i < 120; i += 1) {
      const t = -7 + (14 * i) / 119;
      boundary.push({ x: t, y: -6 }, { x: t, y: 6 });
    }
    assertClearOfBoundary(islandsOf({ outline, copperToBoardEdgeMm: EDGE }), boundary);
  });

  test("circle", () => {
    const outline: PcbBoardOutline = {
      kind: "circle",
      widthMm: 16,
      heightMm: 16,
      centerMm: { x: 0, y: 0 },
    };
    assertClearOfBoundary(
      islandsOf({ outline, copperToBoardEdgeMm: EDGE }),
      sampleEllipse(0, 0, 8, 8, 256),
    );
  });

  test("arc contour", () => {
    // A stadium drawn as a contour: two straight runs joined by semicircles.
    const outline: PcbBoardOutline = {
      kind: "contour",
      widthMm: 20,
      heightMm: 10,
      centerMm: { x: 0, y: 0 },
      start: { x: -5, y: -5 },
      segments: [
        { type: "line", to: { x: 5, y: -5 } },
        { type: "arc", to: { x: 5, y: 5 }, centerMm: { x: 5, y: 0 }, cw: false },
        { type: "line", to: { x: -5, y: 5 } },
        {
          type: "arc",
          to: { x: -5, y: -5 },
          centerMm: { x: -5, y: 0 },
          cw: false,
        },
      ],
    };
    const boundary: PcbPointMm[] = [];
    for (let i = 0; i < 60; i += 1) {
      const t = -5 + (10 * i) / 59;
      boundary.push({ x: t, y: -5 }, { x: t, y: 5 });
    }
    for (let i = 0; i < 60; i += 1) {
      const a = -Math.PI / 2 + (Math.PI * i) / 59;
      boundary.push({ x: 5 + Math.cos(a) * 5, y: Math.sin(a) * 5 });
      boundary.push({ x: -5 - Math.cos(a) * 5, y: Math.sin(a) * 5 });
    }
    assertClearOfBoundary(islandsOf({ outline, copperToBoardEdgeMm: EDGE }), boundary);
  });

  test("cutouts", () => {
    const cutouts: PcbBoardCutout[] = [
      {
        id: "c1",
        shape: {
          kind: "circle",
          widthMm: 4,
          heightMm: 4,
          centerMm: { x: 0, y: 0 },
        },
      },
    ];
    const islands = islandsOf({ cutouts, copperToBoardEdgeMm: EDGE });
    assertClearOfBoundary(islands, [
      ...sampleRect(0, 0, 20, 12, 200),
      ...sampleEllipse(0, 0, 2, 2, 200),
    ]);
    // The cutout must be a hole in the plane, not merely a distant void.
    expect(islands[0]!.rings.length).toBe(2);
  });
});

// --- (b) clearance holds against the TRUE circle -----------------------------

test("(b) a different-net circular pad keeps the true clearance (§5)", () => {
  const center = { x: 0, y: 0 };
  const islands = islandsOf({
    freePads: [
      freePad("vcc", {
        shape: "circle",
        widthMm: 4,
        heightMm: 4,
        centerMm: center,
        netId: "vcc",
      }),
    ],
    clearanceMm: 0.5,
  });
  expect(islands).toHaveLength(1);
  expect(islands[0]!.rings.length).toBe(2);
  // Measured against the exact disc (r = 2), not the sampled polygon: the pad
  // ring circumscribes the arc, so the halo is never short.
  let worst = Infinity;
  for (const v of allVertices(islands)) {
    worst = Math.min(worst, Math.hypot(v.x - center.x, v.y - center.y) - 2);
  }
  expect(worst).toBeGreaterThanOrEqual(0.5 - TOL_MM);
});

// --- (c) layer-invalid copper is an obstacle everywhere ----------------------

test("(c) a declaredLayerInvalid pad voids every layer and joins none (§4)", () => {
  // A 2-layer board; the pad names In1.Cu, which this stackup does not have.
  const ghost = freePad("ghost", {
    layer: "In1.Cu",
    widthMm: 3,
    heightMm: 3,
    centerMm: { x: 0, y: 0 },
    // SAME net as the pour: the layer defect must still refuse to merge it.
    netId: "gnd",
  });
  for (const layer of ["F.Cu", "B.Cu"] as const) {
    const islands = islandsOf({ layer, freePads: [ghost] });
    expect(islands).toHaveLength(1);
    // A void with a full clearance halo, and no membership anywhere.
    expect(islands[0]!.rings.length).toBe(2);
    expect(islands[0]!.memberKeys).toEqual([]);
    expect(islands[0]!.attached).toBe(false);
    let worst = Infinity;
    for (const v of allVertices(islands))
      worst = Math.min(worst, distanceToRect(v, 1.5, 1.5));
    expect(worst).toBeGreaterThanOrEqual(0.5 - TOL_MM);
  }
});

// --- (d) a `std` free pad spans every layer of the real stackup --------------

describe("(d) a std free pad reaches In1.Cu of a 4-layer board (§2, §4)", () => {
  const inner = (netId: string): PcbFreePad =>
    freePad("tp", {
      padType: "std",
      widthMm: 2,
      heightMm: 2,
      drillMm: 1,
      centerMm: { x: 0, y: 0 },
      layer: "F.Cu",
      netId,
    });
  const base = { layer: "In1.Cu", layerCount: 4 } as const;

  test("different net → obstacle on the inner layer", () => {
    const islands = islandsOf({ ...base, freePads: [inner("vcc")] });
    expect(islands).toHaveLength(1);
    expect(islands[0]!.rings.length).toBeGreaterThanOrEqual(2);
    expect(islands[0]!.memberKeys).toEqual([]);
  });

  test("same net → member of the inner-layer island", () => {
    const islands = islandsOf({ ...base, freePads: [inner("gnd")] });
    expect(islands).toHaveLength(1);
    expect(islands[0]!.memberKeys).toEqual(["freepad:tp"]);
    expect(islands[0]!.attached).toBe(true);
  });
});

// --- (e) thermal spokes live in the pad's own frame --------------------------

describe("(e) thermal relief is laid out in the pad frame (§6)", () => {
  const thermal = {
    padConnection: "thermal" as const,
    thermalSpokeWidthMm: 0.4,
    thermalReliefGapMm: 0.4,
  };

  test("a rect pad rotated 30° stays bridged and keeps its relief gap", () => {
    const rotated = freePad("p", {
      widthMm: 3,
      heightMm: 3,
      rotationDeg: 30,
      netId: "gnd",
      padType: "std",
      drillMm: 1,
    });
    const solid = islandsOf({ freePads: [rotated] });
    const relieved = islandsOf({ freePads: [rotated], ...thermal });
    expect(solid[0]!.rings.length).toBe(2); // the drill aperture only
    // The relief gap is cut into arcs by the spokes → several extra holes.
    expect(relieved[0]!.rings.length).toBeGreaterThan(solid[0]!.rings.length);
    // Spokes still reach the pad, so the pad remains a member.
    expect(relieved[0]!.memberKeys).toEqual(["freepad:p"]);
    expect(relieved[0]!.areaMm2).toBeLessThan(solid[0]!.areaMm2);
  });

  test("a 1×4 oval carries its spokes on its own axes, not the world's", () => {
    // Long axis is pad-local Y; rotating 90° puts it on world X. Two spokes at
    // the pad-local default 90° therefore bridge along world ±X. A world-frame
    // layout would put them on ±Y instead, and both probes below would flip.
    const oval = freePad("p", {
      shape: "oval",
      widthMm: 1,
      heightMm: 6,
      rotationDeg: 90,
      centerMm: { x: 0, y: 0 },
      netId: "gnd",
      padType: "std",
      drillMm: 0.5,
    });
    const islands = islandsOf({
      freePads: [oval],
      ...thermal,
      thermalSpokeCount: 2,
    });
    expect(islands).toHaveLength(1);
    // Inside the relief gap on the long (world X) axis → bridged by a spoke.
    expect(isCopper({ x: 3.2, y: 0 }, islands)).toBe(true);
    // Same band on the short (world Y) axis → the relief gap, no copper.
    expect(isCopper({ x: 0, y: 0.7 }, islands)).toBe(false);
    expect(islands[0]!.memberKeys).toEqual(["freepad:p"]);
  });
});

// --- (f) precedence carves with the mutual clearance -------------------------

test("(f) excludeZonesMm carves the extent with its clearance (§3.3)", () => {
  const other = [
    { x: -3, y: -3 },
    { x: 3, y: -3 },
    { x: 3, y: 3 },
    { x: -3, y: 3 },
  ];
  const plain = islandsOf();
  const carved = islandsOf({
    excludeZonesMm: [{ pointsMm: other, clearanceMm: 0.5 }],
  });
  expect(carved).toHaveLength(1);
  expect(carved[0]!.rings.length).toBe(2);
  // 6×6 zone plus a 0.5 mm band all round ⇒ at least 7×7 removed.
  expect(plain[0]!.areaMm2 - carved[0]!.areaMm2).toBeGreaterThan(49 - 1);
  let worst = Infinity;
  for (const v of allVertices(carved))
    worst = Math.min(worst, distanceToRect(v, 3, 3));
  expect(worst).toBeGreaterThanOrEqual(0.5 - TOL_MM);
});

// --- (g) a zone hole is removed exactly --------------------------------------

test("(g) clipHolesMm removes the hole exactly, with no clearance (§3.2, §11)", () => {
  const islands = islandsOf({
    clipPolygonMm: [
      { x: -6, y: -4 },
      { x: 6, y: -4 },
      { x: 6, y: 4 },
      { x: -6, y: 4 },
    ],
    clipHolesMm: [
      [
        { x: -2, y: -2 },
        { x: 2, y: -2 },
        { x: 2, y: 2 },
        { x: -2, y: 2 },
      ],
    ],
  });
  expect(islands).toHaveLength(1);
  expect(islands[0]!.rings.length).toBe(2);
  // Inside the hole: no copper.
  expect(isCopper({ x: 0, y: 0 }, islands)).toBe(false);
  expect(isCopper({ x: 1.999, y: 0 }, islands)).toBe(false);
  // 1 µm outside it: copper. The only slack is the §3.2 grid guard (0.1 µm).
  expect(isCopper({ x: 2.001, y: 0 }, islands)).toBe(true);
  // Exactly the hole's area is gone — a hole carries no clearance.
  expect(islands[0]!.areaMm2).toBeCloseTo(12 * 8 - 4 * 4, 1);
});

test("(g) a hole is subtracted even without an outer clip ring", () => {
  // Defensive: dropping a hole because the caller gave no polygon would pour
  // MORE copper than was drawn — the one direction that is never safe.
  const hole = [
    { x: -2, y: -2 },
    { x: 2, y: -2 },
    { x: 2, y: 2 },
    { x: -2, y: 2 },
  ];
  const islands = islandsOf({ clipHolesMm: [hole] });
  expect(islands).toHaveLength(1);
  expect(islands[0]!.rings.length).toBe(2);
  expect(isCopper({ x: 0, y: 0 }, islands)).toBe(false);
});

// --- (h) failed ≠ empty ------------------------------------------------------

describe("(h) a failed boolean is not an empty fill (§3, §8)", () => {
  test("a NaN obstacle fails the pour", () => {
    const result = buildCopperFillIslands(
      params({
        pourNetId: "gnd",
        traces: [
          trace("bad", {
            netId: "vcc",
            pointsNm: [
              { x: Number.NaN, y: 0 },
              { x: 2_000_000, y: 0 },
            ],
          }),
        ],
      }),
    );
    expect(result.status).toBe("failed");
    expect(result.islands).toEqual([]);
    // The rings view collapses to no copper — fail CLOSED, never a flood.
    expect(
      buildCopperFillPourPaths(
        params({
          pourNetId: "gnd",
          traces: [
            trace("bad", {
              netId: "vcc",
              pointsNm: [
                { x: Number.NaN, y: 0 },
                { x: 2_000_000, y: 0 },
              ],
            }),
          ],
        }),
      ),
    ).toEqual([]);
  });

  test("a non-finite clearance fails rather than pouring at zero", () => {
    const result = buildCopperFillIslands(
      params({
        freePads: [freePad("vcc", { netId: "vcc", widthMm: 2, heightMm: 2 })],
        clearanceForItem: () => Number.NaN,
      }),
    );
    expect(result.status).toBe("failed");
  });

  test("a zone that lies off the board is an EMPTY fill, not a failure", () => {
    const result = buildCopperFillIslands(
      params({
        clipPolygonMm: [
          { x: 100, y: 100 },
          { x: 110, y: 100 },
          { x: 110, y: 110 },
          { x: 100, y: 110 },
        ],
      }),
    );
    expect(result.status).toBe("ok");
    expect(result.islands).toEqual([]);
  });

  test("an edge inset that consumes the board is an EMPTY fill (§8)", () => {
    const result = buildCopperFillIslands(params({ copperToBoardEdgeMm: 50 }));
    expect(result.status).toBe("ok");
    expect(result.islands).toEqual([]);
  });
});

// --- (i) determinism under input permutation ---------------------------------

test("(i) permuting the inputs yields deep-equal islands and rings (§12)", () => {
  const placements = [
    placement("U1", [
      {
        id: "1",
        number: "1",
        shape: "rect",
        centerMm: { x: -7, y: 3 },
        widthMm: 1.4,
        heightMm: 1.4,
        rotationDeg: 0,
        layer: "F.Cu",
      },
    ]),
    placement("U2", [
      {
        id: "1",
        number: "1",
        shape: "rect",
        centerMm: { x: 7, y: -3 },
        widthMm: 1.4,
        heightMm: 1.4,
        rotationDeg: 0,
        layer: "F.Cu",
      },
    ]),
  ];
  const traces = [
    trace("t1", {
      netId: "vcc",
      pointsNm: [
        { x: -2_000_000, y: -6_000_000 },
        { x: -2_000_000, y: 6_000_000 },
      ],
      widthMm: 0.6,
    }),
    trace("t2", { netId: "gnd" }),
  ];
  const vias = [
    via("v1", { centerMm: { x: 4, y: 2 } }),
    via("v2", { netId: "vcc", centerMm: { x: -6, y: -2 } }),
  ];
  const freePads = [
    freePad("f1", { centerMm: { x: 6, y: 4 }, netId: "gnd" }),
    freePad("f2", { centerMm: { x: -8, y: -4 }, netId: "vcc" }),
  ];
  const cutouts: PcbBoardCutout[] = [
    {
      id: "c1",
      shape: {
        kind: "circle",
        widthMm: 2,
        heightMm: 2,
        centerMm: { x: 8, y: 0 },
      },
    },
    {
      id: "c2",
      shape: {
        kind: "circle",
        widthMm: 2,
        heightMm: 2,
        centerMm: { x: -8, y: 0 },
      },
    },
  ];
  const padNetIds = new Map([
    ["U1|1", "gnd"],
    ["U2|1", "vcc"],
  ]);

  const forward = params({
    placements,
    traces,
    vias,
    freePads,
    cutouts,
    padNetIds,
  });
  const reversed = params({
    placements: [...placements].reverse(),
    traces: [...traces].reverse(),
    vias: [...vias].reverse(),
    freePads: [...freePads].reverse(),
    cutouts: [...cutouts].reverse(),
    padNetIds,
  });

  const a = buildCopperFillIslands(forward);
  const b = buildCopperFillIslands(reversed);
  expect(a.status).toBe("ok");
  expect(a.islands.length).toBeGreaterThan(1);
  // Deep-equal, not just the same sort order: rings, areas, centroids and
  // member keys are all accumulated in the canonical order (§8, §12).
  expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  expect(JSON.stringify(buildCopperFillPourPaths(reversed))).toBe(
    JSON.stringify(buildCopperFillPourPaths(forward)),
  );
});

// --- (j) attachment is S1 membership -----------------------------------------

test("(j) an island touching only a same-net trace stub is attached (§8)", () => {
  const islands = islandsOf({
    // A short floating gnd stub: no pad, no via, nothing else on the net.
    traces: [
      trace("stub", {
        pointsNm: [
          { x: 0, y: 0 },
          { x: 1_500_000, y: 0 },
        ],
      }),
    ],
    // Island removal would drop an unattached island of any size.
    islandRemoval: "always",
  });
  expect(islands).toHaveLength(1);
  expect(islands[0]!.attached).toBe(true);
  expect(islands[0]!.memberKeys).toEqual(["trace:stub"]);
});

// --- (k) a trace obstacle's clearance is never short against the TRUE cap ----

describe("(k) a trace obstacle keeps the true clearance against its rounded caps (§4, §5)", () => {
  // Before circumscribing the stadium's cap circle, the sampled-polygon cap
  // fell short of the true circle: 0.4956 (w=6) / 0.4860 (w=10) instead of 0.5.
  test.each([6, 10])("width %o mm", (widthMm) => {
    const halfLen = 5; // segment runs from x=-5 to x=5
    const radius = widthMm / 2;
    const islands = islandsOf({
      traces: [
        trace("t", {
          netId: "vcc",
          widthMm,
          pointsNm: [
            { x: -5_000_000, y: 0 },
            { x: 5_000_000, y: 0 },
          ],
        }),
      ],
      clearanceMm: 0.5,
    });
    const boundary = sampleStadiumX(halfLen, radius, 240);
    expect(boundary.length).toBeGreaterThanOrEqual(200);
    let worst = Infinity;
    for (const p of boundary) worst = Math.min(worst, distanceToIslands(p, islands));
    expect(worst).toBeGreaterThanOrEqual(0.5 - TOL_MM);
  });
});

// --- (l) the per-obstacle net-class clearance tier is used, not the max ------

test("(l) per-net clearance uses each obstacle's own tier, not the pour maximum (§5)", () => {
  const islands = islandsOf({
    freePads: [
      freePad("a", { centerMm: { x: -8, y: 0 }, netId: "n1" }),
      freePad("b", { centerMm: { x: 8, y: 0 }, netId: "n2" }),
    ],
    clearanceMm: 0.2,
    clearanceForItem: (item) => (item.netId === "n2" ? 1.2 : 0.3),
  });
  let gapN1 = Infinity;
  let gapN2 = Infinity;
  for (const v of allVertices(islands)) {
    gapN1 = Math.min(gapN1, distanceToRect({ x: v.x + 8, y: v.y }, 0.5, 0.5));
    gapN2 = Math.min(gapN2, distanceToRect({ x: v.x - 8, y: v.y }, 0.5, 0.5));
  }
  expect(gapN1).toBeGreaterThanOrEqual(0.3 - TOL_MM);
  expect(gapN2).toBeGreaterThanOrEqual(1.2 - TOL_MM);
  // The smaller tier is really applied to n1, not clamped up to n2's 1.2.
  expect(gapN1).toBeLessThan(0.32);
});

// --- (m) determinism survives permuting the zone-derived exclusion arrays ----

test("(m) permuting excludeZonesMm/clipHolesMm/excludePolygonsMm and their ring starts is byte-identical (§12)", () => {
  const zA = [
    { x: -14, y: -10 },
    { x: -6, y: -10 },
    { x: -6, y: -2 },
    { x: -14, y: -2 },
  ];
  const zB = [
    { x: 6, y: 2 },
    { x: 14, y: 2 },
    { x: 14, y: 10 },
    { x: 6, y: 10 },
  ];
  const hA = [
    { x: -2, y: -2 },
    { x: 2, y: -2 },
    { x: 2, y: 2 },
    { x: -2, y: 2 },
  ];
  const hB = [
    { x: -12, y: 4 },
    { x: -8, y: 4 },
    { x: -8, y: 8 },
    { x: -12, y: 8 },
  ];
  const kA = [
    { x: 2, y: -8 },
    { x: 6, y: -8 },
    { x: 6, y: -4 },
    { x: 2, y: -4 },
  ];
  const kB = [
    { x: 10, y: -8 },
    { x: 14, y: -8 },
    { x: 14, y: -4 },
    { x: 10, y: -4 },
  ];
  const rotateRing = (ring: PcbPointMm[], n: number): PcbPointMm[] => [
    ...ring.slice(n),
    ...ring.slice(0, n),
  ];
  const base = {
    clipPolygonMm: [
      { x: -18, y: -13 },
      { x: 18, y: -13 },
      { x: 18, y: 13 },
      { x: -18, y: 13 },
    ],
  };
  const forward = params({
    ...base,
    excludeZonesMm: [
      { pointsMm: zA, clearanceMm: 0.5 },
      { pointsMm: zB, clearanceMm: 0.8 },
    ],
    clipHolesMm: [hA, hB],
    excludePolygonsMm: [kA, kB],
  });
  const permuted = params({
    ...base,
    excludeZonesMm: [
      { pointsMm: rotateRing(zB, 2), clearanceMm: 0.8 },
      { pointsMm: rotateRing(zA, 1), clearanceMm: 0.5 },
    ],
    clipHolesMm: [rotateRing(hB, 3), rotateRing(hA, 2)],
    excludePolygonsMm: [rotateRing(kB, 1), rotateRing(kA, 3)],
  });
  const a = buildCopperFillIslands(forward);
  const b = buildCopperFillIslands(permuted);
  expect(a.status).toBe("ok");
  expect(a.islands.length).toBeGreaterThan(0);
  expect(JSON.stringify(b)).toBe(JSON.stringify(a));
});

// --- (n) a mirrored thermal pad reflects the spoke frame, not the placement's -

test("(n) a mirrored (B.Cu) thermal pad's spoke frame is 180° − angle, not the placement's rotation (§6)", () => {
  // Pad-local rotation 15° so the mirrored/unmirrored spoke frames land at
  // genuinely different bearings (a bare 0° pad rotation makes the two
  // 3-spoke, 120°-spaced families coincide, since 180 − 30 = 150 is itself a
  // member of {30, 150, 270}).
  const RMAX = 3.4;
  const pad = {
    id: "1",
    number: "1",
    shape: "rect" as const,
    centerMm: { x: 0, y: 0 },
    widthMm: 4,
    heightMm: 1.2,
    rotationDeg: 15,
    layer: "F.Cu" as const,
  };
  const thermal = {
    padConnection: "thermal" as const,
    thermalSpokeCount: 3,
    thermalSpokeAngleDeg: 30,
    thermalSpokeWidthMm: 0.4,
    thermalReliefGapMm: 0.4,
  };
  const padNetIds = new Map([["U1|1", "gnd"]]);

  const unmirroredIslands = islandsOf({
    layer: "F.Cu",
    placements: [placement("U1", [pad])],
    padNetIds,
    ...thermal,
  });
  const mirroredIslands = islandsOf({
    layer: "B.Cu",
    placements: [
      placement("U1", [pad], { mirrored: true, layer: "B.Cu" }),
    ],
    padNetIds,
    ...thermal,
  });

  // rotationDeg=15, count=3, angle=30 ⇒ unmirrored frame = 30 + 15 = 45,
  // spokes at {45, 165, 285}; mirrored frame = (180-30) - 15 = 135,
  // spokes at {135, 255, 15} — a disjoint family.
  for (const deg of [45, 165, 285]) {
    expect(rayHasContinuousCopper(unmirroredIslands, deg, RMAX)).toBe(true);
  }
  for (const deg of [15, 135, 255]) {
    expect(rayHasContinuousCopper(unmirroredIslands, deg, RMAX)).toBe(false);
  }
  for (const deg of [15, 135, 255]) {
    expect(rayHasContinuousCopper(mirroredIslands, deg, RMAX)).toBe(true);
  }
  for (const deg of [45, 165, 285]) {
    expect(rayHasContinuousCopper(mirroredIslands, deg, RMAX)).toBe(false);
  }
});

// --- (o) a drill aperture circumscribes the true hole -----------------------

describe("(o) a drill aperture never overhangs the hole it clears (§5, §6)", () => {
  test("a plated (THT) through-hole pad", () => {
    const islands = islandsOf({
      freePads: [
        freePad("p", {
          padType: "std",
          shape: "circle",
          widthMm: 5,
          heightMm: 5,
          drillMm: 3,
          netId: "gnd",
        }),
      ],
    });
    let worst = Infinity;
    for (const v of allVertices(islands)) worst = Math.min(worst, Math.hypot(v.x, v.y));
    expect(worst).toBeGreaterThanOrEqual(1.5);
  });

  test("an NPTH free hole whose halo is just the disc (copperToBoardEdgeMm: 0)", () => {
    const islands = islandsOf({
      freeHoles: [{ id: "h", centerMm: { x: 0, y: 0 }, drillMm: 3 }],
      copperToBoardEdgeMm: 0,
    });
    let worst = Infinity;
    for (const v of allVertices(islands)) worst = Math.min(worst, Math.hypot(v.x, v.y));
    expect(worst).toBeGreaterThanOrEqual(1.5);
  });
});

// --- (p) the region-fallback branch (S2 `fallbacks`) -------------------------

// No fixture in src/core/backend/tests/pcb-geometry-board-region*.test.ts
// currently drives buildBoardRegion's biased flattening into a persistent
// self-cross: every existing `fallbacks` assertion in that suite is
// `toEqual([])`. canSelfCrossFromFlattening only allows the fallback for a
// `contour` outline with an `arc` segment, and constructing an arc whose
// inward-biased offset still self-intersects after the doubling refinement
// loop maxes out at MAX_ARC_SEGMENTS (512) needs a purpose-built pinch/cusp
// contour — not assembled here within the time budget. Needs: a `contour`
// outline with an arc segment (near a manufacturable-web-width neck) whose
// "inward" bias flattening self-intersects at every step multiplier up to
// the segment cap, so `buildBoardRegion(...).fallbacks` is non-empty; that
// same outline fed to `buildCopperFillIslands` should surface a
// `region_ring_unbiased` warning, and the fill should stay
// `copperToBoardEdgeMm + 0.01` clear of the *unbiased* ring's vertices.
test.todo(
  "(p) a region ring that only flattens unbiased is a warning, and the fill clears the unbiased ring (§3.1, §12)",
);

// --- (q) opposite obstacle windings must not cancel --------------------------

test("(q) an opposite-winding pad/trace overlap does not cancel into a flood (§3.5)", () => {
  const islands = islandsOf({
    freePads: [
      freePad("vcc", {
        centerMm: { x: 0, y: 0 },
        widthMm: 4,
        heightMm: 4,
        padType: "smd",
        rotationDeg: 0,
        netId: "vcc",
      }),
      // Anchor so the pour is non-empty.
      freePad("gnd-anchor", {
        centerMm: { x: 0, y: 5 },
        widthMm: 1,
        heightMm: 1,
        padType: "std",
        drillMm: 0.5,
        netId: "gnd",
      }),
    ],
    traces: [
      trace("vcc-t", {
        netId: "vcc",
        widthMm: 4,
        pointsNm: [
          { x: -4_000_000, y: 0 },
          { x: 4_000_000, y: 0 },
        ],
      }),
    ],
  });
  expect(islands.length).toBeGreaterThan(0);
  // Before the fix the pad/trace overlap's opposing windings cancelled and the
  // pour flooded straight through the true VCC rectangle.
  for (const v of allVertices(islands)) {
    expect(distanceToRect(v, 2, 2)).toBeGreaterThanOrEqual(0.5 - 1e-6);
  }
  expect(isCopper({ x: 0, y: 0 }, islands)).toBe(false);
});

// --- (r) trace membership is exact, not circumscribed ------------------------

describe("(r) a same-net zone edge just past the trace's true cap is not a member (§8)", () => {
  const HALF_ANGLE = Math.PI / 32;
  const n = { x: Math.cos(HALF_ANGLE), y: Math.sin(HALF_ANGLE) };
  const t = { x: -Math.sin(HALF_ANGLE), y: Math.cos(HALF_ANGLE) };
  const along = (s: number, p: PcbPointMm): PcbPointMm => ({
    x: s * p.x,
    y: s * p.y,
  });
  const add = (a: PcbPointMm, b: PcbPointMm): PcbPointMm => ({
    x: a.x + b.x,
    y: a.y + b.y,
  });
  const sub = (a: PcbPointMm, b: PcbPointMm): PcbPointMm => ({
    x: a.x - b.x,
    y: a.y - b.y,
  });

  /** Rotated rectangle whose near edge sits `nearCoeff · n` from the origin. */
  function zoneRing(nearCoeff: number): PcbPointMm[] {
    const near = along(nearCoeff, n);
    const far = along(5, n);
    const wide = along(3, t);
    return [sub(near, wide), sub(far, wide), add(far, wide), add(near, wide)];
  }

  function zoneIslands(nearCoeff: number) {
    return buildCopperFillIslands(
      params({
        freePads: [
          freePad("anchor", {
            centerMm: { x: -4, y: 0 },
            widthMm: 1,
            heightMm: 1,
            padType: "std",
            drillMm: 0.5,
            netId: "gnd",
          }),
        ],
        traces: [
          trace("t", {
            netId: "gnd",
            widthMm: 2,
            pointsNm: [
              { x: -4_000_000, y: 0 },
              { x: 0, y: 0 },
            ],
          }),
        ],
        clipPolygonMm: zoneRing(nearCoeff),
      }),
    );
  }

  test("a 2 µm physical gap is not membership", () => {
    const result = zoneIslands(1.0019);
    expect(result.status).toBe("ok");
    expect(result.islands).toHaveLength(1);
    expect(result.islands[0]!.memberKeys).not.toContain("trace:t");
    expect(result.islands[0]!.attached).toBe(false);
  });

  test("control: an overlapping zone edge IS membership", () => {
    const result = zoneIslands(0.999);
    expect(result.status).toBe("ok");
    expect(result.islands).toHaveLength(1);
    expect(result.islands[0]!.memberKeys).toContain("trace:t");
    expect(result.islands[0]!.attached).toBe(true);
  });
});

// --- (s) a sub-grid obstacle fails the pour instead of vanishing -------------

describe("(s) copper thinner than the output grid fails closed (§3.5)", () => {
  function withTraceWidth(widthMm: number) {
    return params({
      freePads: [
        freePad("vcc-pad", {
          centerMm: { x: 0, y: 4 },
          widthMm: 1,
          heightMm: 1,
          netId: "vcc",
        }),
      ],
      traces: [
        trace("hairline", {
          netId: "vcc",
          widthMm,
          pointsNm: [
            { x: -4_000_000, y: 0 },
            { x: 4_000_000, y: 0 },
          ],
        }),
      ],
    });
  }

  test("20 nm trace width fails with a resolution reason", () => {
    const result = buildCopperFillIslands(withTraceWidth(0.00002));
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.reason).toMatch(/resolution/);
    }
  });

  test("control: 1 µm trace width still pours and keeps clearance", () => {
    const islands = islandsOf(withTraceWidth(0.001));
    expect(islands.length).toBeGreaterThan(0);
    for (const v of allVertices(islands)) {
      expect(
        pointToSegmentDistance(v, { x: -4, y: 0 }, { x: 4, y: 0 }),
      ).toBeGreaterThanOrEqual(0.5 - 1e-6);
    }
  });
});

// --- (t) zero edge clearance still keeps copper inside the board -------------

test("(t) copperToBoardEdgeMm: 0 never lets a vertex cross the true board edge (§3.1)", () => {
  const outline: PcbBoardOutline = {
    kind: "rect",
    widthMm: 20.00012,
    heightMm: 20,
    centerMm: { x: 0, y: 0 },
  };
  const islands = islandsOf({
    outline,
    copperToBoardEdgeMm: 0,
    cornerRadiusMm: 0,
    minThicknessMm: 0,
  });
  expect(islands.length).toBeGreaterThan(0);
  const trueRightEdge = 10.00006;
  for (const v of allVertices(islands)) {
    expect(v.x).toBeLessThanOrEqual(trueRightEdge + 1e-9);
  }
});

// --- (u) the corner fillet never re-enters a keepout -------------------------

test("(u) a rounded-corner fillet stays out of a keepout it would otherwise re-enter (§3.4)", () => {
  const islands = islandsOf({
    cornerRadiusMm: 0.4,
    excludePolygonsMm: [
      [
        { x: -2, y: -2 },
        { x: 2, y: -2 },
        { x: 2, y: 2 },
        { x: -2, y: 2 },
      ],
    ],
  });
  expect(islands.length).toBeGreaterThan(0);
  const TOL = 1e-9;
  for (const v of allVertices(islands)) {
    const strictlyInside = Math.abs(v.x) < 2 - TOL && Math.abs(v.y) < 2 - TOL;
    expect(strictlyInside).toBe(false);
  }
});

// --- (q) an oblong drill is a routed slot, not a central disc ----------------

/** 6 mm long, 1 mm wide, along +X through the origin (§5). */
const SLOT = { lengthMm: 6, widthMm: 1, angleDeg: 0 };
/** Its centreline: cap centres, inset from the ends by `widthMm / 2`. */
const SLOT_A: PcbPointMm = { x: -2.5, y: 0 };
const SLOT_B: PcbPointMm = { x: 2.5, y: 0 };
const SLOT_RADIUS_MM = SLOT.widthMm / 2;

describe("(q) a slotted drill is cleared over its whole centreline (§5)", () => {
  test("an NPTH slot holds the hole-to-copper ring along the centreline", () => {
    const edge = 0.5;
    const islands = islandsOf({
      freeHoles: [
        { id: "h", centerMm: { x: 0, y: 0 }, drillMm: 1, drillSlot: SLOT },
      ],
      copperToBoardEdgeMm: edge,
    });
    let worst = Infinity;
    for (const v of allVertices(islands)) {
      worst = Math.min(worst, pointToSegmentDistance(v, SLOT_A, SLOT_B));
    }
    // The fab routes a stadium from (-2.5,0) to (2.5,0) of radius 0.5, so the
    // NPTH halo is that stadium grown by the edge rule. Before the fix only a
    // 0.5 mm disc at the centre was subtracted and pour copper sat ON the
    // routed slot (distance 0).
    expect(worst).toBeGreaterThanOrEqual(SLOT_RADIUS_MM + edge);
  });

  test("a plated slot aperture is the stadium, not the central disc", () => {
    const islands = islandsOf({
      freePads: [
        freePad("p", {
          padType: "std",
          shape: "rect",
          widthMm: 8,
          heightMm: 2,
          drillMm: 1,
          drillSlot: SLOT,
          netId: "gnd",
        }),
      ],
      copperToBoardEdgeMm: 0.5,
    });
    let worst = Infinity;
    for (const v of allVertices(islands)) {
      worst = Math.min(worst, pointToSegmentDistance(v, SLOT_A, SLOT_B));
    }
    // A plated slot takes no clearance beyond the drill itself (§5), but the
    // pour may not overhang the routed metal: no vertex inside the stadium.
    expect(worst).toBeGreaterThanOrEqual(SLOT_RADIUS_MM);
  });
});
