import {
  discInsideRegion,
  polygonInsideRegion,
  stadiumInsideRegion,
} from "../../pcb/board-region";
import {
  pointToRingEdgeDistance,
  polylineToRingEdgeDistance,
  ringToRingEdgeDistance,
} from "../../pcb/pcb-clearance-geometry";
import { distance } from "../../pcb/pcb-trace-geometry";
import { FAB_PRESETS } from "../../pcb/fab-presets";
import { below, type DrcContext } from "../drc-context";
import { clearanceViolated } from "../../pcb/tolerance";
import type { DrcViolationDraft } from "../types";
import { segmentToSegmentDistance } from "../../pcb/pcb-trace-geometry";
import type { DrcHole } from "../drc-context";
import type { ScalarItem } from "../../../../../shared/drc/rule-resolver";
import { ruleSuffix } from "../rule-message";

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
 */
export function checkBoard(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  const region = ctx.boardRegion;
  // A drilled hole passes through the whole stackup, so every valid copper
  // layer is "a layer the item occupies" for a `layer` scope (§4.2).
  const allLayers = [...ctx.validCopperLayers];
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

  for (const t of ctx.traces) {
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
        ruleClass: "clearance",
        ...(traceEdge.rule?.severity
          ? { ruleSeverity: traceEdge.rule.severity }
          : {}),
        message: `Trace is ${gap.toFixed(3)} mm from the board edge (min ${traceEdge.mm.toFixed(3)} mm)${ruleSuffix(traceEdge)}`,
        anchors: [{ kind: "trace", traceId: t.id }],
        locationMm: t.mid,
        layer: t.layer,
        measuredMm: gap,
        requiredMm: traceEdge.mm,
      });
    }
    if (!stadiumInsideRegion(region, t.pointsMm, t.halfWidthMm)) {
      out.push({
        code: "COPPER_OFF_BOARD",
        ruleClass: "constraint",
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
    const viaEdge = ctx.resolver.scalar("edgeClearance", {
      netId: vg.netId,
      layers: vg.layers,
      geometry: { kind: "disc", center: vg.center, radiusMm: vg.radiusMm },
    });
    if (clearanceViolated(gap, viaEdge.mm)) {
      out.push({
        code: "COPPER_TO_BOARD_EDGE",
        ruleClass: "clearance",
        ...(viaEdge.rule?.severity ? { ruleSeverity: viaEdge.rule.severity } : {}),
        message: `Via is ${gap.toFixed(3)} mm from the board edge (min ${viaEdge.mm.toFixed(3)} mm)${ruleSuffix(viaEdge)}`,
        anchors: [{ kind: "via", viaId: vg.via.id }],
        locationMm: vg.center,
        measuredMm: gap,
        requiredMm: viaEdge.mm,
      });
    }
    // Off-board if the via disc (center + radius) is not fully inside the
    // biased region — replaces the old center-only test plus `gap < 0`.
    if (!discInsideRegion(region, vg.center, vg.radiusMm)) {
      out.push({
        code: "COPPER_OFF_BOARD",
        ruleClass: "constraint",
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
    const padEdge = ctx.resolver.scalar("edgeClearance", {
      netId: pad.netId,
      layers: pad.layers,
      geometry: { kind: "ring", ring: pad.ring },
    });
    if (clearanceViolated(gap, padEdge.mm)) {
      out.push({
        code: "COPPER_TO_BOARD_EDGE",
        ruleClass: "clearance",
        ...(padEdge.rule?.severity ? { ruleSeverity: padEdge.rule.severity } : {}),
        message: `Pad is ${gap.toFixed(3)} mm from the board edge (min ${padEdge.mm.toFixed(3)} mm)${ruleSuffix(padEdge)}`,
        anchors: [pad.anchor],
        locationMm: pad.center,
        measuredMm: gap,
        requiredMm: padEdge.mm,
      });
    }
    // Off-board unless the whole pad ring is inside the biased region —
    // replaces the vertex-only outline test and the separate cutout-covers-pad
    // vertex test (both folded into polygonInsideRegion's hole-interior check).
    if (!polygonInsideRegion(region, pad.ring)) {
      out.push({
        code: "COPPER_OFF_BOARD",
        ruleClass: "constraint",
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
  const fabPreset =
    ctx.fabricator === "custom" ? null : (FAB_PRESETS[ctx.fabricator] ?? null);
  const holes = ctx.holes;

  // Hole-to-board-edge (audit B4-4): a drilled hole whose edge encroaches on
  // (or crosses) the board outline is a fab reject. Slot-aware — the slot
  // centerline is used when present so the rounded ends are measured, not a
  // round-hole model. Rings = outline + cutouts (a hole must clear cutouts too).
  const holeEdgeReq = ctx.holeToBoardEdgeMm;
  for (const hole of holes) {
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
        ruleClass: "dfm",
        message: `Hole breaches the board edge (${gap.toFixed(3)} mm)`,
        anchors: [hole.anchor],
        locationMm: hole.center,
        measuredMm: gap,
        requiredMm: holeEdgeReq,
      });
    } else if (below(gap, holeEdgeReq)) {
      out.push({
        code: "HOLE_TO_BOARD_EDGE",
        ruleClass: "dfm",
        message: `Hole is ${gap.toFixed(3)} mm from the board edge (min ${holeEdgeReq.toFixed(3)} mm)`,
        anchors: [hole.anchor],
        locationMm: hole.center,
        measuredMm: gap,
        requiredMm: holeEdgeReq,
      });
    }
  }
  for (let i = 0; i < holes.length; i += 1) {
    const a = holes[i]!;
    for (let j = i + 1; j < holes.length; j += 1) {
      const b = holes[j]!;
      const centerGap = distance(a.center, b.center);
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
        continue;
      }
      if (
        centerGap <= COINCIDENT_EPS_MM &&
        a.netId !== null &&
        a.netId === b.netId
      ) {
        continue;
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
          ruleClass: "clearance",
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
            ruleClass: "manufacturability",
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
    }
  }

  return out;
}
