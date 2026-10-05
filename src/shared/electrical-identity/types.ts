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

export interface ElectricalIdentityInput {
  readonly previousActive: readonly ActiveElectricalNet[];
  readonly currentComponents: readonly ElectricalComponent[];
  /** The caller must supply the complete durable retirement ledger to prevent recycling. */
  readonly retiredIds?: readonly string[];
  readonly allocateId: ElectricalNetAllocator;
}

export interface ElectricalIdentityResult {
  readonly nextActive: readonly ActiveElectricalNet[];
  readonly componentNetIds: ReadonlyMap<string, string>;
  readonly createdIds: readonly string[];
  readonly preservedIds: readonly string[];
  readonly retirements: readonly ElectricalNetRetirement[];
}
