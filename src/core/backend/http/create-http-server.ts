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
