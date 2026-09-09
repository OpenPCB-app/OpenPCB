import type { PcbCopperLayerId, PcbPointMm } from "../../sdks/designer";
import {
  holeBounds,
  itemsFromRecords,
  type DrcHole,
  type DrcPad,
  type DrcTrace,
  type DrcViaGeom,
  type LegalityContext,
} from "../drc/drc-context";
import type { PendingCopper } from "../drc/legality";
import { copperToHoleClearanceMm } from "../drc/rule-resolver";
import { buildCopperRecords } from "../pcb-connectivity/copper-records";
import {
  splitSegmentAtRings,
  type RingBounds,
} from "../pcb-geometry/region-rings";
import { SHORT_EPS_MM } from "../pcb-geometry/tolerance";
import { canonicalizeObstacles } from "./collision";
import { NM_PER_MM, type ObstacleRectNm } from "./types";

/** One nanometre, in mm — the outward step above the inclusive short tier. */
const ONE_NM_MM = 1e-6;

export interface BuildObstaclesInput {
  /**
   * The ONE legality context of this projection — the same object the live
   * gate judges against (live-parity contract 07 §5), so an inflated rect and
   * the gate's verdict cannot drift. Obstacles read the context's ITEMS, never
   * the projection's placements: a `DrcPad` already carries the exact rotated
   * ring bounds and every copper layer the pad occupies.
   */
  ctx: LegalityContext;
  /** Routing layer — other-layer copper is transparent. */
  layer: PcbCopperLayerId;
  /** Session net — same-net copper is transparent. */
  netId: string | null;
  /** Width of the trace being routed. */
  routeWidthMm: number;
  /** Pad keys (`${placementId}|${padNumber}`) that must stay routable: target + start pad. */
  excludePadIds?: ReadonlySet<string>;
  /**
   * Trace ids that are the SUBJECT of the search, not obstacles for it — the
   * tune tool's own trace. `sameNet` already drops a same-net neighbour, so
   * this only matters for a null-net subject, which no net can match.
   */
  excludeTraceIds?: ReadonlySet<string>;
  /**
   * Corridor window (mm). When given, only the items the context's grid returns
   * for it become rects — queried with the builder's OWN halo (broad-phase
   * contract 08 §8), so every item whose copper can constrain a path inside the
   * window is a rect, whatever the caller padded. Absent means the whole board.
   */
  withinBounds?: RingBounds;
  /**
   * Uncommitted session copper (accumulated runs + vias) that must block the
   * search like committed copper does. Converted through the SAME builder pair
   * `checkPendingCopper` uses, so a pending run is the same physical model to
   * the router as it is to the gate.
   */
  extra?: PendingCopper;
}

function sameNet(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a === b;
}

/** Exclude key of a footprint pad; free pads have none and never match. */
function padExcludeKey(pad: DrcPad): string | null {
  return pad.anchor.kind === "pad"
    ? `${pad.anchor.placementId}|${pad.anchor.padNumber}`
    : null;
}

/** Stable rect id fragment for a pad's anchor (free pads are `free:<id>`). */
function padRectKey(pad: DrcPad): string {
  return (
    padExcludeKey(pad) ??
    `free:${pad.anchor.kind === "freePad" ? pad.anchor.freePadId : "?"}`
  );
}

/** Rect from an mm box inflated by `inflateMm`, rounded OUTWARD to nm. */
function rectFrom(
  box: RingBounds,
  inflateMm: number,
  id: string,
): ObstacleRectNm {
  return {
    minX: Math.floor((box.minX - inflateMm) * NM_PER_MM),
    minY: Math.floor((box.minY - inflateMm) * NM_PER_MM),
    maxX: Math.ceil((box.maxX + inflateMm) * NM_PER_MM),
    maxY: Math.ceil((box.maxY + inflateMm) * NM_PER_MM),
    id,
  };
}

/**
 * Build clearance-inflated keep-out rects for auto-finish / walkaround /
 * meander fitting.
 *
 * **Superset convention (07 §5).** Each rect is a superset of
 * `item ⊕ required`, where
 *
 *   required = max( clearance resolved AT THE OBSTACLE,
 *                   the same pair resolved OUTSIDE every rule area,
 *                   SHORT_EPS_MM + 1 nm )
 *              + the obstacle's half extent + the route's half width
 *
 * rounded outward to nanometres. The outside-areas term is what keeps an
 * `area` relaxation AROUND the obstacle from shrinking the rect below what the
 * pair needs when the routed trace itself is outside that area (Astra run 1
 * #4) — and only that: a `net` / `netClass` / `layer` / `pairKind`-scoped
 * relaxation holds wherever the route is, so it shrinks the rect in full. An
 * area TIGHTENING at the obstacle is the larger term and still widens it. The
 * `SHORT_EPS_MM + 1 nm` floor keeps boundary contact above the INCLUSIVE short
 * tier under a 0 mm rule (#5). `fabMin` is deliberately NOT added: `FAB_CLEARANCE`
 * is a warning that never refuses, so the router must not be stricter than the
 * gate on its account.
 *
 * `segmentIntersectsRectNm` tests the open interior, so a path that avoids
 * every rect passes the gate's clearance, short, hole and keepout tiers on this
 * layer. It may still be refused a path that exists (AABB corners) and it says
 * nothing about the edge / off-board tier — a superset statement, not an
 * equivalence.
 */
export function buildRouteObstacles(
  input: BuildObstaclesInput,
): ObstacleRectNm[] {
  const { ctx, layer, netId, withinBounds } = input;
  const out: ObstacleRectNm[] = [];
  const routeHalfMm = input.routeWidthMm / 2;
  const shortFloorMm = SHORT_EPS_MM + ONE_NM_MM;

  /**
   * The requirement this obstacle imposes on the routed trace: the resolution
   * with BOTH evaluation points on the obstacle (a search heuristic — the gate
   * decides legality), floored by the same pair resolved outside every rule
   * area and by the short tier.
   */
  const requiredAt = (
    pairKind: "traceToTrace" | "traceToPad" | "traceToVia",
    obstacleNetId: string | null,
    pointMm: PcbPointMm,
  ): number =>
    Math.max(
      ctx.resolver.clearance(
        pairKind,
        layer,
        { netId, pointMm },
        { netId: obstacleNetId, pointMm },
      ).mm,
      ctx.resolver.clearanceOutsideAreas(pairKind, layer, netId, obstacleNetId)
        .mm,
      shortFloorMm,
    );

  // Pending session copper enters as ordinary items, through the SAME builder
  // pair the gate maps its pending copper with (one clamp policy, one bounds
  // convention). `checkPendingCopper` inlines this pair; there is no narrower
  // helper exported from `shared/drc` to call instead.
  let extraTraces: readonly DrcTrace[] = [];
  let extraVias: readonly DrcViaGeom[] = [];
  if (input.extra) {
    const items = itemsFromRecords(
      buildCopperRecords({
        layerCount: ctx.layerCount,
        placements: [],
        padNetIds: new Map(),
        freePads: [],
        traces: input.extra.traces,
        vias: input.extra.vias,
      }),
      ctx.validCopperLayers,
      ctx.layerCount,
      [],
      [],
    );
    extraTraces = items.traces;
    extraVias = items.vias;
  }

  /**
   * The builder's OWN halo (contract 08 §8): an item omitted here must not be
   * able to constrain a path inside the window, and the widest rect any item
   * can produce is `required + halfWidth + routeHalf` with `required` bounded
   * by `maxClearanceBoundMm` (copper pairs) or `maxHoleBoundMm` (drills). A
   * dropped item's copper is therefore farther than `reach + routeHalf` from
   * every window point, so no rect of its is missing from the window. The
   * callers' own `1 + reach + width` padding of `withinBounds` stays; this is
   * the floor under it, not a replacement.
   */
  const obstacleHaloMm =
    Math.max(ctx.maxClearanceBoundMm, ctx.maxHoleBoundMm, shortFloorMm) +
    routeHalfMm;

  const near = <T>(
    kind: "traces" | "pads" | "vias" | "holes",
    items: readonly T[],
  ): readonly T[] => {
    if (!withinBounds) return items;
    return ctx.near(kind, withinBounds, obstacleHaloMm).map((i) => items[i]!);
  };

  /**
   * Regions of constant area-scope membership along one obstacle segment — the
   * SAME `splitSegmentAtRings` split the gate applies (rule-semantics contract
   * §4.4). Without it a single midpoint decides the whole segment, and an
   * `area` rule covering only PART of a long segment is silently dropped: the
   * midpoint falls outside, the rect stays at the lower tier, and a path that
   * avoids every rect is still refused by the gate over the covered end.
   */
  const splitAtAreas = (
    a: PcbPointMm,
    b: PcbPointMm,
    halfWidthMm: number,
  ): Array<{ a: PcbPointMm; b: PcbPointMm }> => {
    const resolver = ctx.resolver;
    if (!resolver.hasAreaRules) return [{ a, b }];
    // Prefilter on the segment's COPPER box (both half widths), so an area that
    // clips the copper without crossing the centreline still triggers a split.
    const pad = halfWidthMm + routeHalfMm;
    const meets = resolver.boundsMeetAnyArea({
      minX: Math.min(a.x, b.x) - pad,
      minY: Math.min(a.y, b.y) - pad,
      maxX: Math.max(a.x, b.x) + pad,
      maxY: Math.max(a.y, b.y) + pad,
    });
    return meets ? splitSegmentAtRings(a, b, resolver.areaRings) : [{ a, b }];
  };

  for (const trace of [...near("traces", ctx.traces), ...extraTraces]) {
    if (trace.layer !== layer) continue;
    if (input.excludeTraceIds?.has(trace.id)) continue;
    if (sameNet(trace.netId, netId)) continue;
    // One rect per SEGMENT — whole-polyline boxes over-block long traces — and
    // one per area sub-segment inside it, each resolved at its OWN midpoint, so
    // an area-scoped rule inflates exactly the copper it covers.
    for (let i = 1; i < trace.pointsMm.length; i += 1) {
      const a = trace.pointsMm[i - 1]!;
      const b = trace.pointsMm[i]!;
      const subs = splitAtAreas(a, b, trace.halfWidthMm);
      for (let k = 0; k < subs.length; k += 1) {
        const sub = subs[k]!;
        const requiredMm = requiredAt("traceToTrace", trace.netId, {
          x: (sub.a.x + sub.b.x) / 2,
          y: (sub.a.y + sub.b.y) / 2,
        });
        out.push(
          rectFrom(
            {
              minX: Math.min(sub.a.x, sub.b.x),
              minY: Math.min(sub.a.y, sub.b.y),
              maxX: Math.max(sub.a.x, sub.b.x),
              maxY: Math.max(sub.a.y, sub.b.y),
            },
            requiredMm + trace.halfWidthMm + routeHalfMm,
            // An un-split segment keeps its historical id, so the walkaround's
            // cluster signature is unchanged on a board with no area rules.
            subs.length === 1
              ? `trace:${trace.id}:${i - 1}`
              : `trace:${trace.id}:${i - 1}:${k}`,
          ),
        );
      }
    }
  }

  for (const pad of near<DrcPad>("pads", ctx.pads)) {
    // The context's layer model: a through-hole pad occupies EVERY copper
    // layer, a layer-invalid one is clamped onto all of them, and free pads
    // are ordinary pads. Neither the placement-side heuristic nor the old
    // un-swapped union survives: the bounds are the exact rotated ring's.
    if (!pad.layers.includes(layer)) continue;
    const key = padExcludeKey(pad);
    if (key !== null && input.excludePadIds?.has(key)) continue;
    if (sameNet(pad.netId, netId)) continue;
    out.push(
      rectFrom(
        pad.bounds,
        requiredAt("traceToPad", pad.netId, pad.center) + routeHalfMm,
        `pad:${padRectKey(pad)}`,
      ),
    );
  }

  for (const vg of [...near<DrcViaGeom>("vias", ctx.vias), ...extraVias]) {
    if (!vg.layers.includes(layer)) continue;
    if (sameNet(vg.netId, netId)) continue;
    out.push(
      rectFrom(
        {
          minX: vg.center.x - vg.radiusMm,
          minY: vg.center.y - vg.radiusMm,
          maxX: vg.center.x + vg.radiusMm,
          maxY: vg.center.y + vg.radiusMm,
        },
        requiredAt("traceToVia", vg.netId, vg.center) + routeHalfMm,
        `via:${vg.via.id}`,
      ),
    );
  }

  // Non-plated holes carry no copper and no net, so their requirement is the
  // copper-to-hole clearance, not a pair-kind resolution. Plated holes belong
  // to a pad or a via, whose copper is already a rect above.
  const copperToHoleMm = Math.max(
    copperToHoleClearanceMm(ctx.designRules),
    shortFloorMm,
  );
  for (const hole of near<DrcHole>("holes", ctx.holes)) {
    if (hole.kind !== "npth") continue;
    out.push(
      rectFrom(
        holeBounds(hole),
        copperToHoleMm + routeHalfMm,
        `hole:${holeId(hole)}`,
      ),
    );
  }

  // A keepout has clearance 0 (zone/keepout contract §13.4), so the only
  // inflation is the route's half width. The ring's AABB is a deliberate
  // SUPERSET of the exact `keepoutAffects` predicate.
  for (const keepout of ctx.keepouts) {
    if (!keepout.restrictions.tracks) continue;
    if (!keepout.layers.includes(layer)) continue;
    if (keepout.pointsMm.length === 0) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of keepout.pointsMm) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    if (
      !Number.isFinite(minX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(maxY)
    ) {
      continue;
    }
    out.push(
      rectFrom(
        { minX, minY, maxX, maxY },
        routeHalfMm,
        `keepout:${keepout.id}`,
      ),
    );
  }

  return canonicalizeObstacles(out);
}

/** Stable rect id fragment for a non-plated hole's anchor. */
function holeId(hole: DrcHole): string {
  switch (hole.anchor.kind) {
    case "freeHole":
      return hole.anchor.freeHoleId;
    case "freePad":
      return hole.anchor.freePadId;
    case "pad":
      return `${hole.anchor.placementId}|${hole.anchor.padNumber}`;
    case "via":
      return hole.anchor.viaId;
    default:
      return "?";
  }
}
