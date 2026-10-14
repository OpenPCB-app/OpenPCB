/**
 * Staging layout for newly-synced PCB placements: a deterministic shelf grid
 * in a strip to the right of the board outline. Pure, mm, no hashing.
 */

import { snapCoordinateMm } from "../../../../shared/domain/editor-grid";

export interface StagingBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface StagingItem {
  readonly id: string;
  readonly bounds: StagingBounds | null | undefined;
}

export interface StagingExisting {
  readonly xMm: number;
  readonly yMm: number;
  readonly bounds: StagingBounds | null | undefined;
}

export interface StagingFrame {
  readonly outlineBbox: {
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
  } | null;
  readonly boardCenterMm: { readonly x: number; readonly y: number };
  readonly existing: readonly StagingExisting[];
}

// UX staging constants only — not manufacturing rules.
/** Gap between neighbouring staged cells. */
const GAP_MM = 2;
/** Gap between the board / existing parts and the staging strip. */
const MARGIN_MM = 5;
/** Footprint size assumed when a footprint has no preview bounds. */
const FALLBACK_SIZE_MM = 5;
/** Minimum column height so tiny boards do not yield one-part columns. */
const MIN_COLUMN_EXTENT_MM = 60;

function validBounds(
  b: StagingBounds | null | undefined,
): StagingBounds | null {
  if (
    !b ||
    ![b.minX, b.minY, b.maxX, b.maxY].every(Number.isFinite) ||
    b.maxX <= b.minX ||
    b.maxY <= b.minY
  ) {
    return null;
  }
  return b;
}

function sizeOf(raw: StagingBounds | null | undefined): {
  w: number;
  h: number;
  cx: number;
  cy: number;
} {
  const b = validBounds(raw);
  if (!b) return { w: FALLBACK_SIZE_MM, h: FALLBACK_SIZE_MM, cx: 0, cy: 0 };
  return {
    w: b.maxX - b.minX,
    h: b.maxY - b.minY,
    cx: (b.minX + b.maxX) / 2,
    cy: (b.minY + b.maxY) / 2,
  };
}

/** Right edge of an existing part, rotation-safe (uses the largest extent). */
function rightEdge(e: StagingExisting): number {
  const b = validBounds(e.bounds);
  const reach = b
    ? Math.max(
        Math.abs(b.minX),
        Math.abs(b.maxX),
        Math.abs(b.minY),
        Math.abs(b.maxY),
      )
    : FALLBACK_SIZE_MM / 2;
  return e.xMm + reach;
}

const roundNm = (v: number): number => snapCoordinateMm(v, 0);

/**
 * Column-major shelf layout, top-to-bottom (PCB Y is up, so y decreases down
 * a column). Items keep input order; the result is a pure function of input.
 */
export function stageNewPlacements(
  items: readonly StagingItem[],
  frame: StagingFrame,
): Map<string, { xMm: number; yMm: number }> {
  const out = new Map<string, { xMm: number; yMm: number }>();
  if (items.length === 0) return out;

  const bbox = frame.outlineBbox;
  let rightMax = bbox ? bbox.maxX : frame.boardCenterMm.x;
  for (const e of frame.existing) {
    if (Number.isFinite(e.xMm)) rightMax = Math.max(rightMax, rightEdge(e));
  }
  const x0 = rightMax + MARGIN_MM;
  const top = bbox ? bbox.maxY : frame.boardCenterMm.y;
  const limit = Math.max(
    bbox ? bbox.maxY - bbox.minY : 0,
    MIN_COLUMN_EXTENT_MM,
  );

  let colX = x0;
  let colW = 0;
  let used = 0;
  for (const item of items) {
    const s = sizeOf(item.bounds);
    if (used > 0 && used + s.h > limit) {
      colX += colW + GAP_MM;
      colW = 0;
      used = 0;
    }
    const cellCx = colX + s.w / 2;
    const cellCy = top - used - s.h / 2;
    out.set(item.id, {
      xMm: roundNm(cellCx - s.cx),
      yMm: roundNm(cellCy - s.cy),
    });
    colW = Math.max(colW, s.w);
    used += s.h + GAP_MM;
  }
  return out;
}
