import { pointInOutline } from "../../pcb/outline-geometry";
import {
  pointInPolygon,
  pointToRingEdgeDistance,
  polylineToRingEdgeDistance,
  ringToRingEdgeDistance,
} from "../../pcb/pcb-clearance-geometry";
import { distance } from "../../pcb/pcb-trace-geometry";
import { below, type DrcContext } from "../drc-context";
import type { DrcViolationDraft } from "../types";

/**
 * Vertices plus each segment's midpoint — a denser sample so a trace that
 * crosses a cutout (or the outline) between two on-board vertices is still
 * caught by the point-in-outline test.
 */
function sampledTracePoints(
  points: readonly { x: number; y: number }[],
): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < points.length; i += 1) {
    const p = points[i]!;
    out.push(p);
    if (i > 0) {
      const prev = points[i - 1]!;
      out.push({ x: (prev.x + p.x) / 2, y: (prev.y + p.y) / 2 });
    }
  }
  return out;
}

/**
 * Board-relative checks: copper-to-board-edge clearance, copper outside the
 * outline, and hole-to-hole spacing. All distances are to the board outline +
 * cutout perimeters (NOT filled containment), so copper inside the board still
 * has a positive edge clearance.
 */
export function checkBoard(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  const board = ctx.projection.board;
  const cutouts = board.cutouts ?? [];
  const edgeReq = ctx.designRules.clearance.copperToBoardEdgeMm;
  const rings = [ctx.outlineRing, ...ctx.cutoutRings];

  const edgeDistToBoundary = (
    compute: (ring: readonly { x: number; y: number }[]) => number,
  ): number => {
    let best = Infinity;
    for (const ring of rings) {
      const d = compute(ring);
      if (d < best) best = d;
    }
    return best;
  };

  for (const t of ctx.traces) {
    if (t.pointsMm.length < 2) continue;
    const gap =
      edgeDistToBoundary((ring) =>
        polylineToRingEdgeDistance(t.pointsMm, ring),
      ) - t.halfWidthMm;
    if (below(gap, edgeReq)) {
      out.push({
        code: "COPPER_TO_BOARD_EDGE",
        ruleClass: "clearance",
        severity: "warning",
        message: `Trace is ${gap.toFixed(3)} mm from the board edge (min ${edgeReq.toFixed(3)} mm)`,
        anchors: [{ kind: "trace", traceId: t.id }],
        locationMm: t.mid,
        layer: t.layer,
        measuredMm: gap,
        requiredMm: edgeReq,
      });
    }
    if (
      sampledTracePoints(t.pointsMm).some(
        (p) => !pointInOutline(board.outline, cutouts, p),
      )
    ) {
      out.push({
        code: "COPPER_OFF_BOARD",
        ruleClass: "constraint",
        severity: "error",
        message: "Trace extends outside the board outline",
        anchors: [{ kind: "trace", traceId: t.id }],
        locationMm: t.mid,
        layer: t.layer,
      });
    }
  }

  for (const vg of ctx.vias) {
    const gap =
      edgeDistToBoundary((ring) => pointToRingEdgeDistance(vg.center, ring)) -
      vg.radiusMm;
    if (below(gap, edgeReq)) {
      out.push({
        code: "COPPER_TO_BOARD_EDGE",
        ruleClass: "clearance",
        severity: "warning",
        message: `Via is ${gap.toFixed(3)} mm from the board edge (min ${edgeReq.toFixed(3)} mm)`,
        anchors: [{ kind: "via", viaId: vg.via.id }],
        locationMm: vg.center,
        measuredMm: gap,
        requiredMm: edgeReq,
      });
    }
    // Off-board if the center is outside, or the via circle pokes through the
    // outline / a cutout edge (gap = edge distance − radius < 0).
    if (!pointInOutline(board.outline, cutouts, vg.center) || gap < 0) {
      out.push({
        code: "COPPER_OFF_BOARD",
        ruleClass: "constraint",
        severity: "error",
        message: "Via is outside the board outline",
        anchors: [{ kind: "via", viaId: vg.via.id }],
        locationMm: vg.center,
      });
    }
  }

  for (const pad of ctx.pads) {
    const gap = edgeDistToBoundary((ring) =>
      ringToRingEdgeDistance(pad.ring, ring),
    );
    if (below(gap, edgeReq)) {
      out.push({
        code: "COPPER_TO_BOARD_EDGE",
        ruleClass: "clearance",
        severity: "warning",
        message: `Pad is ${gap.toFixed(3)} mm from the board edge (min ${edgeReq.toFixed(3)} mm)`,
        anchors: [pad.anchor],
        locationMm: pad.center,
        measuredMm: gap,
        requiredMm: edgeReq,
      });
    }
    // Off-board if any pad-ring vertex falls outside the outline / inside a
    // cutout, OR the pad fully covers a cutout (a cutout vertex sits inside the
    // pad ring) — the center-only test missed both cases.
    if (
      pad.ring.some((v) => !pointInOutline(board.outline, cutouts, v)) ||
      ctx.cutoutRings.some((ring) =>
        ring.some((cv) => pointInPolygon(cv, pad.ring)),
      )
    ) {
      out.push({
        code: "COPPER_OFF_BOARD",
        ruleClass: "constraint",
        severity: "error",
        message: "Pad is outside the board outline",
        anchors: [pad.anchor],
        locationMm: pad.center,
      });
    }
  }

  // hole-to-hole spacing (mechanical; skip holes of the same footprint).
  // Coincident drills (centers within ~1 µm) on the SAME net are a via dropped
  // onto a through-hole pad — a legitimate stack, not a spacing breach.
  const COINCIDENT_EPS_MM = 1e-3;
  const holes = ctx.holes;
  for (let i = 0; i < holes.length; i += 1) {
    const a = holes[i]!;
    for (let j = i + 1; j < holes.length; j += 1) {
      const b = holes[j]!;
      if (
        a.anchor.kind === "pad" &&
        b.anchor.kind === "pad" &&
        a.anchor.placementId === b.anchor.placementId
      ) {
        continue;
      }
      const centerGap = distance(a.center, b.center);
      if (
        centerGap <= COINCIDENT_EPS_MM &&
        a.netId !== null &&
        a.netId === b.netId
      ) {
        continue;
      }
      const gap = centerGap - (a.drillMm / 2 + b.drillMm / 2);
      if (below(gap, ctx.holeToHoleMm)) {
        out.push({
          code: "HOLE_TO_HOLE",
          ruleClass: "clearance",
          severity: "warning",
          message: `Holes are ${gap.toFixed(3)} mm apart (min ${ctx.holeToHoleMm.toFixed(3)} mm)`,
          anchors: [a.anchor, b.anchor],
          locationMm: {
            x: (a.center.x + b.center.x) / 2,
            y: (a.center.y + b.center.y) / 2,
          },
          measuredMm: gap,
          requiredMm: ctx.holeToHoleMm,
        });
      }
    }
  }

  return out;
}
