import { and, eq } from "drizzle-orm";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import type {
  PcbBoardSettings,
  PcbLayerId,
  PcbPlacedPart,
  PcbPointMm,
} from "../../../../sdks/designer";
import { pcbEntities } from "../schema";
import { asNumber, asRecord, asString } from "../value-guards";
import { createDefaultPcbBoardSettings } from "./pcb-defaults";

type DbClient = BunSQLiteDatabase<Record<string, unknown>>;

const BOARD_SETTINGS_KIND = "board_settings";
const PLACEMENT_KIND = "placement";

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
  timestamp: string;
}): PcbPlacedPart[] {
  const { db, designId, schematicParts, boardCenter, timestamp } = params;
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
      result.push(existingPlacement);
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
        mirrored: false,
        layer: "F.Cu",
        footprint: part.footprint,
      };
      upsertPcbPlacement(db, designId, placement, timestamp);
      result.push(placement);
    }
  }

  return result;
}
