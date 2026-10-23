import { directContactEvidence } from "./evidence-direct";
import { addPourEvidence } from "./evidence-pour";
import { compareEvidenceText, evidenceSet, type CopperReferenceEvidence, type LegacyContactEvidence, type LegacyContactEvidenceInput } from "./evidence-types";

export { copperReferenceKey } from "./evidence-types";
export type { CopperIsland, CopperReferenceEvidence, LegacyContactEvidence, LegacyContactEvidenceInput } from "./evidence-types";

/** Geometry supplies evidence only; callers own classification and persistence. */
export function legacyContactEvidence(input: LegacyContactEvidenceInput): LegacyContactEvidence {
  const graph = directContactEvidence(input);
  const pourDisabledReasons = addPourEvidence(input, graph);
  const evidenceByRef = new Map<string, CopperReferenceEvidence>();
  for (const refKey of [...graph.legacyByRef.keys()].sort(compareEvidenceText)) {
    const islands = graph.islands.filter((island) => island.refKeys.includes(refKey));
    const directPadNets = evidenceSet(islands.flatMap((island) => [...island.directPadNets]));
    const padNets = evidenceSet(islands.flatMap((island) => [...island.padNets]));
    const pourNetIds = evidenceSet(islands.flatMap((island) => [...island.pourNetIds]));
    evidenceByRef.set(refKey, { refKey, islands, directPadNets, padNets, pourNetIds, pour: pourNetIds.size > 0 });
  }
  const pooledByLegacyRoot = new Map<string, Set<string>>();
  for (const island of graph.islands) {
    if (island.padNets.size !== 1) continue;
    for (const root of island.legacyIds) pooledByLegacyRoot.set(root,
      evidenceSet([...(pooledByLegacyRoot.get(root) ?? []), ...island.padNets]));
  }
  return { islands: graph.islands, islandOf: graph.islandOf, evidenceByRef, pooledByLegacyRoot, pourDisabledReasons };
}
