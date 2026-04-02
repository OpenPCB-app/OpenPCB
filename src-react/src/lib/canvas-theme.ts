/**
 * Canvas Theme System
 *
 * Centralized color definitions for HTML5 Canvas 2D rendering.
 * Provides theme-aware colors that respond to light/dark mode changes.
 */

import { useMemo } from "react";
import { useTheme, type ThemeMode } from "../components/ThemeProvider";

// ---------------------------------------------------------------------------
// Color Types
// ---------------------------------------------------------------------------

export interface CanvasColors {
  // Background & Grid
  background: string;
  gridDot: string;
  gridDotFaint: string;
  gridMajorLine: string;
  originCross: string;

  // Symbol Body
  bodyStroke: string;
  bodyFill: string;

  // Pins
  pinLine: string;
  pinDot: string;
  pinLabel: string;
  pinNumber: string;

  // Wires
  wireDefault: string;
  wireSelected: string;
  wirePreview: string;
  junction: string;

  // Selection
  selectionStroke: string;
  selectionFill: string;

  // Text/Labels
  refLabel: string;
  valueLabel: string;

  // Footprint-specific
  padFill: string;
  padStroke: string;
  padSelectedStroke: string;
  padSelectedFill: string;
  padNumber: string;
  padNumberLight: string;
  courtyard: string;
  courtyardStroke: string;
  silkscreen: string;
  fabOutline: string;
  fabFill: string;
  pin1Marker: string;
}

// ---------------------------------------------------------------------------
// Dark Theme Colors
// ---------------------------------------------------------------------------

export const CANVAS_COLORS_DARK: CanvasColors = {
  // Background & Grid
  background: "#0f172a",
  gridDot: "rgba(148, 163, 184, 0.3)",
  gridDotFaint: "rgba(148, 163, 184, 0.15)",
  gridMajorLine: "rgba(148, 163, 184, 0.08)",
  originCross: "rgba(148, 163, 184, 0.4)",

  // Symbol Body
  bodyStroke: "#94a3b8",
  bodyFill: "#1e293b",

  // Pins
  pinLine: "#94a3b8",
  pinDot: "#38bdf8",
  pinLabel: "#e2e8f0",
  pinNumber: "#64748b",

  // Wires
  wireDefault: "#cbd5e1",
  wireSelected: "#e0f2fe",
  wirePreview: "#38bdf8",
  junction: "#f8fafc",

  // Selection
  selectionStroke: "#38bdf8",
  selectionFill: "rgba(56, 189, 248, 0.15)",

  // Text/Labels
  refLabel: "#e0af68",
  valueLabel: "#e2e8f0",

  // Footprint-specific
  padFill: "#c9a227",
  padStroke: "#f4d03f",
  padSelectedStroke: "#38bdf8",
  padSelectedFill: "rgba(56, 189, 248, 0.2)",
  padNumber: "#1e293b",
  padNumberLight: "#e2e8f0",
  courtyard: "rgba(255, 193, 7, 0.3)",
  courtyardStroke: "rgba(255, 193, 7, 0.6)",
  silkscreen: "#94a3b8",
  fabOutline: "#64748b",
  fabFill: "rgba(100, 116, 139, 0.1)",
  pin1Marker: "#38bdf8",
};

// ---------------------------------------------------------------------------
// Light Theme Colors
// ---------------------------------------------------------------------------

export const CANVAS_COLORS_LIGHT: CanvasColors = {
  // Background & Grid
  background: "#fafafe",
  gridDot: "rgba(100, 116, 139, 0.35)",
  gridDotFaint: "rgba(100, 116, 139, 0.2)",
  gridMajorLine: "rgba(100, 116, 139, 0.12)",
  originCross: "rgba(100, 116, 139, 0.5)",

  // Symbol Body
  bodyStroke: "#475569",
  bodyFill: "#f1f5f9",

  // Pins
  pinLine: "#475569",
  pinDot: "#7c3aed",
  pinLabel: "#1e293b",
  pinNumber: "#64748b",

  // Wires
  wireDefault: "#475569",
  wireSelected: "#7c3aed",
  wirePreview: "#7c3aed",
  junction: "#1e293b",

  // Selection
  selectionStroke: "#7c3aed",
  selectionFill: "rgba(124, 58, 237, 0.12)",

  // Text/Labels
  refLabel: "#b45309",
  valueLabel: "#1e293b",

  // Footprint-specific (keeping EDA conventions)
  padFill: "#c9a227",
  padStroke: "#b8860b",
  padSelectedStroke: "#7c3aed",
  padSelectedFill: "rgba(124, 58, 237, 0.15)",
  padNumber: "#1e293b",
  padNumberLight: "#f8fafc",
  courtyard: "rgba(180, 83, 9, 0.2)",
  courtyardStroke: "rgba(180, 83, 9, 0.5)",
  silkscreen: "#475569",
  fabOutline: "#64748b",
  fabFill: "rgba(100, 116, 139, 0.08)",
  pin1Marker: "#7c3aed",
};

// ---------------------------------------------------------------------------
// Color Accessor
// ---------------------------------------------------------------------------

export function getCanvasColors(mode: ThemeMode): CanvasColors {
  return mode === "dark" ? CANVAS_COLORS_DARK : CANVAS_COLORS_LIGHT;
}

// ---------------------------------------------------------------------------
// React Hook
// ---------------------------------------------------------------------------

/**
 * Returns theme-aware canvas colors that update when theme changes.
 * Use this in React components that render canvas elements.
 */
export function useCanvasColors(): CanvasColors {
  const { mode } = useTheme();
  return useMemo(() => getCanvasColors(mode), [mode]);
}

// ---------------------------------------------------------------------------
// Grid Colors Subset (for grid.ts compatibility)
// ---------------------------------------------------------------------------

export interface GridColors {
  dot: string;
  dotFaint: string;
  majorLine: string;
  originCross: string;
}

export function getGridColors(colors: CanvasColors): GridColors {
  return {
    dot: colors.gridDot,
    dotFaint: colors.gridDotFaint,
    majorLine: colors.gridMajorLine,
    originCross: colors.originCross,
  };
}

// ---------------------------------------------------------------------------
// Symbol Colors Subset (for symbols.ts compatibility)
// ---------------------------------------------------------------------------

export interface SymbolColors {
  bodyStroke: string;
  bodyFill: string;
  pinLine: string;
  pinDot: string;
  pinLabel: string;
  pinNumber: string;
  selectionStroke: string;
  selectionFill: string;
  refLabel: string;
  valueLabel: string;
  background: string;
}

export function getSymbolColors(colors: CanvasColors): SymbolColors {
  return {
    bodyStroke: colors.bodyStroke,
    bodyFill: colors.bodyFill,
    pinLine: colors.pinLine,
    pinDot: colors.pinDot,
    pinLabel: colors.pinLabel,
    pinNumber: colors.pinNumber,
    selectionStroke: colors.selectionStroke,
    selectionFill: colors.selectionFill,
    refLabel: colors.refLabel,
    valueLabel: colors.valueLabel,
    background: colors.background,
  };
}

// ---------------------------------------------------------------------------
// Wire Colors Subset (for wires.ts compatibility)
// ---------------------------------------------------------------------------

export interface WireColors {
  wireDefault: string;
  wireSelected: string;
  wirePreview: string;
  junction: string;
}

export function getWireColors(colors: CanvasColors): WireColors {
  return {
    wireDefault: colors.wireDefault,
    wireSelected: colors.wireSelected,
    wirePreview: colors.wirePreview,
    junction: colors.junction,
  };
}

// ---------------------------------------------------------------------------
// Footprint Colors Subset (for footprint rendering)
// ---------------------------------------------------------------------------

export interface FootprintColors {
  background: string;
  gridDot: string;
  gridDotFaint: string;
  gridMajorLine: string;
  originCross: string;
  padFill: string;
  padStroke: string;
  padSelectedStroke: string;
  padSelectedFill: string;
  padNumber: string;
  padNumberLight: string;
  courtyard: string;
  courtyardStroke: string;
  silkscreen: string;
  fabOutline: string;
  fabFill: string;
  pin1Marker: string;
}

export function getFootprintColors(colors: CanvasColors): FootprintColors {
  return {
    background: colors.background,
    gridDot: colors.gridDot,
    gridDotFaint: colors.gridDotFaint,
    gridMajorLine: colors.gridMajorLine,
    originCross: colors.originCross,
    padFill: colors.padFill,
    padStroke: colors.padStroke,
    padSelectedStroke: colors.padSelectedStroke,
    padSelectedFill: colors.padSelectedFill,
    padNumber: colors.padNumber,
    padNumberLight: colors.padNumberLight,
    courtyard: colors.courtyard,
    courtyardStroke: colors.courtyardStroke,
    silkscreen: colors.silkscreen,
    fabOutline: colors.fabOutline,
    fabFill: colors.fabFill,
    pin1Marker: colors.pin1Marker,
  };
}
