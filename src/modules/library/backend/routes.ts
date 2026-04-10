import type {
  CoreBackendModuleContext,
  ModuleRouterHandle,
} from "../../../core/contracts/modules/backend-module";
import { success } from "../../../core/backend/http/response";
import { sql } from "drizzle-orm";
import {
  getDb,
  resolveComponent,
  getSymbol,
  getFootprint,
  searchComponents,
} from "./queries";
import { components } from "./schema";

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
    const limitRaw = routeCtx.query.get("limit");
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
    const tagsRaw = routeCtx.query.get("tags");
    const tags = tagsRaw
      ? tagsRaw
          .split(",")
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      : undefined;
    const result = await searchComponents(ctx, { query, limit, tags });
    return success({ components: result });
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
