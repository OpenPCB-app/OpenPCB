import type {
  DrcAnchor,
  DrcPairKind,
  PcbCopperLayerId,
  PcbNetClass,
  PcbPointMm,
} from "../../../sdks/designer";
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
import type { RingBounds } from "../../pcb-geometry/pad-outline";
import {
  padPadGap,
  padViaGap,
  tracePadGap,
  traceTraceGap,
  traceViaGap,
  viaViaGap,
  type PairGap,
} from "../pair-gap";
import type { DrcViolationDraft } from "../types";
import { anchorKey } from "../violation-id";

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
  // The ONE net-class chain (contract 06 §1): the resolver's memoized live
  // resolution, never a second `resolveNetClassId` call from here.
  const classOf = (netId: string | null): PcbNetClass | null =>
    classById.get(ctx.resolver.netClassIdOf(netId)) ?? null;
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
  out.push(...checkCreepage(ctx, voltageOf));
  return out;
}

/**
 * One heterogeneous electrical item (trace / pad / via) with its net voltage,
 * its anchor and the canonical pair key.
 */
interface ElItem {
  kind: "trace" | "pad" | "via";
  idx: number;
  netId: string | null;
  voltage: number;
  layers: readonly PcbCopperLayerId[];
  bounds: RingBounds;
  anchor: DrcAnchor;
  /** Sorted-anchor key — the smaller one leads every pair (contract §11). */
  key: string;
  /** Representative point for the ordinary-clearance lookup. */
  point: PcbPointMm;
}

const column = (layer: PcbCopperLayerId): "B1" | "B2" =>
  isInternalLayer(layer) ? "B1" : "B2";

function pairKindOf(a: ElItem["kind"], b: ElItem["kind"]): DrcPairKind {
  const set = new Set([a, b]);
  if (set.has("trace") && set.size === 1) return "traceToTrace";
  if (set.has("trace") && set.has("pad")) return "traceToPad";
  if (set.has("trace") && set.has("via")) return "traceToVia";
  if (set.has("pad") && set.size === 1) return "padToPad";
  if (set.has("pad") && set.has("via")) return "padToVia";
  return "viaToVia";
}

function traceOf(ctx: DrcContext, it: ElItem): DrcTrace {
  return ctx.traces[it.idx]!;
}
function padOf(ctx: DrcContext, it: ElItem): DrcPad {
  return ctx.pads[it.idx]!;
}
function viaOf(ctx: DrcContext, it: ElItem): DrcViaGeom {
  return ctx.vias[it.idx]!;
}

function buildElItems(
  ctx: DrcContext,
  voltageOf: (netId: string | null) => number,
): ElItem[] {
  const items: ElItem[] = [];
  const push = (item: Omit<ElItem, "key" | "voltage">): void => {
    items.push({
      ...item,
      key: anchorKey(item.anchor),
      voltage: voltageOf(item.netId),
    });
  };
  ctx.traces.forEach((t, idx) => {
    if (t.pointsMm.length < 2) return;
    push({
      kind: "trace",
      idx,
      netId: t.netId,
      layers: [t.layer],
      bounds: t.bounds,
      anchor: { kind: "trace", traceId: t.id },
      point: t.mid,
    });
  });
  ctx.pads.forEach((p, idx) => {
    push({
      kind: "pad",
      idx,
      netId: p.netId,
      layers: p.layers,
      bounds: p.bounds,
      anchor: p.anchor,
      point: p.center,
    });
  });
  ctx.vias.forEach((v, idx) => {
    push({
      kind: "via",
      idx,
      netId: v.netId,
      layers: v.layers,
      bounds: v.bounds,
      anchor: { kind: "via", viaId: v.via.id },
      point: v.center,
    });
  });
  return items;
}

/**
 * The shared copper layers of a pair, in stackup order. An off-stackup layer
 * (an un-clamped `TRACE_LAYER_MISMATCH` trace) sorts last instead of dropping
 * out, so such a pair is still judged.
 */
function sharedLayers(
  u: ElItem,
  v: ElItem,
  stackupIndex: ReadonlyMap<PcbCopperLayerId, number>,
): PcbCopperLayerId[] {
  const last = Number.MAX_SAFE_INTEGER;
  return u.layers
    .filter((l) => v.layers.includes(l))
    .sort((x, y) => (stackupIndex.get(x) ?? last) - (stackupIndex.get(y) ?? last));
}

/**
 * The IPC-2221 requirement for a pair: the MAXIMUM over every shared layer,
 * not the first one found — an inner layer resolves to the looser B1 column,
 * so a pad↔via pair sharing F.Cu and In1.Cu is bound by the outer B2 value.
 * The reported layer is the first in stackup order that attains it.
 */
function strictestSpacing(
  shared: readonly PcbCopperLayerId[],
  voltageDiff: number,
): { layer: PcbCopperLayerId; requiredMm: number } {
  let layer = shared[0]!;
  let requiredMm = ipc2221SpacingMm(voltageDiff, column(layer));
  for (let i = 1; i < shared.length; i += 1) {
    const l = shared[i]!;
    const r = ipc2221SpacingMm(voltageDiff, column(l));
    if (r > requiredMm) {
      requiredMm = r;
      layer = l;
    }
  }
  return { layer, requiredMm };
}

/** Edge-to-edge gap + marker location, through the ONE gap module (§3). */
function pairGapOf(ctx: DrcContext, a: ElItem, b: ElItem): PairGap {
  if (a.kind === "trace") {
    if (b.kind === "trace") return traceTraceGap(traceOf(ctx, a), traceOf(ctx, b));
    if (b.kind === "pad") return tracePadGap(traceOf(ctx, a), padOf(ctx, b));
    return traceViaGap(traceOf(ctx, a), viaOf(ctx, b));
  }
  if (a.kind === "pad") {
    if (b.kind === "trace") return tracePadGap(traceOf(ctx, b), padOf(ctx, a));
    if (b.kind === "pad") return padPadGap(padOf(ctx, a), padOf(ctx, b));
    return padViaGap(padOf(ctx, a), viaOf(ctx, b));
  }
  if (b.kind === "trace") return traceViaGap(traceOf(ctx, b), viaOf(ctx, a));
  if (b.kind === "pad") return padViaGap(padOf(ctx, b), viaOf(ctx, a));
  return viaViaGap(viaOf(ctx, a), viaOf(ctx, b));
}

function creepageViolation(
  ctx: DrcContext,
  u: ElItem,
  v: ElItem,
  stackupIndex: ReadonlyMap<PcbCopperLayerId, number>,
): DrcViolationDraft | null {
  const shared = sharedLayers(u, v, stackupIndex);
  if (shared.length === 0) return null;
  const voltageDiff = u.voltage - v.voltage;
  const { layer, requiredMm } = strictestSpacing(shared, voltageDiff);
  // Skip when the ORDINARY clearance already dominates — but only WITHOUT area
  // rules. Then net, class and layer scopes are constant over the pair, so the
  // representative-point resolution is exact and the skip cannot hide anything.
  // With area rules the closest approach may sit in a different region, where
  // the ordinary rule is looser than it is at the representative points
  // (rule-semantics contract §4.4), and the skip would suppress a real breach.
  // …and never for two pads of ONE footprint: the ordinary clearance tier does
  // not run inside a footprint (contract 06 §4), so nothing "already covers" the
  // pair and the skip would be a complete miss (Astra S7 #2).
  const sameFootprint =
    u.anchor.kind === "pad" &&
    v.anchor.kind === "pad" &&
    u.anchor.placementId === v.anchor.placementId;
  if (!ctx.resolver.hasAreaRules && !sameFootprint) {
    const base = ctx.resolver.clearance(
      pairKindOf(u.kind, v.kind),
      layer,
      { netId: u.netId, pointMm: u.point },
      { netId: v.netId, pointMm: v.point },
    ).mm;
    if (requiredMm <= base) return null;
  }
  if (aabbGap(u.bounds, v.bounds) > requiredMm) return null;
  const g = pairGapOf(ctx, u, v);
  if (!below(g.gap, requiredMm)) return null;
  return {
    code: "CREEPAGE_DISTANCE",
    message: `IPC-2221 spacing ${g.gap.toFixed(3)} mm is below ${requiredMm.toFixed(3)} mm for ${Math.abs(voltageDiff).toFixed(0)} V (${column(layer)})`,
    anchors: [u.anchor, v.anchor],
    locationMm: g.location,
    layer,
    measuredMm: g.gap,
    requiredMm,
  };
}

/**
 * Walk unordered item pairs where AT LEAST ONE item has a non-zero voltage.
 * This seeds creepage from HV pads/vias too (not just traces), handles negative
 * voltages via |va - vb|, and — because it uses i < j — never double-emits an
 * HV↔HV pair.
 */
function checkCreepage(
  ctx: DrcContext,
  voltageOf: (netId: string | null) => number,
): DrcViolationDraft[] {
  const out: DrcViolationDraft[] = [];
  const items = buildElItems(ctx, voltageOf);
  if (!items.some((it) => it.voltage !== 0)) return out;
  const stackupIndex = new Map(
    [...ctx.validCopperLayers].map((l, i) => [l, i] as const),
  );
  for (let i = 0; i < items.length; i += 1) {
    const a = items[i]!;
    for (let j = i + 1; j < items.length; j += 1) {
      const b = items[j]!;
      if (a.voltage === 0 && b.voltage === 0) continue; // ordinary clearance
      if (a.netId !== null && a.netId === b.netId) continue;
      // Canonical orientation (§11): the smaller anchor key leads, so the
      // reported location cannot depend on the input array order.
      const swap = a.key > b.key;
      const draft = creepageViolation(
        ctx,
        swap ? b : a,
        swap ? a : b,
        stackupIndex,
      );
      if (draft) out.push(draft);
    }
  }
  return out;
}
