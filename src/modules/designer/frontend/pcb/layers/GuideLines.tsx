import { useEffect, useMemo, useRef, type ReactElement } from "react";
import * as THREE from "three";
import { GUIDE_OPACITY } from "../guides/guide-types";

/**
 * Batched thin dashed guide-line renderer shared by the placement-alignment
 * and routing guide layers. All segments live in ONE `lineSegments` with
 * per-vertex colors, so an arbitrary number of guides costs a single draw
 * call. Lines render at 1px (GL line width) → naturally screen-constant at
 * every zoom, like the dynamic ratsnest guide; dashing distinguishes them
 * from real copper. Geometry sits at z=0 with depthTest/Write disabled;
 * `renderOrder` controls layering (passed by the caller).
 */

export interface GuideSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Hex color string, e.g. "#8b5cf6". */
  color: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function GuideLineSegments({
  segments,
  renderOrder,
  dashSize = 0.5,
  gapSize = 0.35,
  opacity = GUIDE_OPACITY,
}: {
  segments: readonly GuideSegment[];
  renderOrder: number;
  dashSize?: number;
  gapSize?: number;
  opacity?: number;
}): ReactElement | null {
  const ref = useRef<THREE.LineSegments>(null);

  const geometry = useMemo(() => {
    const positions = new Float32Array(segments.length * 6);
    const colors = new Float32Array(segments.length * 6);
    segments.forEach((s, i) => {
      const o = i * 6;
      positions[o] = s.x1;
      positions[o + 1] = s.y1;
      positions[o + 2] = 0;
      positions[o + 3] = s.x2;
      positions[o + 4] = s.y2;
      positions[o + 5] = 0;
      const [r, g, b] = hexToRgb(s.color);
      colors[o] = r;
      colors[o + 1] = g;
      colors[o + 2] = b;
      colors[o + 3] = r;
      colors[o + 4] = g;
      colors[o + 5] = b;
    });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geom.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geom;
  }, [segments]);

  // Dashes require per-segment line distances; recompute whenever geometry
  // changes (each pointer move during a drag/route).
  useEffect(() => {
    ref.current?.computeLineDistances();
  }, [geometry]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  if (segments.length === 0) return null;

  return (
    <lineSegments
      ref={ref}
      geometry={geometry}
      renderOrder={renderOrder}
      frustumCulled={false}
    >
      <lineDashedMaterial
        vertexColors
        transparent
        opacity={opacity}
        depthTest={false}
        depthWrite={false}
        dashSize={dashSize}
        gapSize={gapSize}
      />
    </lineSegments>
  );
}
