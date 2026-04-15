import type {
  CoreBackendModuleContext,
  ModuleRouterHandle,
} from "../../../core/contracts/modules/backend-module";
import { sql } from "drizzle-orm";
import {
  NotFoundError,
  ValidationError,
} from "../../../core/backend/contracts/errors";
import {
  getDb,
  getComponentDetail,
  deleteComponents,
  resolveComponent,
  getSymbol,
  getFootprint,
  searchComponents,
} from "./queries";
import { components } from "./schema";
import { commitKicadImport } from "./import/commit-kicad";
import {
  commitGeneratedImport,
  type CommitGeneratedRequest,
} from "./import/commit-generated";
import { buildInspectResponse } from "./import/inspect-kicad";
import type { CommitKicadRequest, InspectKicadRequest } from "./import/types";

function success<T>(data: T, status = 200): Response {
  return Response.json({ ok: true, data }, { status });
}

async function parseJsonBody<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readStringField(
  record: Record<string, unknown>,
  key: string,
  fieldPath: string,
): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new ValidationError(`${fieldPath} must be a string`);
  }
  return value;
}

function parseDeleteIdsBody(value: unknown): string[] {
  if (!isRecord(value)) {
    throw new ValidationError("Request body must be an object");
  }
  const idsRaw = value.ids;
  if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
    throw new ValidationError("ids must be a non-empty array of strings");
  }

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const entry of idsRaw) {
    if (typeof entry !== "string") {
      throw new ValidationError("All ids must be strings");
    }
    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      throw new ValidationError("Component ids must not be empty");
    }
    if (seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    ids.push(trimmed);
  }

  if (ids.length === 0) {
    throw new ValidationError("ids must include at least one component id");
  }
  return ids;
}

function parseInspectRequestBody(value: unknown): InspectKicadRequest {
  if (!isRecord(value)) {
    throw new ValidationError("Request body must be an object");
  }

  const symbolLibraryRaw = value.symbolLibrary;
  if (!isRecord(symbolLibraryRaw)) {
    throw new ValidationError("symbolLibrary must be an object");
  }

  const footprintsRaw = value.footprints;
  if (!Array.isArray(footprintsRaw)) {
    throw new ValidationError("footprints must be an array");
  }

  const footprints = footprintsRaw.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new ValidationError(`footprints[${index}] must be an object`);
    }
    return {
      fileName: readStringField(
        entry,
        "fileName",
        `footprints[${index}].fileName`,
      ),
      content: readStringField(
        entry,
        "content",
        `footprints[${index}].content`,
      ),
    };
  });

  return {
    symbolLibrary: {
      fileName: readStringField(
        symbolLibraryRaw,
        "fileName",
        "symbolLibrary.fileName",
      ),
      content: readStringField(
        symbolLibraryRaw,
        "content",
        "symbolLibrary.content",
      ),
    },
    footprints,
  };
}

function parseCommitRequestBody(value: unknown): CommitKicadRequest {
  const inspect = parseInspectRequestBody(value);
  if (!isRecord(value)) {
    throw new ValidationError("Request body must be an object");
  }

  const selectionRaw = value.selection;
  if (!isRecord(selectionRaw)) {
    throw new ValidationError("selection must be an object");
  }

  const componentRaw = value.component;
  if (!isRecord(componentRaw)) {
    throw new ValidationError("component must be an object");
  }

  const footprintIdRaw = selectionRaw.footprintId;
  if (
    footprintIdRaw !== undefined &&
    footprintIdRaw !== null &&
    typeof footprintIdRaw !== "string"
  ) {
    throw new ValidationError("selection.footprintId must be a string or null");
  }

  return {
    ...inspect,
    selection: {
      symbolId: readStringField(selectionRaw, "symbolId", "selection.symbolId"),
      footprintId:
        typeof footprintIdRaw === "string" || footprintIdRaw === null
          ? footprintIdRaw
          : undefined,
    },
    component: {
      name: readStringField(componentRaw, "name", "component.name"),
      description: readStringField(
        componentRaw,
        "description",
        "component.description",
      ),
    },
  };
}

function parseCommitGeneratedBody(value: unknown): CommitGeneratedRequest {
  if (!isRecord(value)) {
    throw new ValidationError("Request body must be an object");
  }

  const symbolLibraryRaw = value.symbolLibrary;
  if (!isRecord(symbolLibraryRaw)) {
    throw new ValidationError("symbolLibrary must be an object");
  }

  const selectionRaw = value.selection;
  if (!isRecord(selectionRaw)) {
    throw new ValidationError("selection must be an object");
  }

  const generatedRaw = value.generatedFootprint;
  if (!isRecord(generatedRaw)) {
    throw new ValidationError("generatedFootprint must be an object");
  }

  const sourceRaw = generatedRaw.source;
  if (!isRecord(sourceRaw)) {
    throw new ValidationError("generatedFootprint.source must be an object");
  }

  const metadataRaw = generatedRaw.metadata;
  if (!isRecord(metadataRaw)) {
    throw new ValidationError("generatedFootprint.metadata must be an object");
  }

  const componentRaw = value.component;
  if (!isRecord(componentRaw)) {
    throw new ValidationError("component must be an object");
  }

  return {
    symbolLibrary: {
      fileName: readStringField(
        symbolLibraryRaw,
        "fileName",
        "symbolLibrary.fileName",
      ),
      content: readStringField(
        symbolLibraryRaw,
        "content",
        "symbolLibrary.content",
      ),
    },
    selection: {
      symbolId: readStringField(selectionRaw, "symbolId", "selection.symbolId"),
    },
    generatedFootprint: {
      source:
        sourceRaw as CommitGeneratedRequest["generatedFootprint"]["source"],
      metadata:
        metadataRaw as CommitGeneratedRequest["generatedFootprint"]["metadata"],
    },
    component: {
      name: readStringField(componentRaw, "name", "component.name"),
      description: readStringField(
        componentRaw,
        "description",
        "component.description",
      ),
    },
  };
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

  router.post("/components/delete", async (routeCtx) => {
    const body = await parseJsonBody<unknown>(routeCtx.req);
    const ids = parseDeleteIdsBody(body);
    const result = deleteComponents(ctx, ids);
    return success(result);
  });

  router.post("/imports/kicad/inspect", async (routeCtx) => {
    const body = parseInspectRequestBody(
      await parseJsonBody<unknown>(routeCtx.req),
    );
    return success(buildInspectResponse(body));
  });

  router.post("/imports/kicad", async (routeCtx) => {
    const body = parseCommitRequestBody(
      await parseJsonBody<unknown>(routeCtx.req),
    );
    const result = commitKicadImport(ctx, body);
    return success(result, result.reused ? 200 : 201);
  });

  router.post("/imports/generated", async (routeCtx) => {
    const body = parseCommitGeneratedBody(
      await parseJsonBody<unknown>(routeCtx.req),
    );
    const result = commitGeneratedImport(ctx, body);
    return success(result, 201);
  });

  router.get("/components/:componentId", async (routeCtx) => {
    const component = await resolveComponent(
      ctx,
      routeCtx.params.getOrThrow("componentId"),
    );
    if (!component) {
      throw new NotFoundError("Component not found");
    }
    return success({ component });
  });

  router.get("/components/:componentId/detail", async (routeCtx) => {
    const detail = await getComponentDetail(
      ctx,
      routeCtx.params.getOrThrow("componentId"),
    );
    if (!detail) {
      throw new NotFoundError("Component detail not found");
    }
    return success({ detail });
  });

  router.get("/symbols/:symbolId", async (routeCtx) => {
    const symbol = await getSymbol(ctx, routeCtx.params.getOrThrow("symbolId"));
    if (!symbol) {
      throw new NotFoundError("Symbol not found");
    }
    return success({ symbol });
  });

  router.get("/footprints/:footprintId", async (routeCtx) => {
    const footprint = await getFootprint(
      ctx,
      routeCtx.params.getOrThrow("footprintId"),
    );
    if (!footprint) {
      throw new NotFoundError("Footprint not found");
    }
    return success({ footprint });
  });
}
