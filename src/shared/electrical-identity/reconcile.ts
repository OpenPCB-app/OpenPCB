import type {
  ActiveElectricalNet,
  ElectricalIdentityInput,
  ElectricalIdentityResult,
  ElectricalMember,
  ElectricalNetAllocator,
  ElectricalNetRetirement,
  ElectricalNetRetirementReason,
  ElectricalNetTransition,
  ElectricalNetTransitionKind,
  ElectricalPredecessorComparator,
} from "./types";

interface CanonicalRecord {
  readonly key: string;
  readonly members: readonly ElectricalMember[];
  readonly tokens: readonly string[];
  readonly pins: number;
}

interface PairOverlap {
  members: number;
  pins: number;
}

interface OverlapGraph {
  readonly previous: readonly Set<number>[];
  readonly current: readonly Set<number>[];
  /** Per current index: shared member and pin counts, keyed by previous index. */
  readonly shared: readonly Map<number, PairOverlap>[];
}

/** Canonical indices, ascending. Every predecessor overlaps at least one successor. */
interface OverlapCluster {
  readonly kind: ElectricalNetTransitionKind | "continuity";
  readonly predecessors: readonly number[];
  readonly successors: readonly number[];
}

interface SuccessorCandidate extends PairOverlap {
  readonly previous: number;
  readonly current: number;
}

interface AssignedComponents {
  readonly componentNetIds: Map<string, string>;
  readonly createdIds: string[];
  readonly preservedIds: string[];
  readonly nextActive: ActiveElectricalNet[];
}

function compareText(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function requireId(value: unknown, context: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${context} must be a nonempty string`);
  }
}

function canonicalMembers(
  members: readonly ElectricalMember[],
  context: string,
): CanonicalRecord["members"] {
  if (!Array.isArray(members) || members.length === 0)
    throw new Error(`${context} must have nonempty members`);
  const byToken = new Map<string, ElectricalMember>();
  for (const member of members) {
    if (
      !member ||
      !["pin", "wire", "label", "primitive"].includes(member.kind)
    ) {
      throw new Error(`${context} has an invalid member kind`);
    }
    requireId(member.id, `${context} member ID`);
    const token = JSON.stringify([member.kind, member.id]);
    if (byToken.has(token))
      throw new Error(`${context} has a duplicate member ${token}`);
    byToken.set(token, Object.freeze({ kind: member.kind, id: member.id }));
  }
  return Object.freeze(
    [...byToken.entries()]
      .sort(([first], [second]) => compareText(first, second))
      .map(([, member]) => member),
  );
}

function canonicalRecords(
  records:
    | ElectricalIdentityInput["previousActive"]
    | ElectricalIdentityInput["currentComponents"],
  field: "id" | "key",
): CanonicalRecord[] {
  if (!Array.isArray(records))
    throw new Error(`${field} records must be an array`);
  const keys = new Set<string>(),
    owners = new Set<string>();
  const result: CanonicalRecord[] = [];
  for (const record of records) {
    if (!record || typeof record !== "object")
      throw new Error(`Invalid ${field} record`);
    const key: unknown =
      field === "id"
        ? "id" in record
          ? record.id
          : undefined
        : "key" in record
          ? record.key
          : undefined;
    requireId(key, `${field} record key`);
    if (keys.has(key))
      throw new Error(`Duplicate ${field} record key ${JSON.stringify(key)}`);
    keys.add(key);
    const members = canonicalMembers(
      record.members,
      `${field} ${JSON.stringify(key)}`,
    );
    const tokens = members.map((member) =>
      JSON.stringify([member.kind, member.id]),
    );
    for (const token of tokens) {
      if (owners.has(token))
        throw new Error(
          `Member belongs to multiple ${field} records: ${token}`,
        );
      owners.add(token);
    }
    const pins = members.filter((member) => member.kind === "pin").length;
    result.push({ key, members, tokens, pins });
  }
  return result.sort((first, second) => compareText(first.key, second.key));
}

function compareMembership(
  first: CanonicalRecord,
  second: CanonicalRecord,
): number {
  for (
    let index = 0;
    index < Math.min(first.tokens.length, second.tokens.length);
    index++
  ) {
    const comparison = compareText(first.tokens[index]!, second.tokens[index]!);
    if (comparison) return comparison;
  }
  return (
    first.tokens.length - second.tokens.length ||
    compareText(first.key, second.key)
  );
}

function reservedIds(
  input: ElectricalIdentityInput,
  previous: readonly CanonicalRecord[],
): Set<string> {
  const used = new Set(previous.map((record) => record.key));
  const retired = input.retiredIds === undefined ? [] : input.retiredIds;
  if (!Array.isArray(retired)) throw new Error("Retired IDs must be an array");
  const seen = new Set<string>();
  for (const id of retired) {
    requireId(id, "Retired ID");
    if (seen.has(id))
      throw new Error(`Duplicate retired ID ${JSON.stringify(id)}`);
    if (used.has(id))
      throw new Error(`Active ID is already retired: ${JSON.stringify(id)}`);
    seen.add(id);
    used.add(id);
  }
  if (typeof input.allocateId !== "function")
    throw new Error("allocateId must be a function");
  return used;
}

function overlapGraph(
  previous: readonly CanonicalRecord[],
  current: readonly CanonicalRecord[],
): OverlapGraph {
  const graph: OverlapGraph = {
    previous: previous.map(() => new Set()),
    current: current.map(() => new Set()),
    shared: current.map(() => new Map()),
  };
  const owner = new Map<string, number>();
  previous.forEach((record, index) =>
    record.tokens.forEach((token) => owner.set(token, index)),
  );
  current.forEach((record, currentIndex) => {
    record.tokens.forEach((token, memberIndex) => {
      const previousIndex = owner.get(token);
      if (previousIndex === undefined) return;
      graph.current[currentIndex]!.add(previousIndex);
      graph.previous[previousIndex]!.add(currentIndex);
      const shared = graph.shared[currentIndex]!;
      const counts = shared.get(previousIndex) ?? { members: 0, pins: 0 };
      counts.members++;
      if (record.members[memberIndex]!.kind === "pin") counts.pins++;
      shared.set(previousIndex, counts);
    });
  });
  return graph;
}

function clusterKind(
  predecessors: number,
  successors: number,
): OverlapCluster["kind"] {
  if (predecessors > 1) return successors > 1 ? "reconfigure" : "merge";
  return successors > 1 ? "split" : "continuity";
}

/** Connected components of the overlap graph that contain a predecessor, by lowest predecessor. */
function overlapClusters(graph: OverlapGraph): OverlapCluster[] {
  const clusters: OverlapCluster[] = [],
    visited = new Set<number>();
  const ascending = (first: number, second: number): number => first - second;
  for (let start = 0; start < graph.previous.length; start++) {
    if (visited.has(start) || graph.previous[start]!.size === 0) continue;
    const predecessors = [start],
      successors = new Set<number>();
    visited.add(start);
    for (let index = 0; index < predecessors.length; index++) {
      for (const successor of graph.previous[predecessors[index]!]!) {
        if (successors.has(successor)) continue;
        successors.add(successor);
        for (const predecessor of graph.current[successor]!) {
          if (visited.has(predecessor)) continue;
          visited.add(predecessor);
          predecessors.push(predecessor);
        }
      }
    }
    clusters.push({
      kind: clusterKind(predecessors.length, successors.size),
      predecessors: predecessors.sort(ascending),
      successors: [...successors].sort(ascending),
    });
  }
  return clusters;
}

function validateSuccessorPolicy(input: ElectricalIdentityInput): void {
  const policy: unknown = input.successorPolicy;
  if (policy !== "retire" && policy !== "inherit-most-pins")
    throw new Error('successorPolicy must be "retire" or "inherit-most-pins"');
  for (const hook of [
    "comparePredecessorClass",
    "comparePredecessors",
  ] as const)
    if (!["undefined", "function"].includes(typeof input[hook]))
      throw new Error(`${hook} must be a function`);
}

const noPreference: ElectricalPredecessorComparator = () => 0;

/**
 * Class, pin overlap, successor pins, predecessor pins, predecessor preference, member
 * overlap, then the canonical fallbacks. Predecessor hooks see two different predecessors only;
 * `||` skips a NaN (e.g. two unsequenced IDs), so it is a tie that falls through.
 */
function candidateOrder(
  input: ElectricalIdentityInput,
  previous: readonly CanonicalRecord[],
  current: readonly CanonicalRecord[],
): (first: SuccessorCandidate, second: SuccessorCandidate) => number {
  const byClass = input.comparePredecessorClass ?? noPreference,
    byPreference = input.comparePredecessors ?? noPreference;
  return (first, second) => {
    const p = previous[first.previous]!,
      q = previous[second.previous]!;
    const c = current[first.current]!,
      d = current[second.current]!;
    const distinct = first.previous !== second.previous;
    return (
      (distinct ? byClass(p.key, q.key) : 0) ||
      second.pins - first.pins ||
      d.pins - c.pins ||
      q.pins - p.pins ||
      (distinct ? byPreference(p.key, q.key) : 0) ||
      second.members - first.members ||
      compareText(p.key, q.key) ||
      compareMembership(c, d)
    );
  };
}

/** Maps each inheriting successor (current index) to the predecessor (previous index) it inherits. */
function selectSuccessors(
  input: ElectricalIdentityInput,
  previous: readonly CanonicalRecord[],
  current: readonly CanonicalRecord[],
  graph: OverlapGraph,
  clusters: readonly OverlapCluster[],
): Map<number, number> {
  const inherited = new Map<number, number>(),
    order = candidateOrder(input, previous, current);
  for (const cluster of clusters) {
    // One-to-one continuity survives added/removed members; geometry and names have no role.
    if (cluster.kind === "continuity") {
      inherited.set(cluster.successors[0]!, cluster.predecessors[0]!);
      continue;
    }
    if (input.successorPolicy !== "inherit-most-pins") continue;
    const candidates: SuccessorCandidate[] = cluster.successors.flatMap(
      (successor) =>
        [...graph.shared[successor]!].map(([predecessor, overlap]) => ({
          previous: predecessor,
          current: successor,
          ...overlap,
        })),
    );
    const taken = new Set<number>();
    for (const candidate of candidates.sort(order)) {
      if (taken.has(candidate.previous) || inherited.has(candidate.current))
        continue;
      taken.add(candidate.previous);
      inherited.set(candidate.current, candidate.previous);
    }
  }
  return inherited;
}

function allocateComponentId(
  component: CanonicalRecord,
  preservedId: string | undefined,
  allocateId: ElectricalNetAllocator,
  used: Set<string>,
): string {
  const id =
    preservedId ??
    allocateId(
      Object.freeze({
        componentKey: component.key,
        members: component.members,
      }),
    );
  requireId(id, "Allocated ID");
  if (preservedId === undefined && used.has(id))
    throw new Error(`Allocated ID collision: ${JSON.stringify(id)}`);
  if (preservedId === undefined) used.add(id);
  return id;
}

function assignComponents(
  previous: readonly CanonicalRecord[],
  current: readonly CanonicalRecord[],
  inherited: ReadonlyMap<number, number>,
  allocateId: ElectricalNetAllocator,
  used: Set<string>,
): AssignedComponents {
  const result: AssignedComponents = {
    componentNetIds: new Map(),
    createdIds: [],
    preservedIds: [],
    nextActive: [],
  };
  const ordered = current
    .map((component, index) => ({ component, index }))
    .sort((first, second) =>
      compareMembership(first.component, second.component),
    );
  for (const { component, index } of ordered) {
    const predecessor = inherited.get(index);
    const preserved = predecessor !== undefined;
    const id = allocateComponentId(
      component,
      preserved ? previous[predecessor]!.key : undefined,
      allocateId,
      used,
    );
    if (preserved) result.preservedIds.push(id);
    else result.createdIds.push(id);
    result.componentNetIds.set(component.key, id);
    result.nextActive.push({ id, members: component.members });
  }
  return result;
}

const RETIREMENT_REASON: Readonly<
  Record<ElectricalNetTransitionKind, ElectricalNetRetirementReason>
> = { split: "split", merge: "merged", reconfigure: "reconfigured" };

function createRetirements(
  previous: readonly CanonicalRecord[],
  current: readonly CanonicalRecord[],
  graph: OverlapGraph,
  clusters: readonly OverlapCluster[],
  assigned: AssignedComponents,
): ElectricalNetRetirement[] {
  const reasons = new Map<number, ElectricalNetRetirementReason>(),
    preserved = new Set(assigned.preservedIds);
  for (const cluster of clusters)
    if (cluster.kind !== "continuity")
      for (const predecessor of cluster.predecessors)
        reasons.set(predecessor, RETIREMENT_REASON[cluster.kind]);
  // A predecessor no successor inherits retires: its copper, rules or aliases go inert, never re-targeted.
  return previous.flatMap((record, index) =>
    preserved.has(record.key)
      ? []
      : [
          {
            id: record.key,
            reason: reasons.get(index) ?? "removed",
            successorIds: [...graph.previous[index]!]
              .map((successor) =>
                assigned.componentNetIds.get(current[successor]!.key)!,
              )
              .sort(compareText),
          },
        ],
  );
}

function createTransitions(
  previous: readonly CanonicalRecord[],
  current: readonly CanonicalRecord[],
  clusters: readonly OverlapCluster[],
  inherited: ReadonlyMap<number, number>,
  assigned: AssignedComponents,
): ElectricalNetTransition[] {
  const heirs = new Map(
    [...inherited].map(([successor, predecessor]) => [predecessor, successor]),
  );
  // Canonical index order is code-unit key order, so the ID lists come out sorted.
  return clusters.flatMap((cluster) =>
    cluster.kind === "continuity"
      ? []
      : [
          {
            kind: cluster.kind,
            predecessorIds: cluster.predecessors.map(
              (index) => previous[index]!.key,
            ),
            successorIds: cluster.successors
              .map((index) =>
                assigned.componentNetIds.get(current[index]!.key)!,
              )
              .sort(compareText),
            inherited: cluster.predecessors
              .filter((index) => heirs.has(index))
              .map((index) => ({
                fromId: previous[index]!.key,
                componentKey: current[heirs.get(index)!]!.key,
              })),
          },
        ],
  );
}

/** Pure planning only: callers must persist identities, retirements and dependent edits atomically. */
export function reconcileElectricalIdentity(
  input: ElectricalIdentityInput,
): ElectricalIdentityResult {
  const previous = canonicalRecords(input.previousActive, "id");
  const current = canonicalRecords(input.currentComponents, "key");
  const used = reservedIds(input, previous);
  validateSuccessorPolicy(input);
  const graph = overlapGraph(previous, current),
    clusters = overlapClusters(graph);
  const inherited = selectSuccessors(input, previous, current, graph, clusters);
  const assigned = assignComponents(
    previous,
    current,
    inherited,
    input.allocateId,
    used,
  );
  return {
    nextActive: assigned.nextActive.sort((first, second) =>
      compareText(first.id, second.id),
    ),
    componentNetIds: new Map(
      [...assigned.componentNetIds].sort(([first], [second]) =>
        compareText(first, second),
      ),
    ),
    createdIds: assigned.createdIds.sort(compareText),
    preservedIds: assigned.preservedIds.sort(compareText),
    retirements: createRetirements(
      previous,
      current,
      graph,
      clusters,
      assigned,
    ),
    transitions: createTransitions(
      previous,
      current,
      clusters,
      inherited,
      assigned,
    ),
  };
}
