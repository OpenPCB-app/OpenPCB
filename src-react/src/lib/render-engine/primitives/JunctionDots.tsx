/**
 * JunctionDots — Renders wire junction dots as InstancedMesh.
 *
 * Junctions appear where 3+ wires meet at the same point.
 * Rendered as small filled circles.
 */

import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RENDER_ORDER } from "../layers";

interface JunctionData {
  x: number;
  y: number;
}

interface JunctionDotsProps {
  junctions: readonly JunctionData[];
  /** Radius in nanometers */
  radius?: number;
  color?: string;
}

export function JunctionDots({
  junctions,
  radius = 100_000,
  color = "#f8fafc",
}: JunctionDotsProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);

  const geometry = useMemo(() => new THREE.CircleGeometry(1, 12), []);
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color,
        depthTest: false,
        depthWrite: false,
      }),
    [color],
  );

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || junctions.length === 0) return;

    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3(radius, radius, 1);

    for (let i = 0; i < junctions.length; i++) {
      const j = junctions[i];
      if (!j) continue;
      matrix.makeTranslation(j.x, j.y, 0);
      matrix.scale(scale);
      mesh.setMatrixAt(i, matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.count = junctions.length;
    invalidate();
  }, [junctions, radius, invalidate]);

  if (junctions.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, Math.max(junctions.length, 1)]}
      renderOrder={RENDER_ORDER.JUNCTIONS}
      frustumCulled={false}
    />
  );
}
