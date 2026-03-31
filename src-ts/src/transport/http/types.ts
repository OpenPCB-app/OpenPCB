/**
 * HTTP Types
 * Type definitions for HTTP routing and handlers
 */

// Import and re-export shared types from core
import type { RouteHandler as CoreRouteHandler, HttpMethod as CoreHttpMethod, JsonResponseOptions as CoreJsonResponseOptions } from "shared/types/http";

export type RouteHandler = CoreRouteHandler;
export type HttpMethod = CoreHttpMethod;
export type JsonResponseOptions = CoreJsonResponseOptions;

/**
 * Route definition (internal implementation)
 */
export interface Route {
    method: HttpMethod;
    path: string;
    handler: RouteHandler;
}

/**
 * Module route result
 * Contains the module ID and remaining subpath
 */
export interface ModuleRouteMatch {
    moduleId: string;
    subpath: string;
}
