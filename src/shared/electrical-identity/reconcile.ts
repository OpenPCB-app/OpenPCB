import type {
  ActiveElectricalNet,
  ElectricalIdentityInput,
  ElectricalIdentityResult,
  ElectricalMember,
  ElectricalNetAllocator,
  ElectricalNetRetirement,
  ElectricalNetRetirementReason,
  ElectricalNetTransition,
} from "./types";
import {
  compareMembership,
  compareText,
  overlapClusters,
  selectSuccessors,
  type CanonicalRecord,
  type OverlapCluster,
  type OverlapGraph,
} from "./successors";

interface AssignedComponents {
  readonly componentNetIds: Map<string, string>;
  readonly createdIds: string[];
  readonly preservedIds: string[];
  readonly nextActive: ActiveElectricalNet[];
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
    result.push({ key, members, tokens });
  }
  return result.sort((first, second) => compareText(first.key, second.key));
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
  };
  const owner = new Map<string, number>();
  previous.forEach((record, index) =>
    record.tokens.forEach((token) => owner.set(token, index)),
  );
  current.forEach((record, currentIndex) => {
    for (const token of record.tokens) {
      const previousIndex = owner.get(token);
      if (previousIndex === undefined) continue;
      graph.current[currentIndex]!.add(previousIndex);
      graph.previous[previousIndex]!.add(currentIndex);
    }
  });
  return graph;
}

function retirementReasons(
  graph: OverlapGraph,
  clusters: readonly OverlapCluster[],
): ElectricalNetRetirementReason[] {
  const result: ElectricalNetRetirementReason[] = graph.previous.map(
    () => "removed",
  );
  for (const cluster of clusters) {
    const reason =
      cluster.previous.length > 1
        ? cluster.current.length > 1
          ? "reconfigured"
          : "merged"
        : "split";
    for (const predecessor of cluster.previous) result[predecessor] = reason;
  }
  return result;
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
  selected: ReadonlyMap<number, number>,
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
    const predecessor = selected.get(index);
    const preserved = predecessor !== undefined;
    const id = allocateComponentId(
      component,
      preserved ? previous[predecessor!]!.key : undefined,
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

function createRetirements(
  previous: readonly CanonicalRecord[],
  current: readonly CanonicalRecord[],
  graph: OverlapGraph,
  assigned: AssignedComponents,
  clusters: readonly OverlapCluster[],
): ElectricalNetRetirement[] {
  const reasons = retirementReasons(graph, clusters),
    preserved = new Set(assigned.preservedIds);
  return previous.flatMap((record, index) =>
    preserved.has(record.key)
      ? []
      : [
          {
            id: record.key,
            reason: reasons[index]!,
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
  selected: ReadonlyMap<number, number>,
  assigned: AssignedComponents,
): ElectricalNetTransition[] {
  return clusters.flatMap((cluster) => {
    if (cluster.previous.length === 1 && cluster.current.length === 1) return [];
    const inherited = cluster.current.flatMap((successor) => {
      const predecessor = selected.get(successor);
      return predecessor === undefined ? [] : [
        Object.freeze({
          fromId: previous[predecessor]!.key,
          componentKey: current[successor]!.key,
        }),
      ];
    }).sort((first, second) =>
      compareText(first.fromId, second.fromId) ||
      compareText(first.componentKey, second.componentKey),
    );
    const kind = cluster.previous.length === 1 ? "split" :
      cluster.current.length === 1 ? "merge" : "reconfigure";
    return [Object.freeze({
      kind,
      predecessorIds: Object.freeze(cluster.previous.map((index) => previous[index]!.key)),
      successorIds: Object.freeze(cluster.current.map((index) =>
        assigned.componentNetIds.get(current[index]!.key)!,
      ).sort(compareText)),
      inherited: Object.freeze(inherited),
    })];
  });
}

/** Pure planning only: callers must persist identities, retirements and dependent edits atomically. */
export function reconcileElectricalIdentity(
  input: ElectricalIdentityInput,
): ElectricalIdentityResult {
  if (
    input.successorPolicy !== "retire" &&
    input.successorPolicy !== "inherit-most-pins"
  ) {
    throw new Error("Invalid electrical successor policy");
  }
  const previous = canonicalRecords(input.previousActive, "id");
  const current = canonicalRecords(input.currentComponents, "key");
  const used = reservedIds(input, previous),
    graph = overlapGraph(previous, current);
  const clusters = overlapClusters(graph);
  const selected = selectSuccessors({ input, previous, current, graph, clusters });
  const assigned = assignComponents(
    previous,
    current,
    selected,
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
    retirements: createRetirements(previous, current, graph, assigned, clusters),
    transitions: Object.freeze(
      createTransitions(previous, current, clusters, selected, assigned),
    ),
  };
}
