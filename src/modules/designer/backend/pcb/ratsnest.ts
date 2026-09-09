// Ratsnest = MST of the still-unconnected copper components per net. Edges are
// airwires the user must route.
//
// Connectivity is NOT computed here — it comes from the shared kernel via
// `board-connectivity.ts`, so the ratsnest, DRC's `UNCONNECTED_NET` and the
// dangling checks always agree on what "connected" means. This file only
// projects the kernel's components onto logical pins and runs Prim's algorithm
// (O(N^2) — fine for hundreds of components per net).
//
// Contract: docs/pcb-hardening/01-connectivity-contract.md §5.

import type {
  PcbFreePad,
  PcbNetClass,
  PcbPointMm,
  RatsnestEndpoint,
  RatsnestSegment,
} from "../../../../sdks/designer";
import type {
  ConnectivityResult,
  CopperItem,
  CopperPadAnchor,
  CopperRecords,
} from "../../../../shared/pcb-connectivity";
import {
  computeBoardConnectivity,
  type BoardConnectivityInput,
} from "./board-connectivity";
import { resolveNetClassId } from "./net-class-resolver";

export type ComputeRatsnestContext = BoardConnectivityInput & {
  /** Schematic net id → human net name for net-class auto-assignment. */
  netNames: Map<string, string>;
  /** Net classes available on the board (drives color routing). */
  netClasses: ReadonlyArray<PcbNetClass>;
  /** Explicit per-net → net-class overrides (netId → netClassId). */
  perNetClassAssignments?: Record<string, string>;
};

function distSq(a: PcbPointMm, b: PcbPointMm): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * One node the ratsnest can draw an airwire to: a copper shape of a pin, or —
 * when every shape of that pin was rejected as degenerate copper — the pin's
 * record position, so the pin is still counted and its open still reported.
 */
interface PinShape {
  anchor: CopperPadAnchor;
  center: PcbPointMm;
  /** Item key, or a synthetic one for a pin with no surviving copper. */
  key: string;
}

/** Total order on pin shapes: `(center.x, center.y, key)`. */
function comparePads(a: PinShape, b: PinShape): number {
  if (a.center.x !== b.center.x) return a.center.x - b.center.x;
  if (a.center.y !== b.center.y) return a.center.y - b.center.y;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/** Logical pin identity — every copper shape of one pin shares it. */
function anchorId(anchor: CopperPadAnchor): string {
  return anchor.kind === "pad"
    ? `pad:${JSON.stringify([anchor.placementId, anchor.padNumber])}`
    : `freePad:${JSON.stringify(anchor.freePadId)}`;
}

function endpointOf(anchor: CopperPadAnchor): RatsnestEndpoint {
  return anchor.kind === "pad"
    ? {
        kind: "pad",
        placementId: anchor.placementId,
        padNumber: anchor.padNumber,
      }
    : { kind: "freePad", freePadId: anchor.freePadId };
}

/** Union-find over kernel component ids (used to merge one pin's shapes). */
class ComponentMerge {
  private parent = new Map<number, number>();
  find(id: number): number {
    let root = id;
    while ((this.parent.get(root) ?? root) !== root) {
      root = this.parent.get(root)!;
    }
    let walk = id;
    while (walk !== root) {
      const next = this.parent.get(walk) ?? walk;
      this.parent.set(walk, root);
      walk = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(Math.max(ra, rb), Math.min(ra, rb));
  }
}

/**
 * Kernel components restricted to this net's pads, with all copper shapes of
 * one logical pin merged (the component body itself joins them — contract §2).
 * Returns one representative pad item per merged component, sorted.
 */
function representativesForNet(
  pads: readonly PinShape[],
  componentOf: ReadonlyMap<string, number>,
): PinShape[] {
  const merge = new ComponentMerge();
  const byAnchor = new Map<string, number>();
  const componentIdOf = new Map<string, number>();
  // Pads outside the kernel's component map (degenerate copper) get their own
  // synthetic component so they still show as an unconnected node.
  let synthetic = -1;
  for (const item of pads) {
    const id = componentOf.get(item.key) ?? synthetic--;
    componentIdOf.set(item.key, id);
    const anchor = anchorId(item.anchor);
    const seen = byAnchor.get(anchor);
    if (seen === undefined) byAnchor.set(anchor, id);
    else merge.union(seen, id);
  }

  const best = new Map<number, PinShape>();
  for (const item of pads) {
    const root = merge.find(componentIdOf.get(item.key)!);
    const current = best.get(root);
    if (!current || comparePads(item, current) < 0) best.set(root, item);
  }
  return [...best.values()].sort(comparePads);
}

function mstForRepresentatives(
  netId: string,
  netClassId: string,
  reps: readonly PinShape[],
): RatsnestSegment[] {
  if (reps.length < 2) return [];

  const inTree = new Array<boolean>(reps.length).fill(false);
  const minDistSq = new Array<number>(reps.length).fill(
    Number.POSITIVE_INFINITY,
  );
  const parent = new Array<number>(reps.length).fill(-1);

  inTree[0] = true;
  for (let i = 1; i < reps.length; i++) {
    minDistSq[i] = distSq(reps[0]!.center, reps[i]!.center);
    parent[i] = 0;
  }

  const segments: RatsnestSegment[] = [];

  for (let added = 1; added < reps.length; added++) {
    let nextIdx = -1;
    let nextDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < reps.length; i++) {
      if (!inTree[i] && minDistSq[i]! < nextDist) {
        nextDist = minDistSq[i]!;
        nextIdx = i;
      }
    }
    if (nextIdx === -1) break;

    inTree[nextIdx] = true;
    const a = reps[parent[nextIdx]!]!;
    const b = reps[nextIdx]!;
    segments.push({
      netId,
      netClassId,
      fromMm: a.center,
      toMm: b.center,
      from: endpointOf(a.anchor),
      to: endpointOf(b.anchor),
    });

    for (let i = 0; i < reps.length; i++) {
      if (!inTree[i]) {
        const d = distSq(b.center, reps[i]!.center);
        if (d < minDistSq[i]!) {
          minDistSq[i] = d;
          parent[i] = nextIdx;
        }
      }
    }
  }

  return segments;
}

/**
 * Nets the ratsnest covers: schematic nets ∪ nets referenced by free pads.
 * Exported because batch DRC derives its own ratsnest from an existing
 * connectivity result (contract 06 §1) and must cover exactly the same nets —
 * a second, hand-rolled net list is how the two paths would drift.
 */
export function ratsnestNetIds(input: {
  padNetIds: ReadonlyMap<string, string>;
  freePads: ReadonlyArray<PcbFreePad>;
}): string[] {
  const nets = new Set<string>(input.padNetIds.values());
  for (const freePad of input.freePads) {
    if (freePad.netId) nets.add(freePad.netId);
  }
  return [...nets].sort();
}

/**
 * Pin shapes per net: every surviving pad item, plus a synthetic node for each
 * pad RECORD whose pin contributed no item at all. Without the second pass a
 * pin whose only copper shape is degenerate would vanish from its net, turning
 * a two-pad net into a one-pad net that draws no airwire and raises no
 * `UNCONNECTED_NET` — the defect would be invisible (Astra 4).
 */
function pinShapesByNet(
  items: readonly CopperItem[],
  records: CopperRecords,
): Map<string, PinShape[]> {
  const byNet = new Map<string, PinShape[]>();
  const push = (netId: string, shape: PinShape): void => {
    const list = byNet.get(netId);
    if (list) list.push(shape);
    else byNet.set(netId, [shape]);
  };
  const covered = new Set<string>();
  for (const item of items) {
    if (item.kind !== "pad" || item.netId === null) continue;
    covered.add(anchorId(item.anchor));
    push(item.netId, {
      anchor: item.anchor,
      center: item.center,
      key: item.key,
    });
  }
  for (const record of records.pads) {
    if (record.netId === null) continue;
    const anchor = anchorId(record.anchor);
    if (covered.has(anchor)) continue;
    covered.add(anchor);
    push(record.netId, {
      anchor: record.anchor,
      center: record.center,
      key: `noCopper:${anchor}`,
    });
  }
  return byNet;
}

/** Everything `computeRatsnest` is, once connectivity has already been run. */
export interface RatsnestFromConnectivityInput {
  items: readonly CopperItem[];
  result: ConnectivityResult;
  records: CopperRecords;
  /** Schematic net id → human net name for net-class auto-assignment. */
  netNames: Map<string, string>;
  netClasses: ReadonlyArray<PcbNetClass>;
  perNetClassAssignments?: Record<string, string>;
  /** The nets to cover, from `ratsnestNetIds`. */
  netIds: readonly string[];
}

/**
 * The MST half of the ratsnest, over a connectivity result the caller already
 * has. Split out of `computeRatsnest` so batch DRC can run it on the graph it
 * built for its own checks (contract 06 §1) instead of re-running the kernel
 * and the fills a second time — one model, one fill, one verdict.
 */
export function ratsnestFromConnectivity(
  input: RatsnestFromConnectivityInput,
): RatsnestSegment[] {
  const padsByNet = pinShapesByNet(input.items, input.records);

  const segments: RatsnestSegment[] = [];
  for (const netId of input.netIds) {
    const pads = padsByNet.get(netId);
    if (!pads || pads.length < 2) continue;
    const classId = resolveNetClassId(
      input.netNames.get(netId) ?? "",
      input.netClasses,
      input.perNetClassAssignments,
      netId,
    );
    const reps = representativesForNet(pads, input.result.componentOf);
    segments.push(...mstForRepresentatives(netId, classId, reps));
  }
  return segments;
}

export function computeRatsnest(
  ctx: ComputeRatsnestContext,
): RatsnestSegment[] {
  const { items, result, records } = computeBoardConnectivity(ctx);
  return ratsnestFromConnectivity({
    items,
    result,
    records,
    netNames: ctx.netNames,
    netClasses: ctx.netClasses,
    ...(ctx.perNetClassAssignments !== undefined
      ? { perNetClassAssignments: ctx.perNetClassAssignments }
      : {}),
    netIds: ratsnestNetIds(ctx),
  });
}
