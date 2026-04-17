import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef } from "react";
import type * as THREE from "three";

const LINE_HEIGHT = 40;
const PAGE_HEIGHT = 800;
const TRACKPAD_PIXEL_DELTA_THRESHOLD = 10;

export interface EdaWheelOptions {
  readonly enabled?: boolean;
  readonly pinchZoom?: boolean;
  readonly trackpadScroll?: "ignore" | "pan" | "zoom";
  readonly zoomAnchor?: "cursor" | "center";
}

export const DEFAULT_EDA_WHEEL_OPTIONS: Required<EdaWheelOptions> = {
  enabled: true,
  pinchZoom: true,
  trackpadScroll: "pan",
  zoomAnchor: "cursor",
};

export function isLikelyTrackpadWheelEvent(e: WheelEvent): boolean {
  if (e.ctrlKey || e.metaKey) {
    return false;
  }

  if (e.deltaMode !== 0) {
    return false;
  }

  const absX = Math.abs(e.deltaX);
  const absY = Math.abs(e.deltaY);
  const maxDelta = Math.max(absX, absY);
  const hasFractional = absX % 1 !== 0 || absY % 1 !== 0;

  const hasHorizontalComponent = absX > 0.5;
  return (
    hasFractional ||
    hasHorizontalComponent ||
    (maxDelta > 0 && maxDelta < TRACKPAD_PIXEL_DELTA_THRESHOLD)
  );
}

export function normalizeZoomDelta(e: WheelEvent): number {
  const modeScale = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 1 : 0.002;
  const pinchScale = e.ctrlKey || e.metaKey ? 10 : 1;
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

function zoomToCursor(
  camera: THREE.OrthographicCamera,
  canvas: HTMLCanvasElement,
  event: WheelEvent,
  zoom: number,
): void {
  const rect = canvas.getBoundingClientRect();
  const mouseX = event.clientX - rect.left;
  const mouseY = event.clientY - rect.top;
  const canvasW = rect.width;
  const canvasH = rect.height;
  const ndcX = (mouseX / canvasW) * 2 - 1;
  const ndcY = -(mouseY / canvasH) * 2 + 1;

  const worldX = camera.position.x + (ndcX * canvasW) / (2 * camera.zoom);
  const worldY = camera.position.y + (ndcY * canvasH) / (2 * camera.zoom);
  const newWorldX = camera.position.x + (ndcX * canvasW) / (2 * zoom);
  const newWorldY = camera.position.y + (ndcY * canvasH) / (2 * zoom);

  camera.position.x += worldX - newWorldX;
  camera.position.y += worldY - newWorldY;
  camera.zoom = zoom;
}

function zoomToCenter(camera: THREE.OrthographicCamera, zoom: number): void {
  camera.zoom = zoom;
}

export function useEdaWheel(options: EdaWheelOptions = {}): void {
  const gl = useThree((s) => s.gl);
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const invalidate = useThree((s) => s.invalidate);

  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const optionsRef = useRef<Required<EdaWheelOptions>>({
    ...DEFAULT_EDA_WHEEL_OPTIONS,
    ...options,
  });
  optionsRef.current = {
    ...DEFAULT_EDA_WHEEL_OPTIONS,
    ...options,
  };

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const activeOptions = optionsRef.current;
      if (!activeOptions.enabled) {
        return;
      }

      const isPinch = e.ctrlKey || e.metaKey;
      if (isPinch && !activeOptions.pinchZoom) {
        return;
      }

      if (!isPinch && isLikelyTrackpadWheelEvent(e)) {
        if (activeOptions.trackpadScroll === "ignore") return;
        if (activeOptions.trackpadScroll === "pan") {
          const cam = cameraRef.current;
          const { dx, dy } = normalizePanDelta(e);
          cam.position.x += dx / cam.zoom;
          cam.position.y -= dy / cam.zoom;
          cam.updateProjectionMatrix();
          invalidate();
          return;
        }
        // "zoom" falls through to zoom logic below
      }

      const cam = cameraRef.current;
      const delta = normalizeZoomDelta(e);
      if (delta === 0) {
        return;
      }
      const factor = Math.pow(2, delta);
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor));
      if (newZoom === cam.zoom) {
        return;
      }

      if (activeOptions.zoomAnchor === "center") {
        zoomToCenter(cam, newZoom);
      } else {
        zoomToCursor(cam, gl.domElement, e, newZoom);
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
    Math.max(
      MIN_ZOOM,
      Math.min(usableWidth / contentWidth, usableHeight / contentHeight),
    ),
  );

  camera.position.x = (bounds.minX + bounds.maxX) / 2;
  camera.position.y = (bounds.minY + bounds.maxY) / 2;
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
}
