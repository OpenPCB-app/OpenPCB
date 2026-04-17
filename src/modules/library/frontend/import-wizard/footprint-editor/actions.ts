import {
  boundsFromGraphics,
  emptyBoundsMm,
  includeGraphic,
  includePoint,
  isFiniteBoundsMm,
} from "../../../../../shared/rendering/geometry";
import type { PointMm } from "../../../../../shared/rendering/types";
import {
  normalizeRotationDeg,
  rotateGraphicAround,
  rotatePoint,
} from "../../../../../shared/frontend/canvas/tools/tool-utils";
import { useFootprintEditorStore } from "./useFootprintEditorStore";
import type {
  EditorPadElement,
  EditorFootprintGraphic,
  EditorFootprintLabel,
} from "./types";

export function rotateSelection(angleDeg: number): void {
  const store = useFootprintEditorStore.getState();
  const { selectedIds, pads, graphics, labels } = store;
  if (selectedIds.size === 0) return;

  const selPads = pads.filter((p) => selectedIds.has(p.id));
  const selGraphics = graphics.filter((g) => selectedIds.has(g.id));
  const selLabels = labels.filter((l) => selectedIds.has(l.id));
  if (
    selPads.length === 0 &&
    selGraphics.length === 0 &&
    selLabels.length === 0
  )
    return;

  const pivot = computePivot(selPads, selGraphics, selLabels);
  if (!pivot) return;

  store.pushSnapshot();

  for (const pad of selPads) {
    store.updatePad(pad.id, {
      centerMm: rotatePoint(pad.centerMm, pivot, angleDeg),
      rotationDeg: normalizeRotationDeg(pad.rotationDeg + angleDeg),
    });
  }
  for (const g of selGraphics) {
    store.setGraphic(g.id, rotateGraphicAround(g.graphic, pivot, angleDeg));
  }
  for (const l of selLabels) {
    store.updateLabel(l.id, {
      at: rotatePoint(l.label.at, pivot, angleDeg),
      rotationDeg: normalizeRotationDeg(l.label.rotationDeg + angleDeg),
    });
  }
}

function computePivot(
  pads: readonly EditorPadElement[],
  graphics: readonly EditorFootprintGraphic[],
  labels: readonly EditorFootprintLabel[],
): PointMm | null {
  const total = pads.length + graphics.length + labels.length;

  if (total === 1) {
    if (pads.length === 1) return pads[0]!.centerMm;
    if (labels.length === 1) return labels[0]!.label.at;
    const g = graphics[0]!.graphic;
    switch (g.kind) {
      case "rect":
        return { x: g.x + g.width / 2, y: g.y + g.height / 2 };
      case "circle":
        return { ...g.center };
      case "line":
        return { x: (g.a.x + g.b.x) / 2, y: (g.a.y + g.b.y) / 2 };
      case "arc3":
        return {
          x: (g.start.x + g.mid.x + g.end.x) / 3,
          y: (g.start.y + g.mid.y + g.end.y) / 3,
        };
      case "polyline":
      case "bezier": {
        const bounds = boundsFromGraphics([g]);
        if (!bounds) return null;
        return {
          x: (bounds.minX + bounds.maxX) / 2,
          y: (bounds.minY + bounds.maxY) / 2,
        };
      }
    }
  }

  let bounds = emptyBoundsMm();
  for (const pad of pads) bounds = includePoint(bounds, pad.centerMm);
  for (const g of graphics) bounds = includeGraphic(bounds, g.graphic);
  for (const l of labels) bounds = includePoint(bounds, l.label.at);
  if (!isFiniteBoundsMm(bounds)) return null;
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}
