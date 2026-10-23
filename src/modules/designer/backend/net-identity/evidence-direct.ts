import { isValidViaSpan } from "../../../../sdks/designer";
import { boardCopperRecords } from "../../../../shared/pcb-connectivity/board-connectivity";
import { computeConnectivity, padRecordKey, toCopperItems, traceItemKey, viaItemKey, type CopperItem, type CopperRecords } from "../../../../shared/pcb-connectivity";
import { compareEvidenceText, copperReferenceKey, EVIDENCE_GRAPH_NET, evidenceSet, type CopperIsland, type DirectEvidenceGraph, type LegacyContactEvidenceInput } from "./evidence-types";

const finitePoint = (point: { x: number; y: number }): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);

function duplicateIds(rows: readonly { id: string }[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.id)) duplicates.add(row.id);
    seen.add(row.id);
  }
  return duplicates;
}

function exactRecords(records: CopperRecords, input: LegacyContactEvidenceInput): CopperRecords {
  const parts = duplicateIds(input.placements);
  const pads = duplicateIds(input.freePads);
  const traces = duplicateIds(input.traces);
  const vias = duplicateIds(input.vias);
  return {
    validCopperLayers: records.validCopperLayers,
    pads: records.pads.filter((pad) => pad.exactShape && !pad.declaredLayerInvalid &&
      (pad.anchor.kind === "pad" ? !parts.has(pad.anchor.placementId) : !pads.has(pad.anchor.freePadId)) &&
      Number.isFinite(pad.widthMm) && pad.widthMm > 0 && Number.isFinite(pad.heightMm) && pad.heightMm > 0 &&
      finitePoint(pad.center) && pad.ring.every(finitePoint)),
    traces: records.traces.filter((trace) => records.validCopperLayers.has(trace.layer) &&
      !traces.has(trace.id) &&
      Number.isFinite(trace.widthMm) && trace.widthMm > 0 && trace.pointsMm.length >= 2 && trace.pointsMm.every(finitePoint) &&
      trace.pointsMm.some((point) => point.x !== trace.pointsMm[0]!.x || point.y !== trace.pointsMm[0]!.y)),
    vias: records.vias.filter((via) => !via.layerSpanInvalid && finitePoint(via.center) &&
      !vias.has(via.via.id) &&
      Number.isFinite(via.radiusMm) && via.radiusMm > 0 &&
      Number.isFinite(via.via.drillMm) && via.via.drillMm > 0 && via.via.drillMm < via.via.diameterMm &&
      isValidViaSpan(via.via.fromLayer, via.via.toLayer, via.via.viaType, input.board.layerCount).ok),
  };
}

function unambiguousItems(records: CopperRecords): CopperItem[] {
  const counts = new Map<string, number>();
  const add = (key: string): void => { counts.set(key, (counts.get(key) ?? 0) + 1); };
  for (const pad of records.pads) {
    if (!pad.plated && pad.resolvedLayers.length >= 2) {
      for (const layer of pad.resolvedLayers) add(padRecordKey(pad, layer));
    } else add(padRecordKey(pad));
  }
  for (const trace of records.traces) add(traceItemKey(trace.id));
  for (const via of records.vias) add(viaItemKey(via.via.id));
  const padByRing = new Map(records.pads.map((pad) => [pad.ring, pad]));
  // A suffixed duplicate key must never borrow a fill membership witness.
  return toCopperItems(records).filter((item) => {
    const pad = item.kind === "pad" ? padByRing.get(item.ring as typeof records.pads[number]["ring"]) : undefined;
    const base = item.kind === "trace" ? traceItemKey(item.id) : item.kind === "via" ? viaItemKey(item.id) :
      pad ? padRecordKey(pad, !pad.plated && pad.resolvedLayers.length >= 2 ? (item.kind === "pad" ? item.layers[0] : undefined) : undefined) : null;
    return base !== null && item.key === base && counts.get(base) === 1;
  })
    .sort((a, b) => compareEvidenceText(a.key, b.key));
}

function referenceOf(item: CopperItem): string | null {
  if (item.kind === "trace" || item.kind === "via") return copperReferenceKey(item.kind, item.id);
  if (item.kind === "pad" && item.anchor.kind === "freePad") return copperReferenceKey("freePad", item.anchor.freePadId);
  return null;
}

function sourceLabels(records: CopperRecords, items: readonly CopperItem[]): Map<string, string> {
  const retained = new Set(items.map((item) => item.key));
  return new Map(records.pads.flatMap((pad) => {
    const key = padRecordKey(pad);
    return pad.anchor.kind === "pad" && pad.plated && pad.netId && retained.has(key)
      ? [[key, pad.netId] as const] : [];
  }));
}

function physicalIslands(graph: Omit<DirectEvidenceGraph, "islands" | "islandOf">): CopperIsland[] {
  const physical = computeConnectivity(graph.items.map((item) => ({ ...item, netId: EVIDENCE_GRAPH_NET })));
  return physical.components.map((component) => {
    const itemKeys = [...component.itemKeys];
    const refKeys = evidenceSet(itemKeys.flatMap((key) => graph.refByItem.has(key) ? [graph.refByItem.get(key)!] : []));
    const directPadNets = evidenceSet(itemKeys.flatMap((key) => graph.sourceByItem.has(key) ? [graph.sourceByItem.get(key)!] : []));
    return {
      itemKeys, refKeys: [...refKeys],
      legacyIds: evidenceSet([...refKeys].flatMap((key) => graph.legacyByRef.get(key) ? [graph.legacyByRef.get(key)!] : [])),
      directPadNets, padNets: new Set(directPadNets), pourNetIds: new Set<string>(), pour: false,
    };
  });
}

export function directContactEvidence(input: LegacyContactEvidenceInput): DirectEvidenceGraph {
  const sort = <T extends { id: string }>(rows: readonly T[]): T[] => [...rows].sort((a, b) =>
    compareEvidenceText(a.id, b.id) || compareEvidenceText(JSON.stringify(a), JSON.stringify(b)));
  const raw = boardCopperRecords({ ...input, layerCount: input.board.layerCount,
    placements: sort(input.placements), traces: sort(input.traces), vias: sort(input.vias), freePads: sort(input.freePads) });
  const records = exactRecords(raw, input);
  const items = unambiguousItems(records);
  const refByItem = new Map(items.flatMap((item) => {
    const ref = referenceOf(item);
    return ref === null ? [] : [[item.key, ref] as const];
  }));
  const legacyByRef = new Map<string, string | null>([
    ...input.traces.map((row) => [copperReferenceKey("trace", row.id), row.netId] as const),
    ...input.vias.map((row) => [copperReferenceKey("via", row.id), row.netId] as const),
    ...input.freePads.map((row) => [copperReferenceKey("freePad", row.id), row.netId] as const),
  ].sort(([a], [b]) => compareEvidenceText(a, b)));
  const graph = { records: raw, items, sourceByItem: sourceLabels(records, items), refByItem, legacyByRef };
  const islands = physicalIslands(graph);
  return { ...graph, islands, islandOf: new Map(islands.flatMap((island) => island.itemKeys.map((key) => [key, island]))) };
}
