import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  DesignerPcbProjection,
  DesignerNetIdentitySummary,
  DesignerSchematicProjection,
  PcbBoardSettings,
  PcbFreeHole,
  PcbFreePad,
  PcbKeepout,
  PcbPlacedPart,
  PcbTrace,
  PcbVia,
  PcbZone,
} from "../../../../sdks/designer";
import type { LegalityInput } from "../../../../shared/drc/drc-context";
import {
  collectCopperZones,
  collectKeepouts,
  zonePourNets,
} from "../../../../shared/pcb-areas";
import { boardPourSpecs, buildBoardPourFills } from "./board-connectivity";
import { loadSchematicProjection } from "../projection-read";
import { collectUnresolvedFootprints } from "../../../../shared/pcb-geometry/unresolved-footprints";
import { correlateNetPads } from "./net-pad-correlation";
import { bindLegacyNetNames } from "../net-identity/legacy-mode";
import type { NetIdentityMode } from "../net-identity/types";
import { buildNetIdentitySummary } from "../net-identity/summary";
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
  readStoredPcbRuleDiagnostics,
  syncPcbPlacementsFromSchematic,
} from "./pcb-store";
import { computeRatsnest } from "./ratsnest";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;

function assertIdentityMode(mode: NetIdentityMode): void {
  if (mode !== "legacy" && mode !== "durable") {
    throw new Error("PCB identity mode must be legacy or durable");
  }
}

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

/** The persisted rows of one PCB revision, plus the schematic they bind to. */
export interface PcbLegalityRows {
  schematic: DesignerSchematicProjection | null;
  board: PcbBoardSettings;
  placements: PcbPlacedPart[];
  traces: PcbTrace[];
  vias: PcbVia[];
  freeHoles: PcbFreeHole[];
  freePads: PcbFreePad[];
  zones: PcbZone[];
  keepouts: PcbKeepout[];
}

/**
 * A `LegalityInput` plus the two derivation by-products only the projection
 * needs: the binding warnings, and the zones the ambiguity rule left unbound
 * (so the projection does not report them a second time as "unresolved").
 * `LegalityInput` is what every consumer other than `loadPcbProjection` reads.
 */
export interface PcbLegalityAssembly extends LegalityInput {
  /** Always derived here, where the projection's field is optional. */
  padNets: Record<string, string>;
  warnings: string[];
  ambiguousZoneIds: Set<string>;
}

/**
 * The ONE derivation of "what the DRC/legality core sees on this board": net
 * names from the schematic, legacy-only importer hint binding, and the
 * schematic↔PCB pad correlation flattened into `padNets`. PURE — it reads rows
 * and writes nothing, which is what lets the copper commit gate (live-parity
 * contract 07 §6) build a context from the rows the dispatcher already holds
 * instead of from `loadPcbProjection`, whose placement sync would leak writes
 * into the command's undo patch.
 */
export function assemblePcbLegalityInput(
  rows: PcbLegalityRows,
  identityMode: NetIdentityMode,
): PcbLegalityAssembly {
  assertIdentityMode(identityMode);
  const { schematic, board } = rows;
  const netNames = netNamesFromSchematic(schematic);
  const correlation = schematic
    ? correlateNetPads(schematic, rows.placements)
    : { netPads: new Map(), warnings: [] };

  const binding = identityMode === "legacy"
    ? bindLegacyNetNames(schematic, rows)
    : { traces: rows.traces, vias: rows.vias, zones: rows.zones, warnings: [], ambiguousZoneIds: new Set<string>() };

  // Flatten the schematic↔PCB pad correlation into a `${placementId}|${padNumber}`
  // → netId map so a pure consumer (DRC, copper pour) can resolve a footprint
  // pad's net without re-running correlation or touching the schematic.
  const padNets: Record<string, string> = {};
  for (const [netId, pads] of correlation.netPads) {
    for (const pad of pads) {
      padNets[`${pad.placementId}|${pad.padNumber}`] = netId;
    }
  }

  return {
    board,
    placements: rows.placements,
    traces: binding.traces,
    vias: binding.vias,
    freeHoles: rows.freeHoles,
    freePads: rows.freePads,
    zones: binding.zones,
    keepouts: rows.keepouts,
    padNets,
    netNames: Object.fromEntries(netNames),
    warnings: [...correlation.warnings, ...binding.warnings],
    ambiguousZoneIds: binding.ambiguousZoneIds,
  };
}

export function loadPcbProjection(params: {
  db: DbClient;
  designId: string;
  revision: number;
  timestamp: string;
  identityMode: NetIdentityMode;
}): DesignerPcbProjection {
  assertIdentityMode(params.identityMode);
  const ruleReadDiagnostics = readStoredPcbRuleDiagnostics(
    params.db,
    params.designId,
  );
  const schematic = loadSchematicProjection(params.db, params.designId);
  const netNames = netNamesFromSchematic(schematic);
  // Lazy one-time upgrade of the legacy per-layer fill toggle into persisted
  // board zone rows (contract §12.1) — BEFORE the zones are loaded below, and
  // before `ensurePcbBoardSettings` derives its in-memory legacy read view.
  migrateLegacyBoardFill(
    params.db,
    params.designId,
    netNames,
    params.timestamp,
    { mode: params.identityMode === "durable" ? "bound" : "name-hint" },
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
        outline: board.outline,
        defaultLayer: "F.Cu",
        timestamp: params.timestamp,
      })
    : [];

  const overlayTexts = loadPcbOverlayTexts(params.db, params.designId);
  const overlayShapes = loadPcbOverlayShapes(params.db, params.designId);
  const zoneRecords = loadPcbZones(params.db, params.designId);
  const rows: PcbLegalityRows = {
    schematic, board, placements,
    traces: loadPcbTraces(params.db, params.designId),
    vias: loadPcbVias(params.db, params.designId),
    freeHoles: loadPcbFreeHoles(params.db, params.designId),
    freePads: loadPcbFreePads(params.db, params.designId),
    zones: zoneRecords.zones,
    keepouts: loadPcbKeepouts(params.db, params.designId),
  };
  const netIdentity: DesignerNetIdentitySummary = schematic
    ? buildNetIdentitySummary(params.db, params.designId, schematic, rows)
    : { status: "unmigrated", mode: "legacy", origin: null, lastError: "Schematic projection unavailable.",
      historiesArchived: null, groups: [], orphanedCopperCount: 0, inertRuleReferenceCount: 0, exportBlocked: true };

  // Net binding + pad correlation live in the pure assembler, so the commit
  // gate's row-built context sees the same board this projection describes.
  const { warnings: bindingWarnings, ambiguousZoneIds, ...legalityInput } =
    assemblePcbLegalityInput(rows, params.identityMode);
  const { traces, vias, freeHoles, freePads, zones, keepouts, padNets } =
    legalityInput;

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
    netIdentity,
    ...(ruleReadDiagnostics.length > 0 ? { ruleReadDiagnostics } : {}),
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
    unresolvedFootprints: collectUnresolvedFootprints(placements),
    warnings: [
      // Pad-correlation warnings, then the zone / keepout derivation ones (a
      // zone off the stackup, an invalid ring, an unresolved net, a netless
      // board fill) — surfaced rather than swallowed by the derivation.
      ...bindingWarnings,
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
