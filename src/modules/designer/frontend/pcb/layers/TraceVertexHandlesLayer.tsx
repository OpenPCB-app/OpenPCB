import { useMemo, type ReactElement } from "react";
import * as THREE from "three";
import type { PcbTrace } from "../../../../../sdks";
import { RENDER_ORDER } from "../../../../../shared/frontend/canvas/layers";
import { useCanvasTheme } from "../../../../../shared/frontend/canvas/theme";

const NM_TO_MM = 1 / 1_000_000;
/** Handle half-edge in mm (square edge = 2×). Constant in board space. */
const HANDLE_HALF_MM = 0.22;

/**
 * Square grips at each INTERIOR vertex (bend) of the single selected trace.
 * Endpoints (pads) are excluded — they aren't draggable. Purely visual;
 * hit-testing lives in PcbCanvas via `hitTraceVertex`. Must be rendered inside
 * the scene mirror group so coordinates need no pre-mirror.
 */
export function TraceVertexHandlesLayer({
  trace,
}: {
  trace: PcbTrace;
}): ReactElement | null {
  const { theme } = useCanvasTheme();
  const interior = useMemo(
    () =>
      trace.pointsNm.length > 2
        ? trace.pointsNm.slice(1, trace.pointsNm.length - 1)
        : [],
    [trace.pointsNm],
  );
  if (interior.length === 0) return null;
  return (
    <group>
      {interior.map((p, i) => (
        <mesh
          key={i}
          position={[p.x * NM_TO_MM, p.y * NM_TO_MM, 0]}
          renderOrder={RENDER_ORDER.SELECTION + 0.75}
        >
          <planeGeometry args={[HANDLE_HALF_MM * 2, HANDLE_HALF_MM * 2]} />
          <meshBasicMaterial
            color={theme.pcbCanvas.selectionOutline}
            depthTest={false}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}
