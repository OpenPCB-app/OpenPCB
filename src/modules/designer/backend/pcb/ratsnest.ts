// Ratsnest = MST of pad positions per net. Edges are airwires the user must route.
// Prim's algorithm, O(N^2) — fine for hundreds of pads per net; revisit if it bites.

import type {
  PcbNetClass,
  PcbPointMm,
  PcbTrace,
  PcbVia,
  RatsnestSegment,
} from "../../../../sdks/designer";
import type { NetPadCorrelation, PadRef } from "./net-pad-correlation";
import { resolveNetClassId } from "./net-class-resolver";

function distSq(a: PcbPointMm, b: PcbPointMm): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Tolerance for considering two coordinates "touching" (mm, ~1µm). */
const TOUCH_EPS_MM = 0.001;

function pointsTouch(a: PcbPointMm, b: PcbPointMm): boolean {
  return distSq(a, b) < TOUCH_EPS_MM * TOUCH_EPS_MM;
}

class UnionFind {
  private parent = new Map<string, string>();
  add(key: string): void {
    if (!this.parent.has(key)) this.parent.set(key, key);
  }
  find(key: string): string {
    let root = key;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    let cursor = key;
    while (cursor !== root) {
      const next = this.parent.get(cursor)!;
      this.parent.set(cursor, root);
      cursor = next;
    }
    return root;
  }
  union(a: string, b: string): void {
    this.add(a);
    this.add(b);
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

function padKey(pad: PadRef): string {
  return `pad:${pad.placementId}:${pad.padNumber}`;
}

/**
 * For each net, group pads into connected components via routed traces+vias on that net.
 * Returns a map from net id → array of pad-component-representatives (one PadRef per component).
 * If a net has 0 routed connections, every pad is its own component.
 */
function groupPadsByConnectivity(
  netId: string,
  pads: PadRef[],
  traces: PcbTrace[],
  vias: PcbVia[],
): PadRef[][] {
  const uf = new UnionFind();
  for (const pad of pads) uf.add(padKey(pad));

  const netTraces = traces.filter((t) => t.netId === netId);
  const netVias = vias.filter((v) => v.netId === netId);

  // Union pads ↔ trace endpoints
  for (const trace of netTraces) {
    const traceKey = `trace:${trace.id}`;
    uf.add(traceKey);
    const endpoints =
      trace.pointsNm.length >= 2
        ? [trace.pointsNm[0]!, trace.pointsNm[trace.pointsNm.length - 1]!]
        : [];
    for (const epNm of endpoints) {
      const epMm: PcbPointMm = { x: epNm.x / 1_000_000, y: epNm.y / 1_000_000 };
      for (const pad of pads) {
        if (pointsTouch(pad.worldMm, epMm)) {
          uf.union(traceKey, padKey(pad));
        }
      }
    }
  }

  // Chain traces sharing endpoints (trace ↔ trace)
  for (let i = 0; i < netTraces.length; i++) {
    const ti = netTraces[i]!;
    const tiKey = `trace:${ti.id}`;
    const tiEnds = [ti.pointsNm[0], ti.pointsNm[ti.pointsNm.length - 1]];
    for (let j = i + 1; j < netTraces.length; j++) {
      const tj = netTraces[j]!;
      const tjKey = `trace:${tj.id}`;
      const tjEnds = [tj.pointsNm[0], tj.pointsNm[tj.pointsNm.length - 1]];
      for (const a of tiEnds) {
        if (!a) continue;
        for (const b of tjEnds) {
          if (!b) continue;
          if (a.x === b.x && a.y === b.y) uf.union(tiKey, tjKey);
        }
      }
    }
  }

  // Union vias to traces whose endpoints land at the via center
  for (const via of netVias) {
    const viaKey = `via:${via.id}`;
    uf.add(viaKey);
    for (const trace of netTraces) {
      const ends = [
        trace.pointsNm[0],
        trace.pointsNm[trace.pointsNm.length - 1],
      ];
      for (const ep of ends) {
        if (!ep) continue;
        const epMm: PcbPointMm = { x: ep.x / 1_000_000, y: ep.y / 1_000_000 };
        if (pointsTouch(epMm, via.centerMm)) {
          uf.union(`trace:${trace.id}`, viaKey);
        }
      }
    }
  }

  // Group pads by component root
  const groups = new Map<string, PadRef[]>();
  for (const pad of pads) {
    const root = uf.find(padKey(pad));
    const list = groups.get(root) ?? [];
    list.push(pad);
    groups.set(root, list);
  }
  return [...groups.values()];
}

function mstForRepresentatives(
  netId: string,
  netClassId: string,
  components: PadRef[][],
): RatsnestSegment[] {
  // Pick one representative pad per component (smallest worldMm.x then y for determinism).
  const reps = components
    .map(
      (comp) =>
        [...comp].sort((a, b) =>
          a.worldMm.x === b.worldMm.x
            ? a.worldMm.y - b.worldMm.y
            : a.worldMm.x - b.worldMm.x,
        )[0]!,
    )
    .filter(Boolean);
  if (reps.length < 2) return [];

  const inTree = new Array<boolean>(reps.length).fill(false);
  const minDistSq = new Array<number>(reps.length).fill(
    Number.POSITIVE_INFINITY,
  );
  const parent = new Array<number>(reps.length).fill(-1);

  inTree[0] = true;
  for (let i = 1; i < reps.length; i++) {
    minDistSq[i] = distSq(reps[0]!.worldMm, reps[i]!.worldMm);
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
    const parentIdx = parent[nextIdx]!;
    const a = reps[parentIdx]!;
    const b = reps[nextIdx]!;
    segments.push({
      netId,
      netClassId,
      fromMm: a.worldMm,
      toMm: b.worldMm,
      fromPlacementId: a.placementId,
      fromPadNumber: a.padNumber,
      toPlacementId: b.placementId,
      toPadNumber: b.padNumber,
    });

    for (let i = 0; i < reps.length; i++) {
      if (!inTree[i]) {
        const d = distSq(reps[nextIdx]!.worldMm, reps[i]!.worldMm);
        if (d < minDistSq[i]!) {
          minDistSq[i] = d;
          parent[i] = nextIdx;
        }
      }
    }
  }

  return segments;
}

export interface ComputeRatsnestContext {
  /** Schematic net id → human net name for net-class auto-assignment. */
  netNames: Map<string, string>;
  /** Net classes available on the board (drives color routing). */
  netClasses: ReadonlyArray<PcbNetClass>;
  /** Routed traces; ratsnest hides airwires already covered by routing. */
  traces?: ReadonlyArray<PcbTrace>;
  /** Routed vias; chain trace segments across layers when computing connectivity. */
  vias?: ReadonlyArray<PcbVia>;
}

export function computeRatsnest(
  correlation: NetPadCorrelation,
  ctx: ComputeRatsnestContext,
): RatsnestSegment[] {
  const traces = (ctx.traces ?? []) as PcbTrace[];
  const vias = (ctx.vias ?? []) as PcbVia[];
  const result: RatsnestSegment[] = [];
  for (const [netId, pads] of correlation.netPads) {
    const netName = ctx.netNames.get(netId) ?? "";
    const classId = resolveNetClassId(netName, ctx.netClasses);
    const components = groupPadsByConnectivity(netId, pads, traces, vias);
    result.push(...mstForRepresentatives(netId, classId, components));
  }
  return result;
}
