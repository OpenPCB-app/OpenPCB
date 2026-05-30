import { asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  DesignerDesignRecord,
  DesignerDesignSummary,
  DesignerLabel,
  DesignerPin,
  DesignerPlacedPart,
  DesignerSchematicPreview,
  DesignerSchematicProjection,
  DesignerWire,
  LibraryComponentPlacementDetail,
} from "../../../sdks";
import { normalizeRotationDeg } from "./commands/place-part";
import { loadPrimitives } from "./primitive-store";
import { deriveNetsAndJunctions } from "./projection-world";
import {
  designHeads,
  drcResults,
  schematicLabels,
  schematicParts,
  schematicPins,
  schematicWires,
} from "./schema";
import { parseJsonRecord } from "./value-guards";
import { parseWirePointsJson } from "./wire-geometry";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;
type PartRow = typeof schematicParts.$inferSelect;
type PinRow = typeof schematicPins.$inferSelect;
type WireRow = typeof schematicWires.$inferSelect;
type LabelRow = typeof schematicLabels.$inferSelect;

function parseSymbolSnapshotJson(
  payloadJson: string,
): LibraryComponentPlacementDetail["symbol"] {
  return parseJsonRecord(
    payloadJson,
  ) as unknown as LibraryComponentPlacementDetail["symbol"];
}

function parseFootprintSnapshotJson(
  payloadJson: string,
): LibraryComponentPlacementDetail["footprint"] {
  return parseJsonRecord(
    payloadJson,
  ) as unknown as LibraryComponentPlacementDetail["footprint"];
}

function mapPinRow(row: PinRow): DesignerPin {
  return {
    id: row.id,
    originPinKey: row.originPinKey,
    number: row.number,
    name: row.name,
    electricalType: row.electricalType,
    unit: row.unit,
    localPositionNm: { x: row.localXNm, y: row.localYNm },
    worldPositionNm: { x: row.worldXNm, y: row.worldYNm },
  };
}

function parsePropertiesJson(
  payloadJson: string,
): DesignerPlacedPart["propertiesJson"] {
  try {
    return JSON.parse(payloadJson) as DesignerPlacedPart["propertiesJson"];
  } catch {
    return {};
  }
}

function mapPartRow(row: PartRow, pins: DesignerPin[]): DesignerPlacedPart {
  return {
    id: row.id,
    componentId: row.componentId,
    reference: row.reference,
    value: row.value,
    rotationDeg: normalizeRotationDeg(row.rotationDeg),
    mirrored: row.mirrored === 1,
    positionNm: { x: row.positionXNm, y: row.positionYNm },
    symbol: parseSymbolSnapshotJson(row.symbolSnapshotJson),
    footprint: parseFootprintSnapshotJson(row.footprintSnapshotJson),
    pins,
    propertiesJson: parsePropertiesJson(row.propertiesJson),
  };
}

function mapWireRow(row: WireRow): DesignerWire {
  return {
    id: row.id,
    sourcePinId: row.sourcePinId,
    targetPinId: row.targetPinId,
    pointsNm: parseWirePointsJson(row.pointsJson),
  };
}

function mapLabelRow(row: LabelRow): DesignerLabel {
  return {
    id: row.id,
    text: row.text,
    positionNm: { x: row.xNm, y: row.yNm },
  };
}

export function mapDesignSummary(
  row: typeof designHeads.$inferSelect,
  drcRow?: typeof drcResults.$inferSelect | null,
): DesignerDesignSummary {
  return {
    id: row.id,
    name: row.name,
    revision: row.revision,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    drcStatus: drcRow
      ? {
          ranAtRevision: drcRow.ranAtRevision,
          ranAt: drcRow.ranAt,
          errors: drcRow.errorCount,
          warnings: drcRow.warningCount,
          infos: drcRow.infoCount,
          stale: drcRow.ranAtRevision !== row.revision,
        }
      : null,
  };
}

export function loadSchematicProjection(
  db: DbClient,
  designId: string,
): DesignerSchematicProjection | null {
  const head = db
    .select()
    .from(designHeads)
    .where(eq(designHeads.id, designId))
    .get();
  if (!head) return null;

  const partRows = db
    .select()
    .from(schematicParts)
    .where(eq(schematicParts.designId, designId))
    .orderBy(asc(schematicParts.createdAt))
    .all();
  const pinRows = db
    .select()
    .from(schematicPins)
    .where(eq(schematicPins.designId, designId))
    .orderBy(asc(schematicPins.createdAt))
    .all();
  const wireRows = db
    .select()
    .from(schematicWires)
    .where(eq(schematicWires.designId, designId))
    .orderBy(asc(schematicWires.createdAt))
    .all();
  const labelRows = db
    .select()
    .from(schematicLabels)
    .where(eq(schematicLabels.designId, designId))
    .orderBy(asc(schematicLabels.createdAt))
    .all();

  const pinsByPartId = new Map<string, DesignerPin[]>();
  for (const pinRow of pinRows) {
    const mapped = mapPinRow(pinRow);
    const target = pinsByPartId.get(pinRow.partId);
    if (target) target.push(mapped);
    else pinsByPartId.set(pinRow.partId, [mapped]);
  }

  const parts = partRows.map((row) =>
    mapPartRow(row, pinsByPartId.get(row.id) ?? []),
  );
  const wires = wireRows.map(mapWireRow);
  const labels = labelRows.map(mapLabelRow);
  const primitives = loadPrimitives(db, designId);
  const derived = deriveNetsAndJunctions(parts, wires, labels, primitives);
  return {
    designId,
    revision: head.revision,
    parts,
    wires,
    labels,
    primitives,
    nets: derived.nets,
    junctions: derived.junctions,
  };
}

/** Bump when the {@link DesignerSchematicPreview} shape changes so cached
 *  previews (keyed only on design revision) are recomputed. v2 added pin stubs,
 *  connection-point primitives, and dropped the per-design strokeWidth. */
export const PREVIEW_SCHEMA_VERSION = 2;

/** Compact schematic snapshot for Home-screen thumbnails. Loads parts, wires,
 *  and power/ground/portal primitives, stripping each symbol snapshot down to
 *  its render graphics/bounds + pin stubs so the payload stays small across the
 *  design grid (no footprints/labels/nets). */
export function loadSchematicPreview(
  db: DbClient,
  designId: string,
): DesignerSchematicPreview | null {
  const head = db
    .select()
    .from(designHeads)
    .where(eq(designHeads.id, designId))
    .get();
  if (!head) return null;

  const partRows = db
    .select()
    .from(schematicParts)
    .where(eq(schematicParts.designId, designId))
    .orderBy(asc(schematicParts.createdAt))
    .all();
  const wireRows = db
    .select()
    .from(schematicWires)
    .where(eq(schematicWires.designId, designId))
    .orderBy(asc(schematicWires.createdAt))
    .all();

  const parts = partRows.map((row) => {
    const symbol = parseSymbolSnapshotJson(row.symbolSnapshotJson);
    const pins = (symbol.preview.pins ?? []).map((pin) => ({
      anchor: { x: pin.anchor.x, y: pin.anchor.y },
      bodyEnd: { x: pin.bodyEnd.x, y: pin.bodyEnd.y },
    }));
    return {
      positionNm: { x: row.positionXNm, y: row.positionYNm },
      rotationDeg: normalizeRotationDeg(row.rotationDeg),
      mirrored: row.mirrored === 1,
      graphics: symbol.preview.graphics,
      bounds: symbol.preview.bounds,
      pins,
    };
  });
  const wires = wireRows.map((row) => ({
    pointsNm: parseWirePointsJson(row.pointsJson),
  }));
  const primitives = loadPrimitives(db, designId).map((primitive) => ({
    kind: primitive.kind,
    positionNm: { x: primitive.positionNm.x, y: primitive.positionNm.y },
    rotationDeg: primitive.rotationDeg,
  }));

  return {
    schemaVersion: PREVIEW_SCHEMA_VERSION,
    designId,
    revision: head.revision,
    parts,
    wires,
    primitives,
  };
}

export function toDesignRecordFromProjection(
  summary: DesignerDesignSummary,
  projection: DesignerSchematicProjection,
): DesignerDesignRecord {
  return {
    head: summary,
    entities: [
      ...projection.parts.map((part) => ({
        id: part.id,
        designId: summary.id,
        kind: "part" as const,
        payload: part as unknown as Record<string, unknown>,
        createdAt: summary.updatedAt,
        updatedAt: summary.updatedAt,
      })),
      ...projection.wires.map((wire) => ({
        id: wire.id,
        designId: summary.id,
        kind: "wire" as const,
        payload: wire as unknown as Record<string, unknown>,
        createdAt: summary.updatedAt,
        updatedAt: summary.updatedAt,
      })),
      ...projection.labels.map((label) => ({
        id: label.id,
        designId: summary.id,
        kind: "label" as const,
        payload: label as unknown as Record<string, unknown>,
        createdAt: summary.updatedAt,
        updatedAt: summary.updatedAt,
      })),
      ...projection.primitives.map((primitive) => ({
        id: primitive.id,
        designId: summary.id,
        kind: "primitive" as const,
        payload: primitive as unknown as Record<string, unknown>,
        createdAt: summary.updatedAt,
        updatedAt: summary.updatedAt,
      })),
    ],
  };
}
