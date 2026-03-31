import Ajv, { type ValidateFunction, type ErrorObject } from "ajv";

/**
 * Shared AJV instance for tool input validation.
 * - allErrors: complete error reports (not just first failure)
 * - strict: false to accept JSON Schema keywords AJV doesn't know
 * - allowUnionTypes: for flexible schema types
 */
const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });

/**
 * Compile a JSON Schema into a validation function.
 * Uses AJV's internal cache — same schema object returns cached validator.
 */
export function compileSchema(schema: Record<string, unknown>): ValidateFunction {
  return ajv.compile(schema);
}

/**
 * Validate arguments against a JSON Schema in one call.
 * @returns { valid: true } or { valid: false, errors: [...] }
 */
export function validateArgs(
  schema: Record<string, unknown>,
  args: unknown,
): { valid: true } | { valid: false; errors: ErrorObject[] } {
  const validate = compileSchema(schema);
  const valid = validate(args);
  if (valid) {
    return { valid: true };
  }
  return { valid: false, errors: validate.errors ?? [] };
}

/** Export the AJV instance for advanced usage */
export { ajv };
