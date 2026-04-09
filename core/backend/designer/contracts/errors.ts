export class DesignerDomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

export class ValidationError extends DesignerDomainError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR");
  }
}

export class NotFoundError extends DesignerDomainError {
  constructor(message: string) {
    super(message, "NOT_FOUND");
  }
}
