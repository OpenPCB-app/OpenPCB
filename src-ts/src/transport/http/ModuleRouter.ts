/**
 * Module Router
 * Routes HTTP requests to module-specific handlers
 * Extends BaseHttpRouter for shared routing logic
 */

import { BaseHttpRouter, type RouteContext, type RouteHandler } from "../router/BaseHttpRouter";
import { ResponseBuilder } from "../../core/utils/response-builder";
import { CORS_HEADERS } from "./helpers";

/**
 * Module routeMatch type for parsing module routes
 */
export interface ModuleRouteMatch {
    moduleId: string;
    subpath: string;
}

/**
 * Module router implementation
 * Handles routing for a single module
 * Extends BaseHttpRouter for routing logic
 */
export class ModuleRouter extends BaseHttpRouter {
    constructor(private moduleId: string) {
        super();
    }

    /**
     * Get module ID
     */
    getModuleId(): string {
        return this.moduleId;
    }

    /**
     * Handle an incoming request with subpath
     * Matches the request method and subpath to a registered handler
     */
    async handleSubpath(req: Request, subpath: string): Promise<Response> {
        // Normalize subpath
        const normalizedSubpath = subpath.startsWith("/") ? subpath : `/${subpath}`;

        // Build context
        const ctx = this.buildContext(req);

        // Update URL to use subpath for matching
        const matchUrl = new URL(normalizedSubpath, req.url);
        const handler = this.match(req.method, matchUrl.pathname);

        if (!handler) {
            return ResponseBuilder.notFound(`Route ${normalizedSubpath}`, this.moduleId);
        }

        try {
            const response = await handler(ctx);

            // Add CORS headers to module responses
            const headers = new Headers(response.headers);
            Object.entries(CORS_HEADERS).forEach(([key, value]) => {
                headers.set(key, value);
            });

            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers,
            });
        } catch (error) {
            console.error(`[ModuleRouter] Error handling ${req.method} ${normalizedSubpath}:`, error);
            return ResponseBuilder.internalError(error instanceof Error ? error.message : String(error));
        }
    }

    /**
     * Handle HTTP request (implements BaseHttpRouter abstract method)
     */
    async handle(req: Request): Promise<Response> {
        // For ModuleRouter, we use handleSubpath from the registry
        // This method satisfies the abstract requirement
        return this.handleSubpath(req, new URL(req.url).pathname);
    }

    /**
     * Get all registered routes for debugging
     */
    override getRoutes(): Map<string, any[]> {
        return this.routes;
    }
}

/**
 * Global module router registry
 * Manages routers for all loaded modules
 */
export class ModuleRouterRegistry {
    private routers = new Map<string, ModuleRouter>();

    /**
     * Register a module router
     */
    register(moduleId: string, router: ModuleRouter): void {
        if (this.routers.has(moduleId)) {
            console.warn(`[ModuleRouterRegistry] Module ${moduleId} already registered, overwriting`);
        }
        this.routers.set(moduleId, router);
    }

    /**
     * Unregister a module router
     */
    unregister(moduleId: string): void {
        this.routers.delete(moduleId);
    }

    /**
     * Get a module router by ID
     */
    get(moduleId: string): ModuleRouter | undefined {
        return this.routers.get(moduleId);
    }

    /**
     * Check if a module is registered
     */
    has(moduleId: string): boolean {
        return this.routers.has(moduleId);
    }

    /**
     * Get all registered module IDs
     */
    getModuleIds(): string[] {
        return Array.from(this.routers.keys());
    }

    /**
     * Parse module route from URL pathname
     * Extracts moduleId and subpath from /api/modules/:moduleId/*
     */
    parseModuleRoute(pathname: string): ModuleRouteMatch | null {
        // Expected format: /api/modules/:moduleId/...
        const match = pathname.match(/^\/api\/modules\/([^/]+)(\/.*)?$/);

        if (!match) {
            return null;
        }

        const moduleId = match[1]!;
        const subpath = match[2] || "/";

        return { moduleId, subpath };
    }

    /**
     * Handle a module request
     * Routes to the appropriate module handler
     */
    async handleModuleRequest(req: Request, pathname: string): Promise<Response> {
        const match = this.parseModuleRoute(pathname);

        if (!match) {
            return ResponseBuilder.notFound("Module route");
        }

        const { moduleId, subpath } = match;
        const router = this.get(moduleId);

        if (!router) {
            return ResponseBuilder.notFound(`Module "${moduleId}"`);
        }

        return await router.handleSubpath(req, subpath);
    }
}

/**
 * Global module router registry instance
 */
export const moduleRouterRegistry = new ModuleRouterRegistry();
