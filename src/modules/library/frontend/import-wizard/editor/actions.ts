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
} from "./tools/tool-utils";
import { useSymbolEditorStore } from "./useSymbolEditorStore";

/**
 * Rotate all currently selected graphics and pins by `angleDeg` (CCW in Y-up).
 * Pivot is:
 *   - the element's own anchor/center when exactly one item is selected
 *   - the combined bbox center for multi-selection
 * Pushes an undo snapshot before mutating.
 */
export function rotateSelection(angleDeg: number): void {
  const store = useSymbolEditorStore.getState();
  const { selectedIds, graphics, pins } = store;
  if (selectedIds.size === 0) return;

  const selectedGraphics = graphics.filter((g) => selectedIds.has(g.id));
  const selectedPins = pins.filter((p) => selectedIds.has(p.id));
  if (selectedGraphics.length === 0 && selectedPins.length === 0) return;

  const pivot = computePivot(selectedGraphics, selectedPins);
  if (!pivot) return;

  store.pushSnapshot();

  for (const element of selectedGraphics) {
    store.setGraphic(
      element.id,
      rotateGraphicAround(element.graphic, pivot, angleDeg),
    );
  }
  for (const pin of selectedPins) {
    store.updatePin(pin.id, {
      positionMm: rotatePoint(pin.positionMm, pivot, angleDeg),
      rotationDeg: normalizeRotationDeg(pin.rotationDeg + angleDeg),
    });
  }
}

function computePivot(
  selectedGraphics: ReturnType<
    typeof useSymbolEditorStore.getState
  >["graphics"],
  selectedPins: ReturnType<typeof useSymbolEditorStore.getState>["pins"],
): PointMm | null {
  // Single item → rotate around its own anchor/center
  if (selectedGraphics.length + selectedPins.length === 1) {
    if (selectedPins.length === 1) return selectedPins[0]!.positionMm;
    const g = selectedGraphics[0]!.graphic;
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

  // Multi-select → combined bbox center
  let bounds = emptyBoundsMm();
  for (const element of selectedGraphics) {
    bounds = includeGraphic(bounds, element.graphic);
  }
  for (const pin of selectedPins) {
    bounds = includePoint(bounds, pin.positionMm);
  }
  if (!isFiniteBoundsMm(bounds)) return null;
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}
