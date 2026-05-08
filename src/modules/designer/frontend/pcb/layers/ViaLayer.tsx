import { useEffect, useMemo, useRef, type ReactElement } from "react";
import * as THREE from "three";
import type { PcbVia } from "../../../../../sdks";
import {
  PCB_LAYER_COLORS,
  RENDER_ORDER,
} from "../../../../../shared/frontend/canvas/layers";
import { useCanvasTheme } from "../../../../../shared/frontend/canvas/theme";

interface ViaLayerProps {
  vias: ReadonlyArray<PcbVia>;
  highlightedNetId?: string | null;
  selectedViaIds?: ReadonlySet<string>;
}

/**
 * Renders vias as two stacked rings:
 *   - outer copper annular ring (uses F.Cu color; through-via for v1)
 *   - inner drill hole (board-fill color so it appears as a punched hole)
 * Implementation uses two InstancedMesh-style ring geometries via dynamic mesh
 * groups (count is small in v1; a full instanced path can come later).
 */
export function ViaLayer({
  vias,
  highlightedNetId,
  selectedViaIds,
}: ViaLayerProps): ReactElement | null {
  const { theme } = useCanvasTheme();
  if (vias.length === 0) return null;
  return (
    <>
      {vias.map((via) => (
        <SingleVia
          key={via.id}
          via={via}
          drillColor={theme.pcbCanvas.boardFill}
          dimmed={
            highlightedNetId !== null &&
            highlightedNetId !== undefined &&
            via.netId !== highlightedNetId
          }
          selected={selectedViaIds?.has(via.id) ?? false}
        />
      ))}
    </>
  );
}

function SingleVia({
  via,
  drillColor,
  dimmed,
  selected,
}: {
  via: PcbVia;
  drillColor: string;
  dimmed: boolean;
  selected: boolean;
}): ReactElement {
  const annularRing = (via.diameterMm - via.drillMm) / 2;
  const outerRadius = via.diameterMm / 2;
  const drillRadius = via.drillMm / 2;
  const ringGeom = useMemo(
    () => new THREE.RingGeometry(drillRadius, outerRadius, 24),
    [drillRadius, outerRadius],
  );
  const drillGeom = useMemo(
    () => new THREE.CircleGeometry(drillRadius, 18),
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
          color={selected ? "#ffffff" : PCB_LAYER_COLORS["F.Cu"]}
          transparent={dimmed}
          opacity={dimmed ? 0.25 : 1}
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
        />
      </mesh>
    </group>
  );
}
