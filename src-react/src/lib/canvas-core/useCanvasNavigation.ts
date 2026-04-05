/**
 * Canvas Core — Shared Navigation Hook
 *
 * Provides pan (middle-click/shift-click), zoom (wheel/pinch),
 * and DPR-aware canvas resizing for any Canvas2D component.
 */

import { type RefObject, useEffect } from "react";

// ---------------------------------------------------------------------------
// Wheel normalization (from useCanvasWheel)
// ---------------------------------------------------------------------------

const LINE_HEIGHT = 40;
const PAGE_HEIGHT = 800;

export function normalizeZoomDelta(e: WheelEvent): number {
  const modeScale = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.002;

  const pinchScale = e.ctrlKey ? 10 : 1;
  return -e.deltaY * modeScale * pinchScale;
}

export function normalizePanDelta(e: WheelEvent): { dx: number; dy: number } {
  let dx = e.deltaX;
  let dy = e.deltaY;

  if (e.deltaMode === 1) {
    dx *= LINE_HEIGHT;
    dy *= LINE_HEIGHT;
  } else if (e.deltaMode === 2) {
    dx *= PAGE_HEIGHT;
    dy *= PAGE_HEIGHT;
  }

  return { dx, dy };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface CanvasNavigationCallbacks {
  pan: (dx: number, dy: number) => void;
  zoomAt: (centerX: number, centerY: number, factor: number) => void;
}

/**
 * Attaches non-passive wheel listener for zoom/pan navigation.
 * - Ctrl/Cmd + wheel → zoom at cursor
 * - Plain wheel/trackpad → pan
 */
export function useCanvasNavigation(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  callbacks: CanvasNavigationCallbacks,
): void {
  const { pan, zoomAt } = callbacks;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handler = (e: WheelEvent) => {
      e.preventDefault();

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      if (e.ctrlKey || e.metaKey) {
        const delta = normalizeZoomDelta(e);
        const factor = Math.pow(2, delta);
        zoomAt(mouseX, mouseY, factor);
      } else {
        const { dx, dy } = normalizePanDelta(e);
        pan(-dx, -dy);
      }
    };

    canvas.addEventListener("wheel", handler, { passive: false });
    return () => canvas.removeEventListener("wheel", handler);
  }, [canvasRef, pan, zoomAt]);
}

// ---------------------------------------------------------------------------
// DPR-aware canvas resize utility
// ---------------------------------------------------------------------------

/**
 * Resize a canvas element to match its container, accounting for device pixel ratio.
 * Returns the CSS dimensions (for viewport calculations).
 */
export function resizeCanvasToContainer(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
): { width: number; height: number } {
  const dpr = window.devicePixelRatio || 1;
  const rect = container.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);

  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(dpr, dpr);
  }

  return { width, height };
}
