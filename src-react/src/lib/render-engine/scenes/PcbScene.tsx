/**
 * PcbScene — Composes R3F primitives for PCB layout rendering.
 *
 * All coordinates are in mm (scene units) — no nm conversion needed.
 * The PCB store data is already in mm.
 */

import { useMemo } from "react";
import type {
  PcbDocument,
  PcbPlacement,
  TraceSegment,
  Via,
  RatsnestLine,
} from "@/components/pcb-editor/pcb-types";
import type { CanvasColors } from "@/lib/canvas-theme";
import { TraceLines } from "../primitives/TraceLines";
import { PadInstances } from "../primitives/PadInstances";
import { ViaInstances } from "../primitives/ViaInstances";
import { RatsnestLines } from "../primitives/RatsnestLines";
import { RENDER_ORDER, PCB_LAYER_COLORS } from "../layers";

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
}

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
    <group name="pcb-scene">
      {/* Board outline (mm coords directly) */}
      <BoardOutline
        width={doc.boardOutline.width}
        height={doc.boardOutline.height}
        visible={visibleLayers.has("Edge.Cuts")}
      />

      {/* Traces */}
      <PcbTraces
        traces={doc.traces}
        selectedIds={selectedIds}
        visibleLayers={visibleLayers}
        routingPreview={routingPreview}
      />

      {/* Placements (pads) */}
      <PcbPlacements
        placements={doc.placements}
        selectedIds={selectedIds}
        visibleLayers={visibleLayers}
        colors={colors}
      />

      {/* Vias */}
      <PcbVias
        vias={doc.vias}
        previewVias={routingPreviewVias}
        selectedIds={selectedIds}
        colors={colors}
      />

      {/* Ratsnest */}
      <RatsnestLines
        lines={ratsnest.map((r) => ({
          startX: r.start.x,
          startY: r.start.y,
          endX: r.end.x,
          endY: r.end.y,
        }))}
      />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Board Outline (mm coords)
// ---------------------------------------------------------------------------

function BoardOutline({
  width,
  height,
  visible,
}: {
  width: number;
  height: number;
  visible: boolean;
}) {
  const positions = useMemo(() => {
    const w2 = width / 2;
    const h2 = height / 2;
    return new Float32Array([
      -w2,
      -h2,
      0,
      w2,
      -h2,
      0,
      w2,
      -h2,
      0,
      w2,
      h2,
      0,
      w2,
      h2,
      0,
      -w2,
      h2,
      0,
      -w2,
      h2,
      0,
      -w2,
      -h2,
      0,
    ]);
  }, [width, height]);

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
}: {
  traces: readonly TraceSegment[];
  selectedIds: ReadonlySet<string>;
  visibleLayers: ReadonlySet<string>;
  routingPreview?: readonly TraceSegment[];
}) {
  const segments = useMemo(
    () =>
      traces
        .filter((t) => visibleLayers.has(t.layer))
        .map((t) => ({
          id: t.id,
          startX: t.start.x,
          startY: t.start.y,
          endX: t.end.x,
          endY: t.end.y,
          width: t.width,
          layer: t.layer,
          selected: selectedIds.has(t.id),
        })),
    [traces, visibleLayers, selectedIds],
  );

  const previewSegments = useMemo(
    () =>
      routingPreview?.map((t) => ({
        id: t.id,
        startX: t.start.x,
        startY: t.start.y,
        endX: t.end.x,
        endY: t.end.y,
        width: t.width,
        layer: t.layer,
        selected: false,
      })),
    [routingPreview],
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
}: {
  placements: readonly PcbPlacement[];
  selectedIds: ReadonlySet<string>;
  visibleLayers: ReadonlySet<string>;
  colors: CanvasColors;
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
      const placementRotRad = (placement.rotation * Math.PI) / 180;

      for (const pad of placement.footprintData.pads) {
        const cos = Math.cos(placementRotRad);
        const sin = Math.sin(placementRotRad);
        const localX = pad.position.x;
        const localY = pad.position.y;
        const worldX = placement.position.x + localX * cos - localY * sin;
        const worldY = placement.position.y + localX * sin + localY * cos;

        const padShape =
          pad.shape === "circle" || pad.shape === "oval"
            ? pad.shape
            : pad.shape === "roundrect"
              ? ("roundrect" as const)
              : ("rect" as const);

        pads.push({
          id: `${placement.id}:${pad.number}`,
          x: worldX,
          y: worldY,
          width: pad.size.width,
          height: pad.size.height,
          rotation: placement.rotation + pad.rotation,
          shape: padShape,
          selected: isSelected,
        });
      }
    }

    return pads;
  }, [placements, visibleLayers, selectedIds]);

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
}: {
  vias: readonly Via[];
  previewVias?: readonly Via[];
  selectedIds: ReadonlySet<string>;
  colors: CanvasColors;
}) {
  const viaData = useMemo(() => {
    const all = [...vias, ...(previewVias ?? [])];
    return all.map((v) => ({
      id: v.id,
      x: v.position.x,
      y: v.position.y,
      padDiameter: v.padDiameter,
      drillDiameter: v.drillDiameter,
      selected: selectedIds.has(v.id),
    }));
  }, [vias, previewVias, selectedIds]);

  return <ViaInstances vias={viaData} padColor={colors.padFill} />;
}
