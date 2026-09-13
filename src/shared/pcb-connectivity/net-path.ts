/**
 * The net path model (SI contract 14 §2): what a net's ROUTED copper is, and
 * when it has no single answer.
 *
 * The measured set is the minimal subtree of the bridge-only forest spanning
 * the net's terminals — never a shortest path and never a walk (§2.4, Astra
 * #7/#15). Copper that is not on it (dangling branches, hanging rings, a
 * partial duplicate) is reported as `branchLengthMm` and never summed; copper
 * that makes the route ambiguous (a ring through two path nodes, a duplicate
 * record, a pour bypass, an inner-layer via traversal) makes the path
 * `undefined` with the reason, so the rule is never silently inert.
 */
import type { PcbLayerCount } from "../../sdks/designer";
import type { ConnectivityResult } from "./connectivity-graph";
import type { CopperItem, PourCopperItem } from "./copper-items";
import { islandSpansOnTrace } from "./island-contact";
import { copperTouch } from "./touch";
const UNDEFINED = (reason: NetPathUndefinedReason): NetPath =>
  ({ kind: "undefined", reason });

import {
  buildNetGraph,
  subPolyline,
  type NetEdge,
  type NetGraph,
} from "./net-path-graph";
import {
  bridgeEdges,
  buildAdjacency,
  componentsOf,
  minimalSubtree,
  type Arc,
} from "./net-path-uniqueness";
import { CONNECT_EPS_MM } from "../pcb-geometry/tolerance";
import type {
  Junction,
  NetPath,
  NetPathUndefinedReason,
  PathSegment,
  PinRef,
} from "./net-path-types";

export type { NetPath, PathSegment, PinRef } from "./net-path-types";

export interface NetPathInput {
  /** The S1 items the connectivity result was computed from. */
  items: readonly CopperItem[];
  /** Must come from `computeConnectivity(items, { junctions: true })`. */
  connectivity: ConnectivityResult;
  layerCount: PcbLayerCount;
  /** The ONLY defined via length (§2.5): a through via, outer to outer. */
  boardThicknessMm: number;
}

export interface NetPaths {
  /** Every net with copper, sorted. */
  netIds: readonly string[];
  netPath(netId: string): NetPath;
}

/** Canonical neighbour order: the walk must not depend on insertion order. */
function arcSortKey(edge: NetEdge): string {
  return edge.kind === "copper"
    ? `0|${edge.traceKey}|${edge.s0}`
    : `1|${edge.viaKey}|${edge.index}`;
}

/**
 * DFS from the lexicographically smallest terminal, emitting each retained
 * copper edge once. Per-edge arc lengths are summed in THIS order (§7).
 */
function walkSubtree(
  graph: NetGraph,
  adj: readonly Arc[][],
  subtree: ReadonlySet<number>,
  startNode: number,
): { segments: PathSegment[]; copperLengthMm: number } {
  const segments: PathSegment[] = [];
  let copperLengthMm = 0;
  const seen = new Set<number>();
  const visited = new Set<number>([startNode]);
  const stack = [startNode];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const arcs = adj[node]!
      .filter((arc) => subtree.has(arc.edge) && !seen.has(arc.edge))
      .map((arc) => ({ arc, key: arcSortKey(graph.edges[arc.edge]!) }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const children: number[] = [];
    for (const { arc } of arcs) {
      if (seen.has(arc.edge)) continue;
      seen.add(arc.edge);
      const edge = graph.edges[arc.edge]!;
      if (edge.kind === "copper") {
        const trace = graph.traces.get(edge.traceKey)!;
        copperLengthMm += edge.weightMm;
        segments.push({
          layer: edge.layer,
          pointsMm: subPolyline(trace.arc, edge.s0, edge.s1),
          s0: edge.s0,
          s1: edge.s1,
          traceKey: edge.traceKey,
          halfWidthMm: trace.item.halfWidthMm,
        });
      }
      if (!visited.has(arc.to)) {
        visited.add(arc.to);
        children.push(arc.to);
      }
    }
    // Reversed so the canonically first child is popped first.
    for (let i = children.length - 1; i >= 0; i -= 1) stack.push(children[i]!);
  }
  return { segments, copperLengthMm };
}

/**
 * Do the net's pour islands join every terminal into one component of the EDGE
 * graph? This is the only thing that can explain copper S1 calls connected
 * while the path graph does not: islands are copper but never edges (§2.6).
 */
function islandsJoinTerminals(
  graph: NetGraph,
  comp: readonly number[],
  terminalNodes: readonly number[],
): boolean {
  const parent = new Map<number, number>();
  const find = (id: number): number => {
    let root = id;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root)!;
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
  };
  for (const pour of graph.pours) {
    let anchor: number | null = null;
    for (const memberKey of pour.memberKeys) {
      for (const node of graph.nodesOfItem.get(memberKey) ?? []) {
        const component = comp[node];
        if (component === undefined) continue;
        if (anchor === null) anchor = component;
        else union(anchor, component);
      }
    }
  }
  const first = find(comp[terminalNodes[0]!]!);
  return terminalNodes.every((node) => find(comp[node]!) === first);
}

/**
 * Islands grouped by the S1 pour–pour relation (`copperTouch`, contract 01 §3):
 * two overlapping zones are ONE conductor, and counting their contacts apart
 * let each of them touch the route once while together they shorted two points
 * of it. Islands of one pour are disjoint by construction and never group.
 */
function islandGroups(
  pours: readonly PourCopperItem[],
): PourCopperItem[][] {
  const parent = pours.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root]!;
    return root;
  };
  for (let i = 0; i < pours.length; i += 1) {
    for (let j = i + 1; j < pours.length; j += 1) {
      const a = pours[i]!;
      const b = pours[j]!;
      if (a.layer !== b.layer || a.netId !== b.netId) continue;
      if (!copperTouch(a, b, CONNECT_EPS_MM)) continue;
      const ra = find(i);
      const rb = find(j);
      if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
    }
  }
  const byRoot = new Map<number, PourCopperItem[]>();
  pours.forEach((pour, i) => {
    const root = find(i);
    const bucket = byRoot.get(root);
    if (bucket) bucket.push(pour);
    else byRoot.set(root, [pour]);
  });
  return [...byRoot.values()];
}

/**
 * How many SEPARATE places one connected group of islands touches the measured
 * subtree (§2.6, as amended). Spans on a retained edge that reach the node at
 * either end are glued through that node, so copper running continuously
 * across a cut counts once; a pad or via member counts as one contact at its
 * node.
 */
function islandContactCount(
  graph: NetGraph,
  itemsByKey: ReadonlyMap<string, CopperItem>,
  subtree: ReadonlySet<number>,
  subtreeNodes: ReadonlySet<number>,
  group: readonly PourCopperItem[],
): number {
  const parent = new Map<number, number>();
  const find = (id: number): number => {
    let root = id;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root)!;
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
  };
  // Node ids stay themselves; span elements are numbered above `nodeCount` and
  // exist only to be glued to the nodes they reach.
  const spansOnEdge: Array<{
    edge: number;
    element: number;
    span: { s0: number; s1: number };
  }> = [];
  const contacts: number[] = [];
  let next = graph.nodeCount;
  for (const pour of group) {
    for (const index of subtree) {
      const edge = graph.edges[index]!;
      if (edge.kind !== "copper") continue;
      if (!pour.memberKeys.has(edge.traceKey)) continue;
      const trace = graph.traces.get(edge.traceKey);
      if (!trace) continue;
      for (const span of islandSpansOnTrace(
        trace.arc,
        trace.item.halfWidthMm,
        pour.rings,
        CONNECT_EPS_MM,
        edge.s0,
        edge.s1,
      )) {
        const element = next;
        next += 1;
        contacts.push(element);
        if (span.s0 <= edge.s0 + CONNECT_EPS_MM) union(element, edge.u);
        if (span.s1 >= edge.s1 - CONNECT_EPS_MM) union(element, edge.v);
        spansOnEdge.push({ edge: index, element, span });
      }
    }
    for (const memberKey of pour.memberKeys) {
      const item = itemsByKey.get(memberKey);
      if (!item || item.kind === "trace" || item.kind === "pour") continue;
      for (const node of graph.nodesOfItem.get(memberKey) ?? []) {
        if (subtreeNodes.has(node)) contacts.push(node);
      }
    }
  }
  // Two islands of one group may reach the same stretch of one edge; that is
  // one place on the route, not two.
  for (let i = 0; i < spansOnEdge.length; i += 1) {
    for (let j = i + 1; j < spansOnEdge.length; j += 1) {
      const x = spansOnEdge[i]!;
      const y = spansOnEdge[j]!;
      if (x.edge !== y.edge) continue;
      if (x.span.s0 > y.span.s1 || y.span.s0 > x.span.s1) continue;
      union(x.element, y.element);
    }
  }
  return new Set(contacts.map((element) => find(element))).size;
}

/** S1 components with every copper shape of one logical pin merged (§2.1). */
function pinComponentRoots(
  graph: NetGraph,
  items: readonly CopperItem[],
  connectivity: ConnectivityResult,
): Map<string, number> {
  const parent = new Map<number, number>();
  const find = (id: number): number => {
    let root = id;
    while ((parent.get(root) ?? root) !== root) root = parent.get(root)!;
    return root;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
  };
  const first = new Map<string, number>();
  for (const item of items) {
    if (item.kind !== "pad") continue;
    const pinKey = graph.pinOfPadItem.get(item.key);
    const component = connectivity.componentOf.get(item.key);
    if (pinKey === undefined || component === undefined) continue;
    const seen = first.get(pinKey);
    if (seen === undefined) first.set(pinKey, component);
    else union(seen, component);
  }
  const roots = new Map<string, number>();
  for (const [pinKey, component] of first) roots.set(pinKey, find(component));
  return roots;
}

function netPathFor(
  items: readonly CopperItem[],
  junctions: readonly Junction[],
  input: NetPathInput,
): NetPath {
  const graph = buildNetGraph(items, junctions);
  const terminalKeys = [...graph.terminalNode.keys()].sort();
  if (terminalKeys.length < 2) return UNDEFINED("terminals");
  const terminalNodes = terminalKeys.map((k) => graph.terminalNode.get(k)!);
  const terminalSet = new Set(terminalNodes);

  const adj = buildAdjacency(graph.nodeCount, graph.edges, () => true);
  const comp = componentsOf(graph.nodeCount, adj);
  const rootComp = comp[terminalNodes[0]!]!;
  if (!terminalNodes.every((node) => comp[node] === rootComp)) {
    const roots = pinComponentRoots(graph, items, input.connectivity);
    const first = roots.get(terminalKeys[0]!);
    const joined =
      first !== undefined &&
      terminalKeys.every((key) => roots.get(key) === first);
    if (!joined) return UNDEFINED("open");
    // S1 calls this copper connected while the path graph does not. A pour is
    // the only thing that can do that legitimately (§2.6); anything else is a
    // contact this model failed to locate, and saying so beats inventing a
    // reason that happens to read plausibly.
    return islandsJoinTerminals(graph, comp, terminalNodes)
      ? UNDEFINED("pour")
      : UNDEFINED("unresolved");
  }

  const bridges = bridgeEdges(graph.nodeCount, adj);
  const bridgeAdj = buildAdjacency(graph.nodeCount, graph.edges, (i) =>
    bridges.has(i),
  );
  const bridgeComp = componentsOf(graph.nodeCount, bridgeAdj);
  const bridgeRoot = bridgeComp[terminalNodes[0]!]!;
  if (!terminalNodes.every((node) => bridgeComp[node] === bridgeRoot)) {
    return UNDEFINED("loop");
  }

  const alive = new Set<number>();
  graph.edges.forEach((edge, index) => {
    if (bridges.has(index) && bridgeComp[edge.u] === bridgeRoot) {
      alive.add(index);
    }
  });
  const subtree = minimalSubtree(bridgeAdj, alive, terminalSet);
  const startNode = graph.terminalNode.get(terminalKeys[0]!)!;
  const { segments, copperLengthMm } = walkSubtree(
    graph,
    adj,
    subtree,
    startNode,
  );

  // §2.5 — the ONLY defined barrel is a THROUGH via traversed outer to outer.
  let viaLengthMm = 0;
  let viaCount = 0;
  const barrelsOfVia = new Map<string, number[]>();
  graph.edges.forEach((edge, index) => {
    if (edge.kind !== "barrel") return;
    const bucket = barrelsOfVia.get(edge.viaKey);
    if (bucket) bucket.push(index);
    else barrelsOfVia.set(edge.viaKey, [index]);
  });
  for (const via of graph.vias) {
    const barrels = barrelsOfVia.get(via.key) ?? [];
    const retained = barrels.filter((index) => subtree.has(index));
    if (retained.length === 0) continue;
    viaCount += 1;
    const span = via.layers;
    const through =
      span.length === input.layerCount &&
      span[0] === "F.Cu" &&
      span[span.length - 1] === "B.Cu";
    if (!through || retained.length !== barrels.length) return UNDEFINED("via");
    viaLengthMm += input.boardThicknessMm;
  }

  // §2.6 — an island touching the subtree in two SEPARATE places bypasses it.
  const subtreeNodes = new Set<number>([startNode]);
  for (const index of subtree) {
    const edge = graph.edges[index]!;
    subtreeNodes.add(edge.u);
    subtreeNodes.add(edge.v);
  }
  const itemsByKey = new Map(items.map((item) => [item.key, item]));
  for (const group of islandGroups(graph.pours)) {
    if (islandContactCount(graph, itemsByKey, subtree, subtreeNodes, group) >= 2) {
      return UNDEFINED("pour");
    }
  }

  let componentCopperMm = 0;
  for (const edge of graph.edges) {
    if (edge.kind === "copper" && comp[edge.u] === rootComp) {
      componentCopperMm += edge.weightMm;
    }
  }
  const terminals: PinRef[] = terminalKeys.map(
    (key) => graph.terminals.get(key)!,
  );
  return {
    kind: "defined",
    lengthMm: copperLengthMm + viaLengthMm,
    copperLengthMm,
    viaLengthMm,
    viaCount,
    terminals,
    topology: terminals.length === 2 ? "chain" : "tree",
    // The subtree is a subset of the component, so this is non-negative in
    // exact arithmetic; the clamp only absorbs the two sums' float orders.
    branchLengthMm: Math.max(0, componentCopperMm - copperLengthMm),
    segments,
  };
}

/**
 * Routed copper paths for every net on the board. Lazy per net: a 200-net board
 * only pays for the nets a consumer asks about.
 */
export function computeNetPaths(input: NetPathInput): NetPaths {
  if (input.connectivity.junctions === undefined) {
    throw new Error(
      "computeNetPaths needs contact locations: build the connectivity with " +
        "computeConnectivity(items, { junctions: true })",
    );
  }
  const items = [...input.items].sort((a, b) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0,
  );
  const netOfItem = new Map<string, string | null>();
  const byNet = new Map<string, CopperItem[]>();
  for (const item of items) {
    netOfItem.set(item.key, item.netId);
    if (item.netId === null) continue;
    const bucket = byNet.get(item.netId);
    if (bucket) bucket.push(item);
    else byNet.set(item.netId, [item]);
  }
  const junctionsByNet = new Map<string, Junction[]>();
  for (const junction of input.connectivity.junctions ?? []) {
    // Both sides of a junction carry the same non-null net: the graph only
    // emits one at a same-net union.
    const netId = netOfItem.get(junction.a);
    if (!netId) continue;
    const bucket = junctionsByNet.get(netId);
    if (bucket) bucket.push(junction);
    else junctionsByNet.set(netId, [junction]);
  }
  const cache = new Map<string, NetPath>();
  return {
    netIds: [...byNet.keys()].sort(),
    netPath(netId: string): NetPath {
      const hit = cache.get(netId);
      if (hit) return hit;
      const netItems = byNet.get(netId);
      const path = netItems
        ? netPathFor(netItems, junctionsByNet.get(netId) ?? [], input)
        : UNDEFINED("terminals");
      cache.set(netId, path);
      return path;
    },
  };
}
