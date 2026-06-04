/**
 * Routing guide engine (PCB-specific). While a trace is being routed it
 * produces, on proximity to the cursor:
 *  - angle rays from the last anchor (horizontal/vertical + ±45°), posture-gated;
 *  - an extend-direction ray continuing the last committed segment;
 *  - collinear-pad lines when the cursor lines up with a nearby pad / trace
 *    endpoint / via on the active layer.
 * It also returns the best magnetic snap point (cursor projected onto the
 * winning guide) so the caller can land the pending segment exactly — unless
 * an object snap (pad/endpoint) already won, which always takes precedence.
 *
 * Guides only appear when the cursor is within `toleranceMm` of them, so the
 * canvas stays quiet until an alignment is actually in reach.
 */

import type {
  PcbCopperLayerId,
  PcbPlacedPart,
  PcbTrace,
  PcbVia,
} from "../../../../../sdks";
import { placementMirrorX } from "../../../../../sdks/designer/pcb-helpers";
import type { RoutePosture } from "../tools/route-tool-state";
import { matchAxis, sortFeatures, type AxisFeature } from "./axis-match";
import type { RayGuide, RouteGuide } from "./guide-types";

const NM_TO_MM = 1 / 1_000_000;

interface Pt {
  x: number;
  y: number;
}

/** Local→world transform (rotation snapped to 90°, optional X-mirror). */
function transformLocal(
  localMm: Pt,
  rotationDeg: number,
  mirrored: boolean,
): Pt {
  const r = (((Math.round(rotationDeg / 90) * 90) % 360) + 360) % 360;
  const mx = mirrored ? -localMm.x : localMm.x;
  const my = localMm.y;
  switch (r) {
    case 90:
      return { x: -my, y: mx };
    case 180:
      return { x: -mx, y: -my };
    case 270:
      return { x: my, y: -mx };
    default:
      return { x: mx, y: my };
  }
}

/** Foot of the perpendicular from `p` onto the line through `origin` with unit `dir`. */
function projectOntoRay(origin: Pt, dir: Pt, p: Pt): Pt {
  const t = (p.x - origin.x) * dir.x + (p.y - origin.y) * dir.y;
  return { x: origin.x + dir.x * t, y: origin.y + dir.y * t };
}

export function computeRouteGuides(input: {
  anchorMm: Pt;
  priorMm?: Pt;
  cursorMm: Pt;
  posture: RoutePosture;
  placements: readonly PcbPlacedPart[];
  traces: readonly PcbTrace[];
  vias: readonly PcbVia[];
  activeLayer: PcbCopperLayerId;
  netId: string | null;
  toleranceMm: number;
}): { guides: RouteGuide[]; snapPointMm: Pt | null } {
  const {
    anchorMm,
    priorMm,
    cursorMm,
    posture,
    placements,
    traces,
    vias,
    activeLayer,
    toleranceMm,
  } = input;
  const guides: RouteGuide[] = [];
  const candidates: Array<{ point: Pt; dist: number }> = [];
  const consider = (point: Pt, dist: number): void => {
    if (dist <= toleranceMm) candidates.push({ point, dist });
  };

  // --- Angle rays from the live anchor ---
  const wantAxis = posture === "axis" || posture === "auto";
  const want45 = posture === "diagonal" || posture === "auto";
  const s = Math.SQRT1_2;
  const rayDirs: Array<{ kind: RayGuide["kind"]; dir: Pt }> = [];
  if (wantAxis) {
    rayDirs.push({ kind: "ray-axis", dir: { x: 1, y: 0 } });
    rayDirs.push({ kind: "ray-axis", dir: { x: 0, y: 1 } });
  }
  if (want45) {
    rayDirs.push({ kind: "ray-45", dir: { x: s, y: s } });
    rayDirs.push({ kind: "ray-45", dir: { x: s, y: -s } });
  }
  if (priorMm) {
    const dx = anchorMm.x - priorMm.x;
    const dy = anchorMm.y - priorMm.y;
    const len = Math.hypot(dx, dy);
    if (len > 1e-6) {
      rayDirs.push({
        kind: "extend-direction",
        dir: { x: dx / len, y: dy / len },
      });
    }
  }
  for (const r of rayDirs) {
    const proj = projectOntoRay(anchorMm, r.dir, cursorMm);
    const dist = Math.hypot(cursorMm.x - proj.x, cursorMm.y - proj.y);
    if (dist <= toleranceMm) {
      guides.push({
        kind: r.kind,
        originMm: anchorMm,
        dirMm: r.dir,
        snapPointMm: proj,
        sourceIds: [],
      });
      consider(proj, dist);
    }
  }

  // --- Collinear-pad: align the cursor X/Y to a nearby object coordinate ---
  const xFeat: AxisFeature[] = [];
  const yFeat: AxisFeature[] = [];
  const pushPoint = (p: Pt, id: string): void => {
    xFeat.push({ coordMm: p.x, crossMin: p.y, crossMax: p.y, sourceId: id });
    yFeat.push({ coordMm: p.y, crossMin: p.x, crossMax: p.x, sourceId: id });
  };
  for (const pl of placements) {
    const pads = pl.footprint.preview?.pads ?? [];
    for (const pad of pads) {
      const off = transformLocal(
        pad.centerMm,
        pl.rotationDeg,
        placementMirrorX(pl),
      );
      pushPoint(
        { x: pl.positionMm.x + off.x, y: pl.positionMm.y + off.y },
        `${pl.id}|${pad.number}`,
      );
    }
  }
  for (const t of traces) {
    if (t.layer !== activeLayer || t.pointsNm.length < 1) continue;
    const a = t.pointsNm[0]!;
    const z = t.pointsNm[t.pointsNm.length - 1]!;
    pushPoint({ x: a.x * NM_TO_MM, y: a.y * NM_TO_MM }, `${t.id}|s`);
    pushPoint({ x: z.x * NM_TO_MM, y: z.y * NM_TO_MM }, `${t.id}|e`);
  }
  for (const v of vias) pushPoint({ x: v.centerMm.x, y: v.centerMm.y }, v.id);

  const mx = xFeat.length
    ? matchAxis(
        sortFeatures(xFeat),
        [{ coordMm: cursorMm.x, crossMin: cursorMm.y, crossMax: cursorMm.y }],
        toleranceMm,
      )[0]
    : null;
  const my = yFeat.length
    ? matchAxis(
        sortFeatures(yFeat),
        [{ coordMm: cursorMm.y, crossMin: cursorMm.x, crossMax: cursorMm.x }],
        toleranceMm,
      )[0]
    : null;
  if (mx) {
    guides.push({
      kind: "collinear-pad",
      axis: "x",
      coordMm: mx.coordMm,
      spanMinMm: mx.crossMin,
      spanMaxMm: mx.crossMax,
      deltaMm: mx.deltaMm,
      sourceIds: mx.sourceIds,
    });
  }
  if (my) {
    guides.push({
      kind: "collinear-pad",
      axis: "y",
      coordMm: my.coordMm,
      spanMinMm: my.crossMin,
      spanMaxMm: my.crossMax,
      deltaMm: my.deltaMm,
      sourceIds: my.sourceIds,
    });
  }
  if (mx || my) {
    const point = {
      x: mx ? mx.coordMm : cursorMm.x,
      y: my ? my.coordMm : cursorMm.y,
    };
    consider(point, Math.hypot(cursorMm.x - point.x, cursorMm.y - point.y));
  }

  let best: { point: Pt; dist: number } | null = null;
  for (const c of candidates) {
    if (!best || c.dist < best.dist) best = c;
  }
  return { guides, snapPointMm: best ? best.point : null };
}
