import { useMemo, type ReactElement } from "react";
import * as THREE from "three";
import type { PreviewGraphic } from "../../../../../shared/rendering/types";
import { RENDER_ORDER } from "../../../../../shared/frontend/canvas/layers";

const PREVIEW_COLOR = "#60a5fa"; // blue-400

/**
 * Renders a single PreviewGraphic as a rubber-band preview overlay.
 * Used during active drawing tool interactions.
 */
export function PreviewGraphicOverlay({
  graphic,
}: {
  graphic: PreviewGraphic;
}): ReactElement | null {
  const positions = useMemo(() => {
    const segments: number[] = [];

    if (graphic.kind === "line") {
      segments.push(graphic.a.x, graphic.a.y, 0, graphic.b.x, graphic.b.y, 0);
    } else if (graphic.kind === "rect") {
      const { x, y, width, height } = graphic;
      const x2 = x + width;
      const y2 = y + height;
      segments.push(
        x,
        y,
        0,
        x2,
        y,
        0,
        x2,
        y,
        0,
        x2,
        y2,
        0,
        x2,
        y2,
        0,
        x,
        y2,
        0,
        x,
        y2,
        0,
        x,
        y,
        0,
      );
    } else if (graphic.kind === "circle") {
      const segs = 32;
      for (let i = 0; i < segs; i++) {
        const a1 = (i / segs) * Math.PI * 2;
        const a2 = ((i + 1) / segs) * Math.PI * 2;
        segments.push(
          graphic.center.x + Math.cos(a1) * graphic.radiusMm,
          graphic.center.y + Math.sin(a1) * graphic.radiusMm,
          0,
          graphic.center.x + Math.cos(a2) * graphic.radiusMm,
          graphic.center.y + Math.sin(a2) * graphic.radiusMm,
          0,
        );
      }
    } else if (graphic.kind === "arc3") {
      // Approximate arc with line segments
      segments.push(
        graphic.start.x,
        graphic.start.y,
        0,
        graphic.mid.x,
        graphic.mid.y,
        0,
        graphic.mid.x,
        graphic.mid.y,
        0,
        graphic.end.x,
        graphic.end.y,
        0,
      );
    }

    if (segments.length === 0) return null;
    return new Float32Array(segments);
  }, [graphic]);

  if (!positions) return null;

  return (
    <lineSegments renderOrder={RENDER_ORDER.PREVIEW} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial
        color={PREVIEW_COLOR}
        depthTest={false}
        depthWrite={false}
        transparent
        opacity={0.8}
      />
    </lineSegments>
  );
}
