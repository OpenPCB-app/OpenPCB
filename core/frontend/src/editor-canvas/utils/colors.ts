export type NormalizedRgb = [number, number, number];

export const DEFAULT_NORMALIZED_RGB: NormalizedRgb = [0.58, 0.64, 0.72];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function parseHexColor(color: string): NormalizedRgb | null {
  const hex = color.trim().slice(1);
  const normalizedHex =
    hex.length === 3
      ? hex
          .split("")
          .map((part) => part + part)
          .join("")
      : hex;

  if (!/^[\da-f]{6}$/i.test(normalizedHex)) {
    return null;
  }

  return [
    parseInt(normalizedHex.slice(0, 2), 16) / 255,
    parseInt(normalizedHex.slice(2, 4), 16) / 255,
    parseInt(normalizedHex.slice(4, 6), 16) / 255,
  ];
}

function parseRgbFunctionColor(color: string): NormalizedRgb | null {
  const match = color.trim().match(/^rgba?\(([^)]+)\)$/i)?.[1];
  if (!match) {
    return null;
  }

  const parts = match
    .split(",")
    .slice(0, 3)
    .map((part) => Number.parseFloat(part.trim()));
  const [r = Number.NaN, g = Number.NaN, b = Number.NaN] = parts;
  if (![r, g, b].every((value) => Number.isFinite(value))) {
    return null;
  }

  return [clamp01(r / 255), clamp01(g / 255), clamp01(b / 255)];
}

export function parseShaderColor(
  color: string,
  fallback: NormalizedRgb = DEFAULT_NORMALIZED_RGB,
): NormalizedRgb {
  if (color.startsWith("#")) {
    return parseHexColor(color) ?? fallback;
  }
  return parseRgbFunctionColor(color) ?? fallback;
}
