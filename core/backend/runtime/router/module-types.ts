import type { RequestContext } from "../http/request-context";

export interface ModuleRequestContext extends RequestContext {
  moduleId: string;
}

export type ModuleErrorBoundary = (
  error: unknown,
  ctx: ModuleRequestContext,
) => Promise<Response> | Response;

export interface ModuleDispatchResult {
  moduleId: string;
  subpath: string;
}
