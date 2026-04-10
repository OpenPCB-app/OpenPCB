import { eq, like, or, sql } from "drizzle-orm";
import type { CoreBackendModuleContext } from "../../../core/contracts/modules/backend-module";
import type {
  LibraryComponent,
  LibraryFootprint,
  LibrarySearchParams,
  LibrarySDK,
  LibrarySymbol,
} from "../../../core/contracts/modules/sdk";
import type { DrizzleModuleDbClient } from "../../../core/backend/db/module-db-factory";
import { components, footprints, symbols } from "./schema";

export type ComponentRow = typeof components.$inferSelect;
export type SymbolRow = typeof symbols.$inferSelect;
export type FootprintRow = typeof footprints.$inferSelect;

export function getDb(
  ctx: CoreBackendModuleContext,
): DrizzleModuleDbClient["db"] {
  return (ctx.db as DrizzleModuleDbClient).db;
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

export async function searchComponents(
  ctx: CoreBackendModuleContext,
  params: LibrarySearchParams,
): Promise<LibraryComponent[]> {
  const db = getDb(ctx);
  const query = params.query?.trim().toLowerCase() ?? "";
  const limit = Math.max(1, Math.min(100, params.limit ?? 25));

  let rows: ComponentRow[];
  if (query.length > 0) {
    const needle = `%${query}%`;
    rows = await db
      .select()
      .from(components)
      .where(
        or(
          like(sql`lower(${components.name})`, needle),
          like(sql`lower(${components.description})`, needle),
        ),
      )
      .orderBy(components.name)
      .limit(limit);
  } else {
    rows = await db
      .select()
      .from(components)
      .orderBy(components.name)
      .limit(limit);
  }

  const mapped = rows.map(mapComponent);
  if (!params.tags || params.tags.length === 0) {
    return mapped;
  }
  const expected = new Set(params.tags.map((tag) => tag.toLowerCase()));
  return mapped.filter((component) => {
    const have = new Set(component.tags.map((tag) => tag.toLowerCase()));
    for (const tag of expected) {
      if (!have.has(tag)) {
        return false;
      }
    }
    return true;
  });
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

export function buildSdk(ctx: CoreBackendModuleContext): LibrarySDK {
  return {
    resolveComponent: (componentId) => resolveComponent(ctx, componentId),
    getSymbol: (symbolId) => getSymbol(ctx, symbolId),
    getFootprint: (footprintId) => getFootprint(ctx, footprintId),
    searchComponents: (params) => searchComponents(ctx, params),
  };
}
