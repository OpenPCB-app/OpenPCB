export type ElectricalMemberKind = "pin" | "wire" | "label" | "primitive";

/** IDs must identify persistent entities, never their coordinates or display metadata. */
export interface ElectricalMember {
  readonly kind: ElectricalMemberKind;
  readonly id: string;
}

export interface ActiveElectricalNet {
  readonly id: string;
  readonly members: readonly ElectricalMember[];
}

export interface ElectricalComponent {
  readonly key: string;
  readonly members: readonly ElectricalMember[];
}

export interface ElectricalNetAllocation {
  readonly componentKey: string;
  readonly members: readonly ElectricalMember[];
}

export type ElectricalNetAllocator = (
  allocation: ElectricalNetAllocation,
) => string;
export type ElectricalNetRetirementReason =
  "removed" | "split" | "merged" | "reconfigured";

export interface ElectricalNetRetirement {
  readonly id: string;
  readonly reason: ElectricalNetRetirementReason;
  /** Direct overlap successors are diagnostics, not aliases or assignment transfers. */
  readonly successorIds: readonly string[];
}

export type ElectricalSuccessorPolicy = "retire" | "inherit-most-pins";

export interface ElectricalNetTransition {
  readonly kind: "split" | "merge" | "reconfigure";
  readonly predecessorIds: readonly string[];
  readonly successorIds: readonly string[];
  readonly inherited: readonly {
    readonly fromId: string;
    readonly componentKey: string;
  }[];
}

export interface ElectricalIdentityInput {
  readonly previousActive: readonly ActiveElectricalNet[];
  readonly currentComponents: readonly ElectricalComponent[];
  /** Supply the retirement ledger unless a durable monotonic allocator guarantees no reuse. */
  readonly retiredIds?: readonly string[];
  readonly allocateId: ElectricalNetAllocator;
  readonly successorPolicy: ElectricalSuccessorPolicy;
  /** Higher finite rank wins between different predecessors; evaluated once per id. */
  readonly predecessorPriority?: (id: string) => number;
  /** Deterministic total preorder, consulted after overlap and pin-count ties. */
  readonly comparePredecessors?: (firstId: string, secondId: string) => number;
}

export interface ElectricalIdentityResult {
  readonly nextActive: readonly ActiveElectricalNet[];
  readonly componentNetIds: ReadonlyMap<string, string>;
  readonly createdIds: readonly string[];
  readonly preservedIds: readonly string[];
  readonly retirements: readonly ElectricalNetRetirement[];
  readonly transitions: readonly ElectricalNetTransition[];
}
