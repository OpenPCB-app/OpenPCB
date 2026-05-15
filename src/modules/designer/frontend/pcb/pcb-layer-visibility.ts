import type {
  PcbCopperLayerId,
  PcbLayerId,
  PcbPlacedPart,
  PcbTrace,
} from "../../../../sdks";

const ALL_LAYERS: ReadonlyArray<PcbLayerId> = [
  "F.Cu",
  "In1.Cu",
  "In2.Cu",
  "B.Cu",
  "F.Mask",
  "B.Mask",
  "F.Paste",
  "B.Paste",
  "F.SilkS",
  "B.SilkS",
  "F.CrtYd",
  "B.CrtYd",
  "F.Fab",
  "B.Fab",
  "Edge.Cuts",
  "Drill",
  "Metadata",
];
const ALL_LAYER_SET: ReadonlySet<string> = new Set<string>(ALL_LAYERS);

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

/**
 * Vias are visible whenever any of their participating copper layers is
 * visible. v1 vias span F.Cu ↔ B.Cu (through-vias only); the inner-copper
 * span case is forward-compat for blind/buried vias landing later.
 */
export function areViasVisible(
  visibleLayers: ReadonlySet<PcbLayerId>,
): boolean {
  return (
    visibleLayers.has("F.Cu") ||
    visibleLayers.has("In1.Cu") ||
    visibleLayers.has("In2.Cu") ||
    visibleLayers.has("B.Cu")
  );
}

/**
 * Layer ids that the footprint render layer should suppress. The footprint
 * renderer is the source of truth for pads + courtyards + fab; silk graphics
 * live there too until Phase 4 extracts them into the dedicated
 * `SilkscreenLayer`. Hiding any of these via the layer panel suppresses the
 * corresponding footprint sub-pass.
 */
export function hiddenFootprintLayers(
  visibleLayers: ReadonlySet<PcbLayerId>,
): ReadonlySet<string> {
  const hidden = new Set<string>();
  for (const layer of [
    "F.SilkS",
    "B.SilkS",
    "F.CrtYd",
    "B.CrtYd",
    "F.Fab",
    "B.Fab",
  ] as const) {
    if (!visibleLayers.has(layer)) hidden.add(layer);
  }
  return hidden;
}

/**
 * Migrate a `visibleLayers` array deserialized from older board_settings
 * payloads. Drops unknown ids, deduplicates, and seeds defaults for newly
 * introduced layers (`Drill`, `Metadata`, top mask/paste) so a board saved
 * before Phase 1 still presents a sensible visibility set on load.
 */
export function migrateVisibleLayers(raw: ReadonlyArray<string>): PcbLayerId[] {
  const seen = new Set<PcbLayerId>();
  const out: PcbLayerId[] = [];
  for (const id of raw) {
    if (ALL_LAYER_SET.has(id) && !seen.has(id as PcbLayerId)) {
      seen.add(id as PcbLayerId);
      out.push(id as PcbLayerId);
    }
  }
  // Backfill defaults missing from older payloads. Don't add B.SilkS / B.Mask
  // because they were never default-visible historically either.
  for (const defaulted of ["F.Cu", "Edge.Cuts", "Drill", "Metadata"] as const) {
    if (!seen.has(defaulted)) {
      seen.add(defaulted);
      out.push(defaulted);
    }
  }
  return out;
}
