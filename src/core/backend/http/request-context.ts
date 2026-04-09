import type { RouteParams } from "../router/route-params";

export interface ValidatedRequestData {
  params?: unknown;
  query?: unknown;
  body?: unknown;
}

export interface RequestContext {
  req: Request;
  url: URL;
  query: URLSearchParams;
  params: RouteParams;
  requestId: string;
  signal: AbortSignal;
  validated: ValidatedRequestData;
}

export type MiddlewareNext = () => Promise<Response>;
export type Middleware = (ctx: RequestContext, next: MiddlewareNext) => Promise<Response>;
