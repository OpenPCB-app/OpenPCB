import { type RefObject, useEffect } from "react";

const LINE_HEIGHT = 40;
const PAGE_HEIGHT = 800;

/** Threshold for trackpad vs mouse detection. Trackpads emit smaller deltas. */
const TRACKPAD_DELTA_THRESHOLD = 50;

/**
 * Detects if the wheel event likely came from a trackpad vs a mouse wheel.
 * Trackpads typically emit smaller deltas in PIXEL mode.
 */
function isTrackpadEvent(e: WheelEvent): boolean {
  if (e.ctrlKey) return true;
  const absDeltaY = Math.abs(e.deltaY);
  const isSmallDelta = absDeltaY > 0 && absDeltaY < TRACKPAD_DELTA_THRESHOLD;
  const isPixelMode = e.deltaMode === 0;
  return isSmallDelta && isPixelMode;
}

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
 *
 * Input device handling:
 * - Mouse wheel: Zoom by default (Shift+wheel to pan)
 * - Trackpad: Pan on two-finger scroll, zoom on pinch (Ctrl+wheel)
 * - Ctrl/Cmd+wheel: Zoom for all devices
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

      const isZoomAction =
        e.ctrlKey || e.metaKey || (!e.shiftKey && !isTrackpadEvent(e));
      const isPanAction =
        e.shiftKey || (!e.ctrlKey && !e.metaKey && isTrackpadEvent(e));

      if (isZoomAction && !isPanAction) {
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
