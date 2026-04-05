/**
 * Render Engine — EDA Camera Configuration
 *
 * Custom wheel/trackpad handler that preserves the existing useCanvasWheel
 * normalization (browser-specific delta handling, pinch-to-zoom, Figma-style pan)
 * and pipes results into Three.js OrthographicCamera via CameraControls.
 */

import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef } from "react";
import type * as THREE from "three";

// ---------------------------------------------------------------------------
// Wheel Normalization (preserved from useCanvasWheel.ts)
// ---------------------------------------------------------------------------

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

      if (e.ctrlKey || e.metaKey) {
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
