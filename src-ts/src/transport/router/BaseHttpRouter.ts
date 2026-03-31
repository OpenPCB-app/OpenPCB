/**
 * BaseHttpRouter - Shared HTTP routing logic
 * Provides pattern matching, parameter extraction, and route registration
 * Both CoreRouter and ModuleRouter extend this base class
 */

import { RouteParams, type RouteContext, type RouteHandler } from "./route-parser";
import type { z } from 'zod';

export { RouteParams, type RouteContext, type RouteHandler };

/**
 * OpenAPI metadata for route documentation
 */
export interface RouteMetadata {
    /** Unique operation identifier for OpenAPI */
    operationId: string;
    /** OpenAPI tags for grouping endpoints */
    tags?: string[];
    /** Short summary of the endpoint */
    summary?: string;
    /** Detailed description */
    description?: string;
    /** Request body schema (for POST/PUT/PATCH) */
    requestBody?: z.ZodTypeAny;
    /** Query parameter schema */
    queryParams?: z.ZodTypeAny;
    /** Response schemas by status code */
    responses?: Record<number, z.ZodTypeAny>;
}

/**
 * Internal route definition
 */
interface Route {
    pattern: RegExp;
    paramNames: string[];
    handler: RouteHandler;
    /** Original path pattern for OpenAPI generation */
    path: string;
    /** OpenAPI metadata */
    metadata?: RouteMetadata;
}

/**
 * Base HTTP Router with pattern matching
 * Implements shared routing logic for all HTTP routers
 */
export abstract class BaseHttpRouter {
    protected routes = new Map<string, Route[]>();

    /**
     * Register GET route
     */
    get(path: string, handler: RouteHandler, metadata?: RouteMetadata): void {
        this.register('GET', path, handler, metadata);
    }

    /**
     * Register POST route
     */
    post(path: string, handler: RouteHandler, metadata?: RouteMetadata): void {
        this.register('POST', path, handler, metadata);
    }

    /**
     * Register PATCH route
     */
    patch(path: string, handler: RouteHandler, metadata?: RouteMetadata): void {
        this.register('PATCH', path, handler, metadata);
    }

    /**
     * Register DELETE route
     */
    delete(path: string, handler: RouteHandler, metadata?: RouteMetadata): void {
        this.register('DELETE', path, handler, metadata);
    }

    /**
     * Register PUT route
     */
    put(path: string, handler: RouteHandler, metadata?: RouteMetadata): void {
        this.register('PUT', path, handler, metadata);
    }

    /**
     * Internal: register route with method
     */
    protected register(method: string, path: string, handler: RouteHandler, metadata?: RouteMetadata): void {
        const { pattern, paramNames } = this.pathToRegex(path);
        const routes = this.routes.get(method) || [];
        routes.push({ pattern, paramNames, handler, path, metadata });
        this.routes.set(method, routes);
    }

    /**
     * Get all registered routes for OpenAPI generation
     */
    getRoutes(): Map<string, Route[]> {
        return this.routes;
    }

    /**
     * Match route and return handler with extracted params
     */
    protected match(method: string, pathname: string): RouteHandler | null {
        const routes = this.routes.get(method);
        if (!routes) return null;

        for (const route of routes) {
            const match = pathname.match(route.pattern);
            if (match) {
                // Extract params from match
                const params: Record<string, string> = {};
                route.paramNames.forEach((name, i) => {
                    params[name] = match[i + 1]!;
                });

                // Return wrapped handler with params
                return async (ctx: RouteContext) => {
                    const contextWithParams: RouteContext = {
                        ...ctx,
                        params: new RouteParams(params),
                    };
                    return route.handler(contextWithParams);
                };
            }
        }

        return null;
    }

    /**
     * Convert path pattern to regex
     * "/api/chats/:id" -> /^\/api\/chats\/([^\/]+)$/
     */
    protected pathToRegex(path: string): { pattern: RegExp; paramNames: string[] } {
        const paramNames: string[] = [];
        const regexStr = path
            .split('/')
            .map((segment) => {
                if (segment.startsWith(':')) {
                    const paramName = segment.slice(1);
                    paramNames.push(paramName);
                    return '([^/]+)';  // Match any non-slash characters
                }
                return segment;
            })
            .join('/');

        const pattern = new RegExp(`^${regexStr}$`);
        return { pattern, paramNames };
    }

    /**
     * Build route context from request
     */
    protected buildContext(req: Request): RouteContext {
        const url = new URL(req.url);
        return {
            req,
            params: new RouteParams({}),  // Filled by match()
            query: url.searchParams,
            url,
        };
    }

    /**
     * Abstract method for handling requests
     * Subclasses must implement this
     */
    abstract handle(req: Request): Promise<Response>;
}
