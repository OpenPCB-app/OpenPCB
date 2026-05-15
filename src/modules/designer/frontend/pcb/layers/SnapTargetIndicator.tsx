import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import type { PcbPointMm } from "../../../../../sdks";
import { RENDER_ORDER } from "../../../../../shared/frontend/canvas/layers";
import type { SnapKind } from "../snap";

/**
 * Visual highlight at the active snap target. Drawn as a ring + crosshair
 * at world (mm) coordinates so it tracks geometry, not screen position.
 * Color encodes the source kind so the user can tell at a glance whether
 * they're snapping to a pad center vs a trace endpoint vs a via.
 *
 * Renders above the selection slot so it's never occluded by trace/pad
 * paint passes. Hidden when there's no active target.
 */
const COLORS: Record<SnapKind, string> = {
  "pad-center": "#fde047",
  "trace-endpoint": "#34d058",
  "trace-segment-end": "#22d3ee",
  "via-center": "#a78bfa",
};

const RING_RADIUS_MM = 0.4;
const RING_THICKNESS_MM = 0.025;
const CROSSHAIR_HALF = 0.15;
const CROSSHAIR_THICKNESS_MM = 0.025;

export function SnapTargetIndicator({
  pointMm,
  kind,
}: {
  pointMm: PcbPointMm;
  kind: SnapKind;
}): ReactElement {
  const ringGeometry = useMemo(
    () =>
      new THREE.RingGeometry(
        RING_RADIUS_MM - RING_THICKNESS_MM,
        RING_RADIUS_MM,
        48,
      ),
    [],
  );

  const crosshairGeometry = useMemo(() => {
    const t = CROSSHAIR_THICKNESS_MM / 2;
    const h = CROSSHAIR_HALF;
    const verts = new Float32Array([
      -h,
      -t,
      0,
      h,
      -t,
      0,
      h,
      t,
      0,
      -h,
      -t,
      0,
      h,
      t,
      0,
      -h,
      t,
      0,
      -t,
      -h,
      0,
      t,
      -h,
      0,
      t,
      h,
      0,
      -t,
      -h,
      0,
      t,
      h,
      0,
      -t,
      h,
      0,
    ]);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    return geom;
  }, []);

  useEffect(
    () => () => {
      ringGeometry.dispose();
      crosshairGeometry.dispose();
    },
    [ringGeometry, crosshairGeometry],
  );

  const color = COLORS[kind];

  return (
    <group position={[pointMm.x, pointMm.y, 0]}>
      <mesh geometry={ringGeometry} renderOrder={RENDER_ORDER.SELECTION + 0.5}>
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.35}
          depthTest={false}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh
        geometry={crosshairGeometry}
        renderOrder={RENDER_ORDER.SELECTION + 0.5}
      >
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.2}
          depthTest={false}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
