import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import type { PcbPointMm } from "../../../../../sdks";
import { EDAText } from "../../../../../shared/frontend/canvas/primitives/EDAText";
import { RENDER_ORDER } from "../../../../../shared/frontend/canvas/layers";
import { formatMeasureLabel } from "../tools/measure-tool-state";

interface MeasureOverlayLayerProps {
  start: PcbPointMm;
  end: PcbPointMm;
  showDeltas: boolean;
  counterMirror?: boolean;
}

const COLOR = "#38bdf8";
const MARKER_RADIUS_MM = 0.25;
const MARKER_THICKNESS_MM = 0.035;

export function MeasureOverlayLayer({
  start,
  end,
  showDeltas,
  counterMirror = false,
}: MeasureOverlayLayerProps): ReactElement {
  const lineGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(
        new Float32Array([start.x, start.y, 0, end.x, end.y, 0]),
        3,
      ),
    );
    return geometry;
  }, [end.x, end.y, start.x, start.y]);

  const markerGeometry = useMemo(
    () =>
      new THREE.RingGeometry(
        MARKER_RADIUS_MM - MARKER_THICKNESS_MM,
        MARKER_RADIUS_MM,
        36,
      ),
    [],
  );

  const lineMaterial = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: COLOR,
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      }),
    [],
  );

  const line = useMemo(() => {
    const built = new THREE.Line(lineGeometry, lineMaterial);
    built.renderOrder = RENDER_ORDER.SELECTION + 1;
    built.frustumCulled = false;
    return built;
  }, [lineGeometry, lineMaterial]);

  useEffect(
    () => () => {
      lineGeometry.dispose();
      markerGeometry.dispose();
      lineMaterial.dispose();
    },
    [lineGeometry, lineMaterial, markerGeometry],
  );

  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const label = formatMeasureLabel(start, end, showDeltas);

  return (
    <group renderOrder={RENDER_ORDER.SELECTION + 1}>
      <primitive object={line} />
      {[start, end].map((point, index) => (
        <mesh
          key={index}
          geometry={markerGeometry}
          position={[point.x, point.y, 0]}
          renderOrder={RENDER_ORDER.SELECTION + 1}
        >
          <meshBasicMaterial
            color={COLOR}
            transparent
            opacity={0.9}
            depthTest={false}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      <group position={[mid.x, mid.y + 0.8, 0]} scale={[counterMirror ? -1 : 1, 1, 1]}>
        <EDAText
          position={[0, 0, 0]}
          fontSize={0.9}
          color={COLOR}
          anchorX="center"
          anchorY="middle"
        >
          {label}
        </EDAText>
      </group>
    </group>
  );
}
