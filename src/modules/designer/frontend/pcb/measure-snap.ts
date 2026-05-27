import type {
  PcbCopperLayerId,
  PcbFreePad,
  PcbPlacedPart,
  PcbPointMm,
  PcbTrace,
  PcbVia,
} from "../../../../sdks";
import { placementMirrorX } from "../../../../sdks/designer/pcb-helpers";
import type { MeasureAnchor, MeasureAnchorKind } from "./tools/measure-tool-state";

const NM_TO_MM = 1 / 1_000_000;

export interface MeasureSnapInput {
  cursorMm: PcbPointMm;
  toleranceMm: number;
  placements: readonly PcbPlacedPart[];
  traces: readonly PcbTrace[];
  vias: readonly PcbVia[];
  freePads: readonly PcbFreePad[];
  activeLayer: PcbCopperLayerId;
}

export interface MeasureSnapTarget extends MeasureAnchor {
  distanceMm: number;
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

function distanceMm(a: PcbPointMm, b: PcbPointMm): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function priority(kind: MeasureAnchorKind): number {
  switch (kind) {
    case "pad-center":
      return 0;
    case "footprint-origin":
      return 1;
    case "free-pad-center":
      return 2;
    case "via-center":
      return 3;
    case "trace-point":
      return 4;
    case "grid":
      return 5;
    case "cursor":
      return 6;
  }
}

export function findMeasureSnapTarget(
  input: MeasureSnapInput,
): MeasureSnapTarget | null {
  let best: MeasureSnapTarget | null = null;
  const consider = (candidate: MeasureSnapTarget): void => {
    if (candidate.distanceMm > input.toleranceMm) return;
    if (!best) {
      best = candidate;
      return;
    }
    if (candidate.distanceMm < best.distanceMm) {
      best = candidate;
      return;
    }
    const sameDistance = Math.abs(candidate.distanceMm - best.distanceMm) < 1e-9;
    if (sameDistance && priority(candidate.kind) < priority(best.kind)) {
      best = candidate;
    }
  };

  for (const placement of input.placements) {
    consider({
      kind: "footprint-origin",
      pointMm: { ...placement.positionMm },
      distanceMm: distanceMm(input.cursorMm, placement.positionMm),
      sourceId: placement.id,
    });
    const pads = placement.footprint.preview?.pads ?? [];
    for (const pad of pads) {
      const offset = transformLocal(
        pad.centerMm,
        placement.rotationDeg,
        placementMirrorX(placement),
      );
      const pointMm = {
        x: placement.positionMm.x + offset.x,
        y: placement.positionMm.y + offset.y,
      };
      consider({
        kind: "pad-center",
        pointMm,
        distanceMm: distanceMm(input.cursorMm, pointMm),
        sourceId: `${placement.id}|${pad.number}`,
      });
    }
  }

  for (const pad of input.freePads) {
    if (pad.layer !== input.activeLayer && pad.padType !== "std") continue;
    consider({
      kind: "free-pad-center",
      pointMm: { ...pad.centerMm },
      distanceMm: distanceMm(input.cursorMm, pad.centerMm),
      sourceId: pad.id,
    });
  }

  for (const via of input.vias) {
    consider({
      kind: "via-center",
      pointMm: { ...via.centerMm },
      distanceMm: distanceMm(input.cursorMm, via.centerMm),
      sourceId: via.id,
    });
  }

  for (const trace of input.traces) {
    if (trace.layer !== input.activeLayer) continue;
    for (let i = 0; i < trace.pointsNm.length; i += 1) {
      const pointNm = trace.pointsNm[i]!;
      const pointMm = { x: pointNm.x * NM_TO_MM, y: pointNm.y * NM_TO_MM };
      consider({
        kind: "trace-point",
        pointMm,
        distanceMm: distanceMm(input.cursorMm, pointMm),
        sourceId: `${trace.id}|${i}`,
      });
    }
  }

  return best;
}
