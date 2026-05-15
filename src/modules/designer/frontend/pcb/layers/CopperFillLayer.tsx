import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import type {
  PcbBoardOutline,
  PcbCopperLayerId,
  PcbDesignRules,
  PcbPlacedPart,
  PcbTrace,
  PcbVia,
} from "../../../../../sdks";
import {
  PCB_TRACE_COLORS,
  RENDER_ORDER,
} from "../../../../../shared/frontend/canvas/layers";
import { useCanvasTheme } from "../../../../../shared/frontend/canvas/theme";
import {
  buildCopperFillGeometrySpec,
  type CopperFillCutoutSpec,
} from "./copper-fill-geometry";

interface CopperFillLayerProps {
  layer: PcbCopperLayerId;
  outline: PcbBoardOutline;
  placements: ReadonlyArray<PcbPlacedPart>;
  traces: ReadonlyArray<PcbTrace>;
  vias: ReadonlyArray<PcbVia>;
  designRules: PcbDesignRules;
  opacity?: number;
}

function copperFillRenderOrder(layer: PcbCopperLayerId): number {
  // Keep fill below pads (`PINS` = 10) so component copper remains readable.
  // Top traces still render above via `F_COPPER` = 12.
  if (layer === "F.Cu") return RENDER_ORDER.PINS - 0.35;
  if (layer === "In1.Cu") return RENDER_ORDER.IN1_COPPER - 0.35;
  if (layer === "In2.Cu") return RENDER_ORDER.IN2_COPPER - 0.35;
  return RENDER_ORDER.B_COPPER - 0.35;
}

function CutoutMesh({
  cutout,
  color,
  renderOrder,
}: {
  cutout: CopperFillCutoutSpec;
  color: string;
  renderOrder: number;
}): ReactElement {
  const geometry = useMemo(() => new THREE.ShapeGeometry(cutout.shape), [cutout]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh
      geometry={geometry}
      position={[cutout.positionMm.x, cutout.positionMm.y, 0]}
      rotation={[0, 0, (cutout.rotationDeg * Math.PI) / 180]}
      scale={[cutout.scaleX ?? 1, 1, 1]}
      renderOrder={renderOrder}
      frustumCulled={false}
    >
      <meshBasicMaterial
        color={color}
        depthTest={false}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

export function CopperFillLayer({
  layer,
  outline,
  placements,
  traces,
  vias,
  designRules,
  opacity = 0.95,
}: CopperFillLayerProps): ReactElement | null {
  const { theme } = useCanvasTheme();
  const spec = useMemo(
    () =>
      buildCopperFillGeometrySpec({
        layer,
        outline,
        placements,
        traces,
        vias,
        clearanceMm: Math.max(
          designRules.clearance.traceToTraceMm,
          designRules.clearance.traceToPadMm,
          designRules.clearance.traceToViaMm,
        ),
        copperToBoardEdgeMm: designRules.clearance.copperToBoardEdgeMm,
      }),
    [designRules, layer, outline, placements, traces, vias],
  );

  const renderOrder = copperFillRenderOrder(layer);
  if (!spec.fill) return null;

  return (
    <group>
      <mesh
        position={[spec.fill.center.x, spec.fill.center.y, 0]}
        renderOrder={renderOrder}
        frustumCulled={false}
      >
        <planeGeometry args={[spec.fill.widthMm, spec.fill.heightMm]} />
        <meshBasicMaterial
          color={PCB_TRACE_COLORS[layer]}
          transparent
          opacity={opacity}
          depthTest={false}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      {spec.cutouts.map((cutout) => (
        <CutoutMesh
          key={cutout.id}
          cutout={cutout}
          color={theme.pcbCanvas.boardFill}
          renderOrder={renderOrder + 0.05}
        />
      ))}
    </group>
  );
}
