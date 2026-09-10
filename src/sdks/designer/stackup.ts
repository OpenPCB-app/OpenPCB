/**
 * Copper stackup model — the single source of truth for layer ordering,
 * validity and via spans across backend and frontend (DRC_HARDENING_PLAN.md
 * P2). Replaces every hardcoded `STACKUP_ORDER` / `["F.Cu","In1.Cu",…]`
 * literal and the `layerCount === 4 ? … : …` ternary.
 *
 * Ordering is top→bottom: F.Cu, In1.Cu, …, In(n-2).Cu, B.Cu. Inner layers are
 * numbered 1-based from the top, so an n-layer board has inner layers
 * In1.Cu … In(n-2).Cu.
 */
import type { PcbCopperLayerId, PcbLayerCount, PcbViaType } from "./types";

export const MIN_PCB_LAYER_COUNT = 2;
/** JLCPCB's current standard-order ceiling (audit §7). */
export const MAX_PCB_LAYER_COUNT = 32;

const INNER_RE = /^In([1-9]|[12][0-9]|30)\.Cu$/;

/** True for any string that names a copper layer (F.Cu, B.Cu, In1..In30). */
export function isCopperLayerId(v: unknown): v is PcbCopperLayerId {
  return v === "F.Cu" || v === "B.Cu" || (typeof v === "string" && INNER_RE.test(v));
}

/**
 * Ordered copper layers for a board of the given count: F.Cu first, B.Cu last,
 * inner layers In1..In(count-2) between. `count` must be an even value in
 * [2, 32]; callers should route external input through `parsePcbLayerCount`.
 */
export function copperLayersForCount(
  count: PcbLayerCount,
): readonly PcbCopperLayerId[] {
  const layers: PcbCopperLayerId[] = ["F.Cu"];
  for (let i = 1; i <= count - 2; i += 1) {
    layers.push(`In${i}.Cu` as PcbCopperLayerId);
  }
  layers.push("B.Cu");
  return layers;
}

/** Top→bottom index of a copper layer in the stackup, or null if not present. */
export function copperLayerIndex(
  layer: PcbCopperLayerId,
  count: PcbLayerCount,
): number | null {
  const idx = copperLayersForCount(count).indexOf(layer);
  return idx < 0 ? null : idx;
}

/**
 * Coerce arbitrary input to a valid `PcbLayerCount`: integers in [2, 32] round
 * UP to the next even value; anything out of range or non-numeric falls back
 * to 2. This replaces the old 6→2 (store) and 6→4 (import) coercions, which
 * silently discarded inner-layer data.
 */
export function parsePcbLayerCount(v: unknown): PcbLayerCount {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 2;
  const clamped = Math.max(
    MIN_PCB_LAYER_COUNT,
    Math.min(MAX_PCB_LAYER_COUNT, Math.floor(n)),
  );
  const even = clamped % 2 === 0 ? clamped : clamped + 1;
  return Math.min(even, MAX_PCB_LAYER_COUNT) as PcbLayerCount;
}

/**
 * Copper layers a via barrel occupies, from `from` to `to` inclusive,
 * restricted to layers valid for `count`. Returns [] when either endpoint is
 * off the stackup (a layer-invalid via) — callers decide the fallback.
 */
export function viaSpanLayers(
  from: PcbCopperLayerId,
  to: PcbCopperLayerId,
  count: PcbLayerCount,
): PcbCopperLayerId[] {
  const order = copperLayersForCount(count);
  const fromIdx = order.indexOf(from);
  const toIdx = order.indexOf(to);
  if (fromIdx < 0 || toIdx < 0) return [];
  const lo = Math.min(fromIdx, toIdx);
  const hi = Math.max(fromIdx, toIdx);
  return order.slice(lo, hi + 1) as PcbCopperLayerId[];
}

/**
 * Validate a via span for a board + via type. Enforces the layer vocabulary,
 * downward ordering, and per-type span shape:
 *   through → exactly F.Cu…B.Cu (the whole stackup)
 *   blind   → touches exactly one outer layer (F.Cu or B.Cu)
 *   buried  → touches neither outer layer
 *   micro   → a single adjacent step starting at an outer layer
 */
export function isValidViaSpan(
  from: PcbCopperLayerId,
  to: PcbCopperLayerId,
  viaType: PcbViaType,
  count: PcbLayerCount,
): { ok: true } | { ok: false; reason: string } {
  const order = copperLayersForCount(count);
  const fromIdx = order.indexOf(from);
  const toIdx = order.indexOf(to);
  if (fromIdx < 0 || toIdx < 0) {
    return {
      ok: false,
      reason: `via span ${from}→${to} is invalid for a ${count}-layer board`,
    };
  }
  if (fromIdx >= toIdx) {
    return { ok: false, reason: "via span must go downward through the stackup" };
  }
  const outerTop = fromIdx === 0;
  const outerBottom = toIdx === order.length - 1;
  switch (viaType) {
    case "through":
      return outerTop && outerBottom
        ? { ok: true }
        : { ok: false, reason: "through vias always span F.Cu to B.Cu" };
    case "blind":
      return outerTop !== outerBottom
        ? { ok: true }
        : {
            ok: false,
            reason: "blind vias must touch exactly one outer layer",
          };
    case "buried":
      return !outerTop && !outerBottom
        ? { ok: true }
        : { ok: false, reason: "buried vias must not touch an outer layer" };
    case "micro":
      return (outerTop || outerBottom) && toIdx - fromIdx === 1
        ? { ok: true }
        : {
            ok: false,
            reason: "micro vias must span one adjacent layer from an outer layer",
          };
    default:
      return { ok: false, reason: `unknown via type "${viaType}"` };
  }
}

