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

/**
 * The author-time orientation/translation correction declared next to a
 * library footprint's STEP source. Lives in the DB as
 * `library_footprint_models.model_ref_json` and is forwarded into the
 * placement payload as `placement.footprint.model3d.modelRef`.
 *
 * Distinct from the *placement* transform: this is per-model (the GLB
 * may be authored Y-up and need a 90° tip to lay flat on the PCB),
 * whereas placement is per-instance (where the part sits on the board).
 */
interface ModelRefCorrection {
  offset?: { x?: number; y?: number; z?: number };
  rotation?: { x?: number; y?: number; z?: number };
  scale?: { x?: number; y?: number; z?: number };
  /** Present only on a verbatim KiCad `(model …)` block (`Model3DRef`, written
   * by `commit-kicad-zip.ts`); CoreLibrary/opclib refs never carry it. */
  resolvedFileName?: unknown;
}

function parseModelRef(raw: unknown): ModelRefCorrection | null {
  if (!raw || typeof raw !== "object") return null;
  return raw as ModelRefCorrection;
}

function isKicadSourcedModelRef(ref: ModelRefCorrection): boolean {
  return typeof ref.resolvedFileName === "string";
}

/**
 * KiCad `(rotate)` semantics, verified against KiCad 8.0.4
 * `3d-viewer/3d_rendering/opengl/render_3d_opengl.cpp`
 * (`RENDER_3D_OPENGL::get3dModelsFromFootprint`, lines 1031-1036): the model
 * matrix is `translate(offset) · rotZ(−z) · rotY(−y) · rotX(−x) · scale`,
 * i.e. negated angles in Z·Y·X order. `(offset)` is mm (`FP_3DMODEL::m_Offset`,
 * `pcbnew/footprint.h:98`) in the Y-up 3D frame, so it is used unchanged.
 * See KF1 §3 "KiCad 3D model". CoreLibrary refs keep the authored XYZ order.
 */
function modelRefRotation(ref: ModelRefCorrection): THREE.Euler {
  const rotation = ref.rotation ?? {};
  const x = THREE.MathUtils.degToRad(rotation.x ?? 0);
  const y = THREE.MathUtils.degToRad(rotation.y ?? 0);
  const z = THREE.MathUtils.degToRad(rotation.z ?? 0);
  return isKicadSourcedModelRef(ref)
    ? new THREE.Euler(-x, -y, -z, "ZYX")
    : new THREE.Euler(x, y, z, "XYZ");
}

function buildModelRefMatrix(ref: ModelRefCorrection): THREE.Matrix4 {
  const offset = ref.offset ?? {};
  const scale = ref.scale ?? {};
  return new THREE.Matrix4().compose(
    new THREE.Vector3(offset.x ?? 0, offset.y ?? 0, offset.z ?? 0),
    new THREE.Quaternion().setFromEuler(modelRefRotation(ref)),
    new THREE.Vector3(scale.x ?? 1, scale.y ?? 1, scale.z ?? 1),
  );
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

/**
 * Model-group variant of `getPlacementTransformProps` (KF1 §3, "3D back-side
 * model"). KiCad turns a flipped model through the board,
 * `R_z(θ)·diag(1,−1,−1) = R_z(θ+180)·diag(−1,1,−1)`: a proper rotation
 * (det = +1), so the body hangs below the bottom face instead of being
 * mirror-imaged into the board. The flat 2D overlay keeps `(−1,1,1)`.
 */
export function getModelPlacementTransformProps(
  placement: PcbPlacedPart,
  boardThicknessMm: number,
): PlacementTransformProps {
  const transform = getPlacementTransformProps(placement, boardThicknessMm);
  const isBackLayer = placement.layer === "B.Cu";
  return {
    ...transform,
    scale: [transform.scale[0], 1, isBackLayer ? -1 : 1],
  };
}

export function applyPlacementTransform(
  group: THREE.Group,
  placement: PcbPlacedPart,
  boardThicknessMm: number,
  modelRefOverride?: unknown,
): void {
  // Per-model author-time correction (offset + rotation + scale) is applied
  // first in model-space, then the per-instance placement transform on top.
  //
  // The correction is a *library* asset. Prefer an explicitly supplied
  // `modelRefOverride` (the live library descriptor) over the placement
  // snapshot, which may have frozen a now-stale correction at place-time.
  // `undefined` means "not supplied — fall back to the snapshot"; an explicit
  // `null` means "the library declares no correction" and must NOT fall back.
  const rawModelRef =
    modelRefOverride !== undefined
      ? modelRefOverride
      : placement.footprint.model3d?.modelRef;
  const modelRef = parseModelRef(rawModelRef);
  if (modelRef) {
    multiplyGroupTransform(group, buildModelRefMatrix(modelRef));
  }

  const transform = getModelPlacementTransformProps(
    placement,
    boardThicknessMm,
  );
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
