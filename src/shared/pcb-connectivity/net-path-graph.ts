/**
 * The per-net path graph (SI contract 14 §2.2–§2.3): trace cuts, via span
 * nodes, terminal nodes, and the zero-weight attachments that contract away.
 *
 * Nothing here decides connectivity. Every node and every attachment comes from
 * a junction the S1 sweep already approved; this file only turns those
 * locations into a graph whose edges carry exact arc lengths.
 */
import type { PcbCopperLayerId, PcbPointMm } from "../../sdks/designer";
import { CONNECT_EPS_MM } from "../pcb-geometry/tolerance";
import type {
  CopperItem,
  PadCopperItem,
  PourCopperItem,
  TraceCopperItem,
  ViaCopperItem,
} from "./copper-items";
import type { CopperPadAnchor } from "./copper-records";
import { pointAtArc, traceArc, type TraceArc } from "./trace-arc";
import type { Junction, JunctionInterval, PinRef } from "./net-path-types";
import { sharedLayers } from "./touch";

export type NetEdge =
  | {
      kind: "copper";
      u: number;
      v: number;
      weightMm: number;
      traceKey: string;
      layer: PcbCopperLayerId;
      s0: number;
      s1: number;
    }
  | { kind: "barrel"; u: number; v: number; viaKey: string; index: number };

export interface NetGraph {
  nodeCount: number;
  edges: NetEdge[];
  /** Logical pin key → contracted node; the net's terminals (§2.1). */
  terminalNode: Map<string, number>;
  terminals: Map<string, PinRef>;
  /** Item key → the contracted nodes that item's copper occupies (§2.6). */
  nodesOfItem: Map<string, number[]>;
  traces: Map<string, { item: TraceCopperItem; arc: TraceArc }>;
  vias: ViaCopperItem[];
  pours: PourCopperItem[];
  /** Pad item key → its logical pin key. */
  pinOfPadItem: Map<string, string>;
}

/**
 * Logical pin identity — every copper shape of one pin shares it, exactly as
 * `ratsnest.ts` unions them (contract §2.1). A pad shape is never a terminal on
 * its own.
 */
export function logicalPinKey(anchor: CopperPadAnchor): string {
  return anchor.kind === "pad"
    ? `pad:${JSON.stringify([anchor.placementId, anchor.padNumber])}`
    : `freePad:${JSON.stringify(anchor.freePadId)}`;
}

/** A cut request on a trace, resolved to a node once the cuts are clustered. */
interface CutRef {
  traceKey: string;
  s: number;
}

type NodeRef =
  | { kind: "cut"; ref: CutRef }
  | { kind: "pin"; pinKey: string }
  | { kind: "viaLayer"; viaKey: string; layer: PcbCopperLayerId };

interface TraceCuts {
  values: number[];
  /** Merged spans of centreline lying INSIDE a terminal — never path length. */
  clipped: JunctionInterval[];
}

function findRoot(parent: number[], i: number): number {
  let root = i;
  while (parent[root] !== root) root = parent[root]!;
  let walk = i;
  while (parent[walk] !== root) {
    const next = parent[walk]!;
    parent[walk] = root;
    walk = next;
  }
  return root;
}

/**
 * Cuts sorted and clustered with a BOUNDED diameter: a new cluster starts as
 * soon as a value leaves `CONNECT_EPS_MM` of the cluster's START, so a run of
 * near-coincident cuts can never drift into one arbitrarily wide node
 * (Astra #13). The cluster start is the canonical representative.
 */
function clusterCuts(values: number[]): {
  reps: number[];
  indexOf: Map<number, number>;
} {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const reps: number[] = [];
  const indexOf = new Map<number, number>();
  for (const value of sorted) {
    const start = reps[reps.length - 1];
    if (start === undefined || value - start > CONNECT_EPS_MM) {
      reps.push(value);
    }
    indexOf.set(value, reps.length - 1);
  }
  return { reps, indexOf };
}

/** Merge overlapping / abutting clipped spans; exact, no tolerance. */
function mergeSpans(spans: JunctionInterval[]): JunctionInterval[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a.s0 - b.s0 || a.s1 - b.s1);
  const out: JunctionInterval[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i]!;
    const cur = out[out.length - 1]!;
    if (next.s0 <= cur.s1) {
      if (next.s1 > cur.s1) out[out.length - 1] = { s0: cur.s0, s1: next.s1 };
    } else {
      out.push({ ...next });
    }
  }
  return out;
}

/**
 * One net's path graph. `items` must be the net's items in key order and
 * `junctions` the S1 sweep's records; both are already canonical, so the node
 * numbering below is a pure function of the board.
 */
export function buildNetGraph(
  items: readonly CopperItem[],
  junctions: readonly Junction[],
): NetGraph {
  const byKey = new Map<string, CopperItem>();
  for (const item of items) byKey.set(item.key, item);

  const traces = new Map<string, { item: TraceCopperItem; arc: TraceArc }>();
  const vias: ViaCopperItem[] = [];
  const pours: PourCopperItem[] = [];
  const terminals = new Map<string, PinRef>();
  const pinOfPadItem = new Map<string, string>();
  const cuts = new Map<string, TraceCuts>();
  for (const item of items) {
    switch (item.kind) {
      case "trace": {
        const arc = traceArc(item.pointsMm);
        traces.set(item.key, { item, arc });
        cuts.set(item.key, { values: [0, arc.lengthMm], clipped: [] });
        break;
      }
      case "via":
        vias.push(item);
        break;
      case "pour":
        pours.push(item);
        break;
      case "pad": {
        const pinKey = logicalPinKey(item.anchor);
        pinOfPadItem.set(item.key, pinKey);
        if (!terminals.has(pinKey)) terminals.set(pinKey, item.anchor);
        break;
      }
    }
  }

  // --- pass 1: cuts, clipped spans and attachment requests -----------------
  const attachments: Array<[NodeRef, NodeRef]> = [];
  const cutAt = (traceKey: string, s: number): NodeRef => {
    cuts.get(traceKey)!.values.push(s);
    return { kind: "cut", ref: { traceKey, s } };
  };
  const terminalRefs = (
    item: PadCopperItem | ViaCopperItem,
    layers: readonly PcbCopperLayerId[],
  ): NodeRef[] =>
    item.kind === "pad"
      ? [{ kind: "pin", pinKey: pinOfPadItem.get(item.key)! }]
      : layers.map((layer) => ({
          kind: "viaLayer" as const,
          viaKey: item.key,
          layer,
        }));

  for (const junction of junctions) {
    const a = byKey.get(junction.a);
    const b = byKey.get(junction.b);
    if (!a || !b) continue;
    if (junction.sA !== null && junction.sB !== null) {
      // Two trace sides: a crossing, a merge, or a trace meeting itself.
      attachments.push([
        cutAt(junction.a, junction.sA),
        cutAt(junction.b, junction.sB),
      ]);
      continue;
    }
    if (junction.sA === null && junction.sB === null) {
      // Neither side is a trace: pad–pad, pad–via, via–via. The copper really
      // does meet on every shared layer, so every via span node attaches.
      const layers = sharedLayers(a, b);
      const left = terminalRefs(a as PadCopperItem | ViaCopperItem, layers);
      const right = terminalRefs(b as PadCopperItem | ViaCopperItem, layers);
      if (a.kind === "via" && b.kind === "via") {
        left.forEach((ref, i) => attachments.push([ref, right[i]!]));
      } else {
        for (const l of left) for (const r of right) attachments.push([l, r]);
      }
      continue;
    }
    const traceIsA = junction.sA !== null;
    const traceKey = traceIsA ? junction.a : junction.b;
    const trace = traces.get(traceKey);
    const term = (traceIsA ? b : a) as PadCopperItem | ViaCopperItem;
    if (!trace) continue;
    const target = terminalRefs(term, [trace.item.layer])[0];
    if (!target) continue;
    if (junction.inside.length > 0) {
      // Copper inside a terminal is not routed length (Decision 1): each span
      // is clipped and BOTH boundaries attach, so a pin the trace passes
      // through becomes an interior node rather than a length.
      const record = cuts.get(traceKey)!;
      for (const span of junction.inside) {
        attachments.push([cutAt(traceKey, span.s0), target]);
        attachments.push([cutAt(traceKey, span.s1), target]);
        record.clipped.push(span);
      }
    } else if (junction.attachS !== null) {
      attachments.push([cutAt(traceKey, junction.attachS), target]);
    }
  }

  // --- pass 2: raw nodes, in item-key order -------------------------------
  const clusters = new Map<
    string,
    { reps: number[]; indexOf: Map<number, number> }
  >();
  for (const [key, record] of cuts) {
    clusters.set(key, clusterCuts(record.values));
  }
  const rawId = new Map<string, number>();
  const nodeKeyOf = (ref: NodeRef): string => {
    switch (ref.kind) {
      case "cut": {
        const cluster = clusters.get(ref.ref.traceKey)!;
        return `cut:${ref.ref.traceKey}#${cluster.indexOf.get(ref.ref.s)}`;
      }
      case "pin":
        return `pin:${ref.pinKey}`;
      case "viaLayer":
        return `via:${ref.viaKey}@${ref.layer}`;
    }
  };
  const intern = (key: string): number => {
    const existing = rawId.get(key);
    if (existing !== undefined) return existing;
    const id = rawId.size;
    rawId.set(key, id);
    return id;
  };
  for (const item of items) {
    if (item.kind === "pad") {
      intern(`pin:${pinOfPadItem.get(item.key)!}`);
    } else if (item.kind === "trace") {
      const reps = clusters.get(item.key)!.reps;
      reps.forEach((_, i) => intern(`cut:${item.key}#${i}`));
    } else if (item.kind === "via") {
      for (const layer of item.layers) intern(`via:${item.key}@${layer}`);
    }
  }

  // --- pass 3: contraction, then the surviving edges -----------------------
  const parent = Array.from({ length: rawId.size }, (_, i) => i);
  for (const [left, right] of attachments) {
    const u = rawId.get(nodeKeyOf(left));
    const v = rawId.get(nodeKeyOf(right));
    if (u === undefined || v === undefined) continue;
    const ru = findRoot(parent, u);
    const rv = findRoot(parent, v);
    if (ru !== rv) parent[Math.max(ru, rv)] = Math.min(ru, rv);
  }
  const contracted = new Map<number, number>();
  const nodeOf = (rawKey: string): number => {
    const raw = rawId.get(rawKey);
    if (raw === undefined) return -1;
    const root = findRoot(parent, raw);
    const existing = contracted.get(root);
    if (existing !== undefined) return existing;
    const id = contracted.size;
    contracted.set(root, id);
    return id;
  };

  const edges: NetEdge[] = [];
  const nodesOfItem = new Map<string, number[]>();
  for (const item of items) {
    if (item.kind === "pad") {
      const node = nodeOf(`pin:${pinOfPadItem.get(item.key)!}`);
      nodesOfItem.set(item.key, [node]);
    } else if (item.kind === "trace") {
      const cluster = clusters.get(item.key)!;
      const clipped = mergeSpans(cuts.get(item.key)!.clipped);
      const nodes = cluster.reps.map((_, i) => nodeOf(`cut:${item.key}#${i}`));
      nodesOfItem.set(item.key, nodes);
      for (let i = 0; i + 1 < cluster.reps.length; i += 1) {
        const s0 = cluster.reps[i]!;
        const s1 = cluster.reps[i + 1]!;
        const mid = (s0 + s1) / 2;
        if (clipped.some((span) => span.s0 <= mid && mid <= span.s1)) continue;
        edges.push({
          kind: "copper",
          u: nodes[i]!,
          v: nodes[i + 1]!,
          weightMm: s1 - s0,
          traceKey: item.key,
          layer: item.layer,
          s0,
          s1,
        });
      }
    } else if (item.kind === "via") {
      const nodes = item.layers.map((layer) =>
        nodeOf(`via:${item.key}@${layer}`),
      );
      nodesOfItem.set(item.key, nodes);
      for (let i = 0; i + 1 < nodes.length; i += 1) {
        edges.push({
          kind: "barrel",
          u: nodes[i]!,
          v: nodes[i + 1]!,
          viaKey: item.key,
          index: i,
        });
      }
    }
  }

  const terminalNode = new Map<string, number>();
  for (const pinKey of terminals.keys()) {
    terminalNode.set(pinKey, nodeOf(`pin:${pinKey}`));
  }
  return {
    nodeCount: contracted.size,
    edges,
    terminalNode,
    terminals,
    nodesOfItem,
    traces,
    vias,
    pours,
    pinOfPadItem,
  };
}

/** The centreline between two arc lengths, endpoints included. */
export function subPolyline(
  arc: TraceArc,
  s0: number,
  s1: number,
): PcbPointMm[] {
  const out: PcbPointMm[] = [pointAtArc(arc, s0)];
  for (let i = 0; i < arc.points.length; i += 1) {
    const at = arc.prefix[i]!;
    if (at > s0 && at < s1) out.push(arc.points[i]!);
  }
  out.push(pointAtArc(arc, s1));
  return out;
}
