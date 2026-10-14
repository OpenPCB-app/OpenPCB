import { useFrame, useThree } from "@react-three/fiber";
import { type ReactElement, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { DRC_RING, DRC_SEVERITY, DRC_STROKE } from "../drc/drc-colors";

// Same ceiling as DrcMarkerLayer so markers are never hidden under copper.
const MARKER_ORDER = 1000;
const MARKER_PX = 12;

export interface LiveViolationMarker {
  id: string;
  x: number;
  y: number;
  severity: "error" | "warning" | "info";
}

/**
 * Transient markers for the live (route-session) DRC verdict. Constant screen
 * size via camera.zoom in useFrame, same as DrcMarkerLayer. Mounted only while
 * a route session is active (the caller passes an empty list otherwise).
 */
export function LiveRouteViolationLayer({
  markers,
}: {
  markers: readonly LiveViolationMarker[];
}): ReactElement | null {
  const invalidate = useThree((s) => s.invalidate);
  const diamond = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 1);
    shape.lineTo(1, 0);
    shape.lineTo(0, -1);
    shape.lineTo(-1, 0);
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, []);
  useEffect(() => () => diamond.dispose(), [diamond]);

  const groupRefs = useRef<Array<THREE.Group | null>>([]);
  useFrame(({ camera }) => {
    const zoom = (camera as THREE.OrthographicCamera).zoom || 1;
    const s = MARKER_PX / 2 / zoom;
    for (const g of groupRefs.current) g?.scale.setScalar(s);
  });
  useEffect(() => {
    invalidate();
  }, [markers, invalidate]);

  if (markers.length === 0) return null;
  return (
    <group renderOrder={MARKER_ORDER}>
      {markers.map((m, i) => (
        <group
          key={m.id}
          position={[m.x, m.y, 0]}
          ref={(el) => {
            groupRefs.current[i] = el;
          }}
        >
          <MarkerPart geometry={diamond} order={MARKER_ORDER - 0.02} scale={1.6} color={DRC_STROKE} />
          <MarkerPart geometry={diamond} order={MARKER_ORDER - 0.01} scale={1.3} color={DRC_RING} />
          <MarkerPart geometry={diamond} order={MARKER_ORDER} scale={1} color={DRC_SEVERITY[m.severity].core} />
        </group>
      ))}
    </group>
  );
}

function MarkerPart({
  geometry,
  order,
  scale,
  color,
}: {
  geometry: THREE.BufferGeometry;
  order: number;
  scale: number;
  color: string;
}): ReactElement {
  return (
    <mesh geometry={geometry} renderOrder={order} scale={scale}>
      <meshBasicMaterial
        color={color}
        toneMapped={false}
        depthTest={false}
        depthWrite={false}
        transparent
      />
    </mesh>
  );
}
