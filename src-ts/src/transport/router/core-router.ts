import { BaseHttpRouter } from "./BaseHttpRouter";
import { ResponseBuilder } from "../../core/utils/response-builder";

/**
 * Minimal CoreRouter.
 * Core owns only shell endpoints. Module features must live under /api/modules/:moduleId/*.
 */
export class CoreRouter extends BaseHttpRouter {
  constructor() {
    super();
    this.registerRoutes();
  }

  private registerRoutes(): void {
    this.get("/api/health", async () => {
      return ResponseBuilder.success({
        status: "ok",
        timestamp: Date.now(),
      });
    });
  }

  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const handler = this.match(req.method, url.pathname);
    if (!handler) {
      return ResponseBuilder.notFound(`Route ${url.pathname}`);
    }
    return handler(this.buildContext(req));
  }
}
