/**
 * S12b §1 — copper is a convex core ⊕ a disc
 * (docs/pcb-hardening/12-exact-geometry-contract.md §1, §9).
 *
 * The kernel claims to be EXACT where the chord ring was circumscribed, and
 * byte-identical everywhere the ring was already the exact shape. Both halves
 * are pinned here:
 *
 * - exactness against a 4096-point support-sampled boundary, over every pad
 *   shape × rotation × mirror;
 * - `r === 0` byte identity against the pre-S12b primitives, kept verbatim in
 *   this file as the oracle, over the synthetic corpus;
 * - the S7 #5 fabricated contact (two same-net ovals 2 µm apart) now OPEN;
 * - the degenerate cores §1.1 legalises (coincident spine / corners);
 * - Astra run 1 #1 (a one-point core half inside a keepout) and #16 (two plain
 *   circles byte-identical).
 */
import { describe, expect, test } from "bun:test";
import { buildDrcContext } from "../../../modules/designer/backend/drc/drc-context";
import {
  padPadGap,
  padViaGap,
  tracePadGap,
} from "../../../modules/designer/backend/drc/pair-gap";
import type { PcbPlacedPart, PcbPointMm } from "../../../sdks/designer";
import {
  buildCopperRecords,
  copperTouch,
  endCapTouches,
  toCopperItems,
  viaTouchesOnLayer,
  type PadCopperItem,
  type TraceCopperItem,
  type ViaCopperItem,
} from "../../../shared/pcb-connectivity";
import {
  padOutlineWorldMm,
  padRoundedWorldMm,
  shapeRoundedAroundOrigin,
} from "../../../shared/pcb-geometry/pad-outline";
import {
  placementMirrorX,
  padWorldPositionMm,
  transformPadCenterMm,
} from "../../../shared/pcb-geometry/pad-geometry";
import {
  circleToPolygonDistance,
  polygonToPolygonDistance,
  polylineToPolygonDistance,
} from "../../../shared/pcb-geometry/pcb-clearance-geometry";
import {
  convexDistance,
  roundedGap,
  roundedOverlapsRing,
  roundedPoint,
} from "../../../shared/pcb-geometry/rounded-shape";
import type { RoundedShape } from "../../../shared/pcb-geometry/rounded-shape-types";
import { CONNECT_EPS_MM } from "../../../shared/pcb-geometry/tolerance";
import {
  freePad,
  pad,
  placement,
  projection,
  trace,
  via,
} from "./helpers/drc-fixtures";
import { lcg, synthesizeBoard } from "./helpers/drc-synthetic";

// ---------------------------------------------------------------------------
// Oracle — deliberately shares NO code with the kernel under test.
// ---------------------------------------------------------------------------

const DENSE_SEGMENTS = 4096;

function oracleDistinct(core: readonly PcbPointMm[]): PcbPointMm[] {
  const out: PcbPointMm[] = [];
  for (const p of core) {
    if (!out.some((q) => q.x === p.x && q.y === p.y)) out.push(p);
  }
  return out;
}

/**
 * The boundary of `core ⊕ B_r` as a `DENSE_SEGMENTS`-gon whose vertices lie
 * EXACTLY on it: the offset outline of the convex core — the flat side over
 * each core edge, then the arc that turns the outward normal at each core
 * vertex. Only the arcs are sampled, so the polygon is inscribed and its
 * distance to another shape overshoots the true one by at most
 * `r · (1 − cos(π / 4096)) ≈ 7.4e-8 · r`. Sampling support points per
 * DIRECTION instead would collapse each flat side to a single point — a
 * stadium's long sides would vanish.
 */
function denseBoundary(shape: RoundedShape): PcbPointMm[] {
  const core = oracleDistinct(shape.core);
  const r = shape.radiusMm;
  if (core.length === 1) {
    return Array.from({ length: DENSE_SEGMENTS }, (_, i) => {
      const a = (i / DENSE_SEGMENTS) * 2 * Math.PI;
      return { x: core[0]!.x + Math.cos(a) * r, y: core[0]!.y + Math.sin(a) * r };
    });
  }
  // Counter-clockwise, so the outward normal of v_i → v_{i+1} is (dy, −dx).
  const ccw = core.length >= 3 && oracleSignedArea(core) < 0 ? [...core].reverse() : core;
  const n = ccw.length;
  const normals = ccw.map((v, i) => {
    const w = ccw[(i + 1) % n]!;
    const len = Math.hypot(w.x - v.x, w.y - v.y);
    return { x: (w.y - v.y) / len, y: -(w.x - v.x) / len };
  });
  const perVertex = Math.max(8, Math.floor(DENSE_SEGMENTS / n));
  const out: PcbPointMm[] = [];
  for (let i = 0; i < n; i += 1) {
    const v = ccw[i]!;
    const w = ccw[(i + 1) % n]!;
    const nm = normals[i]!;
    out.push({ x: v.x + nm.x * r, y: v.y + nm.y * r });
    out.push({ x: w.x + nm.x * r, y: w.y + nm.y * r });
    // Arc at w, from this edge's normal to the next one, the short CCW way.
    const next = normals[(i + 1) % n]!;
    const a0 = Math.atan2(nm.y, nm.x);
    let sweep = Math.atan2(next.y, next.x) - a0;
    while (sweep <= 0) sweep += 2 * Math.PI;
    for (let k = 1; k < perVertex; k += 1) {
      const a = a0 + (sweep * k) / perVertex;
      out.push({ x: w.x + Math.cos(a) * r, y: w.y + Math.sin(a) * r });
    }
  }
  return out;
}

function oracleSignedArea(ring: readonly PcbPointMm[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a;
}

function oraclePointSegment(
  p: PcbPointMm,
  a: PcbPointMm,
  b: PcbPointMm,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  const c = Math.min(1, Math.max(0, t));
  return Math.hypot(p.x - (a.x + dx * c), p.y - (a.y + dy * c));
}

function oracleCross(o: PcbPointMm, a: PcbPointMm, b: PcbPointMm): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function oracleSegSeg(
  a: PcbPointMm,
  b: PcbPointMm,
  c: PcbPointMm,
  d: PcbPointMm,
): number {
  const d1 = oracleCross(a, b, c);
  const d2 = oracleCross(a, b, d);
  const d3 = oracleCross(c, d, a);
  const d4 = oracleCross(c, d, b);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  return Math.min(
    oraclePointSegment(a, c, d),
    oraclePointSegment(b, c, d),
    oraclePointSegment(c, a, b),
    oraclePointSegment(d, a, b),
  );
}

function oracleInside(p: PcbPointMm, ring: readonly PcbPointMm[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
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

/** Distance from segment AB to a convex core; 0 when they meet. */
function oracleSegmentToCore(
  a: PcbPointMm,
  b: PcbPointMm,
  core: readonly PcbPointMm[],
): number {
  if (core.length === 0) return Infinity;
  if (core.length === 1) return oraclePointSegment(core[0]!, a, b);
  if (core.length >= 3 && (oracleInside(a, core) || oracleInside(b, core))) {
    return 0;
  }
  let best = Infinity;
  for (let i = 0; i < core.length; i += 1) {
    const d = oracleSegSeg(a, b, core[i]!, core[(i + 1) % core.length]!);
    if (d < best) best = d;
  }
  return best;
}

/**
 * The true gap: the closest point of A to B lies on A's boundary, so the
 * minimum over the dense boundary's EDGES (not its vertices — a flat side's
 * interior is where a stadium most often meets its neighbour) is exact up to
 * the arc sampling.
 */
function oracleGap(denseA: readonly PcbPointMm[], b: RoundedShape): number {
  const core = oracleDistinct(b.core);
  let best = Infinity;
  for (let i = 0; i < denseA.length; i += 1) {
    const d = oracleSegmentToCore(
      denseA[i]!,
      denseA[(i + 1) % denseA.length]!,
      core,
    );
    if (d < best) best = d;
  }
  return best - b.radiusMm;
}

// ---------------------------------------------------------------------------
// 1. Exactness against the dense boundary
// ---------------------------------------------------------------------------

const SHAPES = [
  { shape: "circle" as const, w: 1.2, h: 1.2 },
  { shape: "oval" as const, w: 1.8, h: 0.9 }, // spine along X
  { shape: "oval" as const, w: 0.7, h: 1.6 }, // spine along Y
  { shape: "roundrect" as const, w: 1.6, h: 1.0 },
  { shape: "roundrect" as const, w: 1.0, h: 1.0 },
  { shape: "rect" as const, w: 1.4, h: 0.8 },
];

/** A grid of placements whose pads cover every shape × rotation × mirror. */
function randomPadRecords(seed: number, placements: number) {
  const rnd = lcg(seed);
  const parts: PcbPlacedPart[] = [];
  for (let i = 0; i < placements; i += 1) {
    const spec = SHAPES[i % SHAPES.length]!;
    const spec2 = SHAPES[(i * 3 + 1) % SHAPES.length]!;
    parts.push(
      placement(`p${i}`, {
        positionMm: {
          x: (i % 8) * 2.6 + rnd() * 0.6,
          y: Math.floor(i / 8) * 2.6 + rnd() * 0.6,
        },
        rotationDeg: [0, 90, 180, 270, 37.5][i % 5]!,
        mirrored: i % 3 === 0,
        layer: i % 3 === 0 ? "B.Cu" : "F.Cu",
        pads: [
          pad("1", { x: -0.6, y: 0.35 }, spec.w, spec.h, {
            shape: spec.shape,
            rotationDeg: [0, 45, 90, 13][i % 4]!,
            ...(spec.shape === "roundrect" ? { roundrectRatio: 0.3 } : {}),
          }),
          pad("2", { x: 0.7, y: -0.4 }, spec2.w, spec2.h, {
            shape: spec2.shape,
            rotationDeg: [0, 90, 22.5][i % 3]!,
            ...(spec2.shape === "roundrect" ? { roundrectRatio: 0.45 } : {}),
          }),
        ],
      }),
    );
  }
  return buildCopperRecords({
    layerCount: 2,
    placements: parts,
    padNetIds: new Map(),
    freePads: [],
    traces: [],
    vias: [],
  }).pads;
}

describe("roundedGap is exact (§1.2)", () => {
  test(
    "matches a 4096-point support-sampled boundary on every shape / rotation / mirror",
    () => {
      const pads = randomPadRecords(20260911, 40);
      const dense = pads.map((p) => denseBoundary(p.rounded));
      let separated = 0;
      let worst = 0;
      for (let i = 0; i < pads.length; i += 1) {
        for (let j = i + 1; j < pads.length; j += 1) {
          const a = pads[i]!;
          const b = pads[j]!;
          const gap = roundedGap(a.rounded, b.rounded);
          const oracle = oracleGap(dense[i]!, b.rounded);
          if (oracle <= 0) {
            // Overlapping: the kernel reports a lower bound on penetration,
            // not the depth (§1.2) — only the sign is contracted.
            expect(gap).toBeLessThanOrEqual(0);
            continue;
          }
          separated += 1;
          const err = Math.abs(oracle - gap);
          if (err > worst) worst = err;
          expect(err).toBeLessThanOrEqual(1e-6);
          // Symmetric: a reversed pair is the same measurement.
          expect(roundedGap(b.rounded, a.rounded)).toBe(gap);
        }
      }
      expect(separated).toBeGreaterThanOrEqual(2000);
      expect(worst).toBeLessThanOrEqual(1e-6);
    },
    120_000,
  );
});

// ---------------------------------------------------------------------------
// 2. The S7 #5 fabricated contact
// ---------------------------------------------------------------------------

describe("two same-net oval pads 2 µm apart are OPEN (S7 #5)", () => {
  /** Caps of radius 0.5; A spans x ∈ [-1, 1], B ∈ [1.002, 3.002]. */
  const items = () =>
    toCopperItems(
      buildCopperRecords({
        layerCount: 2,
        placements: [],
        padNetIds: new Map(),
        freePads: [
          freePad("a", {
            shape: "oval",
            widthMm: 2,
            heightMm: 1,
            center: { x: 0, y: 0 },
            netId: "n1",
          }),
          freePad("b", {
            shape: "oval",
            widthMm: 2,
            heightMm: 1,
            center: { x: 2.002, y: 0 },
            netId: "n1",
          }),
        ],
        traces: [],
        vias: [],
      }),
    ) as PadCopperItem[];

  test("the circumscribed rings still overlap — the contact was fabricated", () => {
    const [a, b] = items();
    // sec(π/48) inflates each 0.5 mm cap by ~1.07 µm, so the two rings meet
    // across a real 2 µm gap.
    expect(polygonToPolygonDistance(a!.ring, b!.ring)).toBeLessThanOrEqual(
      CONNECT_EPS_MM,
    );
  });

  test("the exact shapes are 2 µm apart and read OPEN", () => {
    const [a, b] = items();
    expect(roundedGap(a!.rounded, b!.rounded)).toBeCloseTo(0.002, 12);
    expect(copperTouch(a!, b!)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. `r === 0` byte identity over the synthetic corpus
// ---------------------------------------------------------------------------

describe("a zero-radius core is byte-identical to the S12 ring path (§1.2)", () => {
  test(
    "every rect / trapezoid / custom pair over 200 synthetic boards",
    () => {
      let padPairs = 0;
      let viaPairs = 0;
      let tracePairs = 0;
      for (let seed = 1; seed <= 200; seed += 1) {
        const ctx = buildDrcContext(
          synthesizeBoard({ seed, items: 40, keepouts: 1 }),
        );
        const flat = ctx.pads.filter((p) => p.rounded.radiusMm === 0);
        for (let i = 0; i < flat.length; i += 1) {
          const a = flat[i]!;
          for (let j = i + 1; j < flat.length; j += 1) {
            const b = flat[j]!;
            padPairs += 1;
            // The pre-S12b `padPadGap`, verbatim.
            expect(padPadGap(a, b).gap).toBe(
              polygonToPolygonDistance(a.ring, b.ring),
            );
          }
          for (const via of ctx.vias) {
            viaPairs += 1;
            expect(padViaGap(a, via).gap).toBe(
              circleToPolygonDistance(via.center, via.radiusMm, a.ring),
            );
          }
          for (const t of ctx.traces) {
            tracePairs += 1;
            expect(tracePadGap(t, a).gap).toBe(
              polylineToPolygonDistance(t.pointsMm, a.ring) - t.halfWidthMm,
            );
          }
        }
      }
      expect(padPairs).toBeGreaterThanOrEqual(1000);
      expect(viaPairs).toBeGreaterThanOrEqual(1000);
      expect(tracePairs).toBeGreaterThanOrEqual(1000);
    },
    120_000,
  );
});

// ---------------------------------------------------------------------------
// 4. Astra run 1 #16 — two plain circles
// ---------------------------------------------------------------------------

test("two circle pads at 0.2 with r = 0.05 group the radii first (#16)", () => {
  const a = roundedPoint({ x: 0, y: 0 }, 0.05);
  const b = roundedPoint({ x: 0.2, y: 0 }, 0.05);
  expect(roundedGap(a, b)).toBe(0.2 - (0.05 + 0.05));
  // The left-to-right grouping the identity would have broken.
  expect(0.2 - 0.05 - 0.05).not.toBe(0.2 - (0.05 + 0.05));
});

// ---------------------------------------------------------------------------
// 5. The core rides the SAME transform chain as the ring (§1.1)
// ---------------------------------------------------------------------------

describe("core vertices are bit-identical to ring vertices (§1.1)", () => {
  const mirroredAt90 = (padSpec: ReturnType<typeof pad>) =>
    placement("u1", {
      positionMm: { x: 7.25, y: -3.125 },
      rotationDeg: 90,
      mirrored: true,
      layer: "B.Cu",
      pads: [padSpec],
    });

  test("a rect pad's core IS its ring", () => {
    const p = pad("1", { x: 1.5, y: -0.75 }, 2, 1, { shape: "rect" });
    const place = mirroredAt90(p);
    const ring = padOutlineWorldMm(place, p);
    const core = padRoundedWorldMm(place, p, ring).core;
    expect(core.length).toBe(ring.length);
    for (let i = 0; i < ring.length; i += 1) {
      expect(Object.is(core[i]!.x, ring[i]!.x)).toBe(true);
      expect(Object.is(core[i]!.y, ring[i]!.y)).toBe(true);
    }
  });

  test("a roundrect pad's core rides rotate → + centre → transform", () => {
    const p = pad("1", { x: 1.5, y: -0.75 }, 2, 1, {
      shape: "roundrect",
      rotationDeg: 30,
      roundrectRatio: 0.25,
    });
    const place = mirroredAt90(p);
    const local = shapeRoundedAroundOrigin(p)!;
    const core = padRoundedWorldMm(place, p, padOutlineWorldMm(place, p)).core;
    const mirrored = placementMirrorX(place);
    for (let i = 0; i < local.core.length; i += 1) {
      const v = local.core[i]!;
      const t = transformPadCenterMm(
        { x: v.x + p.centerMm.x, y: v.y + p.centerMm.y },
        place.rotationDeg,
        mirrored,
      );
      expect(Object.is(core[i]!.x, place.positionMm.x + t.x)).toBe(true);
      expect(Object.is(core[i]!.y, place.positionMm.y + t.y)).toBe(true);
    }
  });

  test("a circle pad's core IS the disc centre the record already carries", () => {
    const p = pad("1", { x: 1.5, y: -0.75 }, 1.2, 1.2, { shape: "circle" });
    const place = mirroredAt90(p);
    const records = buildCopperRecords({
      layerCount: 2,
      placements: [place],
      padNetIds: new Map(),
      freePads: [],
      traces: [],
      vias: [],
    });
    const record = records.pads[0]!;
    const centre = padWorldPositionMm(place, p);
    expect(record.rounded.core.length).toBe(1);
    expect(Object.is(record.rounded.core[0]!.x, centre.x)).toBe(true);
    expect(Object.is(record.rounded.core[0]!.y, centre.y)).toBe(true);
    expect(Object.is(record.rounded.core[0]!.x, record.disc!.center.x)).toBe(
      true,
    );
    expect(record.rounded.radiusMm).toBe(record.disc!.radiusMm);
  });
});

// ---------------------------------------------------------------------------
// 6. Degenerate cores §1.1 legalises
// ---------------------------------------------------------------------------

describe("coincident core points collapse to the lower arity (§1.1)", () => {
  const roundedOf = (spec: {
    shape: string;
    widthMm: number;
    heightMm: number;
    roundrectRatio?: number;
  }): RoundedShape =>
    shapeRoundedAroundOrigin({
      shape: spec.shape,
      widthMm: spec.widthMm,
      heightMm: spec.heightMm,
      rotationDeg: 0,
      ...(spec.roundrectRatio !== undefined
        ? { roundrectRatio: spec.roundrectRatio }
        : {}),
    })!;

  test("an oval with w === h is a disc", () => {
    const oval = roundedOf({ shape: "oval", widthMm: 1, heightMm: 1 });
    expect(oval.core.length).toBe(2);
    // `-0 === 0`, which is what the kernel's collapse compares on.
    expect(oval.core[0]!.x === oval.core[1]!.x).toBe(true);
    expect(oval.core[0]!.y === oval.core[1]!.y).toBe(true);
    const probe = roundedPoint({ x: 3, y: 0 }, 0.25);
    expect(roundedGap(oval, probe)).toBe(3 - (0.5 + 0.25));
    expect(convexDistance(oval.core, probe.core)).toBe(3);
  });

  test("a full-radius roundrect in ONE dimension is a stadium", () => {
    // ratio 0.5 of min(w, h) = 0.5 ⇒ r clamps to h/2, so the X extent survives.
    const rr = roundedOf({
      shape: "roundrect",
      widthMm: 2,
      heightMm: 1,
      roundrectRatio: 0.5,
    });
    expect(rr.radiusMm).toBe(0.5);
    const distinct = new Set(rr.core.map((p) => `${p.x + 0},${p.y + 0}`));
    expect(distinct.size).toBe(2);
    // Identical to the oval of the same box.
    const oval = roundedOf({ shape: "oval", widthMm: 2, heightMm: 1 });
    const probe = roundedPoint({ x: 0, y: 4 }, 0.1);
    expect(roundedGap(rr, probe)).toBe(roundedGap(oval, probe));
  });

  test("a full-radius roundrect in BOTH dimensions is a disc", () => {
    const rr = roundedOf({
      shape: "roundrect",
      widthMm: 1,
      heightMm: 1,
      roundrectRatio: 0.5,
    });
    expect(new Set(rr.core.map((p) => `${p.x + 0},${p.y + 0}`)).size).toBe(1);
    const probe = roundedPoint({ x: 2, y: 0 }, 0.25);
    expect(roundedGap(rr, probe)).toBe(2 - (0.5 + 0.25));
  });
});

// ---------------------------------------------------------------------------
// 7. Astra run 1 #1 — a one-point core half inside a keepout
// ---------------------------------------------------------------------------

describe("roundedOverlapsRing is dimension-aware (§1.2, Astra run 1 #1)", () => {
  const UNIT_SQUARE: PcbPointMm[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];

  test("a circle pad half inside the ring overlaps it", () => {
    expect(
      roundedOverlapsRing(roundedPoint({ x: -0.05, y: 0.5 }, 0.1), UNIT_SQUARE),
    ).toBe(true);
  });

  test("a circle pad wholly inside the ring overlaps it", () => {
    expect(
      roundedOverlapsRing(roundedPoint({ x: 0.5, y: 0.5 }, 0.01), UNIT_SQUARE),
    ).toBe(true);
  });

  test("a circle pad tangent to the ring does not", () => {
    expect(
      roundedOverlapsRing(roundedPoint({ x: -0.1, y: 0.5 }, 0.1), UNIT_SQUARE),
    ).toBe(false);
  });

  test("an oval pad whose circumscribed ring grazes the keepout does not", () => {
    const records = buildCopperRecords({
      layerCount: 2,
      placements: [],
      padNetIds: new Map(),
      // Cap centre at x = 1.5, cap radius 0.5 ⇒ exact left edge at x = 1.0,
      // circumscribed ring at 1.0 − 1.07e-3.
      freePads: [
        freePad("o", {
          shape: "oval",
          widthMm: 2,
          heightMm: 1,
          center: { x: 2, y: 0.5 },
        }),
      ],
      traces: [],
      vias: [],
    });
    const rounded = records.pads[0]!.rounded;
    expect(roundedOverlapsRing(rounded, UNIT_SQUARE)).toBe(false);
    // The ring the pre-S12b verdict used does reach inside.
    expect(
      records.pads[0]!.ring.some((p) => p.x < 1 && p.x > 0 && p.y > 0 && p.y < 1),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. The kernel is live in the DRC context
// ---------------------------------------------------------------------------

test("DrcPad carries the exact shape, copied not aliased", () => {
  const ctx = buildDrcContext(
    projection({
      freePads: [
        freePad("o", { shape: "oval", widthMm: 2, heightMm: 1 }),
        freePad("r", {
          shape: "rect",
          widthMm: 1,
          heightMm: 1,
          center: { x: 5, y: 0 },
        }),
      ],
    }),
  );
  const oval = ctx.pads.find((p) => p.rounded.radiusMm > 0)!;
  const rect = ctx.pads.find((p) => p.rounded.radiusMm === 0)!;
  expect(oval.rounded.core.length).toBe(2);
  // A flat pad's core IS its (copied) ring — one array, never two that drift.
  expect(rect.rounded.core).toBe(rect.ring);
});

// ---------------------------------------------------------------------------
// 9. R1 #1 — the regrouping's verdict window at exactly CONNECT_EPS_MM
// ---------------------------------------------------------------------------

/**
 * `touch.ts` used to group a circle pair's radii SUCCESSIVELY
 * (`Math.hypot(…) − rA − rB`) while `pair-gap.ts` grouped them first;
 * `roundedGap` unified on summed-first over `Math.sqrt`. The two halves of the
 * same question therefore agree now, at the price of a verdict at EXACTLY the
 * 0.5 nm contact tolerance flipping either way by the regrouping's last bits.
 * This pins how wide that window is: every disagreement must sit inside
 * `FLIP_WINDOW_MM`, and anything a picometre clear of the threshold must be
 * decided the same way by both.
 */
describe("the summed-first regrouping only moves verdicts at the threshold", () => {
  /** Measured max |gap − CONNECT_EPS_MM| over a ±60 ulp sweep: 4.12e-17 mm. */
  const FLIP_WINDOW_MM = 1e-15;
  /** A picometre — 6 orders above the window, 3 below the 1 nm coordinate quantum. */
  const CLEAR_OF_THRESHOLD_MM = 1e-12;
  const NM = 1e-6;
  /** Pad widths in integer NANOMETRES, the persisted unit (R1's case list). */
  const WIDTHS_A_NM = [300001, 500001, 800001, 1200001, 250001];
  const WIDTHS_B_NM = [100000, 200000, 400000, 600000];

  const ulpView = new DataView(new ArrayBuffer(8));
  /** `steps` floats above `x`; `x > 0` finite, so the bit pattern increments. */
  function ulpStep(x: number, steps: number): number {
    ulpView.setFloat64(0, x);
    ulpView.setBigUint64(0, ulpView.getBigUint64(0) + BigInt(steps));
    return ulpView.getFloat64(0);
  }

  function circlePair(waNm: number, wbNm: number, centreMm: number) {
    const circle = (id: string, wNm: number, x: number) =>
      freePad(id, {
        shape: "circle",
        widthMm: wNm * NM,
        heightMm: wNm * NM,
        center: { x, y: 0 },
        netId: "n1",
      });
    const records = buildCopperRecords({
      layerCount: 2,
      placements: [],
      padNetIds: new Map(),
      freePads: [circle("a", waNm, 0), circle("b", wbNm, centreMm)],
      traces: [],
      vias: [],
    });
    const items = toCopperItems(records) as PadCopperItem[];
    const ra = records.pads[0]!.rounded.radiusMm;
    const rb = records.pads[1]!.rounded.radiusMm;
    return {
      touch: copperTouch(items[0]!, items[1]!),
      // The pre-S12b successive grouping, kept here as the oracle.
      legacyGap: Math.hypot(centreMm, 0) - ra - rb,
    };
  }

  test("a picometre either side of the threshold is decided, not flipped", () => {
    for (const waNm of WIDTHS_A_NM) {
      for (const wbNm of WIDTHS_B_NM) {
        // `wa + wb` is odd, so the centre distance whose copper gap is exactly
        // CONNECT_EPS_MM (0.5 nm) is the integer `(wa + wb + 1) / 2` nm.
        const critical = ((waNm + wbNm + 1) / 2) * NM;
        expect(
          circlePair(waNm, wbNm, critical + CLEAR_OF_THRESHOLD_MM).touch,
        ).toBe(false);
        expect(
          circlePair(waNm, wbNm, critical - CLEAR_OF_THRESHOLD_MM).touch,
        ).toBe(true);
      }
    }
  });

  test("every flip against the old grouping sits inside the window", () => {
    let samples = 0;
    let disagreements = 0;
    let worst = 0;
    for (const waNm of WIDTHS_A_NM) {
      for (const wbNm of WIDTHS_B_NM) {
        const critical = ((waNm + wbNm + 1) / 2) * NM;
        for (let k = -60; k <= 60; k += 1) {
          const { touch, legacyGap } = circlePair(
            waNm,
            wbNm,
            ulpStep(critical, k),
          );
          samples += 1;
          if (touch !== legacyGap <= CONNECT_EPS_MM) {
            disagreements += 1;
            worst = Math.max(worst, Math.abs(legacyGap - CONNECT_EPS_MM));
          }
        }
      }
    }
    expect(samples).toBe(2420);
    // Non-vacuous: the regrouping really does move verdicts at the threshold.
    expect(disagreements).toBeGreaterThan(0);
    expect(worst).toBeLessThanOrEqual(FLIP_WINDOW_MM);
  });
});

// ---------------------------------------------------------------------------
// 10. R1 #2 — the graph and the dangling predicates judge ONE shape
// ---------------------------------------------------------------------------

describe("every connectivity predicate reads the same pad copper", () => {
  /**
   * Oval pad 2 x 1 at the origin: exact copper spans x ∈ [−1, 1], its
   * circumscribed ring reaches 1.000107. A via / trace end cap of radius 0.3 at
   * x = 1.300002 is 2 µm clear of the copper and 105 µm inside the ring, so the
   * ring path called it connected while the graph called it open — and
   * `UNCONNECTED_NET` then fired with `VIA_DANGLING` / `TRACK_DANGLING` silent.
   */
  const build = () => {
    const records = buildCopperRecords({
      layerCount: 2,
      placements: [],
      padNetIds: new Map(),
      freePads: [
        freePad("p", {
          shape: "oval",
          widthMm: 2,
          heightMm: 1,
          center: { x: 0, y: 0 },
          netId: "n1",
        }),
      ],
      traces: [
        trace(
          "t",
          "n1",
          [
            [4, 0],
            [1.300002, 0],
          ],
          { widthMm: 0.6 },
        ),
      ],
      vias: [
        via("v", {
          netId: "n1",
          center: { x: 1.300002, y: 0 },
          diameterMm: 0.6,
        }),
      ],
    });
    const items = toCopperItems(records);
    return {
      records,
      pad: items.find((i) => i.kind === "pad") as PadCopperItem,
      via: items.find((i) => i.kind === "via") as ViaCopperItem,
      trace: items.find((i) => i.kind === "trace") as TraceCopperItem,
    };
  };

  test("the circumscribed ring does reach past the exact copper", () => {
    const { records, pad } = build();
    expect(Math.max(...records.pads[0]!.ring.map((p) => p.x))).toBeGreaterThan(
      1,
    );
    expect(Math.max(...pad.rounded.core.map((p) => p.x))).toBe(0.5);
  });

  test("viaTouchesOnLayer agrees with the graph", () => {
    const { pad, via: v } = build();
    expect(copperTouch(pad, v)).toBe(false);
    expect(viaTouchesOnLayer(v, pad, "F.Cu")).toBe(false);
  });

  test("endCapTouches agrees with the graph", () => {
    const { pad, trace: t } = build();
    expect(copperTouch(t, pad)).toBe(false);
    expect(endCapTouches(t, 1, pad)).toBe(false);
  });

  test("copper that really does touch is still connected on every path", () => {
    // The same geometry, moved 3 µm in: the via now overlaps the exact copper.
    const records = buildCopperRecords({
      layerCount: 2,
      placements: [],
      padNetIds: new Map(),
      freePads: [
        freePad("p", {
          shape: "oval",
          widthMm: 2,
          heightMm: 1,
          center: { x: 0, y: 0 },
          netId: "n1",
        }),
      ],
      traces: [],
      vias: [
        via("v", {
          netId: "n1",
          center: { x: 1.299997, y: 0 },
          diameterMm: 0.6,
        }),
      ],
    });
    const items = toCopperItems(records);
    const pad = items.find((i) => i.kind === "pad") as PadCopperItem;
    const v = items.find((i) => i.kind === "via") as ViaCopperItem;
    expect(copperTouch(pad, v)).toBe(true);
    expect(viaTouchesOnLayer(v, pad, "F.Cu")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 11. R1 #3 — a dimension that cannot define a radius keeps the ring
// ---------------------------------------------------------------------------

describe("a non-positive dimension never yields a negative radius", () => {
  const gapAgainstSquareAt2 = (spec: {
    shape: string;
    widthMm: number;
    heightMm: number;
    roundrectRatio?: number;
  }) => {
    const records = buildCopperRecords({
      layerCount: 2,
      placements: [],
      padNetIds: new Map(),
      freePads: [
        freePad("a", {
          shape: spec.shape as "oval",
          widthMm: spec.widthMm,
          heightMm: spec.heightMm,
          center: { x: 0, y: 0 },
          ...(spec.roundrectRatio !== undefined
            ? { roundrectRatio: spec.roundrectRatio }
            : {}),
        }),
        freePad("b", {
          shape: "rect",
          widthMm: 1,
          heightMm: 1,
          center: { x: 2, y: 0 },
        }),
      ],
      traces: [],
      vias: [],
    });
    const [a, b] = records.pads;
    return {
      radiusMm: a!.rounded.radiusMm,
      rounded: roundedGap(a!.rounded, b!.rounded),
      ring: polygonToPolygonDistance(a!.ring, b!.ring),
      coreIsRing: a!.rounded.core === a!.ring,
    };
  };

  // A negative radius would make `d − (rA + rB)` report a gap LARGER than the
  // copper's — a false PASS. The ring is merely conservative, so it is the
  // right fallback.
  for (const [name, spec] of [
    ["oval w < 0", { shape: "oval", widthMm: -2, heightMm: 1 }],
    ["oval h < 0", { shape: "oval", widthMm: 2, heightMm: -1 }],
    ["circle w < 0", { shape: "circle", widthMm: -1, heightMm: 1 }],
    ["oval w = 0", { shape: "oval", widthMm: 0, heightMm: 1 }],
  ] as const) {
    test(`${name} falls back to the ring`, () => {
      const r = gapAgainstSquareAt2(spec);
      expect(r.radiusMm).toBe(0);
      expect(r.coreIsRing).toBe(true);
      expect(r.rounded).toBe(r.ring);
    });
  }

  // The free-pad fixture carries no `roundrectRatio`, so the ratio guard is
  // asserted on the builder directly.
  test("a roundrect with an unusable ratio has no core of its own", () => {
    const rr = (roundrectRatio: number) =>
      shapeRoundedAroundOrigin({
        shape: "roundrect",
        widthMm: 2,
        heightMm: 1,
        rotationDeg: 0,
        roundrectRatio,
      });
    // NaN slips past `roundRectRing`'s `r <= 0` fallback, which is why the
    // guard tests for a USABLE radius rather than a positive one.
    expect(rr(NaN)).toBeNull();
    expect(rr(-0.5)).toBeNull();
    expect(rr(0)).toBeNull();
    expect(rr(Infinity)).not.toBeNull();
    // Clamped to half the short side — a full-radius stadium, not a defect.
    expect(rr(Infinity)!.radiusMm).toBe(0.5);
  });

  test("a circle ignores a defect HEIGHT, exactly as its ring does", () => {
    // `heightMm` never reaches the circle's geometry (contract 10 §7), so a
    // defect there must not cost the pad its exact disc — `disc` and `rounded`
    // would then disagree.
    const r = gapAgainstSquareAt2({ shape: "circle", widthMm: 1, heightMm: -5 });
    expect(r.radiusMm).toBe(0.5);
    expect(r.rounded).toBe(2 - (0.5 + 0.5));
  });
});
