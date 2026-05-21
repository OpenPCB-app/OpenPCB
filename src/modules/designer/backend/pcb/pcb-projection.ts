import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { DesignerPcbProjection } from "../../../../sdks/designer";
import { loadSchematicProjection } from "../projection-read";
import { correlateNetPads } from "./net-pad-correlation";
import {
  ensurePcbBoardSettings,
  loadPcbFreeHoles,
  loadPcbFreePads,
  loadPcbOverlayShapes,
  loadPcbOverlayTexts,
  loadPcbTraces,
  loadPcbVias,
  loadPcbZones,
  syncPcbPlacementsFromSchematic,
} from "./pcb-store";
import { computeRatsnest } from "./ratsnest";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;

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

  // Schematic primitives (GND/PWR/NET_PORTAL) are deliberately excluded from
  // PCB placements — they are not parts, have no footprint, and exist only on
  // the schematic. The mapper below iterates `schematic.parts` only, so this
  // is a structural guarantee rather than an explicit filter.
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
        defaultLayer: "F.Cu",
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
  const rawTraces = loadPcbTraces(params.db, params.designId);
  const rawVias = loadPcbVias(params.db, params.designId);

  // Bind importer-supplied netName hints (KiCad project import) to schematic
  // net ids. Built once per projection; native traces / vias with no netName
  // hint are unaffected. When a hint exists but no schematic net matches,
  // leave netId null — pad-alignment heuristics elsewhere remain the fallback.
  const netIdByName = new Map<string, string>();
  if (schematic) {
    for (const net of schematic.nets) {
      if (net.name) netIdByName.set(net.name, net.id);
    }
  }
  const bindNetName = <
    T extends { netId: string | null; netName?: string | null },
  >(
    entity: T,
  ): T => {
    if (entity.netId || !entity.netName) return entity;
    const resolved = netIdByName.get(entity.netName);
    if (!resolved) return entity;
    return { ...entity, netId: resolved };
  };
  const traces = rawTraces.map(bindNetName);
  const vias = rawVias.map(bindNetName);
  const freeHoles = loadPcbFreeHoles(params.db, params.designId);
  const freePads = loadPcbFreePads(params.db, params.designId);
  const overlayTexts = loadPcbOverlayTexts(params.db, params.designId);
  const overlayShapes = loadPcbOverlayShapes(params.db, params.designId);
  const zones = loadPcbZones(params.db, params.designId);

  const ratsnest = computeRatsnest(correlation, {
    netNames,
    netClasses: board.netClasses,
    traces,
    vias,
  });

  return {
    designId: params.designId,
    revision: params.revision,
    board,
    placements,
    traces,
    vias,
    freeHoles,
    freePads,
    overlayTexts,
    overlayShapes,
    zones,
    ratsnest,
    netNames: Object.fromEntries(netNames),
    warnings: correlation.warnings,
  };
}
