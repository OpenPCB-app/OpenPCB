import type {
  PcbCopperLayerId,
  PcbPlacedPart,
  PcbPointMm,
  PcbTrace,
  PcbVia,
} from "../../../../sdks";
import { placementMirrorX } from "../../../../sdks/designer/pcb-helpers";

/**
 * Object-snap engine. Given a cursor position in world (mm) and a
 * screen-space tolerance, returns the nearest snap target — pad center,
 * trace endpoint, via center, or null. Pure function so callers can also
 * use it from tools (route, drag, place) without re-implementing the
 * geometry.
 *
 * Distances are in mm; convert screen tolerance with `tolerancePx /
 * pxPerMm` before calling. Pads always beat traces beat vias on tie
 * (KiCad convention — pads are the most-frequent snap target).
 */

const NM_TO_MM = 1 / 1_000_000;

export type SnapKind =
  | "pad-center"
  | "trace-endpoint"
  | "via-center"
  | "trace-segment-end";

export interface SnapTarget {
  kind: SnapKind;
  /** Resolved snap point in world mm. */
  pointMm: PcbPointMm;
  /** Distance from cursor to target, in mm. */
  distanceMm: number;
  /** Source primitive id (pad → "placementId|padNumber"). */
  sourceId: string;
}

export interface SnapInput {
  cursorMm: PcbPointMm;
  /** Snap tolerance in mm (screen-px ÷ pxPerMm). Typical: 8px / zoom. */
  toleranceMm: number;
  placements: readonly PcbPlacedPart[];
  traces: readonly PcbTrace[];
  vias: readonly PcbVia[];
  /** Restrict trace endpoint snap to this layer. */
  activeLayer: PcbCopperLayerId;
  /** Disable individual sources. */
  options?: {
    snapPads?: boolean;
    snapTraceEndpoints?: boolean;
    snapVias?: boolean;
  };
}

function transformLocal(
  localMm: PcbPointMm,
  rotationDeg: number,
  mirrored: boolean,
): PcbPointMm {
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

function distMm(a: PcbPointMm, b: PcbPointMm): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Find the nearest snap target. Returns null when no candidate is inside
 * the tolerance. Time complexity is O(P + T + V) — fine for boards up to
 * ~5k primitives; swap for the rbush index in a future phase.
 */
export function findSnapTarget(input: SnapInput): SnapTarget | null {
  const {
    cursorMm,
    toleranceMm,
    placements,
    traces,
    vias,
    activeLayer,
    options,
  } = input;
  const snapPads = options?.snapPads ?? true;
  const snapTraceEnds = options?.snapTraceEndpoints ?? true;
  const snapVias = options?.snapVias ?? true;

  let best: SnapTarget | null = null;
  const consider = (candidate: SnapTarget): void => {
    if (candidate.distanceMm > toleranceMm) return;
    if (!best) {
      best = candidate;
      return;
    }
    // Tie-break by priority then distance.
    const prio = (k: SnapKind): number =>
      k === "pad-center"
        ? 0
        : k === "trace-endpoint" || k === "trace-segment-end"
          ? 1
          : 2;
    if (prio(candidate.kind) < prio(best.kind)) {
      best = candidate;
      return;
    }
    if (
      prio(candidate.kind) === prio(best.kind) &&
      candidate.distanceMm < best.distanceMm
    ) {
      best = candidate;
    }
  };

  if (snapPads) {
    for (const placement of placements) {
      const pads = placement.footprint.preview?.pads ?? [];
      for (const pad of pads) {
        const offset = transformLocal(
          pad.centerMm,
          placement.rotationDeg,
          placementMirrorX(placement),
        );
        const cx = placement.positionMm.x + offset.x;
        const cy = placement.positionMm.y + offset.y;
        const d = distMm(cursorMm, { x: cx, y: cy });
        consider({
          kind: "pad-center",
          pointMm: { x: cx, y: cy },
          distanceMm: d,
          sourceId: `${placement.id}|${pad.number}`,
        });
      }
    }
  }

  if (snapTraceEnds) {
    for (const trace of traces) {
      if (trace.layer !== activeLayer) continue;
      if (trace.pointsNm.length < 2) continue;
      // Trace endpoints (head + tail).
      const a = trace.pointsNm[0]!;
      const z = trace.pointsNm[trace.pointsNm.length - 1]!;
      const aMm = { x: a.x * NM_TO_MM, y: a.y * NM_TO_MM };
      const zMm = { x: z.x * NM_TO_MM, y: z.y * NM_TO_MM };
      consider({
        kind: "trace-endpoint",
        pointMm: aMm,
        distanceMm: distMm(cursorMm, aMm),
        sourceId: `${trace.id}|start`,
      });
      consider({
        kind: "trace-endpoint",
        pointMm: zMm,
        distanceMm: distMm(cursorMm, zMm),
        sourceId: `${trace.id}|end`,
      });
      // Intermediate vertices — useful when reshaping a trace.
      for (let i = 1; i < trace.pointsNm.length - 1; i += 1) {
        const p = trace.pointsNm[i]!;
        const pMm = { x: p.x * NM_TO_MM, y: p.y * NM_TO_MM };
        consider({
          kind: "trace-segment-end",
          pointMm: pMm,
          distanceMm: distMm(cursorMm, pMm),
          sourceId: `${trace.id}|${i}`,
        });
      }
    }
  }

  if (snapVias) {
    for (const via of vias) {
      const d = distMm(cursorMm, via.centerMm);
      consider({
        kind: "via-center",
        pointMm: { ...via.centerMm },
        distanceMm: d,
        sourceId: via.id,
      });
    }
  }

  return best;
}
