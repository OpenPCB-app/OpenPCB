/**
 * Insert PCB entities (placements, traces, vias) for a KiCad project import.
 *
 * The schematic-insert step has already created designer_schematic_parts rows.
 * Here we:
 *   1. Seed PCB placements from those schematic parts (via the existing
 *      syncPcbPlacementsFromSchematic helper), then override each placement's
 *      positionMm / rotationDeg / layer with the values from the .kicad_pcb.
 *   2. Insert PcbTrace entities — one polyline per KiCad segment with two
 *      points. Net mapping is best-effort: KiCad uses integer ordinals,
 *      OpenPCB uses derived net ids resolved by ratsnest at projection time,
 *      so v1 records netId=null and netClassId="default" for every trace and
 *      surfaces a warning. The trace's geometry + layer are correct, so the
 *      user can re-assign nets on first projection.
 *   3. Insert PcbVia entities with the same netId=null v1 caveat.
 */

import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  KicadProjectImportWarning,
  PcbCopperLayerId,
  PcbKeepout,
  PcbPlacedPart,
  PcbPointMm,
  PcbTrace,
  PcbVia,
  PcbZone,
} from "../../../../../sdks/designer";
import { isCopperLayerId } from "../../../../../sdks/designer";
import {
  isZoneHoleInvalidity,
  zoneRegionValidity,
  zoneRingValidity,
} from "../../../../../shared/pcb-areas/zone-parse";
import {
  insertPcbKeepout,
  insertPcbTrace,
  insertPcbVia,
  insertPcbZone,
  loadPcbPlacements,
  syncPcbPlacementsFromSchematic,
  upsertPcbPlacement,
} from "../../pcb/pcb-store";
import type {
  ParsedKicadPcb,
  ParsedKicadPcbFootprint,
  ParsedKicadPcbPoint,
  ParsedKicadPcbZone,
} from "../../../../library/backend/infrastructure/parsers/kicad/kicad-pcb-parser";
import { schematicParts } from "../../schema";
import { eq } from "drizzle-orm";

const NM_PER_MM = 1_000_000;
const COPPER_LAYERS: readonly PcbCopperLayerId[] = [
  "F.Cu",
  "In1.Cu",
  "In2.Cu",
  "B.Cu",
];

type DbClient = BetterSQLite3Database<Record<string, unknown>>;

export interface PcbInsertResult {
  placementsSeeded: number;
  placementsRepositioned: number;
  tracesInserted: number;
  viasInserted: number;
  zonesInserted: number;
  keepoutsInserted: number;
  segmentsDropped: number;
  warnings: KicadProjectImportWarning[];
}

export interface PcbInsertOptions {
  designId: string;
  pcb: ParsedKicadPcb;
  /** refdes → partId map produced by insert-schematic. */
  partIdByRefdes: Map<string, string>;
  boardCenterMm: { x: number; y: number };
}

export function insertPcbEntities(
  tx: DbClient,
  options: PcbInsertOptions,
  timestamp: string,
): PcbInsertResult {
  const result: PcbInsertResult = {
    placementsSeeded: 0,
    placementsRepositioned: 0,
    tracesInserted: 0,
    viasInserted: 0,
    zonesInserted: 0,
    keepoutsInserted: 0,
    segmentsDropped: 0,
    warnings: [],
  };

  // ─── Placements (seed + reposition from KiCad coordinates) ───
  // syncPcbPlacementsFromSchematic needs each schematic part's footprint
  // snapshot — we re-read those rows and pair them with the inserted parts.
  const schematicPartRows = tx
    .select()
    .from(schematicParts)
    .where(eq(schematicParts.designId, options.designId))
    .all();
  const seedInput = schematicPartRows.map((row) => ({
    id: row.id,
    componentId: row.componentId,
    reference: row.reference,
    footprint: JSON.parse(
      row.footprintSnapshotJson,
    ) as PcbPlacedPart["footprint"],
  }));
  const seeded = syncPcbPlacementsFromSchematic({
    db: tx,
    designId: options.designId,
    schematicParts: seedInput,
    boardCenter: options.boardCenterMm,
    defaultLayer: "F.Cu",
    timestamp,
  });
  result.placementsSeeded = seeded.length;

  const placementByPartId = new Map(seeded.map((p) => [p.partId, p]));

  // Reposition each seeded placement using the .kicad_pcb footprint's at/layer.
  for (const fp of options.pcb.footprints) {
    const partId = options.partIdByRefdes.get(fp.reference);
    if (!partId) {
      result.warnings.push({
        code: "pcb_placement_skipped_no_part",
        severity: "warning",
        message: `PCB footprint '${fp.reference}' (${fp.libId}) has no matching schematic part; placement skipped.`,
      });
      continue;
    }
    const placement = placementByPartId.get(partId);
    if (!placement) continue;
    const layer = pickCopperLayer(fp.layer);
    const mirrored = layer === "B.Cu";
    const repositioned: PcbPlacedPart = {
      ...placement,
      positionMm: { x: fp.at.xMm, y: fp.at.yMm },
      rotationDeg: normalize360(fp.rotationDeg),
      layer,
      mirrored,
    };
    upsertPcbPlacement(tx, options.designId, repositioned, timestamp);
    result.placementsRepositioned += 1;
  }

  // ─── Traces ───
  const tracesByLayer = new Map<string, number>();
  let arcDerivedCount = 0;
  for (const segment of options.pcb.segments) {
    const layer = pickCopperLayer(segment.layer);
    const trace: PcbTrace = {
      id: crypto.randomUUID(),
      // netId stays null at insert; projection binding (pcb-projection.ts)
      // resolves it from netName at load time so we don't have to read the
      // schematic projection mid-transaction.
      netId: null,
      netName: segment.netName ?? null,
      netClassId: "default",
      layer,
      widthMm: segment.widthMm,
      pointsNm: [
        {
          x: Math.round(segment.start.xMm * NM_PER_MM),
          y: Math.round(segment.start.yMm * NM_PER_MM),
        },
        {
          x: Math.round(segment.end.xMm * NM_PER_MM),
          y: Math.round(segment.end.yMm * NM_PER_MM),
        },
      ],
      segmentMode: isAxisAligned(segment.start, segment.end)
        ? "manhattan-90"
        : "manhattan-45",
    };
    if (
      trace.pointsNm[0]!.x === trace.pointsNm[1]!.x &&
      trace.pointsNm[0]!.y === trace.pointsNm[1]!.y
    ) {
      result.segmentsDropped += 1;
      continue;
    }
    insertPcbTrace(tx, options.designId, trace, timestamp);
    result.tracesInserted += 1;
    tracesByLayer.set(layer, (tracesByLayer.get(layer) ?? 0) + 1);
    if (segment.originatedFromArc) arcDerivedCount += 1;
  }
  if (arcDerivedCount > 0) {
    result.warnings.push({
      code: "arc_tessellated",
      severity: "info",
      message: `Tessellated ${arcDerivedCount} arc-track chord segment(s) into straight Manhattan-45 polylines.`,
    });
  }

  // ─── Vias ───
  for (const v of options.pcb.vias) {
    const fromLayer = pickCopperLayer(v.layers[0]);
    const toLayer = pickCopperLayer(v.layers[1]);
    const via: PcbVia = {
      id: crypto.randomUUID(),
      netId: null,
      netName: v.netName ?? null,
      netClassId: "default",
      centerMm: { x: v.at.xMm, y: v.at.yMm },
      diameterMm: v.sizeMm,
      drillMm: v.drillMm,
      fromLayer,
      toLayer,
      viaType:
        v.type === "blind" ? "blind" : v.type === "micro" ? "micro" : "through",
      protection: "tented",
      provenance: "route",
    };
    insertPcbVia(tx, options.designId, via, timestamp);
    result.viasInserted += 1;
  }

  const tracesWithoutName =
    result.tracesInserted -
    options.pcb.segments.filter((s) => s.netName).length;
  if (tracesWithoutName > 0) {
    result.warnings.push({
      code: "pcb_traces_missing_net_name",
      severity: "info",
      message: `${tracesWithoutName} trace(s) had no resolved net name; projection will fall back to pad-alignment heuristic for those.`,
    });
  }

  // ─── Zones + keepouts (S3a contract §8) ───
  insertKeepouts(tx, options, timestamp, result);
  insertZones(tx, options, timestamp, result);
  if (result.zonesInserted > 0 || result.keepoutsInserted > 0) {
    result.warnings.push({
      code: "pcb_zones_imported",
      severity: "info",
      message: `Imported ${result.zonesInserted} copper zone(s) and ${result.keepoutsInserted} keepout(s).`,
    });
  }

  // Silence unused — kept for future ratsnest / projection wiring.
  void loadPcbPlacements;

  return result;
}

/**
 * KiCad rule areas → `PcbKeepout` rows. A rule area on no copper layer, or one
 * whose contour fails the shared ring test, is dropped with a warning rather
 * than persisted as a row `parsePcbKeepoutRecord` would later reject.
 */
function insertKeepouts(
  tx: DbClient,
  options: PcbInsertOptions,
  timestamp: string,
  result: PcbInsertResult,
): void {
  for (const k of options.pcb.keepouts) {
    const layers = warnNonCopperLayers(k.layers, "Rule area", k.name, result);
    if (layers.length === 0) continue;
    const pointsMm = toPointsMm(k.polygonPointsMm);
    if (!warnRingValid(pointsMm, "Rule area", k.name, result)) continue;
    // Holes included: ignoring one only widens the forbidden area, which is
    // the safe direction for a rule area (contract §8).
    if (k.extraContours > 0) {
      result.warnings.push({
        code: "zone_extra_contour_dropped",
        severity: "warning",
        message: `Rule area ${zoneLabel(k.name)} has ${k.extraContours} additional contour(s); only the first was imported.`,
      });
    }
    const keepout: PcbKeepout = {
      id: crypto.randomUUID(),
      name: k.name,
      enabled: true,
      lockedAt: k.locked ? timestamp : null,
      layers,
      pointsMm,
      restrictions: k.restrictions,
    };
    insertPcbKeepout(tx, options.designId, keepout, timestamp);
    result.keepoutsInserted += 1;
  }
}

/** Copper zones → one `PcbZone` per copper layer (contract §8, §2: one zone = one layer). */
function insertZones(
  tx: DbClient,
  options: PcbInsertOptions,
  timestamp: string,
  result: PcbInsertResult,
): void {
  for (const z of options.pcb.zones) {
    const layers = warnNonCopperLayers(z.layers, "Zone", z.name, result);
    if (layers.length === 0) continue;
    const pointsMm = toPointsMm(z.polygonPointsMm);
    if (!warnRingValid(pointsMm, "Zone", z.name, result)) continue;
    if (z.fillModeHatch) {
      result.warnings.push({
        code: "zone_hatched_fill_as_solid",
        severity: "warning",
        message: `Zone ${zoneLabel(z.name)} uses a hatched fill; imported as a solid fill.`,
      });
    }
    if (z.extraContours > 0) {
      result.warnings.push({
        code: "zone_extra_contour_dropped",
        severity: "warning",
        message: `Zone ${zoneLabel(z.name)} has ${z.extraContours} additional outline(s); only the first was imported.`,
      });
    }
    const region = buildZoneRegion(pointsMm, z.holes);
    // A cutout that survives flattening as an unusable ring is never DROPPED
    // (that would pour more copper than drawn): the zone comes in disabled,
    // keeping the holes, and the user fixes it (copper-pour contract §11).
    const holesValidity = zoneRegionValidity(region);
    const holesUsable = !isZoneHoleInvalidity(holesValidity);
    if (!holesUsable) {
      result.warnings.push({
        code: "zone_hole_invalid_import",
        severity: "warning",
        message: `Zone ${zoneLabel(z.name)} has a cutout that is not usable (${holesValidity}); imported disabled so it pours no copper.`,
      });
    }
    if (layers.length > 1) {
      result.warnings.push({
        code: "zone_multilayer_split",
        severity: "info",
        message: `Zone ${zoneLabel(z.name)} spans ${layers.length} copper layers; split into one zone per layer (${layers.join(", ")}).`,
      });
    }
    for (const layer of layers) {
      insertPcbZone(
        tx,
        options.designId,
        // A fresh region per row: two layers must not alias one points array.
        buildZone(z, layer, buildZoneRegion(pointsMm, z.holes), holesUsable, timestamp),
        timestamp,
      );
      result.zonesInserted += 1;
    }
  }
}

/** Outline plus its cutouts; an empty cutout list leaves the key off (§11). */
function buildZoneRegion(
  pointsMm: readonly PcbPointMm[],
  holes: readonly ParsedKicadPcbPoint[][],
): PcbZone["region"] {
  const holesMm = holes.map(toPointsMm).filter((hole) => hole.length >= 3);
  return {
    kind: "polygon",
    pointsMm: pointsMm.map((p) => ({ x: p.x, y: p.y })),
    ...(holesMm.length === 0 ? {} : { holesMm }),
  };
}

function buildZone(
  z: ParsedKicadPcbZone,
  layer: PcbCopperLayerId,
  region: PcbZone["region"],
  enabled: boolean,
  timestamp: string,
): PcbZone {
  const zone: PcbZone = {
    id: crypto.randomUUID(),
    name: z.name,
    // Fail safe: a zone whose drawn shape we cannot reproduce must not pour.
    enabled,
    lockedAt: z.locked ? timestamp : null,
    layer,
    // netId stays null at insert; projection binding resolves netName the same
    // way it does for traces and vias (contract §3.2).
    netId: null,
    netName: z.netName,
    region,
    priority: z.priority,
  };
  // Overrides are written only when the file carried the token — an absent
  // override inherits the board rule (contract §6).
  if (z.padConnection !== null) zone.padConnection = z.padConnection;
  if (z.clearanceMm !== null) zone.clearanceMm = z.clearanceMm;
  if (z.minThicknessMm !== null) zone.minWidthMm = z.minThicknessMm;
  if (z.thermal !== null) zone.thermal = z.thermal;
  if (z.islandRemoval !== null) zone.islandRemoval = z.islandRemoval;
  return zone;
}

/** Keeps the copper layer ids, warning once about everything else it dropped. */
function warnNonCopperLayers(
  layers: readonly string[],
  kind: string,
  name: string | null,
  result: PcbInsertResult,
): PcbCopperLayerId[] {
  const kept = layers.filter((l): l is PcbCopperLayerId => isCopperLayerId(l));
  const dropped = layers.filter((l) => !isCopperLayerId(l));
  if (dropped.length > 0) {
    result.warnings.push({
      code: "zone_layer_unsupported",
      severity: "warning",
      message: `${kind} ${zoneLabel(name)} references non-copper layer(s) ${dropped.join(", ")}; ${
        kept.length > 0 ? "those layers were dropped" : "nothing was imported"
      }.`,
    });
  } else if (kept.length === 0) {
    result.warnings.push({
      code: "zone_layer_unsupported",
      severity: "warning",
      message: `${kind} ${zoneLabel(name)} declares no layer; nothing was imported.`,
    });
  }
  return kept;
}

function warnRingValid(
  pointsMm: PcbPointMm[],
  kind: string,
  name: string | null,
  result: PcbInsertResult,
): boolean {
  const validity = zoneRingValidity(pointsMm);
  if (validity === "ok") return true;
  result.warnings.push({
    code: "zone_ring_invalid",
    severity: "warning",
    message: `${kind} ${zoneLabel(name)} has an invalid outline (${validity}); dropped.`,
  });
  return false;
}

function toPointsMm(points: readonly ParsedKicadPcbPoint[]): PcbPointMm[] {
  return points.map((p) => ({ x: p.xMm, y: p.yMm }));
}

function zoneLabel(name: string | null): string {
  return name ? `'${name}'` : "(unnamed)";
}

function pickCopperLayer(layer: string): PcbCopperLayerId {
  // Accept any valid copper-layer id (2–32 stackup); everything else → F.Cu.
  return isCopperLayerId(layer) ? layer : "F.Cu";
}

function normalize360(value: number): number {
  return ((Math.round(value) % 360) + 360) % 360;
}

function isAxisAligned(
  a: { xMm: number; yMm: number },
  b: { xMm: number; yMm: number },
): boolean {
  return a.xMm === b.xMm || a.yMm === b.yMm;
}

export function adjustBoardCenter(outline: ParsedKicadPcb["boardOutline"]): {
  x: number;
  y: number;
} {
  if (!outline) return { x: 0, y: 0 };
  return {
    x: (outline.minXMm + outline.maxXMm) / 2,
    y: (outline.minYMm + outline.maxYMm) / 2,
  };
}

/**
 * Re-export for tests: build a footprint summary string for logging.
 */
export function summarizeFootprint(fp: ParsedKicadPcbFootprint): string {
  return `${fp.reference} (${fp.libId}) @ ${fp.at.xMm.toFixed(2)},${fp.at.yMm.toFixed(2)} mm on ${fp.layer}`;
}
