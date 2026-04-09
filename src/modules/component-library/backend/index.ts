import { eq, like, or, sql } from "drizzle-orm";
import type {
  CoreBackendModuleContext,
  ModuleDefinition,
} from "../../../core/contracts/modules/backend-module";
import { MODULE_SDK_TOKENS } from "../../../core/contracts/modules/sdk-map";
import type {
  ComponentLibraryFootprint,
  ComponentLibraryPart,
  ComponentLibrarySDK,
  ComponentLibrarySearchParams,
  ComponentLibrarySymbol,
} from "../../../core/contracts/modules/sdk";
import type { DrizzleModuleDbClient } from "../../../core/backend/db/module-db-factory";
import { success } from "../../../core/backend/http/response";
import { footprints, parts, symbols } from "./schema";

type PartRow = typeof parts.$inferSelect;
type SymbolRow = typeof symbols.$inferSelect;
type FootprintRow = typeof footprints.$inferSelect;

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
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

function mapPart(row: PartRow): ComponentLibraryPart {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    symbolId: row.symbolId,
    footprintId: row.footprintId,
    tags: parseJsonStringArray(row.tagsJson),
  };
}

function mapSymbol(row: SymbolRow): ComponentLibrarySymbol {
  return {
    id: row.id,
    name: row.name,
    data: parseJsonObject(row.dataJson),
  };
}

function mapFootprint(row: FootprintRow): ComponentLibraryFootprint {
  return {
    id: row.id,
    name: row.name,
    data: parseJsonObject(row.dataJson),
  };
}

function getDb(ctx: CoreBackendModuleContext): DrizzleModuleDbClient["db"] {
  return (ctx.db as DrizzleModuleDbClient).db;
}

async function seedIfEmpty(ctx: CoreBackendModuleContext): Promise<void> {
  const db = getDb(ctx);
  const countRow = await db
    .select({ count: sql<number>`count(*)` })
    .from(parts)
    .get();
  if ((countRow?.count ?? 0) > 0) {
    return;
  }

  const now = new Date().toISOString();
  db.insert(symbols)
    .values([
      {
        id: "sym-resistor-2pin",
        name: "Resistor 2-pin",
        dataJson: JSON.stringify({
          referencePrefix: "R",
          pins: [{ num: "1" }, { num: "2" }],
        }),
        createdAt: now,
      },
      {
        id: "sym-capacitor-2pin",
        name: "Capacitor 2-pin",
        dataJson: JSON.stringify({
          referencePrefix: "C",
          pins: [{ num: "1" }, { num: "2" }],
        }),
        createdAt: now,
      },
    ])
    .run();

  db.insert(footprints)
    .values([
      {
        id: "fp-0603",
        name: "0603 Metric",
        dataJson: JSON.stringify({ package: "0603", mountType: "smd" }),
        createdAt: now,
      },
      {
        id: "fp-0805",
        name: "0805 Metric",
        dataJson: JSON.stringify({ package: "0805", mountType: "smd" }),
        createdAt: now,
      },
    ])
    .run();

  db.insert(parts)
    .values([
      {
        id: "part-r-10k-0603",
        name: "Resistor 10k",
        description: "General-purpose resistor",
        symbolId: "sym-resistor-2pin",
        footprintId: "fp-0603",
        tagsJson: JSON.stringify(["resistor", "0603", "passive"]),
        createdAt: now,
      },
      {
        id: "part-c-100nf-0603",
        name: "Capacitor 100nF",
        description: "Decoupling capacitor",
        symbolId: "sym-capacitor-2pin",
        footprintId: "fp-0603",
        tagsJson: JSON.stringify(["capacitor", "0603", "passive"]),
        createdAt: now,
      },
      {
        id: "part-c-10uf-0805",
        name: "Capacitor 10uF",
        description: "Bulk capacitor",
        symbolId: "sym-capacitor-2pin",
        footprintId: "fp-0805",
        tagsJson: JSON.stringify(["capacitor", "0805", "passive"]),
        createdAt: now,
      },
    ])
    .run();
}

async function searchParts(
  ctx: CoreBackendModuleContext,
  params: ComponentLibrarySearchParams,
): Promise<ComponentLibraryPart[]> {
  const db = getDb(ctx);
  const query = params.query?.trim().toLowerCase() ?? "";
  const limit = Math.max(1, Math.min(100, params.limit ?? 25));

  let rows: PartRow[];
  if (query.length > 0) {
    const needle = `%${query}%`;
    rows = await db
      .select()
      .from(parts)
      .where(
        or(
          like(sql`lower(${parts.name})`, needle),
          like(sql`lower(${parts.description})`, needle),
        ),
      )
      .orderBy(parts.name)
      .limit(limit);
  } else {
    rows = await db.select().from(parts).orderBy(parts.name).limit(limit);
  }

  const mapped = rows.map(mapPart);
  if (!params.tags || params.tags.length === 0) {
    return mapped;
  }
  const expected = new Set(params.tags.map((tag) => tag.toLowerCase()));
  return mapped.filter((part) => {
    const have = new Set(part.tags.map((tag) => tag.toLowerCase()));
    for (const tag of expected) {
      if (!have.has(tag)) {
        return false;
      }
    }
    return true;
  });
}

async function resolvePart(
  ctx: CoreBackendModuleContext,
  partId: string,
): Promise<ComponentLibraryPart | null> {
  const db = getDb(ctx);
  const row = await db.select().from(parts).where(eq(parts.id, partId)).get();
  return row ? mapPart(row) : null;
}

async function getSymbol(
  ctx: CoreBackendModuleContext,
  symbolId: string,
): Promise<ComponentLibrarySymbol | null> {
  const db = getDb(ctx);
  const row = await db
    .select()
    .from(symbols)
    .where(eq(symbols.id, symbolId))
    .get();
  return row ? mapSymbol(row) : null;
}

async function getFootprint(
  ctx: CoreBackendModuleContext,
  footprintId: string,
): Promise<ComponentLibraryFootprint | null> {
  const db = getDb(ctx);
  const row = await db
    .select()
    .from(footprints)
    .where(eq(footprints.id, footprintId))
    .get();
  return row ? mapFootprint(row) : null;
}

function buildSdk(ctx: CoreBackendModuleContext): ComponentLibrarySDK {
  return {
    resolvePart: (partId) => resolvePart(ctx, partId),
    getSymbol: (symbolId) => getSymbol(ctx, symbolId),
    getFootprint: (footprintId) => getFootprint(ctx, footprintId),
    searchParts: (params) => searchParts(ctx, params),
  };
}

export const definition: ModuleDefinition = {
  id: "component-library",

  async onActivate(ctx) {
    await seedIfEmpty(ctx);
    ctx.logger.info("component-library activated", {
      tablePrefix: ctx.db.tablePrefix,
    });
  },

  async registerSdk(ctx) {
    if (!ctx.sdk.has(MODULE_SDK_TOKENS.COMPONENT_LIBRARY)) {
      ctx.sdk.registerValue(MODULE_SDK_TOKENS.COMPONENT_LIBRARY, buildSdk(ctx));
    }
  },

  async registerRoutes(router, ctx) {
    router.get("/status", async () => {
      const db = getDb(ctx);
      const row = await db
        .select({ count: sql<number>`count(*)` })
        .from(parts)
        .get();
      return success({
        moduleId: ctx.moduleId,
        namespace: ctx.manifest.namespace,
        status: "ready",
        partCount: row?.count ?? 0,
      });
    });

    router.get("/parts", async (routeCtx) => {
      const query = routeCtx.query.get("q") ?? undefined;
      const limitRaw = routeCtx.query.get("limit");
      const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
      const tagsRaw = routeCtx.query.get("tags");
      const tags = tagsRaw
        ? tagsRaw
            .split(",")
            .map((value) => value.trim())
            .filter((value) => value.length > 0)
        : undefined;
      const result = await searchParts(ctx, { query, limit, tags });
      return success({ parts: result });
    });

    router.get("/parts/:partId", async (routeCtx) => {
      const part = await resolvePart(ctx, routeCtx.params.getOrThrow("partId"));
      if (!part) {
        return Response.json(
          { ok: false, error: "Part not found" },
          { status: 404 },
        );
      }
      return success({ part });
    });

    router.get("/symbols/:symbolId", async (routeCtx) => {
      const symbol = await getSymbol(
        ctx,
        routeCtx.params.getOrThrow("symbolId"),
      );
      if (!symbol) {
        return Response.json(
          { ok: false, error: "Symbol not found" },
          { status: 404 },
        );
      }
      return success({ symbol });
    });

    router.get("/footprints/:footprintId", async (routeCtx) => {
      const footprint = await getFootprint(
        ctx,
        routeCtx.params.getOrThrow("footprintId"),
      );
      if (!footprint) {
        return Response.json(
          { ok: false, error: "Footprint not found" },
          { status: 404 },
        );
      }
      return success({ footprint });
    });
  },
};

export default definition;
