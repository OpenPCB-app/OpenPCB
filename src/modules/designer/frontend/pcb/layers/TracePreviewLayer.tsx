import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { PcbCopperLayerId } from "../../../../../sdks";
import {
  PCB_TRACE_COLORS,
  RENDER_ORDER,
} from "../../../../../shared/frontend/canvas/layers";

const NM_TO_MM = 1 / 1_000_000;

interface TracePreviewLayerProps {
  pointsNm: Array<{ x: number; y: number }>;
  layer: PcbCopperLayerId;
  /** Width of the in-flight trace (mm). Renders at true world-width. */
  widthMm: number;
  /** Pre-mirror X coordinates (use when parent group has no negative scale). */
  mirror?: boolean;
}

/**
 * Renders the in-progress route during a routing session identically to a
 * committed trace: full trace color, true world-width, no pending-tail tint
 * and no DRC overlay — the editor surfaces violation count via the toolbar.
 */
export function TracePreviewLayer({
  pointsNm,
  layer,
  widthMm,
  mirror = false,
}: TracePreviewLayerProps): ReactElement | null {
  const baseColor = PCB_TRACE_COLORS[layer];
  const xScale = mirror ? -1 : 1;
  const positions = useMemo(() => {
    if (pointsNm.length < 2) return null;
    const out: number[] = [];
    for (let i = 1; i < pointsNm.length; i += 1) {
      const a = pointsNm[i - 1]!;
      const b = pointsNm[i]!;
      out.push(a.x * NM_TO_MM * xScale, a.y * NM_TO_MM, 0);
      out.push(b.x * NM_TO_MM * xScale, b.y * NM_TO_MM, 0);
    }
    return out.length > 0 ? new Float32Array(out) : null;
  }, [pointsNm, xScale]);

  return (
    <PreviewSegmentGroup
      positions={positions}
      widthMm={widthMm}
      color={baseColor}
      opacity={1}
    />
  );
}

function PreviewSegmentGroup({
  positions,
  widthMm,
  color,
  opacity,
}: {
  positions: Float32Array | null;
  widthMm: number;
  color: string;
  opacity: number;
}): ReactElement | null {
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);

  const geometry = useMemo(() => {
    if (!positions) return null;
    const geom = new LineSegmentsGeometry();
    geom.setPositions(positions);
    return geom;
  }, [positions]);

  const material = useMemo(() => {
    const mat = new LineMaterial({
      color: new THREE.Color(color).getHex(),
      linewidth: widthMm,
      worldUnits: true,
      transparent: opacity < 1,
      opacity,
      depthTest: false,
      depthWrite: false,
    });
    return mat;
  }, [color, widthMm, opacity]);

  material.resolution.set(size.width * dpr, size.height * dpr);

  const line = useMemo(() => {
    if (!geometry) return null;
    const built = new LineSegments2(geometry, material);
    built.computeLineDistances();
    built.renderOrder = RENDER_ORDER.PREVIEW;
    built.frustumCulled = false;
    return built;
  }, [geometry, material]);

  useEffect(
    () => () => {
      geometry?.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  if (!line) return null;
  return <primitive object={line} />;
}
