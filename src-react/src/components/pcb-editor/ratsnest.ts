import { UnionFind } from "@/lib/union-find";
import { getPadWorldPosition } from "./canvas/pcb-hit-test";
import type {
  PcbNet,
  PcbPlacement,
  Point2D,
  RatsnestLine,
  TraceSegment,
  Via,
} from "./pcb-types";

const CONNECTION_TOLERANCE_MM = 0.01;

interface PadPosition {
  position: Point2D;
}

interface GroupCentroid {
  position: Point2D;
  root: number;
}

function distance(a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function isPointNear(a: Point2D, b: Point2D, tolerance = CONNECTION_TOLERANCE_MM): boolean {
  return distance(a, b) <= tolerance;
}

function findPadAtPosition(
  position: Point2D,
  padPositions: Map<number, Point2D>,
  tolerance = CONNECTION_TOLERANCE_MM,
): number | null {
  for (const [padIndex, padPosition] of padPositions) {
    if (isPointNear(position, padPosition, tolerance)) {
      return padIndex;
    }
  }

  return null;
}

function createTraceEndpoints(trace: TraceSegment): Point2D[] {
  return [trace.start, trace.end];
}

function createViaEndpoints(via: Via): Point2D[] {
  return [via.position];
}

function calculateCentroid(points: Point2D[]): Point2D {
  const sum = points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 },
  );

  return {
    x: sum.x / points.length,
    y: sum.y / points.length,
  };
}

function buildGroupCentroids(
  uf: UnionFind,
  padPositions: PadPosition[],
): GroupCentroid[] {
  const padsByRoot = new Map<number, Point2D[]>();

  for (let padIndex = 0; padIndex < padPositions.length; padIndex += 1) {
    const root = uf.find(padIndex);
    const group = padsByRoot.get(root) ?? [];
    group.push(padPositions[padIndex]!.position);
    padsByRoot.set(root, group);
  }

  return Array.from(padsByRoot.entries()).map(([root, points]) => ({
    root,
    position: calculateCentroid(points),
  }));
}

export function calculateRatsnest(
  nets: PcbNet[],
  placements: PcbPlacement[],
  traces: TraceSegment[],
  vias: Via[],
): RatsnestLine[] {
  const placementMap = new Map(placements.map((p) => [p.id, p]));
  const ratsnestLines: RatsnestLine[] = [];

  for (const net of nets) {
    if (net.padRefs.length < 2) {
      continue;
    }

    const padPositions: PadPosition[] = [];

    for (const padRef of net.padRefs) {
      const placement = placementMap.get(padRef.componentId);
      if (!placement) {
        continue;
      }

      const position = getPadWorldPosition(
        placements,
        padRef.componentId,
        padRef.padNumber,
      );
      if (!position) {
        continue;
      }

      padPositions.push({ position });
    }

    if (padPositions.length < 2) {
      continue;
    }

    const netTraces = traces.filter((trace) => trace.net === net.id);
    const netVias = vias.filter((via) => via.net === net.id);
    const padPositionMap = new Map(
      padPositions.map((pad, index) => [index, pad.position]),
    );
    const traceOffset = padPositions.length;
    const viaOffset = traceOffset + netTraces.length;
    const uf = new UnionFind(padPositions.length + netTraces.length + netVias.length);

    for (const [traceIndex, trace] of netTraces.entries()) {
      const traceNode = traceOffset + traceIndex;

      for (const endpoint of createTraceEndpoints(trace)) {
        const matchedPad = findPadAtPosition(endpoint, padPositionMap);
        if (matchedPad !== null) {
          uf.union(traceNode, matchedPad);
        }
      }
    }

    for (const [viaIndex, via] of netVias.entries()) {
      const viaNode = viaOffset + viaIndex;

      for (const endpoint of createViaEndpoints(via)) {
        const matchedPad = findPadAtPosition(endpoint, padPositionMap);
        if (matchedPad !== null) {
          uf.union(viaNode, matchedPad);
        }
      }
    }

    for (let traceIndex = 0; traceIndex < netTraces.length; traceIndex += 1) {
      const trace = netTraces[traceIndex]!;
      const traceNode = traceOffset + traceIndex;

      for (let otherTraceIndex = traceIndex + 1; otherTraceIndex < netTraces.length; otherTraceIndex += 1) {
        const otherTrace = netTraces[otherTraceIndex]!;
        const otherTraceNode = traceOffset + otherTraceIndex;

        const sharesEndpoint = createTraceEndpoints(trace).some((endpoint) =>
          createTraceEndpoints(otherTrace).some((otherEndpoint) =>
            isPointNear(endpoint, otherEndpoint),
          ),
        );

        if (sharesEndpoint) {
          uf.union(traceNode, otherTraceNode);
        }
      }

      for (const [viaIndex, via] of netVias.entries()) {
        const viaNode = viaOffset + viaIndex;
        const touchesVia = createTraceEndpoints(trace).some((endpoint) =>
          isPointNear(endpoint, via.position),
        );

        if (touchesVia) {
          uf.union(traceNode, viaNode);
        }
      }
    }

    for (let viaIndex = 0; viaIndex < netVias.length; viaIndex += 1) {
      const via = netVias[viaIndex]!;
      const viaNode = viaOffset + viaIndex;

      for (let otherViaIndex = viaIndex + 1; otherViaIndex < netVias.length; otherViaIndex += 1) {
        const otherVia = netVias[otherViaIndex]!;
        const otherViaNode = viaOffset + otherViaIndex;

        if (isPointNear(via.position, otherVia.position)) {
          uf.union(viaNode, otherViaNode);
        }
      }
    }

    const groupCentroids = buildGroupCentroids(uf, padPositions);
    if (groupCentroids.length < 2) {
      continue;
    }

    const centroidEdges: Array<{ i: number; j: number; dist: number }> = [];
    for (let i = 0; i < groupCentroids.length; i += 1) {
      for (let j = i + 1; j < groupCentroids.length; j += 1) {
        centroidEdges.push({
          i,
          j,
          dist: distance(groupCentroids[i]!.position, groupCentroids[j]!.position),
        });
      }
    }

    centroidEdges.sort((a, b) => a.dist - b.dist);

    const groupUf = new UnionFind(groupCentroids.length);

    for (const edge of centroidEdges) {
      if (groupUf.connected(edge.i, edge.j)) {
        continue;
      }

      groupUf.union(edge.i, edge.j);
      ratsnestLines.push({
        start: groupCentroids[edge.i]!.position,
        end: groupCentroids[edge.j]!.position,
        netId: net.id,
      });
    }
  }

  return ratsnestLines;
}
