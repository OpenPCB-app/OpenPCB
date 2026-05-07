import type { PreviewTheme } from "../preview/preview-theme";

export type CanvasThemeMode = "light" | "dark";

/** Schematic-specific color tokens */
export interface SchematicTheme {
  background: string;
  gridColor: string;
  gridAlpha: number;
  gridMajorAlpha: number;
  /** Default signal wire color (used for nets that aren't power or ground). */
  wireColor: string;
  /** Wire color for power rails (VCC, VDD, +5V, +3V3, …). */
  wirePowerColor: string;
  /** Wire color for ground nets (GND, VSS, …). */
  wireGndColor: string;
  wireSelectedColor: string;
  wirePreviewColor: string;
  labelColor: string;
  labelSelectedColor: string;
  junctionColor: string;
  selectionColor: string;
  dragGhostColor: string;
  partOutlineColor: string;
}

/** PCB canvas color tokens. Distinct from `preview` because library tiles
 * render symbols/footprints on a light surface, while the PCB canvas renders
 * on a near-black board fill and needs higher-contrast text + per-layer pads. */
export interface PcbCanvasTheme {
  background: string;
  boardFill: string;
  boardFillOpacity: number;
  ratsnestDefault: string;
  ratsnestPower: string;
  ratsnestGround: string;
  selectionOutline: string;
  highlightNet: string;
  refdesLabel: string;
  valueLabel: string;
  padNumberText: string;
  silkscreen: string;
  fab: string;
  courtyard: string;
  drill: string;
}

/** Full canvas theme for a given mode */
export interface CanvasTheme {
  mode: CanvasThemeMode;
  schematic: SchematicTheme;
  preview: PreviewTheme;
  pcbCanvas: PcbCanvasTheme;
}

// ── Light mode palette ──────────────────────────────────────────────
// Signal-wire palette follows KiCad eeschema convention:
// default = green-ish, power = red, ground = neutral dark/gray.
const SCHEMATIC_LIGHT: SchematicTheme = {
  background: "#f5f5f0",
  gridColor: "#475569",
  gridAlpha: 0.55,
  gridMajorAlpha: 0.4,
  wireColor: "#0f766e", // teal-700 (signal default)
  wirePowerColor: "#b91c1c", // red-700
  wireGndColor: "#475569", // slate-600
  wireSelectedColor: "#7c3aed",
  wirePreviewColor: "#b45309",
  labelColor: "#0f172a",
  labelSelectedColor: "#7c3aed",
  junctionColor: "#020617",
  selectionColor: "#7c3aed",
  dragGhostColor: "#7c3aed",
  partOutlineColor: "#7c3aed",
};

// ── Dark mode palette ──────────────────────────────────────────────
const SCHEMATIC_DARK: SchematicTheme = {
  background: "#0b1120",
  gridColor: "#94a3b8",
  gridAlpha: 0.16,
  gridMajorAlpha: 0.12,
  wireColor: "#67e8f9", // cyan-300 (signal default)
  wirePowerColor: "#f87171", // red-400 — distinct from signal cyan
  wireGndColor: "#cbd5e1", // slate-300 — slightly cooler than signal
  wireSelectedColor: "#22d3ee",
  wirePreviewColor: "#f59e0b",
  labelColor: "#a5b4fc",
  labelSelectedColor: "#22d3ee",
  junctionColor: "#e2e8f0",
  selectionColor: "#22d3ee",
  dragGhostColor: "#22d3ee",
  partOutlineColor: "#22d3ee",
};

/** Default preview theme for dark backgrounds (legacy compatibility) */
const PREVIEW_DARK: PreviewTheme = {
  symbolStroke: "#94a3b8",
  symbolFill: "#1e293b",
  symbolPinDot: "#38bdf8",
  symbolPinLine: "#e2e8f0",
  symbolPinLabel: "#e2e8f0",
  symbolPinNumber: "#94a3b8",
  symbolRefLabel: "#e0af68",
  symbolValueLabel: "#cbd5e1",
  footprintPad: "#c9a227",
  footprintPadNumber: "#0f172a",
  footprintSilk: "#cbd5e1",
  footprintFab: "#64748b",
  footprintDrill: "#0f172a",
};

/** PCB canvas tokens — KiCad/Altium-conventional dark palette.
 * Single token set for both modes; the PCB tab is always dark. */
const PCB_CANVAS_TOKENS: PcbCanvasTheme = {
  background: "#0a0f1c",
  boardFill: "#0a0f1c",
  boardFillOpacity: 0.95,
  ratsnestDefault: "#e5e7eb",
  ratsnestPower: "#ef4444",
  ratsnestGround: "#475569",
  selectionOutline: "#22d3ee",
  highlightNet: "#22d3ee",
  refdesLabel: "#cbd5e1",
  valueLabel: "#cbd5e1",
  padNumberText: "#ffffff",
  silkscreen: "#e2e8f0",
  fab: "#22d3ee",
  courtyard: "#f5d142",
  drill: "#0a0f1c",
};

/** Build the full canvas theme for a given mode */
export function getCanvasTheme(mode: CanvasThemeMode): CanvasTheme {
  if (mode === "light") {
    return {
      mode: "light",
      schematic: SCHEMATIC_LIGHT,
      preview: {
        symbolStroke: "#0f172a",
        symbolFill: "#e8e8e3",
        symbolPinDot: "#0369a1",
        symbolPinLine: "#0f172a",
        symbolPinLabel: "#0f172a",
        symbolPinNumber: "#0f172a",
        symbolRefLabel: "#0f172a",
        symbolValueLabel: "#0f172a",
        footprintPad: "#b45309",
        footprintPadNumber: "#f1f5f9",
        footprintSilk: "#475569",
        footprintFab: "#64748b",
        footprintDrill: "#f1f5f9",
      },
      pcbCanvas: PCB_CANVAS_TOKENS,
    };
  }

  return {
    mode: "dark",
    schematic: SCHEMATIC_DARK,
    preview: PREVIEW_DARK,
    pcbCanvas: PCB_CANVAS_TOKENS,
  };
}

/** EdaCanvas default backgrounds per mode */
export function getDefaultCanvasBackground(mode: CanvasThemeMode): string {
  return mode === "light" ? "#f5f5f0" : "#0f172a";
}
