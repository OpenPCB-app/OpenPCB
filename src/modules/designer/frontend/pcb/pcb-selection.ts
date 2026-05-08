export interface PcbSelection {
  readonly placementIds: ReadonlySet<string>;
  readonly traceIds: ReadonlySet<string>;
  readonly viaIds: ReadonlySet<string>;
}

export function emptyPcbSelection(): PcbSelection {
  return {
    placementIds: new Set<string>(),
    traceIds: new Set<string>(),
    viaIds: new Set<string>(),
  };
}

export function clonePcbSelection(s: PcbSelection): PcbSelection {
  return {
    placementIds: new Set(s.placementIds),
    traceIds: new Set(s.traceIds),
    viaIds: new Set(s.viaIds),
  };
}

export function isPcbSelectionEmpty(s: PcbSelection): boolean {
  return (
    s.placementIds.size === 0 && s.traceIds.size === 0 && s.viaIds.size === 0
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
