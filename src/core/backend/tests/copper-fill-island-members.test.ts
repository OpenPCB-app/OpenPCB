/**
 * Pour-island membership and ordering for the connectivity kernel
 * (docs/pcb-hardening/01-connectivity-contract.md §3, §6).
 *
 * Membership is not "does the item's copper overlap the island" alone — copper
 * that only shares a BOUNDARY with the island is still one conductor. Two cases
 * produce zero-area intersections in practice: a pad flush against a
 * zone-clipped pour edge, and a pad inside a clearance hole resting on the hole
 * boundary. Both must be members; a pad in the middle of a hole must not, which
 * is why the widening uses an edge-only distance and not a containment-aware
 * one.
 *
 * Fixtures switch off the corner fillet and the min-thickness open so the
 * island rings are the exact input coordinates, and the assertions are about
 * membership rather than clipper's offset arithmetic.
 *
 * S5 added the conservative quantisation guard of copper-pour contract §3.2:
 * every forbidden region grows by one output grid step `Q` and every allowed
 * outer ring shrinks by `Q` before the boolean, so nearest-grid rounding can
 * never put copper inside a void. The "flush" fixtures below therefore sit on
 * the GUARDED boundary (`± Q`), not on the drawn one — the membership semantics
 * are unchanged, only the coordinate moves by 0.1 µm.
 */
import { describe, expect, test } from "bun:test";
import {
  buildCopperFillIslands,
  sortCopperFillIslands,
  type CopperFillIsland,
  type CopperFillPourParams,
} from "../../../shared/rendering/copper-fill/copper-fill-geometry";
import {
  freePadItemKey,
  padItemKey,
  viaItemKey,
} from "../../../shared/pcb-connectivity";
import type {
  PcbBoardOutline,
  PcbFreePad,
  PcbPointMm,
} from "../../../sdks/designer";
import { freePad, pad, placement, via } from "./helpers/drc-fixtures";

const outline: PcbBoardOutline = {
  kind: "rect",
  widthMm: 20,
  heightMm: 20,
  centerMm: { x: 10, y: 10 },
};

/** One output grid step (`10^-PRECISION` mm) — the §3.2 quantisation guard. */
const Q = 1e-4;

/** Exact-geometry pour: no fillet, no min-thickness open, no board inset. */
function pour(parts: Partial<CopperFillPourParams>): CopperFillPourParams {
  return {
    layer: "F.Cu",
    layerCount: 2,
    outline,
    placements: parts.placements ?? [],
    traces: parts.traces ?? [],
    vias: parts.vias ?? [],
    pourNetId: parts.pourNetId ?? "gnd",
    padNetIds: parts.padNetIds ?? new Map(),
    clearanceMm: parts.clearanceMm ?? 0,
    // No net class in these fixtures: the zone tier is the whole resolution.
    clearanceForItem: () => 0,
    copperToBoardEdgeMm: parts.copperToBoardEdgeMm ?? 0,
    cornerRadiusMm: 0,
    minThicknessMm: 0,
    minIslandAreaMm2: 0,
    ...(parts.freePads !== undefined ? { freePads: parts.freePads } : {}),
    ...(parts.clipPolygonMm !== undefined
      ? { clipPolygonMm: parts.clipPolygonMm }
      : {}),
  };
}

/** The `ok` islands of a pour; a `failed` pour would surface as an empty list. */
function islandsOf(params: CopperFillPourParams): CopperFillIsland[] {
  const result = buildCopperFillIslands(params);
  expect(result.status).toBe("ok");
  return result.islands;
}

function rect(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): PcbPointMm[] {
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

/** Same-net SMD free pad of `w`×`h` centred at (x, y). */
function gndPad(id: string, x: number, y: number, w = 2, h = 2): PcbFreePad {
  return freePad(id, {
    center: { x, y },
    widthMm: w,
    heightMm: h,
    netId: "gnd",
    layer: "F.Cu",
  });
}

describe("island membership — shared boundaries count", () => {
  test("a pad flush against a zone-clipped pour edge is a member; a 0.2 mm gap is not", () => {
    // Zone occupies x ∈ [5, 15]; the guarded edge is x = 5 + Q, where `flush`
    // ends exactly. `apart` ends at 4.8 — 0.2 mm clear either way.
    const islands = islandsOf(
      pour({
        clipPolygonMm: rect(5, 5, 15, 15),
        freePads: [gndPad("flush", 4 + Q, 10), gndPad("apart", 3.8, 10)],
      }),
    );
    expect(islands).toHaveLength(1);
    expect(islands[0]!.memberKeys).toEqual([freePadItemKey("flush")]);
  });

  test("a pad on a hole boundary is a member; a pad floating inside the hole is not", () => {
    // A different-net pad knocks a 6×6 hole out of the plane at [7, 13]².
    const islands = islandsOf(
      pour({
        freePads: [
          freePad("vcc", {
            center: { x: 10, y: 10 },
            widthMm: 6,
            heightMm: 6,
            netId: "vcc",
            layer: "F.Cu",
          }),
          // The hole wall is the vcc pad grown by Q, so x = 7 − Q.
          gndPad("onEdge", 8 - Q, 10),
          gndPad("floating", 10, 10), // x ∈ [9, 11] — 2 mm clear of every wall
        ],
      }),
    );
    expect(islands).toHaveLength(1);
    expect(islands[0]!.rings.length).toBe(2); // outer + the one hole
    expect(islands[0]!.memberKeys).toEqual([freePadItemKey("onEdge")]);
  });

  test("duplicate pad numbers reach membership under their per-shape keys", () => {
    const islands = islandsOf(
      pour({
        placements: [
          placement("U1", {
            positionMm: { x: 0, y: 0 },
            pads: [
              pad("1", { x: 4, y: 10 }, 2, 2),
              pad("1", { x: 12, y: 10 }, 2, 2),
            ],
          }),
        ],
        padNetIds: new Map([["U1|1", "gnd"]]),
      }),
    );
    expect(islands).toHaveLength(1);
    expect(islands[0]!.memberKeys).toEqual([
      padItemKey("U1", "1"),
      padItemKey("U1", "1", 1),
    ]);
    expect(padItemKey("U1", "1", 1)).toBe('pad:["U1","1",1]');
  });

  test("a via overlapping a slanted island edge by a micron is a member", () => {
    // Astra 6. `buildDiscRing` INSCRIBES the barrel, so on a slanted edge the
    // polygon can miss an overlap the circle has; membership must be decided
    // on the exact disc, or it disagrees with the touch predicate.
    const zone: PcbPointMm[] = [
      { x: 9.2994, y: 2.3992 },
      { x: 14.0994, y: 8.7992 },
      { x: 6.0994, y: 14.7992 },
      { x: 1.2994, y: 8.3992 },
    ];
    const islands = islandsOf(
      pour({
        clipPolygonMm: zone,
        vias: [
          via("v1", {
            netId: "gnd",
            center: { x: 5, y: 5 },
            diameterMm: 1,
            fromLayer: "F.Cu",
            toLayer: "B.Cu",
          }),
        ],
      }),
    );
    expect(islands).toHaveLength(1);
    expect(islands[0]!.memberKeys).toEqual([viaItemKey("v1")]);
  });

  test("a circular pad is a member on its exact disc, not its inscribed polygon", () => {
    const islands = islandsOf(
      pour({
        clipPolygonMm: rect(5, 5, 15, 15),
        freePads: [
          freePad("tangent", {
            shape: "circle",
            center: { x: 4.5 + Q, y: 10 },
            widthMm: 1,
            heightMm: 1,
            netId: "gnd",
            layer: "F.Cu",
          }),
          freePad("clear", {
            shape: "circle",
            center: { x: 4.4, y: 10 },
            widthMm: 1,
            heightMm: 1,
            netId: "gnd",
            layer: "F.Cu",
          }),
        ],
      }),
    );
    expect(islands).toHaveLength(1);
    expect(islands[0]!.memberKeys).toEqual([freePadItemKey("tangent")]);
  });

  test("island order and membership do not depend on input order", () => {
    // A full-height different-net bar at x ∈ [9, 11] splits the plane in two.
    const freePads: PcbFreePad[] = [
      freePad("bar", {
        center: { x: 10, y: 10 },
        widthMm: 2,
        heightMm: 40,
        netId: "vcc",
        layer: "F.Cu",
      }),
      gndPad("left", 4, 10),
      gndPad("right", 16, 10),
    ];
    const forward = islandsOf(pour({ freePads }));
    const reversed = islandsOf(pour({ freePads: [...freePads].reverse() }));
    expect(forward).toHaveLength(2);
    expect(forward.map((i: CopperFillIsland) => i.memberKeys)).toEqual([
      [freePadItemKey("left")],
      [freePadItemKey("right")],
    ]);
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward));
  });
});

describe("island total order", () => {
  test("islands tied on (minX, minY, area) still have one stable order", () => {
    // Both triangles have minX = 0, minY = 0 and area 3; only maxX separates
    // them, which is exactly the clause a three-key sort would be missing.
    const a = {
      areaMm2: 3,
      rings: [[
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 0, y: 2 },
      ]],
    };
    const b = {
      areaMm2: 3,
      rings: [[
        { x: 0, y: 4 },
        { x: 4, y: 0 },
        { x: 4, y: 1.5 },
      ]],
    };
    expect(sortCopperFillIslands([a, b])).toEqual([a, b]);
    expect(sortCopperFillIslands([b, a])).toEqual([a, b]);
  });

  test("the canonical outer ring is rotation-invariant and breaks congruent ties", () => {
    // Same polygon, different start vertex: the canonical form must make these
    // compare equal, so a stable sort leaves them in input order.
    const square = { areaMm2: 2, rings: [rect(0, 0, 2, 1)] };
    const rotated = {
      areaMm2: 2,
      rings: [[
        { x: 2, y: 0 },
        { x: 2, y: 1 },
        { x: 0, y: 1 },
        { x: 0, y: 0 },
      ]],
    };
    expect(sortCopperFillIslands([square, rotated])).toEqual([square, rotated]);
    expect(sortCopperFillIslands([rotated, square])).toEqual([rotated, square]);

    // Same extent and area, one more vertex → the vertex-count clause decides,
    // and rotating the square's start vertex must not change the outcome.
    const notched = {
      areaMm2: 2,
      rings: [[
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 1 },
        { x: 0.5, y: 1 },
        { x: 0, y: 1 },
      ]],
    };
    expect(sortCopperFillIslands([notched, square])).toEqual([square, notched]);
    expect(sortCopperFillIslands([notched, rotated])).toEqual([rotated, notched]);
  });
});
