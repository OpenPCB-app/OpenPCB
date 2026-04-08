/**
 * Drawing Tools for Symbol Editor
 *
 * Stateful tool handlers for line, rect, and circle drawing.
 * Each tool manages its own preview state and produces a SymbolGraphic on commit.
 */

import type { Point, SymbolGraphic } from "../types";

const DEFAULT_STROKE_WIDTH_MM = 0.254;

// ---------------------------------------------------------------------------
// Tool State
// ---------------------------------------------------------------------------

export type DrawingToolType = "line" | "rect" | "circle";

export interface DrawingToolState {
  type: DrawingToolType;
  /** First click point (symbol coords, grid-snapped) */
  startPoint: Point | null;
  /** Current mouse position (symbol coords, grid-snapped) */
  currentPoint: Point | null;
}

export function createDrawingToolState(
  type: DrawingToolType,
): DrawingToolState {
  return { type, startPoint: null, currentPoint: null };
}

// ---------------------------------------------------------------------------
// Preview Graphics (dashed outlines while drawing)
// ---------------------------------------------------------------------------

export function getDrawingPreview(
  state: DrawingToolState,
): SymbolGraphic | null {
  if (!state.startPoint || !state.currentPoint) return null;

  const { startPoint: s, currentPoint: c } = state;

  switch (state.type) {
    case "line":
      return {
        id: "__preview__",
        zIndex: 9999,
        type: "line",
        x1: s.x,
        y1: s.y,
        x2: c.x,
        y2: c.y,
        strokeWidth: DEFAULT_STROKE_WIDTH_MM,
      };

    case "rect": {
      const x = Math.min(s.x, c.x);
      const y = Math.min(s.y, c.y);
      const width = Math.abs(c.x - s.x);
      const height = Math.abs(c.y - s.y);
      return {
        id: "__preview__",
        zIndex: 9999,
        type: "rect",
        x,
        y,
        width,
        height,
        filled: false,
        strokeWidth: DEFAULT_STROKE_WIDTH_MM,
      };
    }

    case "circle": {
      const dx = c.x - s.x;
      const dy = c.y - s.y;
      const radius = Math.sqrt(dx * dx + dy * dy);
      return {
        id: "__preview__",
        zIndex: 9999,
        type: "circle",
        cx: s.x,
        cy: s.y,
        radius,
        filled: false,
        strokeWidth: DEFAULT_STROKE_WIDTH_MM,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Commit (finalize the graphic)
// ---------------------------------------------------------------------------

let graphicCounter = 0;

function nextGraphicId(type: DrawingToolType): string {
  graphicCounter += 1;
  return `${type}-${Date.now()}-${graphicCounter}`;
}

export function commitDrawing(state: DrawingToolState): SymbolGraphic | null {
  if (!state.startPoint || !state.currentPoint) return null;

  const { startPoint: s, currentPoint: c } = state;

  // Reject zero-size shapes
  if (s.x === c.x && s.y === c.y) return null;

  switch (state.type) {
    case "line":
      return {
        id: nextGraphicId("line"),
        zIndex: 0,
        type: "line",
        x1: s.x,
        y1: s.y,
        x2: c.x,
        y2: c.y,
        strokeWidth: DEFAULT_STROKE_WIDTH_MM,
      };

    case "rect": {
      const x = Math.min(s.x, c.x);
      const y = Math.min(s.y, c.y);
      const width = Math.abs(c.x - s.x);
      const height = Math.abs(c.y - s.y);
      if (width === 0 || height === 0) return null;
      return {
        id: nextGraphicId("rect"),
        zIndex: 0,
        type: "rect",
        x,
        y,
        width,
        height,
        filled: false,
        strokeWidth: DEFAULT_STROKE_WIDTH_MM,
      };
    }

    case "circle": {
      const dx = c.x - s.x;
      const dy = c.y - s.y;
      const radius = Math.sqrt(dx * dx + dy * dy);
      if (radius === 0) return null;
      return {
        id: nextGraphicId("circle"),
        zIndex: 0,
        type: "circle",
        cx: s.x,
        cy: s.y,
        radius,
        filled: false,
        strokeWidth: DEFAULT_STROKE_WIDTH_MM,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Tool event handlers
// ---------------------------------------------------------------------------

export function handleDrawingMouseDown(
  state: DrawingToolState,
  symbolPoint: Point,
): DrawingToolState {
  return { ...state, startPoint: symbolPoint, currentPoint: symbolPoint };
}

export function handleDrawingMouseMove(
  state: DrawingToolState,
  symbolPoint: Point,
): DrawingToolState {
  if (!state.startPoint) return state;
  return { ...state, currentPoint: symbolPoint };
}
