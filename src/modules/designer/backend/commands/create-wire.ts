import type { DesignerPin } from "../../../../contracts/modules/sdk";
import type { PersistedWirePayload } from "../payload-types";

function key(point: { x: number; y: number }): string {
  return `${point.x}:${point.y}`;
}

function normalizePath(
  source: { x: number; y: number },
  target: { x: number; y: number },
  pointsNm: Array<{ x: number; y: number }> | undefined,
): Array<{ x: number; y: number }> {
  if (!pointsNm || pointsNm.length === 0) {
    if (source.x === target.x || source.y === target.y) {
      return [source, target];
    }
    return [source, { x: target.x, y: source.y }, target];
  }

  const path = [...pointsNm];
  path[0] = source;
  path[path.length - 1] = target;
  return path;
}

function validateManhattanPath(path: Array<{ x: number; y: number }>): string | null {
  if (path.length < 2) {
    return "wire path must contain at least 2 points";
  }

  for (let index = 1; index < path.length; index += 1) {
    const prev = path[index - 1];
    const curr = path[index];
    if (!prev || !curr) {
      continue;
    }
    if (key(prev) === key(curr)) {
      return "wire path contains duplicate consecutive points";
    }
    const isOrthogonal = prev.x === curr.x || prev.y === curr.y;
    if (!isOrthogonal) {
      return "wire path must be Manhattan (orthogonal segments only)";
    }
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
  const normalizedPoints = normalizePath(source, target, pointsNm);
  const invalidReason = validateManhattanPath(normalizedPoints);
  if (invalidReason) {
    return {
      payload: null,
      invalidReason,
    };
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
