import type {
  CoreBackendModuleContext,
  ModuleRouterHandle,
} from "../../../core/contracts/modules/backend-module";
import { sql } from "drizzle-orm";
import {
  getDb,
  getComponentDetail,
  resolveComponent,
  getSymbol,
  getFootprint,
  searchComponents,
} from "./queries";
import { components } from "./schema";
import { commitKicadImport } from "./import/commit-kicad";
import {
  buildInspectResponse,
  ImportValidationError,
} from "./import/inspect-kicad";
import type { CommitKicadRequest, InspectKicadRequest } from "./import/types";

function success<T>(data: T, status = 200): Response {
  return Response.json({ ok: true, data }, { status });
}

async function parseJsonBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ImportValidationError("Request body must be valid JSON");
  }
}

function importErrorResponse(error: unknown): Response {
  if (error instanceof ImportValidationError) {
    return Response.json({ ok: false, error: error.message }, { status: 400 });
  }
  if (error instanceof Error) {
    return Response.json({ ok: false, error: error.message }, { status: 400 });
  }
  return Response.json({ ok: false, error: "Invalid import payload" }, { status: 400 });
}

function parseLimit(limitRaw: string | null): number | undefined {
  if (!limitRaw) {
    return undefined;
  }
  const parsed = Number.parseInt(limitRaw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function parseTags(tagsRaw: string | null): string[] | undefined {
  if (!tagsRaw) {
    return undefined;
  }
  const seen = new Set<string>();
  const tags = tagsRaw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0)
    .filter((value) => {
      if (seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
  return tags.length > 0 ? tags : undefined;
}

export function registerRoutes(
  router: ModuleRouterHandle,
  ctx: CoreBackendModuleContext,
): void {
  router.get("/status", async () => {
    const db = getDb(ctx);
    const row = await db
      .select({ count: sql<number>`count(*)` })
      .from(components)
      .get();
    return success({
      moduleId: ctx.moduleId,
      namespace: ctx.manifest.namespace,
      status: "ready",
      componentCount: row?.count ?? 0,
    });
  });

  router.get("/components", async (routeCtx) => {
    const query = routeCtx.query.get("q") ?? undefined;
    const limit = parseLimit(routeCtx.query.get("limit"));
    const tags = parseTags(routeCtx.query.get("tags"));
    const result = await searchComponents(ctx, { query, limit, tags });
    return success({ components: result });
  });

  router.post("/imports/kicad/inspect", async (routeCtx) => {
    try {
      const body = await parseJsonBody<InspectKicadRequest>(routeCtx.req);
      return success(buildInspectResponse(body));
    } catch (error) {
      return importErrorResponse(error);
    }
  });

  router.post("/imports/kicad", async (routeCtx) => {
    try {
      const body = await parseJsonBody<CommitKicadRequest>(routeCtx.req);
      const result = commitKicadImport(ctx, body);
      return success(result, result.reused ? 200 : 201);
    } catch (error) {
      return importErrorResponse(error);
    }
  });

  router.get("/components/:componentId", async (routeCtx) => {
    const component = await resolveComponent(
      ctx,
      routeCtx.params.getOrThrow("componentId"),
    );
    if (!component) {
      return Response.json(
        { ok: false, error: "Component not found" },
        { status: 404 },
      );
    }
    return success({ component });
  });

  router.get("/components/:componentId/detail", async (routeCtx) => {
    const detail = await getComponentDetail(
      ctx,
      routeCtx.params.getOrThrow("componentId"),
    );
    if (!detail) {
      return Response.json(
        { ok: false, error: "Component detail not found" },
        { status: 404 },
      );
    }
    return success({ detail });
  });

  router.get("/symbols/:symbolId", async (routeCtx) => {
    const symbol = await getSymbol(ctx, routeCtx.params.getOrThrow("symbolId"));
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
}
