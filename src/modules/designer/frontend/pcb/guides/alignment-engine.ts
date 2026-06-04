/**
 * PCB adapter over the generic placement-alignment engine. Builds `{id,bbox}`
 * boxes from board placements (+ the board outline) and delegates the actual
 * collinearity / spacing / snap computation to the shared engine in
 * `shared/frontend/canvas/guides/alignment-core`.
 *
 * The index is built ONCE per drag-start; each pointer move runs the shared
 * O(log n + k) query.
 */

import type { PcbLayerId, PcbPlacedPart } from "../../../../../sdks";
import type { BoundsMm } from "../../../../../shared/rendering/types";
import { isPlacementVisible } from "../pcb-layer-visibility";
import { placementBoundsMm } from "../pcb-rect-hit";
import {
  buildAlignmentIndexFromBoxes,
  type AlignmentIndex,
  type IdBox,
} from "../../../../../shared/frontend/canvas/guides/alignment-core";

// Re-export the generic query + helpers so existing PCB importers are unchanged.
export {
  computeAlignmentGuides,
  translateBBox,
} from "../../../../../shared/frontend/canvas/guides/alignment-core";
export type {
  AlignmentIndex,
  AlignmentResult,
} from "../../../../../shared/frontend/canvas/guides/alignment-core";

/**
 * Build the per-axis feature index over all NON-dragged, visible placements
 * plus, optionally, the board outline's edges + center (feature-only — not a
 * spacing neighbor).
 */
export function buildAlignmentIndex(input: {
  placements: readonly PcbPlacedPart[];
  excludeIds: ReadonlySet<string>;
  visibleLayers: ReadonlySet<PcbLayerId>;
  boardBoundsMm?: BoundsMm | null;
}): AlignmentIndex {
  const boxes: IdBox[] = [];
  for (const p of input.placements) {
    if (input.excludeIds.has(p.id)) continue;
    if (!isPlacementVisible(input.visibleLayers, p)) continue;
    const b = placementBoundsMm(p);
    if (!b) continue;
    boxes.push({ id: p.id, bbox: b });
  }
  const featureOnlyBoxes: IdBox[] = input.boardBoundsMm
    ? [{ id: "board", bbox: input.boardBoundsMm }]
    : [];
  return buildAlignmentIndexFromBoxes({ boxes, featureOnlyBoxes });
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
