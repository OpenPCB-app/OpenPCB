import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type ReactElement } from "react";
import * as THREE from "three";
import type {
  DesignerPcbProjection,
  PcbPlacedPart,
  PcbPointMm,
} from "../../../../sdks";
import { FootprintRenderLayer } from "../../../../shared/frontend/canvas/scene";
import { EDAText } from "../../../../shared/frontend/canvas/primitives/EDAText";
import { GridShader } from "../../../../shared/frontend/canvas/primitives/GridShader";
import {
  PCB_LAYER_COLORS,
  RENDER_ORDER,
} from "../../../../shared/frontend/canvas/layers";
import { useCanvasTheme } from "../../../../shared/frontend/canvas/theme";
import { TraceLayer } from "./layers/TraceLayer";
import { ViaLayer } from "./layers/ViaLayer";
import type { PcbSelection } from "./pcb-selection";

function BoardOutline({
  projection,
}: {
  projection: DesignerPcbProjection;
}): ReactElement {
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

  return (
    <lineSegments geometry={geometry} renderOrder={RENDER_ORDER.BOARD_OUTLINE}>
      <lineBasicMaterial
        color={PCB_LAYER_COLORS["Edge.Cuts"]}
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
}: {
  placement: PcbPlacedPart;
  positionOverrideMm?: PcbPointMm;
}): ReactElement | null {
  const model = placement.footprint.preview;
  const position = positionOverrideMm ?? placement.positionMm;
  const rotationRad = (placement.rotationDeg * Math.PI) / 180;
  const scaleX = placement.mirrored ? -1 : 1;

  // No footprint preview at all, or footprint with zero pads AND zero graphics:
  // render a placeholder so the user can see the part exists and where it sits.
  // Common cause: drawn-symbol committed without a real footprint, or an old
  // placeholder footprint with `preview: null`.
  const isEmptyModel =
    !model ||
    ((model.pads?.length ?? 0) === 0 && (model.graphics?.length ?? 0) === 0);

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
          hiddenLayers={PCB_HIDDEN_LAYERS}
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
  const scaleX = placement.mirrored ? -1 : 1;
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

interface PcbSceneProps {
  projection: DesignerPcbProjection;
  selection?: PcbSelection;
  /** Per-placement live drag preview positions (group drag). */
  dragOverride?: ReadonlyMap<string, PcbPointMm> | null;
  highlightedNetId?: string | null;
  ratsnestVisible?: boolean;
}

export function PcbScene({
  projection,
  selection,
  dragOverride,
  highlightedNetId,
  ratsnestVisible = true,
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
    invalidate,
  ]);

  const selectedPlacementIds = selection?.placementIds;
  const selectedPlacements = useMemo(() => {
    if (!selectedPlacementIds || selectedPlacementIds.size === 0) return [];
    return projection.placements.filter((p) => selectedPlacementIds.has(p.id));
  }, [projection.placements, selectedPlacementIds]);

  return (
    <>
      <GridShader gridSize={1} majorEvery={5} alpha={0.06} majorAlpha={0.04} />
      <BoardFill projection={projection} />
      <BoardOutline projection={projection} />
      {projection.placements.map((placement) => (
        <PlacementRender
          key={placement.id}
          placement={placement}
          positionOverrideMm={dragOverride?.get(placement.id)}
        />
      ))}
      <TraceLayer
        traces={projection.traces}
        layer="B.Cu"
        highlightedNetId={highlightedNetId}
        selectedTraceIds={selection?.traceIds}
      />
      <TraceLayer
        traces={projection.traces}
        layer="F.Cu"
        highlightedNetId={highlightedNetId}
        selectedTraceIds={selection?.traceIds}
      />
      <ViaLayer
        vias={projection.vias}
        highlightedNetId={highlightedNetId}
        selectedViaIds={selection?.viaIds}
      />
      <RatsnestLayer
        projection={projection}
        selectedPlacementIds={selectedPlacementIds}
        highlightedNetId={highlightedNetId}
        visible={ratsnestVisible}
      />
      {selectedPlacements.map((placement) => (
        <SelectionOutline
          key={placement.id}
          placement={placement}
          positionOverrideMm={dragOverride?.get(placement.id)}
        />
      ))}
    </>
  );
}
