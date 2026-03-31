import type { RouteContext } from '../router';
import { ResponseBuilder } from '../../core/utils/response-builder';
import {
    HttpError,
    NotFoundError,
    ValidationError,
    ConflictError,
    BusinessError,
    UnauthorizedError,
    ServiceUnavailableError,
} from '../../core/errors';

/**
 * Error handler middleware
 * Converts errors to standardized HTTP responses
 */
export async function errorHandlerMiddleware(
    ctx: RouteContext,
    next: () => Promise<Response>
): Promise<Response> {
    try {
        return await next();
    } catch (error) {
        // Log error
        console.error('[Controller Error]', {
            method: ctx.req.method,
            url: ctx.url.pathname,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
        });

        // Handle known HTTP errors (base class catches all subclasses)
        if (error instanceof HttpError) {
            return ResponseBuilder.error(
                error.code,
                error.message,
                error.statusCode,
                error.details
            );
        }

        // Unknown error
        return ResponseBuilder.internalError(
            error instanceof Error ? error.message : 'Internal server error'
        );
    }
}
