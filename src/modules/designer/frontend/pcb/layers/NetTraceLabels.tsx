import { useThree } from "@react-three/fiber";
import { useMemo, type ReactElement } from "react";
import type { PcbCopperLayerId, PcbTrace } from "../../../../../sdks";
import { EDAText } from "../../../../../shared/frontend/canvas/primitives/EDAText";
import { RENDER_ORDER } from "../../../../../shared/frontend/canvas/layers";

const NM_TO_MM = 1 / 1_000_000;
/** Drop a label every ~2.5 mm of arc length along the routed polyline. */
const LABEL_INTERVAL_MM = 2.5;
/** Don't repeat a label within 1.5 mm of either endpoint (crowds the pad). */
const ENDPOINT_GUARD_MM = 1.5;
/** Zoom gate: skip rendering when fewer than this many screen px per mm. */
const MIN_PX_PER_MM = 10;
/** Max labels per trace (prevents runaway count on long power rails). */
const LABEL_CAP_PER_TRACE = 20;
/** Label font height in mm (~0.5 mm reads at typical zooms). */
const LABEL_FONT_MM = 0.5;

interface NetTraceLabelsProps {
  traces: ReadonlyArray<PcbTrace>;
  /** Net id → display name (PCB projection `netNames`). */
  netNames: Readonly<Record<string, string>>;
  layer: PcbCopperLayerId;
  inactive?: boolean;
  opacity?: number;
  /**
   * True when the camera is X-mirrored (active layer is B.Cu) AND this layer
   * matches the active layer. Each label is rendered with `scale-x={-1}` so
   * the camera flip cancels and glyphs read normally — without this, B.Cu
   * net labels appear mirror-reversed in bottom view.
   */
  counterMirror?: boolean;
}

/**
 * Renders net names along routed traces (Flux.ai parity). Walks each
 * polyline, drops a label every LABEL_INTERVAL_MM of arc length, oriented
 * along the segment tangent. Zoom-gated to avoid clutter at board overview.
 */
export function NetTraceLabels({
  traces,
  netNames,
  layer,
  inactive = false,
  opacity,
  counterMirror = false,
}: NetTraceLabelsProps): ReactElement | null {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  // World-mm per screen-px = (camera ortho width / canvas px width).
  // For a non-ortho camera this is approximate but adequate for label gating.
  const pxPerMm = useMemo(() => {
    if ("right" in camera && "left" in camera) {
      const width = camera as unknown as { right: number; left: number };
      const worldWidth = (width.right - width.left) / camera.zoom;
      if (worldWidth <= 0) return MIN_PX_PER_MM;
      return size.width / worldWidth;
    }
    return MIN_PX_PER_MM;
  }, [camera, size.width]);

  const labels = useMemo(() => {
    if (pxPerMm < MIN_PX_PER_MM) return [];
    type Label = {
      key: string;
      xMm: number;
      yMm: number;
      angle: number;
      text: string;
    };
    const out: Label[] = [];
    for (const trace of traces) {
      if (trace.layer !== layer) continue;
      if (!trace.netId) continue;
      const text = netNames[trace.netId];
      if (!text) continue;

      // Cumulative arc length walk through the polyline in mm.
      let arc = 0;
      let nextDrop = LABEL_INTERVAL_MM;
      let placed = 0;
      const totalLen = polylineLengthMm(trace.pointsNm);
      for (let i = 1; i < trace.pointsNm.length; i += 1) {
        const a = trace.pointsNm[i - 1]!;
        const b = trace.pointsNm[i]!;
        const dxMm = (b.x - a.x) * NM_TO_MM;
        const dyMm = (b.y - a.y) * NM_TO_MM;
        const segLen = Math.hypot(dxMm, dyMm);
        if (segLen === 0) continue;
        const angleRaw = Math.atan2(dyMm, dxMm);
        // Flip text past vertical so it never reads upside-down.
        const angle =
          angleRaw > Math.PI / 2 || angleRaw < -Math.PI / 2
            ? angleRaw + Math.PI
            : angleRaw;
        while (
          nextDrop <= arc + segLen &&
          placed < LABEL_CAP_PER_TRACE &&
          nextDrop >= ENDPOINT_GUARD_MM &&
          totalLen - nextDrop >= ENDPOINT_GUARD_MM
        ) {
          const t = (nextDrop - arc) / segLen;
          const xMm = a.x * NM_TO_MM + dxMm * t;
          const yMm = a.y * NM_TO_MM + dyMm * t;
          out.push({
            key: `${trace.id}-${placed}`,
            xMm,
            yMm,
            angle,
            text,
          });
          placed += 1;
          nextDrop += LABEL_INTERVAL_MM;
        }
        arc += segLen;
      }
    }
    return out;
  }, [traces, layer, netNames, pxPerMm]);

  if (labels.length === 0) return null;
  const labelOpacity = opacity ?? (inactive ? 0.22 : 1);
  const scaleX = counterMirror ? -1 : 1;

  return (
    <>
      {labels.map((l) => (
        <group key={l.key} position={[l.xMm, l.yMm, 0]} scale={[scaleX, 1, 1]}>
          <EDAText
            position={[0, 0, 0]}
            fontSize={LABEL_FONT_MM}
            color="#ffffff"
            anchorX="center"
            anchorY="middle"
            rotation={[0, 0, l.angle]}
            opacity={labelOpacity}
            renderOrder={RENDER_ORDER.LABELS}
            outlineWidth={LABEL_FONT_MM * 0.18}
            outlineColor="#000000"
          >
            {l.text}
          </EDAText>
        </group>
      ))}
    </>
  );
}

function polylineLengthMm(
  pointsNm: ReadonlyArray<{ x: number; y: number }>,
): number {
  let len = 0;
  for (let i = 1; i < pointsNm.length; i += 1) {
    const a = pointsNm[i - 1]!;
    const b = pointsNm[i]!;
    len += Math.hypot((b.x - a.x) * NM_TO_MM, (b.y - a.y) * NM_TO_MM);
  }
  return len;
}
