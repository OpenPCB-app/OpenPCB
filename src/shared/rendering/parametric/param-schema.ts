/**
 * Parametric component parameter schema. A tiny typed subset of JSON Schema
 * — sufficient to drive a generated form UI (number/enum/bool) and validate
 * input before running a generator.
 *
 * Kept deliberately closed: each field is one of int / float / enum / bool,
 * with bounds + default. Generators receive a validated `Record<string,
 * number | string | boolean>` and never see raw user input.
 */

export interface ParamFieldInt {
  readonly kind: "int";
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly unit?: string;
  readonly min: number;
  readonly max: number;
  readonly default: number;
  readonly step?: number;
}

export interface ParamFieldFloat {
  readonly kind: "float";
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly unit?: string;
  readonly min: number;
  readonly max: number;
  readonly default: number;
  readonly step?: number;
}

export interface ParamFieldEnum<TOption extends string = string> {
  readonly kind: "enum";
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly options: readonly {
    readonly value: TOption;
    readonly label: string;
  }[];
  readonly default: TOption;
}

export interface ParamFieldBool {
  readonly kind: "bool";
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly default: boolean;
}

export type ParamField =
  | ParamFieldInt
  | ParamFieldFloat
  | ParamFieldEnum
  | ParamFieldBool;

export type ParamValue = number | string | boolean;
export type ParamValues = Readonly<Record<string, ParamValue>>;

export interface ParamSchema {
  readonly fields: readonly ParamField[];
}

export interface ParamValidationError {
  readonly key: string;
  readonly message: string;
}

export function defaultValues(schema: ParamSchema): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const field of schema.fields) {
    out[field.key] = field.default;
  }
  return out;
}

/**
 * Validate raw input against a schema. Returns the coerced + bounded value
 * map, or an array of errors. Missing fields fall back to defaults; unknown
 * keys are dropped silently.
 */
export function validateParams(
  schema: ParamSchema,
  raw: Readonly<Record<string, unknown>>,
):
  | { ok: true; values: Record<string, ParamValue> }
  | { ok: false; errors: ParamValidationError[] } {
  const errors: ParamValidationError[] = [];
  const out: Record<string, ParamValue> = {};

  for (const field of schema.fields) {
    const incoming = raw[field.key];
    if (incoming === undefined) {
      out[field.key] = field.default;
      continue;
    }
    switch (field.kind) {
      case "int": {
        const n = typeof incoming === "number" ? incoming : Number(incoming);
        if (!Number.isFinite(n) || !Number.isInteger(n)) {
          errors.push({ key: field.key, message: "must be an integer" });
          break;
        }
        if (n < field.min || n > field.max) {
          errors.push({
            key: field.key,
            message: `must be between ${field.min} and ${field.max}`,
          });
          break;
        }
        out[field.key] = n;
        break;
      }
      case "float": {
        const n = typeof incoming === "number" ? incoming : Number(incoming);
        if (!Number.isFinite(n)) {
          errors.push({ key: field.key, message: "must be a finite number" });
          break;
        }
        if (n < field.min || n > field.max) {
          errors.push({
            key: field.key,
            message: `must be between ${field.min} and ${field.max}`,
          });
          break;
        }
        out[field.key] = n;
        break;
      }
      case "enum": {
        const s = String(incoming);
        if (!field.options.some((o) => o.value === s)) {
          errors.push({
            key: field.key,
            message: `must be one of: ${field.options.map((o) => o.value).join(", ")}`,
          });
          break;
        }
        out[field.key] = s;
        break;
      }
      case "bool": {
        if (typeof incoming !== "boolean") {
          errors.push({ key: field.key, message: "must be a boolean" });
          break;
        }
        out[field.key] = incoming;
        break;
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, values: out };
}

/**
 * Canonical hash of a param value set. Used to dedupe materializations:
 * identical params for the same template id reuse the cached library row.
 * Sorts keys so map iteration order can't shift the hash.
 */
export function hashParams(values: ParamValues): string {
  const sortedKeys = [...Object.keys(values)].sort();
  const pairs = sortedKeys.map((k) => `${k}=${JSON.stringify(values[k])}`);
  return pairs.join("|");
}
