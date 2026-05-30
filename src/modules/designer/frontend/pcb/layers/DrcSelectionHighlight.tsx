import { useThree } from "@react-three/fiber";
import { type ReactElement, useEffect, useMemo } from "react";
import * as THREE from "three";
import type { PcbTrace } from "../../../../../sdks";
import { RENDER_ORDER } from "../../../../../shared/frontend/canvas/layers";
import { useDrcStore } from "../drc/drc-store";

const HIGHLIGHT_ORDER = RENDER_ORDER.SELECTION - 0.2;
const HIGHLIGHT_COLOR = "#22d3ee"; // cyan — contrasts red copper + severity markers
const NM_TO_MM = 1 / 1_000_000;

interface DrcSelectionHighlightProps {
  traces: ReadonlyArray<PcbTrace>;
}

/**
 * Brightens the offending trace(s) of the currently-selected DRC violation so
 * the user can see *which* trace is involved (the diamond marker only points at
 * a location). Reads the selected violation from `useDrcStore`; renders each
 * anchored trace's centerline as a vivid cyan overlay. Pads/vias are already
 * indicated by the (enlarged) selected marker.
 */
export function DrcSelectionHighlight({
  traces,
}: DrcSelectionHighlightProps): ReactElement | null {
  const report = useDrcStore((s) => s.report);
  const selectedId = useDrcStore((s) => s.selectedId);
  const invalidate = useThree((s) => s.invalidate);

  const geometry = useMemo(() => {
    if (!selectedId || !report) return null;
    const violation = report.violations.find((v) => v.id === selectedId);
    if (!violation) return null;
    const traceIds = new Set(
      violation.anchors
        .filter(
          (a): a is { kind: "trace"; traceId: string } => a.kind === "trace",
        )
        .map((a) => a.traceId),
    );
    if (traceIds.size === 0) return null;
    const verts: number[] = [];
    for (const trace of traces) {
      if (!traceIds.has(trace.id) || trace.pointsNm.length < 2) continue;
      for (let i = 1; i < trace.pointsNm.length; i += 1) {
        const a = trace.pointsNm[i - 1]!;
        const b = trace.pointsNm[i]!;
        verts.push(a.x * NM_TO_MM, a.y * NM_TO_MM, 0);
        verts.push(b.x * NM_TO_MM, b.y * NM_TO_MM, 0);
      }
    }
    if (verts.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(verts), 3),
    );
    return g;
  }, [report, selectedId, traces]);

  useEffect(() => {
    invalidate();
  }, [geometry, invalidate]);
  useEffect(() => () => geometry?.dispose(), [geometry]);

  if (!geometry) return null;
  return (
    <lineSegments geometry={geometry} renderOrder={HIGHLIGHT_ORDER}>
      <lineBasicMaterial
        color={HIGHLIGHT_COLOR}
        toneMapped={false}
        depthTest={false}
        depthWrite={false}
        transparent
        opacity={0.95}
      />
    </lineSegments>
  );
}
