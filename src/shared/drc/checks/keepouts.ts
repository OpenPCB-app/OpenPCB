import {
  copperLayersForCount,
  type DrcAnchor,
  type PcbCopperLayerId,
  type PcbPointMm,
} from "../../../sdks/designer";
import {
  keepoutAffects,
  type EffectiveKeepout,
  type KeepoutItem,
} from "../../pcb-areas";
import {
  boundsMeet,
  boundsOfPoints,
  strictlyInsideRing,
  type RingBounds,
} from "../../pcb-geometry/region-rings";
import { GEOM_EPS_MM } from "../../pcb-geometry/tolerance";
import { polylineToPolylineClosestPoints } from "../../pcb-geometry/pcb-trace-geometry";
import { placementSideLayer } from "../../rendering/pad-copper-layers";
import type { DrcContext, LegalityContext } from "../drc-context";
import type { ItemSet } from "./clearance-judge";
import type { DrcViolationDraft } from "../types";

/**
 * `KEEPOUT_VIOLATION` (zone/keepout contract §4, §13.1): every effective
 * keepout against every piece of copper and every placement the DRC context
 * already resolved.
 *
 * The verdict is `keepoutAffects` and nothing else — this check owns no
 * geometry. It builds the §4 items once, prefilters each (item, keepout) pair
 * on their AABBs, and emits ONE violation per affected pair however many times
 * the item crosses the area (the anchor pair is unique, so the id is too).
 *
 * Layer scope follows the items: a trace is on one layer; a via and a pad carry
 * the DRC CLAMP layer sets (a layer-invalid item is on every valid layer, so it
 * cannot escape the rule); a placement is judged on its outer copper layer
 * only, which is why an inner-layer keepout never affects one.
 */

/** An item plus everything the draft needs that the predicate does not see. */
interface CandidateItem {
  item: KeepoutItem;
  anchor: DrcAnchor;
  bounds: RingBounds;
  /** Layers the item's copper occupies; a placement contributes its side only. */
  layers: readonly PcbCopperLayerId[];
  /** Noun for the message ("Trace", "Via", "Pad U1.3", "Footprint U1"). */
  subject: string;
  /** Marker location when the item is not a polyline. */
  point: PcbPointMm;
  /** Set for traces: the witness search runs on the centreline. */
  polylineMm?: readonly PcbPointMm[];
}

function keepoutLabel(keepout: EffectiveKeepout): string {
  return keepout.name ?? keepout.id.slice(0, 6);
}

function padSubject(
  anchor: DrcAnchor,
  referenceOf: (id: string) => string,
): string {
  if (anchor.kind === "pad") {
    return `Pad ${referenceOf(anchor.placementId)}.${anchor.padNumber}`;
  }
  if (anchor.kind === "freePad") return `Pad ${anchor.freePadId.slice(0, 6)}`;
  return "Pad";
}

/** First layer in stackup order the item and the keepout share. */
function sharedLayer(
  stackup: readonly PcbCopperLayerId[],
  itemLayers: readonly PcbCopperLayerId[],
  keepout: EffectiveKeepout,
): PcbCopperLayerId {
  for (const layer of stackup) {
    if (itemLayers.includes(layer) && keepout.layers.includes(layer)) {
      return layer;
    }
  }
  // Unreachable once `keepoutAffects` said yes (it requires the intersection to
  // be non-empty); kept total so a future item class cannot crash the run.
  return keepout.layers[0]!;
}

/**
 * The witness point on a trace: the first vertex strictly inside the keepout,
 * else the point on the centreline closest to the (closed) keepout ring — the
 * case where the copper enters through a segment whose endpoints are both out.
 */
function traceWitness(
  polylineMm: readonly PcbPointMm[],
  keepout: EffectiveKeepout,
  fallback: PcbPointMm,
): PcbPointMm {
  for (const v of polylineMm) {
    if (strictlyInsideRing(v, keepout.pointsMm, GEOM_EPS_MM)) return v;
  }
  const ring = keepout.pointsMm;
  if (polylineMm.length >= 2 && ring.length >= 3) {
    const closed = [...ring, ring[0]!];
    const closest = polylineToPolylineClosestPoints([...polylineMm], closed);
    if (Number.isFinite(closest.distance)) return closest.a;
  }
  return fallback;
}

/** The copper candidates of one item set — traces, vias and pads (§4). */
function copperCandidates(
  ctx: LegalityContext,
  items: ItemSet,
): CandidateItem[] {
  // Memoised on the context: this used to rebuild the whole reference map on
  // every call, and the gate calls it per pending set (R1 #2).
  const referenceOf = (placementId: string): string =>
    ctx.placementReference(placementId);
  const out: CandidateItem[] = [];

  for (const t of items.traces) {
    if (t.pointsMm.length === 0) continue;
    out.push({
      item: {
        kind: "trace",
        layer: t.layer,
        pointsMm: t.pointsMm,
        widthMm: t.widthMm,
      },
      anchor: { kind: "trace", traceId: t.id },
      bounds: t.bounds,
      layers: [t.layer],
      subject: "Trace",
      point: t.mid,
      polylineMm: t.pointsMm,
    });
  }

  for (const v of items.vias) {
    out.push({
      item: {
        kind: "via",
        layers: new Set(v.layers),
        centerMm: v.center,
        diameterMm: v.radiusMm * 2,
      },
      anchor: { kind: "via", viaId: v.via.id },
      bounds: v.bounds,
      layers: v.layers,
      subject: "Via",
      point: v.center,
    });
  }

  for (const p of items.pads) {
    out.push({
      // A true circle passes its EXACT disc (§13.6 closed, contract 06 §2);
      // every other pad reaches the predicate as its sampled ring, which
      // circumscribes the shape and so errs towards "affected".
      item: {
        kind: "pad",
        layers: new Set(p.layers),
        ringMm: p.ring,
        ...(p.disc
          ? { disc: { centerMm: p.disc.center, radiusMm: p.disc.radiusMm } }
          : {}),
      },
      anchor: p.anchor,
      bounds: p.bounds,
      layers: p.layers,
      subject: padSubject(p.anchor, referenceOf),
      point: p.center,
    });
  }

  return out;
}

/**
 * The placement candidates — batch only: a part move has no live gate (07 §9),
 * and the hull needs `ctx.placementExtent`, which is not in `LegalityContext`.
 */
function placementCandidates(ctx: DrcContext): CandidateItem[] {
  const out: CandidateItem[] = [];
  for (const placement of ctx.placements) {
    const hull = ctx.placementExtent(placement.id);
    // No resolvable extent ⇒ not evaluated (§4): judging a part on geometry
    // that could be a SUBSET of it would be fail-open.
    if (!hull) continue;
    const sideLayer = placementSideLayer(placement);
    out.push({
      item: { kind: "placement", sideLayer, hullMm: hull },
      anchor: { kind: "placement", placementId: placement.id },
      bounds: boundsOfPoints(hull),
      layers: [sideLayer],
      subject: `Footprint ${placement.reference}`,
      point: placement.positionMm,
    });
  }

  return out;
}

function judgeKeepouts(
  ctx: LegalityContext,
  items: readonly CandidateItem[],
  out: DrcViolationDraft[],
): void {
  const stackup = copperLayersForCount(ctx.layerCount);

  for (const keepout of ctx.keepouts) {
    const keepoutBounds = boundsOfPoints(keepout.pointsMm);
    const label = keepoutLabel(keepout);
    for (const candidate of items) {
      if (!boundsMeet(candidate.bounds, keepoutBounds, GEOM_EPS_MM)) continue;
      if (!keepoutAffects(keepout, candidate.item)) continue;
      const layer =
        candidate.item.kind === "trace"
          ? candidate.item.layer
          : sharedLayer(stackup, candidate.layers, keepout);
      const locationMm = candidate.polylineMm
        ? traceWitness(candidate.polylineMm, keepout, candidate.point)
        : candidate.point;
      const forbidden =
        candidate.item.kind === "trace"
          ? "tracks"
          : candidate.item.kind === "via"
            ? "vias"
            : candidate.item.kind === "pad"
              ? "pads"
              : "footprints";
      // A trace names its layer up front (it has exactly one); every other item
      // names the layer the verdict was reached on, after the keepout.
      const isTrace = candidate.item.kind === "trace";
      const subject = isTrace ? `Trace on ${layer}` : candidate.subject;
      const where = isTrace ? "" : ` on ${layer}`;
      out.push({
        code: "KEEPOUT_VIOLATION",
        message: `${subject} enters keepout "${label}"${where} (${forbidden} forbidden)`,
        anchors: [candidate.anchor, { kind: "keepout", keepoutId: keepout.id }],
        locationMm,
        layer,
      });
    }
  }
}

/** `KEEPOUT_VIOLATION` for the copper of one item set (07 §3 "Areas"). */
export function keepoutItems(
  ctx: LegalityContext,
  items: ItemSet,
  opts: { out: DrcViolationDraft[] },
): void {
  if (ctx.keepouts.length === 0) return;
  judgeKeepouts(ctx, copperCandidates(ctx, items), opts.out);
}

export function checkKeepouts(ctx: DrcContext): DrcViolationDraft[] {
  if (ctx.keepouts.length === 0) return [];
  const out: DrcViolationDraft[] = [];
  // ONE candidate list, in the order the check has always built it (copper,
  // then placements), so the draft order — and with it the engine's same-id
  // survivor — is unchanged.
  judgeKeepouts(
    ctx,
    [...copperCandidates(ctx, ctx), ...placementCandidates(ctx)],
    out,
  );
  return out;
}
