/**
 * Canonical form + validation for free-form board contours. Every producer of a
 * `PcbBoardContour` — the draw tool, fillet/chamfer edits, DXF import, and the
 * HTTP command parser — must run its output through {@link normalizeContour}
 * and have the executor gate it with {@link validateContour}. No producer
 * trusts its own geometry; this module is the single source of truth.
 *
 * Canonical closure = **explicit**: the last segment ends exactly at `start`, so
 * every edge (including the closing one) is a real segment that can be filleted
 * or converted to an arc uniformly. This matches the executor's `>= 3 segments`
 * floor (a triangle = 3 explicit edges) and `contourPoints`' trailing-point drop.
 */
import type {
  PcbBoardContour,
  PcbOutlineSegment,
  PcbPointMm,
} from "../../../sdks";
import {
  computeOutlineBboxMm,
  flattenOutline,
  ringSelfIntersects,
} from "./outline-geometry";
import { exactContour } from "../../pcb-geometry/exact-contour";
import {
  exactEntryOf,
  exactRingProblem,
  type RingFault,
} from "../../pcb-geometry/exact-simplicity";
import {
  type ExactBudget,
  ExactBudgetExceeded,
} from "../../pcb-geometry/region-exact";

/** Points within this distance (mm) are treated as coincident (1 nm-scale). */
export const CONTOUR_POINT_EPSILON_MM = 1e-3;
/** Absolute + relative tolerance for "arc endpoints equidistant from center". */
export const ARC_RADIUS_TOLERANCE_MM = 1e-3;
export const ARC_RADIUS_RELATIVE_TOLERANCE = 1e-3;
/**
 * Primitive comparisons the simplicity arm may spend on ONE contour
 * (exact-geometry contract 12 §3, §10). The draw tool calls this on every
 * pointer release, so the exact sweep must stop and fall back rather than block
 * the editor on a pathological shape.
 */
const CONTOUR_EXACT_BUDGET = 200_000;

export interface ContourValidationError {
  code:
    | "start-not-finite"
    | "point-not-finite"
    | "arc-center-not-finite"
    | "too-few-segments"
    | "zero-length-edge"
    | "degenerate-arc"
    | "full-circle-arc"
    | "arc-radius-mismatch"
    | "not-closed"
    | "self-intersects";
  message: string;
  /** Index into `segments`, when the error is segment-local. */
  segmentIndex?: number;
}

export type ContourValidationResult =
  | { ok: true }
  | { ok: false; errors: ContourValidationError[] };

function isFinitePoint(p: PcbPointMm): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function pointsEqual(a: PcbPointMm, b: PcbPointMm): boolean {
  return Math.hypot(a.x - b.x, a.y - b.y) <= CONTOUR_POINT_EPSILON_MM;
}

function distance(a: PcbPointMm, b: PcbPointMm): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function segmentStart(contour: PcbBoardContour, index: number): PcbPointMm {
  return index === 0 ? contour.start : contour.segments[index - 1]!.to;
}

/**
 * Rewrite a contour into canonical form: drop zero-length line edges, force
 * explicit closure onto `start`, and refresh the cached bbox. Pure. Does not
 * fix an already-invalid contour (self-intersecting, mismatched arc radii) —
 * that is {@link validateContour}'s job.
 */
export function normalizeContour(contour: PcbBoardContour): PcbBoardContour {
  const start: PcbPointMm = { x: contour.start.x, y: contour.start.y };
  const segments: PcbOutlineSegment[] = [];
  let prev = start;
  for (const seg of contour.segments) {
    const to: PcbPointMm = { x: seg.to.x, y: seg.to.y };
    // Drop zero-length *line* edges. A zero-length *arc* encodes a full circle;
    // leave it for the validator to reject rather than silently reshape it.
    if (seg.type === "line" && pointsEqual(prev, to)) continue;
    segments.push(
      seg.type === "arc"
        ? {
            type: "arc",
            to,
            centerMm: { x: seg.centerMm.x, y: seg.centerMm.y },
            cw: seg.cw,
          }
        : { type: "line", to },
    );
    prev = to;
  }

  const last = segments[segments.length - 1];
  if (!last) {
    // Degenerate input; hand it back so the validator reports "too-few-segments".
    return { ...contour, start, segments };
  }
  if (pointsEqual(last.to, start)) {
    last.to = { x: start.x, y: start.y }; // snap near-coincident closure exact
  } else {
    segments.push({ type: "line", to: { x: start.x, y: start.y } });
  }

  const provisional: PcbBoardContour = {
    kind: "contour",
    widthMm: contour.widthMm,
    heightMm: contour.heightMm,
    centerMm: contour.centerMm,
    start,
    segments,
  };
  const bbox = computeOutlineBboxMm(provisional);
  return { ...provisional, ...bbox };
}

/**
 * Validate a contour that is expected to already be in canonical form (run
 * {@link normalizeContour} first). Checks finiteness, segment count, closure,
 * degenerate edges, arc radius consistency, and self-intersection.
 */
export function validateContour(
  contour: PcbBoardContour,
): ContourValidationResult {
  const errors: ContourValidationError[] = [];

  if (!isFinitePoint(contour.start)) {
    errors.push({ code: "start-not-finite", message: "contour start must be finite" });
  }

  const segs = contour.segments;
  if (segs.length < 3) {
    errors.push({
      code: "too-few-segments",
      message: "contour needs >= 3 segments",
    });
  }

  segs.forEach((seg, i) => {
    const from = segmentStart(contour, i);
    if (!isFinitePoint(seg.to)) {
      errors.push({ code: "point-not-finite", message: "contour point must be finite", segmentIndex: i });
      return;
    }
    if (seg.type === "arc") {
      if (!isFinitePoint(seg.centerMm)) {
        errors.push({ code: "arc-center-not-finite", message: "arc center must be finite", segmentIndex: i });
        return;
      }
      const rFrom = distance(from, seg.centerMm);
      const rTo = distance(seg.to, seg.centerMm);
      if (rFrom <= ARC_RADIUS_TOLERANCE_MM) {
        errors.push({ code: "degenerate-arc", message: "arc radius is ~0", segmentIndex: i });
      } else if (
        Math.abs(rFrom - rTo) >
        Math.max(ARC_RADIUS_TOLERANCE_MM, rFrom * ARC_RADIUS_RELATIVE_TOLERANCE)
      ) {
        errors.push({
          code: "arc-radius-mismatch",
          message: `arc endpoints not equidistant from center (${rFrom.toFixed(3)} vs ${rTo.toFixed(3)} mm)`,
          segmentIndex: i,
        });
      }
      if (pointsEqual(from, seg.to)) {
        errors.push({ code: "full-circle-arc", message: "zero-length arc (model a full circle as a circle outline)", segmentIndex: i });
      }
    } else if (pointsEqual(from, seg.to)) {
      errors.push({ code: "zero-length-edge", message: "zero-length edge", segmentIndex: i });
    }
  });

  const last = segs[segs.length - 1];
  if (last && isFinitePoint(last.to) && !pointsEqual(last.to, contour.start)) {
    errors.push({
      code: "not-closed",
      message: "last segment must end at start (explicit closure)",
    });
  }

  // Simplicity LAST, and on the CANONICAL EXACT ring (exact-geometry contract
  // 12 §3.2): the same predicate `BOARD_OUTLINE_INVALID` runs, so the draw tool
  // can never refuse a contour DRC accepts. The chord arm rejected a return
  // edge 0.002 mm inside a fillet (S2 #8) — a true-simple shape.
  //
  // Every authored rule above has already run and none of them may be judged on
  // the canonical ring: projecting first would erase a 1 mm authored radius
  // mismatch (Astra run 1 #8). `exactContour` canonicalises internally, and
  // nothing derived is persisted — `normalizeContour` never projects.
  if (errors.length === 0) {
    const fault = contourSimplicityFault(contour);
    if (fault) {
      errors.push({ code: "self-intersects", message: simplicityMessage(fault) });
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/** Convenience for the executor: first error message, or null when valid. */
export function firstContourError(contour: PcbBoardContour): string | null {
  const result = validateContour(contour);
  return result.ok ? null : result.errors[0]!.message;
}

/** §3 (b)'s wording, one message per fault, all under `self-intersects`. */
function simplicityMessage(fault: RingFault): string {
  if (fault === "retrace") return "outline retraces the same arc";
  if (fault === "degenerate") return "outline has a degenerate edge";
  return "outline self-intersects";
}

/**
 * The exact simplicity verdict, with the chord rule as the documented fallback:
 * an exhausted comparison budget must not let a self-crossing contour through,
 * and `ringSelfIntersects` on the flattened ring is the pre-S12b answer — it
 * over-rejects near an arc, which for an authoring gate is the safe side.
 */
function contourSimplicityFault(contour: PcbBoardContour): RingFault | null {
  const budget: ExactBudget = { comparisons: CONTOUR_EXACT_BUDGET };
  try {
    const problem = exactRingProblem(exactEntryOf(exactContour(contour)), budget);
    return problem ? problem.fault : null;
  } catch (error) {
    if (!(error instanceof ExactBudgetExceeded)) throw error;
    return ringSelfIntersects(flattenOutline(contour)) ? "crossing" : null;
  }
}
