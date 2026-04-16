import { eq, inArray, like, or, sql } from "drizzle-orm";
import type { CoreBackendModuleContext } from "../../../core/contracts/modules/backend-module";
import type {
  LibraryComponent,
  LibraryComponentDetail,
  LibraryFootprint,
  LibraryFootprintDetail,
  LibraryPreviewWarning,
  LibrarySearchParams,
  LibrarySourceProvenance,
  LibrarySDK,
  LibrarySymbol,
  LibrarySymbolDetail,
} from "../../../core/contracts/modules/sdk";
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
  const fallbackPins = Array.isArray(data.pins) ? data.pins : [];
  const normalizedPins =
    normalized && Array.isArray(normalized.pins) ? normalized.pins : null;

  const previewCandidate = normalized?.preview ?? data.preview;
  const preview = asRecord(previewCandidate);

  return {
    id: row.id,
    name: row.name,
    referencePrefix:
      asString(normalized?.referencePrefix) ?? asString(data.referencePrefix),
    pinCount: normalizedPins ? normalizedPins.length : fallbackPins.length,
    warnings: parseWarnings(normalized?.warnings ?? data.warnings),
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
  };
}
