import type { BoundsMm } from "../../../rendering";
import type { SceneBoundsMm } from "./types";

export function toSceneBounds(bounds: BoundsMm | null): SceneBoundsMm | null {
  if (!bounds) {
    return null;
  }
  if (
    !Number.isFinite(bounds.minX) ||
    !Number.isFinite(bounds.minY) ||
    !Number.isFinite(bounds.maxX) ||
    !Number.isFinite(bounds.maxY)
  ) {
    return null;
  }
  if (bounds.maxX < bounds.minX || bounds.maxY < bounds.minY) {
    return null;
  }
  return {
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
  };
}

export function normalizeSceneBounds(
  bounds: SceneBoundsMm,
  minSpanMm: number,
): SceneBoundsMm {
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const width = Math.max(spanX, minSpanMm);
  const height = Math.max(spanY, minSpanMm);
  return {
    minX: cx - width / 2,
    minY: cy - height / 2,
    maxX: cx + width / 2,
    maxY: cy + height / 2,
  };
}
