/**
 * Content Editor Errors
 *
 * Domain-specific error types for content editing operations.
 */

/**
 * Base content editor error
 */
export class ContentEditorError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "ContentEditorError";
  }
}

/**
 * Target not found or not registered
 */
export class TargetNotFoundError extends ContentEditorError {
  constructor(targetType: string, targetId?: string) {
    super(
      targetId
        ? `Target not found: ${targetType}:${targetId}`
        : `Target type not registered: ${targetType}`,
      "TARGET_NOT_FOUND",
      { targetType, targetId }
    );
    this.name = "TargetNotFoundError";
  }
}

/**
 * Target is locked by another operation
 */
export class TargetLockedError extends ContentEditorError {
  constructor(
    targetType: string,
    targetId: string,
    public readonly lockingEditId: string
  ) {
    super(
      `Target ${targetType}:${targetId} is locked by edit ${lockingEditId}`,
      "TARGET_LOCKED",
      { targetType, targetId, lockingEditId }
    );
    this.name = "TargetLockedError";
  }
}

/**
 * Invalid selection for the target
 */
export class InvalidSelectionError extends ContentEditorError {
  constructor(message: string, details?: unknown) {
    super(message, "INVALID_SELECTION", details);
    this.name = "InvalidSelectionError";
  }
}

/**
 * Edit operation not found
 */
export class EditNotFoundError extends ContentEditorError {
  constructor(editId: string) {
    super(`Edit operation not found: ${editId}`, "EDIT_NOT_FOUND", { editId });
    this.name = "EditNotFoundError";
  }
}

/**
 * Rollback failed
 */
export class RollbackError extends ContentEditorError {
  constructor(editId: string, reason: string) {
    super(
      `Failed to rollback edit ${editId}: ${reason}`,
      "ROLLBACK_FAILED",
      { editId, reason }
    );
    this.name = "RollbackError";
  }
}

/**
 * Provider or model not available
 */
export class ProviderError extends ContentEditorError {
  constructor(provider: string, model: string, reason: string) {
    super(
      `Provider ${provider} (${model}) error: ${reason}`,
      "PROVIDER_ERROR",
      { provider, model, reason }
    );
    this.name = "ProviderError";
  }
}

/**
 * Content parsing/transformation error
 */
export class ContentParseError extends ContentEditorError {
  constructor(message: string, details?: unknown) {
    super(message, "CONTENT_PARSE_ERROR", details);
    this.name = "ContentParseError";
  }
}
