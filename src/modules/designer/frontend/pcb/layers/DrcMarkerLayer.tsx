import { useFrame, useThree } from "@react-three/fiber";
import { type ReactElement, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { DrcSeverity } from "../../../../../sdks";
import { RENDER_ORDER } from "../../../../../shared/frontend/canvas/layers";
import { useDrcStore } from "../drc/drc-store";
import { usePcbViewStore } from "../pcb-view-store";

// Just under the selection highlight so markers sit on top of copper/ratsnest.
const MARKER_ORDER = RENDER_ORDER.SELECTION - 0.1;
// Target on-screen marker size (px); kept constant across zoom.
const MARKER_PX = 13;
const SELECTED_MULT = 1.7;
const HALO_MULT = 1.55;

// Severity core colors. The dark halo (below) guarantees contrast against any
// copper color (incl. bright-red traces), so cores stay vivid + semantic.
const SEVERITY_COLOR: Record<DrcSeverity, string> = {
  error: "#ff3b3b",
  warning: "#f5a623",
  info: "#38bdf8",
};
const HALO_COLOR = "#0b0f19";

interface MarkerDatum {
  id: string;
  x: number;
  y: number;
  severity: DrcSeverity;
  selected: boolean;
}

/**
 * DRC violation markers — a dark-haloed diamond at each violation's locationMm,
 * colored by severity, sized to a constant ~13px on screen (zoom-independent),
 * with `toneMapped={false}` so the colors stay vivid. Reads the report +
 * selection from `useDrcStore` and waivers from `usePcbViewStore`. Lives inside
 * the board mirror group; R3F demand-rendered.
 */
export function DrcMarkerLayer(): ReactElement | null {
  const report = useDrcStore((s) => s.report);
  const selectedId = useDrcStore((s) => s.selectedId);
  const waivedIds = usePcbViewStore((s) => s.viewState.drcWaivedViolationIds);
  const invalidate = useThree((s) => s.invalidate);

  // Unit diamond (half-extent 1) reused by every marker.
  const diamond = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 1);
    shape.lineTo(1, 0);
    shape.lineTo(0, -1);
    shape.lineTo(-1, 0);
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, []);
  useEffect(() => () => diamond.dispose(), [diamond]);

  const markers = useMemo<MarkerDatum[]>(() => {
    const waived = new Set(waivedIds ?? []);
    const out: MarkerDatum[] = [];
    for (const v of report?.violations ?? []) {
      if (!v.locationMm || waived.has(v.id)) continue;
      out.push({
        id: v.id,
        x: v.locationMm.x,
        y: v.locationMm.y,
        severity: v.severity,
        selected: v.id === selectedId,
      });
    }
    return out;
  }, [report, selectedId, waivedIds]);

  const groupRefs = useRef<Array<THREE.Group | null>>([]);

  // Keep markers a constant screen size: ortho `camera.zoom` ≈ px-per-mm, so a
  // marker of world half-extent `(MARKER_PX/2)/zoom` renders at MARKER_PX px.
  useFrame(({ camera }) => {
    const zoom = (camera as THREE.OrthographicCamera).zoom || 1;
    const base = MARKER_PX / 2 / zoom;
    for (let i = 0; i < groupRefs.current.length; i += 1) {
      const g = groupRefs.current[i];
      if (!g) continue;
      const mult = markers[i]?.selected ? SELECTED_MULT : 1;
      g.scale.setScalar(base * mult);
    }
  });

  useEffect(() => {
    invalidate();
  }, [markers, invalidate]);

  if (markers.length === 0) return null;

  return (
    <>
      {markers.map((m, i) => (
        <group
          key={m.id}
          position={[m.x, m.y, 0]}
          ref={(el) => {
            groupRefs.current[i] = el;
          }}
        >
          <mesh geometry={diamond} renderOrder={MARKER_ORDER} scale={HALO_MULT}>
            <meshBasicMaterial
              color={HALO_COLOR}
              toneMapped={false}
              depthTest={false}
              depthWrite={false}
              transparent
              opacity={0.92}
            />
          </mesh>
          <mesh geometry={diamond} renderOrder={MARKER_ORDER + 0.01}>
            <meshBasicMaterial
              color={SEVERITY_COLOR[m.severity]}
              toneMapped={false}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        </group>
      ))}
    </>
  );
}
