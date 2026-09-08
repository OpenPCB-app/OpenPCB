/**
 * `keepoutAffects` — the ONE implementation of "does this keepout affect this
 * object?" (S3a zone/keepout contract §4). Pure, mm domain, over pre-resolved
 * geometric items (no projection types, mirroring `pcb-connectivity/
 * copper-items.ts`). DRC (S4), the route commit gate and the fill are the
 * intended callers; this file wires into none of them.
 *
 * `enabled: false` on the keepout means "affects nothing anywhere" (§3.5).
 * Otherwise, per §4: the restriction flag for the item's class must be set,
 * the item's copper layer(s) must intersect the keepout's layers, and the
 * item's geometry must overlap the keepout's OPEN interior (touching the
 * boundary is legal — a keepout has clearance 0).
 *
 * Non-finite coordinates return false: DRC's structural checks own malformed
 * geometry, not this predicate. Degenerate items (zero half-width, zero
 * radius, a sub-triangle ring) are handled by the underlying predicates in
 * `area-overlap.ts`, which are already total and return false for them — this
 * file does not special-case them again.
 */
import type {
  PcbCopperLayerId,
  PcbKeepout,
  PcbKeepoutRestrictions,
  PcbPointMm,
} from "../../sdks/designer";
import {
  discOverlapsRing,
  ringsOverlapPositiveArea,
  stadiumOverlapsRing,
} from "../pcb-geometry/area-overlap";
import {
  canonicalizeRing,
  DEGENERATE_AREA_MM2,
  ringSignedArea,
} from "../pcb-geometry/ring-utils";
import { ringSelfIntersects } from "../pcb-geometry/segment-predicates";
import { GEOM_EPS_MM } from "../pcb-geometry/tolerance";
import type { EffectiveKeepout } from "./copper-zones";

export type KeepoutItem =
  | {
      kind: "trace";
      layer: PcbCopperLayerId;
      pointsMm: readonly PcbPointMm[];
      widthMm: number;
    }
  | {
      kind: "via";
      layers: ReadonlySet<PcbCopperLayerId>;
      centerMm: PcbPointMm;
      diameterMm: number;
    }
  | {
      kind: "pad";
      layers: ReadonlySet<PcbCopperLayerId>;
      ringMm: readonly PcbPointMm[];
      /** Exact disc for a circular pad; when present, the ring is ignored. */
      disc?: { centerMm: PcbPointMm; radiusMm: number };
    }
  | {
      kind: "placement";
      sideLayer: "F.Cu" | "B.Cu";
      hullMm: readonly PcbPointMm[];
    };

function isFinitePoint(p: PcbPointMm): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

function ringFinite(ring: readonly PcbPointMm[]): boolean {
  return ring.every(isFinitePoint);
}

/**
 * Canonical ring, or null when the item's copper is degenerate (§4: a ring
 * with fewer than three vertices or no more than `DEGENERATE_AREA_MM2` is not
 * copper and is never affected — the fail-closed orientation branch of the
 * overlap predicate must not see it).
 */
function usableRing(
  ring: readonly PcbPointMm[],
  eps: number,
): PcbPointMm[] | null {
  if (!ringFinite(ring)) return null;
  const canonical = canonicalizeRing(ring, eps);
  if (canonical.length < 3) return null;
  if (Math.abs(ringSignedArea(canonical)) < DEGENERATE_AREA_MM2) return null;
  // A self-intersecting ring has no well-defined interior side; §3.3 rejects
  // it upstream, and this guard keeps the predicate total for raw input.
  if (ringSelfIntersects(canonical, eps)) return null;
  return canonical;
}

function layersIntersect(
  itemLayers: ReadonlySet<PcbCopperLayerId>,
  keepoutLayers: readonly PcbCopperLayerId[],
): boolean {
  for (const layer of keepoutLayers) {
    if (itemLayers.has(layer)) return true;
  }
  return false;
}

/** Restriction flag that governs an item's class: trace→tracks, via→vias, pad→pads, placement→footprints. */
export function keepoutRestrictionFor(
  item: KeepoutItem,
): keyof PcbKeepoutRestrictions {
  switch (item.kind) {
    case "trace":
      return "tracks";
    case "via":
      return "vias";
    case "pad":
      return "pads";
    case "placement":
      return "footprints";
  }
}

export function keepoutAffects(
  keepout: EffectiveKeepout | PcbKeepout,
  item: KeepoutItem,
  eps = GEOM_EPS_MM,
): boolean {
  if (!keepout.enabled) return false;
  if (!keepout.restrictions[keepoutRestrictionFor(item)]) return false;
  const keepoutRing = usableRing(keepout.pointsMm, eps);
  if (!keepoutRing) return false;

  switch (item.kind) {
    case "trace": {
      if (!keepout.layers.includes(item.layer)) return false;
      if (!ringFinite(item.pointsMm) || !Number.isFinite(item.widthMm)) {
        return false;
      }
      return stadiumOverlapsRing(
        item.pointsMm,
        item.widthMm / 2,
        keepoutRing,
        eps,
      );
    }
    case "via": {
      if (!layersIntersect(item.layers, keepout.layers)) return false;
      if (!isFinitePoint(item.centerMm) || !Number.isFinite(item.diameterMm)) {
        return false;
      }
      return discOverlapsRing(
        item.centerMm,
        item.diameterMm / 2,
        keepoutRing,
        eps,
      );
    }
    case "pad": {
      if (!layersIntersect(item.layers, keepout.layers)) return false;
      if (item.disc) {
        if (
          !isFinitePoint(item.disc.centerMm) ||
          !Number.isFinite(item.disc.radiusMm)
        ) {
          return false;
        }
        return discOverlapsRing(
          item.disc.centerMm,
          item.disc.radiusMm,
          keepoutRing,
          eps,
        );
      }
      const padRing = usableRing(item.ringMm, eps);
      if (!padRing) return false;
      return ringsOverlapPositiveArea(padRing, keepoutRing, eps);
    }
    case "placement": {
      if (!keepout.layers.includes(item.sideLayer)) return false;
      const hull = usableRing(item.hullMm, eps);
      if (!hull) return false;
      return ringsOverlapPositiveArea(hull, keepoutRing, eps);
    }
  }
}

/** Ids of the keepouts (in input order) that affect `item`. */
export function keepoutsAffecting(
  keepouts: readonly (EffectiveKeepout | PcbKeepout)[],
  item: KeepoutItem,
  eps = GEOM_EPS_MM,
): string[] {
  const ids: string[] = [];
  for (const keepout of keepouts) {
    if (keepoutAffects(keepout, item, eps)) ids.push(keepout.id);
  }
  return ids;
}
