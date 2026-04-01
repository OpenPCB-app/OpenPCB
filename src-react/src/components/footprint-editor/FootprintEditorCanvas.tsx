/**
 * Footprint Editor Canvas
 *
 * HTML5 Canvas 2D component for rendering and editing footprint drafts.
 * Renders pads, graphics (courtyard, silkscreen, fab), and handles user interaction.
 */

import { useRef, useEffect, useCallback } from "react";
import { useFootprintEditorStore } from "./footprint-editor-store";
import {
  footprintToScreen,
  screenToFootprint,
  domEventToScreen,
  snapToGrid,
  createCenteredViewport,
  fitViewportToBounds,
  getPadBounds,
} from "./viewport";
import type { Bounds, FootprintGraphic, PadDefinition, Viewport } from "./types";
import { renderGrid, renderPad, renderGraphic, COLORS } from "./render-utils";

// ---------------------------------------------------------------------------
// Hit Testing
// ---------------------------------------------------------------------------

function hitTestPad(
  screenX: number,
  screenY: number,
  pad: PadDefinition,
  viewport: Viewport,
  threshold = 10,
): boolean {
  const bounds = getPadBounds(pad);
  const min = footprintToScreen(bounds.minX, bounds.maxY, viewport);
  const max = footprintToScreen(bounds.maxX, bounds.minY, viewport);
  const left = Math.min(min.x, max.x) - threshold;
  const right = Math.max(min.x, max.x) + threshold;
  const top = Math.min(min.y, max.y) - threshold;
  const bottom = Math.max(min.y, max.y) + threshold;
  if (screenX >= left && screenX <= right && screenY >= top && screenY <= bottom) {
    return true;
  }

  const tipScreen = footprintToScreen(pad.position.x, pad.position.y, viewport);
  const dx = screenX - tipScreen.x;
  const dy = screenY - tipScreen.y;
  return Math.sqrt(dx * dx + dy * dy) <= threshold;
}

function findPadAtScreen(
  screenX: number,
  screenY: number,
  pads: PadDefinition[],
  viewport: Viewport,
): PadDefinition | null {
  // Check in reverse order (top-most first)
  for (let i = pads.length - 1; i >= 0; i--) {
    const pad = pads[i];
    if (pad && hitTestPad(screenX, screenY, pad, viewport)) {
      return pad;
    }
  }
  return null;
}

function getGraphicBounds(graphic: FootprintGraphic): Bounds | null {
  switch (graphic.type) {
    case "line":
      return {
        minX: Math.min(graphic.start.x, graphic.end.x),
        minY: Math.min(graphic.start.y, graphic.end.y),
        maxX: Math.max(graphic.start.x, graphic.end.x),
        maxY: Math.max(graphic.start.y, graphic.end.y),
      };
    case "rect":
      return {
        minX: graphic.position.x - graphic.width / 2,
        minY: graphic.position.y - graphic.height / 2,
        maxX: graphic.position.x + graphic.width / 2,
        maxY: graphic.position.y + graphic.height / 2,
      };
    case "circle":
    case "arc":
      return {
        minX: graphic.center.x - graphic.radius,
        minY: graphic.center.y - graphic.radius,
        maxX: graphic.center.x + graphic.radius,
        maxY: graphic.center.y + graphic.radius,
      };
    case "polygon":
      if (graphic.points.length === 0) return null;
      return {
        minX: Math.min(...graphic.points.map((point) => point.x)),
        minY: Math.min(...graphic.points.map((point) => point.y)),
        maxX: Math.max(...graphic.points.map((point) => point.x)),
        maxY: Math.max(...graphic.points.map((point) => point.y)),
      };
    case "text":
      return {
        minX: graphic.position.x,
        minY: graphic.position.y,
        maxX: graphic.position.x,
        maxY: graphic.position.y,
      };
  }
}

function hitTestGraphic(screenX: number, screenY: number, graphic: FootprintGraphic, viewport: Viewport): boolean {
  const bounds = getGraphicBounds(graphic);
  if (!bounds) return false;
  const min = footprintToScreen(bounds.minX, bounds.maxY, viewport);
  const max = footprintToScreen(bounds.maxX, bounds.minY, viewport);
  return screenX >= Math.min(min.x, max.x) - 8 &&
    screenX <= Math.max(min.x, max.x) + 8 &&
    screenY >= Math.min(min.y, max.y) - 8 &&
    screenY <= Math.max(min.y, max.y) + 8;
}

function findGraphicAtScreen(screenX: number, screenY: number, graphics: FootprintGraphic[], viewport: Viewport): FootprintGraphic | null {
  for (let i = graphics.length - 1; i >= 0; i--) {
    const graphic = graphics[i];
    if (graphic && hitTestGraphic(screenX, screenY, graphic, viewport)) {
      return graphic;
    }
  }
  return null;
}

function translateGraphic(graphic: FootprintGraphic, dx: number, dy: number): FootprintGraphic {
  switch (graphic.type) {
    case "line":
      return {
        ...graphic,
        start: { x: graphic.start.x + dx, y: graphic.start.y + dy },
        end: { x: graphic.end.x + dx, y: graphic.end.y + dy },
      };
    case "rect":
      return { ...graphic, position: { x: graphic.position.x + dx, y: graphic.position.y + dy } };
    case "circle":
      return { ...graphic, center: { x: graphic.center.x + dx, y: graphic.center.y + dy } };
    case "arc":
      return { ...graphic, center: { x: graphic.center.x + dx, y: graphic.center.y + dy } };
    case "polygon":
      return { ...graphic, points: graphic.points.map((point) => ({ x: point.x + dx, y: point.y + dy })) };
    case "text":
      return { ...graphic, position: { x: graphic.position.x + dx, y: graphic.position.y + dy } };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FootprintEditorCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const isDraggingPad = useRef(false);
  const draggedPadId = useRef<string | null>(null);
  const isDraggingGraphic = useRef(false);
  const draggedGraphicId = useRef<string | null>(null);

  const draft = useFootprintEditorStore((s) => s.draft);
  const pan = useFootprintEditorStore((s) => s.pan);
  const zoomAt = useFootprintEditorStore((s) => s.zoomAt);
  const setViewport = useFootprintEditorStore((s) => s.setViewport);
  const selectPad = useFootprintEditorStore((s) => s.selectPad);
  const selectGraphic = useFootprintEditorStore((s) => s.selectGraphic);
  const clearSelection = useFootprintEditorStore((s) => s.clearSelection);
  const movePad = useFootprintEditorStore((s) => s.movePad);
  const updateGraphic = useFootprintEditorStore((s) => s.updateGraphic);

  // Resize canvas to fill container
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
  }, []);

  // Render frame
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;

    ctx.save();
    ctx.scale(dpr, dpr);

    // Clear
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, width, height);

    const store = useFootprintEditorStore.getState();
    const { viewport, gridSize, showGrid, selection } = store.chrome;
    const { pads, graphics } = store.draft;

    // Grid
    if (showGrid) {
      renderGrid(ctx, width, height, viewport, gridSize);
    }

    // Graphics (courtyard, silkscreen, fab)
    for (const graphic of graphics) {
      renderGraphic(ctx, graphic, viewport);
    }

    // Pads
    for (const pad of pads) {
      const isSelected = selection.selectedPadIds.has(pad.id);
      renderPad(ctx, pad, viewport, isSelected);
    }

    ctx.restore();
  }, []);

  // Animation loop
  useEffect(() => {
    let running = true;

    const loop = () => {
      if (!running) return;
      render();
      rafRef.current = requestAnimationFrame(loop);
    };

    loop();

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [render]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    resizeCanvas();

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        resizeCanvas();
      });
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [resizeCanvas]);

  // Initial centering
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    setViewport(createCenteredViewport(rect.width, rect.height));
  }, [setViewport]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !draft.importPreservation) return;

    const rect = container.getBoundingClientRect();
    setViewport(fitViewportToBounds(getFootprintDraftBounds(draft), rect.width, rect.height));
  }, [draft.id, draft.importPreservation?.sourceFileName, setViewport]);

  // Mouse handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      // Middle click or Shift+left click = pan
      if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        isPanning.current = true;
        lastMouse.current = { x: e.clientX, y: e.clientY };
        e.preventDefault();
        return;
      }

      if (e.button !== 0) return;

      const store = useFootprintEditorStore.getState();
      const screenPoint = domEventToScreen(e.clientX, e.clientY, canvas.getBoundingClientRect());
      const hitPad = findPadAtScreen(
        screenPoint.x,
        screenPoint.y,
        store.draft.pads,
        store.chrome.viewport,
      );
      const hitGraphic = hitPad
        ? null
        : findGraphicAtScreen(
            screenPoint.x,
            screenPoint.y,
            store.draft.graphics,
            store.chrome.viewport,
          );

      if (hitPad) {
        store.pushHistory();
        selectPad(hitPad.id, e.ctrlKey || e.metaKey);
        // Start dragging
        isDraggingPad.current = true;
        draggedPadId.current = hitPad.id;
        lastMouse.current = { x: e.clientX, y: e.clientY };
      } else if (hitGraphic) {
        store.pushHistory();
        selectGraphic(hitGraphic.id, e.ctrlKey || e.metaKey);
        isDraggingGraphic.current = true;
        draggedGraphicId.current = hitGraphic.id;
        lastMouse.current = { x: e.clientX, y: e.clientY };
      } else {
        clearSelection();
      }
    },
    [selectGraphic, selectPad, clearSelection],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (isPanning.current) {
        const dx = e.clientX - lastMouse.current.x;
        const dy = e.clientY - lastMouse.current.y;
        pan(dx, dy);
        lastMouse.current = { x: e.clientX, y: e.clientY };
        return;
      }

      if (isDraggingPad.current && draggedPadId.current) {
        const store = useFootprintEditorStore.getState();
        const screenPoint = domEventToScreen(e.clientX, e.clientY, canvas.getBoundingClientRect());
        const footprintPoint = screenToFootprint(screenPoint.x, screenPoint.y, store.chrome.viewport);
        const snappedPoint = snapToGrid(footprintPoint, store.chrome.gridSize);
        movePad(draggedPadId.current, snappedPoint);
        return;
      }

      if (isDraggingGraphic.current && draggedGraphicId.current) {
        const store = useFootprintEditorStore.getState();
        const previous = domEventToScreen(
          lastMouse.current.x,
          lastMouse.current.y,
          canvas.getBoundingClientRect(),
        );
        const current = domEventToScreen(
          e.clientX,
          e.clientY,
          canvas.getBoundingClientRect(),
        );
        const previousPoint = screenToFootprint(previous.x, previous.y, store.chrome.viewport);
        const currentPoint = screenToFootprint(current.x, current.y, store.chrome.viewport);
        const dx = currentPoint.x - previousPoint.x;
        const dy = currentPoint.y - previousPoint.y;
        const graphic = store.draft.graphics.find((entry) => entry.id === draggedGraphicId.current);
        if (graphic) {
          updateGraphic(graphic.id, translateGraphic(graphic, dx, dy));
          lastMouse.current = { x: e.clientX, y: e.clientY };
        }
      }
    },
    [pan, movePad, updateGraphic],
  );

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
    isDraggingPad.current = false;
    draggedPadId.current = null;
    isDraggingGraphic.current = false;
    draggedGraphicId.current = null;
  }, []);

  const handleMouseLeave = useCallback(() => {
    isPanning.current = false;
    isDraggingPad.current = false;
    draggedPadId.current = null;
    isDraggingGraphic.current = false;
    draggedGraphicId.current = null;
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoomAt(mouseX, mouseY, factor);
    },
    [zoomAt],
  );

  // Keyboard handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Delete" || e.key === "Backspace") {
        const store = useFootprintEditorStore.getState();
        const selectedIds = [...store.chrome.selection.selectedPadIds];
        const selectedGraphicIds = [...store.chrome.selection.selectedGraphicIds];
        if (selectedIds.length > 0) {
          store.removePads(selectedIds);
          e.preventDefault();
        } else if (selectedGraphicIds.length > 0) {
          store.removeGraphics(selectedGraphicIds);
          e.preventDefault();
        }
      }

      // Undo/Redo
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        if (e.shiftKey) {
          useFootprintEditorStore.getState().redo();
        } else {
          useFootprintEditorStore.getState().undo();
        }
        e.preventDefault();
      }

      // Select all
      if ((e.ctrlKey || e.metaKey) && e.key === "a") {
        useFootprintEditorStore.getState().selectAllPads();
        e.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div
      ref={containerRef}
      data-testid="footprint-editor-canvas-surface"
      className="relative h-full w-full overflow-hidden bg-background"
    >
      <canvas
        ref={canvasRef}
        data-testid="footprint-editor-canvas"
        className="absolute inset-0 cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}

function mergeBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function getFootprintDraftBounds(draft: ReturnType<typeof useFootprintEditorStore.getState>["draft"]): Bounds | null {
  let bounds: Bounds | null = null;
  for (const pad of draft.pads) {
    bounds = mergeBounds(bounds, getPadBounds(pad));
  }
  for (const graphic of draft.graphics) {
    bounds = mergeBounds(bounds, getGraphicBounds(graphic));
  }
  if (!bounds) return null;
  return {
    minX: bounds.minX - 1,
    minY: bounds.minY - 1,
    maxX: bounds.maxX + 1,
    maxY: bounds.maxY + 1,
  };
}
