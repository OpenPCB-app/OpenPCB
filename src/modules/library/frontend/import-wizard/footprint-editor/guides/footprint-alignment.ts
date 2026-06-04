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
  EditorPadElement,
  EditorFootprintGraphic,
  EditorFootprintLabel,
} from "../types";

/** Axis-aligned bbox of a pad (rotation approximated for v1). */
export function padBBox(pad: EditorPadElement): BoundsMm {
  const hw = pad.widthMm / 2;
  const hh = pad.heightMm / 2;
  return {
    minX: pad.centerMm.x - hw,
    minY: pad.centerMm.y - hh,
    maxX: pad.centerMm.x + hw,
    maxY: pad.centerMm.y + hh,
  };
}

/** Build the alignment index over all non-dragged pads + graphics. */
export function buildFootprintAlignmentIndex(input: {
  pads: readonly EditorPadElement[];
  graphics: readonly EditorFootprintGraphic[];
  excludeIds: ReadonlySet<string>;
}): AlignmentIndex {
  const boxes: IdBox[] = [];
  for (const p of input.pads) {
    if (input.excludeIds.has(p.id)) continue;
    boxes.push({ id: p.id, bbox: padBBox(p) });
  }
  for (const g of input.graphics) {
    if (input.excludeIds.has(g.id)) continue;
    const b = boundsFromGraphics([g.graphic]);
    if (b) boxes.push({ id: g.id, bbox: b });
  }
  return buildAlignmentIndexFromBoxes({ boxes });
}

function includePoint(b: BoundsMm, p: PointMm): BoundsMm {
  return {
    minX: Math.min(b.minX, p.x),
    minY: Math.min(b.minY, p.y),
    maxX: Math.max(b.maxX, p.x),
    maxY: Math.max(b.maxY, p.y),
  };
}

/** Union bbox of the given selected element ids (pads + graphics + labels). */
export function selectionBBox(input: {
  pads: readonly EditorPadElement[];
  graphics: readonly EditorFootprintGraphic[];
  labels: readonly EditorFootprintLabel[];
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
  for (const p of input.pads) if (input.ids.has(p.id)) grow(padBBox(p));
  for (const g of input.graphics) {
    if (!input.ids.has(g.id)) continue;
    const b = boundsFromGraphics([g.graphic]);
    if (b) grow(b);
  }
  for (const l of input.labels) {
    if (!input.ids.has(l.id)) continue;
    const at = l.label.at;
    grow(includePoint({ minX: at.x, minY: at.y, maxX: at.x, maxY: at.y }, at));
  }
  return bounds;
}
