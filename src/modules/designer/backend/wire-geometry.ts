import { and, eq, inArray, or } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { asNumber, asRecord } from "./value-guards";
import { schematicWires } from "./schema";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;
type Point = { x: number; y: number };

function pointKey(point: Point): string {
  return `${point.x}:${point.y}`;
}

export function parseWirePointsJson(pointsJson: string): Point[] {
  const parsed = JSON.parse(pointsJson) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed
    .map((point) => {
      const record = asRecord(point);
      const x = asNumber(record?.x);
      const y = asNumber(record?.y);
      return x === null || y === null ? null : { x, y };
    })
    .filter((point): point is Point => point !== null);
}

function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function projectPointToSegment(
  point: Point,
  start: Point,
  end: Point,
): Point & { t: number; distance: number } {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return { x: start.x, y: start.y, t: 0, distance: distance(point, start) };
  }
  const rawT = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lenSq;
  const t = Math.max(0, Math.min(1, rawT));
  const projected = { x: Math.round(start.x + dx * t), y: Math.round(start.y + dy * t) };
  return { ...projected, t, distance: distance(point, projected) };
}

export function insertVertexOnWire(
  points: Point[],
  point: Point,
): { points: Point[]; insertIndex: number } | null {
  if (points.length < 2) {
    return null;
  }

  let bestIndex = -1;
  let bestProjection: (Point & { t: number; distance: number }) | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const curr = points[index];
    if (!prev || !curr) continue;
    const projection = projectPointToSegment(point, prev, curr);
    if (projection.distance < bestDistance) {
      bestDistance = projection.distance;
      bestProjection = projection;
      bestIndex = index;
    }
  }

  if (!bestProjection || bestIndex < 1) return null;
  const result = [...points];
  const prev = result[bestIndex - 1];
  const curr = result[bestIndex];
  if (!prev || !curr) return null;
  if (pointKey(prev) === pointKey(bestProjection)) return { points: result, insertIndex: bestIndex - 1 };
  if (pointKey(curr) === pointKey(bestProjection)) return { points: result, insertIndex: bestIndex };
  result.splice(bestIndex, 0, { x: bestProjection.x, y: bestProjection.y });
  return { points: result, insertIndex: bestIndex };
}

export function sanitizePath(points: Point[]): Point[] {
  const output: Point[] = [];
  for (const point of points) {
    const prev = output[output.length - 1];
    if (!prev || pointKey(prev) !== pointKey(point)) {
      output.push(point);
    }
  }
  return output;
}

function buildManhattanPathThroughAnchors(anchors: Point[]): Point[] {
  if (anchors.length <= 1) return anchors;
  const path: Point[] = [{ ...anchors[0]! }];
  for (let index = 1; index < anchors.length; index += 1) {
    const next = anchors[index];
    const prev = path[path.length - 1];
    if (!next || !prev) continue;
    if (prev.x === next.x || prev.y === next.y) {
      path.push({ ...next });
    } else {
      path.push({ x: next.x, y: prev.y }, { ...next });
    }
  }
  return sanitizePath(path);
}

function simplifyCollinearPath(points: Point[]): Point[] {
  const deduped = sanitizePath(points);
  if (deduped.length <= 2) return deduped;
  const output: Point[] = [deduped[0]!];
  for (let index = 1; index < deduped.length - 1; index += 1) {
    const prev = output[output.length - 1];
    const curr = deduped[index];
    const next = deduped[index + 1];
    if (!prev || !curr || !next) continue;
    const isVertical = prev.x === curr.x && curr.x === next.x;
    const isHorizontal = prev.y === curr.y && curr.y === next.y;
    if (!isVertical && !isHorizontal) output.push(curr);
  }
  output.push(deduped[deduped.length - 1]!);
  return sanitizePath(output);
}

function rerouteWireWithUpdatedEndpoints(points: Point[], source: Point, target: Point): Point[] {
  if (points.length <= 2) {
    return simplifyCollinearPath(buildManhattanPathThroughAnchors([source, target]));
  }
  return simplifyCollinearPath(buildManhattanPathThroughAnchors([source, ...points.slice(1, -1), target]));
}

export function updateConnectedWireGeometry(params: {
  tx: DbClient;
  designId: string;
  movedPinIds: string[];
  nextByPinId: Map<string, Point>;
  timestamp: string;
}): void {
  const { tx, designId, movedPinIds, nextByPinId, timestamp } = params;
  if (movedPinIds.length === 0) return;

  const wireRows = tx.select().from(schematicWires).where(
    and(
      eq(schematicWires.designId, designId),
      or(inArray(schematicWires.sourcePinId, movedPinIds), inArray(schematicWires.targetPinId, movedPinIds)),
    ),
  ).all();

  for (const wireRow of wireRows) {
    const points = parseWirePointsJson(wireRow.pointsJson);
    const source = nextByPinId.get(wireRow.sourcePinId) ?? points[0];
    const target = nextByPinId.get(wireRow.targetPinId) ?? points[points.length - 1];
    if (!source || !target) continue;
    tx.update(schematicWires)
      .set({ pointsJson: JSON.stringify(rerouteWireWithUpdatedEndpoints(points, source, target)), updatedAt: timestamp })
      .where(eq(schematicWires.id, wireRow.id))
      .run();
  }
}
