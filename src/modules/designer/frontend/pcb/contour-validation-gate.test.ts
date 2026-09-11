/**
 * The EDITOR's contour gate under Vitest (exact-geometry contract 12 §3.2).
 *
 * `validateContour` is what the draw tool, fillet / chamfer and DXF import run
 * on every produced shape, and its simplicity arm now shares ONE predicate with
 * `BOARD_OUTLINE_INVALID`. The Bun suite (`core/backend/tests/
 * contour-validation.test.ts`) covers the same module from the backend side;
 * this file pins the frontend-facing contract, because a `*.test.ts` under
 * `src/shared/rendering/**` runs in NEITHER runner.
 */
import { describe, expect, test } from "vitest";
import type { PcbBoardContour, PcbPointMm } from "../../../../sdks";
import {
  normalizeContour,
  validateContour,
} from "../../../../shared/rendering/pcb/contour-validation";

/** A point at `deg` on the circle of radius `r` about the origin. */
const at = (deg: number, r = 30): PcbPointMm => ({
  x: r * Math.cos((deg * Math.PI) / 180),
  y: r * Math.sin((deg * Math.PI) / 180),
});

/** A comb whose teeth all span the full width — the simplicity sweep's worst case. */
function comb(teeth: number, crossing: boolean): PcbBoardContour {
  const segments: PcbBoardContour["segments"] = [];
  const w = 100;
  let y = 0;
  for (let i = 0; i < teeth; i += 1) {
    const x = i % 2 === 0 ? w : -w;
    segments.push(line(x, y));
    y += 0.2;
    segments.push(line(x, y));
  }
  if (crossing) segments.push(line(0, -2));
  segments.push(line(-w - 5, y));
  segments.push(line(-w - 5, -5));
  segments.push(line(-w, -5));
  segments.push(line(-w, 0));
  return normalizeContour({
    kind: "contour",
    widthMm: 2 * w + 10,
    heightMm: y + 10,
    centerMm: { x: 0, y: y / 2 },
    start: { x: -w, y: 0 },
    segments,
  });
}

const P = (x: number, y: number): PcbPointMm => ({ x, y });
const line = (x: number, y: number) => ({ type: "line" as const, to: P(x, y) });
const arcTo = (to: PcbPointMm, centerMm: PcbPointMm, cw: boolean) => ({
  type: "arc" as const,
  to,
  centerMm,
  cw,
});

function contour(segments: PcbBoardContour["segments"]): PcbBoardContour {
  return normalizeContour({
    kind: "contour",
    widthMm: 40,
    heightMm: 40,
    centerMm: P(0, 0),
    start: P(-20, -20),
    segments,
  });
}

describe("validateContour — the editor gate", () => {
  test("a filleted rectangle is accepted", () => {
    expect(
      validateContour(
        contour([
          line(20, -20),
          line(20, 10),
          arcTo(P(10, 20), P(10, 10), false),
          line(-20, 20),
          line(-20, -20),
        ]),
      ).ok,
    ).toBe(true);
  });

  test("S2 #8: two arcs 0.002 mm apart are simple, not self-intersecting", () => {
    // The S2 #8 class: a feature closer to an arc than the chord deviation
    // (0.0099 mm at r = 19.999). Two semicircular notches cut from opposite
    // edges leave a 0.002 mm bridge of board between their arcs — non-adjacent
    // primitives at 0.002 mm > GEOM_EPS_MM, so §3 (b) calls the ring SIMPLE.
    // The pre-S12b arm judged this on chords; the chord-vs-exact disagreement
    // itself is pinned in `core/backend/tests/drc-outline-exact.test.ts`, which
    // can reach the biased rings this gate never sees.
    const r = 19.999;
    const shape = contour([
      line(20, -20),
      line(20, -r),
      arcTo(P(20, r), P(20, 0), true),
      line(20, 20),
      line(-20, 20),
      line(-20, r),
      arcTo(P(-20, -r), P(-20, 0), true),
      line(-20, -20),
    ]);
    expect(validateContour(shape).ok).toBe(true);
  });

  test("a genuinely self-crossing contour is still refused", () => {
    const result = validateContour(
      contour([line(20, -20), line(-20, 20), line(20, 20), line(-20, -20)]),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors.map((e) => e.code)).toContain(
      "self-intersects",
    );
  });

  test("a same-circle RETRACE has its own wording", () => {
    // §3 (b): a boundary traversed twice is not a crossing. Three arcs of ONE
    // circle — 350° out, 20° back, 10° back — every pair sharing an angular
    // INTERVAL rather than a point.
    const retraced: PcbBoardContour = {
      kind: "contour",
      widthMm: 60,
      heightMm: 60,
      centerMm: P(0, 0),
      start: P(30, 0),
      segments: [
        arcTo(at(-10), P(0, 0), false),
        arcTo(at(10), P(0, 0), false),
        arcTo(P(30, 0), P(0, 0), true),
      ],
    };
    const result = validateContour(retraced);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors[0]).toEqual({
      code: "self-intersects",
      message: "outline retraces the same arc",
    });
  });

  test("a primitive the CANONICAL ring degenerates has its own wording", () => {
    // The arc's authored `to` is 2 µm past its start radius at the SAME angle:
    // inside `arc-radius-mismatch`'s band (0.01 mm at r = 10) and outside
    // `full-circle-arc`'s coincidence rule (1e-3 mm), so every authored check
    // passes. Canonicalisation projects that end onto the start radius, where it
    // lands exactly on the start — a 2π sweep, which §3 (b) calls degenerate.
    const collapsing: PcbBoardContour = {
      kind: "contour",
      widthMm: 40,
      heightMm: 40,
      centerMm: P(0, 0),
      start: P(10, 0),
      segments: [arcTo(P(10.002, 0), P(0, 0), false), line(20, -10), line(10, 0)],
    };
    const result = validateContour(collapsing);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors[0]).toEqual({
      code: "self-intersects",
      message: "outline has a degenerate edge",
    });
  });

  test("an exhausted comparison budget falls back to the CHORD rule", () => {
    // 1204 primitives that all span the full width: the sweep's active list
    // never shortens and `CONTOUR_EXACT_BUDGET` runs out, so the gate answers
    // with `ringSelfIntersects` on the flattened ring. It must still accept a
    // valid comb and still refuse a crossing one — the draw tool may not be
    // blocked, and it may not let a self-crossing shape through either.
    expect(validateContour(comb(600, false)).ok).toBe(true);
    const crossing = validateContour(comb(600, true));
    expect(crossing.ok).toBe(false);
    expect(
      crossing.ok === false && crossing.errors.map((e) => e.code),
    ).toContain("self-intersects");
  });

  test("AUTHORED rules are judged before canonicalisation", () => {
    // Astra run 1 #8: projecting the arc's end onto the start radius first
    // would erase a 1 mm authored mismatch and make this contour legal.
    const result = validateContour(
      contour([
        line(20, -20),
        line(20, 10),
        // `to` is 1 mm off the circle of the start radius about the centre.
        arcTo(P(11, 20), P(10, 10), false),
        line(-20, 20),
        line(-20, -20),
      ]),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.errors[0]!.code).toBe(
      "arc-radius-mismatch",
    );
  });
});
