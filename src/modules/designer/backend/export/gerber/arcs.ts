/**
 * The Edge.Cuts Profile as TRUE arcs (exact-geometry contract 12 §6).
 *
 * One closed Gerber loop per exact ring: a run of segments interpolates
 * linearly (`G01`), an arc interpolates circularly (`G02` clockwise / `G03`
 * counter-clockwise) with `I`/`J` giving the centre offset from the piece's
 * START point. The writer emits `y` unflipped, so a ring that turns clockwise
 * in board millimetres turns clockwise in the plotted image too and the
 * direction maps straight through.
 *
 * Three rules keep the emitted arc consistent with the curve it came from:
 *
 *  - **No centre repair.** A 1 nm endpoint mismatch on a near-full arc moves a
 *    bisector-repaired centre by metres; the canonical contour (12 §2.1) has
 *    already made the two radii agree, so the authored centre is emitted as-is.
 *  - **Quantise once, subtract in integers.** The centre is quantised once per
 *    arc and every endpoint once — a vertex shared by two pieces, or by an arc
 *    and its neighbouring primitive, is the SAME integer on both sides — so
 *    consecutive pieces reconstruct ONE centre and the ring stays closed.
 *  - **Pieces of at most 90°, validated AFTER quantisation.** Splitting at the
 *    quadrant boundaries of the arc's own circle keeps every piece far from a
 *    full turn; a piece whose quantised endpoints coincide would read to a CAM
 *    as a full circle, so it is dropped (merged into its neighbour), and a
 *    piece whose chord survives at under 2 nm is emitted as a line.
 */
import type { PcbPointMm } from "../../../../../sdks/designer/types";
import {
  arcPointAt,
  type ExactArc,
  type ExactRing,
} from "../../../../../shared/pcb-geometry/exact-arcs";
import { ringPrims } from "../../../../../shared/pcb-geometry/exact-ring";
import { gerberNm, ijOperandNm, xyOperand, xyOperandNm } from "../units";

/** Interpolation modes are modal across the whole file, hence the state box. */
export type InterpolationMode = "G01" | "G02" | "G03";

export interface InterpolationState {
  mode: InterpolationMode;
}

/** A point on the emitted 1 nm grid. Integers, so `I`/`J` are exact. */
interface NmPoint {
  x: number;
  y: number;
}

const QUADRANT_RAD = Math.PI / 2;

/** Chord (nm) below which a quantised arc piece is emitted as a line (§6). */
const MIN_ARC_CHORD_NM = 2;

/** Does this ring carry an arc — i.e. does the file need `G75` at all? */
export function ringHasArc(ring: ExactRing): boolean {
  return "prims" in ring && ring.prims.some((prim) => prim.kind === "arc");
}

/**
 * Can this ring be plotted as a loop at all? A contour that reduces to ONE
 * primitive — a full-circle arc whose start and end coincide, which the outline
 * validator refuses as `full-circle-arc` — has no second vertex to draw to, and
 * the caller must fall back rather than emit nothing.
 */
export function ringIsEmittable(ring: ExactRing): boolean {
  return ringPrims(ring).length >= 2;
}

function quantise(p: PcbPointMm): NmPoint {
  return { x: gerberNm(p.x), y: gerberNm(p.y) };
}

function samePoint(a: NmPoint, b: NmPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

function setMode(
  out: string[],
  state: InterpolationState,
  mode: InterpolationMode,
): void {
  if (state.mode === mode) return;
  out.push(`${mode}*`);
  state.mode = mode;
}

function emitLineTo(
  out: string[],
  state: InterpolationState,
  to: NmPoint,
): void {
  setMode(out, state, "G01");
  out.push(`${xyOperandNm(to.x, to.y)}D01*`);
}

/**
 * The multiples of π/2 STRICTLY inside the arc's swept range, in sweep order.
 *
 * The arc's own parametrisation decides this — not the endpoints' positions —
 * so a piece is bounded by construction rather than by a chord test. An arc
 * that starts exactly on a boundary gets no zero-length piece there; one that
 * starts a hair before it gets a piece the quantisation stage then throws away.
 */
function quadrantSplits(arc: ExactArc): number[] {
  const span = Math.abs(arc.sweep);
  const dir = arc.sweep >= 0 ? 1 : -1;
  const out: number[] = [];
  let k =
    dir > 0
      ? Math.floor(arc.a0 / QUADRANT_RAD) + 1
      : Math.ceil(arc.a0 / QUADRANT_RAD) - 1;
  for (;;) {
    const angle = k * QUADRANT_RAD;
    const offset = dir > 0 ? angle - arc.a0 : arc.a0 - angle;
    if (!(offset < span)) break;
    if (offset > 0) out.push(angle);
    k += dir;
  }
  return out;
}

function emitArc(
  out: string[],
  state: InterpolationState,
  arc: ExactArc,
  from: NmPoint,
  to: NmPoint,
): void {
  const center = quantise(arc.c);
  // OpenPCB's `cw` survives as the sweep sign (`exactArcFromPoints`), and the
  // image is not mirrored, so clockwise is G02.
  const mode: InterpolationMode = arc.sweep < 0 ? "G02" : "G03";
  // The first and last piece endpoints are the RING's vertices, never
  // re-derived from the circle: the neighbouring primitive quantised the same
  // numbers, and the loop has to close on the bit.
  const points: NmPoint[] = [from];
  for (const angle of quadrantSplits(arc)) {
    points.push(quantise(arcPointAt(arc, angle)));
  }
  points.push(to);
  let cursor = from;
  for (let i = 1; i < points.length; i += 1) {
    const end = points[i]!;
    // A piece that quantised to nothing is merged into its neighbour: the
    // cursor has not moved, so the next piece starts where this one did.
    if (samePoint(cursor, end)) continue;
    const dx = end.x - cursor.x;
    const dy = end.y - cursor.y;
    if (dx * dx + dy * dy < MIN_ARC_CHORD_NM * MIN_ARC_CHORD_NM) {
      emitLineTo(out, state, end);
    } else {
      setMode(out, state, mode);
      out.push(
        `${xyOperandNm(end.x, end.y)}` +
          `${ijOperandNm(center.x - cursor.x, center.y - cursor.y)}D01*`,
      );
    }
    cursor = end;
  }
}

/**
 * The pre-arc CHORD loop, kept as the fallback for a ring the exact model
 * cannot close ({@link ringIsEmittable}). Such a board is already
 * `BOARD_OUTLINE_INVALID`, but an export must never silently drop an Edge.Cuts
 * loop — the fab would receive a board with no profile at all — so the
 * degenerate shape still ships its default flattening, plus a warning.
 *
 * Returns false when even the chord ring has no loop in it.
 */
export function emitChordLoop(
  out: string[],
  state: InterpolationState,
  pts: readonly PcbPointMm[],
): boolean {
  if (pts.length < 2) return false;
  setMode(out, state, "G01");
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i]!;
    out.push(`${xyOperand(p.x, p.y)}${i === 0 ? "D02*" : "D01*"}`);
  }
  // Close the loop back to the first point unless the flattening already did —
  // the writer's own closure rule, at the Gerber coordinate resolution.
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  if (
    Math.abs(first.x - last.x) >= 1e-6 ||
    Math.abs(first.y - last.y) >= 1e-6
  ) {
    out.push(`${xyOperand(first.x, first.y)}D01*`);
  }
  return true;
}

/**
 * One closed Profile loop. The ring is already closed (its last primitive ends
 * at the first's start), so the closing draw is the last primitive's own move
 * and there is never a separate closing command to add.
 *
 * Returns false for a ring with no loop in it, which the caller owes a fallback.
 */
export function emitExactRing(
  out: string[],
  ring: ExactRing,
  state: InterpolationState,
): boolean {
  const prims = ringPrims(ring);
  if (prims.length < 2) return false;
  const verts = prims.map((prim) => quantise(prim.a));
  const start = verts[0]!;
  out.push(`${xyOperandNm(start.x, start.y)}D02*`);
  for (let i = 0; i < prims.length; i += 1) {
    const prim = prims[i]!;
    const from = verts[i]!;
    const to = verts[(i + 1) % prims.length]!;
    if (prim.kind === "seg") {
      // A segment that quantised to zero length draws nothing; emitting it
      // would leave a zero-length stroke the loop does not need.
      if (!samePoint(from, to)) emitLineTo(out, state, to);
      continue;
    }
    emitArc(out, state, prim, from, to);
  }
  return true;
}
