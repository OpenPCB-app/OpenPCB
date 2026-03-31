import { ValidationError } from '../../core/errors';

/**
 * Route parameter extractor
 * Eliminates fragile URL parsing duplications
 */
export class RouteParams {
    constructor(private params: Record<string, string>) { }

    /**
     * Get parameter (returns undefined if missing)
     */
    get(name: string): string | undefined {
        return this.params[name];
    }

    /**
     * Get parameter or throw error
     * @throws ValidationError if parameter is missing
     */
    getOrThrow(name: string): string {
        const value = this.params[name];
        if (!value) {
            throw new ValidationError(`Required parameter "${name}" missing`);
        }
        return value;
    }

    /**
     * Get integer parameter
     * @throws ValidationError if parameter is missing or invalid
     */
    getInt(name: string, defaultValue?: number): number {
        const value = this.params[name];
        if (!value) {
            if (defaultValue !== undefined) return defaultValue;
            throw new ValidationError(`Required parameter "${name}" missing`);
        }
        const parsed = parseInt(value, 10);
        if (isNaN(parsed)) {
            throw new ValidationError(`Parameter "${name}" must be an integer`);
        }
        return parsed;
    }

    /**
     * Get all params as object
     */
    all(): Record<string, string> {
        return { ...this.params };
    }
}

/**
 * Route context passed to handlers
 */
export interface RouteContext {
    req: Request;
    params: RouteParams;
    query: URLSearchParams;
    url: URL;
}

/**
 * Route handler function
 */
export type RouteHandler = (ctx: RouteContext) => Promise<Response>;

/**
 * Route definition
 */
interface Route {
    pattern: RegExp;
    paramNames: string[];
    handler: RouteHandler;
}

/**
 * Simple Router with pattern matching
 */
export class Router {
    private routes = new Map<string, Route[]>();

    /**
     * Register GET route
     */
    get(path: string, handler: RouteHandler): void {
        this.register('GET', path, handler);
    }

    /**
     * Register POST route
     */
    post(path: string, handler: RouteHandler): void {
        this.register('POST', path, handler);
    }

    /**
     * Register PATCH route
     */
    patch(path: string, handler: RouteHandler): void {
        this.register('PATCH', path, handler);
    }

    /**
     * Register DELETE route
     */
    delete(path: string, handler: RouteHandler): void {
        this.register('DELETE', path, handler);
    }

    /**
     * Register PUT route
     */
    put(path: string, handler: RouteHandler): void {
        this.register('PUT', path, handler);
    }

    /**
     * Internal: register route with method
     */
    private register(method: string, path: string, handler: RouteHandler): void {
        const { pattern, paramNames } = this.pathToRegex(path);
        const routes = this.routes.get(method) || [];
        routes.push({ pattern, paramNames, handler });
        this.routes.set(method, routes);
    }

    /**
     * Match route and return handler
     */
    match(method: string, pathname: string): RouteHandler | null {
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
    private pathToRegex(path: string): { pattern: RegExp; paramNames: string[] } {
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
    buildContext(req: Request): RouteContext {
        const url = new URL(req.url);
        return {
            req,
            params: new RouteParams({}),  // Filled by match()
            query: url.searchParams,
            url,
        };
    }
}
