import * as THREE from "three";
import type { PcbPlacedPart } from "../../../../sdks";

const DEFAULT_FALLBACK_BOX_MM = {
  widthMm: 3,
  depthMm: 3,
  heightMm: 1.5,
} as const;

export interface PlacementTransformProps {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

function multiplyGroupTransform(
  group: THREE.Group,
  transform: THREE.Matrix4,
): void {
  group.updateMatrix();
  const nextMatrix = transform.clone().multiply(group.matrix);
  nextMatrix.decompose(group.position, group.quaternion, group.scale);
}

export function getPlacementTransformProps(
  placement: PcbPlacedPart,
  boardThicknessMm: number,
): PlacementTransformProps {
  const isBackLayer = placement.layer === "B.Cu";
  const mirrorX = placement.mirrored || isBackLayer;
  return {
    position: [
      placement.positionMm.x,
      placement.positionMm.y,
      isBackLayer ? -boardThicknessMm : 0,
    ],
    rotation: [0, 0, THREE.MathUtils.degToRad(placement.rotationDeg)],
    scale: [mirrorX ? -1 : 1, 1, 1],
  };
}

export function applyPlacementTransform(
  group: THREE.Group,
  placement: PcbPlacedPart,
  boardThicknessMm: number,
): void {
  const transform = getPlacementTransformProps(placement, boardThicknessMm);
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...transform.position),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(...transform.rotation, "XYZ"),
    ),
    new THREE.Vector3(...transform.scale),
  );
  multiplyGroupTransform(group, matrix);
}

export function getFallbackBoxSize(placement: PcbPlacedPart): {
  widthMm: number;
  depthMm: number;
  heightMm: number;
} {
  const bounds = placement.footprint.preview?.bounds;
  if (bounds) {
    const widthMm = Math.abs(bounds.maxX - bounds.minX);
    const depthMm = Math.abs(bounds.maxY - bounds.minY);
    if (widthMm > 0 && depthMm > 0) {
      return {
        widthMm,
        depthMm,
        heightMm: DEFAULT_FALLBACK_BOX_MM.heightMm,
      };
    }
  }

  const pads = placement.footprint.preview?.pads ?? [];
  if (pads.length > 0) {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const pad of pads) {
      const halfWidth = pad.widthMm / 2;
      const halfHeight = pad.heightMm / 2;
      minX = Math.min(minX, pad.centerMm.x - halfWidth);
      minY = Math.min(minY, pad.centerMm.y - halfHeight);
      maxX = Math.max(maxX, pad.centerMm.x + halfWidth);
      maxY = Math.max(maxY, pad.centerMm.y + halfHeight);
    }
    const widthMm = maxX - minX;
    const depthMm = maxY - minY;
    if (
      Number.isFinite(widthMm) &&
      Number.isFinite(depthMm) &&
      widthMm > 0 &&
      depthMm > 0
    ) {
      return {
        widthMm,
        depthMm,
        heightMm: DEFAULT_FALLBACK_BOX_MM.heightMm,
      };
    }
  }

  return { ...DEFAULT_FALLBACK_BOX_MM };
}
