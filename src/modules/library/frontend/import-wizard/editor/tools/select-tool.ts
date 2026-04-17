import type { InteractionEvent } from "../../../../../../shared/frontend/canvas/interaction/types";
import type {
  PointMm,
  PreviewGraphic,
} from "../../../../../../shared/rendering/types";
import { isDeleteShortcut } from "../../../../../../shared/frontend/canvas/utils/keyboard-shortcuts";
import {
  computeAabbFromPoints,
  isAabbNonEmpty,
  isGraphicFullyInsideAabb,
  isPointInAabb,
} from "../../../../../../shared/frontend/canvas/selection/rubber-band";
import type { EditorTool } from "../types";
import { useSymbolEditorStore } from "../useSymbolEditorStore";
import {
  eventToMmRaw,
  snapToGrid,
  translateGraphic,
} from "../../../../../../shared/frontend/canvas/tools/tool-utils";

const HIT_RADIUS_MM = 0.8;
const DOUBLE_CLICK_MS = 400;

interface DragState {
  startPoint: PointMm;
  originalGraphics: Map<string, PreviewGraphic>;
  originalPins: Map<string, PointMm>;
  originalLabels: Map<string, PointMm>;
  snapshotPushed: boolean;
}

interface RectSelectState {
  startPoint: PointMm;
  additive: boolean;
  initialSelection: Set<string>;
}

interface LastClick {
  id: string;
  timeMs: number;
}

/** Approximate label hit radius based on text width. */
function labelHitRadius(text: string, fontSizeMm: number): number {
  const width = Math.max(text.length * fontSizeMm * 0.62, fontSizeMm * 0.5);
  return Math.max(width / 2, HIT_RADIUS_MM);
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
  let rectSelectState: RectSelectState | null = null;
  let lastClick: LastClick | null = null;

  return {
    id: "select",
    cursor: "default",

    onDeactivate() {
      dragState = null;
      rectSelectState = null;
      lastClick = null;
      const store = useSymbolEditorStore.getState();
      store.setSelectionRect(null);
      store.cancelTextEdit();
    },

    onPointerDown(event: InteractionEvent) {
      const store = useSymbolEditorStore.getState();
      const point = eventToMmRaw(event);

      // Hit test — first match wins; graphics → pins → labels
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
        for (const element of store.labels) {
          const l = element.label;
          const r = labelHitRadius(l.text, l.fontSizeMm);
          const dist = Math.sqrt(
            (point.x - l.at.x) ** 2 + (point.y - l.at.y) ** 2,
          );
          if (dist < r) {
            hitId = element.id;
            break;
          }
        }
      }

      if (!hitId) {
        // Start rect-select. Shift preserves existing selection.
        rectSelectState = {
          startPoint: point,
          additive: event.modifiers.shift,
          initialSelection: event.modifiers.shift
            ? new Set(store.selectedIds)
            : new Set(),
        };
        store.setSelectionRect({ a: point, b: point });
        if (!event.modifiers.shift) store.clearSelection();
        lastClick = null;
        return;
      }

      // Double-click on a label → open inline text editor
      const now = Date.now();
      const isDoubleClick =
        lastClick !== null &&
        lastClick.id === hitId &&
        now - lastClick.timeMs < DOUBLE_CLICK_MS;
      lastClick = { id: hitId, timeMs: now };

      if (isDoubleClick) {
        const labelElement = store.labels.find((l) => l.id === hitId);
        if (labelElement) {
          store.beginTextEdit(
            labelElement.id,
            labelElement.label.at,
            event.screenPoint.x,
            event.screenPoint.y,
            labelElement.label.text,
          );
          return;
        }
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
      const originalLabels = new Map<string, PointMm>();
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
      for (const element of store.labels) {
        if (selection.has(element.id)) {
          originalLabels.set(element.id, element.label.at);
        }
      }

      dragState = {
        startPoint: point,
        originalGraphics,
        originalPins,
        originalLabels,
        snapshotPushed: false,
      };
    },

    onPointerMove(event: InteractionEvent) {
      const store = useSymbolEditorStore.getState();
      const current = eventToMmRaw(event);

      if (rectSelectState) {
        store.setSelectionRect({ a: rectSelectState.startPoint, b: current });
        return;
      }

      if (!dragState) return;
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
      for (const [id, originalAt] of dragState.originalLabels) {
        store.updateLabel(id, {
          at: { x: originalAt.x + dx, y: originalAt.y + dy },
        });
      }
      for (const [id, originalPos] of dragState.originalPins) {
        store.setPinPosition(id, {
          x: originalPos.x + dx,
          y: originalPos.y + dy,
        });
      }
    },

    onPointerUp(event: InteractionEvent) {
      // A drag consumes its starting click — invalidate the double-click
      // window so the next click-on-same-element doesn't spuriously open
      // the inline text editor. (Rect-select isn't a "click on element" so
      // doesn't need to touch lastClick either way.)
      if (dragState?.snapshotPushed) {
        lastClick = null;
      }

      if (rectSelectState) {
        const store = useSymbolEditorStore.getState();
        const endPoint = eventToMmRaw(event);
        const aabb = computeAabbFromPoints(
          rectSelectState.startPoint,
          endPoint,
        );

        if (isAabbNonEmpty(aabb)) {
          const picked = new Set<string>(rectSelectState.initialSelection);
          for (const g of store.graphics) {
            if (isGraphicFullyInsideAabb(g.graphic, aabb)) picked.add(g.id);
          }
          for (const p of store.pins) {
            if (isPointInAabb(p.positionMm, aabb)) picked.add(p.id);
          }
          for (const l of store.labels) {
            if (isPointInAabb(l.label.at, aabb)) picked.add(l.id);
          }
          store.setSelection(picked);
        }
        store.setSelectionRect(null);
        rectSelectState = null;
        return;
      }

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
