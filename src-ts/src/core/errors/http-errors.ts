/**
 * Base HTTP Error
 */
export abstract class HttpError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number,
        public readonly code: string,
        public readonly details?: unknown
    ) {
        super(message);
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
    }
}

/**
 * 404 Not Found
 */
export class NotFoundError extends HttpError {
    constructor(
        public readonly entity: string,
        public readonly id?: string
    ) {
        const message = id
            ? `${entity} with id "${id}" not found`
            : `${entity} not found`;
        super(message, 404, 'NOT_FOUND', { entity, id });
    }
}

/**
 * 400 Bad Request (validation)
 */
export class ValidationError extends HttpError {
    constructor(message: string, details?: unknown) {
        super(message, 400, 'VALIDATION_ERROR', details);
    }
}

/**
 * 409 Conflict
 */
export class ConflictError extends HttpError {
    constructor(message: string, details?: unknown) {
        super(message, 409, 'CONFLICT', details);
    }
}

/**
 * 500 Internal Server Error (business logic)
 */
export class BusinessError extends HttpError {
    constructor(message: string, details?: unknown) {
        super(message, 500, 'BUSINESS_ERROR', details);
    }
}

/**
 * 401 Unauthorized
 */
export class UnauthorizedError extends HttpError {
    constructor(message = 'Unauthorized') {
        super(message, 401, 'UNAUTHORIZED');
    }
}

/**
 * 503 Service Unavailable (offline)
 */
export class ServiceUnavailableError extends HttpError {
    constructor(message = 'Service temporarily unavailable') {
        super(message, 503, 'SERVICE_UNAVAILABLE');
    }
}
