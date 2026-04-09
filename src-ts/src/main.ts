import { corsPreflightResponse, isTrustedOrigin, withCorsHeaders } from "./transport/http/helpers";

type StartupLicenseState = "active" | "grace" | "restricted" | "blocked";

type WorkspaceRecord = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: Record<string, unknown>;
};

type ProjectRecord = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  icon: string | null;
  color: string | null;
  sortOrder: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

type DesignRecord = {
  id: string;
  workspaceId: string;
  projectId: string | null;
  name: string;
  description: string | null;
  sortOrder: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "127.0.0.1";

const STARTUP_CONTRACT_VERSION = Number.parseInt(
  process.env.OPENPCB_STARTUP_CONTRACT_VERSION || "1",
  10,
);

const STARTUP_LICENSE_STATE: StartupLicenseState =
  process.env.NODE_ENV === "development"
    ? "active"
    : ((process.env.OPENPCB_STARTUP_LICENSE_STATE as StartupLicenseState) || "blocked");

const STARTUP_LICENSE_CODE =
  process.env.NODE_ENV === "development"
    ? "DEV_MODE_BYPASS"
    : process.env.OPENPCB_STARTUP_LICENSE_CODE || "STARTUP_LICENSE_MISSING";

const nowIso = () => new Date().toISOString();

const defaultWorkspaceId = "workspace-core";

const workspaces: WorkspaceRecord[] = [
  {
    id: defaultWorkspaceId,
    name: "OpenPCB",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    settings: {},
  },
];

const projects: ProjectRecord[] = [];
const designs: DesignRecord[] = [];

function ok<T>(data: T): Response {
  return Response.json({ ok: true, data });
}

function badRequest(message: string): Response {
  return Response.json(
    { ok: false, error: { code: "BAD_REQUEST", message } },
    { status: 400 },
  );
}

function notFound(message: string): Response {
  return Response.json(
    { ok: false, error: { code: "NOT_FOUND", message } },
    { status: 404 },
  );
}

function parseJson<T>(req: Request): Promise<T> {
  return req.json() as Promise<T>;
}

const server = Bun.serve({
  hostname: HOST,
  port: PORT,
  async fetch(req: Request): Promise<Response> {
    const origin = req.headers.get("origin");
    if (!isTrustedOrigin(origin)) {
      return withCorsHeaders(
        Response.json(
          { ok: false, error: { code: "CORS_FORBIDDEN", message: "Origin not allowed" } },
          { status: 403 },
        ),
        origin,
      );
    }

    if (req.method === "OPTIONS") {
      return corsPreflightResponse(origin);
    }

    const url = new URL(req.url);
    const pathname = url.pathname;

    try {
      if (req.method === "GET" && pathname === "/api") {
        return withCorsHeaders(
          Response.json({
            name: "OpenPCB Core",
            version: "core-only",
            startupContractVersion: Number.isInteger(STARTUP_CONTRACT_VERSION)
              ? STARTUP_CONTRACT_VERSION
              : 1,
            startupLicenseState: STARTUP_LICENSE_STATE,
            startupLicenseCode: STARTUP_LICENSE_CODE,
            loadedModules: ["ai-service"],
            endpoints: {
              health: "/api/health",
              workspaces: "/api/workspaces",
              projects: "/api/projects",
              designs: "/api/designs",
            },
          }),
          origin,
        );
      }

      if (req.method === "GET" && pathname === "/api/health") {
        return withCorsHeaders(ok({ status: "ok" }), origin);
      }

      if (req.method === "GET" && pathname === "/api/workspaces") {
        return withCorsHeaders(ok({ workspaces }), origin);
      }

      if (req.method === "POST" && pathname === "/api/workspaces") {
        const body = await parseJson<{ name?: string; settings?: Record<string, unknown> }>(req);
        if (!body.name || !body.name.trim()) {
          return withCorsHeaders(badRequest("Workspace name is required"), origin);
        }
        const now = nowIso();
        const workspace: WorkspaceRecord = {
          id: crypto.randomUUID(),
          name: body.name.trim(),
          settings: body.settings || {},
          createdAt: now,
          updatedAt: now,
        };
        workspaces.push(workspace);
        return withCorsHeaders(ok({ workspace }), origin);
      }

      if (pathname.startsWith("/api/workspaces/")) {
        const id = decodeURIComponent(pathname.substring("/api/workspaces/".length));
        const idx = workspaces.findIndex((w) => w.id === id);
        if (idx < 0) {
          return withCorsHeaders(notFound(`Workspace ${id} not found`), origin);
        }
        if (req.method === "GET") {
          return withCorsHeaders(ok({ workspace: workspaces[idx] }), origin);
        }
        if (req.method === "PATCH") {
          const body = await parseJson<{ name?: string; settings?: Record<string, unknown> }>(req);
          const existing = workspaces[idx] as WorkspaceRecord;
          const next = {
            ...existing,
            name: body.name?.trim() || existing.name,
            settings: body.settings ?? existing.settings,
            updatedAt: nowIso(),
          };
          workspaces[idx] = next;
          return withCorsHeaders(ok({ workspace: next }), origin);
        }
        if (req.method === "DELETE") {
          workspaces.splice(idx, 1);
          return withCorsHeaders(ok({ deleted: true }), origin);
        }
      }

      if (req.method === "GET" && pathname === "/api/projects") {
        const workspaceId = url.searchParams.get("workspaceId");
        const filtered = workspaceId
          ? projects.filter((project) => project.workspaceId === workspaceId)
          : projects;
        return withCorsHeaders(ok({ projects: filtered }), origin);
      }

      if (req.method === "POST" && pathname === "/api/projects") {
        const body = await parseJson<{
          workspaceId?: string;
          name?: string;
          description?: string;
          icon?: string;
          color?: string;
        }>(req);
        if (!body.workspaceId || !body.name?.trim()) {
          return withCorsHeaders(badRequest("workspaceId and name are required"), origin);
        }
        const now = nowIso();
        const project: ProjectRecord = {
          id: crypto.randomUUID(),
          workspaceId: body.workspaceId,
          name: body.name.trim(),
          description: body.description ?? null,
          status: "active",
          icon: body.icon ?? null,
          color: body.color ?? null,
          sortOrder: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        projects.push(project);
        return withCorsHeaders(ok({ project }), origin);
      }

      if (pathname.startsWith("/api/projects/")) {
        const id = decodeURIComponent(pathname.substring("/api/projects/".length));
        const idx = projects.findIndex((p) => p.id === id);
        if (idx < 0) {
          return withCorsHeaders(notFound(`Project ${id} not found`), origin);
        }
        if (req.method === "GET") {
          return withCorsHeaders(ok({ project: projects[idx] }), origin);
        }
        if (req.method === "PATCH") {
          const body = await parseJson<Record<string, unknown>>(req);
          const existing = projects[idx] as ProjectRecord;
          const next = {
            ...existing,
            ...(body as Partial<ProjectRecord>),
            updatedAt: nowIso(),
          };
          projects[idx] = next;
          return withCorsHeaders(ok({ project: next }), origin);
        }
        if (req.method === "DELETE") {
          projects.splice(idx, 1);
          return withCorsHeaders(ok({ deleted: true }), origin);
        }
      }

      if (req.method === "GET" && pathname === "/api/designs") {
        const workspaceId = url.searchParams.get("workspaceId");
        const projectId = url.searchParams.get("projectId");
        const filtered = designs.filter((design) => {
          if (workspaceId && design.workspaceId !== workspaceId) {
            return false;
          }
          if (projectId === "null") {
            return design.projectId === null;
          }
          if (projectId && projectId !== "null") {
            return design.projectId === projectId;
          }
          return true;
        });
        return withCorsHeaders(ok({ designs: filtered }), origin);
      }

      if (req.method === "POST" && pathname === "/api/designs") {
        const body = await parseJson<{
          workspaceId?: string;
          projectId?: string | null;
          name?: string;
          description?: string;
        }>(req);
        if (!body.workspaceId || !body.name?.trim()) {
          return withCorsHeaders(badRequest("workspaceId and name are required"), origin);
        }
        const now = nowIso();
        const design: DesignRecord = {
          id: crypto.randomUUID(),
          workspaceId: body.workspaceId,
          projectId: body.projectId ?? null,
          name: body.name.trim(),
          description: body.description ?? null,
          sortOrder: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        designs.push(design);
        return withCorsHeaders(ok({ design }), origin);
      }

      if (pathname.startsWith("/api/designs/") && pathname.includes("/sheets/")) {
        if (req.method === "PUT") {
          return withCorsHeaders(ok({ saved: true }), origin);
        }
      }

      if (pathname.startsWith("/api/designs/")) {
        const id = decodeURIComponent(pathname.substring("/api/designs/".length));
        const idx = designs.findIndex((d) => d.id === id);
        if (idx < 0) {
          return withCorsHeaders(notFound(`Design ${id} not found`), origin);
        }
        if (req.method === "PATCH") {
          const body = await parseJson<Record<string, unknown>>(req);
          const existing = designs[idx] as DesignRecord;
          const next = {
            ...existing,
            ...(body as Partial<DesignRecord>),
            updatedAt: nowIso(),
          };
          designs[idx] = next;
          return withCorsHeaders(ok({ design: next }), origin);
        }
        if (req.method === "DELETE") {
          designs.splice(idx, 1);
          return withCorsHeaders(ok({ deleted: true }), origin);
        }
      }

      return withCorsHeaders(
        Response.json(
          { ok: false, error: { code: "NOT_FOUND", message: "Route not found" } },
          { status: 404 },
        ),
        origin,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown server error";
      return withCorsHeaders(
        Response.json(
          { ok: false, error: { code: "INTERNAL_ERROR", message } },
          { status: 500 },
        ),
        origin,
      );
    }
  },
});

console.log(`[Core] Server running on http://${HOST}:${PORT}`);
