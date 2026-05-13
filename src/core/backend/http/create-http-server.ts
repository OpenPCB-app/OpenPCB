import { existsSync } from "node:fs";
import { join } from "node:path";
import { DiagnosticsController } from "../controllers/diagnostics-controller";
import { HealthController } from "../controllers/health-controller";
import { ModuleRuntimeDiagnosticsController } from "../controllers/module-runtime-diagnostics-controller";
import type { RequestContext, Middleware } from "./request-context";
import { HttpRouter } from "../router/http-router";
import { RouteParams } from "../router/route-params";
import type { HttpServerConfig } from "./server-config";
import { resolveAllowedOrigins } from "./cors";
import { createCorsMiddleware } from "../middleware/cors-middleware";
import { createErrorMiddleware } from "../middleware/error-middleware";
import { requestLoggingMiddleware } from "../middleware/request-logging-middleware";
import { requestIdMiddleware } from "../middleware/request-id-middleware";

function resolveStaticDir(): string | null {
  const fromEnv = process.env.OPENPCB_STATIC_DIR;
  if (fromEnv) {
    const resolved = join(fromEnv);
    if (existsSync(resolved)) return resolved;
    return null;
  }
  if (process.env.NODE_ENV === "production") {
    const resourcesPath = (process as unknown as Record<string, unknown>).resourcesPath as string | undefined;
    if (resourcesPath) {
      const candidate = join(resourcesPath, "frontend-dist");
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

async function serveStaticFile(
  staticDir: string,
  pathname: string,
): Promise<Response | null> {
  const filePath = join(staticDir, pathname);
  if (!filePath.startsWith(staticDir)) {
    return null;
  }
  const file = Bun.file(filePath);
  if (await file.exists()) {
    return new Response(file);
  }
  return null;
}

function serveSpaFallback(staticDir: string): Response {
  const indexPath = join(staticDir, "index.html");
  const file = Bun.file(indexPath);
  return new Response(file, {
    headers: { "content-type": "text/html" },
  });
}

export interface RuntimeServer {
  fetch(req: Request): Promise<Response>;
  start(): ReturnType<typeof Bun.serve>;
}

function applyMiddlewares(
  ctx: RequestContext,
  middlewares: Middleware[],
  handler: () => Promise<Response>,
): Promise<Response> {
  let index = -1;
  const dispatch = async (current: number): Promise<Response> => {
    if (current <= index) {
      throw new Error("next() called multiple times");
    }
    index = current;
    const middleware = middlewares[current];
    if (!middleware) {
      return handler();
    }
    return middleware(ctx, () => dispatch(current + 1));
  };
  return dispatch(0);
}

export function createHttpServer(config: HttpServerConfig): RuntimeServer {
  const router = new HttpRouter();
  const diagnosticsController = new DiagnosticsController(config.diagnosticsStore);
  const moduleRuntimeDiagnosticsController = config.moduleRuntime
    ? new ModuleRuntimeDiagnosticsController(config.moduleRuntime)
    : null;

  router.get("/api/health", async () => HealthController.check());
  router.get("/api/diagnostics", async () => diagnosticsController.snapshot());
  router.get("/api/modules/registry", async () => {
    if (!config.moduleRuntime) {
      return Response.json({
        modules: [],
        loadedModules: [],
      });
    }
    return Response.json(config.moduleRuntime.snapshot());
  });
  if (moduleRuntimeDiagnosticsController && process.env.OPENPCB_DEBUG_DIAGNOSTICS === "true") {
    router.get("/api/diagnostics/debug/modules", async () =>
      moduleRuntimeDiagnosticsController.snapshot(),
    );
  }
  const allowedOrigins = resolveAllowedOrigins({ allowedOrigins: config.allowedOrigins });
  const middlewares: Middleware[] = [
    requestIdMiddleware,
    requestLoggingMiddleware,
    createCorsMiddleware(allowedOrigins),
    createErrorMiddleware(config.diagnosticsStore),
  ];

  const staticDir = resolveStaticDir();

  const fetch = async (req: Request): Promise<Response> => {
    const requestId = req.headers.get("x-request-id") ?? crypto.randomUUID();
    const url = new URL(req.url);
    const ctx: RequestContext = {
      req,
      url,
      query: url.searchParams,
      params: new RouteParams({}),
      requestId,
      signal: req.signal,
      validated: {},
    };

    const baseHandler = async (): Promise<Response> => {
      // Serve static files first for non-API routes when in packaged mode
      if (
        staticDir &&
        req.method === "GET" &&
        !url.pathname.startsWith("/api/") &&
        !url.pathname.startsWith("/ws/")
      ) {
        const staticResponse = await serveStaticFile(staticDir, url.pathname);
        if (staticResponse) return staticResponse;
        return serveSpaFallback(staticDir);
      }

      if (
        url.pathname.startsWith("/api/modules/") &&
        url.pathname !== "/api/modules/registry" &&
        config.moduleRegistry
      ) {
        return config.moduleRegistry.dispatch(ctx);
      }
      return router.dispatch(ctx);
    };

    return applyMiddlewares(ctx, middlewares, baseHandler);
  };

  const start = (): ReturnType<typeof Bun.serve> => {
    return Bun.serve({
      hostname: config.host ?? "127.0.0.1",
      port: config.port ?? 3000,
      fetch,
    });
  };

  return { fetch, start };
}
