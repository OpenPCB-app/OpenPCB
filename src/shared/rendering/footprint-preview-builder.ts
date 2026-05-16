import { boundsFromPadsAndGraphics } from "./footprint-bounds";
import { isFiniteBoundsMm, normalizeBounds } from "./geometry";
import type {
  BuildFootprintRenderModelOptions,
  FootprintRenderModel,
  FootprintRenderSource,
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

export function buildFootprintRenderModel(
  source: FootprintRenderSource,
  options: BuildFootprintRenderModelOptions = {},
): FootprintRenderModel {
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

  // Bounds from pads + graphics only. Labels are excluded so that PCB
  // selection/hit regions are not inflated by KiCad value/reference text
  // anchored far outside the body. Library preview tile recomputes a
  // label-inclusive bbox at runtime via `footprintVisualBounds`.
  const bounds = boundsFromPadsAndGraphics({ pads, graphics });

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
