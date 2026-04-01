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
} from "./viewport";
import type { PadDefinition, Viewport } from "./types";
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
  const tipScreen = footprintToScreen(pad.position.x, pad.position.y, viewport);
  const hw = (pad.size.width * 50 * viewport.zoom) / 2;
  const hh = (pad.size.height * 50 * viewport.zoom) / 2;
  
  const dx = screenX - tipScreen.x;
  const dy = screenY - tipScreen.y;
  
  // Check if point is within pad bounding box
  if (Math.abs(dx) <= hw + threshold && Math.abs(dy) <= hh + threshold) {
    return true;
  }
  
  // Also check center point for small pads
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

  const chrome = useFootprintEditorStore((s) => s.chrome);
  const pan = useFootprintEditorStore((s) => s.pan);
  const zoomAt = useFootprintEditorStore((s) => s.zoomAt);
  const setViewport = useFootprintEditorStore((s) => s.setViewport);
  const selectPad = useFootprintEditorStore((s) => s.selectPad);
  const clearSelection = useFootprintEditorStore((s) => s.clearSelection);
  const movePad = useFootprintEditorStore((s) => s.movePad);

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
      resizeCanvas();
      // Center viewport on resize
      const rect = container.getBoundingClientRect();
      setViewport(createCenteredViewport(rect.width, rect.height, chrome.viewport.zoom));
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [resizeCanvas, setViewport, chrome.viewport.zoom]);

  // Initial centering
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    setViewport(createCenteredViewport(rect.width, rect.height));
  }, [setViewport]);

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

      if (hitPad) {
        selectPad(hitPad.id, e.ctrlKey || e.metaKey);
        // Start dragging
        isDraggingPad.current = true;
        draggedPadId.current = hitPad.id;
        lastMouse.current = { x: e.clientX, y: e.clientY };
      } else {
        clearSelection();
      }
    },
    [selectPad, clearSelection],
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
      }
    },
    [pan, movePad],
  );

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
    isDraggingPad.current = false;
    draggedPadId.current = null;
  }, []);

  const handleMouseLeave = useCallback(() => {
    isPanning.current = false;
    isDraggingPad.current = false;
    draggedPadId.current = null;
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
        if (selectedIds.length > 0) {
          store.removePads(selectedIds);
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