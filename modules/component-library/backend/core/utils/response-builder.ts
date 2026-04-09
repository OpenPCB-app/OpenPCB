/**
 * Response Builder — standardized JSON responses for module routes.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-OpenPCB-Token, If-Unmodified-Since",
  Vary: "Origin",
};

interface JsonResponseOptions {
  status?: number;
  headers?: Record<string, string>;
}

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export class ResponseBuilder {
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

  static success<T>(data: T, status = 200): Response {
    const body: ApiResponse<T> = { ok: true, data };
    return this.json(body, { status });
  }

  static created<T>(data: T): Response {
    return this.success(data, 201);
  }

  static error(
    code: string,
    message: string,
    status: number,
    details?: unknown,
  ): Response {
    const body: ApiResponse = {
      ok: false,
      error: { code, message, details },
    };
    return this.json(body, { status });
  }

  static badRequest(message: string, details?: unknown): Response {
    return this.error("BAD_REQUEST", message, 400, details);
  }

  static notFound(resource: string, id?: string): Response {
    const message = id
      ? `${resource} with id "${id}" not found`
      : `${resource} not found`;
    return this.error("NOT_FOUND", message, 404, { resource, id });
  }

  static conflict(message: string, details?: unknown): Response {
    return this.error("CONFLICT", message, 409, details);
  }

  static internalError(message = "Internal server error"): Response {
    return this.error("INTERNAL_ERROR", message, 500);
  }
}
