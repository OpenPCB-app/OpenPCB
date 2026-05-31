import { and, eq, inArray, or } from "drizzle-orm";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { asNumber, asRecord } from "./value-guards";
import { schematicWires } from "./schema";
import {
  buildManhattanPathThroughAnchors,
  orthogonalProjection,
  pointKey,
  sanitizePath,
  simplifyCollinearPath,
  type Point,
} from "./routing/manhattan";

type DbClient = BetterSQLite3Database<Record<string, unknown>>;

// Re-export shared helpers consumed elsewhere (command-executor imports
// `sanitizePath` from this module).
export { sanitizePath };

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

export function insertVertexOnWire(
  points: Point[],
  point: Point,
): { points: Point[]; insertIndex: number } | null {
  if (points.length < 2) {
    return null;
  }

  let bestIndex = -1;
  let bestPoint: Point | null = null;
  let bestDistanceSq: bigint | null = null;
  for (let index = 1; index < points.length; index += 1) {
    const prev = points[index - 1];
    const curr = points[index];
    if (!prev || !curr) continue;
    const projection = orthogonalProjection(point, prev, curr);
    if (bestDistanceSq === null || projection.distanceSq < bestDistanceSq) {
      bestDistanceSq = projection.distanceSq;
      bestPoint = projection.point;
      bestIndex = index;
    }
  }

  if (!bestPoint || bestIndex < 1) return null;
  const result = [...points];
  const prev = result[bestIndex - 1];
  const curr = result[bestIndex];
  if (!prev || !curr) return null;
  if (pointKey(prev) === pointKey(bestPoint))
    return { points: result, insertIndex: bestIndex - 1 };
  if (pointKey(curr) === pointKey(bestPoint))
    return { points: result, insertIndex: bestIndex };
  result.splice(bestIndex, 0, { x: bestPoint.x, y: bestPoint.y });
  return { points: result, insertIndex: bestIndex };
}

function rerouteWireWithUpdatedEndpoints(
  points: Point[],
  source: Point,
  target: Point,
): Point[] {
  if (points.length <= 2) {
    return simplifyCollinearPath(
      buildManhattanPathThroughAnchors([source, target]),
    );
  }
  return simplifyCollinearPath(
    buildManhattanPathThroughAnchors([source, ...points.slice(1, -1), target]),
  );
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

  const wireRows = tx
    .select()
    .from(schematicWires)
    .where(
      and(
        eq(schematicWires.designId, designId),
        or(
          inArray(schematicWires.sourcePinId, movedPinIds),
          inArray(schematicWires.targetPinId, movedPinIds),
        ),
      ),
    )
    .all();

  for (const wireRow of wireRows) {
    const points = parseWirePointsJson(wireRow.pointsJson);
    const source = nextByPinId.get(wireRow.sourcePinId) ?? points[0];
    const target =
      nextByPinId.get(wireRow.targetPinId) ?? points[points.length - 1];
    if (!source || !target) continue;
    tx.update(schematicWires)
      .set({
        pointsJson: JSON.stringify(
          rerouteWireWithUpdatedEndpoints(points, source, target),
        ),
        updatedAt: timestamp,
      })
      .where(eq(schematicWires.id, wireRow.id))
      .run();
  }
}
