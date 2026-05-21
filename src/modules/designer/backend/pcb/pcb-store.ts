import { and, eq } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type {
  PcbBoardSettings,
  PcbCopperLayerId,
  PcbFreeHole,
  PcbFreePad,
  PcbFreePadShape,
  PcbFreePadType,
  PcbLayerId,
  PcbLayerPreset,
  PcbOverlayLayer,
  PcbOverlayShape,
  PcbOverlayShapeKind,
  PcbOverlayText,
  PcbPlacedPart,
  PcbPointMm,
  PcbTrace,
  PcbTraceSegmentMode,
  PcbVia,
  PcbViewSide,
  PcbViewState,
  PcbZone,
} from "../../../../sdks/designer";
import { pcbEntities } from "../schema";
import { asNumber, asRecord, asString } from "../value-guards";
import {
  createDefaultPcbBoardSettings,
  createDefaultPcbViewState,
} from "./pcb-defaults";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;

const BOARD_SETTINGS_KIND = "board_settings";
const PLACEMENT_KIND = "placement";
const TRACE_KIND = "trace";
const VIA_KIND = "via";
const FREE_HOLE_KIND = "free_hole";
const FREE_PAD_KIND = "free_pad";
const OVERLAY_TEXT_KIND = "overlay_text";
const OVERLAY_SHAPE_KIND = "overlay_shape";
const ZONE_KIND = "zone";

const OVERLAY_LAYERS: ReadonlySet<PcbOverlayLayer> = new Set<PcbOverlayLayer>([
  "F.SilkS",
  "B.SilkS",
  "F.Fab",
  "B.Fab",
  "F.CrtYd",
  "B.CrtYd",
  "Edge.Cuts",
]);
const OVERLAY_SHAPE_KINDS: ReadonlySet<PcbOverlayShapeKind> =
  new Set<PcbOverlayShapeKind>([
    "rect",
    "circle",
    "line",
    "polyline",
    "polygon",
  ]);

const FREE_PAD_TYPES: ReadonlySet<PcbFreePadType> = new Set<PcbFreePadType>([
  "smd",
  "hole",
  "std",
  "conn",
]);
const FREE_PAD_SHAPES: ReadonlySet<PcbFreePadShape> = new Set<PcbFreePadShape>([
  "rect",
  "circle",
  "oval",
  "roundrect",
]);

function isCopperLayer(value: string | null): value is PcbCopperLayerId {
  return (
    value === "F.Cu" ||
    value === "In1.Cu" ||
    value === "In2.Cu" ||
    value === "B.Cu"
  );
}

function isSegmentMode(value: string | null): value is PcbTraceSegmentMode {
  return value === "manhattan-90" || value === "manhattan-45";
}

const ALL_PCB_LAYER_IDS: ReadonlySet<PcbLayerId> = new Set<PcbLayerId>([
  "F.Cu",
  "In1.Cu",
  "In2.Cu",
  "B.Cu",
  "F.Mask",
  "B.Mask",
  "F.Paste",
  "B.Paste",
  "F.SilkS",
  "B.SilkS",
  "F.CrtYd",
  "B.CrtYd",
  "F.Fab",
  "B.Fab",
  "Edge.Cuts",
  "Drill",
  "Metadata",
]);

function isPcbLayerId(
  value: string | null,
): value is PcbBoardSettings["activeLayer"] {
  return value !== null && ALL_PCB_LAYER_IDS.has(value as PcbLayerId);
}

function parseVisibleLayers(value: unknown): PcbBoardSettings["visibleLayers"] {
  const layers = (Array.isArray(value) ? value : [])
    ?.map((item) => asString(item))
    .filter(
      (item): item is PcbLayerId =>
        item !== null && ALL_PCB_LAYER_IDS.has(item as PcbLayerId),
    );
  return layers && layers.length > 0
    ? layers
    : ["F.Cu", "B.Cu", "F.SilkS", "Edge.Cuts", "Drill", "Metadata"];
}

function parseDisplayMode(value: unknown): PcbBoardSettings["displayMode"] {
  const s = asString(value);
  return s === "dim" || s === "solo" || s === "normal" ? s : "normal";
}

function parseLayerCount(value: unknown): PcbBoardSettings["layerCount"] {
  const n = asNumber(value);
  return n === 4 ? 4 : 2;
}

function parsePayload(payloadJson: string): unknown {
  try {
    return JSON.parse(payloadJson) as unknown;
  } catch {
    return null;
  }
}

function isCopperLayerId(value: unknown): value is PcbCopperLayerId {
  return (
    value === "F.Cu" ||
    value === "In1.Cu" ||
    value === "In2.Cu" ||
    value === "B.Cu"
  );
}

function parseViewSide(value: unknown): PcbViewSide {
  const s = asString(value);
  return s === "bottom" ? "bottom" : "top";
}

function parseLayerPreset(value: unknown): PcbLayerPreset {
  const s = asString(value);
  if (
    s === "top-side" ||
    s === "bottom-side" ||
    s === "all-copper" ||
    s === "assembly"
  ) {
    return s;
  }
  return "custom";
}

function parseCopperFillLayers(value: unknown): PcbCopperLayerId[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<PcbCopperLayerId>();
  const out: PcbCopperLayerId[] = [];
  for (const item of value) {
    if (isCopperLayerId(item) && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

function parsePourNetIds(
  value: unknown,
): Partial<Record<PcbCopperLayerId, string | null>> {
  const record = asRecord(value);
  if (!record) return {};
  const out: Partial<Record<PcbCopperLayerId, string | null>> = {};
  for (const key of ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"] as const) {
    const raw = record[key];
    if (raw === null) {
      out[key] = null;
    } else if (typeof raw === "string" && raw.length > 0) {
      out[key] = raw;
    }
  }
  return out;
}

function parsePerLayerOpacity(
  value: unknown,
): Partial<Record<PcbLayerId, number>> {
  const record = asRecord(value);
  if (!record) return {};
  const out: Partial<Record<PcbLayerId, number>> = {};
  for (const key of Object.keys(record)) {
    if (!ALL_PCB_LAYER_IDS.has(key as PcbLayerId)) continue;
    const n = asNumber(record[key]);
    if (n === null) continue;
    out[key as PcbLayerId] = Math.max(0, Math.min(1, n));
  }
  return out;
}

function parseViewState(value: unknown): PcbViewState {
  const record = asRecord(value);
  const defaults = createDefaultPcbViewState();
  if (!record) return defaults;
  return {
    displayMode: parseDisplayMode(record.displayMode),
    viewSide: parseViewSide(record.viewSide),
    copperFillLayers: parseCopperFillLayers(record.copperFillLayers),
    copperFillPourNetIds: parsePourNetIds(record.copperFillPourNetIds),
    perLayerOpacity: parsePerLayerOpacity(record.perLayerOpacity),
    layerPreset: parseLayerPreset(record.layerPreset),
    ratsnestVisible:
      record.ratsnestVisible === false
        ? false
        : record.ratsnestVisible === true
          ? true
          : defaults.ratsnestVisible,
  };
}

function mergeViewState(
  current: PcbViewState,
  patch: Partial<PcbViewState>,
): PcbViewState {
  return {
    displayMode: patch.displayMode ?? current.displayMode,
    viewSide: patch.viewSide ?? current.viewSide,
    copperFillLayers: patch.copperFillLayers
      ? parseCopperFillLayers(patch.copperFillLayers)
      : current.copperFillLayers,
    copperFillPourNetIds: patch.copperFillPourNetIds
      ? { ...current.copperFillPourNetIds, ...patch.copperFillPourNetIds }
      : current.copperFillPourNetIds,
    perLayerOpacity: patch.perLayerOpacity
      ? { ...current.perLayerOpacity, ...patch.perLayerOpacity }
      : current.perLayerOpacity,
    layerPreset: patch.layerPreset ?? current.layerPreset,
    ratsnestVisible:
      patch.ratsnestVisible !== undefined
        ? patch.ratsnestVisible
        : current.ratsnestVisible,
  };
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

  const outlineKind = outline?.kind === "polygon" ? "polygon" : "rect";
  if (
    !record ||
    (outline?.kind !== "rect" && outline?.kind !== "polygon") ||
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

  // Polygon outlines round-trip an extra `pointsMm` field.
  const polygonPoints: Array<{ x: number; y: number }> = [];
  if (outlineKind === "polygon" && Array.isArray(outline?.pointsMm)) {
    for (const raw of outline.pointsMm as unknown[]) {
      const r = asRecord(raw);
      const x = asNumber(r?.x);
      const y = asNumber(r?.y);
      if (x !== null && y !== null) polygonPoints.push({ x, y });
    }
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
  const outlineParsed =
    outlineKind === "polygon" && polygonPoints.length >= 3
      ? {
          kind: "polygon" as const,
          widthMm,
          heightMm,
          centerMm: { x: centerX, y: centerY },
          pointsMm: polygonPoints,
        }
      : {
          kind: "rect" as const,
          widthMm,
          heightMm,
          centerMm: { x: centerX, y: centerY },
        };
  return {
    ...defaults,
    outline: outlineParsed,
    activeLayer,
    visibleLayers: parseVisibleLayers(record.visibleLayers),
    tracePresets:
      tracePresets.length > 0 ? tracePresets : defaults.tracePresets,
    fabricator: parseFabricator(record.fabricator) ?? defaults.fabricator,
    layerCount: parseLayerCount(record.layerCount),
    displayMode: parseDisplayMode(record.displayMode),
    solderMaskExpansionMm:
      asNumber(record.solderMaskExpansionMm) ?? defaults.solderMaskExpansionMm,
    solderPasteExpansionMm:
      asNumber(record.solderPasteExpansionMm) ??
      defaults.solderPasteExpansionMm,
    viewState:
      record.viewState !== undefined
        ? parseViewState(record.viewState)
        : defaults.viewState,
    updatedAt,
  };
}

function parseFabricator(
  value: unknown,
): PcbBoardSettings["fabricator"] | null {
  const s = asString(value);
  if (
    s === "custom" ||
    s === "jlcpcb_2l" ||
    s === "jlcpcb_4l" ||
    s === "pcbway_std" ||
    s === "pcbway_advanced"
  ) {
    return s;
  }
  return null;
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
  // Dedupe + preserve order; auto-pin the active layer ONLY when the new
  // set still contains its family (i.e. the user is reshuffling copper
  // visibility). Presets that intentionally omit all copper (e.g.
  // "Assembly view") shouldn't drag the routing layer back in — that
  // would leave the panel and chip detection out of sync with the user's
  // chosen preset.
  const seen = new Set<PcbLayerId>();
  const visible: PcbLayerId[] = [];
  for (const layer of params.visibleLayers) {
    if (!seen.has(layer)) {
      seen.add(layer);
      visible.push(layer);
    }
  }
  const hasAnyCopper =
    seen.has("F.Cu") ||
    seen.has("In1.Cu") ||
    seen.has("In2.Cu") ||
    seen.has("B.Cu");
  const activeIsCopper = isCopperLayer(settings.activeLayer);
  if (hasAnyCopper && activeIsCopper && !seen.has(settings.activeLayer)) {
    visible.push(settings.activeLayer);
  }
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

export function updatePcbViewState(params: {
  db: DbClient;
  designId: string;
  patch: Partial<PcbViewState>;
  timestamp: string;
}): PcbBoardSettings {
  const settings = ensurePcbBoardSettings(
    params.db,
    params.designId,
    params.timestamp,
  );
  const current = settings.viewState ?? createDefaultPcbViewState();
  const nextViewState = mergeViewState(current, params.patch);
  const next: PcbBoardSettings = {
    ...settings,
    viewState: nextViewState,
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
  const netName =
    record.netName === undefined ? undefined : asString(record.netName);
  return {
    id,
    netId: netId ?? null,
    netClassId,
    layer,
    widthMm,
    pointsNm,
    segmentMode,
    ...(netName !== undefined ? { netName: netName ?? null } : {}),
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
  // Forward-compat default-fill: pre-Phase-B vias lack `viaType` /
  // `protection` / per-via layer pair. Defaults match v1 behaviour
  // (through F→B, tented).
  const fromLayerRaw = asString(record.fromLayer);
  const toLayerRaw = asString(record.toLayer);
  const fromLayer = isCopperLayer(fromLayerRaw) ? fromLayerRaw : "F.Cu";
  const toLayer = isCopperLayer(toLayerRaw) ? toLayerRaw : "B.Cu";
  const viaTypeRaw = asString(record.viaType);
  const viaType: PcbVia["viaType"] =
    viaTypeRaw === "blind" || viaTypeRaw === "buried" || viaTypeRaw === "micro"
      ? viaTypeRaw
      : "through";
  const protectionRaw = asString(record.protection);
  const protection: PcbVia["protection"] =
    protectionRaw === "none" ||
    protectionRaw === "plugged" ||
    protectionRaw === "filled" ||
    protectionRaw === "capped"
      ? protectionRaw
      : "tented";
  const provenanceRaw = asString(record.provenance);
  const provenance: PcbVia["provenance"] =
    provenanceRaw === "manual" ? "manual" : "route";
  const netName =
    record.netName === undefined ? undefined : asString(record.netName);
  return {
    id,
    netId: netId ?? null,
    netClassId,
    centerMm: { x: cx, y: cy },
    diameterMm,
    drillMm,
    fromLayer,
    toLayer,
    viaType,
    protection,
    provenance,
    ...(netName !== undefined ? { netName: netName ?? null } : {}),
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

// ─────────────────────── Free holes (F5) ───────────────────────

function parseFreeHole(value: unknown): PcbFreeHole | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = asString(record.id);
  const center = asRecord(record.centerMm);
  const cx = asNumber(center?.x);
  const cy = asNumber(center?.y);
  const drillMm = asNumber(record.drillMm);
  if (!id || cx === null || cy === null || drillMm === null || drillMm <= 0) {
    return null;
  }
  const lockedAtRaw = asString(record.lockedAt);
  return {
    id,
    centerMm: { x: cx, y: cy },
    drillMm,
    lockedAt: lockedAtRaw ?? null,
  };
}

export function loadPcbFreeHoles(
  db: DbClient,
  designId: string,
): PcbFreeHole[] {
  const rows = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, FREE_HOLE_KIND),
      ),
    )
    .all();
  const out: PcbFreeHole[] = [];
  for (const row of rows) {
    const parsed = parseFreeHole(parsePayload(row.payloadJson));
    if (parsed) out.push(parsed);
  }
  return out;
}

export function loadPcbFreeHoleById(
  db: DbClient,
  designId: string,
  freeHoleId: string,
): PcbFreeHole | null {
  const row = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, FREE_HOLE_KIND),
        eq(pcbEntities.id, freeHoleId),
      ),
    )
    .get();
  if (!row) return null;
  return parseFreeHole(parsePayload(row.payloadJson));
}

export function insertPcbFreeHole(
  db: DbClient,
  designId: string,
  hole: PcbFreeHole,
  timestamp: string,
): void {
  db.insert(pcbEntities)
    .values({
      id: hole.id,
      designId,
      kind: FREE_HOLE_KIND,
      payloadJson: JSON.stringify(hole),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
}

export function updatePcbFreeHole(
  db: DbClient,
  hole: PcbFreeHole,
  timestamp: string,
): void {
  db.update(pcbEntities)
    .set({
      payloadJson: JSON.stringify(hole),
      updatedAt: timestamp,
    })
    .where(eq(pcbEntities.id, hole.id))
    .run();
}

export function deletePcbFreeHole(db: DbClient, freeHoleId: string): void {
  db.delete(pcbEntities).where(eq(pcbEntities.id, freeHoleId)).run();
}

// ─────────────────────── Free pads (F5) ───────────────────────

function parseFreePad(value: unknown): PcbFreePad | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = asString(record.id);
  const center = asRecord(record.centerMm);
  const cx = asNumber(center?.x);
  const cy = asNumber(center?.y);
  const rotationDeg = asNumber(record.rotationDeg);
  const padTypeRaw = asString(record.padType);
  const shapeRaw = asString(record.shape);
  const widthMm = asNumber(record.widthMm);
  const heightMm = asNumber(record.heightMm);
  if (
    !id ||
    cx === null ||
    cy === null ||
    rotationDeg === null ||
    !padTypeRaw ||
    !shapeRaw ||
    widthMm === null ||
    heightMm === null ||
    widthMm <= 0 ||
    heightMm <= 0 ||
    !FREE_PAD_TYPES.has(padTypeRaw as PcbFreePadType) ||
    !FREE_PAD_SHAPES.has(shapeRaw as PcbFreePadShape)
  ) {
    return null;
  }
  const padType = padTypeRaw as PcbFreePadType;
  const shape = shapeRaw as PcbFreePadShape;
  const roundrectRatio = asNumber(record.roundrectRatio);
  const drillMm = asNumber(record.drillMm);
  const layerRaw = asString(record.layer);
  const layer = isCopperLayer(layerRaw) ? layerRaw : "F.Cu";
  const netIdRaw = record.netId;
  const netId =
    netIdRaw === null || netIdRaw === undefined ? null : asString(netIdRaw);
  const solderMaskExpansionMm = asNumber(record.solderMaskExpansionMm);
  const solderPasteExpansionMm = asNumber(record.solderPasteExpansionMm);
  const lockedAt = asString(record.lockedAt);
  return {
    id,
    centerMm: { x: cx, y: cy },
    rotationDeg,
    padType,
    shape,
    widthMm,
    heightMm,
    ...(roundrectRatio !== null ? { roundrectRatio } : {}),
    drillMm: drillMm !== null && drillMm > 0 ? drillMm : null,
    layer,
    netId: netId ?? null,
    solderMaskExpansionMm,
    solderPasteExpansionMm,
    lockedAt: lockedAt ?? null,
  };
}

export function loadPcbFreePads(db: DbClient, designId: string): PcbFreePad[] {
  const rows = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, FREE_PAD_KIND),
      ),
    )
    .all();
  const out: PcbFreePad[] = [];
  for (const row of rows) {
    const parsed = parseFreePad(parsePayload(row.payloadJson));
    if (parsed) out.push(parsed);
  }
  return out;
}

export function loadPcbFreePadById(
  db: DbClient,
  designId: string,
  freePadId: string,
): PcbFreePad | null {
  const row = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, FREE_PAD_KIND),
        eq(pcbEntities.id, freePadId),
      ),
    )
    .get();
  if (!row) return null;
  return parseFreePad(parsePayload(row.payloadJson));
}

export function insertPcbFreePad(
  db: DbClient,
  designId: string,
  pad: PcbFreePad,
  timestamp: string,
): void {
  db.insert(pcbEntities)
    .values({
      id: pad.id,
      designId,
      kind: FREE_PAD_KIND,
      payloadJson: JSON.stringify(pad),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
}

export function updatePcbFreePad(
  db: DbClient,
  pad: PcbFreePad,
  timestamp: string,
): void {
  db.update(pcbEntities)
    .set({ payloadJson: JSON.stringify(pad), updatedAt: timestamp })
    .where(eq(pcbEntities.id, pad.id))
    .run();
}

export function deletePcbFreePad(db: DbClient, freePadId: string): void {
  db.delete(pcbEntities).where(eq(pcbEntities.id, freePadId)).run();
}

// ───────────────────── Overlay text (F5) ─────────────────────

function parseOverlayLayer(value: unknown): PcbOverlayLayer | null {
  const s = asString(value);
  return s && OVERLAY_LAYERS.has(s as PcbOverlayLayer)
    ? (s as PcbOverlayLayer)
    : null;
}

function parseOverlayText(value: unknown): PcbOverlayText | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = asString(record.id);
  const layer = parseOverlayLayer(record.layer);
  const pos = asRecord(record.positionMm);
  const px = asNumber(pos?.x);
  const py = asNumber(pos?.y);
  const text = asString(record.text);
  const fontSizeMm = asNumber(record.fontSizeMm);
  const rotationDeg = asNumber(record.rotationDeg);
  if (
    !id ||
    !layer ||
    px === null ||
    py === null ||
    text === null ||
    fontSizeMm === null ||
    fontSizeMm <= 0 ||
    rotationDeg === null
  ) {
    return null;
  }
  const justifyRaw = asString(record.justify);
  const justify: PcbOverlayText["justify"] =
    justifyRaw === "left" || justifyRaw === "right" ? justifyRaw : "center";
  const mirror = record.mirror === true;
  const lockedAt = asString(record.lockedAt);
  return {
    id,
    layer,
    positionMm: { x: px, y: py },
    text,
    fontSizeMm,
    rotationDeg,
    mirror,
    justify,
    lockedAt: lockedAt ?? null,
  };
}

export function loadPcbOverlayTexts(
  db: DbClient,
  designId: string,
): PcbOverlayText[] {
  const rows = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, OVERLAY_TEXT_KIND),
      ),
    )
    .all();
  const out: PcbOverlayText[] = [];
  for (const row of rows) {
    const parsed = parseOverlayText(parsePayload(row.payloadJson));
    if (parsed) out.push(parsed);
  }
  return out;
}

export function loadPcbOverlayTextById(
  db: DbClient,
  designId: string,
  id: string,
): PcbOverlayText | null {
  const row = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, OVERLAY_TEXT_KIND),
        eq(pcbEntities.id, id),
      ),
    )
    .get();
  if (!row) return null;
  return parseOverlayText(parsePayload(row.payloadJson));
}

export function insertPcbOverlayText(
  db: DbClient,
  designId: string,
  overlay: PcbOverlayText,
  timestamp: string,
): void {
  db.insert(pcbEntities)
    .values({
      id: overlay.id,
      designId,
      kind: OVERLAY_TEXT_KIND,
      payloadJson: JSON.stringify(overlay),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
}

export function updatePcbOverlayText(
  db: DbClient,
  overlay: PcbOverlayText,
  timestamp: string,
): void {
  db.update(pcbEntities)
    .set({ payloadJson: JSON.stringify(overlay), updatedAt: timestamp })
    .where(eq(pcbEntities.id, overlay.id))
    .run();
}

export function deletePcbOverlayText(db: DbClient, id: string): void {
  db.delete(pcbEntities).where(eq(pcbEntities.id, id)).run();
}

// ───────────────────── Overlay shape (F5) ────────────────────

function parseOverlayShape(value: unknown): PcbOverlayShape | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = asString(record.id);
  const layer = parseOverlayLayer(record.layer);
  const kindRaw = asString(record.kind);
  const kind =
    kindRaw && OVERLAY_SHAPE_KINDS.has(kindRaw as PcbOverlayShapeKind)
      ? (kindRaw as PcbOverlayShapeKind)
      : null;
  const strokeWidthMm = asNumber(record.strokeWidthMm);
  const pointsRaw = Array.isArray(record.pointsMm) ? record.pointsMm : null;
  if (
    !id ||
    !layer ||
    !kind ||
    strokeWidthMm === null ||
    strokeWidthMm <= 0 ||
    !pointsRaw ||
    pointsRaw.length < 2
  ) {
    return null;
  }
  const pointsMm: { x: number; y: number }[] = [];
  for (const raw of pointsRaw) {
    const r = asRecord(raw);
    const x = asNumber(r?.x);
    const y = asNumber(r?.y);
    if (x === null || y === null) return null;
    pointsMm.push({ x, y });
  }
  const fill: PcbOverlayShape["fill"] =
    record.fill === "solid" ? "solid" : "none";
  const lockedAt = asString(record.lockedAt);
  return {
    id,
    layer,
    kind,
    pointsMm,
    strokeWidthMm,
    fill,
    lockedAt: lockedAt ?? null,
  };
}

export function loadPcbOverlayShapes(
  db: DbClient,
  designId: string,
): PcbOverlayShape[] {
  const rows = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, OVERLAY_SHAPE_KIND),
      ),
    )
    .all();
  const out: PcbOverlayShape[] = [];
  for (const row of rows) {
    const parsed = parseOverlayShape(parsePayload(row.payloadJson));
    if (parsed) out.push(parsed);
  }
  return out;
}

export function loadPcbOverlayShapeById(
  db: DbClient,
  designId: string,
  id: string,
): PcbOverlayShape | null {
  const row = db
    .select()
    .from(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, OVERLAY_SHAPE_KIND),
        eq(pcbEntities.id, id),
      ),
    )
    .get();
  if (!row) return null;
  return parseOverlayShape(parsePayload(row.payloadJson));
}

export function insertPcbOverlayShape(
  db: DbClient,
  designId: string,
  shape: PcbOverlayShape,
  timestamp: string,
): void {
  db.insert(pcbEntities)
    .values({
      id: shape.id,
      designId,
      kind: OVERLAY_SHAPE_KIND,
      payloadJson: JSON.stringify(shape),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
}

export function updatePcbOverlayShape(
  db: DbClient,
  shape: PcbOverlayShape,
  timestamp: string,
): void {
  db.update(pcbEntities)
    .set({ payloadJson: JSON.stringify(shape), updatedAt: timestamp })
    .where(eq(pcbEntities.id, shape.id))
    .run();
}

export function deletePcbOverlayShape(db: DbClient, id: string): void {
  db.delete(pcbEntities).where(eq(pcbEntities.id, id)).run();
}

// ─────────── Replace-helpers used by undo/redo replay ───────────
// Each `replacePcb*` wipes all rows of one kind for a design and re-inserts
// the supplied list. The history reconstitution path
// (`applyHistoryPatches`) snapshots before-state, applies patches in an ECS
// world, then calls these to make the DB row set match the post-patch world.

export function replacePcbFreeHoles(
  db: DbClient,
  designId: string,
  holes: PcbFreeHole[],
  timestamp: string,
): void {
  db.delete(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, FREE_HOLE_KIND),
      ),
    )
    .run();
  for (const hole of holes) insertPcbFreeHole(db, designId, hole, timestamp);
}

export function replacePcbFreePads(
  db: DbClient,
  designId: string,
  pads: PcbFreePad[],
  timestamp: string,
): void {
  db.delete(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, FREE_PAD_KIND),
      ),
    )
    .run();
  for (const pad of pads) insertPcbFreePad(db, designId, pad, timestamp);
}

export function replacePcbOverlayTexts(
  db: DbClient,
  designId: string,
  overlays: PcbOverlayText[],
  timestamp: string,
): void {
  db.delete(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, OVERLAY_TEXT_KIND),
      ),
    )
    .run();
  for (const overlay of overlays) {
    insertPcbOverlayText(db, designId, overlay, timestamp);
  }
}

export function replacePcbOverlayShapes(
  db: DbClient,
  designId: string,
  shapes: PcbOverlayShape[],
  timestamp: string,
): void {
  db.delete(pcbEntities)
    .where(
      and(
        eq(pcbEntities.designId, designId),
        eq(pcbEntities.kind, OVERLAY_SHAPE_KIND),
      ),
    )
    .run();
  for (const shape of shapes) {
    insertPcbOverlayShape(db, designId, shape, timestamp);
  }
}

// ───────────────────────── Zones (KiCad import) ─────────────────────────

function parseZone(value: unknown): PcbZone | null {
  const record = asRecord(value);
  if (!record) return null;
  const id = asString(record.id);
  const layerRaw = asString(record.layer);
  if (!id || !isCopperLayer(layerRaw)) return null;
  const netName =
    record.netName === undefined
      ? null
      : record.netName === null
        ? null
        : asString(record.netName);
  const fillTypeRaw = asString(record.fillType);
  const fillType: PcbZone["fillType"] =
    fillTypeRaw === "hatched" ? "hatched" : "solid";
  const hatchEdgeMm = asNumber(record.hatchEdgeMm) ?? 0.5;
  const pointsRaw = Array.isArray(record.polygonPointsMm)
    ? record.polygonPointsMm
    : null;
  if (!pointsRaw) return null;
  const polygonPointsMm: Array<{ x: number; y: number }> = [];
  for (const raw of pointsRaw) {
    const r = asRecord(raw);
    const x = asNumber(r?.x);
    const y = asNumber(r?.y);
    if (x === null || y === null) return null;
    polygonPointsMm.push({ x, y });
  }
  if (polygonPointsMm.length < 3) return null;
  return {
    id,
    netName: netName ?? null,
    layer: layerRaw,
    polygonPointsMm,
    hatchEdgeMm,
    fillType,
  };
}

export function loadPcbZones(db: DbClient, designId: string): PcbZone[] {
  const rows = db
    .select()
    .from(pcbEntities)
    .where(
      and(eq(pcbEntities.designId, designId), eq(pcbEntities.kind, ZONE_KIND)),
    )
    .all();
  const out: PcbZone[] = [];
  for (const row of rows) {
    const parsed = parseZone(parsePayload(row.payloadJson));
    if (parsed) out.push(parsed);
  }
  return out;
}

export function insertPcbZone(
  db: DbClient,
  designId: string,
  zone: PcbZone,
  timestamp: string,
): void {
  db.insert(pcbEntities)
    .values({
      id: zone.id,
      designId,
      kind: ZONE_KIND,
      payloadJson: JSON.stringify(zone),
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
}

export function replacePcbZones(
  db: DbClient,
  designId: string,
  zones: PcbZone[],
  timestamp: string,
): void {
  db.delete(pcbEntities)
    .where(
      and(eq(pcbEntities.designId, designId), eq(pcbEntities.kind, ZONE_KIND)),
    )
    .run();
  for (const zone of zones) {
    insertPcbZone(db, designId, zone, timestamp);
  }
}
