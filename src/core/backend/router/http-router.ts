import { ZodError } from "zod";
import { MethodNotAllowedError, NotFoundError, ValidationError } from "../contracts/errors";
import type { RequestContext, ValidatedRequestData } from "../http/request-context";
import type { RouteDefinition, RouteHandler, RouteSchemas } from "./route-definition";
import { compilePath, matchPath, type CompiledRoute } from "./route-matcher";
import { RouteParams } from "./route-params";

interface RegisteredRoute extends RouteDefinition {
  compiled: CompiledRoute;
}

function routeSpecificity(route: RegisteredRoute): number {
  return route.path
    .split("/")
    .filter((segment) => segment.length > 0)
    .reduce((score, segment) => score + (segment.startsWith(":") ? 1 : 100), 0);
}

function normalizeQuery(searchParams: URLSearchParams): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of searchParams.entries()) {
    const existing = query[key];
    if (existing === undefined) {
      query[key] = value;
      continue;
    }
    if (Array.isArray(existing)) {
      existing.push(value);
      continue;
    }
    query[key] = [existing, value];
  }
  return query;
}

async function parseJsonBody(req: Request): Promise<unknown> {
  const raw = await req.clone().text();
  if (raw.trim().length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
}

function toValidationError(error: unknown): ValidationError {
  if (error instanceof ZodError) {
    return new ValidationError("Request validation failed", {
      issues: error.issues,
    });
  }
  if (error instanceof ValidationError) {
    return error;
  }
  return new ValidationError("Request validation failed");
}

export class HttpRouter {
  private readonly routes: RegisteredRoute[] = [];

  register(definition: RouteDefinition): void {
    this.routes.push({
      ...definition,
      compiled: compilePath(definition.method, definition.path),
    });
  }

  get(path: string, handler: RouteHandler, schemas?: RouteSchemas): void {
    this.register({ method: "GET", path, handler, schemas });
  }

  post(path: string, handler: RouteHandler, schemas?: RouteSchemas): void {
    this.register({ method: "POST", path, handler, schemas });
  }

  put(path: string, handler: RouteHandler, schemas?: RouteSchemas): void {
    this.register({ method: "PUT", path, handler, schemas });
  }

  patch(path: string, handler: RouteHandler, schemas?: RouteSchemas): void {
    this.register({ method: "PATCH", path, handler, schemas });
  }

  delete(path: string, handler: RouteHandler, schemas?: RouteSchemas): void {
    this.register({ method: "DELETE", path, handler, schemas });
  }

  async dispatch(ctx: RequestContext): Promise<Response> {
    const pathname = ctx.url.pathname;
    const method = ctx.req.method.toUpperCase();

    const byPath = this.routes.filter((route) => matchPath(route.compiled, pathname) !== null);
    if (byPath.length === 0) {
      throw new NotFoundError();
    }

    const route = byPath
      .filter((candidate) => candidate.method === method)
      .sort((left, right) => routeSpecificity(right) - routeSpecificity(left))[0];
    if (!route) {
      const allowedMethods = [...new Set(byPath.map((candidate) => candidate.method))].sort();
      throw new MethodNotAllowedError(allowedMethods);
    }

    const matched = matchPath(route.compiled, pathname);
    if (!matched) {
      throw new NotFoundError();
    }

    const validated = await this.validate(route.schemas, ctx, matched.params);
    ctx.params = new RouteParams(matched.params);
    ctx.validated = validated;
    return route.handler(ctx);
  }

  private async validate(
    schemas: RouteSchemas | undefined,
    ctx: RequestContext,
    params: Record<string, string>,
  ): Promise<ValidatedRequestData> {
    const validated: ValidatedRequestData = {};
    if (!schemas) {
      return validated;
    }

    if (schemas.params) {
      try {
        validated.params = schemas.params.parse(params);
      } catch (error) {
        throw toValidationError(error);
      }
    }

    if (schemas.query) {
      const queryObject = normalizeQuery(ctx.query);
      try {
        validated.query = schemas.query.parse(queryObject);
      } catch (error) {
        throw toValidationError(error);
      }
    }

    if (schemas.body) {
      try {
        const body = await parseJsonBody(ctx.req);
        validated.body = schemas.body.parse(body);
      } catch (error) {
        throw toValidationError(error);
      }
    }

    return validated;
  }
}
