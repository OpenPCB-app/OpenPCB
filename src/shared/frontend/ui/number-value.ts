/**
 * Pure parse / clamp / format helpers behind `NumberInput` (T-157 class of
 * bugs: 0 and negatives must be accepted, the decimal point never dropped).
 */

export type NumberDraft =
  | { kind: "value"; value: number }
  | { kind: "empty" }
  | { kind: "invalid"; reason: "syntax" | "negative" };

export interface ParseNumberOptions {
  /** Default true. */
  allowNegative?: boolean;
  /** A trailing unit the user may type along ("0.2mm"). */
  unit?: string;
}

const NUMBER_SYNTAX = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** Accepts "1,5" (locale comma), "1,234.5" / "1.234,5" (grouping), "+2", "-0". */
function normalizeSeparators(text: string): string | null {
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma === -1) return text;
  if (lastDot === -1) {
    // Only commas: one is a decimal separator, several are ambiguous.
    return text.indexOf(",") === lastComma ? text.replace(",", ".") : null;
  }
  return lastDot > lastComma
    ? text.replace(/,/g, "")
    : text.replace(/\./g, "").replace(",", ".");
}

export function parseNumberDraft(
  draft: string,
  options: ParseNumberOptions = {},
): NumberDraft {
  const { allowNegative = true, unit } = options;
  let text = draft.replace(/[\s  ]/g, "");
  if (unit && text.toLowerCase().endsWith(unit.toLowerCase())) {
    text = text.slice(0, text.length - unit.length);
  }
  text = text.replace(/^−/, "-");
  if (text.length === 0) return { kind: "empty" };
  const normalized = normalizeSeparators(text);
  if (normalized === null || !NUMBER_SYNTAX.test(normalized)) {
    return { kind: "invalid", reason: "syntax" };
  }
  const value = Number(normalized);
  if (!Number.isFinite(value)) return { kind: "invalid", reason: "syntax" };
  if (value < 0 && !allowNegative) return { kind: "invalid", reason: "negative" };
  return { kind: "value", value: Object.is(value, -0) ? 0 : value };
}

function decimalsOf(value: number): number {
  const text = String(value);
  const exp = text.match(/e-(\d+)$/i);
  if (exp) return Number(exp[1]);
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

/** Rounds to `precision` decimals (or leaves as is) without float noise. */
export function roundTo(value: number, precision?: number): number {
  if (precision === undefined) return Number(value.toPrecision(12));
  const factor = 10 ** precision;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export interface ClampOptions {
  min?: number;
  max?: number;
  precision?: number;
}

export function clampNumber(value: number, options: ClampOptions = {}): number {
  const { min, max, precision } = options;
  let next = roundTo(value, precision);
  if (min !== undefined && next < min) next = min;
  if (max !== undefined && next > max) next = max;
  return next;
}

/** Arrow-key stepping: ±step (×10 with Shift), clamped, float-noise free. */
export function stepNumber(
  value: number,
  direction: 1 | -1,
  options: ClampOptions & { step?: number; large?: boolean } = {},
): number {
  const step = (options.step ?? 1) * (options.large ? 10 : 1);
  const decimals = Math.max(decimalsOf(step), decimalsOf(value));
  const raw = Number((value + direction * step).toFixed(Math.min(decimals, 12)));
  return clampNumber(raw, options);
}

/** Display text for a committed value (`null` → empty). */
export function formatNumberValue(value: number | null, precision?: number): string {
  if (value === null || !Number.isFinite(value)) return "";
  return String(roundTo(value, precision));
}
