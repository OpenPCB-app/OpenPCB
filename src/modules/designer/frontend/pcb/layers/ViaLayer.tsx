import { useEffect, useMemo, useRef, type ReactElement } from "react";
import * as THREE from "three";
import type { PcbVia } from "../../../../../sdks";
import {
  PCB_LAYER_COLORS,
  PCB_TRACE_COLORS,
  RENDER_ORDER,
} from "../../../../../shared/frontend/canvas/layers";

interface ViaLayerProps {
  vias: ReadonlyArray<PcbVia>;
  highlightedNetId?: string | null;
  selectedViaIds?: ReadonlySet<string>;
  /**
   * The user's active copper layer. When the active layer is non-copper
   * (silk / edge), vias dim to 50% so the focused layer reads cleanly.
   * For 2-layer through-vias the via spans both copper layers, so it stays
   * bright whenever the active layer is F.Cu or B.Cu.
   */
  activeLayer?: string;
  /** Keep same-net vias bright even when their copper span is not active. */
  focusNetAcrossLayers?: boolean;
}

/**
 * Renders vias as two stacked rings:
 *   - outer copper annular ring (trace color of `fromLayer`: red for F.Cu,
 *     blue for B.Cu — matches Flux.ai/KiCad convention; the trace coming into
 *     the via dictates the ring color)
 *   - inner drill hole (board-fill color so it appears as a punched hole)
 */
export function ViaLayer({
  vias,
  highlightedNetId,
  selectedViaIds,
  activeLayer,
  focusNetAcrossLayers = false,
}: ViaLayerProps): ReactElement | null {
  if (vias.length === 0) return null;
  const activeIsCopper =
    activeLayer === "F.Cu" ||
    activeLayer === "In1.Cu" ||
    activeLayer === "In2.Cu" ||
    activeLayer === "B.Cu";
  return (
    <>
      {vias.map((via) => {
        const onActiveLayer =
          activeIsCopper &&
          (via.fromLayer === activeLayer || via.toLayer === activeLayer);
        const inactive = activeIsCopper && !onActiveLayer;
        return (
          <SingleVia
            key={via.id}
            via={via}
            drillColor={PCB_LAYER_COLORS.Drill}
            dimmed={
              highlightedNetId !== null &&
              highlightedNetId !== undefined &&
              via.netId !== highlightedNetId
            }
            inactive={
              focusNetAcrossLayers &&
              highlightedNetId !== null &&
              highlightedNetId !== undefined &&
              via.netId === highlightedNetId
                ? false
                : inactive
            }
            selected={selectedViaIds?.has(via.id) ?? false}
          />
        );
      })}
    </>
  );
}

function SingleVia({
  via,
  drillColor,
  dimmed,
  inactive,
  selected,
}: {
  via: PcbVia;
  drillColor: string;
  dimmed: boolean;
  inactive: boolean;
  selected: boolean;
}): ReactElement {
  const annularRing = (via.diameterMm - via.drillMm) / 2;
  const outerRadius = via.diameterMm / 2;
  const drillRadius = via.drillMm / 2;
  const ringGeom = useMemo(
    () => new THREE.RingGeometry(drillRadius, outerRadius, 32),
    [drillRadius, outerRadius],
  );
  const drillGeom = useMemo(
    () => new THREE.CircleGeometry(drillRadius, 24),
    [drillRadius],
  );
  useEffect(
    () => () => {
      ringGeom.dispose();
      drillGeom.dispose();
    },
    [ringGeom, drillGeom],
  );
  const ringRef = useRef<THREE.Mesh>(null);
  const drillRef = useRef<THREE.Mesh>(null);
  // annularRing not currently used for rendering width — kept for future DRC.
  void annularRing;

  return (
    <group position={[via.centerMm.x, via.centerMm.y, 0]}>
      <mesh ref={ringRef} geometry={ringGeom} renderOrder={RENDER_ORDER.PINS}>
        <meshBasicMaterial
          color={selected ? "#22d3ee" : PCB_TRACE_COLORS[via.fromLayer]}
          transparent={dimmed || inactive}
          opacity={dimmed ? 0.3 : inactive ? 0.55 : 1}
          depthTest={false}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh
        ref={drillRef}
        geometry={drillGeom}
        renderOrder={RENDER_ORDER.PINS + 1}
      >
        <meshBasicMaterial
          color={drillColor}
          depthTest={false}
          depthWrite={false}
          side={THREE.DoubleSide}
          transparent={false}
        />
      </mesh>
    </group>
  );
}
