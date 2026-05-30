import { useFrame, useThree } from "@react-three/fiber";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactElement,
} from "react";
import * as THREE from "three";
import type {
  DesignerPcbProjection,
  PcbBoardCutout,
  PcbBoardOutline,
  PcbCopperLayerId,
  PcbFreeHole,
  PcbFreePad,
  PcbLayerId,
  PcbOverlayText,
  PcbPlacedPart,
  PcbPointMm,
  PcbTrace,
  PcbVia,
} from "../../../../sdks";
import { FootprintRenderLayer } from "../../../../shared/frontend/canvas/scene";
import {
  flipLayerSide,
  placementContributingLayers,
} from "../../../../shared/frontend/canvas/scene/layer-side";
import { EDAText } from "../../../../shared/frontend/canvas/primitives/EDAText";
import { GridShader } from "../../../../shared/frontend/canvas/primitives/GridShader";
import {
  PCB_LAYER_COLORS,
  RENDER_ORDER,
  effectiveRenderOrder,
} from "../../../../shared/frontend/canvas/layers";
import { useCanvasTheme } from "../../../../shared/frontend/canvas/theme";
import { TraceLayer } from "./layers/TraceLayer";
import { TracePreviewLayer } from "./layers/TracePreviewLayer";
import { CopperFillLayer } from "./layers/CopperFillLayer";
import { viaCrossesLayer } from "./layers/copper-fill-trace-geometry";
import { ViaLayer } from "./layers/ViaLayer";
import { DrillHighlightLayer, DrillHoleCutoutLayer } from "./layers/DrillLayer";
import { FreePadLayer } from "./layers/FreePadLayer";
import { OverlayLayer } from "./layers/OverlayLayer";
import { BOARD_HANDLES, handlePointMm } from "./pcb-board-resize";
import {
  cutoutToPath,
  outlineToLinePoints,
  outlineToShape,
} from "./pcb-outline-three";
import { collectDrills } from "./pcb-drills";
import { buildPadNetIds } from "./pcb-pad-nets";
import { SolderMaskLayer } from "./layers/SolderMaskLayer";
import { SolderPasteLayer } from "./layers/SolderPasteLayer";
import { NetTraceLabels } from "./layers/NetTraceLabels";
import { SnapTargetIndicator } from "./layers/SnapTargetIndicator";
import { MeasureOverlayLayer } from "./layers/MeasureOverlayLayer";
import { usePcbViewStore } from "./pcb-view-store";
import { SelectionRectOverlay } from "../../../../shared/frontend/canvas/selection";
import {
  areViasVisible,
  hiddenFootprintLayers,
  isCopperLayerVisible,
  isPcbLayerVisible,
  isPlacementVisible,
  visibleLayerSet,
} from "./pcb-layer-visibility";
import type { PcbSelection } from "./pcb-selection";
import type { ViewportState } from "../types";
import {
  createPcbVisualState,
  layerOpacity,
  shouldRenderCopperLayer,
  type PcbVisualState,
} from "./pcb-visual-state";

export interface PcbCameraControls {
  zoomIn(): void;
  zoomOut(): void;
  fit(): void;
}

/** Stable empty reference so `useMemo` deps don't churn on absent cutouts. */
const EMPTY_CUTOUTS: readonly PcbBoardCutout[] = [];

function fitCameraToOutline(
  camera: THREE.OrthographicCamera,
  gl: THREE.WebGLRenderer,
  outline: PcbBoardOutline,
): void {
  const { widthMm, heightMm, centerMm } = outline;
  const canvasWidth = gl.domElement.clientWidth;
  const canvasHeight = gl.domElement.clientHeight;
  const paddedWidth = widthMm * 1.15;
  const paddedHeight = heightMm * 1.15;
  const zoom = Math.max(
    1,
    Math.min(canvasWidth / paddedWidth, canvasHeight / paddedHeight, 500),
  );
  camera.position.set(centerMm.x, centerMm.y, camera.position.z);
  camera.zoom = zoom;
  camera.updateProjectionMatrix();
}

function FitBoardOnMount({
  outline,
  initialViewport,
}: {
  outline: PcbBoardOutline;
  initialViewport?: ViewportState | null;
}): null {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    if (initialViewport) {
      camera.position.set(
        initialViewport.posX,
        initialViewport.posY,
        camera.position.z,
      );
      camera.zoom = initialViewport.zoom;
      camera.updateProjectionMatrix();
    } else {
      fitCameraToOutline(camera, gl, outline);
    }
    invalidate();
    // runs only on mount; PcbCanvas remounts (key=designId) on design switch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

function CameraControlsBridge({
  outline,
  onReady,
}: {
  outline: PcbBoardOutline;
  onReady: (controls: PcbCameraControls | null) => void;
}): null {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const outlineRef = useRef(outline);
  outlineRef.current = outline;

  useEffect(() => {
    const controls: PcbCameraControls = {
      zoomIn() {
        camera.zoom = Math.min(camera.zoom * 1.15, 500);
        camera.updateProjectionMatrix();
        invalidate();
      },
      zoomOut() {
        camera.zoom = Math.max(camera.zoom / 1.15, 1);
        camera.updateProjectionMatrix();
        invalidate();
      },
      fit() {
        fitCameraToOutline(camera, gl, outlineRef.current);
        invalidate();
      },
    };
    onReady(controls);
    return () => onReady(null);
  }, [camera, gl, invalidate, onReady]);

  return null;
}

function ViewportReporter({
  onViewportChange,
}: {
  onViewportChange: (zoom: number, posX: number, posY: number) => void;
}): null {
  const camera = useThree((s) => s.camera) as THREE.OrthographicCamera;
  const lastRef = useRef({
    zoom: camera.zoom,
    posX: camera.position.x,
    posY: camera.position.y,
  });

  useFrame(() => {
    const { zoom, position } = camera;
    const l = lastRef.current;
    if (
      Math.abs(l.zoom - zoom) > 0.001 ||
      Math.abs(l.posX - position.x) > 0.1 ||
      Math.abs(l.posY - position.y) > 0.1
    ) {
      l.zoom = zoom;
      l.posX = position.x;
      l.posY = position.y;
      onViewportChange(zoom, position.x, position.y);
    }
  });

  return null;
}

function BoardOutline({
  projection,
  visibleLayers,
  tintColor,
  outlineOverride,
}: {
  projection: DesignerPcbProjection;
  visibleLayers: ReadonlySet<PcbLayerId>;
  /** Optional active-layer color override (Flux convention in Solo mode). */
  tintColor?: string;
  /** Live resize preview; overrides the persisted outline when set. */
  outlineOverride?: PcbBoardOutline | null;
}): ReactElement | null {
  const outline = outlineOverride ?? projection.board.outline;
  const cutouts = projection.board.cutouts ?? EMPTY_CUTOUTS;
  const geometry = useMemo(() => {
    const points = outlineToLinePoints(outline);
    // Cutouts draw on the same Edge.Cuts layer (their own closed contours).
    for (const cut of cutouts) {
      const ring = outlineToLinePoints(cut.shape);
      points.push(...ring);
    }
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [outline, cutouts]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  if (!isPcbLayerVisible(visibleLayers, "Edge.Cuts")) return null;

  return (
    <lineSegments geometry={geometry} renderOrder={RENDER_ORDER.BOARD_OUTLINE}>
      <lineBasicMaterial
        color={tintColor ?? PCB_LAYER_COLORS["Edge.Cuts"]}
        depthTest={false}
        depthWrite={false}
        transparent
        opacity={0.85}
      />
    </lineSegments>
  );
}

/**
 * Draggable resize grips at the 4 edge midpoints + 4 corners of a rectangular
 * board outline. Rendered only in select mode (gated by the caller). Hit-tested
 * separately in PcbCanvas via `hitBoardHandle`; these are purely visual.
 */
function BoardResizeHandles({
  outline,
}: {
  outline: PcbBoardOutline;
}): ReactElement {
  const { theme } = useCanvasTheme();
  return (
    <group>
      {BOARD_HANDLES.map((handle) => {
        const p = handlePointMm(outline, handle);
        return (
          <mesh
            key={handle}
            position={[p.x, p.y, 0]}
            renderOrder={RENDER_ORDER.BOARD_OUTLINE + 2}
          >
            <planeGeometry args={[0.7, 0.7]} />
            <meshBasicMaterial
              color={theme.pcbCanvas.selectionOutline}
              depthTest={false}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        );
      })}
    </group>
  );
}

function BoardFill({
  projection,
  visualState,
  outlineOverride,
}: {
  projection: DesignerPcbProjection;
  visualState: PcbVisualState;
  /** Live resize preview; overrides the persisted outline when set. */
  outlineOverride?: PcbBoardOutline | null;
}): ReactElement {
  const { theme } = useCanvasTheme();
  const outline = outlineOverride ?? projection.board.outline;
  const { widthMm, heightMm, centerMm } = outline;
  const cutouts = projection.board.cutouts ?? EMPTY_CUTOUTS;
  const fillColor = useMemo(() => {
    if (visualState.boardTintOpacity <= 0) return theme.pcbCanvas.boardFill;
    const base = new THREE.Color(theme.pcbCanvas.boardFill);
    const tint = new THREE.Color(
      PCB_LAYER_COLORS[visualState.activeLayer ?? "F.Cu"],
    );
    base.lerp(tint, visualState.boardTintOpacity);
    return `#${base.getHexString()}`;
  }, [theme.pcbCanvas.boardFill, visualState]);

  // Inner board substrate as a punched ShapeGeometry: outer rectangle path,
  // one circular hole per drill so the canvas background shows through.
  // `centerMm` is the group offset, so drill coords are converted to local.
  const fillGeometry = useMemo(() => {
    const halfW = widthMm / 2;
    const halfH = heightMm / 2;
    // Outer substrate from the actual outline shape (local space around center).
    const shape = outlineToShape(outline, centerMm);
    // Internal cutouts punch holes through the substrate.
    for (const cut of cutouts) {
      shape.holes.push(cutoutToPath(cut.shape, centerMm));
    }
    const drills = collectDrills(
      projection.vias,
      projection.placements,
      projection.freeHoles,
      projection.freePads,
    );
    for (const drill of drills) {
      const localX = drill.centerMm.x - centerMm.x;
      const localY = drill.centerMm.y - centerMm.y;
      // Reject drills outside the bbox (defensive — placements past board
      // edge punch nothing, otherwise THREE silently produces invalid geom).
      if (
        localX - drill.radiusMm < -halfW ||
        localX + drill.radiusMm > halfW ||
        localY - drill.radiusMm < -halfH ||
        localY + drill.radiusMm > halfH
      ) {
        continue;
      }
      const hole = new THREE.Path();
      hole.absarc(localX, localY, drill.radiusMm, 0, Math.PI * 2, false);
      shape.holes.push(hole);
    }
    return new THREE.ShapeGeometry(shape);
  }, [
    outline,
    cutouts,
    widthMm,
    heightMm,
    centerMm.x,
    centerMm.y,
    centerMm,
    projection.vias,
    projection.placements,
    projection.freeHoles,
    projection.freePads,
  ]);
  useEffect(() => () => fillGeometry.dispose(), [fillGeometry]);

  // NOTE: must be opaque. With `transparent: true`, three.js renders this in
  // the transparent pass *after* opaque pads / silkscreen, so a 0.95-opacity
  // fill paints over the components and washes them out. depthTest:false
  // alone doesn't change the opaque/transparent pass split.
  //
  // Two-pass substrate: outer solid "shoulder" plane provides a subtle
  // bevel; inner ShapeGeometry plane is punched at every drill so the
  // background reads through (real cutouts, not painted-on black discs).
  const shoulderMm = 0.35;
  return (
    <group position={[centerMm.x, centerMm.y, 0]}>
      <mesh position={[0, 0, -0.02]} renderOrder={RENDER_ORDER.BOARD_FILL - 1}>
        <planeGeometry
          args={[widthMm + shoulderMm * 2, heightMm + shoulderMm * 2]}
        />
        <meshBasicMaterial
          color="#1f242c"
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <mesh
        geometry={fillGeometry}
        position={[0, 0, -0.01]}
        renderOrder={RENDER_ORDER.BOARD_FILL}
      >
        <meshBasicMaterial
          color={fillColor}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

interface RatsnestLayerProps {
  projection: DesignerPcbProjection;
  dragOverride?: ReadonlyMap<string, PcbPointMm> | null;
  selectedPlacementIds?: ReadonlySet<string>;
  highlightedNetId?: string | null;
  visible: boolean;
  /**
   * When set, segments matching this net id are skipped — used during route
   * mode so the static ratsnest doesn't fight with the dynamic cursor-guide.
   */
  suppressNetId?: string | null;
  visualState: PcbVisualState;
}

interface RatsnestGroup {
  color: string;
  /** Full-opacity segments — highlighted, or scoped to selection. */
  bright: Float32Array | null;
  /** Reduced-opacity segments — everything else. */
  dim: Float32Array | null;
}

function RatsnestLayer({
  projection,
  dragOverride,
  selectedPlacementIds,
  highlightedNetId,
  visible,
  suppressNetId,
  visualState,
}: RatsnestLayerProps): ReactElement | null {
  const fallbackColor = "#d4d4d8";

  const placementPositions = useMemo(() => {
    const map = new Map<string, PcbPointMm>();
    for (const placement of projection.placements) {
      map.set(placement.id, placement.positionMm);
    }
    return map;
  }, [projection.placements]);

  const adjustEndpoint = useCallback(
    (placementId: string, point: PcbPointMm): PcbPointMm => {
      const override = dragOverride?.get(placementId);
      if (!override) return point;
      const original = placementPositions.get(placementId);
      if (!original) return point;
      return {
        x: point.x + override.x - original.x,
        y: point.y + override.y - original.y,
      };
    },
    [dragOverride, placementPositions],
  );

  const groups = useMemo(() => {
    const byColor = new Map<string, { bright: number[]; dim: number[] }>();
    for (const seg of projection.ratsnest) {
      if (suppressNetId && seg.netId === suppressNetId) continue;
      const color = fallbackColor;
      let bucket = byColor.get(color);
      if (!bucket) {
        bucket = { bright: [], dim: [] };
        byColor.set(color, bucket);
      }
      const isHighlighted =
        highlightedNetId !== null &&
        highlightedNetId !== undefined &&
        seg.netId === highlightedNetId;
      const placementsScoped =
        selectedPlacementIds !== undefined && selectedPlacementIds.size > 0;
      const isLocal =
        placementsScoped &&
        (selectedPlacementIds.has(seg.fromPlacementId) ||
          selectedPlacementIds.has(seg.toPlacementId));
      // When something is highlighted/scoped, "bright" wins; otherwise everything is bright.
      const scopingActive =
        (highlightedNetId !== null && highlightedNetId !== undefined) ||
        placementsScoped;
      const target =
        !scopingActive || isHighlighted || isLocal ? bucket.bright : bucket.dim;
      const fromMm = adjustEndpoint(seg.fromPlacementId, seg.fromMm);
      const toMm = adjustEndpoint(seg.toPlacementId, seg.toMm);
      target.push(fromMm.x, fromMm.y, 0, toMm.x, toMm.y, 0);
    }
    const result: RatsnestGroup[] = [];
    for (const [color, vals] of byColor) {
      result.push({
        color,
        bright: vals.bright.length > 0 ? new Float32Array(vals.bright) : null,
        dim: vals.dim.length > 0 ? new Float32Array(vals.dim) : null,
      });
    }
    return result;
  }, [
    projection.ratsnest,
    adjustEndpoint,
    highlightedNetId,
    selectedPlacementIds,
    suppressNetId,
  ]);

  if (!visible || groups.length === 0) return null;

  return (
    <>
      {groups.map((g, idx) => (
        <RatsnestGroupRender key={idx} group={g} visualState={visualState} />
      ))}
    </>
  );
}

function RatsnestGroupRender({
  group,
  visualState,
}: {
  group: RatsnestGroup;
  visualState: PcbVisualState;
}): ReactElement {
  // Buffer geometry with computeLineDistances() so LineDashedMaterial can draw
  // dashes. lineSegments uses pairs of vertices per segment, so we let three
  // compute attributes itself via a Line wrapper-style buffer.
  const brightGeom = useMemo(() => {
    if (!group.bright) return null;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(group.bright, 3));
    geom.computeBoundingSphere();
    return geom;
  }, [group.bright]);
  const dimGeom = useMemo(() => {
    if (!group.dim) return null;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(group.dim, 3));
    geom.computeBoundingSphere();
    return geom;
  }, [group.dim]);
  useEffect(
    () => () => {
      brightGeom?.dispose();
      dimGeom?.dispose();
    },
    [brightGeom, dimGeom],
  );
  return (
    <>
      {brightGeom ? (
        <DashedLineSegments
          geometry={brightGeom}
          color={group.color}
          opacity={visualState.ratsnestOpacity}
        />
      ) : null}
      {dimGeom ? (
        <DashedLineSegments
          geometry={dimGeom}
          color={group.color}
          opacity={visualState.ratsnestDimOpacity}
        />
      ) : null}
    </>
  );
}

/** lineSegments + LineDashedMaterial. Calls computeLineDistances on the
 * underlying THREE.LineSegments after mount so dashes render correctly. */
function DashedLineSegments({
  geometry,
  color,
  opacity,
}: {
  geometry: THREE.BufferGeometry;
  color: string;
  opacity: number;
}): ReactElement {
  const ref = useRef<THREE.LineSegments>(null);
  useEffect(() => {
    ref.current?.computeLineDistances();
  }, [geometry]);
  return (
    <lineSegments
      ref={ref}
      geometry={geometry}
      renderOrder={RENDER_ORDER.METADATA}
    >
      <lineDashedMaterial
        color={color}
        transparent
        opacity={opacity}
        depthTest={false}
        depthWrite={false}
        dashSize={0.45}
        gapSize={0.35}
      />
    </lineSegments>
  );
}

/**
 * F.Fab / F.Fabrication labels in KiCad footprints carry the `${REFERENCE}`
 * user-text token at the footprint origin (or pad-1 center for THT) — meant
 * for fabrication-only artwork. On the PCB layout canvas we hide them by
 * default to match KiCad's routing view convention; the actual reference
 * designator (e.g. "R1") is rendered via the silkscreen reference label.
 */
const PCB_HIDDEN_LAYERS: ReadonlySet<string> = new Set([
  "F.Fab",
  "B.Fab",
  "F.Fabrication",
  "B.Fabrication",
]);

function PlacementRender({
  placement,
  positionOverrideMm,
  visibleLayers,
  visualState,
  padNetIds,
  layerOpacity,
  viewSide = "top",
}: {
  placement: PcbPlacedPart;
  positionOverrideMm?: PcbPointMm;
  visibleLayers: ReadonlySet<PcbLayerId>;
  visualState: PcbVisualState;
  padNetIds: ReadonlyMap<string, string>;
  layerOpacity?: (layer: string) => number;
  viewSide?: "top" | "bottom";
}): ReactElement | null {
  const model = placement.footprint.preview;
  const position = positionOverrideMm ?? placement.positionMm;
  const rotationRad = (placement.rotationDeg * Math.PI) / 180;
  // Match the canonical 3D mirror formula (transform-helpers.ts:29-30): a
  // placement on B.Cu OR with `mirrored=true` flips X. Keeping these in sync
  // means a placement created via the new flip command renders identically
  // in 2D and 3D, and any legacy data with only one of the two flags still
  // looks right.
  const isBackLayer = placement.layer === "B.Cu";
  const scaleX = placement.mirrored || isBackLayer ? -1 : 1;

  // No footprint preview at all, or footprint with zero pads AND zero graphics:
  // render a placeholder so the user can see the part exists and where it sits.
  // Common cause: drawn-symbol committed without a real footprint, or an old
  // placeholder footprint with `preview: null`.
  const isEmptyModel =
    !model ||
    ((model.pads?.length ?? 0) === 0 && (model.graphics?.length ?? 0) === 0);

  // KiCad-style flip: a B.Cu placement remaps F.* ↔ B.* (silk, mask, paste,
  // courtyard, fab). Through-hole (`*.Cu`) pad copper spans every layer; in the
  // 2D view it must read in the FOREGROUND copper color (red top / blue bottom),
  // not the generic copper-gold — so map `*.Cu` → the viewed copper layer for
  // color/dim resolution. SMD layers still flip F↔B for back placements.
  const layerRemap = useMemo(() => {
    const viewedCopper = viewSide === "bottom" ? "B.Cu" : "F.Cu";
    return (layer: string | undefined): string | undefined =>
      layer === "*.Cu"
        ? viewedCopper
        : isBackLayer
          ? flipLayerSide(layer)
          : layer;
  }, [isBackLayer, viewSide]);

  // Dim every layer the placement contributes only while a PCB layer/net focus
  // is active. With no focused layer, all visible layers render undimmed even
  // though the board still has a routing-active copper layer.
  const dimmedLayers = useMemo<ReadonlySet<string> | undefined>(() => {
    if (visualState.activeLayer === null) return undefined;
    if (placement.layer === visualState.activeLayer) return undefined;
    return placementContributingLayers(placement.layer);
  }, [placement.layer, visualState.activeLayer]);

  const hiddenLayers = useMemo(() => {
    return new Set([
      ...PCB_HIDDEN_LAYERS,
      ...hiddenFootprintLayers(visibleLayers),
    ]);
  }, [visibleLayers]);

  const dimmedPadNumbers = useMemo<ReadonlySet<string> | undefined>(() => {
    if (!visualState.routeFocusActive || !visualState.activeNetId)
      return undefined;
    const pads = model?.pads ?? [];
    const dimmed = new Set<string>();
    for (const pad of pads) {
      const netId = padNetIds.get(`${placement.id}|${pad.number}`);
      if (netId !== visualState.activeNetId) dimmed.add(pad.number);
    }
    return dimmed;
  }, [model?.pads, padNetIds, placement.id, visualState]);

  // Layer-visibility filter: hide entire placement when its primary copper
  // layer is not in the visible set. Hooks stay above this return.
  if (!isPlacementVisible(visibleLayers, placement)) return null;

  return (
    <group
      position={[position.x, position.y, 0]}
      rotation={[0, 0, rotationRad]}
      scale={[scaleX, 1, 1]}
    >
      {model ? (
        <FootprintRenderLayer
          model={model}
          useLayerColors
          surface="pcb"
          hiddenLayers={hiddenLayers}
          dimmedLayers={dimmedLayers}
          dimmedPadNumbers={dimmedPadNumbers}
          padDimFactor={layerFocusDimFactor(visualState)}
          dimmedOpacity={layerFocusDimFactor(visualState)}
          layerRemap={layerRemap}
          layerOpacity={layerOpacity}
          hidePadNumbers={!isPcbLayerVisible(visibleLayers, "Metadata")}
          padNumberRenderOrder={RENDER_ORDER.METADATA}
          padRenderOrder={effectiveRenderOrder(
            placement.layer === "B.Cu" ? "B.Cu" : "F.Cu",
            viewSide,
            "object",
          )}
          drillRenderOrder={RENDER_ORDER.DRILL}
          placeholderSubstitutions={{ reference: placement.reference }}
        />
      ) : null}
      {isEmptyModel ? (
        <PlacementPlaceholder reference={placement.reference} />
      ) : null}
    </group>
  );
}

/** Visible fallback when a footprint has no pads/graphics — yellow dashed-look
 * outline + reference label so the user can locate and move the part. */
function PlacementPlaceholder({
  reference,
}: {
  reference: string;
}): ReactElement {
  const half = 2.5; // 5mm × 5mm placeholder
  const points = useMemo(
    () => [
      new THREE.Vector3(-half, -half, 0),
      new THREE.Vector3(half, -half, 0),
      new THREE.Vector3(half, -half, 0),
      new THREE.Vector3(half, half, 0),
      new THREE.Vector3(half, half, 0),
      new THREE.Vector3(-half, half, 0),
      new THREE.Vector3(-half, half, 0),
      new THREE.Vector3(-half, -half, 0),
    ],
    [],
  );
  const geometry = useMemo(
    () => new THREE.BufferGeometry().setFromPoints(points),
    [points],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <>
      <lineSegments geometry={geometry} renderOrder={RENDER_ORDER.BODIES}>
        <lineBasicMaterial
          color="#facc15"
          depthTest={false}
          depthWrite={false}
        />
      </lineSegments>
      <PlacementPlaceholderLabel reference={reference} />
    </>
  );
}

function PlacementPlaceholderLabel({
  reference,
}: {
  reference: string;
}): ReactElement {
  const { theme } = useCanvasTheme();
  return (
    <EDAText
      position={[0, 0, 0]}
      fontSize={1.2}
      color={theme.pcbCanvas.refdesLabel}
      anchorX="center"
      anchorY="middle"
    >
      {reference || "?"}
    </EDAText>
  );
}

function SelectionOutline({
  placement,
  positionOverrideMm,
}: {
  placement: PcbPlacedPart;
  positionOverrideMm?: PcbPointMm;
}): ReactElement | null {
  const bounds = placement.footprint.preview?.bounds;
  if (!bounds) return null;
  const position = positionOverrideMm ?? placement.positionMm;
  const rotationRad = (placement.rotationDeg * Math.PI) / 180;
  // Mirror in lockstep with PlacementRender (mirror OR back-layer).
  const scaleX = placement.mirrored || placement.layer === "B.Cu" ? -1 : 1;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const padMm = 0.4;
  const minX = cx - w / 2 - padMm;
  const maxX = cx + w / 2 + padMm;
  const minY = cy - h / 2 - padMm;
  const maxY = cy + h / 2 + padMm;
  const geometry = useMemo(() => {
    const points = [
      new THREE.Vector3(minX, minY, 0),
      new THREE.Vector3(maxX, minY, 0),
      new THREE.Vector3(maxX, minY, 0),
      new THREE.Vector3(maxX, maxY, 0),
      new THREE.Vector3(maxX, maxY, 0),
      new THREE.Vector3(minX, maxY, 0),
      new THREE.Vector3(minX, maxY, 0),
      new THREE.Vector3(minX, minY, 0),
    ];
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [maxX, maxY, minX, minY]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const handles: ReadonlyArray<readonly [number, number]> = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
  return (
    <group
      position={[position.x, position.y, 0]}
      rotation={[0, 0, rotationRad]}
      scale={[scaleX, 1, 1]}
    >
      <lineSegments geometry={geometry} renderOrder={RENDER_ORDER.SELECTION}>
        <SelectionOutlineMaterial />
      </lineSegments>
      {handles.map(([x, y], index) => (
        <SelectionHandle key={index} x={x} y={y} />
      ))}
    </group>
  );
}

function FreeHoleSelectionOutline({
  hole,
  positionOverrideMm,
}: {
  hole: PcbFreeHole;
  positionOverrideMm?: PcbPointMm;
}): ReactElement {
  const position = positionOverrideMm ?? hole.centerMm;
  const r = hole.drillMm / 2 + 0.5;
  const geometry = useMemo(() => {
    const pts = [
      new THREE.Vector3(-r, -r, 0),
      new THREE.Vector3(r, -r, 0),
      new THREE.Vector3(r, -r, 0),
      new THREE.Vector3(r, r, 0),
      new THREE.Vector3(r, r, 0),
      new THREE.Vector3(-r, r, 0),
      new THREE.Vector3(-r, r, 0),
      new THREE.Vector3(-r, -r, 0),
    ];
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [r]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const handles: ReadonlyArray<readonly [number, number]> = [
    [-r, -r],
    [r, -r],
    [r, r],
    [-r, r],
  ];
  return (
    <group position={[position.x, position.y, 0]}>
      <lineSegments geometry={geometry} renderOrder={RENDER_ORDER.SELECTION}>
        <SelectionOutlineMaterial />
      </lineSegments>
      {handles.map(([x, y], i) => (
        <SelectionHandle key={i} x={x} y={y} />
      ))}
    </group>
  );
}

function FreePadSelectionOutline({
  pad,
  positionOverrideMm,
}: {
  pad: PcbFreePad;
  positionOverrideMm?: PcbPointMm;
}): ReactElement {
  const position = positionOverrideMm ?? pad.centerMm;
  const padMm = 0.3;
  const hw = pad.widthMm / 2 + padMm;
  const hh = pad.heightMm / 2 + padMm;
  const rotRad = (pad.rotationDeg * Math.PI) / 180;
  const geometry = useMemo(() => {
    const pts = [
      new THREE.Vector3(-hw, -hh, 0),
      new THREE.Vector3(hw, -hh, 0),
      new THREE.Vector3(hw, -hh, 0),
      new THREE.Vector3(hw, hh, 0),
      new THREE.Vector3(hw, hh, 0),
      new THREE.Vector3(-hw, hh, 0),
      new THREE.Vector3(-hw, hh, 0),
      new THREE.Vector3(-hw, -hh, 0),
    ];
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [hw, hh]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const handles: ReadonlyArray<readonly [number, number]> = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  return (
    <group position={[position.x, position.y, 0]} rotation={[0, 0, rotRad]}>
      <lineSegments geometry={geometry} renderOrder={RENDER_ORDER.SELECTION}>
        <SelectionOutlineMaterial />
      </lineSegments>
      {handles.map(([x, y], i) => (
        <SelectionHandle key={i} x={x} y={y} />
      ))}
    </group>
  );
}

function OverlayTextSelectionOutline({
  text,
  positionOverrideMm,
}: {
  text: PcbOverlayText;
  positionOverrideMm?: PcbPointMm;
}): ReactElement {
  const position = positionOverrideMm ?? text.positionMm;
  const rotRad = (text.rotationDeg * Math.PI) / 180;
  const hw = (text.fontSizeMm * text.text.length * 0.6) / 2 + 0.4;
  const hh = text.fontSizeMm / 2 + 0.3;
  const geometry = useMemo(() => {
    const pts = [
      new THREE.Vector3(-hw, -hh, 0),
      new THREE.Vector3(hw, -hh, 0),
      new THREE.Vector3(hw, -hh, 0),
      new THREE.Vector3(hw, hh, 0),
      new THREE.Vector3(hw, hh, 0),
      new THREE.Vector3(-hw, hh, 0),
      new THREE.Vector3(-hw, hh, 0),
      new THREE.Vector3(-hw, -hh, 0),
    ];
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [hw, hh]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const handles: ReadonlyArray<readonly [number, number]> = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ];
  return (
    <group position={[position.x, position.y, 0]} rotation={[0, 0, rotRad]}>
      <lineSegments geometry={geometry} renderOrder={RENDER_ORDER.SELECTION}>
        <SelectionOutlineMaterial />
      </lineSegments>
      {handles.map(([x, y], i) => (
        <SelectionHandle key={i} x={x} y={y} />
      ))}
    </group>
  );
}

type PcbLayerSide = "top" | "bottom";

function focusedLayerSide(layer: PcbCopperLayerId | null): PcbLayerSide | null {
  if (layer === null) return null;
  if (layer === "B.Cu") return "bottom";
  return "top";
}

function maskOpacityForSide(
  visualState: PcbVisualState,
  side: PcbLayerSide,
): number {
  if (visualState.routeFocusActive) return 0.16;
  const focusedSide = focusedLayerSide(visualState.activeLayer);
  // In all-layers mode the solder-mask pass is contextual only. A high-opacity
  // black mask plane physically sits above bottom copper and makes B.Cu look
  // incorrectly dimmed even when no layer is focused.
  if (focusedSide === null) return 0.08;
  return focusedSide === side ? 0.18 : 0.05;
}

function pasteOpacityForSide(
  visualState: PcbVisualState,
  side: PcbLayerSide,
): number {
  if (visualState.routeFocusActive) return 0.25;
  const focusedSide = focusedLayerSide(visualState.activeLayer);
  if (focusedSide === null) return 0.85;
  return focusedSide === side ? 0.45 : 0.08;
}

function layerFocusDimFactor(visualState: PcbVisualState): number {
  if (visualState.routeFocusActive) return 0.18;
  if (visualState.activeLayer !== null) return 0.14;
  return 0.32;
}

function SelectionHandle({ x, y }: { x: number; y: number }): ReactElement {
  const { theme } = useCanvasTheme();
  return (
    <mesh position={[x, y, 0]} renderOrder={RENDER_ORDER.SELECTION + 1}>
      <circleGeometry args={[0.16, 16]} />
      <meshBasicMaterial
        color={theme.pcbCanvas.selectionOutline}
        depthTest={false}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function SelectionOutlineMaterial(): ReactElement {
  const { theme } = useCanvasTheme();
  return (
    <lineBasicMaterial
      color={theme.pcbCanvas.selectionOutline}
      depthTest={false}
      depthWrite={false}
    />
  );
}

/**
 * While routing, draws a single dashed airwire from the cursor to the closest
 * pad on the active net (excluding `excludePadIds`). Mirrors the Flux.ai /
 * KiCad behaviour where the ratsnest "follows" the cursor as the user routes.
 */
function DynamicRatsnestGuide({
  ratsnest,
  cursorMm,
  netId,
  excludePadIds,
  netClasses,
}: {
  ratsnest: ReadonlyArray<{
    netId: string;
    netClassId: string;
    fromMm: PcbPointMm;
    toMm: PcbPointMm;
    fromPlacementId: string;
    fromPadNumber: string;
    toPlacementId: string;
    toPadNumber: string;
  }>;
  cursorMm: PcbPointMm;
  netId: string;
  excludePadIds?: ReadonlySet<string>;
  netClasses: ReadonlyArray<{ id: string; color: string }>;
}): ReactElement | null {
  const guide = useMemo(() => {
    type Pad = {
      id: string;
      x: number;
      y: number;
      netClassId: string;
    };
    const pads = new Map<string, Pad>();
    for (const seg of ratsnest) {
      if (seg.netId !== netId) continue;
      const fromKey = `${seg.fromPlacementId}|${seg.fromPadNumber}`;
      const toKey = `${seg.toPlacementId}|${seg.toPadNumber}`;
      if (!pads.has(fromKey)) {
        pads.set(fromKey, {
          id: fromKey,
          x: seg.fromMm.x,
          y: seg.fromMm.y,
          netClassId: seg.netClassId,
        });
      }
      if (!pads.has(toKey)) {
        pads.set(toKey, {
          id: toKey,
          x: seg.toMm.x,
          y: seg.toMm.y,
          netClassId: seg.netClassId,
        });
      }
    }
    let closest: Pad | null = null;
    let bestDistSq = Infinity;
    for (const pad of pads.values()) {
      if (excludePadIds?.has(pad.id)) continue;
      const dx = pad.x - cursorMm.x;
      const dy = pad.y - cursorMm.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        closest = pad;
      }
    }
    if (!closest) return null;
    const cls = netClasses.find((c) => c.id === closest!.netClassId);
    void cls;
    return {
      from: cursorMm,
      to: { x: closest.x, y: closest.y },
      color: "#d4d4d8",
    };
  }, [ratsnest, cursorMm, netId, excludePadIds, netClasses]);

  const geom = useMemo(() => {
    if (!guide) return null;
    const g = new THREE.BufferGeometry();
    const positions = new Float32Array([
      guide.from.x,
      guide.from.y,
      0,
      guide.to.x,
      guide.to.y,
      0,
    ]);
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, [guide]);
  useEffect(
    () => () => {
      geom?.dispose();
    },
    [geom],
  );
  if (!guide || !geom) return null;
  return <DashedLineSegments geometry={geom} color={guide.color} opacity={1} />;
}

interface PcbSceneProps {
  projection: DesignerPcbProjection;
  selection?: PcbSelection;
  /**
   * Live board-outline preview while drag-resizing. When set, the board
   * outline + substrate render at this rect instead of the persisted one.
   */
  outlineOverride?: PcbBoardOutline | null;
  /** Show draggable board resize handles (select tool). */
  boardHandlesVisible?: boolean;
  /** Per-placement live drag preview positions (group drag). */
  dragOverride?: ReadonlyMap<string, PcbPointMm> | null;
  /** Live drag preview positions for free primitives (hole/pad/text). */
  freePrimitiveDragOverrides?: {
    freeHoles?: ReadonlyMap<string, PcbPointMm>;
    freePads?: ReadonlyMap<string, PcbPointMm>;
    overlayTexts?: ReadonlyMap<string, PcbPointMm>;
  } | null;
  highlightedNetId?: string | null;
  ratsnestVisible?: boolean;
  /** Board view orientation. `"bottom"` mirrors the scene horizontally. */
  viewSide?: "top" | "bottom";
  /**
   * Non-active layer emphasis (KiCad-style Normal/Dim/Solo). When unset,
   * defaults to `"normal"` and matches pre-Phase-6 behavior. Trace and via
   * layers consume this via the existing `inactive` channel — Solo collapses
   * non-active copper to hidden, Dim keeps the existing 50%-opacity dim.
   */
  displayMode?: "normal" | "dim" | "solo";
  /**
   * Active route session for dynamic ratsnest guidance. When set, the static
   * ratsnest segments anchored at the route's start pad are hidden and a
   * single dashed airwire is drawn from `cursorMm` to the closest other pad
   * on `netId`. Mirrors Flux.ai's cursor-tracking guide.
   */
  routeGuide?: {
    cursorMm: PcbPointMm;
    netId: string;
    /** Pad ids ("placementId|padNumber") to exclude — typically the route's start pad. */
    excludePadIds?: ReadonlySet<string>;
  } | null;
  /**
   * In-progress route preview. LineSegments2 cannot live under a negative-scale
   * parent, so this is rendered outside the mirror group and pre-mirrored.
   */
  routePreview?: {
    pointsNm: Array<{ x: number; y: number }>;
    layer: PcbCopperLayerId;
    widthMm: number;
  } | null;
  routeFocusActive?: boolean;
  routeFocusLayer?: PcbCopperLayerId;
  focusedLayer?: PcbCopperLayerId | null;
  copperFillLayers?: ReadonlyArray<PcbCopperLayerId>;
  /**
   * Rubber-band marquee overlay rendered inside the mirror group so selection
   * rect aligns with board content in both top and bottom view.
   */
  marqueeOverlay?: {
    a: { x: number; y: number } | null;
    b: { x: number; y: number } | null;
    color: string;
  } | null;
  measurement?: {
    start: PcbPointMm;
    end: PcbPointMm;
    showDeltas: boolean;
  } | null;
  /**
   * Active snap target. Rendered as a color-coded ring at the resolved
   * point so the user can see where a click would land. The snap engine
   * (`snap.ts`) chooses pad-center > trace-end > via-center; this prop is
   * what gets visualized.
   */
  snapTarget?: {
    kind: "pad-center" | "trace-endpoint" | "trace-segment-end" | "via-center";
    pointMm: PcbPointMm;
  } | null;
  initialViewport?: ViewportState | null;
  onViewportChange?: (zoom: number, posX: number, posY: number) => void;
  /** Called once the R3F camera is ready; pass `null` on unmount. */
  onCameraReady?: (controls: PcbCameraControls | null) => void;
}

export function PcbScene({
  projection,
  selection,
  outlineOverride = null,
  boardHandlesVisible = false,
  dragOverride,
  freePrimitiveDragOverrides,
  highlightedNetId,
  ratsnestVisible = true,
  viewSide = "top",
  displayMode = "normal",
  routeGuide = null,
  routePreview = null,
  routeFocusActive = false,
  routeFocusLayer,
  focusedLayer = null,
  copperFillLayers = [],
  marqueeOverlay = null,
  measurement = null,
  snapTarget = null,
  initialViewport,
  onViewportChange,
  onCameraReady,
}: PcbSceneProps): ReactElement {
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    invalidate();
  }, [
    projection,
    selection,
    outlineOverride,
    boardHandlesVisible,
    dragOverride,
    freePrimitiveDragOverrides,
    highlightedNetId,
    ratsnestVisible,
    viewSide,
    displayMode,
    routeGuide,
    routePreview,
    routeFocusActive,
    focusedLayer,
    copperFillLayers,
    marqueeOverlay,
    measurement,
    invalidate,
  ]);

  const selectedPlacementIds = selection?.placementIds;
  const visibleLayers = useMemo(
    () => visibleLayerSet(projection.board.visibleLayers),
    [projection.board.visibleLayers],
  );
  const renderPlacements = useMemo<ReadonlyArray<PcbPlacedPart>>(() => {
    if (!dragOverride || dragOverride.size === 0) return projection.placements;
    return projection.placements.map((placement) => {
      const override = dragOverride.get(placement.id);
      if (!override) return placement;
      return {
        ...placement,
        positionMm: override,
      };
    });
  }, [dragOverride, projection.placements]);
  const selectedPlacements = useMemo(() => {
    if (!selectedPlacementIds || selectedPlacementIds.size === 0) return [];
    return renderPlacements.filter(
      (p) =>
        selectedPlacementIds.has(p.id) && isPlacementVisible(visibleLayers, p),
    );
  }, [renderPlacements, selectedPlacementIds, visibleLayers]);

  const selectedFreeHoles = useMemo(() => {
    const ids = selection?.freeHoleIds;
    if (!ids || ids.size === 0) return [];
    return projection.freeHoles.filter((h) => ids.has(h.id));
  }, [projection.freeHoles, selection?.freeHoleIds]);

  const selectedFreePads = useMemo(() => {
    const ids = selection?.freePadIds;
    if (!ids || ids.size === 0) return [];
    return projection.freePads.filter((p) => ids.has(p.id));
  }, [projection.freePads, selection?.freePadIds]);

  const selectedOverlayTexts = useMemo(() => {
    const ids = selection?.overlayTextIds;
    if (!ids || ids.size === 0) return [];
    return projection.overlayTexts.filter((t) => ids.has(t.id));
  }, [projection.overlayTexts, selection?.overlayTextIds]);

  const renderFreeHoles = useMemo(() => {
    const overrides = freePrimitiveDragOverrides?.freeHoles;
    if (!overrides || overrides.size === 0) return projection.freeHoles;
    return projection.freeHoles.map((h) => {
      const override = overrides.get(h.id);
      return override ? { ...h, centerMm: override } : h;
    });
  }, [projection.freeHoles, freePrimitiveDragOverrides?.freeHoles]);

  const renderFreePads = useMemo(() => {
    const overrides = freePrimitiveDragOverrides?.freePads;
    if (!overrides || overrides.size === 0) return projection.freePads;
    return projection.freePads.map((p) => {
      const override = overrides.get(p.id);
      return override ? { ...p, centerMm: override } : p;
    });
  }, [projection.freePads, freePrimitiveDragOverrides?.freePads]);

  const renderOverlayTexts = useMemo(() => {
    const overrides = freePrimitiveDragOverrides?.overlayTexts;
    if (!overrides || overrides.size === 0) return projection.overlayTexts;
    return projection.overlayTexts.map((t) => {
      const override = overrides.get(t.id);
      return override ? { ...t, positionMm: override } : t;
    });
  }, [projection.overlayTexts, freePrimitiveDragOverrides?.overlayTexts]);

  // Bottom-view mirror: driven by the canvas's Top/Bottom layer switch.
  // Pointer events compensate via `interactionCoordinateTransform`.
  const mirror = viewSide === "bottom";
  const sceneScaleX = mirror ? -1 : 1;
  const activeCopperLayer: PcbCopperLayerId =
    projection.board.activeLayer === "B.Cu" ||
    projection.board.activeLayer === "In1.Cu" ||
    projection.board.activeLayer === "In2.Cu"
      ? projection.board.activeLayer
      : "F.Cu";
  const visualState = useMemo(
    () =>
      createPcbVisualState({
        displayMode,
        activeLayer: routeFocusActive
          ? (routeFocusLayer ?? routePreview?.layer ?? activeCopperLayer)
          : focusedLayer,
        routeNetId: routeGuide?.netId ?? null,
        routeFocusActive,
      }),
    [
      activeCopperLayer,
      displayMode,
      routeFocusActive,
      routeFocusLayer,
      focusedLayer,
      routeGuide?.netId,
      routePreview?.layer,
    ],
  );
  const padNetIds = useMemo(
    () =>
      buildPadNetIds(
        projection.ratsnest,
        projection.placements,
        projection.traces,
      ),
    [projection.ratsnest, projection.placements, projection.traces],
  );
  // Per-layer opacity overrides from the panel's slider. Multiplied against
  // the layer's display-mode opacity so dim + per-layer attenuation compose.
  const perLayerOpacity = usePcbViewStore((s) => s.viewState.perLayerOpacity);
  const layerOpacityFor = useCallback(
    (layer: string): number => {
      const v = perLayerOpacity[layer as PcbLayerId];
      return v === undefined ? 1 : v;
    },
    [perLayerOpacity],
  );
  const copperFillSet = useMemo(
    () => new Set<PcbCopperLayerId>(copperFillLayers),
    [copperFillLayers],
  );
  const copperFillPourNetIds = usePcbViewStore(
    (s) => s.viewState.copperFillPourNetIds,
  );
  // Pre-bucket traces and vias by copper layer once per projection so each
  // <CopperFillLayer> receives an identity-stable array slice. Without this
  // the inner useMemo would invalidate on every render (fresh filter result
  // each time defeats reference equality).
  const tracesByLayer = useMemo(() => {
    const map: Record<PcbCopperLayerId, PcbTrace[]> = {
      "F.Cu": [],
      "In1.Cu": [],
      "In2.Cu": [],
      "B.Cu": [],
    };
    for (const trace of projection.traces) {
      map[trace.layer].push(trace);
    }
    return map;
  }, [projection.traces]);
  // Vias are bucketed by every layer their barrel crosses. v1 vias are always
  // through (F.Cu↔B.Cu) so every via lands in all four buckets; the helper
  // keeps the door open for v2 blind/buried vias without changing this site.
  const viasByLayer = useMemo(() => {
    const map: Record<PcbCopperLayerId, PcbVia[]> = {
      "F.Cu": [],
      "In1.Cu": [],
      "In2.Cu": [],
      "B.Cu": [],
    };
    for (const via of projection.vias) {
      for (const layer of ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"] as const) {
        if (viaCrossesLayer(via, layer)) map[layer].push(via);
      }
    }
    return map;
  }, [projection.vias]);
  // Vias whose net matches a rendered same-net pour they cross. Such a via's
  // copper ring would otherwise be invisible (same color as the pour it merges
  // into), so ViaLayer draws a presentation-only board-color separator ring
  // around it (Flux look). The pour fill itself keeps the electrical merge.
  const samePourViaIds = useMemo(() => {
    const ids = new Set<string>();
    if (copperFillSet.size === 0) return ids;
    for (const via of projection.vias) {
      if (via.netId === null) continue;
      for (const layer of ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"] as const) {
        if (!copperFillSet.has(layer)) continue;
        if ((copperFillPourNetIds[layer] ?? null) !== via.netId) continue;
        if (viaCrossesLayer(via, layer)) {
          ids.add(via.id);
          break;
        }
      }
    }
    return ids;
  }, [projection.vias, copperFillSet, copperFillPourNetIds]);
  const effectiveHighlightedNetId = visualState.routeFocusActive
    ? visualState.activeNetId
    : visualState.activeLayer === null
      ? highlightedNetId
      : null;

  // LineSegments2 does not render correctly under a negative-scale parent
  // group (the three.js addons line renderer breaks with negative determinant
  // model matrices). TraceLayer and TracePreviewLayer are therefore rendered
  // OUTSIDE the mirror group; they use the `mirror` prop to pre-negate X in
  // their geometry instead. All other primitives stay inside the group.
  return (
    <>
      {(["B.Cu", "In2.Cu", "In1.Cu", "F.Cu"] as const).map((layer) =>
        isCopperLayerVisible(visibleLayers, layer) &&
        shouldRenderCopperLayer(visualState, layer) ? (
          <TraceLayer
            key={layer}
            traces={projection.traces}
            layer={layer}
            highlightedNetId={effectiveHighlightedNetId}
            selectedTraceIds={selection?.traceIds}
            inactiveOpacity={
              (visualState.routeFocusActive && visualState.activeNetId
                ? 1
                : layerOpacity(visualState, layer)) * layerOpacityFor(layer)
            }
            dimOpacity={visualState.inactiveNetOpacity}
            mirror={mirror}
            viewSide={viewSide}
          />
        ) : null,
      )}
      {routePreview ? (
        <TracePreviewLayer
          pointsNm={routePreview.pointsNm}
          layer={routePreview.layer}
          widthMm={routePreview.widthMm}
          mirror={mirror}
        />
      ) : null}
      <group scale={[sceneScaleX, 1, 1]}>
        <FitBoardOnMount
          outline={projection.board.outline}
          initialViewport={initialViewport}
        />
        {onCameraReady && (
          <CameraControlsBridge
            outline={projection.board.outline}
            onReady={onCameraReady}
          />
        )}
        {onViewportChange && (
          <ViewportReporter onViewportChange={onViewportChange} />
        )}
        <GridShader
          gridSize={1}
          majorEvery={5}
          color="#3f4754"
          alpha={0.22}
          majorAlpha={0.45}
          minSpacingPx={5}
        />
        <BoardFill
          projection={projection}
          visualState={visualState}
          outlineOverride={outlineOverride}
        />
        <BoardOutline
          projection={projection}
          visibleLayers={visibleLayers}
          outlineOverride={outlineOverride}
        />
        {boardHandlesVisible ? (
          <BoardResizeHandles
            outline={outlineOverride ?? projection.board.outline}
          />
        ) : null}
        {(["B.Cu", "In2.Cu", "In1.Cu", "F.Cu"] as const).map((layer) =>
          copperFillSet.has(layer) &&
          isCopperLayerVisible(visibleLayers, layer) &&
          shouldRenderCopperLayer(visualState, layer) ? (
            <CopperFillLayer
              key={`fill:${layer}`}
              layer={layer}
              outline={projection.board.outline}
              // Feed the pour COMMITTED geometry, not the per-frame drag
              // overrides: the Clipper pour is expensive and would otherwise
              // rebuild every frame (×N copper layers) while dragging a part /
              // free primitive. The moat refreshes once on commit — standard
              // EDA "pour is stale during edit" behavior.
              placements={projection.placements}
              traces={tracesByLayer[layer]}
              vias={viasByLayer[layer]}
              pourNetId={copperFillPourNetIds[layer] ?? null}
              padNetIds={padNetIds}
              designRules={projection.board.designRules}
              cutouts={projection.board.cutouts}
              freeHoles={projection.freeHoles}
              freePads={projection.freePads}
              opacity={
                layerOpacity(visualState, layer) * layerOpacityFor(layer)
              }
              viewSide={viewSide}
            />
          ) : null,
        )}
        {renderPlacements.map((placement) => (
          <PlacementRender
            key={placement.id}
            placement={placement}
            visibleLayers={visibleLayers}
            visualState={visualState}
            padNetIds={padNetIds}
            layerOpacity={layerOpacityFor}
            viewSide={viewSide}
          />
        ))}
        {areViasVisible(visibleLayers) ? (
          <ViaLayer
            vias={projection.vias}
            highlightedNetId={effectiveHighlightedNetId}
            selectedViaIds={selection?.viaIds}
            activeLayer={projection.board.activeLayer}
            focusNetAcrossLayers={visualState.routeFocusActive}
            samePourViaIds={samePourViaIds}
          />
        ) : null}
        {/* Hole cutouts are intrinsic pad/via geometry — always rendered so a
            plated hole reads as a hole even with the "Drill" layer hidden. */}
        <DrillHoleCutoutLayer
          vias={projection.vias}
          placements={renderPlacements}
          freeHoles={renderFreeHoles}
          freePads={renderFreePads}
        />
        {/* Drill highlights (lime outline, mounting/selection rings) are
            annotations — gated by the "Drill" layer toggle. */}
        {isPcbLayerVisible(visibleLayers, "Drill") ? (
          <DrillHighlightLayer
            vias={projection.vias}
            placements={renderPlacements}
            freeHoles={renderFreeHoles}
            freePads={renderFreePads}
            selectedFreeHoleIds={selection?.freeHoleIds}
            showMountingHoleRing={isPcbLayerVisible(visibleLayers, "F.SilkS")}
          />
        ) : null}
        {/* Occlusion pass: re-assert plated holes ABOVE selected traces /
            ratsnest / net labels (which sort above the copper-level cutout), so
            no copper ever reads inside a hole — the robust fix for a trace
            crossing a pad/via hole (Codex review). Kept below snap
            (SELECTION+0.5) and measurement (SELECTION+1) so those stay on top. */}
        <DrillHoleCutoutLayer
          vias={projection.vias}
          placements={renderPlacements}
          freeHoles={renderFreeHoles}
          freePads={renderFreePads}
          renderOrder={RENDER_ORDER.SELECTION + 0.25}
        />
        {(["B.Cu", "In2.Cu", "In1.Cu", "F.Cu"] as const).map((layer) =>
          isCopperLayerVisible(visibleLayers, layer) &&
          shouldRenderCopperLayer(visualState, layer) ? (
            <FreePadLayer
              key={`free-pad:${layer}`}
              freePads={renderFreePads}
              layer={layer}
              viewSide={viewSide}
              selectedFreePadIds={selection?.freePadIds}
              opacity={
                layerOpacity(visualState, layer) * layerOpacityFor(layer)
              }
            />
          ) : null,
        )}
        <OverlayLayer
          texts={renderOverlayTexts}
          shapes={projection.overlayShapes}
          viewSide={viewSide}
          selectedOverlayTextIds={selection?.overlayTextIds}
        />
        {isPcbLayerVisible(visibleLayers, "B.Mask") ? (
          <SolderMaskLayer
            side="bottom"
            placements={renderPlacements}
            outline={projection.board.outline}
            expansionMm={projection.board.solderMaskExpansionMm}
            opacity={
              maskOpacityForSide(visualState, "bottom") *
              layerOpacityFor("B.Mask")
            }
            viewSide={viewSide}
          />
        ) : null}
        {isPcbLayerVisible(visibleLayers, "F.Mask") ? (
          <SolderMaskLayer
            side="top"
            placements={renderPlacements}
            outline={projection.board.outline}
            expansionMm={projection.board.solderMaskExpansionMm}
            opacity={
              maskOpacityForSide(visualState, "top") * layerOpacityFor("F.Mask")
            }
            viewSide={viewSide}
          />
        ) : null}
        {isPcbLayerVisible(visibleLayers, "B.Paste") ? (
          <SolderPasteLayer
            side="bottom"
            placements={renderPlacements}
            expansionMm={projection.board.solderPasteExpansionMm}
            opacity={
              pasteOpacityForSide(visualState, "bottom") *
              layerOpacityFor("B.Paste")
            }
            viewSide={viewSide}
          />
        ) : null}
        {isPcbLayerVisible(visibleLayers, "F.Paste") ? (
          <SolderPasteLayer
            side="top"
            placements={renderPlacements}
            expansionMm={projection.board.solderPasteExpansionMm}
            opacity={
              pasteOpacityForSide(visualState, "top") *
              layerOpacityFor("F.Paste")
            }
            viewSide={viewSide}
          />
        ) : null}
        {isPcbLayerVisible(visibleLayers, "Metadata")
          ? (["B.Cu", "In2.Cu", "In1.Cu", "F.Cu"] as const).map((layer) =>
              isCopperLayerVisible(visibleLayers, layer) ? (
                <NetTraceLabels
                  key={layer}
                  traces={projection.traces}
                  netNames={projection.netNames}
                  layer={layer}
                  opacity={1}
                  counterMirror={mirror}
                />
              ) : null,
            )
          : null}
        <RatsnestLayer
          projection={projection}
          dragOverride={dragOverride}
          selectedPlacementIds={selectedPlacementIds}
          highlightedNetId={effectiveHighlightedNetId}
          visible={
            ratsnestVisible && isPcbLayerVisible(visibleLayers, "Metadata")
          }
          suppressNetId={routeGuide?.netId}
          visualState={visualState}
        />
        {routeGuide && isPcbLayerVisible(visibleLayers, "Metadata") ? (
          <DynamicRatsnestGuide
            ratsnest={projection.ratsnest}
            cursorMm={routeGuide.cursorMm}
            netId={routeGuide.netId}
            excludePadIds={routeGuide.excludePadIds}
            netClasses={projection.board.netClasses}
          />
        ) : null}
        {selectedPlacements.map((placement) => (
          <SelectionOutline key={placement.id} placement={placement} />
        ))}
        {selectedFreeHoles.map((hole) => (
          <FreeHoleSelectionOutline
            key={hole.id}
            hole={hole}
            positionOverrideMm={freePrimitiveDragOverrides?.freeHoles?.get(
              hole.id,
            )}
          />
        ))}
        {selectedFreePads.map((pad) => (
          <FreePadSelectionOutline
            key={pad.id}
            pad={pad}
            positionOverrideMm={freePrimitiveDragOverrides?.freePads?.get(
              pad.id,
            )}
          />
        ))}
        {selectedOverlayTexts.map((text) => (
          <OverlayTextSelectionOutline
            key={text.id}
            text={text}
            positionOverrideMm={freePrimitiveDragOverrides?.overlayTexts?.get(
              text.id,
            )}
          />
        ))}
        <SelectionRectOverlay
          a={marqueeOverlay?.a ?? null}
          b={marqueeOverlay?.b ?? null}
          color={marqueeOverlay?.color ?? "#60a5fa"}
        />
        {measurement ? (
          <MeasureOverlayLayer
            start={measurement.start}
            end={measurement.end}
            showDeltas={measurement.showDeltas}
            counterMirror={mirror}
          />
        ) : null}
        {snapTarget ? (
          <SnapTargetIndicator
            pointMm={snapTarget.pointMm}
            kind={snapTarget.kind}
          />
        ) : null}
      </group>
    </>
  );
}
