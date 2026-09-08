import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  DesignerPcbProjection,
  DesignerSchematicProjection,
} from "../../../../sdks/designer";
import {
  collectCopperZones,
  collectKeepouts,
  zonePourNets,
} from "../../../../shared/pcb-areas";
import { boardPourSpecs, buildBoardPourFills } from "./board-connectivity";
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
  loadPcbKeepouts,
  loadPcbZones,
  migrateLegacyBoardFill,
  syncPcbPlacementsFromSchematic,
} from "./pcb-store";
import { computeRatsnest } from "./ratsnest";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;

/**
 * netId → net name for the design's schematic. The zone/keepout migration and
 * every net-name binding read the same map, so a board zone's persisted net
 * name is the one the schematic actually has.
 */
export function netNamesFromSchematic(
  schematic: DesignerSchematicProjection | null,
): Map<string, string> {
  const netNames = new Map<string, string>();
  if (!schematic) return netNames;
  for (const net of schematic.nets) {
    netNames.set(net.id, net.name);
  }
  return netNames;
}

export function loadPcbProjection(params: {
  db: DbClient;
  designId: string;
  revision: number;
  timestamp: string;
}): DesignerPcbProjection {
  const schematic = loadSchematicProjection(params.db, params.designId);
  const netNames = netNamesFromSchematic(schematic);
  // Lazy one-time upgrade of the legacy per-layer fill toggle into persisted
  // board zone rows (contract §12.1) — BEFORE the zones are loaded below, and
  // before `ensurePcbBoardSettings`, which resets an unparsable settings
  // payload to defaults and would take the unread legacy keys with it.
  migrateLegacyBoardFill(
    params.db,
    params.designId,
    netNames,
    params.timestamp,
  );
  const board = ensurePcbBoardSettings(
    params.db,
    params.designId,
    params.timestamp,
  );

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
  const rawTraces = loadPcbTraces(params.db, params.designId);
  const rawVias = loadPcbVias(params.db, params.designId);

  // Bind importer-supplied netName hints (KiCad project import) to schematic
  // net ids. Built once per projection; native traces / vias with no netName
  // hint are unaffected. When a hint exists but no schematic net matches,
  // leave netId null — pad-alignment heuristics elsewhere remain the fallback.
  // Case-insensitive, matching the schematic's case-insensitive named-net union
  // (so a "VCC" trace hint binds to a "vcc"-named net). First writer wins on a
  // case collision (rare; the union already collapses same-name nets).
  const netIdByName = new Map<string, string>();
  if (schematic) {
    for (const net of schematic.nets) {
      if (!net.name) continue;
      const key = net.name.trim().toUpperCase();
      if (!netIdByName.has(key)) netIdByName.set(key, net.id);
    }
  }
  const bindNetName = <
    T extends { netId: string | null; netName?: string | null },
  >(
    entity: T,
  ): T => {
    if (entity.netId || !entity.netName) return entity;
    const resolved = netIdByName.get(entity.netName.trim().toUpperCase());
    if (!resolved) return entity;
    return { ...entity, netId: resolved };
  };
  const traces = rawTraces.map(bindNetName);
  const vias = rawVias.map(bindNetName);
  const freeHoles = loadPcbFreeHoles(params.db, params.designId);
  const freePads = loadPcbFreePads(params.db, params.designId);
  const overlayTexts = loadPcbOverlayTexts(params.db, params.designId);
  const overlayShapes = loadPcbOverlayShapes(params.db, params.designId);
  // Bind zone netName → netId so imported/drawn copper zones participate in the
  // pour fill, connectivity and export (zones carry `netName` like traces but
  // were previously inert). `netId` starts unset, so `bindNetName` resolves it.
  // A name that matches more than one schematic net (case-insensitively) is
  // ambiguous: first-match would make the zone's net depend on net order
  // (contract §3.2), so the zone stays unbound and warns.
  const nameCounts = new Map<string, number>();
  for (const name of netNames.values()) {
    const key = name.trim().toUpperCase();
    nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
  }
  const zoneBindingWarnings: string[] = [];
  const ambiguousZoneIds = new Set<string>();
  const zoneRecords = loadPcbZones(params.db, params.designId);
  const zones = zoneRecords.zones.map((zone) => {
    const key = zone.netName?.trim().toUpperCase() ?? "";
    if (!zone.netId && key && (nameCounts.get(key) ?? 0) > 1) {
      ambiguousZoneIds.add(zone.id);
      zoneBindingWarnings.push(
        `zone_net_ambiguous: Zone ${zone.id} net "${zone.netName}" matches more than one schematic net.`,
      );
      return zone;
    }
    return bindNetName(zone);
  });
  const keepouts = loadPcbKeepouts(params.db, params.designId);

  // Flatten the schematic↔PCB pad correlation into a `${placementId}|${padNumber}`
  // → netId map so a pure consumer (DRC, copper pour) can resolve a footprint
  // pad's net without re-running correlation or touching the schematic.
  const padNets: Record<string, string> = {};
  for (const [netId, pads] of correlation.netPads) {
    for (const pad of pads) {
      padNets[`${pad.placementId}|${pad.padNumber}`] = netId;
    }
  }

  // The ONE derivation of "which copper areas exist" (zone/keepout contract
  // §3.1): explicit zones first, then the persisted board zone rows. Every
  // other consumer (connectivity, DRC, snapshot, Gerber, canvas) reads the same
  // list instead of re-assembling its own.
  const keepoutAreas = collectKeepouts({
    keepouts,
    layerCount: board.layerCount,
  });
  const copperAreas = collectCopperZones({
    zones,
    layerCount: board.layerCount,
    knownNetIds: new Set(netNames.keys()),
  });
  const copper = {
    layerCount: board.layerCount,
    placements,
    padNetIds: new Map(Object.entries(padNets)),
    freePads,
    traces,
    vias,
  };
  // ONE kernel run per net-bound zone (contract §9) — the ratsnest reasons
  // about the very islands the fill produced, never a second fill of its own.
  const pours = buildBoardPourFills(copper, {
    outline: board.outline,
    designRules: board.designRules,
    cutouts: board.cutouts ?? [],
    freeHoles,
    pours: boardPourSpecs(
      copperAreas.zones,
      board.designRules,
      keepoutAreas.keepouts,
      zonePourNets(board, Object.fromEntries(netNames)),
    ),
  });

  const ratsnest = computeRatsnest({
    ...copper,
    netNames,
    netClasses: board.netClasses,
    perNetClassAssignments: board.perNetClassAssignments,
    pours,
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
    keepouts,
    ratsnest,
    netNames: Object.fromEntries(netNames),
    padNets,
    warnings: [
      ...correlation.warnings,
      // Zone / keepout derivation warnings (a zone off the stackup, an invalid
      // ring, an unresolved net, a netless board fill) surface next to the
      // correlation ones rather than being swallowed by the derivation.
      ...zoneBindingWarnings,
      // Read-time upgrade warnings (a v1 netless zone disabled, a hatched fill
      // read as solid) are design data the user can act on, so they surface
      // here instead of dying inside `loadPcbZones`.
      ...zoneRecords.warnings.map(
        (warning) => `${warning.code}: ${warning.detail}`,
      ),
      ...[...copperAreas.warnings, ...keepoutAreas.warnings]
        // A zone already reported ambiguous would otherwise be reported twice:
        // the binding pass leaves `netId` null, which the derivation then calls
        // unresolved.
        .filter(
          (warning) =>
            !(
              warning.code === "zone_net_unresolved" &&
              warning.id !== null &&
              ambiguousZoneIds.has(warning.id)
            ),
        )
        .map((warning) => `${warning.code}: ${warning.detail}`),
    ],
  };
}
