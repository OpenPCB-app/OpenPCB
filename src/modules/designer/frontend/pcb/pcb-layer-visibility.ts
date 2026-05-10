import type {
  PcbCopperLayerId,
  PcbLayerId,
  PcbPlacedPart,
  PcbTrace,
} from "../../../../sdks";

export function visibleLayerSet(
  visibleLayers: ReadonlyArray<PcbLayerId>,
): ReadonlySet<PcbLayerId> {
  return new Set(visibleLayers);
}

export function isPcbLayerVisible(
  visibleLayers: ReadonlySet<PcbLayerId>,
  layer: PcbLayerId,
): boolean {
  return visibleLayers.has(layer);
}

export function isCopperLayerVisible(
  visibleLayers: ReadonlySet<PcbLayerId>,
  layer: PcbCopperLayerId,
): boolean {
  return visibleLayers.has(layer);
}

export function isPlacementVisible(
  visibleLayers: ReadonlySet<PcbLayerId>,
  placement: PcbPlacedPart,
): boolean {
  return visibleLayers.has(placement.layer);
}

export function isTraceVisible(
  visibleLayers: ReadonlySet<PcbLayerId>,
  trace: PcbTrace,
): boolean {
  return visibleLayers.has(trace.layer);
}

export function areViasVisible(
  visibleLayers: ReadonlySet<PcbLayerId>,
): boolean {
  return visibleLayers.has("F.Cu") || visibleLayers.has("B.Cu");
}

export function hiddenFootprintLayers(
  visibleLayers: ReadonlySet<PcbLayerId>,
): ReadonlySet<string> {
  const hidden = new Set<string>();
  for (const layer of ["F.SilkS", "B.SilkS"] as const) {
    if (!visibleLayers.has(layer)) hidden.add(layer);
  }
  return hidden;
}
