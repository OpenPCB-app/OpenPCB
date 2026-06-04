/**
 * Visual-guide model shared by the placement-alignment engine and the route
 * guide engine. Pure data — no React / three / PCB imports — so the 1-D
 * matcher and these types can be promoted to `shared/frontend/canvas/guides/`
 * if the schematic editor adopts them later.
 *
 * Coordinates are world millimetres (PCB scene units). A `LineGuide` is an
 * axis-aligned collinearity line; a `RayGuide` is a routing assist ray.
 */

export type GuideAxis = "x" | "y";

/**
 * A 1-D collinearity guide: an axis-aligned line at a fixed coordinate.
 *  - `axis:"x"` → a VERTICAL line at `coordMm` (shared X).
 *  - `axis:"y"` → a HORIZONTAL line at `coordMm` (shared Y).
 * `spanMin/MaxMm` is the draw extent on the *other* axis (union of the matched
 * features and the moving object) so the line only spans the relevant region.
 */
export interface LineGuide {
  kind: "edge" | "center" | "collinear-pad";
  axis: GuideAxis;
  coordMm: number;
  spanMinMm: number;
  spanMaxMm: number;
  /** Correction to add to the moving feature's coord to land exactly on the guide. */
  deltaMm: number;
  /** Ids of the placements / pads / endpoints this guide aligns to. */
  sourceIds: string[];
}

/** Routing assist ray emanating from the live route anchor. */
export interface RayGuide {
  kind: "extend-direction" | "ray-45" | "ray-axis";
  originMm: { x: number; y: number };
  /** Unit direction of the ray. */
  dirMm: { x: number; y: number };
  /** Cursor projected onto the ray — the magnetic snap point, when within tol. */
  snapPointMm?: { x: number; y: number };
  sourceIds: string[];
}

/**
 * Equal-spacing (distribution) indicator: the dragged object sits with equal
 * gaps to its flanking neighbors on one axis. Drawn as two equal gap bars at
 * the `crossMm` row/column level.
 */
export interface SpacingGuide {
  axis: GuideAxis;
  gapMm: number;
  /** Cross-axis level at which to draw the gap bars. */
  crossMm: number;
  /** The two equal gaps as [from,to] coordinates along `axis`. */
  spans: Array<{ fromMm: number; toMm: number }>;
  sourceIds: string[];
}

/** Guides produced while dragging/placing components (Phase 1). */
export type AlignmentGuide = LineGuide;

/** Guides produced while routing a trace (Phase 2). */
export type RouteGuide = LineGuide | RayGuide;

export function isRayGuide(g: RouteGuide): g is RayGuide {
  return (
    g.kind === "extend-direction" ||
    g.kind === "ray-45" ||
    g.kind === "ray-axis"
  );
}

/** Subtle colored-by-meaning palette — echoes SnapTargetIndicator semantics. */
export const GUIDE_COLORS = {
  /** placement edge/center alignment */
  align: "#8b5cf6", // violet
  /** route 45° / axis / extend-direction rays */
  ray: "#22d3ee", // cyan
  /** collinear-pad (matches SnapTargetIndicator pad-center yellow) */
  pad: "#fde047", // yellow
  /** equal-spacing / distribution indicators */
  spacing: "#34d399", // emerald
} as const;

export const GUIDE_OPACITY = 0.45;

/** Screen-pixel activation/snap threshold (→ mm via `/ pxPerMm`). */
export const SNAP_THRESHOLD_PX = 8;
