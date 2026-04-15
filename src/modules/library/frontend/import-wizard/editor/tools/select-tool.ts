import type { InteractionEvent } from "../../../../../../shared/frontend/canvas/interaction/types";
import { isDeleteShortcut } from "../../../../../../shared/frontend/canvas/utils/keyboard-shortcuts";
import type { EditorTool } from "../types";
import { useSymbolEditorStore } from "../useSymbolEditorStore";
import { eventToMmRaw } from "./tool-utils";

const HIT_RADIUS_MM = 0.8;

export function createSelectTool(): EditorTool {
  return {
    id: "select",
    cursor: "default",

    onPointerDown(event: InteractionEvent) {
      const store = useSymbolEditorStore.getState();
      const point = eventToMmRaw(event);

      // Hit test graphics
      for (const element of store.graphics) {
        const g = element.graphic;
        let hit = false;

        if (g.kind === "rect") {
          hit =
            point.x >= g.x - HIT_RADIUS_MM &&
            point.x <= g.x + g.width + HIT_RADIUS_MM &&
            point.y >= g.y - HIT_RADIUS_MM &&
            point.y <= g.y + g.height + HIT_RADIUS_MM;
        } else if (g.kind === "line") {
          const dx = g.b.x - g.a.x;
          const dy = g.b.y - g.a.y;
          const len2 = dx * dx + dy * dy;
          if (len2 > 0) {
            const t = Math.max(
              0,
              Math.min(
                1,
                ((point.x - g.a.x) * dx + (point.y - g.a.y) * dy) / len2,
              ),
            );
            const px = g.a.x + t * dx;
            const py = g.a.y + t * dy;
            const dist = Math.sqrt((point.x - px) ** 2 + (point.y - py) ** 2);
            hit = dist < HIT_RADIUS_MM;
          }
        } else if (g.kind === "circle") {
          const dist = Math.sqrt(
            (point.x - g.center.x) ** 2 + (point.y - g.center.y) ** 2,
          );
          hit = Math.abs(dist - g.radiusMm) < HIT_RADIUS_MM;
        }

        if (hit) {
          if (event.modifiers.shift) {
            const next = new Set(store.selectedIds);
            if (next.has(element.id)) {
              next.delete(element.id);
            } else {
              next.add(element.id);
            }
            store.setSelection(next);
          } else {
            store.setSelection(new Set([element.id]));
          }
          return;
        }
      }

      // Hit test pins
      for (const pin of store.pins) {
        const dist = Math.sqrt(
          (point.x - pin.positionMm.x) ** 2 + (point.y - pin.positionMm.y) ** 2,
        );
        if (dist < HIT_RADIUS_MM) {
          if (event.modifiers.shift) {
            const next = new Set(store.selectedIds);
            if (next.has(pin.id)) {
              next.delete(pin.id);
            } else {
              next.add(pin.id);
            }
            store.setSelection(next);
          } else {
            store.setSelection(new Set([pin.id]));
          }
          return;
        }
      }

      // Click on empty space — clear selection
      store.clearSelection();
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
