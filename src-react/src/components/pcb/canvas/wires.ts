import type { DerivedJunction, Point, Viewport, WireEntity } from "../types";
import type { WireColors } from "@/lib/canvas-theme";
import { schematicToScreen } from "./viewport";

function isSamePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

function isCollinear(prev: Point, current: Point, next: Point): boolean {
  return (
    (prev.x === current.x && current.x === next.x) ||
    (prev.y === current.y && current.y === next.y)
  );
}

export function collapseRedundantWirePoints(points: Point[]): Point[] {
  const deduped = points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || !isSamePoint(previous, point);
  });

  if (deduped.length <= 2) {
    return deduped;
  }

  const collapsed: Point[] = [deduped[0]!];

  for (let index = 1; index < deduped.length - 1; index += 1) {
    const previous = collapsed[collapsed.length - 1];
    const current = deduped[index];
    const next = deduped[index + 1];

    if (!previous || !current || !next || isCollinear(previous, current, next)) {
      continue;
    }

    collapsed.push(current);
  }

  collapsed.push(deduped[deduped.length - 1]!);
  return collapsed;
}

export function collectDirectlyAttachedPinIds(wires: WireEntity[]): string[] {
  return [...new Set(wires.flatMap((wire) => [wire.sourcePinId, wire.targetPinId]))].sort();
}

export function translateWirePoints(points: Point[], delta: Point): Point[] {
  return points.map((point) => ({
    x: point.x + delta.x,
    y: point.y + delta.y,
  }));
}

export function rerouteWireWithMovedEndpoint(
  wire: WireEntity,
  movedPinIds: Set<string>,
  initialPoints: Point[],
  getAnchor: (pinId: string) => Point | null,
): Point[] {
  const sourceMoved = movedPinIds.has(wire.sourcePinId);
  const targetMoved = movedPinIds.has(wire.targetPinId);

  if (sourceMoved === targetMoved) {
    return initialPoints;
  }

  const sourcePoint = sourceMoved ? getAnchor(wire.sourcePinId) : initialPoints[0] ?? null;
  const targetPoint = targetMoved ? getAnchor(wire.targetPinId) : initialPoints[initialPoints.length - 1] ?? null;

  if (!sourcePoint || !targetPoint) {
    return initialPoints;
  }

  return collapseRedundantWirePoints([
    sourcePoint,
    ...initialPoints.slice(1, -1),
    targetPoint,
  ]);
}

export function buildOrthogonalWirePath(source: Point, target: Point): Point[] {
  return buildOrthogonalWirePathWithWaypoints(source, [], target);
}

export function buildOrthogonalWirePathWithWaypoints(
  source: Point,
  waypoints: Point[],
  target: Point,
): Point[] {
  const points: Point[] = [source];

  for (const point of [...waypoints, target]) {
    const lastPoint = points[points.length - 1];

    if (!lastPoint) {
      continue;
    }

    points.push({ x: point.x, y: lastPoint.y });
    points.push(point);
  }

  return collapseRedundantWirePoints(points);
}

export function getWireLength(points: Point[]): number {
  let totalLength = 0;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];

    if (!previous || !current) {
      continue;
    }

    totalLength += Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y);
  }

  return totalLength;
}

export function deriveWireJunctions(
  wires: Array<Pick<WireEntity, "id" | "points">>,
): DerivedJunction[] {
  const endpointMap = new Map<
    string,
    { position: Point; wireIds: Set<string> }
  >();

  for (const wire of wires) {
    const firstPoint = wire.points[0];
    const lastPoint = wire.points[wire.points.length - 1];

    for (const point of [firstPoint, lastPoint]) {
      if (!point) {
        continue;
      }

      const key = `${point.x}:${point.y}`;
      const entry = endpointMap.get(key) ?? {
        position: point,
        wireIds: new Set<string>(),
      };

      entry.wireIds.add(wire.id);
      endpointMap.set(key, entry);
    }
  }

  return [...endpointMap.entries()]
    .filter(([, entry]) => entry.wireIds.size >= 2)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, entry]) => ({
      id: `junction:${key}`,
      position: entry.position,
      degree: entry.wireIds.size,
      wireIds: [...entry.wireIds].sort(),
    }));
}

interface RenderWireOptions {
  preview?: boolean;
  selected?: boolean;
  colors?: WireColors;
}

export function renderWire(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  viewport: Viewport,
  options: RenderWireOptions = {},
): void {
  if (points.length < 2 || getWireLength(points) <= 0) {
    return;
  }

  const colors = options.colors;

  ctx.save();
  ctx.beginPath();

  points.forEach((point, index) => {
    const screenPoint = schematicToScreen(point.x, point.y, viewport);
    if (index === 0) {
      ctx.moveTo(screenPoint.x, screenPoint.y);
      return;
    }

    ctx.lineTo(screenPoint.x, screenPoint.y);
  });

  ctx.strokeStyle = options.preview
    ? (colors?.wirePreview ?? "#38bdf8")
    : options.selected
      ? (colors?.wireSelected ?? "#e0f2fe")
      : (colors?.wireDefault ?? "#cbd5e1");
  ctx.lineWidth = options.preview ? 2.5 : 2;
  ctx.setLineDash(options.preview ? [10, 6] : []);
  ctx.globalAlpha = options.preview ? 0.9 : 1;
  ctx.stroke();
  ctx.restore();
}

export function renderJunctions(
  ctx: CanvasRenderingContext2D,
  junctions: DerivedJunction[],
  viewport: Viewport,
  colors?: WireColors,
): void {
  ctx.save();
  ctx.fillStyle = colors?.junction ?? "#f8fafc";

  for (const junction of junctions) {
    const screenPoint = schematicToScreen(
      junction.position.x,
      junction.position.y,
      viewport,
    );

    ctx.beginPath();
    ctx.arc(screenPoint.x, screenPoint.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
