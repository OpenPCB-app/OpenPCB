import type {
  PcbNet,
  PcbPlacement,
  Point2D,
  RatsnestLine,
  TraceSegment,
  Via,
} from "./pcb-types";
import { UnionFind } from "@/lib/union-find";

interface PadPosition {
  padRef: { componentId: string; padNumber: string };
  position: Point2D;
  netId: string;
}

function resolvePadWorldPosition(
  placement: PcbPlacement,
  padNumber: string,
): Point2D | null {
  const pad = placement.footprintData.pads.find((p) => p.number === padNumber);
  if (!pad) return null;

  const radians = (placement.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);

  const rotatedX = pad.position.x * cos - pad.position.y * sin;
  const rotatedY = pad.position.x * sin + pad.position.y * cos;

  return {
    x: placement.position.x + rotatedX,
    y: placement.position.y + rotatedY,
  };
}

function distance(a: Point2D, b: Point2D): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function calculateRatsnest(
  nets: PcbNet[],
  placements: PcbPlacement[],
  _traces: TraceSegment[],
  _vias: Via[],
): RatsnestLine[] {
  const placementMap = new Map(placements.map((p) => [p.id, p]));
  const ratsnestLines: RatsnestLine[] = [];

  for (const net of nets) {
    if (net.padRefs.length < 2) continue;

    const padPositions: PadPosition[] = [];

    for (const padRef of net.padRefs) {
      const placement = placementMap.get(padRef.componentId);
      if (!placement) continue;

      const position = resolvePadWorldPosition(placement, padRef.padNumber);
      if (!position) continue;

      padPositions.push({ padRef, position, netId: net.id });
    }

    if (padPositions.length < 2) continue;

    const edges: Array<{ i: number; j: number; dist: number }> = [];
    for (let i = 0; i < padPositions.length; i++) {
      for (let j = i + 1; j < padPositions.length; j++) {
        const dist = distance(
          padPositions[i]!.position,
          padPositions[j]!.position,
        );
        edges.push({ i, j, dist });
      }
    }

    edges.sort((a, b) => a.dist - b.dist);

    const uf = new UnionFind(padPositions.length);

    for (const edge of edges) {
      if (!uf.connected(edge.i, edge.j)) {
        uf.union(edge.i, edge.j);

        ratsnestLines.push({
          start: padPositions[edge.i]!.position,
          end: padPositions[edge.j]!.position,
          netId: net.id,
        });
      }
    }
  }

  return ratsnestLines;
}
