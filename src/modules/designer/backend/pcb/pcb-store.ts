import { and, eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type {
  PcbBoardSettings,
  PcbCopperLayerId,
  PcbLayerId,
  PcbPlacedPart,
  PcbPointMm,
  PcbTrace,
  PcbTraceSegmentMode,
  PcbVia,
} from "../../../../sdks/designer";
import { pcbEntities } from "../schema";
import { asNumber, asRecord, asString } from "../value-guards";
import { createDefaultPcbBoardSettings } from "./pcb-defaults";

type DbClient = BunSQLiteDatabase<Record<string, unknown>>;

const BOARD_SETTINGS_KIND = "board_settings";
const PLACEMENT_KIND = "placement";
const TRACE_KIND = "trace";
const VIA_KIND = "via";

function isCopperLayer(value: string | null): value is PcbCopperLayerId {
  return value === "F.Cu" || value === "B.Cu";
}

function isSegmentMode(value: string | null): value is PcbTraceSegmentMode {
  return value === "manhattan-90" || value === "manhattan-45";
}

function isPcbLayerId(
  value: string | null,
): value is PcbBoardSettings["activeLayer"] {
  return (
    value === "F.Cu" ||
    value === "B.Cu" ||
    value === "F.SilkS" ||
    value === "B.SilkS" ||
    value === "Edge.Cuts"
  );
}

function parseVisibleLayers(value: unknown): PcbBoardSettings["visibleLayers"] {
  const layers = (Array.isArray(value) ? value : [])
    ?.map((item) => asString(item))
    .filter(
      (item): item is PcbBoardSettings["visibleLayers"][number] =>
        item === "F.Cu" ||
        item === "B.Cu" ||
        item === "F.SilkS" ||
        item === "B.SilkS" ||
        item === "Edge.Cuts",
    );
  return layers && layers.length > 0
    ? layers
    : ["F.Cu", "B.Cu", "F.SilkS", "B.SilkS", "Edge.Cuts"];
}

function parsePayload(payloadJson: string): unknown {
  try {
    return JSON.parse(payloadJson) as unknown;
  } catch {
    return null;
  }
}

function parseBoardSettings(value: unknown): PcbBoardSettings | null {
  const record = asRecord(value);
  const outline = asRecord(record?.outline);
  const center = asRecord(outline?.centerMm);
  const widthMm = asNumber(outline?.widthMm);
  const heightMm = asNumber(outline?.heightMm);
  const centerX = asNumber(center?.x);
  const centerY = asNumber(center?.y);
  const updatedAt = asString(record?.updatedAt);
  const activeLayer = asString(record?.activeLayer);

  if (
    !record ||
    outline?.kind !== "rect" ||
    widthMm === null ||
    heightMm === null ||
    widthMm <= 0 ||
    heightMm <= 0 ||
    centerX === null ||
    centerY === null ||
    !updatedAt ||
    !isPcbLayerId(activeLayer)
  ) {
    return null;
  }

  const defaults = createDefaultPcbBoardSettings(updatedAt);
  // Trace presets: parse if present, fallback to defaults so older saved
  // boards (pre-tracePresets) keep working without migration.
  const tracePresetsRaw = Array.isArray(record.tracePresets)
    ? record.tracePresets
    : null;
  const tracePresets =
    tracePresetsRaw === null
      ? defaults.tracePresets
      : tracePresetsRaw
          .map((value) => asNumber(value))
          .filter((value): value is number => value !== null && value > 0);
  return {
    ...defaults,
    outline: {
      kind: "rect",
      widthMm,
      heightMm,
      centerMm: { x: centerX, y: centerY },
    },
    activeLayer,
    visibleLayers: parseVisibleLayers(record.visibleLayers),
    tracePresets:
      tracePresets.length > 0 ? tracePresets : defaults.tracePresets,
    updatedAt,
  };
}

export function ensurePcbBoardSettings(
  db: DbClient,
  designId: string,
  timestamp: string,
): PcbBoardSettings {
  const row = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, BOARD_SETTINGS_KIND),
      ),
    )
    .get();

  if (row) {
    const parsed = parseBoardSettings(parsePayload(row.payloadJson));
    if (parsed) return parsed;
  }

  const settings = createDefaultPcbBoardSettings(timestamp);
  if (row) {
    db.update(pcbEntities)
      .set({ payloadJson: JSON.stringify(settings), updatedAt: timestamp })
      .where(eq(pcbEntities.id, row.id))
      .run();
    return settings;
  }

  db.insert(pcbEntities)
    .values({
      id: crypto.randomUUID(),
      designId,
      kind: BOARD_SETTINGS_KIND,
      payloadJson: JSON.stringify(settings),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  return settings;
}

export function updatePcbBoardSize(params: {
  db: DbClient;
  designId: string;
  widthMm: number;
  heightMm: number;
  timestamp: string;
}): PcbBoardSettings {
  const settings = ensurePcbBoardSettings(
    params.db,
    params.designId,
    params.timestamp,
  );
  const next: PcbBoardSettings = {
    ...settings,
    outline: {
      ...settings.outline,
      widthMm: params.widthMm,
      heightMm: params.heightMm,
    },
    updatedAt: params.timestamp,
  };

  params.db
    .update(pcbEntities)
    .set({ payloadJson: JSON.stringify(next), updatedAt: params.timestamp })
    .where(
      and(
        eq(pcbEntities.designId, params.designId),
        eq(pcbEntities.kind, BOARD_SETTINGS_KIND),
      ),
    )
    .run();
  return next;
}

export function updatePcbActiveLayer(params: {
  db: DbClient;
  designId: string;
  layer: PcbLayerId;
  timestamp: string;
}): PcbBoardSettings {
  const settings = ensurePcbBoardSettings(
    params.db,
    params.designId,
    params.timestamp,
  );
  const next: PcbBoardSettings = {
    ...settings,
    activeLayer: params.layer,
    visibleLayers: settings.visibleLayers.includes(params.layer)
      ? settings.visibleLayers
      : [...settings.visibleLayers, params.layer],
    updatedAt: params.timestamp,
  };
  params.db
    .update(pcbEntities)
    .set({ payloadJson: JSON.stringify(next), updatedAt: params.timestamp })
    .where(
      and(
        eq(pcbEntities.designId, params.designId),
        eq(pcbEntities.kind, BOARD_SETTINGS_KIND),
      ),
    )
    .run();
  return next;
}

export function updatePcbVisibleLayers(params: {
  db: DbClient;
  designId: string;
  visibleLayers: ReadonlyArray<PcbLayerId>;
  timestamp: string;
}): PcbBoardSettings {
  const settings = ensurePcbBoardSettings(
    params.db,
    params.designId,
    params.timestamp,
  );
  // Dedupe + preserve order; ensure activeLayer remains visible.
  const seen = new Set<PcbLayerId>();
  const visible: PcbLayerId[] = [];
  for (const layer of params.visibleLayers) {
    if (!seen.has(layer)) {
      seen.add(layer);
      visible.push(layer);
    }
  }
  if (!seen.has(settings.activeLayer)) visible.push(settings.activeLayer);
  const next: PcbBoardSettings = {
    ...settings,
    visibleLayers: visible,
    updatedAt: params.timestamp,
  };
  params.db
    .update(pcbEntities)
    .set({ payloadJson: JSON.stringify(next), updatedAt: params.timestamp })
    .where(
      and(
        eq(pcbEntities.designId, params.designId),
        eq(pcbEntities.kind, BOARD_SETTINGS_KIND),
      ),
    )
    .run();
  return next;
}

export function replacePcbBoardSettings(
  db: DbClient,
  designId: string,
  settings: PcbBoardSettings,
  timestamp: string,
): void {
  db.update(pcbEntities)
    .set({ payloadJson: JSON.stringify(settings), updatedAt: timestamp })
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, BOARD_SETTINGS_KIND),
      ),
    )
    .run();
}

function parsePlacement(value: unknown): PcbPlacedPart | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = asString(record.id);
  const partId = asString(record.partId);
  const componentId = asString(record.componentId);
  const reference = asString(record.reference);
  const position = asRecord(record.positionMm);
  const posX = asNumber(position?.x);
  const posY = asNumber(position?.y);
  const rotationDeg = asNumber(record.rotationDeg);
  const mirrored = record.mirrored === true;
  const layer = asString(record.layer);
  const footprint = record.footprint;
  if (
    !id ||
    !partId ||
    !componentId ||
    !reference ||
    posX === null ||
    posY === null ||
    rotationDeg === null ||
    !isPcbLayerId(layer) ||
    !footprint
  ) {
    return null;
  }
  return {
    id,
    partId,
    componentId,
    reference,
    positionMm: { x: posX, y: posY },
    rotationDeg,
    mirrored,
    layer,
    footprint: footprint as PcbPlacedPart["footprint"],
  };
}

export function loadPcbPlacements(
  db: DbClient,
  designId: string,
): PcbPlacedPart[] {
  const rows = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, PLACEMENT_KIND),
      ),
    )
    .all();
  const placements: PcbPlacedPart[] = [];
  for (const row of rows) {
    const parsed = parsePlacement(parsePayload(row.payloadJson));
    if (parsed) placements.push(parsed);
  }
  return placements;
}

export function upsertPcbPlacement(
  db: DbClient,
  designId: string,
  placement: PcbPlacedPart,
  timestamp: string,
): void {
  const existing = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, PLACEMENT_KIND),
        eq(pcbEntities.id, placement.id),
      ),
    )
    .get();
  if (existing) {
    db.update(pcbEntities)
      .set({ payloadJson: JSON.stringify(placement), updatedAt: timestamp })
      .where(eq(pcbEntities.id, placement.id))
      .run();
  } else {
    db.insert(pcbEntities)
      .values({
        id: placement.id,
        designId,
        kind: PLACEMENT_KIND,
        payloadJson: JSON.stringify(placement),
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
  }
}

export function deletePcbPlacement(db: DbClient, placementId: string): void {
  db.delete(pcbEntities).where(eq(pcbEntities.id, placementId)).run();
}

export function replacePcbPlacements(
  db: DbClient,
  designId: string,
  placements: PcbPlacedPart[],
  timestamp: string,
): void {
  db.delete(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, PLACEMENT_KIND),
      ),
    )
    .run();
  for (const placement of placements) {
    db.insert(pcbEntities)
      .values({
        id: placement.id,
        designId,
        kind: PLACEMENT_KIND,
        payloadJson: JSON.stringify(placement),
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
  }
}

export function loadPcbPlacementById(
  db: DbClient,
  designId: string,
  placementId: string,
): PcbPlacedPart | null {
  const row = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, PLACEMENT_KIND),
        eq(pcbEntities.id, placementId),
      ),
    )
    .get();
  if (!row) return null;
  return parsePlacement(parsePayload(row.payloadJson));
}

export function movePcbPlacement(params: {
  db: DbClient;
  designId: string;
  placementId: string;
  positionMm: PcbPointMm;
  timestamp: string;
}): PcbPlacedPart | null {
  const placement = loadPcbPlacementById(
    params.db,
    params.designId,
    params.placementId,
  );
  if (!placement) return null;
  const next: PcbPlacedPart = {
    ...placement,
    positionMm: {
      x: Number(params.positionMm.x.toFixed(3)),
      y: Number(params.positionMm.y.toFixed(3)),
    },
  };
  upsertPcbPlacement(params.db, params.designId, next, params.timestamp);
  return next;
}

export function rotatePcbPlacement(params: {
  db: DbClient;
  designId: string;
  placementId: string;
  rotationDeg: 0 | 90 | 180 | 270;
  timestamp: string;
}): PcbPlacedPart | null {
  const placement = loadPcbPlacementById(
    params.db,
    params.designId,
    params.placementId,
  );
  if (!placement) return null;
  const next: PcbPlacedPart = {
    ...placement,
    rotationDeg: params.rotationDeg,
  };
  upsertPcbPlacement(params.db, params.designId, next, params.timestamp);
  return next;
}

export function flipPcbPlacement(params: {
  db: DbClient;
  designId: string;
  placementId: string;
  timestamp: string;
}): PcbPlacedPart | null {
  const placement = loadPcbPlacementById(
    params.db,
    params.designId,
    params.placementId,
  );
  if (!placement) return null;
  const next: PcbPlacedPart = {
    ...placement,
    layer: placement.layer === "B.Cu" ? "F.Cu" : "B.Cu",
    mirrored: !placement.mirrored,
  };
  upsertPcbPlacement(params.db, params.designId, next, params.timestamp);
  return next;
}

function deterministicOffset(index: number): { x: number; y: number } {
  const base = 1.5;
  const step = 0.8;
  const slotsPerRing = 6;
  const ring = Math.floor(index / slotsPerRing);
  const slot = index % slotsPerRing;
  const angle = (slot / slotsPerRing) * 2 * Math.PI;
  const radius = base + ring * step;
  return {
    x: Number((radius * Math.cos(angle)).toFixed(3)),
    y: Number((radius * Math.sin(angle)).toFixed(3)),
  };
}

function hashStringToIndex(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & 0x7fffffff; // Keep within 31-bit positive range
  }
  return hash;
}

export function syncPcbPlacementsFromSchematic(params: {
  db: DbClient;
  designId: string;
  schematicParts: Array<{
    id: string;
    componentId: string;
    reference: string;
    footprint: PcbPlacedPart["footprint"];
  }>;
  boardCenter: PcbPointMm;
  /** Layer assigned to newly-created placements; B.Cu also flips mirror. Defaults to F.Cu. */
  defaultLayer?: PcbLayerId;
  timestamp: string;
}): PcbPlacedPart[] {
  const {
    db,
    designId,
    schematicParts,
    boardCenter,
    defaultLayer = "F.Cu",
    timestamp,
  } = params;
  const existing = loadPcbPlacements(db, designId);
  const existingByPartId = new Map(existing.map((p) => [p.partId, p]));
  const schematicPartIds = new Set(schematicParts.map((p) => p.id));

  // Delete placements for removed schematic parts
  for (const placement of existing) {
    if (!schematicPartIds.has(placement.partId)) {
      deletePcbPlacement(db, placement.id);
    }
  }

  // Self-heal placements with absurd positions. A previous sync bug stored
  // nanometer values into the mm field, putting parts ~86,000 km off-board.
  // Detect any position outside a generous board envelope and reset to the
  // deterministic offset so the user can see and move the part again.
  // Threshold: 10,000 mm — bigger than any realistic PCB, much smaller than
  // the bug's nm-as-mm magnitude.
  const POSITION_SANITY_MM = 10_000;
  const isAbsurd = (p: PcbPlacedPart): boolean =>
    !Number.isFinite(p.positionMm.x) ||
    !Number.isFinite(p.positionMm.y) ||
    Math.abs(p.positionMm.x) > POSITION_SANITY_MM ||
    Math.abs(p.positionMm.y) > POSITION_SANITY_MM;

  // Create or repair placements for each schematic part.
  const result: PcbPlacedPart[] = [];
  for (const part of schematicParts) {
    const existingPlacement = existingByPartId.get(part.id);
    if (existingPlacement && !isAbsurd(existingPlacement)) {
      const footprintChanged =
        JSON.stringify(existingPlacement.footprint) !==
        JSON.stringify(part.footprint);
      if (footprintChanged) {
        const refreshed: PcbPlacedPart = {
          ...existingPlacement,
          componentId: part.componentId,
          reference: part.reference,
          footprint: part.footprint,
        };
        upsertPcbPlacement(db, designId, refreshed, timestamp);
        result.push(refreshed);
      } else {
        result.push(existingPlacement);
      }
      continue;
    }
    const index = hashStringToIndex(part.id) % 24;
    const offset = deterministicOffset(index);
    const repairedPosition = {
      x: Number((boardCenter.x + offset.x).toFixed(3)),
      y: Number((boardCenter.y + offset.y).toFixed(3)),
    };
    if (existingPlacement) {
      // Repair in place: keep id + manual fields the user set, reset position.
      const repaired: PcbPlacedPart = {
        ...existingPlacement,
        positionMm: repairedPosition,
        // Refresh the footprint snapshot too — the stale data was likely
        // committed alongside an outdated snapshot.
        footprint: part.footprint,
      };
      upsertPcbPlacement(db, designId, repaired, timestamp);
      result.push(repaired);
    } else {
      const placement: PcbPlacedPart = {
        id: crypto.randomUUID(),
        partId: part.id,
        componentId: part.componentId,
        reference: part.reference,
        positionMm: repairedPosition,
        rotationDeg: 0,
        mirrored: defaultLayer === "B.Cu",
        layer: defaultLayer,
        footprint: part.footprint,
      };
      upsertPcbPlacement(db, designId, placement, timestamp);
      result.push(placement);
    }
  }

  return result;
}

// ───────────────────────── Traces ─────────────────────────

function parseTrace(value: unknown): PcbTrace | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = asString(record.id);
  const netId = record.netId === null ? null : asString(record.netId);
  const netClassId = asString(record.netClassId);
  const layer = asString(record.layer);
  const widthMm = asNumber(record.widthMm);
  const segmentMode = asString(record.segmentMode);
  const points = Array.isArray(record.pointsNm) ? record.pointsNm : null;
  if (
    !id ||
    !netClassId ||
    !isCopperLayer(layer) ||
    widthMm === null ||
    widthMm <= 0 ||
    !isSegmentMode(segmentMode) ||
    !points ||
    points.length < 2
  ) {
    return null;
  }
  const pointsNm: Array<{ x: number; y: number }> = [];
  for (const raw of points) {
    const r = asRecord(raw);
    const x = asNumber(r?.x);
    const y = asNumber(r?.y);
    if (x === null || y === null) return null;
    pointsNm.push({ x, y });
  }
  return {
    id,
    netId: netId ?? null,
    netClassId,
    layer,
    widthMm,
    pointsNm,
    segmentMode,
  };
}

export function loadPcbTraces(db: DbClient, designId: string): PcbTrace[] {
  const rows = db
    .select()
    .from(pcbEntities)
    .where(
      and(eq(pcbEntities.designId, designId), eq(pcbEntities.kind, TRACE_KIND)),
    )
    .all();
  const traces: PcbTrace[] = [];
  for (const row of rows) {
    const parsed = parseTrace(parsePayload(row.payloadJson));
    if (parsed) traces.push(parsed);
  }
  return traces;
}

export function loadPcbTraceById(
  db: DbClient,
  designId: string,
  traceId: string,
): PcbTrace | null {
  const row = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, TRACE_KIND),
        eq(pcbEntities.id, traceId),
      ),
    )
    .get();
  if (!row) return null;
  return parseTrace(parsePayload(row.payloadJson));
}

export function insertPcbTrace(
  db: DbClient,
  designId: string,
  trace: PcbTrace,
  timestamp: string,
): void {
  db.insert(pcbEntities)
    .values({
      id: trace.id,
      designId,
      kind: TRACE_KIND,
      payloadJson: JSON.stringify(trace),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
}

export function updatePcbTrace(
  db: DbClient,
  trace: PcbTrace,
  timestamp: string,
): void {
  db.update(pcbEntities)
    .set({ payloadJson: JSON.stringify(trace), updatedAt: timestamp })
    .where(eq(pcbEntities.id, trace.id))
    .run();
}

export function deletePcbTrace(db: DbClient, traceId: string): void {
  db.delete(pcbEntities).where(eq(pcbEntities.id, traceId)).run();
}

export function replacePcbTraces(
  db: DbClient,
  designId: string,
  traces: PcbTrace[],
  timestamp: string,
): void {
  db.delete(pcbEntities)
    .where(
      and(eq(pcbEntities.designId, designId), eq(pcbEntities.kind, TRACE_KIND)),
    )
    .run();
  for (const trace of traces) {
    insertPcbTrace(db, designId, trace, timestamp);
  }
}

// ───────────────────────── Vias ─────────────────────────

function parseVia(value: unknown): PcbVia | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = asString(record.id);
  const netId = record.netId === null ? null : asString(record.netId);
  const netClassId = asString(record.netClassId);
  const center = asRecord(record.centerMm);
  const cx = asNumber(center?.x);
  const cy = asNumber(center?.y);
  const diameterMm = asNumber(record.diameterMm);
  const drillMm = asNumber(record.drillMm);
  if (
    !id ||
    !netClassId ||
    cx === null ||
    cy === null ||
    diameterMm === null ||
    drillMm === null ||
    diameterMm <= drillMm ||
    drillMm <= 0
  ) {
    return null;
  }
  return {
    id,
    netId: netId ?? null,
    netClassId,
    centerMm: { x: cx, y: cy },
    diameterMm,
    drillMm,
    fromLayer: "F.Cu",
    toLayer: "B.Cu",
  };
}

export function loadPcbVias(db: DbClient, designId: string): PcbVia[] {
  const rows = db
    .select()
    .from(pcbEntities)
    .where(
      and(eq(pcbEntities.designId, designId), eq(pcbEntities.kind, VIA_KIND)),
    )
    .all();
  const vias: PcbVia[] = [];
  for (const row of rows) {
    const parsed = parseVia(parsePayload(row.payloadJson));
    if (parsed) vias.push(parsed);
  }
  return vias;
}

export function loadPcbViaById(
  db: DbClient,
  designId: string,
  viaId: string,
): PcbVia | null {
  const row = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, VIA_KIND),
        eq(pcbEntities.id, viaId),
      ),
    )
    .get();
  if (!row) return null;
  return parseVia(parsePayload(row.payloadJson));
}

export function insertPcbVia(
  db: DbClient,
  designId: string,
  via: PcbVia,
  timestamp: string,
): void {
  db.insert(pcbEntities)
    .values({
      id: via.id,
      designId,
      kind: VIA_KIND,
      payloadJson: JSON.stringify(via),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
}

export function deletePcbVia(db: DbClient, viaId: string): void {
  db.delete(pcbEntities).where(eq(pcbEntities.id, viaId)).run();
}

export function replacePcbVias(
  db: DbClient,
  designId: string,
  vias: PcbVia[],
  timestamp: string,
): void {
  db.delete(pcbEntities)
    .where(
      and(eq(pcbEntities.designId, designId), eq(pcbEntities.kind, VIA_KIND)),
    )
    .run();
  for (const via of vias) {
    insertPcbVia(db, designId, via, timestamp);
  }
}
