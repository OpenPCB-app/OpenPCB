import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type { DesignerPcbProjection } from "../../../../sdks/designer";
import { loadSchematicProjection } from "../projection-read";
import { correlateNetPads } from "./net-pad-correlation";
import {
  ensurePcbBoardSettings,
  syncPcbPlacementsFromSchematic,
} from "./pcb-store";
import { computeRatsnest } from "./ratsnest";

type DbClient = BunSQLiteDatabase<Record<string, unknown>>;

export function loadPcbProjection(params: {
  db: DbClient;
  designId: string;
  revision: number;
  timestamp: string;
}): DesignerPcbProjection {
  const board = ensurePcbBoardSettings(
    params.db,
    params.designId,
    params.timestamp,
  );
  const schematic = loadSchematicProjection(params.db, params.designId);

  const placements = schematic
    ? syncPcbPlacementsFromSchematic({
        db: params.db,
        designId: params.designId,
        schematicParts: schematic.parts.map((part) => ({
          id: part.id,
          componentId: part.componentId,
          reference: part.reference,
          footprint: part.footprint,
        })),
        boardCenter: board.outline.centerMm,
        timestamp: params.timestamp,
      })
    : [];

  const correlation = schematic
    ? correlateNetPads(schematic, placements)
    : { netPads: new Map(), warnings: [] };
  const netNames = new Map<string, string>();
  if (schematic) {
    for (const net of schematic.nets) {
      netNames.set(net.id, net.name);
    }
  }
  const ratsnest = computeRatsnest(correlation, {
    netNames,
    netClasses: board.netClasses,
  });

  return {
    designId: params.designId,
    revision: params.revision,
    board,
    placements,
    ratsnest,
    warnings: correlation.warnings,
  };
}
