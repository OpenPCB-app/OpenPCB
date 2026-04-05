/**
 * RatsnestLines — Renders unrouted connections as dashed lines.
 *
 * Shows which pads still need traces routed between them.
 */

import { useMemo } from "react";
import { RENDER_ORDER } from "../layers";

interface RatsnestLineData {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

interface RatsnestLinesProps {
  lines: readonly RatsnestLineData[];
  color?: string;
  opacity?: number;
}

export function RatsnestLines({
  lines,
  color = "#64748b",
  opacity = 0.5,
}: RatsnestLinesProps) {
  const positions = useMemo(() => {
    const verts = new Float32Array(lines.length * 6);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l) continue;
      const j = i * 6;
      verts[j] = l.startX;
      verts[j + 1] = l.startY;
      verts[j + 2] = 0;
      verts[j + 3] = l.endX;
      verts[j + 4] = l.endY;
      verts[j + 5] = 0;
    }
    return verts;
  }, [lines]);

  if (lines.length === 0) return null;

  return (
    <lineSegments renderOrder={RENDER_ORDER.RATSNEST} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineDashedMaterial
        color={color}
        dashSize={200_000}
        gapSize={150_000}
        transparent
        opacity={opacity}
        depthTest={false}
        depthWrite={false}
      />
    </lineSegments>
  );
}
