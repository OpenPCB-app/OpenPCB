import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef } from "react";
import type * as THREE from "three";

const LINE_HEIGHT = 40;
const PAGE_HEIGHT = 800;
const TRACKPAD_DELTA_THRESHOLD = 50;

export function isTrackpadWheelEvent(e: WheelEvent): boolean {
  if (e.ctrlKey) return true;
  const absDeltaY = Math.abs(e.deltaY);
  const isSmallDelta = absDeltaY > 0 && absDeltaY < TRACKPAD_DELTA_THRESHOLD;
  const isPixelMode = e.deltaMode === 0;
  return isSmallDelta && isPixelMode;
}

export type WheelNavigationAction = "zoom" | "pan";

export function getWheelNavigationAction(e: WheelEvent): WheelNavigationAction {
  const isZoomAction = e.ctrlKey || e.metaKey || (!e.shiftKey && !isTrackpadWheelEvent(e));
  const isPanAction = e.shiftKey || (!e.ctrlKey && !e.metaKey && isTrackpadWheelEvent(e));
  return isZoomAction && !isPanAction ? "zoom" : "pan";
}

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

export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 5000;

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

      if (getWheelNavigationAction(e) === "zoom") {
        const delta = normalizeZoomDelta(e);
        const factor = Math.pow(2, delta);
        const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor));

        const rect = gl.domElement.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const canvasW = rect.width;
        const canvasH = rect.height;
        const ndcX = (mouseX / canvasW) * 2 - 1;
        const ndcY = -(mouseY / canvasH) * 2 + 1;

        const worldX = cam.position.x + (ndcX * canvasW) / (2 * cam.zoom);
        const worldY = cam.position.y + (ndcY * canvasH) / (2 * cam.zoom);
        const newWorldX = cam.position.x + (ndcX * canvasW) / (2 * newZoom);
        const newWorldY = cam.position.y + (ndcY * canvasH) / (2 * newZoom);

        cam.position.x += worldX - newWorldX;
        cam.position.y += worldY - newWorldY;
        cam.zoom = newZoom;
      } else {
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
    Math.max(MIN_ZOOM, Math.min(usableWidth / contentWidth, usableHeight / contentHeight)),
  );

  camera.position.x = (bounds.minX + bounds.maxX) / 2;
  camera.position.y = (bounds.minY + bounds.maxY) / 2;
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
}
