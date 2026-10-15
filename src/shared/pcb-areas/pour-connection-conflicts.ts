/**
 * Same-net pour connection conflicts (H19 / OPENPCB-67 §3.9.1).
 *
 * Same-net zones never carve each other (`pour-params.ts` zoneExclusions) and
 * every consumer unions the pours of one net, so where two same-net pours
 * cover one pad and resolve its connection differently, the union silently
 * keeps "most copper": a solid board pour floods a thermal polygon's relief
 * gaps, a wider gap is filled by a narrower one. This pure check finds every
 * such pad so manufacturing export can refuse (`EXPORT_POUR_CONNECTION_CONFLICT`)
 * and the layers panel can warn — the geometry itself is unchanged.
 *
 * The per-zone resolution is the fill kernel's own (`resolvePadConnection`,
 * `resolveThermalConfig`, `zoneMinThicknessMm`), so this check cannot disagree
 * with the copper the kernel would pour.
 */
import type {
  PcbCopperLayerId,
  PcbDesignRules,
  PcbFreePad,
  PcbPointMm,
} from "../../sdks/designer";
import type {
  CopperPadAnchor,
  CopperRecords,
  PadCopperRecord,
} from "../pcb-connectivity/copper-records";
import {
  discOverlapsRing,
  ringsOverlapPositiveArea,
} from "../pcb-geometry/area-overlap";
import { ringStrictlyInside } from "../pcb-geometry/region-rings";
import { canonicalizeRing, ringSignedArea } from "../pcb-geometry/ring-utils";
import {
  resolvePadConnection,
  resolveThermalConfig,
  type ResolvedPadConnection,
} from "../rendering/copper-fill/copper-fill-geometry";
import type { EffectiveCopperZone } from "./copper-zones";
import { zoneMinThicknessMm } from "./pour-params";

export interface PourConnectionConflictZone {
  zoneId: string;
  isBoard: boolean;
  resolved: ResolvedPadConnection;
  /** Physical relief gap (mm) the kernel would cut; null unless `thermal`. */
  gapMm: number | null;
  /** Physical spoke width (mm, after the min-width floor); null unless `thermal`. */
  spokeWidthMm: number | null;
}

export interface PourConnectionConflict {
  layer: PcbCopperLayerId;
  netId: string;
  pad:
    | { kind: "pad"; placementId: string; padNumber: string }
    | { kind: "freePad"; freePadId: string };
  /** Every same-net pour covering the pad on `layer`, sorted by zone id. */
  zones: PourConnectionConflictZone[];
}

export interface PourConnectionConflictInput {
  /** `collectCopperZones(...).zones` — enabled, bound zones only. */
  zones: readonly EffectiveCopperZone[];
  /** `buildCopperRecords` of the SAME projection. */
  records: CopperRecords;
  /**
   * The projection's free pads: a `std` free pad is drilled by definition
   * whatever its drill says (kernel S3a), which decides `thruHoleThermal`.
   */
  freePads: ReadonlyArray<Pick<PcbFreePad, "id" | "padType">>;
  /** Board rules: the spoke floor is part of the physical relief. */
  designRules: PcbDesignRules;
}

/** Code-unit order, never `localeCompare` (machine-independent). */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function anchorKey(anchor: CopperPadAnchor): string {
  return anchor.kind === "pad"
    ? `pad\u0000${anchor.placementId}\u0000${anchor.padNumber}`
    : `freePad\u0000${anchor.freePadId}`;
}

interface CanonicalPolygon {
  outer: PcbPointMm[];
  holes: PcbPointMm[][];
}

/** Mirrors the kernel's `padRecordHasCopper`: a degenerate ring pours nothing. */
function padHasCopper(record: PadCopperRecord): boolean {
  return record.ring.length >= 3 && Math.abs(ringSignedArea(record.ring)) > 0;
}

/**
 * Does the zone's region meet the pad's copper with positive area? A board
 * zone covers every pad on its layer: pad copper off the board is already a
 * non-overridable DRC error, so treating it as covered only over-reports.
 * A pad lying wholly inside a zone cutout is not covered.
 */
function zoneCoversPad(
  polygon: CanonicalPolygon | null,
  record: PadCopperRecord,
  padRing: readonly PcbPointMm[],
): boolean {
  if (polygon === null) return true;
  const overlaps = record.disc
    ? discOverlapsRing(record.disc.center, record.disc.radiusMm, polygon.outer)
    : ringsOverlapPositiveArea(padRing, polygon.outer);
  if (!overlaps) return false;
  return !polygon.holes.some((hole) => ringStrictlyInside(padRing, hole));
}

function resolveZone(
  zone: EffectiveCopperZone,
  drilled: boolean,
  designRules: PcbDesignRules,
): PourConnectionConflictZone {
  const resolved = resolvePadConnection(zone.padConnection, drilled);
  const base = { zoneId: zone.id, isBoard: zone.sourceKind === "board" };
  // Same mapping as `pourParamsForZone`: an absent `thermal` keeps the
  // kernel defaults.
  const thermal =
    resolved === "thermal"
      ? resolveThermalConfig(
          {
            padConnection: zone.padConnection,
            ...(zone.thermal
              ? {
                  thermalReliefGapMm: zone.thermal.gapMm,
                  thermalSpokeWidthMm: zone.thermal.spokeWidthMm,
                }
              : {}),
          },
          zoneMinThicknessMm(zone, designRules),
        )
      : null;
  return {
    ...base,
    resolved,
    gapMm: thermal ? thermal.gapMm : null,
    spokeWidthMm: thermal ? thermal.spokeWidthMm : null,
  };
}

function sameResolution(
  a: PourConnectionConflictZone,
  b: PourConnectionConflictZone,
): boolean {
  return (
    a.resolved === b.resolved &&
    a.gapMm === b.gapMm &&
    a.spokeWidthMm === b.spokeWidthMm
  );
}

function canonicalPolygons(
  zones: readonly EffectiveCopperZone[],
): Map<string, CanonicalPolygon | null> {
  const out = new Map<string, CanonicalPolygon | null>();
  for (const zone of zones) {
    out.set(
      zone.id,
      zone.region.kind === "polygon"
        ? {
            outer: canonicalizeRing(zone.region.pointsMm),
            holes: (zone.region.holesMm ?? []).map((h) => canonicalizeRing(h)),
          }
        : null,
    );
  }
  return out;
}

/**
 * One conflict per (layer, pad) where ≥2 enabled same-net pours cover the pad
 * and resolve `(mode, gap, spoke)` differently. Sorted by (layer, netId, pad
 * key) in code-unit order. A pad number with several copper shapes reports
 * once, from its first conflicting shape.
 */
export function findPourConnectionConflicts(
  input: PourConnectionConflictInput,
): PourConnectionConflict[] {
  const stdFreePadIds = new Set(
    input.freePads.filter((p) => p.padType === "std").map((p) => p.id),
  );
  const polygons = canonicalPolygons(input.zones);
  const found = new Map<string, PourConnectionConflict>();

  for (const record of input.records.pads) {
    const netId = record.netId;
    // Unplated copper and layer-invalid pads are never same-net members in the
    // kernel (every zone resolves them alike), so they cannot conflict.
    if (netId === null || !record.plated || record.declaredLayerInvalid)
      continue;
    if (!padHasCopper(record)) continue;
    const drilled =
      record.drillMm > 0 ||
      (record.anchor.kind === "freePad" &&
        stdFreePadIds.has(record.anchor.freePadId));
    const padRing = canonicalizeRing(record.ring);
    const padKey = anchorKey(record.anchor);

    for (const layer of new Set(record.resolvedLayers)) {
      const key = `${layer}\u0000${padKey}`;
      if (found.has(key)) continue;
      const covering = input.zones.filter(
        (zone) =>
          zone.layer === layer &&
          zone.netId === netId &&
          zoneCoversPad(polygons.get(zone.id) ?? null, record, padRing),
      );
      if (covering.length < 2) continue;
      const zones = covering
        .map((zone) => resolveZone(zone, drilled, input.designRules))
        .sort((a, b) => compareStrings(a.zoneId, b.zoneId));
      if (zones.every((z) => sameResolution(z, zones[0]!))) continue;
      found.set(key, {
        layer,
        netId,
        pad:
          record.anchor.kind === "pad"
            ? {
                kind: "pad",
                placementId: record.anchor.placementId,
                padNumber: record.anchor.padNumber,
              }
            : { kind: "freePad", freePadId: record.anchor.freePadId },
        zones,
      });
    }
  }

  return [...found.values()].sort(
    (a, b) =>
      compareStrings(a.layer, b.layer) ||
      compareStrings(a.netId, b.netId) ||
      compareStrings(anchorKey(a.pad), anchorKey(b.pad)),
  );
}
