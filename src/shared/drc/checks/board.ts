import {
  discInsideRegion,
  polygonInsideRegion,
  regionBoundaryDistancePoint,
  regionContainsPoint,
  stadiumInsideRegion,
} from "../../pcb-geometry/board-region";
import { GEOM_EPS_MM } from "../../pcb-geometry/tolerance";
import type { PcbPointMm } from "../../../sdks/designer";
import {
  pointToRingEdgeDistance,
  polylineToRingEdgeDistance,
  ringToRingEdgeDistance,
} from "../../pcb-geometry/pcb-clearance-geometry";
import { distance } from "../../pcb-geometry/pcb-trace-geometry";
import { FAB_PRESETS } from "../fab-presets";
import {
  below,
  holeBounds,
  type DrcContext,
  type LegalityContext,
} from "../drc-context";
import type { ItemSet } from "./clearance-judge";
import { clearanceViolated } from "../../pcb-geometry/tolerance";
import type { DrcViolationDraft } from "../types";
import { segmentToSegmentDistance } from "../../pcb-geometry/pcb-trace-geometry";
import type { DrcHole } from "../drc-context";
import type { ScalarItem } from "../rule-resolver";
import { ruleSuffix } from "../rule-message";
import { anchorKey } from "../violation-id";

/** A hole's scope geometry is its DRILL — an NPTH has no copper (§4.2). */
function holeGeometry(hole: DrcHole): ScalarItem["geometry"] {
  return hole.slot
    ? {
        kind: "segment",
        a: hole.slot.a,
        b: hole.slot.b,
        halfWidthMm: hole.slot.widthMm / 2,
      }
    : { kind: "disc", center: hole.center, radiusMm: hole.drillMm / 2 };
}

/** Edge-to-edge gap between two holes, slot-aware when either carries a slot. */
function holeEdgeGap(a: DrcHole, b: DrcHole, centerGap: number): number {
  if (!a.slot && !b.slot) return centerGap - (a.drillMm / 2 + b.drillMm / 2);
  const segA = a.slot ? [a.slot.a, a.slot.b] : [a.center, a.center];
  const segB = b.slot ? [b.slot.a, b.slot.b] : [b.center, b.center];
  const radA = a.slot ? a.slot.widthMm / 2 : a.drillMm / 2;
  const radB = b.slot ? b.slot.widthMm / 2 : b.drillMm / 2;
  return (
    segmentToSegmentDistance(segA[0]!, segA[1]!, segB[0]!, segB[1]!) -
    (radA + radB)
  );
}

/**
 * Board-relative checks: copper-to-board-edge clearance, copper outside the
 * outline, and hole-to-hole spacing. All distances are to the board outline +
 * cutout perimeters (NOT filled containment), so copper inside the board still
 * has a positive edge clearance.
 *
 * `COPPER_TO_BOARD_EDGE.measuredMm` is SIGNED (contract 06 §6): the perimeter
 * distance alone cannot tell "0.2 mm short of the rule" from "0.2 mm past the
 * edge", and the same number meant both. It is negative exactly when the item
 * is not inside the region — the containment verdict `COPPER_OFF_BOARD`
 * already computes, so the two can never disagree. The COMPARISON is unchanged:
 * it still runs on the unsigned perimeter gap.
 *
 * A circular pad is measured as its exact `disc` where it has one; the sampled
 * `ring` circumscribes the circle (a ~0.2 %·r false-fail band), which on the
 * board edge is a hard error nobody can waive (contract 06 §2).
 */
export function boardItems(
  ctx: LegalityContext,
  items: ItemSet & { holes: readonly DrcHole[] },
  opts: { out: DrcViolationDraft[] },
): void {
  const out = opts.out;
  const region = ctx.boardRegion;
  // Edge clearance measures against the BIASED region rings too: on an arc the
  // unbiased chords sit up to 0.01 mm on the wrong side, and a hole's inscribed
  // chords over-measured copper-to-cutout clearance (B4-6 — Astra §9.2 showed a
  // true 0.4949999 mm gap passing a 0.5 mm rule on the unbiased rings).
  const rings = [region.outer, ...region.holes];

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

  /**
   * §6: the perimeter distance, negated when the copper is not on the board.
   * A ring that CROSSES the edge has a perimeter distance of 0, which would
   * serialise as `0`, not `-0`; its magnitude is then how far the ring reaches
   * past the boundary (R1 #7), never less than the geometry epsilon.
   */
  const signed = (gap: number, inside: boolean, penetration = 0): number =>
    inside ? gap : -Math.max(Math.abs(gap), penetration, GEOM_EPS_MM);
  const ringPenetration = (ring: readonly PcbPointMm[]): number => {
    let worst = 0;
    for (const p of ring) {
      if (regionContainsPoint(region, p)) continue;
      const d = regionBoundaryDistancePoint(region, p);
      if (d > worst) worst = d;
    }
    return worst;
  };

  for (const t of items.traces) {
    if (t.pointsMm.length === 0) continue;
    // A single-point trace is a disc of copper, not a free pass: measure and
    // contain it as one (Astra §9.2 #4 — it used to skip both checks).
    const single = t.pointsMm.length === 1 ? t.pointsMm[0]! : null;
    const gap =
      edgeDistToBoundary((ring) =>
        single
          ? pointToRingEdgeDistance(single, ring)
          : polylineToRingEdgeDistance(t.pointsMm, ring),
      ) - t.halfWidthMm;
    const inside = stadiumInsideRegion(region, t.pointsMm, t.halfWidthMm);
    const traceEdge = ctx.resolver.scalar("edgeClearance", {
      netId: t.netId,
      layers: [t.layer],
      geometry: {
        kind: "polyline",
        pointsMm: t.pointsMm,
        halfWidthMm: t.halfWidthMm,
      },
    });
    if (clearanceViolated(gap, traceEdge.mm)) {
      out.push({
        code: "COPPER_TO_BOARD_EDGE",
        ...(traceEdge.rule?.severity
          ? { ruleSeverity: traceEdge.rule.severity }
          : {}),
        message: `Trace is ${gap.toFixed(3)} mm from the board edge (min ${traceEdge.mm.toFixed(3)} mm)${ruleSuffix(traceEdge)}`,
        anchors: [{ kind: "trace", traceId: t.id }],
        locationMm: t.mid,
        layer: t.layer,
        measuredMm: signed(gap, inside),
        requiredMm: traceEdge.mm,
      });
    }
    if (!inside) {
      out.push({
        code: "COPPER_OFF_BOARD",
        message: "Trace extends outside the board outline",
        anchors: [{ kind: "trace", traceId: t.id }],
        locationMm: t.mid,
        layer: t.layer,
      });
    }
  }

  for (const vg of items.vias) {
    const gap =
      edgeDistToBoundary((ring) => pointToRingEdgeDistance(vg.center, ring)) -
      vg.radiusMm;
    // Off-board if the via disc (center + radius) is not fully inside the
    // biased region — replaces the old center-only test plus `gap < 0`.
    const inside = discInsideRegion(region, vg.center, vg.radiusMm);
    const viaEdge = ctx.resolver.scalar("edgeClearance", {
      netId: vg.netId,
      layers: vg.layers,
      geometry: { kind: "disc", center: vg.center, radiusMm: vg.radiusMm },
    });
    if (clearanceViolated(gap, viaEdge.mm)) {
      out.push({
        code: "COPPER_TO_BOARD_EDGE",
        ...(viaEdge.rule?.severity ? { ruleSeverity: viaEdge.rule.severity } : {}),
        message: `Via is ${gap.toFixed(3)} mm from the board edge (min ${viaEdge.mm.toFixed(3)} mm)${ruleSuffix(viaEdge)}`,
        anchors: [{ kind: "via", viaId: vg.via.id }],
        locationMm: vg.center,
        measuredMm: signed(gap, inside),
        requiredMm: viaEdge.mm,
      });
    }
    if (!inside) {
      out.push({
        code: "COPPER_OFF_BOARD",
        message: "Via is outside the board outline",
        anchors: [{ kind: "via", viaId: vg.via.id }],
        locationMm: vg.center,
      });
    }
  }

  for (const pad of items.pads) {
    // The exact disc when the pad is a true circle; the circumscribed ring
    // otherwise (contract 06 §2).
    const disc = pad.disc;
    const gap = disc
      ? edgeDistToBoundary((ring) =>
          pointToRingEdgeDistance(disc.center, ring),
        ) - disc.radiusMm
      : edgeDistToBoundary((ring) => ringToRingEdgeDistance(pad.ring, ring));
    const inside = disc
      ? discInsideRegion(region, disc.center, disc.radiusMm)
      : polygonInsideRegion(region, pad.ring);
    const padEdge = ctx.resolver.scalar("edgeClearance", {
      netId: pad.netId,
      layers: pad.layers,
      geometry: { kind: "ring", ring: pad.ring },
    });
    if (clearanceViolated(gap, padEdge.mm)) {
      out.push({
        code: "COPPER_TO_BOARD_EDGE",
        ...(padEdge.rule?.severity ? { ruleSeverity: padEdge.rule.severity } : {}),
        message: `Pad is ${gap.toFixed(3)} mm from the board edge (min ${padEdge.mm.toFixed(3)} mm)${ruleSuffix(padEdge)}`,
        anchors: [pad.anchor],
        locationMm: pad.center,
        measuredMm: signed(gap, inside, disc ? 0 : ringPenetration(pad.ring)),
        requiredMm: padEdge.mm,
      });
    }
    // Off-board unless the whole pad is inside the biased region — replaces the
    // vertex-only outline test and the separate cutout-covers-pad vertex test
    // (both folded into polygonInsideRegion's hole-interior check).
    if (!inside) {
      out.push({
        code: "COPPER_OFF_BOARD",
        message: "Pad is outside the board outline",
        anchors: [pad.anchor],
        locationMm: pad.center,
      });
    }
  }

  // Hole-to-board-edge (audit B4-4): a drilled hole whose edge encroaches on
  // (or crosses) the board outline is a fab reject. Slot-aware — the slot
  // centerline is used when present so the rounded ends are measured, not a
  // round-hole model. Rings = outline + cutouts (a hole must clear cutouts too).
  const holeEdgeReq = ctx.holeToBoardEdgeMm;
  for (const hole of items.holes) {
    const radius = hole.slot ? hole.slot.widthMm / 2 : hole.drillMm / 2;
    const edgeDist = edgeDistToBoundary((ring) =>
      hole.slot
        ? polylineToRingEdgeDistance([hole.slot.a, hole.slot.b], ring)
        : pointToRingEdgeDistance(hole.center, ring),
    );
    const gap = edgeDist - radius;
    // Error when the drill (disc, or slot stadium) is not inside the biased
    // region; warning when inside and merely below the clearance rule.
    const inside = hole.slot
      ? stadiumInsideRegion(region, [hole.slot.a, hole.slot.b], hole.slot.widthMm / 2)
      : discInsideRegion(region, hole.center, hole.drillMm / 2);
    if (!inside) {
      out.push({
        // A drill that is not inside the board region at all is its own code
        // (contract §7) — the former dual-severity HOLE_TO_BOARD_EDGE hid an
        // error and a near-miss warning behind one id.
        code: "HOLE_OFF_BOARD",
        message: `Hole breaches the board edge (${gap.toFixed(3)} mm)`,
        anchors: [hole.anchor],
        locationMm: hole.center,
        measuredMm: gap,
        requiredMm: holeEdgeReq,
      });
    } else if (below(gap, holeEdgeReq)) {
      out.push({
        code: "HOLE_TO_BOARD_EDGE",
        message: `Hole is ${gap.toFixed(3)} mm from the board edge (min ${holeEdgeReq.toFixed(3)} mm)`,
        anchors: [hole.anchor],
        locationMm: hole.center,
        measuredMm: gap,
        requiredMm: holeEdgeReq,
      });
    }
  }
}

/**
 * Hole ↔ hole spacing (mechanical; skip holes of the same footprint) plus the
 * fab tier, for one subject set against one other set (07 §3). Coincident
 * drills (centers within ~1 µm) on the SAME net are a via dropped onto a
 * through-hole pad — a legitimate stack, not a spacing breach. `replaces`
 * filters the OTHER (board) side only.
 */
export function holePairs(
  ctx: LegalityContext,
  subjects: readonly DrcHole[],
  others: readonly DrcHole[],
  opts: { replaces?: ReadonlySet<string>; out: DrcViolationDraft[] },
): void {
  const out = opts.out;
  // A drilled hole passes through the whole stackup, so every valid copper
  // layer is "a layer the item occupies" for a `layer` scope (§4.2).
  const allLayers = [...ctx.validCopperLayers];
  const COINCIDENT_EPS_MM = 1e-3;
  const fabPreset =
    ctx.fabricator === "custom" ? null : (FAB_PRESETS[ctx.fabricator] ?? null);
  // Hoisted: the key of an item is a per-item fact, not a per-pair one, and the
  // board's are precomputed on the context (R1 #2).
  const subjectKeys =
    subjects === ctx.holes ? ctx.holeKeys : subjects.map((h) => anchorKey(h.anchor));
  const otherKeys =
    others === subjects
      ? subjectKeys
      : others === ctx.holes
        ? ctx.holeKeys
        : others.map((h) => anchorKey(h.anchor));
  const self = subjects === others;
  // The grid pays off only for a small subject set against the board's holes;
  // the batch pass (board × board) keeps its full O(n²) loop, which S9 owns.
  const gridded = others === ctx.holes && !self && subjects !== ctx.holes;

  const judgePair = (i: number, j: number): void => {
    if (
      opts.replaces &&
      others[j]!.anchor.kind === "via" &&
      opts.replaces.has((others[j]!.anchor as { viaId: string }).viaId)
    ) {
      return;
    }
    // Canonical orientation (contract 06 §7): the hole with the smaller
    // anchor key leads, so the emitted anchor order — and with it the report
    // bytes — cannot follow `ctx.holes` order (R1 #1).
    const keyI = subjectKeys[i]!;
    const keyJ = otherKeys[j]!;
    const a = keyI < keyJ ? subjects[i]! : others[j]!;
    const b = keyI < keyJ ? others[j]! : subjects[i]!;
    const centerGap = distance(a.center, b.center);
    // Two drills under ONE pad number (a multi-shape pin) are one item only
    // when they are the same physical drill (coincident); two DISTINCT drill
    // hits of one pin still ship in the Excellon file and must still be
    // judged for overlap (R1 #2, Astra S7 #3).
    if (keyI === keyJ && centerGap <= COINCIDENT_EPS_MM) return;
    const drillsOverlap = centerGap < a.drillMm / 2 + b.drillMm / 2;
    // Intra-footprint pad SPACING is the footprint's responsibility — but
    // only when the drills don't physically overlap. Overlapping drills in
    // one footprint are still a broken drill file (audit B4-3).
    if (
      a.anchor.kind === "pad" &&
      b.anchor.kind === "pad" &&
      a.anchor.placementId === b.anchor.placementId &&
      !drillsOverlap
    ) {
      return;
    }
    if (
      centerGap <= COINCIDENT_EPS_MM &&
      a.netId !== null &&
      a.netId === b.netId
    ) {
      return;
    }
    // Slot-aware edge gap: a slotted drill uses its centerline (segment)
    // instead of the round center, so overlapping slot ends between distant
    // centers are still caught (Codex review; audit B2-5 follow-through).
    const gap = holeEdgeGap(a, b, centerGap);
    // `net` / `netClass` match if EITHER hole qualifies, `area` needs BOTH
    // (contract §5.1); the scope geometry is the drill, not the copper.
    const holeReq = ctx.resolver.scalarPair(
      "holeToHole",
      { netId: a.netId, layers: allLayers, geometry: holeGeometry(a) },
      { netId: b.netId, layers: allLayers, geometry: holeGeometry(b) },
    );
    if (below(gap, holeReq.mm)) {
      out.push({
        code: "HOLE_TO_HOLE",
        ...(holeReq.rule?.severity
          ? { ruleSeverity: holeReq.rule.severity }
          : {}),
        message: `Holes are ${gap.toFixed(3)} mm apart (min ${holeReq.mm.toFixed(3)} mm)${ruleSuffix(holeReq)}`,
        anchors: [a.anchor, b.anchor],
        locationMm: {
          x: (a.center.x + b.center.x) / 2,
          y: (a.center.y + b.center.y) / 2,
        },
        measuredMm: gap,
        requiredMm: holeReq.mm,
      });
    } else if (fabPreset) {
      // Fab capability tier (P8): JLCPCB publishes distinct hole-to-hole
      // floors for via-via vs anything involving a component (PTH/NPTH)
      // drill. Only surfaces when the board rule above did not already fire.
      const fabReq =
        a.kind === "via" && b.kind === "via"
          ? fabPreset.holeToHoleViaMm
          : fabPreset.holeToHolePthMm;
      if (below(gap, fabReq)) {
        out.push({
          code: "FAB_HOLE_TO_HOLE",
          message: `Holes are ${gap.toFixed(3)} mm apart (${fabPreset.name} min ${fabReq.toFixed(3)} mm)`,
          anchors: [a.anchor, b.anchor],
          locationMm: {
            x: (a.center.x + b.center.x) / 2,
            y: (a.center.y + b.center.y) / 2,
          },
          measuredMm: gap,
          requiredMm: fabReq,
        });
      }
    }
  };

  for (let i = 0; i < subjects.length; i += 1) {
    if (gridded) {
      for (const j of ctx.near(
        "holes",
        holeBounds(subjects[i]!),
        ctx.maxHoleBoundMm,
      )) {
        judgePair(i, j);
      }
      continue;
    }
    for (let j = self ? i + 1 : 0; j < others.length; j += 1) judgePair(i, j);
  }
}

/**
 * Board-relative checks over the whole board: the per-item edge / off-board
 * tiers, then hole ↔ hole spacing.
 */
export function checkBoard(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  boardItems(ctx, ctx, { out });
  holePairs(ctx, ctx.holes, ctx.holes, { out });
  return out;
}
