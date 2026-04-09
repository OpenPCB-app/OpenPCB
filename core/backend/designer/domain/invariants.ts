import type { DesignEntity } from "../contracts/entity";
import { ValidationError } from "../contracts/errors";
import type { RotationDeg } from "../contracts/geometry";

const VALID_ROTATIONS = new Set<RotationDeg>([0, 90, 180, 270]);

export function assertRotation(rotation: number): asserts rotation is RotationDeg {
  if (!VALID_ROTATIONS.has(rotation as RotationDeg)) {
    throw new ValidationError(`Invalid rotation: ${rotation}`);
  }
}

export function assertFiniteNm(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new ValidationError(`${field} must be finite`);
  }
}

export function assertEntityInvariant(entity: DesignEntity): void {
  if (!entity.id) {
    throw new ValidationError("Entity id required");
  }

  if (entity.kind !== "sheet" && !entity.components.sheet_ref) {
    throw new ValidationError(`Entity ${entity.id} missing sheet_ref`);
  }

  if (entity.kind === "part_instance") {
    const transform = entity.components.transform_2d;
    const originRef = entity.components.part_origin_ref;
    const snapshot = entity.components.symbol_snapshot;
    const instance = entity.components.instance_fields;
    if (!transform || !originRef || !snapshot || !instance) {
      throw new ValidationError(
        `Part instance ${entity.id} missing required components`,
      );
    }
    assertFiniteNm(transform.xNm, `${entity.id}.transform_2d.xNm`);
    assertFiniteNm(transform.yNm, `${entity.id}.transform_2d.yNm`);
    assertRotation(transform.rotationDeg);
  }

  if (entity.kind === "wire") {
    const wireGeometry = entity.components.wire_geometry;
    if (!wireGeometry || wireGeometry.pointsNm.length < 2) {
      throw new ValidationError(`Wire ${entity.id} requires >= 2 points`);
    }
    for (let i = 0; i < wireGeometry.pointsNm.length; i++) {
      const point = wireGeometry.pointsNm[i]!;
      assertFiniteNm(point.xNm, `${entity.id}.wire_geometry.pointsNm[${i}].xNm`);
      assertFiniteNm(point.yNm, `${entity.id}.wire_geometry.pointsNm[${i}].yNm`);
    }
  }

  if (entity.kind === "net" && !entity.components.net_meta) {
    throw new ValidationError(`Net ${entity.id} missing net_meta`);
  }
}
