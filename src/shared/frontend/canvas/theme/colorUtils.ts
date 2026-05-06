/**
 * Color utility functions for canvas theming.
 * Converts between hex / RGB / normalized RGB and computes luminance/contrast.
 */

export function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return [r, g, b];
}

export function hexToNormalizedRgb(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex);
  return [r / 255, g / 255, b / 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Relative luminance per WCAG 2.1 */
export function getLuminance(hex: string): number {
  const [r, g, b] = hexToNormalizedRgb(hex);
  const a = [r, g, b].map((v) =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4),
  );
  return a[0]! * 0.2126 + a[1]! * 0.7152 + a[2]! * 0.0722;
}

/** Is the color light (luminance > 0.5)? */
export function isLight(hex: string): boolean {
  return getLuminance(hex) > 0.5;
}

/** Blend two hex colors by a factor (0 = a, 1 = b) */
export function blendHex(a: string, b: string, factor: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  const r = ar + (br - ar) * factor;
  const g = ag + (bg - ag) * factor;
  const b_ = ab + (bb - ab) * factor;
  return rgbToHex(r, g, b_);
}

/** Darken a hex color by a factor (0 = no change, 1 = black) */
export function darkenHex(hex: string, factor: number): string {
  return blendHex(hex, "#000000", factor);
}

/** Lighten a hex color by a factor (0 = no change, 1 = white) */
export function lightenHex(hex: string, factor: number): string {
  return blendHex(hex, "#ffffff", factor);
}

/** Choose between dark/light based on background luminance */
export function contrastColor(
  bgHex: string,
  darkHex: string,
  lightHex: string,
): string {
  return isLight(bgHex) ? darkHex : lightHex;
}

/** Auto-adapt symbol/footprint preview colors for a given background.
 *  Returns a palette where stroke, fill, and accents have appropriate contrast.
 */
export function getAutoPreviewTheme(bgHex: string) {
  const bgLight = isLight(bgHex);
  const bgLum = getLuminance(bgHex);

  // Stroke should be clearly visible against bg
  const stroke = bgLight ? "#1e293b" : "#94a3b8";

  // Fill should be slightly different from bg but not jarring
  const fill = bgLight
    ? darkenHex(bgHex, 0.06)
    : lightenHex(bgHex, 0.08);

  // Pin dots: blue-ish for dark, darker blue for light
  const pinDot = bgLight ? "#0369a1" : "#38bdf8";

  // Pin lines and labels
  const pinLine = bgLight ? "#334155" : "#e2e8f0";
  const pinLabel = bgLight ? "#1e293b" : "#e2e8f0";
  const pinNumber = bgLight ? "#475569" : "#94a3b8";

  // Reference/value labels
  const refLabel = bgLight ? "#92400e" : "#e0af68";
  const valueLabel = bgLight ? "#1e293b" : "#cbd5e1";

  // Footprint colors
  const footprintPad = bgLight ? "#b45309" : "#c9a227";
  const footprintPadNumber = bgLight ? "#f1f5f9" : "#0f172a";
  const footprintSilk = bgLight ? "#475569" : "#cbd5e1";
  const footprintFab = bgLight ? "#64748b" : "#64748b";
  const footprintDrill = bgLight ? "#f1f5f9" : "#0f172a";

  return {
    symbolStroke: stroke,
    symbolFill: fill,
    symbolPinDot: pinDot,
    symbolPinLine: pinLine,
    symbolPinLabel: pinLabel,
    symbolPinNumber: pinNumber,
    symbolRefLabel: refLabel,
    symbolValueLabel: valueLabel,
    footprintPad,
    footprintPadNumber,
    footprintSilk,
    footprintFab,
    footprintDrill,
  };
}
