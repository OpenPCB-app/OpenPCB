/**
 * CORS headers for cross-origin requests
 */
const CORS_HEADERS = {
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-OpenPCB-Token, If-Unmodified-Since",
    Vary: "Origin",
};

/**
 * JSON response options
 */
interface JsonResponseOptions {
    status?: number;
    headers?: Record<string, string>;
}

/**
 * Standardized API Response Format
 */
export interface ApiResponse<T = unknown> {
    ok: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
        details?: unknown;
    };
}

/**
 * Response Builder - Standardized HTTP responses
 */
export class ResponseBuilder {
    /**
     * Create a JSON response with CORS headers
     */
    static json(data: unknown, options: JsonResponseOptions = {}): Response {
        const { status = 200, headers = {} } = options;

        return new Response(JSON.stringify(data), {
            status,
            headers: {
                ...CORS_HEADERS,
                "Content-Type": "application/json",
                ...headers,
            },
        });
    }

    /**
     * Create a text response with CORS headers
     */
    static text(data: string, options: JsonResponseOptions = {}): Response {
        const { status = 200, headers = {} } = options;

        return new Response(data, {
            status,
            headers: {
                ...CORS_HEADERS,
                "Content-Type": "text/plain",
                ...headers,
            },
        });
    }

    /**
     * Success response (200 OK or custom status)
     */
    static success<T>(data: T, status = 200): Response {
        const body: ApiResponse<T> = { ok: true, data };
        return this.json(body, { status });
    }

    /**
     * Created response (201 Created)
     */
    static created<T>(data: T): Response {
        return this.success(data, 201);
    }

    /**
     * Accepted response (202 Accepted)
     * Used for async operations where processing continues
     */
    static accepted<T>(data: T): Response {
        return this.success(data, 202);
    }

    /**
     * No content response (204 No Content)
     */
    static noContent(): Response {
        return new Response(null, {
            status: 204,
            headers: CORS_HEADERS
        });
    }

    /**
     * Error response (generic)
     */
    static error(
        code: string,
        message: string,
        status: number,
        details?: unknown
    ): Response {
        const body: ApiResponse = {
            ok: false,
            error: { code, message, details },
        };
        return this.json(body, { status });
    }

    /**
     * 400 Bad Request
     */
    static badRequest(message: string, details?: unknown): Response {
        return this.error('BAD_REQUEST', message, 400, details);
    }

    /**
     * 404 Not Found
     */
    static notFound(resource: string, id?: string): Response {
        const message = id
            ? `${resource} with id "${id}" not found`
            : `${resource} not found`;
        return this.error('NOT_FOUND', message, 404, { resource, id });
    }

    /**
     * 405 Method Not Allowed
     */
    static methodNotAllowed(message = 'Method not allowed'): Response {
        return this.error('METHOD_NOT_ALLOWED', message, 405);
    }

    /**
     * 409 Conflict
     */
    static conflict(message: string, details?: unknown): Response {
        return this.error('CONFLICT', message, 409, details);
    }

    /**
     * 401 Unauthorized
     */
    static unauthorized(message = 'Unauthorized'): Response {
        return this.error('UNAUTHORIZED', message, 401);
    }

    /**
     * 500 Internal Server Error
     */
    static internalError(message = 'Internal server error'): Response {
        return this.error('INTERNAL_ERROR', message, 500);
    }

    /**
     * 503 Service Unavailable
     */
    static serviceUnavailable(message = 'Service temporarily unavailable'): Response {
        return this.error('SERVICE_UNAVAILABLE', message, 503);
    }
}
