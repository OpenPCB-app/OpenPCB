import { success } from "../../../core/backend/runtime/http/response";
import type {
  CoreBackendModuleContext,
  CoreBackendModuleDefinition,
} from "../../../core/backend/runtime/modules/backend-module";
import type { ComponentLibrarySDK } from "../../../core/contracts/modules/sdk";
import { MODULE_SDK_TOKENS } from "../../../core/contracts/modules/sdk-map";

interface DesignRow {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  revision: number;
  created_at: string;
}

interface EntityRow {
  id: string;
  design_id: string;
  kind: string;
  ref: string | null;
  part_id: string | null;
  net_name: string | null;
  payload_json: string;
}

function parsePayload(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // noop
  }
  return {};
}

async function ensureSchema(ctx: CoreBackendModuleContext): Promise<void> {
  await ctx.db.createTable(
    "designs",
    "id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, project_id TEXT NOT NULL, name TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL",
  );
  await ctx.db.createTable(
    "entities",
    "id TEXT PRIMARY KEY, design_id TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT, part_id TEXT, net_name TEXT, payload_json TEXT NOT NULL",
  );

  const countRows = await ctx.db.query<{ count: number }>(
    "SELECT COUNT(*) as count FROM $table",
    "designs",
  );
  if ((countRows[0]?.count ?? 0) > 0) {
    return;
  }

  const createdAt = new Date().toISOString();
  await ctx.db.transaction(async (db) => {
    await db.execute(
      "INSERT INTO $table(id, workspace_id, project_id, name, revision, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      "designs",
      ["design-demo-1", "workspace-demo", "project-demo", "Demo Board", 1, createdAt],
    );

    const rows: Array<[string, string, string | null, string | null, string | null, Record<string, unknown>]> = [
      ["entity-r1", "component", "R1", "part-r-10k-0603", "NET_VCC", { x: 10, y: 8 }],
      ["entity-c1", "component", "C1", "part-c-100nf-0603", "NET_VCC", { x: 12, y: 8 }],
      ["entity-c2", "component", "C2", "part-c-10uf-0805", "NET_GND", { x: 12, y: 10 }],
      ["entity-wire-1", "wire", null, null, "NET_VCC", { path: [[10, 8], [12, 8]] }],
    ];

    for (const [id, kind, ref, partId, netName, payload] of rows) {
      await db.execute(
        "INSERT INTO $table(id, design_id, kind, ref, part_id, net_name, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
        "entities",
        [id, "design-demo-1", kind, ref, partId, netName, JSON.stringify(payload)],
      );
    }
  });
}

function getComponentLibrarySdk(ctx: CoreBackendModuleContext): ComponentLibrarySDK {
  if (!ctx.sdk.has(MODULE_SDK_TOKENS.COMPONENT_LIBRARY)) {
    throw new Error("ComponentLibrarySDK token is not registered");
  }
  return ctx.sdk.resolve<ComponentLibrarySDK>(MODULE_SDK_TOKENS.COMPONENT_LIBRARY);
}

async function getDesignById(
  ctx: CoreBackendModuleContext,
  designId: string,
): Promise<DesignRow | null> {
  const rows = await ctx.db.query<DesignRow>(
    "SELECT id, workspace_id, project_id, name, revision, created_at FROM $table WHERE id = ? LIMIT 1",
    "designs",
    [designId],
  );
  return rows[0] ?? null;
}

export const backendModule: CoreBackendModuleDefinition = {
  id: "designer",
  async registerRoutes(router, ctx) {
    await ensureSchema(ctx);

    router.get("/status", async () => {
      const counts = await ctx.db.query<{ count: number }>(
        "SELECT COUNT(*) as count FROM $table",
        "designs",
      );
      return success({
        moduleId: ctx.moduleId,
        namespace: ctx.manifest.namespace,
        status: "ready",
        designCount: counts[0]?.count ?? 0,
        capabilities: {
          hasComponentLibrarySdk: ctx.sdk.has(MODULE_SDK_TOKENS.COMPONENT_LIBRARY),
          hasProjectsCapability: ctx.sdk.has(MODULE_SDK_TOKENS.CORE_PROJECTS),
        },
      });
    });

    router.get("/projects", async (routeCtx) => {
      const workspaceId = routeCtx.query.get("workspaceId") ?? "workspace-demo";
      const projects = await ctx.core.projects.list({ workspaceId, status: "all" });
      return success({ projects });
    });

    router.get("/designs", async (routeCtx) => {
      const workspaceId = routeCtx.query.get("workspaceId");
      const projectId = routeCtx.query.get("projectId");
      let sql = "SELECT id, workspace_id, project_id, name, revision, created_at FROM $table";
      const filters: string[] = [];
      const params: unknown[] = [];
      if (workspaceId) {
        filters.push("workspace_id = ?");
        params.push(workspaceId);
      }
      if (projectId) {
        filters.push("project_id = ?");
        params.push(projectId);
      }
      if (filters.length > 0) {
        sql += ` WHERE ${filters.join(" AND ")}`;
      }
      sql += " ORDER BY created_at DESC";
      const designs = await ctx.db.query<DesignRow>(sql, "designs", params);
      return success({ designs });
    });

    router.get("/designs/:designId", async (routeCtx) => {
      const design = await getDesignById(ctx, routeCtx.params.getOrThrow("designId"));
      if (!design) {
        return Response.json({ ok: false, error: "Design not found" }, { status: 404 });
      }
      return success({ design });
    });

    router.get("/designs/:designId/entities", async (routeCtx) => {
      const designId = routeCtx.params.getOrThrow("designId");
      const design = await getDesignById(ctx, designId);
      if (!design) {
        return Response.json({ ok: false, error: "Design not found" }, { status: 404 });
      }
      const rows = await ctx.db.query<EntityRow>(
        "SELECT id, design_id, kind, ref, part_id, net_name, payload_json FROM $table WHERE design_id = ? ORDER BY id ASC",
        "entities",
        [designId],
      );

      const componentLibrarySdk = getComponentLibrarySdk(ctx);
      const entities = await Promise.all(
        rows.map(async (row) => {
          const part = row.part_id
            ? await componentLibrarySdk.resolvePart(row.part_id)
            : null;
          return {
            id: row.id,
            kind: row.kind,
            ref: row.ref,
            partId: row.part_id,
            netName: row.net_name,
            payload: parsePayload(row.payload_json),
            part,
          };
        }),
      );
      return success({ entities });
    });

    router.get("/designs/:designId/netlist", async (routeCtx) => {
      const designId = routeCtx.params.getOrThrow("designId");
      const design = await getDesignById(ctx, designId);
      if (!design) {
        return Response.json({ ok: false, error: "Design not found" }, { status: 404 });
      }
      const rows = await ctx.db.query<EntityRow>(
        "SELECT id, design_id, kind, ref, part_id, net_name, payload_json FROM $table WHERE design_id = ? ORDER BY id ASC",
        "entities",
        [designId],
      );

      const nets = new Map<string, Array<{ entityId: string; ref: string | null; kind: string }>>();
      for (const row of rows) {
        if (!row.net_name) {
          continue;
        }
        const existing = nets.get(row.net_name) ?? [];
        existing.push({
          entityId: row.id,
          ref: row.ref,
          kind: row.kind,
        });
        nets.set(row.net_name, existing);
      }

      const netlist = [...nets.entries()]
        .map(([name, members]) => ({
          name,
          memberCount: members.length,
          members,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return success({ netlist });
    });
  },
};

export default backendModule;
