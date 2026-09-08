import { describe, expect, test } from "vitest";
import * as THREE from "three";
import type {
  PcbFreePad,
  PcbPlacedPart,
  PcbTrace,
  PcbVia,
} from "../../../../../sdks";
import type { FootprintRenderSourcePad } from "../../../../../shared/rendering";
import {
  buildCopperFillIslands,
  buildCopperFillPourPaths,
  isTraceCoveredByPour,
  type CopperFillIsland,
  type CopperFillPourParams,
} from "./copper-fill-geometry";
import {
  boardClearanceByPairKind,
  DEFAULT_POUR_TO_COPPER_MM,
} from "../../../../../shared/drc/rule-compile";
import { islandsToShapes } from "../../../../../shared/rendering/copper-fill/copper-fill-shapes";

const outline = {
  kind: "rect" as const,
  widthMm: 20,
  heightMm: 10,
  centerMm: { x: 0, y: 0 },
};

const noTraces: ReadonlyArray<PcbTrace> = [];
const noVias: ReadonlyArray<PcbVia> = [];
const emptyPadNets: ReadonlyMap<string, string> = new Map();

function pad(
  id: string,
  centerMm: { x: number; y: number },
  widthMm: number,
  heightMm: number,
  overrides: Partial<FootprintRenderSourcePad> = {},
): FootprintRenderSourcePad {
  return {
    id,
    number: id,
    shape: "rect",
    centerMm,
    widthMm,
    heightMm,
    rotationDeg: 0,
    layer: "F.Cu",
    ...overrides,
  };
}

function placement(
  pads: FootprintRenderSourcePad[],
  overrides: Partial<PcbPlacedPart> = {},
): PcbPlacedPart {
  return {
    id: "U1-pcb",
    partId: "U1",
    componentId: "component-1",
    reference: "U1",
    positionMm: { x: 0, y: 0 },
    rotationDeg: 0,
    mirrored: false,
    layer: "F.Cu",
    footprint: {
      footprintId: "fp-1",
      name: "SOIC",
      mountType: "smd",
      sourceHash: null,
      preview: {
        kind: "footprint",
        units: "mm",
        name: "SOIC",
        pads,
        graphics: [],
        labels: [],
        bounds: { minX: -10, minY: -10, maxX: 10, maxY: 10 },
        warnings: [],
      },
    },
    ...overrides,
  };
}

function via(overrides: Partial<PcbVia> = {}): PcbVia {
  return {
    id: "v1",
    netId: null,
    netClassId: "default",
    centerMm: { x: 0, y: 0 },
    diameterMm: 0.6,
    drillMm: 0.3,
    fromLayer: "F.Cu",
    toLayer: "B.Cu",
    viaType: "through",
    protection: "tented",
    ...overrides,
  };
}

function freePad(overrides: Partial<PcbFreePad> = {}): PcbFreePad {
  return {
    id: "fp1",
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
    ...overrides,
  };
}

// --- pour measurement helpers ----------------------------------------------

function ringArea(pts: THREE.Vector2[]): number {
  let acc = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    acc += p.x * q.y - q.x * p.y;
  }
  return Math.abs(acc) / 2;
}

function pourArea(shapes: THREE.Shape[]): number {
  let total = 0;
  for (const shape of shapes) {
    const { shape: outer, holes } = shape.extractPoints(1);
    total += ringArea(outer);
    for (const hole of holes) total -= ringArea(hole);
  }
  return total;
}

function holeCount(shapes: THREE.Shape[]): number {
  return shapes.reduce((n, s) => n + s.holes.length, 0);
}

/** Every vertex of every hole across all pour islands (mm). */
function holeVertices(shapes: THREE.Shape[]): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (const shape of shapes) {
    for (const hole of shape.extractPoints(1).holes) out.push(...hole);
  }
  return out;
}

/**
 * Hole-ring vertices PLUS each edge midpoint. The polygonal round-offset's
 * chords lie inside the ideal Minkowski offset, so the worst clearance under-cut
 * is at edge midpoints — vertices alone (which sit on the offset boundary) miss
 * it.
 */
function holeEdgeSamples(shapes: THREE.Shape[]): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  for (const shape of shapes) {
    for (const hole of shape.extractPoints(1).holes) {
      for (let i = 0; i < hole.length; i += 1) {
        const a = hole[i]!;
        const b = hole[(i + 1) % hole.length]!;
        out.push(a);
        out.push(new THREE.Vector2((a.x + b.x) / 2, (a.y + b.y) / 2));
      }
    }
  }
  return out;
}

/** Euclidean distance from a point to an axis-aligned rect (0 if inside). */
function distPointToRect(
  px: number,
  py: number,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
): number {
  const dx = Math.max(Math.abs(px - cx) - hw, 0);
  const dy = Math.max(Math.abs(py - cy) - hh, 0);
  return Math.hypot(dx, dy);
}

function pourParams(
  p: Partial<CopperFillPourParams> = {},
): CopperFillPourParams {
  return {
    layer: "F.Cu",
    layerCount: 2,
    outline,
    placements: [],
    traces: noTraces,
    vias: noVias,
    pourNetId: null,
    padNetIds: emptyPadNets,
    clearanceMm: 0.5,
    // No rules and no net class in these fixtures: the zone tier passed above
    // is the whole resolution, so the per-obstacle term contributes nothing.
    clearanceForItem: () => 0,
    copperToBoardEdgeMm: 0.5,
    // Default off so geometry is predictable; specific tests opt in.
    cornerRadiusMm: 0,
    minThicknessMm: 0,
    ...p,
  };
}

/** Kept islands of an `ok` pour; a `failed` pour would surface as an empty list. */
function islands(p: Partial<CopperFillPourParams> = {}): CopperFillIsland[] {
  return buildCopperFillIslands(pourParams(p)).islands;
}

function buildPour(p: Partial<CopperFillPourParams> = {}): THREE.Shape[] {
  return islandsToShapes(islands(p));
}

describe("copper fill geometry", () => {
  // S6: the pour's board tier is PER KIND — `max(pourToCopperMm ?? 0.5,
  // traceToX)` — and lives in the rule resolver, not in the fill kernel
  // (rule-semantics contract §4.1, §6). The kernel's old single maximum over
  // all four board clearances is gone: a board whose `traceToPadMm` is below
  // its `traceToTraceMm` now pours closer to pads than to traces, following
  // the pad rule the way a trace does.
  test("the pour board tier is per pair kind, floored by the 0.5 mm default", () => {
    const low = boardClearanceByPairKind({
      clearance: {
        traceToTraceMm: 0.2,
        traceToPadMm: 0.25,
        padToPadMm: 0.25,
        traceToViaMm: 0.2,
        viaToViaMm: 0.3,
        copperToBoardEdgeMm: 0.5,
      },
      minimums: {
        traceWidthMm: 0.2,
        drillSizeMm: 0.4,
        annularRingMm: 0.2,
        viaDiameterMm: 0.8,
        viaDrillMm: 0.4,
      },
    });
    expect(low.pourToTrace).toBe(DEFAULT_POUR_TO_COPPER_MM);
    expect(low.pourToPad).toBe(DEFAULT_POUR_TO_COPPER_MM);
    expect(low.pourToVia).toBe(DEFAULT_POUR_TO_COPPER_MM);
    expect(low.pourToPour).toBe(DEFAULT_POUR_TO_COPPER_MM);

    const wide = boardClearanceByPairKind({
      clearance: {
        traceToTraceMm: 0.2,
        traceToPadMm: 0.6,
        padToPadMm: 0.25,
        traceToViaMm: 0.2,
        viaToViaMm: 0.3,
        copperToBoardEdgeMm: 0.5,
      },
      minimums: {
        traceWidthMm: 0.2,
        drillSizeMm: 0.4,
        annularRingMm: 0.2,
        viaDiameterMm: 0.8,
        viaDrillMm: 0.4,
      },
    });
    // Only the PAD kind follows the wider pad rule now.
    expect(wide.pourToPad).toBe(0.6);
    expect(wide.pourToTrace).toBe(DEFAULT_POUR_TO_COPPER_MM);
  });

  // S5: the extent is the S2 board region offset inward by `e + ε`
  // (ε = CLEARANCE_SAFETY_EPS_MM = 0.01), not the old analytic parametric
  // inset by `e` — so a 20×10 board insets to 18.98×8.98 = 170.44 mm², not
  // 19×9 = 171 (copper-pour contract §3.1).
  const INSET_AREA_MM2 = 18.98 * 8.98;

  test("empty board floods to the edge-clearance inset", () => {
    const shapes = buildPour();
    expect(shapes).toHaveLength(1);
    expect(holeCount(shapes)).toBe(0);
    expect(pourArea(shapes)).toBeCloseTo(INSET_AREA_MM2, 1);
  });

  test("different-net pad carves a clearance hole in the pour", () => {
    const shapes = buildPour({
      placements: [placement([pad("1", { x: 0, y: 0 }, 1, 1)])],
    });
    expect(holeCount(shapes)).toBeGreaterThanOrEqual(1);
    expect(pourArea(shapes)).toBeLessThan(INSET_AREA_MM2); // pad + clearance removed
  });

  test("same-net pad merges into the pour (no clearance hole)", () => {
    const shapes = buildPour({
      placements: [placement([pad("1", { x: 0, y: 0 }, 1, 1)])],
      pourNetId: "GND",
      padNetIds: new Map([["U1-pcb|1", "GND"]]),
    });
    expect(holeCount(shapes)).toBe(0);
    expect(pourArea(shapes)).toBeCloseTo(INSET_AREA_MM2, 1);
  });

  test("drill apertures are subtracted even for a same-net via", () => {
    const shapes = buildPour({
      vias: [via({ netId: "GND", centerMm: { x: 0, y: 0 } })],
      pourNetId: "GND",
    });
    // Via copper merges, but the plated hole must always read.
    expect(holeCount(shapes)).toBeGreaterThanOrEqual(1);
  });

  test("a disconnected island below the area limit is pruned", () => {
    // No same-net anchor → the single island must clear the area threshold.
    expect(buildPour({ minIslandAreaMm2: 1_000_000 })).toHaveLength(0);
  });

  test("an island connected to a same-net anchor survives the area limit", () => {
    const shapes = buildPour({
      placements: [placement([pad("1", { x: 0, y: 0 }, 1, 1)])],
      pourNetId: "GND",
      padNetIds: new Map([["U1-pcb|1", "GND"]]),
      minIslandAreaMm2: 1_000_000,
    });
    expect(shapes.length).toBeGreaterThanOrEqual(1);
  });

  test("B.Cu placement pads participate in the B.Cu pour", () => {
    const shapes = buildPour({
      layer: "B.Cu",
      placements: [
        placement([pad("1", { x: 3, y: 0 }, 1, 1)], { layer: "B.Cu" }),
      ],
    });
    expect(holeCount(shapes)).toBeGreaterThanOrEqual(1);
  });

  test("aesthetic corner fillet trims the pour corners (clearance-safe)", () => {
    const sharp = buildPour();
    const filleted = buildPour({ cornerRadiusMm: 0.5 });
    // Rounding only removes copper at convex corners → strictly smaller.
    expect(pourArea(filleted)).toBeLessThan(pourArea(sharp));
    expect(pourArea(filleted)).toBeGreaterThan(pourArea(sharp) - 2);
  });

  test("every pour edge sample stays >= clearance from different-net copper", () => {
    const shapes = buildPour({
      placements: [placement([pad("1", { x: 0, y: 0 }, 1, 1)])],
      clearanceMm: 0.5,
    });
    // Sample edge MIDPOINTS, not just vertices: the polygonal halo's chords cut
    // inside the ideal offset, so the worst under-cut is mid-edge. The kernel
    // over-clears by the arc-chord compensation, so even midpoints stay >=
    // clearance (tol = 0.1 µm grid). Without that compensation this fails.
    const samples = holeEdgeSamples(shapes);
    expect(samples.length).toBeGreaterThan(0);
    const minDist = Math.min(
      ...samples.map((v) => distPointToRect(v.x, v.y, 0, 0, 0.5, 0.5)),
    );
    expect(minDist).toBeGreaterThanOrEqual(0.5 - 0.001);
  });

  test("a board cutout keeps the pour >= copper-to-edge clearance (offset eps)", () => {
    // Roundrect cutout with radius 0 = a rect (exact straight edges, no
    // tessellation inscribe error), so only the offset's rounded corners carry
    // chord error. The edge offset over-clears by the same compensation, so even
    // corner-arc midpoints stay >= the 0.5 mm copper-to-edge clearance.
    const shapes = buildPour({
      copperToBoardEdgeMm: 0.5,
      cutouts: [
        {
          id: "cut1",
          shape: {
            kind: "roundrect",
            widthMm: 4,
            heightMm: 3,
            centerMm: { x: 0, y: 0 },
            cornerRadiusMm: 0,
          },
        },
      ],
    });
    const samples = holeEdgeSamples(shapes);
    expect(samples.length).toBeGreaterThan(0);
    // Cutout half-extents 2 × 1.5, centred at origin.
    const minDist = Math.min(
      ...samples.map((v) => distPointToRect(v.x, v.y, 0, 0, 2, 1.5)),
    );
    expect(minDist).toBeGreaterThanOrEqual(0.5 - 0.001);
  });

  test("a degenerate different-net via is not copper, so it is not an obstacle", () => {
    // Control: a real different-net via yields a poured board (with a moat).
    const withVia = buildPour({
      vias: [via({ netId: "OTHER" })],
      pourNetId: "GND",
    });
    expect(withVia.length).toBeGreaterThan(0);
    expect(pourArea(withVia)).toBeLessThan(INSET_AREA_MM2);
    // S5: "degenerate copper is not copper" (S1 §2, copper-pour contract §4) —
    // a zero-radius via holds no metal, so there is nothing to clear and the
    // pour floods. Before S5 the kernel could not tell a degenerate obstacle
    // from a collapsed boolean and blanked the fill for both; the collapse is
    // now `status: "failed"` (see copper-fill-kernel-s5.test.ts).
    const shapes = buildPour({
      vias: [via({ diameterMm: 0, drillMm: 0, netId: "OTHER" })],
      pourNetId: "GND",
    });
    expect(pourArea(shapes)).toBeCloseTo(INSET_AREA_MM2, 1);
  });

  test("a different-net free pad carves a clearance hole in the pour", () => {
    const shapes = buildPour({
      freePads: [freePad({ centerMm: { x: 0, y: 0 }, netId: "OTHER" })],
      pourNetId: "GND",
    });
    expect(holeCount(shapes)).toBeGreaterThanOrEqual(1);
    expect(pourArea(shapes)).toBeLessThan(INSET_AREA_MM2);
    const verts = holeVertices(shapes);
    const minDist = Math.min(
      ...verts.map((v) => distPointToRect(v.x, v.y, 0, 0, 0.5, 0.5)),
    );
    expect(minDist).toBeGreaterThanOrEqual(0.5 - 0.05);
  });

  test("a same-net free pad merges into the pour (no clearance hole)", () => {
    const shapes = buildPour({
      freePads: [freePad({ netId: "GND" })],
      pourNetId: "GND",
    });
    expect(holeCount(shapes)).toBe(0);
  });

  test("pad copper rotates with a 45° placement in the pour", () => {
    const shapes = buildPour({
      placements: [
        placement([pad("1", { x: 3, y: 0 }, 1, 1)], { rotationDeg: 45 }),
      ],
    });
    // Pad local (3,0) rotated 45° about the placement origin → (3/√2, 3/√2).
    const c = 3 / Math.SQRT2;
    const verts = holeVertices(shapes);
    expect(verts.length).toBeGreaterThan(0);
    const centroid = verts.reduce(
      (acc, v) => ({
        x: acc.x + v.x / verts.length,
        y: acc.y + v.y / verts.length,
      }),
      { x: 0, y: 0 },
    );
    expect(centroid.x).toBeCloseTo(c, 1);
    expect(centroid.y).toBeCloseTo(c, 1);
  });
});

describe("copper fill thermal relief", () => {
  const sameNetPlacement = placement([pad("1", { x: 0, y: 0 }, 2, 2)]);
  const padNets = new Map([["U1-pcb|1", "gnd"]]);

  test("solid connection floods over a same-net pad (no relief gap)", () => {
    const shapes = buildPour({
      placements: [sameNetPlacement],
      pourNetId: "gnd",
      padNetIds: padNets,
      padConnection: "solid",
    });
    // Same-net solid pad merges into the pour → no knockout hole.
    expect(holeCount(shapes)).toBe(0);
  });

  test("thermal connection carves a relief gap with spoke channels", () => {
    const solid = buildPour({
      placements: [sameNetPlacement],
      pourNetId: "gnd",
      padNetIds: padNets,
      padConnection: "solid",
    });
    const thermal = buildPour({
      placements: [sameNetPlacement],
      pourNetId: "gnd",
      padNetIds: padNets,
      padConnection: "thermal",
      thermalSpokeWidthMm: 0.4,
      thermalReliefGapMm: 0.4,
      thermalSpokeCount: 4,
    });
    // The relief gap removes copper the solid flood kept.
    expect(pourArea(thermal)).toBeLessThan(pourArea(solid));
    // A relief gap (with spoke carve-outs) shows up as ≥1 hole in the pour.
    expect(holeCount(thermal)).toBeGreaterThan(0);
  });
});

// S5 replaced `buildCopperFillPadGroups` with per-island `memberKeys` on the
// one result every consumer reads (copper-pour contract §8): two pad keys on
// the same island are exactly what the old "group" meant.
describe("copper fill connectivity (island memberKeys)", () => {
  // Two same-net pads on one board-wide pour → one island holding both keys.
  const twoPads = placement([
    pad("1", { x: -6, y: 0 }, 2, 2),
    pad("2", { x: 6, y: 0 }, 2, 2),
  ]);
  const padNets = new Map([
    ["U1-pcb|1", "gnd"],
    ["U1-pcb|2", "gnd"],
  ]);
  const bothPads = ['pad:["U1-pcb","1",0]', 'pad:["U1-pcb","2",0]'];
  const base: Partial<CopperFillPourParams> = {
    placements: [twoPads],
    pourNetId: "gnd",
    padNetIds: padNets,
  };

  test("solid pour joins both same-net pads into one island", () => {
    const result = islands(base);
    expect(result).toHaveLength(1);
    expect(result[0]!.memberKeys).toEqual(bothPads);
    expect(result[0]!.attached).toBe(true);
  });

  test("thermal pour still joins both pads (spokes connect them)", () => {
    const result = islands({
      ...base,
      padConnection: "thermal",
      thermalSpokeWidthMm: 0.4,
      thermalReliefGapMm: 0.4,
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.memberKeys).toEqual(bothPads);
  });

  test("a foreign-net pad is not a member of the pour", () => {
    const result = islands({
      ...base,
      pourNetId: "vcc", // pour net differs from the pads' "gnd"
    });
    expect(result.flatMap((i) => i.memberKeys)).toEqual([]);
    expect(result.every((i) => !i.attached)).toBe(true);
  });
});

describe("copper fill redundant-trace coverage (isTraceCoveredByPour)", () => {
  const base: CopperFillPourParams = pourParams({ pourNetId: "gnd" });
  const trace = (netId: string): PcbTrace => ({
    id: `t-${netId}`,
    netId,
    netClassId: "default",
    layer: "F.Cu",
    widthMm: 0.5,
    pointsNm: [
      { x: -5_000_000, y: 0 },
      { x: 5_000_000, y: 0 },
    ],
    segmentMode: "manhattan-90",
  });

  test("a same-net trace inside the pour is fully covered", () => {
    const gnd = trace("gnd");
    const islands = buildCopperFillPourPaths({ ...base, traces: [gnd] });
    expect(isTraceCoveredByPour(gnd, islands)).toBe(true);
  });

  test("a different-net trace (knocked out by its moat) is not covered", () => {
    const vcc = trace("vcc");
    const islands = buildCopperFillPourPaths({ ...base, traces: [vcc] });
    expect(isTraceCoveredByPour(vcc, islands)).toBe(false);
  });
});

describe("copper fill zone clip (clipPolygonMm)", () => {
  // 20×10 board; clip to a 4×4 square centred at origin.
  const clip = [
    { x: -2, y: -2 },
    { x: 2, y: -2 },
    { x: 2, y: 2 },
    { x: -2, y: 2 },
  ];

  test("clipping a pour to a zone polygon restricts its area", () => {
    const full = buildPour({ pourNetId: null });
    const zoned = buildPour({ pourNetId: null, clipPolygonMm: clip });
    const fullArea = pourArea(full);
    const zonedArea = pourArea(zoned);
    expect(zonedArea).toBeGreaterThan(0);
    expect(zonedArea).toBeLessThan(fullArea);
    // ≈ the 4×4 = 16 mm² clip (well inside the board, no obstacles).
    expect(zonedArea).toBeGreaterThan(10);
    expect(zonedArea).toBeLessThan(16.5);
  });
});

describe("copper fill zone padConnection override", () => {
  const padNets = new Map([["U1-pcb|1", "GND"]]);
  // The connectivity item key the island-membership report uses for this pad.
  const padKey = 'pad:["U1-pcb","1",0]';
  // Same-net SMD pad (no drill) and same-net through-hole pad (0.8 mm drill).
  const smd: Partial<CopperFillPourParams> = {
    placements: [placement([pad("1", { x: 0, y: 0 }, 1, 1)])],
    pourNetId: "GND",
    padNetIds: padNets,
  };
  const tht: Partial<CopperFillPourParams> = {
    placements: [
      placement([pad("1", { x: 0, y: 0 }, 1.5, 1.5, { drillDiameterMm: 0.8 })]),
    ],
    pourNetId: "GND",
    padNetIds: padNets,
  };

  // S5: `attached` IS `memberKeys.length > 0` on the one island result
  // (copper-pour contract §8) — the separate anchors intersection is gone.
  const anchored = (p: Partial<CopperFillPourParams>): boolean[] =>
    islands(p).map((i) => i.attached);
  const memberKeys = (p: Partial<CopperFillPourParams>): string[] =>
    islands(p).flatMap((i) => i.memberKeys);

  test("'solid' is the absent-override behaviour, unchanged", () => {
    expect(
      buildCopperFillPourPaths(pourParams({ ...smd, padConnection: "solid" })),
    ).toEqual(buildCopperFillPourPaths(pourParams(smd)));
    expect(
      buildCopperFillPourPaths(pourParams({ ...tht, padConnection: "solid" })),
    ).toEqual(buildCopperFillPourPaths(pourParams(tht)));
    expect(anchored({ ...smd, padConnection: "solid" })).toEqual([true]);
    expect(memberKeys({ ...smd, padConnection: "solid" })).toEqual([padKey]);
  });

  test("'none' treats a same-net pad as different-net copper", () => {
    const p = { ...smd, padConnection: "none" as const };
    const shapes = buildPour(p);
    // A clearance halo (hole in the island), not a flood over the pad.
    expect(holeCount(shapes)).toBe(1);
    expect(pourArea(shapes)).toBeLessThan(pourArea(buildPour(smd)));
    // …and the pad stops anchoring / joining the island (contract §6).
    expect(anchored(p)).toEqual([false]);
    expect(memberKeys(p)).toEqual([]);
    expect(memberKeys(p)).toEqual([]);
  });

  test("'thruHoleThermal' relieves a drilled pad and drops an SMD one", () => {
    const drilled = { ...tht, padConnection: "thruHoleThermal" as const };
    const shapes = buildPour(drilled);
    // 4 relief-gap arcs (the spokes bridge the gap) + the drill aperture.
    expect(holeCount(shapes)).toBe(5);
    expect(pourArea(shapes)).toBeLessThan(pourArea(buildPour(tht)));
    // The pad still anchors and still joins the island through its spokes.
    expect(anchored(drilled)).toEqual([true]);
    expect(memberKeys(drilled)).toEqual([padKey]);
    expect(buildCopperFillPourPaths(pourParams(drilled))).toEqual(
      buildCopperFillPourPaths(
        pourParams({ ...tht, padConnection: "thermal" }),
      ),
    );

    const smdPad = { ...smd, padConnection: "thruHoleThermal" as const };
    // No drill ⇒ resolves to "none": a clearance halo, no relief, no anchor.
    expect(holeCount(buildPour(smdPad))).toBe(1);
    expect(anchored(smdPad)).toEqual([false]);
    expect(memberKeys(smdPad)).toEqual([]);
    expect(buildCopperFillPourPaths(pourParams(smdPad))).toEqual(
      buildCopperFillPourPaths(pourParams({ ...smd, padConnection: "none" })),
    );
  });
});

describe("copper fill zone islandRemoval override", () => {
  // A different-net trace at x = -8 splits the 19×9 inset pour into a ~6.7 mm²
  // strip and a ~150.7 mm² remainder. Neither is anchored: the "GND" pour has
  // no same-net copper of its own.
  const splitter: PcbTrace = {
    id: "t-split",
    netId: "VCC",
    netClassId: "default",
    layer: "F.Cu",
    widthMm: 0.5,
    pointsNm: [
      { x: -8_000_000, y: -6_000_000 },
      { x: -8_000_000, y: 6_000_000 },
    ],
    segmentMode: "manhattan-90",
  };
  // Same-net copper inside the large region, so that island IS anchored.
  const anchor: PcbTrace = {
    ...splitter,
    id: "t-anchor",
    netId: "GND",
    pointsNm: [
      { x: 0, y: 0 },
      { x: 5_000_000, y: 0 },
    ],
  };
  const split: Partial<CopperFillPourParams> = {
    pourNetId: "GND",
    traces: [splitter],
  };

  test("'never' keeps every unanchored island", () => {
    expect(buildPour({ ...split, islandRemoval: "never" })).toHaveLength(2);
  });

  test("'always' removes every unanchored island", () => {
    expect(buildPour({ ...split, islandRemoval: "always" })).toHaveLength(0);
  });

  test("'always' still keeps an anchored island", () => {
    expect(
      buildPour({
        ...split,
        traces: [splitter, anchor],
        islandRemoval: "always",
      }),
    ).toHaveLength(1);
  });

  test("{ minAreaMm2 } keeps islands at or above the threshold", () => {
    expect(
      buildPour({ ...split, islandRemoval: { minAreaMm2: 5 } }),
    ).toHaveLength(2);
    expect(
      buildPour({ ...split, islandRemoval: { minAreaMm2: 10 } }),
    ).toHaveLength(1);
  });

  test("islandRemoval wins over an explicit minIslandAreaMm2", () => {
    expect(
      buildPour({
        ...split,
        minIslandAreaMm2: 1_000_000,
        islandRemoval: "never",
      }),
    ).toHaveLength(2);
    expect(
      buildPour({ ...split, minIslandAreaMm2: 0, islandRemoval: "always" }),
    ).toHaveLength(0);
  });
});

describe("copper fill thermal relief on free pads", () => {
  test("a thermally connected same-net free pad gets a relief gap like a footprint pad", () => {
    const solid = buildPour({
      freePads: [freePad({ netId: "GND" })],
      pourNetId: "GND",
      padConnection: "solid",
    });
    const thermal = buildPour({
      freePads: [freePad({ netId: "GND" })],
      pourNetId: "GND",
      padConnection: "thermal",
      thermalSpokeWidthMm: 0.4,
      thermalReliefGapMm: 0.4,
      thermalSpokeCount: 4,
    });
    expect(pourArea(thermal)).toBeLessThan(pourArea(solid));
    expect(holeCount(thermal)).toBeGreaterThan(holeCount(solid));
  });
});

describe("copper fill keepout subtraction (excludePolygonsMm)", () => {
  const keepout = [
    { x: -2, y: -2 },
    { x: 2, y: -2 },
    { x: 2, y: 2 },
    { x: -2, y: 2 },
  ];
  test("a copper-pour keepout removes its interior from the pour", () => {
    const plain = buildPour({});
    const cut = buildPour({ excludePolygonsMm: [keepout] });
    // 16 mm² removed, plus the one-grid-step guard band around it.
    expect(pourArea(plain) - pourArea(cut)).toBeGreaterThan(16);
    expect(pourArea(plain) - pourArea(cut)).toBeLessThan(16.01);
    expect(holeCount(cut)).toBeGreaterThan(holeCount(plain));
  });
  test("the guard band keeps every pour vertex outside the keepout", () => {
    const cut = buildPour({ excludePolygonsMm: [keepout] });
    for (const shape of cut) {
      for (const hole of shape.holes) {
        for (const v of hole.getPoints()) {
          const inside = v.x > -2 && v.x < 2 && v.y > -2 && v.y < 2;
          expect(inside).toBe(false);
        }
      }
    }
  });
  test("two overlapping keepouts with OPPOSITE winding still remove the union (Astra S4 #1)", () => {
    // Under the non-zero fill rule two opposite-winding rings cancel where they
    // overlap; the kernel must normalise them so both keepouts still apply.
    const reversed = [...keepout].reverse();
    const one = buildPour({ excludePolygonsMm: [keepout] });
    const both = buildPour({ excludePolygonsMm: [keepout, reversed] });
    expect(pourArea(both)).toBeCloseTo(pourArea(one), 6);
    for (const shape of both) {
      for (const hole of shape.holes) {
        for (const v of hole.getPoints()) {
          const inside = v.x > -2 && v.x < 2 && v.y > -2 && v.y < 2;
          expect(inside).toBe(false);
        }
      }
    }
  });
  test("a degenerate keepout ring is ignored", () => {
    expect(pourArea(buildPour({ excludePolygonsMm: [[{ x: 0, y: 0 }, { x: 1, y: 1 }]] }))).toBe(
      pourArea(buildPour({})),
    );
  });
});
