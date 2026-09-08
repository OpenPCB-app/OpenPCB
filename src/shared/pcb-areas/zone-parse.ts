/**
 * The ONE reader of a persisted zone / keepout payload (contract §2.1).
 * `pcb-store`, the golden-fixture loader and any future paste/import path go
 * through here, so a v1 row upgrades identically everywhere.
 *
 * A v1 row is recognised by the ABSENCE of `region`. Parsing never throws and
 * never judges ring validity: a persisted invalid ring is data the user can
 * fix, so the derivation (§3.1) skips it with a warning instead.
 */
import type {
  PcbCopperLayerId,
  PcbKeepout,
  PcbKeepoutRestrictions,
  PcbPointMm,
  PcbZone,
  PcbZoneIslandRemoval,
  PcbZonePadConnection,
  PcbZoneRegion,
} from "../../sdks/designer";
import { isCopperLayerId } from "../../sdks/designer";
import {
  ringsIntersect,
  ringStrictlyInside,
  strictlyInsideRing,
} from "../pcb-geometry/region-rings";
import {
  canonicalizeRing,
  DEGENERATE_AREA_MM2,
  ringSignedArea,
} from "../pcb-geometry/ring-utils";
import { ringSelfIntersects } from "../pcb-geometry/segment-predicates";
import { GEOM_EPS_MM } from "../pcb-geometry/tolerance";

export type ZoneRecordWarningCode =
  | "zone_legacy_netless_disabled"
  | "zone_hatched_fill_as_solid";

export interface ZoneRecordWarning {
  code: ZoneRecordWarningCode;
  zoneId: string | null;
  detail: string;
}

export interface ZoneRecordUpgrade {
  zone: PcbZone | null;
  warnings: ZoneRecordWarning[];
}

/** Why a zone / keepout ring cannot bound a fill (contract §3.3). */
export type ZoneRingValidity =
  "ok" | "tooFewPoints" | "nonFinite" | "selfIntersecting" | "zeroArea";

/** Why a zone's cutouts cannot be subtracted (copper-pour contract §11). */
export type ZoneHoleInvalidity =
  | "hole_ring_invalid"
  | "hole_outside_outer"
  | "hole_touches_outer"
  | "holes_overlap"
  | "holes_nested";

/** Ring reasons plus the hole reasons — the verdict on a whole region. */
export type ZoneRegionValidity =
  | ZoneRingValidity
  | ZoneHoleInvalidity;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** `""` is never a net id (contract §3.2 has only set / null). */
function asNetId(value: unknown): string | null {
  const s = asString(value);
  return s ? s : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Points, or `null` when the array is missing or any vertex is unparsable. */
function parsePoints(value: unknown): PcbPointMm[] | null {
  if (!Array.isArray(value)) return null;
  const points: PcbPointMm[] = [];
  for (const raw of value) {
    const record = asRecord(raw);
    const x = asFiniteNumber(record?.x);
    const y = asFiniteNumber(record?.y);
    if (x === null || y === null) return null;
    points.push({ x, y });
  }
  return points.length < 3 ? null : points;
}

function parsePadConnection(value: unknown): PcbZonePadConnection | undefined {
  return value === "solid" ||
    value === "thermal" ||
    value === "thruHoleThermal" ||
    value === "none"
    ? value
    : undefined;
}

function parseIslandRemoval(value: unknown): PcbZoneIslandRemoval | undefined {
  if (value === "always" || value === "never") return value;
  const record = asRecord(value);
  const minAreaMm2 = asFiniteNumber(record?.minAreaMm2);
  // A negative threshold would keep every floating island (fail-open): malformed.
  return minAreaMm2 === null || minAreaMm2 < 0 ? undefined : { minAreaMm2 };
}

function parseThermal(
  value: unknown,
): { gapMm: number; spokeWidthMm: number } | undefined {
  const record = asRecord(value);
  const gapMm = asFiniteNumber(record?.gapMm);
  const spokeWidthMm = asFiniteNumber(record?.spokeWidthMm);
  if (gapMm === null || spokeWidthMm === null) return undefined;
  if (gapMm <= 0 || spokeWidthMm <= 0) return undefined;
  return { gapMm, spokeWidthMm };
}

/** Non-finite / negative overrides are dropped, not clamped (§2.1). */
function parseTightenOverride(value: unknown): number | undefined {
  const n = asFiniteNumber(value);
  return n === null || n < 0 ? undefined : n;
}

/** Integer ≥ 0: non-finite → 0, negative → 0, fractional → floor. */
function parsePriority(value: unknown): number {
  const n = asFiniteNumber(value);
  if (n === null || n < 0) return 0;
  return Math.floor(n);
}

/**
 * `holesMm` (copper-pour contract §11): `undefined` = the key is absent (an
 * empty list normalises to that), `null` = malformed. Malformed REJECTS the
 * row: dropping a cutout would pour MORE copper than the zone was drawn with,
 * so there is no safe repair.
 */
function parseHoles(value: unknown): PcbPointMm[][] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return null;
  const holes: PcbPointMm[][] = [];
  for (const raw of value) {
    const points = parsePoints(raw);
    if (!points) return null;
    holes.push(points);
  }
  return holes.length === 0 ? undefined : holes;
}

function parseRegion(value: unknown): PcbZoneRegion | null {
  const record = asRecord(value);
  if (!record) return null;
  // A board row covers the whole board and carries no points (contract §2.1);
  // its id must be `board:<layer>`, which the derivation (§3.1) enforces.
  if (record.kind === "board") return { kind: "board" };
  if (record.kind !== "polygon") return null;
  const pointsMm = parsePoints(record.pointsMm);
  if (!pointsMm) return null;
  const holesMm = parseHoles(record.holesMm);
  if (holesMm === null) return null;
  return {
    kind: "polygon",
    pointsMm,
    ...(holesMm === undefined ? {} : { holesMm }),
  };
}

/**
 * Upgrade one persisted zone payload to the v2 record. `zone: null` means the
 * row is rejected (missing id, non-copper layer, or unparsable points).
 */
export function upgradePcbZoneRecord(value: unknown): ZoneRecordUpgrade {
  const warnings: ZoneRecordWarning[] = [];
  const record = asRecord(value);
  if (!record) return { zone: null, warnings };

  const id = asString(record.id);
  const layer = record.layer;
  if (!id || !isCopperLayerId(layer)) return { zone: null, warnings };

  const isV2 = record.region !== undefined;
  let region: PcbZoneRegion;
  if (isV2) {
    const parsed = parseRegion(record.region);
    if (!parsed) return { zone: null, warnings };
    region = parsed;
  } else {
    const pointsMm = parsePoints(record.polygonPointsMm);
    if (!pointsMm) return { zone: null, warnings };
    region = { kind: "polygon", pointsMm };
  }

  if (record.fillType === "hatched") {
    warnings.push({
      code: "zone_hatched_fill_as_solid",
      zoneId: id,
      detail: "Hatched fill is not supported; the zone is filled solid.",
    });
  }

  const netId = asNetId(record.netId);
  const netName = asString(record.netName);
  const enabledRaw = record.enabled;
  let enabled = typeof enabledRaw === "boolean" ? enabledRaw : true;
  if (
    enabledRaw === undefined &&
    !isV2 &&
    !netId &&
    (netName === null || netName.trim() === "")
  ) {
    // A v1 net-less row is a pre-S3a rule area or a net-0 zone. It never
    // poured copper before the model changed; it must not start now.
    enabled = false;
    warnings.push({
      code: "zone_legacy_netless_disabled",
      zoneId: id,
      detail: "Legacy zone with no net was imported disabled.",
    });
  }

  const padConnection = parsePadConnection(
    isV2 ? record.padConnection : record.connection,
  );
  const clearanceMm = parseTightenOverride(record.clearanceMm);
  const minWidthMm = parseTightenOverride(record.minWidthMm);
  const thermal = parseThermal(record.thermal);
  const islandRemoval = parseIslandRemoval(record.islandRemoval);

  const zone: PcbZone = {
    id,
    name: asString(record.name),
    enabled,
    lockedAt: asString(record.lockedAt),
    layer,
    netId,
    netName,
    region,
    priority: parsePriority(record.priority),
    ...(padConnection === undefined ? {} : { padConnection }),
    ...(clearanceMm === undefined ? {} : { clearanceMm }),
    ...(minWidthMm === undefined ? {} : { minWidthMm }),
    ...(thermal === undefined ? {} : { thermal }),
    ...(islandRemoval === undefined ? {} : { islandRemoval }),
  };
  return { zone, warnings };
}

function parseRestrictions(value: unknown): PcbKeepoutRestrictions {
  const record = asRecord(value);
  const flag = (key: keyof PcbKeepoutRestrictions): boolean =>
    record?.[key] === true;
  return {
    tracks: flag("tracks"),
    vias: flag("vias"),
    pads: flag("pads"),
    copperPour: flag("copperPour"),
    footprints: flag("footprints"),
  };
}

/**
 * Parse one persisted keepout payload. Fail-closed: no id, an empty or
 * non-copper `layers` list, or fewer than three parsable points rejects the
 * row rather than widening or narrowing what it forbids.
 */
export function parsePcbKeepoutRecord(value: unknown): PcbKeepout | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = asString(record.id);
  if (!id) return null;
  if (!Array.isArray(record.layers) || record.layers.length === 0) return null;
  const layers: PcbCopperLayerId[] = [];
  for (const raw of record.layers) {
    if (!isCopperLayerId(raw)) return null;
    if (!layers.includes(raw)) layers.push(raw);
  }
  const pointsMm = parsePoints(record.pointsMm);
  if (!pointsMm) return null;
  return {
    id,
    name: asString(record.name),
    enabled: typeof record.enabled === "boolean" ? record.enabled : true,
    lockedAt: asString(record.lockedAt),
    layers,
    pointsMm,
    restrictions: parseRestrictions(record.restrictions),
  };
}

/**
 * The single ring test zones, keepouts and the board outline share (§3.3):
 * at least three finite vertices after canonicalisation, no inclusive
 * self-intersection, and more than a degenerate area.
 */
export function zoneRingValidity(
  points: readonly PcbPointMm[],
): ZoneRingValidity {
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return "nonFinite";
  }
  const ring = canonicalizeRing(points);
  if (ring.length < 3) return "tooFewPoints";
  if (ringSelfIntersects(ring)) return "selfIntersecting";
  // Strict `<`, the same threshold sense as the board-outline check.
  if (Math.abs(ringSignedArea(ring)) < DEGENERATE_AREA_MM2) return "zeroArea";
  return "ok";
}

const HOLE_INVALIDITIES: ReadonlySet<string> = new Set<ZoneHoleInvalidity>([
  "hole_ring_invalid",
  "hole_outside_outer",
  "hole_touches_outer",
  "holes_overlap",
  "holes_nested",
]);

/** Does this verdict blame a cutout rather than the outer ring? */
export function isZoneHoleInvalidity(
  validity: ZoneRegionValidity,
): validity is ZoneHoleInvalidity {
  return HOLE_INVALIDITIES.has(validity);
}

/** Two cutouts must be disjoint as FILLED regions — no nesting, no touching. */
function holePairValidity(
  rings: readonly PcbPointMm[][],
): ZoneHoleInvalidity | "ok" {
  for (let i = 0; i < rings.length; i += 1) {
    for (let j = i + 1; j < rings.length; j += 1) {
      const a = rings[i]!;
      const b = rings[j]!;
      if (
        ringStrictlyInside(a, b, GEOM_EPS_MM) ||
        ringStrictlyInside(b, a, GEOM_EPS_MM)
      ) {
        return "holes_nested";
      }
      if (ringsIntersect(a, b, GEOM_EPS_MM)) return "holes_overlap";
    }
  }
  return "ok";
}

/**
 * The ONE validity test for a whole zone region (copper-pour contract §11):
 * the outer ring by `zoneRingValidity`, then every cutout by the same test,
 * strictly inside the outer ring (no vertex outside, no edge contact) and
 * pairwise disjoint from every other cutout. A board region is always valid.
 *
 * Fail-closed by construction: every failure makes the derivation drop the
 * zone, because a region we cannot subtract exactly would pour MORE copper
 * than the user drew.
 */
export function zoneRegionValidity(
  region: PcbZoneRegion,
): ZoneRegionValidity {
  if (region.kind === "board") return "ok";
  const outerValidity = zoneRingValidity(region.pointsMm);
  if (outerValidity !== "ok") return outerValidity;
  const holes = region.holesMm ?? [];
  if (holes.length === 0) return "ok";
  const outer = canonicalizeRing(region.pointsMm);
  const rings: PcbPointMm[][] = [];
  for (const hole of holes) {
    if (zoneRingValidity(hole) !== "ok") return "hole_ring_invalid";
    const ring = canonicalizeRing(hole);
    for (const v of ring) {
      if (!strictlyInsideRing(v, outer, GEOM_EPS_MM)) return "hole_outside_outer";
    }
    // Vertices alone do not settle it: a cutout may bulge across an outer edge
    // and come back without putting a vertex outside.
    if (!ringStrictlyInside(ring, outer, GEOM_EPS_MM)) return "hole_touches_outer";
    rings.push(ring);
  }
  return holePairValidity(rings);
}
