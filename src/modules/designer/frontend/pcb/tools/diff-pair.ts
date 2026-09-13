/**
 * Differential-pair identity for the bundle tool — a thin front end over the
 * ONE resolver (SI contract 14 §5, `shared/drc/diff-pair-resolver.ts`).
 *
 * This file used to carry its own suffix table, which drifted from the DRC's:
 * it still paired a bare trailing `P`/`N` (so `VIP`/`VIN` looked like a pair)
 * and it knew nothing about `board.diffPairs`. Both answers now come from the
 * shared resolver, so the pair the bundle tool auto-collects is the pair the
 * SI checks judge.
 */
import type { PcbDiffPair } from "../../../../../sdks";
import {
  diffPairPartnerName,
  resolveDiffPairs,
} from "../../../../../shared/drc/diff-pair-resolver";

export { diffPairPartnerName };

/** True when the two net names form a pair under the shared suffix table. */
export function isDiffPair(nameA: string, nameB: string): boolean {
  return (
    nameA !== nameB &&
    (diffPairPartnerName(nameA) === nameB ||
      diffPairPartnerName(nameB) === nameA)
  );
}

/** The board's resolved pairs, indexed for the bundle tool's partner pick. */
export interface DiffPairIndex {
  /** Partner net id, or null when this net is in no resolved pair. */
  partnerNetId(netId: string | null): string | null;
  /** Partner net NAME — what `findNearestPadOnNet` looks a pad up by. */
  partnerNetName(netId: string | null, netName: string | null): string | null;
}

/**
 * Explicit `board.diffPairs` rows win, then the shared name convention —
 * `resolveDiffPairs` applies both in that order, respects nets an explicit row
 * has already claimed, and REFUSES an ambiguous base name instead of resolving
 * it by insertion order (§5).
 */
export function buildDiffPairIndex(
  diffPairs: readonly PcbDiffPair[] | undefined,
  netNames: Record<string, string>,
): DiffPairIndex {
  const partnerById = new Map<string, string>();
  for (const pair of resolveDiffPairs(diffPairs, netNames)) {
    partnerById.set(pair.pNetId, pair.nNetId);
    partnerById.set(pair.nNetId, pair.pNetId);
  }
  return {
    partnerNetId: (netId) =>
      netId === null ? null : (partnerById.get(netId) ?? null),
    partnerNetName: (netId, netName) => {
      const partnerId = netId === null ? undefined : partnerById.get(netId);
      if (partnerId !== undefined) return netNames[partnerId] ?? null;
      // The resolver is authoritative for every net the board names — a base
      // it refused as ambiguous must stay refused, not be re-resolved here.
      // Only a net the board has no id/name row for falls back to the bare
      // suffix table (an id-less pad picked off the canvas).
      if (netId !== null && netNames[netId] !== undefined) return null;
      return netName === null ? null : diffPairPartnerName(netName);
    },
  };
}
