import { useMemo, type ReactElement } from "react";
import type { DesignerCommentThread } from "../../../../sdks";
import { EDAText } from "../../../../shared/frontend/canvas/primitives/EDAText";
import { RENDER_ORDER } from "../../../../shared/frontend/canvas/layers";

interface CanvasCommentMarkersProps {
  threads: readonly DesignerCommentThread[];
  activeThreadId: string | null;
  mirrorX?: boolean;
}

function colorFor(thread: DesignerCommentThread, active: boolean): string {
  if (active) return "#facc15";
  if (thread.status === "resolved") return "#64748b";
  if (thread.todoStatus === "done") return "#22c55e";
  if (thread.todoStatus !== "none") return "#fb923c";
  return "#8b5cf6";
}

export function CanvasCommentMarkers({
  threads,
  activeThreadId,
  mirrorX = false,
}: CanvasCommentMarkersProps): ReactElement | null {
  const anchored = useMemo(
    () => threads.filter((thread) => thread.anchor?.pointNm && !thread.deletedAt),
    [threads],
  );
  if (anchored.length === 0) return null;
  return (
    <>
      {anchored.map((thread, index) => {
        const point = thread.anchor!.pointNm;
        const active = thread.id === activeThreadId;
        const x = point.x / 1_000_000;
        const y = point.y / 1_000_000;
        const label = String(index + 1);
        return (
          <group
            key={thread.id}
            position={[mirrorX ? -x : x, y, 0]}
            renderOrder={RENDER_ORDER.PREVIEW + 1}
          >
            <mesh renderOrder={RENDER_ORDER.PREVIEW + 1}>
              <circleGeometry args={[active ? 0.42 : 0.34, 32]} />
              <meshBasicMaterial
                color={colorFor(thread, active)}
                depthTest={false}
                depthWrite={false}
                transparent
                opacity={thread.status === "resolved" ? 0.65 : 0.95}
              />
            </mesh>
            <EDAText
              position={[0, 0, 0]}
              color="#ffffff"
              fontSize={0.28}
              anchorX="center"
              anchorY="middle"
            >
              {label}
            </EDAText>
          </group>
        );
      })}
    </>
  );
}

export function hitCommentThread(
  threads: readonly DesignerCommentThread[],
  pointNm: { x: number; y: number },
  radiusNm = 600_000,
): DesignerCommentThread | null {
  let best: { thread: DesignerCommentThread; distanceSq: number } | null = null;
  for (const thread of threads) {
    const anchor = thread.anchor;
    if (!anchor || thread.deletedAt) continue;
    const dx = pointNm.x - anchor.pointNm.x;
    const dy = pointNm.y - anchor.pointNm.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq <= radiusNm * radiusNm && (!best || distanceSq < best.distanceSq)) {
      best = { thread, distanceSq };
    }
  }
  return best?.thread ?? null;
}
