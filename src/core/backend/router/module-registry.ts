import { NotFoundError } from "../contracts/errors";
import type { RequestContext } from "../http/request-context";
import type { ModuleDispatchResult } from "./module-types";
import { ModuleRouter } from "./module-router";

export class ModuleRouterRegistry {
  private readonly routers = new Map<string, ModuleRouter>();

  register(router: ModuleRouter): void {
    this.routers.set(router.getModuleId(), router);
  }

  unregister(moduleId: string): void {
    this.routers.delete(moduleId);
  }

  get(moduleId: string): ModuleRouter | undefined {
    return this.routers.get(moduleId);
  }

  parse(pathname: string): ModuleDispatchResult | null {
    const matched = pathname.match(/^\/api\/modules\/([^/]+)(\/.*)?$/);
    if (!matched) {
      return null;
    }
    return {
      moduleId: matched[1] ?? "",
      subpath: matched[2] ?? "/",
    };
  }

  async dispatch(ctx: RequestContext): Promise<Response> {
    const parsed = this.parse(ctx.url.pathname);
    if (!parsed) {
      throw new NotFoundError("Module route not found");
    }
    const router = this.get(parsed.moduleId);
    if (!router) {
      throw new NotFoundError(`Module \"${parsed.moduleId}\" not found`);
    }

    const subpathUrl = new URL(`${parsed.subpath}${ctx.url.search}`, ctx.url.origin);
    const moduleCtx: RequestContext = {
      ...ctx,
      url: subpathUrl,
      query: subpathUrl.searchParams,
    };
    return router.dispatch(moduleCtx);
  }
}
