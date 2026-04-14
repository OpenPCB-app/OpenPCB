import {
  boundsFromGraphics,
  emptyBoundsMm,
  includeLabel,
  includePoint,
  isFiniteBoundsMm,
  normalizeBounds,
} from "./geometry";
import type {
  BuildFootprintPreviewModelOptions,
  FootprintPreviewModel,
  FootprintPreviewSource,
} from "./types";

function filterByLayer(
  includeLayerNames: readonly string[] | undefined,
  layer: string | undefined,
): boolean {
  if (!includeLayerNames || includeLayerNames.length === 0) {
    return true;
  }
  if (!layer) {
    return false;
  }
  return includeLayerNames.includes(layer);
}

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

export function buildFootprintPreviewModel(
  source: FootprintPreviewSource,
  options: BuildFootprintPreviewModelOptions = {},
): FootprintPreviewModel {
  const graphics = source.graphics.filter((graphic) =>
    filterByLayer(options.includeLayerNames, graphic.layer),
  );

  const labels = source.labels.filter((label) =>
    filterByLayer(options.includeLayerNames, label.layer),
  );

  const pads = options.includePadLayerNames
    ? source.pads.filter((pad) =>
        filterByLayer(options.includePadLayerNames, pad.layer),
      )
    : source.pads;

  let bounds = boundsFromGraphics(graphics) ?? emptyBoundsMm();

  for (const pad of pads) {
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

  for (const label of labels) {
    bounds = includeLabel(bounds, label);
  }

  const resolvedBounds = isFiniteBoundsMm(bounds)
    ? normalizeBounds(bounds, 2.0)
    : null;

  return {
    kind: "footprint",
    units: "mm",
    name: source.name,
    pads,
    graphics,
    labels,
    bounds: resolvedBounds,
    warnings: source.warnings,
  };
}
