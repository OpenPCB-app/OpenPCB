import { HttpRouter } from "./http-router";
import type { ModuleErrorBoundary, ModuleRequestContext } from "./module-types";
import type { RequestContext } from "../http/request-context";
import type { RouteSchemas } from "./route-definition";

export class ModuleRouter {
  private readonly router = new HttpRouter();

  constructor(
    private readonly moduleId: string,
    private readonly errorBoundary?: ModuleErrorBoundary,
  ) {}

  getModuleId(): string {
    return this.moduleId;
  }

  get(
    path: string,
    handler: (ctx: ModuleRequestContext) => Promise<Response>,
    schemas?: RouteSchemas,
  ): void {
    this.router.get(path, (ctx) => handler({ ...ctx, moduleId: this.moduleId }), schemas);
  }

  post(
    path: string,
    handler: (ctx: ModuleRequestContext) => Promise<Response>,
    schemas?: RouteSchemas,
  ): void {
    this.router.post(path, (ctx) => handler({ ...ctx, moduleId: this.moduleId }), schemas);
  }

  put(
    path: string,
    handler: (ctx: ModuleRequestContext) => Promise<Response>,
    schemas?: RouteSchemas,
  ): void {
    this.router.put(path, (ctx) => handler({ ...ctx, moduleId: this.moduleId }), schemas);
  }

  patch(
    path: string,
    handler: (ctx: ModuleRequestContext) => Promise<Response>,
    schemas?: RouteSchemas,
  ): void {
    this.router.patch(path, (ctx) => handler({ ...ctx, moduleId: this.moduleId }), schemas);
  }

  delete(
    path: string,
    handler: (ctx: ModuleRequestContext) => Promise<Response>,
    schemas?: RouteSchemas,
  ): void {
    this.router.delete(path, (ctx) => handler({ ...ctx, moduleId: this.moduleId }), schemas);
  }

  async dispatch(ctx: RequestContext): Promise<Response> {
    try {
      return await this.router.dispatch(ctx);
    } catch (error) {
      if (!this.errorBoundary) {
        throw error;
      }
      const moduleContext: ModuleRequestContext = {
        ...ctx,
        moduleId: this.moduleId,
      };
      return this.errorBoundary(error, moduleContext);
    }
  }
}
