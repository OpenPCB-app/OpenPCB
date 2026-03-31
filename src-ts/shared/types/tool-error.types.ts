/**
 * Error codes for tool-related failures.
 */
export type ToolErrorCode =
  | 'VALIDATION_FAILED'
  | 'AUTH_REQUIRED'
  | 'CONTEXT_MISSING'
  | 'RATE_LIMIT'
  | 'EXECUTION_ERROR'
  | 'NOT_FOUND'
  | 'SCHEMA_ERROR';

/**
 * Phases of tool execution where an error can occur.
 */
export type ToolErrorPhase = 'validation' | 'guard' | 'execution' | 'serialization';

/**
 * Structured error for the tool system.
 */
export interface ToolError {
  /** Unique error code identifying the type of failure */
  code: ToolErrorCode;
  /** Human-readable error message */
  message: string;
  /** Phase where the error occurred */
  phase: ToolErrorPhase;
  /** Whether the operation can be retried */
  retryable: boolean;
  /** Optional additional details about the error */
  details?: Record<string, unknown>;
}

/**
 * Mapping of error codes to their default retryability status.
 */
const RETRYABLE_MAPPING: Record<ToolErrorCode, boolean> = {
  VALIDATION_FAILED: true,
  AUTH_REQUIRED: false,
  CONTEXT_MISSING: true,
  RATE_LIMIT: true,
  EXECUTION_ERROR: false,
  NOT_FOUND: false,
  SCHEMA_ERROR: false,
};

/**
 * Options for creating a ToolError.
 */
export interface CreateToolErrorOptions {
  phase?: ToolErrorPhase;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

/**
 * Creates a structured ToolError object.
 * 
 * @param code - The error code
 * @param message - Human-readable message
 * @param opts - Optional phase, retryable flag, and details
 * @returns A fully typed ToolError object
 */
export function createToolError(
  code: ToolErrorCode,
  message: string,
  opts: CreateToolErrorOptions = {}
): ToolError {
  return {
    code,
    message,
    phase: opts.phase ?? 'execution',
    retryable: opts.retryable ?? RETRYABLE_MAPPING[code],
    details: opts.details,
  };
}

/**
 * Type guard to check if an error is retryable.
 * 
 * @param error - The error to check
 * @returns True if the error is a ToolError and is marked as retryable
 */
export function isRetryable(error: unknown): error is ToolError & { retryable: true } {
  if (
    typeof error === 'object' &&
    error !== null &&
    'retryable' in error
  ) {
    const candidate = error as Record<string, unknown>;
    return candidate.retryable === true;
  }
  return false;
}
