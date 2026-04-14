import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import type * as THREE from "three";
import type { SceneBoundsMm } from "./types";
import { normalizeSceneBounds } from "./bounds";

const MIN_ZOOM = 0.01;
const MAX_ZOOM = 5000;

export function usePreviewFit(
  bounds: SceneBoundsMm | null,
  paddingPx = 24,
  minSpanMm = 2,
  fallbackZoom = 40,
): void {
  const camera = useThree((state) => state.camera) as THREE.OrthographicCamera;
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);

  const minX = bounds?.minX ?? null;
  const minY = bounds?.minY ?? null;
  const maxX = bounds?.maxX ?? null;
  const maxY = bounds?.maxY ?? null;

  useEffect(() => {
    if (minX === null || minY === null || maxX === null || maxY === null) {
      camera.position.x = 0;
      camera.position.y = 0;
      camera.zoom = fallbackZoom;
      camera.updateProjectionMatrix();
      invalidate();
      return;
    }

    const normalized = normalizeSceneBounds(
      { minX, minY, maxX, maxY },
      minSpanMm,
    );
    const contentWidth = normalized.maxX - normalized.minX;
    const contentHeight = normalized.maxY - normalized.minY;
    const usableWidth = Math.max(size.width - paddingPx * 2, 1);
    const usableHeight = Math.max(size.height - paddingPx * 2, 1);
    const zoom = Math.min(
      MAX_ZOOM,
      Math.max(
        MIN_ZOOM,
        Math.min(usableWidth / contentWidth, usableHeight / contentHeight),
      ),
    );

    camera.position.x = (normalized.minX + normalized.maxX) / 2;
    camera.position.y = (normalized.minY + normalized.maxY) / 2;
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    invalidate();
  }, [
    minX,
    minY,
    maxX,
    maxY,
    camera,
    fallbackZoom,
    invalidate,
    minSpanMm,
    paddingPx,
    size.height,
    size.width,
  ]);
}
