/**
 * Plumbing between the path model and the coupling kernel (SI contract 14
 * §4.2) — the part of `checks/signal-integrity.ts` that is about DATA, not
 * about verdicts. It emits no violation code of its own.
 *
 * Two different copper sets feed `coupledSpans` for one member:
 *
 * - the SOURCE is the member's measured PATH, so a dangling stub or a pruned
 *   duplicate is never "uncoupled length" the designer must answer for;
 * - the PARTNER is the partner's COPPER TRACES — every trace item of that net,
 *   whatever its path does. A member is measurable beside an open or looped
 *   partner, which is exactly the case the pre-S14 check went silent on.
 */
import type { PcbPointMm } from "../../../sdks/designer";
import type { CopperItem, TraceCopperItem } from "../../pcb-connectivity/copper-items";
import type { NetPath } from "../../pcb-connectivity/net-path";
import type { SublevelInterval } from "../../pcb-geometry/segment-sublevel";
import { GEOM_EPS_MM } from "../../pcb-geometry/tolerance";
import type { CoupledPath } from "../si/coupled-span";

/** Trace items of one net, in canonical key order. */
export function netTraceItems(
  items: readonly CopperItem[],
  netId: string,
): TraceCopperItem[] {
  return items
    .filter(
      (item): item is TraceCopperItem =>
        item.kind === "trace" &&
        item.netId === netId &&
        item.pointsMm.length >= 2,
    )
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** A net's whole 2D copper, as the coupling kernel's partner side. */
export function traceCopper(items: readonly TraceCopperItem[]): CoupledPath[] {
  return items.map((item) => ({
    layer: item.layer,
    pointsMm: [...item.pointsMm],
    halfWidthMm: item.halfWidthMm,
  }));
}

/**
 * A DEFINED path's copper, in walk order, each segment carrying the WIDTH of
 * the trace it was cut from — `PathSegment.halfWidthMm`, which the path model
 * records (contract §2.7).
 *
 * This used to recover the width by matching a segment's ENDPOINTS back to a
 * trace item, and that is wrong wherever two traces meet: at a junction the
 * endpoint lies on both records, so a pruned NARROW branch could lend its
 * width to a retained WIDE segment. Astra run 2 built the board that does it —
 * a 0.6 mm run with two 0.2 mm stubs touching it — and the measured gap came
 * out 0.2 mm too generous on both sides, which silenced a real
 * `DIFF_PAIR_GAP`. There is no matching left to get wrong.
 */
export function pathCopper(
  path: Extract<NetPath, { kind: "defined" }>,
): CoupledPath[] {
  const out: CoupledPath[] = [];
  for (const segment of path.segments) {
    if (segment.pointsMm.length < 2) continue;
    out.push({
      layer: segment.layer,
      pointsMm: [...segment.pointsMm],
      halfWidthMm: segment.halfWidthMm,
    });
  }
  return out;
}

/** The centreline point at arc length `sMm` of a member's own walk. */
function pointAtWalk(
  paths: readonly CoupledPath[],
  sMm: number,
): PcbPointMm | null {
  let offMm = 0;
  for (const path of paths) {
    for (let i = 1; i < path.pointsMm.length; i += 1) {
      const a = path.pointsMm[i - 1]!;
      const b = path.pointsMm[i]!;
      const lenMm = Math.hypot(b.x - a.x, b.y - a.y);
      if (lenMm === 0) continue;
      if (sMm <= offMm + lenMm) {
        const t = Math.max(0, sMm - offMm) / lenMm;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
      offMm += lenMm;
    }
  }
  return lastPointOf(paths);
}

/** Where the member first runs beside no partner copper, or null. */
export function firstUncoupledPointMm(
  paths: readonly CoupledPath[],
  coupled: readonly SublevelInterval[],
  copperLengthMm: number,
): PcbPointMm | null {
  let cursor = 0;
  for (const span of coupled) {
    if (span.s0 > cursor + GEOM_EPS_MM) return pointAtWalk(paths, cursor);
    if (span.s1 > cursor) cursor = span.s1;
  }
  if (cursor < copperLengthMm - GEOM_EPS_MM) return pointAtWalk(paths, cursor);
  return null;
}

export function firstPointOf(paths: readonly CoupledPath[]): PcbPointMm | null {
  for (const path of paths) {
    const first = path.pointsMm[0];
    if (first) return first;
  }
  return null;
}

function lastPointOf(paths: readonly CoupledPath[]): PcbPointMm | null {
  for (let i = paths.length - 1; i >= 0; i -= 1) {
    const points = paths[i]!.pointsMm;
    const last = points[points.length - 1];
    if (last) return last;
  }
  return null;
}
