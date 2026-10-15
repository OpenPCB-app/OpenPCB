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
  /** Direct overlap successors are diagnostics, not aliases or assignment transfers. An inherited ID never retires. */
  readonly successorIds: readonly string[];
}

/**
 * `retire`: only one-to-one continuity keeps an ID; every split/merge predecessor retires.
 * `inherit-most-pins`: in a split/merge cluster the best-ranked overlapping pairs inherit
 * (one successor per predecessor); unmatched predecessors retire, unmatched successors allocate.
 */
export type ElectricalSuccessorPolicy = "retire" | "inherit-most-pins";

/**
 * Total preorder over predecessor IDs: negative ranks `firstId` ahead. Only consulted between
 * two different predecessors; NaN counts as a tie.
 */
export type ElectricalPredecessorComparator = (
  firstId: string,
  secondId: string,
) => number;

export interface ElectricalIdentityInput {
  readonly previousActive: readonly ActiveElectricalNet[];
  readonly currentComponents: readonly ElectricalComponent[];
  /** The caller must supply the complete durable retirement ledger to prevent recycling. */
  readonly retiredIds?: readonly string[];
  readonly allocateId: ElectricalNetAllocator;
  readonly successorPolicy: ElectricalSuccessorPolicy;
  /**
   * `inherit-most-pins` only: precedence class, ranked before every overlap key, so overlap and
   * size decide only within one class (H08: user-named nets beat auto-named nets). Absent: one class.
   */
  readonly comparePredecessorClass?: ElectricalPredecessorComparator;
  /**
   * `inherit-most-pins` only: ranked after the pin keys and before member overlap
   * (H08: more dependents, then lower numeric seq). Absent: no preference.
   */
  readonly comparePredecessors?: ElectricalPredecessorComparator;
}

export type ElectricalNetTransitionKind = "split" | "merge" | "reconfigure";

export interface ElectricalNetInheritance {
  readonly fromId: string;
  readonly componentKey: string;
}

/** One split/merge/reconfigure overlap cluster; one-to-one continuity is not a transition. */
export interface ElectricalNetTransition {
  readonly kind: ElectricalNetTransitionKind;
  readonly predecessorIds: readonly string[];
  readonly successorIds: readonly string[];
  /** Empty under `retire`. */
  readonly inherited: readonly ElectricalNetInheritance[];
}

export interface ElectricalIdentityResult {
  readonly nextActive: readonly ActiveElectricalNet[];
  readonly componentNetIds: ReadonlyMap<string, string>;
  readonly createdIds: readonly string[];
  readonly preservedIds: readonly string[];
  readonly retirements: readonly ElectricalNetRetirement[];
  readonly transitions: readonly ElectricalNetTransition[];
}
