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
import { canonicalizeRing } from "../../pcb-geometry/ring-utils";
import type { RoundedShape } from "../../pcb-geometry/rounded-shape-types";
import { roundedOverlapsRing } from "../../pcb-geometry/rounded-shape";
import { GEOM_EPS_MM } from "../../pcb-geometry/tolerance";
import { polylineToPolylineClosestPoints } from "../../pcb-geometry/pcb-trace-geometry";
import { placementSideLayer } from "../../rendering/pad-copper-layers";
import type {
  DrcContext,
  DrcPad,
  DrcTrace,
  DrcViaGeom,
  LegalityContext,
} from "../drc-context";
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
  /**
   * Set for a pad whose ring CIRCUMSCRIBES its copper (oval / roundrect): the
   * exact shape the ring's verdict is refined against (12 §1.3).
   */
  rounded?: RoundedShape;
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

/**
 * The per-item candidate constructors. ONE definition each, so the linear list
 * and the indexed enumeration cannot build a candidate two ways (08 §4).
 * `null` = the item contributes no candidate.
 */
function traceCandidate(t: DrcTrace): CandidateItem | null {
  if (t.pointsMm.length === 0) return null;
  return {
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
  };
}

function viaCandidate(v: DrcViaGeom): CandidateItem {
  return {
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
  };
}

function padCandidate(
  p: DrcPad,
  referenceOf: (id: string) => string,
): CandidateItem {
  return {
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
    // Only an ARC-bearing pad the disc arm does not already answer exactly:
    // a `rect` / `trapezoid` / `custom` core IS the ring (radius 0) and a
    // circle is the disc, so neither has anything to refine (12 §1.3).
    ...(p.rounded.radiusMm > 0 && p.rounded.core.length > 1
      ? { rounded: p.rounded }
      : {}),
  };
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
    const candidate = traceCandidate(t);
    if (candidate) out.push(candidate);
  }

  for (const v of items.vias) out.push(viaCandidate(v));

  for (const p of items.pads) out.push(padCandidate(p, referenceOf));

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

/**
 * The verdict for ONE (keepout, candidate) pair — the whole of the check's
 * geometry and message. Both enumerations call exactly this, so they can differ
 * only in which candidates they list (08 §4).
 */
function judgeKeepoutPair(
  stackup: readonly PcbCopperLayerId[],
  keepout: EffectiveKeepout,
  keepoutBounds: RingBounds,
  label: string,
  candidate: CandidateItem,
  out: DrcViolationDraft[],
): void {
  if (!boundsMeet(candidate.bounds, keepoutBounds, GEOM_EPS_MM)) return;
  if (!keepoutAffects(keepout, candidate.item)) return;
  // The exact refinement (12 §1.3). `keepoutAffects` owns the whole verdict —
  // restrictions, layers, the keepout ring's usability and the conservative
  // geometry — and an oval / roundrect pad reaches it as its CIRCUMSCRIBED
  // ring, which claims up to 0.86 %·r of copper the pad does not have. The core
  // ⊕ disc is a subset of that ring, so this can only withdraw an affectation
  // the ring fabricated, never add one, and it runs solely on the rare pairs
  // the ring already flagged. The keepout ring is canonicalised exactly as
  // `keepoutAffects` canonicalised it, so both judge one ring.
  if (
    candidate.rounded &&
    !roundedOverlapsRing(
      candidate.rounded,
      canonicalizeRing(keepout.pointsMm, GEOM_EPS_MM),
      GEOM_EPS_MM,
    )
  ) {
    return;
  }
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
      judgeKeepoutPair(stackup, keepout, keepoutBounds, label, candidate, out);
    }
  }
}

/**
 * The same keepout order and the same kind order (traces, vias, pads, then the
 * placements), over the grid instead of the whole candidate list (08 §4).
 *
 * The query halo is ZERO: the exact filter this check has always applied is
 * `boundsMeet(item, keepoutBounds, GEOM_EPS_MM)`, and a query already pads by
 * `GEOM_EPS_MM` plus the grid's own slack. For pads and vias the filed bounds
 * ARE the AABB the filter tests, so the result is a superset of it outright.
 * For traces the grid is geometry-tight (§2.1) — but `keepoutAffects` answers
 * yes only when the trace's stadium overlaps the keepout's ring, which lies
 * inside `keepoutBounds`, so a trace whose copper never reaches that box could
 * not have produced a draft in the linear enumeration either.
 *
 * Candidates are built per hit, from the SAME constructors the linear list
 * uses, so no draft field can drift between the two.
 */
function judgeKeepoutsIndexed(
  ctx: LegalityContext,
  items: ItemSet,
  placements: readonly CandidateItem[],
  out: DrcViolationDraft[],
): void {
  const stackup = copperLayersForCount(ctx.layerCount);
  const referenceOf = (placementId: string): string =>
    ctx.placementReference(placementId);

  for (const keepout of ctx.keepouts) {
    const keepoutBounds = boundsOfPoints(keepout.pointsMm);
    const label = keepoutLabel(keepout);
    for (const i of ctx.near("traces", keepoutBounds, 0)) {
      const candidate = traceCandidate(items.traces[i]!);
      if (!candidate) continue;
      judgeKeepoutPair(stackup, keepout, keepoutBounds, label, candidate, out);
    }
    for (const i of ctx.near("vias", keepoutBounds, 0)) {
      judgeKeepoutPair(
        stackup,
        keepout,
        keepoutBounds,
        label,
        viaCandidate(items.vias[i]!),
        out,
      );
    }
    for (const i of ctx.near("pads", keepoutBounds, 0)) {
      judgeKeepoutPair(
        stackup,
        keepout,
        keepoutBounds,
        label,
        padCandidate(items.pads[i]!, referenceOf),
        out,
      );
    }
    // Placements are not a grid kind (they are not copper) — listed linearly,
    // and only by the batch check: a part move has no live gate (07 §9).
    for (const candidate of placements) {
      judgeKeepoutPair(stackup, keepout, keepoutBounds, label, candidate, out);
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
  // The grid indexes the CONTEXT's arrays; a pending subject set is enumerated
  // linearly, which the same per-pair body makes equivalent.
  const gridded =
    ctx.broadPhase !== "exhaustive" &&
    items.traces === ctx.traces &&
    items.pads === ctx.pads &&
    items.vias === ctx.vias;
  if (gridded) judgeKeepoutsIndexed(ctx, items, [], opts.out);
  else judgeKeepouts(ctx, copperCandidates(ctx, items), opts.out);
}

export function checkKeepouts(ctx: DrcContext): DrcViolationDraft[] {
  if (ctx.keepouts.length === 0) return [];
  const out: DrcViolationDraft[] = [];
  if (ctx.broadPhase === "exhaustive") {
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
  judgeKeepoutsIndexed(ctx, ctx, placementCandidates(ctx), out);
  return out;
}
