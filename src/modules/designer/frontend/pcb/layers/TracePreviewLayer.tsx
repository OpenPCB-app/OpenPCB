import { useThree } from "@react-three/fiber";
import { copperLayerColor } from "../pcb-layer-colors";
import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import type { PcbCopperLayerId } from "../../../../../sdks";
import {
  RENDER_ORDER,
} from "../../../../../shared/frontend/canvas/layers";

const NM_TO_MM = 1 / 1_000_000;

interface TracePreviewLayerProps {
  /** Single polyline. Mutually exclusive with `polylinesNm`. */
  pointsNm?: Array<{ x: number; y: number }>;
  /**
   * Many polylines batched into ONE LineSegments2 (bundle lanes) — one
   * allocation per update instead of one per lane.
   */
  polylinesNm?: ReadonlyArray<ReadonlyArray<{ x: number; y: number }>>;
  layer: PcbCopperLayerId;
  /** Width of the in-flight trace (mm). Renders at true world-width. */
  widthMm: number;
  /** Pre-mirror X coordinates (use when parent group has no negative scale). */
  mirror?: boolean;
  /** Dim for not-yet-accepted proposals (auto-finish). Default 1 = committed look. */
  opacity?: number;
  /** Tint override (degraded bundle lanes); default = the layer's copper color. */
  colorOverride?: string;
}

/**
 * Renders the in-progress route during a routing session identically to a
 * committed trace: full trace color, true world-width. When the caller marks
 * the route illegal it passes `colorOverride` (DRC hue) + reduced `opacity`.
 */
export function TracePreviewLayer({
  pointsNm,
  polylinesNm,
  layer,
  widthMm,
  mirror = false,
  opacity = 1,
  colorOverride,
}: TracePreviewLayerProps): ReactElement | null {
  const baseColor = colorOverride ?? copperLayerColor(layer);
  const xScale = mirror ? -1 : 1;
  const positions = useMemo(() => {
    const polylines = polylinesNm ?? (pointsNm ? [pointsNm] : []);
    const out: number[] = [];
    for (const line of polylines) {
      for (let i = 1; i < line.length; i += 1) {
        const a = line[i - 1]!;
        const b = line[i]!;
        out.push(a.x * NM_TO_MM * xScale, a.y * NM_TO_MM, 0);
        out.push(b.x * NM_TO_MM * xScale, b.y * NM_TO_MM, 0);
      }
    }
    return out.length > 0 ? new Float32Array(out) : null;
  }, [pointsNm, polylinesNm, xScale]);

  return (
    <PreviewSegmentGroup
      positions={positions}
      widthMm={widthMm}
      color={baseColor}
      opacity={opacity}
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
      // Always transparent so the preview sorts with the rest of the copper by
      // renderOrder. An opaque preview renders in three's earlier opaque pass,
      // after which every transparent copper mesh (pour/traces/mask) would
      // paint over it regardless of its higher renderOrder.
      transparent: true,
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
