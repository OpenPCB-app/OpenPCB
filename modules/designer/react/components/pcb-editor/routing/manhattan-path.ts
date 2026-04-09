import type { Point2D, TraceSegment } from "../pcb-types";

export function calculateManhattanPath(
  from: Point2D,
  to: Point2D,
  elbowDirection: "horizontal_first" | "vertical_first",
  width: number,
  layer: string,
  net: string,
): TraceSegment[] {
  const segments: TraceSegment[] = [];

  if (from.x === to.x && from.y === to.y) {
    return segments;
  }

  if (from.x === to.x || from.y === to.y) {
    segments.push({
      id: "",
      start: { ...from },
      end: { ...to },
      width,
      layer,
      net,
    });
    return segments;
  }

  if (elbowDirection === "horizontal_first") {
    const corner: Point2D = { x: to.x, y: from.y };
    segments.push({
      id: "",
      start: { ...from },
      end: corner,
      width,
      layer,
      net,
    });
    segments.push({ id: "", start: corner, end: { ...to }, width, layer, net });
  } else {
    const corner: Point2D = { x: from.x, y: to.y };
    segments.push({
      id: "",
      start: { ...from },
      end: corner,
      width,
      layer,
      net,
    });
    segments.push({ id: "", start: corner, end: { ...to }, width, layer, net });
  }

  return segments;
}

export function snapPointToGrid(point: Point2D, gridSize: number): Point2D {
  return {
    x: Math.round(point.x / gridSize) * gridSize,
    y: Math.round(point.y / gridSize) * gridSize,
  };
}
