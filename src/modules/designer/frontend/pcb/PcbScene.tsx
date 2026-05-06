import { useThree } from "@react-three/fiber";
import { useEffect, useMemo, type ReactElement } from "react";
import * as THREE from "three";
import type {
  DesignerPcbProjection,
  PcbPlacedPart,
  PcbPointMm,
} from "../../../../sdks";
import { FootprintRenderLayer } from "../../../../shared/frontend/canvas/scene";
import { GridShader } from "../../../../shared/frontend/canvas/primitives/GridShader";
import {
  PCB_LAYER_COLORS,
  RENDER_ORDER,
} from "../../../../shared/frontend/canvas/layers";

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
  const { widthMm, heightMm, centerMm } = projection.board.outline;
  return (
    <mesh
      position={[centerMm.x, centerMm.y, -0.01]}
      renderOrder={RENDER_ORDER.BOARD_FILL}
    >
      <planeGeometry args={[widthMm, heightMm]} />
      <meshBasicMaterial
        color="#1e293b"
        transparent
        opacity={0.85}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}

function RatsnestLayer({
  projection,
}: {
  projection: DesignerPcbProjection;
}): ReactElement | null {
  const geometry = useMemo(() => {
    if (projection.ratsnest.length === 0) return null;
    const positions = new Float32Array(projection.ratsnest.length * 6);
    let i = 0;
    for (const seg of projection.ratsnest) {
      positions[i++] = seg.fromMm.x;
      positions[i++] = seg.fromMm.y;
      positions[i++] = 0;
      positions[i++] = seg.toMm.x;
      positions[i++] = seg.toMm.y;
      positions[i++] = 0;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geom;
  }, [projection.ratsnest]);

  useEffect(() => () => geometry?.dispose(), [geometry]);

  if (!geometry) return null;

  return (
    <lineSegments geometry={geometry} renderOrder={RENDER_ORDER.RATSNEST}>
      <lineBasicMaterial
        color="#facc15"
        transparent
        opacity={0.5}
        depthTest={false}
        depthWrite={false}
      />
    </lineSegments>
  );
}

function PlacementRender({
  placement,
  positionOverrideMm,
}: {
  placement: PcbPlacedPart;
  positionOverrideMm?: PcbPointMm;
}): ReactElement | null {
  const model = placement.footprint.preview;
  if (!model) return null;
  const position = positionOverrideMm ?? placement.positionMm;
  const rotationRad = (placement.rotationDeg * Math.PI) / 180;
  const scaleX = placement.mirrored ? -1 : 1;
  return (
    <group
      position={[position.x, position.y, 0]}
      rotation={[0, 0, rotationRad]}
      scale={[scaleX, 1, 1]}
    >
      <FootprintRenderLayer model={model} useLayerColors />
    </group>
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
        <lineBasicMaterial
          color="#22d3ee"
          depthTest={false}
          depthWrite={false}
        />
      </lineSegments>
    </group>
  );
}

interface PcbSceneProps {
  projection: DesignerPcbProjection;
  selectedPlacementId?: string | null;
  dragOverride?: { id: string; positionMm: PcbPointMm } | null;
}

export function PcbScene({
  projection,
  selectedPlacementId,
  dragOverride,
}: PcbSceneProps): ReactElement {
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    invalidate();
  }, [projection, selectedPlacementId, dragOverride, invalidate]);

  const selected = selectedPlacementId
    ? projection.placements.find((p) => p.id === selectedPlacementId)
    : null;

  return (
    <>
      <GridShader gridSize={1} majorEvery={5} alpha={0.18} majorAlpha={0.12} />
      <BoardFill projection={projection} />
      <BoardOutline projection={projection} />
      {projection.placements.map((placement) => (
        <PlacementRender
          key={placement.id}
          placement={placement}
          positionOverrideMm={
            dragOverride?.id === placement.id
              ? dragOverride.positionMm
              : undefined
          }
        />
      ))}
      <RatsnestLayer projection={projection} />
      {selected ? (
        <SelectionOutline
          placement={selected}
          positionOverrideMm={
            dragOverride?.id === selected.id
              ? dragOverride.positionMm
              : undefined
          }
        />
      ) : null}
    </>
  );
}
