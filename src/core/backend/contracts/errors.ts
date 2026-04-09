export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  [key: string]: unknown;
}

export class AppError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly title: string,
    public readonly type = "about:blank",
    public readonly extras?: Record<string, unknown>,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, extras?: Record<string, unknown>) {
    super(message, 400, "Bad Request", "https://openpcb.dev/problems/validation", extras);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Route not found") {
    super(message, 404, "Not Found", "https://openpcb.dev/problems/not-found");
  }
}

export class MethodNotAllowedError extends AppError {
  constructor(allowedMethods: string[], message = "Method not allowed") {
    super(
      message,
      405,
      "Method Not Allowed",
      "https://openpcb.dev/problems/method-not-allowed",
      { allowedMethods },
      { Allow: allowedMethods.join(", ") },
    );
  }
}
