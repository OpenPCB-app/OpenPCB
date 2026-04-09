import type { z } from "zod";
import type { RequestContext } from "../http/request-context";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RouteSchemas {
  params?: z.ZodType<unknown>;
  query?: z.ZodType<unknown>;
  body?: z.ZodType<unknown>;
}

export type RouteHandler = (ctx: RequestContext) => Promise<Response>;

export interface RouteDefinition {
  method: HttpMethod;
  path: string;
  handler: RouteHandler;
  schemas?: RouteSchemas;
}
