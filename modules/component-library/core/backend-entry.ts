import { success } from "../../../core/backend/runtime/http/response";
import type {
  CoreBackendModuleContext,
  CoreBackendModuleDefinition,
} from "../../../core/backend/runtime/modules/backend-module";
import type {
  ComponentLibraryFootprint,
  ComponentLibraryPart,
  ComponentLibrarySDK,
  ComponentLibrarySearchParams,
  ComponentLibrarySymbol,
} from "../../../core/contracts/modules/sdk";
import { MODULE_SDK_TOKENS } from "../../../core/contracts/modules/sdk-map";
import { ensureComponentLibrarySchema, getTypedDb } from "../backend/db/bridge";
import { ComponentRepository } from "../backend/db/repositories/component-repository";
import { ComponentController } from "../backend/handlers/component-controller";
import { QueryLogger } from "../backend/db/query-logger";

interface PartRow {
  id: string;
  name: string;
  description: string;
  symbol_id: string;
  footprint_id: string;
  tags_json: string;
}

interface SymbolRow {
  id: string;
  name: string;
  data_json: string;
}

interface FootprintRow {
  id: string;
  name: string;
  data_json: string;
}

async function ensureSchema(ctx: CoreBackendModuleContext): Promise<void> {
  await ctx.db.createTable(
    "symbols",
    "id TEXT PRIMARY KEY, name TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL",
  );
  await ctx.db.createTable(
    "footprints",
    "id TEXT PRIMARY KEY, name TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL",
  );
  await ctx.db.createTable(
    "parts",
    "id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, symbol_id TEXT NOT NULL, footprint_id TEXT NOT NULL, tags_json TEXT NOT NULL, created_at TEXT NOT NULL",
  );
  await ctx.db.execute(
    "CREATE INDEX IF NOT EXISTS idx_module_component_library_parts_name ON $table(name)",
    "parts",
  );

  const seededRows = await ctx.db.query<{ count: number }>(
    "SELECT COUNT(*) as count FROM $table",
    "parts",
  );
  if ((seededRows[0]?.count ?? 0) > 0) {
    return;
  }

  const now = new Date().toISOString();
  await ctx.db.transaction(async (db) => {
    await db.execute(
      "INSERT INTO $table(id, name, data_json, created_at) VALUES (?, ?, ?, ?)",
      "symbols",
      [
        "sym-resistor-2pin",
        "Resistor 2-pin",
        JSON.stringify({
          referencePrefix: "R",
          pins: [{ num: "1" }, { num: "2" }],
        }),
        now,
      ],
    );
    await db.execute(
      "INSERT INTO $table(id, name, data_json, created_at) VALUES (?, ?, ?, ?)",
      "symbols",
      [
        "sym-capacitor-2pin",
        "Capacitor 2-pin",
        JSON.stringify({
          referencePrefix: "C",
          pins: [{ num: "1" }, { num: "2" }],
        }),
        now,
      ],
    );

    await db.execute(
      "INSERT INTO $table(id, name, data_json, created_at) VALUES (?, ?, ?, ?)",
      "footprints",
      [
        "fp-0603",
        "0603 Metric",
        JSON.stringify({
          package: "0603",
          mountType: "smd",
        }),
        now,
      ],
    );
    await db.execute(
      "INSERT INTO $table(id, name, data_json, created_at) VALUES (?, ?, ?, ?)",
      "footprints",
      [
        "fp-0805",
        "0805 Metric",
        JSON.stringify({
          package: "0805",
          mountType: "smd",
        }),
        now,
      ],
    );

    await db.execute(
      "INSERT INTO $table(id, name, description, symbol_id, footprint_id, tags_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      "parts",
      [
        "part-r-10k-0603",
        "Resistor 10k",
        "General-purpose resistor",
        "sym-resistor-2pin",
        "fp-0603",
        JSON.stringify(["resistor", "0603", "passive"]),
        now,
      ],
    );
    await db.execute(
      "INSERT INTO $table(id, name, description, symbol_id, footprint_id, tags_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      "parts",
      [
        "part-c-100nf-0603",
        "Capacitor 100nF",
        "Decoupling capacitor",
        "sym-capacitor-2pin",
        "fp-0603",
        JSON.stringify(["capacitor", "0603", "passive"]),
        now,
      ],
    );
    await db.execute(
      "INSERT INTO $table(id, name, description, symbol_id, footprint_id, tags_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      "parts",
      [
        "part-c-10uf-0805",
        "Capacitor 10uF",
        "Bulk capacitor",
        "sym-capacitor-2pin",
        "fp-0805",
        JSON.stringify(["capacitor", "0805", "passive"]),
        now,
      ],
    );
  });
}

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
    symbolId: row.symbol_id,
    footprintId: row.footprint_id,
    tags: parseJsonStringArray(row.tags_json),
  };
}

function mapSymbol(row: SymbolRow): ComponentLibrarySymbol {
  return {
    id: row.id,
    name: row.name,
    data: parseJsonObject(row.data_json),
  };
}

function mapFootprint(row: FootprintRow): ComponentLibraryFootprint {
  return {
    id: row.id,
    name: row.name,
    data: parseJsonObject(row.data_json),
  };
}

async function searchParts(
  ctx: CoreBackendModuleContext,
  params: ComponentLibrarySearchParams,
): Promise<ComponentLibraryPart[]> {
  const query = params.query?.trim().toLowerCase() ?? "";
  const limit = Math.max(1, Math.min(100, params.limit ?? 25));
  const rows = query.length
    ? await ctx.db.query<PartRow>(
        "SELECT id, name, description, symbol_id, footprint_id, tags_json FROM $table WHERE lower(name) LIKE ? OR lower(description) LIKE ? ORDER BY name ASC LIMIT ?",
        "parts",
        [`%${query}%`, `%${query}%`, limit],
      )
    : await ctx.db.query<PartRow>(
        "SELECT id, name, description, symbol_id, footprint_id, tags_json FROM $table ORDER BY name ASC LIMIT ?",
        "parts",
        [limit],
      );

  const parts = rows.map(mapPart);
  if (!params.tags || params.tags.length === 0) {
    return parts;
  }
  const expectedTags = new Set(params.tags.map((tag) => tag.toLowerCase()));
  return parts.filter((part) => {
    const tags = new Set(part.tags.map((tag) => tag.toLowerCase()));
    for (const expected of expectedTags) {
      if (!tags.has(expected)) {
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
  const rows = await ctx.db.query<PartRow>(
    "SELECT id, name, description, symbol_id, footprint_id, tags_json FROM $table WHERE id = ? LIMIT 1",
    "parts",
    [partId],
  );
  const row = rows[0];
  return row ? mapPart(row) : null;
}

async function getSymbol(
  ctx: CoreBackendModuleContext,
  symbolId: string,
): Promise<ComponentLibrarySymbol | null> {
  const rows = await ctx.db.query<SymbolRow>(
    "SELECT id, name, data_json FROM $table WHERE id = ? LIMIT 1",
    "symbols",
    [symbolId],
  );
  const row = rows[0];
  return row ? mapSymbol(row) : null;
}

async function getFootprint(
  ctx: CoreBackendModuleContext,
  footprintId: string,
): Promise<ComponentLibraryFootprint | null> {
  const rows = await ctx.db.query<FootprintRow>(
    "SELECT id, name, data_json FROM $table WHERE id = ? LIMIT 1",
    "footprints",
    [footprintId],
  );
  const row = rows[0];
  return row ? mapFootprint(row) : null;
}

function createComponentLibrarySdk(
  ctx: CoreBackendModuleContext,
): ComponentLibrarySDK {
  return {
    resolvePart: async (partId) => resolvePart(ctx, partId),
    getSymbol: async (symbolId) => getSymbol(ctx, symbolId),
    getFootprint: async (footprintId) => getFootprint(ctx, footprintId),
    searchParts: async (params) => searchParts(ctx, params),
  };
}

export const backendModule: CoreBackendModuleDefinition = {
  id: "component-library",
  async onActivate(ctx) {
    const typedDb = getTypedDb(ctx);
    await ensureComponentLibrarySchema(typedDb);
    ctx.logger.info(
      "component-library: components + component_variants tables ready",
    );
  },
  async registerSdk(ctx) {
    await ensureSchema(ctx);
    if (!ctx.sdk.has(MODULE_SDK_TOKENS.COMPONENT_LIBRARY)) {
      ctx.sdk.registerValue(
        MODULE_SDK_TOKENS.COMPONENT_LIBRARY,
        createComponentLibrarySdk(ctx),
      );
    }
  },
  async registerRoutes(router, ctx) {
    await ensureSchema(ctx);

    // Real components endpoint backed by Drizzle ComponentRepository.
    // Schema init runs in onActivate; here we only mount handlers.
    const typedDb = getTypedDb(ctx);
    const queryLogger = new QueryLogger({ enableLogging: false });
    const componentRepo = new ComponentRepository(typedDb, queryLogger);
    const componentController = new ComponentController(componentRepo);

    router.post("/components", (routeCtx) =>
      componentController.createComponent(routeCtx),
    );
    router.get("/components", (routeCtx) =>
      componentController.listComponents(routeCtx),
    );

    router.get("/status", async () => {
      const counts = await ctx.db.query<{ count: number }>(
        "SELECT COUNT(*) as count FROM $table",
        "parts",
      );
      return success({
        moduleId: ctx.moduleId,
        namespace: ctx.manifest.namespace,
        status: "ready",
        partCount: counts[0]?.count ?? 0,
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
      const parts = await searchParts(ctx, { query, limit, tags });
      return success({ parts });
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

export default backendModule;
