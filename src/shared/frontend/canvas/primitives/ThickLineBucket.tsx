import { useEffect, useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { ReactElement } from "react";

export interface ThickLineBucketProps {
  /** Flat array of vertex positions: [x1, y1, z1, x2, y2, z2, ...]. Two
   *  consecutive vertices form one segment. */
  positions: Float32Array | number[];
  /** Stroke width in world units (mm). Rendered at exactly this size at any zoom. */
  widthMm: number;
  color: string;
  /** Three.js render order. */
  renderOrder?: number;
  /** Optional opacity (for ghost previews). */
  opacity?: number;
}

/**
 * Renders a uniform-width batch of line segments using LineSegments2 +
 * LineMaterial in worldUnits mode. Unlike `<lineBasicMaterial linewidth>`,
 * this actually thickens lines on screen — WebGL caps native line width at
 * 1 px on most platforms, so worldUnits mode is the only reliable path.
 *
 * Group your segments by stroke width (LineMaterial requires uniform width
 * per material) and render one bucket per width.
 */
export function ThickLineBucket({
  positions,
  widthMm,
  color,
  renderOrder,
  opacity = 1,
}: ThickLineBucketProps): ReactElement | null {
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);

  const positionsArray = useMemo(
    () =>
      positions instanceof Float32Array
        ? positions
        : new Float32Array(positions),
    [positions],
  );

  const { object, dispose } = useMemo(() => {
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positionsArray);
    const material = new LineMaterial({
      color,
      linewidth: widthMm,
      worldUnits: true,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity,
    });
    material.resolution.set(size.width * dpr, size.height * dpr);
    const lines = new LineSegments2(geometry, material);
    lines.computeLineDistances();
    if (renderOrder !== undefined) lines.renderOrder = renderOrder;
    return {
      object: lines,
      dispose: () => {
        geometry.dispose();
        material.dispose();
      },
    };
    // resolution is updated below; intentionally not in deps to avoid
    // rebuilding the geometry on every resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionsArray, widthMm, color, renderOrder, opacity]);

  // Keep the resolution uniform in sync with the live canvas size.
  if (object.material instanceof LineMaterial) {
    object.material.resolution.set(size.width * dpr, size.height * dpr);
  }

  useEffect(() => () => dispose(), [dispose]);

  if (positionsArray.length === 0) return null;
  return <primitive object={object} />;
}
