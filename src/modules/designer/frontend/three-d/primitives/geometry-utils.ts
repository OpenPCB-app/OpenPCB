import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type {
  DesignerPcbProjection,
  PcbPlacedPart,
  PcbPointMm,
  PcbTrace,
  PcbVia,
  PcbViaProtection,
} from "../../../../../sdks";
import { collectDrills } from "../../pcb/pcb-drills";
import { graphicStrokeSegments } from "../../../../../shared/frontend/canvas/preview/geometry";
import { flattenOutline } from "../../../backend/pcb/outline-geometry";
import type {
  FootprintRenderSourcePad,
  PreviewLabel,
} from "../../../../../shared/rendering";

export const DEFAULT_BOARD_THICKNESS_MM = 1.6;
export const DEFAULT_COPPER_THICKNESS_MM = 0.035;
export const DEFAULT_PAD_HEIGHT_MM = 0.05;
export const DEFAULT_SILKSCREEN_HEIGHT_MM = 0.02;
export const DEFAULT_BOARD_PADDING_MM = 10;
// Soldermask plane: above copper top (0.035) but below the pad face (0.05) so
// pads render proud of the (translucent) mask and read as exposed ENIG gold.
export const SOLDERMASK_Z_MM = 0.04;
// Rendered copper thickness for traces/pour/vias. Real 1 oz copper is 0.035 mm;
// nudged up slightly for a visible edge wall but kept below the pad face (0.05).
export const COPPER_RELIEF_HEIGHT_MM = 0.04;

export interface PointNm {
  x: number;
  y: number;
}

export interface TraceMeshSegmentInput {
  startMm: PcbPointMm;
  endMm: PcbPointMm;
  widthMm: number;
}

export interface BoardBoundsMm {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CopperTraceMeshInput extends TraceMeshSegmentInput {
  id: string;
  traceId: string;
  layer: PcbTrace["layer"];
  centerMm: PcbPointMm;
  lengthMm: number;
  angleRad: number;
}

export interface ViaMeshInput {
  id: string;
  centerMm: PcbPointMm;
  diameterMm: number;
  drillMm: number;
  protection: PcbViaProtection;
}

export interface PadMeshInput {
  id: string;
  placementId: string;
  pad: FootprintRenderSourcePad;
  layer: PcbPlacedPart["layer"];
  zSurfaceMm: number;
}

export interface SilkscreenLineInput {
  id: string;
  placementId: string;
  layer: string | undefined;
  startMm: PcbPointMm;
  endMm: PcbPointMm;
  widthMm: number;
}

export interface SilkscreenLabelInput {
  id: string;
  placementId: string;
  layer: string | undefined;
  label: PreviewLabel;
}

export function nmToMm(n: number): number {
  return n / 1_000_000;
}

export function tracePointsToMeshSegments(
  pointsNm: Array<{ x: number; y: number }>,
  widthMm: number,
): TraceMeshSegmentInput[] {
  const segments: TraceMeshSegmentInput[] = [];
  for (let index = 1; index < pointsNm.length; index += 1) {
    const start = pointsNm[index - 1];
    const end = pointsNm[index];
    if (!start || !end) continue;
    segments.push({
      startMm: { x: nmToMm(start.x), y: nmToMm(start.y) },
      endMm: { x: nmToMm(end.x), y: nmToMm(end.y) },
      widthMm,
    });
  }
  return segments;
}

export function boardOutlineBoundsMm(
  outline: DesignerPcbProjection["board"]["outline"],
): BoardBoundsMm {
  const halfWidth = outline.widthMm / 2;
  const halfHeight = outline.heightMm / 2;
  return {
    minX: outline.centerMm.x - halfWidth,
    minY: outline.centerMm.y - halfHeight,
    maxX: outline.centerMm.x + halfWidth,
    maxY: outline.centerMm.y + halfHeight,
  };
}

export function shapeFromBounds(bounds: BoardBoundsMm): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(bounds.minX, bounds.minY);
  shape.lineTo(bounds.maxX, bounds.minY);
  shape.lineTo(bounds.maxX, bounds.maxY);
  shape.lineTo(bounds.minX, bounds.maxY);
  shape.lineTo(bounds.minX, bounds.minY);
  return shape;
}

/**
 * Build the board substrate `THREE.Shape` from the actual outline geometry (any
 * kind — arcs already discretised via `flattenOutline`) in world mm coords, with
 * internal cutouts punched as holes.
 */
export function boardOutlineToShape(
  outline: DesignerPcbProjection["board"]["outline"],
  cutouts?: DesignerPcbProjection["board"]["cutouts"],
): THREE.Shape {
  const ring = flattenOutline(outline);
  const shape = new THREE.Shape();
  if (ring.length > 0) {
    shape.moveTo(ring[0]!.x, ring[0]!.y);
    for (let i = 1; i < ring.length; i += 1) {
      shape.lineTo(ring[i]!.x, ring[i]!.y);
    }
    shape.closePath();
  }
  for (const cut of cutouts ?? []) {
    const hole = new THREE.Path();
    const cutRing = flattenOutline(cut.shape);
    if (cutRing.length === 0) continue;
    hole.moveTo(cutRing[0]!.x, cutRing[0]!.y);
    for (let i = 1; i < cutRing.length; i += 1) {
      hole.lineTo(cutRing[i]!.x, cutRing[i]!.y);
    }
    hole.closePath();
    shape.holes.push(hole);
  }
  return shape;
}

/**
 * Board substrate outline (with cutouts) plus a circular through-hole punched
 * for every drilled object (PTH pads, vias, free holes/pads). Coords are
 * absolute world mm. Drills whose bbox falls outside the board bounds are
 * skipped (matching the 2D `BoardFill` guard) so `ExtrudeGeometry` never gets
 * an edge-crossing hole.
 */
export function boardSubstrateShape(
  projection: DesignerPcbProjection,
): THREE.Shape {
  const outline = projection.board?.outline;
  const bounds = outline
    ? boardOutlineBoundsMm(outline)
    : fallbackBoardBoundsFromProjection(projection);
  const shape = outline
    ? boardOutlineToShape(outline, projection.board?.cutouts)
    : shapeFromBounds(bounds);

  const drills = collectDrills(
    // Vias are tented (soldermask bridges over them) — no board hole / mask
    // opening; CopperVias draws them as raised green bumps. Component pad drills,
    // free holes and mounting holes stay drilled.
    [],
    projection.placements,
    projection.freeHoles,
    projection.freePads,
  );
  for (const drill of drills) {
    const { x, y } = drill.centerMm;
    const r = drill.radiusMm;
    if (
      x - r < bounds.minX ||
      x + r > bounds.maxX ||
      y - r < bounds.minY ||
      y + r > bounds.maxY
    ) {
      continue;
    }
    const hole = new THREE.Path();
    hole.absarc(x, y, r, 0, Math.PI * 2, false);
    shape.holes.push(hole);
  }

  return shape;
}

const TRACE_CAP_SEGMENTS = 16;

/**
 * Stroke a trace polyline into a single **extruded** copper ribbon (a box per
 * straight segment + a short cylinder at every vertex to round the corners and
 * cap the ends), centred on z=0 with thickness `heightMm`. One geometry per
 * trace → many merge per layer into a single draw call. The cylinders give
 * smooth rounded corners (no miter spikes) and the box/cylinder side walls give
 * the trace real copper thickness. Returns null for degenerate (<2 distinct).
 */
export function buildTraceRibbonGeometry(
  pointsNm: ReadonlyArray<{ x: number; y: number }>,
  widthMm: number,
  heightMm: number,
): THREE.BufferGeometry | null {
  const pts: PcbPointMm[] = [];
  for (const p of pointsNm) {
    const mm = { x: nmToMm(p.x), y: nmToMm(p.y) };
    const prev = pts[pts.length - 1];
    if (!prev || prev.x !== mm.x || prev.y !== mm.y) pts.push(mm);
  }
  if (pts.length < 2 || widthMm <= 0 || heightMm <= 0) return null;

  const r = widthMm / 2;
  const parts: THREE.BufferGeometry[] = [];

  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const box = new THREE.BoxGeometry(len, widthMm, heightMm);
    box.applyMatrix4(new THREE.Matrix4().makeRotationZ(Math.atan2(dy, dx)));
    box.translate((a.x + b.x) / 2, (a.y + b.y) / 2, 0);
    parts.push(box);
  }
  for (const p of pts) {
    const cyl = new THREE.CylinderGeometry(r, r, heightMm, TRACE_CAP_SEGMENTS);
    cyl.rotateX(Math.PI / 2); // cylinder axis Y → Z
    cyl.translate(p.x, p.y, 0);
    parts.push(cyl);
  }
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts, false);
  parts.forEach((part) => part.dispose());
  return merged;
}

export function traceToMeshInputs(trace: PcbTrace): CopperTraceMeshInput[] {
  return tracePointsToMeshSegments(trace.pointsNm, trace.widthMm).map(
    (segment, segmentIndex) => {
      const dx = segment.endMm.x - segment.startMm.x;
      const dy = segment.endMm.y - segment.startMm.y;
      return {
        ...segment,
        id: `${trace.id}:${segmentIndex}`,
        traceId: trace.id,
        layer: trace.layer,
        centerMm: {
          x: (segment.startMm.x + segment.endMm.x) / 2,
          y: (segment.startMm.y + segment.endMm.y) / 2,
        },
        lengthMm: Math.hypot(dx, dy),
        angleRad: Math.atan2(dy, dx),
      };
    },
  );
}

export function viasToMeshInputs(vias: readonly PcbVia[]): ViaMeshInput[] {
  return vias.map((via) => ({
    id: via.id,
    centerMm: via.centerMm,
    diameterMm: via.diameterMm > 0 ? via.diameterMm : 0.6,
    drillMm: via.drillMm > 0 ? via.drillMm : 0.3,
    protection: via.protection ?? "tented",
  }));
}

export function padsToMeshInputs(
  placements: readonly PcbPlacedPart[],
  boardThicknessMm = DEFAULT_BOARD_THICKNESS_MM,
): PadMeshInput[] {
  const pads: PadMeshInput[] = [];
  for (const placement of placements) {
    const previewPads = placement.footprint.preview?.pads ?? [];
    const zSurfaceMm = placement.layer === "B.Cu" ? -boardThicknessMm : 0;
    for (const pad of previewPads) {
      pads.push({
        id: `${placement.id}:${pad.id}`,
        placementId: placement.id,
        pad,
        layer: placement.layer,
        zSurfaceMm,
      });
    }
  }
  return pads;
}

export function silkscreenToLineInputs(
  placements: readonly PcbPlacedPart[],
): SilkscreenLineInput[] {
  const lines: SilkscreenLineInput[] = [];
  for (const placement of placements) {
    const graphics = placement.footprint.preview?.graphics ?? [];
    graphics.forEach((graphic, graphicIndex) => {
      if (!isSilkscreenLayer(graphic.layer)) return;
      graphicStrokeSegments(graphic).forEach((segment, segmentIndex) => {
        lines.push({
          id: `${placement.id}:g${graphicIndex}:s${segmentIndex}`,
          placementId: placement.id,
          layer: graphic.layer,
          startMm: { x: segment[0], y: segment[1] },
          endMm: { x: segment[2], y: segment[3] },
          widthMm: Math.max(graphic.strokeWidthMm, 0.08),
        });
      });
    });
  }
  return lines;
}

export function silkscreenToLabelInputs(
  placements: readonly PcbPlacedPart[],
): SilkscreenLabelInput[] {
  const labels: SilkscreenLabelInput[] = [];
  for (const placement of placements) {
    const previewLabels = placement.footprint.preview?.labels ?? [];
    previewLabels.forEach((label) => {
      if (!isSilkscreenLayer(label.layer)) return;
      labels.push({
        id: `${placement.id}:label:${label.id}`,
        placementId: placement.id,
        layer: label.layer,
        label,
      });
    });
  }
  return labels;
}

export function isSilkscreenLayer(layer: string | undefined): boolean {
  return layer === undefined || layer === "F.SilkS" || layer === "B.SilkS";
}

export function placementTransform(
  placement: PcbPlacedPart,
  boardThicknessMm = DEFAULT_BOARD_THICKNESS_MM,
): {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
} {
  const isBackLayer = placement.layer === "B.Cu";
  const mirrorX = placement.mirrored || isBackLayer;
  return {
    position: [
      placement.positionMm.x,
      placement.positionMm.y,
      isBackLayer ? -boardThicknessMm : 0,
    ],
    rotation: [0, 0, (placement.rotationDeg * Math.PI) / 180],
    scale: [mirrorX ? -1 : 1, 1, 1],
  };
}

export function fallbackBoardBoundsFromProjection(
  projection: DesignerPcbProjection,
  paddingMm = DEFAULT_BOARD_PADDING_MM,
): BoardBoundsMm {
  const bounds: BoardBoundsMm = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };

  const includePoint = (point: PcbPointMm): void => {
    bounds.minX = Math.min(bounds.minX, point.x);
    bounds.minY = Math.min(bounds.minY, point.y);
    bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.maxY = Math.max(bounds.maxY, point.y);
  };

  for (const placement of projection.placements) {
    const footprintBounds = placement.footprint.preview?.bounds;
    if (footprintBounds) {
      includePoint({
        x: placement.positionMm.x + footprintBounds.minX,
        y: placement.positionMm.y + footprintBounds.minY,
      });
      includePoint({
        x: placement.positionMm.x + footprintBounds.maxX,
        y: placement.positionMm.y + footprintBounds.maxY,
      });
    } else {
      includePoint(placement.positionMm);
    }
  }
  for (const trace of projection.traces) {
    for (const point of trace.pointsNm) {
      includePoint({ x: nmToMm(point.x), y: nmToMm(point.y) });
    }
  }
  for (const via of projection.vias) {
    includePoint(via.centerMm);
  }

  if (!Number.isFinite(bounds.minX)) {
    return { minX: -40, minY: -28, maxX: 40, maxY: 28 };
  }

  return {
    minX: bounds.minX - paddingMm,
    minY: bounds.minY - paddingMm,
    maxX: bounds.maxX + paddingMm,
    maxY: bounds.maxY + paddingMm,
  };
}
