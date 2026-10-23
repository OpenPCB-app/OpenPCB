import { createHash } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { parsePcbLayerCount } from "../../../../sdks/designer/stackup";
import type { PcbPlacedPart, PcbTrace, PcbVia, PcbFreePad, PcbFreeHole, PcbZone, PcbKeepout } from "../../../../sdks/designer";
import type { ZoneRecordWarning } from "../../../../shared/pcb-areas/zone-parse";
import { pcbEntities } from "../schema";
import { asRecord } from "../value-guards";
import {
  readPcbBoardSettingsForMigration, readPcbEntityForMigration,
  type MigrationBoardSettingsRead, type MigrationPcbEntityRead,
} from "../pcb/pcb-store";
import {
  KNOWN_TOP_LEVEL, KNOWN_DESIGN_RULES, KNOWN_VIEW_STATE,
  KNOWN_AUTO_LAYOUT, KNOWN_AUTO_LAYOUT_PLACE, KNOWN_AUTO_LAYOUT_ROUTE,
  DESIGN_RULE_BLOCKS, ROW_ARRAYS,
} from "../pcb/board-settings-known-keys";
import { BOARD_SETTINGS_SCHEMA_VERSION } from "../pcb/board-settings-serialize";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;
export type MigrationPcbEntityRow = typeof pcbEntities.$inferSelect;

export interface MigrationGeometry {
  placements: PcbPlacedPart[];
  traces: PcbTrace[];
  vias: PcbVia[];
  freePads: PcbFreePad[];
  freeHoles: PcbFreeHole[];
  zones: PcbZone[];
  keepouts: PcbKeepout[];
}

export interface MigrationSourceDiagnostic {
  kind: "parse_loss" | "normalization" | "board_loss" | "duplicate_identity";
  rowId: string | null;
  entityKind: string;
  path: string;
  message: string;
}

export interface NetIdentityMigrationSource extends MigrationGeometry {
  board: MigrationBoardSettingsRead;
  rawRows: MigrationPcbEntityRow[];
  zoneWarnings: ZoneRecordWarning[];
  diagnostics: MigrationSourceDiagnostic[];
  parseLosses: MigrationSourceDiagnostic[];
  geometryAmbiguities: MigrationSourceDiagnostic[];
  /** Canonical reader outputs with no declared-field normalization or identity ambiguity. */
  evidence: MigrationGeometry;
  trustedStackup: boolean;
  allowPourEvidence: boolean;
}

const ENTITY_FIELDS: Record<MigrationPcbEntityRead["kind"], readonly string[]> = {
  placement: ["id", "partId", "componentId", "reference", "positionMm", "rotationDeg", "mirrored", "layer", "footprint"],
  trace: ["id", "netId", "netName", "netClassId", "layer", "widthMm", "pointsNm", "segmentMode"],
  via: ["id", "netId", "netName", "netClassId", "centerMm", "diameterMm", "drillMm", "fromLayer", "toLayer", "viaType", "protection", "provenance"],
  free_pad: ["id", "centerMm", "rotationDeg", "padType", "shape", "widthMm", "heightMm", "roundrectRatio", "drillMm", "drillSlot", "layer", "netId", "solderMaskExpansionMm", "solderPasteExpansionMm", "lockedAt"],
  free_hole: ["id", "centerMm", "drillMm", "drillSlot", "lockedAt"],
  zone: ["id", "name", "enabled", "lockedAt", "layer", "netId", "netName", "region", "polygonPointsMm", "connection", "fillType", "priority", "padConnection", "clearanceMm", "minWidthMm", "thermal", "islandRemoval"],
  keepout: ["id", "name", "enabled", "lockedAt", "layers", "pointsMm", "restrictions"],
};

const BOARD_KEYS = new Map<string, ReadonlySet<string>>([
  ["board_settings", new Set([...KNOWN_TOP_LEVEL].filter((key) => key !== "schemaVersion"))],
  ["board_settings.designRules", KNOWN_DESIGN_RULES],
  ["board_settings.viewState", KNOWN_VIEW_STATE],
  ["board_settings.viewState.autoLayoutConfig", KNOWN_AUTO_LAYOUT],
  ["board_settings.viewState.autoLayoutConfig.place", KNOWN_AUTO_LAYOUT_PLACE],
  ["board_settings.viewState.autoLayoutConfig.route", KNOWN_AUTO_LAYOUT_ROUTE],
  ...DESIGN_RULE_BLOCKS.map(([key, fields]) => [`board_settings.designRules.${key}`, fields] as const),
  ...ROW_ARRAYS.map(([key, fields]) => [`board_settings.${key}[]`, fields] as const),
]);

function compareText(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

export function legacyFillRowId(designId: string, zoneId: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(["net-identity-legacy-fill", designId, zoneId])).digest("hex");
  return `net_identity_zone:${digest}`;
}

function emptyGeometry(): MigrationGeometry {
  return { placements: [], traces: [], vias: [], freePads: [], freeHoles: [], zones: [], keepouts: [] };
}

function knownKeys(path: string, raw: Record<string, unknown>, parsed: Record<string, unknown>): ReadonlySet<string> {
  const board = BOARD_KEYS.get(path.replace(/\[\d+\]/g, "[]"));
  if (board) return board;
  const entity = ENTITY_FIELDS[path as MigrationPcbEntityRead["kind"]];
  if (entity) return new Set(entity);
  if (["zone.region", "keepout.restrictions"].includes(path)) {
    return new Set(path === "zone.region" ? ["kind", "pointsMm", "holesMm"] : ["tracks", "vias", "pads", "copperPour", "footprints"]);
  }
  if (["board_settings.perNetClassAssignments", "board_settings.drcSeverityOverrides", "board_settings.viewState.perLayerOpacity"].includes(path)) {
    return new Set([...Object.keys(raw), ...Object.keys(parsed)]);
  }
  return new Set(Object.keys(parsed));
}

/** Compare declared known fields to the canonical reader; unknown extensions are retained raw. */
function normalizationPaths(raw: unknown, parsed: unknown, path: string): string[] {
  if (Object.is(raw, parsed)) return [];
  if (Array.isArray(raw)) {
    if (!Array.isArray(parsed) || raw.length !== parsed.length) return [path];
    return raw.flatMap((value, index) => normalizationPaths(value, parsed[index], `${path}[${index}]`));
  }
  const before = asRecord(raw), after = asRecord(parsed);
  if (before && after) {
    const known = knownKeys(path, before, after);
    return Object.keys(before).sort(compareText).flatMap((key) =>
      known.has(key) ? normalizationPaths(before[key], after[key], `${path}.${key}`) : [],
    );
  }
  return [path];
}

function parsedPayload(row: MigrationPcbEntityRow): unknown {
  try { return JSON.parse(row.payloadJson) as unknown; } catch { return undefined; }
}

function invalidIdentityPaths(raw: unknown, kind: MigrationPcbEntityRead["kind"]): string[] {
  if (!["trace", "via", "free_pad", "zone"].includes(kind)) return [];
  const record = asRecord(raw);
  return ["netId", "netName"].flatMap((field) => {
    const value = record?.[field];
    return value !== undefined && value !== null && typeof value !== "string" ? [`${kind}.${field}`] : [];
  });
}

function pushEntity(target: MigrationGeometry, parsed: MigrationPcbEntityRead): void {
  switch (parsed.kind) {
    case "placement": if (parsed.entity) target.placements.push(parsed.entity); break;
    case "trace": if (parsed.entity) target.traces.push(parsed.entity); break;
    case "via": if (parsed.entity) target.vias.push(parsed.entity); break;
    case "free_pad": if (parsed.entity) target.freePads.push(parsed.entity); break;
    case "free_hole": if (parsed.entity) target.freeHoles.push(parsed.entity); break;
    case "zone": if (parsed.entity) target.zones.push(parsed.entity); break;
    case "keepout": if (parsed.entity) target.keepouts.push(parsed.entity); break;
  }
}

interface RowRead {
  row: MigrationPcbEntityRow;
  raw: unknown;
  parsed: MigrationPcbEntityRead;
}

function readGeometry(rows: MigrationPcbEntityRow[], diagnostics: MigrationSourceDiagnostic[]): {
  geometry: MigrationGeometry; reads: RowRead[]; zoneWarnings: ZoneRecordWarning[];
} {
  const geometry = emptyGeometry(), reads: RowRead[] = [], zoneWarnings: ZoneRecordWarning[] = [];
  for (const row of rows) {
    const parsed = readPcbEntityForMigration(row.kind, row.payloadJson);
    if (!parsed) {
      if (!["board_settings", "overlay_text", "overlay_shape"].includes(row.kind)) diagnostics.push({
        kind: "normalization", rowId: row.id, entityKind: row.kind, path: "kind",
        message: "Unknown PCB entity kind cannot contribute to migration evidence.",
      });
      continue;
    }
    const raw = parsedPayload(row);
    reads.push({ row, raw, parsed });
    zoneWarnings.push(...parsed.warnings);
    if (!parsed.entity) {
      diagnostics.push({ kind: "parse_loss", rowId: row.id, entityKind: row.kind, path: "payloadJson", message: "Persisted physical geometry was rejected by its canonical reader." });
      continue;
    }
    pushEntity(geometry, parsed);
    const normalized = new Set([...normalizationPaths(raw, parsed.entity, row.kind), ...invalidIdentityPaths(raw, parsed.kind)]);
    for (const path of normalized) diagnostics.push({
      kind: "normalization", rowId: row.id, entityKind: row.kind, path,
      message: "Declared geometry or metadata was normalized by its canonical reader; excluded from positive evidence.",
    });
  }
  return { geometry, reads, zoneWarnings };
}

function duplicateIdentities(reads: RowRead[]): MigrationSourceDiagnostic[] {
  const claims = new Map<string, MigrationPcbEntityRow[]>();
  for (const { row, raw } of reads) {
    const value = asRecord(raw);
    for (const field of row.kind === "placement" ? ["id", "partId"] : ["id"]) {
      const id = value?.[field];
      if (typeof id !== "string") continue;
      const key = JSON.stringify([field, id]), owners = claims.get(key) ?? [];
      owners.push(row); claims.set(key, owners);
    }
  }
  return [...claims].sort(([a], [b]) => compareText(a, b)).flatMap(([key, owners]) => owners.length < 2 ? [] : owners.map((row) => ({
    kind: "duplicate_identity" as const, rowId: row.id, entityKind: row.kind, path: key,
    message: "Multiple physical rows claim this payload identity; every claimant is excluded from positive evidence.",
  })));
}

function boardDiagnostics(board: MigrationBoardSettingsRead): MigrationSourceDiagnostic[] {
  const diagnostics: MigrationSourceDiagnostic[] = board.diagnostics.map((entry) => ({
    kind: "board_loss", rowId: board.rowId, entityKind: "board_settings", path: entry.path, message: entry.message,
  }));
  if (board.status === "absent") diagnostics.push({
    kind: "board_loss", rowId: null, entityKind: "board_settings", path: "board_settings", message: "No persisted board settings are available for pour evidence.",
  });
  for (const path of board.status === "parsed" ? normalizationPaths(board.storedRaw, board.settings, "board_settings") : []) diagnostics.push({
    kind: "normalization", rowId: board.rowId, entityKind: "board_settings", path, message: "Declared board metadata was normalized by its canonical reader.",
  });
  const version = asRecord(board.storedRaw)?.schemaVersion;
  if (version !== undefined && version !== BOARD_SETTINGS_SCHEMA_VERSION) diagnostics.push({
    kind: "board_loss", rowId: board.rowId, entityKind: "board_settings", path: "schemaVersion", message: "Stored board schema version is not supported for migration evidence.",
  });
  return diagnostics;
}

function hasTrustedStackup(board: MigrationBoardSettingsRead, boardCount: number): boolean {
  if (boardCount !== 1) return false;
  const raw = asRecord(board.storedRaw), layerCount = raw?.layerCount;
  if (layerCount === undefined) return board.status === "parsed";
  return typeof layerCount === "number" && parsePcbLayerCount(layerCount) === layerCount;
}

/** Unsynced persisted inputs only: never ensure, repair, derive pads, or migrate while reading. */
export function readNetIdentityMigrationSource(
  db: DbClient, designId: string, timestamp: string,
): NetIdentityMigrationSource {
  const rawRows = db.select().from(pcbEntities).where(eq(pcbEntities.designId, designId)).orderBy(asc(pcbEntities.id)).all();
  const board = readPcbBoardSettingsForMigration(db, designId, timestamp);
  const diagnostics = boardDiagnostics(board);
  const { geometry, reads, zoneWarnings } = readGeometry(rawRows, diagnostics);
  const geometryAmbiguities = duplicateIdentities(reads);
  diagnostics.push(...geometryAmbiguities);
  const boardRows = rawRows.filter((row) => row.kind === "board_settings");
  if (boardRows.length > 1) diagnostics.push({
    kind: "board_loss", rowId: null, entityKind: "board_settings", path: "board_settings", message: "Multiple persisted board settings rows make board geometry ambiguous.",
  });
  const trustedStackup = hasTrustedStackup(board, boardRows.length);
  const excluded = new Set(diagnostics.filter((entry) => entry.kind !== "board_loss").map((entry) => entry.rowId));
  const evidence = emptyGeometry();
  if (trustedStackup) for (const { row, parsed } of reads) {
    if (!excluded.has(row.id)) pushEntity(evidence, parsed);
  }
  diagnostics.sort((a, b) => compareText(JSON.stringify([a.kind, a.rowId, a.path]), JSON.stringify([b.kind, b.rowId, b.path])));
  return {
    ...geometry, board, rawRows, zoneWarnings, diagnostics, geometryAmbiguities, evidence, trustedStackup,
    parseLosses: diagnostics.filter((entry) => entry.kind === "parse_loss"),
    allowPourEvidence: board.status === "parsed" && trustedStackup && diagnostics.length === 0 && zoneWarnings.length === 0,
  };
}
