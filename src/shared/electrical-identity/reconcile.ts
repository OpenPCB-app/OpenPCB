import type {
  ActiveElectricalNet,
  ElectricalIdentityInput,
  ElectricalIdentityResult,
  ElectricalMember,
  ElectricalNetAllocator,
  ElectricalNetRetirement,
  ElectricalNetRetirementReason,
} from "./types";

interface CanonicalRecord {
  readonly key: string;
  readonly members: readonly ElectricalMember[];
  readonly tokens: readonly string[];
}

interface OverlapGraph {
  readonly previous: readonly Set<number>[];
  readonly current: readonly Set<number>[];
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
    result.push({ key, members, tokens });
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
): ElectricalNetRetirementReason[] {
  const result: ElectricalNetRetirementReason[] = graph.previous.map(
    () => "removed",
  );
  const visited = new Set<number>();
  for (let start = 0; start < graph.previous.length; start++) {
    if (visited.has(start) || graph.previous[start]!.size === 0) continue;
    const predecessors = new Set([start]),
      successors = new Set<number>(),
      queue = [start];
    visited.add(start);
    for (let index = 0; index < queue.length; index++) {
      for (const successor of graph.previous[queue[index]!]!) {
        if (successors.has(successor)) continue;
        successors.add(successor);
        for (const predecessor of graph.current[successor]!) {
          if (visited.has(predecessor)) continue;
          visited.add(predecessor);
          predecessors.add(predecessor);
          queue.push(predecessor);
        }
      }
    }
    const reason =
      predecessors.size > 1
        ? successors.size > 1
          ? "reconfigured"
          : "merged"
        : "split";
    for (const predecessor of predecessors) result[predecessor] = reason;
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
  graph: OverlapGraph,
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
    const predecessors = graph.current[index]!;
    const predecessor = predecessors.values().next().value;
    // One-to-one continuity survives added/removed members; geometry and names have no role.
    const preserved =
      predecessors.size === 1 && graph.previous[predecessor!]!.size === 1;
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
): ElectricalNetRetirement[] {
  const reasons = retirementReasons(graph),
    preserved = new Set(assigned.preservedIds);
  // Split/merge invalidation prevents copper, rules or aliases silently following an arbitrary branch.
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

/** Pure planning only: callers must persist identities, retirements and dependent edits atomically. */
export function reconcileElectricalIdentity(
  input: ElectricalIdentityInput,
): ElectricalIdentityResult {
  const previous = canonicalRecords(input.previousActive, "id");
  const current = canonicalRecords(input.currentComponents, "key");
  const used = reservedIds(input, previous),
    graph = overlapGraph(previous, current);
  const assigned = assignComponents(
    previous,
    current,
    graph,
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
    retirements: createRetirements(previous, current, graph, assigned),
  };
}
