import type { PcbLengthMatchGroup } from "../../../sdks/designer";

/**
 * The ONE length-match target resolution (SI contract 14 §3 / §6). Both the
 * batch `NET_LENGTH_OUT_OF_RANGE` check and the route / tune HUD gauge call
 * this — the gauge passes `exclude` to get "the longest OTHER member" without
 * a second, drifting copy of the `longest` semantics (critique #9).
 *
 * `lengthByNet` holds only members with a DEFINED path: an undefined member is
 * absent from the map and can neither set nor be judged against the target.
 */
export function resolveLengthTarget(
  group: PcbLengthMatchGroup,
  lengthByNet: ReadonlyMap<string, number>,
  opts?: { exclude?: string },
): { targetMm: number } | null {
  if (group.target.kind === "absolute") return { targetMm: group.target.mm };

  const exclude = opts?.exclude;
  const seen = new Set<string>();
  let defined = 0;
  let targetMm: number | null = null;
  for (const netId of group.netIds) {
    if (seen.has(netId)) continue;
    seen.add(netId);
    const lengthMm = lengthByNet.get(netId);
    if (lengthMm === undefined) continue;
    defined += 1;
    if (netId === exclude) continue;
    if (targetMm === null || lengthMm > targetMm) targetMm = lengthMm;
  }
  // `longest` is self-inclusive (contract §3), so one defined member would be
  // measured against its own length — a target that can never be missed. With
  // an `exclude` the caller has already asked for a comparison, so the single
  // remaining member is enough.
  if (exclude === undefined && defined < 2) return null;
  return targetMm === null ? null : { targetMm };
}
