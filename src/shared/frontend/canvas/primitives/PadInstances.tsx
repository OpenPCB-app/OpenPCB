import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RENDER_ORDER } from "../layers";

export interface PadData {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  shape: "circle" | "rect" | "oval" | "roundrect";
  roundrectRatio?: number;
  color?: string;
  selected?: boolean;
}

export interface PadInstancesProps {
  pads: readonly PadData[];
  defaultColor?: string;
  selectedColor?: string;
  /** When true, pads participate in depth testing/writing so 3D bodies above can occlude them. Default false matches 2D canvas overlay convention. */
  enableDepthTest?: boolean;
}

/** Build a THREE.Shape for a rectangle with rounded corners. */
function roundedRectShape(w: number, h: number, ratio: number): THREE.Shape {
  const r = Math.min(w, h) * 0.5 * Math.max(0, Math.min(ratio, 0.5));
  const hw = w / 2;
  const hh = h / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-hw + r, -hh);
  shape.lineTo(hw - r, -hh);
  if (r > 0) shape.quadraticCurveTo(hw, -hh, hw, -hh + r);
  shape.lineTo(hw, hh - r);
  if (r > 0) shape.quadraticCurveTo(hw, hh, hw - r, hh);
  shape.lineTo(-hw + r, hh);
  if (r > 0) shape.quadraticCurveTo(-hw, hh, -hw, hh - r);
  shape.lineTo(-hw, -hh + r);
  if (r > 0) shape.quadraticCurveTo(-hw, -hh, -hw + r, -hh);
  return shape;
}

export function PadInstances({
  pads,
  defaultColor = "#c9a227",
  selectedColor = "#38bdf8",
  enableDepthTest = false,
}: PadInstancesProps) {
  const invalidate = useThree((s) => s.invalidate);

  const circleGeom = useMemo(() => new THREE.CircleGeometry(0.5, 24), []);
  const rectGeom = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        depthTest: enableDepthTest,
        depthWrite: enableDepthTest,
        transparent: !enableDepthTest,
        side: THREE.DoubleSide,
      }),
    [enableDepthTest],
  );

  const defCol = useMemo(() => new THREE.Color(defaultColor), [defaultColor]);
  const selCol = useMemo(() => new THREE.Color(selectedColor), [selectedColor]);

  // Split pads into groups by rendering strategy
  const { circlePads, rectPads, roundrectPads } = useMemo(() => {
    const cp: PadData[] = [];
    const rp: PadData[] = [];
    const rrp: PadData[] = [];
    for (const p of pads) {
      if (p.shape === "circle" || p.shape === "oval") cp.push(p);
      else if (
        p.shape === "roundrect" &&
        p.roundrectRatio !== undefined &&
        p.roundrectRatio > 0
      )
        rrp.push(p);
      else rp.push(p);
    }
    return { circlePads: cp, rectPads: rp, roundrectPads: rrp };
  }, [pads]);

  // ── Circle + oval pads (instanced) ────────────────────────────────
  const circleMeshRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = circleMeshRef.current;
    if (!mesh || circlePads.length === 0) return;

    const matrix = new THREE.Matrix4();
    const rot = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const col = new THREE.Color();

    for (let i = 0; i < circlePads.length; i++) {
      const pad = circlePads[i];
      if (!pad) continue;
      pos.set(pad.x, pad.y, 0);
      rot.setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        (pad.rotation * Math.PI) / 180,
      );
      scale.set(pad.width, pad.height, 1);
      matrix.compose(pos, rot, scale);
      mesh.setMatrixAt(i, matrix);

      if (pad.selected) col.copy(selCol);
      else if (pad.color) col.set(pad.color);
      else col.copy(defCol);
      mesh.setColorAt(i, col);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.count = circlePads.length;
    invalidate();
  }, [circlePads, defCol, selCol, invalidate]);

  // ── Rect pads (instanced) ─────────────────────────────────────────
  const rectMeshRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = rectMeshRef.current;
    if (!mesh || rectPads.length === 0) return;

    const matrix = new THREE.Matrix4();
    const rot = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const col = new THREE.Color();

    for (let i = 0; i < rectPads.length; i++) {
      const pad = rectPads[i];
      if (!pad) continue;
      pos.set(pad.x, pad.y, 0);
      rot.setFromAxisAngle(
        new THREE.Vector3(0, 0, 1),
        (pad.rotation * Math.PI) / 180,
      );
      scale.set(pad.width, pad.height, 1);
      matrix.compose(pos, rot, scale);
      mesh.setMatrixAt(i, matrix);

      if (pad.selected) col.copy(selCol);
      else if (pad.color) col.set(pad.color);
      else col.copy(defCol);
      mesh.setColorAt(i, col);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.count = rectPads.length;
    invalidate();
  }, [rectPads, defCol, selCol, invalidate]);

  // ── Roundrect pads (individual meshes — unique geometry per ratio) ─
  const roundrectGeometries = useMemo(() => {
    return roundrectPads.map((pad) => {
      const shape = roundedRectShape(
        pad.width,
        pad.height,
        pad.roundrectRatio ?? 0.25,
      );
      return new THREE.ShapeGeometry(shape);
    });
  }, [roundrectPads]);

  return (
    <group>
      {circlePads.length > 0 && (
        <instancedMesh
          ref={circleMeshRef}
          args={[circleGeom, material, Math.max(circlePads.length, 1)]}
          renderOrder={RENDER_ORDER.PINS}
          frustumCulled={false}
        />
      )}
      {rectPads.length > 0 && (
        <instancedMesh
          ref={rectMeshRef}
          args={[rectGeom, material, Math.max(rectPads.length, 1)]}
          renderOrder={RENDER_ORDER.PINS}
          frustumCulled={false}
        />
      )}
      {roundrectPads.map((pad, i) => {
        const geom = roundrectGeometries[i];
        if (!geom) return null;
        const padColor = pad.selected
          ? selectedColor
          : (pad.color ?? defaultColor);
        return (
          <mesh
            key={pad.id}
            position={[pad.x, pad.y, 0]}
            rotation={[0, 0, (pad.rotation * Math.PI) / 180]}
            renderOrder={RENDER_ORDER.PINS}
            frustumCulled={false}
          >
            <primitive object={geom} attach="geometry" />
            <meshBasicMaterial
              color={padColor}
              depthTest={enableDepthTest}
              depthWrite={enableDepthTest}
              side={THREE.DoubleSide}
            />
          </mesh>
        );
      })}
    </group>
  );
}
