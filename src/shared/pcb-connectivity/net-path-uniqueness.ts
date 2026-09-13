/**
 * The graph half of the path model (SI contract 14 §2.4): adjacency, bridges,
 * and the minimal terminal-spanning subtree of the bridge-only forest.
 *
 * There is no path search here and there must never be one — the measured set
 * is a SUBTREE, not a route, so a net with two ways round reports `loop`
 * instead of quietly measuring the shorter one.
 */
import type { NetEdge } from "./net-path-graph";

export interface Arc {
  to: number;
  edge: number;
}

export function buildAdjacency(
  nodeCount: number,
  edges: readonly NetEdge[],
  keep: (index: number) => boolean,
): Arc[][] {
  const adj: Arc[][] = Array.from({ length: nodeCount }, () => []);
  edges.forEach((edge, index) => {
    // A self-loop is copper, but it is on no route between two nodes: it can
    // never be a bridge and never enters the subtree. It stays in the branch
    // total, which is where a fold-back's copper belongs.
    if (edge.u === edge.v || !keep(index)) return;
    adj[edge.u]!.push({ to: edge.v, edge: index });
    adj[edge.v]!.push({ to: edge.u, edge: index });
  });
  return adj;
}

export function componentsOf(nodeCount: number, adj: readonly Arc[][]): number[] {
  const comp = new Array<number>(nodeCount).fill(-1);
  let next = 0;
  for (let start = 0; start < nodeCount; start += 1) {
    if (comp[start] !== -1) continue;
    const stack = [start];
    comp[start] = next;
    while (stack.length > 0) {
      const node = stack.pop()!;
      for (const arc of adj[node]!) {
        if (comp[arc.to] === -1) {
          comp[arc.to] = next;
          stack.push(arc.to);
        }
      }
    }
    next += 1;
  }
  return comp;
}

/**
 * Bridge edges by DFS lowlink, iterative so a long chain cannot blow the
 * stack. Parallel edges keep their IDENTITY — the walk skips the edge it
 * entered on, not every edge back to the parent — so two coincident trace
 * records are two edges and neither is a bridge (§2.4, Astra #7).
 */
export function bridgeEdges(nodeCount: number, adj: readonly Arc[][]): Set<number> {
  const disc = new Array<number>(nodeCount).fill(-1);
  const low = new Array<number>(nodeCount).fill(0);
  const bridges = new Set<number>();
  let timer = 0;
  for (let start = 0; start < nodeCount; start += 1) {
    if (disc[start] !== -1) continue;
    disc[start] = timer;
    low[start] = timer;
    timer += 1;
    const stack: Array<{ node: number; viaEdge: number; next: number }> = [
      { node: start, viaEdge: -1, next: 0 },
    ];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const arcs = adj[frame.node]!;
      if (frame.next < arcs.length) {
        const arc = arcs[frame.next]!;
        frame.next += 1;
        if (arc.edge === frame.viaEdge) continue;
        if (disc[arc.to] === -1) {
          disc[arc.to] = timer;
          low[arc.to] = timer;
          timer += 1;
          stack.push({ node: arc.to, viaEdge: arc.edge, next: 0 });
        } else if (disc[arc.to]! < low[frame.node]!) {
          low[frame.node] = disc[arc.to]!;
        }
        continue;
      }
      stack.pop();
      const parent = stack[stack.length - 1];
      if (!parent) continue;
      if (low[frame.node]! < low[parent.node]!) low[parent.node] = low[frame.node]!;
      if (low[frame.node]! > disc[parent.node]!) bridges.add(frame.viaEdge);
    }
  }
  return bridges;
}

/**
 * The MINIMAL subtree of a forest spanning `terminals`: iteratively prune every
 * non-terminal leaf. Each retained edge is counted once — there is no path
 * search anywhere in this file.
 */
export function minimalSubtree(
  adj: readonly Arc[][],
  alive: Set<number>,
  terminals: ReadonlySet<number>,
): Set<number> {
  const degree = new Map<number, number>();
  const bump = (node: number, by: number): number => {
    const next = (degree.get(node) ?? 0) + by;
    degree.set(node, next);
    return next;
  };
  adj.forEach((arcs, node) => {
    for (const arc of arcs) if (alive.has(arc.edge)) bump(node, 1);
  });
  const queue: number[] = [];
  for (const [node, deg] of degree) {
    if (deg === 1 && !terminals.has(node)) queue.push(node);
  }
  while (queue.length > 0) {
    const node = queue.shift()!;
    if ((degree.get(node) ?? 0) !== 1 || terminals.has(node)) continue;
    const arc = adj[node]!.find((a) => alive.has(a.edge));
    if (!arc) continue;
    alive.delete(arc.edge);
    bump(node, -1);
    if (bump(arc.to, -1) === 1 && !terminals.has(arc.to)) queue.push(arc.to);
  }
  return alive;
}

