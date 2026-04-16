import type { BoundsMm, FootprintRenderModel } from "../../../rendering";
import {
  boundsFromGraphics,
  emptyBoundsMm,
  includeLabel,
  includePoint,
  isFiniteBoundsMm,
  normalizeBounds,
} from "../../../rendering";

function rotatedPadHalfExtents(
  widthMm: number,
  heightMm: number,
  rotationDeg: number,
): { halfX: number; halfY: number } {
  const halfWidth = Math.abs(widthMm) / 2;
  const halfHeight = Math.abs(heightMm) / 2;
  const radians = (rotationDeg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return {
    halfX: cos * halfWidth + sin * halfHeight,
    halfY: sin * halfWidth + cos * halfHeight,
  };
}

function baseGeometryBounds(model: FootprintRenderModel): BoundsMm {
  let bounds = boundsFromGraphics(model.graphics) ?? emptyBoundsMm();

  for (const pad of model.pads) {
    const { halfX, halfY } = rotatedPadHalfExtents(
      pad.widthMm,
      pad.heightMm,
      pad.rotationDeg,
    );
    bounds = includePoint(bounds, {
      x: pad.centerMm.x - halfX,
      y: pad.centerMm.y - halfY,
    });
    bounds = includePoint(bounds, {
      x: pad.centerMm.x + halfX,
      y: pad.centerMm.y + halfY,
    });
  }

  return bounds;
}

export function footprintGeometryBounds(model: FootprintRenderModel): BoundsMm | null {
  const bounds = baseGeometryBounds(model);
  if (!isFiniteBoundsMm(bounds)) {
    return null;
  }
  return normalizeBounds(bounds, 2.0);
}

export function footprintVisualBounds(model: FootprintRenderModel): BoundsMm | null {
  let bounds = baseGeometryBounds(model);
  for (const label of model.labels) {
    bounds = includeLabel(bounds, label);
  }
  if (!isFiniteBoundsMm(bounds)) {
    return null;
  }
  return normalizeBounds(bounds, 2.0);
}
