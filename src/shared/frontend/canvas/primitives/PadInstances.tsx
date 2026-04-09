import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RENDER_ORDER } from "../layers";

interface PadData {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  shape: "circle" | "rect" | "oval" | "roundrect";
  color?: string;
  selected?: boolean;
}

interface PadInstancesProps {
  pads: readonly PadData[];
  defaultColor?: string;
  selectedColor?: string;
}

export function PadInstances({
  pads,
  defaultColor = "#c9a227",
  selectedColor = "#38bdf8",
}: PadInstancesProps) {
  const invalidate = useThree((s) => s.invalidate);

  const circleGeom = useMemo(() => new THREE.CircleGeometry(0.5, 16), []);
  const rectGeom = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    [],
  );

  const defCol = useMemo(() => new THREE.Color(defaultColor), [defaultColor]);
  const selCol = useMemo(() => new THREE.Color(selectedColor), [selectedColor]);

  const { circlePads, rectPads } = useMemo(() => {
    const cp: PadData[] = [];
    const rp: PadData[] = [];
    for (const p of pads) {
      if (p.shape === "circle" || p.shape === "oval") cp.push(p);
      else rp.push(p);
    }
    return { circlePads: cp, rectPads: rp };
  }, [pads]);

  const circleMeshRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = circleMeshRef.current;
    if (!mesh || circlePads.length === 0) return;

    const matrix = new THREE.Matrix4();
    const rot = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();

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
      mesh.setColorAt(i, pad.selected ? selCol : defCol);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.count = circlePads.length;
    invalidate();
  }, [circlePads, defCol, selCol, invalidate]);

  const rectMeshRef = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = rectMeshRef.current;
    if (!mesh || rectPads.length === 0) return;

    const matrix = new THREE.Matrix4();
    const rot = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();

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
      mesh.setColorAt(i, pad.selected ? selCol : defCol);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.count = rectPads.length;
    invalidate();
  }, [rectPads, defCol, selCol, invalidate]);

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
    </group>
  );
}
