import type { PcbCopperLayerId, PcbNetClass } from "../../../../../sdks/designer";
import { resolveNetClassId } from "../../pcb/net-class-resolver";
import {
  circleToPolygonDistance,
  polygonToPolygonDistance,
  polylineToPolygonDistance,
} from "../../pcb/pcb-clearance-geometry";
import {
  pointToPolylineDistance,
  polylineToPolylineClosestPoints,
} from "../../pcb/pcb-trace-geometry";
import {
  ipc2221SpacingMm,
  requiredTraceWidthMm,
} from "../ipc2221-spacing";
import {
  aabbGap,
  below,
  type DrcContext,
  type DrcPad,
  type DrcTrace,
  type DrcViaGeom,
} from "../drc-context";
import type { DrcAnchor, DrcPairKind } from "../../../../../sdks/designer";
import type { DrcViolationDraft } from "../types";

/** Outer layers use the IPC-2221 external column; inner layers the internal. */
function isInternalLayer(layer: PcbCopperLayerId): boolean {
  return layer !== "F.Cu" && layer !== "B.Cu";
}

/**
 * Electrical DRC (P10): IPC-2221 creepage/clearance by net voltage, and the
 * IPC-2221 current-vs-trace-width check. Both are net-class-driven (voltageV /
 * currentA), resolved LIVE from each net. Creepage runs a small HV subset ×
 * all-copper pass, so it is O(H·n), not a second O(n²).
 */
export function checkElectrical(ctx: DrcContext): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  const board = ctx.projection.board;
  const classById = new Map(board.netClasses.map((c) => [c.id, c]));
  const cache = new Map<string, PcbNetClass | null>();
  const classOf = (netId: string | null): PcbNetClass | null => {
    if (!netId) return null;
    const cached = cache.get(netId);
    if (cached !== undefined) return cached;
    const id = resolveNetClassId(
      ctx.netNames[netId] ?? "",
      board.netClasses,
      board.perNetClassAssignments,
      netId,
    );
    const cls = classById.get(id) ?? null;
    cache.set(netId, cls);
    return cls;
  };
  const voltageOf = (netId: string | null): number =>
    classOf(netId)?.voltageV ?? 0;

  // ── current-vs-width (IPC-2221) ──────────────────────────────────────────
  const elec = board.designRules.electrical;
  const tempRiseC = elec?.tempRiseC ?? 10;
  const copperOz = elec?.copperWeightOz ?? 1;
  for (const t of ctx.traces) {
    const cls = classOf(t.netId);
    if (!cls || cls.currentA === undefined || cls.currentA <= 0) continue;
    const req = requiredTraceWidthMm(
      cls.currentA,
      tempRiseC,
      copperOz,
      isInternalLayer(t.layer),
    );
    if (below(t.widthMm, req)) {
      out.push({
        code: "TRACE_CURRENT_WIDTH",
        ruleClass: "electrical",
        message: `Trace ${t.widthMm.toFixed(3)} mm is below the IPC-2221 minimum ${req.toFixed(3)} mm for ${cls.currentA} A at ${tempRiseC} °C rise (${copperOz} oz)`,
        anchors: [{ kind: "trace", traceId: t.id }],
        locationMm: t.mid,
        layer: t.layer,
        measuredMm: t.widthMm,
        requiredMm: req,
      });
    }
  }

  // ── creepage / HV clearance (IPC-2221 Table 6-1) ─────────────────────────
  // Build one heterogeneous electrical-item list (traces/pads/vias) with each
  // item's net voltage, then walk unordered pairs where AT LEAST ONE item has
  // a non-zero voltage. This seeds creepage from HV pads/vias too (not just
  // traces), handles negative voltages via |va - vb|, and — because it uses
  // i < j — never double-emits an HV↔HV pair.
  interface ElItem {
    kind: "trace" | "pad" | "via";
    idx: number;
    netId: string | null;
    voltage: number;
    layers: readonly PcbCopperLayerId[];
    bounds: { minX: number; minY: number; maxX: number; maxY: number };
  }
  const items: ElItem[] = [];
  ctx.traces.forEach((t, i) => {
    if (t.pointsMm.length >= 2)
      items.push({ kind: "trace", idx: i, netId: t.netId, voltage: voltageOf(t.netId), layers: [t.layer], bounds: t.bounds });
  });
  ctx.pads.forEach((p, i) =>
    items.push({ kind: "pad", idx: i, netId: p.netId, voltage: voltageOf(p.netId), layers: p.layers, bounds: p.bounds }),
  );
  ctx.vias.forEach((v, i) =>
    items.push({ kind: "via", idx: i, netId: v.netId, voltage: voltageOf(v.netId), layers: v.layers, bounds: v.bounds }),
  );
  if (!items.some((it) => it.voltage !== 0)) return out;

  const column = (layer: PcbCopperLayerId): "B1" | "B2" =>
    isInternalLayer(layer) ? "B1" : "B2";
  const pairKindOf = (a: ElItem["kind"], b: ElItem["kind"]): DrcPairKind => {
    const set = new Set([a, b]);
    if (set.has("trace") && set.size === 1) return "traceToTrace";
    if (set.has("trace") && set.has("pad")) return "traceToPad";
    if (set.has("trace") && set.has("via")) return "traceToVia";
    if (set.has("pad") && set.size === 1) return "padToPad";
    if (set.has("pad") && set.has("via")) return "padToVia";
    return "viaToVia";
  };

  for (let i = 0; i < items.length; i += 1) {
    const a = items[i]!;
    for (let j = i + 1; j < items.length; j += 1) {
      const b = items[j]!;
      if (a.voltage === 0 && b.voltage === 0) continue; // ordinary clearance
      if (a.netId !== null && a.netId === b.netId) continue;
      const layer = a.layers.find((l) => b.layers.includes(l));
      if (!layer) continue;
      const required = ipc2221SpacingMm(a.voltage - b.voltage, column(layer));
      // Skip when the ORDINARY clearance for this pair kind already dominates.
      const pk = pairKindOf(a.kind, b.kind);
      const base = ctx.resolver.clearance(
        pk,
        layer,
        { netId: a.netId, pointMm: pointOf(ctx, a) },
        { netId: b.netId, pointMm: pointOf(ctx, b) },
      ).mm;
      if (required <= base) continue;
      if (aabbGap(a.bounds, b.bounds) > required) continue;
      const g = electricalGap(ctx, a, b, layer);
      if (g === null || !below(g.gap, required)) continue;
      out.push({
        code: "CREEPAGE_DISTANCE",
        ruleClass: "electrical",
        message: `IPC-2221 spacing ${g.gap.toFixed(3)} mm is below ${required.toFixed(3)} mm for ${Math.abs(a.voltage - b.voltage).toFixed(0)} V (${column(layer)})`,
        anchors: [anchorOf(ctx, a), anchorOf(ctx, b)],
        locationMm: g.location,
        layer,
        measuredMm: g.gap,
        requiredMm: required,
      });
    }
  }
  return out;
}

interface ElItemLike {
  kind: "trace" | "pad" | "via";
  idx: number;
}
function traceOf(ctx: DrcContext, it: ElItemLike): DrcTrace {
  return ctx.traces[it.idx]!;
}
function padOf(ctx: DrcContext, it: ElItemLike): DrcPad {
  return ctx.pads[it.idx]!;
}
function viaOf(ctx: DrcContext, it: ElItemLike): DrcViaGeom {
  return ctx.vias[it.idx]!;
}
function pointOf(ctx: DrcContext, it: ElItemLike): { x: number; y: number } {
  if (it.kind === "trace") return traceOf(ctx, it).mid;
  if (it.kind === "pad") return padOf(ctx, it).center;
  return viaOf(ctx, it).center;
}
function anchorOf(ctx: DrcContext, it: ElItemLike): DrcAnchor {
  if (it.kind === "trace") return { kind: "trace", traceId: traceOf(ctx, it).id };
  if (it.kind === "pad") return padOf(ctx, it).anchor;
  return { kind: "via", viaId: viaOf(ctx, it).via.id };
}
/** Edge-to-edge gap + marker location for a heterogeneous electrical pair. */
function electricalGap(
  ctx: DrcContext,
  a: ElItemLike,
  b: ElItemLike,
  _layer: PcbCopperLayerId,
): { gap: number; location: { x: number; y: number } } | null {
  const t = (it: ElItemLike) => traceOf(ctx, it);
  const p = (it: ElItemLike) => padOf(ctx, it);
  const v = (it: ElItemLike) => viaOf(ctx, it);
  if (a.kind === "trace" && b.kind === "trace") {
    const c = polylineToPolylineClosestPoints(t(a).pointsMm, t(b).pointsMm);
    return {
      gap: c.distance - (t(a).halfWidthMm + t(b).halfWidthMm),
      location: { x: (c.a.x + c.b.x) / 2, y: (c.a.y + c.b.y) / 2 },
    };
  }
  const traceVsPad = (tr: DrcTrace, pd: DrcPad) => ({
    gap: polylineToPolygonDistance(tr.pointsMm, pd.ring) - tr.halfWidthMm,
    location: pd.center,
  });
  const traceVsVia = (tr: DrcTrace, vg: DrcViaGeom) => ({
    gap:
      pointToPolylineDistance(vg.center, tr.pointsMm).distance -
      (tr.halfWidthMm + vg.radiusMm),
    location: vg.center,
  });
  if (a.kind === "trace" && b.kind === "pad") return traceVsPad(t(a), p(b));
  if (a.kind === "pad" && b.kind === "trace") return traceVsPad(t(b), p(a));
  if (a.kind === "trace" && b.kind === "via") return traceVsVia(t(a), v(b));
  if (a.kind === "via" && b.kind === "trace") return traceVsVia(t(b), v(a));
  if (a.kind === "via" && b.kind === "via") {
    const va = v(a);
    const vb = v(b);
    const d = Math.hypot(va.center.x - vb.center.x, va.center.y - vb.center.y);
    return {
      gap: d - (va.radiusMm + vb.radiusMm),
      location: {
        x: (va.center.x + vb.center.x) / 2,
        y: (va.center.y + vb.center.y) / 2,
      },
    };
  }
  const padVsVia = (pd: DrcPad, vg: DrcViaGeom) => ({
    gap: circleToPolygonDistance(vg.center, vg.radiusMm, pd.ring),
    location: vg.center,
  });
  if (a.kind === "pad" && b.kind === "via") return padVsVia(p(a), v(b));
  if (a.kind === "via" && b.kind === "pad") return padVsVia(p(b), v(a));
  if (a.kind === "pad" && b.kind === "pad") {
    return {
      gap: polygonToPolygonDistance(p(a).ring, p(b).ring),
      location: {
        x: (p(a).center.x + p(b).center.x) / 2,
        y: (p(a).center.y + p(b).center.y) / 2,
      },
    };
  }
  return null;
}
