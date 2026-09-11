/**
 * Profile parity: the Edge.Cuts the fab receives IS the exact contour, and it
 * is the same board the canvas draws (exact-geometry contract 12 §6).
 *
 * The file is PARSED back — mode lines, `I`/`J` operands and all — never read
 * through the writer's own helpers, and the parser runs `strict` so an
 * unmodelled `G` command fails the test instead of silently changing how every
 * following move plots.
 *
 * Four independent claims, per golden board and per synthetic outline:
 *
 *  (a) one closed loop per contour, and the loop count is 1 + the cutouts;
 *  (b) the loop closes and keeps the ring's handedness (a reflected axis
 *      convention would reverse it);
 *  (c) merging the ≤ 90° pieces back into arcs reproduces `exactContour` —
 *      centre and endpoints within 1 nm, radius within `2√2 nm` (the bound
 *      independent 1 nm rounding of the centre and of an endpoint allows,
 *      Astra run 1 #15), direction identical;
 *  (d) flattening the PARSED arcs with the default chord rule agrees with
 *      `flattenOutline` within `MAX_CHORD_DEVIATION_MM` — the Profile, the
 *      canvas and the snapshot describe one board.
 *
 * Plus the two emission rules that have no geometric witness: no arc command
 * may carry a zero chord (a CAM reads one as a full circle, Astra run 1 #14),
 * and `G75` / `G02` / `G03` appear exactly when an arc is actually emitted.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildGerberLayer } from "../../../modules/designer/backend/export/gerber/writer";
import {
  arcSegmentCount,
  MAX_CHORD_DEVIATION_MM,
} from "../../../shared/pcb-geometry/arc-chords";
import {
  exactContour,
  exactRingSignedArea,
} from "../../../shared/pcb-geometry/exact-contour";
import type { ExactRing } from "../../../shared/pcb-geometry/exact-arcs";
import { ringPrims } from "../../../shared/pcb-geometry/exact-ring";
import { flattenOutline } from "../../../shared/pcb-geometry/outline-geometry";
import { projectPointToSegment } from "../../../shared/pcb-geometry/segment-predicates";
import type {
  DesignerPcbProjection,
  PcbBoardCutout,
  PcbBoardOutline,
  PcbPointMm,
} from "../../../sdks/designer/types";
import { board, projection } from "./helpers/drc-fixtures";
import { SYNTHETIC } from "./helpers/gerber-outline-fixtures";
import { fixtureToProjection } from "./helpers/drc-golden";
import { parseGerber, type GerberStroke } from "./helpers/gerber-parse";

const GOLDEN_DIR = join(import.meta.dir, "fixtures/drc/golden");

/** One Gerber quantum (mm). Every tolerance below is stated in these. */
const NM = 1e-6;
/** Centre / endpoint agreement: one quantum (§6 "quantise once"). */
const POINT_TOL_MM = NM;
/** Radius agreement: `2√2 nm` — independent rounding of centre and endpoint. */
const RADIUS_TOL_MM = 2 * Math.SQRT2 * NM;
/** The writer's own line fallback: a piece whose chord is under 2 nm. */
const MICRO_CHORD_MM = 2 * NM;

// ---------------------------------------------------------------------------
// Reconstruction
// ---------------------------------------------------------------------------

type Piece =
  | { kind: "line"; a: PcbPointMm; b: PcbPointMm }
  | { kind: "arc"; a: PcbPointMm; b: PcbPointMm; c: PcbPointMm; cw: boolean };

function dist(a: PcbPointMm, b: PcbPointMm): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The pieces one Profile loop was plotted from, in emission order. */
function strokePieces(stroke: GerberStroke): Piece[] {
  const out: Piece[] = [];
  for (let i = 1; i < stroke.points.length; i += 1) {
    const prev = stroke.points[i - 1]!;
    const here = stroke.points[i]!;
    const a = { x: prev.xMm, y: prev.yMm };
    const b = { x: here.xMm, y: here.yMm };
    out.push(
      here.arc
        ? {
            kind: "arc",
            a,
            b,
            c: { x: here.arc.c.xMm, y: here.arc.c.yMm },
            cw: here.arc.cw,
          }
        : { kind: "line", a, b },
    );
  }
  return out;
}

/**
 * The exact ring as the same piece vocabulary. A segment that quantises to
 * nothing is dropped, because the writer drops it too — the alternative is to
 * demand a zero-length draw command the contract forbids.
 */
function exactPieces(ring: ExactRing): Piece[] {
  const out: Piece[] = [];
  for (const prim of ringPrims(ring)) {
    if (prim.kind === "seg") {
      if (
        Math.round(prim.a.x / NM) === Math.round(prim.b.x / NM) &&
        Math.round(prim.a.y / NM) === Math.round(prim.b.y / NM)
      ) {
        continue;
      }
      out.push({ kind: "line", a: prim.a, b: prim.b });
      continue;
    }
    out.push({
      kind: "arc",
      a: prim.a,
      b: prim.b,
      c: prim.c,
      cw: prim.sweep < 0,
    });
  }
  return out;
}

/**
 * The writer's sub-2 nm line fallback, undone: such a piece is always the first
 * or last slice of ONE arc (quadrant boundaries are π/2 apart, so a tiny slice
 * can only sit at an arc's end), and the arc it belongs to is the adjacent arc
 * piece. Undoing it keeps the merged arc's endpoint on the RING vertex, which
 * is what the 1 nm endpoint bound is stated against.
 */
function absorbMicroLines(pieces: Piece[]): Piece[] {
  const out = [...pieces];
  for (let i = out.length - 1; i >= 0 && out.length > 1; i -= 1) {
    const piece = out[i]!;
    if (piece.kind !== "line" || dist(piece.a, piece.b) >= MICRO_CHORD_MM) {
      continue;
    }
    const next = out[(i + 1) % out.length]!;
    const prevIndex = (i - 1 + out.length) % out.length;
    const prev = out[prevIndex]!;
    if (next.kind === "arc") {
      out[(i + 1) % out.length] = { ...next, a: piece.a };
      out.splice(i, 1);
    } else if (prev.kind === "arc") {
      out[prevIndex] = { ...prev, b: piece.b };
      out.splice(i, 1);
    }
  }
  return out;
}

/** Consecutive pieces of ONE circle turning ONE way are one arc again. */
function mergeArcs(pieces: Piece[]): Piece[] {
  const out = [...pieces];
  for (let guard = 0; guard < pieces.length && out.length > 1; guard += 1) {
    let merged = false;
    for (let i = 0; i < out.length; i += 1) {
      const j = (i + 1) % out.length;
      if (i === j) break;
      const head = out[i]!;
      const tail = out[j]!;
      if (head.kind !== "arc" || tail.kind !== "arc") continue;
      if (head.cw !== tail.cw) continue;
      if (dist(head.c, tail.c) > POINT_TOL_MM / 2) continue;
      out[i] = { kind: "arc", a: head.a, b: tail.b, c: head.c, cw: head.cw };
      out.splice(j, 1);
      merged = true;
      break;
    }
    if (!merged) break;
  }
  return out;
}

function primitives(pieces: Piece[]): Piece[] {
  return mergeArcs(absorbMicroLines(pieces));
}

/**
 * The cyclic rotation of `actual` that lines up with `expected`. Merging across
 * the ring's wrap point moves the starting offset, and the loop carries no
 * intrinsic start — so the comparison picks the alignment and then asserts on
 * it, rather than assuming the two lists begin at the same vertex.
 */
function alignRotation(actual: Piece[], expected: Piece[]): Piece[] {
  let best = actual;
  let bestError = Infinity;
  for (let r = 0; r < actual.length; r += 1) {
    const rotated = [...actual.slice(r), ...actual.slice(0, r)];
    let error = 0;
    for (let i = 0; i < Math.min(rotated.length, expected.length); i += 1) {
      error += dist(rotated[i]!.a, expected[i]!.a);
    }
    if (error < bestError) {
      bestError = error;
      best = rotated;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Flattening (claim d)
// ---------------------------------------------------------------------------

/** Signed sweep of a parsed piece, from its reconstructed centre. */
function pieceSweep(piece: Piece & { kind: "arc" }): number {
  const a0 = Math.atan2(piece.a.y - piece.c.y, piece.a.x - piece.c.x);
  const a1 = Math.atan2(piece.b.y - piece.c.y, piece.b.x - piece.c.x);
  const tau = Math.PI * 2;
  let sweep = a1 - a0;
  if (piece.cw) {
    while (sweep >= 0) sweep -= tau;
  } else {
    while (sweep <= 0) sweep += tau;
  }
  return sweep;
}

/** The loop as a chord ring, arcs stepped by the DEFAULT chord rule. */
function flattenPieces(pieces: readonly Piece[]): PcbPointMm[] {
  const out: PcbPointMm[] = [];
  for (const piece of pieces) {
    out.push(piece.a);
    if (piece.kind !== "arc") continue;
    const r = dist(piece.a, piece.c);
    const sweep = pieceSweep(piece);
    const a0 = Math.atan2(piece.a.y - piece.c.y, piece.a.x - piece.c.x);
    const steps = Math.max(1, arcSegmentCount(r, Math.abs(sweep), "inscribed"));
    for (let k = 1; k < steps; k += 1) {
      const angle = a0 + (sweep * k) / steps;
      out.push({
        x: piece.c.x + Math.cos(angle) * r,
        y: piece.c.y + Math.sin(angle) * r,
      });
    }
  }
  return out;
}

/** Distance from `p` to the closed polyline `ring`. */
function pointToRing(p: PcbPointMm, ring: readonly PcbPointMm[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const d = projectPointToSegment(
      p,
      ring[i]!,
      ring[(i + 1) % ring.length]!,
    ).distance;
    if (d < best) best = d;
  }
  return best;
}

function hausdorff(a: readonly PcbPointMm[], b: readonly PcbPointMm[]): number {
  let worst = 0;
  for (const p of a) worst = Math.max(worst, pointToRing(p, b));
  for (const p of b) worst = Math.max(worst, pointToRing(p, a));
  return worst;
}

function ringArea(ring: readonly PcbPointMm[]): number {
  let twice = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i]!;
    const q = ring[(i + 1) % ring.length]!;
    twice += p.x * q.y - q.x * p.y;
  }
  return twice / 2;
}

// ---------------------------------------------------------------------------
// The assertion, run against every board below
// ---------------------------------------------------------------------------

function profileLoops(proj: DesignerPcbProjection): GerberStroke[] {
  const gerber = buildGerberLayer(proj, "edge_cuts", []);
  return parseGerber(gerber, { strict: true }).strokes;
}

function assertProfileParity(proj: DesignerPcbProjection, label: string): void {
  const outline = proj.board.outline;
  const cutouts = proj.board.cutouts ?? [];
  const shapes: PcbBoardOutline[] = [
    outline,
    ...cutouts.map((cut: PcbBoardCutout) => cut.shape),
  ];
  const loops = profileLoops(proj);
  // (a) one loop per contour.
  expect(`${label}: loops=${loops.length}`).toBe(
    `${label}: loops=${shapes.length}`,
  );

  shapes.forEach((shape, index) => {
    const where = `${label}#${index}`;
    const loop = loops[index]!;
    const pieces = strokePieces(loop);
    const ring = exactContour(shape);

    // (b) closure and handedness.
    const first = loop.points[0]!;
    const last = loop.points[loop.points.length - 1]!;
    expect(
      `${where}: closed=${
        dist({ x: first.xMm, y: first.yMm }, { x: last.xMm, y: last.yMm }) <=
        POINT_TOL_MM
      }`,
    ).toBe(`${where}: closed=true`);
    const flat = flattenPieces(pieces);
    expect(`${where}: ccw=${ringArea(flat) > 0}`).toBe(
      `${where}: ccw=${exactRingSignedArea(ring) > 0}`,
    );

    // (e) no zero-chord arc command, every piece ≤ 90°, and (g) the per-piece
    // radius bound a shared quantised centre leaves.
    for (const piece of pieces) {
      if (piece.kind !== "arc") continue;
      expect(dist(piece.a, piece.b)).toBeGreaterThanOrEqual(
        MICRO_CHORD_MM - 1e-12,
      );
      expect(Math.abs(pieceSweep(piece))).toBeLessThanOrEqual(
        Math.PI / 2 + 1e-9,
      );
      expect(
        Math.abs(dist(piece.a, piece.c) - dist(piece.b, piece.c)),
      ).toBeLessThanOrEqual(RADIUS_TOL_MM);
    }

    // (c) the merged pieces ARE the exact ring.
    const expected = primitives(exactPieces(ring));
    const actual = alignRotation(primitives(pieces), expected);
    expect(`${where}: prims=${actual.map((p) => p.kind).join(",")}`).toBe(
      `${where}: prims=${expected.map((p) => p.kind).join(",")}`,
    );
    actual.forEach((piece, i) => {
      const want = expected[i]!;
      expect(dist(piece.a, want.a)).toBeLessThanOrEqual(POINT_TOL_MM);
      expect(dist(piece.b, want.b)).toBeLessThanOrEqual(POINT_TOL_MM);
      if (piece.kind !== "arc" || want.kind !== "arc") return;
      expect(`${where}[${i}]: cw=${piece.cw}`).toBe(
        `${where}[${i}]: cw=${want.cw}`,
      );
      expect(dist(piece.c, want.c)).toBeLessThanOrEqual(POINT_TOL_MM);
      const wantR = dist(want.a, want.c);
      expect(Math.abs(dist(piece.a, piece.c) - wantR)).toBeLessThanOrEqual(
        RADIUS_TOL_MM,
      );
    });

    // (d) one board: the Profile's own curve and the canvas flattening.
    expect(hausdorff(flat, flattenOutline(shape))).toBeLessThanOrEqual(
      MAX_CHORD_DEVIATION_MM,
    );
  });
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

const GOLDEN_NAMES = readdirSync(GOLDEN_DIR)
  .filter((f) => f.endsWith(".json") && !f.endsWith(".expected.json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

function loadGolden(name: string): DesignerPcbProjection {
  return fixtureToProjection(
    JSON.parse(readFileSync(join(GOLDEN_DIR, `${name}.json`), "utf8")),
  );
}

function outlineProjection(
  outline: PcbBoardOutline,
  cutouts: PcbBoardCutout[] = [],
): DesignerPcbProjection {
  return projection({ board: board({ outline, cutouts }) });
}

describe("Gerber Profile — exact arcs (12 §6)", () => {
  for (const name of GOLDEN_NAMES) {
    test(`${name}: Profile ≡ exactContour ≡ the canvas flattening`, () => {
      assertProfileParity(loadGolden(name), name);
    });
  }

  for (const [name, outline, cutouts] of SYNTHETIC) {
    test(`${name}: Profile ≡ exactContour ≡ the canvas flattening`, () => {
      assertProfileParity(outlineProjection(outline, cutouts), name);
    });
  }

  test("mode lines appear exactly when an arc is emitted", () => {
    for (const [name, outline, cutouts] of SYNTHETIC) {
      const gerber = buildGerberLayer(
        outlineProjection(outline, cutouts),
        "edge_cuts",
        [],
      );
      const curved = [outline, ...cutouts.map((c) => c.shape)].some((shape) => {
        const ring = exactContour(shape);
        return "prims" in ring && ring.prims.some((p) => p.kind === "arc");
      });
      const lines = gerber.split("\r\n");
      expect(`${name}: G75=${lines.includes("G75*")}`).toBe(
        `${name}: G75=${curved}`,
      );
      expect(
        `${name}: arcs=${lines.includes("G02*") || lines.includes("G03*")}`,
      ).toBe(`${name}: arcs=${curved}`);
    }
  });

  test("a contour that reduces to one primitive still ships a loop", () => {
    // A single full-circle arc: start === end, so the exact ring holds ONE
    // primitive and has no second vertex to interpolate to. The board is
    // already BOARD_OUTLINE_INVALID (`full-circle-arc`), but the Profile must
    // never come out empty — it falls back to the chord flattening and says so.
    const outline: PcbBoardOutline = {
      kind: "contour",
      widthMm: 20,
      heightMm: 20,
      centerMm: { x: 0, y: 0 },
      start: { x: 10, y: 0 },
      segments: [
        {
          type: "arc",
          to: { x: 10, y: 0 },
          centerMm: { x: 0, y: 0 },
          cw: false,
        },
      ],
    };
    const warnings: string[] = [];
    const gerber = buildGerberLayer(
      outlineProjection(outline),
      "edge_cuts",
      warnings,
    );
    const loops = parseGerber(gerber, { strict: true }).strokes;
    expect(loops.length).toBe(1);
    // The chord loop the pre-arc writer emitted, closed and arc-free.
    const points = loops[0]!.points;
    expect(points.length).toBeGreaterThan(60);
    expect(points.every((p) => p.arc === undefined)).toBe(true);
    expect(
      dist(
        { x: points[0]!.xMm, y: points[0]!.yMm },
        {
          x: points[points.length - 1]!.xMm,
          y: points[points.length - 1]!.yMm,
        },
      ),
    ).toBeLessThanOrEqual(POINT_TOL_MM);
    // No arc is emitted, so no mode line claims one.
    expect(gerber).not.toContain("G75*");
    expect(gerber).not.toContain("G02*");
    expect(gerber).not.toContain("G03*");
    expect(warnings.filter((w) => /degenerate/i.test(w))).toEqual([
      "Board outline (contour) is degenerate — it encloses no closed contour; " +
        "Edge.Cuts exported as its chord approximation",
    ]);
  });

  test("an arc move outside G75 is a parse error, never a skipped line", () => {
    const gerber = buildGerberLayer(
      outlineProjection({
        kind: "circle",
        widthMm: 20,
        heightMm: 20,
        centerMm: { x: 0, y: 0 },
      }),
      "edge_cuts",
      [],
    );
    expect(() =>
      parseGerber(gerber.replace("G75*\r\n", ""), { strict: true }),
    ).toThrow(/outside G75/);
    expect(() =>
      parseGerber(gerber.replace(/I-?\d+J-?\d+/g, ""), { strict: true }),
    ).toThrow(/without I\/J/);
  });
});
