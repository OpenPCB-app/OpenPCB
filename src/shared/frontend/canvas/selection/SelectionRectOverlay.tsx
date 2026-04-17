import { useMemo, type ReactElement } from "react";
import { RENDER_ORDER } from "../layers";
import type { PointMm } from "../../../../shared/rendering/types";

const DEFAULT_COLOR = "#60a5fa"; // blue-400

/**
 * Rubber-band rectangle overlay for rect-select interactions.
 * Renders a dashed outline between two mm-space points. Null/collapsed
 * rectangles render nothing.
 */
export function SelectionRectOverlay({
  a,
  b,
  color = DEFAULT_COLOR,
}: {
  a: PointMm | null;
  b: PointMm | null;
  color?: string;
}): ReactElement | null {
  const positions = useMemo(() => {
    if (!a || !b) return null;
    const x1 = Math.min(a.x, b.x);
    const y1 = Math.min(a.y, b.y);
    const x2 = Math.max(a.x, b.x);
    const y2 = Math.max(a.y, b.y);
    if (x2 === x1 || y2 === y1) return null;
    return new Float32Array([
      x1,
      y1,
      0,
      x2,
      y1,
      0,
      x2,
      y1,
      0,
      x2,
      y2,
      0,
      x2,
      y2,
      0,
      x1,
      y2,
      0,
      x1,
      y2,
      0,
      x1,
      y1,
      0,
    ]);
  }, [a, b]);

  if (!positions) return null;

  return (
    <lineSegments renderOrder={RENDER_ORDER.SELECTION} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial
        color={color}
        depthTest={false}
        depthWrite={false}
        transparent
        opacity={0.8}
      />
    </lineSegments>
  );
}
