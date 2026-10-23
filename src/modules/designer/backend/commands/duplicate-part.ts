import type { DesignerPlacedPart } from "../../../../sdks/designer";
import type { PersistedPartPayload } from "../payload-types";
import {
  nextReference,
  normalizeRotationDeg,
  recomputePinWorldPositions,
} from "./place-part";

type PointNm = { x: number; y: number };
type DuplicatePlan =
  | { ok: true; payload: PersistedPartPayload }
  | { ok: false; detail: string };

function safeIntegerPoint(value: unknown): value is PointNm {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const point = value as Record<string, unknown>;
  return Number.isSafeInteger(point.x) && Number.isSafeInteger(point.y);
}

export function duplicatePartPositionProblem(value: unknown): string | null {
  return safeIntegerPoint(value)
    ? null
    : "positionNm.x and positionNm.y must be safe integer nanometers";
}

/** Plan from the placed snapshot; the current library may differ or be absent. */
export function planDuplicatePart(
  source: DesignerPlacedPart,
  positionNm: PointNm,
  existingParts: readonly DesignerPlacedPart[],
): DuplicatePlan {
  const problem = duplicatePartPositionProblem(positionNm);
  if (problem) return { ok: false, detail: problem };
  const snapshot = structuredClone(source);
  const rotationDeg = normalizeRotationDeg(snapshot.rotationDeg);
  const worldPositions = recomputePinWorldPositions(
    snapshot.pins,
    positionNm,
    rotationDeg,
    snapshot.mirrored,
  );
  if (!worldPositions.every(safeIntegerPoint)) {
    return {
      ok: false,
      detail: "positionNm places a pin outside safe integer nanometers",
    };
  }
  const id = crypto.randomUUID();
  const prefix = snapshot.symbol.referencePrefix?.trim() || "U";
  return {
    ok: true,
    payload: {
      ...snapshot,
      id,
      reference: nextReference(existingParts, prefix),
      positionNm: { ...positionNm },
      rotationDeg,
      pins: snapshot.pins.map((pin, index) => ({
        ...pin,
        id: `${id}:${pin.originPinKey}`,
        worldPositionNm: worldPositions[index]!,
      })),
      propertiesJson: JSON.stringify(snapshot.propertiesJson),
    },
  };
}
