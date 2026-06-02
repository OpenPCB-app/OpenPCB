/**
 * Pure board-outline geometry — no THREE, no DB. Shared by the Gerber writer,
 * the 2D / 3D renderers, containment / DRC, and bbox recomputation so every
 * consumer agrees on how a board shape flattens to points.
 *
 * `flatten*` returns an *open* ring (first point !== last); callers close the
 * loop themselves (line rendering duplicates, Gerber emits a closing move).
 */
import type {
  PcbBoardCutout,
  PcbBoardCutoutShape,
  PcbBoardOutline,
  PcbOutlineSegment,
  PcbPointMm,
} from "../../../sdks";

/** Segments used to discretise a full 360° circle; arcs scale by sweep. */
export const DEFAULT_ARC_SEGMENTS = 64;

export interface OutlineBboxMm {
  widthMm: number;
  heightMm: number;
  centerMm: PcbPointMm;
}

function arcPoints(
  start: PcbPointMm,
  end: PcbPointMm,
  center: PcbPointMm,
  cw: boolean,
  fullCircleSegments: number,
): PcbPointMm[] {
  const r = Math.hypot(start.x - center.x, start.y - center.y);
  let a0 = Math.atan2(start.y - center.y, start.x - center.x);
  let a1 = Math.atan2(end.y - center.y, end.x - center.x);
  // Normalise the swept angle to (0, 2π] in the requested direction.
  if (cw) {
    while (a1 >= a0) a1 -= Math.PI * 2;
  } else {
    while (a1 <= a0) a1 += Math.PI * 2;
  }
  const sweep = Math.abs(a1 - a0);
  const steps = Math.max(
    1,
    Math.ceil((sweep / (Math.PI * 2)) * fullCircleSegments),
  );
  const pts: PcbPointMm[] = [];
  // Skip i=0 (== start, already emitted by the previous segment); include end.
  for (let i = 1; i <= steps; i += 1) {
    const a = a0 + ((a1 - a0) * i) / steps;
    pts.push({ x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r });
  }
  return pts;
}

function ellipsePoints(
  center: PcbPointMm,
  rx: number,
  ry: number,
  segments: number,
): PcbPointMm[] {
  const pts: PcbPointMm[] = [];
  for (let i = 0; i < segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    pts.push({
      x: center.x + Math.cos(a) * rx,
      y: center.y + Math.sin(a) * ry,
    });
  }
  return pts;
}

function roundRectPoints(
  center: PcbPointMm,
  widthMm: number,
  heightMm: number,
  cornerRadiusMm: number,
  fullCircleSegments: number,
): PcbPointMm[] {
  const hw = widthMm / 2;
  const hh = heightMm / 2;
  const r = Math.max(0, Math.min(cornerRadiusMm, hw, hh));
  if (r <= 0) {
    return [
      { x: center.x + hw, y: center.y - hh },
      { x: center.x + hw, y: center.y + hh },
      { x: center.x - hw, y: center.y + hh },
      { x: center.x - hw, y: center.y - hh },
    ];
  }
  const off = (p: PcbPointMm): PcbPointMm => ({
    x: center.x + p.x,
    y: center.y + p.y,
  });
  const pts: PcbPointMm[] = [];
  const start = off({ x: hw, y: hh - r });
  pts.push(start);
  // top-right corner
  pts.push(
    ...arcPoints(
      start,
      off({ x: hw - r, y: hh }),
      off({ x: hw - r, y: hh - r }),
      false,
      fullCircleSegments,
    ),
  );
  pts.push(off({ x: -(hw - r), y: hh }));
  pts.push(
    ...arcPoints(
      off({ x: -(hw - r), y: hh }),
      off({ x: -hw, y: hh - r }),
      off({ x: -(hw - r), y: hh - r }),
      false,
      fullCircleSegments,
    ),
  );
  pts.push(off({ x: -hw, y: -(hh - r) }));
  pts.push(
    ...arcPoints(
      off({ x: -hw, y: -(hh - r) }),
      off({ x: -(hw - r), y: -hh }),
      off({ x: -(hw - r), y: -(hh - r) }),
      false,
      fullCircleSegments,
    ),
  );
  pts.push(off({ x: hw - r, y: -hh }));
  pts.push(
    ...arcPoints(
      off({ x: hw - r, y: -hh }),
      off({ x: hw, y: -(hh - r) }),
      off({ x: hw - r, y: -(hh - r) }),
      false,
      fullCircleSegments,
    ),
  );
  // implicit close back to `start` along the right edge
  return pts;
}

function contourPoints(
  start: PcbPointMm,
  segments: readonly PcbOutlineSegment[],
  fullCircleSegments: number,
): PcbPointMm[] {
  const pts: PcbPointMm[] = [{ x: start.x, y: start.y }];
  let prev = start;
  for (const seg of segments) {
    if (seg.type === "line") {
      pts.push({ x: seg.to.x, y: seg.to.y });
    } else {
      pts.push(
        ...arcPoints(prev, seg.to, seg.centerMm, seg.cw, fullCircleSegments),
      );
    }
    prev = seg.to;
  }
  // Drop a trailing point coincident with the start (closed contours often end
  // where they began); consumers re-close.
  if (
    pts.length > 1 &&
    Math.abs(pts[pts.length - 1]!.x - start.x) < 1e-9 &&
    Math.abs(pts[pts.length - 1]!.y - start.y) < 1e-9
  ) {
    pts.pop();
  }
  return pts;
}

/** Flatten any outline shape to an open ring of points (mm). */
export function flattenOutline(
  outline: PcbBoardOutline,
  fullCircleSegments: number = DEFAULT_ARC_SEGMENTS,
): PcbPointMm[] {
  const c = outline.centerMm;
  switch (outline.kind) {
    case "rect": {
      const hw = outline.widthMm / 2;
      const hh = outline.heightMm / 2;
      return [
        { x: c.x - hw, y: c.y - hh },
        { x: c.x + hw, y: c.y - hh },
        { x: c.x + hw, y: c.y + hh },
        { x: c.x - hw, y: c.y + hh },
      ];
    }
    case "roundrect":
      return roundRectPoints(
        c,
        outline.widthMm,
        outline.heightMm,
        outline.cornerRadiusMm,
        fullCircleSegments,
      );
    case "circle":
      return ellipsePoints(
        c,
        outline.widthMm / 2,
        outline.heightMm / 2,
        fullCircleSegments,
      );
    case "polygon":
      return outline.pointsMm.map((p) => ({ x: p.x, y: p.y }));
    case "contour":
      return contourPoints(outline.start, outline.segments, fullCircleSegments);
  }
}

/** Flatten a cutout shape (reuses the non-rect outline shapes). */
export function flattenCutout(
  shape: PcbBoardCutoutShape,
  fullCircleSegments: number = DEFAULT_ARC_SEGMENTS,
): PcbPointMm[] {
  return flattenOutline(shape, fullCircleSegments);
}

function bboxOfPoints(points: readonly PcbPointMm[]): OutlineBboxMm {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) {
    return { widthMm: 0, heightMm: 0, centerMm: { x: 0, y: 0 } };
  }
  return {
    widthMm: maxX - minX,
    heightMm: maxY - minY,
    centerMm: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
  };
}

/**
 * Recompute the cached bounding box from an outline's actual geometry. For
 * parametric kinds (rect/roundrect/circle) the stored w/h/center already IS the
 * bbox, but recomputing keeps a single code path after edits.
 */
export function computeOutlineBboxMm(outline: PcbBoardOutline): OutlineBboxMm {
  if (
    outline.kind === "rect" ||
    outline.kind === "roundrect" ||
    outline.kind === "circle"
  ) {
    return {
      widthMm: outline.widthMm,
      heightMm: outline.heightMm,
      centerMm: { ...outline.centerMm },
    };
  }
  return bboxOfPoints(flattenOutline(outline));
}

function pointInRing(ring: readonly PcbPointMm[], p: PcbPointMm): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const intersects =
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * True when `p` is inside the board: inside the outer outline and not inside any
 * cutout. Used for the "items outside outline" warning and mechanical DRC.
 */
export function pointInOutline(
  outline: PcbBoardOutline,
  cutouts: readonly PcbBoardCutout[] | undefined,
  p: PcbPointMm,
): boolean {
  if (!pointInRing(flattenOutline(outline), p)) return false;
  for (const cut of cutouts ?? []) {
    if (pointInRing(flattenCutout(cut.shape), p)) return false;
  }
  return true;
}
