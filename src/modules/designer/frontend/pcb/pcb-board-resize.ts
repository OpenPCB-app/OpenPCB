import type {
  DesignerPcbProjection,
  PcbBoardOutline,
  PcbPointMm,
} from "../../../../sdks";
import type { BoundsMm } from "../../../../shared/rendering/types";
import { placementBoundsMm } from "./pcb-rect-hit";
import { pointInOutline } from "../../backend/pcb/outline-geometry";

/** Resize grips: 4 edges + 4 corners. */
export type BoardHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const BOARD_HANDLES: readonly BoardHandle[] = [
  "n",
  "s",
  "e",
  "w",
  "ne",
  "nw",
  "se",
  "sw",
];

/** Minimum board dimension; matches the backend's `> 0` floor with headroom. */
export const MIN_BOARD_MM = 1;
/** Maximum board dimension; mirrors the backend's `<= 2000mm` cap. */
export const MAX_BOARD_MM = 2000;

/** Round to 1 decimal (0.1mm) — board dimensions snap to clean tenths. */
export function roundDimMm(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Bounding box of any outline (from the cached widthMm/heightMm/centerMm). */
function outlineBounds(outline: PcbBoardOutline): BoundsMm {
  const hw = outline.widthMm / 2;
  const hh = outline.heightMm / 2;
  return {
    minX: outline.centerMm.x - hw,
    maxX: outline.centerMm.x + hw,
    minY: outline.centerMm.y - hh,
    maxY: outline.centerMm.y + hh,
  };
}

function scalePoint(p: PcbPointMm, oldB: BoundsMm, b: BoundsMm): PcbPointMm {
  const sx = (b.maxX - b.minX) / Math.max(1e-6, oldB.maxX - oldB.minX);
  const sy = (b.maxY - b.minY) / Math.max(1e-6, oldB.maxY - oldB.minY);
  return {
    x: b.minX + (p.x - oldB.minX) * sx,
    y: b.minY + (p.y - oldB.minY) * sy,
  };
}

/**
 * Rebuild an outline of the SAME kind to fit new bounds. Parametric kinds
 * (rect/roundrect/circle) just update w/h/center (corner radius preserved,
 * clamped to the new half-min); polygon/contour points are scaled to fit.
 */
function outlineFromBounds(
  prev: PcbBoardOutline,
  b: BoundsMm,
): PcbBoardOutline {
  const widthMm = b.maxX - b.minX;
  const heightMm = b.maxY - b.minY;
  const centerMm = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  switch (prev.kind) {
    case "rect":
      return { kind: "rect", widthMm, heightMm, centerMm };
    case "circle":
      return { kind: "circle", widthMm, heightMm, centerMm };
    case "roundrect":
      return {
        kind: "roundrect",
        widthMm,
        heightMm,
        centerMm,
        cornerRadiusMm: Math.min(
          prev.cornerRadiusMm,
          widthMm / 2,
          heightMm / 2,
        ),
      };
    case "polygon": {
      const oldB = outlineBounds(prev);
      return {
        kind: "polygon",
        widthMm,
        heightMm,
        centerMm,
        pointsMm: prev.pointsMm.map((p) => scalePoint(p, oldB, b)),
      };
    }
    case "contour": {
      const oldB = outlineBounds(prev);
      return {
        kind: "contour",
        widthMm,
        heightMm,
        centerMm,
        start: scalePoint(prev.start, oldB, b),
        segments: prev.segments.map((seg) =>
          seg.type === "arc"
            ? {
                type: "arc",
                to: scalePoint(seg.to, oldB, b),
                centerMm: scalePoint(seg.centerMm, oldB, b),
                cw: seg.cw,
              }
            : { type: "line", to: scalePoint(seg.to, oldB, b) },
        ),
      };
    }
  }
}

/**
 * Returns the handle under `cursorMm`, or null. Corners take priority over
 * edges (a corner grip resizes two edges at once). `toleranceMm` is the grab
 * radius around each handle point — a fixed mm value mirroring the other
 * `pcb-hit.ts` tolerances.
 */
export function hitBoardHandle(
  outline: PcbBoardOutline,
  cursorMm: PcbPointMm,
  toleranceMm: number,
): BoardHandle | null {
  const b = outlineBounds(outline);
  const midX = outline.centerMm.x;
  const midY = outline.centerMm.y;
  const near = (px: number, py: number): boolean =>
    Math.abs(cursorMm.x - px) <= toleranceMm &&
    Math.abs(cursorMm.y - py) <= toleranceMm;

  // Corners first.
  if (near(b.maxX, b.maxY)) return "ne";
  if (near(b.minX, b.maxY)) return "nw";
  if (near(b.maxX, b.minY)) return "se";
  if (near(b.minX, b.minY)) return "sw";
  // Edge midpoints.
  if (near(midX, b.maxY)) return "n";
  if (near(midX, b.minY)) return "s";
  if (near(b.maxX, midY)) return "e";
  if (near(b.minX, midY)) return "w";
  return null;
}

/** Scene-space position of a handle (for rendering grips). */
export function handlePointMm(
  outline: PcbBoardOutline,
  handle: BoardHandle,
): PcbPointMm {
  const b = outlineBounds(outline);
  const midX = outline.centerMm.x;
  const midY = outline.centerMm.y;
  switch (handle) {
    case "ne":
      return { x: b.maxX, y: b.maxY };
    case "nw":
      return { x: b.minX, y: b.maxY };
    case "se":
      return { x: b.maxX, y: b.minY };
    case "sw":
      return { x: b.minX, y: b.minY };
    case "n":
      return { x: midX, y: b.maxY };
    case "s":
      return { x: midX, y: b.minY };
    case "e":
      return { x: b.maxX, y: midY };
    case "w":
      return { x: b.minX, y: midY };
  }
}

/** CSS cursor for a handle (axis-aware so the grip telegraphs its direction). */
export function handleCursor(handle: BoardHandle): string {
  switch (handle) {
    case "n":
    case "s":
      return "ns-resize";
    case "e":
    case "w":
      return "ew-resize";
    case "ne":
    case "sw":
      return "nesw-resize";
    case "nw":
    case "se":
      return "nwse-resize";
  }
}

/**
 * CAD-standard edge drag: move only the grabbed edge(s) to the snapped cursor,
 * keeping the opposite edge(s) fixed. `centerMm` shifts as a result. Each moved
 * edge is clamped so the dimension stays within [MIN_BOARD_MM, MAX_BOARD_MM].
 */
export function applyHandleDrag(
  outline: PcbBoardOutline,
  handle: BoardHandle,
  cursorMm: PcbPointMm,
  opts: { snap: (v: number) => number },
): PcbBoardOutline {
  const b = { ...outlineBounds(outline) };
  const x = opts.snap(cursorMm.x);
  const y = opts.snap(cursorMm.y);
  const touchE = handle === "e" || handle === "ne" || handle === "se";
  const touchW = handle === "w" || handle === "nw" || handle === "sw";
  const touchN = handle === "n" || handle === "ne" || handle === "nw";
  const touchS = handle === "s" || handle === "se" || handle === "sw";

  // Move the grabbed edge to the (clamped) cursor, then snap the resulting span
  // to a clean 0.1mm by adjusting ONLY the moved edge — the opposite (fixed)
  // edge stays exact, so the dimension reads as a rounded tenth.
  if (touchE) b.maxX = b.minX + snapDim(clampEdge(x, b.minX, "max") - b.minX);
  if (touchW) b.minX = b.maxX - snapDim(b.maxX - clampEdge(x, b.maxX, "min"));
  if (touchN) b.maxY = b.minY + snapDim(clampEdge(y, b.minY, "max") - b.minY);
  if (touchS) b.minY = b.maxY - snapDim(b.maxY - clampEdge(y, b.maxY, "min"));

  return outlineFromBounds(outline, b);
}

/** Snap a span (dimension) to 0.1mm, clamped to the valid board range. */
function snapDim(span: number): number {
  return Math.min(Math.max(roundDimMm(span), MIN_BOARD_MM), MAX_BOARD_MM);
}

/**
 * Clamp a dragged edge so the resulting span against the fixed opposite edge
 * stays in [MIN_BOARD_MM, MAX_BOARD_MM].
 * - `side === "max"`: moving the high edge; fixed edge is the low one.
 * - `side === "min"`: moving the low edge; fixed edge is the high one.
 */
function clampEdge(value: number, fixed: number, side: "max" | "min"): number {
  if (side === "max") {
    const lo = fixed + MIN_BOARD_MM;
    const hi = fixed + MAX_BOARD_MM;
    return Math.min(Math.max(value, lo), hi);
  }
  const hi = fixed - MIN_BOARD_MM;
  const lo = fixed - MAX_BOARD_MM;
  return Math.min(Math.max(value, lo), hi);
}

/**
 * Count entities whose extent falls (partly) outside `rect`. Used for the
 * non-blocking "N items outside board" warning — resizing never moves or
 * deletes content, so this is purely informational.
 */
export function countOutsideBoard(
  projection: DesignerPcbProjection,
  outline: PcbBoardOutline,
  cutouts?: DesignerPcbProjection["board"]["cutouts"],
): number {
  const inside = (p: PcbPointMm): boolean =>
    pointInOutline(outline, cutouts, p);
  const cornersInside = (b: BoundsMm): boolean =>
    inside({ x: b.minX, y: b.minY }) &&
    inside({ x: b.maxX, y: b.minY }) &&
    inside({ x: b.maxX, y: b.maxY }) &&
    inside({ x: b.minX, y: b.maxY });
  let count = 0;
  for (const placement of projection.placements) {
    const b = placementBoundsMm(placement);
    if (!b) continue;
    if (!cornersInside(b)) count += 1;
  }
  for (const trace of projection.traces) {
    if (!trace.pointsNm.every((p) => inside({ x: p.x / 1e6, y: p.y / 1e6 }))) {
      count += 1;
    }
  }
  for (const via of projection.vias) {
    if (!inside(via.centerMm)) count += 1;
  }
  for (const hole of projection.freeHoles) {
    if (!inside(hole.centerMm)) count += 1;
  }
  for (const pad of projection.freePads) {
    if (!inside(pad.centerMm)) count += 1;
  }
  return count;
}
