// Ratsnest = MST of pad positions per net. Edges are airwires the user must route.
// Prim's algorithm, O(N^2) — fine for hundreds of pads per net; revisit if it bites.

import type {
  PcbNetClass,
  PcbPointMm,
  RatsnestSegment,
} from "../../../../sdks/designer";
import type { NetPadCorrelation, PadRef } from "./net-pad-correlation";
import { resolveNetClassId } from "./net-class-resolver";

function distSq(a: PcbPointMm, b: PcbPointMm): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function mstForNet(
  netId: string,
  netClassId: string,
  pads: PadRef[],
): RatsnestSegment[] {
  if (pads.length < 2) return [];

  const inTree = new Array<boolean>(pads.length).fill(false);
  const minDistSq = new Array<number>(pads.length).fill(
    Number.POSITIVE_INFINITY,
  );
  const parent = new Array<number>(pads.length).fill(-1);

  inTree[0] = true;
  for (let i = 1; i < pads.length; i++) {
    minDistSq[i] = distSq(pads[0]!.worldMm, pads[i]!.worldMm);
    parent[i] = 0;
  }

  const segments: RatsnestSegment[] = [];

  for (let added = 1; added < pads.length; added++) {
    let nextIdx = -1;
    let nextDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < pads.length; i++) {
      if (!inTree[i] && minDistSq[i]! < nextDist) {
        nextDist = minDistSq[i]!;
        nextIdx = i;
      }
    }
    if (nextIdx === -1) break;

    inTree[nextIdx] = true;
    const parentIdx = parent[nextIdx]!;
    const a = pads[parentIdx]!;
    const b = pads[nextIdx]!;
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

    for (let i = 0; i < pads.length; i++) {
      if (!inTree[i]) {
        const d = distSq(pads[nextIdx]!.worldMm, pads[i]!.worldMm);
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
}

export function computeRatsnest(
  correlation: NetPadCorrelation,
  ctx: ComputeRatsnestContext,
): RatsnestSegment[] {
  const result: RatsnestSegment[] = [];
  for (const [netId, pads] of correlation.netPads) {
    const netName = ctx.netNames.get(netId) ?? "";
    const classId = resolveNetClassId(netName, ctx.netClasses);
    result.push(...mstForNet(netId, classId, pads));
  }
  return result;
}
