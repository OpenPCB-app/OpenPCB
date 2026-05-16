import { useEffect, useMemo, useRef, type ReactElement } from "react";
import * as THREE from "three";
import type { PcbVia } from "../../../../../sdks";
import {
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
 * Renders vias as a single copper annular ring around the drill.
 * The drill itself is a real cutout in the board substrate (`BoardFill`
 * `ShapeGeometry.holes[]`); `DrillLayer` paints the lime outline on top.
 * Ring color follows `fromLayer` trace color (red for F.Cu, blue for B.Cu —
 * Flux.ai/KiCad convention).
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
  dimmed,
  inactive,
  selected,
}: {
  via: PcbVia;
  dimmed: boolean;
  inactive: boolean;
  selected: boolean;
}): ReactElement {
  const outerRadius = via.diameterMm / 2;
  const drillRadius = via.drillMm / 2;
  const ringGeom = useMemo(
    () => new THREE.RingGeometry(drillRadius, outerRadius, 32),
    [drillRadius, outerRadius],
  );
  useEffect(() => () => ringGeom.dispose(), [ringGeom]);
  const ringRef = useRef<THREE.Mesh>(null);

  return (
    <mesh
      ref={ringRef}
      geometry={ringGeom}
      position={[via.centerMm.x, via.centerMm.y, 0]}
      renderOrder={RENDER_ORDER.PINS}
    >
      <meshBasicMaterial
        color={selected ? "#22d3ee" : PCB_TRACE_COLORS[via.fromLayer]}
        transparent={dimmed || inactive}
        opacity={dimmed ? 0.3 : inactive ? 0.55 : 1}
        depthTest={false}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
