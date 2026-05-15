import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type ReactElement } from "react";
import * as THREE from "three";
import type {
  DesignerPcbProjection,
  PcbBoardOutline,
  PcbCopperLayerId,
  PcbLayerId,
  PcbPlacedPart,
  PcbPointMm,
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
} from "../../../../shared/frontend/canvas/layers";
import { useCanvasTheme } from "../../../../shared/frontend/canvas/theme";
import { TraceLayer } from "./layers/TraceLayer";
import { TracePreviewLayer } from "./layers/TracePreviewLayer";
import { ViaLayer } from "./layers/ViaLayer";
import { DrillLayer } from "./layers/DrillLayer";
import { SolderMaskLayer } from "./layers/SolderMaskLayer";
import { SolderPasteLayer } from "./layers/SolderPasteLayer";
import { NetTraceLabels } from "./layers/NetTraceLabels";
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
    } else {
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
    }
    camera.updateProjectionMatrix();
    invalidate();
    // runs only on mount; PcbCanvas remounts (key=designId) on design switch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
}: {
  projection: DesignerPcbProjection;
  visibleLayers: ReadonlySet<PcbLayerId>;
  /** Optional active-layer color override (Flux convention in Solo mode). */
  tintColor?: string;
}): ReactElement | null {
  const geometry = useMemo(() => {
    const { widthMm, heightMm, centerMm } = projection.board.outline;
    const halfW = widthMm / 2;
    const halfH = heightMm / 2;
    const left = centerMm.x - halfW;
    const right = centerMm.x + halfW;
    const bottom = centerMm.y - halfH;
    const top = centerMm.y + halfH;
    const points = [
      new THREE.Vector3(left, bottom, 0),
      new THREE.Vector3(right, bottom, 0),
      new THREE.Vector3(right, bottom, 0),
      new THREE.Vector3(right, top, 0),
      new THREE.Vector3(right, top, 0),
      new THREE.Vector3(left, top, 0),
      new THREE.Vector3(left, top, 0),
      new THREE.Vector3(left, bottom, 0),
    ];
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [projection.board.outline]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  if (!isPcbLayerVisible(visibleLayers, "Edge.Cuts")) return null;

  return (
    <lineSegments geometry={geometry} renderOrder={RENDER_ORDER.BOARD_OUTLINE}>
      <lineBasicMaterial
        color={tintColor ?? PCB_LAYER_COLORS["Edge.Cuts"]}
        depthTest={false}
        depthWrite={false}
      />
    </lineSegments>
  );
}

function BoardFill({
  projection,
}: {
  projection: DesignerPcbProjection;
}): ReactElement {
  const { theme } = useCanvasTheme();
  const { widthMm, heightMm, centerMm } = projection.board.outline;
  // NOTE: must be opaque. With `transparent: true`, three.js renders this in
  // the transparent pass *after* opaque pads / silkscreen, so a 0.95-opacity
  // fill paints over the components and washes them out. depthTest:false
  // alone doesn't change the opaque/transparent pass split.
  return (
    <mesh
      position={[centerMm.x, centerMm.y, -0.01]}
      renderOrder={RENDER_ORDER.BOARD_FILL}
    >
      <planeGeometry args={[widthMm, heightMm]} />
      <meshBasicMaterial
        color={theme.pcbCanvas.boardFill}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}

interface RatsnestLayerProps {
  projection: DesignerPcbProjection;
  selectedPlacementIds?: ReadonlySet<string>;
  highlightedNetId?: string | null;
  visible: boolean;
  /**
   * When set, segments matching this net id are skipped — used during route
   * mode so the static ratsnest doesn't fight with the dynamic cursor-guide.
   */
  suppressNetId?: string | null;
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
  selectedPlacementIds,
  highlightedNetId,
  visible,
  suppressNetId,
}: RatsnestLayerProps): ReactElement | null {
  // Net classes by id → color (with sane fallback so a stale class id doesn't drop a segment).
  const classColors = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of projection.board.netClasses) {
      map.set(c.id, c.color);
    }
    return map;
  }, [projection.board.netClasses]);
  const fallbackColor = "#e5e7eb";

  const groups = useMemo(() => {
    const byColor = new Map<string, { bright: number[]; dim: number[] }>();
    for (const seg of projection.ratsnest) {
      if (suppressNetId && seg.netId === suppressNetId) continue;
      const color = classColors.get(seg.netClassId) ?? fallbackColor;
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
      target.push(seg.fromMm.x, seg.fromMm.y, 0, seg.toMm.x, seg.toMm.y, 0);
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
    classColors,
    highlightedNetId,
    selectedPlacementIds,
    suppressNetId,
  ]);

  if (!visible || groups.length === 0) return null;

  return (
    <>
      {groups.map((g, idx) => (
        <RatsnestGroupRender key={idx} group={g} />
      ))}
    </>
  );
}

function RatsnestGroupRender({
  group,
}: {
  group: RatsnestGroup;
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
          opacity={0.85}
        />
      ) : null}
      {dimGeom ? (
        <DashedLineSegments
          geometry={dimGeom}
          color={group.color}
          opacity={0.18}
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
      renderOrder={RENDER_ORDER.RATSNEST}
    >
      <lineDashedMaterial
        color={color}
        transparent
        opacity={opacity}
        depthTest={false}
        depthWrite={false}
        dashSize={0.6}
        gapSize={0.4}
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
  activeLayer,
  visibleLayers,
}: {
  placement: PcbPlacedPart;
  positionOverrideMm?: PcbPointMm;
  activeLayer: PcbLayerId;
  visibleLayers: ReadonlySet<PcbLayerId>;
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

  // KiCad-style flip: when on B.Cu, every footprint child layer remaps F.* ↔ B.*
  // (pads, silk, mask, paste, courtyard, fab). `*.Cu` (through-hole) untouched.
  const layerRemap = isBackLayer ? flipLayerSide : undefined;

  // Dim every layer the placement contributes when it lives on the off-active
  // side. Using the remapped contributing-layers set means we cover all
  // child layers with one prop.
  const dimmedLayers = useMemo<ReadonlySet<string> | undefined>(() => {
    if (placement.layer === activeLayer) return undefined;
    return placementContributingLayers(placement.layer);
  }, [placement.layer, activeLayer]);

  const hiddenLayers = useMemo(() => {
    return new Set([
      ...PCB_HIDDEN_LAYERS,
      ...hiddenFootprintLayers(visibleLayers),
    ]);
  }, [visibleLayers]);

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
          layerRemap={layerRemap}
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
  const points = [
    new THREE.Vector3(cx - w / 2 - padMm, cy - h / 2 - padMm, 0),
    new THREE.Vector3(cx + w / 2 + padMm, cy - h / 2 - padMm, 0),
    new THREE.Vector3(cx + w / 2 + padMm, cy - h / 2 - padMm, 0),
    new THREE.Vector3(cx + w / 2 + padMm, cy + h / 2 + padMm, 0),
    new THREE.Vector3(cx + w / 2 + padMm, cy + h / 2 + padMm, 0),
    new THREE.Vector3(cx - w / 2 - padMm, cy + h / 2 + padMm, 0),
    new THREE.Vector3(cx - w / 2 - padMm, cy + h / 2 + padMm, 0),
    new THREE.Vector3(cx - w / 2 - padMm, cy - h / 2 - padMm, 0),
  ];
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  return (
    <group
      position={[position.x, position.y, 0]}
      rotation={[0, 0, rotationRad]}
      scale={[scaleX, 1, 1]}
    >
      <lineSegments geometry={geometry} renderOrder={RENDER_ORDER.SELECTION}>
        <SelectionOutlineMaterial />
      </lineSegments>
    </group>
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
    return {
      from: cursorMm,
      to: { x: closest.x, y: closest.y },
      color: cls?.color ?? "#e5e7eb",
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
  /** Per-placement live drag preview positions (group drag). */
  dragOverride?: ReadonlyMap<string, PcbPointMm> | null;
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
    pendingTailFromIndex: number;
    violationSegmentIndexes: ReadonlyArray<number>;
  } | null;
  /**
   * Rubber-band marquee overlay rendered inside the mirror group so selection
   * rect aligns with board content in both top and bottom view.
   */
  marqueeOverlay?: {
    a: { x: number; y: number } | null;
    b: { x: number; y: number } | null;
    color: string;
  } | null;
  initialViewport?: ViewportState | null;
  onViewportChange?: (zoom: number, posX: number, posY: number) => void;
}

export function PcbScene({
  projection,
  selection,
  dragOverride,
  highlightedNetId,
  ratsnestVisible = true,
  viewSide = "top",
  displayMode = "normal",
  routeGuide = null,
  routePreview = null,
  marqueeOverlay = null,
  initialViewport,
  onViewportChange,
}: PcbSceneProps): ReactElement {
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    invalidate();
  }, [
    projection,
    selection,
    dragOverride,
    highlightedNetId,
    ratsnestVisible,
    viewSide,
    routeGuide,
    routePreview,
    marqueeOverlay,
    invalidate,
  ]);

  const selectedPlacementIds = selection?.placementIds;
  const visibleLayers = useMemo(
    () => visibleLayerSet(projection.board.visibleLayers),
    [projection.board.visibleLayers],
  );
  const selectedPlacements = useMemo(() => {
    if (!selectedPlacementIds || selectedPlacementIds.size === 0) return [];
    return projection.placements.filter(
      (p) =>
        selectedPlacementIds.has(p.id) && isPlacementVisible(visibleLayers, p),
    );
  }, [projection.placements, selectedPlacementIds, visibleLayers]);

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

  // LineSegments2 does not render correctly under a negative-scale parent
  // group (the three.js addons line renderer breaks with negative determinant
  // model matrices). TraceLayer and TracePreviewLayer are therefore rendered
  // OUTSIDE the mirror group; they use the `mirror` prop to pre-negate X in
  // their geometry instead. All other primitives stay inside the group.
  return (
    <>
      {(["B.Cu", "In2.Cu", "In1.Cu", "F.Cu"] as const).map((layer) =>
        isCopperLayerVisible(visibleLayers, layer) &&
        !(displayMode === "solo" && activeCopperLayer !== layer) ? (
          <TraceLayer
            key={layer}
            traces={projection.traces}
            layer={layer}
            highlightedNetId={highlightedNetId}
            selectedTraceIds={selection?.traceIds}
            inactive={activeCopperLayer !== layer && displayMode !== "normal"}
            mirror={mirror}
          />
        ) : null,
      )}
      {routePreview ? (
        <TracePreviewLayer
          pointsNm={routePreview.pointsNm}
          layer={routePreview.layer}
          widthMm={routePreview.widthMm}
          pendingTailFromIndex={routePreview.pendingTailFromIndex}
          violationSegmentIndexes={routePreview.violationSegmentIndexes}
          mirror={mirror}
        />
      ) : null}
      <group scale={[sceneScaleX, 1, 1]}>
        <FitBoardOnMount
          outline={projection.board.outline}
          initialViewport={initialViewport}
        />
        {onViewportChange && (
          <ViewportReporter onViewportChange={onViewportChange} />
        )}
        {/* <GridShader gridSize={1} majorEvery={5} alpha={0.16} majorAlpha={0.12} /> */}
        <BoardFill projection={projection} />
        <BoardOutline
          projection={projection}
          visibleLayers={visibleLayers}
          tintColor={
            displayMode === "solo"
              ? PCB_LAYER_COLORS[projection.board.activeLayer]
              : undefined
          }
        />
        {projection.placements.map((placement) => (
          <PlacementRender
            key={placement.id}
            placement={placement}
            positionOverrideMm={dragOverride?.get(placement.id)}
            activeLayer={projection.board.activeLayer}
            visibleLayers={visibleLayers}
          />
        ))}
        {areViasVisible(visibleLayers) ? (
          <ViaLayer
            vias={projection.vias}
            highlightedNetId={highlightedNetId}
            selectedViaIds={selection?.viaIds}
            activeLayer={projection.board.activeLayer}
          />
        ) : null}
        {isPcbLayerVisible(visibleLayers, "Drill") ? (
          <DrillLayer
            vias={projection.vias}
            placements={projection.placements}
            showMountingHoleRing={isPcbLayerVisible(visibleLayers, "F.SilkS")}
          />
        ) : null}
        {isPcbLayerVisible(visibleLayers, "B.Mask") ? (
          <SolderMaskLayer
            side="bottom"
            placements={projection.placements}
            outline={projection.board.outline}
            expansionMm={projection.board.solderMaskExpansionMm}
          />
        ) : null}
        {isPcbLayerVisible(visibleLayers, "F.Mask") ? (
          <SolderMaskLayer
            side="top"
            placements={projection.placements}
            outline={projection.board.outline}
            expansionMm={projection.board.solderMaskExpansionMm}
          />
        ) : null}
        {isPcbLayerVisible(visibleLayers, "B.Paste") ? (
          <SolderPasteLayer
            side="bottom"
            placements={projection.placements}
            expansionMm={projection.board.solderPasteExpansionMm}
          />
        ) : null}
        {isPcbLayerVisible(visibleLayers, "F.Paste") ? (
          <SolderPasteLayer
            side="top"
            placements={projection.placements}
            expansionMm={projection.board.solderPasteExpansionMm}
          />
        ) : null}
        {(["B.Cu", "In2.Cu", "In1.Cu", "F.Cu"] as const).map((layer) =>
          isCopperLayerVisible(visibleLayers, layer) ? (
            <NetTraceLabels
              key={layer}
              traces={projection.traces}
              netNames={projection.netNames}
              layer={layer}
              inactive={activeCopperLayer !== layer}
              counterMirror={layer === "B.Cu" ? mirror : false}
            />
          ) : null,
        )}
        <RatsnestLayer
          projection={projection}
          selectedPlacementIds={selectedPlacementIds}
          highlightedNetId={highlightedNetId}
          visible={ratsnestVisible}
          suppressNetId={routeGuide?.netId}
        />
        {routeGuide ? (
          <DynamicRatsnestGuide
            ratsnest={projection.ratsnest}
            cursorMm={routeGuide.cursorMm}
            netId={routeGuide.netId}
            excludePadIds={routeGuide.excludePadIds}
            netClasses={projection.board.netClasses}
          />
        ) : null}
        {selectedPlacements.map((placement) => (
          <SelectionOutline
            key={placement.id}
            placement={placement}
            positionOverrideMm={dragOverride?.get(placement.id)}
          />
        ))}
        <SelectionRectOverlay
          a={marqueeOverlay?.a ?? null}
          b={marqueeOverlay?.b ?? null}
          color={marqueeOverlay?.color ?? "#60a5fa"}
        />
      </group>
    </>
  );
}
