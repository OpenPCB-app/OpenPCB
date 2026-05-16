/**
 * Selected PCB primitives. The three original buckets are mandatory; new
 * F5-era buckets (free holes, free pads) are optional so existing call sites
 * that construct `{ placementIds, traceIds, viaIds }` continue to compile.
 * Helpers below default missing buckets to empty sets when reading.
 */
export interface PcbSelection {
  readonly placementIds: ReadonlySet<string>;
  readonly traceIds: ReadonlySet<string>;
  readonly viaIds: ReadonlySet<string>;
  readonly freeHoleIds?: ReadonlySet<string>;
  readonly freePadIds?: ReadonlySet<string>;
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

function holeIds(s: PcbSelection): ReadonlySet<string> {
  return s.freeHoleIds ?? EMPTY_SET;
}

function padIds(s: PcbSelection): ReadonlySet<string> {
  return s.freePadIds ?? EMPTY_SET;
}

export function emptyPcbSelection(): PcbSelection {
  return {
    placementIds: new Set<string>(),
    traceIds: new Set<string>(),
    viaIds: new Set<string>(),
    freeHoleIds: new Set<string>(),
    freePadIds: new Set<string>(),
  };
}

export function clonePcbSelection(s: PcbSelection): PcbSelection {
  return {
    placementIds: new Set(s.placementIds),
    traceIds: new Set(s.traceIds),
    viaIds: new Set(s.viaIds),
    freeHoleIds: new Set(holeIds(s)),
    freePadIds: new Set(padIds(s)),
  };
}

export function isPcbSelectionEmpty(s: PcbSelection): boolean {
  return (
    s.placementIds.size === 0 &&
    s.traceIds.size === 0 &&
    s.viaIds.size === 0 &&
    holeIds(s).size === 0 &&
    padIds(s).size === 0
  );
}

export function pcbSelectionUnion(
  a: PcbSelection,
  b: PcbSelection,
): PcbSelection {
  return {
    placementIds: new Set([...a.placementIds, ...b.placementIds]),
    traceIds: new Set([...a.traceIds, ...b.traceIds]),
    viaIds: new Set([...a.viaIds, ...b.viaIds]),
    freeHoleIds: new Set([...holeIds(a), ...holeIds(b)]),
    freePadIds: new Set([...padIds(a), ...padIds(b)]),
  };
}

export function togglePlacement(s: PcbSelection, id: string): PcbSelection {
  const next = new Set(s.placementIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return { ...s, placementIds: next };
}

export function toggleTrace(s: PcbSelection, id: string): PcbSelection {
  const next = new Set(s.traceIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return { ...s, traceIds: next };
}

export function toggleVia(s: PcbSelection, id: string): PcbSelection {
  const next = new Set(s.viaIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return { ...s, viaIds: next };
}

export function toggleFreeHole(s: PcbSelection, id: string): PcbSelection {
  const next = new Set(holeIds(s));
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return { ...s, freeHoleIds: next };
}

export function toggleFreePad(s: PcbSelection, id: string): PcbSelection {
  const next = new Set(padIds(s));
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return { ...s, freePadIds: next };
}
