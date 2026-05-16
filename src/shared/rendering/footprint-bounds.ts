import {
  boundsFromGraphics,
  emptyBoundsMm,
  includeLabel,
  includePoint,
  isFiniteBoundsMm,
  normalizeBounds,
} from "./geometry";
import type { BoundsMm, FootprintRenderModel } from "./types";

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

/**
 * Bounds from pads + graphics only. Excludes labels (KiCad value/reference
 * text is often anchored far outside the body and would inflate selection/hit
 * regions on the PCB). Used as the source of truth for `model.bounds`.
 */
export function boundsFromPadsAndGraphics(
  model: Pick<FootprintRenderModel, "pads" | "graphics">,
): BoundsMm {
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

export function footprintGeometryBounds(
  model: FootprintRenderModel,
): BoundsMm | null {
  const bounds = boundsFromPadsAndGraphics(model);
  if (!isFiniteBoundsMm(bounds)) {
    return null;
  }
  return normalizeBounds(bounds, 2.0);
}

export function footprintVisualBounds(
  model: FootprintRenderModel,
): BoundsMm | null {
  let bounds = boundsFromPadsAndGraphics(model);
  for (const label of model.labels) {
    bounds = includeLabel(bounds, label);
  }
  if (!isFiniteBoundsMm(bounds)) {
    return null;
  }
  return normalizeBounds(bounds, 2.0);
}
