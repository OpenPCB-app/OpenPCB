import type { DesignEntity } from "../contracts/entity";
import { NotFoundError, ValidationError } from "../contracts/errors";
import type { PointNm } from "../contracts/geometry";
import type { EntityKind } from "../contracts/entity-kind";
import type { EntityId, SheetId } from "../contracts/ids";
import type { PinRef } from "../contracts/components/wire-end-hints";
import type { DesignWorld } from "./design-world";

function rotatePoint(point: PointNm, rotationDeg: 0 | 90 | 180 | 270): PointNm {
  if (rotationDeg === 0) return point;
  if (rotationDeg === 90) return { xNm: -point.yNm, yNm: point.xNm };
  if (rotationDeg === 180) return { xNm: -point.xNm, yNm: -point.yNm };
  return { xNm: point.yNm, yNm: -point.xNm };
}

function transformPinLocal(
  point: PointNm,
  transform: { xNm: number; yNm: number; rotationDeg: 0 | 90 | 180 | 270; mirrored: boolean },
): PointNm {
  const mirrored = transform.mirrored
    ? { xNm: -point.xNm, yNm: point.yNm }
    : point;
  const rotated = rotatePoint(mirrored, transform.rotationDeg);
  return {
    xNm: transform.xNm + rotated.xNm,
    yNm: transform.yNm + rotated.yNm,
  };
}

export function listEntitiesByKind(
  world: DesignWorld,
  kind: EntityKind,
): DesignEntity[] {
  return [...world.entities.values()].filter((entity) => entity.kind === kind);
}

export function listEntitiesBySheet(
  world: DesignWorld,
  sheetId: SheetId,
): DesignEntity[] {
  return [...world.entities.values()].filter(
    (entity) => entity.components.sheet_ref?.sheetId === sheetId,
  );
}

export function requireEntity(world: DesignWorld, entityId: EntityId): DesignEntity {
  const entity = world.entities.get(entityId);
  if (!entity) {
    throw new NotFoundError(`Entity not found: ${entityId}`);
  }
  return entity;
}

export function requireSheetEntity(
  world: DesignWorld,
  sheetId: SheetId,
): DesignEntity {
  const entity = requireEntity(world, sheetId);
  if (entity.kind !== "sheet") {
    throw new ValidationError(`Entity ${sheetId} is not a sheet`);
  }
  return entity;
}

export function assertPinRefExistsOnSheet(
  world: DesignWorld,
  sheetId: SheetId,
  pinRef: PinRef,
): void {
  const part = requireEntity(world, pinRef.partInstanceId);
  if (part.kind !== "part_instance") {
    throw new ValidationError(`Entity ${pinRef.partInstanceId} is not part_instance`);
  }

  if (part.components.sheet_ref?.sheetId !== sheetId) {
    throw new ValidationError(`Pin ref ${pinRef.partInstanceId}:${pinRef.originPinKey} on wrong sheet`);
  }

  const pinExists = part.components.symbol_snapshot?.pins.some(
    (pin) => pin.originPinKey === pinRef.originPinKey,
  );
  if (!pinExists) {
    throw new ValidationError(`Pin ref not found: ${pinRef.partInstanceId}:${pinRef.originPinKey}`);
  }
}

export function getPartPinWorldPosition(
  world: DesignWorld,
  sheetId: SheetId,
  pinRef: PinRef,
): PointNm {
  assertPinRefExistsOnSheet(world, sheetId, pinRef);

  const part = requireEntity(world, pinRef.partInstanceId);
  const transform = part.components.transform_2d;
  const pin = part.components.symbol_snapshot?.pins.find(
    (candidate) => candidate.originPinKey === pinRef.originPinKey,
  );

  if (!transform || !pin) {
    throw new ValidationError(`Pin world position unavailable: ${pinRef.partInstanceId}:${pinRef.originPinKey}`);
  }

  return transformPinLocal(pin.localPosition, transform);
}
