import type { PointNm } from "../../contracts/geometry";
import { DEFAULT_SCHEMATIC_GRID_NM } from "../../contracts/units";

function snap(valueNm: number, gridNm: number): number {
  return Math.round(valueNm / gridNm) * gridNm;
}

function isSamePoint(a: PointNm, b: PointNm): boolean {
  return a.xNm === b.xNm && a.yNm === b.yNm;
}

function isCollinear(a: PointNm, b: PointNm, c: PointNm): boolean {
  return (b.yNm - a.yNm) * (c.xNm - b.xNm) === (c.yNm - b.yNm) * (b.xNm - a.xNm);
}

export function normalizeWirePoints(
  points: PointNm[],
  gridNm: number = DEFAULT_SCHEMATIC_GRID_NM,
): PointNm[] {
  if (points.length < 2) {
    return points;
  }

  const snapped = points.map((point) => ({
    xNm: snap(point.xNm, gridNm),
    yNm: snap(point.yNm, gridNm),
  }));

  const deduped: PointNm[] = [];
  for (const point of snapped) {
    const last = deduped[deduped.length - 1];
    if (!last || !isSamePoint(last, point)) {
      deduped.push(point);
    }
  }

  if (deduped.length < 3) {
    return deduped;
  }

  const collapsed: PointNm[] = [deduped[0]!];
  for (let i = 1; i < deduped.length - 1; i++) {
    const prev = collapsed[collapsed.length - 1]!;
    const curr = deduped[i]!;
    const next = deduped[i + 1]!;
    if (!isCollinear(prev, curr, next)) {
      collapsed.push(curr);
    }
  }
  collapsed.push(deduped[deduped.length - 1]!);

  return collapsed;
}
