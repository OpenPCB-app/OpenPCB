import type { PcbBoardSettings, PcbFreeHole, PcbFreePad, PcbKeepout, PcbPlacedPart, PcbTrace, PcbVia, PcbZone } from "../../../../sdks/designer";
import type { CopperItem, CopperRecords } from "../../../../shared/pcb-connectivity";

export type CopperReferenceKind = "trace" | "via" | "freePad";

export function copperReferenceKey(kind: CopperReferenceKind, id: string): string {
  return JSON.stringify([kind, id]);
}

export interface LegacyContactEvidenceInput {
  board: PcbBoardSettings;
  placements: readonly PcbPlacedPart[];
  padNetIds: ReadonlyMap<string, string>;
  traces: readonly PcbTrace[];
  vias: readonly PcbVia[];
  freePads: readonly PcbFreePad[];
  freeHoles: readonly PcbFreeHole[];
  zones: readonly PcbZone[];
  keepouts: readonly PcbKeepout[];
  legacyRootIds: ReadonlyMap<string, string>;
  netNames: ReadonlyMap<string, string>;
  nameBoundZones: readonly { zone: PcbZone; netId: string }[];
  allowPourEvidence: boolean;
}

export interface CopperIsland {
  itemKeys: string[];
  refKeys: string[];
  legacyIds: Set<string>;
  directPadNets: Set<string>;
  padNets: Set<string>;
  pourNetIds: Set<string>;
  pour: boolean;
}

export interface CopperReferenceEvidence {
  refKey: string;
  islands: CopperIsland[];
  directPadNets: Set<string>;
  padNets: Set<string>;
  pourNetIds: Set<string>;
  pour: boolean;
}

export interface LegacyContactEvidence {
  islands: CopperIsland[];
  /** Physical item key, including separate faces of an unplated pad. */
  islandOf: Map<string, CopperIsland>;
  evidenceByRef: Map<string, CopperReferenceEvidence>;
  /** Only singleton, non-conflicting island evidence contributes. */
  pooledByLegacyRoot: Map<string, Set<string>>;
  pourDisabledReasons: string[];
}

export interface DirectEvidenceGraph {
  records: CopperRecords;
  items: CopperItem[];
  sourceByItem: Map<string, string>;
  refByItem: Map<string, string>;
  legacyByRef: Map<string, string | null>;
  islands: CopperIsland[];
  islandOf: Map<string, CopperIsland>;
}

export const compareEvidenceText = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
export const evidenceSet = (values: Iterable<string>): Set<string> => new Set([...values].sort(compareEvidenceText));
export const EVIDENCE_GRAPH_NET = "physical-contact-proof";
