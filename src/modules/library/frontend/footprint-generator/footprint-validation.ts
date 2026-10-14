import {
  validateParams,
  type ParamSchema,
  type ParamValue,
} from "../../../../shared/rendering/parametric";

export type TemplateParamValidation =
  | { ok: true; values: Record<string, ParamValue> }
  | { ok: false; errors: Record<string, string> };

/**
 * Validate raw form input (strings from inputs, booleans from checkboxes)
 * against a template schema. Same rules the backend `materialize` route
 * applies, so the form can disable Generate before a round-trip.
 */
export function validateTemplateParams(
  schema: ParamSchema,
  values: Readonly<Record<string, unknown>>,
): TemplateParamValidation {
  // validateParams silently coerces "" to 0 (Number("") === 0); a blank
  // numeric field must be an error, not a quiet zero.
  const errors: Record<string, string> = {};
  const cleaned: Record<string, unknown> = {};
  for (const field of schema.fields) {
    const raw = values[field.key];
    if (
      (field.kind === "int" || field.kind === "float") &&
      typeof raw === "string" &&
      raw.trim().length === 0
    ) {
      errors[field.key] = "is required";
      continue;
    }
    cleaned[field.key] = raw;
  }
  const result = validateParams(schema, cleaned);
  if (!result.ok) {
    for (const error of result.errors) errors[error.key] = error.message;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (!result.ok) return { ok: false, errors };
  return { ok: true, values: result.values };
}

/**
 * Symbol pin numbers that no pad covers, de-duplicated, in first-seen order.
 * Mirrors the backend rule (a pin without a pad is a 400) so the UI can show
 * the gap before committing.
 */
export function missingPinNumbers(
  symbolPins: readonly string[],
  pads: readonly { readonly number: string }[],
): string[] {
  const padNumbers = new Set(pads.map((pad) => pad.number.trim()));
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const raw of symbolPins) {
    const pin = raw.trim();
    if (pin.length === 0 || seen.has(pin)) continue;
    seen.add(pin);
    if (!padNumbers.has(pin)) missing.push(pin);
  }
  return missing;
}
