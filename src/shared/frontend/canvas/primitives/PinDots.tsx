import { useEffect, useMemo, useRef } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import { RENDER_ORDER } from "../layers";

interface PinData {
  id: string;
  x: number;
  y: number;
  connected?: boolean;
}

interface PinDotsProps {
  pins: readonly PinData[];
  radius?: number;
  defaultColor?: string;
  connectedColor?: string;
}

const CIRCLE_SEGMENTS = 12;

export function PinDots({
  pins,
  radius = 80_000,
  defaultColor = "#38bdf8",
  connectedColor = "#22c55e",
}: PinDotsProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);

  const geometry = useMemo(
    () => new THREE.CircleGeometry(1, CIRCLE_SEGMENTS),
    [],
  );
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );

  const defaultCol = useMemo(() => new THREE.Color(defaultColor), [defaultColor]);
  const connectedCol = useMemo(
    () => new THREE.Color(connectedColor),
    [connectedColor],
  );

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || pins.length === 0) return;

    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3(radius, radius, 1);

    for (let i = 0; i < pins.length; i++) {
      const pin = pins[i];
      if (!pin) continue;

      matrix.makeTranslation(pin.x, pin.y, 0);
      matrix.scale(scale);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, pin.connected ? connectedCol : defaultCol);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.count = pins.length;
    invalidate();
  }, [pins, radius, defaultCol, connectedCol, invalidate]);

  if (pins.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, Math.max(pins.length, 1)]}
      renderOrder={RENDER_ORDER.PINS}
      frustumCulled={false}
    />
  );
}
