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
  /** Index of the first segment that belongs to the pending tail. */
  pendingTailFromIndex?: number;
  /** Indices of segments that violate DRC (rendered with a red halo). */
  violationSegmentIndexes?: ReadonlyArray<number>;
  /** Pre-mirror X coordinates (use when parent group has no negative scale). */
  mirror?: boolean;
}

/**
 * Renders the in-progress route during a routing session at true world-width
 * using LineSegments2 + LineMaterial:
 *  - committed segments at full opacity
 *  - pending tail as a white cursor guide (Flux-style, not yet committed)
 *  - DRC-violating segments overlaid in red
 */
export function TracePreviewLayer({
  pointsNm,
  layer,
  widthMm,
  pendingTailFromIndex,
  violationSegmentIndexes,
  mirror = false,
}: TracePreviewLayerProps): ReactElement | null {
  const baseColor = PCB_TRACE_COLORS[layer];
  const xScale = mirror ? -1 : 1;
  const split = useMemo(() => {
    if (pointsNm.length < 2)
      return { committed: null, pending: null, violation: null };
    const splitIdx = Math.min(
      Math.max(pendingTailFromIndex ?? pointsNm.length - 1, 0),
      pointsNm.length - 1,
    );
    const committed: number[] = [];
    const pending: number[] = [];
    const violation: number[] = [];
    const violSet = new Set(violationSegmentIndexes ?? []);
    for (let i = 1; i < pointsNm.length; i += 1) {
      const a = pointsNm[i - 1]!;
      const b = pointsNm[i]!;
      const target = i - 1 < splitIdx ? committed : pending;
      target.push(a.x * NM_TO_MM * xScale, a.y * NM_TO_MM, 0);
      target.push(b.x * NM_TO_MM * xScale, b.y * NM_TO_MM, 0);
      if (violSet.has(i - 1)) {
        violation.push(a.x * NM_TO_MM * xScale, a.y * NM_TO_MM, 0);
        violation.push(b.x * NM_TO_MM * xScale, b.y * NM_TO_MM, 0);
      }
    }
    return {
      committed: committed.length > 0 ? new Float32Array(committed) : null,
      pending: pending.length > 0 ? new Float32Array(pending) : null,
      violation: violation.length > 0 ? new Float32Array(violation) : null,
    };
  }, [pointsNm, pendingTailFromIndex, violationSegmentIndexes, xScale]);

  return (
    <>
      <PreviewSegmentGroup
        positions={split.committed}
        widthMm={widthMm}
        color={baseColor}
        opacity={1}
      />
      <PreviewSegmentGroup
        positions={split.pending}
        widthMm={Math.max(widthMm * 0.55, 0.08)}
        color="#ffffff"
        opacity={0.95}
      />
      {/* DRC violation halo: slightly larger width to "bleed" around the offending segment. */}
      <PreviewSegmentGroup
        positions={split.violation}
        widthMm={widthMm * 1.4 + 0.05}
        color="#ef4444"
        opacity={0.55}
      />
    </>
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
