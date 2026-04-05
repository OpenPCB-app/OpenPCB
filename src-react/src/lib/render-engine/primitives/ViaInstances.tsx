/**
 * ViaInstances — Renders PCB vias as InstancedMesh with concentric rings.
 *
 * Each via is two circles: outer pad ring + inner drill hole.
 */

import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RENDER_ORDER } from "../layers";

interface ViaData {
  id: string;
  x: number;
  y: number;
  padDiameter: number;
  drillDiameter: number;
  selected?: boolean;
}

interface ViaInstancesProps {
  vias: readonly ViaData[];
  padColor?: string;
  drillColor?: string;
  selectedColor?: string;
}

export function ViaInstances({
  vias,
  padColor = "#c9a227",
  drillColor = "#0f172a",
  selectedColor = "#38bdf8",
}: ViaInstancesProps) {
  const outerRef = useRef<THREE.InstancedMesh>(null);
  const innerRef = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);

  const circleGeom = useMemo(() => new THREE.CircleGeometry(0.5, 16), []);
  const outerMat = useMemo(
    () => new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false }),
    [],
  );
  const innerMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: drillColor,
        depthTest: false,
        depthWrite: false,
      }),
    [drillColor],
  );

  const defCol = useMemo(() => new THREE.Color(padColor), [padColor]);
  const selCol = useMemo(() => new THREE.Color(selectedColor), [selectedColor]);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner || vias.length === 0) return;

    const matrix = new THREE.Matrix4();

    for (let i = 0; i < vias.length; i++) {
      const via = vias[i];
      if (!via) continue;
      // Outer ring
      matrix.makeTranslation(via.x, via.y, 0);
      matrix.scale(new THREE.Vector3(via.padDiameter, via.padDiameter, 1));
      outer.setMatrixAt(i, matrix);
      outer.setColorAt(i, via.selected ? selCol : defCol);

      // Inner drill
      matrix.makeTranslation(via.x, via.y, 0);
      matrix.scale(new THREE.Vector3(via.drillDiameter, via.drillDiameter, 1));
      inner.setMatrixAt(i, matrix);
    }

    outer.instanceMatrix.needsUpdate = true;
    inner.instanceMatrix.needsUpdate = true;
    if (outer.instanceColor) outer.instanceColor.needsUpdate = true;
    outer.count = vias.length;
    inner.count = vias.length;
    invalidate();
  }, [vias, defCol, selCol, invalidate]);

  if (vias.length === 0) return null;

  const count = Math.max(vias.length, 1);
  return (
    <group>
      <instancedMesh
        ref={outerRef}
        args={[circleGeom, outerMat, count]}
        renderOrder={RENDER_ORDER.PINS}
        frustumCulled={false}
      />
      <instancedMesh
        ref={innerRef}
        args={[circleGeom, innerMat, count]}
        renderOrder={RENDER_ORDER.PINS + 0.1}
        frustumCulled={false}
      />
    </group>
  );
}
