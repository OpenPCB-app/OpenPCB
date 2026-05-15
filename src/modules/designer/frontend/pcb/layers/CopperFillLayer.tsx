import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
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
import type { PcbViewSide } from "../../../../../sdks";
import { useCanvasTheme } from "../../../../../shared/frontend/canvas/theme";
import {
  buildCopperFillGeometrySpec,
  resolveCopperFillClearanceMm,
} from "./copper-fill-geometry";

interface CopperFillLayerProps {
  layer: PcbCopperLayerId;
  outline: PcbBoardOutline;
  placements: ReadonlyArray<PcbPlacedPart>;
  /**
   * Traces on this layer. Items on the same net as `pourNetId` are merged
   * silently into the pour; everything else gets a clearance halo.
   */
  traces: ReadonlyArray<PcbTrace>;
  /**
   * Vias whose barrel crosses this layer. Same-net merge applies.
   */
  vias: ReadonlyArray<PcbVia>;
  /**
   * Net id of the pour on this layer (e.g. `"GND"`). `null` disables same-net
   * merging — every copper object renders with a halo. Read from
   * `viewState.copperFillPourNetIds[layer] ?? null` at the call site.
   */
  pourNetId: string | null;
  /**
   * Per-pad net resolution map keyed by `"<placementId>|<padNumber>"`. Used
   * for same-net pad merge (pads on the pour net skip the clearance halo
   * unless merging would violate minimum clearance).
   */
  padNetIds: ReadonlyMap<string, string>;
  designRules: PcbDesignRules;
  opacity?: number;
  /**
   * Side-flip indicator. Drives render-order reversal so bottom-view shows
   * B.Cu on top of F.Cu (spec §5.2). Defaults to "top" for back-compat.
   */
  viewSide?: PcbViewSide;
}

// Dev-only diagnostic: when set to "1", mask polygons render in bright yellow
// instead of the board background. Makes the three-second sanity check
// described in the spec trivial — if no yellow appears around a trace, the
// trace was not fed into the zone filler.
const DEBUG_COPPER_FILL =
  typeof import.meta !== "undefined" &&
  import.meta.env?.VITE_DEBUG_COPPER_FILL === "1";

function copperFillRenderOrder(
  layer: PcbCopperLayerId,
  viewSide: PcbViewSide,
): number {
  // The pour must sit BELOW its layer's pads, traces and vias — otherwise
  // the flood paints over the very objects whose halos define it. For F.Cu
  // we anchor at PINS - 0.35 (legacy) so SMT pads (which render at PINS)
  // stay readable; bottom and inner layers anchor at their own object slot
  // minus the same bias. Side flip swaps F ↔ B so bottom-view rendering
  // keeps B.Cu's pour in the foreground.
  const sourceLayer: PcbCopperLayerId =
    viewSide === "bottom"
      ? layer === "F.Cu"
        ? "B.Cu"
        : layer === "B.Cu"
          ? "F.Cu"
          : layer
      : layer;
  if (sourceLayer === "F.Cu") return RENDER_ORDER.PINS - 0.35;
  if (sourceLayer === "In1.Cu") return RENDER_ORDER.IN1_COPPER - 0.35;
  if (sourceLayer === "In2.Cu") return RENDER_ORDER.IN2_COPPER - 0.35;
  return RENDER_ORDER.B_COPPER - 0.35;
}

function blendedCopperFillColor(
  layer: PcbCopperLayerId,
  opacity: number,
  boardFill: string,
): string {
  const alpha = Math.max(0, Math.min(1, opacity));
  if (alpha >= 0.999) return PCB_TRACE_COLORS[layer];
  const color = new THREE.Color(boardFill);
  color.lerp(new THREE.Color(PCB_TRACE_COLORS[layer]), alpha);
  return `#${color.getHexString()}`;
}

function MaskGeometry({
  geometry,
  color,
  renderOrder,
}: {
  geometry: THREE.BufferGeometry;
  color: string;
  renderOrder: number;
}): ReactElement {
  return (
    <mesh geometry={geometry} renderOrder={renderOrder} frustumCulled={false}>
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

function buildMergedMaskGeometry(
  masks: ReturnType<typeof buildCopperFillGeometrySpec>["masks"],
): THREE.BufferGeometry | null {
  const geometries = masks.map((mask) => {
    const geometry = new THREE.ShapeGeometry(mask.shape);
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(mask.positionMm.x, mask.positionMm.y, 0),
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(0, 0, (mask.rotationDeg * Math.PI) / 180),
      ),
      new THREE.Vector3(mask.scaleX, 1, 1),
    );
    geometry.applyMatrix4(matrix);
    return geometry;
  });
  if (geometries.length === 0) return null;
  if (geometries.length === 1) return geometries[0]!;
  const merged = mergeGeometries(geometries, false);
  geometries.forEach((geometry) => geometry.dispose());
  return merged;
}

export function CopperFillLayer({
  layer,
  outline,
  placements,
  traces,
  vias,
  pourNetId,
  padNetIds,
  designRules,
  opacity = 0.95,
  viewSide = "top",
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
        pourNetId,
        padNetIds,
        clearanceMm: resolveCopperFillClearanceMm(designRules.clearance),
        copperToBoardEdgeMm: designRules.clearance.copperToBoardEdgeMm,
      }),
    [
      designRules,
      layer,
      outline,
      placements,
      traces,
      vias,
      pourNetId,
      padNetIds,
    ],
  );

  const renderOrder = copperFillRenderOrder(layer, viewSide);
  const fillColor = useMemo(
    () => blendedCopperFillColor(layer, opacity, theme.pcbCanvas.boardFill),
    [layer, opacity, theme.pcbCanvas.boardFill],
  );
  const maskGeometry = useMemo(
    () => buildMergedMaskGeometry(spec.masks),
    [spec.masks],
  );
  useEffect(() => () => maskGeometry?.dispose(), [maskGeometry]);
  if (!spec.fill) return null;

  const maskColor = DEBUG_COPPER_FILL ? "#ffea00" : theme.pcbCanvas.boardFill;

  return (
    <group>
      <mesh
        position={[spec.fill.center.x, spec.fill.center.y, 0]}
        renderOrder={renderOrder}
        frustumCulled={false}
      >
        <planeGeometry args={[spec.fill.widthMm, spec.fill.heightMm]} />
        <meshBasicMaterial
          color={fillColor}
          depthTest={false}
          depthWrite={false}
          side={THREE.DoubleSide}
          transparent
          opacity={1}
        />
      </mesh>
      {maskGeometry ? (
        <MaskGeometry
          geometry={maskGeometry}
          color={maskColor}
          renderOrder={renderOrder + 0.05}
        />
      ) : null}
    </group>
  );
}
