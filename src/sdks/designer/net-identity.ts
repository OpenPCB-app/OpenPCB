/** A persisted electrical reference, independent of coordinates and display names. */
export type DesignerNetReferenceSite =
  | { kind: "trace"; traceId: string }
  | { kind: "via"; viaId: string }
  | { kind: "freePad"; freePadId: string }
  | { kind: "zone"; zoneId: string }
  | { kind: "netClassAssignment" }
  | { kind: "lengthGroup"; groupId: string }
  | { kind: "diffPair"; pairId: string; member: "p" | "n" }
  | { kind: "drcRule"; ruleId: string; scopeIndex: number };

export interface DesignerNetDependents {
  traces: number;
  vias: number;
  zones: number;
  freePads: number;
  netClassAssignment: boolean;
  lengthGroupIds: string[];
  diffPairIds: string[];
  drcRuleIds: string[];
}

export type DesignerNetIdentityEvent =
  | {
      kind: "split";
      netId: string;
      netName: string;
      keptPinCount: number;
      hasDependents: boolean;
      newNets: Array<{ netId: string; netName: string; pinCount: number }>;
      dependents: DesignerNetDependents;
    }
  | {
      kind: "merge";
      survivorNetId: string;
      survivorName: string;
      hasDependents: boolean;
      retired: Array<{
        netId: string;
        netName: string;
        pinCount: number;
        dependents: DesignerNetDependents;
      }>;
    }
  | {
      kind: "reconfigure";
      hasDependents: boolean;
      predecessors: Array<{
        netId: string;
        netName: string;
        retired: boolean;
        dependents: DesignerNetDependents;
      }>;
      successors: Array<{ netId: string; netName: string }>;
    }
  | {
      kind: "removed";
      netId: string;
      netName: string;
      hasDependents: true;
      dependents: DesignerNetDependents;
    };

export interface DesignerNetIdentityOutcome {
  events: DesignerNetIdentityEvent[];
}

export interface DesignerNetReferenceGroup {
  netId: string | null;
  netName: string | null;
  reason: "retired" | "legacy-quarantine" | "unknown" | "unresolved-name";
  successorNetIds: string[];
  suggestedNetId: string | null;
  candidateNetIds: string[];
  copper: { traceIds: string[]; viaIds: string[]; zoneIds: string[]; freePadIds: string[] };
  /** Inert declarations are listed but never block export. */
  disabledZoneIds: string[];
  rules: DesignerNetReferenceSite[];
}

export interface DesignerNetIdentitySummary {
  status: "active" | "migration_failed" | "legacy_restored" | "unmigrated";
  mode: "durable" | "legacy";
  origin: "native" | "legacy-migration" | "kicad-import" | null;
  lastError: string | null;
  historiesArchived: number | null;
  groups: DesignerNetReferenceGroup[];
  /** Unique enabled physical declarations with inactive or unresolved references. */
  orphanedCopperCount: number;
  /** Unique inactive rule sites, including distinct pair members and scopes. */
  inertRuleReferenceCount: number;
  /** Legacy mode or either blocking reference count is nonzero. */
  exportBlocked: boolean;
}

/** Revision of the same snapshot used to enumerate unresolved references. */
export interface DesignerNetIdentityStatus extends DesignerNetIdentitySummary {
  revision: number;
}
