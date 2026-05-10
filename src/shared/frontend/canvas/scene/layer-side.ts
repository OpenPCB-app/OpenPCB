/**
 * Pure layer-side helpers used by 2D and 3D PCB rendering when a placement is
 * on the bottom (B.Cu) side. KiCad/Altium remap every paired layer F.* ↔ B.*
 * atomically on flip; through-hole pads (`*.Cu`) and edge cuts are
 * layer-agnostic and pass through unchanged.
 */

/** Swap F.* ↔ B.* prefixes; pass other layers through untouched. */
export function flipLayerSide(layer: string | undefined): string | undefined {
  if (!layer) return layer;
  if (layer.startsWith("F.")) return "B." + layer.slice(2);
  if (layer.startsWith("B.")) return "F." + layer.slice(2);
  return layer;
}

/**
 * Build the set of layers that a placement contributes to after side remap.
 * Used by 2D rendering to dim every footprint layer (copper / silk / mask /
 * paste / courtyard / fab) when the placement is on the off-active side.
 */
export function placementContributingLayers(
  placementLayer: string,
): ReadonlySet<string> {
  if (placementLayer === "B.Cu") {
    return new Set([
      "B.Cu",
      "B.SilkS",
      "B.Mask",
      "B.Paste",
      "B.CrtYd",
      "B.Fab",
      "*.Cu",
      "Edge.Cuts",
    ]);
  }
  return new Set([
    "F.Cu",
    "F.SilkS",
    "F.Mask",
    "F.Paste",
    "F.CrtYd",
    "F.Fab",
    "*.Cu",
    "Edge.Cuts",
  ]);
}
