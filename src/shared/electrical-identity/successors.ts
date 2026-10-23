import type { ElectricalIdentityInput, ElectricalMember } from "./types";

export interface CanonicalRecord {
  readonly key: string;
  readonly members: readonly ElectricalMember[];
  readonly tokens: readonly string[];
}

export interface OverlapGraph {
  readonly previous: readonly Set<number>[];
  readonly current: readonly Set<number>[];
}

export interface OverlapCluster {
  readonly previous: readonly number[];
  readonly current: readonly number[];
}

interface Candidate {
  readonly previous: number;
  readonly current: number;
  readonly pinOverlap: number;
  readonly memberOverlap: number;
}

export function compareText(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

export function compareMembership(
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

export function overlapClusters(graph: OverlapGraph): OverlapCluster[] {
  const result: OverlapCluster[] = [];
  const visited = new Set<number>();
  for (let start = 0; start < graph.previous.length; start++) {
    if (visited.has(start) || graph.previous[start]!.size === 0) continue;
    const previous = [start],
      current = new Set<number>();
    visited.add(start);
    for (let index = 0; index < previous.length; index++) {
      for (const successor of graph.previous[previous[index]!]!) {
        if (current.has(successor)) continue;
        current.add(successor);
        for (const predecessor of graph.current[successor]!) {
          if (visited.has(predecessor)) continue;
          visited.add(predecessor);
          previous.push(predecessor);
        }
      }
    }
    result.push({
      previous: previous.sort((a, b) => a - b),
      current: [...current].sort((a, b) => a - b),
    });
  }
  return result;
}

function priorities(
  input: ElectricalIdentityInput,
  previous: readonly CanonicalRecord[],
): number[] {
  if (
    input.predecessorPriority !== undefined &&
    typeof input.predecessorPriority !== "function"
  ) {
    throw new Error("predecessorPriority must be a function");
  }
  if (
    input.comparePredecessors !== undefined &&
    typeof input.comparePredecessors !== "function"
  ) {
    throw new Error("comparePredecessors must be a function");
  }
  return previous.map(({ key }) => {
    const priority = input.predecessorPriority ? input.predecessorPriority(key) : 0;
    if (typeof priority !== "number" || !Number.isFinite(priority)) {
      throw new Error("Predecessor priority must be a finite number");
    }
    return priority;
  });
}

function candidate(
  previous: number,
  current: number,
  records: readonly CanonicalRecord[],
  successor: CanonicalRecord,
): Candidate {
  const tokens = new Set(records[previous]!.tokens);
  let pinOverlap = 0,
    memberOverlap = 0;
  successor.tokens.forEach((token, index) => {
    if (!tokens.has(token)) return;
    memberOverlap++;
    if (successor.members[index]!.kind === "pin") pinOverlap++;
  });
  return { previous, current, pinOverlap, memberOverlap };
}

function pinCount(record: CanonicalRecord): number {
  return record.members.filter((member) => member.kind === "pin").length;
}

function predecessorComparison(
  input: ElectricalIdentityInput,
  firstId: string,
  secondId: string,
): number {
  const comparison = firstId !== secondId && input.comparePredecessors
    ? input.comparePredecessors(firstId, secondId) : 0;
  if (typeof comparison !== "number" || !Number.isFinite(comparison)) {
    throw new Error("Predecessor comparison must be a finite number");
  }
  return comparison;
}

function compareCandidates(params: {
  input: ElectricalIdentityInput;
  previous: readonly CanonicalRecord[];
  current: readonly CanonicalRecord[];
  priority: readonly number[];
}): (first: Candidate, second: Candidate) => number {
  const { input, previous, current, priority } = params;
  const previousPins = previous.map(pinCount),
    currentPins = current.map(pinCount);
  return (first, second) => {
    const different = first.previous !== second.previous;
    if (different && priority[first.previous] !== priority[second.previous]) {
      return priority[first.previous]! > priority[second.previous]! ? -1 : 1;
    }
    const overlap =
      second.pinOverlap - first.pinOverlap ||
      second.memberOverlap - first.memberOverlap ||
      currentPins[second.current]! - currentPins[first.current]! ||
      previousPins[second.previous]! - previousPins[first.previous]!;
    if (overlap) return overlap;
    const firstId = previous[first.previous]!.key,
      secondId = previous[second.previous]!.key;
    return (
      predecessorComparison(input, firstId, secondId) ||
      compareText(firstId, secondId) ||
      compareMembership(current[first.current]!, current[second.current]!)
    );
  };
}

export function selectSuccessors(params: {
  input: ElectricalIdentityInput;
  previous: readonly CanonicalRecord[];
  current: readonly CanonicalRecord[];
  graph: OverlapGraph;
  clusters: readonly OverlapCluster[];
}): Map<number, number> {
  const { input, previous, current, graph, clusters } = params;
  const compare = compareCandidates({
    input, previous, current, priority: priorities(input, previous),
  });
  const selected = new Map<number, number>(),
    taken = new Set<number>();
  for (const cluster of clusters) {
    if (cluster.previous.length === 1 && cluster.current.length === 1) {
      selected.set(cluster.current[0]!, cluster.previous[0]!);
      continue;
    }
    if (input.successorPolicy === "retire") continue;
    const candidates = cluster.previous.flatMap((predecessor) =>
      [...graph.previous[predecessor]!].map((successor) =>
        candidate(predecessor, successor, previous, current[successor]!),
      ),
    );
    candidates.sort(compare);
    for (const pair of candidates) {
      if (taken.has(pair.previous) || selected.has(pair.current)) continue;
      taken.add(pair.previous);
      selected.set(pair.current, pair.previous);
    }
  }
  return selected;
}
