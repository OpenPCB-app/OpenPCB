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
import type { FootprintEditorTool, EditorPadElement } from "../types";
import { useFootprintEditorStore } from "../useFootprintEditorStore";
import {
  eventToMmRaw,
  snapToGrid,
  translateGraphic,
} from "../../../../../../shared/frontend/canvas/tools/tool-utils";

const HIT_RADIUS_MM = 0.8;
const DOUBLE_CLICK_MS = 400;

interface DragState {
  startPoint: PointMm;
  originalPads: Map<string, PointMm>;
  originalGraphics: Map<string, PreviewGraphic>;
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

function hitTestPad(pad: EditorPadElement, point: PointMm): boolean {
  const halfW = pad.widthMm / 2 + HIT_RADIUS_MM;
  const halfH = pad.heightMm / 2 + HIT_RADIUS_MM;
  return (
    Math.abs(point.x - pad.centerMm.x) < halfW &&
    Math.abs(point.y - pad.centerMm.y) < halfH
  );
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
    return Math.sqrt((point.x - px) ** 2 + (point.y - py) ** 2) < HIT_RADIUS_MM;
  }
  if (graphic.kind === "circle") {
    const dist = Math.sqrt(
      (point.x - graphic.center.x) ** 2 + (point.y - graphic.center.y) ** 2,
    );
    return Math.abs(dist - graphic.radiusMm) < HIT_RADIUS_MM;
  }
  return false;
}

function labelHitRadius(text: string, fontSizeMm: number): number {
  return Math.max(
    text.length * fontSizeMm * 0.62,
    fontSizeMm * 0.5,
    HIT_RADIUS_MM,
  );
}

export function createSelectTool(): FootprintEditorTool {
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
      const store = useFootprintEditorStore.getState();
      store.setSelectionRect(null);
      store.cancelTextEdit();
    },

    onPointerDown(event: InteractionEvent) {
      const store = useFootprintEditorStore.getState();
      const point = eventToMmRaw(event);
      const vis = store.layerVisibility;

      // Hit test: pads → graphics → labels (respect layer visibility)
      let hitId: string | null = null;
      for (const pad of store.pads) {
        if (!vis.has(pad.layer) && pad.layer !== "*.Cu") continue;
        if (pad.layer === "*.Cu" && !vis.has("F.Cu") && !vis.has("B.Cu"))
          continue;
        if (hitTestPad(pad, point)) {
          hitId = pad.id;
          break;
        }
      }
      if (!hitId) {
        for (const g of store.graphics) {
          if (!vis.has(g.layer)) continue;
          if (hitTestGraphic(g.graphic, point)) {
            hitId = g.id;
            break;
          }
        }
      }
      if (!hitId) {
        for (const l of store.labels) {
          const layer = l.label.layer;
          if (layer && !vis.has(layer)) continue;
          const r = labelHitRadius(l.label.text, l.label.fontSizeMm);
          const dist = Math.sqrt(
            (point.x - l.label.at.x) ** 2 + (point.y - l.label.at.y) ** 2,
          );
          if (dist < r) {
            hitId = l.id;
            break;
          }
        }
      }

      if (!hitId) {
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

      // Double-click label → edit
      const now = Date.now();
      const isDoubleClick =
        lastClick !== null &&
        lastClick.id === hitId &&
        now - lastClick.timeMs < DOUBLE_CLICK_MS;
      lastClick = { id: hitId, timeMs: now };

      if (isDoubleClick) {
        const labelEl = store.labels.find((l) => l.id === hitId);
        if (labelEl) {
          store.beginTextEdit(
            labelEl.id,
            labelEl.label.at,
            event.screenPoint.x,
            event.screenPoint.y,
            labelEl.label.text,
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

      let selection = store.selectedIds;
      if (!selection.has(hitId)) {
        selection = new Set([hitId]);
        store.setSelection(selection);
      }

      const originalPads = new Map<string, PointMm>();
      const originalGraphics = new Map<string, PreviewGraphic>();
      const originalLabels = new Map<string, PointMm>();
      for (const p of store.pads) {
        if (selection.has(p.id)) originalPads.set(p.id, p.centerMm);
      }
      for (const g of store.graphics) {
        if (selection.has(g.id)) originalGraphics.set(g.id, g.graphic);
      }
      for (const l of store.labels) {
        if (selection.has(l.id)) originalLabels.set(l.id, l.label.at);
      }

      dragState = {
        startPoint: point,
        originalPads,
        originalGraphics,
        originalLabels,
        snapshotPushed: false,
      };
    },

    onPointerMove(event: InteractionEvent) {
      const store = useFootprintEditorStore.getState();
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

      for (const [id, original] of dragState.originalPads) {
        store.setPadPosition(id, { x: original.x + dx, y: original.y + dy });
      }
      for (const [id, original] of dragState.originalGraphics) {
        store.setGraphic(id, translateGraphic(original, dx, dy));
      }
      for (const [id, originalAt] of dragState.originalLabels) {
        store.updateLabel(id, {
          at: { x: originalAt.x + dx, y: originalAt.y + dy },
        });
      }
    },

    onPointerUp(event: InteractionEvent) {
      if (dragState?.snapshotPushed) {
        lastClick = null;
      }

      if (rectSelectState) {
        const store = useFootprintEditorStore.getState();
        const endPoint = eventToMmRaw(event);
        const aabb = computeAabbFromPoints(
          rectSelectState.startPoint,
          endPoint,
        );

        if (isAabbNonEmpty(aabb)) {
          const picked = new Set<string>(rectSelectState.initialSelection);
          const vis = store.layerVisibility;
          for (const p of store.pads) {
            if (!vis.has(p.layer) && p.layer !== "*.Cu") continue;
            if (isPointInAabb(p.centerMm, aabb)) picked.add(p.id);
          }
          for (const g of store.graphics) {
            if (!vis.has(g.layer)) continue;
            if (isGraphicFullyInsideAabb(g.graphic, aabb)) picked.add(g.id);
          }
          for (const l of store.labels) {
            const layer = l.label.layer;
            if (layer && !vis.has(layer)) continue;
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
        const store = useFootprintEditorStore.getState();
        if (store.selectedIds.size > 0) {
          event.preventDefault();
          store.pushSnapshot();
          store.removeSelected();
        }
      }
    },
  };
}
