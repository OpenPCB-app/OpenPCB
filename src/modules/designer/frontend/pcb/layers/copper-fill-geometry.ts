import * as THREE from "three";
import type {
  PcbBoardOutline,
  PcbCopperLayerId,
  PcbPlacedPart,
  PcbPointMm,
  PcbTrace,
  PcbVia,
} from "../../../../../sdks";
import { placementMirrorX } from "../../../../../sdks/designer/pcb-helpers";
import type { BoundsMm, FootprintRenderSourcePad } from "../../../../../shared/rendering";
import { footprintGeometryBounds } from "../../../../../shared/frontend/canvas/scene/footprint-render-bounds";
import { padAperturePath } from "../../../../../shared/frontend/canvas/scene/pad-aperture-geometry";

const NM_TO_MM = 1 / 1_000_000;

export interface CopperFillRectSpec {
  center: PcbPointMm;
  widthMm: number;
  heightMm: number;
}

export interface CopperFillCutoutSpec {
  id: string;
  shape: THREE.Shape;
  positionMm: PcbPointMm;
  rotationDeg: number;
  scaleX?: number;
}

export interface CopperFillGeometrySpec {
  fill: CopperFillRectSpec | null;
  cutouts: CopperFillCutoutSpec[];
}

function normalizeRotationDeg(rotationDeg: number): 0 | 90 | 180 | 270 {
  const r = (((Math.round(rotationDeg / 90) * 90) % 360) + 360) % 360;
  return r as 0 | 90 | 180 | 270;
}

function transformLocal(
  localMm: PcbPointMm,
  rotationDeg: number,
  mirrored: boolean,
): PcbPointMm {
  const r = normalizeRotationDeg(rotationDeg);
  const mx = mirrored ? -localMm.x : localMm.x;
  const my = localMm.y;
  switch (r) {
    case 90:
      return { x: -my, y: mx };
    case 180:
      return { x: -mx, y: -my };
    case 270:
      return { x: my, y: -mx };
    default:
      return { x: mx, y: my };
  }
}

function rectShape(widthMm: number, heightMm: number): THREE.Shape {
  const hw = Math.max(0, widthMm) / 2;
  const hh = Math.max(0, heightMm) / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, -hh);
  shape.lineTo(hw, -hh);
  shape.lineTo(hw, hh);
  shape.lineTo(-hw, hh);
  shape.closePath();
  return shape;
}

function circleShape(radiusMm: number, segments = 32): THREE.Shape {
  const shape = new THREE.Shape();
  if (radiusMm <= 0) return shape;
  shape.moveTo(radiusMm, 0);
  for (let i = 1; i <= segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    shape.lineTo(Math.cos(a) * radiusMm, Math.sin(a) * radiusMm);
  }
  shape.closePath();
  return shape;
}

function pathToShape(path: THREE.Path): THREE.Shape {
  const points = path.getPoints(0);
  const shape = new THREE.Shape();
  if (points.length === 0) return shape;
  shape.moveTo(points[0]!.x, points[0]!.y);
  for (let i = 1; i < points.length; i += 1) {
    shape.lineTo(points[i]!.x, points[i]!.y);
  }
  shape.closePath();
  return shape;
}

function capsuleShape(lengthMm: number, radiusMm: number): THREE.Shape {
  const shape = new THREE.Shape();
  if (radiusMm <= 0) return shape;
  const half = Math.max(0, lengthMm) / 2;
  const straight = Math.max(0, half - radiusMm);
  shape.moveTo(-straight, -radiusMm);
  shape.lineTo(straight, -radiusMm);
  for (let i = 1; i <= 16; i += 1) {
    const a = -Math.PI / 2 + (i / 16) * Math.PI;
    shape.lineTo(straight + Math.cos(a) * radiusMm, Math.sin(a) * radiusMm);
  }
  shape.lineTo(-straight, radiusMm);
  for (let i = 1; i <= 16; i += 1) {
    const a = Math.PI / 2 + (i / 16) * Math.PI;
    shape.lineTo(-straight + Math.cos(a) * radiusMm, Math.sin(a) * radiusMm);
  }
  shape.closePath();
  return shape;
}

function effectivePadLayer(
  padLayer: string | undefined,
  mirrored: boolean,
): string | undefined {
  const layer = padLayer ?? "F.Cu";
  if (layer.startsWith("*.") || !mirrored) return layer;
  if (layer.startsWith("F.")) return `B.${layer.slice(2)}`;
  if (layer.startsWith("B.")) return `F.${layer.slice(2)}`;
  return layer;
}

export function padContributesToCopperLayer(
  pad: Pick<FootprintRenderSourcePad, "layer">,
  layer: PcbCopperLayerId,
  placementMirrored: boolean,
): boolean {
  const effectiveLayer = effectivePadLayer(pad.layer, placementMirrored);
  if (effectiveLayer === "*.Cu") return true;
  return effectiveLayer === layer;
}

function viaContributesToCopperLayer(
  via: PcbVia,
  layer: PcbCopperLayerId,
): boolean {
  if (via.viaType === "through") return true;
  return via.fromLayer === layer || via.toLayer === layer;
}

function expandedBoundsShape(bounds: BoundsMm, expansionMm: number): THREE.Shape {
  const minX = bounds.minX - expansionMm;
  const minY = bounds.minY - expansionMm;
  const maxX = bounds.maxX + expansionMm;
  const maxY = bounds.maxY + expansionMm;
  const shape = new THREE.Shape();
  shape.moveTo(minX, minY);
  shape.lineTo(maxX, minY);
  shape.lineTo(maxX, maxY);
  shape.lineTo(minX, maxY);
  shape.closePath();
  return shape;
}

function buildTraceCutouts(
  layer: PcbCopperLayerId,
  traces: ReadonlyArray<PcbTrace>,
  clearanceMm: number,
): CopperFillCutoutSpec[] {
  const out: CopperFillCutoutSpec[] = [];
  for (const trace of traces) {
    if (trace.layer !== layer) continue;
    const radius = trace.widthMm / 2 + clearanceMm;
    for (let i = 1; i < trace.pointsNm.length; i += 1) {
      const a = trace.pointsNm[i - 1]!;
      const b = trace.pointsNm[i]!;
      const ax = a.x * NM_TO_MM;
      const ay = a.y * NM_TO_MM;
      const bx = b.x * NM_TO_MM;
      const by = b.y * NM_TO_MM;
      const dx = bx - ax;
      const dy = by - ay;
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length <= 0) continue;
      out.push({
        id: `trace:${trace.id}:${i - 1}`,
        shape: capsuleShape(length + radius * 2, radius),
        positionMm: { x: (ax + bx) / 2, y: (ay + by) / 2 },
        rotationDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
      });
    }
  }
  return out;
}

function buildViaCutouts(
  layer: PcbCopperLayerId,
  vias: ReadonlyArray<PcbVia>,
  clearanceMm: number,
): CopperFillCutoutSpec[] {
  const out: CopperFillCutoutSpec[] = [];
  for (const via of vias) {
    if (!viaContributesToCopperLayer(via, layer)) continue;
    out.push({
      id: `via:${via.id}`,
      shape: circleShape(via.diameterMm / 2 + clearanceMm),
      positionMm: via.centerMm,
      rotationDeg: 0,
    });
  }
  return out;
}

function buildPadCutouts(
  layer: PcbCopperLayerId,
  placements: ReadonlyArray<PcbPlacedPart>,
  clearanceMm: number,
): CopperFillCutoutSpec[] {
  const out: CopperFillCutoutSpec[] = [];
  for (const placement of placements) {
    const pads = placement.footprint.preview?.pads ?? [];
    const mirrored = placementMirrorX(placement);
    for (const pad of pads) {
      if (!padContributesToCopperLayer(pad, layer, mirrored)) continue;
      const offset = transformLocal(pad.centerMm, placement.rotationDeg, mirrored);
      out.push({
        id: `pad:${placement.id}:${pad.id}`,
        shape: pathToShape(padAperturePath(pad, clearanceMm)),
        positionMm: {
          x: placement.positionMm.x + offset.x,
          y: placement.positionMm.y + offset.y,
        },
        rotationDeg:
          pad.rotationDeg + placement.rotationDeg * (mirrored ? -1 : 1),
      });
    }
  }
  return out;
}

function buildPlacementKeepouts(
  layer: PcbCopperLayerId,
  placements: ReadonlyArray<PcbPlacedPart>,
  clearanceMm: number,
): CopperFillCutoutSpec[] {
  const out: CopperFillCutoutSpec[] = [];
  for (const placement of placements) {
    if (placement.layer !== layer) continue;
    const model = placement.footprint.preview;
    if (!model) continue;
    const bounds = footprintGeometryBounds(model);
    if (!bounds) continue;
    out.push({
      id: `placement:${placement.id}`,
      shape: expandedBoundsShape(bounds, clearanceMm),
      positionMm: placement.positionMm,
      rotationDeg: placement.rotationDeg,
      scaleX: placementMirrorX(placement) ? -1 : 1,
    });
  }
  return out;
}

export function buildCopperFillGeometrySpec(params: {
  layer: PcbCopperLayerId;
  outline: PcbBoardOutline;
  placements: ReadonlyArray<PcbPlacedPart>;
  traces: ReadonlyArray<PcbTrace>;
  vias: ReadonlyArray<PcbVia>;
  clearanceMm: number;
  copperToBoardEdgeMm: number;
}): CopperFillGeometrySpec {
  const edge = Math.max(0, params.copperToBoardEdgeMm);
  const fillWidth = params.outline.widthMm - edge * 2;
  const fillHeight = params.outline.heightMm - edge * 2;
  const fill =
    fillWidth > 0 && fillHeight > 0
      ? {
          center: params.outline.centerMm,
          widthMm: fillWidth,
          heightMm: fillHeight,
        }
      : null;
  const clearance = Math.max(0, params.clearanceMm);
  return {
    fill,
    cutouts: [
      ...buildPlacementKeepouts(params.layer, params.placements, clearance),
      ...buildTraceCutouts(params.layer, params.traces, clearance),
      ...buildViaCutouts(params.layer, params.vias, clearance),
      ...buildPadCutouts(params.layer, params.placements, clearance),
    ],
  };
}
