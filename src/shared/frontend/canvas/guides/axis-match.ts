/**
 * Pure 1-D collinearity matcher. Given features sorted on one axis and a set
 * of query coordinates, find for each query the nearest feature within
 * tolerance, grouping features that share that coordinate so N collinear
 * objects emit ONE guide carrying all their source ids.
 *
 * No PCB / three / React imports. Shared by the PCB editor and the library
 * (footprint + symbol) draw editors.
 */

export interface AxisFeature {
  /** Position along the matched axis (mm). */
  coordMm: number;
  /** Extent on the OTHER axis (for draw-span). */
  crossMin: number;
  crossMax: number;
  sourceId: string;
}

export interface AxisQuery {
  coordMm: number;
  crossMin: number;
  crossMax: number;
}

export interface AxisMatch {
  /** The feature coordinate the query aligns to. */
  coordMm: number;
  /** `coordMm - query.coordMm` — correction to land the query on the guide. */
  deltaMm: number;
  /** All features sharing `coordMm` (within epsilon). */
  sourceIds: string[];
  /** Union of the query's and matched features' cross-extents. */
  crossMin: number;
  crossMax: number;
}

/** Features within this distance (mm) are treated as sharing a coordinate. */
const COORD_EPS = 1e-4;

export function sortFeatures(features: AxisFeature[]): AxisFeature[] {
  return [...features].sort((a, b) => a.coordMm - b.coordMm);
}

/** First index whose coord is >= target (binary search on sorted features). */
function lowerBound(
  sorted: ReadonlyArray<AxisFeature>,
  target: number,
): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]!.coordMm < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * For each query (in order), return its best match or `null`. O(log n + k)
 * per query via binary search into the [q-tol, q+tol] window.
 */
export function matchAxis(
  sorted: ReadonlyArray<AxisFeature>,
  queries: ReadonlyArray<AxisQuery>,
  toleranceMm: number,
): Array<AxisMatch | null> {
  return queries.map((q) => {
    const lo = lowerBound(sorted, q.coordMm - toleranceMm);
    const hiCoord = q.coordMm + toleranceMm;

    let best: AxisFeature | null = null;
    let bestAbs = Infinity;
    for (let i = lo; i < sorted.length; i += 1) {
      const f = sorted[i]!;
      if (f.coordMm > hiCoord) break;
      const abs = Math.abs(f.coordMm - q.coordMm);
      if (abs < bestAbs) {
        bestAbs = abs;
        best = f;
      }
    }
    if (!best) return null;

    // Group every feature sharing best.coordMm to merge source ids + span.
    const sourceIds: string[] = [];
    let crossMin = q.crossMin;
    let crossMax = q.crossMax;
    for (let i = lo; i < sorted.length; i += 1) {
      const f = sorted[i]!;
      if (f.coordMm > hiCoord) break;
      if (Math.abs(f.coordMm - best.coordMm) <= COORD_EPS) {
        sourceIds.push(f.sourceId);
        if (f.crossMin < crossMin) crossMin = f.crossMin;
        if (f.crossMax > crossMax) crossMax = f.crossMax;
      }
    }

    return {
      coordMm: best.coordMm,
      deltaMm: best.coordMm - q.coordMm,
      sourceIds,
      crossMin,
      crossMax,
    };
  });
}
