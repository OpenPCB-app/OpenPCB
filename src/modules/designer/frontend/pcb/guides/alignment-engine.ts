/**
 * Placement-alignment guide engine (PCB-specific). Generates Figma-style
 * collinearity guides between the dragged placement(s) and the rest of the
 * board (other footprints + the board outline), equal-spacing/distribution
 * guides, and the best per-axis magnetic-snap correction.
 *
 * The index is built ONCE per drag-start; each pointer move only runs the
 * O(log n + k) `matchAxis` query plus a small neighbor scan for spacing.
 */

import type { PcbLayerId, PcbPlacedPart } from "../../../../../sdks";
import type { BoundsMm } from "../../../../../shared/rendering/types";
import { isPlacementVisible } from "../pcb-layer-visibility";
import { placementBoundsMm } from "../pcb-rect-hit";
import {
  matchAxis,
  sortFeatures,
  type AxisFeature,
  type AxisQuery,
} from "./axis-match";
import type { AlignmentGuide, SpacingGuide } from "./guide-types";

export interface AlignmentIndex {
  xFeatures: AxisFeature[];
  yFeatures: AxisFeature[];
  /** Non-dragged placement boxes, for equal-spacing detection. */
  boxes: Array<{ id: string; bbox: BoundsMm }>;
}

const EMPTY_INDEX: AlignmentIndex = { xFeatures: [], yFeatures: [], boxes: [] };

/**
 * Build the per-axis feature index over all NON-dragged, visible placements
 * (left/center/right → X, top/center/bottom → Y) plus, optionally, the board
 * outline's edges + center. Cross-extent = the source's span on the opposite
 * axis (used to size the drawn guide line).
 */
export function buildAlignmentIndex(input: {
  placements: readonly PcbPlacedPart[];
  excludeIds: ReadonlySet<string>;
  visibleLayers: ReadonlySet<PcbLayerId>;
  boardBoundsMm?: BoundsMm | null;
}): AlignmentIndex {
  const xFeatures: AxisFeature[] = [];
  const yFeatures: AxisFeature[] = [];
  const boxes: Array<{ id: string; bbox: BoundsMm }> = [];

  const pushBox = (id: string, b: BoundsMm): void => {
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    xFeatures.push(
      { coordMm: b.minX, crossMin: b.minY, crossMax: b.maxY, sourceId: id },
      { coordMm: cx, crossMin: b.minY, crossMax: b.maxY, sourceId: id },
      { coordMm: b.maxX, crossMin: b.minY, crossMax: b.maxY, sourceId: id },
    );
    yFeatures.push(
      { coordMm: b.minY, crossMin: b.minX, crossMax: b.maxX, sourceId: id },
      { coordMm: cy, crossMin: b.minX, crossMax: b.maxX, sourceId: id },
      { coordMm: b.maxY, crossMin: b.minX, crossMax: b.maxX, sourceId: id },
    );
  };

  for (const p of input.placements) {
    if (input.excludeIds.has(p.id)) continue;
    if (!isPlacementVisible(input.visibleLayers, p)) continue;
    const b = placementBoundsMm(p);
    if (!b) continue;
    pushBox(p.id, b);
    boxes.push({ id: p.id, bbox: b });
  }
  // Board outline contributes alignment lines (edges + center) but is not a
  // spacing neighbor.
  if (input.boardBoundsMm) pushBox("board", input.boardBoundsMm);

  if (xFeatures.length === 0 && yFeatures.length === 0) return EMPTY_INDEX;
  return {
    xFeatures: sortFeatures(xFeatures),
    yFeatures: sortFeatures(yFeatures),
    boxes,
  };
}

/** Union AABB of the given placements (drag-start group bbox). */
export function unionBBox(
  placements: readonly PcbPlacedPart[],
): BoundsMm | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;
  for (const p of placements) {
    const b = placementBoundsMm(p);
    if (!b) continue;
    found = true;
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return found ? { minX, minY, maxX, maxY } : null;
}

export function translateBBox(b: BoundsMm, dx: number, dy: number): BoundsMm {
  return {
    minX: b.minX + dx,
    minY: b.minY + dy,
    maxX: b.maxX + dx,
    maxY: b.maxY + dy,
  };
}

const X_KINDS = ["edge", "center", "edge"] as const;

export interface AlignmentResult {
  guides: AlignmentGuide[];
  spacing: SpacingGuide[];
  snap: { dx: number; dy: number };
}

/**
 * Query the index with the dragged group's live bbox. Returns collinearity
 * guides, equal-spacing guides, and the best magnetic-snap correction per axis
 * (collinearity wins; spacing fills an axis with no collinear match).
 */
export function computeAlignmentGuides(input: {
  index: AlignmentIndex;
  draggedBBoxMm: BoundsMm;
  toleranceMm: number;
}): AlignmentResult {
  const { index, draggedBBoxMm: b, toleranceMm } = input;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;

  const xQueries: AxisQuery[] = [
    { coordMm: b.minX, crossMin: b.minY, crossMax: b.maxY },
    { coordMm: cx, crossMin: b.minY, crossMax: b.maxY },
    { coordMm: b.maxX, crossMin: b.minY, crossMax: b.maxY },
  ];
  const yQueries: AxisQuery[] = [
    { coordMm: b.minY, crossMin: b.minX, crossMax: b.maxX },
    { coordMm: cy, crossMin: b.minX, crossMax: b.maxX },
    { coordMm: b.maxY, crossMin: b.minX, crossMax: b.maxX },
  ];

  const guides: AlignmentGuide[] = [];
  let snapDx = 0;
  let bestXAbs = Infinity;
  let snapDy = 0;
  let bestYAbs = Infinity;

  matchAxis(index.xFeatures, xQueries, toleranceMm).forEach((m, i) => {
    if (!m) return;
    guides.push({
      kind: X_KINDS[i]!,
      axis: "x",
      coordMm: m.coordMm,
      spanMinMm: m.crossMin,
      spanMaxMm: m.crossMax,
      deltaMm: m.deltaMm,
      sourceIds: m.sourceIds,
    });
    const abs = Math.abs(m.deltaMm);
    if (abs < bestXAbs) {
      bestXAbs = abs;
      snapDx = m.deltaMm;
    }
  });

  matchAxis(index.yFeatures, yQueries, toleranceMm).forEach((m, i) => {
    if (!m) return;
    guides.push({
      kind: X_KINDS[i]!,
      axis: "y",
      coordMm: m.coordMm,
      spanMinMm: m.crossMin,
      spanMaxMm: m.crossMax,
      deltaMm: m.deltaMm,
      sourceIds: m.sourceIds,
    });
    const abs = Math.abs(m.deltaMm);
    if (abs < bestYAbs) {
      bestYAbs = abs;
      snapDy = m.deltaMm;
    }
  });

  // Equal-spacing fills any axis that collinearity didn't already snap.
  const spacing = computeSpacingGuides(index.boxes, b, toleranceMm);
  if (bestXAbs === Infinity && spacing.snap.dx !== 0) snapDx = spacing.snap.dx;
  if (bestYAbs === Infinity && spacing.snap.dy !== 0) snapDy = spacing.snap.dy;

  return {
    guides: dedupeGuides(guides),
    spacing: spacing.guides,
    snap: { dx: snapDx, dy: snapDy },
  };
}

/** Overlap of two closed intervals (>0 means they share extent). */
function overlap(
  aMin: number,
  aMax: number,
  bMin: number,
  bMax: number,
): number {
  return Math.min(aMax, bMax) - Math.max(aMin, bMin);
}

/**
 * Detect equal spacing between the dragged box and its nearest flanking
 * neighbors on each axis (neighbors must overlap on the cross axis — i.e. be
 * in the same row/column). Snaps to equalize the two gaps when the required
 * correction is within tolerance.
 */
function computeSpacingGuides(
  boxes: ReadonlyArray<{ id: string; bbox: BoundsMm }>,
  dragged: BoundsMm,
  toleranceMm: number,
): { guides: SpacingGuide[]; snap: { dx: number; dy: number } } {
  const guides: SpacingGuide[] = [];
  const snap = { dx: 0, dy: 0 };

  const axisSpacing = (axis: "x" | "y"): void => {
    const dMin = axis === "x" ? dragged.minX : dragged.minY;
    const dMax = axis === "x" ? dragged.maxX : dragged.maxY;
    const crossMin = axis === "x" ? dragged.minY : dragged.minX;
    const crossMax = axis === "x" ? dragged.maxY : dragged.maxX;
    const crossLevel = (crossMin + crossMax) / 2;

    let left: { id: string; max: number } | null = null;
    let right: { id: string; min: number } | null = null;
    for (const box of boxes) {
      const bMin = axis === "x" ? box.bbox.minX : box.bbox.minY;
      const bMax = axis === "x" ? box.bbox.maxX : box.bbox.maxY;
      const bcMin = axis === "x" ? box.bbox.minY : box.bbox.minX;
      const bcMax = axis === "x" ? box.bbox.maxY : box.bbox.maxX;
      if (overlap(crossMin, crossMax, bcMin, bcMax) <= 0) continue; // not same row/col
      if (bMax <= dMin + toleranceMm && (!left || bMax > left.max)) {
        left = { id: box.id, max: bMax };
      }
      if (bMin >= dMax - toleranceMm && (!right || bMin < right.min)) {
        right = { id: box.id, min: bMin };
      }
    }
    if (!left || !right) return;

    const gapL = dMin - left.max;
    const gapR = right.min - dMax;
    if (gapL < 0 || gapR < 0) return;
    const delta = (gapR - gapL) / 2; // shift to equalize
    if (Math.abs(delta) > toleranceMm) return;

    const gapEq = (gapL + gapR) / 2;
    if (gapEq <= 0) return;
    const spans = [
      { fromMm: left.max, toMm: left.max + gapEq },
      { fromMm: right.min - gapEq, toMm: right.min },
    ];
    guides.push({
      axis,
      gapMm: gapEq,
      crossMm: crossLevel,
      spans,
      sourceIds: [left.id, right.id],
    });
    if (axis === "x") snap.dx = delta;
    else snap.dy = delta;
  };

  axisSpacing("x");
  axisSpacing("y");
  return { guides, snap };
}

/** Merge guides that fall on the same axis+coordinate (e.g. equal-size parts). */
function dedupeGuides(guides: AlignmentGuide[]): AlignmentGuide[] {
  const byKey = new Map<string, AlignmentGuide>();
  for (const g of guides) {
    const key = `${g.axis}:${g.coordMm.toFixed(4)}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...g, sourceIds: [...new Set(g.sourceIds)] });
      continue;
    }
    existing.spanMinMm = Math.min(existing.spanMinMm, g.spanMinMm);
    existing.spanMaxMm = Math.max(existing.spanMaxMm, g.spanMaxMm);
    existing.sourceIds = [...new Set([...existing.sourceIds, ...g.sourceIds])];
    if (g.kind === "center") existing.kind = "center";
  }
  return [...byKey.values()];
}
