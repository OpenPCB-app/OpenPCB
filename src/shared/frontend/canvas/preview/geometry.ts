import type { PreviewGraphic } from "../../../rendering";

const ARC_SEGMENTS = 24;
const CURVE_SEGMENTS = 20;

function arcFromThreePoints(
  start: { x: number; y: number },
  mid: { x: number; y: number },
  end: { x: number; y: number },
): Array<{ x: number; y: number }> {
  const d =
    2 *
    (start.x * (mid.y - end.y) +
      mid.x * (end.y - start.y) +
      end.x * (start.y - mid.y));
  if (Math.abs(d) < 1e-12) {
    return [start, end];
  }

  const ux =
    ((start.x * start.x + start.y * start.y) * (mid.y - end.y) +
      (mid.x * mid.x + mid.y * mid.y) * (end.y - start.y) +
      (end.x * end.x + end.y * end.y) * (start.y - mid.y)) /
    d;
  const uy =
    ((start.x * start.x + start.y * start.y) * (end.x - mid.x) +
      (mid.x * mid.x + mid.y * mid.y) * (start.x - end.x) +
      (end.x * end.x + end.y * end.y) * (mid.x - start.x)) /
    d;

  const radius = Math.hypot(start.x - ux, start.y - uy);
  const startAngle = Math.atan2(start.y - uy, start.x - ux);
  const midAngle = Math.atan2(mid.y - uy, mid.x - ux);
  let endAngle = Math.atan2(end.y - uy, end.x - ux);

  const normalize = (angle: number): number => {
    let out = angle;
    while (out < 0) out += Math.PI * 2;
    while (out >= Math.PI * 2) out -= Math.PI * 2;
    return out;
  };

  const s = normalize(startAngle);
  const m = normalize(midAngle);
  const e = normalize(endAngle);

  let ccw = false;
  if (s < e) {
    ccw = !(m > s && m < e);
  } else {
    ccw = m > s || m < e;
  }

  let sweep = endAngle - startAngle;
  if (ccw && sweep < 0) {
    sweep += Math.PI * 2;
  }
  if (!ccw && sweep > 0) {
    sweep -= Math.PI * 2;
  }

  const points: Array<{ x: number; y: number }> = [];
  for (let index = 0; index <= ARC_SEGMENTS; index += 1) {
    const t = index / ARC_SEGMENTS;
    const angle = startAngle + sweep * t;
    points.push({
      x: ux + Math.cos(angle) * radius,
      y: uy + Math.sin(angle) * radius,
    });
  }
  return points;
}

function cubicBezierPoint(
  t: number,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
): { x: number; y: number } {
  const u = 1 - t;
  return {
    x:
      u * u * u * p0.x +
      3 * u * u * t * p1.x +
      3 * u * t * t * p2.x +
      t * t * t * p3.x,
    y:
      u * u * u * p0.y +
      3 * u * u * t * p1.y +
      3 * u * t * t * p2.y +
      t * t * t * p3.y,
  };
}

export function graphicStrokeSegments(
  graphic: PreviewGraphic,
): Array<[number, number, number, number]> {
  if (graphic.kind === "line") {
    return [[graphic.a.x, graphic.a.y, graphic.b.x, graphic.b.y]];
  }
  if (graphic.kind === "rect") {
    const x = graphic.x;
    const y = graphic.y;
    const w = graphic.width;
    const h = graphic.height;
    return [
      [x, y, x + w, y],
      [x + w, y, x + w, y + h],
      [x + w, y + h, x, y + h],
      [x, y + h, x, y],
    ];
  }
  if (graphic.kind === "circle") {
    const segments: Array<[number, number, number, number]> = [];
    for (let index = 0; index < ARC_SEGMENTS; index += 1) {
      const a1 = (index / ARC_SEGMENTS) * Math.PI * 2;
      const a2 = ((index + 1) / ARC_SEGMENTS) * Math.PI * 2;
      segments.push([
        graphic.center.x + Math.cos(a1) * graphic.radiusMm,
        graphic.center.y + Math.sin(a1) * graphic.radiusMm,
        graphic.center.x + Math.cos(a2) * graphic.radiusMm,
        graphic.center.y + Math.sin(a2) * graphic.radiusMm,
      ]);
    }
    return segments;
  }
  if (graphic.kind === "arc3") {
    const points = arcFromThreePoints(graphic.start, graphic.mid, graphic.end);
    const segments: Array<[number, number, number, number]> = [];
    for (let index = 0; index < points.length - 1; index += 1) {
      const current = points[index];
      const next = points[index + 1];
      if (!current || !next) {
        continue;
      }
      segments.push([current.x, current.y, next.x, next.y]);
    }
    return segments;
  }
  if (graphic.kind === "polyline") {
    const segments: Array<[number, number, number, number]> = [];
    for (let index = 0; index < graphic.points.length - 1; index += 1) {
      const current = graphic.points[index];
      const next = graphic.points[index + 1];
      if (!current || !next) {
        continue;
      }
      segments.push([current.x, current.y, next.x, next.y]);
    }
    if (graphic.closed && graphic.points.length > 2) {
      const first = graphic.points[0];
      const last = graphic.points[graphic.points.length - 1];
      if (first && last) {
        segments.push([last.x, last.y, first.x, first.y]);
      }
    }
    return segments;
  }

  const segments: Array<[number, number, number, number]> = [];
  for (let index = 0; index < CURVE_SEGMENTS; index += 1) {
    const t1 = index / CURVE_SEGMENTS;
    const t2 = (index + 1) / CURVE_SEGMENTS;
    const p1 = cubicBezierPoint(
      t1,
      graphic.points[0],
      graphic.points[1],
      graphic.points[2],
      graphic.points[3],
    );
    const p2 = cubicBezierPoint(
      t2,
      graphic.points[0],
      graphic.points[1],
      graphic.points[2],
      graphic.points[3],
    );
    segments.push([p1.x, p1.y, p2.x, p2.y]);
  }
  return segments;
}
