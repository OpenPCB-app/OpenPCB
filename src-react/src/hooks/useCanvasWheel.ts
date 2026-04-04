import { type RefObject, useEffect } from "react";

const LINE_HEIGHT = 40;
const PAGE_HEIGHT = 800;

/** Returns a logarithmic zoom delta suitable for `Math.pow(2, result)`. */
export function normalizeZoomDelta(e: WheelEvent): number {
  const modeScale =
    e.deltaMode === 1
      ? 0.05 // DOM_DELTA_LINE (Firefox mouse wheel)
      : e.deltaMode === 2
        ? 1 // DOM_DELTA_PAGE (rare)
        : 0.002; // DOM_DELTA_PIXEL (trackpad / Chrome mouse)

  // Pinch-to-zoom sends ~10x smaller deltas than mouse wheel
  const pinchScale = e.ctrlKey ? 10 : 1;

  return -e.deltaY * modeScale * pinchScale;
}

/** Converts wheel deltas to pixel-equivalent pan offsets. */
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

interface CanvasWheelCallbacks {
  pan: (dx: number, dy: number) => void;
  zoomAt: (centerX: number, centerY: number, factor: number) => void;
}

/**
 * Attaches a non-passive native wheel listener to a canvas element.
 * - ctrlKey (pinch / Ctrl+scroll) → zoom to cursor
 * - no ctrlKey (two-finger scroll / mouse wheel) → pan
 */
export function useCanvasWheel(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  callbacks: CanvasWheelCallbacks,
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
