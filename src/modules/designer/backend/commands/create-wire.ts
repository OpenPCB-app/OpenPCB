import type { DesignerPin } from "../../../../sdks/designer";
import type { PersistedWirePayload } from "../payload-types";
import {
  isManhattanPath,
  pointKey,
  repairToManhattan,
  sanitizePath,
  type Point,
} from "../routing/manhattan";

/**
 * Normalize a caller-supplied wire path into a valid Manhattan polyline with
 * exact endpoints. When no interior points are supplied we fall back to a
 * single L-bend; the obstacle-aware auto-router (Phase 4) replaces this default
 * at the command layer when `pointsNm` is omitted.
 */
function normalizePath(
  source: Point,
  target: Point,
  pointsNm: Point[] | undefined,
): Point[] {
  if (!pointsNm || pointsNm.length === 0) {
    if (source.x === target.x || source.y === target.y) {
      return sanitizePath([source, target]);
    }
    return sanitizePath([source, { x: target.x, y: source.y }, target]);
  }
  // Force exact endpoints, keep interior verbatim. If that is already a valid
  // orthogonal path (junction-split geometry or a clean caller path), preserve
  // it exactly. Only snap/rebuild when it is genuinely malformed.
  const forced = [...pointsNm];
  forced[0] = source;
  forced[forced.length - 1] = target;
  const sane = sanitizePath(forced);
  if (sane.length >= 2 && isManhattanPath(sane)) {
    return sane;
  }
  return repairToManhattan(pointsNm, source, target);
}

function validatePath(path: Point[]): string | null {
  if (path.length < 2) {
    return "wire path must contain at least 2 points (source and target must differ)";
  }
  for (let index = 1; index < path.length; index += 1) {
    const prev = path[index - 1]!;
    const curr = path[index]!;
    if (pointKey(prev) === pointKey(curr)) {
      return "wire path contains duplicate consecutive points";
    }
  }
  if (!isManhattanPath(path)) {
    return "wire path must be Manhattan (orthogonal segments only)";
  }
  return null;
}

export function buildCreateWirePayload(
  sourcePin: DesignerPin,
  targetPin: DesignerPin,
  pointsNm: Array<{ x: number; y: number }> | undefined,
): { payload: PersistedWirePayload | null; invalidReason: string | null } {
  const source = sourcePin.worldPositionNm;
  const target = targetPin.worldPositionNm;
  if (source.x === target.x && source.y === target.y) {
    return {
      payload: null,
      invalidReason: "source and target pins are at the same point",
    };
  }
  const normalizedPoints = normalizePath(source, target, pointsNm);
  const invalidReason = validatePath(normalizedPoints);
  if (invalidReason) {
    return { payload: null, invalidReason };
  }

  return {
    payload: {
      id: crypto.randomUUID(),
      sourcePinId: sourcePin.id,
      targetPinId: targetPin.id,
      pointsNm: normalizedPoints,
    },
    invalidReason: null,
  };
}
