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
import { boundsFromGraphics } from "../../../../../../shared/rendering/geometry";
import type { BoundsMm } from "../../../../../../shared/rendering/types";
import {
  computeAlignmentGuides,
  translateBBox,
  SNAP_THRESHOLD_PX,
  type AlignmentIndex,
} from "../../../../../../shared/frontend/canvas/guides";
import type { FootprintEditorTool, EditorPadElement } from "../types";
import {
  useFootprintEditorStore,
  type FootprintEditorState,
} from "../useFootprintEditorStore";
import {
  buildFootprintAlignmentIndex,
  selectionBBox,
} from "../guides/footprint-alignment";
import { footprintViewZoom, pxToMm } from "../footprint-view-zoom";
import {
  eventToMmRaw,
  rotatePoint,
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
  originalPads: Map<string, PointMm>;
  originalGraphics: Map<string, PreviewGraphic>;
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

function hitTestPad(
  pad: EditorPadElement,
  point: PointMm,
  tol: number,
): boolean {
  // Transform the click into the pad's local (unrotated) frame.
  const local = pad.rotationDeg
    ? rotatePoint(point, pad.centerMm, -pad.rotationDeg)
    : point;
  const halfW = pad.widthMm / 2 + tol;
  const halfH = pad.heightMm / 2 + tol;
  return (
    Math.abs(local.x - pad.centerMm.x) < halfW &&
    Math.abs(local.y - pad.centerMm.y) < halfH
  );
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
    return Math.sqrt((point.x - px) ** 2 + (point.y - py) ** 2) < tol;
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

function labelHitRadius(
  text: string,
  fontSizeMm: number,
  tol: number,
): number {
  return Math.max(text.length * fontSizeMm * 0.62, fontSizeMm * 0.5, tol);
}

/** First element under `point` honoring layer visibility: pads → graphics → labels. */
function pickAt(
  store: FootprintEditorState,
  point: PointMm,
  tol: number,
): string | null {
  const vis = store.layerVisibility;
  for (const pad of store.pads) {
    if (!vis.has(pad.layer) && pad.layer !== "*.Cu") continue;
    if (pad.layer === "*.Cu" && !vis.has("F.Cu") && !vis.has("B.Cu")) continue;
    if (hitTestPad(pad, point, tol)) return pad.id;
  }
  for (const g of store.graphics) {
    if (!vis.has(g.layer)) continue;
    if (hitTestGraphic(g.graphic, point, tol)) return g.id;
  }
  for (const l of store.labels) {
    const layer = l.label.layer;
    if (layer && !vis.has(layer)) continue;
    const r = labelHitRadius(l.label.text, l.label.fontSizeMm, tol);
    const dist = Math.sqrt(
      (point.x - l.label.at.x) ** 2 + (point.y - l.label.at.y) ** 2,
    );
    if (dist < r) return l.id;
  }
  return null;
}

/** Reference point of the grabbed element, used as the grid-snap anchor. */
function anchorOf(store: FootprintEditorState, id: string, fallback: PointMm): PointMm {
  const pad = store.pads.find((p) => p.id === id);
  if (pad) return pad.centerMm;
  const g = store.graphics.find((el) => el.id === id);
  if (g) {
    const b = boundsFromGraphics([g.graphic]);
    if (b) return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  }
  const label = store.labels.find((l) => l.id === id);
  if (label) return label.label.at;
  return fallback;
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
      store.setHoveredId(null);
      store.clearAlignmentGuides();
      store.cancelTextEdit();
    },

    onPointerDown(event: InteractionEvent) {
      const store = useFootprintEditorStore.getState();
      const point = eventToMmRaw(event);
      const tol = pxToMm(HIT_PX);

      const hitId = pickAt(store, point, tol);

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
        startScreen: { x: event.screenPoint.x, y: event.screenPoint.y },
        anchorMm: anchorOf(store, hitId, point),
        originalPads,
        originalGraphics,
        originalLabels,
        index: buildFootprintAlignmentIndex({
          pads: store.pads,
          graphics: store.graphics,
          excludeIds: selection,
        }),
        baseBBox: selectionBBox({
          pads: store.pads,
          graphics: store.graphics,
          labels: store.labels,
          ids: selection,
        }),
        moved: false,
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

      if (!dragState) {
        // Idle hover affordance.
        const tol = pxToMm(HIT_PX);
        const hit = pickAt(store, current, tol);
        if (store.hoveredId !== hit) store.setHoveredId(hit);
        return;
      }

      // Dead-zone: a selecting click shouldn't nudge the element.
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

      // Snap the grabbed element's resulting position to grid (absolute), so the
      // group moves rigidly and the anchor lands on-grid — fine moves still work.
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

      // Figma-style alignment guides + magnetic snap (Alt suppresses the snap).
      if (store.alignmentGuidesVisible && dragState.index && dragState.baseBBox) {
        const result = computeAlignmentGuides({
          index: dragState.index,
          draggedBBoxMm: translateBBox(dragState.baseBBox, dx, dy),
          toleranceMm: SNAP_THRESHOLD_PX / footprintViewZoom.current,
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
        if (dx === 0 && dy === 0) return; // wait for the first real grid step
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

      if (dragState) {
        useFootprintEditorStore.getState().clearAlignmentGuides();
        dragState = null;
      }
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
