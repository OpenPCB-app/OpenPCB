import { useMemo, type ReactElement } from "react";
import * as THREE from "three";
import type { PreviewGraphic } from "../../../../../shared/rendering/types";
import { RENDER_ORDER } from "../../../../../shared/frontend/canvas/layers";

const PREVIEW_COLOR = "#60a5fa"; // blue-400

/** Filled THREE.Shape for a solid rect/circle preview (pad / filled copper). */
function buildFillShape(graphic: PreviewGraphic): THREE.Shape | null {
  if (graphic.kind === "rect" && graphic.fill === "solid") {
    const { x, y, width, height } = graphic;
    if (width <= 0 || height <= 0) return null;
    const shape = new THREE.Shape();
    shape.moveTo(x, y);
    shape.lineTo(x + width, y);
    shape.lineTo(x + width, y + height);
    shape.lineTo(x, y + height);
    shape.closePath();
    return shape;
  }
  if (graphic.kind === "circle" && graphic.fill === "solid") {
    if (graphic.radiusMm <= 0) return null;
    const shape = new THREE.Shape();
    shape.absarc(graphic.center.x, graphic.center.y, graphic.radiusMm, 0, Math.PI * 2, false);
    return shape;
  }
  return null;
}

export function FootprintPreviewOverlay({
  graphic,
}: {
  graphic: PreviewGraphic;
}): ReactElement | null {
  const fillShape = useMemo(() => buildFillShape(graphic), [graphic]);

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

  if (!positions && !fillShape) return null;

  return (
    <>
      {fillShape && (
        <mesh renderOrder={RENDER_ORDER.PREVIEW - 0.1} frustumCulled={false}>
          <shapeGeometry args={[fillShape]} />
          <meshBasicMaterial
            color={PREVIEW_COLOR}
            depthTest={false}
            depthWrite={false}
            transparent
            opacity={0.3}
          />
        </mesh>
      )}
      {positions && (
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
      )}
    </>
  );
}
