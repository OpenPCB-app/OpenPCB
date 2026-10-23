export interface NetRebindReceipt {
  traces: number;
  vias: number;
  zones: number;
  freePads: number;
  assignments: number;
  lengthGroups: number;
  diffPairs: number;
  drcRules: number;
  removedRules: string[];
  removedDiffPairs: string[];
  removedLengthGroups: string[];
  disabledZones: string[];
}
