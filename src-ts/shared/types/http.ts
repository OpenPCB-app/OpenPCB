/**
 * Shared HTTP types for module endpoints
 *
 * These types define the core HTTP routing and handler signatures
 * for the module system's HTTP API.
 */

// Re-export RouteContext and RouteParams from BaseHttpRouter
export type { RouteContext, RouteMetadata } from '../../src/transport/router/BaseHttpRouter';
export { RouteParams } from '../../src/transport/router/RouteParams';

/**
 * HTTP route handler function
 *
 * Handles HTTP requests using RouteContext which provides:
 * - req: The incoming HTTP request
 * - params: Extracted URL parameters (e.g., /users/:id)
 * - query: URL search parameters
 * - url: Parsed URL object
 *
 * @param ctx - Route context with request, params, query, and url
 * @returns HTTP response or promise resolving to response
 *
 * @example
 * ```typescript
 * http.get('/items/:id', async ({ req, params, query }) => {
 *     const id = params.get('id');  // Type-safe parameter access
 *     const limit = query.get('limit') || '10';
 *     return ResponseBuilder.json({ id, limit });
 * });
 * ```
 */
export type RouteHandler = (ctx: import('../../src/transport/router/BaseHttpRouter').RouteContext) => Response | Promise<Response>;

/**
 * Supported HTTP methods
 */
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";

/**
 * JSON response configuration options
 */
export interface JsonResponseOptions {
    /** HTTP status code (default: 200) */
    status?: number;
    /** Additional HTTP headers */
    headers?: Record<string, string>;
}

/**
 * HTTP Router Interface
 *
 * Defines the contract for HTTP routing in modules.
 * Implementations provide request routing to handler functions.
 *
 * Handlers now receive RouteContext instead of raw Request,
 * providing access to extracted URL parameters and query strings.
 *
 * @example
 * ```typescript
 * // In module endpoint registration:
 * endpoints(ctx, http: HttpRouter, ws: WsRouter) {
 *     // Simple route
 *     http.get('/status', async () => {
 *         return ResponseBuilder.json({ status: 'ok' });
 *     });
 *
 *     // Route with parameters
 *     http.get('/users/:userId/posts/:postId', async ({ params }) => {
 *         const userId = params.get('userId');
 *         const postId = params.get('postId');
 *         return ResponseBuilder.json({ userId, postId });
 *     });
 *
 *     // Route with query parameters
 *     http.get('/search', async ({ query }) => {
 *         const term = query.get('q') || '';
 *         const page = parseInt(query.get('page') || '1');
 *         return ResponseBuilder.json({ term, page });
 *     });
 * }
 * ```
 */
export interface HttpRouter {
    /** Register a GET route handler */
    get(path: string, handler: RouteHandler, metadata?: import('../../src/transport/router/BaseHttpRouter').RouteMetadata): void;
    /** Register a POST route handler */
    post(path: string, handler: RouteHandler, metadata?: import('../../src/transport/router/BaseHttpRouter').RouteMetadata): void;
    /** Register a PUT route handler */
    put(path: string, handler: RouteHandler, metadata?: import('../../src/transport/router/BaseHttpRouter').RouteMetadata): void;
    /** Register a DELETE route handler */
    delete(path: string, handler: RouteHandler, metadata?: import('../../src/transport/router/BaseHttpRouter').RouteMetadata): void;
    /** Register a PATCH route handler */
    patch(path: string, handler: RouteHandler, metadata?: import('../../src/transport/router/BaseHttpRouter').RouteMetadata): void;
}
