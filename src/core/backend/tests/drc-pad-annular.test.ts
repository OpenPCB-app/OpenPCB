/**
 * S11 — the annular-ring kernel against an independent oracle
 * (manufacturability contract 10 §3, §9).
 *
 * The oracle is deliberately built the OTHER way round from
 * `padSignedDistanceMm`: instead of the §3.2 closed forms it carries the pad
 * boundary as EXACT primitives (segments and circular arcs) in the shape's
 * local frame, measures the distance to each of them, and takes the sign from
 * a convex half-plane / disc membership test. Two structurally different
 * computations of the same number.
 *
 *  (a) SDF identity — over shapes x rotations x mirror x drills, the analytic
 *      `annularRingMm` equals the oracle's `min over the centreline of
 *      sdf − r_tool` to 1e-9.
 *  (b) The WALL reading — the minimum signed distance over a densely sampled
 *      drill wall (7200 points) is the same number: it is the ring's physical
 *      meaning, and it is what makes the "min over the centreline" shortcut a
 *      claim about copper rather than about a formula. Breakout cases assert
 *      the SIGN and the conservative direction instead (§3.1).
 *  (c) The concavity shortcut — a densely sampled slot centreline never beats
 *      its endpoints, which is why `min(sdf(a), sdf(b))` is exact.
 *  (d) Named cases: breakout, the roundrect clamp, `copperInsideDrill`, the
 *      frame inverse against `padOutlineWorldMm`, and the DRC verdicts §3.3
 *      pins (exactly-at-minimum passes, 1 nm below fails, breakout at a
 *      minimum of 0 still fires).
 */
import { describe, expect, test } from "bun:test";
import { runDrc } from "../../../modules/designer/backend/drc/drc-engine";
import {
  annularRingMm,
  copperInsideDrill,
  padSignedDistanceMm,
  type DrillGeometry,
  type PadCopperShape,
} from "../../../shared/pcb-geometry/pad-annular";
import { padCopperShape } from "../../../shared/pcb-geometry/pad-geometry";
import { padOutlineWorldMm } from "../../../shared/pcb-geometry/pad-outline";
import { below } from "../../../shared/pcb-geometry/tolerance";
import type { PcbPlacedPart, PcbPointMm } from "../../../sdks/designer";
import type { FootprintRenderSourcePad } from "../../../shared/rendering/types";
import { boardWithRules, codes, placement, projection } from "./helpers/drc-fixtures";

/* ------------------------------------------------------------------ oracle */

type Prim =
  | { kind: "seg"; a: PcbPointMm; b: PcbPointMm }
  | { kind: "arc"; c: PcbPointMm; r: number; from: number; to: number };

/**
 * The pad boundary as EXACT primitives in the shape-local frame, listed
 * counter-clockwise so a segment's inner side is its left. `circle` is a disc
 * of `widthMm` (§7); `trapezoid` / `custom` are rectangles (§0).
 */
function localPrimitives(shape: PadCopperShape): Prim[] {
  const hw = shape.widthMm / 2;
  const hh = shape.heightMm / 2;
  const box = (bw: number, bh: number): Prim[] => {
    const x = bw / 2;
    const y = bh / 2;
    return [
      { kind: "seg", a: { x: -x, y: -y }, b: { x, y: -y } },
      { kind: "seg", a: { x, y: -y }, b: { x, y } },
      { kind: "seg", a: { x, y }, b: { x: -x, y } },
      { kind: "seg", a: { x: -x, y }, b: { x: -x, y: -y } },
    ];
  };
  switch (shape.shape) {
    case "circle":
      return [{ kind: "arc", c: { x: 0, y: 0 }, r: hw, from: 0, to: 2 * Math.PI }];
    case "oval": {
      const r = Math.min(hw, hh);
      const d = Math.abs(shape.widthMm - shape.heightMm) / 2;
      if (shape.widthMm > shape.heightMm) {
        return [
          { kind: "seg", a: { x: -d, y: -r }, b: { x: d, y: -r } },
          { kind: "arc", c: { x: d, y: 0 }, r, from: -Math.PI / 2, to: Math.PI / 2 },
          { kind: "seg", a: { x: d, y: r }, b: { x: -d, y: r } },
          { kind: "arc", c: { x: -d, y: 0 }, r, from: Math.PI / 2, to: (3 * Math.PI) / 2 },
        ];
      }
      return [
        { kind: "seg", a: { x: r, y: -d }, b: { x: r, y: d } },
        { kind: "arc", c: { x: 0, y: d }, r, from: 0, to: Math.PI },
        { kind: "seg", a: { x: -r, y: d }, b: { x: -r, y: -d } },
        { kind: "arc", c: { x: 0, y: -d }, r, from: Math.PI, to: 2 * Math.PI },
      ];
    }
    case "roundrect": {
      const ratio = shape.roundrectRatio ?? 0.25;
      const r = Math.min(ratio * Math.min(shape.widthMm, shape.heightMm), hw, hh);
      if (r < 1e-6) return box(shape.widthMm, shape.heightMm);
      const cx = hw - r;
      const cy = hh - r;
      return [
        { kind: "seg", a: { x: -cx, y: -hh }, b: { x: cx, y: -hh } },
        { kind: "arc", c: { x: cx, y: -cy }, r, from: -Math.PI / 2, to: 0 },
        { kind: "seg", a: { x: hw, y: -cy }, b: { x: hw, y: cy } },
        { kind: "arc", c: { x: cx, y: cy }, r, from: 0, to: Math.PI / 2 },
        { kind: "seg", a: { x: cx, y: hh }, b: { x: -cx, y: hh } },
        { kind: "arc", c: { x: -cx, y: cy }, r, from: Math.PI / 2, to: Math.PI },
        { kind: "seg", a: { x: -hw, y: cy }, b: { x: -hw, y: -cy } },
        { kind: "arc", c: { x: -cx, y: -cy }, r, from: Math.PI, to: (3 * Math.PI) / 2 },
      ];
    }
    default:
      return box(shape.widthMm, shape.heightMm);
  }
}

function rotateBy(p: PcbPointMm, deg: number): PcbPointMm {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** Local -> world: `centre + R(rot)·M·local` (the record's own composition). */
function toWorld(shape: PadCopperShape, local: PcbPointMm): PcbPointMm {
  const m = shape.mirrored ? { x: -local.x, y: local.y } : local;
  const r = rotateBy(m, shape.rotationDeg);
  return { x: shape.centerMm.x + r.x, y: shape.centerMm.y + r.y };
}

/** World -> local: the explicit inverse `M·R(−rot)·(p − centre)`. */
function toLocal(shape: PadCopperShape, world: PcbPointMm): PcbPointMm {
  const r = rotateBy(
    { x: world.x - shape.centerMm.x, y: world.y - shape.centerMm.y },
    -shape.rotationDeg,
  );
  return shape.mirrored ? { x: -r.x, y: r.y } : r;
}

interface Nearest {
  d: number;
  /** Outward unit normal of the boundary at the nearest point. */
  nx: number;
  ny: number;
  /** `p − q`, the vector from the nearest boundary point to `p`. */
  vx: number;
  vy: number;
}

/** Nearest boundary point of ONE primitive, with the outward normal there. */
function nearestOnPrim(p: PcbPointMm, prim: Prim): Nearest {
  if (prim.kind === "seg") {
    const dx = prim.b.x - prim.a.x;
    const dy = prim.b.y - prim.a.y;
    const lenSq = dx * dx + dy * dy;
    let t = ((p.x - prim.a.x) * dx + (p.y - prim.a.y) * dy) / lenSq;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = prim.a.x + t * dx;
    const qy = prim.a.y + t * dy;
    const len = Math.sqrt(lenSq);
    // Edges run CCW, so the material is on the LEFT and the outward normal is
    // the right-hand one.
    return {
      d: Math.hypot(p.x - qx, p.y - qy),
      nx: dy / len,
      ny: -dx / len,
      vx: p.x - qx,
      vy: p.y - qy,
    };
  }
  const dx = p.x - prim.c.x;
  const dy = p.y - prim.c.y;
  const rho = Math.hypot(dx, dy);
  let ang = rho > 0 ? Math.atan2(dy, dx) : prim.from;
  while (ang < prim.from) ang += 2 * Math.PI;
  while (ang >= prim.from + 2 * Math.PI) ang -= 2 * Math.PI;
  if (ang > prim.to) {
    // Outside the arc's wedge: the nearest point is one of its endpoints, and
    // the outward normal there is still radial (the boundary is convex).
    ang =
      Math.abs(ang - prim.to) < Math.abs(prim.from + 2 * Math.PI - ang)
        ? prim.to
        : prim.from;
  }
  const qx = prim.c.x + Math.cos(ang) * prim.r;
  const qy = prim.c.y + Math.sin(ang) * prim.r;
  return {
    d: Math.hypot(p.x - qx, p.y - qy),
    nx: Math.cos(ang),
    ny: Math.sin(ang),
    vx: p.x - qx,
    vy: p.y - qy,
  };
}

/**
 * The oracle's signed distance — positive inside, like §3.2, but reached the
 * other way: the exact distance to the nearest boundary PRIMITIVE, signed by
 * whether `p` lies on the inner side of the outward normal there. Valid
 * because every S11 pad shape is convex, so the nearest boundary point's
 * normal decides membership (at a corner, an outside point lies in the normal
 * cone and the argmin primitive's normal is one of its generators).
 */
function oracleSdf(
  shape: PadCopperShape,
  prims: readonly Prim[],
  world: PcbPointMm,
): number {
  const p = toLocal(shape, world);
  let best: Nearest | null = null;
  for (const prim of prims) {
    const n = nearestOnPrim(p, prim);
    if (!best || n.d < best.d) best = n;
  }
  const b = best!;
  const outward = b.vx * b.nx + b.vy * b.ny;
  return outward > 0 ? -b.d : b.d;
}

/* ------------------------------------------------------------------- cases */

interface LocalDrill {
  name: string;
  /** Centre (round) or the two centreline endpoints (slot), pad-local. */
  a: PcbPointMm;
  b?: PcbPointMm;
  radiusMm: number;
}

const SHAPES: ReadonlyArray<Omit<PadCopperShape, "centerMm" | "rotationDeg" | "mirrored"> & { name: string }> = [
  { name: "circle", shape: "circle", widthMm: 2.4, heightMm: 2.4 },
  { name: "rect", shape: "rect", widthMm: 3.0, heightMm: 2.0 },
  { name: "oval-wide", shape: "oval", widthMm: 3.0, heightMm: 1.4 },
  { name: "oval-tall", shape: "oval", widthMm: 1.4, heightMm: 3.0 },
  { name: "roundrect-0.25", shape: "roundrect", widthMm: 3.0, heightMm: 2.0, roundrectRatio: 0.25 },
  // ratio 0.6 clamps to min(0.6·2.0, 1.5, 1.0) = 1.0 — a stadium.
  { name: "roundrect-clamped", shape: "roundrect", widthMm: 3.0, heightMm: 2.0, roundrectRatio: 0.6 },
  { name: "trapezoid", shape: "trapezoid", widthMm: 3.0, heightMm: 2.0 },
];

const ROTATIONS = [0, 30, 45, 90, 137, 270, 359];

const DRILLS: readonly LocalDrill[] = [
  { name: "round-centred", a: { x: 0, y: 0 }, radiusMm: 0.25 },
  { name: "round-offset", a: { x: 0.4, y: 0.2 }, radiusMm: 0.25 },
  { name: "slot-x", a: { x: -0.6, y: 0 }, b: { x: 0.6, y: 0 }, radiusMm: 0.25 },
  { name: "slot-y", a: { x: 0, y: -0.6 }, b: { x: 0, y: 0.6 }, radiusMm: 0.25 },
  // Runs past one end of every shape above -> a breakout.
  { name: "slot-past-end", a: { x: -1.6, y: 0 }, b: { x: 1.6, y: 0 }, radiusMm: 0.2 },
];

const CENTRE: PcbPointMm = { x: 12.5, y: -7.25 };

function shapeAt(
  base: (typeof SHAPES)[number],
  rotationDeg: number,
  mirrored: boolean,
): PadCopperShape {
  return {
    shape: base.shape,
    widthMm: base.widthMm,
    heightMm: base.heightMm,
    ...(base.roundrectRatio !== undefined
      ? { roundrectRatio: base.roundrectRatio }
      : {}),
    centerMm: CENTRE,
    rotationDeg,
    mirrored,
  };
}

function worldDrill(shape: PadCopperShape, drill: LocalDrill): DrillGeometry {
  const a = toWorld(shape, drill.a);
  if (!drill.b) return { centerMm: a, radiusMm: drill.radiusMm };
  const b = toWorld(shape, drill.b);
  return {
    centerMm: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    radiusMm: drill.radiusMm,
    slot: { a, b },
  };
}

/** Centreline endpoints of a drill, in world. */
function centrelineEnds(drill: DrillGeometry): PcbPointMm[] {
  return drill.slot ? [drill.slot.a, drill.slot.b] : [drill.centerMm];
}

/**
 * The drill WALL: every point at exactly `radiusMm` from the centreline — a
 * circle for a round hit, a stadium for a slot. `n` points, all exactly on the
 * true wall (no chord approximation).
 */
function wallPoints(drill: DrillGeometry, n: number): PcbPointMm[] {
  const r = drill.radiusMm;
  if (!drill.slot) {
    return Array.from({ length: n }, (_, i) => {
      const a = (i / n) * 2 * Math.PI;
      return {
        x: drill.centerMm.x + Math.cos(a) * r,
        y: drill.centerMm.y + Math.sin(a) * r,
      };
    });
  }
  const { a, b } = drill.slot;
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  // Left normal of the centreline; the wall is the two offset sides plus the
  // two cap semicircles, parameterised by arclength so samples are uniform.
  const nx = -uy;
  const ny = ux;
  const perimeter = 2 * len + 2 * Math.PI * r;
  const out: PcbPointMm[] = [];
  for (let i = 0; i < n; i += 1) {
    const s = (i / n) * perimeter;
    if (s < len) {
      out.push({ x: a.x + ux * s + nx * r, y: a.y + uy * s + ny * r });
    } else if (s < len + Math.PI * r) {
      // Cap at b: n at φ=0, u at φ=π/2, −n at φ=π.
      const f = (s - len) / r;
      const c = Math.cos(f);
      const sn = Math.sin(f);
      out.push({
        x: b.x + (nx * c + ux * sn) * r,
        y: b.y + (ny * c + uy * sn) * r,
      });
    } else if (s < 2 * len + Math.PI * r) {
      const t = s - len - Math.PI * r;
      out.push({ x: b.x - ux * t - nx * r, y: b.y - uy * t - ny * r });
    } else {
      // Cap at a: −n at φ=0, −u at φ=π/2, n at φ=π.
      const f = (s - 2 * len - Math.PI * r) / r;
      const c = Math.cos(f);
      const sn = Math.sin(f);
      out.push({
        x: a.x - (nx * c + ux * sn) * r,
        y: a.y - (ny * c + uy * sn) * r,
      });
    }
  }
  return out;
}

describe("annular-ring kernel — analytic vs an exact-primitive oracle", () => {
  test("(a) the ring equals the oracle's centreline minimum, every shape x rotation x mirror x drill", () => {
    let cases = 0;
    for (const base of SHAPES) {
      for (const rotationDeg of ROTATIONS) {
        for (const mirrored of [false, true]) {
          const shape = shapeAt(base, rotationDeg, mirrored);
          const prims = localPrimitives(shape);
          for (const local of DRILLS) {
            const drill = worldDrill(shape, local);
            const oracle =
              Math.min(
                ...centrelineEnds(drill).map((p) => oracleSdf(shape, prims, p)),
              ) - drill.radiusMm;
            const label = `${base.name} rot=${rotationDeg} mir=${mirrored} ${local.name}`;
            expect(
              Math.abs(annularRingMm(shape, drill) - oracle),
              `${label}: ${annularRingMm(shape, drill)} vs ${oracle}`,
            ).toBeLessThanOrEqual(1e-9);
            cases += 1;
          }
        }
      }
    }
    expect(cases).toBe(SHAPES.length * ROTATIONS.length * 2 * DRILLS.length);
  });

  test("(b) the ring is the minimum copper width measured from the drill WALL", () => {
    // 7200 wall samples: the sampled minimum of a smooth function overshoots
    // the true one by at most ~r·(Δθ/2)²/2 ≈ 5e-8 mm here, two orders below
    // the 1e-6 assertion. The boundary itself is exact (primitives, not a
    // polygon), so it contributes no error at all.
    const WALL_SAMPLES = 7200;
    let contained = 0;
    let breakout = 0;
    for (const base of SHAPES) {
      for (const rotationDeg of [0, 45, 137]) {
        for (const mirrored of [false, true]) {
          const shape = shapeAt(base, rotationDeg, mirrored);
          const prims = localPrimitives(shape);
          for (const local of DRILLS) {
            const drill = worldDrill(shape, local);
            const ring = annularRingMm(shape, drill);
            let sampled = Infinity;
            for (const p of wallPoints(drill, WALL_SAMPLES)) {
              const d = oracleSdf(shape, prims, p);
              if (d < sampled) sampled = d;
            }
            const label = `${base.name} rot=${rotationDeg} mir=${mirrored} ${local.name}`;
            if (ring > 0) {
              expect(
                Math.abs(sampled - ring),
                `${label}: wall ${sampled} vs ring ${ring}`,
              ).toBeLessThanOrEqual(1e-6);
              contained += 1;
            } else {
              // A negative ring is a conservative LOWER bound of the wall
              // deficit, not an exact measurement (§3.1).
              expect(sampled, `${label}: wall sign`).toBeLessThan(0);
              expect(ring, `${label}: conservative`).toBeLessThanOrEqual(
                sampled + 1e-6,
              );
              breakout += 1;
            }
          }
        }
      }
    }
    expect(contained).toBeGreaterThan(0);
    expect(breakout).toBeGreaterThan(0);
  });

  test("(c) a slot's minimum is at an endpoint — the concavity shortcut is exact", () => {
    for (const base of SHAPES) {
      for (const rotationDeg of [0, 137]) {
        for (const mirrored of [false, true]) {
          const shape = shapeAt(base, rotationDeg, mirrored);
          const prims = localPrimitives(shape);
          for (const local of DRILLS) {
            if (!local.b) continue;
            const drill = worldDrill(shape, local);
            const { a, b } = drill.slot!;
            const ends = Math.min(
              oracleSdf(shape, prims, a),
              oracleSdf(shape, prims, b),
            );
            for (let i = 1; i < 200; i += 1) {
              const t = i / 200;
              const p = {
                x: a.x + (b.x - a.x) * t,
                y: a.y + (b.y - a.y) * t,
              };
              expect(oracleSdf(shape, prims, p)).toBeGreaterThanOrEqual(
                ends - 1e-9,
              );
            }
          }
        }
      }
    }
  });
});

describe("annular-ring kernel — named cases", () => {
  const at = (
    shape: PadCopperShape["shape"],
    widthMm: number,
    heightMm: number,
    extra: Partial<PadCopperShape> = {},
  ): PadCopperShape => ({
    shape,
    widthMm,
    heightMm,
    centerMm: { x: 0, y: 0 },
    rotationDeg: 0,
    mirrored: false,
    ...extra,
  });

  test("a drill centre outside the copper gives a negative ring", () => {
    const shape = at("rect", 2, 1);
    const ring = annularRingMm(shape, {
      centerMm: { x: 1.4, y: 0 },
      radiusMm: 0.25,
    });
    expect(ring).toBeLessThan(0);
    expect(ring).toBeCloseTo(-0.4 - 0.25, 12);
  });

  test("a slot cap outside the copper gives a negative ring", () => {
    const shape = at("oval", 2.0, 1.0);
    // Caps at ±0.9: the right one is 0.4 mm past the copper's own cap centre,
    // whose sdf is 0.5 − 0.4 = 0.1 … still inside, so push it to ±1.2.
    const ring = annularRingMm(shape, {
      centerMm: { x: 0, y: 0 },
      radiusMm: 0.2,
      slot: { a: { x: -1.2, y: 0 }, b: { x: 1.2, y: 0 } },
    });
    expect(ring).toBeLessThan(0);
  });

  test("the roundrect corner radius clamps exactly as the pad ring builder's", () => {
    // ratio 0.6 on 3.0 x 2.0 clamps to min(1.2, 1.5, 1.0) = 1.0, which makes
    // the shape a stadium: the two must agree everywhere.
    const rr = at("roundrect", 3.0, 2.0, { roundrectRatio: 0.6 });
    const oval = at("oval", 3.0, 2.0);
    for (let i = 0; i < 64; i += 1) {
      const a = (i / 64) * 2 * Math.PI;
      const p = { x: Math.cos(a) * 1.7, y: Math.sin(a) * 1.1 };
      expect(padSignedDistanceMm(rr, p)).toBeCloseTo(
        padSignedDistanceMm(oval, p),
        12,
      );
    }
    // A radius that rounds to zero degrades to the rect formula, exactly as
    // `roundRectRing` and the Gerber writer's `r < 1e-6` branch do.
    const tiny = at("roundrect", 3.0, 2.0, { roundrectRatio: 1e-7 });
    expect(padSignedDistanceMm(tiny, { x: 1.5, y: 1.0 })).toBeCloseTo(0, 12);
  });

  test("copperInsideDrill: a square keeps its corners, a matching disc does not", () => {
    // Astra run 1 #3: `min(w, h)` is not a containment test.
    expect(
      copperInsideDrill(at("rect", 1, 1), {
        centerMm: { x: 0, y: 0 },
        radiusMm: 0.5,
      }),
    ).toBe(false);
    expect(
      copperInsideDrill(at("circle", 3.2, 3.2), {
        centerMm: { x: 0, y: 0 },
        radiusMm: 1.6,
      }),
    ).toBe(true);
    expect(
      copperInsideDrill(at("circle", 3.2, 3.2), {
        centerMm: { x: 0.1, y: 0 },
        radiusMm: 1.6,
      }),
    ).toBe(false);
  });

  test("the local frame is the exact inverse of the record's world transform", () => {
    // Every vertex of `padOutlineWorldMm` must read as sdf ≈ 0. The ring
    // CIRCUMSCRIBES its arcs, so a vertex sits sec(halfStep) − 1 OUTSIDE the
    // true copper — never inside.
    const cases: Array<{
      pad: FootprintRenderSourcePad;
      pl: PcbPlacedPart;
      tol: number;
    }> = [];
    const mk = (
      shape: FootprintRenderSourcePad["shape"],
      widthMm: number,
      heightMm: number,
      arcRadius: number,
      halfStep: number,
      roundrectRatio?: number,
    ): void => {
      const pad: FootprintRenderSourcePad = {
        id: "p1",
        number: "1",
        shape,
        centerMm: { x: 1.5, y: -0.75 },
        widthMm,
        heightMm,
        rotationDeg: 41,
        ...(roundrectRatio !== undefined ? { roundrectRatio } : {}),
      };
      for (const mirrored of [false, true]) {
        cases.push({
          pad,
          pl: placement("U1", {
            positionMm: { x: -3.25, y: 8.5 },
            rotationDeg: 23,
            ...(mirrored ? { layer: "B.Cu" as const } : {}),
            pads: [pad],
          }),
          tol: arcRadius * (1 / Math.cos(halfStep) - 1) + 1e-9,
        });
      }
    };
    mk("rect", 2.0, 1.2, 0, 0);
    mk("circle", 2.4, 2.4, 1.2, Math.PI / 48);
    mk("oval", 3.0, 1.4, 0.7, Math.PI / 48);
    mk("roundrect", 3.0, 2.0, 0.5, Math.PI / 24, 0.25);

    for (const { pad, pl, tol } of cases) {
      const shape = padCopperShape(pl, pad);
      for (const v of padOutlineWorldMm(pl, pad)) {
        const sdf = padSignedDistanceMm(shape, v);
        expect(sdf).toBeLessThanOrEqual(1e-9);
        expect(sdf).toBeGreaterThanOrEqual(-tol);
      }
    }
  });
});

describe("ANNULAR_RING_MIN verdicts (§3.3)", () => {
  const board = (annularRingMm: number) =>
    boardWithRules({ minimums: { annularRingMm, drillSizeMm: 0.1 } });

  /** One plated THT pad: circle `od`, centred drill `drill`. */
  const withPad = (od: number, drill: number, annular: number) =>
    runDrc(
      projection({
        board: board(annular),
        placements: [
          placement("U1", {
            pads: [
              {
                id: "p1",
                number: "1",
                shape: "circle",
                centerMm: { x: 0, y: 0 },
                widthMm: od,
                heightMm: od,
                rotationDeg: 0,
                drillDiameterMm: drill,
              },
            ],
          }),
        ],
      }),
    );

  test("a ring exactly at the minimum passes; one nanometre less fails", () => {
    // od 1.4 / drill 1.0 -> ring 0.200 exactly.
    expect(codes(withPad(1.4, 1.0, 0.2))).not.toContain("ANNULAR_RING_MIN");
    // 2 nm of copper removed per side -> a 2 nm ring deficit, past `below`'s
    // 1 nm grace. (A deficit of EXACTLY 1 nm is the grace itself and passes —
    // pinned below, so the mutation cannot silently widen.)
    expect(codes(withPad(1.4 - 4e-6, 1.0, 0.2))).toContain("ANNULAR_RING_MIN");
    expect(below(0.2, 0.2)).toBe(false);
    expect(below(0.2 - 1e-6, 0.2)).toBe(false);
    expect(below(0.2 - 2e-6, 0.2)).toBe(true);
  });

  test("a breakout fires even with the minimum set to zero", () => {
    // od 1.0 / drill 1.0 -> ring exactly 0: the wall IS the copper edge.
    const report = withPad(1.0, 1.0, 0);
    expect(codes(report)).toContain("ANNULAR_RING_MIN");
    const v = report.violations.find((x) => x.code === "ANNULAR_RING_MIN")!;
    expect(v.message).toContain("breaks out");
    // And a drill wider than the pad, likewise.
    expect(codes(withPad(1.0, 1.4, 0))).toContain("ANNULAR_RING_MIN");
  });
});
