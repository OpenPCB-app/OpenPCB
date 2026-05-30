import type {
  DesignerPin,
  DesignerPlacedPart,
  LibraryComponentPlacementDetail,
} from "../../../../sdks";
import type { PersistedPartPayload } from "../payload-types";
import { normalizeRotationDeg } from "../../../../shared/pcb-geometry/rotation";

// Re-export so the many backend importers of `normalizeRotationDeg` from this
// module keep working after the definition moved to shared/pcb-geometry.
export { normalizeRotationDeg };

const NM_PER_MM = 1_000_000;

function mmToNm(mm: number): number {
  return mm * NM_PER_MM;
}

function createPinId(partId: string, originPinKey: string): string {
  return `${partId}:${originPinKey}`;
}

function inferReferencePrefix(detail: LibraryComponentPlacementDetail): string {
  const raw = detail.symbol.referencePrefix?.trim();
  if (!raw) {
    return "U";
  }
  return raw;
}

function nextReference(parts: DesignerPlacedPart[], prefix: string): string {
  let max = 0;
  for (const part of parts) {
    if (!part.reference.startsWith(prefix)) {
      continue;
    }
    const suffix = Number(part.reference.slice(prefix.length));
    if (Number.isInteger(suffix) && suffix > max) {
      max = suffix;
    }
  }
  return `${prefix}${max + 1}`;
}

export function transformLocalPointNm(
  local: { x: number; y: number },
  rotationDeg: 0 | 90 | 180 | 270,
  mirrored: boolean,
): { x: number; y: number } {
  const mirroredX = mirrored ? -local.x : local.x;
  const mirroredY = local.y;

  switch (rotationDeg) {
    case 90:
      return { x: -mirroredY, y: mirroredX };
    case 180:
      return { x: -mirroredX, y: -mirroredY };
    case 270:
      return { x: mirroredY, y: -mirroredX };
    default:
      return { x: mirroredX, y: mirroredY };
  }
}

function buildPins(
  partId: string,
  detail: LibraryComponentPlacementDetail,
  positionNm: { x: number; y: number },
  rotationDeg: 0 | 90 | 180 | 270,
  mirrored: boolean,
): DesignerPin[] {
  return detail.symbol.pins.map((pin) => {
    const localX = Math.round(mmToNm(pin.localPositionMm.x));
    const localY = Math.round(mmToNm(pin.localPositionMm.y));
    const transformed = transformLocalPointNm(
      { x: localX, y: localY },
      rotationDeg,
      mirrored,
    );

    return {
      id: createPinId(partId, pin.originPinKey),
      originPinKey: pin.originPinKey,
      number: pin.number,
      name: pin.name,
      electricalType: pin.electricalType,
      unit: pin.unit,
      localPositionNm: { x: localX, y: localY },
      worldPositionNm: {
        x: positionNm.x + transformed.x,
        y: positionNm.y + transformed.y,
      },
    };
  });
}

export function recomputePinWorldPositions(
  pins: Array<Pick<DesignerPin, "localPositionNm">>,
  positionNm: { x: number; y: number },
  rotationDeg: 0 | 90 | 180 | 270,
  mirrored: boolean,
): Array<{ x: number; y: number }> {
  return pins.map((pin) => {
    const transformed = transformLocalPointNm(
      pin.localPositionNm,
      rotationDeg,
      mirrored,
    );
    return {
      x: positionNm.x + transformed.x,
      y: positionNm.y + transformed.y,
    };
  });
}

export function buildPlacePartPayload(
  detail: LibraryComponentPlacementDetail,
  positionNm: { x: number; y: number },
  rotationDeg: number,
  mirrored: boolean,
  existingParts: DesignerPlacedPart[],
): PersistedPartPayload {
  const partId = crypto.randomUUID();
  const normalizedRotation = normalizeRotationDeg(rotationDeg);
  const prefix = inferReferencePrefix(detail);
  const reference = nextReference(existingParts, prefix);

  return {
    id: partId,
    componentId: detail.component.id,
    reference,
    value: "",
    rotationDeg: normalizedRotation,
    mirrored,
    positionNm,
    symbol: detail.symbol,
    footprint: detail.footprint,
    pins: buildPins(partId, detail, positionNm, normalizedRotation, mirrored),
    propertiesJson: "{}",
  };
}
