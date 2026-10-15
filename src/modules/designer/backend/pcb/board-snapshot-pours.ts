import type {
  DesignerPcbProjection,
  PcbPointMm,
  PourIsland,
  SnapshotCopperLayerId,
} from "../../../../sdks/designer";
import { ringSignedArea } from "../../../../shared/pcb-geometry/ring-utils";
import type { CopperFillResult } from "../../../../shared/rendering/copper-fill/copper-fill-geometry";
import { buildProjectionPours } from "../../../../shared/rendering/copper-fill/projection-pours";
import { zonePourNets } from "../../../../shared/pcb-areas";
import {
  escapeStructuralIdSegment,
  fnv1a64,
} from "../drc/violation-id";

const SNAPSHOT_LAYER_SET = new Set<string>(["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"]);
const COPPER_LAYER_ORDER: readonly SnapshotCopperLayerId[] = [
  "F.Cu",
  "In1.Cu",
  "In2.Cu",
  "B.Cu",
];
const COORD_DECIMALS = 4;
const COORD_SCALE = 10 ** COORD_DECIMALS;

type PourSource = {
  readonly kind: "board" | "zone";
  readonly sourceId: string;
  readonly layer: SnapshotCopperLayerId;
  readonly pourNetId: string | null;
  /** The zone's fill — the ONE kernel argument set (OPENPCB-67 §3.8). */
  readonly result: CopperFillResult;
};

type PendingPourIsland = PourIsland & {
  readonly sourceOrder: string;
  readonly geometryOrder: string;
};

/**
 * The snapshot's pour islands. `warnings` is the caller's warning sink (plain
 * strings, as everywhere in `board-snapshot.ts`): a zone whose fill BAILED
 * (copper-pour contract §8) contributes no islands, and silently sending the
 * autorouter a board with a missing plane is exactly the failure the `failed`
 * status exists to prevent — so it is named here instead.
 */
export function buildSnapshotPourIslands(
  projection: DesignerPcbProjection,
  warnings: string[] = [],
): PourIsland[] {
  const pending: PendingPourIsland[] = [];
  for (const source of pourSources(projection)) {
    const { result } = source;
    if (result.status === "failed") {
      warnings.push(
        `Copper pour "${source.sourceId}" on ${source.layer} could not be filled (${result.reason}); it was not sent to the cloud service.`,
      );
      continue;
    }
    for (const { rings } of result.islands) {
      const normalized = normalizeIslandRings(rings);
      if (!normalized) continue;
      const geometryOrder = ringsKey(normalized);
      const sourceOrder = sourceSortKey(source);
      pending.push({
        islandId: `pour-${fnv1a64(`${sourceOrder}|${geometryOrder}`)}`,
        layer: source.layer,
        pourNetId: source.pourNetId,
        rings: normalized,
        sourceOrder,
        geometryOrder,
      });
    }
  }
  return pending
    .sort((a, b) => comparePendingPourIsland(a, b))
    .map(({ islandId, layer, pourNetId, rings }) => ({
      islandId,
      layer,
      pourNetId,
      rings,
    }));
}

function pourSources(projection: DesignerPcbProjection): PourSource[] {
  const netNames = projection.netNames ?? {};
  // The ONE derivation (contract §3.1) filled with the ONE argument set
  // (OPENPCB-67 §3.8), the same keepouts the canvas, Gerber and DRC subtract
  // (§13.3) included: a snapshot island that ignored a `copperPour` keepout
  // would send the autorouter copper the board will never manufacture.
  // `sourceId` is the effective zone's id — `board:<layer>` for a board zone,
  // the zone id for an explicit one — so the hashed `islandId` stays
  // byte-stable across this rewiring.
  const pours = buildProjectionPours(
    {
      ...projection,
      padNets: projection.padNets ?? {},
      netNames,
      keepouts: projection.keepouts ?? [],
    },
    { nets: zonePourNets(projection.board, netNames) },
  );
  const sources: PourSource[] = [];
  for (const { zone, result } of pours) {
    if (!SNAPSHOT_LAYER_SET.has(zone.layer)) continue;
    sources.push({
      kind: zone.sourceKind,
      sourceId: zone.id,
      layer: zone.layer as SnapshotCopperLayerId,
      pourNetId: zone.netId,
      result,
    });
  }
  return sources.sort((a, b) => sourceSortKey(a).localeCompare(sourceSortKey(b)));
}

function normalizeIslandRings(
  rings: ReadonlyArray<ReadonlyArray<PcbPointMm>>,
): PcbPointMm[][] | null {
  const outer = rings.at(0);
  if (!outer) return null;
  const normalizedOuter = normalizeRing(outer, "ccw");
  if (!normalizedOuter) return null;
  const holes = rings
    .slice(1)
    .map((ring) => normalizeRing(ring, "cw"))
    .filter((ring): ring is PcbPointMm[] => ring !== null)
    .sort((a, b) => ringsKey([a]).localeCompare(ringsKey([b])));
  return [normalizedOuter, ...holes];
}

function normalizeRing(
  ring: ReadonlyArray<PcbPointMm>,
  winding: "ccw" | "cw",
): PcbPointMm[] | null {
  const points = removeClosingDuplicate(removeConsecutiveDuplicates(ring.map(quantizePoint)));
  if (points.length < 3 || ringSignedArea(points) === 0) return null;
  const area = ringSignedArea(points);
  const shouldReverse = winding === "ccw" ? area < 0 : area > 0;
  return shouldReverse ? [...points].reverse() : points;
}

function quantizePoint(point: PcbPointMm): PcbPointMm {
  return {
    x: quantizeCoord(point.x),
    y: quantizeCoord(point.y),
  };
}

function quantizeCoord(value: number): number {
  const rounded = Math.round(value * COORD_SCALE) / COORD_SCALE;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function removeConsecutiveDuplicates(points: readonly PcbPointMm[]): PcbPointMm[] {
  const result: PcbPointMm[] = [];
  for (const point of points) {
    const previous = result.at(-1);
    if (previous && samePoint(previous, point)) continue;
    result.push(point);
  }
  return result;
}

function removeClosingDuplicate(points: readonly PcbPointMm[]): PcbPointMm[] {
  const first = points.at(0);
  const last = points.at(-1);
  if (first && last && points.length > 1 && samePoint(first, last)) {
    return points.slice(0, -1);
  }
  return [...points];
}

function samePoint(a: PcbPointMm, b: PcbPointMm): boolean {
  return a.x === b.x && a.y === b.y;
}

function sourceSortKey(source: PourSource): string {
  return [
    COPPER_LAYER_ORDER.indexOf(source.layer).toString().padStart(2, "0"),
    source.kind === "board" ? "0" : "1",
    escapeStructuralIdSegment(source.sourceId),
    escapeStructuralIdSegment(source.pourNetId ?? ""),
  ].join("|");
}

function ringsKey(rings: readonly (readonly PcbPointMm[])[]): string {
  return rings
    .map((ring) => ring.map((point) => `${point.x},${point.y}`).join(";"))
    .join("/");
}

function comparePendingPourIsland(
  a: PendingPourIsland,
  b: PendingPourIsland,
): number {
  const source = a.sourceOrder.localeCompare(b.sourceOrder);
  if (source !== 0) return source;
  return a.geometryOrder.localeCompare(b.geometryOrder);
}
