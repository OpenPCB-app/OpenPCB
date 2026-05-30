import { useEffect, useMemo, useRef, type ReactElement } from "react";
import * as THREE from "three";
import type { PcbVia } from "../../../../../sdks";
import {
  PCB_TRACE_COLORS,
  RENDER_ORDER,
} from "../../../../../shared/frontend/canvas/layers";
import { useCanvasTheme } from "../../../../../shared/frontend/canvas/theme";

// Presentation-only board-color gap drawn around a via that sits on a same-net
// pour. The pour fill keeps the electrical merge (no knockout in the exported
// geometry), but without a gap the via's copper ring is the same color as the
// pour it merges into and reads as solid. The separator sits ABOVE the pour and
// BELOW the via copper + any connecting trace, so a trace entering the via
// still bridges the gap (the via stays visibly connected to its net).
//
// NOTE: tied to the current pour render order (PINS - 0.35). Phase 3 moves the
// pour to the copper fill slot; re-tune VIA_SEPARATOR_RENDER_ORDER + the via
// copper ring together there so `pour < separator < via ring < trace` holds.
const VIA_SEPARATOR_GAP_MM = 0.15;
const VIA_SEPARATOR_RENDER_ORDER = RENDER_ORDER.PINS - 0.15;

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
  /**
   * Vias whose net matches a rendered same-net pour they cross. These get a
   * presentation-only board-color separator ring so the copper annulus reads
   * against the pour it merges into (Flux look).
   */
  samePourViaIds?: ReadonlySet<string>;
}

/**
 * Renders vias as a single copper annular ring around the drill. The drill is
 * revealed by `DrillHoleCutoutLayer` (always-on board-color disc); ring color
 * follows `fromLayer` trace color (red for F.Cu, blue for B.Cu —
 * Flux.ai/KiCad convention). Same-net-pour vias additionally get a board-color
 * separator ring (see `VIA_SEPARATOR_*`).
 */
export function ViaLayer({
  vias,
  highlightedNetId,
  selectedViaIds,
  activeLayer,
  focusNetAcrossLayers = false,
  samePourViaIds,
}: ViaLayerProps): ReactElement | null {
  const { theme } = useCanvasTheme();
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
            showSeparator={samePourViaIds?.has(via.id) ?? false}
            separatorColor={theme.pcbCanvas.boardFill}
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
  showSeparator,
  separatorColor,
}: {
  via: PcbVia;
  dimmed: boolean;
  inactive: boolean;
  selected: boolean;
  showSeparator: boolean;
  separatorColor: string;
}): ReactElement {
  const outerRadius = via.diameterMm / 2;
  const drillRadius = via.drillMm / 2;
  const ringGeom = useMemo(
    () => new THREE.RingGeometry(drillRadius, outerRadius, 32),
    [drillRadius, outerRadius],
  );
  useEffect(() => () => ringGeom.dispose(), [ringGeom]);
  const separatorGeom = useMemo(
    () =>
      showSeparator
        ? new THREE.RingGeometry(
            outerRadius,
            outerRadius + VIA_SEPARATOR_GAP_MM,
            32,
          )
        : null,
    [outerRadius, showSeparator],
  );
  useEffect(() => () => separatorGeom?.dispose(), [separatorGeom]);
  const ringRef = useRef<THREE.Mesh>(null);

  return (
    <group>
      {showSeparator && separatorGeom ? (
        <mesh
          geometry={separatorGeom}
          position={[via.centerMm.x, via.centerMm.y, 0]}
          renderOrder={VIA_SEPARATOR_RENDER_ORDER}
        >
          <meshBasicMaterial
            color={separatorColor}
            transparent
            opacity={1}
            depthTest={false}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ) : null}
      <mesh
        ref={ringRef}
        geometry={ringGeom}
        position={[via.centerMm.x, via.centerMm.y, 0]}
        renderOrder={RENDER_ORDER.PINS}
      >
        <meshBasicMaterial
          color={selected ? "#22d3ee" : PCB_TRACE_COLORS[via.fromLayer]}
          // Always transparent: three.js renders opaque meshes in a separate
          // earlier pass, so an opaque via would ignore renderOrder vs the
          // transparent pour / mask / drill-cutout and sort wrong. Keep all
          // order-dependent copper in the one transparent pass.
          transparent
          opacity={dimmed ? 0.3 : inactive ? 0.55 : 1}
          depthTest={false}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
