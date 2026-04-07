/**
 * Render Engine — EDA Camera Configuration
 *
 * Custom wheel/trackpad handler that preserves the existing useCanvasWheel
 * normalization (browser-specific delta handling, pinch-to-zoom, Figma-style pan)
 * and pipes results into Three.js OrthographicCamera via CameraControls.
 *
 * Input device handling:
 * - Mouse wheel: Zoom by default (inverted from traditional Figma-style)
 * - Trackpad (detected via delta pattern): Pan on scroll, zoom on pinch (Ctrl+wheel)
 * - Middle-click drag: Pan for all devices
 * - Shift+wheel: Alternative pan for mouse users
 */

import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef } from "react";
import type * as THREE from "three";

// ---------------------------------------------------------------------------
// Wheel Normalization (preserved from useCanvasWheel.ts)
// ---------------------------------------------------------------------------

const LINE_HEIGHT = 40;
const PAGE_HEIGHT = 800;

/** Threshold for trackpad vs mouse detection. Trackpads emit smaller deltas. */
const TRACKPAD_DELTA_THRESHOLD = 50;

/**
 * Detects if the wheel event likely came from a trackpad vs a mouse wheel.
 *
 * Trackpad characteristics:
 * - Smaller delta values (typically < 50 per event)
 * - Usually DOM_DELTA_PIXEL mode (0)
 * - More frequent events with smaller increments
 *
 * Mouse wheel characteristics:
 * - Larger delta values (often 100+ per notch)
 * - Can be DOM_DELTA_LINE (1) on Firefox
 */
function isTrackpadEvent(e: WheelEvent): boolean {
  // Pinch gestures on macOS trackpads set ctrlKey
  if (e.ctrlKey) return true;

  // Trackpads typically have small deltas in pixel mode
  const absDeltaY = Math.abs(e.deltaY);
  const isSmallDelta = absDeltaY > 0 && absDeltaY < TRACKPAD_DELTA_THRESHOLD;
  const isPixelMode = e.deltaMode === 0; // DOM_DELTA_PIXEL

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

// ---------------------------------------------------------------------------
// Zoom Limits
// ---------------------------------------------------------------------------

export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 5000;

// ---------------------------------------------------------------------------
// Custom Wheel Handler Hook
// ---------------------------------------------------------------------------

/**
 * Attaches a non-passive wheel listener to the R3F canvas that matches
 * the existing Figma-style navigation exactly:
 * - Ctrl/Cmd + wheel → zoom to cursor
 * - Plain wheel → pan (inverted for natural scroll feel)
 */
export function useEdaWheel(): void {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const invalidate = useThree((s) => s.invalidate);

  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();

      const cam = cameraRef.current;

      // Determine if this is a zoom or pan action based on input device and modifiers
      // Ctrl/Cmd+wheel = zoom (pinch gesture on trackpads)
      // Shift+wheel = pan (alternative for mouse users)
      // Trackpad without modifiers = pan (two-finger scroll)
      // Mouse wheel without modifiers = zoom (PC mouse expectation)
      const isZoomAction =
        e.ctrlKey || e.metaKey || (!e.shiftKey && !isTrackpadEvent(e));
      const isPanAction =
        e.shiftKey || (!e.ctrlKey && !e.metaKey && isTrackpadEvent(e));

      if (isZoomAction && !isPanAction) {
        // Zoom to cursor
        const delta = normalizeZoomDelta(e);
        const factor = Math.pow(2, delta);
        const newZoom = Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, cam.zoom * factor),
        );

        const rect = gl.domElement.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const canvasW = rect.width;
        const canvasH = rect.height;

        // NDC coords
        const ndcX = (mouseX / canvasW) * 2 - 1;
        const ndcY = -(mouseY / canvasH) * 2 + 1;

        // World position under cursor before and after zoom
        const worldX = cam.position.x + (ndcX * canvasW) / (2 * cam.zoom);
        const worldY = cam.position.y + (ndcY * canvasH) / (2 * cam.zoom);
        const newWorldX = cam.position.x + (ndcX * canvasW) / (2 * newZoom);
        const newWorldY = cam.position.y + (ndcY * canvasH) / (2 * newZoom);

        cam.position.x += worldX - newWorldX;
        cam.position.y += worldY - newWorldY;
        cam.zoom = newZoom;
      } else {
        // Pan
        const { dx, dy } = normalizePanDelta(e);
        cam.position.x += dx / cam.zoom;
        cam.position.y -= dy / cam.zoom;
      }

      cam.updateProjectionMatrix();
      invalidate();
    },
    [gl, invalidate],
  );

  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, [gl, handleWheel]);
}

// ---------------------------------------------------------------------------
// Fit Camera to Bounds
// ---------------------------------------------------------------------------

export function fitCameraToBounds(
  camera: THREE.OrthographicCamera,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  canvasWidth: number,
  canvasHeight: number,
  paddingPx: number = 80,
): void {
  const contentWidth = Math.max(bounds.maxX - bounds.minX, 2_540_000);
  const contentHeight = Math.max(bounds.maxY - bounds.minY, 2_540_000);
  const usableWidth = Math.max(canvasWidth - paddingPx * 2, 1);
  const usableHeight = Math.max(canvasHeight - paddingPx * 2, 1);

  const zoom = Math.min(
    MAX_ZOOM,
    Math.max(
      MIN_ZOOM,
      Math.min(usableWidth / contentWidth, usableHeight / contentHeight),
    ),
  );

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  camera.position.x = centerX;
  camera.position.y = centerY;
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
}
