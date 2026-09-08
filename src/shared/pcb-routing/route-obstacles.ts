import type {
  PcbCopperLayerId,
  PcbPlacedPart,
  PcbPointMm,
  PcbTrace,
  PcbVia,
} from "../../sdks/designer";
import type { RuleResolver } from "../drc/rule-resolver";
import type { EffectiveKeepout } from "../pcb-areas/copper-zones";
import {
  padWorldHalfExtentsMm,
  padWorldPositionMm,
  placementPads,
} from "../pcb-geometry/pad-geometry";
import { boundsOfPoints } from "../pcb-geometry/region-rings";
import { placementSideLayer } from "../rendering/pad-copper-layers";
import { canonicalizeObstacles } from "./collision";
import { mmToNm, NM_PER_MM, type ObstacleRectNm } from "./types";

export interface BuildObstaclesInput {
  /** Pre-filtered by the caller's broad-phase (rbush) query. */
  traces: readonly PcbTrace[];
  placements: readonly PcbPlacedPart[];
  vias: readonly PcbVia[];
  /** Routing layer — other-layer copper is transparent (live-DRC parity). */
  layer: PcbCopperLayerId;
  /** Session net — same-net copper is transparent (live-DRC parity). */
  netId: string | null;
  /** Pad key `${placementId}|${padNumber}` → net id. */
  padNetMap: ReadonlyMap<string, string>;
  /**
   * The ONE rule resolver of this projection — the same instance the live-DRC
   * commit gate uses, so an inflated rect and the gate's verdict cannot drift
   * (rule-semantics contract §9). Each obstacle is inflated by
   * `clearance(kindOfObstacle, layer, {session net, p}, {obstacle net, p})`
   * with BOTH evaluation points at the obstacle: this is a search heuristic,
   * not a legality verdict, so an `area` relaxation applies whenever the
   * obstacle itself lies inside the area. The gate decides legality.
   */
  resolver: RuleResolver;
  /** Width of the trace being routed. */
  routeWidthMm: number;
  /** Pad keys (`${placementId}|${padNumber}`) that must stay routable: target + start pad. */
  excludePadIds?: ReadonlySet<string>;
  /**
   * Effective keepouts of the same projection (`collectKeepouts` — already
   * enabled-filtered and layer-narrowed; do NOT re-filter `enabled` here).
   * Every one with `restrictions.tracks` whose layers include the routing
   * layer becomes ONE rect: the bounding box of its ring, inflated by
   * `routeWidthMm / 2` only — a keepout has clearance 0 (zone/keepout
   * contract §13.4). The AABB is a deliberate SUPERSET of the exact
   * `keepoutAffects` predicate (§4: "a conservative superset, never a
   * subset"), so auto-finish / walkaround / meander may fail to find a path
   * that exists but can never propose one that enters the keepout. The exact
   * verdict stays with the live DRC.
   */
  keepouts?: readonly EffectiveKeepout[];
}

function sameNet(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a === b;
}

/**
 * Build clearance-inflated keep-out rects for auto-finish / walkaround /
 * meander fitting. Avoiding these rects is SUFFICIENT to pass the live-DRC
 * commit gate (both read the SAME resolver; AABBs are conservative near
 * corners — proposals may be stricter than the gate, never looser). The one
 * documented divergence is `area`-scoped rules: an obstacle is resolved with
 * both evaluation points on the obstacle, so a relaxation around it applies
 * even where the routed trace itself sits outside the area (§9 — a search
 * heuristic, never a legality verdict).
 */
export function buildRouteObstacles(
  input: BuildObstaclesInput,
): ObstacleRectNm[] {
  const out: ObstacleRectNm[] = [];
  const routeHalfNm = mmToNm(input.routeWidthMm / 2);
  const { resolver, layer, netId } = input;
  /** Clearance at one obstacle, both evaluation points on the obstacle (§9). */
  const clearanceAt = (
    pairKind: "traceToTrace" | "traceToPad" | "traceToVia",
    obstacleNetId: string | null,
    pointMm: PcbPointMm,
  ): number =>
    resolver.clearance(
      pairKind,
      layer,
      { netId, pointMm },
      { netId: obstacleNetId, pointMm },
    ).mm;

  for (const trace of input.traces) {
    if (trace.layer !== input.layer) continue;
    if (sameNet(trace.netId, input.netId)) continue;
    // required = clearance + pendingHalf + otherHalf (live-drc parity), one
    // rect per segment — whole-polyline boxes over-block long traces. The
    // clearance is resolved per segment at its midpoint, so an area-scoped
    // rule inflates only the segments it actually covers.
    for (let i = 1; i < trace.pointsNm.length; i += 1) {
      const a = trace.pointsNm[i - 1]!;
      const b = trace.pointsNm[i]!;
      const clearanceMm = clearanceAt("traceToTrace", trace.netId, {
        x: (a.x + b.x) / 2 / NM_PER_MM,
        y: (a.y + b.y) / 2 / NM_PER_MM,
      });
      const inflateNm = mmToNm(clearanceMm + trace.widthMm / 2) + routeHalfNm;
      out.push({
        minX: Math.min(a.x, b.x) - inflateNm,
        minY: Math.min(a.y, b.y) - inflateNm,
        maxX: Math.max(a.x, b.x) + inflateNm,
        maxY: Math.max(a.y, b.y) + inflateNm,
        id: `trace:${trace.id}:${i - 1}`,
      });
    }
  }

  for (const placement of input.placements) {
    // Live-DRC layer model: pads block F.Cu or B.Cu only.
    const padLayer: PcbCopperLayerId = placementSideLayer(placement);
    if (padLayer !== input.layer) continue;
    for (const pad of placementPads(placement)) {
      const key = `${placement.id}|${pad.number}`;
      if (input.excludePadIds?.has(key)) continue;
      const padNetId = input.padNetMap.get(key) ?? null;
      if (sameNet(padNetId, input.netId)) continue;
      const center = padWorldPositionMm(placement, pad);
      const padInflateNm =
        mmToNm(clearanceAt("traceToPad", padNetId, center)) + routeHalfNm;
      // Per-axis max of the swap-aware world AABB and live-DRC's un-swapped
      // model — the union clears both the physical pad and the commit gate.
      const swapped = padWorldHalfExtentsMm(placement, pad);
      const halfX = Math.max(swapped.x, pad.widthMm / 2);
      const halfY = Math.max(swapped.y, pad.heightMm / 2);
      out.push({
        minX: mmToNm(center.x - halfX) - padInflateNm,
        minY: mmToNm(center.y - halfY) - padInflateNm,
        maxX: mmToNm(center.x + halfX) + padInflateNm,
        maxY: mmToNm(center.y + halfY) + padInflateNm,
        id: `pad:${key}`,
      });
    }
  }

  for (const via of input.vias) {
    if (sameNet(via.netId, input.netId)) continue;
    // Vias block every layer (through barrels span the stack). Live DRC has
    // no trace↔via check — these rects only stop physical overlap. The
    // requirement is the `traceToVia` pair kind, not the trace-to-trace one.
    const halfNm =
      mmToNm(
        via.diameterMm / 2 + clearanceAt("traceToVia", via.netId, via.centerMm),
      ) + routeHalfNm;
    const cx = mmToNm(via.centerMm.x);
    const cy = mmToNm(via.centerMm.y);
    out.push({
      minX: cx - halfNm,
      minY: cy - halfNm,
      maxX: cx + halfNm,
      maxY: cy + halfNm,
      id: `via:${via.id}`,
    });
  }

  for (const keepout of input.keepouts ?? []) {
    if (!keepout.restrictions.tracks) continue;
    if (!keepout.layers.includes(input.layer)) continue;
    if (keepout.pointsMm.length === 0) continue;
    const bounds = boundsOfPoints(keepout.pointsMm);
    if (
      !Number.isFinite(bounds.minX) ||
      !Number.isFinite(bounds.minY) ||
      !Number.isFinite(bounds.maxX) ||
      !Number.isFinite(bounds.maxY)
    ) {
      continue;
    }
    // Floor / ceil (not nearest) so the rect is a literal superset of
    // `bounds ∓ w/2` — nearest rounding of the two terms separately could land
    // up to 1 nm inside the exact envelope, past the predicate's eps band.
    const halfMm = input.routeWidthMm / 2;
    out.push({
      minX: Math.floor((bounds.minX - halfMm) * NM_PER_MM),
      minY: Math.floor((bounds.minY - halfMm) * NM_PER_MM),
      maxX: Math.ceil((bounds.maxX + halfMm) * NM_PER_MM),
      maxY: Math.ceil((bounds.maxY + halfMm) * NM_PER_MM),
      id: `keepout:${keepout.id}`,
    });
  }

  return canonicalizeObstacles(out);
}
