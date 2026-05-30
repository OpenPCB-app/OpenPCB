import type {
  DrcAnchor,
  DrcRuleCode,
  PcbPointMm,
} from "../../../../../sdks/designer";
import { FAB_PRESETS } from "../../pcb/fab-presets";
import {
  circleToPolygonDistance,
  polygonToPolygonDistance,
  polylineToPolygonDistance,
} from "../../pcb/pcb-clearance-geometry";
import {
  distance,
  pointToPolylineDistance,
  polylineToPolylineClosestPoints,
} from "../../pcb/pcb-trace-geometry";
import {
  aabbGap,
  layersOverlap,
  type DrcContext,
  type DrcTrace,
} from "../drc-context";
import type { DrcViolationDraft } from "../types";

/** Overlap tolerance for short detection (0.1 µm). */
const SHORT_EPS_MM = 1e-4;

function sameNet(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a === b;
}

function differentKnownNet(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a !== b;
}

function midpoint(a: PcbPointMm, b: PcbPointMm): PcbPointMm {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Copper clearance + short detection for trace↔trace / trace↔pad / trace↔via on
 * shared copper layers (different nets). One geometric pass yields three
 * outcomes per pair:
 *   gap ≤ 0 (different known nets) → NET_SHORT_CIRCUIT (error)
 *   gap < required                → <pair>_CLEARANCE     (error)
 *   required ≤ gap < fabMin        → FAB_CLEARANCE        (warning)
 * `required = max(designRule, netClassA, netClassB)`; net class can only tighten.
 */
export function checkClearance(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  const clr = ctx.designRules.clearance;
  const fabMin =
    ctx.fabricator === "custom"
      ? 0
      : (FAB_PRESETS[ctx.fabricator]?.minClearanceMm ?? 0);

  const emit = (params: {
    netA: string | null;
    netB: string | null;
    gap: number;
    required: number;
    clearanceCode: DrcRuleCode;
    anchors: DrcAnchor[];
    location: PcbPointMm;
    layer: DrcTrace["layer"];
    label: string;
  }): void => {
    const { gap, required, netA, netB } = params;
    // A short (different-net copper overlap) is flagged independent of the
    // configured clearance: a 0 mm rule (custom fab / no net class) must NOT
    // hide a dead short. Only when it is NOT a short do we fall through to the
    // clearance / fabricator comparisons.
    if (differentKnownNet(netA, netB) && gap <= SHORT_EPS_MM) {
      out.push({
        code: "NET_SHORT_CIRCUIT",
        ruleClass: "connectivity",
        severity: "error",
        message: `Short circuit: ${params.label} on different nets overlap`,
        anchors: [
          ...params.anchors,
          { kind: "net", netId: netA! },
          { kind: "net", netId: netB! },
        ],
        locationMm: params.location,
        layer: params.layer,
        measuredMm: Math.max(0, gap),
        requiredMm: required,
      });
    } else if (gap < required) {
      out.push({
        code: params.clearanceCode,
        ruleClass: "clearance",
        severity: "error",
        message: `Clearance ${gap.toFixed(3)} mm between ${params.label} is below the required ${required.toFixed(3)} mm`,
        anchors: params.anchors,
        locationMm: params.location,
        layer: params.layer,
        measuredMm: gap,
        requiredMm: required,
      });
    } else if (fabMin > 0 && gap < fabMin) {
      out.push({
        code: "FAB_CLEARANCE",
        ruleClass: "manufacturability",
        severity: "warning",
        message: `Clearance ${gap.toFixed(3)} mm between ${params.label} is below the fabricator minimum ${fabMin.toFixed(3)} mm`,
        anchors: params.anchors,
        locationMm: params.location,
        layer: params.layer,
        measuredMm: gap,
        requiredMm: fabMin,
      });
    }
  };

  // --- trace ↔ trace (same layer) ---
  for (let i = 0; i < ctx.traces.length; i += 1) {
    const a = ctx.traces[i]!;
    if (a.pointsMm.length < 2) continue;
    for (let j = i + 1; j < ctx.traces.length; j += 1) {
      const b = ctx.traces[j]!;
      if (b.pointsMm.length < 2) continue;
      if (a.layer !== b.layer) continue;
      if (sameNet(a.netId, b.netId)) continue;
      const required = Math.max(
        clr.traceToTraceMm,
        ctx.netClassClearanceMm(a.netId, a.netClassId),
        ctx.netClassClearanceMm(b.netId, b.netClassId),
      );
      if (aabbGap(a.bounds, b.bounds) > Math.max(required, fabMin)) continue;
      const closest = polylineToPolylineClosestPoints(a.pointsMm, b.pointsMm);
      const gap = closest.distance - (a.halfWidthMm + b.halfWidthMm);
      emit({
        netA: a.netId,
        netB: b.netId,
        gap,
        required,
        clearanceCode: "TRACE_TO_TRACE_CLEARANCE",
        anchors: [
          { kind: "trace", traceId: a.id },
          { kind: "trace", traceId: b.id },
        ],
        // Marker at the true point of closest approach (midpoint of the closest
        // point pair) rather than the midpoint of the two trace bounding boxes.
        location: midpoint(closest.a, closest.b),
        layer: a.layer,
        label: "two traces",
      });
    }
  }

  // --- trace ↔ pad (pad occupies the trace's layer) ---
  for (const t of ctx.traces) {
    if (t.pointsMm.length < 2) continue;
    for (const pad of ctx.pads) {
      if (!pad.layers.includes(t.layer)) continue;
      if (sameNet(t.netId, pad.netId)) continue;
      const required = Math.max(
        clr.traceToPadMm,
        ctx.netClassClearanceMm(t.netId, t.netClassId),
        ctx.netClassClearanceMm(pad.netId),
      );
      if (aabbGap(t.bounds, pad.bounds) > Math.max(required, fabMin)) continue;
      const gap =
        polylineToPolygonDistance(t.pointsMm, pad.ring) - t.halfWidthMm;
      emit({
        netA: t.netId,
        netB: pad.netId,
        gap,
        required,
        clearanceCode: "TRACE_TO_PAD_CLEARANCE",
        anchors: [{ kind: "trace", traceId: t.id }, pad.anchor],
        location: pad.center,
        layer: t.layer,
        label: "trace and pad",
      });
    }
  }

  // --- trace ↔ via (via barrel crosses the trace's layer) ---
  for (const t of ctx.traces) {
    if (t.pointsMm.length < 2) continue;
    for (const vg of ctx.vias) {
      if (!vg.layers.includes(t.layer)) continue;
      if (sameNet(t.netId, vg.netId)) continue;
      const required = Math.max(
        clr.traceToViaMm,
        ctx.netClassClearanceMm(t.netId, t.netClassId),
        ctx.netClassClearanceMm(vg.netId, vg.netClassId),
      );
      if (aabbGap(t.bounds, vg.bounds) > Math.max(required, fabMin)) continue;
      const gap =
        pointToPolylineDistance(vg.center, t.pointsMm).distance -
        (t.halfWidthMm + vg.radiusMm);
      emit({
        netA: t.netId,
        netB: vg.netId,
        gap,
        required,
        clearanceCode: "TRACE_TO_VIA_CLEARANCE",
        anchors: [
          { kind: "trace", traceId: t.id },
          { kind: "via", viaId: vg.via.id },
        ],
        location: vg.center,
        layer: t.layer,
        label: "trace and via",
      });
    }
  }

  // --- via ↔ via (P2) ---
  for (let i = 0; i < ctx.vias.length; i += 1) {
    const a = ctx.vias[i]!;
    for (let j = i + 1; j < ctx.vias.length; j += 1) {
      const b = ctx.vias[j]!;
      if (!layersOverlap(a.layers, b.layers)) continue;
      if (sameNet(a.netId, b.netId)) continue;
      const required = Math.max(
        clr.viaToViaMm,
        ctx.netClassClearanceMm(a.netId, a.netClassId),
        ctx.netClassClearanceMm(b.netId, b.netClassId),
      );
      if (aabbGap(a.bounds, b.bounds) > Math.max(required, fabMin)) continue;
      const gap = distance(a.center, b.center) - (a.radiusMm + b.radiusMm);
      emit({
        netA: a.netId,
        netB: b.netId,
        gap,
        required,
        clearanceCode: "VIA_TO_VIA_CLEARANCE",
        anchors: [
          { kind: "via", viaId: a.via.id },
          { kind: "via", viaId: b.via.id },
        ],
        location: midpoint(a.center, b.center),
        layer: a.layers[0] ?? "F.Cu",
        label: "two vias",
      });
    }
  }

  // --- pad ↔ pad (P2). Skip pads of the SAME footprint — intra-footprint pad
  // spacing is the footprint's responsibility, not board DRC. ---
  for (let i = 0; i < ctx.pads.length; i += 1) {
    const a = ctx.pads[i]!;
    for (let j = i + 1; j < ctx.pads.length; j += 1) {
      const b = ctx.pads[j]!;
      if (
        a.anchor.kind === "pad" &&
        b.anchor.kind === "pad" &&
        a.anchor.placementId === b.anchor.placementId
      ) {
        continue;
      }
      const sharedLayer = a.layers.find((l) => b.layers.includes(l));
      if (!sharedLayer) continue;
      if (sameNet(a.netId, b.netId)) continue;
      const required = Math.max(
        clr.padToPadMm,
        ctx.netClassClearanceMm(a.netId),
        ctx.netClassClearanceMm(b.netId),
      );
      if (aabbGap(a.bounds, b.bounds) > Math.max(required, fabMin)) continue;
      const gap = polygonToPolygonDistance(a.ring, b.ring);
      emit({
        netA: a.netId,
        netB: b.netId,
        gap,
        required,
        clearanceCode: "PAD_TO_PAD_CLEARANCE",
        anchors: [a.anchor, b.anchor],
        location: midpoint(a.center, b.center),
        layer: sharedLayer,
        label: "two pads",
      });
    }
  }

  // --- pad ↔ via (P2). Via barrel crosses a copper layer the pad occupies, on
  // different nets. circleToPolygonDistance is the exact circle-to-polygon gap;
  // the via has no dedicated rule, so the board floor reuses traceToViaMm. ---
  for (const pad of ctx.pads) {
    for (const vg of ctx.vias) {
      const sharedLayer = pad.layers.find((l) => vg.layers.includes(l));
      if (!sharedLayer) continue;
      if (sameNet(pad.netId, vg.netId)) continue;
      const required = Math.max(
        clr.traceToViaMm,
        ctx.netClassClearanceMm(pad.netId),
        ctx.netClassClearanceMm(vg.netId, vg.netClassId),
      );
      if (aabbGap(pad.bounds, vg.bounds) > Math.max(required, fabMin)) continue;
      const gap = circleToPolygonDistance(vg.center, vg.radiusMm, pad.ring);
      emit({
        netA: pad.netId,
        netB: vg.netId,
        gap,
        required,
        clearanceCode: "PAD_TO_VIA_CLEARANCE",
        anchors: [pad.anchor, { kind: "via", viaId: vg.via.id }],
        location: vg.center,
        layer: sharedLayer,
        label: "pad and via",
      });
    }
  }

  return out;
}
