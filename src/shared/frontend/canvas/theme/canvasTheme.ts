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
  /** Saturated accent colors used for primitive ports (GND/PWR/Net Portal)
   * so they remain visual landmarks even when wires are muted greys. */
  primitiveGndColor: string;
  primitivePwrColor: string;
  primitivePortalColor: string;
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
  wireColor: "#475569", // slate-600 — neutral grey on light BG
  wirePowerColor: "#7a5151", // grey with warm-red hint
  wireGndColor: "#4f5b6b", // grey with cool-blue hint
  wireSelectedColor: "#7c3aed",
  wirePreviewColor: "#b45309",
  labelColor: "#0f172a",
  labelSelectedColor: "#7c3aed",
  junctionColor: "#020617",
  selectionColor: "#7c3aed",
  dragGhostColor: "#7c3aed",
  partOutlineColor: "#7c3aed",
  primitiveGndColor: "#3b82f6",
  primitivePwrColor: "#dc2626",
  primitivePortalColor: "#7c3aed",
};

// ── Dark mode palette ──────────────────────────────────────────────
// "Deep Space" — violet signal wires, warm-red power, steel-blue GND, and
// orange-red component outlines. Three distinct hue families (violet/red/
// blue/orange) keep wire classes and component bodies semantically separable
// at any zoom level. Inspired by KiCad Eagle-Dark structure with violet
// substituted for the conventional green signal wire.
const SCHEMATIC_DARK: SchematicTheme = {
  background: "#0b1120",
  gridColor: "#94a3b8",
  gridAlpha: 0.16,
  gridMajorAlpha: 0.12,
  wireColor: "#94a3b8", // slate-400 — darker neutral grey
  wirePowerColor: "#a05858", // darker dimmed red
  wireGndColor: "#5a7a99", // darker dimmed blue
  wireSelectedColor: "#ffffff", // bright white selection pop
  wirePreviewColor: "#f59e0b", // amber — drafting wires-in-progress
  labelColor: "#94a3b8", // muted slate-blue (annotations recede)
  labelSelectedColor: "#f0f4ff", // near-white
  junctionColor: "#cbd5e1", // light slate — matches grey wire family
  selectionColor: "#fbbf24", // amber — high contrast vs violet wires
  dragGhostColor: "#a78bfa",
  partOutlineColor: "#22d3ee",
  primitiveGndColor: "#3b82f6", // blue-500 — saturated GND landmark
  primitivePwrColor: "#dc2626", // red-600 — matches power wire
  primitivePortalColor: "#7c3aed", // violet-600 — matches app primary brand
};

/** Default preview theme for dark backgrounds (legacy compatibility) */
const PREVIEW_DARK: PreviewTheme = {
  symbolStroke: "#e2e8f0", // slate-200 — soft white, less heavy on large IC bodies
  symbolFill: "#0f172a", // slate-900 — slightly darker than canvas BG
  symbolPinDot: "#7dd3fc", // sky-300 — softer terminals, less "Christmas-lights" effect
  symbolPinLine: "#e2e8f0",
  symbolPinLabel: "#94a3b8", // muted slate-blue inside body
  symbolPinNumber: "#cbd5e1", // slate-300 — pin numbers near body
  symbolRefLabel: "#fbbf24", // amber — refs pop on dark canvas
  symbolValueLabel: "#94a3b8", // slate-400 — quieter than ref
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
