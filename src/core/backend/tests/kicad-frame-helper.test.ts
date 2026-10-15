/**
 * H13 OP9 — `KicadBoardFrame` (H13 §3.8, KF1 §2-§3).
 *
 * Expected values are KF1 formulas worked by hand or a test-side transcription of
 * KiCad `RotatePoint` (libs/kimath/src/trigo.cpp @8.0.4: math-CW in Y-down). The
 * seeded algebra block encodes the same §3.1.3 reasoning as the implementation, so
 * it is a REGRESSION check, not an oracle; the back-side oracle is OP11's O4.
 */
import { describe, expect, test } from "bun:test";
import { buildFootprintPreviewFromParsed } from "@openpcb/kicad-import";
import { parseKicadFootprint, parseSexpr, type SExpr } from "@openpcb/kicad-parsers";
import {
  KICAD_BOARD_TRANSFORM_VERSION,
  KICAD_CANONICAL_FRAME_V1 as CANON,
  KICAD_LEGACY_FRAME as LEGACY,
  type KicadSide,
  boardImportFrameStamp,
  norm360,
  selectBoardFrame,
} from "../../../modules/designer/backend/import/kicad-project/kicad-frame";
import { norm360Grid } from "../../../shared/kicad-frame/angles";
import { transformPadCenterMm } from "../../../shared/pcb-geometry/pad-geometry";

type P = { x: number; y: number };

/** KiCad `RotatePoint(p, θ)`: visually CCW in the Y-down frame. */
function rotK(p: P, deg: number): P {
  const r = (deg * Math.PI) / 180;
  return {
    x: p.x * Math.cos(r) + p.y * Math.sin(r),
    y: -p.x * Math.sin(r) + p.y * Math.cos(r),
  };
}
const N = (p: P): P => ({ x: p.x, y: -p.y });

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("§3.1.3 placement algebra (seeded, non-oracle regression)", () => {
  test("composed canonical pad centre = N·(KiCad world) on both sides", () => {
    const rnd = mulberry32(0x5eed13);
    for (let i = 0; i < 400; i += 1) {
      const pK: P = { x: rnd() * 20 - 10, y: rnd() * 20 - 10 }; // front library local, K
      const at = { xMm: rnd() * 300 - 50, yMm: rnd() * 300 - 50 };
      const theta = i % 4 === 0 ? (Math.floor(rnd() * 4) * 90 - 90) : rnd() * 360 - 180;
      const side: KicadSide = i % 2 === 0 ? "front" : "back";
      // KiCad stores a back instance's children already flipped: local N·p.
      const local = side === "back" ? N(pK) : pK;
      const worldK = rotK(local, theta);
      const expected = N({ x: at.xMm + worldK.x, y: at.yMm + worldK.y });

      const origin = CANON.pointMm(at);
      const t = transformPadCenterMm(
        N(pK), // the canonical library local (SH1: kicadPointToCanonical)
        CANON.placementRotationDeg(theta, side),
        CANON.placementMirrored(side),
      );
      expect(origin.x + t.x).toBeCloseTo(expected.x, 9);
      expect(origin.y + t.y).toBeCloseTo(expected.y, 9);
    }
  });

  test("back-side worked example: front pad 1 at K (−1,0), flipped L/R → θ = 180", () => {
    // KiCad: θ = 180, stored local (−1, 0), world_K = at + RotK((−1,0), 180) = at + (1, 0).
    const at = { xMm: 10, yMm: 5 };
    expect(rotK({ x: -1, y: 0 }, 180).x).toBeCloseTo(1, 12);
    const rot = CANON.placementRotationDeg(180, "back");
    expect(rot).toBe(0);
    const t = transformPadCenterMm({ x: -1, y: 0 }, rot, CANON.placementMirrored("back"));
    const o = CANON.pointMm(at);
    expect({ x: o.x + t.x, y: o.y + t.y }).toEqual({ x: 11, y: -5 });
  });

  test("the legacy frame is NOT the KF1 composition on the back side", () => {
    const at = { xMm: 10, yMm: 5 };
    const pK = { x: 1, y: 0.5 };
    const worldK = rotK(N(pK), 30);
    const expected = N({ x: at.xMm + worldK.x, y: at.yMm + worldK.y });
    const t = transformPadCenterMm(N(pK), LEGACY.placementRotationDeg(30, "back"), true);
    const o = CANON.pointMm(at);
    expect(Math.hypot(o.x + t.x - expected.x, o.y + t.y - expected.y)).toBeGreaterThan(0.1);
  });
});

describe("points and boxes", () => {
  test("canonical nm: round in K, then negate; never −0", () => {
    expect(CANON.point({ xMm: 157.5, yMm: 135 })).toEqual({ x: 157_500_000, y: -135_000_000 });
    expect(CANON.point({ xMm: 0.0000004, yMm: -0.0000004 })).toEqual({ x: 0, y: 0 });
    expect(Object.is(CANON.point({ xMm: -0, yMm: 0 }).y, -0)).toBe(false);
    expect(Object.is(CANON.point({ xMm: -0, yMm: 0 }).x, -0)).toBe(false);
    const rnd = mulberry32(7);
    for (let i = 0; i < 200; i += 1) {
      const p = { xMm: (rnd() - 0.5) * 1e-5, yMm: (rnd() - 0.5) * 1e-5 };
      // Canonical y is exactly the negation of the legacy (K) rounding.
      expect(CANON.point(p).y).toBe(-LEGACY.point(p).y || 0);
      expect(CANON.point(p).x).toBe(LEGACY.point(p).x);
    }
  });

  test("pointMm negates y only; legacy is verbatim", () => {
    expect(CANON.pointMm({ xMm: 1.25, yMm: -2.5 })).toEqual({ x: 1.25, y: 2.5 });
    expect(Object.is(CANON.pointMm({ xMm: -0, yMm: 0 }).y, -0)).toBe(false);
    expect(LEGACY.pointMm({ xMm: 1.25, yMm: -2.5 })).toEqual({ x: 1.25, y: -2.5 });
  });

  test("schPoint uses the same N as point()", () => {
    const p = { xMm: 101.6, yMm: 50.8 };
    expect(CANON.schPoint(p)).toEqual(CANON.point(p));
    expect(LEGACY.schPoint(p)).toEqual(LEGACY.point(p));
  });

  test("bboxMm: minY = −maxY, maxY = −minY", () => {
    const b = { minXMm: 130, minYMm: 125, maxXMm: 170, maxYMm: 150 };
    expect(CANON.bboxMm(b)).toEqual({ minXMm: 130, minYMm: -150, maxXMm: 170, maxYMm: -125 });
    expect(LEGACY.bboxMm(b)).toEqual(b);
  });

  test("non-finite input throws instead of persisting NaN", () => {
    expect(() => CANON.point({ xMm: Number.NaN, yMm: 0 })).toThrow(RangeError);
    expect(() => LEGACY.pointMm({ xMm: 0, yMm: Infinity })).toThrow(RangeError);
    expect(() => CANON.placementRotationDeg(Number.NaN, "front")).toThrow(RangeError);
  });
});

describe("angles", () => {
  test("placement rotation: canonical back adds 180; fractional θ kept (E2)", () => {
    expect(CANON.placementRotationDeg(-90, "front")).toBe(270);
    expect(CANON.placementRotationDeg(-90, "back")).toBe(90);
    expect(CANON.placementRotationDeg(22.5, "front")).toBe(22.5);
    expect(CANON.placementRotationDeg(22.5, "back")).toBe(202.5);
    expect(CANON.placementRotationDeg(180, "back")).toBe(0);
    // −179.9 + 180 is 0.09999999999999432 in floating point; the 1e-9° grid removes it.
    expect(CANON.placementRotationDeg(-179.9, "back")).toBe(0.1);
    expect(CANON.schSymbolTransform(0.1, "x")).toEqual({ rotationDeg: 179.9, mirrored: true });
    expect(LEGACY.placementRotationDeg(-90, "back")).toBe(270);
    expect(LEGACY.placementRotationDeg(0.1, "front")).toBe(0.1);
  });

  test("mirrored iff back, both frames", () => {
    for (const f of [CANON, LEGACY]) {
      expect(f.placementMirrored("back")).toBe(true);
      expect(f.placementMirrored("front")).toBe(false);
    }
  });

  test("text rotation is norm360 in both frames (KF1 §2: angles unchanged by N)", () => {
    for (const f of [CANON, LEGACY]) {
      expect(f.textRotationDeg(-90)).toBe(270);
      expect(f.textRotationDeg(360)).toBe(0);
      expect(f.textRotationDeg(-1e-12)).toBe(0);
      expect(f.textRotationDeg(0.1)).toBe(0.1);
    }
    expect(norm360(359.9999999999)).toBe(0);
  });

  test("norm360Grid removes sum noise and keeps fractions", () => {
    expect(-179.9 + 180).not.toBe(0.1);
    expect(norm360Grid(-179.9 + 180)).toBe(0.1);
    expect(norm360Grid(22.5 - 10.1)).toBe(12.4);
    expect(norm360Grid(-1e-12)).toBe(0);
    expect(norm360Grid(359.9999999996)).toBe(0);
    expect(norm360Grid(123.456789)).toBe(123.456789);
  });

  test("arc sweep reverses under N (E5): signed turn of the mapped 3 points flips", () => {
    // In K the arc (0,−1) → (1,0) → (0,1); its signed turn in K coordinates.
    const pts: P[] = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
    const turn = (a: P, b: P, c: P) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const k = turn(pts[0]!, pts[1]!, pts[2]!);
    const c = pts.map((p) => CANON.pointMm({ xMm: p.x, yMm: p.y }));
    expect(Math.sign(turn(c[0]!, c[1]!, c[2]!))).toBe(-Math.sign(k));
    expect(CANON.arcSegmentCw(true)).toBe(false);
    expect(CANON.arcSegmentCw(false)).toBe(true);
    expect(LEGACY.arcSegmentCw(true)).toBe(true);
  });
});

describe("schSymbolTransform", () => {
  // KiCad 8.0.4 sch_io_kicad_sexpr_parser.cpp:2862-2867 (TRANSFORM(x1,y1,x2,y2) applied as
  // (x1·x + y1·y, x2·x + y2·y)) and sch_symbol.cpp:1649-1661 + :1748-1765 (A ← B·A).
  // A transcription of the source, independent of the implementation formula — not OP11's
  // corpus oracle.
  const AT: Record<number, [number, number, number, number]> = {
    0: [1, 0, 0, -1],
    90: [0, -1, -1, 0],
    180: [-1, 0, 0, 1],
    270: [0, 1, 1, 0],
  };
  const MIRROR: Record<"x" | "y", [number, number, number, number]> = {
    x: [1, 0, 0, -1],
    y: [-1, 0, 0, 1],
  };
  function kicadPin(p: P, theta: number, mirror: "x" | "y" | null): P {
    let [x1, y1, x2, y2] = AT[theta]!;
    if (mirror) {
      const [tx1, ty1, tx2, ty2] = MIRROR[mirror];
      [x1, y1, x2, y2] = [
        x1 * tx1 + x2 * ty1,
        y1 * tx1 + y2 * ty1,
        x1 * tx2 + x2 * ty2,
        y1 * tx2 + y2 * ty2,
      ];
    }
    return { x: x1 * p.x + y1 * p.y, y: x2 * p.x + y2 * p.y }; // K (Y-down)
  }
  const pins: P[] = [{ x: 2.54, y: 0 }, { x: 0, y: 5.08 }, { x: -1.27, y: -3.81 }];

  test("every (θ, mirror) composes like KiCad, in C", () => {
    for (const theta of [0, 90, 180, 270]) {
      for (const mirror of [null, "x", "y"] as const) {
        const t = CANON.schSymbolTransform(theta, mirror);
        for (const p of pins) {
          const got = transformPadCenterMm(p, t.rotationDeg, t.mirrored);
          const want = N(kicadPin(p, theta, mirror));
          expect(got.x).toBeCloseTo(want.x, 12);
          expect(got.y).toBeCloseTo(want.y, 12);
        }
      }
    }
  });

  test("the four canonical mirrored forms KiCad writes", () => {
    expect(CANON.schSymbolTransform(0, "y")).toEqual({ rotationDeg: 0, mirrored: true });
    expect(CANON.schSymbolTransform(0, "x")).toEqual({ rotationDeg: 180, mirrored: true });
    expect(CANON.schSymbolTransform(90, "x")).toEqual({ rotationDeg: 90, mirrored: true });
    expect(CANON.schSymbolTransform(270, "x")).toEqual({ rotationDeg: 270, mirrored: true });
    expect(CANON.schSymbolTransform(90, null)).toEqual({ rotationDeg: 90, mirrored: false });
  });

  test("non-oracle equivalence: mirror_y at θ+180 = mirror_x at θ", () => {
    for (const theta of [0, 90, 180, 270]) {
      expect(CANON.schSymbolTransform(theta + 180, "y")).toEqual(
        CANON.schSymbolTransform(theta, "x"),
      );
    }
  });

  test("legacy ignores mirror and keeps fractional angles", () => {
    expect(LEGACY.schSymbolTransform(90, "x")).toEqual({ rotationDeg: 90, mirrored: false });
    expect(LEGACY.schSymbolTransform(-45.5, null)).toEqual({ rotationDeg: 314.5, mirrored: false });
  });
});

describe("footprintToLibraryForm", () => {
  const BACK = parseSexpr(
    `(footprint "R:R_0603" (layer "B.Cu") (at 10 5 90)
       (pad "1" smd rect (at -0.8 0 90) (size 0.8 0.9) (layers "B.Cu" "B.Mask") (net 1 "GND")))`,
  ) as SExpr[];
  const FRONT = parseSexpr(
    `(footprint "R:R_0603" (layer "F.Cu") (at 10 5 90)
       (pad "1" smd rect (at -0.8 0 90) (size 0.8 0.9) (layers "F.Cu" "F.Mask")))`,
  ) as SExpr[];

  test("legacy: front verbatim, back refused", () => {
    expect(LEGACY.footprintToLibraryForm(FRONT, "front")).toBe(FRONT);
    expect(LEGACY.footprintToLibraryForm(BACK, "back")).toBeNull();
  });

  test("canonical: un-placed library form on both sides; side must agree", () => {
    const f = CANON.footprintToLibraryForm(FRONT, "front")!;
    const b = CANON.footprintToLibraryForm(BACK, "back")!;
    expect(f).toEqual(b);
    expect(f).toEqual(
      parseSexpr(
        `(footprint "R:R_0603" (layer "F.Cu") (pad "1" smd rect (at -0.8 0) (size 0.8 0.9) (layers "F.Cu" "F.Mask")))`,
      ) as SExpr[],
    );
    expect(() => CANON.footprintToLibraryForm(BACK, "front")).toThrow(/back side/);
  });
});

describe("frame selection and stamp", () => {
  const STAMP = {
    frame: "openpcb-y-up",
    origin: "kicad-converted",
    transformVersion: 1,
    tool: "@openpcb/kicad-import",
  };

  test("a qualified kicad-converted stamp selects the canonical frame", () => {
    expect(selectBoardFrame(STAMP)).toBe(CANON);
    expect(selectBoardFrame("openpcb-y-up/kicad-converted/1")).toBe(CANON);
  });

  test("anything else selects legacy", () => {
    for (const s of [
      undefined,
      null,
      "",
      "openpcb-y-up/kicad-converted/2",
      "openpcb-y-up/kicad-converted/01",
      "openpcb-y-up/kicad-converted/1/x",
      "openpcb-y-up/authored/0",
      { ...STAMP, transformVersion: 2 },
      { ...STAMP, transformVersion: 1.5 },
      { ...STAMP, origin: "authored", transformVersion: 0 },
      { ...STAMP, frame: "kicad-y-down" },
      [STAMP],
    ]) {
      expect(selectBoardFrame(s)).toBe(LEGACY);
    }
  });

  test("the pinned kicad-import 0.1.2 emits no stamp → legacy (H14 probe)", () => {
    const parsed = parseKicadFootprint(
      `(footprint "P" (layer "F.Cu") (pad "1" smd rect (at -1 0.5) (size 1 1) (layers "F.Cu")))`,
    );
    const preview = buildFootprintPreviewFromParsed(parsed) as unknown as { frame?: unknown };
    expect(selectBoardFrame(preview.frame)).toBe(LEGACY);
  });

  test("boardImportFrameStamp", () => {
    expect(boardImportFrameStamp(CANON)).toEqual({
      frame: "kicad-canonical-v1",
      kicadBoardTransformVersion: KICAD_BOARD_TRANSFORM_VERSION,
    });
    expect(boardImportFrameStamp(LEGACY)).toEqual({
      frame: "kicad-legacy-unqualified",
      kicadBoardTransformVersion: null,
    });
  });

  test("frames are frozen", () => {
    expect(Object.isFrozen(CANON)).toBe(true);
    expect(Object.isFrozen(LEGACY)).toBe(true);
  });
});
