// Parts whose footprint is missing or has no pads: the ONE collection + the
// human-readable summary shared by projection, snapshot, export preflight and
// the PCB banner / status chip. Pure.

import type { DesignerUnresolvedFootprint } from "../../sdks/designer";
import { unresolvedFootprintReason } from "./pad-geometry";

type PlacementLike = {
  id: string;
  partId: string;
  reference: string;
  footprint: Parameters<typeof unresolvedFootprintReason>[0];
};

export function collectUnresolvedFootprints(
  placements: readonly PlacementLike[],
): DesignerUnresolvedFootprint[] {
  const out: DesignerUnresolvedFootprint[] = [];
  for (const p of placements) {
    const reason = unresolvedFootprintReason(p.footprint);
    if (reason) {
      out.push({
        placementId: p.id,
        partId: p.partId,
        reference: p.reference,
        reason,
      });
    }
  }
  return out;
}

export const UNRESOLVED_SUMMARY_MAX_REFS = 6;

function refList(
  items: readonly DesignerUnresolvedFootprint[],
  max: number,
): string {
  const shown = items.slice(0, max).map((i) => i.reference);
  const extra = items.length - shown.length;
  return extra > 0 ? `${shown.join(", ")} +${extra} more` : shown.join(", ");
}

/**
 * "3 parts have no usable footprint: U1, U2 (no footprint); C4 (footprint has
 * no pads)". Max `max` refdes per reason group, then "+k more".
 */
export function formatUnresolvedFootprintSummary(
  items: readonly DesignerUnresolvedFootprint[],
  max: number = UNRESOLVED_SUMMARY_MAX_REFS,
): string {
  if (items.length === 0) return "";
  const noFp = items.filter((i) => i.reason === "no-footprint");
  const noPads = items.filter((i) => i.reason === "no-pads");
  const groups: string[] = [];
  if (noFp.length > 0) groups.push(`${refList(noFp, max)} (no footprint)`);
  if (noPads.length > 0) {
    groups.push(`${refList(noPads, max)} (footprint has no pads)`);
  }
  const n = items.length;
  return `${n} ${n === 1 ? "part has" : "parts have"} no usable footprint: ${groups.join("; ")}`;
}

/** Refdes list for a one-line warning, capped. */
export function unresolvedRefdesList(
  items: readonly DesignerUnresolvedFootprint[],
  max: number = UNRESOLVED_SUMMARY_MAX_REFS,
): string {
  return refList(items, max);
}

/** The net-pad-correlation warning surfaced by the PCB banner instead. */
export function isUnresolvedFootprintWarning(warning: string): boolean {
  return /^WARN: .+ has no footprint pads — /.test(warning);
}
