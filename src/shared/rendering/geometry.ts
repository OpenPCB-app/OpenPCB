import type { BoundsMm, PointMm, PreviewGraphic, PreviewLabel } from "./types";

const TAU = Math.PI * 2;
const EPSILON = 1e-9;

export function emptyBoundsMm(): BoundsMm {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
}

export function isFiniteBoundsMm(bounds: BoundsMm): boolean {
  return (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.maxY) &&
    bounds.maxX >= bounds.minX &&
    bounds.maxY >= bounds.minY
  );
}

export function includePoint(bounds: BoundsMm, point: PointMm): BoundsMm {
  return {
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y),
  };
}

export function expandBounds(bounds: BoundsMm, deltaMm: number): BoundsMm {
  if (deltaMm <= 0) {
    return bounds;
  }
  return {
    minX: bounds.minX - deltaMm,
    minY: bounds.minY - deltaMm,
    maxX: bounds.maxX + deltaMm,
    maxY: bounds.maxY + deltaMm,
  };
}

export function translatePoint(point: PointMm, dx: number, dy: number): PointMm {
  return {
    x: point.x + dx,
    y: point.y + dy,
  };
}

export function translateBounds(bounds: BoundsMm, dx: number, dy: number): BoundsMm {
  return {
    minX: bounds.minX + dx,
    minY: bounds.minY + dy,
    maxX: bounds.maxX + dx,
    maxY: bounds.maxY + dy,
  };
}

function normalizeAngleRad(angleRad: number): number {
  let out = angleRad % TAU;
  if (out < 0) {
    out += TAU;
  }
  return out;
}

function isAngleOnSweep(
  angleRad: number,
  startRad: number,
  endRad: number,
  ccw: boolean,
): boolean {
  const angle = normalizeAngleRad(angleRad);
  const start = normalizeAngleRad(startRad);
  const end = normalizeAngleRad(endRad);

  if (ccw) {
    if (start <= end) {
      return angle >= start - EPSILON && angle <= end + EPSILON;
    }
    return angle >= start - EPSILON || angle <= end + EPSILON;
  }

  if (start >= end) {
    return angle <= start + EPSILON && angle >= end - EPSILON;
  }
  return angle <= start + EPSILON || angle >= end - EPSILON;
}

function arcCenterFrom3Points(
  start: PointMm,
  mid: PointMm,
  end: PointMm,
): { center: PointMm; radius: number; startRad: number; endRad: number; ccw: boolean } | null {
  const d =
    2 *
    (start.x * (mid.y - end.y) +
      mid.x * (end.y - start.y) +
      end.x * (start.y - mid.y));
  if (Math.abs(d) < EPSILON) {
    return null;
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

  const center = { x: ux, y: uy };
  const radius = Math.hypot(start.x - ux, start.y - uy);
  const startRad = Math.atan2(start.y - uy, start.x - ux);
  const midRad = Math.atan2(mid.y - uy, mid.x - ux);
  const endRad = Math.atan2(end.y - uy, end.x - ux);

  const s = normalizeAngleRad(startRad);
  const m = normalizeAngleRad(midRad);
  const e = normalizeAngleRad(endRad);

  let ccw = false;
  if (s < e) {
    ccw = !(m > s && m < e);
  } else {
    ccw = m > s || m < e;
  }

  return { center, radius, startRad, endRad, ccw };
}

function includeBezierExtrema(
  bounds: BoundsMm,
  p0: PointMm,
  p1: PointMm,
  p2: PointMm,
  p3: PointMm,
): BoundsMm {
  const includeT = (acc: BoundsMm, t: number): BoundsMm => {
    if (t <= 0 || t >= 1) {
      return acc;
    }
    const u = 1 - t;
    const point = {
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
    return includePoint(acc, point);
  };

  let current = includePoint(includePoint(includePoint(includePoint(bounds, p0), p1), p2), p3);

  const solveQuadratic = (a: number, b: number, c: number): number[] => {
    if (Math.abs(a) < EPSILON) {
      if (Math.abs(b) < EPSILON) {
        return [];
      }
      return [-c / b];
    }
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) {
      return [];
    }
    if (Math.abs(discriminant) < EPSILON) {
      return [-b / (2 * a)];
    }
    const root = Math.sqrt(discriminant);
    return [(-b + root) / (2 * a), (-b - root) / (2 * a)];
  };

  const ax = -p0.x + 3 * p1.x - 3 * p2.x + p3.x;
  const bx = 2 * (p0.x - 2 * p1.x + p2.x);
  const cx = -p0.x + p1.x;
  const ay = -p0.y + 3 * p1.y - 3 * p2.y + p3.y;
  const by = 2 * (p0.y - 2 * p1.y + p2.y);
  const cy = -p0.y + p1.y;

  for (const t of solveQuadratic(3 * ax, 2 * bx, cx)) {
    current = includeT(current, t);
  }
  for (const t of solveQuadratic(3 * ay, 2 * by, cy)) {
    current = includeT(current, t);
  }

  return current;
}

export function includeGraphic(bounds: BoundsMm, graphic: PreviewGraphic): BoundsMm {
  const strokeHalf = Math.max(graphic.strokeWidthMm, 0) / 2;

  switch (graphic.kind) {
    case "line": {
      const lineBounds = includePoint(includePoint(bounds, graphic.a), graphic.b);
      return expandBounds(lineBounds, strokeHalf);
    }
    case "rect": {
      const rectBounds: BoundsMm = {
        minX: Math.min(bounds.minX, graphic.x, graphic.x + graphic.width),
        minY: Math.min(bounds.minY, graphic.y, graphic.y + graphic.height),
        maxX: Math.max(bounds.maxX, graphic.x, graphic.x + graphic.width),
        maxY: Math.max(bounds.maxY, graphic.y, graphic.y + graphic.height),
      };
      return expandBounds(rectBounds, strokeHalf);
    }
    case "circle": {
      const circleBounds: BoundsMm = {
        minX: Math.min(bounds.minX, graphic.center.x - graphic.radiusMm),
        minY: Math.min(bounds.minY, graphic.center.y - graphic.radiusMm),
        maxX: Math.max(bounds.maxX, graphic.center.x + graphic.radiusMm),
        maxY: Math.max(bounds.maxY, graphic.center.y + graphic.radiusMm),
      };
      return expandBounds(circleBounds, strokeHalf);
    }
    case "arc3": {
      const arc = arcCenterFrom3Points(graphic.start, graphic.mid, graphic.end);
      if (!arc) {
        return expandBounds(
          includePoint(includePoint(includePoint(bounds, graphic.start), graphic.mid), graphic.end),
          strokeHalf,
        );
      }

      let current = includePoint(
        includePoint(includePoint(bounds, graphic.start), graphic.mid),
        graphic.end,
      );

      const cardinal = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
      for (const angleRad of cardinal) {
        if (!isAngleOnSweep(angleRad, arc.startRad, arc.endRad, arc.ccw)) {
          continue;
        }
        current = includePoint(current, {
          x: arc.center.x + Math.cos(angleRad) * arc.radius,
          y: arc.center.y + Math.sin(angleRad) * arc.radius,
        });
      }

      return expandBounds(current, strokeHalf);
    }
    case "polyline": {
      let current = bounds;
      for (const point of graphic.points) {
        current = includePoint(current, point);
      }
      return expandBounds(current, strokeHalf);
    }
    case "bezier": {
      const bezierBounds = includeBezierExtrema(
        bounds,
        graphic.points[0],
        graphic.points[1],
        graphic.points[2],
        graphic.points[3],
      );
      return expandBounds(bezierBounds, strokeHalf);
    }
  }
}

export function includeLabel(bounds: BoundsMm, label: PreviewLabel): BoundsMm {
  const text = label.text.trim();
  if (text.length === 0) {
    return includePoint(bounds, label.at);
  }

  const fontHeight = Math.max(label.fontSizeMm, 0.01);
  const glyphAspect = 0.62;
  const width = text.length * fontHeight * glyphAspect;
  const height = fontHeight;

  let left = 0;
  if (label.anchorX === "center") {
    left = -width / 2;
  } else if (label.anchorX === "right") {
    left = -width;
  }

  let top = 0;
  if (label.anchorY === "middle") {
    top = height / 2;
  } else if (label.anchorY === "bottom") {
    top = height;
  } else if (label.anchorY === "top-baseline") {
    top = height * 0.82;
  } else if (label.anchorY === "bottom-baseline") {
    top = height * 0.18;
  }

  const right = left + width;
  const bottom = top - height;
  const radians = (label.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  const corners: Array<{ x: number; y: number }> = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];

  let current = bounds;
  for (const corner of corners) {
    const x = label.at.x + corner.x * cos - corner.y * sin;
    const y = label.at.y + corner.x * sin + corner.y * cos;
    current = includePoint(current, { x, y });
  }

  return current;
}

export function boundsFromGraphics(
  graphics: readonly PreviewGraphic[],
): BoundsMm | null {
  let bounds = emptyBoundsMm();
  for (const graphic of graphics) {
    bounds = includeGraphic(bounds, graphic);
  }
  return isFiniteBoundsMm(bounds) ? bounds : null;
}

export function normalizeBounds(
  bounds: BoundsMm,
  minSizeMm: number,
): BoundsMm {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const normalizedWidth = Math.max(width, minSizeMm);
  const normalizedHeight = Math.max(height, minSizeMm);
  return {
    minX: cx - normalizedWidth / 2,
    minY: cy - normalizedHeight / 2,
    maxX: cx + normalizedWidth / 2,
    maxY: cy + normalizedHeight / 2,
  };
}
