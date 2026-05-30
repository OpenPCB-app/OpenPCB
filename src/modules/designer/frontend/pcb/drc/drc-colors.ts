import type { DrcSeverity } from "../../../../../sdks";

/**
 * Centralized DRC violation colors for the PCB canvas. Single source of truth
 * for the marker badge + glow + selection/hover highlight so the look stays
 * consistent and tunable.
 *
 * Contrast strategy: every marker layers a bright white ring (`DRC_RING`) over a
 * dark stroke (`DRC_STROKE`) under the severity `core`. The white ring is the
 * key element that separates the marker from BOTH red/blue copper AND the
 * near-black canvas background — the previous design (severity core + dark halo)
 * vanished into red copper (error red on red trace) and into the dark bg.
 */
// Hues are deliberately kept clear of the copper palette (red F.Cu `#ff0000`,
// blue B.Cu `#1e40af`) so markers stay unique + vivid against the board:
//   error   → hot magenta/fuchsia (NOT red — red drowns in red top-copper)
//   warning → amber/gold
//   info    → cyan
export const DRC_SEVERITY: Record<DrcSeverity, { core: string; glow: string }> =
  {
    error: { core: "#ff2d9e", glow: "#ff66c2" },
    warning: { core: "#ffb020", glow: "#ffcc4d" },
    info: { core: "#38bdf8", glow: "#5cd0ff" },
  };

/** Bright ring around every marker — the contrast key (pops on red copper). */
export const DRC_RING = "#f8fafc";
/** Dark outer stroke — matte separation from light areas (silkscreen). */
export const DRC_STROKE = "#0b0f19";
/** Cyan overlay for the selected/hovered violation's offending trace(s). */
export const DRC_HIGHLIGHT = "#22d3ee";
