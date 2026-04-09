/**
 * PcbScene — Composes R3F primitives for PCB layout rendering.
 *
 * All coordinates are in mm (scene units) — no nm conversion needed.
 * The PCB store data is already in mm.
 */

import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type {
  PcbDocument,
  PcbPlacement,
  TraceSegment,
  Via,
  RatsnestLine,
} from "@/components/pcb-editor/pcb-types";
import type { CanvasColors } from "@/lib/canvas-theme";
import { transformPlacementPoint } from "@/components/pcb-editor/canvas/pcb-hit-test";
import { TraceLines } from "../primitives/TraceLines";
import { PadInstances } from "../primitives/PadInstances";
import { ViaInstances } from "../primitives/ViaInstances";
import { RatsnestLines } from "../primitives/RatsnestLines";
import { RENDER_ORDER, PCB_LAYER_COLORS } from "../layers";
import type { PcbAdapterSceneTransform } from "../adapters/pcb-adapter-transform";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface PcbSceneConfig {
  editable?: boolean;
  activeLayer?: "F.Cu" | "B.Cu";
  visibleLayers?: ReadonlySet<string>;
  selectedIds?: ReadonlySet<string>;
  gridSize?: number;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PcbSceneProps {
  document: PcbDocument | null;
  ratsnest?: readonly RatsnestLine[];
  routingPreview?: readonly TraceSegment[];
  routingPreviewVias?: readonly Via[];
  config?: PcbSceneConfig;
  colors: CanvasColors;
  sceneTransform: PcbAdapterSceneTransform;
}

interface PcbViewportProofDetail {
  camera: {
    x: number;
    y: number;
    zoom: number;
  };
  points: {
    boardCenter: { x: number; y: number };
    leftPad: { x: number; y: number } | null;
    rightPad: { x: number; y: number } | null;
  };
}

const NO_RAYCAST = (() => null) as THREE.Object3D["raycast"];

// ---------------------------------------------------------------------------
// Component — ALL coordinates in mm (scene units)
// ---------------------------------------------------------------------------

export function PcbScene({
  document: doc,
  ratsnest = [],
  routingPreview,
  routingPreviewVias,
  config = {},
  colors,
  sceneTransform,
}: PcbSceneProps) {
  const {
    visibleLayers = new Set([
      "F.Cu",
      "B.Cu",
      "F.SilkS",
      "F.CrtYd",
      "Edge.Cuts",
    ]),
    selectedIds = new Set<string>(),
  } = config;

  if (!doc) return null;

  return (
    <group
      name="pcb-scene"
      onUpdate={(group) => {
        group.traverse((object) => {
          object.raycast = NO_RAYCAST;
        });
      }}
    >
      <PcbViewportProofReporter
        document={doc}
        sceneTransform={sceneTransform}
      />
      {/* Board outline (mm coords directly) */}
      <BoardOutline
        width={doc.boardOutline.width}
        height={doc.boardOutline.height}
        visible={visibleLayers.has("Edge.Cuts")}
        sceneTransform={sceneTransform}
      />

      {/* Traces */}
      <PcbTraces
        traces={doc.traces}
        selectedIds={selectedIds}
        visibleLayers={visibleLayers}
        routingPreview={routingPreview}
        sceneTransform={sceneTransform}
      />

      {/* Placements (pads) */}
      <PcbPlacements
        placements={doc.placements}
        selectedIds={selectedIds}
        visibleLayers={visibleLayers}
        colors={colors}
        sceneTransform={sceneTransform}
      />

      {/* Vias */}
      <PcbVias
        vias={doc.vias}
        previewVias={routingPreviewVias}
        selectedIds={selectedIds}
        colors={colors}
        sceneTransform={sceneTransform}
      />

      {/* Ratsnest */}
      <RatsnestLines
        lines={ratsnest.map((r) => ({
          startX: sceneTransform.storePointToScenePoint(r.start).x,
          startY: sceneTransform.storePointToScenePoint(r.start).y,
          endX: sceneTransform.storePointToScenePoint(r.end).x,
          endY: sceneTransform.storePointToScenePoint(r.end).y,
        }))}
      />
    </group>
  );
}

function projectScenePointToCanvas(
  scenePoint: { x: number; y: number },
  camera: THREE.OrthographicCamera,
  size: { width: number; height: number },
) {
  return {
    x: (scenePoint.x - camera.position.x) * camera.zoom + size.width / 2,
    y: (camera.position.y - scenePoint.y) * camera.zoom + size.height / 2,
  };
}

function PcbViewportProofReporter({
  document,
  sceneTransform,
}: {
  document: PcbDocument;
  sceneTransform: PcbAdapterSceneTransform;
}) {
  const camera = useThree((state) => state.camera) as THREE.OrthographicCamera;
  const size = useThree((state) => state.size);
  const latestProofRef = useRef<string>("");

  const proofPoints = useMemo(() => {
    const boardCenter = sceneTransform.storePointToScenePoint({
      x: document.boardOutline.width / 2,
      y: document.boardOutline.height / 2,
    });

    const padPoints = document.placements.flatMap((placement) =>
      placement.footprintData.pads.map((pad) =>
        sceneTransform.storePointToScenePoint(
          transformPlacementPoint(placement, pad.position.x, pad.position.y),
        ),
      ),
    );

    const sortedPadPoints = [...padPoints].sort((a, b) =>
      a.x === b.x ? a.y - b.y : a.x - b.x,
    );

    return {
      boardCenter,
      leftPad: sortedPadPoints[0] ?? null,
      rightPad: sortedPadPoints.at(-1) ?? null,
    };
  }, [document, sceneTransform]);

  useFrame(() => {
    if (typeof window === "undefined") {
      return;
    }

    const detail: PcbViewportProofDetail = {
      camera: {
        x: camera.position.x,
        y: camera.position.y,
        zoom: camera.zoom,
      },
      points: {
        boardCenter: projectScenePointToCanvas(
          proofPoints.boardCenter,
          camera,
          size,
        ),
        leftPad: proofPoints.leftPad
          ? projectScenePointToCanvas(proofPoints.leftPad, camera, size)
          : null,
        rightPad: proofPoints.rightPad
          ? projectScenePointToCanvas(proofPoints.rightPad, camera, size)
          : null,
      },
    };

    const signature = JSON.stringify(detail);
    if (signature === latestProofRef.current) {
      return;
    }

    latestProofRef.current = signature;
    (
      window as Window & {
        __OPENPCB_PCB_VIEWPORT_PROOF__?: PcbViewportProofDetail;
      }
    ).__OPENPCB_PCB_VIEWPORT_PROOF__ = detail;
    window.dispatchEvent(
      new CustomEvent<PcbViewportProofDetail>("openpcb:pcb-viewport-proof", {
        detail,
      }),
    );
  });

  return null;
}

// ---------------------------------------------------------------------------
// Board Outline (mm coords)
// ---------------------------------------------------------------------------

function BoardOutline({
  width,
  height,
  visible,
  sceneTransform,
}: {
  width: number;
  height: number;
  visible: boolean;
  sceneTransform: PcbAdapterSceneTransform;
}) {
  const positions = useMemo(() => {
    const topLeft = sceneTransform.storePointToScenePoint({ x: 0, y: 0 });
    const topRight = sceneTransform.storePointToScenePoint({ x: width, y: 0 });
    const bottomRight = sceneTransform.storePointToScenePoint({
      x: width,
      y: height,
    });
    const bottomLeft = sceneTransform.storePointToScenePoint({
      x: 0,
      y: height,
    });
    return new Float32Array([
      topLeft.x,
      topLeft.y,
      0,
      topRight.x,
      topRight.y,
      0,
      topRight.x,
      topRight.y,
      0,
      bottomRight.x,
      bottomRight.y,
      0,
      bottomRight.x,
      bottomRight.y,
      0,
      bottomLeft.x,
      bottomLeft.y,
      0,
      bottomLeft.x,
      bottomLeft.y,
      0,
      topLeft.x,
      topLeft.y,
      0,
    ]);
  }, [width, height, sceneTransform]);

  if (!visible) return null;

  return (
    <lineSegments
      renderOrder={RENDER_ORDER.BOARD_OUTLINE}
      frustumCulled={false}
    >
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial
        color={PCB_LAYER_COLORS["Edge.Cuts"]}
        depthTest={false}
        depthWrite={false}
      />
    </lineSegments>
  );
}

// ---------------------------------------------------------------------------
// PcbTraces (mm coords)
// ---------------------------------------------------------------------------

function PcbTraces({
  traces,
  selectedIds,
  visibleLayers,
  routingPreview,
  sceneTransform,
}: {
  traces: readonly TraceSegment[];
  selectedIds: ReadonlySet<string>;
  visibleLayers: ReadonlySet<string>;
  routingPreview?: readonly TraceSegment[];
  sceneTransform: PcbAdapterSceneTransform;
}) {
  const segments = useMemo(
    () =>
      traces
        .filter((t) => visibleLayers.has(t.layer))
        .map((t) => {
          const start = sceneTransform.storePointToScenePoint(t.start);
          const end = sceneTransform.storePointToScenePoint(t.end);
          return {
            id: t.id,
            startX: start.x,
            startY: start.y,
            endX: end.x,
            endY: end.y,
            width: t.width,
            layer: t.layer,
            selected: selectedIds.has(t.id),
          };
        }),
    [traces, visibleLayers, selectedIds, sceneTransform],
  );

  const previewSegments = useMemo(
    () =>
      routingPreview?.map((t) => {
        const start = sceneTransform.storePointToScenePoint(t.start);
        const end = sceneTransform.storePointToScenePoint(t.end);
        return {
          id: t.id,
          startX: start.x,
          startY: start.y,
          endX: end.x,
          endY: end.y,
          width: t.width,
          layer: t.layer,
          selected: false,
        };
      }),
    [routingPreview, sceneTransform],
  );

  return (
    <TraceLines
      segments={segments}
      frontColor={PCB_LAYER_COLORS["F.Cu"]}
      backColor={PCB_LAYER_COLORS["B.Cu"]}
      previewSegments={previewSegments}
    />
  );
}

// ---------------------------------------------------------------------------
// PcbPlacements — pads from footprint data (mm coords)
// ---------------------------------------------------------------------------

function PcbPlacements({
  placements,
  selectedIds,
  visibleLayers,
  colors,
  sceneTransform,
}: {
  placements: readonly PcbPlacement[];
  selectedIds: ReadonlySet<string>;
  visibleLayers: ReadonlySet<string>;
  colors: CanvasColors;
  sceneTransform: PcbAdapterSceneTransform;
}) {
  const padData = useMemo(() => {
    const pads: Array<{
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      rotation: number;
      shape: "circle" | "rect" | "oval" | "roundrect";
      selected: boolean;
    }> = [];

    for (const placement of placements) {
      if (!visibleLayers.has(placement.layer)) continue;

      const isSelected = selectedIds.has(placement.id);
      for (const pad of placement.footprintData.pads) {
        const worldPoint = transformPlacementPoint(
          placement,
          pad.position.x,
          pad.position.y,
        );
        const scenePoint = sceneTransform.storePointToScenePoint(worldPoint);

        const padShape =
          pad.shape === "circle" || pad.shape === "oval"
            ? pad.shape
            : pad.shape === "roundrect"
              ? ("roundrect" as const)
              : ("rect" as const);

        pads.push({
          id: `${placement.id}:${pad.number}`,
          x: scenePoint.x,
          y: scenePoint.y,
          width: pad.size.width,
          height: pad.size.height,
          rotation: sceneTransform.rotationToScene(
            placement.rotation + pad.rotation,
          ),
          shape: padShape,
          selected: isSelected,
        });
      }
    }

    return pads;
  }, [placements, visibleLayers, selectedIds, sceneTransform]);

  return (
    <PadInstances
      pads={padData}
      defaultColor={colors.padFill}
      selectedColor={colors.padSelectedStroke}
    />
  );
}

// ---------------------------------------------------------------------------
// PcbVias (mm coords)
// ---------------------------------------------------------------------------

function PcbVias({
  vias,
  previewVias,
  selectedIds,
  colors,
  sceneTransform,
}: {
  vias: readonly Via[];
  previewVias?: readonly Via[];
  selectedIds: ReadonlySet<string>;
  colors: CanvasColors;
  sceneTransform: PcbAdapterSceneTransform;
}) {
  const viaData = useMemo(() => {
    const all = [...vias, ...(previewVias ?? [])];
    return all.map((v) => {
      const scenePoint = sceneTransform.storePointToScenePoint(v.position);
      return {
        id: v.id,
        x: scenePoint.x,
        y: scenePoint.y,
        padDiameter: v.padDiameter,
        drillDiameter: v.drillDiameter,
        selected: selectedIds.has(v.id),
      };
    });
  }, [vias, previewVias, selectedIds, sceneTransform]);

  return <ViaInstances vias={viaData} padColor={colors.padFill} />;
}
