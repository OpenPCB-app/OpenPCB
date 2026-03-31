/**
 * Database Error Hierarchy
 *
 * Typed error classes for database operations.
 */

/**
 * Base database error class
 */
export class DatabaseError extends Error {
  override readonly cause?: unknown;

  constructor(
    message: string,
    cause?: unknown
  ) {
    super(message);
    this.name = "DatabaseError";
    this.cause = cause;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

/**
 * Thrown when a unique constraint is violated
 */
export class UniqueConstraintError extends DatabaseError {
  constructor(
    message: string,
    public readonly column?: string,
    cause?: unknown
  ) {
    super(message, cause);
    this.name = "UniqueConstraintError";
  }
}

/**
 * Thrown when a foreign key constraint is violated
 */
export class ForeignKeyError extends DatabaseError {
  constructor(
    message: string,
    public readonly column?: string,
    cause?: unknown
  ) {
    super(message, cause);
    this.name = "ForeignKeyError";
  }
}

/**
 * Thrown when a requested record is not found
 */
export class DbNotFoundError extends DatabaseError {
  constructor(
    message: string,
    public readonly entity?: string,
    public readonly id?: string,
    cause?: unknown
  ) {
    super(message, cause);
    this.name = "DbNotFoundError";
  }
}

/**
 * Thrown when a resource conflict occurs (e.g., lock already held)
 */
export class DbConflictError extends DatabaseError {
  constructor(
    message: string,
    public readonly entity?: string,
    public readonly id?: string,
    cause?: unknown
  ) {
    super(message, cause);
    this.name = "DbConflictError";
  }
}

/**
 * Thrown when a transaction fails
 */
export class TransactionError extends DatabaseError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "TransactionError";
  }
}

/**
 * Thrown when database migration fails
 */
export class MigrationError extends DatabaseError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "MigrationError";
  }
}

/**
 * Thrown when query exceeds timeout or resource limits
 */
export class QueryError extends DatabaseError {
  constructor(
    message: string,
    public readonly sql?: string,
    cause?: unknown
  ) {
    super(message, cause);
    this.name = "QueryError";
  }
}

/**
 * Parse SQLite error and return typed error
 */
export function parseSQLiteError(err: unknown, context: string): DatabaseError {
  // Log the raw error for debugging
  console.error(`[DatabaseError] ${context}:`, err);

  if (err instanceof DatabaseError) {
    return err;
  }

  const message = err instanceof Error ? err.message : String(err);
  const lowerMessage = message.toLowerCase();

  // UNIQUE constraint failed
  if (lowerMessage.includes("unique constraint")) {
    const constraintMatch = message.match(/unique constraint failed: (\w+)\.(\w+)/i);
    const column = constraintMatch?.[2];
    return new UniqueConstraintError(
      `${context}: ${message}`,
      column,
      err
    );
  }

  // FOREIGN KEY constraint failed
  if (lowerMessage.includes("foreign key constraint")) {
    return new ForeignKeyError(`${context}: ${message}`, undefined, err);
  }

  // NOT NULL constraint failed
  if (lowerMessage.includes("not null constraint")) {
    return new QueryError(`${context}: ${message}`, undefined, err);
  }

  // Generic database error
  return new DatabaseError(`${context}: ${message}`, err);
}
