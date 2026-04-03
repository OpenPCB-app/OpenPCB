import type { PcbPlacement, Point2D } from "../pcb-types";
import type { ParsedKicadFootprint } from "@/lib/api/component-api";

export type PcbHitTarget =
  | { kind: "placement"; placementId: string }
  | { kind: "pad"; placementId: string; padNumber: string }
  | null;

type ParsedPad = ParsedKicadFootprint["pads"][number];

interface PlacementBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function transformPoint(
  placement: PcbPlacement,
  localX: number,
  localY: number,
): Point2D {
  const radians = (placement.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  let x = localX;
  let y = localY;

  if (placement.layer === "B.Cu") {
    x = -x;
  }

  const rotatedX = x * cos - y * sin;
  const rotatedY = x * sin + y * cos;

  return {
    x: placement.position.x + rotatedX,
    y: placement.position.y + rotatedY,
  };
}

function computePlacementBounds(placement: PcbPlacement): PlacementBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const footprint = placement.footprintData;
  if (!footprint) {
    return {
      minX: placement.position.x - 2,
      minY: placement.position.y - 2,
      maxX: placement.position.x + 2,
      maxY: placement.position.y + 2,
    };
  }

  for (const pad of footprint.pads) {
    const worldPos = transformPoint(placement, pad.position.x, pad.position.y);
    const halfW = pad.size.width / 2;
    const halfH = pad.size.height / 2;

    minX = Math.min(minX, worldPos.x - halfW);
    minY = Math.min(minY, worldPos.y - halfH);
    maxX = Math.max(maxX, worldPos.x + halfW);
    maxY = Math.max(maxY, worldPos.y + halfH);
  }

  for (const graphic of footprint.graphics) {
    if (graphic.type === "line") {
      const data = graphic.data as {
        start: { x: number; y: number };
        end: { x: number; y: number };
      };
      const p1 = transformPoint(placement, data.start.x, data.start.y);
      const p2 = transformPoint(placement, data.end.x, data.end.y);
      minX = Math.min(minX, p1.x, p2.x);
      minY = Math.min(minY, p1.y, p2.y);
      maxX = Math.max(maxX, p1.x, p2.x);
      maxY = Math.max(maxY, p1.y, p2.y);
    } else if (graphic.type === "rect") {
      const data = graphic.data as {
        start: { x: number; y: number };
        end: { x: number; y: number };
      };
      const corners = [
        transformPoint(placement, data.start.x, data.start.y),
        transformPoint(placement, data.end.x, data.start.y),
        transformPoint(placement, data.start.x, data.end.y),
        transformPoint(placement, data.end.x, data.end.y),
      ];
      for (const c of corners) {
        minX = Math.min(minX, c.x);
        minY = Math.min(minY, c.y);
        maxX = Math.max(maxX, c.x);
        maxY = Math.max(maxY, c.y);
      }
    } else if (graphic.type === "circle") {
      const data = graphic.data as {
        center: { x: number; y: number };
        radius?: number;
        end?: { x: number; y: number };
      };
      const center = transformPoint(placement, data.center.x, data.center.y);
      let radius: number;
      if (data.radius !== undefined) {
        radius = data.radius;
      } else if (data.end) {
        const dx = data.end.x - data.center.x;
        const dy = data.end.y - data.center.y;
        radius = Math.sqrt(dx * dx + dy * dy);
      } else {
        radius = 1;
      }
      minX = Math.min(minX, center.x - radius);
      minY = Math.min(minY, center.y - radius);
      maxX = Math.max(maxX, center.x + radius);
      maxY = Math.max(maxY, center.y + radius);
    }
  }

  if (!isFinite(minX)) {
    return {
      minX: placement.position.x - 2,
      minY: placement.position.y - 2,
      maxX: placement.position.x + 2,
      maxY: placement.position.y + 2,
    };
  }

  const padding = 0.5;
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
}

function hitTestPad(
  placement: PcbPlacement,
  pad: ParsedPad,
  worldPoint: Point2D,
): boolean {
  const padWorld = transformPoint(placement, pad.position.x, pad.position.y);
  const halfW = pad.size.width / 2;
  const halfH = pad.size.height / 2;

  return (
    worldPoint.x >= padWorld.x - halfW &&
    worldPoint.x <= padWorld.x + halfW &&
    worldPoint.y >= padWorld.y - halfH &&
    worldPoint.y <= padWorld.y + halfH
  );
}

function hitTestPlacementBounds(
  bounds: PlacementBounds,
  worldPoint: Point2D,
): boolean {
  return (
    worldPoint.x >= bounds.minX &&
    worldPoint.x <= bounds.maxX &&
    worldPoint.y >= bounds.minY &&
    worldPoint.y <= bounds.maxY
  );
}

export function hitTestPcb(
  placements: PcbPlacement[],
  worldPoint: Point2D,
  activeLayer: "F.Cu" | "B.Cu",
): PcbHitTarget {
  const activeLayerPlacements = placements.filter(
    (p) => p.layer === activeLayer,
  );
  const otherLayerPlacements = placements.filter(
    (p) => p.layer !== activeLayer,
  );

  const orderedPlacements = [...activeLayerPlacements, ...otherLayerPlacements];

  for (const placement of orderedPlacements) {
    if (!placement.footprintData) continue;

    for (const pad of placement.footprintData.pads) {
      if (hitTestPad(placement, pad, worldPoint)) {
        return {
          kind: "pad",
          placementId: placement.id,
          padNumber: pad.number,
        };
      }
    }
  }

  for (const placement of orderedPlacements) {
    const bounds = computePlacementBounds(placement);
    if (hitTestPlacementBounds(bounds, worldPoint)) {
      return { kind: "placement", placementId: placement.id };
    }
  }

  return null;
}

export function getPlacementBounds(placement: PcbPlacement): PlacementBounds {
  return computePlacementBounds(placement);
}

export function getPadWorldPosition(
  placements: PcbPlacement[],
  placementId: string,
  padNumber: string,
): Point2D | null {
  const placement = placements.find((p) => p.id === placementId);
  if (!placement?.footprintData) return null;

  const pad = placement.footprintData.pads.find((p) => p.number === padNumber);
  if (!pad) return null;

  return transformPoint(placement, pad.position.x, pad.position.y);
}

export function findPadNet(
  placements: PcbPlacement[],
  nets: { id: string; padRefs: { componentId: string; padNumber: string }[] }[],
  placementId: string,
  padNumber: string,
): string | null {
  const placement = placements.find((p) => p.id === placementId);
  if (!placement) return null;

  for (const net of nets) {
    const found = net.padRefs.some(
      (pr) =>
        pr.componentId === placement.schematicSymbolId &&
        pr.padNumber === padNumber,
    );
    if (found) return net.id;
  }
  return null;
}
