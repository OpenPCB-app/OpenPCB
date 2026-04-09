/**
 * Database Error Hierarchy
 *
 * Typed error classes for database operations.
 */

export class DatabaseError extends Error {
  override readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "DatabaseError";
    this.cause = cause;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

export class UniqueConstraintError extends DatabaseError {
  constructor(
    message: string,
    public readonly column?: string,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = "UniqueConstraintError";
  }
}

export class ForeignKeyError extends DatabaseError {
  constructor(
    message: string,
    public readonly column?: string,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = "ForeignKeyError";
  }
}

export class DbNotFoundError extends DatabaseError {
  constructor(
    message: string,
    public readonly entity?: string,
    public readonly id?: string,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = "DbNotFoundError";
  }
}

export class DbConflictError extends DatabaseError {
  constructor(
    message: string,
    public readonly entity?: string,
    public readonly id?: string,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = "DbConflictError";
  }
}

export class QueryError extends DatabaseError {
  constructor(
    message: string,
    public readonly sql?: string,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = "QueryError";
  }
}

/**
 * Parse SQLite error and return typed error.
 */
export function parseSQLiteError(err: unknown, context: string): DatabaseError {
  if (err instanceof DatabaseError) {
    return err;
  }

  const message = err instanceof Error ? err.message : String(err);
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("unique constraint")) {
    const constraintMatch = message.match(
      /unique constraint failed: (\w+)\.(\w+)/i,
    );
    const column = constraintMatch?.[2];
    return new UniqueConstraintError(`${context}: ${message}`, column, err);
  }

  if (lowerMessage.includes("foreign key constraint")) {
    return new ForeignKeyError(`${context}: ${message}`, undefined, err);
  }

  if (lowerMessage.includes("not null constraint")) {
    return new QueryError(`${context}: ${message}`, undefined, err);
  }

  return new DatabaseError(`${context}: ${message}`, err);
}
