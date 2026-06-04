import type { InteractionEvent } from "../../../../../../shared/frontend/canvas/interaction/types";
import type {
  BoundsMm,
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
import {
  computeAlignmentGuides,
  translateBBox,
  SNAP_THRESHOLD_PX,
  type AlignmentIndex,
} from "../../../../../../shared/frontend/canvas/guides";
import type { EditorTool } from "../types";
import {
  useSymbolEditorStore,
  type SymbolEditorState,
} from "../useSymbolEditorStore";
import {
  buildSymbolAlignmentIndex,
  selectionBBox,
} from "../guides/symbol-alignment";
import { symbolViewZoom, pxToMm } from "../symbol-view-zoom";
import {
  eventToMmRaw,
  snapPointToGrid,
  translateGraphic,
} from "../../../../../../shared/frontend/canvas/tools/tool-utils";

/** Screen-pixel hit tolerance (converted to mm at the live zoom). */
const HIT_PX = 7;
/** Screen-pixel dead-zone before a selecting click turns into a drag. */
const DEAD_ZONE_PX = 3;
const DOUBLE_CLICK_MS = 400;

interface DragState {
  startPoint: PointMm;
  startScreen: { x: number; y: number };
  anchorMm: PointMm;
  originalGraphics: Map<string, PreviewGraphic>;
  originalPins: Map<string, PointMm>;
  originalLabels: Map<string, PointMm>;
  index: AlignmentIndex | null;
  baseBBox: BoundsMm | null;
  moved: boolean;
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
function labelHitRadius(text: string, fontSizeMm: number, tol: number): number {
  const width = Math.max(text.length * fontSizeMm * 0.62, fontSizeMm * 0.5);
  return Math.max(width / 2, tol);
}

function hitTestGraphic(
  graphic: PreviewGraphic,
  point: PointMm,
  tol: number,
): boolean {
  if (graphic.kind === "rect") {
    return (
      point.x >= graphic.x - tol &&
      point.x <= graphic.x + graphic.width + tol &&
      point.y >= graphic.y - tol &&
      point.y <= graphic.y + graphic.height + tol
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
    return dist < tol;
  }
  if (graphic.kind === "circle") {
    const dist = Math.sqrt(
      (point.x - graphic.center.x) ** 2 + (point.y - graphic.center.y) ** 2,
    );
    // Clickable across the whole disc (interior), not just the ring.
    return dist <= graphic.radiusMm + tol;
  }
  return false;
}

/** First element under `point`: graphics → pins → labels. */
function pickAt(
  store: SymbolEditorState,
  point: PointMm,
  tol: number,
): string | null {
  for (const element of store.graphics) {
    if (hitTestGraphic(element.graphic, point, tol)) return element.id;
  }
  for (const pin of store.pins) {
    const dist = Math.sqrt(
      (point.x - pin.positionMm.x) ** 2 + (point.y - pin.positionMm.y) ** 2,
    );
    if (dist < tol) return pin.id;
  }
  for (const element of store.labels) {
    const l = element.label;
    const r = labelHitRadius(l.text, l.fontSizeMm, tol);
    const dist = Math.sqrt((point.x - l.at.x) ** 2 + (point.y - l.at.y) ** 2);
    if (dist < r) return element.id;
  }
  return null;
}

/** Reference point of the grabbed element, used as the grid-snap anchor. */
function anchorOf(
  store: SymbolEditorState,
  id: string,
  fallback: PointMm,
): PointMm {
  const pin = store.pins.find((p) => p.id === id);
  if (pin) return pin.positionMm;
  const label = store.labels.find((l) => l.id === id);
  if (label) return label.label.at;
  return fallback;
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
      store.setHoveredId(null);
      store.clearAlignmentGuides();
      store.cancelTextEdit();
    },

    onPointerDown(event: InteractionEvent) {
      const store = useSymbolEditorStore.getState();
      const point = eventToMmRaw(event);
      const tol = pxToMm(HIT_PX);

      const hitId = pickAt(store, point, tol);

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
        if (selection.has(pin.id)) originalPins.set(pin.id, pin.positionMm);
      }
      for (const element of store.labels) {
        if (selection.has(element.id)) {
          originalLabels.set(element.id, element.label.at);
        }
      }

      dragState = {
        startPoint: point,
        startScreen: { x: event.screenPoint.x, y: event.screenPoint.y },
        anchorMm: anchorOf(store, hitId, point),
        originalGraphics,
        originalPins,
        originalLabels,
        index: buildSymbolAlignmentIndex({
          graphics: store.graphics,
          pins: store.pins,
          excludeIds: selection,
        }),
        baseBBox: selectionBBox({
          graphics: store.graphics,
          pins: store.pins,
          labels: store.labels,
          ids: selection,
        }),
        moved: false,
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

      if (!dragState) {
        const tol = pxToMm(HIT_PX);
        const hit = pickAt(store, current, tol);
        if (store.hoveredId !== hit) store.setHoveredId(hit);
        return;
      }

      if (!dragState.moved) {
        const movedPx = Math.hypot(
          event.screenPoint.x - dragState.startScreen.x,
          event.screenPoint.y - dragState.startScreen.y,
        );
        if (movedPx < DEAD_ZONE_PX) return;
        dragState.moved = true;
      }

      const rawDx = current.x - dragState.startPoint.x;
      const rawDy = current.y - dragState.startPoint.y;

      let dx = rawDx;
      let dy = rawDy;
      if (store.gridVisible) {
        const snapped = snapPointToGrid(
          { x: dragState.anchorMm.x + rawDx, y: dragState.anchorMm.y + rawDy },
          store.gridSizeMm,
        );
        dx = snapped.x - dragState.anchorMm.x;
        dy = snapped.y - dragState.anchorMm.y;
      }

      if (store.alignmentGuidesVisible && dragState.index && dragState.baseBBox) {
        const result = computeAlignmentGuides({
          index: dragState.index,
          draggedBBoxMm: translateBBox(dragState.baseBBox, dx, dy),
          toleranceMm: SNAP_THRESHOLD_PX / symbolViewZoom.current,
        });
        store.setAlignmentGuides(result.guides, result.spacing);
        if (!event.modifiers.alt) {
          dx += result.snap.dx;
          dy += result.snap.dy;
        }
      } else {
        store.clearAlignmentGuides();
      }

      if (!dragState.snapshotPushed) {
        if (dx === 0 && dy === 0) return;
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

      if (dragState) {
        useSymbolEditorStore.getState().clearAlignmentGuides();
        dragState = null;
      }
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
