import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import type {
  PcbFreeHole,
  PcbFreePad,
  PcbPlacedPart,
  PcbVia,
} from "../../../../../sdks";
import {
  PCB_DRILL_OUTLINE_COLOR,
  PCB_DRILL_OUTLINE_THICKNESS_MM,
  RENDER_ORDER,
} from "../../../../../shared/frontend/canvas/layers";
import { useCanvasTheme } from "../../../../../shared/frontend/canvas/theme";
import { collectDrills, type DrillInstance } from "../pcb-drills";

const MOUNTING_HOLE_THRESHOLD_MM = 1.5;
const MOUNTING_RING_THICKNESS_MM = 0.4;

// Footprint pad copper from the shared FootprintRenderLayer is a *solid* disc
// (no annular cutout) drawn at the copper order (F_COPPER = 12). To reveal the
// drill we paint a board-colored disc + outline ring just above the top copper,
// below the ANNULAR (13) slot used by mounting / selection rings.
const PCB_DRILL_FILL_RENDER_ORDER = RENDER_ORDER.F_COPPER + 0.6;
const PCB_DRILL_RING_RENDER_ORDER = RENDER_ORDER.F_COPPER + 0.7;

interface DrillLayerProps {
  vias: ReadonlyArray<PcbVia>;
  placements: ReadonlyArray<PcbPlacedPart>;
  freeHoles?: ReadonlyArray<PcbFreeHole>;
  freePads?: ReadonlyArray<PcbFreePad>;
  selectedFreeHoleIds?: ReadonlySet<string>;
  /**
   * When true, draw a magenta annular ring on the silkscreen render order
   * around any drill larger than `MOUNTING_HOLE_THRESHOLD_MM`. Matches Flux's
   * "Top Overlay" mounting-hole halo convention (screenshot 16.39.34).
   */
  showMountingHoleRing?: boolean;
}

/**
 * DrillLayer — paints every PTH pad + via drill on top of the copper so the
 * hole reads. Footprint pad copper is a solid disc (the shared renderer has no
 * annular cutout), so we draw a board-colored fill disc + a thin lime outline
 * ring just above the top copper. Vias (drawn as a `RingGeometry`) get the same
 * treatment for a consistent hole look across pads / vias / free holes.
 *
 * Mounting holes (drill ≥ 1.5 mm) additionally get a magenta annulus on the
 * top silkscreen render order to mark non-electrical mechanical holes.
 */
export function DrillLayer({
  vias,
  placements,
  freeHoles,
  freePads,
  selectedFreeHoleIds,
  showMountingHoleRing = true,
}: DrillLayerProps): ReactElement | null {
  const { theme } = useCanvasTheme();
  const drills = useMemo(
    () => collectDrills(vias, placements, freeHoles, freePads),
    [vias, placements, freeHoles, freePads],
  );

  const mountingHoles = useMemo(
    () =>
      showMountingHoleRing
        ? drills.filter((d) => d.radiusMm * 2 >= MOUNTING_HOLE_THRESHOLD_MM)
        : [],
    [drills, showMountingHoleRing],
  );

  const selectedHoles = useMemo(
    () =>
      selectedFreeHoleIds && selectedFreeHoleIds.size > 0
        ? (freeHoles ?? []).filter((h) => selectedFreeHoleIds.has(h.id))
        : [],
    [freeHoles, selectedFreeHoleIds],
  );

  if (drills.length === 0) return null;
  return (
    <>
      <DrillHoleFills drills={drills} color={theme.pcbCanvas.boardFill} />
      <DrillOutlineRings drills={drills} />
      {mountingHoles.length > 0 ? (
        <MountingHoleRings holes={mountingHoles} />
      ) : null}
      {selectedHoles.map((hole) => (
        <SelectedHoleRing key={hole.id} hole={hole} />
      ))}
    </>
  );
}

/**
 * Per-drill board-colored fill disc, painted above the top copper so it covers
 * the solid footprint pad and reads as an empty hole.
 */
function DrillHoleFills({
  drills,
  color,
}: {
  drills: ReadonlyArray<DrillInstance>;
  color: string;
}): ReactElement {
  return (
    <group renderOrder={PCB_DRILL_FILL_RENDER_ORDER}>
      {drills.map((drill, i) => (
        <DrillHoleFill key={i} drill={drill} color={color} />
      ))}
    </group>
  );
}

function DrillHoleFill({
  drill,
  color,
}: {
  drill: DrillInstance;
  color: string;
}): ReactElement {
  const geom = useMemo(
    () => new THREE.CircleGeometry(drill.radiusMm, 32),
    [drill.radiusMm],
  );
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <mesh
      geometry={geom}
      position={[drill.centerMm.x, drill.centerMm.y, 0]}
      renderOrder={PCB_DRILL_FILL_RENDER_ORDER}
    >
      {/* `transparent` so this shares the transparent render pass with the
          footprint pad copper (which is transparent because the PCB canvas runs
          depthTest-off). Otherwise the opaque pass would draw the fill first and
          the transparent pad would paint over it regardless of renderOrder. */}
      <meshBasicMaterial
        color={color}
        depthTest={false}
        depthWrite={false}
        side={THREE.DoubleSide}
        transparent
        opacity={1}
      />
    </mesh>
  );
}

/**
 * Per-drill `RingGeometry`. We cannot use `InstancedMesh` with a unit ring
 * because per-instance scale would warp ring thickness (`PCB_DRILL_OUTLINE_
 * THICKNESS_MM` must stay constant in mm regardless of drill size).
 */
function DrillOutlineRings({
  drills,
}: {
  drills: ReadonlyArray<DrillInstance>;
}): ReactElement {
  return (
    <group renderOrder={PCB_DRILL_RING_RENDER_ORDER}>
      {drills.map((drill, i) => (
        <DrillOutlineRing key={i} drill={drill} />
      ))}
    </group>
  );
}

function DrillOutlineRing({ drill }: { drill: DrillInstance }): ReactElement {
  const geom = useMemo(
    () =>
      new THREE.RingGeometry(
        drill.radiusMm,
        drill.radiusMm + PCB_DRILL_OUTLINE_THICKNESS_MM,
        32,
      ),
    [drill.radiusMm],
  );
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <mesh
      geometry={geom}
      position={[drill.centerMm.x, drill.centerMm.y, 0]}
      renderOrder={PCB_DRILL_RING_RENDER_ORDER}
    >
      <meshBasicMaterial
        color={PCB_DRILL_OUTLINE_COLOR}
        depthTest={false}
        depthWrite={false}
        side={THREE.DoubleSide}
        transparent
        opacity={1}
      />
    </mesh>
  );
}

function MountingHoleRings({
  holes,
}: {
  holes: ReadonlyArray<DrillInstance>;
}): ReactElement {
  return (
    <group renderOrder={RENDER_ORDER.ANNULAR}>
      {holes.map((hole, i) => (
        <MountingHoleRing key={i} hole={hole} />
      ))}
    </group>
  );
}

const MOUNTING_HOLE_RING_COLOR = "#ec4899";
const SELECTED_HOLE_COLOR = "#facc15";

function SelectedHoleRing({ hole }: { hole: PcbFreeHole }): ReactElement {
  const r = hole.drillMm / 2;
  const geom = useMemo(
    () => new THREE.RingGeometry(r + 0.05, r + 0.35, 32),
    [r],
  );
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <mesh
      geometry={geom}
      position={[hole.centerMm.x, hole.centerMm.y, 0]}
      renderOrder={RENDER_ORDER.ANNULAR + 1}
    >
      <meshBasicMaterial
        color={SELECTED_HOLE_COLOR}
        transparent
        opacity={0.9}
        depthTest={false}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function MountingHoleRing({ hole }: { hole: DrillInstance }): ReactElement {
  const geom = useMemo(
    () =>
      new THREE.RingGeometry(
        hole.radiusMm + 0.05,
        hole.radiusMm + 0.05 + MOUNTING_RING_THICKNESS_MM,
        32,
      ),
    [hole.radiusMm],
  );
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <mesh
      geometry={geom}
      position={[hole.centerMm.x, hole.centerMm.y, 0]}
      renderOrder={RENDER_ORDER.ANNULAR}
    >
      <meshBasicMaterial
        color={MOUNTING_HOLE_RING_COLOR}
        transparent
        opacity={0.92}
        depthTest={false}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
