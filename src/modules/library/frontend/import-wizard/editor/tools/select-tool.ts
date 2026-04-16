import type { InteractionEvent } from "../../../../../../shared/frontend/canvas/interaction/types";
import type {
  PointMm,
  PreviewGraphic,
} from "../../../../../../shared/rendering/types";
import { isDeleteShortcut } from "../../../../../../shared/frontend/canvas/utils/keyboard-shortcuts";
import type { EditorTool } from "../types";
import { snapToGrid, useSymbolEditorStore } from "../useSymbolEditorStore";
import { eventToMmRaw, translateGraphic } from "./tool-utils";

const HIT_RADIUS_MM = 0.8;

interface DragState {
  startPoint: PointMm;
  originalGraphics: Map<string, PreviewGraphic>;
  originalPins: Map<string, PointMm>;
  snapshotPushed: boolean;
}

function hitTestGraphic(graphic: PreviewGraphic, point: PointMm): boolean {
  if (graphic.kind === "rect") {
    return (
      point.x >= graphic.x - HIT_RADIUS_MM &&
      point.x <= graphic.x + graphic.width + HIT_RADIUS_MM &&
      point.y >= graphic.y - HIT_RADIUS_MM &&
      point.y <= graphic.y + graphic.height + HIT_RADIUS_MM
    );
  }
  if (graphic.kind === "line") {
    const dx = graphic.b.x - graphic.a.x;
    const dy = graphic.b.y - graphic.a.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return false;
    const t = Math.max(
      0,
      Math.min(
        1,
        ((point.x - graphic.a.x) * dx + (point.y - graphic.a.y) * dy) / len2,
      ),
    );
    const px = graphic.a.x + t * dx;
    const py = graphic.a.y + t * dy;
    const dist = Math.sqrt((point.x - px) ** 2 + (point.y - py) ** 2);
    return dist < HIT_RADIUS_MM;
  }
  if (graphic.kind === "circle") {
    const dist = Math.sqrt(
      (point.x - graphic.center.x) ** 2 + (point.y - graphic.center.y) ** 2,
    );
    return Math.abs(dist - graphic.radiusMm) < HIT_RADIUS_MM;
  }
  return false;
}

export function createSelectTool(): EditorTool {
  let dragState: DragState | null = null;

  return {
    id: "select",
    cursor: "default",

    onDeactivate() {
      dragState = null;
    },

    onPointerDown(event: InteractionEvent) {
      const store = useSymbolEditorStore.getState();
      const point = eventToMmRaw(event);

      // Hit test — first match wins, graphics before pins
      let hitId: string | null = null;
      for (const element of store.graphics) {
        if (hitTestGraphic(element.graphic, point)) {
          hitId = element.id;
          break;
        }
      }
      if (!hitId) {
        for (const pin of store.pins) {
          const dist = Math.sqrt(
            (point.x - pin.positionMm.x) ** 2 +
              (point.y - pin.positionMm.y) ** 2,
          );
          if (dist < HIT_RADIUS_MM) {
            hitId = pin.id;
            break;
          }
        }
      }

      if (!hitId) {
        if (!event.modifiers.shift) store.clearSelection();
        return;
      }

      if (event.modifiers.shift) {
        const next = new Set(store.selectedIds);
        if (next.has(hitId)) next.delete(hitId);
        else next.add(hitId);
        store.setSelection(next);
        return;
      }

      // Non-shift click on element: ensure it's selected, then begin drag
      let selection = store.selectedIds;
      if (!selection.has(hitId)) {
        selection = new Set([hitId]);
        store.setSelection(selection);
      }

      const originalGraphics = new Map<string, PreviewGraphic>();
      const originalPins = new Map<string, PointMm>();
      for (const element of store.graphics) {
        if (selection.has(element.id)) {
          originalGraphics.set(element.id, element.graphic);
        }
      }
      for (const pin of store.pins) {
        if (selection.has(pin.id)) {
          originalPins.set(pin.id, pin.positionMm);
        }
      }

      dragState = {
        startPoint: point,
        originalGraphics,
        originalPins,
        snapshotPushed: false,
      };
    },

    onPointerMove(event: InteractionEvent) {
      if (!dragState) return;
      const store = useSymbolEditorStore.getState();
      const current = eventToMmRaw(event);
      let dx = current.x - dragState.startPoint.x;
      let dy = current.y - dragState.startPoint.y;
      if (store.gridVisible) {
        dx = snapToGrid(dx, store.gridSizeMm);
        dy = snapToGrid(dy, store.gridSizeMm);
      }

      if (dx === 0 && dy === 0) return;

      if (!dragState.snapshotPushed) {
        store.pushSnapshot();
        dragState.snapshotPushed = true;
      }

      for (const [id, original] of dragState.originalGraphics) {
        store.setGraphic(id, translateGraphic(original, dx, dy));
      }
      for (const [id, originalPos] of dragState.originalPins) {
        store.setPinPosition(id, {
          x: originalPos.x + dx,
          y: originalPos.y + dy,
        });
      }
    },

    onPointerUp() {
      dragState = null;
    },

    onKeyDown(event: KeyboardEvent) {
      if (isDeleteShortcut(event)) {
        const store = useSymbolEditorStore.getState();
        if (store.selectedIds.size > 0) {
          event.preventDefault();
          store.pushSnapshot();
          store.removeSelected();
        }
      }
    },
  };
}
