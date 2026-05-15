import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import type { PcbPlacedPart, PcbPointMm, PcbVia } from "../../../../../sdks";
import { placementMirrorX } from "../../../../../sdks/designer/pcb-helpers";
import {
  PCB_LAYER_COLORS,
  RENDER_ORDER,
} from "../../../../../shared/frontend/canvas/layers";

const MOUNTING_HOLE_THRESHOLD_MM = 1.5;
const MOUNTING_RING_THICKNESS_MM = 0.4;

interface DrillLayerProps {
  vias: ReadonlyArray<PcbVia>;
  placements: ReadonlyArray<PcbPlacedPart>;
  /**
   * When true, draw a magenta annular ring on the silkscreen render order
   * around any drill larger than `MOUNTING_HOLE_THRESHOLD_MM`. Matches Flux's
   * "Top Overlay" mounting-hole halo convention (screenshot 16.39.34).
   */
  showMountingHoleRing?: boolean;
}

interface DrillInstance {
  centerMm: PcbPointMm;
  radiusMm: number;
}

function transformLocal(
  localMm: PcbPointMm,
  rotationDeg: number,
  mirrored: boolean,
): PcbPointMm {
  const r = (((Math.round(rotationDeg / 90) * 90) % 360) + 360) % 360;
  const mx = mirrored ? -localMm.x : localMm.x;
  switch (r) {
    case 90:
      return { x: -localMm.y, y: mx };
    case 180:
      return { x: -mx, y: -localMm.y };
    case 270:
      return { x: localMm.y, y: -mx };
    default:
      return { x: mx, y: localMm.y };
  }
}

function collectDrills(
  vias: ReadonlyArray<PcbVia>,
  placements: ReadonlyArray<PcbPlacedPart>,
): DrillInstance[] {
  const out: DrillInstance[] = [];
  for (const via of vias) {
    if (via.drillMm > 0) {
      out.push({ centerMm: via.centerMm, radiusMm: via.drillMm / 2 });
    }
  }
  for (const placement of placements) {
    const pads = placement.footprint.preview?.pads ?? [];
    const mirrored = placementMirrorX(placement);
    for (const pad of pads) {
      const drill = pad.drillDiameterMm;
      if (!drill || drill <= 0) continue;
      const offset = transformLocal(
        pad.centerMm,
        placement.rotationDeg,
        mirrored,
      );
      out.push({
        centerMm: {
          x: placement.positionMm.x + offset.x,
          y: placement.positionMm.y + offset.y,
        },
        radiusMm: drill / 2,
      });
    }
  }
  return out;
}

/**
 * DrillLayer — renders every PTH pad + via as a black circular hole on the
 * unified `Drill` virtual layer. One InstancedMesh, scaled per instance.
 *
 * Mounting holes (drill ≥ 1.5 mm) additionally get a magenta annulus on the
 * top silkscreen render order to match Flux.ai's mounting-hole halo.
 */
export function DrillLayer({
  vias,
  placements,
  showMountingHoleRing = true,
}: DrillLayerProps): ReactElement | null {
  const drills = useMemo(
    () => collectDrills(vias, placements),
    [vias, placements],
  );

  const mountingHoles = useMemo(
    () =>
      showMountingHoleRing
        ? drills.filter((d) => d.radiusMm * 2 >= MOUNTING_HOLE_THRESHOLD_MM)
        : [],
    [drills, showMountingHoleRing],
  );

  const drillGeom = useMemo(() => new THREE.CircleGeometry(1, 24), []);
  const ringGeom = useMemo(() => {
    // Inner radius 1, outer 1 + (thickness / 1) — but the instanced mesh
    // scales by the drill radius, so the ring grows proportionally too.
    // We want a constant 0.4 mm thickness; we'll instead use per-instance
    // RingGeometry built relative to each drill below. Placeholder unit ring.
    return new THREE.RingGeometry(1, 1 + MOUNTING_RING_THICKNESS_MM, 24);
  }, []);

  useEffect(
    () => () => {
      drillGeom.dispose();
      ringGeom.dispose();
    },
    [drillGeom, ringGeom],
  );

  if (drills.length === 0) return null;
  return (
    <>
      <InstancedDrillMesh drills={drills} geometry={drillGeom} />
      {mountingHoles.length > 0 ? (
        <MountingHoleRings holes={mountingHoles} />
      ) : null}
    </>
  );
}

function InstancedDrillMesh({
  drills,
  geometry,
}: {
  drills: ReadonlyArray<DrillInstance>;
  geometry: THREE.CircleGeometry;
}): ReactElement {
  const meshRef = useInstancedMatrices(drills);
  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, undefined, drills.length]}
      renderOrder={RENDER_ORDER.DRILL}
    >
      <meshBasicMaterial
        color={PCB_LAYER_COLORS.Drill}
        depthTest={false}
        depthWrite={false}
        side={THREE.DoubleSide}
        transparent={false}
      />
    </instancedMesh>
  );
}

function MountingHoleRings({
  holes,
}: {
  holes: ReadonlyArray<DrillInstance>;
}): ReactElement {
  // Per-hole geometry so ring thickness stays constant (0.4 mm) regardless
  // of drill size; instancing with a unit ring would scale thickness too.
  return (
    <group renderOrder={RENDER_ORDER.ANNULAR}>
      {holes.map((hole, i) => (
        <MountingHoleRing key={i} hole={hole} />
      ))}
    </group>
  );
}

/** Mounting-hole annulus color (Flux convention). Bright magenta so non-electrical
 * mechanical holes are visually distinct from electrical PTH pads + vias. */
const MOUNTING_HOLE_RING_COLOR = "#ec4899";

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

function useInstancedMatrices(
  drills: ReadonlyArray<DrillInstance>,
): React.RefCallback<THREE.InstancedMesh> {
  return useMemo(() => {
    const tmp = new THREE.Object3D();
    return (mesh: THREE.InstancedMesh | null) => {
      if (!mesh) return;
      for (let i = 0; i < drills.length; i++) {
        const d = drills[i]!;
        tmp.position.set(d.centerMm.x, d.centerMm.y, 0);
        tmp.scale.set(d.radiusMm, d.radiusMm, 1);
        tmp.rotation.set(0, 0, 0);
        tmp.updateMatrix();
        mesh.setMatrixAt(i, tmp.matrix);
      }
      mesh.count = drills.length;
      mesh.instanceMatrix.needsUpdate = true;
    };
  }, [drills]);
}
