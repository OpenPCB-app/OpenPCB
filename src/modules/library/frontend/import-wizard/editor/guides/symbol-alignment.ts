import type {
  BoundsMm,
  PointMm,
} from "../../../../../../shared/rendering/types";
import { boundsFromGraphics } from "../../../../../../shared/rendering/geometry";
import {
  buildAlignmentIndexFromBoxes,
  type AlignmentIndex,
  type IdBox,
} from "../../../../../../shared/frontend/canvas/guides";
import type {
  EditorGraphicElement,
  EditorLabelElement,
  EditorPinElement,
} from "../types";

/** Small bbox around a pin's connection point (pins are treated as points). */
function pinBBox(pin: EditorPinElement): BoundsMm {
  const p = pin.positionMm;
  return { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
}

/** Build the alignment index over all non-dragged graphics + pins. */
export function buildSymbolAlignmentIndex(input: {
  graphics: readonly EditorGraphicElement[];
  pins: readonly EditorPinElement[];
  excludeIds: ReadonlySet<string>;
}): AlignmentIndex {
  const boxes: IdBox[] = [];
  for (const g of input.graphics) {
    if (input.excludeIds.has(g.id)) continue;
    const b = boundsFromGraphics([g.graphic]);
    if (b) boxes.push({ id: g.id, bbox: b });
  }
  for (const pin of input.pins) {
    if (input.excludeIds.has(pin.id)) continue;
    boxes.push({ id: pin.id, bbox: pinBBox(pin) });
  }
  return buildAlignmentIndexFromBoxes({ boxes });
}

function growToPoint(b: BoundsMm | null, p: PointMm): BoundsMm {
  if (!b) return { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
  return {
    minX: Math.min(b.minX, p.x),
    minY: Math.min(b.minY, p.y),
    maxX: Math.max(b.maxX, p.x),
    maxY: Math.max(b.maxY, p.y),
  };
}

/** Union bbox of the given selected element ids (graphics + pins + labels). */
export function selectionBBox(input: {
  graphics: readonly EditorGraphicElement[];
  pins: readonly EditorPinElement[];
  labels: readonly EditorLabelElement[];
  ids: ReadonlySet<string>;
}): BoundsMm | null {
  let bounds: BoundsMm | null = null;
  const grow = (b: BoundsMm): void => {
    bounds = bounds
      ? {
          minX: Math.min(bounds.minX, b.minX),
          minY: Math.min(bounds.minY, b.minY),
          maxX: Math.max(bounds.maxX, b.maxX),
          maxY: Math.max(bounds.maxY, b.maxY),
        }
      : b;
  };
  for (const g of input.graphics) {
    if (!input.ids.has(g.id)) continue;
    const b = boundsFromGraphics([g.graphic]);
    if (b) grow(b);
  }
  for (const pin of input.pins) {
    if (input.ids.has(pin.id)) bounds = growToPoint(bounds, pin.positionMm);
  }
  for (const l of input.labels) {
    if (input.ids.has(l.id)) bounds = growToPoint(bounds, l.label.at);
  }
  return bounds;
}
