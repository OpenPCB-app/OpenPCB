import { eq, inArray, like, or, sql } from "drizzle-orm";
import type { CoreBackendModuleContext } from "../../../core/contracts/modules/backend-module";
import type {
  LibraryComponent,
  LibraryComponentPlacementDetail,
  LibraryComponentDetail,
  LibraryFootprint,
  LibraryFootprintDetail,
  LibraryFootprintPlacementSnapshot,
  LibraryPreviewWarning,
  LibrarySearchParams,
  LibrarySourceProvenance,
  LibrarySDK,
  LibrarySymbol,
  LibrarySymbolPlacementSnapshot,
  LibrarySymbolDetail,
} from "../../../sdks/library";
import type {
  FootprintRenderModel,
  SymbolRenderModel,
} from "../../../shared/rendering";
import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { components, footprints, symbols } from "./schema";

export type ComponentRow = typeof components.$inferSelect;
export type SymbolRow = typeof symbols.$inferSelect;
export type FootprintRow = typeof footprints.$inferSelect;

export function getDb(
  ctx: CoreBackendModuleContext,
): BunSQLiteDatabase<Record<string, unknown>> {
  return (ctx.db as { db: BunSQLiteDatabase<Record<string, unknown>> }).db;
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function parseJsonStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function isSymbolRenderModel(value: unknown): value is SymbolRenderModel {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return (value as { kind?: unknown }).kind === "symbol";
}

function isFootprintRenderModel(value: unknown): value is FootprintRenderModel {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return (value as { kind?: unknown }).kind === "footprint";
}

function translatePreviewGraphic(
  graphic: SymbolRenderModel["graphics"][number],
  dx: number,
  dy: number,
): SymbolRenderModel["graphics"][number] {
  switch (graphic.kind) {
    case "line":
      return {
        ...graphic,
        a: { x: graphic.a.x + dx, y: graphic.a.y + dy },
        b: { x: graphic.b.x + dx, y: graphic.b.y + dy },
      };
    case "rect":
      return {
        ...graphic,
        x: graphic.x + dx,
        y: graphic.y + dy,
      };
    case "circle":
      return {
        ...graphic,
        center: {
          x: graphic.center.x + dx,
          y: graphic.center.y + dy,
        },
      };
    case "arc3":
      return {
        ...graphic,
        start: { x: graphic.start.x + dx, y: graphic.start.y + dy },
        mid: { x: graphic.mid.x + dx, y: graphic.mid.y + dy },
        end: { x: graphic.end.x + dx, y: graphic.end.y + dy },
      };
    case "polyline":
      return {
        ...graphic,
        points: graphic.points.map((point) => ({
          x: point.x + dx,
          y: point.y + dy,
        })),
      };
    case "bezier":
      return {
        ...graphic,
        points: [
          { x: graphic.points[0].x + dx, y: graphic.points[0].y + dy },
          { x: graphic.points[1].x + dx, y: graphic.points[1].y + dy },
          { x: graphic.points[2].x + dx, y: graphic.points[2].y + dy },
          { x: graphic.points[3].x + dx, y: graphic.points[3].y + dy },
        ],
      };
  }
}

function alignPreviewToPinSnapshot(
  preview: SymbolRenderModel,
  pins: LibrarySymbolPlacementSnapshot["pins"],
): SymbolRenderModel {
  if (preview.pins.length === 0 || pins.length === 0) {
    return preview;
  }

  const pairs = Math.min(preview.pins.length, pins.length);
  let deltaX = 0;
  let deltaY = 0;
  for (let index = 0; index < pairs; index += 1) {
    const previewPin = preview.pins[index];
    const localPin = pins[index];
    if (!previewPin || !localPin) {
      continue;
    }
    deltaX += previewPin.anchor.x - localPin.localPositionMm.x;
    deltaY += previewPin.anchor.y - localPin.localPositionMm.y;
  }

  const dx = deltaX / pairs;
  const dy = deltaY / pairs;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) {
    return preview;
  }

  return {
    ...preview,
    graphics: preview.graphics.map((graphic) =>
      translatePreviewGraphic(graphic, -dx, -dy),
    ),
    pins: preview.pins.map((pin) => ({
      ...pin,
      anchor: { x: pin.anchor.x - dx, y: pin.anchor.y - dy },
      bodyEnd: { x: pin.bodyEnd.x - dx, y: pin.bodyEnd.y - dy },
    })),
    labels: preview.labels.map((label) => ({
      ...label,
      at: { x: label.at.x - dx, y: label.at.y - dy },
    })),
    bounds: preview.bounds
      ? {
          minX: preview.bounds.minX - dx,
          minY: preview.bounds.minY - dy,
          maxX: preview.bounds.maxX - dx,
          maxY: preview.bounds.maxY - dy,
        }
      : null,
  };
}

function parseSymbolPlacementSnapshot(
  row: SymbolRow,
): LibrarySymbolPlacementSnapshot {
  const data = parseJsonObject(row.dataJson);
  const normalized = asRecord(data.normalized);

  // Require normalized data only - no legacy fallback
  if (!normalized) {
    throw new Error(
      `Symbol ${row.id} (${row.name}) missing normalized data. ` +
        `Only normalized-format symbols are supported for schematic placement.`
    );
  }

  const pinsRaw = Array.isArray(normalized.pins) ? normalized.pins : [];
  const previewRaw = normalized.preview;
  const provenance = asRecord(data.provenance);

  // Require valid preview for schematic rendering
  if (!isSymbolRenderModel(previewRaw)) {
    throw new Error(
      `Symbol ${row.id} (${row.name}) missing valid preview model. ` +
        `Symbol must have a renderable preview for schematic placement.`
    );
  }

  const pins = pinsRaw
    .map((entry) => {
      const pin = asRecord(entry);
      if (!pin) {
        return null;
      }
      const local = asRecord(pin.localPosition);
      const x = asNumber(local?.x);
      const y = asNumber(local?.y);
      if (x === null || y === null) {
        return null;
      }

      const originPinKey = asString(pin.originPinKey);
      const name = asString(pin.name);
      if (!originPinKey || !name) {
        return null;
      }

      return {
        originPinKey,
        number: asString(pin.number),
        name,
        localPositionMm: { x, y },
        electricalType: asString(pin.electricalType) ?? "passive",
        unit: asNumber(pin.unit) ?? 1,
      };
    })
    .filter((pin): pin is LibrarySymbolPlacementSnapshot["pins"][number] => pin !== null);

  return {
    symbolId: row.id,
    name: row.name,
    referencePrefix: asString(normalized.referencePrefix) ?? "",
    sourceHash: asString(provenance?.sourceHash),
    pins,
    preview: alignPreviewToPinSnapshot(previewRaw, pins),
  };
}

function parseFootprintPlacementSnapshot(
  row: FootprintRow,
): LibraryFootprintPlacementSnapshot {
  // TODO: Tighten footprint preview invariants when PCB editor starts consuming placement snapshots.
  // For now, footprint preview is optional (null allowed) since schematic-only workflow is the priority.
  const data = parseJsonObject(row.dataJson);
  const normalized = asRecord(data.normalized);
  const provenance = asRecord(data.provenance);
  const previewRaw = normalized?.preview;

  return {
    footprintId: row.id,
    name: row.name,
    mountType: asString(normalized?.mountType) ?? asString(data.mountType),
    sourceHash: asString(provenance?.sourceHash),
    preview: isFootprintRenderModel(previewRaw) ? previewRaw : null,
  };
}

function parseWarnings(value: unknown): LibraryPreviewWarning[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const warnings: LibraryPreviewWarning[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }
    const code = asString(record.code);
    const message = asString(record.message);
    if (!code || !message) {
      continue;
    }
    warnings.push({ code, message });
  }
  return warnings;
}

function parseSourceProvenance(
  data: Record<string, unknown>,
): LibrarySourceProvenance | null {
  const provenance = asRecord(data.provenance);
  if (!provenance) {
    return null;
  }
  return {
    sourceKind: asString(provenance.sourceKind),
    sourceFormat: asString(provenance.sourceFormat),
    fileName: asString(provenance.fileName),
    importedAt: asString(provenance.importedAt),
    sourceHash: asString(provenance.sourceHash),
  };
}

function parsePackageCode(value: unknown): {
  imperial: string | null;
  metric: string | null;
} {
  const record = asRecord(value);
  if (!record) {
    return {
      imperial: null,
      metric: null,
    };
  }
  return {
    imperial: asString(record.imperial),
    metric: asString(record.metric),
  };
}

export function mapComponent(row: ComponentRow): LibraryComponent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    symbolId: row.symbolId,
    footprintId: row.footprintId,
    tags: parseJsonStringArray(row.tagsJson),
  };
}

export function mapSymbol(row: SymbolRow): LibrarySymbol {
  return {
    id: row.id,
    name: row.name,
    data: parseJsonObject(row.dataJson),
  };
}

export function mapFootprint(row: FootprintRow): LibraryFootprint {
  return {
    id: row.id,
    name: row.name,
    data: parseJsonObject(row.dataJson),
  };
}

export function mapSymbolDetail(row: SymbolRow): LibrarySymbolDetail {
  const data = parseJsonObject(row.dataJson);
  const normalized = asRecord(data.normalized);

  // Only use normalized data - no legacy fallback
  const normalizedPins =
    normalized && Array.isArray(normalized.pins) ? normalized.pins : null;

  const preview = asRecord(normalized?.preview);

  return {
    id: row.id,
    name: row.name,
    referencePrefix: asString(normalized?.referencePrefix) ?? "",
    pinCount: normalizedPins ? normalizedPins.length : 0,
    warnings: parseWarnings(normalized?.warnings),
    preview,
    provenance: parseSourceProvenance(data),
  };
}

export function mapFootprintDetail(row: FootprintRow): LibraryFootprintDetail {
  const data = parseJsonObject(row.dataJson);
  const normalized = asRecord(data.normalized);
  const normalizedPads =
    normalized && Array.isArray(normalized.pads) ? normalized.pads : null;
  const previewCandidate = normalized?.preview ?? data.preview;
  const preview = asRecord(previewCandidate);

  const padCountFromNormalized = asNumber(normalized?.padCount);
  const mountType = asString(normalized?.mountType) ?? asString(data.mountType);

  return {
    id: row.id,
    name: row.name,
    mountType,
    padCount:
      padCountFromNormalized ?? (normalizedPads ? normalizedPads.length : 0),
    packageCode: parsePackageCode(normalized?.packageCode ?? data.packageCode),
    warnings: parseWarnings(normalized?.warnings ?? data.warnings),
    preview,
    provenance: parseSourceProvenance(data),
  };
}

export async function searchComponents(
  ctx: CoreBackendModuleContext,
  params: LibrarySearchParams,
): Promise<LibraryComponent[]> {
  const db = getDb(ctx);
  const query = params.query?.trim().toLowerCase() ?? "";
  const limit = Math.max(1, Math.min(100, params.limit ?? 25));
  const requestedTags = (params.tags ?? [])
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag, index, all) => tag.length > 0 && all.indexOf(tag) === index);
  const hasTagFilter = requestedTags.length > 0;

  let rows: ComponentRow[];
  if (query.length > 0) {
    const needle = `%${query}%`;
    const baseQuery = db
      .select()
      .from(components)
      .where(
        or(
          like(sql`lower(${components.name})`, needle),
          like(sql`lower(${components.description})`, needle),
        ),
      )
      .orderBy(components.name);
    rows = hasTagFilter ? await baseQuery.all() : await baseQuery.limit(limit);
  } else {
    const baseQuery = db.select().from(components).orderBy(components.name);
    rows = hasTagFilter ? await baseQuery.all() : await baseQuery.limit(limit);
  }

  const mapped = rows.map(mapComponent);
  if (!hasTagFilter) {
    return mapped;
  }
  const expected = new Set(requestedTags);
  const filtered = mapped.filter((component) => {
    const have = new Set(component.tags.map((tag) => tag.toLowerCase()));
    for (const tag of expected) {
      if (!have.has(tag)) {
        return false;
      }
    }
    return true;
  });
  return filtered.slice(0, limit);
}

export async function resolveComponent(
  ctx: CoreBackendModuleContext,
  componentId: string,
): Promise<LibraryComponent | null> {
  const db = getDb(ctx);
  const row = await db
    .select()
    .from(components)
    .where(eq(components.id, componentId))
    .get();
  return row ? mapComponent(row) : null;
}

export async function getComponentDetail(
  ctx: CoreBackendModuleContext,
  componentId: string,
): Promise<LibraryComponentDetail | null> {
  const db = getDb(ctx);
  const componentRow = await db
    .select()
    .from(components)
    .where(eq(components.id, componentId))
    .get();
  if (!componentRow) {
    return null;
  }

  const symbolRow = await db
    .select()
    .from(symbols)
    .where(eq(symbols.id, componentRow.symbolId))
    .get();
  const footprintRow = await db
    .select()
    .from(footprints)
    .where(eq(footprints.id, componentRow.footprintId))
    .get();
  if (!symbolRow || !footprintRow) {
    return null;
  }

  return {
    component: mapComponent(componentRow),
    symbol: mapSymbolDetail(symbolRow),
    footprint: mapFootprintDetail(footprintRow),
  };
}

export async function resolveComponentForPlacement(
  ctx: CoreBackendModuleContext,
  componentId: string,
): Promise<LibraryComponentPlacementDetail | null> {
  const db = getDb(ctx);
  const componentRow = await db
    .select()
    .from(components)
    .where(eq(components.id, componentId))
    .get();
  if (!componentRow) {
    return null;
  }

  const symbolRow = await db
    .select()
    .from(symbols)
    .where(eq(symbols.id, componentRow.symbolId))
    .get();
  const footprintRow = await db
    .select()
    .from(footprints)
    .where(eq(footprints.id, componentRow.footprintId))
    .get();
  if (!symbolRow || !footprintRow) {
    return null;
  }

  return {
    component: mapComponent(componentRow),
    symbol: parseSymbolPlacementSnapshot(symbolRow),
    footprint: parseFootprintPlacementSnapshot(footprintRow),
    resolvedAt: new Date().toISOString(),
  };
}

export async function getSymbol(
  ctx: CoreBackendModuleContext,
  symbolId: string,
): Promise<LibrarySymbol | null> {
  const db = getDb(ctx);
  const row = await db
    .select()
    .from(symbols)
    .where(eq(symbols.id, symbolId))
    .get();
  return row ? mapSymbol(row) : null;
}

export async function getFootprint(
  ctx: CoreBackendModuleContext,
  footprintId: string,
): Promise<LibraryFootprint | null> {
  const db = getDb(ctx);
  const row = await db
    .select()
    .from(footprints)
    .where(eq(footprints.id, footprintId))
    .get();
  return row ? mapFootprint(row) : null;
}

export interface DeleteComponentsResult {
  deletedComponents: number;
  deletedSymbols: number;
  deletedFootprints: number;
}

export function deleteComponents(
  ctx: CoreBackendModuleContext,
  ids: string[],
): DeleteComponentsResult {
  if (ids.length === 0) {
    return { deletedComponents: 0, deletedSymbols: 0, deletedFootprints: 0 };
  }

  const db = getDb(ctx);

  let summary: DeleteComponentsResult = {
    deletedComponents: 0,
    deletedSymbols: 0,
    deletedFootprints: 0,
  };

  db.transaction((tx) => {
    const transactionalDb = tx as typeof db;

    // Collect symbol/footprint IDs referenced by the components to delete
    const toDelete = transactionalDb
      .select({
        symbolId: components.symbolId,
        footprintId: components.footprintId,
      })
      .from(components)
      .where(inArray(components.id, ids))
      .all();

    const symbolIds = [...new Set(toDelete.map((r) => r.symbolId))];
    const footprintIds = [...new Set(toDelete.map((r) => r.footprintId))];

    // Delete the components
    transactionalDb
      .delete(components)
      .where(inArray(components.id, ids))
      .run();

    // Delete orphaned symbols (not referenced by any remaining component)
    let deletedSymbols = 0;
    for (const symbolId of symbolIds) {
      const still = transactionalDb
        .select({ id: components.id })
        .from(components)
        .where(eq(components.symbolId, symbolId))
        .get();
      if (!still) {
        transactionalDb.delete(symbols).where(eq(symbols.id, symbolId)).run();
        deletedSymbols++;
      }
    }

    // Delete orphaned footprints
    let deletedFootprints = 0;
    for (const footprintId of footprintIds) {
      const still = transactionalDb
        .select({ id: components.id })
        .from(components)
        .where(eq(components.footprintId, footprintId))
        .get();
      if (!still) {
        transactionalDb
          .delete(footprints)
          .where(eq(footprints.id, footprintId))
          .run();
        deletedFootprints++;
      }
    }

    summary = {
      deletedComponents: toDelete.length,
      deletedSymbols,
      deletedFootprints,
    };
  });

  return summary;
}

export function buildSdk(ctx: CoreBackendModuleContext): LibrarySDK {
  return {
    resolveComponent: (componentId) => resolveComponent(ctx, componentId),
    getSymbol: (symbolId) => getSymbol(ctx, symbolId),
    getFootprint: (footprintId) => getFootprint(ctx, footprintId),
    getComponentDetail: (componentId) => getComponentDetail(ctx, componentId),
    searchComponents: (params) => searchComponents(ctx, params),
    resolveComponentForPlacement: (componentId) =>
      resolveComponentForPlacement(ctx, componentId),
  };
}
