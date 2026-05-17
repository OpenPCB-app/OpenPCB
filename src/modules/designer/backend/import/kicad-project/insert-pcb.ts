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
  PcbPlacedPart,
  PcbTrace,
  PcbVia,
  PcbZone,
} from "../../../../../sdks/designer";
import {
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

  // ─── Zones ───
  for (const z of options.pcb.zones) {
    const layer = pickCopperLayer(z.layer);
    const zone: PcbZone = {
      id: crypto.randomUUID(),
      netName: z.netName ?? null,
      layer,
      polygonPointsMm: z.polygonPointsMm.map((p) => ({ x: p.xMm, y: p.yMm })),
      hatchEdgeMm: z.hatchEdgeMm,
      fillType: z.fillType,
    };
    insertPcbZone(tx, options.designId, zone, timestamp);
    result.zonesInserted += 1;
  }
  if (result.zonesInserted > 0) {
    result.warnings.push({
      code: "pcb_zones_imported",
      severity: "info",
      message: `Imported ${result.zonesInserted} zone(s) as outline polygons. Fill recomputation and DRC participation are not yet wired.`,
    });
  }

  // Silence unused — kept for future ratsnest / projection wiring.
  void loadPcbPlacements;

  return result;
}

function pickCopperLayer(layer: string): PcbCopperLayerId {
  // Accept canonical KiCad copper-layer names; everything else falls back to F.Cu.
  return (COPPER_LAYERS as readonly string[]).includes(layer)
    ? (layer as PcbCopperLayerId)
    : "F.Cu";
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
